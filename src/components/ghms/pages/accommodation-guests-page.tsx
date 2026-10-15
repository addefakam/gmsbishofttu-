"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import {
  apiGetGuests,
  apiGetReservations,
  apiCheckin,
  apiCheckout,
  apiUpdateReservation,
  apiGetRooms,
  apiCreateReservation,
  apiCancelReservation,
  apiBulkReservationAction,
} from "@/lib/api";
import { toast } from "sonner";
import { isValidPhone, isDefaultRoomName, isCheckoutDue, isCheckInDue } from "@/lib/utils";
import { normalizeIdType } from "@/lib/national-id";
import RoomAvailabilityCalendar from "@/components/ghms/room-availability-calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Search, LogIn, LogOut, Users, BedDouble, CalendarDays, AlertTriangle, UserPlus, Download,
  MoreVertical, Pencil, XCircle, CalendarPlus, CreditCard,
  ListChecks, Loader2, Phone,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationControls } from "@/components/shared/pagination-controls";


// ── Types ──
interface Guest {
  id: string; name: string; phone: string; idNumber: string; idType: string;
  nationality: string; email: string; vip: boolean; totalStays: number; totalSpent: number;
  createdAt: string;
  // Address fields (returned by /api/guests but optional here for backwards compat)
  region?: string; zone?: string; woreda?: string; kebele?: string;
  houseNumber?: string; streetName?: string;
}

interface Room { id: string; number: string; name: string; type: string; status: string; pricePerNight: number; }

interface Reservation {
  id: string; status: string; checkIn: string; checkOut: string; nights: number;
  totalCost: number; paidAmount: number; balance: number; paymentStatus: string;
  guestId?: string;
  guest?: { id: string; name: string; phone: string; idNumber: string };
  room?: { id: string; number: string; name: string; type: string };
  secondGuestName?: string; secondGuestPhone?: string; secondGuestIdNumber?: string;
  exceptionallyReserved?: boolean; exceptionReason?: string;
  createdAt: string;
  // Group booking info — populated by GET /api/reservations via a LEFT JOIN
  // to GroupBooking. Used by getGuestDisplayName() to swap placeholder
  // "Guest 1", "Guest 2", ... names for the group/organization name.
  groupBookingId?: string | null;
  groupBookingName?: string | null;
}

// ── Display name helper for the Guest column ──
// When a group booking is created via the Quick Group Setup flow, each
// reservation gets a placeholder Guest record ("Guest 1", "Guest 2", ...).
// In the Guests table we prefer to show the group/organization name
// (e.g. "Bishoftu Police Training Cohort 12") instead of those placeholders.
//
// Rules:
//   1. If the reservation has no groupBookingName → show guest.name as-is
//   2. If guest.name matches the placeholder pattern /^Guest \d+$/ → show
//      groupBookingName instead (with the placeholder as a small subtitle)
//   3. If guest.name is a real name (not a placeholder) → show guest.name
//      with groupBookingName as a small subtitle (group context)
const PLACEHOLDER_GUEST_RE = /^Guest\s+\d+$/;

function getGuestDisplayName(res: Reservation): { primary: string; subtitle?: string } {
  const guestName = res.guest?.name || "";
  const groupName = res.groupBookingName || "";
  if (!groupName) {
    return { primary: guestName || "—" };
  }
  if (PLACEHOLDER_GUEST_RE.test(guestName)) {
    return { primary: groupName, subtitle: guestName };
  }
  return { primary: guestName || "—", subtitle: groupName };
}

// ── Check-in eligibility (mirrors the 3 backend gates on
//    /api/reservations/[id]/checkin) ──
//   1. Reservation must be UPCOMING
//   2. Today's date >= scheduled checkIn   (not before arrival)
//   3. Today's date <= scheduled checkOut   (not after planned checkout)
// The room-occupied check is enforced by the API server-side. Local date
// (not UTC) so the gate matches the operator's wall clock for an
// Ethiopian guesthouse (UTC+3).
type CheckInEligibility = {
  canCheckIn: boolean;
  reasonKey: string | null;
  reasonContext: Record<string, string | number> | null;
};

function getCheckInEligibility(res: Reservation): CheckInEligibility {
  if (res.status !== "UPCOMING") {
    return {
      canCheckIn: false,
      reasonKey: res.status === "ACTIVE" ? "checkinAlreadyActive" : "checkinNotUpcoming",
      reasonContext: { status: res.status },
    };
  }
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (todayStr < res.checkIn) {
    return {
      canCheckIn: false,
      reasonKey: "checkinTooEarly",
      reasonContext: { arrival: res.checkIn, today: todayStr },
    };
  }
  if (todayStr > res.checkOut) {
    return {
      canCheckIn: false,
      reasonKey: "checkinTooLate",
      reasonContext: { checkout: res.checkOut, today: todayStr },
    };
  }
  return { canCheckIn: true, reasonKey: null, reasonContext: null };
}

// ── Constants ──
const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  OCCUPIED: "bg-blue-100 text-blue-800",
  MAINTENANCE: "bg-amber-100 text-amber-800",
  RESERVED: "bg-purple-100 text-purple-800",
};

const RES_STATUS: Record<string, { color: string; label: string }> = {
  UPCOMING: { color: "bg-blue-100 text-blue-800", label: "Upcoming" },
  ACTIVE: { color: "bg-emerald-100 text-emerald-800", label: "Checked In" },
  COMPLETED: { color: "bg-slate-100 text-slate-700", label: "Completed" },
  CANCELLED: { color: "bg-red-100 text-red-800", label: "Cancelled" },
};

const DOUBLE_ROOM_TYPES = ["DOUBLE", "TWIN"];

const emptyResForm = {
  guestId: "", roomId: "", checkIn: "", checkOut: "", notes: "",
  secondGuestName: "", secondGuestPhone: "", secondGuestIdNumber: "",
  exceptionallyReserved: false, exceptionReason: "",
};

// ── Helpers ──
function formatDate(d: string) {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return d; }
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "ETB", maximumFractionDigits: 0 }).format(v);
}

function todayStr() { return new Date().toISOString().split("T")[0]; }

function addDays(d: string, n: number) {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}

// ── Component ──
export default function AccommodationGuestsPage() {
  const { t } = useTranslation("accommodation");
  const { refreshKey, triggerRefresh, setCurrentPage, setPreselectedRoom } = useAppStore();

  function resStatusLabel(status: string) {
    const key = `resStatus${status.charAt(0)}${status.slice(1).toLowerCase()}`;
    const translated = t(key);
    return translated !== key ? translated : status;
  }

  // Data
  const [guests, setGuests] = useState<Guest[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  // Lifecycle summaries per guest — keys are guest IDs. Used to show
  // status-change badges (early exit, extended, cancelled, room shifted)
  // inline on each row of the guest search table.


  // Search & filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New reservation dialog
  const [resDialogOpen, setResDialogOpen] = useState(false);
  const [resForm, setResForm] = useState(emptyResForm);
  const [resGuestSearch, setResGuestSearch] = useState("");
  const [creatingRes, setCreatingRes] = useState(false);

  // Check-in / Check-out confirm
  const [confirmAction, setConfirmAction] = useState<{
    type: "checkin" | "checkout" | "cancel"; reservation: Reservation;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ── Extend Stay ──
  const [extendDialog, setExtendDialog] = useState<Reservation | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [extending, setExtending] = useState(false);

  // ── Early Checkout ──
  const [earlyCheckoutDialog, setEarlyCheckoutDialog] = useState<Reservation | null>(null);
  const [earlyCheckingOut, setEarlyCheckingOut] = useState(false);

  const openExtendDialog = (res: Reservation) => {
    setExtendDialog(res);
    const nextDay = new Date(res.checkOut);
    nextDay.setDate(nextDay.getDate() + 1);
    setExtendDate(nextDay.toISOString().split("T")[0]);
  };

  const handleExtendStay = async () => {
    if (!extendDialog || !extendDate) return;
    if (extendDate <= extendDialog.checkOut) {
      toast.error("New checkout date must be after the current checkout date");
      return;
    }
    try {
      setExtending(true);
      await apiUpdateReservation(extendDialog.id, { checkOut: extendDate });
      toast.success("Stay extended successfully");
      setExtendDialog(null);
      setExtendDate("");
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to extend stay");
    } finally {
      setExtending(false);
    }
  };

  const handleEarlyCheckout = async () => {
    if (!earlyCheckoutDialog) return;
    try {
      setEarlyCheckingOut(true);
      await apiCheckout(earlyCheckoutDialog.id);
      toast.success("Guest checked out successfully");
      setEarlyCheckoutDialog(null);
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to check out");
    } finally {
      setEarlyCheckingOut(false);
    }
  };

  const handleCancelReservation = async () => {
    if (!confirmAction) return;
    try {
      setActionLoading(true);
      await apiCancelReservation(confirmAction.reservation.id);
      toast.success("Reservation cancelled");
      setConfirmAction(null);
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel reservation");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Export dialog state ──
  // Lets the user pick a date range + guest state, then downloads an .xlsx
  // of matching guests (with their reservation info).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportState, setExportState] = useState<"ALL" | "CHECKED_IN" | "UPCOMING" | "COMPLETED" | "CANCELLED">("ALL");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      // Re-use already-loaded guests + reservations. If the user picked a
      // date range, filter by reservation checkIn/checkOut overlapping the
      // range. If the user picked a state, filter by it.
      const from = exportFrom ? exportFrom : null;
      const to = exportTo ? exportTo : null;

      // Build a map of guestId → reservations (any status) for date filtering.
      const reservationsByGuest = new Map<string, Reservation[]>();
      for (const r of reservations) {
        const gid = r.guestId || r.guest?.id;
        if (!gid) continue;
        if (!reservationsByGuest.has(gid)) reservationsByGuest.set(gid, []);
        reservationsByGuest.get(gid)!.push(r);
      }

      const rows: Record<string, string | number>[] = [];

      for (const g of guests) {
        const gReservations = reservationsByGuest.get(g.id) || [];

        // ── State filter ──
        if (exportState === "CHECKED_IN") {
          if (!gReservations.some((r) => r.status === "ACTIVE")) continue;
        } else if (exportState === "UPCOMING") {
          if (!gReservations.some((r) => r.status === "UPCOMING")) continue;
        } else if (exportState === "COMPLETED") {
          if (!gReservations.some((r) => r.status === "COMPLETED")) continue;
        } else if (exportState === "CANCELLED") {
          if (!gReservations.some((r) => r.status === "CANCELLED")) continue;
        }
        // Skip guests with no reservations entirely.
        if (gReservations.length === 0) continue;

        // ── Date range filter ──
        // If a range is set, require at least one reservation whose
        // [checkIn, checkOut] overlaps with [from, to].
        if (from || to) {
          const inRange = gReservations.some((r) => {
            const ci = r.checkIn?.slice(0, 10) || "";
            const co = r.checkOut?.slice(0, 10) || "";
            if (!ci || !co) return false;
            // Overlap test: ci <= to && co >= from
            const okFrom = !from || co >= from;
            const okTo = !to || ci <= to;
            return okFrom && okTo;
          });
          if (!inRange) continue;
        }

        // Compose address string
        const addrParts = [g.region, g.zone, g.woreda, g.kebele, g.houseNumber, g.streetName]
          .filter((x) => x && String(x).trim())
          .map((x) => String(x).trim());

        // Pick the "primary" reservation for the row (most recent check-in)
        const primary = gReservations
          .slice()
          .sort((a, b) => (b.checkIn || "").localeCompare(a.checkIn || ""))[0];

        rows.push({
          Name: g.name || "",
          Phone: g.phone || "",
          Nationality: g.nationality || "",
          IDType: normalizeIdType(g.idType) || "",
          IDNumber: g.idNumber || "",
          CheckIn: primary?.checkIn?.slice(0, 10) || "—",
          CheckOut: primary?.checkOut?.slice(0, 10) || "—",
          RoomNumber: primary?.room?.number || "—",
          RoomType: primary?.room?.type || "—",
        });
      }

      if (rows.length === 0) {
        toast.error("No guests match the selected filters.");
        return;
      }

      // Dynamic import to keep the initial bundle small.
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows);
      // Auto-size columns based on header length + a few rows
      const colWidths = Object.keys(rows[0]).map((k) => ({
        wch: Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)) + 2,
      }));
      ws["!cols"] = colWidths;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Guests");
      const dateStamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `guests_export_${dateStamp}.xlsx`);
      toast.success(`Exported ${rows.length} guest(s) to Excel.`);
      setExportOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Pagination
  const pagination = usePagination({ totalItems: 0, initialPageSize: 10, pageSizeOptions: [10, 20, 50] });

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch the 3 main data sources in parallel — these are what the
      // table needs to render. Don't block on lifecycle summaries.
      const [gData, rData, rmData] = await Promise.all([
        apiGetGuests(),
        apiGetReservations(),
        apiGetRooms(),
      ]);
      const gArr = Array.isArray(gData) ? gData : [];
      setGuests(gArr);
      const rArr = Array.isArray(rData?.data) ? rData.data : Array.isArray(rData) ? rData : [];
      setReservations(rArr);
      // apiGetRooms already unwraps { rooms: [...] } to a plain array
      const raw = Array.isArray(rmData) ? rmData : Array.isArray(rmData?.rooms) ? rmData.rooms : [];
      setRooms(raw);

      // ── Stop loading here so the page renders immediately ──
      setLoading(false);

      // History column + lifecycle badges removed — was causing slow
      // loading due to N+1 API calls (one per guest).
    } catch {
      toast.error(t("toastFailedLoadGuests"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

  // ── Computed: list of displayable reservations ──
  // Each reservation becomes ONE row in the table — no deduplication by
  // guest. So if a guest has multiple bookings (group bookings, recurring
  // stays, multi-room), they appear once per reservation.
  //
  // Includes ALL non-DELETED statuses so the status-filter dropdown next
  // to the search input can show COMPLETED and CANCELLED rows too.
  // Stats/bulk-action consumers below explicitly filter to ACTIVE +
  // UPCOMING where needed (so the KPI cards still reflect live guests).
  const activeReservations = useMemo(() =>
    reservations.filter((r) => r.status !== "DELETED"),
    [reservations]
  );

  // Lookup map of guestId → full Guest record. The reservation's `guest`
  // sub-object from the API only has {id, name, phone} — no idNumber,
  // nationality, vip, etc. Cross-reference here to surface those fields
  // (idNumber is shown in the Phone/ID column; vip could be used for
  // the star badge if needed in the future).
  const guestMap = useMemo(() => {
    const m = new Map<string, Guest>();
    for (const g of guests) m.set(g.id, g);
    return m;
  }, [guests]);

  // ── Filtered list (one row per reservation) ──
  const filtered = useMemo(() => {
    let list = activeReservations;
    if (statusFilter === "CHECKED_IN") {
      list = list.filter((r) => r.status === "ACTIVE");
    } else if (statusFilter === "UPCOMING") {
      list = list.filter((r) => r.status === "UPCOMING");
    } else if (statusFilter === "COMPLETED") {
      list = list.filter((r) => r.status === "COMPLETED");
    } else if (statusFilter === "CANCELLED") {
      list = list.filter((r) => r.status === "CANCELLED");
    }
    // statusFilter === "ALL" → no extra filter, every non-DELETED reservation shown.
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) => {
          // Match primary guest name/phone from the reservation's nested guest
          if ((r.guest?.name || "").toLowerCase().includes(q)) return true;
          if ((r.guest?.phone || "").toLowerCase().includes(q)) return true;
          // Match second guest name/phone (e.g. for double rooms)
          if ((r.secondGuestName || "").toLowerCase().includes(q)) return true;
          if ((r.secondGuestPhone || "").toLowerCase().includes(q)) return true;
          // Match the primary guest's ID number — this field is NOT in the
          // reservation's nested guest object (the API only returns name/phone
          // there), so we cross-reference the guests array via guestMap.
          const guest = r.guestId ? guestMap.get(r.guestId) : undefined;
          if (guest?.idNumber && guest.idNumber.toLowerCase().includes(q)) return true;
          // Match against the group booking name — lets operators search
          // "Police Training" and find all reservations in that group.
          if ((r.groupBookingName || "").toLowerCase().includes(q)) return true;
          return false;
        }
      );
    }
    // Sort: ACTIVE first, then UPCOMING.
    //   - ACTIVE  → sorted by checkOut date ASCENDING (soonest departure
    //               first — the operator sees who needs to check out
    //               today/tomorrow on top, the most urgent action)
    //   - UPCOMING → sorted by checkIn date ASCENDING (soonest arrival
    //                first — the operator sees who's expected next)
    //   - Other   → fallback to createdAt DESC
    return [...list].sort((a, b) => {
      const aPri = a.status === "ACTIVE" ? 2 : a.status === "UPCOMING" ? 1 : 0;
      const bPri = b.status === "ACTIVE" ? 2 : b.status === "UPCOMING" ? 1 : 0;
      if (bPri !== aPri) return bPri - aPri;
      // Same priority group:
      if (a.status === "UPCOMING") {
        // Soonest arrival first → ascending by checkIn
        return (a.checkIn || "").localeCompare(b.checkIn || "");
      }
      if (a.status === "ACTIVE") {
        // Soonest departure first → ascending by checkOut.
        // Operator sees who needs to check out today/tomorrow on top —
        // the most urgent action — rather than who arrived most recently.
        return (a.checkOut || "").localeCompare(b.checkOut || "");
      }
      // COMPLETED/CANCELLED/DELETED fallback — most recently created first
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [activeReservations, statusFilter, search]);

  // Update pagination total
  useEffect(() => { pagination.setTotalItems(filtered.length); }, [filtered.length, pagination]);
  const paginated = useMemo(() => pagination.paginate(filtered), [filtered, pagination]);

  // Rooms offered for new reservations: every bookable room — availability is
  // date-driven (calendar disables occupied days; server rejects overlaps).
  // Only MAINTENANCE rooms are excluded. A room flagged OCCUPIED/RESERVED
  // stays selectable for future free dates.
  const availableRooms = useMemo(() => rooms.filter((r) => r.status !== "MAINTENANCE"), [rooms]);

  // Guest search for reservation dialog
  const resGuestResults = useMemo(() => {
    if (!resGuestSearch || resGuestSearch.length < 2) return guests.slice(0, 10);
    const q = resGuestSearch.toLowerCase();
    return guests
      .filter((g) => g.name.toLowerCase().includes(q) || g.phone.includes(q) || g.idNumber.toLowerCase().includes(q))
      .slice(0, 10);
  }, [resGuestSearch, guests]);

  const resNights = useMemo(() => {
    if (!resForm.checkIn || !resForm.checkOut) return 0;
    return Math.max(1, Math.ceil((new Date(resForm.checkOut).getTime() - new Date(resForm.checkIn).getTime()) / 86400000));
  }, [resForm.checkIn, resForm.checkOut]);

  const resRate = useMemo(() => {
    const rm = rooms.find((r) => r.id === resForm.roomId);
    return rm ? rm.pricePerNight : 0;
  }, [resForm.roomId, rooms]);

  // Is the selected room a DOUBLE or TWIN?
  const selectedRoomIsDouble = useMemo(() => {
    const rm = rooms.find((r) => r.id === resForm.roomId);
    return rm ? DOUBLE_ROOM_TYPES.includes(rm.type) : false;
  }, [resForm.roomId, rooms]);

  // ── Handlers ──
  const handleCreateRes = async () => {
    if (!resForm.guestId || !resForm.roomId || !resForm.checkIn || !resForm.checkOut) {
      toast.error(t("toastFillRequired")); return;
    }
    // Client-side validation for double rooms
    if (selectedRoomIsDouble && !resForm.exceptionallyReserved) {
      if (!resForm.secondGuestName.trim() || !resForm.secondGuestPhone.trim()) {
        toast.error(t("toastSecondGuestRequired"));
        return;
      }
      if (!isValidPhone(resForm.secondGuestPhone)) {
        toast.error(t("toastInvalidSecondGuestPhone"));
        return;
      }
    }
    if (resForm.exceptionallyReserved && !resForm.exceptionReason.trim()) {
      toast.error(t("toastProvideExceptionReason")); return;
    }
    try {
      setCreatingRes(true);
      await apiCreateReservation({
        guestId: resForm.guestId, roomId: resForm.roomId,
        checkIn: resForm.checkIn, checkOut: resForm.checkOut, notes: resForm.notes,
        secondGuestName: resForm.secondGuestName,
        secondGuestPhone: resForm.secondGuestPhone,
        secondGuestIdNumber: resForm.secondGuestIdNumber,
        exceptionallyReserved: resForm.exceptionallyReserved,
        exceptionReason: resForm.exceptionReason,
      });
      toast.success(t("toastReservationCreated"));
      setResDialogOpen(false);
      setResForm(emptyResForm);
      setResGuestSearch("");
      triggerRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("toastFailedCreateReservation");
      toast.error(msg);
    } finally { setCreatingRes(false); }
  };

  const handleAction = async () => {
    if (!confirmAction) return;
    const { type, reservation } = confirmAction;
    try {
      setActionLoading(true);
      if (type === "checkin") { await apiCheckin(reservation.id); toast.success(t("toastGuestCheckedIn")); }
      else if (type === "checkout") { await apiCheckout(reservation.id); toast.success(t("toastGuestCheckedOut")); }
      else if (type === "cancel") { await apiCancelReservation(reservation.id); toast.success("Reservation cancelled"); }
      setConfirmAction(null);
      triggerRefresh();
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : (type === "checkin" ? t("toastFailedCheckIn") : type === "checkout" ? t("toastFailedCheckOut") : "Failed to cancel"));
    } finally { setActionLoading(false); }
  };

  const quickCheckin = (r: Reservation) => setConfirmAction({ type: "checkin", reservation: r });
  const quickCheckout = (r: Reservation) => setConfirmAction({ type: "checkout", reservation: r });

  // ── Bulk Check In / Check Out / Cancel (multi-select) ──
  // Mirrors the bulk-action bar on the Reservations page, scoped to three
  // actions (per request):
  //   - checkin  → for UPCOMING reservations whose check-in date has arrived
  //   - checkout → for ACTIVE reservations whose checkout date has arrived
  //   - cancel   → for UPCOMING or ACTIVE reservations (releases the room)
  //
  // (Bulk Early Out already exists on the Reservations page; can be added
  //  here later by extending bulkAction's type union.)
  //
  // selectionMode: when true, each row shows a checkbox and a sticky
  // action bar appears at the bottom with the action buttons.
  // selectedIds: set of reservation IDs currently checked.
  // bulkAction: when set, an AlertDialog is shown asking the user to
  //   confirm before firing the API call.
  // bulkLoading: spinner state on the confirm button.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"checkin" | "checkout" | "cancel" | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkAction(null);
  };

  // ── Second Guest column toggle ──
  // Operator-controlled show/hide for the desktop table's Second Guest
  // column. Default ON (matches previous behavior). Persists in
  // localStorage so the choice is remembered across sessions.
  // SSR-safe: guard with typeof window check + try/catch for private
  // mode (Safari throws on localStorage access in private browsing).
  const [showSecondGuest, setShowSecondGuest] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("ghms.showSecondGuestColumn");
      if (stored === "false") setShowSecondGuest(false);
    } catch {
      /* private mode — ignore */
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("ghms.showSecondGuestColumn", String(showSecondGuest));
    } catch {
      /* private mode — ignore */
    }
  }, [showSecondGuest]);

  // Phone/ID column toggle — same pattern as Second Guest.
  const [showPhoneId, setShowPhoneId] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("ghms.showPhoneIdColumn");
      if (stored === "false") setShowPhoneId(false);
    } catch {
      /* private mode — ignore */
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("ghms.showPhoneIdColumn", String(showPhoneId));
    } catch {
      /* private mode — ignore */
    }
  }, [showPhoneId]);

  // Eligibility counts for the confirm dialog's "X not eligible" hint.
  // Mirrors the server-side checks so the user gets an accurate pre-flight
  // estimate before confirming. The room-occupied check is server-side
  // only — we don't have the live room status here cheaply.
  const bulkEligibility = useMemo(() => {
    const selected = activeReservations.filter((r) => selectedIds.has(r.id));
    let eligible = 0;
    let skipped = 0;
    for (const r of selected) {
      // Same checks as the bulk endpoint:
      //   - checkin  → must be UPCOMING, today must be ≥ checkIn
      //   - checkout → must be ACTIVE, today must be ≥ checkOut
      //   - cancel   → must be UPCOMING or ACTIVE (terminal states like
      //                COMPLETED/CANCELLED/DELETED are skipped)
      let ok = false;
      if (bulkAction === "checkin") {
        ok = r.status === "UPCOMING" && isCheckInDue(r.checkIn);
      } else if (bulkAction === "checkout") {
        ok = r.status === "ACTIVE" && isCheckoutDue(r.checkOut);
      } else if (bulkAction === "cancel") {
        ok = r.status === "UPCOMING" || r.status === "ACTIVE";
      }
      if (ok) eligible++;
      else skipped++;
    }
    return { eligible, skipped, total: selected.length };
  }, [activeReservations, selectedIds, bulkAction]);

  const handleBulkAction = async () => {
    if (!bulkAction) return;
    const selectedIdsArray = Array.from(selectedIds);
    if (selectedIdsArray.length === 0) return;

    try {
      setBulkLoading(true);
      const result = await apiBulkReservationAction(selectedIdsArray, bulkAction) as {
        successCount: number;
        skippedCount: number;
        failedCount: number;
        total: number;
      };
      const toastKey =
        bulkAction === "checkin" ? "toastBulkCheckinResult"
        : bulkAction === "cancel" ? "toastBulkCancelResult"
        : "toastBulkCheckoutResult";
      toast.success(t(toastKey, {
        success: result.successCount,
        total: result.total,
        skipped: result.skippedCount,
        failed: result.failedCount,
      }));
      exitSelectionMode();
      triggerRefresh();
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bulk action failed";
      toast.error(msg);
    } finally {
      setBulkLoading(false);
    }
  };

  // ── Stats ──
  // Counts RESERVATIONS (one per row in the table) so the numbers
  // always match the displayed list rows exactly. The Total / CheckedIn /
  // Upcoming KPIs deliberately count ONLY ACTIVE + UPCOMING — completed
  // and cancelled stays are historical and shouldn't inflate the live
  // occupancy numbers, even when the user selects those filters from the
  // dropdown.
  const stats = useMemo(() => {
    const live = activeReservations.filter((r) => r.status === "ACTIVE" || r.status === "UPCOMING");
    return {
      total: live.length,
      checkedIn: live.filter((r) => r.status === "ACTIVE").length,
      upcoming: live.filter((r) => r.status === "UPCOMING").length,
      availableRooms: rooms.filter((r) => r.status === "AVAILABLE").length,
    };
  }, [activeReservations, rooms]);

  // ── Render ──
  if (loading) {
    return (
      <div className="space-y-4 p-3 sm:p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      </div>
    );
  }

  // ── Confirm dialog metadata for the single-action (non-bulk) dialog ──
  // Branches on confirmAction.type so Cancel shows a red 'Cancel' button
  // with a cancel-specific description, instead of incorrectly showing
  // 'Check Out' label/color/desc for cancel (the old ternary treated
  // anything non-checkin as checkout).
  const actionInfo = (() => {
    if (!confirmAction) return null;
    const guestName = confirmAction.reservation.guest?.name || "";
    const roomNumber = confirmAction.reservation.room?.number || "";
    if (confirmAction.type === "checkin") {
      return {
        label: t("btnCheckIn"),
        icon: <LogIn className="h-4 w-4" />,
        cls: "bg-emerald-600 hover:bg-emerald-700",
        desc: t("confirmCheckInDesc", { guest: guestName, room: roomNumber }),
      };
    }
    if (confirmAction.type === "cancel") {
      return {
        label: t("btnCancel") || "Cancel",
        icon: <XCircle className="h-4 w-4" />,
        cls: "bg-red-600 hover:bg-red-700",
        desc: t("confirmCancelDesc", { guest: guestName, room: roomNumber }),
      };
    }
    // type === "checkout"
    return {
      label: t("btnCheckOut"),
      icon: <LogOut className="h-4 w-4" />,
      cls: "bg-sky-600 hover:bg-sky-700",
      desc: t("confirmCheckOutDesc", { guest: guestName, room: roomNumber }),
    };
  })();

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("manageGuests", "Manage Guests")}</h1>
          <p className="text-sm text-muted-foreground">{t("manageGuestsDesc", "Manage guest check-in & check-out and reservations")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setExportOpen(true)} className="h-8 text-xs gap-1.5">
            <Download className="h-3.5 w-3.5" /> {t("export", "Export")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setPreselectedRoom({ id: "", number: "", name: "", type: "", pricePerNight: 0, intent: "create" }); setCurrentPage("reservations"); }} className="h-8 text-xs gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> {t("newReservation", "New Reservation")}
          </Button>
        </div>
      </div>

      {/* Stats — clickable cards that filter the list (or navigate to rooms) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t("totalGuests", "Total Guests"), value: stats.total, icon: <Users className="h-4 w-4" />, color: "text-slate-700 bg-slate-50", onClick: () => { setStatusFilter("ALL"); pagination.resetToFirst(); } },
          { label: t("checkedIn", "Checked In"), value: stats.checkedIn, icon: <BedDouble className="h-4 w-4" />, color: "text-emerald-700 bg-emerald-50", onClick: () => { setStatusFilter("CHECKED_IN"); pagination.resetToFirst(); } },
          { label: t("upcoming", "Upcoming"), value: stats.upcoming, icon: <CalendarDays className="h-4 w-4" />, color: "text-blue-700 bg-blue-50", onClick: () => { setStatusFilter("UPCOMING"); pagination.resetToFirst(); } },
          { label: t("availableRooms", "Available Rooms"), value: stats.availableRooms, icon: <BedDouble className="h-4 w-4" />, color: "text-purple-700 bg-purple-50", onClick: () => { setAccommodationTab("rooms"); setCurrentPage("accommodation"); } },
        ].map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={s.onClick}
            className="rounded-lg border p-3 text-left transition-all hover:border-slate-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-md ${s.color}`}>{s.icon}</div>
              <div>
                <p className="text-lg font-bold leading-tight">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Search & Filter + Bulk Select toggle */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("searchGuests", "Search by name, phone, or ID...")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); pagination.resetToFirst(); }}>
          <SelectTrigger className="h-9 w-full sm:w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("allGuests", "All Guests")}</SelectItem>
            <SelectItem value="CHECKED_IN">{t("checkedIn", "Checked In")}</SelectItem>
            <SelectItem value="UPCOMING">{t("upcoming", "Upcoming")}</SelectItem>
            <SelectItem value="COMPLETED">{t("completed", "Completed")}</SelectItem>
            <SelectItem value="CANCELLED">{t("cancelled", "Cancelled")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={selectionMode ? "default" : "outline"}
          size="sm"
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
          className="h-9 gap-1.5"
        >
          {selectionMode ? <XCircle className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
          {selectionMode ? t("btnBulkExit") : t("btnBulkSelect")}
        </Button>
        {/* Phone/ID column toggle — desktop only */}
        <Button
          type="button"
          variant={showPhoneId ? "default" : "outline"}
          size="sm"
          onClick={() => setShowPhoneId((v) => !v)}
          className="hidden md:inline-flex h-9 gap-1.5"
          aria-pressed={showPhoneId}
          title={showPhoneId
            ? "Hide the Phone / ID column"
            : "Show the Phone / ID column"}
        >
          <Phone className="h-4 w-4" />
          {t("btnTogglePhoneId", "Phone / ID")}
        </Button>
        {/* Second Guest column toggle — desktop only (mobile cards already
            conditionally render second-guest info only when present). */}
        <Button
          type="button"
          variant={showSecondGuest ? "default" : "outline"}
          size="sm"
          onClick={() => setShowSecondGuest((v) => !v)}
          className="hidden md:inline-flex h-9 gap-1.5"
          aria-pressed={showSecondGuest}
          title={showSecondGuest
            ? "Hide the Second Guest column"
            : "Show the Second Guest column"}
        >
          <UserPlus className="h-4 w-4" />
          {t("btnToggleSecondGuest", "Second Guest")}
        </Button>
      </div>

      {/* Guest List */}
      <div className="rounded-xl border bg-card shadow-sm">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-3 h-10 w-10 text-muted--foreground/40" />
            <p className="text-sm text-muted-foreground">{t("noGuestsFound")}</p>
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="divide-y md:hidden">
              {paginated.map((r) => {
                const guest = r.guestId ? guestMap.get(r.guestId) : undefined;
                const guestIdNumber = r.guest?.idNumber || guest?.idNumber || "";
                const guestPhone = r.guest?.phone || guest?.phone || "";
                const vip = guest?.vip || false;
                return (
                <div key={r.id} className={`p-3 space-y-2 transition-all ${selectionMode && selectedIds.has(r.id) ? "ring-2 ring-violet-400 border-l-4 border-violet-300" : ""}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {selectionMode && (
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={() => toggleSelect(r.id)}
                          aria-label={`Select reservation ${r.guest?.name || ""}`}
                        />
                      )}
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${r.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : r.status === "UPCOMING" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                        {(() => {
                          const dn = getGuestDisplayName(r);
                          return (dn.primary || "?").charAt(0).toUpperCase();
                        })()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-medium">
                            {(() => {
                              const dn = getGuestDisplayName(r);
                              return dn.primary;
                            })()}
                          </p>
                          {vip && <span className="text-[9px] text-amber-600 font-semibold">VIP</span>}
                        </div>
                        {(() => {
                          const dn = getGuestDisplayName(r);
                          return dn.subtitle ? (
                            <p className="text-[10px] text-slate-400 truncate">{dn.subtitle}</p>
                          ) : null;
                        })()}
                        <p className="text-[10px] text-muted-foreground">{guestPhone}{guestIdNumber ? ` | ${guestIdNumber}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {r.exceptionallyReserved && (
                        <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-300">{t("exceptionBadge")}</Badge>
                      )}
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${RES_STATUS[r.status]?.color || ""}`}>
                        {resStatusLabel(r.status)}
                      </Badge>
                    </div>
                  </div>
                  {r.room && (
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-10">
                      <span>{r.room && !isDefaultRoomName(r.room.name, r.room.number) ? t("roomWithName", { number: r.room.number, name: r.room.name }) : t("roomPrefix", { number: r.room.number })}</span>
                      <span>{formatDate(r.checkIn)} → {formatDate(r.checkOut)}</span>
                    </div>
                  )}
                  {r.secondGuestName && (
                    <div className="text-[10px] text-muted-foreground pl-10 flex items-center gap-1">
                      <UserPlus className="h-3 w-3" /> {t("secondGuestPrefix")} {r.secondGuestName}{r.secondGuestPhone ? ` (${r.secondGuestPhone})` : ""}
                    </div>
                  )}
                  <div className="flex gap-2 pl-10">
                    {r.status === "UPCOMING" && (() => {
                      const eligibility = getCheckInEligibility(r);
                      if (eligibility.canCheckIn) {
                        return (
                          <Button size="sm" className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => quickCheckin(r)}>
                            <LogIn className="h-3 w-3" /> {t("btnCheckIn")}
                          </Button>
                        );
                      }
                      return (
                        <Button
                          size="sm"
                          disabled
                          title={eligibility.reasonKey ? t(eligibility.reasonKey, eligibility.reasonContext || {}) : ""}
                          className="h-7 text-[10px] gap-1 bg-gray-200 text-gray-400 cursor-not-allowed"
                        >
                          <LogIn className="h-3 w-3 opacity-60" /> {t("btnCheckIn")}
                        </Button>
                      );
                    })()}
                    {r.status === "ACTIVE" && (
                      isCheckoutDue(r.checkOut) ? (
                        <Button size="sm" className="h-7 text-[10px] gap-1 bg-sky-600 hover:bg-sky-700" onClick={() => quickCheckout(r)}>
                          <LogOut className="h-3 w-3" /> {t("btnCheckOut")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-rose-700 border-rose-300 hover:bg-rose-50" onClick={() => setEarlyCheckoutDialog(r)}>
                          <LogOut className="h-3 w-3" /> {t("btnEarlyCheckout", "Early Checkout")}
                        </Button>
                      )
                    )}
                  </div>
                </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 border-b border-slate-200">
                    {selectionMode && (
                      <TableHead className="w-[40px] px-3 py-3">
                        <Checkbox
                          checked={paginated.length > 0 && paginated.every((r) => selectedIds.has(r.id))}
                          onCheckedChange={(checked) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (checked) {
                                paginated.forEach((r) => next.add(r.id));
                              } else {
                                paginated.forEach((r) => next.delete(r.id));
                              }
                              return next;
                            });
                          }}
                        />
                      </TableHead>
                    )}
                    <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("thGuest", "Guest")}</TableHead>
                    {showPhoneId && (
                    <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("thPhoneId", "Phone / ID")}</TableHead>
                    )}
                    <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-[180px]">Room / Status</TableHead>
                    {showSecondGuest && (
                      <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("thSecondGuest", "Second Guest")}</TableHead>
                    )}
                    <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("thStayPeriod", "Stay Period")}</TableHead>
                    <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 text-right">{t("thActions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((r) => {
                    const guest = r.guestId ? guestMap.get(r.guestId) : undefined;
                    // Prefer idNumber from the reservation's nested guest object
                    // (returned by the API), fall back to guestMap lookup.
                    const guestIdNumber = r.guest?.idNumber || guest?.idNumber || "";
                    const guestPhone = r.guest?.phone || guest?.phone || "";
                    const vip = guest?.vip || false;
                    // Compute nights for context under the stay period
                    const nights = (r.checkIn && r.checkOut)
                      ? Math.max(1, Math.ceil((new Date(r.checkOut + "T00:00:00").getTime() - new Date(r.checkIn + "T00:00:00").getTime()) / 86400000))
                      : 0;
                    return (
                    <TableRow
                      key={r.id}
                      className={`group transition-colors border-b border-slate-100 last:border-b-0 ${
                        r.status === "ACTIVE"
                          ? "bg-emerald-50/40 hover:bg-emerald-50/70"
                          : "hover:bg-slate-50/70"
                      }`}
                    >
                      {selectionMode && (
                        <TableCell className="w-[40px] px-3 py-3 align-middle">
                          <Checkbox
                            checked={selectedIds.has(r.id)}
                            onCheckedChange={() => toggleSelect(r.id)}
                            aria-label={`Select reservation ${r.guest?.name || ""}`}
                          />
                        </TableCell>
                      )}
                      {/* Guest */}
                      <TableCell className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <div className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                            r.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200/60"
                            : r.status === "UPCOMING" ? "bg-blue-100 text-blue-700 ring-2 ring-blue-200/60"
                            : "bg-slate-100 text-slate-600"}`}
                          >
                            {(() => {
                              const dn = getGuestDisplayName(r);
                              return (dn.primary || "?").charAt(0).toUpperCase();
                            })()}
                            {vip && (
                              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-white text-[8px] font-bold ring-2 ring-white" title="VIP">★</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-slate-900 truncate max-w-[200px]">
                                {(() => {
                                  const dn = getGuestDisplayName(r);
                                  return dn.primary;
                                })()}
                              </p>
                              {r.exceptionallyReserved && (
                                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-300 px-1.5 py-0">{t("exceptionBadge")}</Badge>
                              )}
                            </div>
                            {(() => {
                              const dn = getGuestDisplayName(r);
                              return dn.subtitle ? (
                                <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{dn.subtitle}</p>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      </TableCell>
                      {/* Phone / ID — optional column */}
                      {showPhoneId && (
                      <TableCell className="px-4 py-3 align-middle">
                        {guestPhone || guestIdNumber ? (
                          <div className="space-y-0.5">
                            {guestPhone && <p className="text-xs font-medium text-slate-700 tabular-nums">{guestPhone}</p>}
                            {guestIdNumber && <p className="text-[10px] text-slate-500 font-mono tracking-tight">{guestIdNumber}</p>}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </TableCell>
                      )}
                      {/* Room / Status */}
                      <TableCell className="px-4 py-3 align-middle">
                        <div className="flex flex-col gap-1.5">
                          {r.room ? (
                            <span className="text-xs font-medium text-slate-700">
                              {r.room && !isDefaultRoomName(r.room.name, r.room.number) ? t("roomWithName", { number: r.room.number, name: r.room.name }) : t("roomPrefix", { number: r.room.number })}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                          <Badge variant="outline" className={`inline-flex items-center gap-1 text-[10px] w-fit px-1.5 py-0.5 font-medium border-0 ${RES_STATUS[r.status]?.color || "bg-slate-100 text-slate-700"}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                            {resStatusLabel(r.status)}
                          </Badge>
                        </div>
                      </TableCell>
                      {/* Second Guest */}
                      {showSecondGuest && (
                        <TableCell className="px-4 py-3 align-middle">
                          {r.secondGuestName ? (
                            <div className="space-y-0.5">
                              <p className="text-xs font-medium text-slate-700">{r.secondGuestName}</p>
                              {r.secondGuestPhone && <p className="text-[10px] text-slate-500 tabular-nums">{r.secondGuestPhone}</p>}
                            </div>
                          ) : r.exceptionallyReserved ? (
                            <span className="text-[10px] text-amber-600 italic">{t("naException")}</span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </TableCell>
                      )}
                      {/* Stay Period */}
                      <TableCell className="px-4 py-3 align-middle">
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium text-slate-700 whitespace-nowrap">
                            {formatDate(r.checkIn)}
                            <span className="text-slate-400 mx-1">→</span>
                            {formatDate(r.checkOut)}
                          </p>
                          {nights > 0 && (
                            <p className="text-[10px] text-slate-500">
                              {nights} {nights === 1 ? "night" : "nights"}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      {/* Actions */}
                      <TableCell className="px-4 py-3 align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* ── Primary action: Check In / Check Out (inline) ── */}
                          {r.status === "UPCOMING" && (() => {
                            const eligibility = getCheckInEligibility(r);
                            if (eligibility.canCheckIn) {
                              return (
                                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400" onClick={() => quickCheckin(r)}>
                                  <LogIn className="h-3 w-3" /> {t("btnCheckIn", "Check In")}
                                </Button>
                              );
                            }
                            const reason = eligibility.reasonKey ? t(eligibility.reasonKey, eligibility.reasonContext || {}) : "Check-in not available";
                            return (
                              <div className="relative group">
                                <Button size="sm" variant="outline" disabled className="h-7 text-[10px] gap-1 text-gray-400 border-gray-200 cursor-not-allowed">
                                  <LogIn className="h-3 w-3 opacity-40" /> {t("btnCheckIn", "Check In")}
                                </Button>
                                <div className="absolute bottom-full right-0 mb-1 hidden group-hover:block z-50">
                                  <div className="rounded-md bg-slate-900 px-2.5 py-1.5 text-[10px] text-white shadow-lg whitespace-nowrap max-w-[280px]">
                                    {reason}
                                    <div className="absolute top-full right-3 h-0 w-0 border-x-4 border-x-transparent border-t-4 border-t-slate-900" />
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {r.status === "ACTIVE" && (
                            isCheckoutDue(r.checkOut) ? (
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-sky-700 border-sky-300 hover:bg-sky-50 hover:border-sky-400" onClick={() => quickCheckout(r)}>
                                <LogOut className="h-3 w-3" /> {t("btnCheckOut", "Check Out")}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-rose-700 border-rose-300 hover:bg-rose-50 hover:border-rose-400" onClick={() => setEarlyCheckoutDialog(r)}>
                                <LogOut className="h-3 w-3" /> {t("btnEarlyCheckout", "Early Checkout")}
                              </Button>
                            )
                          )}

                          {/* ── Secondary actions in ⋮ dropdown ── */}
                          {(r.status === "UPCOMING" || r.status === "ACTIVE") && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => { setPreselectedRoom({ id: "", number: "", name: "", type: "", pricePerNight: 0, intent: "create" }); setCurrentPage("reservations"); }} className="text-violet-700 focus:text-violet-700">
                                  <Pencil className="mr-2 h-4 w-4" /> Edit
                                </DropdownMenuItem>
                                {r.status === "ACTIVE" && (
                                  <DropdownMenuItem onClick={() => openExtendDialog(r)} className="text-sky-700 focus:text-sky-700">
                                    <CalendarPlus className="mr-2 h-4 w-4" /> Extend Stay
                                  </DropdownMenuItem>
                                )}
                                {r.status === "ACTIVE" && !isCheckoutDue(r.checkOut) && (
                                  <DropdownMenuItem onClick={() => setEarlyCheckoutDialog(r)} className="text-rose-700 focus:text-rose-700">
                                    <LogOut className="mr-2 h-4 w-4" /> Early Checkout
                                  </DropdownMenuItem>
                                )}
                                {r.status === "UPCOMING" && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setConfirmAction({ type: "cancel", reservation: r })} className="text-rose-600 focus:text-rose-600">
                                      <XCircle className="mr-2 h-4 w-4" /> Cancel
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {!loading && filtered.length > 0 && (
        <PaginationControls
          currentPage={pagination.currentPage} totalPages={pagination.totalPages}
          pageSize={pagination.pageSize} pageSizeOptions={pagination.pageSizeOptions}
          totalItems={pagination.rangeInfo.total} rangeInfo={pagination.rangeInfo}
          goToPage={pagination.goToPage} setPageSize={pagination.setPageSize}
        />
      )}

      {/* Old New Reservation Dialog removed — now navigates to the full
          Reservations page which has the single-page form with room banner,
          guest search box, collapsible address, capacity-based second
          guest toggle, etc. */}

      {/* ── Check-in / Check-out Confirm ── */}
      {actionInfo && confirmAction && (
        <AlertDialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">{actionInfo.icon} {actionInfo.label}</AlertDialogTitle>
              <AlertDialogDescription>{actionInfo.desc}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={actionLoading}>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction className={actionInfo.cls} onClick={handleAction} disabled={actionLoading}>{actionLoading ? t("btnProcessing") : actionInfo.label}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* ── Extend Stay Dialog ── */}
      <Dialog open={!!extendDialog} onOpenChange={(o) => { if (!o) { setExtendDialog(null); setExtendDate(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-sky-600" />
              Extend Stay
            </DialogTitle>
            <DialogDescription>
              {extendDialog && `Extend checkout for ${extendDialog.guest?.name || "guest"} (Room ${extendDialog.room?.number || "?"}). Current checkout: ${extendDialog.checkOut}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>New Check-out Date</Label>
              <Input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} min={extendDialog ? new Date(new Date(extendDialog.checkOut).getTime() + 86400000).toISOString().split("T")[0] : ""} />
              <p className="text-[10px] text-muted-foreground">Must be after the current checkout date.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExtendDialog(null); setExtendDate(""); }} disabled={extending}>Cancel</Button>
            <Button onClick={handleExtendStay} disabled={extending || !extendDate} className="gap-1.5 bg-sky-600 hover:bg-sky-700">
              {extending ? "Extending..." : "Extend Stay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Early Checkout Dialog ── */}
      <AlertDialog open={!!earlyCheckoutDialog} onOpenChange={() => setEarlyCheckoutDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5 text-rose-600" /> Early Checkout
            </AlertDialogTitle>
            <AlertDialogDescription>
              {earlyCheckoutDialog && `Check out ${earlyCheckoutDialog.guest?.name || "guest"} from Room ${earlyCheckoutDialog.room?.number || "?"} before the scheduled checkout date (${earlyCheckoutDialog.checkOut})?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={earlyCheckingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={handleEarlyCheckout} disabled={earlyCheckingOut}>
              {earlyCheckingOut ? "Checking out..." : "Check Out Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Export Dialog — filter guests by date range + state, then download .xlsx ── */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md mx-4 w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-emerald-600" />
              {t("exportGuests", "Export Guests")}
            </DialogTitle>
            <DialogDescription>
              {t("exportDesc", "Filter guests by date range and state, then download as Excel (.xlsx).")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Date range */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">{t("dateRange", "Date Range")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">{t("from", "From")}</Label>
                  <Input
                    type="date"
                    value={exportFrom}
                    onChange={(e) => setExportFrom(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">{t("to", "To")}</Label>
                  <Input
                    type="date"
                    value={exportTo}
                    onChange={(e) => setExportTo(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {t("dateRangeHint", "Filters by reservation check-in/check-out overlap. Leave empty to include all dates.")}
              </p>
            </div>

            {/* Guest state filter */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">{t("guestState", "Guest State")}</Label>
              <Select value={exportState} onValueChange={(v) => setExportState(v as typeof exportState)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("allGuests", "All Guests")}</SelectItem>
                  <SelectItem value="CHECKED_IN">{t("checkedIn", "Checked In")}</SelectItem>
                  <SelectItem value="UPCOMING">{t("upcoming", "Upcoming")}</SelectItem>
                  <SelectItem value="COMPLETED">{t("completed", "Completed")}</SelectItem>
                  <SelectItem value="CANCELLED">{t("cancelled", "Cancelled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(false)} disabled={exporting}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={handleExport} disabled={exporting} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              <Download className="h-3.5 w-3.5" />
              {exporting ? t("exporting", "Exporting…") : t("export", "Export")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Action Bar ──
          Sticky bottom bar that appears when selectionMode is on and ≥1
          reservation is selected. Shows the count + Check In / Check Out /
          Cancel buttons. (Early Out not exposed here per request — can be
          added later by extending bulkAction's type.) */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl border bg-white shadow-xl px-4 py-3 max-w-[calc(100vw-2rem)] overflow-x-auto">
          <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
            {t("bulkActionBarCount", { count: selectedIds.size })}
          </span>
          <span className="h-6 w-px bg-gray-200" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            onClick={() => setBulkAction("checkin")}
            disabled={bulkLoading}
          >
            <LogIn className="h-3.5 w-3.5" /> {t("btnBulkCheckin")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 text-sky-700 border-sky-300 hover:bg-sky-50"
            onClick={() => setBulkAction("checkout")}
            disabled={bulkLoading}
          >
            <LogOut className="h-3.5 w-3.5" /> {t("btnBulkCheckout")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 text-red-700 border-red-300 hover:bg-red-50"
            onClick={() => setBulkAction("cancel")}
            disabled={bulkLoading}
          >
            <XCircle className="h-3.5 w-3.5" /> {t("btnBulkCancel")}
          </Button>
        </div>
      )}

      {/* ── Bulk Action Confirm Dialog (Check In / Check Out / Cancel) ── */}
      <AlertDialog
        open={!!bulkAction}
        onOpenChange={(open) => { if (!open && !bulkLoading) setBulkAction(null); }}
      >
        <AlertDialogContent>
          <AlertDialogTitle className="flex items-center gap-2">
            {bulkAction === "checkin" ? <LogIn className="h-5 w-5 text-emerald-600" />
              : bulkAction === "cancel" ? <XCircle className="h-5 w-5 text-red-600" />
              : <LogOut className="h-5 w-5 text-sky-600" />}
            {bulkAction === "checkin"
              ? t("confirmBulkCheckinTitle", { count: bulkEligibility.total })
              : bulkAction === "cancel"
                ? t("confirmBulkCancelTitle", { count: bulkEligibility.total })
                : t("confirmBulkCheckoutTitle", { count: bulkEligibility.total })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {bulkAction === "checkin"
              ? t("confirmBulkCheckinDesc", { skipped: bulkEligibility.skipped })
              : bulkAction === "cancel"
                ? t("confirmBulkCancelDesc", { skipped: bulkEligibility.skipped })
                : t("confirmBulkCheckoutDesc", { skipped: bulkEligibility.skipped })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkLoading}>{t("btnCancel")}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className={bulkAction === "checkin"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : bulkAction === "cancel"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-sky-600 hover:bg-sky-700"}
              onClick={(e) => { e.preventDefault(); handleBulkAction(); }}
              disabled={bulkLoading || bulkEligibility.eligible === 0}
            >
              {bulkLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("btnProcessing")}
                </span>
              ) : (
                bulkAction === "checkin" ? t("btnBulkCheckin")
                : bulkAction === "cancel" ? t("btnBulkCancel")
                : t("btnBulkCheckout")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
