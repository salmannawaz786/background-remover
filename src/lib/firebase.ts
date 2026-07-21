import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, TwitterAuthProvider, type Auth } from "firebase/auth";

let firebaseApp: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let initPromise: Promise<FirebaseApp> | null = null;

async function initFirebaseAsync(): Promise<FirebaseApp> {
  if (typeof window === "undefined") throw new Error("SSR");
  if (firebaseApp) return firebaseApp;
  if (getApps().length) {
    firebaseApp = getApps()[0];
    authInstance = getAuth(firebaseApp);
    return firebaseApp;
  }

  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001").replace(/\/$/, "");
  let config: any;
  try {
    // Try to fetch config from backend first (more secure)
    const res = await fetch(`${apiBase}/api/config`);
    if (!res.ok) throw new Error("Failed to fetch firebase config");
    config = await res.json();
  } catch {
    // Fallback to environment variables if backend is not available
    config = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    };
    if (!config.apiKey) {
      throw new Error("Firebase config not available");
    }
  }
  
  firebaseApp = initializeApp(config);
  authInstance = getAuth(firebaseApp);
  return firebaseApp;
}

export function getFirebaseApp(): Promise<FirebaseApp> {
  if (!initPromise) {
    initPromise = initFirebaseAsync();
  }
  return initPromise;
}

// Export auth that waits for initialization
export const auth = new Proxy({} as Auth, {
  get(target, prop) {
    if (!authInstance) {
      if (typeof window !== "undefined") {
        console.warn("Firebase auth accessed before initialization. This may cause errors.");
      }
      // Return a dummy function for common methods to avoid immediate crash
      if (prop === "onAuthStateChanged") return () => () => {};
      if (prop === "currentUser") return null;
      throw new Error("Firebase not initialized yet. Call getFirebaseApp() first.");
    }
    return (authInstance as never)[prop as keyof Auth];
  },
});

export const googleProvider = new GoogleAuthProvider();
export const twitterProvider = new TwitterAuthProvider();
