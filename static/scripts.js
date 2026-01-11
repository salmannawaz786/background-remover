// Intersection Observer for fade-in animations
const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
};

const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target); // Stop observing once visible
        }
    });
}, observerOptions);

// Observe all tool containers and fade-in elements
document.addEventListener('DOMContentLoaded', () => {
    const elements = document.querySelectorAll('.tool-container, .fade-in');
    elements.forEach(el => observer.observe(el));
});

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
    });
});

// Theme Management Module
const ThemeManager = {
    defaultTheme: 'light',
    storageKey: 'user-theme-preference',

    init() {
        this.setupThemeToggle();
        this.loadSavedTheme();
    },

    setupThemeToggle() {
        const toggleBtn = document.querySelector('.theme-toggle-btn');
        if (!toggleBtn) {
            console.warn('Theme toggle button not found');
            return;
        }

        toggleBtn.addEventListener('click', () => {
            this.toggleTheme();
        });
    },

    toggleTheme() {
        const currentTheme = this.getCurrentTheme();
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    },

    getCurrentTheme() {
        return document.documentElement.getAttribute('data-theme') || this.defaultTheme;
    },

    setTheme(theme) {
        // Use requestAnimationFrame for smoother transition
        requestAnimationFrame(() => {
            document.documentElement.setAttribute('data-theme', theme);
            
            // Apply to body as well for backward compatibility
            if (theme === 'dark') {
                document.body.classList.add('dark-mode');
                document.body.classList.remove('light-mode');
            } else {
                document.body.classList.add('light-mode');
                document.body.classList.remove('dark-mode');
            }
            
            localStorage.setItem(this.storageKey, theme);
            this.updateThemeToggleUI(theme);
            
            // Dispatch event
            document.dispatchEvent(new CustomEvent('themeChanged', { 
                detail: { theme } 
            }));
        });
    },

    loadSavedTheme() {
        const savedTheme = localStorage.getItem(this.storageKey) || this.defaultTheme;
        this.setTheme(savedTheme);
    },

    updateThemeToggleUI(theme) {
        const lightIcon = document.querySelector('.theme-icon-light');
        const darkIcon = document.querySelector('.theme-icon-dark');
        
        if (lightIcon && darkIcon) {
            if (theme === 'dark') {
                lightIcon.classList.remove('active');
                darkIcon.classList.add('active');
            } else {
                lightIcon.classList.add('active');
                darkIcon.classList.remove('active');
            }
        }
    }
};

// Initialize theme management when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();
});

// Optional: Listen for theme change events
document.addEventListener('themeChanged', (e) => {
    console.log(`Theme changed to: ${e.detail.theme}`);
    // You can add additional actions here if needed
});

// Mobile interaction for tool images
document.querySelectorAll('.tool-image').forEach(container => {
    let isMobile = window.matchMedia("(max-width: 768px)").matches;
    let isActive = false;

    if (isMobile) {
        container.addEventListener('click', () => {
            isActive = !isActive;
            container.classList.toggle('active', isActive);
        });
    }

    
});

