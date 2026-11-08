"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Search, MapPin, Calendar, Users, X, Filter, Star,
  Phone, Bed, ArrowLeft, CheckCircle2, Loader2, ChevronRight, ChevronDown,
  Wifi, Car, Tv, Coffee, Wind, Snowflake, LogOut, User, Building
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────
interface Room {
  id: string;
  number: string;
  name: string;
  type: string;
  pricePerNight: number;
  pricePerNightWeekend: number | null;
  floor: number;
  capacity: number;
  amenities: string;
  description: string;
  image: string | null;
  providerId: string;
  available: boolean;
  amenitiesList: string[];
}

interface ProviderWithRooms {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  subCity: string | null;
  woreda: string | null;
  latitude: number | null;
  longitude: number | null;
  rooms: Room[];
}

interface GuestUser {
  id: string; name: string; phone: string;
}

// Bishoftu sub-cities (matches src/lib/bishoftu-divisions.ts)
const SUB_CITIES = ["Debaayyuu", "Chalaleka", "Xxulaa"];

const ROOM_TYPES = [
  "SINGLE", "DOUBLE", "TWIN", "SUITE", "DELUXE", "KING", "STANDARD",
  "STANDARD_SUITE", "JUNIOR_SUITE", "EXECUTIVE_SUITE", "PRESIDENTIAL_SUITE"
];

// ── Helper: get today's date + tomorrow's date (for default date range) ──
function todayStr(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ── Helper: fetch with no auth needed ──
async function fetchPublic<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

// ── Main component ───────────────────────────────────────────────────
export function RoomSearchPage() {
  const { t, i18n } = useTranslation("findApp");
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<"search" | "reservations">("search");
  const [guest, setGuest] = useState<GuestUser | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Check if guest is logged in (cookie exists)
  useEffect(() => {
    if (!mounted) return;
    // Check URL param for tab
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam === "reservations") setTab("reservations");
  }, [mounted]);

  if (!mounted) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-sky-50">
        <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-sky-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-gradient-to-r from-sky-600 to-cyan-600 text-white shadow-lg shadow-sky-600/20">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <Bed className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight">{t("appName")}</h1>
                <p className="text-[11px] text-sky-100 leading-tight">{t("tagline")}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Language switcher */}
              <button
                onClick={() => i18n.changeLanguage(i18n.language === "am" ? "en" : "am")}
                className="flex h-8 items-center gap-1 rounded-lg bg-white/15 px-2.5 text-xs font-medium backdrop-blur transition hover:bg-white/25"
              >
                <span>{i18n.language === "am" ? "EN" : "አማ"}</span>
              </button>

              {/* Guest auth / profile */}
              {guest ? (
                <div className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 backdrop-blur">
                  <User className="h-4 w-4" />
                  <span className="text-xs font-medium">{guest.name}</span>
                  <button
                    onClick={() => {
                      document.cookie = "ghms_guest_token=; Max-Age=0; path=/;";
                      setGuest(null);
                      setTab("search");
                    }}
                    className="ml-1 text-sky-100 hover:text-white"
                    title={t("nav.signOut")}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <GuestLoginButton t={t} onLogin={setGuest} />
              )}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="mx-auto max-w-5xl px-4 pb-2">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("search")}
              className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                tab === "search" ? "bg-white text-sky-700 shadow-sm" : "bg-white/15 text-white backdrop-blur hover:bg-white/25"
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              {t("nav.search")}
            </button>
            <button
              onClick={() => setTab("reservations")}
              className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                tab === "reservations" ? "bg-white text-sky-700 shadow-sm" : "bg-white/15 text-white backdrop-blur hover:bg-white/25"
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              {t("nav.reservations")}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 py-4 pb-20">
        {tab === "search" ? (
          <SearchTab t={t} guest={guest} onLoginRequired={() => {}} />
        ) : (
          <ReservationsTab t={t} guest={guest} />
        )}
      </main>
    </div>
  );
}

// ── Guest Login Button (triggers OTP flow) ────────────────────────────
function GuestLoginButton({ t, onLogin }: {
  t: (key: string, opts?: any) => string;
  onLogin: (user: GuestUser) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-xs font-semibold text-sky-700 shadow-sm transition hover:bg-sky-50"
      >
        <User className="h-3.5 w-3.5" />
        {t("nav.signIn")}
      </button>
      {open && (
        <GuestLoginSheet t={t} onClose={() => setOpen(false)} onLogin={(u) => { onLogin(u); setOpen(false); }} />
      )}
    </>
  );
}

// ── Guest Login Sheet (phone → OTP → verify) ─────────────────────────
function GuestLoginSheet({ t, onClose, onLogin }: {
  t: (key: string, opts?: any) => string;
  onClose: () => void;
  onLogin: (user: GuestUser) => void;
}) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [devOtp, setDevOtp] = useState("");

  const sendOtp = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/guest-auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send OTP");
      if (data.otp) setDevOtp(data.otp);
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP");
    } finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/guest-auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      onLogin(data.guest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            {step === "phone" ? t("auth.title") : t("auth.otpTitle")}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 border border-red-200">
            {error}
          </div>
        )}

        {step === "phone" ? (
          <>
            <p className="mb-4 text-sm text-slate-600">{t("auth.subtitle")}</p>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("auth.phoneLabel")}</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("auth.phonePlaceholder")}
              className="mb-4 h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
            />
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("auth.nameLabel")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("auth.namePlaceholder")}
              className="mb-4 h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
            />
            <button
              onClick={sendOtp}
              disabled={loading || !phone.trim()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 transition hover:bg-sky-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t("auth.sendOtp")}</>}
            </button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600">
              {t("auth.otpSubtitle", { phone })}
            </p>
            {devOtp && (
              <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 border border-amber-200">
                {t("auth.devOtpNote", { otp: devOtp })}
              </div>
            )}
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("auth.otpLabel")}</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder={t("auth.otpPlaceholder")}
              className="mb-4 h-14 w-full rounded-xl border border-slate-200 px-4 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
            />
            <button
              onClick={verifyOtp}
              disabled={loading || code.length !== 6}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 transition hover:bg-sky-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t("auth.verifyOtp")}</>}
            </button>
            <button
              onClick={() => setStep("phone")}
              className="mt-3 flex h-10 w-full items-center justify-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("auth.back")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Search Tab ────────────────────────────────────────────────────────
function SearchTab({ t, guest, onLoginRequired }: {
  t: (key: string, opts?: any) => string;
  guest: GuestUser | null;
  onLoginRequired: () => void;
}) {
  // No date filtering on search tab — guests browse all rooms.
  // Dates are picked only when requesting a booking (in the room detail sheet).
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [roomType, setRoomType] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [subCity, setSubCity] = useState("");

  const [providers, setProviders] = useState<ProviderWithRooms[]>([]);
  const [totalRooms, setTotalRooms] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<{ room: Room; provider: ProviderWithRooms } | null>(null);

  const search = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      // Note: checkIn/checkOut NOT sent — search tab doesn't filter by date.
      // Availability filtering happens in the room detail sheet when booking.
      if (roomType) params.set("roomType", roomType);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);
      if (subCity) params.set("subCity", subCity);
      const data = await fetchPublic<{
        providers: ProviderWithRooms[];
        totalProviders: number;
        totalRooms: number;
      }>(`/api/public/rooms/search?${params}`);
      setProviders(data?.providers || []);
      setTotalRooms(data?.totalRooms || 0);
    } catch (e) {
      setError(t("errors.searchFailed"));
      setProviders([]);
      setTotalRooms(0);
    } finally { setLoading(false); }
  }, [roomType, minPrice, maxPrice, subCity, t]);

  // Auto-search on mount
  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      {/* Search bar — no check-in/check-out dates, only filters */}
      <div className="mb-4 rounded-2xl bg-white p-3 shadow-sm border border-slate-100">
        {/* Filters row (always visible now — no toggle needed since they're compact) */}
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-600">{t("search.roomType")}</label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">{t("search.allTypes")}</option>
              {ROOM_TYPES.map((rt) => (
                  <option key={rt} value={rt}>{t(`roomTypes.${rt}`)}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">{t("search.minPrice")}</label>
                <input
                  type="number"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="0"
                  className="h-10 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">{t("search.maxPrice")}</label>
                <input
                  type="number"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="5000"
                  className="h-10 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-sky-500"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">{t("search.subCity")}</label>
              <select
                value={subCity}
                onChange={(e) => setSubCity(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">{t("search.allSubCities")}</option>
                {SUB_CITIES.map((sc) => (
                  <option key={sc} value={sc}>{t(`subCities.${sc}`)}</option>
                ))}
              </select>
            </div>
          </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={search}
            disabled={loading}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t("search.searchButton")}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Results header — artistic gradient banner */}
      <div className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600 via-sky-700 to-cyan-700 p-4 text-white shadow-lg shadow-sky-600/20">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 text-base font-bold">
              <Building className="h-4 w-4 shrink-0" />
              <span className="truncate">All guesthouses in Bishoftu</span>
            </h2>
            <p className="mt-1 text-[11px] text-sky-100">
              {loading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("search.loading")}
                </span>
              ) : (
                <>
                  <span className="font-bold text-white">{providers.length}</span> guesthouses
                  <span className="mx-1.5 text-sky-300">•</span>
                  <span className="font-bold text-white">{totalRooms}</span> rooms
                </>
              )}
            </p>
          </div>
          {!loading && providers.length > 0 && (
            <div className="shrink-0 text-right">
              <div className="text-2xl font-extrabold leading-none">{providers.length}</div>
              <div className="text-[9px] uppercase tracking-wider text-sky-200">listed</div>
            </div>
          )}
        </div>
        {/* Decorative wave at the bottom */}
        <svg
          className="mt-2 h-1.5 w-full text-sky-300/30"
          viewBox="0 0 100 4"
          preserveAspectRatio="none"
        >
          <path d="M0,2 Q25,0 50,2 T100,2" stroke="currentColor" strokeWidth="0.5" fill="none" />
        </svg>
      </div>

      {/* Hint — let guest know dates are picked at booking time */}
      {!loading && providers.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2 text-[11px] text-amber-900 ring-1 ring-amber-200/60">
          <span className="shrink-0 text-base leading-none">💡</span>
          <span>
            Tap a guesthouse below to see its rooms. Pick check-in + check-out dates when booking.
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center border border-slate-100">
          <Bed className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-sm text-slate-500">{t("search.noResults")}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {providers.map((provider) => (
            <ProviderSection
              key={provider.id}
              provider={provider}
              t={t}
              onSelectRoom={(room) => setSelectedRoom({ room, provider })}
            />
          ))}
        </div>
      )}

      {/* Room detail sheet — picks its own dates inside */}
      {selectedRoom && (
        <RoomDetailSheet
          room={selectedRoom.room}
          provider={selectedRoom.provider}
          t={t}
          guest={guest}
          onClose={() => setSelectedRoom(null)}
          onLoginRequired={onLoginRequired}
          onBooked={() => { setSelectedRoom(null); }}
        />
      )}
    </div>
  );
}

// ── Provider Section (group of rooms under one guesthouse) ───────────
function ProviderSection({ provider, t, onSelectRoom }: {
  provider: ProviderWithRooms;
  t: (key: string, opts?: any) => string;
  onSelectRoom: (room: Room) => void;
}) {
  const availableCount = provider.rooms.filter(r => r.available).length;
  const allAvailable = availableCount === provider.rooms.length;
  const someBooked = availableCount < provider.rooms.length;
  // Collapsed by default — guest taps the provider header to expand.
  const [collapsed, setCollapsed] = useState(true);

  // Generate a deterministic gradient pair based on provider id — gives
  // each guesthouse its own "color identity" while staying on-brand.
  const gradients = [
    "from-sky-500 via-sky-600 to-cyan-600",
    "from-indigo-500 via-indigo-600 to-violet-600",
    "from-emerald-500 via-emerald-600 to-teal-600",
    "from-amber-500 via-orange-500 to-rose-500",
    "from-fuchsia-500 via-purple-500 to-indigo-600",
    "from-cyan-500 via-blue-500 to-indigo-600",
    "from-rose-500 via-pink-500 to-fuchsia-600",
    "from-lime-500 via-emerald-500 to-teal-600",
  ];
  const gradientIdx = provider.id
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0) % gradients.length;
  const gradient = gradients[gradientIdx];

  // First letter of name for the avatar bubble.
  const initial = (provider.name || "?").trim().charAt(0).toUpperCase();

  return (
    <div
      className="group relative overflow-hidden rounded-3xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/60 transition-all duration-300 hover:shadow-[0_12px_32px_rgba(14,165,233,0.18)] hover:ring-sky-300/60"
      style={{ borderRadius: 24 }}
    >
      {/* Decorative top accent — colored bar that signals "tap me" */}
      <div className={`h-1.5 w-full bg-gradient-to-r ${gradient}`} />

      {/* Provider header — tap to expand/collapse */}
      <div
        className="relative cursor-pointer select-none p-4 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {/* Soft glow background on hover */}
        <div
          className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-[0.04]`}
        />

        <div className="relative flex items-start gap-3.5">
          {/* Avatar bubble with gradient + initial letter */}
          <div className="relative shrink-0">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-base font-extrabold text-white shadow-lg shadow-slate-900/10 ring-2 ring-white`}
            >
              {initial}
            </div>
            {/* Availability dot — green when all available, amber when some booked */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm ${
                allAvailable ? "bg-emerald-500" : someBooked ? "bg-amber-500" : "bg-slate-400"
              }`}
              title={
                allAvailable ? "All rooms available" :
                someBooked ? `${availableCount} of ${provider.rooms.length} available` :
                "No rooms available"
              }
            />
          </div>

          {/* Name + address + meta */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold leading-tight text-slate-900">
              {provider.name}
            </h3>

            {/* Address line with sub-city chip */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="flex items-center gap-0.5 text-slate-600">
                <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                <span className="truncate max-w-[140px]">
                  {provider.address || "Bishoftu"}
                </span>
              </span>
              {provider.subCity && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  {t(`subCities.${provider.subCity}`, { defaultValue: provider.subCity })}
                </span>
              )}
            </div>

            {/* Stats row: rooms + availability + tap hint */}
            <div className="mt-2 flex items-center gap-2 text-[10px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                <Bed className="h-2.5 w-2.5" />
                {provider.rooms.length} rooms
              </span>
              {allAvailable ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  All available
                </span>
              ) : someBooked ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {availableCount} available
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700 ring-1 ring-red-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Fully booked
                </span>
              )}
            </div>

            {/* Tap hint — appears subtly, bold on hover */}
            <p className="mt-2 text-[10px] font-medium text-slate-400 transition-colors group-hover:text-sky-600">
              {collapsed ? "▸ Tap to view rooms" : "▴ Tap to hide"}
            </p>
          </div>

          {/* Right column: call button + chevron */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <a
              href={`tel:${provider.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="group/call flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30 transition-all hover:scale-105 hover:shadow-lg active:scale-95"
              title={`Call ${provider.phone}`}
              aria-label={`Call ${provider.phone}`}
            >
              <Phone className="h-4 w-4" />
            </a>
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-all duration-300 group-hover:bg-sky-100 group-hover:text-sky-600 ${
                collapsed ? "" : "rotate-90"
              }`}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
      </div>

      {/* Rooms list (under this provider) — shown only when expanded */}
      {!collapsed && (
        <div
          className="border-t border-dashed border-slate-200 bg-gradient-to-b from-slate-50/50 to-white"
          style={{
            animation: "ghms-provider-expand 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Small "Rooms" subheader */}
          <div className="px-4 pt-3 pb-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
              {provider.rooms.length} {provider.rooms.length === 1 ? "Room" : "Rooms"} Available
            </p>
          </div>
          <div className="divide-y divide-slate-100/80">
            {provider.rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                t={t}
                onViewDetails={() => onSelectRoom(room)}
              />
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes ghms-provider-expand {
          0% { opacity: 0; transform: translateY(-8px); max-height: 0; }
          100% { opacity: 1; transform: translateY(0); max-height: 5000px; }
        }
      `}</style>
    </div>
  );
}

// ── Room Card (single room row — no provider info, that's in the section header) ────
function RoomCard({ room, t, onViewDetails }: {
  room: Room;
  t: (key: string, opts?: any) => string;
  onViewDetails: () => void;
}) {
  const priceDisplay = new Intl.NumberFormat("en-US").format(room.pricePerNight);
  const roomTypeLabel = t(`roomTypes.${room.type}`, { defaultValue: room.type });

  return (
    <div
      onClick={onViewDetails}
      className="group/room relative cursor-pointer px-4 py-3 transition-all duration-200 hover:bg-gradient-to-r hover:from-sky-50/80 hover:to-transparent"
    >
      <div className="flex items-center gap-3">
        {/* Image / placeholder — with shimmer effect on hover */}
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl shadow-sm ring-1 ring-slate-200/80">
          {room.image ? (
            <img
              src={room.image}
              alt={room.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover/room:scale-110"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sky-100 via-cyan-50 to-sky-100">
              <Bed className="h-5 w-5 text-sky-400" />
            </div>
          )}
          {/* Availability ribbon — top-left corner */}
          {room.available ? (
            <span className="absolute top-0 left-0 rounded-br-lg bg-emerald-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm backdrop-blur">
              ✓
            </span>
          ) : (
            <span className="absolute top-0 left-0 rounded-br-lg bg-red-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm backdrop-blur">
              ✕
            </span>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="truncate text-[13px] font-semibold text-slate-900 group-hover/room:text-sky-700 transition-colors">
              {room.name}
            </h4>
            <div className="shrink-0 text-right">
              <span className="text-[13px] font-bold text-sky-600">
                {priceDisplay}
              </span>
              <span className="ml-0.5 text-[9px] text-slate-400">/night</span>
            </div>
          </div>

          <p className="mt-0.5 text-[10px] text-slate-500">
            <span className="font-medium text-slate-600">{roomTypeLabel}</span>
            <span className="mx-1 text-slate-300">•</span>
            {t("roomCard.floor", { floor: room.floor })}
          </p>

          {/* Capacity + amenities chips */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px]">
            <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
              <Users className="h-2.5 w-2.5" />
              {t("roomCard.capacity", { count: room.capacity })}
            </span>
            {room.amenitiesList.slice(0, 2).map((a, i) => (
              <span
                key={i}
                className="rounded-md bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700 ring-1 ring-sky-100"
              >
                {a}
              </span>
            ))}
          </div>
        </div>

        {/* Chevron — slides right on hover */}
        <div className="flex shrink-0 items-center pr-1">
          <div className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-all duration-200 group-hover/room:bg-sky-100 group-hover/room:text-sky-600 group-hover/room:translate-x-0.5">
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Room Detail Sheet ────────────────────────────────────────────────
function RoomDetailSheet({ room, provider, t, guest, onClose, onLoginRequired, onBooked }: {
  room: Room;
  provider: ProviderWithRooms;
  t: (key: string, opts?: any) => string;
  guest: GuestUser | null;
  onClose: () => void;
  onLoginRequired: () => void;
  onBooked: () => void;
}) {
  // Dates are picked INSIDE the detail sheet (not on the search tab).
  // Default: tomorrow → day after tomorrow (1 night).
  const [checkIn, setCheckIn] = useState(todayStr(1));
  const [checkOut, setCheckOut] = useState(todayStr(2));
  const [booking, setBooking] = useState(false);
  const [guestNotes, setGuestNotes] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Calculate nights + total
  const { nights, total, hasWeekend } = useMemo(() => {
    if (!checkIn || !checkOut) return { nights: 0, total: 0, hasWeekend: false };
    const ci = new Date(checkIn + "T00:00:00");
    const co = new Date(checkOut + "T00:00:00");
    const n = Math.max(1, Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24)));
    let tot = 0; let weekend = false;
    for (let i = 0; i < n; i++) {
      const d = new Date(ci); d.setDate(d.getDate() + i);
      const dow = d.getDay();
      if ((dow === 5 || dow === 6) && room.pricePerNightWeekend && room.pricePerNightWeekend > 0) {
        tot += room.pricePerNightWeekend; weekend = true;
      } else {
        tot += room.pricePerNight;
      }
    }
    return { nights: n, total: tot, hasWeekend: weekend };
  }, [checkIn, checkOut, room]);

  const book = async () => {
    if (!guest) { onLoginRequired(); return; }
    setBooking(true); setError("");
    try {
      const res = await fetch("/api/public/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id, checkIn, checkOut, guestNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      setSuccess(true);
      setTimeout(onBooked, 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally { setBooking(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero image */}
        <div className="relative h-48 bg-gradient-to-br from-sky-200 to-cyan-200">
          {room.image && <img src={room.image} alt={room.name} className="h-full w-full object-cover" />}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="absolute bottom-3 left-3 right-3">
            <h2 className="text-xl font-bold text-white drop-shadow">{room.name}</h2>
            <p className="text-sm text-white/90 drop-shadow">
              {t(`roomTypes.${room.type}`)} · {t("roomCard.floor", { floor: room.floor })}
            </p>
          </div>
        </div>

        <div className="p-4">
          {success ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
              <h3 className="mb-1 text-lg font-bold text-slate-900">{t("booking.success")}</h3>
              <p className="text-sm text-slate-600">{t("booking.successMessage")}</p>
            </div>
          ) : (
            <>
              {/* Guesthouse info */}
              <div className="mb-3 rounded-xl bg-sky-50 p-3 border border-sky-100">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-sky-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{provider.name}</p>
                    <p className="text-[11px] text-slate-600">
                      {provider.address || "Bishoftu"}
                      {provider.subCity && ` · ${t(`subCities.${provider.subCity}`, { defaultValue: provider.subCity })}`}
                    </p>
                  </div>
                  <a
                    href={`tel:${provider.phone}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm border border-sky-200"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                </div>
              </div>

              {/* Description */}
              {room.description && (
                <div className="mb-3">
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t("detail.description")}</h3>
                  <p className="text-sm text-slate-700">{room.description}</p>
                </div>
              )}

              {/* Amenities */}
              {room.amenitiesList.length > 0 && (
                <div className="mb-3">
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{t("detail.amenities")}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {room.amenitiesList.map((a, i) => (
                      <span key={i} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Booking box */}
              <div className="rounded-xl border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-bold text-slate-900">{t("booking.title")}</h3>

                {/* Date pickers — guest picks check-in + check-out here */}
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">{t("search.checkIn")}</label>
                    <input
                      type="date"
                      value={checkIn}
                      min={todayStr(0)}
                      onChange={(e) => {
                        setCheckIn(e.target.value);
                        // Auto-fix check-out if it's now invalid (before check-in)
                        if (checkOut && e.target.value >= checkOut) {
                          const next = new Date(e.target.value + "T00:00:00");
                          next.setDate(next.getDate() + 1);
                          setCheckOut(next.toISOString().slice(0, 10));
                        }
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">{t("search.checkOut")}</label>
                    <input
                      type="date"
                      value={checkOut}
                      min={checkIn || todayStr(1)}
                      onChange={(e) => setCheckOut(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div className="mb-2 flex items-center gap-2 text-xs text-slate-600">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="ml-auto font-semibold text-slate-900">{t("booking.nights", { count: nights })}</span>
                </div>

                {hasWeekend && (
                  <p className="mb-2 text-[11px] text-amber-700">{t("detail.weekendRate")}</p>
                )}

                <div className="mb-3 flex items-center justify-between border-t border-slate-100 pt-2">
                  <span className="text-xs text-slate-500">{t("booking.totalCost")}</span>
                  <span className="text-lg font-bold text-sky-600">
                    {new Intl.NumberFormat("en-US").format(total)} ETB
                  </span>
                </div>

                <label className="mb-1 block text-[11px] font-medium text-slate-700">{t("booking.guestNotes")}</label>
                <textarea
                  value={guestNotes}
                  onChange={(e) => setGuestNotes(e.target.value)}
                  placeholder={t("booking.guestNotesPlaceholder")}
                  rows={2}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                />

                {error && (
                  <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 border border-red-200">
                    {error}
                  </div>
                )}

                <button
                  onClick={book}
                  disabled={booking || !room.available}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 transition hover:bg-sky-700 disabled:opacity-50"
                >
                  {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    guest ? t("booking.submitButton") : t("booking.signInButton")
                  )}
                </button>
                {!guest && (
                  <p className="mt-2 text-center text-[11px] text-slate-500">{t("booking.needLogin")}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reservations Tab ─────────────────────────────────────────────────
function ReservationsTab({ t, guest }: {
  t: (key: string, opts?: any) => string;
  guest: GuestUser | null;
}) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!guest) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch("/api/my-reservations", { credentials: "include" });
        const data = await res.json();
        if (res.ok) setReservations(data.reservations || []);
        else setError(data.error || "Failed to load");
      } catch (e) {
        setError("Failed to load");
      } finally { setLoading(false); }
    })();
  }, [guest]);

  if (!guest) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center border border-slate-100">
        <User className="mx-auto mb-3 h-12 w-12 text-slate-300" />
        <p className="mb-4 text-sm text-slate-600">{t("booking.needLogin")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">{error}</div>;
  }

  if (reservations.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center border border-slate-100">
        <Calendar className="mx-auto mb-3 h-12 w-12 text-slate-300" />
        <p className="mb-4 text-sm text-slate-600">{t("reservations.empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reservations.map((r) => (
        <ReservationCard key={r.id} reservation={r} t={t} />
      ))}
    </div>
  );
}

function ReservationCard({ reservation: r, t }: {
  reservation: any;
  t: (key: string, opts?: any) => string;
}) {
  const statusColors: Record<string, string> = {
    UPCOMING: "bg-amber-100 text-amber-800 border-amber-200",
    ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
    COMPLETED: "bg-slate-100 text-slate-700 border-slate-200",
    CANCELLED: "bg-red-100 text-red-700 border-red-200",
    DELETED: "bg-slate-100 text-slate-500 border-slate-200",
  };
  const statusKey = r.status in statusColors ? r.status : "UPCOMING";

  const bookedDate = new Date(r.createdAt).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900">{r.room?.name || "Room"}</h3>
          <p className="text-[11px] text-slate-500">{r.room?.provider?.name}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColors[statusKey]}`}>
          {t(`reservations.status.${statusKey}`)}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs text-slate-600">
        <Calendar className="h-3.5 w-3.5 text-slate-400" />
        <span>{r.checkIn} → {r.checkOut}</span>
        <span className="text-slate-400">·</span>
        <span>{t("reservations.nights", { count: r.nights })}</span>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <div>
          <p className="text-[11px] text-slate-500">{t("reservations.total")}</p>
          <p className="text-base font-bold text-slate-900">
            {new Intl.NumberFormat("en-US").format(r.totalCost)} ETB
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-500">{t("reservations.paymentStatus." + r.paymentStatus, { defaultValue: r.paymentStatus })}</p>
          {r.balance > 0 && (
            <p className="text-[11px] text-amber-700">{t("reservations.balance")}: {new Intl.NumberFormat("en-US").format(r.balance)} ETB</p>
          )}
        </div>
      </div>

      <p className="mt-2 text-[10px] text-slate-400">{t("reservations.bookedAt", { date: bookedDate })}</p>

      {r.notes && r.notes !== "Booked via Bishoftu Rooms app" && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
          <p className="font-medium text-slate-700">{t("reservations.yourNotes")}:</p>
          <p>{r.notes}</p>
        </div>
      )}
    </div>
  );
}
