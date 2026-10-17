"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, type CurrentUser } from "@/lib/store";
import { apiDashboard, apiGetEodReport, apiGetShiftHandover, apiGetHousekeeping, apiLogout } from "@/lib/api";
import {
  TrendingUp, AlertTriangle, Clock, RefreshCw, FileText, Wrench,
  CheckCircle2, BedDouble, DoorOpen, CalendarCheck, CalendarX, LogOut,
  ExternalLink,
} from "lucide-react";

interface DashboardData {
  roomsByStatus: Record<string, number>;
  totalRooms: number;
  activeReservations: number;
  todayCheckins: number;
  todayCheckouts: number;
  totalRevenue: number;
  occupancyRate: number;
}

interface EodReport {
  reportDate: string;
  cashPayments: number;
  telebirrPayments: number;
  cbePayments: number;
  cardPayments: number;
  totalPayments: number;
  expectedCash: number;
  signedOffAt: string | null;
}

interface ShiftHandover {
  id: string;
  shiftType: string;
  openingCash: number;
  handoverNotes: string;
  startedAt: string;
  endedAt: string | null;
}

interface HousekeepingTask {
  id: string;
  status: string;
  priority?: string;
  notes: string;
  createdAt: string;
  room?: { number: string; name: string };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function elapsed(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h ago`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m ago`;
}

function isAging(createdAt: string, status: string): boolean {
  if (status === "COMPLETED") return false;
  return (Date.now() - new Date(createdAt).getTime()) / 86400000 > 3;
}

export default function OwnerApp({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const { ownerFeatureFlags } = useAppStore();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [eod, setEod] = useState<EodReport | null>(null);
  const [shift, setShift] = useState<ShiftHandover | null>(null);
  const [tickets, setTickets] = useState<HousekeepingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [dashRes, eodRes, shiftRes, ticketsRes] = await Promise.all([
        apiDashboard().catch(() => null),
        apiGetEodReport().catch(() => null),
        apiGetShiftHandover().catch(() => null),
        apiGetHousekeeping("type=MAINTENANCE&limit=5").catch(() => null),
      ]);
      setDashboard(dashRes as DashboardData);
      setEod((eodRes as { report?: EodReport } | null)?.report || null);
      setShift((shiftRes as { current?: ShiftHandover } | null)?.current || null);
      setTickets((ticketsRes as { tasks?: HousekeepingTask[] } | null)?.tasks || []);
    } catch (err) {
      console.error("[owner-app] fetchData error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch {}
    useAppStore.getState().setCurrentUser(null);
    window.location.href = "/owner";
  };

  const alerts: { level: "crit" | "warn" | "info"; title: string; desc: string }[] = [];
  if (dashboard) {
    if (dashboard.roomsByStatus?.MAINTENANCE > 0) {
      alerts.push({ level: "info", title: `${dashboard.roomsByStatus.MAINTENANCE} room(s) under maintenance`, desc: "Out of service" });
    }
  }
  if (eod && eod.signedOffAt === null) {
    alerts.push({ level: "warn", title: "EoD report not signed off", desc: `Expected cash: ${fmt(eod.expectedCash)} ETB` });
  }
  if (tickets.length > 0) {
    const aging = tickets.filter((tk) => isAging(tk.createdAt, tk.status)).length;
    if (aging > 0) {
      alerts.push({ level: "crit", title: `${aging} aging ticket(s)`, desc: "Open > 3 days" });
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-1 w-28 overflow-hidden rounded-full bg-indigo-100">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 to-violet-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F6F7FB]">
      {/* Header */}
      <header className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 py-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">{t("owner.greeting", { defaultValue: "Welcome back" })}</p>
            <h1 className="text-lg font-bold">{user.name || "Owner"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 active:scale-95"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={handleLogout}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 active:scale-95"
              aria-label="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs opacity-80">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </header>

      <main className="space-y-3 px-4 pt-4 pb-8">
        {/* KPI Grid */}
        {dashboard && (
          <div className="grid grid-cols-2 gap-3">
            <KpiCard
              label={t("owner.occupancy", { defaultValue: "Occupancy" })}
              value={`${dashboard.occupancyRate}%`}
              hint={`${dashboard.roomsByStatus?.OCCUPIED || 0} / ${dashboard.totalRooms} rooms`}
              color="emerald"
              icon={<BedDouble className="h-4 w-4" />}
            />
            <KpiCard
              label={t("owner.revenue", { defaultValue: "Revenue" })}
              value={`${fmt(dashboard.totalRevenue)}`}
              hint="ETB · this month"
              color="slate"
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <KpiCard
              label={t("owner.checkins", { defaultValue: "Check-ins Due" })}
              value={`${dashboard.todayCheckins}`}
              hint="arrivals today"
              color="sky"
              icon={<CalendarCheck className="h-4 w-4" />}
            />
            <KpiCard
              label={t("owner.checkouts", { defaultValue: "Check-outs Due" })}
              value={`${dashboard.todayCheckouts}`}
              hint="departures today"
              color="rose"
              icon={<CalendarX className="h-4 w-4" />}
            />
          </div>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-bold text-slate-800">{t("owner.alerts", { defaultValue: "Alerts" })}</h2>
              <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{alerts.length}</span>
            </div>
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${
                    a.level === "crit" ? "border-rose-200 bg-rose-50"
                    : a.level === "warn" ? "border-amber-200 bg-amber-50"
                    : "border-sky-200 bg-sky-50"
                  }`}
                >
                  <span className="flex-1">
                    <span className="block font-semibold text-slate-800">{a.title}</span>
                    <span className="block text-slate-500">{a.desc}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Room status */}
        {dashboard && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-slate-800">{t("owner.roomStatus", { defaultValue: "Room Status" })}</h2>
            <div className="grid grid-cols-2 gap-2">
              <RoomStatusCard icon={<DoorOpen className="h-4 w-4" />} label="Available" count={dashboard.roomsByStatus?.AVAILABLE || 0} color="emerald" />
              <RoomStatusCard icon={<BedDouble className="h-4 w-4" />} label="Occupied" count={dashboard.roomsByStatus?.OCCUPIED || 0} color="slate" />
              <RoomStatusCard icon={<CalendarCheck className="h-4 w-4" />} label="Reserved" count={dashboard.roomsByStatus?.RESERVED || 0} color="sky" />
              <RoomStatusCard icon={<Wrench className="h-4 w-4" />} label="Maintenance" count={dashboard.roomsByStatus?.MAINTENANCE || 0} color="amber" />
            </div>
          </section>
        )}

        {/* End-of-Day summary */}
        {eod && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-800">{t("owner.eodToday", { defaultValue: "End-of-Day" })}</h2>
              {eod.signedOffAt ? (
                <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Signed off</span>
              ) : (
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Pending</span>
              )}
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Cash</span>
                <span className="font-semibold tabular-nums">{fmt(eod.cashPayments)} ETB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Telebirr</span>
                <span className="font-semibold tabular-nums">{fmt(eod.telebirrPayments)} ETB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">CBE</span>
                <span className="font-semibold tabular-nums">{fmt(eod.cbePayments)} ETB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Card</span>
                <span className="font-semibold tabular-nums">{fmt(eod.cardPayments)} ETB</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1.5">
                <span className="font-semibold text-emerald-700">Expected drawer</span>
                <span className="font-bold tabular-nums text-emerald-700">{fmt(eod.expectedCash)} ETB</span>
              </div>
            </div>
          </section>
        )}

        {/* Current shift */}
        {shift && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-800">{t("owner.currentShift", { defaultValue: "Current Shift" })}</h2>
              <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {elapsed(shift.startedAt)}
              </span>
            </div>
            <div className="text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Type</span>
                <span className="font-semibold">{shift.shiftType}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-slate-500">Opening cash</span>
                <span className="font-semibold tabular-nums">{fmt(shift.openingCash)} ETB</span>
              </div>
              {shift.handoverNotes && (
                <div className="mt-2 rounded-md border-l-2 border-indigo-300 bg-indigo-50/50 p-2">
                  <p className="text-[10px] uppercase font-semibold text-indigo-700">Handover notes</p>
                  <p className="italic text-slate-700">"{shift.handoverNotes}"</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Maintenance tickets */}
        {tickets.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Wrench className="h-4 w-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-800">{t("owner.maintenance", { defaultValue: "Maintenance Tickets" })}</h2>
              <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {tickets.filter((tk) => tk.status !== "COMPLETED").length} open
              </span>
            </div>
            <div className="space-y-2">
              {tickets.slice(0, 5).map((tk) => {
                const aging = isAging(tk.createdAt, tk.status);
                return (
                  <div key={tk.id} className={`rounded-lg border p-2 text-xs ${aging ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">Room {tk.room?.number || "?"}</span>
                      {aging && <span className="rounded-full bg-rose-600 px-1.5 py-0 text-[9px] font-bold text-white">AGING</span>}
                    </div>
                    <p className="text-slate-600">{tk.notes || "—"}</p>
                    <p className="text-[10px] text-slate-400">{timeAgo(tk.createdAt)}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Link to full system */}
        <a
          href="/"
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-medium text-indigo-700 active:scale-[0.98]"
        >
          <ExternalLink className="h-4 w-4" />
          {t("owner.openFullSystem", { defaultValue: "Open Full System" })}
        </a>
      </main>
    </div>
  );
}

function KpiCard({
  label, value, hint, color, icon,
}: {
  label: string; value: string; hint: string;
  color: "emerald" | "slate" | "sky" | "rose"; icon: React.ReactNode;
}) {
  const colorMap = {
    emerald: "text-emerald-700 bg-emerald-50",
    slate: "text-slate-900 bg-slate-50",
    sky: "text-sky-700 bg-sky-50",
    rose: "text-rose-700 bg-rose-50",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${colorMap[color]}`}>{icon}</div>
      </div>
      <p className={`mt-2 text-xl font-bold ${colorMap[color].split(" ")[0]}`}>{value}</p>
      <p className="text-[10px] text-slate-400">{hint}</p>
    </div>
  );
}

function RoomStatusCard({
  icon, label, count, color,
}: {
  icon: React.ReactNode; label: string; count: number;
  color: "emerald" | "slate" | "sky" | "amber";
}) {
  const colorMap = {
    emerald: "text-emerald-700",
    slate: "text-slate-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
      <div className={colorMap[color]}>{icon}</div>
      <div>
        <p className={`text-sm font-bold ${colorMap[color]}`}>{count}</p>
        <p className="text-[10px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}
