"use client";
export const dynamic = 'force-dynamic';
import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, googleProvider, facebookProvider, twitterProvider, getFirebaseApp } from "@/lib/firebase";
import { useStore } from "@/lib/store";
import { motion } from "framer-motion";
import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
    </svg>
  );
}

const providers = [
  { id: "google",   label: "Continue with Google",   Icon: GoogleIcon,   provider: googleProvider,   bg: "hover:bg-[#4285F4]/10 border-[#4285F4]/30" },
  { id: "facebook", label: "Continue with Facebook",  Icon: FacebookIcon, provider: facebookProvider, bg: "hover:bg-[#1877F2]/10 border-[#1877F2]/30" },
  { id: "twitter",  label: "Continue with X",         Icon: XIcon,        provider: twitterProvider,  bg: "hover:bg-foreground/5 border-border/40" },
];

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const setUser = useStore((s) => s.setUser);

  const handleSignIn = async (providerId: string, provider: typeof googleProvider) => {
    setLoading(providerId);
    try {
      await getFirebaseApp();
      const { signInWithPopup: signIn } = await import("firebase/auth");
      const cred = await signIn(auth, provider);
      setUser({ uid: cred.user.uid, email: cred.user.email ?? "", displayName: cred.user.displayName ?? undefined, photoURL: cred.user.photoURL ?? undefined });
      router.push("/");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      console.error("Sign-in error:", code, err);
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      if (code === "auth/unauthorized-domain") {
        toast.error("This domain isn't authorized. Add it in Firebase Console.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen aurora-bg flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm glass rounded-3xl p-8 border border-[var(--glass-border)]"
      >
        <div className="flex flex-col items-center gap-3 mb-8">
          <Image src="/logo.png" alt="SalluLabs" width={56} height={56}
            className="w-14 h-14 object-contain drop-shadow-[0_0_16px_rgba(251,191,36,0.4)]" />
          <span className="font-bold text-foreground text-xl">SalluLabs</span>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-1 text-center">Welcome back</h1>
        <p className="text-muted-foreground text-sm mb-8 text-center">Sign in to continue removing backgrounds</p>

        <div className="flex flex-col gap-3">
          {providers.map(({ id, label, Icon, provider, bg }) => (
            <button
              key={id}
              onClick={() => handleSignIn(id, provider as any)}
              disabled={!!loading}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm font-medium text-foreground transition-all disabled:opacity-60 cursor-pointer ${bg}`}
            >
              {loading === id ? (
                <span className="w-5 h-5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              ) : (
                <Icon />
              )}
              <span className="flex-1 text-left">{label}</span>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          No account yet?{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">Sign up free</Link>
        </p>
      </motion.div>
    </div>
  );
}
