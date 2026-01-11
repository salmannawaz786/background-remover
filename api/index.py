from flask import Flask, request, send_file, render_template, jsonify
from flask_cors import CORS
from rembg import remove, new_session
from PIL import Image
import io
import logging
from werkzeug.utils import secure_filename
import os
from concurrent.futures import ThreadPoolExecutor
import time
from functools import lru_cache
import gc
import psutil
from threading import Timer
import uuid

app = Flask(__name__)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Enable CORS with methods and headers
CORS(app, resources={r"/*": {"origins": "*"}}, methods=["GET", "POST"], allow_headers=["Content-Type"])

# Configure upload folder and allowed extensions
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10MB max upload

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Initialize resource monitoring
MAX_MEMORY_PERCENT = 80
memory_warning_issued = False

# Initialize thread pool with adaptive sizing based on CPU cores
cpu_count = psutil.cpu_count(logical=False) or 2
executor = ThreadPoolExecutor(max_workers=max(2, min(cpu_count-1, 8)))
logger.info(f"Initialized thread pool with {executor._max_workers} workers")

# Initialize rembg session with specific model
model_name = "u2net"  # or "u2netp" for faster but less accurate results
try:
    session = new_session(model_name)
    logger.info(f"Successfully loaded rembg model: {model_name}")
except Exception as e:
    logger.error(f"Failed to load model: {str(e)}")
    session = None

def process_image(image_path):
    """Process image with optimized settings"""
    start_time = time.time()
    
    try:
        # Check memory before processing
        mem_usage = check_memory_usage()
        if mem_usage > 90:
            logger.error("Memory usage too high, rejecting processing")
            raise MemoryError("Server under heavy load, please try again later")
        
        with Image.open(image_path) as input_image:
            # Resize large images to optimize processing
            max_size = 1500  # Reduced from 2000 for faster processing
            original_size = input_image.size
            
            if max(input_image.size) > max_size:
                ratio = max_size / max(input_image.size)
                new_size = tuple(int(dim * ratio) for dim in input_image.size)
                input_image = input_image.resize(new_size, Image.Resampling.LANCZOS)
                logger.info(f"Resized image from {original_size} to {input_image.size}")
            
            # Process image with a timeout guard
            if session is None:
                raise ValueError("Model not properly loaded")
                
            # Process with optimized parameters
            output_image = remove(
                input_image, 
                session=session,
                alpha_matting=False,  # Faster processing
                alpha_matting_foreground_threshold=240,
                alpha_matting_background_threshold=10,
                post_process_mask=True
            )
            
            # Force garbage collection after processing
            del input_image
            gc.collect()
            
            # Save to byte stream with optimized settings
            img_io = io.BytesIO()
            output_image.save(img_io, 'PNG', optimize=True, compress_level=6)
            img_io.seek(0)
            
            processing_time = time.time() - start_time
            logger.info(f"Image processed in {processing_time:.2f} seconds")
            
            return img_io, processing_time
    except MemoryError as me:
        logger.error(f"Memory error: {str(me)}")
        raise
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        raise

# Cache for processed images, with a size limit to prevent memory issues
CACHE_SIZE = 32
processed_images = lru_cache(maxsize=CACHE_SIZE)(process_image)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def check_memory_usage():
    """Monitor memory usage and log warnings if approaching limits"""
    global memory_warning_issued
    
    try:
        memory = psutil.virtual_memory()
        percent_used = memory.percent
        
        if percent_used > MAX_MEMORY_PERCENT and not memory_warning_issued:
            logger.warning(f"Memory usage critical: {percent_used}%. Cleaning cache...")
            processed_images.cache_clear()
            gc.collect()
            memory_warning_issued = True
        elif percent_used < MAX_MEMORY_PERCENT - 10:
            memory_warning_issued = False
            
        return percent_used
    except Exception as e:
        logger.error(f"Error checking memory: {str(e)}")
        return 0

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check current system load
        if check_memory_usage() > 90:
            return jsonify({'error': 'Server under heavy load, please try again later'}), 503
            
        if 'image_file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400

        file = request.files['image_file']
        
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
            
        if not allowed_file(file.filename):
            return jsonify({'error': 'File type not allowed'}), 400

        # Save uploaded file with unique filename to prevent collisions
        unique_id = str(uuid.uuid4())[:8]
        filename = f"{unique_id}_{secure_filename(file.filename)}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        try:
            # Add timeout handling for processing
            future = executor.submit(processed_images, filepath)
            img_io, processing_time = future.result(timeout=30)  # 30 second timeout
            
            # Return processed image with metadata
            response = send_file(img_io, mimetype='image/png')
            response.headers['X-Processing-Time'] = str(processing_time)
            return response
        except Exception as e:
            logger.error(f"Processing error: {str(e)}")
            return jsonify({'error': 'Error processing the image'}), 500
        finally:
            # Clean up uploaded file
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception as e:
                logger.error(f"Error removing temp file: {str(e)}")

    except Exception as e:
        logger.error(f"Error in upload_image: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/health')
def health_check():
    mem_usage = check_memory_usage()
    return jsonify({
        'status': 'healthy' if mem_usage < MAX_MEMORY_PERCENT else 'degraded',
        'model_loaded': session is not None,
        'workers': executor._max_workers,
        'memory_usage': f"{mem_usage}%",
        'cache_info': str(processed_images.cache_info())
    })

@app.route('/clear-cache', methods=['POST'])
def clear_cache():
    """Admin endpoint to clear cache manually"""
    processed_images.cache_clear()
    gc.collect()
    return jsonify({'status': 'Cache cleared'})

# Error handlers
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large (max 10MB)'}), 413

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(503)
def service_unavailable(error):
    return jsonify({'error': 'Service temporarily unavailable'}), 503

def cleanup_old_files():
    """Periodic cleanup of orphaned files in upload directory"""
    try:
        current_time = time.time()
        for filename in os.listdir(UPLOAD_FOLDER):
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.isfile(filepath):
                file_age = current_time - os.path.getmtime(filepath)
                if file_age > 3600:  # Files older than 1 hour
                    os.remove(filepath)
    except Exception as e:
        logger.error(f"Error during cleanup: {str(e)}")
    finally:
        # Schedule next cleanup
        Timer(1800, cleanup_old_files).start()  # Run every 30 minutes

if __name__ == '__main__':
    # Start background cleanup task
    cleanup_timer = Timer(1800, cleanup_old_files)
    cleanup_timer.daemon = True
    cleanup_timer.start()
    
    # Start Flask with production server
    from waitress import serve
    logger.info("Starting background removal service...")
    serve(app, host="0.0.0.0", port=5000, threads=4, connection_limit=100)
