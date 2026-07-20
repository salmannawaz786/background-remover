"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { getFirebaseApp } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import Link from "next/link";
import { LogOut, User, Coins, Copy, Check } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

export default function UserMenu() {
  const { user } = useStore();
  const [open, setOpen] = useState(false);
  const [authInstance, setAuthInstance] = useState<any>(null);
  const [totalInvites, setTotalInvites] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getFirebaseApp()
      .then(async (app) => {
        const { getAuth } = await import("firebase/auth");
        setAuthInstance(getAuth(app));
      })
      .catch(() => {});
  }, []);

  // Listen for totalInvites changes from Firestore (auth already handled by FirebaseInit)
  useEffect(() => {
    if (!user) return;
    let unsub: (() => void) | null = null;

    const setup = async () => {
      try {
        const app = await getFirebaseApp();
        const { getFirestore, doc, onSnapshot } = await import("firebase/firestore");
        const db = getFirestore(app);
        unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
          if (snap.exists()) {
            setTotalInvites(snap.data().totalInvites || 0);
          }
        });
      } catch {}
    };

    setup();
    return () => { if (unsub) unsub(); };
  }, [user]);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const avatarUrl = user?.photoURL;

  const inviteLink = user ? `${typeof window !== 'undefined' ? window.location.origin : ''}/signup?ref=${user.uid}` : '';

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Invite link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  if (!user) {
    return (
      <Link href="/login"
        className="flex items-center gap-2 px-3 py-1.5 rounded-full glass border border-[var(--glass-border)] text-sm font-medium text-foreground hover:border-primary/50 transition-all">
        <User size={14} /> Sign in
      </Link>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-full glass border border-[var(--glass-border)] hover:border-primary/50 transition-all">
        {avatarUrl ? (
          <Image src={avatarUrl} alt="avatar" width={24} height={24} className="rounded-full object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-full btn-gradient flex items-center justify-center text-black text-xs font-bold shrink-0">
            {displayName[0].toUpperCase()}
          </div>
        )}
        <div className="hidden sm:flex items-center gap-1 text-sm text-foreground">
          <Coins size={12} className="text-primary" />
          <span className="font-semibold">{user.credits ?? "…"}</span>
        </div>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-2 w-[min(16rem,calc(100vw-1rem))] z-20 shadow-2xl rounded-2xl p-2 border border-[var(--glass-border)] bg-[var(--popover)] text-[var(--popover-foreground)]"
            style={{ backgroundColor: "var(--popover)" }}
          >
            <div className="px-3 py-2.5 border-b border-[var(--glass-border)] mb-1">
              <p className="text-sm font-semibold truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              <div className="flex items-center gap-1 mt-1.5">
                <Coins size={12} className="text-primary" />
                <span className="text-sm font-bold text-primary">{user.credits ?? 0}</span>
                <span className="text-xs text-muted-foreground">credits</span>
              </div>
            </div>

            {/* Invite Section */}
            <div className="px-3 py-2.5 border-b border-[var(--glass-border)] mb-1">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-xs text-muted-foreground">Invite friends & earn credits</span>
                <span className="text-xs font-medium text-primary whitespace-nowrap">{totalInvites}/10</span>
              </div>
              <button onClick={copyInviteLink}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy Invite Link"}
              </button>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Earn 6 credits per invite (max 10)
              </p>
            </div>

            <button onClick={() => { if (authInstance) signOut(authInstance); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all">
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
