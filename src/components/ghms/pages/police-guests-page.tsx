"use client";
import { useTranslation } from "react-i18next";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { normalizeIdType } from "@/lib/national-id";
import { apiPoliceGuests, apiGetGuestLifecycle } from "@/lib/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Phone,
  Mail,
  MapPin,
  Globe,
  CreditCard,
  Calendar,
  Star,
  UserCircle,
  Building2,
  BedDouble,
  ChevronLeft,
  ChevronRight,
  LogIn,
  LogOut,
  CalendarPlus,
  ArrowRightLeft,
  Ban,
  RefreshCw,
  Receipt,
  Clock,
  Route as RouteIcon,
} from "lucide-react";
import { AddressDisplay } from "@/components/shared/address-fields";
import GuestLifecycleBadges, { type GuestLifecycleSummary } from "@/components/shared/guest-lifecycle-badges";

interface Guest {
  id: string;
  name: string;
  phone: string;
  email: string;
  idNumber: string;
  idType: string;
  nationality: string;
  region: string;
  zone: string;
  woreda: string;
  kebele: string;
  houseNumber: string;
  streetName: string;
  address: string;
  notes: string;
  vip: boolean;
  totalSpent: number;
  totalStays: number;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  provider: { id: string; name: string } | null;
}

// ── Movement timeline event shape ────────────────────────────────
// Mirrors what /api/guests/[id]/lifecycle returns in `events[]`.
type MovementEventType =
  | "RESERVATION_CREATED"
  | "CHECKED_IN"
  | "CHECKED_OUT"
  | "EARLY_CHECKOUT"
  | "CANCELLED"
  | "EXTENDED"
  | "ROOM_SHIFTED"
  | "PAYMENT"
  | "RESERVATION_UPDATED";

interface MovementEvent {
  type: MovementEventType;
  timestamp: string;
  label: string;
  details: Record<string, unknown>;
  source: "STAFF_LOG" | "RESERVATION";
  reservationId: string;
  roomNumber?: string;
  actorName?: string;
  providerId?: string | null;
  providerName?: string | null;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "ETB", minimumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Per-event-type presentation: icon + tinted chip background.
// Aligned with the colour scheme used by GuestLifecycleBadges for
// consistency (amber=early, sky=extended, violet=shifted,
// rose=cancelled, slate=updated, emerald=check-in, blue=check-out,
// indigo=payment, primary=reservation-created).
const EVENT_PRESENTATION: Record<
  MovementEventType,
  { icon: typeof LogIn; dot: string; chip: string; iconColor: string }
> = {
  RESERVATION_CREATED: { icon: CalendarPlus, dot: "bg-primary", chip: "bg-primary/10 text-primary", iconColor: "text-primary" },
  CHECKED_IN:          { icon: LogIn,        dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", iconColor: "text-emerald-600" },
  CHECKED_OUT:         { icon: LogOut,       dot: "bg-blue-500",    chip: "bg-blue-50 text-blue-700",       iconColor: "text-blue-600" },
  EARLY_CHECKOUT:      { icon: Clock,        dot: "bg-amber-500",   chip: "bg-amber-50 text-amber-700",     iconColor: "text-amber-600" },
  CANCELLED:           { icon: Ban,          dot: "bg-rose-500",    chip: "bg-rose-50 text-rose-700",       iconColor: "text-rose-600" },
  EXTENDED:            { icon: CalendarPlus, dot: "bg-sky-500",     chip: "bg-sky-50 text-sky-700",         iconColor: "text-sky-600" },
  ROOM_SHIFTED:        { icon: ArrowRightLeft, dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700",  iconColor: "text-violet-600" },
  PAYMENT:             { icon: Receipt,      dot: "bg-indigo-500",  chip: "bg-indigo-50 text-indigo-700",   iconColor: "text-indigo-600" },
  RESERVATION_UPDATED: { icon: RefreshCw,    dot: "bg-slate-400",   chip: "bg-slate-50 text-slate-700",     iconColor: "text-slate-500" },
};

// ── Filter groups for the movement timeline ────────────────────────
// Each group maps to one or more MovementEventType values. "ALL" is
// the no-filter default; the others cluster related event types so the
// chip row stays compact (7 chips instead of 9).
type TimelineFilterGroup =
  | "ALL"
  | "CHECK_INS"
  | "CHECK_OUTS"
  | "ROOM_CHANGES"
  | "CANCELLATIONS"
  | "PAYMENTS"
  | "RESERVATIONS";

const EVENT_GROUP_MATCHERS: Record<TimelineFilterGroup, MovementEventType[] | null> = {
  ALL:           null, // null = no filter
  CHECK_INS:     ["CHECKED_IN"],
  CHECK_OUTS:    ["CHECKED_OUT", "EARLY_CHECKOUT"],
  ROOM_CHANGES:  ["ROOM_SHIFTED", "EXTENDED"],
  CANCELLATIONS: ["CANCELLED"],
  PAYMENTS:      ["PAYMENT"],
  RESERVATIONS:  ["RESERVATION_CREATED", "RESERVATION_UPDATED"],
};

// Order of filter chips in the UI (ALL first, then logical flow).
const FILTER_GROUP_ORDER: TimelineFilterGroup[] = [
  "ALL", "CHECK_INS", "CHECK_OUTS", "ROOM_CHANGES", "CANCELLATIONS", "PAYMENTS", "RESERVATIONS",
];

// ── Active-stay detection ───────────────────────────────────────────
// Returns the CHECKED_IN events for reservations that have NOT been
// checked out (i.e. the guest is currently staying there). Sorted by
// timestamp desc (most recent active stay first).
//
// Logic: walk events per reservationId in chronological order, track
// whether the last event for that reservation was a CHECKED_IN. If so,
// the stay is still active.
function computeActiveStays(events: MovementEvent[]): MovementEvent[] {
  const byReservation = new Map<string, MovementEvent[]>();
  for (const e of events) {
    const arr = byReservation.get(e.reservationId) ?? [];
    arr.push(e);
    byReservation.set(e.reservationId, arr);
  }
  const active: MovementEvent[] = [];
  for (const evs of byReservation.values()) {
    // chronological order (asc)
    const sorted = [...evs].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    let lastCheckIn: MovementEvent | null = null;
    for (const e of sorted) {
      if (e.type === "CHECKED_IN") lastCheckIn = e;
      else if (e.type === "CHECKED_OUT" || e.type === "EARLY_CHECKOUT") lastCheckIn = null;
    }
    if (lastCheckIn) active.push(lastCheckIn);
  }
  return active.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

// Look up the scheduled checkout date for a given reservationId by
// finding its RESERVATION_CREATED event (which carries checkOut in
// details). Returns null if not found.
function findScheduledCheckout(events: MovementEvent[], reservationId: string): string | null {
  const created = events.find(
    (e) => e.type === "RESERVATION_CREATED" && e.reservationId === reservationId
  );
  const co = created?.details?.checkOut;
  return typeof co === "string" ? co : null;
}

export default function PoliceGuestsPage() {
  const { t } = useTranslation("policeGuests");
  const { refreshKey } = useAppStore();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [loading, setLoading] = useState(true);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // Per-guest lifecycle summaries — powers the status-change badges
  // (early exit, extended, room shifted, cancelled) in the History column.
  const [lifecycleMap, setLifecycleMap] = useState<Record<string, GuestLifecycleSummary>>({});

  // ── Movement timeline state ──
  // When the detail dialog opens for a guest, we fetch the FULL lifecycle
  // (events[] array) — not just the summary — and render a vertical
  // timeline showing every check-in, check-out, room shift, payment,
  // cancellation, etc., tagged with the provider it happened at.
  const [movementEvents, setMovementEvents] = useState<MovementEvent[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  // Filter state for the movement timeline. "ALL" = no filter. Reset
  // whenever the dialog closes so opening guest B doesn't carry over
  // guest A's filter selection.
  const [timelineFilterType, setTimelineFilterType] = useState<TimelineFilterGroup>("ALL");
  const [timelineFilterProvider, setTimelineFilterProvider] = useState<string>("ALL");

  // Debounce search input (300ms) to avoid firing a request on every keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1); // reset to first page on new search
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch guests from server whenever page/pageSize/search changes
  const fetchGuests = useCallback(async () => {
    try {
      setLoading(true);
      const data: any = await apiPoliceGuests({
        q: debouncedSearch || undefined,
        page,
        pageSize,
      });
      const list: Guest[] = Array.isArray(data.guests) ? data.guests : [];
      setGuests(list);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);

      // ── Fetch lifecycle summaries for the current page of guests ──
      // Non-blocking — failures just mean badges don't show. Batches of 8.
      try {
        const summaries: Record<string, GuestLifecycleSummary> = {};
        const BATCH = 8;
        for (let i = 0; i < list.length; i += BATCH) {
          const batch = list.slice(i, i + BATCH);
          const results = await Promise.allSettled(
            batch.map((g) => apiGetGuestLifecycle(g.id))
          );
          results.forEach((r, idx) => {
            if (r.status === "fulfilled" && r.value?.summary) {
              summaries[batch[idx].id] = r.value.summary as GuestLifecycleSummary;
            }
          });
        }
        setLifecycleMap(summaries);
      } catch {
        setLifecycleMap({});
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('failedToLoad');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, pageSize]);

  useEffect(() => { fetchGuests(); }, [fetchGuests, refreshKey]);

  // Fetch the full movement timeline whenever the detail dialog opens
  // for a guest. Reuses the same lifecycle endpoint but consumes the
  // `events` array (the table-summary fetch above only used `summary`).
  const selectedGuestId = selectedGuest?.id;
  useEffect(() => {
    // No guest selected / dialog closed — nothing to fetch. The
    // movementEvents state is reset by the dialog's onOpenChange handler
    // when the dialog closes, so we don't need a synchronous setState here.
    if (!detailOpen || !selectedGuestId) {
      return;
    }
    let cancelled = false;
    setMovementLoading(true);
    setMovementError(null);
    apiGetGuestLifecycle(selectedGuestId)
      .then((data: any) => {
        if (cancelled) return;
        const events: MovementEvent[] = Array.isArray(data?.events) ? data.events : [];
        setMovementEvents(events);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : t('movementLoadFailed');
        setMovementError(msg);
        setMovementEvents([]);
      })
      .finally(() => {
        if (!cancelled) setMovementLoading(false);
      });
    return () => { cancelled = true };
  }, [detailOpen, selectedGuestId]);

  const openDetail = (guest: Guest) => {
    setSelectedGuest(guest);
    setDetailOpen(true);
  };

  const goToPage = (p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages)));
  };

  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  // Number of distinct providers the guest has stayed at — derived from
  // the movement events. Surfaced as a stat above the timeline so the
  // police officer can see at a glance whether this is a single-property
  // guest or someone moving between properties.
  const distinctProviders = new Set(
    movementEvents
      .map((e) => e.providerName)
      .filter((n): n is string => Boolean(n))
  ).size;

  // ── Journey summary derived values ────────────────────────────────
  // These power the new "Journey Summary" strip + "Current Whereabouts"
  // callout above the 2-column body. All are derived purely from the
  // movement events array, so they recompute whenever events load.
  const sortedTimestamps = movementEvents.map((e) => e.timestamp).sort();
  const firstSeenDate = sortedTimestamps[0] ?? null;
  const lastActivityDate = sortedTimestamps[sortedTimestamps.length - 1] ?? null;
  const activeStays = computeActiveStays(movementEvents);
  const currentStatusKey =
    activeStays.length > 0 ? "currentlyStaying" : "noActiveStay";

  // Distinct provider list for the provider filter dropdown. Sorted
  // alphabetically. Empty when there are no events (still loading or
  // no movement history).
  const distinctProviderList = Array.from(
    new Set(movementEvents.map((e) => e.providerName).filter((n): n is string => Boolean(n)))
  ).sort();

  // Apply both filters (event type group + provider) to the events
  // array. The timeline renders `filteredEvents` instead of the raw
  // `movementEvents`. When both filters are "ALL", this is identity.
  const filteredEvents = movementEvents.filter((ev) => {
    const groupMatcher = EVENT_GROUP_MATCHERS[timelineFilterType];
    if (groupMatcher && !groupMatcher.includes(ev.type)) return false;
    if (timelineFilterProvider !== "ALL" && ev.providerName !== timelineFilterProvider) return false;
    return true;
  });

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      {/* Search Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">{t('pageTitle')}</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t('pageSubtitle')}
          </p>
        </div>
        <div className="relative w-full sm:w-72 md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 sm:h-10"
          />
        </div>
      </div>

      {/* Results count */}
      {!loading && total > 0 && (
        <p className="text-xs text-muted-foreground px-1">
          {t('guestsFound', { total })}
          {debouncedSearch ? ` for "${debouncedSearch}"` : ""}
        </p>
      )}

      {/* Guest List — Cards on mobile, Table on md+ */}
      <div className="rounded-xl border bg-card shadow-sm">
        {loading ? (
          <div className="space-y-3 p-4 sm:p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full sm:h-12" />
            ))}
          </div>
        ) : guests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-center">
            <UserCircle className="mb-3 h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/40" />
            <p className="text-xs sm:text-sm text-muted-foreground">
              {debouncedSearch ? t('noGuestsMatch') : t('noGuestsYet')}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: Card layout */}
            <div className="divide-y md:hidden">
              {guests.map((guest) => (
                <button
                  key={guest.id}
                  className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/50 active:bg-muted/80"
                  onClick={() => openDetail(guest)}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100">
                    <UserCircle className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium">{guest.name}</p>
                      {guest.vip && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{guest.phone}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Building2 className="h-2.5 w-2.5" />
                        {guest.provider?.name || t('unknown')}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <BedDouble className="h-2.5 w-2.5" />
                        {guest.totalStays} {t('staysLabel')}
                      </span>
                      <span className="text-[10px] font-medium text-emerald-600">
                        {formatCurrency(guest.totalSpent)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Desktop: Table layout */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:thguestName')}</TableHead>
                    <TableHead>{t('common:thphone')}</TableHead>
                    <TableHead>{t('common:thidNumber')}</TableHead>
                    <TableHead>{t('common:thidType')}</TableHead>
                    <TableHead>{t('common:thnationality')}</TableHead>
                    <TableHead>{t('common:thprovider')}</TableHead>
                    <TableHead>{t('common:thtotalSpent')}</TableHead>
                    <TableHead>{t('common:thstays')}</TableHead>
                    <TableHead>{t('policeGuests:thHistory', 'History')}</TableHead>
                    <TableHead>{t('common:thvip')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {guests.map((guest) => (
                    <TableRow
                      key={guest.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDetail(guest)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {guest.name}
                          {guest.vip && (
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{guest.phone}</TableCell>
                      <TableCell className="font-mono text-sm">{guest.idNumber || "—"}</TableCell>
                      <TableCell>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium">
                          {normalizeIdType(guest.idType) || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {guest.nationality ? (
                            <>
                              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm">{guest.nationality}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {guest.provider?.name || t('unknown')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(guest.totalSpent)}</TableCell>
                      <TableCell className="text-center">{guest.totalStays}</TableCell>
                      <TableCell>
                        <GuestLifecycleBadges
                          summary={lifecycleMap[guest.id]}
                          compact
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        {guest.vip ? (
                          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
                            VIP
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {/* Guest Detail Dialog — wider, two-column on desktop, with Movement Timeline */}
      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          // Reset movement timeline state when the dialog closes so the
          // next opening starts fresh (no stale events from the previous guest).
          if (!open) {
            setMovementEvents([]);
            setMovementError(null);
            setMovementLoading(false);
            setTimelineFilterType("ALL");
            setTimelineFilterProvider("ALL");
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-auto w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
              <UserCircle className="h-5 w-5" />
              {selectedGuest?.name}
              {selectedGuest?.vip && (
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 text-xs">
                  VIP
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {selectedGuest?.provider?.name || t('unknownProvider')}
              {" · "}
              {t('movementCount', { count: movementEvents.length })}
              {distinctProviders > 1 && ` · ${t('providersVisited', { count: distinctProviders })}`}
            </DialogDescription>
          </DialogHeader>

          {/* ── Journey Summary strip ────────────────────────────────────
              A horizontal row of mini stat cards giving police officers
              an at-a-glance overview of the guest's tracking history:
              when they first appeared in the system, when they were
              last active, how many movements total, how many distinct
              properties they've visited, and their current status
              (actively staying somewhere vs. not). */}
          {selectedGuest && !movementLoading && movementEvents.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-lg border bg-muted/20 p-2.5">
              <SummaryCell
                label={t('firstSeen')}
                value={firstSeenDate ? formatDate(firstSeenDate) : "—"}
                icon={Calendar}
              />
              <SummaryCell
                label={t('lastActivity')}
                value={lastActivityDate ? formatDate(lastActivityDate) : "—"}
                icon={Clock}
              />
              <SummaryCell
                label={t('movementTimelineShort', t('movementTimeline'))}
                value={String(movementEvents.length)}
                icon={RouteIcon}
              />
              <SummaryCell
                label={t('providersVisitedShort', t('providersVisited', { count: distinctProviders }))}
                value={String(distinctProviders)}
                icon={Building2}
              />
              <SummaryCell
                label={t('status')}
                value={t(currentStatusKey)}
                icon={activeStays.length > 0 ? LogIn : LogOut}
                valueClassName={activeStays.length > 0 ? "text-emerald-700" : "text-muted-foreground"}
              />
            </div>
          )}

          {/* ── Current Whereabouts callout ─────────────────────────────
              When the guest has one or more active check-ins (no matching
              checkout), show a prominent emerald panel with the property
              they're currently at, the room, when they checked in, and
              the scheduled checkout date. This is the headline "where is
              this guest right now" answer for the follow-up view. */}
          {selectedGuest && !movementLoading && activeStays.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                  {t('currentWhereabouts')}
                </p>
              </div>
              {activeStays.map((stay) => {
                const scheduledOut = findScheduledCheckout(movementEvents, stay.reservationId);
                return (
                  <div key={stay.reservationId} className="text-xs text-emerald-900">
                    <p className="font-semibold">
                      {t('currentlyStayingAt')} {stay.providerName || t('unknownProvider')}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-emerald-800/90">
                      {stay.roomNumber && (
                        <span className="inline-flex items-center gap-0.5">
                          <BedDouble className="h-3 w-3" />
                          Room {stay.roomNumber}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5">
                        <LogIn className="h-3 w-3" />
                        {t('checkedIn')} {formatDateTime(stay.timestamp)}
                      </span>
                      {scheduledOut && (
                        <span className="inline-flex items-center gap-0.5">
                          <LogOut className="h-3 w-3" />
                          {t('scheduledCheckout')} {formatDate(scheduledOut)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedGuest && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ── LEFT: Guest profile + identity + contact ── */}
              <div className="space-y-4">
                {/* Quick stats row — always visible, stack on very small */}
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3 text-center">
                    <CreditCard className="mx-auto mb-1 h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                    <p className="text-sm sm:text-lg font-bold leading-tight">{formatCurrency(selectedGuest.totalSpent)}</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t('spent')}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3 text-center">
                    <p className="text-sm sm:text-lg font-bold leading-tight">{selectedGuest.totalStays}</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t('staysLabel')}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2.5 sm:p-3 text-center">
                    <p className="text-sm sm:text-lg font-bold leading-tight">{selectedGuest.vip ? t('yes') : t('no')}</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t('vip')}</p>
                  </div>
                </div>

                <Separator />

                {/* Contact & ID details — stacked on mobile */}
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2.5">
                    <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">{t('detailPhone')}</p>
                      <p className="font-medium">{selectedGuest.phone}</p>
                    </div>
                  </div>
                  {selectedGuest.email && (
                    <div className="flex items-center gap-2.5">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">{t('detailEmail')}</p>
                        <p className="font-medium">{selectedGuest.email}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-100 text-[8px] font-bold text-slate-600">ID</span>
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        {normalizeIdType(selectedGuest.idType) || t('detailIdType')}
                      </p>
                      <p className="font-mono font-medium">
                        {selectedGuest.idNumber || "—"}
                      </p>
                    </div>
                  </div>
                  {selectedGuest.nationality && (
                    <div className="flex items-center gap-2.5">
                      <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">{t('detailNationality')}</p>
                        <p className="font-medium">{selectedGuest.nationality}</p>
                      </div>
                    </div>
                  )}
                  {(selectedGuest.region || selectedGuest.address) && (
                    <div className="flex items-start gap-2.5">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">{t('detailAddress')}</p>
                        {selectedGuest.region ? (
                          <AddressDisplay
                            region={selectedGuest.region}
                            zone={selectedGuest.zone}
                            woreda={selectedGuest.woreda}
                            kebele={selectedGuest.kebele}
                            houseNumber={selectedGuest.houseNumber}
                            streetName={selectedGuest.streetName}
                          />
                        ) : (
                          <p className="font-medium">{selectedGuest.address || "—"}</p>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2.5">
                    <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">{t('detailRegistered')}</p>
                      <p className="font-medium">{formatDate(selectedGuest.createdAt)}</p>
                    </div>
                  </div>
                </div>

                {selectedGuest.notes && (
                  <>
                    <Separator />
                    <div className="space-y-1.5">
                      <Label>{t('common:lblnotes')}</Label>
                      <p className="rounded-lg bg-muted/50 p-3 text-xs sm:text-sm">{selectedGuest.notes}</p>
                    </div>
                  </>
                )}
              </div>

              {/* ── RIGHT: Movement timeline ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 sticky top-0 bg-card/95 backdrop-blur-sm py-1 z-10">
                  <div className="flex items-center gap-1.5">
                    <RouteIcon className="h-4 w-4 text-primary" />
                    <p className="text-xs uppercase tracking-wider font-semibold">
                      {t('movementTimeline')}
                    </p>
                  </div>
                  {!movementLoading && movementEvents.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {t('movementsShown', { shown: filteredEvents.length, total: movementEvents.length })}
                    </span>
                  )}
                </div>

                {/* Filter chips — event type group + provider dropdown.
                    Chips compose with the dropdown; both reset to "ALL"
                    when the dialog closes. Hidden while loading or when
                    there are no events to filter. */}
                {!movementLoading && movementEvents.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {FILTER_GROUP_ORDER.map((group) => (
                      <button
                        key={group}
                        type="button"
                        onClick={() => setTimelineFilterType(group)}
                        aria-pressed={timelineFilterType === group}
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none transition-colors ${
                          timelineFilterType === group
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {t(`filter_${group}`)}
                      </button>
                    ))}
                    {distinctProviderList.length > 1 && (
                      <Select
                        value={timelineFilterProvider}
                        onValueChange={setTimelineFilterProvider}
                      >
                        <SelectTrigger className="h-7 w-auto min-w-[140px] max-w-[220px] text-[11px] ml-1">
                          <SelectValue placeholder={t('filterAllProviders')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{t('filterAllProviders')}</SelectItem>
                          {distinctProviderList.map((name) => (
                            <SelectItem key={name} value={name}>
                              <span className="flex items-center gap-1">
                                <Building2 className="h-3 w-3 opacity-60" />
                                {name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}

                {movementLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : movementError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    {movementError}
                  </div>
                ) : movementEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                    <RouteIcon className="mb-2 h-8 w-8 opacity-40" />
                    <p className="text-xs">{t('noMovements')}</p>
                  </div>
                ) : filteredEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                    <RouteIcon className="mb-2 h-8 w-8 opacity-40" />
                    <p className="text-xs">{t('noMatchingMovements')}</p>
                  </div>
                ) : (
                  <ol className="relative space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                    {/* Vertical guide line */}
                    <span
                      aria-hidden
                      className="absolute left-[15px] top-2 bottom-2 w-px bg-border"
                    />
                    {filteredEvents.map((ev, i) => {
                      const p = EVENT_PRESENTATION[ev.type] ?? EVENT_PRESENTATION.RESERVATION_UPDATED;
                      const Icon = p.icon;
                      return (
                        <li key={`${ev.reservationId}-${ev.type}-${i}`} className="relative pl-9">
                          {/* Dot */}
                          <span
                            aria-hidden
                            className={`absolute left-[11px] top-2 h-2.5 w-2.5 rounded-full ring-2 ring-card ${p.dot}`}
                          />
                          <div className="rounded-lg border bg-card p-2.5 shadow-xs">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Icon className={`h-3.5 w-3.5 shrink-0 ${p.iconColor}`} />
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none ${p.chip}`}>
                                  {t(`movementType_${ev.type}`, ev.type.replace(/_/g, ' ').toLowerCase())}
                                </span>
                              </div>
                              <time className="text-[10px] text-muted-foreground whitespace-nowrap" dateTime={ev.timestamp}>
                                {formatDateTime(ev.timestamp)}
                              </time>
                            </div>
                            <p className="mt-1.5 text-xs font-medium leading-snug">
                              {ev.label}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                              {ev.providerName && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Building2 className="h-2.5 w-2.5" />
                                  {ev.providerName}
                                </span>
                              )}
                              {ev.roomNumber && (
                                <span className="inline-flex items-center gap-0.5">
                                  <BedDouble className="h-2.5 w-2.5" />
                                  Room {ev.roomNumber}
                                </span>
                              )}
                              {ev.actorName && (
                                <span className="inline-flex items-center gap-0.5">
                                  <UserCircle className="h-2.5 w-2.5" />
                                  {ev.actorName}
                                </span>
                              )}
                              {ev.source === "STAFF_LOG" && (
                                <span className="rounded bg-slate-100 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-slate-500">
                                  staff log
                                </span>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pagination Controls — server-side */}
      {!loading && total > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{t('showing', { from: rangeFrom, to: rangeTo, total })}</span>
            <Select value={String(pageSize)} onValueChange={(v) => changePageSize(Number(v))}>
              <SelectTrigger className="h-7 w-[90px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">{t('perPage', { count: 10 })}</SelectItem>
                <SelectItem value="20">{t('perPage', { count: 20 })}</SelectItem>
                <SelectItem value="50">{t('perPage', { count: 50 })}</SelectItem>
                <SelectItem value="100">{t('perPage', { count: 100 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs px-2">{t('pageOf', { page, total: totalPages })}</span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SummaryCell — compact stat for the Journey Summary strip ────────
// Icon + label + value stacked vertically. The value can be colour-tinted
// via `valueClassName` (e.g. emerald for active status).
function SummaryCell({
  label,
  value,
  icon: Icon,
  valueClassName = "",
}: {
  label: string;
  value: string;
  icon: typeof Calendar;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md bg-card border border-border/60 p-2 text-center">
      <Icon className="mx-auto mb-1 h-3 w-3 text-muted-foreground" />
      <p className={`text-xs sm:text-sm font-bold leading-tight truncate ${valueClassName}`} title={value}>
        {value}
      </p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5 truncate">
        {label}
      </p>
    </div>
  );
}
