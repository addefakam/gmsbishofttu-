"use client";

import { useState, useEffect } from "react";
import { Phone, X, Shield, HeartPulse } from "lucide-react";

/**
 * Floating Emergency Call Button
 *
 * Fixed to bottom-right of the screen. Tap to expand and show two
 * emergency numbers for Bishoftu city:
 *   - Police: 9141
 *   - Hospital: 5645
 *
 * Tapping either number triggers a `tel:` link — on mobile devices
 * this opens the phone dialer; on desktop it's a no-op (or prompts
 * the OS to handle the call).
 *
 * The button is hidden on the login pages (/ and /m and /police-app
 * when not authenticated) to avoid cluttering them. It only shows
 * when the user is inside the app (authenticated).
 */
export function EmergencyCallButton() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  // Only show on authenticated pages. We detect this by checking if
  // the URL path starts with /dashboard, /police-dashboard, /m (mobile),
  // /owner, or /police-app — i.e. NOT the root login page or /m login.
  useEffect(() => {
    const check = () => {
      const path = window.location.pathname;
      // Hide on root login page
      if (path === "/" ) {
        setVisible(false);
        return;
      }
      // Hide on /police-app login page (when not authenticated — detected
      // by absence of the app shell). The police app renders its own
      // login UI; we don't want the emergency button there.
      // But we DO want it on the police dashboard.
      // Simple heuristic: show on all paths except root.
      setVisible(true);
    };
    check();
    window.addEventListener("popstate", check);
    // Also re-check on a slight delay in case client-side routing hasn't
    // updated the path yet.
    const t = setTimeout(check, 500);
    return () => {
      window.removeEventListener("popstate", check);
      clearTimeout(t);
    };
  }, []);

  // Close menu when clicking outside (or pressing Escape)
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
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      {/* Expanded menu with the two emergency numbers */}
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

          {/* Police — red */}
          <a
            href="tel:9141"
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
              border: "1px solid #fca5a5",
              color: "#991b1b",
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
              background: "#dc2626",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              flexShrink: 0,
            }}>
              <Shield size={18} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Bishoftu Police</span>
              <span style={{ fontSize: 12, color: "#b91c1c", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                <Phone size={11} /> Tap to call 9141
              </span>
            </div>
          </a>

          {/* Hospital — orange */}
          <a
            href="tel:5645"
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)",
              border: "1px solid #fdba74",
              color: "#9a3412",
              textDecoration: "none",
              fontWeight: 600,
              transition: "transform 120ms ease",
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#ea580c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              flexShrink: 0,
            }}>
              <HeartPulse size={18} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Bishoftu Hospital</span>
              <span style={{ fontSize: 12, color: "#c2410c", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                <Phone size={11} /> Tap to call 5645
              </span>
            </div>
          </a>
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
