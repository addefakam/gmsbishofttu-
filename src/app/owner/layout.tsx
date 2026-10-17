import type { Metadata, Viewport } from "next";
import "@/i18n/config";

export const metadata: Metadata = {
  title: "Bishoftu GMS — Owner",
  description: "Owner mobile companion — real-time KPIs, alerts, end-of-day report, shift + maintenance overview",
  manifest: "/owner-app/manifest.json",
  icons: {
    icon: [
      { url: "/owner-app/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/owner-app/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Bishoftu GMS Owner",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#F6F7FB",
};

export default function OwnerAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#F6F7FB] text-slate-900 antialiased">
      {children}
    </div>
  );
}
