// PWA Install Handler
// Manages the install prompt, Service Worker registration, and storage persistence

const PWAInstaller = (() => {
    let _deferredPrompt = null;
    let _isInstalled = false;

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true ||
               localStorage.getItem('pwa-installed') === 'true';
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    function isMobile() {
        return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
    }

    // Register Service Worker
    async function registerSW() {
        if (!('serviceWorker' in navigator)) {
            console.log('[PWA] Service Workers not supported');
            return;
        }
        try {
            const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.log('[PWA] Service Worker registered, scope:', reg.scope);

            // Check for updates periodically
            setInterval(() => reg.update(), 60 * 60 * 1000); // every hour
        } catch (e) {
            console.error('[PWA] SW registration failed:', e);
        }
    }

    // Request persistent storage so browser doesn't evict the AI model
    async function requestPersistentStorage() {
        if (!navigator.storage || !navigator.storage.persist) return;
        try {
            const granted = await navigator.storage.persist();
            console.log('[PWA] Persistent storage:', granted ? 'granted' : 'denied');
        } catch (e) {
            console.log('[PWA] Persistent storage request failed:', e);
        }
    }

    // Show/hide the install section
    function showInstallSection() {
        const section = document.getElementById('desktop-install-section');
        if (section) section.classList.add('visible');
    }

    function hideInstallSection() {
        const section = document.getElementById('desktop-install-section');
        if (section) section.classList.remove('visible');
        localStorage.setItem('pwa-installed', 'true');
    }

    function wasAlreadyInstalled() {
        return localStorage.getItem('pwa-installed') === 'true';
    }

    // Check if user dismissed the banner recently (within 7 days)
    function wasDismissedRecently() {
        const dismissed = localStorage.getItem('pwa-install-dismissed');
        if (!dismissed) return false;
        const daysSince = (Date.now() - parseInt(dismissed)) / (1000 * 60 * 60 * 24);
        return daysSince < 7;
    }

    return {
        get isInstalled() { return _isInstalled; },
        get isMobileDevice() { return isMobile(); },

        async init() {
            // Register Service Worker first
            await registerSW();

            // Request persistent storage (for AI model cache)
            await requestPersistentStorage();

            _isInstalled = isStandalone();

            if (_isInstalled) {
                console.log('[PWA] Running as installed app');
                localStorage.setItem('pwa-installed', 'true');
                return;
            }

            // Never show install banner on phone screens
            if (isMobile()) {
                console.log('[PWA] Mobile device — skipping install banner');
                return;
            }

            // Listen for the install prompt (Chrome/Edge/Samsung — desktop only)
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                _deferredPrompt = e;
                console.log('[PWA] Install prompt ready');

                // Show navbar install buttons
                const navbarInstallBtn = document.getElementById('navbar-install-btn');
                const navbarInstallBtnMobile = document.getElementById('navbar-install-btn-mobile');
                if (navbarInstallBtn) navbarInstallBtn.style.display = 'flex';
                if (navbarInstallBtnMobile) navbarInstallBtnMobile.style.display = 'flex';

                if (!wasAlreadyInstalled() && !wasDismissedRecently()) {
                    showInstallSection();
                }
            });

            // Detect successful install — hide section and persist
            window.addEventListener('appinstalled', () => {
                _isInstalled = true;
                _deferredPrompt = null;
                hideInstallSection();
                console.log('[PWA] App installed successfully');
            });

            // Wire up install button
            const installBtn = document.getElementById('pwa-install-btn');
            if (installBtn) {
                installBtn.addEventListener('click', () => this.promptInstall());
            }

            // Wire up navbar install buttons
            const navbarInstallBtn = document.getElementById('navbar-install-btn');
            const navbarInstallBtnMobile = document.getElementById('navbar-install-btn-mobile');
            
            if (navbarInstallBtn) {
                navbarInstallBtn.addEventListener('click', () => {
                    // Show the install section/banner
                    showInstallSection();
                    // Scroll to it smoothly
                    const section = document.getElementById('desktop-install-section');
                    if (section) {
                        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }
            
            if (navbarInstallBtnMobile) {
                navbarInstallBtnMobile.addEventListener('click', () => {
                    showInstallSection();
                    const section = document.getElementById('desktop-install-section');
                    if (section) {
                        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }

        },

        async promptInstall() {
            if (!_deferredPrompt) {
                console.log('[PWA] No install prompt available');
                return false;
            }
            _deferredPrompt.prompt();
            const result = await _deferredPrompt.userChoice;
            console.log('[PWA] Install choice:', result.outcome);
            _deferredPrompt = null;
            hideInstallSection();
            return result.outcome === 'accepted';
        }
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    PWAInstaller.init();
});
