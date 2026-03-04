// Service Worker for BG Remover PWA
// Handles offline caching of app shell and static assets
// AI model caching is handled by transformers.js Cache API separately

const CACHE_NAME = 'bg-remover-v1.0.1';
const APP_SHELL = [
    '/',
    '/static/index.css?v=1.0.1',
    '/static/navbar.css?v=1.0.1',
    '/static/footer.css?v=1.0.1',
    '/static/theme.css?v=1.0.1',
    '/static/theme-toggle.css?v=1.0.1',
    '/static/quality-toggle.css?v=1.0.1',
    '/static/auth.css?v=1.0.1',
    '/static/pwa-install.css?v=1.0.1',
    '/static/scripts.js?v=1.0.1',
    '/static/client-processor.js?v=1.0.1',
    '/static/client-processor-v2.js?v=1.0.1',
    '/static/firebaseauth.js?v=1.0.1',
    '/static/pwa-install.js?v=1.0.1',
    '/static/app.js?v=1.0.1',
    '/static/dogie_running.lottie',
    '/static/images/logo.png'
];

// Install — cache app shell
self.addEventListener('install', (event) => {
    console.log('[SW] Installing v1...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching app shell');
                return cache.addAll(APP_SHELL);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME && name !== 'transformers-cache')
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch — smart strategy based on request type
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests (POST to /upload, etc.)
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests (Firebase, CDNs, etc.) except HuggingFace model files
    if (url.origin !== self.location.origin) return;

    // API calls — network first, no cache
    if (url.pathname.startsWith('/api/') || 
        url.pathname === '/verify-token' || 
        url.pathname === '/health' ||
        url.pathname === '/logout') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(JSON.stringify({ error: 'Offline' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // Static assets & app shell — cache first, network fallback
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request).then((response) => {
                // Don't cache non-ok responses
                if (!response || response.status !== 200) return response;

                // Cache static assets for future offline use
                if (url.pathname.startsWith('/static/') || url.pathname === '/') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }

                return response;
            }).catch(() => {
                // Offline fallback — serve cached index for navigation requests
                if (event.request.mode === 'navigate') {
                    return caches.match('/');
                }
                return new Response('Offline', { status: 503 });
            });
        })
    );
});
