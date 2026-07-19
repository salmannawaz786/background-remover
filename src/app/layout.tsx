import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";
import FirebaseInit from "../components/FirebaseInit";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BG Remover — AI Background Removal",
  description:
    "Remove image backgrounds instantly with AI. Upload a photo, click one button, and download a transparent PNG.",
  applicationName: "BG Remover",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BG Remover",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#a97e2f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${geistSans.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <FirebaseInit />
          {children}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
