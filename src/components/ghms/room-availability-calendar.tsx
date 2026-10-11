"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Loader2, Info } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { apiGetRoomAvailability } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface BookedRange {
  id: string;
  checkIn: string;
  checkOut: string;
  status: string;
  guestName: string;
  guestPhone: string;
}

interface Props {
  roomId?: string;
  checkIn: string;
  checkOut: string;
  onChange: (next: { checkIn: string; checkOut: string }) => void;
  className?: string;
}

// ── Local-time date helpers (dates are "YYYY-MM-DD" strings) ──
function dstr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sdate(s: string): Date {
  return new Date(s + "T00:00:00");
}
function todayLocal(): string {
  return dstr(new Date());
}
function fmtShort(s: string): string {
  if (!s) return "—";
  try {
    return sdate(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return s;
  }
}

/**
 * Real availability calendar for the reservation create dialog.
 *
 * Selection is two-phase on one calendar: click the arrival date, then the
 * departure date. A day is NOT clickable when it cannot serve the active role:
 *
 *  - as ARRIVAL:  past days and occupied nights [checkIn, checkOut) of any
 *    existing reservation are disabled. A previous guest's checkout day
 *    (turnover day) stays open — it is bookable as the new arrival.
 *  - as DEPARTURE: the arrival day itself and any day after the next booking's
 *    arrival are disabled — every night from arrival up to departure must be
 *    free. Departing on the next booking's arrival day is allowed (back-to-back).
 *
 * Occupied days are rendered disabled by react-day-picker, so they cannot be
 * clicked, tapped or keyboard-activated.
 */
export function RoomAvailabilityCalendar({ roomId, checkIn, checkOut, onChange, className }: Props) {
  const { t } = useTranslation("reservations");
  const [availState, setAvailState] = useState<{
    roomId: string; ranges: BookedRange[]; loading: boolean; error: string | null;
  }>({ roomId: "", ranges: [], loading: false, error: null });
  const [phase, setPhase] = useState<"arrival" | "departure">("arrival");
  const [month, setMonth] = useState<Date>(sdate(todayLocal()));
  const [expanded, setExpanded] = useState(false);
  const fetchSeq = useRef(0);

  const today = todayLocal();

  const stale = availState.roomId !== roomId;
  const ranges = stale ? [] : availState.ranges;
  const loading = stale ? !!roomId : availState.loading;
  const loadError = stale ? null : availState.error;

  // Load booked ranges for the selected room
  useEffect(() => {
    if (!roomId) return;
    const seq = ++fetchSeq.current;
    apiGetRoomAvailability(roomId)
      .then((data: { bookedRanges?: BookedRange[] }) => {
        if (seq !== fetchSeq.current) return;
        setAvailState({
          roomId,
          ranges: Array.isArray(data?.bookedRanges) ? data.bookedRanges : [],
          loading: false,
          error: null,
        });
        setMonth(sdate(checkIn || todayLocal()));
        setPhase(checkIn && !checkOut ? "departure" : "arrival");
      })
      .catch((err: unknown) => {
        if (seq !== fetchSeq.current) return;
        setAvailState({
          roomId,
          ranges: [],
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load availability",
        });
      });
  }, [roomId]);

  // Occupied NIGHTS: [checkIn, checkOut) of every booked range.
  // The checkOut day itself is a turnover day — not occupied.
  const occupiedNights = useMemo(() => {
    const set = new Set<string>();
    for (const r of ranges) {
      if (!r.checkIn || !r.checkOut || r.checkOut <= r.checkIn) continue;
      let cursor = sdate(r.checkIn);
      const end = sdate(r.checkOut);
      let guard = 0;
      while (cursor < end && guard < 366) {
        set.add(dstr(cursor));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
        guard++;
      }
    }
    return set;
  }, [ranges]);

  const turnoverDays = useMemo(() => {
    const set = new Set<string>();
    for (const r of ranges) {
      if (r.checkOut && r.checkOut > r.checkIn) set.add(r.checkOut);
    }
    return set;
  }, [ranges]);

  // Next booking that starts at/after the chosen arrival — the departure
  // window ends there (back-to-back departure on that day is allowed).
  const nextArrival = useMemo(() => {
    if (!checkIn) return null;
    const ups = ranges
      .map((r) => r.checkIn)
      .filter((s) => s >= checkIn)
      .sort();
    return ups.length > 0 ? ups[0] : null;
  }, [ranges, checkIn]);

  const arrivalDisabled = useCallback(
    (date: Date) => dstr(date) < today || occupiedNights.has(dstr(date)),
    [occupiedNights, today]
  );

  const departureDisabled = useCallback(
    (date: Date) => {
      const s = dstr(date);
      if (!checkIn) return true;
      if (s <= checkIn) return true;
      if (nextArrival && s > nextArrival) return true;
      return false;
    },
    [checkIn, nextArrival]
  );

  const disabledFn = phase === "arrival" ? arrivalDisabled : departureDisabled;

  const handleSelect = (date: Date | undefined) => {
    if (!date) return;
    const s = dstr(date);
    if (phase === "arrival") {
      onChange({ checkIn: s, checkOut: checkOut && checkOut > s ? checkOut : "" });
      setPhase("departure");
    } else {
      onChange({ checkIn, checkOut: s });
      setPhase("arrival");
    }
  };

  const selected = phase === "arrival"
    ? checkIn ? sdate(checkIn) : undefined
    : checkOut ? sdate(checkOut) : undefined;

  return (
    <div className={cn("rounded-lg border-2 border-indigo-300 bg-white shadow-sm", className)}>
      {/* Compact header — always visible, click to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <CalendarDays className="h-4 w-4 text-gray-400 shrink-0" />
        <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
          <span className={cn("rounded-full px-2.5 py-1 font-bold truncate", checkIn ? "bg-blue-100 text-blue-700 border border-blue-300" : "bg-gray-100 text-gray-500")}>
            {fmtShort(checkIn) !== "—" ? fmtShort(checkIn) : t("calendarArrival")}
          </span>
          <span className="text-gray-300">→</span>
          <span className={cn("rounded-full px-2.5 py-1 font-bold truncate", checkOut ? "bg-amber-100 text-amber-700 border border-amber-300" : "bg-gray-100 text-gray-500")}>
            {fmtShort(checkOut) !== "—" ? fmtShort(checkOut) : t("calendarDeparture")}
          </span>
        </div>
        <span className="text-[10px] text-gray-400 shrink-0">
          {expanded ? "▲" : "▼"} {expanded ? t("calendarHide", { defaultValue: "Hide" }) : t("calendarShow", { defaultValue: "Check availability" })}
        </span>
      </button>

      {/* Expanded calendar — only rendered when expanded */}
      {expanded && (
        <>
          {/* Phase chips */}
          <div className="flex items-center gap-2 border-t bg-gray-50/60 px-3 py-2">
            <button
              type="button"
              onClick={() => setPhase("arrival")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-colors",
                phase === "arrival" ? "bg-blue-600 text-white shadow-sm" : "bg-white text-gray-500 border"
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {phase === "arrival" ? t("calendarSelectArrival") : fmtShort(checkIn)}
            </button>
            <span className="text-gray-300">→</span>
            <button
              type="button"
              onClick={() => checkIn && setPhase("departure")}
              disabled={!checkIn}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-40",
                phase === "departure" ? "bg-amber-600 text-white shadow-sm" : "bg-white text-gray-500 border"
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {phase === "departure" ? t("calendarSelectDeparture") : fmtShort(checkOut)}
            </button>
          </div>

          {/* Calendar */}
          <div className="flex justify-center px-2 py-1">
            {!roomId ? (
              <p className="flex items-center gap-2 py-6 text-xs text-gray-400">
                <Info className="h-4 w-4" />
                {t("calendarPickRoom")}
              </p>
            ) : loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              </div>
            ) : (
              <Calendar
                mode="single"
                selected={selected}
                onSelect={(d) => handleSelect(d ?? undefined)}
                disabled={disabledFn}
                month={month}
                onMonthChange={setMonth}
                showOutsideDays={false}
                modifiers={{
                  booked: (date: Date) => occupiedNights.has(dstr(date)),
                  turnover: (date: Date) => turnoverDays.has(dstr(date)) && !occupiedNights.has(dstr(date)),
                }}
                modifiersClassNames={{
                  booked: "!bg-rose-50 !text-rose-300 line-through decoration-rose-300",
                  turnover: "!bg-amber-50 !text-amber-600 ring-1 ring-amber-300",
                }}
                className="w-full max-w-[240px] p-2"
              />
            )}
          </div>

          {/* Legend + booked ranges */}
          {roomId && !loading && (
            <div className="border-t bg-gray-50/60 px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-rose-300" />
                  {t("calendarLegendOccupied")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-300 ring-1 ring-amber-400" />
                  {t("calendarLegendTurnover")}
                </span>
              </div>
              {loadError ? (
                <p className="mt-1 text-[10px] text-rose-500">{loadError}</p>
              ) : ranges.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {ranges.map((r) => (
                    <span key={r.id} className="rounded-full border border-rose-200 bg-white px-1.5 py-0 text-[10px] text-rose-700">
                      {fmtShort(r.checkIn)} → {fmtShort(r.checkOut)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default RoomAvailabilityCalendar;
