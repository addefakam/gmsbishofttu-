"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiGetEodReport, apiSignOffEod } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Printer,
  Mail,
  Calendar,
  Clock,
} from "lucide-react";

interface EodReport {
  id: string;
  reportDate: string;
  openingCash: number;
  cashPayments: number;
  cashRefunds: number;
  pettyCashExpenses: number;
  expectedCash: number;
  countedCash: number;
  discrepancy: number;
  telebirrPayments: number;
  cbePayments: number;
  cardPayments: number;
  totalPayments: number;
  checkins: number;
  checkouts: number;
  newReservations: number;
  cancellations: number;
  noShows: number;
  signedOffById: string | null;
  signedOffAt: string | null;
  notes: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function OwnerEodPage() {
  const { t } = useTranslation("dashboard");
  const { refreshKey } = useAppStore();
  const [report, setReport] = useState<EodReport | null>(null);
  const [isDraft, setIsDraft] = useState(true);
  const [loading, setLoading] = useState(true);
  const [signingOff, setSigningOff] = useState(false);
  const [date, setDate] = useState(todayDateStr());
  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");

  const fetchData = useCallback(async (targetDate: string) => {
    setLoading(true);
    try {
      const res = await apiGetEodReport(targetDate);
      if (res?.report) {
        setReport(res.report);
        setIsDraft(res.isDraft !== false);
        setCountedCash(res.report.countedCash ? String(res.report.countedCash) : "");
        setNotes(res.report.notes || "");
      } else {
        setReport(null);
        setIsDraft(true);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("eodErrorLoad", { defaultValue: "Failed to load EoD report" }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData(date);
  }, [fetchData, date, refreshKey]);

  const handleSignOff = async () => {
    if (!countedCash || isNaN(Number(countedCash))) {
      toast.error(t("eodCountedRequired", { defaultValue: "Please enter the counted cash amount" }));
      return;
    }
    setSigningOff(true);
    try {
      const res = await apiSignOffEod({
        reportDate: date,
        countedCash: Number(countedCash),
        notes,
      });
      if (res?.report) {
        setReport(res.report);
        setIsDraft(false);
        toast.success(t("eodSignedOff", { defaultValue: "End-of-Day report signed off" }));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("eodSignOffFailed", { defaultValue: "Failed to sign off report" }));
    } finally {
      setSigningOff(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  const discrepancy = report ? Number(countedCash || 0) - report.expectedCash : 0;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-indigo-600" />
            {t("eodTitle", { defaultValue: "End-of-Day Report" })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("eodSubtitle", { defaultValue: "Daily cash reconciliation + activity summary" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <Input
              type="date"
              value={date}
              max={todayDateStr()}
              onChange={(e) => setDate(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            <span className="hidden sm:inline">{t("eodPrint", { defaultValue: "Print" })}</span>
          </Button>
        </div>
      </div>

      {!report && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto text-amber-500 mb-2" />
            <p className="text-sm text-amber-700">
              {t("eodNoData", { defaultValue: "No data available for this date. Reports can only be generated for past or current dates." })}
            </p>
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          {/* Status banner */}
          {isDraft ? (
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Clock className="h-5 w-5 shrink-0 text-amber-500" />
              <p className="text-sm text-amber-800">
                {t("eodDraftBanner", { defaultValue: "This report is in DRAFT state. Enter the counted cash + sign off to finalize." })}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              <p className="text-sm text-emerald-800">
                {t("eodSignedBanner", { defaultValue: "Signed off" })}
                {report.signedOffAt && (
                  <span className="ml-2 text-emerald-600">
                    {new Date(report.signedOffAt).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Cash reconciliation */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-indigo-600" />
                  {t("eodCashRecon", { defaultValue: "Cash Drawer Reconciliation" })}
                </CardTitle>
                <CardDescription>{t("eodCashReconDesc", { defaultValue: "All amounts in ETB" })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* Payments by method */}
                <div className="rounded-lg bg-slate-50 p-3 mb-3">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                    {t("eodPaymentsByMethod", { defaultValue: "Today's Payments (System)" })}
                  </p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-slate-600">Cash</span><span className="font-semibold tabular-nums">{fmt(report.cashPayments)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">Telebirr</span><span className="font-semibold tabular-nums">{fmt(report.telebirrPayments)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">CBE Transfer</span><span className="font-semibold tabular-nums">{fmt(report.cbePayments)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">Card</span><span className="font-semibold tabular-nums">{fmt(report.cardPayments)}</span></div>
                    <div className="flex justify-between border-t pt-1.5 mt-1.5 font-bold">
                      <span>Total</span><span className="tabular-nums">{fmt(report.totalPayments)}</span>
                    </div>
                  </div>
                </div>

                {/* Drawer calc */}
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-slate-600">Opening balance</span><span className="font-semibold tabular-nums">{fmt(report.openingCash)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">+ Cash payments received</span><span className="font-semibold tabular-nums text-emerald-700">+{fmt(report.cashPayments)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">− Cash refunds issued</span><span className="font-semibold tabular-nums text-rose-700">−{fmt(report.cashRefunds)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">− Petty cash expenses</span><span className="font-semibold tabular-nums text-rose-700">−{fmt(report.pettyCashExpenses)}</span></div>
                  <div className="flex justify-between border-t pt-1.5 mt-1.5">
                    <span className="font-semibold text-emerald-700">= Expected in drawer</span>
                    <span className="font-bold tabular-nums text-emerald-700">{fmt(report.expectedCash)}</span>
                  </div>
                </div>

                {/* Counted cash input */}
                <div className="mt-4 space-y-2">
                  <Label htmlFor="counted-cash" className="text-xs uppercase tracking-wide text-slate-600">
                    {t("eodCountedCash", { defaultValue: "Actual counted cash in drawer" })}
                  </Label>
                  <Input
                    id="counted-cash"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={countedCash}
                    onChange={(e) => setCountedCash(e.target.value)}
                    disabled={!isDraft}
                    className="text-lg font-semibold"
                  />
                  {countedCash !== "" && !isNaN(Number(countedCash)) && (
                    <div className={`rounded-md p-2 text-sm ${
                      Math.abs(discrepancy) < 0.01
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}>
                      <div className="flex justify-between">
                        <span>{discrepancy >= 0 ? "Surplus" : "Shortage"}:</span>
                        <span className="font-bold tabular-nums">
                          {discrepancy >= 0 ? "+" : ""}{fmt(discrepancy)} ETB
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="mt-3 space-y-2">
                  <Label htmlFor="eod-notes" className="text-xs uppercase tracking-wide text-slate-600">
                    {t("eodNotes", { defaultValue: "Notes for owner (optional)" })}
                  </Label>
                  <Textarea
                    id="eod-notes"
                    placeholder={t("eodNotesPlaceholder", { defaultValue: "e.g. Why the cash drawer is short, telebirr receipt not printed, etc." })}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={!isDraft}
                    rows={3}
                  />
                </div>

                {isDraft && (
                  <Button
                    className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700"
                    onClick={handleSignOff}
                    disabled={signingOff || !countedCash}
                  >
                    {signingOff ? (
                      <><Clock className="h-4 w-4 mr-2 animate-spin" />{t("eodSigningOff", { defaultValue: "Signing off..." })}</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-2" />{t("eodSignOff", { defaultValue: "Sign off report" })}</>
                    )}
                  </Button>
                )}
                {!isDraft && (
                  <Button variant="outline" className="w-full mt-2" onClick={() => window.print()}>
                    <Printer className="h-4 w-4 mr-2" />
                    {t("eodPrintPdf", { defaultValue: "Print PDF" })}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Right: Activity summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-4 w-4 text-indigo-600" />
                  {t("eodActivity", { defaultValue: "Today's Activity" })}
                </CardTitle>
                <CardDescription>{report.reportDate}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Check-ins</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-700">{report.checkins}</p>
                  </div>
                  <div className="rounded-lg border border-rose-100 bg-rose-50/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Check-outs</p>
                    <p className="mt-1 text-2xl font-bold text-rose-700">{report.checkouts}</p>
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-sky-50/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">New reservations</p>
                    <p className="mt-1 text-2xl font-bold text-sky-700">{report.newReservations}</p>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Cancellations</p>
                    <p className="mt-1 text-2xl font-bold text-amber-700">{report.cancellations}</p>
                  </div>
                  <div className="rounded-lg border border-rose-100 bg-rose-50/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">No-shows</p>
                    <p className="mt-1 text-2xl font-bold text-rose-700">{report.noShows}</p>
                  </div>
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Total revenue</p>
                    <p className="mt-1 text-xl font-bold text-indigo-700">{fmt(report.totalPayments)}<span className="text-xs font-normal text-slate-400 ml-1">ETB</span></p>
                  </div>
                </div>

                {/* Quick email button (placeholder — auto-email is set up via cron in production) */}
                <div className="mt-4 pt-4 border-t">
                  <Button variant="outline" className="w-full" onClick={() => toast.info(t("eodAutoEmail", { defaultValue: "Auto-email is set up via cron at 23:00. Use Print to manually send now." }))}>
                    <Mail className="h-4 w-4 mr-2" />
                    {t("eodEmailOwner", { defaultValue: "Email report to owner" })}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
