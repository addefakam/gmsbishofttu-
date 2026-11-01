import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/i18n/config";
import { Toaster } from "@/components/ui/sonner";
import { initToastErrorWrapper, setSupportPhone } from "@/lib/support";
import { EmergencyCallButton } from "@/components/shared/emergency-call-button";

// ── One-time setup: wrap sonner's toast.error so EVERY error toast in
// the app automatically appends "For help, call: <phone>" when a
// support phone is configured. Safe on server (no-op) and client.
if (typeof window !== "undefined") {
  initToastErrorWrapper();
  // Pre-load any previously-stored support phone from localStorage so
  // the wrapper has it on the very first toast.error call after refresh.
  // (Login screens will refresh this from /api/config/public on mount.)
  setSupportPhone(window.localStorage.getItem("ghms_support_phone"));
}

export const metadata: Metadata = {
  title: "Bishoftu Guest Management System",
  description: "Bishoftu Guest Management System",
  applicationName: "Bishoftu GMS",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Bishoftu GMS",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/app-icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/app-icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {children}
        <Toaster richColors position="top-right" />
        {/* Floating Emergency Call button — bottom-right corner.
            Tap to expand → shows Bishoftu Police (9141) + Hospital (5645). */}
        <EmergencyCallButton />
      </body>
    </html>
  );
}
