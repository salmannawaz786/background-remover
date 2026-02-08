// Firebase Authentication for Electron Desktop App
const { ipcMain, BrowserWindow } = require('electron');

// Firebase configuration - same as web app
const firebaseConfig = {
    apiKey: "AIzaSyA8D2w0J8auihu3BbR8McIpoSduDfI2jxo",
    authDomain: "are-you-genius-1f253.firebaseapp.com",
    projectId: "are-you-genius-1f253",
    storageBucket: "imagetotext-4c3e3.appspot.com",
    messagingSenderId: "771421054895",
    appId: "1:771421054895:web:7a27a9c69f722069ebb15a",
    measurementId: "G-RE3R9WGMH9"
};

// Google OAuth Client ID - Get from Google Cloud Console
// https://console.cloud.google.com/apis/credentials
const GOOGLE_CLIENT_ID = '771421054895-jdcj82m05a5bavmk3sdc5q0kllvu18n5.apps.googleusercontent.com';

// Store for current auth state
let currentUser = null;
let idToken = null;
let persistentStore = null;

// Google Sign-In using BrowserWindow
async function handleGoogleSignIn() {
    return new Promise((resolve, reject) => {
        let isResolved = false;
        
        const authWindow = new BrowserWindow({
            width: 500,
            height: 600,
            show: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        
        // Build Google OAuth URL - Using Firebase handler
        const redirectUri = 'https://are-you-genius-1f253.firebaseapp.com/__/auth/handler';
        const scope = encodeURIComponent('email profile');
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${GOOGLE_CLIENT_ID}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=token` +
            `&scope=${scope}`;
        
        console.log('Opening Google OAuth URL:', authUrl);
        authWindow.loadURL(authUrl);
        
        // Handle all navigation events
        authWindow.webContents.on('will-redirect', (event, url) => {
            console.log('Will redirect to:', url);
            handleCallback(url);
        });
        
        authWindow.webContents.on('will-navigate', (event, url) => {
            console.log('Will navigate to:', url);
            handleCallback(url);
        });
        
        authWindow.webContents.on('did-navigate', (event, url) => {
            console.log('Did navigate to:', url);
            handleCallback(url);
        });
        
        // Check URL on every navigation
        authWindow.webContents.on('did-finish-load', () => {
            const currentUrl = authWindow.webContents.getURL();
            console.log('Page loaded:', currentUrl);
            handleCallback(currentUrl);
        });
        
        function handleCallback(url) {
            if (isResolved) return;
            
            console.log('Checking URL:', url);
            
            // Check for Firebase auth handler success
            if (url.includes('/__/auth/handler') && (url.includes('#') || url.includes('access_token'))) {
                try {
                    // Extract tokens from URL fragment
                    const hashPart = url.split('#')[1] || url.split('?')[1] || '';
                    const params = new URLSearchParams(hashPart);
                    const accessToken = params.get('access_token');
                    const idTokenValue = params.get('id_token');
                    
                    if (accessToken) {
                        console.log('✅ Got access token!');
                        isResolved = true;
                        authWindow.destroy();
                        resolve({ accessToken, idToken: idTokenValue });
                        return;
                    }
                } catch (error) {
                    console.error('Error parsing tokens:', error);
                }
            }
            
            // Check for error
            if (url.includes('error=')) {
                console.log('❌ OAuth error detected');
                isResolved = true;
                authWindow.destroy();
                reject(new Error('Google Sign-In was cancelled or failed'));
            }
        }
        
        // Handle window close
        authWindow.on('closed', () => {
            if (!isResolved) {
                console.log('⚠️ Window closed by user');
                isResolved = true;
                reject(new Error('Sign-in window was closed'));
            }
        });
    });
}

// IPC Handlers for authentication
function setupAuthHandlers(store) {
    persistentStore = store;
    
    // Get current auth state
    ipcMain.handle('auth-get-state', () => {
        return {
            isAuthenticated: currentUser !== null,
            user: currentUser
        };
    });
    
    // Store auth state after login from renderer
    ipcMain.handle('auth-set-user', async (event, { user, token }) => {
        try {
            // Store user data in memory
            currentUser = user;
            idToken = token;
            
            // Persist to disk (encrypted)
            if (persistentStore) {
                persistentStore.set('user', user);
                persistentStore.set('token', token);
            }
            
            console.log('User authenticated:', user.email);
            return { success: true };
        } catch (error) {
            console.error('Auth storage failed:', error);
            return { success: false, error: error.message };
        }
    });
    
    // Logout
    ipcMain.handle('auth-logout', () => {
        currentUser = null;
        idToken = null;
        
        // Clear persistent storage
        if (persistentStore) {
            persistentStore.delete('user');
            persistentStore.delete('token');
        }
        
        return { success: true };
    });
    
    // Get ID token for API calls
    ipcMain.handle('auth-get-token', () => {
        return idToken;
    });
    
    // Google Sign-In
    ipcMain.handle('auth-google-signin', async () => {
        try {
            const tokens = await handleGoogleSignIn();
            return { success: true, ...tokens };
        } catch (error) {
            console.error('Google Sign-In error:', error);
            return { success: false, error: error.message };
        }
    });
}

// Set current user (for restoring from persistent storage)
function setCurrentUser(user, token) {
    currentUser = user;
    idToken = token;
    console.log('Restored user session:', user.email);
}

module.exports = {
    setupAuthHandlers,
    firebaseConfig,
    getCurrentUser: () => currentUser,
    getIdToken: () => idToken,
    setCurrentUser
};
