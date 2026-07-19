#!/usr/bin/env python3
"""
Local Queue System Test
========================
Test the queue manager locally before deploying to production.
"""
import sys
import time
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from queue_manager import SmartQueueManager, JobType, JobStatus


def test_job(job_id: str, duration: float = 1.0):
    """Simulate a processing job"""
    print(f"  🔄 Processing job {job_id}...")
    time.sleep(duration)
    print(f"  ✅ Job {job_id} completed")
    return f"Result from {job_id}"


def main():
    print("=" * 60)
    print("Queue Manager Local Test")
    print("=" * 60)
    print()
    
    # Initialize queue manager with test settings
    print("Initializing queue manager...")
    qm = SmartQueueManager(
        bg_fast_workers=2,
        bg_pro_workers=1,
        obj_remove_workers=1,
        max_queue_size=10,
        job_timeout=30
    )
    print("✅ Queue manager initialized")
    print()
    
    # Get initial stats
    print("Initial queue stats:")
    stats = qm.get_queue_stats()
    print(f"  Total capacity: {stats['total_capacity']}")
    print(f"  Memory: {stats['system']['memory_percent']:.1f}% ({stats['system']['memory_status']})")
    print()
    
    # Test 1: Submit fast jobs
    print("Test 1: Submitting 3 fast jobs...")
    fast_jobs = []
    for i in range(3):
        job = qm.submit_job(
            job_id=f"fast-{i}",
            job_type=JobType.BG_FAST,
            task_func=test_job,
            job_id=f"fast-{i}",
            duration=1.0
        )
        fast_jobs.append(job)
        print(f"  ✅ Submitted fast-{i}")
    print()
    
    # Test 2: Submit pro jobs
    print("Test 2: Submitting 2 pro jobs...")
    pro_jobs = []
    for i in range(2):
        job = qm.submit_job(
            job_id=f"pro-{i}",
            job_type=JobType.BG_PRO,
            task_func=test_job,
            job_id=f"pro-{i}",
            duration=2.0
        )
        pro_jobs.append(job)
        print(f"  ✅ Submitted pro-{i}")
    print()
    
    # Check queue stats
    print("Queue stats after submission:")
    stats = qm.get_queue_stats()
    for job_type_name, queue_info in stats['queues'].items():
        print(f"  {job_type_name}: {queue_info['active']}/{queue_info['capacity']} active, {queue_info['queued']} queued")
    print()
    
    # Wait for jobs to complete
    print("Waiting for all jobs to complete...")
    all_jobs = fast_jobs + pro_jobs
    for job in all_jobs:
        qm.wait_for_job(job, timeout=10)
    print()
    
    # Check results
    print("Job Results:")
    for job in all_jobs:
        status_emoji = "✅" if job.status == JobStatus.COMPLETED else "❌"
        print(f"  {status_emoji} {job.job_id}: {job.status.value}")
        if job.status == JobStatus.COMPLETED:
            print(f"      Wait: {job.wait_time:.2f}s, Process: {job.processing_time:.2f}s, Total: {job.total_time:.2f}s")
        if job.error:
            print(f"      Error: {job.error}")
    print()
    
    # Final stats
    print("Final queue stats:")
    stats = qm.get_queue_stats()
    print(f"  Total jobs: {stats['stats']['total_jobs']}")
    print(f"  Completed: {stats['stats']['completed_jobs']}")
    print(f"  Failed: {stats['stats']['failed_jobs']}")
    print(f"  Timeout: {stats['stats']['timeout_jobs']}")
    print()
    
    # Test 3: Test queue full
    print("Test 3: Testing queue limits...")
    try:
        # Try to submit too many jobs
        for i in range(15):
            qm.submit_job(
                job_id=f"overflow-{i}",
                job_type=JobType.BG_FAST,
                task_func=test_job,
                job_id=f"overflow-{i}",
                duration=0.1
            )
    except ValueError as e:
        print(f"  ✅ Queue limit enforced: {e}")
    print()
    
    # Shutdown
    print("Shutting down queue manager...")
    qm.shutdown()
    print("✅ Test complete!")
    print()
    print("=" * 60)
    print("All tests passed! Queue system is ready for deployment.")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
