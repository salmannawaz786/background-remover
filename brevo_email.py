"""
Brevo Email OTP Service
Handles sending OTP verification emails via Brevo API
"""
import os
import random
import string
import requests
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

# Brevo configuration
BREVO_API_KEY = os.getenv('BREVO_API_KEY')
BREVO_SENDER_EMAIL = os.getenv('BREVO_SENDER_EMAIL', 'noreply@sallulabs.com')
BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

# OTP storage (in production, use Redis or database)
otp_store = {}

def generate_otp(length=6):
    """Generate a random OTP"""
    return ''.join(random.choices(string.digits, k=length))

def send_otp_email(email, otp):
    """Send OTP via Brevo"""
    if not BREVO_API_KEY:
        logger.error("Brevo API key not configured")
        return False
        
    try:
        headers = {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json'
        }
        
        payload = {
            'sender': {
                'name': 'SalluLabs',
                'email': BREVO_SENDER_EMAIL
            },
            'to': [
                {
                    'email': email,
                    'name': email.split('@')[0]
                }
            ],
            'subject': 'Your BG Remover Verification Code',
            'htmlContent': f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .container {{
            background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
            border-radius: 16px;
            padding: 40px;
            text-align: center;
            color: white;
        }}
        .otp-code {{
            background: white;
            color: #f59e0b;
            font-size: 36px;
            font-weight: bold;
            letter-spacing: 8px;
            padding: 20px;
            border-radius: 12px;
            margin: 30px 0;
            font-family: 'Courier New', monospace;
        }}
        .footer {{
            margin-top: 30px;
            font-size: 14px;
            color: rgba(255, 255, 255, 0.8);
        }}
        .logo {{
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 20px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🎨 BG Remover</div>
        <h2>Email Verification</h2>
        <p>Your verification code is:</p>
        <div class="otp-code">{otp}</div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <div class="footer">
            <p>© 2026 SalluLabs. All rights reserved.</p>
            <p><a href="https://sallulabs.com" style="color: white;">sallulabs.com</a></p>
        </div>
    </div>
</body>
</html>
            """
        }
        
        response = requests.post(BREVO_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        
        logger.info(f"OTP email sent to {email}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send OTP email: {str(e)}")
        return False

def store_otp(email, otp):
    """Store OTP with expiration time"""
    otp_store[email] = {
        'otp': otp,
        'expires': datetime.now() + timedelta(minutes=10),
        'attempts': 0
    }

def verify_otp(email, otp):
    """Verify OTP"""
    if email not in otp_store:
        return False, "OTP not found or expired"
    
    stored = otp_store[email]
    
    # Check expiration
    if datetime.now() > stored['expires']:
        del otp_store[email]
        return False, "OTP has expired"
    
    # Check attempts
    if stored['attempts'] >= 3:
        del otp_store[email]
        return False, "Too many failed attempts"
    
    # Verify OTP
    if stored['otp'] == otp:
        del otp_store[email]
        return True, "OTP verified successfully"
    else:
        stored['attempts'] += 1
        return False, "Invalid OTP"

def send_verification_email(email):
    """Generate and send OTP"""
    otp = generate_otp()
    store_otp(email, otp)
    
    if send_otp_email(email, otp):
        return True, "Verification code sent to your email"
    else:
        return False, "Failed to send verification email"
