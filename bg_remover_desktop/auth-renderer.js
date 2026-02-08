// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

// Brevo (Sendinblue) Configuration - https://app.brevo.com/
// FREE: 300 emails/day!
// Get your API key from: Brevo Dashboard → Settings → SMTP & API → API Keys
const BREVO_API_KEY = 'YOUR_BREVO_API_KEY_HERE';  // Replace with your Brevo API key
const SENDER_EMAIL = 'info@sallulabs.com'; // Your verified sender email
const SENDER_NAME = 'SalluLabs BG Remover';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyA8D2w0J8auihu3BbR8McIpoSduDfI2jxo",
    authDomain: "are-you-genius-1f253.firebaseapp.com",
    projectId: "are-you-genius-1f253",
    storageBucket: "imagetotext-4c3e3.appspot.com",
    messagingSenderId: "771421054895",
    appId: "1:771421054895:web:7a27a9c69f722069ebb15a",
    measurementId: "G-RE3R9WGMH9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Export storage for use in other modules
window.firebaseStorage = { storage, ref, uploadBytes, getDownloadURL };

// UI Elements
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const verifyForm = document.getElementById('verify-form');
const resetForm = document.getElementById('reset-form');
const authTabs = document.querySelectorAll('.auth-tab');
const messageDiv = document.getElementById('message');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const backToLoginBtn = document.getElementById('back-to-login');

// Store signup data temporarily
let pendingSignupData = null;
let generatedVerificationCode = null;

// Show message
function showMessage(message, type = 'error') {
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

// Switch tabs
authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        authTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        
        if (tabName === 'login') {
            loginForm.classList.add('active');
        } else {
            signupForm.classList.add('active');
        }
    });
});

// Handle successful authentication
async function handleAuthSuccess(user) {
    try {
        const token = await user.getIdToken();
        
        // Store auth state in main process
        const result = await window.electronAPI.auth.setUser({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
        }, token);
        
        if (result.success) {
            showMessage('Login successful! Redirecting...', 'success');
            
            // Store in localStorage for persistence
            localStorage.setItem('user', JSON.stringify({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            }));
            localStorage.setItem('token', token);
            
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        } else {
            throw new Error(result.error || 'Authentication failed');
        }
    } catch (error) {
        console.error('Auth error:', error);
        showMessage('Authentication failed: ' + error.message);
    }
}

// Login form
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        await handleAuthSuccess(userCredential.user);
    } catch (error) {
        console.error('Login error:', error.code);
        showMessage(getAuthErrorMessage(error.code));
    }
});

// Generate random 6-digit code
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// User-friendly error messages
function getAuthErrorMessage(errorCode) {
    const errorMessages = {
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/user-disabled': 'This account has been disabled. Please contact support.',
        'auth/user-not-found': 'No account found with this email. Please sign up first.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/invalid-credential': 'Invalid email or password. Please check your credentials.',
        'auth/email-already-in-use': 'This email is already registered. Please login instead.',
        'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your internet connection.',
        'auth/popup-closed-by-user': 'Sign-in was cancelled. Please try again.',
        'auth/operation-not-allowed': 'This sign-in method is not enabled.',
        'auth/requires-recent-login': 'Please log in again to complete this action.'
    };
    return errorMessages[errorCode] || 'An error occurred. Please try again.';
}

// Send verification email using Brevo API
async function sendVerificationEmail(email, code, name) {
    // Check if Brevo is configured
    if (BREVO_API_KEY === 'YOUR_BREVO_API_KEY') {
        // Demo mode - show code in alert
        console.log('Verification code for', email, ':', code);
        alert(`📧 Verification code sent to ${email}\n\n🔑 Your code: ${code}\n\n(Configure Brevo API key for real emails)`);
        return true;
    }
    
    try {
        const userName = name || email.split('@')[0];
        
        // Beautiful HTML email template
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" max-width="500" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #FACC15 0%, #F59E0B 100%); padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #1a1a1a; font-size: 28px; font-weight: 700;">Sallulabs</h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <h2 style="margin: 0 0 10px 0; color: #1a1a1a; font-size: 22px;">Hey ${userName}! 👋</h2>
                            <p style="margin: 0 0 25px 0; color: #666; font-size: 16px; line-height: 1.5;">
                                Welcome to Sallulabs! Use the code below to verify your email and complete your account setup.
                            </p>
                            
                            <!-- Verification Code Box -->
                            <div style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); border-radius: 12px; padding: 25px; text-align: center; margin: 20px 0;">
                                <p style="margin: 0 0 10px 0; color: #999; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Your Verification Code</p>
                                <h1 style="margin: 0; color: #FACC15; font-size: 42px; font-weight: 700; letter-spacing: 8px;">${code}</h1>
                            </div>
                            
                            <p style="margin: 25px 0 0 0; color: #999; font-size: 14px; text-align: center;">
                                ⏱️ This code expires in <strong>10 minutes</strong>
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9f9f9; padding: 25px 30px; border-top: 1px solid #eee;">
                            <p style="margin: 0 0 10px 0; color: #999; font-size: 13px; text-align: center;">
                                Didn't request this code? You can safely ignore this email.
                            </p>
                            <p style="margin: 0; color: #999; font-size: 13px; text-align: center;">
                                © ${new Date().getFullYear()} SalluLabs. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
        
        // Send via Brevo API
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: SENDER_NAME,
                    email: SENDER_EMAIL
                },
                to: [{
                    email: email,
                    name: userName
                }],
                subject: `🔑 Your Sallulabs Verification Code: ${code}`,
                htmlContent: htmlContent
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to send email');
        }
        
        showMessage(`✅ Verification code sent to ${email}! Check your inbox.`, 'success');
        return true;
    } catch (error) {
        console.error('Brevo API error:', error);
        // Fallback to demo mode
        alert(`📧 Email service temporarily unavailable.\n\n🔑 Your code: ${code}`);
        return true;
    }
}

// Signup form - Step 1: Send verification code
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-password-confirm').value;
    
    if (password !== confirmPassword) {
        showMessage('Passwords do not match');
        return;
    }
    
    try {
        // Generate verification code
        generatedVerificationCode = generateVerificationCode();
        
        // Store signup data
        pendingSignupData = { name, email, password };
        
        // Send verification email with name
        await sendVerificationEmail(email, generatedVerificationCode, name);
        
        // Show verification form
        signupForm.classList.remove('active');
        verifyForm.classList.add('active');
        
        showMessage('Verification code sent! Check your email.', 'success');
    } catch (error) {
        console.error('Signup error:', error.code);
        showMessage(getAuthErrorMessage(error.code));
    }
});

// Verify form - Step 2: Verify code and create account
verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const code = document.getElementById('verify-code').value;
    
    if (code !== generatedVerificationCode) {
        showMessage('Invalid verification code. Please try again.');
        return;
    }
    
    if (!pendingSignupData) {
        showMessage('Session expired. Please sign up again.');
        verifyForm.classList.remove('active');
        signupForm.classList.add('active');
        return;
    }
    
    try {
        // Create Firebase account
        const userCredential = await createUserWithEmailAndPassword(
            auth,
            pendingSignupData.email,
            pendingSignupData.password
        );
        const user = userCredential.user;
        
        // Create user document in Firestore
        await setDoc(doc(db, "users", user.uid), {
            firstname: pendingSignupData.name,
            email: user.email,
            createdAt: new Date().toISOString(),
            credits: 5,
            totalInvites: 0,
            emailVerified: true // Already verified via code
        });
        
        // Clear pending data
        pendingSignupData = null;
        generatedVerificationCode = null;
        
        await handleAuthSuccess(user);
    } catch (error) {
        console.error('Account creation error:', error.code);
        showMessage(getAuthErrorMessage(error.code));
    }
});

// Resend code button
document.getElementById('resend-code').addEventListener('click', async () => {
    if (!pendingSignupData) {
        showMessage('Session expired. Please sign up again.');
        return;
    }
    
    generatedVerificationCode = generateVerificationCode();
    await sendVerificationEmail(pendingSignupData.email, generatedVerificationCode, pendingSignupData.name);
    showMessage('New verification code sent!', 'success');
});

// Back to signup button
document.getElementById('back-to-signup').addEventListener('click', () => {
    verifyForm.classList.remove('active');
    signupForm.classList.add('active');
    pendingSignupData = null;
    generatedVerificationCode = null;
    document.getElementById('verify-code').value = '';
});

// Google Sign-In for Login
document.getElementById('google-login').addEventListener('click', async () => {
    await handleGoogleAuth('login');
});

// Google Sign-In for Signup
document.getElementById('google-signup').addEventListener('click', async () => {
    await handleGoogleAuth('signup');
});

// Shared Google Auth handler
async function handleGoogleAuth(mode) {
    try {
        showMessage('🔐 Opening Google Sign-In window...', 'success');
        
        // Use Electron's OAuth window
        const result = await window.electronAPI.auth.googleSignIn();
        
        if (result.success && result.accessToken) {
            showMessage('✅ Authenticating with Firebase...', 'success');
            
            // Use the access token to sign in with Firebase
            const credential = GoogleAuthProvider.credential(null, result.accessToken);
            const userCredential = await signInWithCredential(auth, credential);
            const user = userCredential.user;
            
            // Check if new user and create document
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (!userDoc.exists()) {
                await setDoc(doc(db, "users", user.uid), {
                    firstname: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    createdAt: new Date().toISOString(),
                    credits: 5,
                    totalInvites: 0,
                    emailVerified: true
                });
                showMessage(`🎉 Welcome ${user.displayName || 'to BG Remover'}!`, 'success');
            } else {
                showMessage(`👋 Welcome back, ${user.displayName || user.email}!`, 'success');
            }
            
            await handleAuthSuccess(user);
        } else {
            showMessage(result.error || '❌ Google Sign-In was cancelled');
        }
    } catch (error) {
        console.error('Google Sign-In error:', error);
        
        if (error.message && error.message.includes('closed')) {
            showMessage('⚠️ Sign-in window was closed. Please try again.');
        } else {
            showMessage(getAuthErrorMessage(error.code) || '❌ Google Sign-In failed. Please try email login.');
        }
    }
}

// Forgot password link
forgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.remove('active');
    signupForm.classList.remove('active');
    verifyForm.classList.remove('active');
    resetForm.classList.add('active');
    
    // Hide tabs when on reset form
    document.querySelector('.auth-tabs').style.display = 'none';
});

// Back to login button
backToLoginBtn.addEventListener('click', () => {
    resetForm.classList.remove('active');
    loginForm.classList.add('active');
    document.getElementById('reset-email').value = '';
    
    // Show tabs again
    document.querySelector('.auth-tabs').style.display = 'flex';
});

// Reset password form
resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('reset-email').value;
    
    try {
        // Use custom branded password reset page
        const actionCodeSettings = {
            url: window.location.origin + '/reset-password.html',
            handleCodeInApp: false
        };
        
        await sendPasswordResetEmail(auth, email, actionCodeSettings);
        
        showMessage(`✅ Password reset link sent to ${email}! Check your inbox.`, 'success');
        
        // Show success message and return to login after 3 seconds
        setTimeout(() => {
            resetForm.classList.remove('active');
            loginForm.classList.add('active');
            document.getElementById('reset-email').value = '';
            document.querySelector('.auth-tabs').style.display = 'flex';
        }, 3000);
    } catch (error) {
        console.error('Password reset error:', error.code);
        showMessage(getAuthErrorMessage(error.code));
    }
});

// Check if already authenticated
window.addEventListener('DOMContentLoaded', async () => {
    const authState = await window.electronAPI.auth.getState();
    if (authState.isAuthenticated) {
        window.location.href = 'index.html';
    }
});
