"use client";

// Force server-rendering on every request so the HTML shell always
// references the latest JS chunk URLs. Without this, Vercel serves a
// statically-prerendered index.html that points at OLD chunk URLs, and
// the browser happily serves both the old HTML and the old chunks from
// its HTTP cache — making deployed changes invisible until the cache
// expires or the user manually clears site data.
export const dynamic = "force-dynamic";

import "@/i18n/config";

import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from "react";
import { useAppStore } from "@/lib/store";
import LoginPage from "@/components/ghms/login-page";
import Sidebar from "@/components/ghms/sidebar";
import PageRenderer from "@/components/ghms/page-renderer";
import LanguageSwitcher from "@/components/ghms/language-switcher";
import PwaInstallPrompt from "@/components/pwa-install-prompt";
import { apiGetNotifications, apiMarkNotificationRead } from "@/lib/api";
import { useTranslation, I18nextProvider } from "react-i18next";
import i18n from "@/i18n/config";
import { Bell, ArrowLeft } from "lucide-react";

interface UrgentNotif {
  id: string;
  title: string;
  message: string;
}

const emptySubscribe = () => () => {};

function readFromPoliceAppFlag(): boolean {
  try {
    return sessionStorage.getItem("ghms_from_police_app") === "1";
  } catch {
    return false;
  }
}

export default function Home() {
  return (
    <I18nextProvider i18n={i18n}>
      <PwaInstallPrompt />
      <HomeContent />
    </I18nextProvider>
  );
}

function HomeContent() {
  const { t } = useTranslation("common");
  const { currentUser, currentPage, setCurrentPage } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentNotifs, setUrgentNotifs] = useState<UrgentNotif[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Show a "back to the police app" arrow when the user arrived via the
  // police app's Full System Access (incl. the installed standalone window).
  const fromPoliceApp = useSyncExternalStore(
    emptySubscribe,
    readFromPoliceAppFlag,
    () => false
  );

  const backToPoliceApp = useCallback(() => {
    try {
      sessionStorage.removeItem("ghms_from_police_app");
    } catch {
      /* ignore */
    }
    window.location.assign("/police-app");
  }, []);

  // ── ALL hooks must be called before any conditional return (Rules of Hooks) ──

  // Prevent hydration mismatch — store loads from localStorage on client
  useEffect(() => { setMounted(true); }, []);

  // ── Handle Chapa payment redirect: /?chapa=success&sub=XXX ──
  useEffect(() => {
    if (!mounted) return;
    const params = new URLSearchParams(window.location.search);
    const chapa = params.get("chapa");
    const sub = params.get("sub");

    // Also check sessionStorage (legacy bridge page approach)
    const sessionRaw = sessionStorage.getItem("chapa_callback");
    let sessionData: { chapa?: string; sub?: string } | null = null;
    if (sessionRaw) {
      try { sessionData = JSON.parse(sessionRaw); } catch { /* ignore */ }
      sessionStorage.removeItem("chapa_callback");
    }

    const chapaValue = chapa || sessionData?.chapa;
    const subValue = sub || sessionData?.sub;

    if (chapaValue === "success") {
      sessionStorage.setItem("chapa_result", "success");
      sessionStorage.setItem("chapa_sub", subValue || "");
      sessionStorage.setItem("chapa_timestamp", String(Date.now()));
      setCurrentPage("my-subscription");
      window.history.replaceState({}, "/", "/");
    }
  }, [mounted, setCurrentPage]);

  const fetchNotifData = useCallback(async () => {
    try {
      const res = await apiGetNotifications();
      const raw = res as Record<string, unknown> | unknown[];
      const list = Array.isArray(raw) ? raw : raw?.notifications;
      const arr: Record<string, unknown>[] = Array.isArray(list) ? list : [];
      setUnreadCount(arr.filter((n) => !n.isRead).length);
      const urgent = arr
        .filter((n) => !n.isRead && typeof n.title === "string" && n.title.startsWith("[URGENT]"))
        .map((n) => ({
          id: n.id as string,
          title: (n.title as string).replace(/^\[URGENT\]\s*/, ""),
          message: ((n.message as string) || "").split("\n")[0],
        }));
      setUrgentNotifs(urgent);
    } catch {
      // silent - non-critical
    }
  }, []);

  useEffect(() => {
    if (!mounted || !currentUser) return;
    fetchNotifData();
    const interval = setInterval(fetchNotifData, 15000);
    return () => clearInterval(interval);
  }, [mounted, currentUser, fetchNotifData]);

  // Logout (or session loss) clears the police-app back arrow
  useEffect(() => {
    if (mounted && !currentUser) {
      try {
        sessionStorage.removeItem("ghms_from_police_app");
      } catch {
        /* ignore */
      }
    }
  }, [mounted, currentUser]);

  // ── Conditional renders (AFTER all hooks) ──

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (!currentUser || currentPage === "login") {
    return <LoginPage />;
  }

  const tickerText = urgentNotifs
    .map((n) => `${n.title}: ${n.message}`)
    .join("     \u2022     ");

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {urgentNotifs.length > 0 && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              const ids = urgentNotifs.map((n) => n.id);
              setUrgentNotifs([]);
              setUnreadCount((c) => Math.max(0, c - ids.length));
              ids.forEach((id) => apiMarkNotificationRead(id).catch(() => {}));
              setCurrentPage("notifications");
            }}
            onKeyDown={(e) => { if (e.key === "Enter") setCurrentPage("notifications"); }}
            className="shrink-0 bg-red-600 text-white text-sm font-medium overflow-hidden cursor-pointer hover:bg-red-700 active:bg-red-800 transition-colors"
          >
            <div className="flex items-center h-8">
              <span className="shrink-0 px-3 bg-red-800 text-[11px] font-bold uppercase tracking-wider h-full flex items-center gap-1.5 z-10 relative">
                <span className="inline-block h-2 w-2 rounded-full bg-red-300 animate-pulse" />
                {t("URGENT")}
              </span>
              <div className="relative flex-1 overflow-hidden">
                <div
                  ref={scrollRef}
                  className="urgent-ticker-track flex whitespace-nowrap pointer-events-none"
                  style={{ animation: `urgent-scroll ${Math.max(15, tickerText.length * 0.15)}s linear infinite` }}
                >
                  <span className="px-8">{tickerText}</span>
                  <span className="px-8">{tickerText}</span>
                </div>
              </div>
              <span className="shrink-0 px-3 text-[11px] text-red-200 z-10 relative">
                {t("Click to view")}
              </span>
            </div>
          </div>
        )}
        <header className="flex items-center justify-end px-4 md:px-6 h-12 shrink-0 bg-white border-b border-slate-100 gap-2">
          {fromPoliceApp && (
            <button
              onClick={backToPoliceApp}
              title={t("Back to Police App")}
              aria-label={t("Back to Police App")}
              className="mr-auto flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft className="h-[18px] w-[18px]" />
              <span className="hidden sm:inline">{t("Police App")}</span>
            </button>
          )}
          <LanguageSwitcher />
          <button
            onClick={() => setCurrentPage("notifications")}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            title="Notifications"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4.5 w-4.5 min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <PageRenderer />
        </main>
      </div>
    </div>
  );
}