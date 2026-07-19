"use client";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Sun, Moon, Download, Menu, X, Coins, LogOut, ChevronDown } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { getFirebaseApp } from "@/lib/firebase";
import { onAuthStateChanged, signOut, type User as FBUser } from "firebase/auth";
import { useStore } from "@/lib/store";
import { isPWA } from "@/lib/pwa-utils";
import Image from "next/image";

export default function Navbar() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<Event & { prompt: () => void } | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [fbUser, setFbUser] = useState<FBUser | null>(null);
  const [authInstance, setAuthInstance] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const { user, setUser, updateCredits } = useStore();

  useEffect(() => {
    setMounted(true);
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as Event & { prompt: () => void });
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let unsubFirestore: (() => void) | null = null;
    
    const setupAuth = async () => {
      try {
        const app = await getFirebaseApp();
        const { getAuth, onAuthStateChanged } = await import("firebase/auth");
        const auth = getAuth(app);
        setAuthInstance(auth);
        
        unsub = onAuthStateChanged(auth, async (u) => {
          setFbUser(u);
          setAuthChecked(true);
          if (u) {
            setUser({ uid: u.uid, email: u.email ?? "" });
            
            // Set up real-time Firestore listener for credits
            try {
              const { getFirestore, doc, onSnapshot, getDoc } = await import("firebase/firestore");
              const db = getFirestore(app);
              
              // Remove existing listener if any
              if (unsubFirestore) { unsubFirestore(); unsubFirestore = null; }
              
              // Set up real-time listener
              unsubFirestore = onSnapshot(doc(db, "users", u.uid), (docSnapshot) => {
                if (docSnapshot.exists()) {
                  const userData = docSnapshot.data();
                  const credits = userData.credits || 0;
                  updateCredits(credits);
                  console.log(`✅ Credits updated in real-time: ${credits}`);
                }
              }, (error) => {
                console.error('Error listening to user stats:', error);
              });
              
              // Also get initial data immediately
              const userDoc = await getDoc(doc(db, "users", u.uid));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                const credits = userData.credits || 0;
                updateCredits(credits);
              }
            } catch (err) {
              // Firestore not available in this session — credits will stay at default.
              console.warn("Firestore real-time credits unavailable:", err);
            }
          } else {
            setUser(null);
            // Clean up Firestore listener
            if (unsubFirestore) { unsubFirestore(); unsubFirestore = null; }
          }
        });
      } catch {
        // Firebase not available
        setUser(null);
        setAuthChecked(true);
      }
    };
    
    setupAuth();
    
    return () => {
      if (unsub) unsub();
      if (unsubFirestore) unsubFirestore();
    };
  }, [setUser, updateCredits]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      setDeferredPrompt(null);
      setShowInstall(false);
    } else {
      // If prompt is not available, show toast with instructions
      import('sonner').then(({ toast }) => {
        toast.info("To install: tap the share icon (iOS) or menu (Android/Desktop) and select 'Add to Home Screen'");
      });
    }
  };

  const handleSignOut = async () => {
    if (authInstance) await signOut(authInstance);
    setDropOpen(false);
    setUser(null);
  };

  const displayName = fbUser?.displayName || fbUser?.email?.split("@")[0] || "User";
  const avatarUrl = fbUser?.photoURL;

  return (
    <nav className="sticky top-0 z-50 glass border-b border-[var(--glass-border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">

        {/* ── LEFT: Logo ── */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Image
            src="/logo.png"
            alt="SalluLabs Logo"
            width={40}
            height={40}
            className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-[0_0_12px_rgba(220,177,92,0.3)]"
          />
          <div className="flex items-baseline gap-1.5">
            <span className="font-black text-xl tracking-tight text-foreground hidden sm:block">SalluLabs</span>
          </div>
        </Link>

        {/* ── CENTER: Nav links ── */}
        <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/#how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
          <Link href="/#tools" className="hover:text-foreground transition-colors">Tools</Link>
        </div>

        {/* ── RIGHT ── */}
        <div className="flex items-center gap-2">
          {/* App Install Button - Hide in PWA, show in web */}
          {!isPWA() && (
            <button onClick={handleInstall}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-all">
              <Download size={12} /> Install App
            </button>
          )}

          {/* Theme toggle */}
          {mounted && (
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          )}

          {/* Auth section */}
          {!authChecked ? (
            /* Loading: show a minimal skeleton to prevent flash */
            <div className="w-20 h-9 rounded-full bg-muted/30 animate-pulse" />
          ) : fbUser ? (
            /* Logged in: avatar + credits + dropdown */
            <div className="relative" ref={dropRef}>
              <button onClick={() => setDropOpen(!dropOpen)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-full glass border border-[var(--glass-border)] hover:border-primary/40 transition-all">
                {avatarUrl ? (
                  <Image src={avatarUrl} alt="avatar" width={26} height={26} className="rounded-full object-cover" />
                ) : (
                  <div className="w-[26px] h-[26px] rounded-full btn-gradient flex items-center justify-center text-black text-xs font-bold shrink-0">
                    {displayName[0].toUpperCase()}
                  </div>
                )}
                <div className="hidden sm:flex items-center gap-1 text-sm text-foreground">
                  <Coins size={12} className="text-primary" />
                  <span className="font-semibold">{user?.credits ?? "…"}</span>
                </div>
                <ChevronDown size={13} className={`text-muted-foreground transition-transform ${dropOpen ? "rotate-180" : ""}`} />
              </button>

              {dropOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 glass border border-[var(--glass-border)] rounded-2xl p-2 z-50 shadow-2xl">
                  <div className="px-3 py-2.5 border-b border-[var(--glass-border)] mb-1">
                    <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">{fbUser.email}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      <Coins size={12} className="text-primary" />
                      <span className="text-sm font-bold text-primary">{user?.credits ?? 0}</span>
                      <span className="text-xs text-muted-foreground">credits</span>
                    </div>
                  </div>
                  <button onClick={handleSignOut}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all">
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Logged out: sign in + get started */
            <>
              <Link href="/login"
                className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">
                Sign in
              </Link>
              <Link href="/signup"
                className="btn-gradient text-black text-sm font-bold px-4 py-2 rounded-full">
                Get started
              </Link>
            </>
          )}

          {/* Mobile hamburger */}
          <button className="md:hidden w-9 h-9 flex items-center justify-center text-muted-foreground"
            onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* ── Mobile menu ── */}
      {menuOpen && (
        <div className="md:hidden border-t border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl px-5 py-4 flex flex-col gap-4 text-sm">
          <Link href="/#how-it-works" onClick={() => setMenuOpen(false)} className="text-muted-foreground hover:text-foreground py-1">How it works</Link>
          <Link href="/#tools" onClick={() => setMenuOpen(false)} className="text-muted-foreground hover:text-foreground py-1">Tools</Link>
          {!fbUser && (
            <Link href="/login" onClick={() => setMenuOpen(false)} className="text-muted-foreground hover:text-foreground py-1">Sign in</Link>
          )}
          {fbUser && (
            <div className="flex items-center gap-2 py-1">
              <Coins size={14} className="text-primary" />
              <span className="text-foreground font-semibold">{user?.credits ?? 0} credits</span>
            </div>
          )}
          {showInstall && (
            <button onClick={handleInstall} className="flex items-center gap-2 text-primary font-medium">
              <Download size={14} /> Install App
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
