"use client";
import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="border-t border-[var(--glass-border)] py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="SalluLabs Logo"
              width={36}
              height={36}
              className="w-9 h-9 object-contain drop-shadow-[0_0_12px_rgba(251,191,36,0.3)]"
            />
            <div className="flex items-baseline gap-1.5">
              <span className="font-black text-lg tracking-tight text-foreground">SalluLabs</span>
              <span className="text-[10px] font-bold bg-primary text-black px-1.5 py-0.5 rounded-full leading-none">BETA</span>
            </div>
          </Link>

          {/* Links */}
          <div className="flex items-center gap-5 text-sm text-muted-foreground flex-wrap justify-center">
            <Link href="/#how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
            <Link href="/#tools" className="hover:text-foreground transition-colors">Tools</Link>
            <Link href="/login" className="hover:text-foreground transition-colors">Sign In</Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">Sign Up</Link>
          </div>

          {/* Copyright */}
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} SalluLabs
          </p>
        </div>
      </div>
    </footer>
  );
}
