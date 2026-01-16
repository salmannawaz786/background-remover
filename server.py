from flask import Flask, request, send_file, render_template, jsonify, session, redirect, url_for
from flask_cors import CORS
from rembg import remove, new_session
from PIL import Image
import io
import logging
import traceback
from werkzeug.utils import secure_filename
import os
from concurrent.futures import ThreadPoolExecutor
import time
from functools import lru_cache, wraps
import gc
import psutil
from threading import Timer
import uuid
import sys
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, storage, auth as firebase_auth
from flask import Flask, request, send_file, render_template, jsonify, session, redirect, url_for, send_from_directory
# Load environment variables

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')

@app.route('/static/<path:filename>')
def serve_static(filename):
    # Only allow specific file types
    allowed_extensions = {'.css', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.js'}
    file_ext = os.path.splitext(filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        return "File not found", 404
    
    try:
        return send_from_directory('static', filename)
    except:
        return "File not found", 404
# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('app.log')
    ]
)
logger = logging.getLogger(__name__)

# Initialize Firebase Admin (for authentication and storage)
try:
    # Check if Firebase credentials are provided as JSON string (for Digital Ocean App Platform)
    firebase_creds_json = os.getenv('FIREBASE_CREDENTIALS_JSON')
    
    if firebase_creds_json:
        # Parse JSON from environment variable
        import json
        cred_dict = json.loads(firebase_creds_json)
        cred = credentials.Certificate(cred_dict)
        logger.info("Using Firebase credentials from environment variable")
    else:
        # Use credentials file (for local development and Droplet)
        cred = credentials.Certificate(os.getenv('FIREBASE_CREDENTIALS_PATH', 'firebase-credentials.json'))
        logger.info("Using Firebase credentials from file")
    
    firebase_admin.initialize_app(cred, {
        'storageBucket': os.getenv('FIREBASE_STORAGE_BUCKET', 'your-project.appspot.com')
    })
    bucket = storage.bucket()
    logger.info(f"Firebase initialized successfully with bucket: {os.getenv('FIREBASE_STORAGE_BUCKET')}")
except Exception as e:
    logger.warning(f"Firebase initialization failed: {str(e)}. Continuing without Firebase.")
    bucket = None

# Enable CORS
CORS(app, resources={r"/*": {"origins": "*"}}, methods=["GET", "POST"], allow_headers=["Content-Type"])

# Configure upload folder and allowed extensions
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10MB

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Resource monitoring
MAX_MEMORY_PERCENT = 92
memory_warning_issued = False

# Thread pool - BALANCED for quality and speed
cpu_count = psutil.cpu_count(logical=False) or 2
max_workers = int(os.getenv('MAX_WORKERS', max(2, min(cpu_count, 8))))
executor = ThreadPoolExecutor(max_workers=max_workers)
logger.info(f"Initialized thread pool with {executor._max_workers} workers")

# Load rembg model - BALANCED SETTINGS
model_name = os.getenv('MODEL_NAME', 'u2net')
try:
    session_rembg = new_session(model_name)
    logger.info(f"Successfully loaded rembg model: {model_name}")
except Exception as e:
    logger.error(f"Failed to load model: {str(e)}")
    session_rembg = None

# Authentication decorator
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get token from header
        auth_header = request.headers.get('Authorization')
        
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Unauthorized - No token provided'}), 401
        
        token = auth_header.split('Bearer ')[1]
        
        try:
            # Verify Firebase token
            decoded_token = firebase_auth.verify_id_token(token)
            request.user_id = decoded_token['uid']
            request.user_email = decoded_token.get('email')
            return f(*args, **kwargs)
        except Exception as e:
            logger.error(f"Token verification failed: {str(e)}")
            return jsonify({'error': 'Unauthorized - Invalid token'}), 401
    
    return decorated_function

def process_image(image_path, hd_quality=False):
    """Process image with quality settings based on user tier"""
    start_time = time.time()
    
    try:
        # Check memory - be more lenient, only block at critical levels
        mem_usage = check_memory_usage()
        if mem_usage > 95:
            gc.collect()  # Try to free memory first
            mem_usage = check_memory_usage()
            if mem_usage > 95:
                raise MemoryError("Server is busy. Please try again in a moment.")
        
        with Image.open(image_path) as input_image:
            original_size = input_image.size
            original_mode = input_image.mode
            
            if hd_quality:
                # HD: NO resize, NO compression - keep original quality
                # Only resize if image is extremely large (over 4000px)
                max_size = 4000
                compress_level = 0  # No compression
                logger.info(f"Processing in HD quality mode - preserving original quality")
            else:
                # Standard: Balanced quality for free tier
                max_size = 1200
                compress_level = 6
            
            # Only resize if needed
            if max(input_image.size) > max_size:
                ratio = max_size / max(input_image.size)
                new_size = tuple(int(dim * ratio) for dim in input_image.size)
                input_image = input_image.resize(new_size, Image.Resampling.LANCZOS)
                logger.info(f"Resized from {original_size} to {input_image.size}")
            else:
                logger.info(f"Keeping original size: {original_size}")
            
            if session_rembg is None:
                raise ValueError("Processing model not ready. Please refresh and try again.")
            
            # Process with quality settings
            output_image = remove(
                input_image, 
                session=session_rembg,
                alpha_matting=hd_quality,  # Enable for HD quality
                post_process_mask=True
            )
            
            # Cleanup input
            del input_image
            
            # Save with appropriate compression
            img_io = io.BytesIO()
            if hd_quality:
                # HD: Save without compression to preserve quality
                output_image.save(img_io, 'PNG', compress_level=0)
            else:
                output_image.save(img_io, 'PNG', optimize=True, compress_level=compress_level)
            img_io.seek(0)
            
            # Cleanup output
            del output_image
            gc.collect()
            
            processing_time = time.time() - start_time
            logger.info(f"Processed in {processing_time:.2f}s (HD: {hd_quality})")
            
            return img_io, processing_time
    except MemoryError as e:
        gc.collect()
        raise
    except Exception as e:
        logger.error(f"Processing error: {str(e)}")
        gc.collect()
        raise

# Cache processed images
CACHE_SIZE = 32
processed_images = lru_cache(maxsize=CACHE_SIZE)(process_image)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def check_memory_usage():
    global memory_warning_issued
    try:
        memory = psutil.virtual_memory()
        percent_used = memory.percent
        
        if percent_used > MAX_MEMORY_PERCENT and not memory_warning_issued:
            logger.warning(f"Memory critical: {percent_used}%. Clearing cache...")
            processed_images.cache_clear()
            gc.collect()
            memory_warning_issued = True
        elif percent_used < MAX_MEMORY_PERCENT - 10:
            memory_warning_issued = False
        
        return percent_used
    except Exception as e:
        logger.error(f"Memory check error: {str(e)}")
        return 0

# Routes
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login')
def login():
    return render_template('login.html')

@app.route('/signup')
def signup():
    return render_template('signup.html')

@app.route('/api/config')
def get_firebase_config():
    """Serve Firebase config - only accessible from same origin"""
    # Check referer to ensure request is from our domain
    referer = request.headers.get('Referer', '')
    allowed_origins = [
        'https://bgremover.sallulabs.com',
        'http://localhost:5000',
        'http://127.0.0.1:5000'
    ]
    
    is_allowed = any(referer.startswith(origin) for origin in allowed_origins) or not referer
    
    if not is_allowed:
        return jsonify({'error': 'Unauthorized'}), 403
    
    # Return Firebase client config (these are safe to expose with domain restrictions)
    return jsonify({
        'apiKey': os.getenv('FIREBASE_API_KEY', 'AIzaSyA8D2w0J8auihu3BbR8McIpoSduDfI2jxo'),
        'authDomain': os.getenv('FIREBASE_AUTH_DOMAIN', 'are-you-genius-1f253.firebaseapp.com'),
        'projectId': os.getenv('FIREBASE_PROJECT_ID', 'are-you-genius-1f253'),
        'storageBucket': os.getenv('FIREBASE_STORAGE_BUCKET', 'are-you-genius-1f253.firebasestorage.app'),
        'messagingSenderId': os.getenv('FIREBASE_MESSAGING_SENDER_ID', '771421054895'),
        'appId': os.getenv('FIREBASE_APP_ID', '1:771421054895:web:7a27a9c69f722069ebb15a'),
        'measurementId': os.getenv('FIREBASE_MEASUREMENT_ID', 'G-RE3R9WGMH9')
    })

@app.route('/verify-token', methods=['POST'])
def verify_token():
    """Verify Firebase token from frontend"""
    try:
        data = request.get_json()
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'No token provided'}), 400
        
        # Verify the token
        decoded_token = firebase_auth.verify_id_token(token)
        uid = decoded_token['uid']
        
        # Store in session
        session['user_id'] = uid
        session['user_email'] = decoded_token.get('email')
        
        return jsonify({
            'success': True,
            'uid': uid,
            'email': decoded_token.get('email')
        })
    except Exception as e:
        logger.error(f"Token verification error: {str(e)}")
        return jsonify({'error': 'Invalid token'}), 401

@app.route('/logout')
def logout():
    """Clear session"""
    session.clear()
    return jsonify({'success': True})

@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload and process image - with authentication-based features"""
    try:
        # Check memory
        if check_memory_usage() > 90:
            return jsonify({'error': 'Server under heavy load. Please try again later.'}), 503
        
        if 'image_file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['image_file']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Please upload PNG, JPG, JPEG, GIF, or WEBP.'}), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        # Check authentication status
        user_id = session.get('user_id')
        is_authenticated = user_id is not None
        
        # HD quality check
        hd_quality = request.form.get('hd_quality', 'false').lower() == 'true'
        
        if hd_quality and not is_authenticated:
            return jsonify({
                'error': 'HD quality is only available for registered users. Please sign up to unlock HD quality!',
                'requiresAuth': True
            }), 403
        
        # File size limits
        max_size_free = 5 * 1024 * 1024  # 5MB for free users
        max_size_premium = 10 * 1024 * 1024  # 10MB for authenticated users
        
        if not is_authenticated and file_size > max_size_free:
            return jsonify({
                'error': f'File size ({file_size / (1024*1024):.1f}MB) exceeds the free tier limit of 5MB. Please sign up to upload files up to 10MB!',
                'requiresAuth': True
            }), 413
        
        if is_authenticated and file_size > max_size_premium:
            return jsonify({
                'error': f'File size ({file_size / (1024*1024):.1f}MB) exceeds the maximum limit of 10MB. Please reduce the file size.'
            }), 413
        
        # Rate limiting for non-authenticated users
        if not is_authenticated:
            # Use IP-based rate limiting
            client_ip = request.remote_addr
            rate_limit_key = f"ratelimit_{client_ip}"
            
            # Check daily usage (stored in session for simplicity)
            daily_count = session.get(rate_limit_key, 0)
            if daily_count >= 5:
                return jsonify({
                    'error': 'Daily limit reached! Free users can process 5 images per day. Sign up for unlimited processing!',
                    'requiresAuth': True
                }), 429
            
            # Increment counter
            session[rate_limit_key] = daily_count + 1
        
        # Save with unique filename
        unique_id = str(uuid.uuid4())[:8]
        filename = f"{unique_id}_{secure_filename(file.filename)}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        try:
            # Process image with quality setting
            future = executor.submit(process_image, filepath, hd_quality)
            img_io, processing_time = future.result(timeout=60 if hd_quality else 30)
            
            # Copy image bytes for Firebase upload (so we can send response immediately)
            img_io.seek(0)
            image_bytes = img_io.read()
            
            # Upload to Firebase in background (truly fire-and-forget, no waiting)
            if bucket:
                def firebase_upload_background(img_bytes, blob_name):
                    try:
                        blob = bucket.blob(blob_name)
                        blob.upload_from_string(img_bytes, content_type='image/png', timeout=30)
                        blob.make_public()
                        logger.info(f"Firebase upload success: {blob.public_url}")
                    except Exception as e:
                        logger.error(f"Firebase background upload error: {str(e)[:100]}")
                
                # Submit and forget - don't wait for result
                blob_name = f"removed-bg-images/{unique_id}_{file.filename}"
                executor.submit(firebase_upload_background, image_bytes, blob_name)
                logger.info(f"Firebase upload started in background: {blob_name}")
            
            # Send response immediately (don't wait for Firebase)
            response_io = io.BytesIO(image_bytes)
            response = send_file(response_io, mimetype='image/png')
            response.headers['X-Processing-Time'] = str(processing_time)
            
            return response
        except TimeoutError:
            return jsonify({'error': 'Processing took too long. Please try with a smaller image.'}), 504
        except MemoryError as e:
            gc.collect()
            return jsonify({'error': str(e) or 'Server is busy. Please try again in a moment.'}), 503
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Processing error: {error_msg}")
            # Provide user-friendly error messages
            if 'model' in error_msg.lower():
                return jsonify({'error': 'Processing model not ready. Please refresh and try again.'}), 503
            return jsonify({'error': 'Failed to process image. Please try again.'}), 500
        finally:
            # Cleanup uploaded file
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except:
                pass
            gc.collect()
    
    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        gc.collect()
        return jsonify({'error': 'Upload failed. Please try again.'}), 500

@app.route('/health')
def health():
    """Health check endpoint"""
    mem_usage = check_memory_usage()
    return jsonify({
        'status': 'healthy' if mem_usage < MAX_MEMORY_PERCENT else 'degraded',
        'model_loaded': session_rembg is not None,
        'memory_usage': f"{mem_usage}%",
        'workers': executor._max_workers
    })

# Error handlers
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large (max 10MB)'}), 413

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

# Cleanup old files
def cleanup_old_files():
    try:
        current_time = time.time()
        for filename in os.listdir(UPLOAD_FOLDER):
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.isfile(filepath):
                if current_time - os.path.getmtime(filepath) > 3600:  # 1 hour
                    os.remove(filepath)
    except Exception as e:
        logger.error(f"Cleanup error: {str(e)}")
    finally:
        Timer(1800, cleanup_old_files).start()  # Every 30 min

if __name__ == '__main__':
    # Start cleanup
    cleanup_timer = Timer(1800, cleanup_old_files)
    cleanup_timer.daemon = True
    cleanup_timer.start()
    
    logger.info("Starting Background Remover service...")
    logger.info(f"Model: {model_name}, Workers: {max_workers}")
    
    from waitress import serve
    serve(app, host="0.0.0.0", port=5000, threads=4)
