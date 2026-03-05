from flask import Flask, request, send_file, render_template, jsonify, session, redirect, url_for, send_from_directory
from flask_cors import CORS
from PIL import Image
import io
import logging
import traceback
from werkzeug.utils import secure_filename
import os
from concurrent.futures import ThreadPoolExecutor
import time
from functools import wraps
import gc
import psutil
from threading import Timer
import uuid
import sys
from queue import Queue
import threading
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from brevo_email import send_verification_email, verify_otp
import boto3
from botocore.exceptions import ClientError
from model_manager_v4 import get_model_manager
# Load environment variables

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')

@app.route('/static/<path:filename>')
def serve_static(filename):
    # Only allow specific file types
    allowed_extensions = {'.css', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.js', '.json', '.lottie', '.webp', '.woff', '.woff2'}
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

# Initialize Firebase Admin (for authentication only)
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
        cred = credentials.Certificate(os.getenv('FIREBASE_CREDENTIALS_PATH', 'serviceAccountKey.json'))
        logger.info("Using Firebase credentials from file")
    
    firebase_admin.initialize_app(cred)
    logger.info("Firebase Auth initialized successfully")
except Exception as e:
    logger.warning(f"Firebase initialization failed: {str(e)}. Continuing without Firebase.")

# Cloudflare R2 Configuration
R2_ENDPOINT = os.getenv('R2_ENDPOINT', '')
R2_ACCESS_KEY = os.getenv('R2_ACCESS_KEY', '')
R2_SECRET_KEY = os.getenv('R2_SECRET_KEY', '')
R2_BUCKET_NAME = os.getenv('R2_BUCKET_NAME', '')

# Initialize R2 client
s3_client = None
if R2_ENDPOINT and R2_ACCESS_KEY and R2_SECRET_KEY:
    try:
        s3_client = boto3.client(
            's3',
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            region_name='auto'
        )
        logger.info(f"Cloudflare R2 client initialized - bucket: {R2_BUCKET_NAME}")
    except Exception as e:
        logger.warning(f"Could not initialize R2 client: {e}")
        s3_client = None
else:
    logger.warning("R2 credentials not provided. Image upload to R2 will be disabled.")

# Enable CORS - restrict to our own domain in production
ALLOWED_ORIGINS = [
    'https://bgremover.sallulabs.com',
    'http://localhost:5001',
    'http://127.0.0.1:5001',
]
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}}, methods=["GET", "POST"], allow_headers=["Content-Type"])

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    # Only send HSTS on HTTPS
    if request.is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Configure upload folder and allowed extensions
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_CONTENT_LENGTH = 15 * 1024 * 1024  # 15MB (actual limits enforced in route handler)

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Resource monitoring
MAX_MEMORY_PERCENT = 92
memory_warning_issued = False

# Request queue system - max 2 concurrent processing
MAX_CONCURRENT_REQUESTS = 2
request_queue = Queue(maxsize=10)  # Max 10 in queue
active_requests = 0
active_requests_lock = threading.Lock()

# Thread pool - CPU-safe: executor handles compute, waitress handles I/O
cpu_count = psutil.cpu_count(logical=False) or 2
max_workers = max(1, cpu_count - 1)  # Leave 1 core for web I/O
executor = ThreadPoolExecutor(max_workers=max_workers)
logger.info(f"Initialized thread pool with {max_workers} workers (physical cores: {cpu_count})")
logger.info(f"Request queue: max {MAX_CONCURRENT_REQUESTS} concurrent, {request_queue.maxsize} queue size")

# Load model manager
try:
    logger.info("Initializing background remover (RVM + RMBG smart routing)...")
    model_manager = get_model_manager()
    available_models = model_manager.get_available_models()
    logger.info(f"Available models: {list(available_models.keys())}")
    for mode, info in available_models.items():
        logger.info(f"  - {mode}: {info['name']} ({info.get('size_mb', 0):.1f}MB)")
    # Pre-load RVM (persons) immediately - 15MB, fast load
    model_manager.preload_rvm()
    logger.info("RVM (persons) loading in background...")
    # Pre-load RMBG (objects) in background
    model_manager.preload_rmbg()
    logger.info("RMBG (objects) loading in background...")
except Exception as e:
    logger.error(f"Failed to initialize model manager: {str(e)}")
    model_manager = None
    raise

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

def process_image(image_path, model_mode='fast', output_format='webp'):
    """Process image with selected model
    
    Args:
        image_path: Path to input image
        model_mode: 'fast' (U2Net Silueta) or 'hd' (RMBG-1.4)
        output_format: 'webp' or 'png'
    """
    start_time = time.time()
    
    try:
        # Check memory
        mem_usage = check_memory_usage()
        if mem_usage > 95:
            gc.collect()
            if model_manager:
                model_manager.clear_cache()
            mem_usage = check_memory_usage()
            if mem_usage > 95:
                raise MemoryError("Server is busy. Please try again in a moment.")
        
        if model_manager is None:
            raise ValueError("Processing model not ready. Please refresh and try again.")
        
        with Image.open(image_path) as input_image:
            # Convert to RGB if needed
            if input_image.mode != 'RGB':
                input_image = input_image.convert('RGB')
            
            logger.info(f"Processing {input_image.size} with {model_mode} model")
            
            # Process with selected model
            output_image = model_manager.remove_background(
                input_image,
                mode=model_mode
            )
            
            # Save with chosen format
            img_io = io.BytesIO()
            if output_format == 'png':
                output_image.save(img_io, 'PNG', compress_level=3)
                mimetype = 'image/png'
            else:
                # WEBP: 30-50% faster save, smaller file, same visual quality
                output_image.save(img_io, 'WEBP', quality=95, method=4, lossless=True)
                mimetype = 'image/webp'
            img_io.seek(0)
            
            # Cleanup
            del input_image
            del output_image
            gc.collect()
            
            processing_time = time.time() - start_time
            logger.info(f"Processed in {processing_time:.2f}s ({output_format.upper()}, model: {model_mode})")
            
            return img_io, processing_time, mimetype
            
    except MemoryError as e:
        gc.collect()
        if model_manager:
            model_manager.clear_cache()
        raise
    except Exception as e:
        logger.error(f"Processing error: {str(e)}")
        gc.collect()
        if model_manager:
            model_manager.clear_cache()
        raise

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def check_memory_usage():
    global memory_warning_issued
    try:
        memory = psutil.virtual_memory()
        percent_used = memory.percent
        
        if percent_used > MAX_MEMORY_PERCENT and not memory_warning_issued:
            logger.warning(f"Memory critical: {percent_used}%. Clearing...")
            gc.collect()
            memory_warning_issued = True
        elif percent_used < MAX_MEMORY_PERCENT - 10:
            memory_warning_issued = False
        
        return percent_used
    except Exception as e:
        logger.error(f"Memory check error: {str(e)}")
        return 0

# Routes

# PWA: Service Worker must be served from root scope
@app.route('/sw.js')
def serve_sw():
    response = send_from_directory('static', 'sw.js')
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Cache-Control'] = 'no-cache'
    return response

# PWA: Manifest with correct MIME type
@app.route('/manifest.json')
def serve_manifest():
    response = send_from_directory('static', 'manifest.json')
    response.headers['Content-Type'] = 'application/manifest+json'
    return response

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
        # Check memory with graceful degradation
        mem_usage = check_memory_usage()
        if mem_usage > 95:
            # Critical - try to free memory first
            gc.collect()
            mem_usage = check_memory_usage()
            if mem_usage > 95:
                return jsonify({
                    'error': 'Server is currently at capacity. Please wait a moment and try again.',
                    'retryAfter': 10,
                    'serverLoad': 'critical'
                }), 503
        elif mem_usage > 90:
            # High load but still processing - warn user
            logger.warning(f"High memory usage: {mem_usage}%. Processing with caution.")
        
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
        
        # Model mode: 'fast' (Silueta) or 'pro' (BiRefNet .pt)
        model_mode = request.form.get('model', '').lower()
        if model_mode not in ('fast', 'pro'):
            # Backward compat: map old 'hd'/'best' to 'pro', others to 'fast'
            if model_mode in ('hd', 'best'):
                model_mode = 'pro'
            else:
                model_mode = 'fast'

        # Pro mode requires authentication
        if model_mode == 'pro' and not is_authenticated:
            return jsonify({
                'error': 'Pro mode requires an account. Sign in to access high-quality background removal!',
                'requiresAuth': True,
                'proRequired': True
            }), 403
        
        # Output format (webp default, png optional)
        output_format = request.form.get('format', 'webp').lower()
        if output_format not in ('png', 'webp'):
            output_format = 'webp'
        
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
            # Process image with selected model
            timeout = 30 if model_mode == 'pro' else 12
            future = executor.submit(process_image, filepath, model_mode, output_format)
            img_io, processing_time, mimetype = future.result(timeout=timeout)
            
            # Copy image bytes for R2 upload (so we can send response immediately)
            img_io.seek(0)
            image_bytes = img_io.read()
            
            # Upload to R2 (synchronous for debugging)
            if s3_client and R2_BUCKET_NAME:
                try:
                    r2_key = f"removed-bg-images/{unique_id}_{file.filename}"
                    logger.info(f"Starting R2 upload: {r2_key} ({len(image_bytes)} bytes)")
                    
                    s3_client.put_object(
                        Bucket=R2_BUCKET_NAME,
                        Key=r2_key,
                        Body=image_bytes,
                        ContentType=mimetype
                    )
                    
                    public_domain = os.getenv('R2_PUBLIC_DOMAIN', '')
                    if public_domain:
                        r2_url = f"{public_domain.rstrip('/')}/{r2_key}"
                    else:
                        r2_url = f"https://{R2_BUCKET_NAME}.r2.dev/{r2_key}"
                    
                    logger.info(f"R2 upload SUCCESS: {r2_url}")
                except Exception as e:
                    logger.error(f"R2 upload FAILED: {str(e)}")
                    logger.error(f"R2 config - Endpoint: {R2_ENDPOINT}, Bucket: {R2_BUCKET_NAME}")
                    # Don't fail the request, just log the error
            
            # Send response immediately (don't wait for R2)
            response_io = io.BytesIO(image_bytes)
            response = send_file(response_io, mimetype=mimetype)
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

@app.route('/api/models')
def get_models():
    """Get available background removal models"""
    if model_manager:
        return jsonify({
            'models': model_manager.get_available_models(),
            'default': 'fast'
        })
    return jsonify({'error': 'Model manager not initialized'}), 500

@app.route('/health')
def health():
    """Health check endpoint with model info"""
    mem_usage = check_memory_usage()
    health_data = {
        'status': 'healthy' if mem_usage < MAX_MEMORY_PERCENT else 'degraded',
        'models': model_manager.get_available_models() if model_manager else {},
        'model_loaded': model_manager is not None,
        'memory_usage': f"{mem_usage}%",
        'workers': executor._max_workers
    }
    
    return jsonify(health_data)

@app.route('/api/upload-to-r2', methods=['POST'])
def upload_processed_to_r2():
    """Upload a client-processed image directly to R2 (no server-side processing needed)"""
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        
        file = request.files['image']
        image_bytes = file.read()
        
        if not image_bytes:
            return jsonify({'error': 'Empty file'}), 400
        
        if s3_client and R2_BUCKET_NAME:
            unique_id = str(uuid.uuid4())[:8]
            safe_name = secure_filename(file.filename or 'processed.webp')
            r2_key = f"removed-bg-images/{unique_id}_{safe_name}"
            
            s3_client.put_object(
                Bucket=R2_BUCKET_NAME,
                Key=r2_key,
                Body=image_bytes,
                ContentType=file.content_type or 'image/webp'
            )
            
            public_domain = os.getenv('R2_PUBLIC_DOMAIN', '')
            if public_domain:
                r2_url = f"{public_domain.rstrip('/')}/{r2_key}"
            else:
                r2_url = f"https://{R2_BUCKET_NAME}.r2.dev/{r2_key}"
            
            logger.info(f"Client-processed image uploaded to R2: {r2_url}")
            return jsonify({'success': True, 'key': r2_key, 'url': r2_url})
        else:
            return jsonify({'success': False, 'error': 'R2 not configured'}), 503
    except Exception as e:
        logger.error(f"R2 direct upload error: {str(e)}")
        return jsonify({'success': False, 'error': 'Upload failed'}), 500

# Error handlers
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({
        'error': 'File is too large! Maximum upload size is 10MB for signed-in users, 5MB for free users. Please reduce the file size and try again.',
        'maxSize': '10MB'
    }), 413

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

@app.route('/api/send-otp', methods=['POST'])
def send_otp():
    """Send OTP to user's email"""
    try:
        data = request.get_json()
        email = data.get('email')
        
        if not email:
            return jsonify({'error': 'Email is required'}), 400
        
        success, message = send_verification_email(email)
        
        if success:
            return jsonify({'success': True, 'message': message}), 200
        else:
            return jsonify({'error': message}), 500
            
    except Exception as e:
        logger.error(f"Send OTP error: {str(e)}")
        return jsonify({'error': 'Failed to send verification code'}), 500

@app.route('/api/verify-otp', methods=['POST'])
def verify_otp_route():
    """Verify OTP"""
    try:
        data = request.get_json()
        email = data.get('email')
        otp = data.get('otp')
        
        if not email or not otp:
            return jsonify({'error': 'Email and OTP are required'}), 400
        
        success, message = verify_otp(email, otp)
        
        if success:
            return jsonify({'success': True, 'message': message}), 200
        else:
            return jsonify({'error': message}), 400
            
    except Exception as e:
        logger.error(f"Verify OTP error: {str(e)}")
        return jsonify({'error': 'Failed to verify OTP'}), 500

if __name__ == '__main__':
    # Start cleanup
    cleanup_timer = Timer(1800, cleanup_old_files)
    cleanup_timer.daemon = True
    cleanup_timer.start()
    
    logger.info("Starting Background Remover service (multi-model)...")
    logger.info(f"Models: {list(model_manager.get_available_models().keys())}, Workers: {max_workers}")
    
    from waitress import serve
    serve(app, host="0.0.0.0", port=5001, threads=2)  # 2 I/O threads, executor handles compute
