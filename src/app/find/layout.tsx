import type { Metadata, Viewport } from "next";
import "@/i18n/config";

export const metadata: Metadata = {
  title: "Bishoftu Rooms — Guest Room Finder",
  description: "Find and book guesthouse rooms in Bishoftu city. Browse available rooms, compare prices, and request bookings from approved guesthouses.",
  applicationName: "Bishoftu Rooms",
  manifest: "/find-app/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Bishoftu Rooms",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/find-app/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/find-app/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/find-app/icon-192.png", sizes: "192x192" }],
  },
  openGraph: {
    title: "Bishoftu Rooms — Guest Room Finder",
    description: "Find and book guesthouse rooms in Bishoftu city.",
    type: "website",
    locale: "am_ET",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0ea5e9",
};

export default function FindAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-sky-50 text-slate-900 antialiased">
      <link rel="icon" type="image/png" sizes="192x192" href="/find-app/icon-192.png" />
      <link rel="icon" type="image/png" sizes="512x512" href="/find-app/icon-512.png" />
      <link rel="apple-touch-icon" sizes="192x192" href="/find-app/icon-192.png" />
      {children}
    </div>
  );
}
