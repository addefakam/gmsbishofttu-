"use client";

export const dynamic = "force-dynamic";

import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n/config";
import { RoomSearchPage } from "@/components/find/room-search-page";

export default function FindPage() {
  return (
    <I18nextProvider i18n={i18n}>
      <RoomSearchPage />
    </I18nextProvider>
  );
}
