"use client";

import { useState, useEffect } from "react";
import {
  Phone, X, Shield, HeartPulse, Flame, Ambulance, Siren, AlertTriangle,
  type LucideIcon,
} from "lucide-react";

/**
 * Floating Emergency Call Button
 *
 * Fixed to bottom-left of the screen. Tap to expand and show emergency
 * contacts for Bishoftu city.
 *
 * Contacts are fetched from /api/public/emergency-contacts (configured
 * by the admin in System Config). Falls back to hardcoded defaults
 * (Police 9141, Hospital 5645) if the API fails or returns nothing.
 *
 * Tapping any contact triggers a `tel:` link — on mobile devices this
 * opens the phone dialer; on desktop it's a no-op (or prompts the OS).
 *
 * The button is always visible on all pages (login + authenticated).
 */

interface EmergencyContact {
  id: string;
  type: "police" | "hospital" | "custom";
  label: string;
  labelAm?: string;
  phone: string;
  icon: string;
  color: string;
  sortOrder: number;
}

// Hardcoded fallback — used if API fails (e.g. DB down, network error)
const FALLBACK_CONTACTS: EmergencyContact[] = [
  {
    id: "police",
    type: "police",
    label: "Bishoftu Police",
    labelAm: "የቢሾፍቱ ፖሊስ",
    phone: "9141",
    icon: "shield",
    color: "red",
    sortOrder: 1,
  },
  {
    id: "hospital",
    type: "hospital",
    label: "Bishoftu Hospital",
    labelAm: "የቢሾፍቱ ሆስፒታል",
    phone: "5645",
    icon: "heart-pulse",
    color: "orange",
    sortOrder: 2,
  },
];

// Map icon name (from API) → lucide-react component
const ICON_MAP: Record<string, LucideIcon> = {
  shield: Shield,
  "heart-pulse": HeartPulse,
  flame: Flame,
  ambulance: Ambulance,
  siren: Siren,
  "alert-triangle": AlertTriangle,
  phone: Phone,
};

// Map color name (from API) → gradient + border + text colors
const COLOR_MAP: Record<string, {
  gradient: string;
  border: string;
  text: string;
  subtext: string;
  bg: string;
}> = {
  red: {
    gradient: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
    border: "#fca5a5",
    text: "#991b1b",
    subtext: "#b91c1c",
    bg: "#dc2626",
  },
  orange: {
    gradient: "linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)",
    border: "#fdba74",
    text: "#9a3412",
    subtext: "#c2410c",
    bg: "#ea580c",
  },
  amber: {
    gradient: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
    border: "#fcd34d",
    text: "#92400e",
    subtext: "#b45309",
    bg: "#d97706",
  },
  rose: {
    gradient: "linear-gradient(135deg, #ffe4e6 0%, #fecdd3 100%)",
    border: "#fda4af",
    text: "#9f1239",
    subtext: "#be123c",
    bg: "#e11d48",
  },
  emerald: {
    gradient: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)",
    border: "#6ee7b7",
    text: "#065f46",
    subtext: "#047857",
    bg: "#059669",
  },
  sky: {
    gradient: "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)",
    border: "#7dd3fc",
    text: "#075985",
    subtext: "#0369a1",
    bg: "#0284c7",
  },
  indigo: {
    gradient: "linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)",
    border: "#a5b4fc",
    text: "#3730a3",
    subtext: "#4338ca",
    bg: "#4f46e5",
  },
};

// Cache fetched contacts for 5 minutes (avoids re-fetching on every page)
let cachedContacts: EmergencyContact[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function EmergencyCallButton() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [contacts, setContacts] = useState<EmergencyContact[]>(FALLBACK_CONTACTS);

  // Show on every page — emergency services should always be one tap away
  useEffect(() => {
    setVisible(true);
  }, []);

  // Fetch contacts from API (with caching)
  useEffect(() => {
    if (!visible) return;

    // Use cache if fresh
    if (cachedContacts && Date.now() < cacheExpiry) {
      setContacts(cachedContacts);
      return;
    }

    let cancelled = false;
    fetch("/api/public/emergency-contacts", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.contacts) && data.contacts.length > 0) {
          cachedContacts = data.contacts;
          cacheExpiry = Date.now() + CACHE_TTL_MS;
          setContacts(data.contacts);
        }
      })
      .catch((err) => {
        // Silently fall back to defaults — emergency button must always work
        console.warn("[EmergencyCallButton] Failed to fetch contacts, using fallback:", err);
      });

    return () => { cancelled = true; };
  }, [visible]);

  // Close menu when pressing Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      {/* Expanded menu with emergency contacts */}
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 8,
            background: "white",
            borderRadius: 16,
            boxShadow: "0 10px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid #e5e7eb",
            minWidth: 220,
            maxWidth: 280,
            animation: "ghms-emg-pop 180ms ease-out",
          }}
        >
          <style>{`
            @keyframes ghms-emg-pop {
              from { opacity: 0; transform: translateY(8px) scale(0.95); }
              to   { opacity: 1; transform: translateY(0)   scale(1); }
            }
          `}</style>

          {/* Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 8px",
          }}>
            <span style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}>
              Emergency · Bishoftu
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close emergency menu"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: "#94a3b8",
                borderRadius: 6,
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Render each contact dynamically */}
          {contacts.map((contact) => {
            const IconComp = ICON_MAP[contact.icon] || Phone;
            const colors = COLOR_MAP[contact.color] || COLOR_MAP.sky;
            const displayPhone = contact.phone.startsWith("+")
              ? contact.phone
              : contact.phone;

            return (
              <a
                key={contact.id}
                href={`tel:${contact.phone}`}
                onClick={() => setOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: colors.gradient,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  textDecoration: "none",
                  fontWeight: 600,
                  transition: "transform 120ms ease, box-shadow 120ms ease",
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
              >
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: colors.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  flexShrink: 0,
                }}>
                  <IconComp size={18} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {contact.label}
                  </span>
                  <span style={{
                    fontSize: 12,
                    color: colors.subtext,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}>
                    <Phone size={11} /> Tap to call {displayPhone}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {/* Main FAB button */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close emergency call menu" : "Open emergency call menu"}
        aria-expanded={open}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: open
            ? "linear-gradient(135deg, #475569 0%, #334155 100%)"
            : "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
          color: "white",
          border: "none",
          cursor: "pointer",
          boxShadow: open
            ? "0 4px 12px rgba(0,0,0,0.15)"
            : "0 6px 20px rgba(220,38,38,0.45), 0 2px 6px rgba(220,38,38,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 150ms ease, box-shadow 150ms ease",
          position: "relative",
        }}
        onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {open ? <X size={24} /> : <Phone size={24} />}

        {/* Pulsing ring on the closed button — draws attention */}
        {!open && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "2px solid #dc2626",
              animation: "ghms-emg-pulse 2s ease-out infinite",
              pointerEvents: "none",
            }}
          />
        )}
        <style>{`
          @keyframes ghms-emg-pulse {
            0%   { transform: scale(1);   opacity: 0.7; }
            70%  { transform: scale(1.6); opacity: 0; }
            100% { transform: scale(1.6); opacity: 0; }
          }
        `}</style>
      </button>
    </div>
  );
}
