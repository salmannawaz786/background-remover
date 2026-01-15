// Import the necessary Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// Firebase configuration - loaded from server for security
let app, auth, db;

async function initFirebase() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        app = initializeApp(config);
        auth = getAuth(app);
        db = getFirestore(app);
        return true;
    } catch (error) {
        console.error('Failed to initialize Firebase:', error);
        return false;
    }
}

// Initialize Firebase immediately
const firebaseReady = initFirebase();

// Function to display error messages
function displayErrorMessage(message) {
    const errorMessage = document.getElementById("error-message");
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }
}

// Function to display success messages
function displaySuccessMessage(message) {
    const successMessage = document.getElementById("success-message");
    if (successMessage) {
        successMessage.textContent = message;
        successMessage.style.display = 'block';
        setTimeout(() => {
            successMessage.style.display = 'none';
        }, 5000);
    }
}

// Function to verify token with backend
async function verifyTokenWithBackend(token) {
    try {
        const response = await fetch('/verify-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: token }),
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Token verification failed');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Token verification error:', error);
        throw error;
    }
}

// Function to get URL parameters
function getUrlParam(param) {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    return urlParams.get(param);
}

// Send verification email to user
async function sendVerificationEmail(user) {
    try {
        await sendEmailVerification(user);
        displaySuccessMessage("Verification email sent! Please check your inbox and verify your email before logging in.");
    } catch (error) {
        console.error("Error sending verification email:", error);
        displayErrorMessage("Failed to send verification email: " + error.message);
    }
}

// Handle successful registration
async function handleRegistrationSuccess(user, isNewUser = true) {
    try {
        // For new users, ensure we have their data in Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));
        
        // Check for invite code
        const inviteCode = getUrlParam('invite');
        
        if (!userDoc.exists()) {
            // Default initial data
            const userData = {
                firstname: user.displayName || user.email.split('@')[0],
                email: user.email,
                createdAt: new Date().toISOString(),
                credits: 5, // Give new users 5 free credits
                totalInvites: 0,
                emailVerified: false
            };
            
            // If invited, store the referrer
            if (inviteCode) {
                userData.invitedBy = inviteCode;
                
                // Credit the referrer
                try {
                    const referrerDoc = await getDoc(doc(db, "users", inviteCode));
                    if (referrerDoc.exists()) {
                        // Update referrer's credits and invite count
                        await updateDoc(doc(db, "users", inviteCode), {
                            credits: increment(5),
                            totalInvites: increment(1)
                        });
                        
                        // Also update backend
                        await fetch('/credit-referrer', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ 
                                referrerId: inviteCode,
                                newUserId: user.uid 
                            }),
                            credentials: 'include'
                        });
                    }
                } catch (error) {
                    console.error('Error updating referrer:', error);
                }
            }
            
            await setDoc(doc(db, "users", user.uid), userData);
        }
        
        // Send verification email for email/password sign up
        if (!user.emailVerified) {
            await sendVerificationEmail(user);
            
            // Redirect to login page after a delay
            setTimeout(() => {
                window.location.href = '/login';
            }, 5000);
        }
    } catch (error) {
        console.error('Registration error:', error);
        displayErrorMessage('Registration failed. Please try again.');
    }
}

// Handle successful authentication (login)
async function handleAuthSuccess(user) {
    try {
        // Check if email is verified for email/password login
        if (!user.emailVerified && user.providerData[0].providerId === 'password') {
            displayErrorMessage("Please verify your email before logging in. Check your inbox for a verification link.");
            
            // Show resend verification option
            const errorMessage = document.getElementById("error-message");
            if (errorMessage) {
                const resendLink = document.createElement('a');
                resendLink.href = '#';
                resendLink.textContent = 'Resend verification email';
                resendLink.className = 'resend-link';
                resendLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    sendVerificationEmail(user);
                });
                
                errorMessage.appendChild(document.createElement('br'));
                errorMessage.appendChild(resendLink);
            }
            
            // Sign out the user
            await auth.signOut();
            return;
        }
        
        // If email is verified or Google sign-in, proceed with login
        const token = await user.getIdToken();
        await verifyTokenWithBackend(token);
        
        // Update user's emailVerified status in Firestore
        await updateDoc(doc(db, "users", user.uid), {
            emailVerified: user.emailVerified
        });
        
        displaySuccessMessage("Login successful! Redirecting...");
        setTimeout(() => {
            window.location.href = '/';
        }, 1000);
    } catch (error) {
        console.error('Authentication error:', error);
        displayErrorMessage('Authentication failed. Please try again.');
    }
}

// Handle Google Authentication
async function handleGoogleAuth(isSignUp = false) {
    const provider = new GoogleAuthProvider();
    // Request profile and email scopes
    provider.addScope('profile');
    provider.addScope('email');
    
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        console.log('Google user data:', {
            photoURL: user.photoURL,
            displayName: user.displayName,
            email: user.email
        });
        
        // Check if this is a new user
        const isNewUser = result._tokenResponse.isNewUser;
        
        if (isNewUser) {
            await handleRegistrationSuccess(user, true);
        } else {
            await handleAuthSuccess(user);
        }
    } catch (error) {
        displayErrorMessage(`Google sign-${isSignUp ? 'up' : 'in'} failed: ${error.message}`);
    }
}

// Generate and copy invite link
function handleInvite() {
    const inviteModal = document.getElementById('invite-modal');
    const closeModal = document.querySelector('.close-modal');
    const copyLinkBtn = document.getElementById('copy-link');
    const inviteLink = document.getElementById('invite-link');
    const inviteSuccess = document.getElementById('invite-success');
    
    if (auth.currentUser) {
        // Generate invite link with current user's UID
        const baseUrl = window.location.origin;
        const inviteUrl = `${baseUrl}/signup?invite=${auth.currentUser.uid}`;
        
        // Set the link in the input field
        inviteLink.value = inviteUrl;
        
        // Show the modal
        inviteModal.style.display = 'block';
        
        // Copy link button handler
        copyLinkBtn.addEventListener('click', () => {
            inviteLink.select();
            document.execCommand('copy');
            
            // Show success message
            inviteSuccess.style.display = 'block';
            setTimeout(() => {
                inviteSuccess.style.display = 'none';
            }, 3000);
        });
        
        // Close modal handler
        closeModal.addEventListener('click', () => {
            inviteModal.style.display = 'none';
        });
        
        // Close when clicking outside
        window.addEventListener('click', (event) => {
            if (event.target === inviteModal) {
                inviteModal.style.display = 'none';
            }
        });
    }
}

// Document ready event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Handle signup button on main page
    const signUpButton = document.getElementById("sign-up-btn");
    if (signUpButton) {
        signUpButton.addEventListener('click', () => {
            window.location.href = '/signup';
        });
    }

    // Handle signup link on login page
    const signupLink = document.querySelector('a[href="/signup"]');
    if (signupLink) {
        signupLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = '/signup';
        });
    }

    // Handle login form
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById("email").value;
            const password = document.getElementById("password").value;

            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                await handleAuthSuccess(userCredential.user);
            } catch (error) {
                displayErrorMessage("Login failed: " + error.message);
            }
        });

        // Google Login handler
        const googleLoginButton = document.getElementById("google-login");
        if (googleLoginButton) {
            googleLoginButton.addEventListener('click', () => handleGoogleAuth(false));
        }
    }

    // Handle signup form
    const signUpForm = document.getElementById("signupForm");
    if (signUpForm) {
        signUpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const firstname = document.getElementById("firstname-input").value;
            const email = document.getElementById("email-input").value;
            const password = document.getElementById("password-input").value;
            const repeatPassword = document.getElementById("repeat-password-input").value;

            if (password !== repeatPassword) {
                displayErrorMessage("Passwords do not match");
                return;
            }

            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // The user data will be handled in handleRegistrationSuccess
                await handleRegistrationSuccess(user, true);
            } catch (error) {
                displayErrorMessage("Sign-up failed: " + error.message);
            }
        });

        // Google Sign-up handler
        const googleSignUpButton = document.getElementById("google-signup");
        if (googleSignUpButton) {
            googleSignUpButton.addEventListener('click', () => handleGoogleAuth(true));
        }
    }
    
    // Invite button handler
    const inviteButton = document.getElementById("invite-btn");
    if (inviteButton) {
        inviteButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleInvite();
        });
    }
});

// Logout handler
async function handleLogout() {
    try {
        await auth.signOut();
        // Clear session on backend
        await fetch('/logout', {
            method: 'GET',
            credentials: 'include'
        });
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        displayErrorMessage("Logout failed: " + error.message);
    }
}

// Function to update user stats in the UI
async function updateUserStats(userId) {
    try {
        const userDoc = await getDoc(doc(db, "users", userId));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            
            // Update credits display
            const creditsElement = document.getElementById("user-credits");
            if (creditsElement) {
                creditsElement.textContent = userData.credits || 0;
            }
            
            // Update invites display
            const invitesElement = document.getElementById("user-invites");
            if (invitesElement) {
                invitesElement.textContent = userData.totalInvites || 0;
            }
        }
    } catch (error) {
        console.error('Error fetching user stats:', error);
    }
}

// Authentication state observer
onAuthStateChanged(auth, async (user) => {
    const signUpButton = document.getElementById("sign-up-btn");
    const profileContainer = document.querySelector('.profile-container');
    const profilePic = document.getElementById("profile-pic");
    const profileName = document.getElementById("profile-name");
    const profileEmail = document.getElementById("profile-email");
    const logoutButton = document.getElementById("logout");
    
    if (user) {
        // User is signed in
        try {
            // Check if email is verified for protected pages
            if (!user.emailVerified && user.providerData[0].providerId === 'password') {
                const protectedPaths = ['/', '/index.html'];
                if (protectedPaths.includes(window.location.pathname)) {
                    displayErrorMessage("Please verify your email before accessing this page.");
                    await handleLogout();
                    return;
                }
            }
            
            const token = await user.getIdToken();
            await verifyTokenWithBackend(token);
            
            if (signUpButton) signUpButton.style.display = "none";
            if (profileContainer) profileContainer.style.display = "block";
            
            if (profilePic) {
                // Set profile picture from Google account or fallback
                const photoURL = user.photoURL;
                console.log('Setting profile picture. PhotoURL:', photoURL);
                
                if (photoURL) {
                    // Force reload with cache-bust parameter
                    const cacheBust = new Date().getTime();
                    const photoWithCacheBust = photoURL.includes('?') 
                        ? `${photoURL}&cb=${cacheBust}` 
                        : `${photoURL}?cb=${cacheBust}`;
                    
                    profilePic.src = photoWithCacheBust;
                    profilePic.onerror = (e) => {
                        console.error('Failed to load profile picture:', e);
                        profilePic.src = '../static/images/user.png';
                    };
                    profilePic.onload = () => {
                        console.log('Profile picture loaded successfully');
                    };
                } else {
                    console.warn('No photoURL found, using fallback');
                    profilePic.src = '../static/images/user.png';
                }
                
                // Remove existing listener if any to avoid duplicates
                profilePic.removeEventListener('click', toggleDropdown);
                profilePic.addEventListener('click', toggleDropdown);
            }
            
            if (profileName) profileName.textContent = user.displayName || user.email.split('@')[0];
            if (profileEmail) profileEmail.textContent = user.email;
            if (logoutButton) {
                logoutButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    handleLogout();
                });
            }

            // Update user stats (credits and invites)
            await updateUserStats(user.uid);

            // Update UI for authenticated state
            document.querySelectorAll('.auth-required').forEach(elem => {
                elem.style.display = 'block';
            });
            document.querySelectorAll('.no-auth-required').forEach(elem => {
                elem.style.display = 'none';
            });

        } catch (error) {
            console.error('Token verification error:', error);
            await handleLogout();
        }
    } else {
        // User is signed out
        if (signUpButton) signUpButton.style.display = "block";
        if (profileContainer) profileContainer.style.display = "none";
        
        // Update UI for non-authenticated state
        document.querySelectorAll('.auth-required').forEach(elem => {
            elem.style.display = 'none';
        });
        document.querySelectorAll('.no-auth-required').forEach(elem => {
            elem.style.display = 'block';
        });

       
    }
});

// Dropdown toggle function
function toggleDropdown(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Close dropdown when clicking outside
window.addEventListener('click', (event) => {
    if (!event.target.matches('#profile-pic')) {
        const dropdowns = document.getElementsByClassName('profile-dropdown');
        Array.from(dropdowns).forEach(dropdown => {
            if (dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            }
        });
    }
});

export { handleLogout };
