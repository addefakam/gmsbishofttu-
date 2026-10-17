"use client";

// Force server-rendering on every request so the HTML shell always
// references the latest JS chunk URLs (matches /police-app pattern).
export const dynamic = "force-dynamic";

import "@/i18n/config";

import { useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "@/lib/store";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n/config";
import OwnerApp from "@/components/owner-app/owner-app";
import { OwnerLogin, OwnerRoleError } from "@/components/owner-app/owner-login";

const emptySubscribe = () => () => {};

export default function OwnerAppPage() {
  return (
    <I18nextProvider i18n={i18n}>
      <OwnerAppGate />
    </I18nextProvider>
  );
}

function OwnerAppGate() {
  const { currentUser } = useAppStore();

  // false during SSR + first hydration render, true afterwards.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // Default to English for the owner app (matches police-app convention).
  useEffect(() => {
    if (mounted && i18n && typeof i18n.changeLanguage === "function" && i18n.language !== "en") {
      i18n.changeLanguage("en");
    }
  }, [mounted]);

  if (!mounted) {
    // Light splash — gradient tile + loading shimmer.
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#F6F7FB]">
        <div
          aria-hidden="true"
          className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/25"
        />
        <div className="h-1 w-28 overflow-hidden rounded-full bg-indigo-100">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 to-violet-400" />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <OwnerLogin />;
  }

  // Owner app is accessible to:
  //   - SUPERUSER (both system admin and guesthouse owner — system admin
  //     may want to preview the owner experience)
  //   - OPERATOR (front desk / manager)
  // STAFF + POLICE get the role-error page.
  if (currentUser.role !== "SUPERUSER" && currentUser.role !== "OPERATOR") {
    return <OwnerRoleError />;
  }

  return <OwnerApp user={currentUser} />;
}
