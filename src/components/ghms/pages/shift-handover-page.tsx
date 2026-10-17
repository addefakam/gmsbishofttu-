"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiGetShiftHandover, apiShiftAction } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  Play,
  Square,
  Clock,
  User,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";

interface ShiftHandover {
  id: string;
  shiftDate: string;
  shiftType: string;
  staffStartId: string;
  staffEndId: string | null;
  openingCash: number;
  closingCash: number | null;
  discrepancy: number;
  handoverNotes: string;
  startedAt: string;
  endedAt: string | null;
  signedOffAt: string | null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m ago`;
}

function elapsed(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ShiftHandoverPage() {
  const { t } = useTranslation("dashboard");
  const { refreshKey } = useAppStore();
  const [current, setCurrent] = useState<ShiftHandover | null>(null);
  const [history, setHistory] = useState<ShiftHandover[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // End-shift form state
  const [closingCash, setClosingCash] = useState("");
  const [handoverNotes, setHandoverNotes] = useState("");

  // Start-shift form state (optional opening cash override)
  const [openingCash, setOpeningCash] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetShiftHandover();
      setCurrent(res?.current || null);
      setHistory(Array.isArray(res?.history) ? res.history : []);
      if (res?.current?.openingCash != null) {
        setOpeningCash(String(res.current.openingCash));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("shiftErrorLoad", { defaultValue: "Failed to load shift data" }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const handleStart = async () => {
    setActing(true);
    try {
      const data: { action: "start"; openingCash?: number } = { action: "start" };
      if (openingCash && !isNaN(Number(openingCash))) data.openingCash = Number(openingCash);
      await apiShiftAction(data);
      toast.success(t("shiftStarted", { defaultValue: "Shift started" }));
      await fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("shiftStartFailed", { defaultValue: "Failed to start shift" });
      toast.error(msg);
    } finally {
      setActing(false);
    }
  };

  const handleEnd = async () => {
    if (!closingCash || isNaN(Number(closingCash))) {
      toast.error(t("shiftClosingCashRequired", { defaultValue: "Please enter the counted closing cash" }));
      return;
    }
    setActing(true);
    try {
      await apiShiftAction({
        action: "end",
        closingCash: Number(closingCash),
        handoverNotes,
      });
      toast.success(t("shiftEnded", { defaultValue: "Shift ended + signed off" }));
      setClosingCash("");
      setHandoverNotes("");
      await fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("shiftEndFailed", { defaultValue: "Failed to end shift" });
      toast.error(msg);
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <RefreshCw className="h-6 w-6 text-indigo-600" />
          {t("shiftTitle", { defaultValue: "Shift Handover" })}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("shiftSubtitle", { defaultValue: "Track shift openings, closings, and cash handovers between front desk staff" })}
        </p>
      </div>

      {/* ── Current Shift Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-indigo-600" />
              {t("shiftCurrent", { defaultValue: "Current Shift" })}
            </CardTitle>
            {current ? (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">
                {t("shiftActive", { defaultValue: "Active" })} · {elapsed(current.startedAt)}
              </Badge>
            ) : (
              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 border-0">
                {t("shiftNone", { defaultValue: "No active shift" })}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {current ? (
            <div className="space-y-4">
              {/* Shift details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Started by</p>
                  <p className="text-sm font-semibold">{current.staffStartId}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Started at</p>
                  <p className="text-sm font-semibold">{new Date(current.startedAt).toLocaleTimeString()}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Shift type</p>
                  <p className="text-sm font-semibold">{current.shiftType}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Opening cash</p>
                  <p className="text-sm font-semibold">{fmt(current.openingCash)} ETB</p>
                </div>
              </div>

              {/* End shift form */}
              <div className="border-t pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Square className="h-3.5 w-3.5 text-rose-600" />
                  {t("shiftEndHeader", { defaultValue: "End this shift" })}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="closing-cash" className="text-xs uppercase tracking-wide text-slate-600">
                      {t("shiftClosingCash", { defaultValue: "Counted closing cash" })}
                    </Label>
                    <Input
                      id="closing-cash"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={closingCash}
                      onChange={(e) => setClosingCash(e.target.value)}
                    />
                    {closingCash && !isNaN(Number(closingCash)) && (
                      <p className={`text-xs ${Number(closingCash) >= current.openingCash ? "text-emerald-600" : "text-rose-600"}`}>
                        {Number(closingCash) >= current.openingCash ? (
                          <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />+{fmt(Number(closingCash) - current.openingCash)} ETB</span>
                        ) : (
                          <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3" />{fmt(Number(closingCash) - current.openingCash)} ETB</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="handover-notes" className="text-xs uppercase tracking-wide text-slate-600">
                      {t("shiftHandoverNotes", { defaultValue: "Handover notes for next shift" })}
                    </Label>
                    <Textarea
                      id="handover-notes"
                      placeholder={t("shiftNotesPlaceholder", { defaultValue: "e.g. VIP arriving tomorrow at 6 AM, Room 204 AC still broken, telebirr printer offline" })}
                      value={handoverNotes}
                      onChange={(e) => setHandoverNotes(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
                <Button
                  className="bg-rose-600 hover:bg-rose-700"
                  onClick={handleEnd}
                  disabled={acting || !closingCash}
                >
                  <Square className="h-4 w-4 mr-2" />
                  {acting ? t("shiftEnding", { defaultValue: "Ending shift..." }) : t("shiftEndBtn", { defaultValue: "End shift + sign off" })}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center py-6">
                <User className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">
                  {t("shiftNoActive", { defaultValue: "No shift is currently active. Start a shift to track today's cash flow + handover." })}
                </p>
              </div>
              <div className="border-t pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5 text-emerald-600" />
                  {t("shiftStartHeader", { defaultValue: "Start a new shift" })}
                </h3>
                <div className="space-y-1.5">
                  <Label htmlFor="opening-cash" className="text-xs uppercase tracking-wide text-slate-600">
                    {t("shiftOpeningCash", { defaultValue: "Opening cash in drawer (optional — defaults to last shift's closing)" })}
                  </Label>
                  <Input
                    id="opening-cash"
                    type="number"
                    step="0.01"
                    placeholder={openingCash || "0.00"}
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                  />
                </div>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleStart}
                  disabled={acting}
                >
                  <Play className="h-4 w-4 mr-2" />
                  {acting ? t("shiftStarting", { defaultValue: "Starting shift..." }) : t("shiftStartBtn", { defaultValue: "Start shift" })}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Handovers History ── */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-500" />
              {t("shiftHistory", { defaultValue: "Recent Handovers" })}
            </CardTitle>
            <CardDescription>{t("shiftHistoryDesc", { defaultValue: "Last 14 ended shifts" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Shift</th>
                    <th className="py-2 pr-3">Started</th>
                    <th className="py-2 pr-3">Ended</th>
                    <th className="py-2 pr-3 text-right">Opening</th>
                    <th className="py-2 pr-3 text-right">Closing</th>
                    <th className="py-2 pr-3 text-right">Δ</th>
                    <th className="py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((shift) => {
                    const discrepancy = (shift.closingCash ?? 0) - shift.openingCash;
                    return (
                      <tr key={shift.id} className="border-b last:border-0 hover:bg-slate-50/50">
                        <td className="py-2 pr-3 text-slate-700">{shift.shiftDate}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className="text-[10px]">
                            {shift.shiftType}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-600">
                          {shift.staffStartId.slice(-4)}
                          <div className="text-slate-400">{new Date(shift.startedAt).toLocaleTimeString()}</div>
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-600">
                          {shift.staffEndId?.slice(-4) || "—"}
                          <div className="text-slate-400">{shift.endedAt ? new Date(shift.endedAt).toLocaleTimeString() : "—"}</div>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmt(shift.openingCash)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{shift.closingCash != null ? fmt(shift.closingCash) : "—"}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${discrepancy >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {discrepancy >= 0 ? "+" : ""}{fmt(discrepancy)}
                        </td>
                        <td className="py-2 text-xs text-slate-500 max-w-xs truncate" title={shift.handoverNotes}>
                          {shift.handoverNotes || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
