"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import { apiDashboard, apiGetEodReport, apiGetShiftHandover, apiGetHousekeeping } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, TrendingDown, CalendarCheck, CalendarX, DollarSign, Wrench,
  RefreshCw, FileText, AlertTriangle, CheckCircle2, Clock, ArrowRight,
  BedDouble, DoorOpen, Users,
} from "lucide-react";

interface DashboardData {
  roomsByStatus: Record<string, number>;
  totalRooms: number;
  activeReservations: number;
  todayCheckins: number;
  todayCheckouts: number;
  totalRevenue: number;
  occupancyRate: number;
  revenueLast7Days?: { day: string; date: string; amount: number }[];
}

interface EodReport {
  id: string;
  reportDate: string;
  openingCash: number;
  cashPayments: number;
  telebirrPayments: number;
  cbePayments: number;
  cardPayments: number;
  totalPayments: number;
  expectedCash: number;
  countedCash: number;
  discrepancy: number;
  signedOffAt: string | null;
}

interface ShiftHandover {
  id: string;
  shiftDate: string;
  shiftType: string;
  staffStartId: string;
  openingCash: number;
  closingCash: number | null;
  discrepancy: number;
  handoverNotes: string;
  startedAt: string;
  endedAt: string | null;
}

interface HousekeepingTask {
  id: string;
  roomId: string;
  type: string;
  status: string;
  priority?: string;
  notes: string;
  createdAt: string;
  assignedTo: string | null;
  room?: { id: string; number: string; name: string };
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

export default function OwnerOverviewPage() {
  const { t } = useTranslation("dashboard");
  const { refreshKey, ownerFeatureFlags, setCurrentPage } = useAppStore();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [eod, setEod] = useState<EodReport | null>(null);
  const [shift, setShift] = useState<ShiftHandover | null>(null);
  const [tickets, setTickets] = useState<HousekeepingTask[]>([]);
  const [loading, setLoading] = useState(true);

  const ownerDashboardEnabled = ownerFeatureFlags?.ownerDashboard !== false;
  const eodEnabled = ownerFeatureFlags?.endOfDayReport !== false;
  const shiftEnabled = ownerFeatureFlags?.shiftHandover !== false;
  const maintenanceEnabled = ownerFeatureFlags?.maintenanceTickets !== false;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const promises: Promise<unknown>[] = [apiDashboard()];

      if (eodEnabled) {
        promises.push(apiGetEodReport().catch(() => null));
      } else {
        promises.push(Promise.resolve(null));
      }
      if (shiftEnabled) {
        promises.push(apiGetShiftHandover().catch(() => null));
      } else {
        promises.push(Promise.resolve(null));
      }
      if (maintenanceEnabled) {
        promises.push(apiGetHousekeeping("type=MAINTENANCE&limit=10").catch(() => null));
      } else {
        promises.push(Promise.resolve(null));
      }

      const [dashRes, eodRes, shiftRes, ticketsRes] = await Promise.all(promises);
      setDashboard(dashRes as DashboardData);
      setEod((eodRes as { report?: EodReport } | null)?.report || null);
      const shiftData = shiftRes as { current?: ShiftHandover } | null;
      setShift(shiftData?.current || null);
      const ticketsData = ticketsRes as { tasks?: HousekeepingTask[] } | null;
      setTickets(ticketsData?.tasks || []);
    } catch (err: unknown) {
      console.error("[owner-overview] fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }, [eodEnabled, shiftEnabled, maintenanceEnabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    );
  }

  const alerts: { level: "crit" | "warn" | "info"; title: string; desc: string }[] = [];

  // Build alerts based on data
  if (dashboard) {
    if (dashboard.todayCheckins === 0 && dashboard.activeReservations === 0) {
      alerts.push({ level: "warn", title: "No active stays", desc: "No guests currently in-house or expected today" });
    }
    if (dashboard.roomsByStatus?.MAINTENANCE > 0) {
      alerts.push({ level: "info", title: `${dashboard.roomsByStatus.MAINTENANCE} room(s) under maintenance`, desc: "Out of service — not bookable" });
    }
  }
  if (eod && eod.signedOffAt === null) {
    alerts.push({ level: "warn", title: "End-of-Day report not signed off", desc: `Expected cash: ${fmt(eod.expectedCash)} ETB — sign off to close the day` });
  }
  if (tickets.length > 0) {
    const aging = tickets.filter((tk) => isAging(tk.createdAt, tk.status)).length;
    if (aging > 0) {
      alerts.push({ level: "crit", title: `${aging} aging maintenance ticket(s)`, desc: "Open for more than 3 days — needs attention" });
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page Title */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-indigo-600" />
            {t("ownerOverviewTitle", { defaultValue: "Owner Overview" })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("ownerOverviewSubtitle", { defaultValue: "Real-time view of your guesthouse — KPIs, alerts, shift + maintenance status" })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchData()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t("refresh", { defaultValue: "Refresh" })}
        </Button>
      </div>

      {/* ── KPI Strip (only if ownerDashboard flag is on) ── */}
      {ownerDashboardEnabled && dashboard && (
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800">{t("liveSnapshot", { defaultValue: "Live Snapshot" })}</h2>
            <Badge variant="outline" className="ml-auto text-[10px] text-indigo-600 border-indigo-200 bg-indigo-50">
              {t("live", { defaultValue: "Live" })}
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-indigo-100 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("occupancy", { defaultValue: "Occupancy" })}</p>
              <p className="mt-1 text-xl font-bold text-emerald-700">{dashboard.occupancyRate}%</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {dashboard.roomsByStatus?.OCCUPIED || 0} / {dashboard.totalRooms} rooms
              </p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("revenue", { defaultValue: "Revenue" })}</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{fmt(dashboard.totalRevenue)} <span className="text-xs font-normal text-slate-400">ETB</span></p>
              <p className="text-[10px] text-slate-400 mt-0.5">{t("thisMonth", { defaultValue: "This month" })}</p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("checkinsToday", { defaultValue: "Check-ins Due" })}</p>
              <p className="mt-1 text-xl font-bold text-sky-700">{dashboard.todayCheckins}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{t("arrivalsToday", { defaultValue: "Arrivals today" })}</p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("checkoutsToday", { defaultValue: "Check-outs Due" })}</p>
              <p className="mt-1 text-xl font-bold text-rose-700">{dashboard.todayCheckouts}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{t("departuresToday", { defaultValue: "Departures today" })}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Alerts (only if there are any) ── */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {t("alerts", { defaultValue: "Alerts" })}
              <Badge className="ml-auto bg-amber-100 text-amber-700 hover:bg-amber-100 border-0">{alerts.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  a.level === "crit" ? "border-rose-200 bg-rose-50"
                  : a.level === "warn" ? "border-amber-200 bg-amber-50"
                  : "border-sky-200 bg-sky-50"
                }`}
              >
                {a.level === "crit" ? <AlertTriangle className="h-4 w-4 text-rose-600 mt-0.5" />
                : a.level === "warn" ? <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                : <Clock className="h-4 w-4 text-sky-600 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{a.title}</p>
                  <p className="text-xs text-slate-500">{a.desc}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Two-column layout: EoD + Shift ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* End-of-Day summary (only if flag is on) */}
        {eodEnabled && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  {t("eodSummary", { defaultValue: "End-of-Day" })}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setCurrentPage("owner-eod")} className="gap-1 text-xs">
                  {t("view", { defaultValue: "View" })}
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
              <CardDescription>{new Date().toLocaleDateString()}</CardDescription>
            </CardHeader>
            <CardContent>
              {eod ? (
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-slate-50 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">Cash payments</p>
                      <p className="font-semibold tabular-nums">{fmt(eod.cashPayments)} ETB</p>
                    </div>
                    <div className="rounded-md bg-slate-50 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">Telebirr</p>
                      <p className="font-semibold tabular-nums">{fmt(eod.telebirrPayments)} ETB</p>
                    </div>
                    <div className="rounded-md bg-slate-50 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">CBE Transfer</p>
                      <p className="font-semibold tabular-nums">{fmt(eod.cbePayments)} ETB</p>
                    </div>
                    <div className="rounded-md bg-slate-50 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">Card</p>
                      <p className="font-semibold tabular-nums">{fmt(eod.cardPayments)} ETB</p>
                    </div>
                  </div>
                  <div className="border-t pt-2 flex justify-between">
                    <span className="text-slate-600">Expected cash drawer</span>
                    <span className="font-bold tabular-nums">{fmt(eod.expectedCash)} ETB</span>
                  </div>
                  {eod.signedOffAt ? (
                    <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3" />
                      Signed off at {new Date(eod.signedOffAt).toLocaleTimeString()}
                    </div>
                  ) : (
                    <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-700 flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      Not signed off yet — counted cash not entered
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">{t("noEodData", { defaultValue: "No data for today" })}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Current shift (only if flag is on) */}
        {shiftEnabled && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="h-4 w-4 text-indigo-600" />
                  {t("currentShift", { defaultValue: "Current Shift" })}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setCurrentPage("shift-handover")} className="gap-1 text-xs">
                  {t("view", { defaultValue: "View" })}
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
              <CardDescription>{new Date().toLocaleDateString()}</CardDescription>
            </CardHeader>
            <CardContent>
              {shift ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{shift.shiftType} Shift</p>
                      <p className="text-xs text-slate-500">Started {new Date(shift.startedAt).toLocaleTimeString()}</p>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">
                      {elapsed(shift.startedAt)}
                    </Badge>
                  </div>
                  <div className="rounded-md bg-slate-50 p-2">
                    <p className="text-[10px] text-slate-500 uppercase">Opening cash</p>
                    <p className="font-semibold tabular-nums">{fmt(shift.openingCash)} ETB</p>
                  </div>
                  {shift.handoverNotes && (
                    <div className="rounded-md border-l-2 border-indigo-300 bg-indigo-50/50 p-2">
                      <p className="text-[10px] text-indigo-700 uppercase font-semibold">Previous shift notes</p>
                      <p className="text-xs text-slate-700 italic">"{shift.handoverNotes}"</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <Clock className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">{t("noActiveShift", { defaultValue: "No active shift" })}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => setCurrentPage("shift-handover")}>
                    {t("startShift", { defaultValue: "Start a shift" })}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Maintenance tickets (only if flag is on) ── */}
      {maintenanceEnabled && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-indigo-600" />
                {t("maintenanceTickets", { defaultValue: "Maintenance Tickets" })}
                <Badge variant="outline" className="text-[10px]">{tickets.filter((tk) => tk.status !== "COMPLETED").length} open</Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setCurrentPage("maintenance-tickets")} className="gap-1 text-xs">
                {t("viewAll", { defaultValue: "View All" })}
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {tickets.length === 0 ? (
              <div className="text-center py-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">{t("noTickets", { defaultValue: "No maintenance tickets" })}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tickets.slice(0, 5).map((tk) => {
                  const aging = isAging(tk.createdAt, tk.status);
                  const priority = tk.priority || "MEDIUM";
                  return (
                    <div
                      key={tk.id}
                      className={`flex items-start gap-3 rounded-lg border p-2.5 ${
                        aging ? "border-rose-200 bg-rose-50/40"
                        : tk.status === "COMPLETED" ? "border-slate-200 bg-slate-50/40"
                        : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        priority === "URGENT" || priority === "HIGH" ? "bg-rose-100 text-rose-700"
                        : priority === "MEDIUM" ? "bg-amber-100 text-amber-700"
                        : "bg-sky-100 text-sky-700"
                      }`}>
                        <Wrench className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">Room {tk.room?.number || "?"}</span>
                          {aging && (
                            <Badge className="bg-rose-600 text-white hover:bg-rose-600 text-[9px] px-1.5 py-0">
                              AGING {timeAgo(tk.createdAt)}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 truncate">{tk.notes || "—"}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(tk.createdAt)}{tk.assignedTo ? ` · ${tk.assignedTo}` : ""}</p>
                      </div>
                      <Badge variant="outline" className={`text-[9px] ${
                        tk.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : tk.status === "IN_PROGRESS" ? "bg-sky-50 text-sky-700 border-sky-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        {tk.status === "COMPLETED" ? "Resolved"
                        : tk.status === "IN_PROGRESS" ? "In Progress"
                        : "Open"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Quick stats footer ── */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <DoorOpen className="h-5 w-5 mx-auto text-emerald-600 mb-1" />
            <p className="text-lg font-bold text-slate-900">{dashboard.roomsByStatus?.AVAILABLE || 0}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Available</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <BedDouble className="h-5 w-5 mx-auto text-emerald-700 mb-1" />
            <p className="text-lg font-bold text-slate-900">{dashboard.roomsByStatus?.OCCUPIED || 0}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Occupied</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <CalendarCheck className="h-5 w-5 mx-auto text-sky-600 mb-1" />
            <p className="text-lg font-bold text-slate-900">{dashboard.roomsByStatus?.RESERVED || 0}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Reserved</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
            <Wrench className="h-5 w-5 mx-auto text-amber-600 mb-1" />
            <p className="text-lg font-bold text-slate-900">{dashboard.roomsByStatus?.MAINTENANCE || 0}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Maintenance</p>
          </div>
        </div>
      )}

      {/* ── Link to mobile PWA ── */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
          <Users className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-800">{t("mobileApp", { defaultValue: "Owner Mobile App" })}</p>
          <p className="text-xs text-slate-600">{t("mobileAppDesc", { defaultValue: "Access this dashboard on your phone — optimized for mobile viewing" })}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.open("/owner", "_blank")}>
          {t("open", { defaultValue: "Open" })}
        </Button>
      </div>
    </div>
  );
}
