"""
Smart Queue Manager for Background Remover & Object Remover
============================================================
Designed for 24GB RAM / 4 vCPUs Oracle Cloud instance

Queue Strategy:
- Fast mode (RVM/U2Net-P): 3 concurrent workers (lighter memory, fast)
- Pro mode (BiRefNet): 2 concurrent workers (heavier memory, slower)
- Object Remover (Big-Lama): 1 concurrent worker (very heavy)

Total: 6 workers max across both apps, with dynamic memory management
"""
import threading
import time
import logging
import psutil
import gc
from collections import deque
from dataclasses import dataclass
from typing import Optional, Callable, Any
from enum import Enum

logger = logging.getLogger(__name__)


class JobType(Enum):
    """Job types with different resource requirements"""
    BG_FAST = "bg_fast"      # Background removal - fast mode
    BG_PRO = "bg_pro"        # Background removal - pro mode
    OBJ_REMOVE = "obj_remove"  # Object removal (Big-Lama)


class JobStatus(Enum):
    """Job lifecycle states"""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


@dataclass
class Job:
    """Represents a processing job"""
    job_id: str
    job_type: JobType
    task_func: Callable
    args: tuple = ()
    kwargs: dict = None
    
    # State
    status: JobStatus = JobStatus.QUEUED
    result: Any = None
    error: Optional[str] = None
    
    # Timing
    queued_at: float = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    
    # Event for waiting
    event: threading.Event = None
    
    def __post_init__(self):
        if self.kwargs is None:
            self.kwargs = {}
        if self.queued_at is None:
            self.queued_at = time.time()
        if self.event is None:
            self.event = threading.Event()
    
    @property
    def wait_time(self) -> float:
        """How long the job waited in queue (seconds)"""
        if self.started_at:
            return self.started_at - self.queued_at
        return time.time() - self.queued_at
    
    @property
    def processing_time(self) -> Optional[float]:
        """How long the job took to process (seconds)"""
        if self.completed_at and self.started_at:
            return self.completed_at - self.started_at
        return None
    
    @property
    def total_time(self) -> Optional[float]:
        """Total time from queue to completion (seconds)"""
        if self.completed_at:
            return self.completed_at - self.queued_at
        return None


class SmartQueueManager:
    """
    Smart queue manager with lane-based concurrency control and DYNAMIC SCALING.
    
    Configuration for 24GB RAM / 4 vCPUs:
    - BG Fast: 3 concurrent (RVM/U2Net-P ~500MB each)
    - BG Pro: 2 concurrent (BiRefNet ~2GB each)
    - Object Removal: 1 concurrent (Big-Lama ~3GB)
    
    DYNAMIC SCALING: Automatically extends worker capacity when resources are free.
    - If object remover is idle, reallocate capacity to BG removal
    - If memory < 50%, temporarily boost active queue capacities
    - If CPU < 60%, allow more concurrent jobs
    
    Memory safety: automatic throttling when RAM usage exceeds thresholds.
    """
    
    def __init__(
        self,
        bg_fast_workers: int = 3,
        bg_pro_workers: int = 2,
        obj_remove_workers: int = 1,
        max_queue_size: int = 50,
        job_timeout: float = 60,
        memory_critical_threshold: float = 85,
        memory_warning_threshold: float = 75,
        enable_dynamic_scaling: bool = True,
        scaling_check_interval: float = 5.0
    ):
        # Worker capacity per job type (BASE capacity)
        self.base_capacity = {
            JobType.BG_FAST: bg_fast_workers,
            JobType.BG_PRO: bg_pro_workers,
            JobType.OBJ_REMOVE: obj_remove_workers
        }
        
        # Current capacity (can be dynamically adjusted)
        self.capacity = self.base_capacity.copy()
        
        # Maximum capacity (don't exceed this even when scaling)
        self.max_capacity = {
            JobType.BG_FAST: bg_fast_workers + 2,  # Can boost by 2
            JobType.BG_PRO: bg_pro_workers + 1,    # Can boost by 1
            JobType.OBJ_REMOVE: obj_remove_workers
        }
        
        # Queues per job type
        self.queues = {
            JobType.BG_FAST: deque(),
            JobType.BG_PRO: deque(),
            JobType.OBJ_REMOVE: deque()
        }
        
        # Active workers per job type
        self.active_workers = {
            JobType.BG_FAST: 0,
            JobType.BG_PRO: 0,
            JobType.OBJ_REMOVE: 0
        }
        
        # Semaphores for concurrency control
        self.semaphores = {
            JobType.BG_FAST: threading.Semaphore(bg_fast_workers),
            JobType.BG_PRO: threading.Semaphore(bg_pro_workers),
            JobType.OBJ_REMOVE: threading.Semaphore(obj_remove_workers)
        }
        
        # Configuration
        self.max_queue_size = max_queue_size
        self.job_timeout = job_timeout
        self.memory_critical_threshold = memory_critical_threshold
        self.memory_warning_threshold = memory_warning_threshold
        self.enable_dynamic_scaling = enable_dynamic_scaling
        self.scaling_check_interval = scaling_check_interval
        
        # Dynamic scaling state
        self.last_scaling_check = time.time()
        self.scaling_lock = threading.Lock()
        
        # Thread safety
        self.lock = threading.Lock()
        self.jobs = {}  # job_id -> Job
        
        # Stats
        self.stats = {
            'total_jobs': 0,
            'completed_jobs': 0,
            'failed_jobs': 0,
            'timeout_jobs': 0,
            'rejected_jobs': 0
        }
        
        # Worker threads
        self.workers = []
        self.shutdown_event = threading.Event()
        
        logger.info(f"Queue Manager initialized: BG_Fast={bg_fast_workers}, BG_Pro={bg_pro_workers}, ObjRemove={obj_remove_workers}")
        logger.info(f"Dynamic scaling: {'ENABLED' if enable_dynamic_scaling else 'DISABLED'}")
        
        # Start worker threads
        self._start_workers()
        
        # Start dynamic scaling thread if enabled
        if self.enable_dynamic_scaling:
            self._start_scaling_monitor()
    
    def _start_workers(self):
        """Start worker threads for each job type"""
        for job_type in JobType:
            for i in range(self.capacity[job_type]):
                worker = threading.Thread(
                    target=self._worker_loop,
                    args=(job_type, i),
                    daemon=True,
                    name=f"{job_type.value}-worker-{i}"
                )
                worker.start()
                self.workers.append(worker)
                logger.info(f"Started worker: {job_type.value}-{i}")
    
    def _start_scaling_monitor(self):
        """Start background thread for dynamic scaling"""
        scaling_thread = threading.Thread(
            target=self._scaling_monitor_loop,
            daemon=True,
            name="scaling-monitor"
        )
        scaling_thread.start()
        logger.info("Dynamic scaling monitor started")
    
    def _scaling_monitor_loop(self):
        """Monitor system resources and adjust capacity dynamically"""
        logger.info("Scaling monitor loop started")
        
        while not self.shutdown_event.is_set():
            try:
                time.sleep(self.scaling_check_interval)
                self._adjust_capacity_dynamically()
            except Exception as e:
                logger.error(f"Scaling monitor error: {e}", exc_info=True)
    
    def _adjust_capacity_dynamically(self):
        """
        Dynamically adjust worker capacity based on:
        1. Current queue demand (which queues have jobs waiting)
        2. Available system resources (memory, CPU)
        3. Idle workers in other queues
        """
        with self.scaling_lock:
            mem = psutil.virtual_memory()
            cpu_percent = psutil.cpu_percent(interval=0.5)
            
            # Calculate total idle capacity
            total_idle = 0
            idle_by_type = {}
            for job_type in JobType:
                idle = self.capacity[job_type] - self.active_workers[job_type]
                idle_by_type[job_type] = idle
                total_idle += idle
            
            # Get queue demand (how many jobs are waiting)
            demand_by_type = {}
            for job_type in JobType:
                demand_by_type[job_type] = len(self.queues[job_type])
            
            # Scaling decision logic
            changes_made = False
            
            # Rule 1: If object remover is completely idle and BG queues have demand
            if (idle_by_type[JobType.OBJ_REMOVE] == self.capacity[JobType.OBJ_REMOVE] and
                self.capacity[JobType.OBJ_REMOVE] > 0 and
                (demand_by_type[JobType.BG_FAST] > 0 or demand_by_type[JobType.BG_PRO] > 0)):
                
                # Check if we have good resources
                if mem.percent < 70 and cpu_percent < 70:
                    # Boost BG Fast if it has demand and can scale
                    if (demand_by_type[JobType.BG_FAST] > 0 and 
                        self.capacity[JobType.BG_FAST] < self.max_capacity[JobType.BG_FAST]):
                        self.capacity[JobType.BG_FAST] += 1
                        logger.info(f"🚀 Scaled UP BG_FAST: {self.capacity[JobType.BG_FAST] - 1} → {self.capacity[JobType.BG_FAST]} (obj remover idle)")
                        changes_made = True
                    
                    # Or boost BG Pro if it has demand
                    elif (demand_by_type[JobType.BG_PRO] > 0 and 
                          self.capacity[JobType.BG_PRO] < self.max_capacity[JobType.BG_PRO]):
                        self.capacity[JobType.BG_PRO] += 1
                        logger.info(f"🚀 Scaled UP BG_PRO: {self.capacity[JobType.BG_PRO] - 1} → {self.capacity[JobType.BG_PRO]} (obj remover idle)")
                        changes_made = True
            
            # Rule 2: If memory and CPU are very low, boost active queues
            if mem.percent < 50 and cpu_percent < 50:
                # Boost fast queue if it has demand
                if (demand_by_type[JobType.BG_FAST] > 2 and 
                    self.capacity[JobType.BG_FAST] < self.max_capacity[JobType.BG_FAST]):
                    self.capacity[JobType.BG_FAST] += 1
                    logger.info(f"🚀 Scaled UP BG_FAST: {self.capacity[JobType.BG_FAST] - 1} → {self.capacity[JobType.BG_FAST]} (low resource usage)")
                    changes_made = True
                
                # Boost pro queue if it has demand
                if (demand_by_type[JobType.BG_PRO] > 1 and 
                    self.capacity[JobType.BG_PRO] < self.max_capacity[JobType.BG_PRO]):
                    self.capacity[JobType.BG_PRO] += 1
                    logger.info(f"🚀 Scaled UP BG_PRO: {self.capacity[JobType.BG_PRO] - 1} → {self.capacity[JobType.BG_PRO]} (low resource usage)")
                    changes_made = True
            
            # Rule 3: Scale down if memory is getting high
            if mem.percent > 75:
                scaled_down = False
                
                # Scale down BG Fast if it's above base and has idle workers
                if (self.capacity[JobType.BG_FAST] > self.base_capacity[JobType.BG_FAST] and
                    idle_by_type[JobType.BG_FAST] > 0):
                    self.capacity[JobType.BG_FAST] -= 1
                    logger.info(f"📉 Scaled DOWN BG_FAST: {self.capacity[JobType.BG_FAST] + 1} → {self.capacity[JobType.BG_FAST]} (high memory)")
                    scaled_down = True
                
                # Scale down BG Pro if it's above base and has idle workers
                if (not scaled_down and
                    self.capacity[JobType.BG_PRO] > self.base_capacity[JobType.BG_PRO] and
                    idle_by_type[JobType.BG_PRO] > 0):
                    self.capacity[JobType.BG_PRO] -= 1
                    logger.info(f"📉 Scaled DOWN BG_PRO: {self.capacity[JobType.BG_PRO] + 1} → {self.capacity[JobType.BG_PRO]} (high memory)")
                    scaled_down = True
                
                if scaled_down:
                    changes_made = True
            
            # Rule 4: Return to base capacity when no demand and resources are good
            if mem.percent < 60 and cpu_percent < 60:
                # Check if all queues are empty or nearly empty
                if all(demand_by_type[jt] <= 1 for jt in JobType):
                    # Gradually return to base capacity
                    for job_type in [JobType.BG_FAST, JobType.BG_PRO]:
                        if self.capacity[job_type] > self.base_capacity[job_type]:
                            # Only scale down if we have idle workers
                            if idle_by_type[job_type] > 0:
                                self.capacity[job_type] -= 1
                                logger.info(f"📉 Scaled DOWN {job_type.value}: {self.capacity[job_type] + 1} → {self.capacity[job_type]} (returning to base)")
                                changes_made = True
                                break  # One at a time
            
            # Log current state if changes were made
            if changes_made:
                logger.info(f"Capacity after scaling: BG_Fast={self.capacity[JobType.BG_FAST]}/{self.max_capacity[JobType.BG_FAST]}, "
                           f"BG_Pro={self.capacity[JobType.BG_PRO]}/{self.max_capacity[JobType.BG_PRO]}, "
                           f"Mem={mem.percent:.1f}%, CPU={cpu_percent:.1f}%")
    
    def _worker_loop(self, job_type: JobType, worker_id: int):
        """Worker thread main loop"""
        logger.info(f"Worker {job_type.value}-{worker_id} started")
        
        while not self.shutdown_event.is_set():
            job = None
            
            try:
                # Wait for a job from this type's queue
                with self.lock:
                    if self.queues[job_type]:
                        job = self.queues[job_type].popleft()
                
                if not job:
                    # No jobs, sleep briefly
                    time.sleep(0.1)
                    continue
                
                # Check if we're within current capacity (dynamic scaling)
                with self.lock:
                    current_capacity = self.capacity[job_type]
                    if self.active_workers[job_type] >= current_capacity:
                        # Capacity reduced, put job back and wait
                        self.queues[job_type].appendleft(job)
                        time.sleep(0.5)
                        continue
                
                # Check memory before processing
                mem_percent = psutil.virtual_memory().percent
                if mem_percent > self.memory_critical_threshold:
                    logger.warning(f"Memory critical ({mem_percent:.1f}%), running GC before processing")
                    gc.collect()
                    time.sleep(0.5)
                    mem_percent = psutil.virtual_memory().percent
                    
                    if mem_percent > self.memory_critical_threshold:
                        # Still critical, reject job
                        job.status = JobStatus.FAILED
                        job.error = f"Server memory critical ({mem_percent:.1f}%). Please try again."
                        job.completed_at = time.time()
                        job.event.set()
                        logger.error(f"Job {job.job_id} rejected due to critical memory")
                        continue
                
                # Acquire semaphore (this blocks if lane is full)
                # Note: We use the original base capacity for semaphore,
                # but check dynamic capacity above for actual execution
                acquired = self.semaphores[job_type].acquire(timeout=self.job_timeout)
                
                if not acquired:
                    # Timeout waiting for slot
                    job.status = JobStatus.TIMEOUT
                    job.error = "Request timed out waiting for available worker"
                    job.completed_at = time.time()
                    job.event.set()
                    with self.lock:
                        self.stats['timeout_jobs'] += 1
                    logger.warning(f"Job {job.job_id} timed out waiting for worker")
                    continue
                
                try:
                    # Update active workers
                    with self.lock:
                        self.active_workers[job_type] += 1
                    
                    # Process the job
                    job.status = JobStatus.PROCESSING
                    job.started_at = time.time()
                    logger.info(f"Worker {job_type.value}-{worker_id} processing job {job.job_id} (waited {job.wait_time:.2f}s)")
                    
                    # Execute the task
                    job.completed_at = time.time()
                    try:
                        result = job.task_func(*job.args, **job.kwargs)
                        job.result = result
                        job.status = JobStatus.COMPLETED
                        with self.lock:
                            self.stats['completed_jobs'] += 1
                        logger.info(f"Job {job.job_id} completed in {job.processing_time:.2f}s")
                    except Exception as e:
                        job.status = JobStatus.FAILED
                        job.error = str(e)
                        with self.lock:
                            self.stats['failed_jobs'] += 1
                        logger.error(f"Job {job.job_id} failed: {e}")
                    job.event.set()
                    
                    # Cleanup
                    gc.collect()
                    
                finally:
                    # Release semaphore
                    self.semaphores[job_type].release()
                    with self.lock:
                        self.active_workers[job_type] -= 1
                
            except Exception as e:
                logger.error(f"Worker {job_type.value}-{worker_id} error: {e}", exc_info=True)
                if job:
                    job.status = JobStatus.FAILED
                    job.error = f"Worker error: {str(e)}"
                    job.completed_at = time.time()
                    job.event.set()
        
        logger.info(f"Worker {job_type.value}-{worker_id} shutting down")
    
    def submit_job(
        self,
        job_id: str,
        job_type: JobType,
        task_func: Callable,
        *args,
        **kwargs
    ) -> Job:
        """
        Submit a job to the queue.
        
        Returns:
            Job object that can be used to wait for completion
        
        Raises:
            ValueError: if queue is full or memory is critical
        """
        with self.lock:
            # Check queue size
            if len(self.queues[job_type]) >= self.max_queue_size:
                self.stats['rejected_jobs'] += 1
                raise ValueError(f"Queue full for {job_type.value} (max: {self.max_queue_size})")
            
            # Check memory
            mem_percent = psutil.virtual_memory().percent
            if mem_percent > self.memory_critical_threshold:
                gc.collect()
                mem_percent = psutil.virtual_memory().percent
                if mem_percent > self.memory_critical_threshold:
                    self.stats['rejected_jobs'] += 1
                    raise ValueError(f"Server memory critical ({mem_percent:.1f}%). Please try again shortly.")
            
            # Create job
            job = Job(
                job_id=job_id,
                job_type=job_type,
                task_func=task_func,
                args=args,
                kwargs=kwargs
            )
            
            # Add to queue
            self.queues[job_type].append(job)
            self.jobs[job_id] = job
            self.stats['total_jobs'] += 1
            
            queue_pos = len(self.queues[job_type])
            logger.info(f"Job {job_id} ({job_type.value}) queued at position {queue_pos}")
            
            return job
    
    def wait_for_job(self, job: Job, timeout: Optional[float] = None) -> Job:
        """
        Wait for a job to complete.
        
        Args:
            job: Job to wait for
            timeout: Maximum time to wait (None = wait forever)
        
        Returns:
            The completed job
        """
        if timeout is None:
            timeout = self.job_timeout * 2  # Default: 2x job timeout
        
        job.event.wait(timeout=timeout)
        
        if job.status == JobStatus.QUEUED or job.status == JobStatus.PROCESSING:
            # Still not done, mark as timeout
            job.status = JobStatus.TIMEOUT
            job.error = "Job exceeded maximum wait time"
            job.completed_at = time.time()
            logger.warning(f"Job {job.job_id} timed out after {timeout}s")
        
        return job
    
    def get_job_status(self, job_id: str) -> Optional[Job]:
        """Get the status of a job by ID"""
        with self.lock:
            return self.jobs.get(job_id)
    
    def get_queue_stats(self) -> dict:
        """Get current queue statistics including dynamic capacity info"""
        with self.lock:
            mem = psutil.virtual_memory()
            cpu_percent = psutil.cpu_percent(interval=0.1)
            
            queue_info = {}
            for job_type, queue in self.queues.items():
                current_cap = self.capacity[job_type]
                base_cap = self.base_capacity[job_type]
                max_cap = self.max_capacity[job_type]
                
                queue_info[job_type.value] = {
                    'queued': len(queue),
                    'active': self.active_workers[job_type],
                    'capacity': current_cap,
                    'base_capacity': base_cap,
                    'max_capacity': max_cap,
                    'utilization': f"{(self.active_workers[job_type] / current_cap * 100) if current_cap > 0 else 0:.1f}%",
                    'scaled': current_cap != base_cap,
                    'scale_direction': (
                        'UP' if current_cap > base_cap 
                        else 'DOWN' if current_cap < base_cap 
                        else 'BASE'
                    )
                }
            
            return {
                'queues': queue_info,
                'total_queued': sum(len(q) for q in self.queues.values()),
                'total_active': sum(self.active_workers.values()),
                'total_capacity': sum(self.capacity.values()),
                'base_capacity': sum(self.base_capacity.values()),
                'dynamic_scaling': {
                    'enabled': self.enable_dynamic_scaling,
                    'current_boost': sum(self.capacity.values()) - sum(self.base_capacity.values()),
                    'max_boost': sum(self.max_capacity.values()) - sum(self.base_capacity.values())
                },
                'stats': self.stats.copy(),
                'system': {
                    'memory_percent': mem.percent,
                    'memory_available_gb': mem.available / (1024**3),
                    'memory_used_gb': mem.used / (1024**3),
                    'cpu_percent': cpu_percent,
                    'memory_status': (
                        'critical' if mem.percent > self.memory_critical_threshold
                        else 'warning' if mem.percent > self.memory_warning_threshold
                        else 'healthy'
                    )
                }
            }
    
    def cleanup_old_jobs(self, max_age: float = 3600):
        """Remove completed jobs older than max_age seconds"""
        with self.lock:
            current_time = time.time()
            to_remove = []
            
            for job_id, job in self.jobs.items():
                if job.completed_at and (current_time - job.completed_at) > max_age:
                    to_remove.append(job_id)
            
            for job_id in to_remove:
                del self.jobs[job_id]
            
            if to_remove:
                logger.info(f"Cleaned up {len(to_remove)} old jobs")
    
    def shutdown(self):
        """Gracefully shutdown the queue manager"""
        logger.info("Queue manager shutting down...")
        self.shutdown_event.set()
        
        # Wait for workers to finish
        for worker in self.workers:
            worker.join(timeout=5)
        
        logger.info("Queue manager shutdown complete")


# Global queue manager instance (initialized in Flask app)
_queue_manager: Optional[SmartQueueManager] = None


def get_queue_manager() -> SmartQueueManager:
    """Get the global queue manager instance"""
    global _queue_manager
    if _queue_manager is None:
        _queue_manager = SmartQueueManager(
            bg_fast_workers=3,
            bg_pro_workers=2,
            obj_remove_workers=1,
            max_queue_size=50,
            job_timeout=60
        )
    return _queue_manager


def init_queue_manager(**kwargs) -> SmartQueueManager:
    """Initialize the global queue manager with custom settings"""
    global _queue_manager
    _queue_manager = SmartQueueManager(**kwargs)
    return _queue_manager
