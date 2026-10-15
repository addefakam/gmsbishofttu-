"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import {
  apiGetReservations,
  apiCreateReservation,
  apiUpdateReservation,
  apiCheckin,
  apiCheckout,
  apiCancelReservation,
  apiBulkReservationAction,
  apiCreatePayment,
  apiGetGuests,
  apiGetRooms,
  apiCreateGuest,
} from "@/lib/api";
import { formatNationalId, isValidNationalId, isNationalIdType, NATIONAL_ID_PLACEHOLDER, getIdFieldConfig, ID_TYPES } from "@/lib/national-id";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import RoomAvailabilityCalendar from "@/components/ghms/room-availability-calendar";
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  MoreVertical,
  LogIn,
  LogOut,
  XCircle,
  CreditCard,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  User,
  Users,
  BedDouble,
  Clock,
  DollarSign,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  UserPlus,
  UserCheck,
  ChevronsUpDown,
  CalendarPlus,
  Pencil,
  ListChecks,
  Ban,
  Loader2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

import AddressFields from "@/components/shared/address-fields";
import { ethiopianRegions, getLevel2Label } from "@/lib/ethiopian-admin-divisions";
import { COUNTRIES, DEFAULT_NATIONALITY } from "@/lib/countries";
import { NationalityCombobox } from "@/components/shared/nationality-combobox";
import { isValidPhone, isCheckoutDue, isCheckInDue } from "@/lib/utils";
import { calculateStayTotal, formatCostBreakdown } from "@/lib/room-pricing";

interface GuestOption {
  id: string;
  name: string;
  phone: string;
  idNumber?: string;
  address?: string;
  nationality?: string;
  // Individual address fields — present in the raw /api/guests response
  // and used to compose `address` above.
  region?: string;
  zone?: string;
  woreda?: string;
  kebele?: string;
  houseNumber?: string;
  streetName?: string;
}

/** Shape of the JSON error body surfaced by the API client (thrown as message). */
interface ParsedApiError {
  error?: string;
  message?: string;
  code?: string;
  conflict?: {
    roomId: string;
    checkIn: string;
    checkOut: string;
    roomNumber: string;
    roomName?: string;
  };
}

interface RoomOption {
  id: string;
  number: string;
  name: string;
  type: string;
  status: string;
  pricePerNight: number;
  pricePerNightWeekend?: number | null;
  capacity: number;
}

interface Reservation {
  id: string;
  guestId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomRate: number;
  totalCost: number;
  paidAmount: number;
  balance: number;
  paymentStatus: string;
  paymentMethod: string | null;
  status: string;
  notes: string;
  taxAmount: number;
  discountAmount: number;
  actualCheckIn: string | null;
  actualCheckOut: string | null;
  createdAt: string;
  guest?: { id: string; name: string; phone: string };
  room?: { id: string; number: string; name: string; type: string };
  secondGuestName?: string;
  secondGuestPhone?: string;
  secondGuestIdNumber?: string;
  exceptionallyReserved?: boolean;
  exceptionReason?: string;
  // Group booking info — populated by GET /api/reservations via a LEFT JOIN
  // to GroupBooking. Used by getGuestDisplayName() below to swap placeholder
  // "Guest 1", "Guest 2", ... names for the group/organization name.
  groupBookingId?: string | null;
  groupBookingName?: string | null;
}

// ── Display name helper for the Guest column ──
// When a group booking is created via the Quick Group Setup flow, each
// reservation gets a placeholder Guest record ("Guest 1", "Guest 2", ...).
// In the Reservations table we prefer to show the group/organization name
// (e.g. "Bishoftu Police Training Cohort 12") instead of those placeholders,
// because the operator recognizes the org name, not "Guest 7".
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
    return { primary: guestName || "Unknown" };
  }
  // Placeholder name + group present → swap: org is the primary, placeholder is the subtitle.
  if (PLACEHOLDER_GUEST_RE.test(guestName)) {
    return { primary: groupName, subtitle: guestName };
  }
  // Real guest name + group present → keep guest name primary, group as subtitle.
  return { primary: guestName || "Unknown", subtitle: groupName };
}

// ── Check-in eligibility (mirrors the 3 backend gates) ──
//   1. Reservation must be UPCOMING
//   2. Today's date ≥ scheduled checkIn   (not before arrival)
//   3. Today's date ≤ scheduled checkOut   (not after planned checkout)
//   4. Room is not already OCCUPIED (consulted when the caller passes
//      a room status; otherwise the API enforces it server-side)
//
// The web admin's Reservations page doesn't have room.status readily
// accessible for each row, so we skip the room-occupied check on the
// client and rely on the backend's structured 409 response for that
// rare case. Date checks are local (not UTC) to match the operator's
// wall clock for an Ethiopian guesthouse (UTC+3).
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

const STATUS_TABS = ["ALL", "UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED", "FREE_ROOMS"] as const;

// Human-readable labels for each status — used in tab pills, table badges,
// and dropdown menus. Keeps vocabulary consistent: ACTIVE is rendered as
// "Checked-in" everywhere (matches the user-facing terminology).
const STATUS_LABEL: Record<string, string> = {
  ALL: "All",
  UPCOMING: "Upcoming",
  ACTIVE: "Checked-in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FREE_ROOMS: "Free Rooms",
  DELETED: "Deleted",
};

const STATUS_BADGE: Record<string, string> = {
  UPCOMING: "bg-sky-100 text-sky-800 border-sky-200",
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  COMPLETED: "bg-gray-100 text-gray-700 border-gray-200",
  CANCELLED: "bg-rose-100 text-rose-800 border-rose-200",
  DELETED: "bg-orange-100 text-orange-800 border-orange-200",
};

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PARTIAL: "bg-amber-100 text-amber-800 border-amber-200",
  PENDING: "bg-gray-100 text-gray-600 border-gray-200",
};

const PAYMENT_METHODS = ["CASH", "TRANSFER", "CARD", "MOBILE"] as const;

/**
 * Whether a room requires the second-guest section (and the second guest
 * is required unless exceptionally reserved for single occupancy).
 *
 * Rule: any room with capacity >= 2 requires a second guest. This applies
 * regardless of room type — DOUBLE, TWIN, SUITE, DELUXE, KING, STANDARD,
 * STANDARD_SUITE, JUNIOR_SUITE, EXECUTIVE_SUITE, etc. all qualify as long
 * as their capacity field is 2 or more.
 *
 * SINGLE rooms typically have capacity 1 and don't trigger this rule, but
 * if a SINGLE room is configured with capacity 2 (allowed up to max 2), it
 * will also require a second guest for consistency.
 */
function requiresSecondGuest(opts: { type?: string; capacity?: number }): boolean {
  const cap = Number(opts?.capacity) || 0;
  return cap >= 2;
}

/**
 * Collapsible address block.
 *
 * All address fields (region, zone/sub-city, woreda, kebele, house number,
 * street name) AND plate number are bundled under a single toggle row.
 * When collapsed (default), only the toggle is shown. When expanded, all
 * the fields render in a 3-column grid.
 *
 * The toggle bullet shows a live summary of filled fields, so the user can
 * see at a glance what they've entered without expanding.
 */
function CollapsibleAddressFields({
  region,
  zone,
  woreda,
  kebele,
  houseNumber,
  streetName,
  plateNumber,
  weapon,
  onChange,
  labelGuestAddress,
  labelPlateNumber,
  placeholderPlateNumber,
  placeholderZone,
  placeholderWoreda,
  placeholderKebele,
  placeholderHouseNumber,
  placeholderStreetName,
  labelSecurityWeapon,
  placeholderSecurityWeapon,
}: {
  region: string;
  zone: string;
  woreda: string;
  kebele: string;
  houseNumber: string;
  streetName: string;
  plateNumber: string;
  weapon: string;
  onChange: (patch: Partial<{
    region: string;
    zone: string;
    woreda: string;
    kebele: string;
    houseNumber: string;
    streetName: string;
    plateNumber: string;
    weapon: string;
  }>) => void;
  labelGuestAddress: string;
  labelPlateNumber: string;
  placeholderPlateNumber: string;
  placeholderZone: string;
  placeholderWoreda: string;
  placeholderKebele: string;
  placeholderHouseNumber: string;
  placeholderStreetName: string;
  labelSecurityWeapon: string;
  placeholderSecurityWeapon: string;
}) {
  const [open, setOpen] = useState(false);
  const level2Label = region ? getLevel2Label(region) : "Zone/Sub-city";

  // Build a summary string of all filled address fields (used in the toggle).
  const summaryParts = [
    region,
    zone,
    woreda,
    kebele && `Kebele ${kebele}`,
    houseNumber,
    streetName,
    plateNumber && `Plate ${plateNumber}`,
    weapon && `Weapon ${weapon}`,
  ].filter((x) => typeof x === "string" && x.trim().length > 0);
  const hasAny = summaryParts.length > 0;

  return (
    <>
      {/* Toggle row — always visible.
          Designed to fit inline with other fields in a parent grid.
          Layout: bullet + label on top, summary/placeholder below. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-col items-stretch gap-0.5 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-left hover:bg-gray-100 transition-colors min-h-[38px]"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${hasAny ? "bg-emerald-500" : "bg-gray-300"}`}
              aria-hidden
            />
            <span className="text-xs font-semibold text-gray-800 shrink-0">
              {labelGuestAddress}
            </span>
          </div>
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </div>
        {/* Summary line — shows either filled values or the placeholder */}
        <span className="text-[11px] text-gray-500 truncate pl-4">
          {hasAny
            ? summaryParts.join(", ")
            : "Record detail guest information"}
        </span>
      </button>

      {/* Expanded body — full-width below the parent grid row.
          Uses col-span-full so it always takes the full row of the parent grid. */}
      {open && (
        <div className="sm:col-span-3 mt-2 rounded-lg border border-gray-200 bg-white p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Region */}
            <div className="space-y-1.5">
              <Label className="text-xs">Region</Label>
              <Select
                value={region}
                onValueChange={(v) => onChange({ region: v })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {ethiopianRegions.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Zone / Sub-city */}
            <div className="space-y-1.5">
              <Label className="text-xs">{level2Label}</Label>
              <Input
                placeholder={placeholderZone}
                value={zone}
                onChange={(e) => onChange({ zone: e.target.value })}
                className="h-9"
              />
            </div>

            {/* Woreda */}
            <div className="space-y-1.5">
              <Label className="text-xs">Woreda</Label>
              <Input
                placeholder={placeholderWoreda}
                value={woreda}
                onChange={(e) => onChange({ woreda: e.target.value })}
                className="h-9"
              />
            </div>

            {/* Kebele */}
            <div className="space-y-1.5">
              <Label className="text-xs">Kebele</Label>
              <Input
                placeholder={placeholderKebele}
                value={kebele}
                onChange={(e) => onChange({ kebele: e.target.value })}
                className="h-9"
              />
            </div>

            {/* House Number */}
            <div className="space-y-1.5">
              <Label className="text-xs">House No.</Label>
              <Input
                placeholder={placeholderHouseNumber}
                value={houseNumber}
                onChange={(e) => onChange({ houseNumber: e.target.value })}
                className="h-9"
              />
            </div>

            {/* Street Name */}
            <div className="space-y-1.5">
              <Label className="text-xs">Street Name</Label>
              <Input
                placeholder={placeholderStreetName}
                value={streetName}
                onChange={(e) => onChange({ streetName: e.target.value })}
                className="h-9"
              />
            </div>
          </div>

          {/* Plate number — on its own row, still inside the address block */}
          <div className="space-y-1.5">
            <Label className="text-xs">{labelPlateNumber}</Label>
            <Input
              placeholder={placeholderPlateNumber}
              value={plateNumber}
              onChange={(e) => onChange({ plateNumber: e.target.value })}
              className="h-9"
            />
          </div>

          {/* Security weapon — last field inside the address block */}
          <div className="space-y-1.5">
            <Label className="text-xs">{labelSecurityWeapon}</Label>
            <Input
              placeholder={placeholderSecurityWeapon}
              value={weapon}
              onChange={(e) => onChange({ weapon: e.target.value })}
              className="h-9"
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Self-contained guest search box with always-visible filtered dropdown.
 *
 * Replaces the Radix Popover + cmdk Command pattern, which:
 * - had empty-value filtering issues when guests had blank name/phone
 * - lost input focus when nested inside a Dialog (Radix focus trap)
 *
 * This component manages its own "open" state based on focus + click-outside,
 * so it works reliably inside dialogs.
 */
function GuestSearchBox({
  value,
  onChange,
  onPick,
  guests,
  totalGuests,
  loading,
  placeholder,
  emptyText,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (g: GuestOption) => void;
  guests: GuestOption[];
  totalGuests: number;
  loading: boolean;
  placeholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click-outside. Use mousedown (not click) so we catch the
  // event before focus moves elsewhere.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="flex items-center border border-input rounded-md bg-white px-3 h-10 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 pointer-events-none" />
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          style={{
            height: "36px",
            width: "100%",
            backgroundColor: "transparent",
            border: "none",
            outline: "none",
            fontSize: "14px",
            color: "inherit",
          }}
          className="placeholder:text-muted-foreground"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="ml-2 text-xs text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-[10000] mt-1 w-full rounded-md border border-input bg-white shadow-lg"
          style={{ minWidth: "100%" }}
        >
          <div className="max-h-60 overflow-y-auto p-1">
            {guests.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {loading ? "Loading guests…" : emptyText}
              </div>
            ) : (
              guests.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onPick(g);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                >
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{g.name || "(no name)"}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{g.phone}</span>
                </button>
              ))
            )}
          </div>
          {totalGuests > 50 && (
            <div className="border-t px-2 py-1 text-[10px] text-muted-foreground">
              Showing first 50 of {totalGuests} guests. Refine your search to see more.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReservationsPage() {
  const { t } = useTranslation("reservations");
  const { refreshKey, triggerRefresh, preselectedRoom, setPreselectedRoom, setCurrentPage, setAccommodationTab } = useAppStore();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [allGuests, setAllGuests] = useState<GuestOption[]>([]);
  const [allRooms, setAllRooms] = useState<RoomOption[]>([]);
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [guestSearch, setGuestSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Create dialog — single page form (guest + booking on one screen)
  const [createOpen, setCreateOpen] = useState(false);

  // Step 1 — guest selection / creation
  const [guestMode, setGuestMode] = useState<"existing" | "new">("existing");
  const [selectedGuestId, setSelectedGuestId] = useState("");
  const [newGuestForm, setNewGuestForm] = useState({
    name: "",
    phone: "",
    email: "",
    idNumber: "",
    idType: "National ID",
    nationality: DEFAULT_NATIONALITY,
    region: "",
    zone: "",
    woreda: "",
    kebele: "",
    houseNumber: "",
    streetName: "",
    plateNumber: "",
    weapon: "",
    notes: "",
  });

  // Step 2 — booking details
  const [createForm, setCreateForm] = useState({
    roomId: "",
    checkIn: "",
    checkOut: "",
    notes: "",
    secondGuestName: "",
    secondGuestPhone: "",
    secondGuestIdNumber: "",
    exceptionallyReserved: false,
    exceptionReason: "",
    hasSecondGuest: false,
  });
  const [creating, setCreating] = useState(false);


  // Payment dialog
  const [paymentDialog, setPaymentDialog] = useState<Reservation | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    method: "CASH",
    referenceNo: "",
    notes: "",
  });
  const [paying, setPaying] = useState(false);

  // Edit dialog (pending / active reservations only — enforced by API too)
  const [editTarget, setEditTarget] = useState<Reservation | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    guestId: "",
    roomId: "",
    checkIn: "",
    checkOut: "",
    roomRate: "",
    taxAmount: "",
    discountAmount: "",
    paymentMethod: "CASH",
    notes: "",
  });
  const [editGuestOpen, setEditGuestOpen] = useState(false);

  // Action confirmations
  const [confirmAction, setConfirmAction] = useState<{
    type: "checkin" | "checkout" | "cancel";
    reservation: Reservation;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ── Extend Stay ──
  const [extendDialog, setExtendDialog] = useState<Reservation | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [extending, setExtending] = useState(false);

  // ── Early Checkout ──
  const [earlyCheckoutDialog, setEarlyCheckoutDialog] = useState<Reservation | null>(null);
  const [earlyCheckingOut, setEarlyCheckingOut] = useState(false);

  // ── Bulk Actions (multi-select Check In / Check Out / Early Out / Cancel) ──
  // selectionMode: when true, each row/card shows a checkbox and a sticky
  // action bar appears at the bottom with the 4 bulk action buttons.
  // selectedIds: the set of reservation IDs currently checked.
  // bulkAction: when set, an AlertDialog is shown asking the user to confirm
  //   the bulk action before firing the API call.
  // bulkLoading: spinner state on the confirm button.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"checkin" | "checkout" | "earlyout" | "cancel" | null>(null);
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

  // Eligibility counts for the confirm dialog's "X not eligible and will
  // be skipped" hint. Mirrors the server-side checks so the user gets an
  // accurate pre-flight estimate before confirming.
  const bulkEligibility = useMemo(() => {
    const selected = reservations.filter((r) => selectedIds.has(r.id));
    let eligible = 0;
    let skipped = 0;
    for (const r of selected) {
      let ok = false;
      if (bulkAction === "checkin") {
        // Same checks as the bulk endpoint: must be UPCOMING, today must be
        // within [checkIn, checkOut]. Room-occupied check is server-side
        // only — we don't have the live room status here cheaply.
        ok = r.status === "UPCOMING" && isCheckInDue(r.checkIn);
      } else if (bulkAction === "checkout") {
        ok = r.status === "ACTIVE" && isCheckoutDue(r.checkOut);
      } else if (bulkAction === "earlyout") {
        ok = r.status === "ACTIVE";
      } else if (bulkAction === "cancel") {
        ok = r.status === "UPCOMING" || r.status === "ACTIVE";
      }
      if (ok) eligible++;
      else skipped++;
    }
    return { eligible, skipped, total: selected.length };
  }, [reservations, selectedIds, bulkAction]);

  const handleBulkAction = async () => {
    if (!bulkAction) return;
    const selectedIdsArray = Array.from(selectedIds);
    if (selectedIdsArray.length === 0) return;

    // Map the UI action to the API action. "earlyout" maps to "checkout"
    // server-side (same behavior — the distinction is purely client UX).
    const apiAction: "checkin" | "checkout" | "cancel" =
      bulkAction === "earlyout" ? "checkout" : bulkAction;

    try {
      setBulkLoading(true);
      const result = await apiBulkReservationAction(selectedIdsArray, apiAction) as {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bulk action failed";
      toast.error(msg);
    } finally {
      setBulkLoading(false);
    }
  };

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
      triggerRefresh();
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
      triggerRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to check out");
    } finally {
      setEarlyCheckingOut(false);
    }
  };

  // Room conflict dialog
  const [conflictInfo, setConflictInfo] = useState<{ roomNumber: string; roomName: string; checkIn: string; checkOut: string } | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const pageSize = 15;

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [resData, guestData, roomData] = await Promise.all([
        apiGetReservations(),
        apiGetGuests(),
        apiGetRooms(),
      ]);
      setReservations(Array.isArray(resData) ? resData : []);
      setAllGuests((Array.isArray(guestData) ? guestData : []).map((g: GuestOption) => {
        // Compose a single address string from individual fields returned
        // by /api/guests (region, zone, woreda, kebele, houseNumber, streetName).
        // The API does not return a pre-composed 'address' field.
        const addrParts = [
          g.region,
          g.zone,
          g.woreda,
          g.kebele,
          g.houseNumber,
          g.streetName,
        ]
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim());
        return {
          id: g.id,
          name: g.name,
          phone: g.phone,
          idNumber: g.idNumber,
          address: addrParts.length > 0 ? addrParts.join(", ") : "",
          nationality: g.nationality,
        };
      }));
      // apiGetRooms already unwraps { rooms: [...] } to a plain array
      const rawRooms = Array.isArray(roomData) ? roomData : [];
      setAllRooms(
        rawRooms.map((r: RoomOption) => ({
          id: r.id,
          number: r.number,
          name: r.name,
          type: r.type,
          status: r.status,
          pricePerNight: r.pricePerNight,
          pricePerNightWeekend: (r as { pricePerNightWeekend?: number | null }).pricePerNightWeekend ?? null,
          capacity: Number(r.capacity) || 1,
        }))
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load data";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshKey]);

  // When a room is pre-selected from the Rooms page, open the create
  // reservation dialog directly with that room pre-filled — matching the
  // mobile app's behavior of landing the user straight on the guest
  // registration form for the chosen room.
  const [highlightRoomId, setHighlightRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedRoom) {
      setHighlightRoomId(preselectedRoom.id);
      // Only auto-open the create dialog when the user clicked "Reserve" on
      // an available room (intent === "create", the default). When they
      // clicked "Manage Reservations" on an already-reserved room
      // (intent === "manage"), just highlight the matching reservations —
      // they want to see existing ones, not start a new booking.
      if (preselectedRoom.intent !== "manage") {
        setCreateForm((f) =>
          f.roomId === preselectedRoom.id
            ? f
            : { ...f, roomId: preselectedRoom.id }
        );
        // Reset guest selection so the form starts fresh.
        setGuestMode("existing");
        setSelectedGuestId("");
        setGuestSearch("");
        setNewGuestForm({ name: "", phone: "", email: "", idNumber: "", idType: "National ID", nationality: DEFAULT_NATIONALITY, region: "", zone: "", woreda: "", kebele: "", houseNumber: "", streetName: "", plateNumber: "", weapon: "", notes: "" });
        setCreateOpen(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedRoom]);

  // Clear highlight on user interaction (tab change, status filter, search)
  const clearHighlight = () => {
    setHighlightRoomId(null);
    setPreselectedRoom(null);
  };

  // The room banner at the top of the dialog reflects the CURRENTLY selected
  // room (from the room dropdown), not just the preselected one. When the
  // user changes the room via the dropdown, the banner updates to match.
  const bannerRoom = useMemo(() => {
    if (createForm.roomId) {
      const r = allRooms.find((x) => x.id === createForm.roomId);
      if (r) {
        return {
          id: r.id,
          number: r.number,
          name: r.name,
          type: r.type,
          pricePerNight: r.pricePerNight,
          pricePerNightWeekend: r.pricePerNightWeekend ?? null,
        };
      }
    }
    // Fall back to preselectedRoom if no room is selected in the form yet
    if (preselectedRoom && preselectedRoom.intent !== "manage") {
      return preselectedRoom;
    }
    return null;
  }, [createForm.roomId, allRooms, preselectedRoom]);

  // Rooms offered for new reservations: every bookable room. Availability is
  // date-driven — occupied days are disabled in the calendar and the server
  // rejects overlapping stays — so a room flagged OCCUPIED/RESERVED (stale or
  // in-house guest) must still be selectable for future free dates.
  // Only MAINTENANCE rooms are excluded from booking.
  const availableRooms = useMemo(
    () => allRooms.filter((r) => r.status !== "MAINTENANCE"),
    [allRooms]
  );

  // When the selected ROOM changes, auto-set hasSecondGuest based on capacity.
  // Rooms with capacity >= 2 default to "Two guests" (second guest fields shown).
  // Rooms with capacity 1 default to "One guest only".
  // The user can still toggle manually afterward — this effect only fires
  // when the room ID actually changes, NOT when hasSecondGuest changes.
  // (If hasSecondGuest were in the deps, the effect would re-run every time
  // the user toggles, immediately overriding their manual choice — a
  // feedback loop that makes it impossible to switch to "One guest only"
  // on a capacity-2 room.)
  const prevRoomIdRef = useRef<string>("");
  useEffect(() => {
    if (!createForm.roomId) return;
    // Only run when the room ID actually changed — skip if it's the same.
    if (prevRoomIdRef.current === createForm.roomId) return;
    prevRoomIdRef.current = createForm.roomId;

    const selRoom = allRooms.find((r) => r.id === createForm.roomId);
    if (!selRoom) return;
    const cap = Number(selRoom.capacity) || 1;
    const shouldHaveSecond = cap >= 2;
    if (shouldHaveSecond) {
      setCreateForm((f) => ({ ...f, hasSecondGuest: true }));
    } else {
      setCreateForm((f) => ({
        ...f,
        hasSecondGuest: false,
        secondGuestName: "",
        secondGuestPhone: "",
        secondGuestIdNumber: "",
      }));
    }
  }, [createForm.roomId, allRooms]);

  // Client-side filtered guest list for the existing-guest search dropdown.
  // Searches across name, phone, and ID number (case-insensitive).
  // Limited to 50 results to keep the dropdown snappy on large guest lists.
  const filteredGuests = useMemo(() => {
    const q = guestSearch.trim().toLowerCase();
    if (!q) return allGuests.slice(0, 50);
    return allGuests
      .filter((g) => {
        const name = (g.name || "").toLowerCase();
        const phone = (g.phone || "").toLowerCase();
        const idNum = (g.idNumber || "").toLowerCase();
        return name.includes(q) || phone.includes(q) || idNum.includes(q);
      })
      .slice(0, 50);
  }, [allGuests, guestSearch]);

  // Computed nights and total for create form
  const createNights = useMemo(() => {
    if (!createForm.checkIn || !createForm.checkOut) return 0;
    const diff = new Date(createForm.checkOut).getTime() - new Date(createForm.checkIn).getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [createForm.checkIn, createForm.checkOut]);

  const createRate = useMemo(() => {
    const room = allRooms.find((r) => r.id === createForm.roomId);
    return room ? room.pricePerNight : 0;
  }, [createForm.roomId, allRooms]);

  // Weekend-aware cost preview — uses calculateStayTotal which iterates each
  // night and picks the weekday or weekend (Fri+Sat) rate based on the day
  // of week. When no weekend price is set on the room, this falls back to
  // the standard flat rate for every night (backward compatible).
  const createTotal = useMemo(() => {
    if (!createForm.checkIn || !createForm.checkOut || !createForm.roomId) return 0;
    const room = allRooms.find((r) => r.id === createForm.roomId);
    if (!room) return 0;
    return calculateStayTotal(createForm.checkIn, createForm.checkOut, {
      pricePerNight: room.pricePerNight,
      pricePerNightWeekend: room.pricePerNightWeekend,
    });
  }, [createForm.checkIn, createForm.checkOut, createForm.roomId, allRooms]);

  const step1Valid = useMemo(() => {
    if (guestMode === "existing") return !!selectedGuestId;
    return !!(
      newGuestForm.name.trim() &&
      newGuestForm.phone.trim() &&
      newGuestForm.nationality.trim() &&
      newGuestForm.idType &&
      newGuestForm.idNumber.trim()
    );
  }, [guestMode, selectedGuestId, newGuestForm.name, newGuestForm.phone, newGuestForm.nationality, newGuestForm.idType, newGuestForm.idNumber]);

  // ── Live guest lookup by phone number ──
  // When the operator types a phone in "New Guest" mode, auto-search
  // the existing guests list for a match. If found, show a hint banner
  // so the operator knows the system will reuse the existing record
  // instead of creating a duplicate (the backend's find-or-create logic
  // handles this automatically — this is just a UX heads-up).
  const phoneMatch = useMemo(() => {
    if (guestMode !== "new") return null;
    const q = newGuestForm.phone.trim();
    if (q.length < 7) return null;
    return allGuests.find((g) => g.phone === q) || null;
  }, [guestMode, newGuestForm.phone, allGuests]);

  // Local calendar date (YYYY-MM-DD) — same key used by the rooms page.
  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Free Rooms tab (replaced the old Deleted tab): rooms with nothing
  // blocking today — same date-aware logic as the rooms page. A room is
  // totally free when no guest is checked in, it is not under maintenance,
  // and no upcoming booking covers today or a later date.
  const freeRooms = useMemo(() => {
    const activeRoomIds = new Set(
      reservations.filter((r) => r.status === "ACTIVE" && r.roomId).map((r) => r.roomId)
    );
    const earliestUpcoming: Record<string, string> = {};
    for (const r of reservations
      .filter((x) => x.status === "UPCOMING" && x.roomId)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))) {
      if (!earliestUpcoming[r.roomId]) earliestUpcoming[r.roomId] = r.checkOut;
    }
    return allRooms.filter((room) => {
      if (activeRoomIds.has(room.id)) return false;
      if (room.status === "MAINTENANCE") return false;
      const upCheckOut = earliestUpcoming[room.id];
      if (upCheckOut && upCheckOut > todayKey) return false;
      return true;
    });
  }, [allRooms, reservations, todayKey]);

  // Filtered reservations
  const filtered = useMemo(() => {
    let list = reservations;
    if (statusFilter === "FREE_ROOMS") {
      return [];
    }
    if (statusFilter !== "ALL") {
      list = list.filter((r) => r.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.guest?.name?.toLowerCase().includes(q) ||
          r.groupBookingName?.toLowerCase().includes(q) ||
          r.room?.number?.toLowerCase().includes(q) ||
          r.room?.name?.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q)
      );
    }
    // Sort order (operator's natural workflow):
    //   1. UPCOMING + check-in due (today or past)  — TOP
    //      Guests who were supposed to arrive today or earlier but haven't
    //      checked in yet. Longest-overdue first (oldest checkIn on top).
    //   2. ACTIVE                                    — MIDDLE
    //      Currently in-house guests. Most recent check-in first.
    //   3. UPCOMING + check-in in the future          — BOTTOM
    //      Future bookings. Soonest first (next arrival on top).
    //   4. COMPLETED / CANCELLED / DELETED             — BELOW ALL
    //      Historical/archive rows. Most recent first.
    list = list.slice().sort((a, b) => {
      const aCheckInDue = a.status === "UPCOMING" && isCheckInDue(a.checkIn);
      const bCheckInDue = b.status === "UPCOMING" && isCheckInDue(b.checkIn);
      // Group 1 (UPCOMING + due) before everything else
      if (aCheckInDue && !bCheckInDue) return -1;
      if (!aCheckInDue && bCheckInDue) return 1;
      if (aCheckInDue && bCheckInDue) {
        // Both due — longest-overdue first (oldest checkIn on top)
        return (a.checkIn || "").localeCompare(b.checkIn || "");
      }
      // Neither is UPCOMING-due — sort ACTIVE above UPCOMING-future
      // above COMPLETED/CANCELLED/DELETED.
      const aPri = a.status === "ACTIVE" ? 2
        : a.status === "UPCOMING" ? 1
        : 0;
      const bPri = b.status === "ACTIVE" ? 2
        : b.status === "UPCOMING" ? 1
        : 0;
      if (aPri !== bPri) return bPri - aPri;
      // Within the same priority group, sort by check-in date:
      //   - UPCOMING (future):  ascending  — soonest first (next arrival on top)
      //   - ACTIVE:              descending — most recent first (newest in-house on top)
      //   - COMPLETED/CANCELLED/DELETED: descending — most recent first
      if (a.status === "UPCOMING") {
        return (a.checkIn || "").localeCompare(b.checkIn || "");
      }
      return (b.checkIn || "").localeCompare(a.checkIn || "");
    });
    return list;
  }, [reservations, statusFilter, search]);

  // Free-rooms list respects the search box (room number, name, or type).
  const filteredFreeRooms = useMemo(() => {
    if (statusFilter !== "FREE_ROOMS") return [];
    if (!search) return freeRooms;
    const q = search.toLowerCase();
    return freeRooms.filter(
      (room) =>
        room.number.toLowerCase().includes(q) ||
        room.name.toLowerCase().includes(q) ||
        room.type.toLowerCase().includes(q)
    );
  }, [statusFilter, freeRooms, search]);

  const isFreeRoomsView = statusFilter === "FREE_ROOMS";
  const viewCount = isFreeRoomsView ? filteredFreeRooms.length : filtered.length;
  const totalPages = Math.ceil(viewCount / pageSize);
  const pagedReservations = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const pagedFreeRooms = filteredFreeRooms.slice(page * pageSize, (page + 1) * pageSize);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "ETB", maximumFractionDigits: 0 }).format(val);

  const formatDateShort = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return dateStr; }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const handleCreate = async () => {
    // ── All validation BEFORE setting creating=true ──
    if (!createForm.roomId || !createForm.checkIn || !createForm.checkOut) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (createNights < 1) {
      toast.error("Check-out must be after check-in");
      return;
    }
    if (guestMode === "new" && (!newGuestForm.name || !newGuestForm.name.trim())) {
      toast.error("Guest full name is required");
      return;
    }
    if (guestMode === "new" && (!newGuestForm.phone || !newGuestForm.phone.trim())) {
      toast.error("Guest phone is required");
      return;
    }
    if (guestMode === "new" && !isValidPhone(newGuestForm.phone)) {
      toast.error("Invalid guest phone number format (7-15 digits)");
      return;
    }
    if (guestMode === "new" && (!newGuestForm.nationality || !newGuestForm.nationality.trim())) {
      toast.error("Guest nationality is required");
      return;
    }
    if (guestMode === "new" && (!newGuestForm.idType || newGuestForm.idType === "")) {
      toast.error("Guest ID type is required");
      return;
    }
    if (guestMode === "new" && (!newGuestForm.idNumber || !newGuestForm.idNumber.trim())) {
      toast.error("Guest ID number is required");
      return;
    }
    if (guestMode === "new" && newGuestForm.idNumber.trim().length < 4) {
      toast.error("ID number is too short. Please enter a valid ID number.");
      return;
    }
    // National ID validation — 16 digits in "FAN XX XX XX XX XX XX XX XX" format
    if (guestMode === "new" && isNationalIdType(newGuestForm.idType) && !isValidNationalId(newGuestForm.idNumber)) {
      toast.error("National ID must be 16 digits in FAN format (e.g. FAN 12 34 56 78 90 12 34 56)");
      return;
    }
    if (guestMode !== "new" && !selectedGuestId) {
      toast.error("Please select or create a guest");
      return;
    }
    const selRoom = allRooms.find((r) => r.id === createForm.roomId);
    // Second guest is NOT mandatory for any room type. It's only required
    // if the user explicitly toggled "Two guests" on.
    if (createForm.hasSecondGuest) {
      if (!createForm.secondGuestName.trim() || !createForm.secondGuestPhone.trim()) {
        toast.error("Second guest name and phone are required");
        return;
      }
      if (!isValidPhone(createForm.secondGuestPhone)) {
        toast.error("Invalid second guest phone number format (7-15 digits)");
        return;
      }
    }
    if (createForm.exceptionallyReserved && !createForm.exceptionReason.trim()) {
      toast.error("Please provide the exception reason");
      return;
    }

    // ── All validation passed — now make API calls ──


    try {
      setCreating(true);

      // Determine guestId: use existing or create new.
      // The backend's POST /api/guests now implements find-or-create by
      // phone number — if a guest with the same phone + providerId
      // already exists, it UPDATEs that guest (enriches empty fields)
      // and returns it with _reused: true instead of creating a
      // duplicate. So the operator never needs to manually check for
      // duplicates — the system handles it automatically.
      let guestId = selectedGuestId;
      if (guestMode === "new") {
        const created = await apiCreateGuest({
          ...newGuestForm,
        });
        guestId = created.id;
        // Show a heads-up toast if the system reused an existing guest
        // instead of creating a new one — the operator should know that
        // their form data enriched the existing record.
        if ((created as Record<string, unknown>)._reused) {
          toast.info(`Existing guest "${created.name}" found — record enriched and reused.`);
        }
      } else if (selRoom?.type === "FAMILY" && guestId) {
        // Existing guest as leader — best-effort role update
        try {
          await fetch(`/api/guests/${guestId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ role: "LEADER" }),
          });
        } catch { /* non-blocking */ }
      }

      if (!guestId) {
        toast.error("Please select or create a guest");
        return;
      }

      await apiCreateReservation({
        guestId,
        roomId: createForm.roomId,
        checkIn: createForm.checkIn,
        checkOut: createForm.checkOut,
        notes: createForm.notes,
        secondGuestName: createForm.secondGuestName,
        secondGuestPhone: createForm.secondGuestPhone,
        secondGuestIdNumber: createForm.secondGuestIdNumber,
        exceptionallyReserved: createForm.exceptionallyReserved,
        exceptionReason: createForm.exceptionReason,      });

      toast.success("Guest and reservation created successfully");
      closeCreateDialog();
      triggerRefresh();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Failed to create reservation";
      let parsed: ParsedApiError | null = null;
      try { parsed = JSON.parse(raw); } catch {}
      // req() throws only the `error` field — a 409 surfaces as the bare
      // string "ROOM_CONFLICT", so fall back to the chosen form values for
      // the conflict dialog details.
      if (raw === "ROOM_CONFLICT" || (parsed?.code === "ROOM_CONFLICT" && parsed.conflict)) {
        const chosen = allRooms.find((x) => x.id === createForm.roomId);
        setCreateOpen(false);
        setConflictInfo({
          roomNumber: parsed?.conflict?.roomNumber || chosen?.number || "",
          roomName: parsed?.conflict?.roomName || chosen?.name || "",
          checkIn: parsed?.conflict?.checkIn || createForm.checkIn,
          checkOut: parsed?.conflict?.checkOut || createForm.checkOut,
        });
        return;
      }
      toast.error(parsed?.error || raw || "Failed to create reservation");
    } finally {
      setCreating(false);
    }
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setGuestMode("existing");
    setSelectedGuestId("");
    setGuestSearch("");
    setNewGuestForm({ name: "", phone: "", email: "", idNumber: "", idType: "National ID", nationality: DEFAULT_NATIONALITY, region: "", zone: "", woreda: "", kebele: "", houseNumber: "", streetName: "", plateNumber: "", weapon: "", notes: "" });
    setCreateForm({ roomId: "", checkIn: "", checkOut: "", notes: "", secondGuestName: "", secondGuestPhone: "", secondGuestIdNumber: "", exceptionallyReserved: false, exceptionReason: "", hasSecondGuest: false });
    // Read preselectedRoom directly from the store to avoid stale closures.
    const currentPreselected = useAppStore.getState().preselectedRoom;
    // If the dialog was opened from the Accommodation page (either from the
    // Reservations tab's "New Reservation" button with empty id, or from
    // the Rooms tab's "Reserve" button with a real room id), navigate back
    // to the Accommodation page on the appropriate tab.
    if (currentPreselected && currentPreselected.intent === "create") {
      // Came from Rooms tab (real room id) → return to Rooms tab
      if (currentPreselected.id !== "") {
        useAppStore.getState().setAccommodationTab("rooms");
      } else {
        // Came from Reservations tab (empty id) → return to Reservations tab
        useAppStore.getState().setAccommodationTab("reservations");
      }
      useAppStore.getState().setCurrentPage("accommodation");
    }
    setPreselectedRoom(null);
  };

  const handleAction = async () => {
    if (!confirmAction) return;
    const { type, reservation } = confirmAction;
    if (type === "cancel" && (reservation.status === "COMPLETED" || reservation.status === "CANCELLED" || reservation.status === "DELETED")) {
      toast.error("Cannot cancel a completed, cancelled, or deleted reservation");
      setConfirmAction(null);
      return;
    }
    try {
      setActionLoading(true);
      if (type === "checkin") {
        await apiCheckin(reservation.id);
        toast.success("Guest checked in successfully");
      } else if (type === "checkout") {
        await apiCheckout(reservation.id);
        toast.success("Guest checked out successfully");
      } else if (type === "cancel") {
        await apiCancelReservation(reservation.id);
        toast.success("Reservation cancelled");
      }
      setConfirmAction(null);
      triggerRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to ${type}`;
      // ── Stale-state detection ──
      // If the API says the reservation can't be cancelled / checked-in /
      // checked-out because its status already changed (cancelled by
      // another tab/device/cron, or already checked in/out elsewhere),
      // the raw error message ("Cannot cancel a reservation with status
      // 'CANCELLED'") is cryptic and unactionable. Replace it with a
      // friendly explanation, CLOSE the confirm dialog (retrying won't
      // help — the state is now terminal), and trigger a refresh so the
      // list reflects the actual status.
      const isStaleCancel = type === "cancel"
        && /Cannot cancel a reservation with status/i.test(message);
      const isStaleCheckin = type === "checkin"
        && /Cannot check.?in a reservation with status/i.test(message);
      const isStaleCheckout = type === "checkout"
        && /Cannot check.?out a reservation with status/i.test(message);
      if (isStaleCancel || isStaleCheckin || isStaleCheckout) {
        const friendlyKey = isStaleCancel
          ? "toastCancelStaleState"
          : isStaleCheckin
            ? "toastCheckinStaleState"
            : "toastCheckoutStaleState";
        toast.error(t(friendlyKey, { defaultValue: "This reservation's status has changed. Refreshing the list…" }));
        setConfirmAction(null);
        triggerRefresh();
      } else {
        toast.error(message);
        // Keep the dialog open on error so the user can see what went wrong
        // and retry. Only close on success (above) or cancel.
      }
    } finally {
      setActionLoading(false);
    }
  };

  const openEdit = (res: Reservation) => {
    setEditForm({
      guestId: res.guestId,
      roomId: res.roomId,
      checkIn: String(res.checkIn || "").slice(0, 10),
      checkOut: String(res.checkOut || "").slice(0, 10),
      roomRate: String(res.roomRate ?? 0),
      taxAmount: String(res.taxAmount ?? 0),
      discountAmount: String(res.discountAmount ?? 0),
      paymentMethod: res.paymentMethod || "CASH",
      notes: res.notes || "",
    });
    setEditTarget(res);
  };

  // Live price preview while editing — mirrors the server-side recompute
  const editPreview = useMemo(() => {
    const inDay = editForm.checkIn;
    const outDay = editForm.checkOut;
    let nights = 0;
    if (inDay && outDay && outDay > inDay) {
      nights = Math.max(1, Math.ceil((new Date(outDay).getTime() - new Date(inDay).getTime()) / 86400000));
    }
    const rate = Number(editForm.roomRate) || 0;
    const tax = Number(editForm.taxAmount) || 0;
    const discount = Number(editForm.discountAmount) || 0;
    // If the operator passed a custom roomRate (e.g. manually negotiated),
    // use the simple rate × nights formula. Otherwise use the weekend-aware
    // calculation that picks the weekday or Fri+Sat rate per night.
    let subtotal: number;
    if (rate > 0) {
      subtotal = rate * nights;
    } else if (inDay && outDay && editForm.roomId) {
      const room = allRooms.find((r) => r.id === editForm.roomId);
      if (room) {
        subtotal = calculateStayTotal(inDay, outDay, {
          pricePerNight: room.pricePerNight,
          pricePerNightWeekend: room.pricePerNightWeekend,
        });
      } else {
        subtotal = 0;
      }
    } else {
      subtotal = 0;
    }
    const total = nights > 0 ? subtotal + tax - discount : 0;
    const paid = editTarget?.paidAmount ?? 0;
    return { nights, subtotal, total, paid, balance: total - paid, valid: nights > 0 };
  }, [editForm.checkIn, editForm.checkOut, editForm.roomRate, editForm.taxAmount, editForm.discountAmount, editTarget, editForm.roomId, allRooms]);

  const handleEditSave = async () => {
    if (!editTarget) return;
    if (!editForm.guestId || !editForm.roomId || !editForm.checkIn || !editForm.checkOut) {
      toast.error(t("editMissingFields"));
      return;
    }
    if (editForm.checkOut <= editForm.checkIn) {
      toast.error(t("editDateOrder"));
      return;
    }
    try {
      setEditSaving(true);
      await apiUpdateReservation(editTarget.id, {
        guestId: editForm.guestId,
        roomId: editForm.roomId,
        checkIn: editForm.checkIn,
        checkOut: editForm.checkOut,
        roomRate: Number(editForm.roomRate) || 0,
        taxAmount: Number(editForm.taxAmount) || 0,
        discountAmount: Number(editForm.discountAmount) || 0,
        paymentMethod: editForm.paymentMethod || null,
        notes: editForm.notes,
      });
      toast.success(t("reservationUpdated"));
      setEditTarget(null);
      triggerRefresh();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Failed to update reservation";
      let parsed: ParsedApiError | null = null;
      try { parsed = JSON.parse(raw); } catch {}
      // req() throws only the `error` field — a 409 surfaces as the bare
      // string "ROOM_CONFLICT", so fall back to the edited form values for
      // the conflict dialog details.
      if (raw === "ROOM_CONFLICT" || (parsed?.code === "ROOM_CONFLICT" && parsed.conflict)) {
        const chosen = allRooms.find((x) => x.id === editForm.roomId);
        setEditTarget(null);
        setConflictInfo({
          roomNumber: parsed?.conflict?.roomNumber || chosen?.number || "",
          roomName: parsed?.conflict?.roomName || chosen?.name || "",
          checkIn: parsed?.conflict?.checkIn || editForm.checkIn,
          checkOut: parsed?.conflict?.checkOut || editForm.checkOut,
        });
        return;
      }
      toast.error(parsed?.error || raw || t("editFailed"));
    } finally {
      setEditSaving(false);
    }
  };

  const handlePayment = async () => {
    if (!paymentDialog || !paymentForm.amount) {
      toast.error("Payment amount is required");
      return;
    }
    const amount = Number(paymentForm.amount);
    if (amount <= 0) {
      toast.error("Amount must be positive");
      return;
    }
    if (amount > paymentDialog.balance) {
      toast.error(`Amount exceeds balance of ${formatCurrency(paymentDialog.balance)}`);
      return;
    }
    try {
      setPaying(true);
      await apiCreatePayment({
        reservationId: paymentDialog.id,
        amount,
        method: paymentForm.method,
        referenceNo: paymentForm.referenceNo,
        notes: paymentForm.notes,
      });
      toast.success(`Payment of ${formatCurrency(amount)} recorded`);
      setPaymentDialog(null);
      setPaymentForm({ amount: "", method: "CASH", referenceNo: "", notes: "" });
      triggerRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to record payment";
      toast.error(message);
    } finally {
      setPaying(false);
    }
  };

  const ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode; className: string; description: string }> = {
    checkin: {
      label: "Check In",
      icon: <LogIn className="h-4 w-4" />,
      className: "bg-emerald-600 hover:bg-emerald-700",
      description: `Check in ${confirmAction?.reservation.guest?.name || "guest"} for Room ${confirmAction?.reservation.room?.number || ""}?`,
    },
    checkout: {
      label: "Check Out",
      icon: <LogOut className="h-4 w-4" />,
      className: "bg-sky-600 hover:bg-sky-700",
      description: `Check out ${confirmAction?.reservation.guest?.name || "guest"} from Room ${confirmAction?.reservation.room?.number || ""}?`,
    },
    cancel: {
      label: "Cancel Reservation",
      icon: <XCircle className="h-4 w-4" />,
      className: "bg-rose-600 hover:bg-rose-700",
      description: `Cancel reservation for ${confirmAction?.reservation.guest?.name || "guest"}? This action cannot be undone.`,
    },
  };

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-40" />
            <Skeleton className="mt-1 h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("pageSubtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("btnNewReservation")}
        </Button>
      </div>

      {/* Status Tabs + Search + Bulk Select toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); clearHighlight(); }}>
          <TabsList>
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="text-xs sm:text-sm">
                {STATUS_LABEL[tab] || tab.charAt(0) + tab.slice(1).toLowerCase()}
                {tab !== "ALL" && (
                  <span className="ml-1.5 text-[10px] opacity-60">
                    ({tab === "FREE_ROOMS" ? freeRooms.length : reservations.filter((r) => r.status === tab).length})
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {!isFreeRoomsView && (
            <Button
              type="button"
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (selectionMode) exitSelectionMode();
                else setSelectionMode(true);
              }}
              className="gap-1.5"
            >
              {selectionMode ? <XCircle className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
              {selectionMode ? t("btnBulkExit") : t("btnBulkSelect")}
            </Button>
          )}
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              type="search"
              name="reservation-search"
              autoComplete="off"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
                clearHighlight();
              }}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {!isFreeRoomsView && (
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/80">
                {selectionMode && (
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={pagedReservations.length > 0 && pagedReservations.every((r) => selectedIds.has(r.id))}
                      onCheckedChange={(checked) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (checked) {
                            pagedReservations.forEach((r) => next.add(r.id));
                          } else {
                            pagedReservations.forEach((r) => next.delete(r.id));
                          }
                          return next;
                        });
                      }}
                    />
                  </TableHead>
                )}
                <TableHead>{t('thguest', 'Guest')}</TableHead>
                <TableHead className="w-[140px]">Second Guest</TableHead>
                <TableHead>{t('throom', 'Room')}</TableHead>
                <TableHead className="w-[180px]">Stay Date</TableHead>
                {/* Total, Paid, Balance columns removed per request. */}
                <TableHead className="w-[110px]">{t('thstatus', 'Status')}</TableHead>
                {/* Payment column removed per request. */}
                <TableHead className="w-[150px] text-right">{t('thactions', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedReservations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={selectionMode ? 7 : 6} className="h-32 text-center">
                    <div className="flex flex-col items-center text-gray-400">
                      <CalendarRange className="h-8 w-8 mb-2" />
                      <p className="font-medium text-lg">
                        {search || statusFilter !== "ALL" ? t("emptyNoMatch") : t("emptyNoReservations")}
                      </p>
                      <p className="text-sm mt-1">
                        {search || statusFilter !== "ALL"
                          ? t("emptyNoMatchHint")
                          : t("emptyNoReservationsHint")}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedReservations.map((res) => (
                  <TableRow key={res.id} className={highlightRoomId && res.room?.id === highlightRoomId ? "bg-sky-50 border-l-4 border-l-sky-500 transition-all duration-300" : ""}>
                    {selectionMode && (
                      <TableCell className="w-[40px]">
                        <Checkbox
                          checked={selectedIds.has(res.id)}
                          onCheckedChange={() => toggleSelect(res.id)}
                          aria-label={`Select reservation ${res.guest?.name || ""}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 text-xs font-medium">
                          {(() => {
                            const dn = getGuestDisplayName(res);
                            return dn.primary.charAt(0).toUpperCase() || "?";
                          })()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {(() => {
                              const dn = getGuestDisplayName(res);
                              return dn.primary;
                            })()}
                          </p>
                          {(() => {
                            const dn = getGuestDisplayName(res);
                            return dn.subtitle ? (
                              <span className="block text-[10px] text-slate-400 truncate">{dn.subtitle}</span>
                            ) : null;
                          })()}
                          <p className="text-xs text-gray-400">{res.guest?.phone}</p>
                        </div>
                      </div>
                    </TableCell>
                    {/* Second Guest — shows name + phone if a second guest
                        was recorded, "—" otherwise. */}
                    <TableCell>
                      {res.secondGuestName ? (
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate">
                            {res.secondGuestName}
                          </p>
                          <p className="text-xs text-gray-400">{res.secondGuestPhone || ""}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {res.room?.number || "—"}
                        </p>
                        <p className="text-xs text-gray-400">{res.room?.name}</p>
                      </div>
                    </TableCell>
                    {/* Stay Date — merged Check-in + Check-out + Nights
                        into a single column for a cleaner table. */}
                    <TableCell className="text-sm text-gray-600">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-gray-700">
                          {formatDate(res.checkIn)} → {formatDate(res.checkOut)}
                        </span>
                        <span className="text-xs text-gray-400">
                          {res.nights} night{res.nights !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </TableCell>
                    {/* Total, Paid, Balance cells removed per request. */}
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE[res.status] || ""}>
                        {STATUS_LABEL[res.status] || res.status}
                      </Badge>
                    </TableCell>
                    {/* Payment cell removed per request. */}
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {/* ── Primary action: Check In / Check Out (inline) ──
                            Everything else (Edit, Cancel, Extend, Early Checkout,
                            Record Payment) goes into the ⋮ dropdown to keep
                            the table clean and presentable. */}

                        {/* UPCOMING → Check In button (or grayed-out + tooltip) */}
                        {res.status === "UPCOMING" && (() => {
                          const eligibility = getCheckInEligibility(res);
                          if (eligibility.canCheckIn) {
                            return (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                onClick={() => setConfirmAction({ type: "checkin", reservation: res })}
                              >
                                <LogIn className="h-3 w-3" /> {t("btnCheckIn", "Check In")}
                              </Button>
                            );
                          }
                          const reason = eligibility.reasonKey
                            ? t(eligibility.reasonKey, eligibility.reasonContext || {})
                            : "Check-in not available";
                          return (
                            <div className="relative group">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                className="h-7 text-[10px] gap-1 text-gray-400 border-gray-200 cursor-not-allowed"
                              >
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

                        {/* ACTIVE → Check Out or Early Checkout button (inline)
                            depending on whether the scheduled checkout date has arrived. */}
                        {res.status === "ACTIVE" && (
                          isCheckoutDue(res.checkOut) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1 text-sky-700 border-sky-300 hover:bg-sky-50"
                              onClick={() => setConfirmAction({ type: "checkout", reservation: res })}
                            >
                              <LogOut className="h-3 w-3" /> {t("btnCheckOut", "Check Out")}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1 text-rose-700 border-rose-300 hover:bg-rose-50"
                              onClick={() => setEarlyCheckoutDialog(res)}
                            >
                              <LogOut className="h-3 w-3" /> {t("btnEarlyCheckout", "Early Checkout")}
                            </Button>
                          )
                        )}

                        {/* COMPLETED / CANCELLED / DELETED → no primary action */}
                        {(res.status === "COMPLETED" || res.status === "CANCELLED" || res.status === "DELETED") && (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}

                        {/* ── Secondary actions in ⋮ dropdown ── */}
                        {(res.status === "UPCOMING" || res.status === "ACTIVE") && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {/* Edit */}
                              <DropdownMenuItem
                                onClick={() => openEdit(res)}
                                className="text-violet-700 focus:text-violet-700"
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                {t("edit")}
                              </DropdownMenuItem>

                              {/* Extend — only for ACTIVE */}
                              {res.status === "ACTIVE" && (
                                <DropdownMenuItem
                                  onClick={() => openExtendDialog(res)}
                                  className="text-sky-700 focus:text-sky-700"
                                >
                                  <CalendarPlus className="mr-2 h-4 w-4" />
                                  Extend Stay
                                </DropdownMenuItem>
                              )}

                              {/* Early Checkout — only for ACTIVE when checkout date
                                  is still in the future (when checkout is due,
                                  the inline Check Out button covers it instead). */}
                              {res.status === "ACTIVE" && !isCheckoutDue(res.checkOut) && (
                                <DropdownMenuItem
                                  onClick={() => setEarlyCheckoutDialog(res)}
                                  className="text-rose-700 focus:text-rose-700"
                                >
                                  <LogOut className="mr-2 h-4 w-4" />
                                  Early Checkout
                                </DropdownMenuItem>
                              )}

                              {/* Record Payment — if balance > 0 */}
                              {res.balance > 0 && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setPaymentDialog(res);
                                    setPaymentForm({ amount: "", method: "CASH", referenceNo: "", notes: "" });
                                  }}
                                  className="text-amber-700 focus:text-amber-700"
                                >
                                  <CreditCard className="mr-2 h-4 w-4" />
                                  Record Payment
                                </DropdownMenuItem>
                              )}

                              {/* Cancel — only for UPCOMING */}
                              {res.status === "UPCOMING" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => setConfirmAction({ type: "cancel", reservation: res })}
                                    className="text-rose-600 focus:text-rose-600"
                                  >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    Cancel
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-gray-500">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, viewCount)} of{" "}
              {viewCount}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm text-gray-600">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Free Rooms View (replaces the old Deleted tab) */}
      {isFreeRoomsView && (
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/80">
                <TableHead>{t("frColRoom", "Room")}</TableHead>
                <TableHead>{t("frColType", "Type")}</TableHead>
                <TableHead>{t("frColPrice", "Price / Night")}</TableHead>
                <TableHead>{t("frColStatus", "Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedFreeRooms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center">
                    <div className="flex flex-col items-center text-gray-400">
                      <CalendarRange className="h-8 w-8 mb-2" />
                      <p className="font-medium text-lg">{t("frEmpty", "No free rooms")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedFreeRooms.map((room) => (
                  <TableRow key={room.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{room.number}</p>
                        <p className="text-xs text-gray-400">{room.name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{room.type}</TableCell>
                    <TableCell className="text-sm text-gray-600">{formatCurrency(room.pricePerNight)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        {t("frAvailable", "Available")}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-gray-500">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, viewCount)} of{" "}
              {viewCount}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm text-gray-600">
                {page + 1} / {totalPages}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Mobile Card View */}
      {!isFreeRoomsView && (
      <div className="space-y-3 md:hidden">
        {pagedReservations.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
            <CalendarRange className="h-12 w-12 text-gray-300 mb-3" />
            <p className="text-lg font-medium text-gray-500">No reservations</p>
          </div>
        ) : (
          pagedReservations.map((res) => (
            <div key={res.id} className={`rounded-xl border p-4 space-y-3 transition-all duration-300 ${highlightRoomId && res.room?.id === highlightRoomId ? "bg-sky-50 border-sky-400 border-l-4 shadow-md shadow-sky-100" : "bg-white"} ${selectionMode && selectedIds.has(res.id) ? "ring-2 ring-violet-400 border-violet-300" : ""}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  {selectionMode && (
                    <Checkbox
                      checked={selectedIds.has(res.id)}
                      onCheckedChange={() => toggleSelect(res.id)}
                      aria-label={`Select reservation ${res.guest?.name || ""}`}
                    />
                  )}
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-600 font-semibold text-sm">
                    {(() => {
                      const dn = getGuestDisplayName(res);
                      return dn.primary.charAt(0).toUpperCase() || "?";
                    })()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-gray-900 text-sm">
                        {(() => {
                          const dn = getGuestDisplayName(res);
                          return dn.primary;
                        })()}
                      </h3>
                      <Badge variant="outline" className={`${STATUS_BADGE[res.status]} text-[10px] px-1.5 py-0`}>
                        {STATUS_LABEL[res.status] || res.status}
                      </Badge>
                    </div>
                    {(() => {
                      const dn = getGuestDisplayName(res);
                      return dn.subtitle ? (
                        <p className="text-[10px] text-slate-400 truncate -mt-0.5">{dn.subtitle}</p>
                      ) : null;
                    })()}
                    <p className="text-xs text-gray-500">
                      Room {res.room?.number} · {res.room?.name}
                    </p>
                    {res.secondGuestName && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        2nd Guest: {res.secondGuestName}{res.secondGuestPhone ? ` · ${res.secondGuestPhone}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                {/* Secondary actions: Edit, Cancel, Record Payment (still in dropdown) */}
                {(res.status === "UPCOMING" || res.status === "ACTIVE") && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {res.balance > 0 && (res.status === "UPCOMING" || res.status === "ACTIVE") && (
                        <DropdownMenuItem onClick={() => { setPaymentDialog(res); setPaymentForm({ amount: "", method: "CASH", referenceNo: "", notes: "" }); }}>
                          <CreditCard className="mr-2 h-4 w-4" /> Record Payment
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-violet-700" onClick={() => openEdit(res)}>
                        <Pencil className="mr-2 h-4 w-4" /> {t("edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-rose-600" onClick={() => setConfirmAction({ type: "cancel", reservation: res })}>
                        <XCircle className="mr-2 h-4 w-4" /> Cancel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* ── Inline action buttons — mirrors the mobile app layout ── */}
              <div className="flex gap-2 pt-1">
                {res.status === "UPCOMING" && (() => {
                  const eligibility = getCheckInEligibility(res);
                  if (eligibility.canCheckIn) {
                    return (
                      <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700 py-2 text-xs font-semibold" onClick={() => setConfirmAction({ type: "checkin", reservation: res })}>
                        <LogIn className="mr-1.5 h-3 w-3" /> {t("btnCheckIn", "Check In")}
                      </Button>
                    );
                  }
                  return (
                    <div className="flex-1 space-y-1">
                      <Button size="sm" disabled className="w-full bg-gray-200 text-gray-400 py-2 text-xs font-semibold cursor-not-allowed">
                        <LogIn className="mr-1.5 h-3 w-3 opacity-40" /> {t("btnCheckIn", "Check In")}
                      </Button>
                      {eligibility.reasonKey && (
                        <p className="text-[10px] text-amber-700 leading-tight px-1">
                          {t(eligibility.reasonKey, eligibility.reasonContext || {})}
                        </p>
                      )}
                    </div>
                  );
                })()}
                {res.status === "ACTIVE" && (
                  isCheckoutDue(res.checkOut) ? (
                    <Button size="sm" className="flex-1 bg-sky-600 hover:bg-sky-700 py-2 text-xs font-semibold" onClick={() => setConfirmAction({ type: "checkout", reservation: res })}>
                      <LogOut className="mr-1.5 h-3 w-3" /> {t("btnCheckOut", "Check Out")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300 py-2 text-xs font-semibold" onClick={() => setEarlyCheckoutDialog(res)}>
                      <LogOut className="mr-1.5 h-3 w-3" /> {t("btnEarlyCheckout", "Early Checkout")}
                    </Button>
                  )
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex items-center gap-1 text-gray-500">
                  <CalendarDays className="h-3 w-3" /> {formatDate(res.checkIn)} → {formatDate(res.checkOut)}
                </div>
                <div className="flex items-center gap-1 text-gray-500">
                  <Clock className="h-3 w-3" /> {res.nights} night{res.nights !== 1 ? "s" : ""}
                </div>
              </div>

              <Separator />

              {/* Payment badge removed from mobile card per request. */}
            </div>
          ))
        )}

        {/* Mobile Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <span className="text-sm text-gray-500">{page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
      )}

      {/* Free Rooms — Mobile Card View */}
      {isFreeRoomsView && (
      <div className="space-y-3 md:hidden">
        {pagedFreeRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
            <CalendarRange className="h-12 w-12 text-gray-300 mb-3" />
            <p className="text-lg font-medium text-gray-500">{t("frEmpty", "No free rooms")}</p>
          </div>
        ) : (
          pagedFreeRooms.map((room) => (
            <div key={room.id} className="rounded-xl border bg-white p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{t("frColRoom", "Room")} {room.number}</h3>
                  <p className="text-xs text-gray-500">{room.name}</p>
                </div>
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  {t("frAvailable", "Available")}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{room.type}</span>
                <span className="font-medium text-gray-700">
                  {formatCurrency(room.pricePerNight)} / {t("frNight", "night")}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      )}

      {/* New Reservation Dialog — single page form */}
      <Dialog open={createOpen} onOpenChange={closeCreateDialog}>
        <DialogContent
          className="sm:max-w-2xl"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "672px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-emerald-500" />
              {t("btnNewReservation")}
            </DialogTitle>
            <DialogDescription>{t("newResDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            {/* ── Room banner — reflects the CURRENTLY selected room ──
                Updates when the user changes the room dropdown below. */}
            {bannerRoom && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
                    <BedDouble className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-emerald-700">
                      {t("labelRoom")}
                    </div>
                    <div className="truncate text-sm font-semibold text-emerald-900">
                      {bannerRoom.number} · {bannerRoom.name} · {bannerRoom.type}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-emerald-700">{t("frNight", "night")}</div>
                  <div className="text-sm font-semibold text-emerald-900">
                    {formatCurrency(bannerRoom.pricePerNight)}
                  </div>
                </div>
              </div>
            )}

            {/* ── Section: Guest ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold text-gray-800">{t("labelGuest")}</h3>
              </div>

              {/* Mode toggle */}
              <div className="flex p-1 rounded-full bg-gray-100">
                <Button variant={guestMode === "existing" ? "default" : "ghost"} onClick={() => setGuestMode("existing")} className="flex-1 rounded-full shadow-sm">
                  <Search className="mr-2 h-4 w-4" />
                  {t("btnExistingGuest")}
                </Button>
                <Button variant={guestMode === "new" ? "default" : "ghost"} onClick={() => setGuestMode("new")} className="flex-1 rounded-full shadow-sm">
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t("btnNewGuest")}
                </Button>
              </div>

              {guestMode === "existing" ? (
                <div className="space-y-2">
                  <Label>{t("labelSearchGuest")} <span className="text-rose-500">*</span></Label>

                  {/* Selected guest preview chip — shown when a guest is picked. */}
                  {selectedGuestId ? (
                    <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-200 text-violet-700 text-sm font-bold">
                            {allGuests.find((g) => g.id === selectedGuestId)?.name?.charAt(0).toUpperCase() || "?"}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-violet-900 truncate">
                              {allGuests.find((g) => g.id === selectedGuestId)?.name || "—"}
                            </p>
                            <p className="text-xs text-violet-600 truncate">
                              {allGuests.find((g) => g.id === selectedGuestId)?.phone}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setSelectedGuestId(""); setGuestSearch(""); }}
                          className="h-7 px-2 text-xs text-violet-700 hover:bg-violet-100"
                        >
                          {t("btnCancel")}
                        </Button>
                      </div>
                      {/* Guest address bullet — only shown when the selected
                          guest has an address on file. */}
                      {(() => {
                        const sel = allGuests.find((g) => g.id === selectedGuestId);
                        const addr = sel?.address?.trim();
                        const nat = sel?.nationality?.trim();
                        const idNum = sel?.idNumber?.trim();
                        if (!addr && !nat && !idNum) return null;
                        return (
                          <div className="border-t border-violet-200 pt-1.5 mt-1 space-y-0.5">
                            {nat && (
                              <div className="flex items-start gap-1.5 text-xs text-violet-700">
                                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                                <span>{nat}{idNum ? ` · ${idNum}` : ""}</span>
                              </div>
                            )}
                            {addr && (
                              <div className="flex items-start gap-1.5 text-xs text-violet-600">
                                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                                <span className="text-violet-500">{t("labelGuestAddress")}:</span>
                                <span className="flex-1">{addr}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    /* Search input with always-visible dropdown.
                       Replaces the Radix Popover + cmdk Command approach
                       which had focus issues inside the dialog. */
                    <GuestSearchBox
                      value={guestSearch}
                      onChange={setGuestSearch}
                      onPick={(g) => {
                        setSelectedGuestId(g.id);
                        setComboboxOpen(false);
                        setGuestSearch("");
                      }}
                      guests={filteredGuests}
                      totalGuests={allGuests.length}
                      loading={allGuests.length === 0}
                      placeholder={t("placeholderSearchGuest")}
                      emptyText={t("noGuestsFound")}
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Full Name, Phone, Nationality — all on one horizontal line. */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="whitespace-nowrap">{t("labelFullName")} <span className="text-rose-500">*</span></Label>
                      <Input placeholder={t("placeholderFullName")} value={newGuestForm.name} onChange={(e) => setNewGuestForm({ ...newGuestForm, name: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="whitespace-nowrap">{t("labelPhone")} <span className="text-rose-500">*</span></Label>
                      <Input
                        type="tel"
                        placeholder={t("placeholderPhone")}
                        value={newGuestForm.phone}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, phone: e.target.value })}
                        className={newGuestForm.phone.trim() && !isValidPhone(newGuestForm.phone) ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500" : ""}
                      />
                      {newGuestForm.phone.trim() && !isValidPhone(newGuestForm.phone) && (
                        <p className="text-[11px] text-rose-500">
                          {t("phoneFormatHint") || "Use 7-15 digits with optional + prefix. e.g. +251912345678"}
                        </p>
                      )}
                      {/* ── Existing-guest hint ──
                          When the typed phone matches an existing guest,
                          show a green banner so the operator knows the
                          system will REUSE that record (not create a
                          duplicate). The backend's find-or-create logic
                          handles the actual dedup — this is just a UX
                          heads-up so the operator doesn't worry about
                          filling in fields the system will auto-enrich. */}
                      {phoneMatch && (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Guest found: <strong>{phoneMatch.name}</strong>
                            {phoneMatch.idNumber ? ` · ${phoneMatch.idNumber}` : ""}
                            — existing record will be used & enriched.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setGuestMode("existing");
                              setSelectedGuestId(phoneMatch.id);
                              setGuestSearch(phoneMatch.name);
                            }}
                            className="ml-auto shrink-0 font-semibold text-emerald-700 underline hover:text-emerald-800"
                          >
                            Use
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="whitespace-nowrap">{t("labelNationality")} <span className="text-rose-500">*</span></Label>
                      <NationalityCombobox
                        value={newGuestForm.nationality || DEFAULT_NATIONALITY}
                        onValueChange={(v) => {
                          // Auto-switch ID type based on nationality:
                          // - Ethiopia → "National ID" (Ethiopian residents use FAN/National ID)
                          // - Any other country → "Passport" (foreign visitors use their passport)
                          const isEthiopian = v === "Ethiopia";
                          const newIdType = isEthiopian ? "National ID" : "Passport";
                          if (!newGuestForm.idNumber || newGuestForm.idNumber.trim() === "") {
                            setNewGuestForm({ ...newGuestForm, nationality: v, idType: newIdType });
                          } else {
                            setNewGuestForm({ ...newGuestForm, nationality: v });
                          }
                        }}
                        placeholder={t("placeholderNationality")}
                        t={t}
                      />
                    </div>
                  </div>
                  {/* ID Type, ID Number, and Guest Address — all on one row.
                      ID Type is narrower (dropdown with short text), ID Number
                      is wider (text input), Guest Address toggle takes the
                      remaining space. Custom grid template keeps ID Type and
                      ID Number visually grouped close together. */}
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr_1.5fr] gap-3 items-start">
                    <div className="space-y-1.5">
                      <Label className="whitespace-nowrap">{t("labelIdType")} <span className="text-rose-500">*</span></Label>
                      <Select value={newGuestForm.idType} onValueChange={(v) => setNewGuestForm({ ...newGuestForm, idType: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ID_TYPES.map((x) => (
                            <SelectItem key={x} value={x}>{x}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      {(() => {
                        const cfg = getIdFieldConfig(newGuestForm.idType);
                        return (
                          <>
                            <Label className="whitespace-nowrap">
                              {cfg.label} <span className="text-rose-500">*</span>
                              {isNationalIdType(newGuestForm.idType) && (
                                <span className="ml-1.5 text-[10px] font-normal text-amber-600 whitespace-nowrap">
                                  (16 digits, FAN)
                                </span>
                              )}
                            </Label>
                            <Input
                              placeholder={cfg.placeholder}
                              value={newGuestForm.idNumber}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (isNationalIdType(newGuestForm.idType)) {
                                  setNewGuestForm({ ...newGuestForm, idNumber: formatNationalId(val) });
                          } else {
                            setNewGuestForm({ ...newGuestForm, idNumber: val });
                          }
                        }}
                              className={isNationalIdType(newGuestForm.idType) ? "font-mono" : ""}
                            />
                            {isNationalIdType(newGuestForm.idType) && newGuestForm.idNumber.trim() && !isValidNationalId(newGuestForm.idNumber) && (
                              <p className="text-[10px] text-rose-500">
                                National ID must be 16 digits (FAN XX XX XX XX XX XX XX XX)
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    {/* Guest Address block — the toggle fills this 3rd
                        column; when expanded, the body spans the full
                        width below (sm:col-span-3 inside the component). */}
                    <CollapsibleAddressFields
                      region={newGuestForm.region}
                      zone={newGuestForm.zone}
                      woreda={newGuestForm.woreda}
                      kebele={newGuestForm.kebele}
                      houseNumber={newGuestForm.houseNumber}
                      streetName={newGuestForm.streetName}
                      plateNumber={newGuestForm.plateNumber}
                      onChange={(patch) => setNewGuestForm({ ...newGuestForm, ...patch })}
                      labelGuestAddress={t("labelGuestAddress")}
                      labelPlateNumber={t("labelPlateNumber")}
                      placeholderPlateNumber={t("placeholderPlateNumber")}
                      placeholderZone="Enter zone/sub-city"
                      placeholderWoreda="Enter woreda"
                      placeholderKebele="e.g. 01, 02, 03"
                      placeholderHouseNumber="e.g. H-124"
                      placeholderStreetName="e.g. Bole Road"
                      labelSecurityWeapon={t("labelSecurityWeapon")}
                      placeholderSecurityWeapon={t("placeholderSecurityWeapon")}
                      weapon={newGuestForm.weapon}
                    />
                  </div>

                  {/* Live preview of the new guest's address info — only
                      shows bullets for fields the user has filled in. */}
                  {(() => {
                    const nat = newGuestForm.nationality.trim();
                    const idNum = newGuestForm.idNumber.trim();
                    const addrParts = [
                      newGuestForm.region,
                      newGuestForm.zone,
                      newGuestForm.woreda,
                      newGuestForm.kebele,
                      newGuestForm.houseNumber,
                      newGuestForm.streetName,
                    ].filter((x) => x && x.trim()).map((x) => x.trim());
                    if (!nat && !idNum && addrParts.length === 0) return null;
                    return (
                      <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 space-y-0.5">
                        {nat && (
                          <div className="flex items-start gap-1.5 text-xs text-violet-700">
                            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                            <span>{nat}{idNum ? ` · ${idNum}` : ""}</span>
                          </div>
                        )}
                        {addrParts.length > 0 && (
                          <div className="flex items-start gap-1.5 text-xs text-violet-600">
                            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                            <span className="text-violet-500">{t("labelGuestAddress")}:</span>
                            <span className="flex-1">{addrParts.join(", ")}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <Separator />

            {/* ── Section: Booking ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <BedDouble className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-semibold text-gray-800">{t("labelRoom")}</h3>
              </div>

              <div className="space-y-2">
                <Label>{t("labelRoom")} <span className="text-rose-500">*</span></Label>
                <Select value={createForm.roomId} onValueChange={(v) => setCreateForm({ ...createForm, roomId: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("placeholderSelectRoom")} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        <span className="flex items-center gap-2">
                          <BedDouble className="h-3.5 w-3.5 text-gray-400" />
                          {r.name ? t("roomOptionWithName", { number: r.number, name: r.name, type: r.type, price: formatCurrency(r.pricePerNight) }) : t("roomOption", { number: r.number, type: r.type, price: formatCurrency(r.pricePerNight) })}
                        </span>
                      </SelectItem>
                    ))}
                    {availableRooms.length === 0 && (
                      <SelectItem value="__none" disabled>{t("noAvailableRooms")}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Second Guest Section — shown for ALL room types.
                  The second guest is NOT mandatory. The user chooses
                  "One guest only" (default) or "Two guests". If "Two guests"
                  is selected, the second guest fields appear and become
                  required. This applies uniformly to every room type
                  regardless of capacity. */}
              {(() => {
                const selRoom = allRooms.find((r) => r.id === createForm.roomId);
                if (!selRoom) return null;
                return (
                  <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sky-800">
                      <Users className="h-4 w-4" />
                      <span className="text-xs font-semibold">{t("additionalOccupant")}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="guest-count" checked={!createForm.hasSecondGuest} onChange={() => setCreateForm({ ...createForm, hasSecondGuest: false, secondGuestName: "", secondGuestPhone: "", secondGuestIdNumber: "" })} className="h-3.5 w-3.5 accent-emerald-600" />
                        <span className="text-xs font-medium">{t("oneGuestOnly")}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="guest-count" checked={createForm.hasSecondGuest} onChange={() => setCreateForm({ ...createForm, hasSecondGuest: true })} className="h-3.5 w-3.5 accent-sky-600" />
                        <span className="text-xs font-medium text-sky-700">{t("twoGuests")}</span>
                      </label>
                    </div>
                    {createForm.hasSecondGuest && (
                      <div className="space-y-2">
                        <p className="text-[10px] text-muted-foreground">{t("descSecondGuestDetails")}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>{t("labelSecondGuestName")} <span className="text-rose-500">*</span></Label>
                            <Input placeholder={t("placeholderSecondGuestName")} value={createForm.secondGuestName} onChange={(e) => setCreateForm({ ...createForm, secondGuestName: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("labelSecondGuestPhone")} <span className="text-rose-500">*</span></Label>
                            <Input type="tel" placeholder={t("placeholderPhone")} value={createForm.secondGuestPhone} onChange={(e) => setCreateForm({ ...createForm, secondGuestPhone: e.target.value })} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label>{t("labelSecondGuestIdNumber")}</Label>
                          <Input placeholder={t("placeholderId")} value={createForm.secondGuestIdNumber} onChange={(e) => setCreateForm({ ...createForm, secondGuestIdNumber: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Availability calendar */}
              <RoomAvailabilityCalendar
                roomId={createForm.roomId || undefined}
                checkIn={createForm.checkIn}
                checkOut={createForm.checkOut}
                onChange={(v) => setCreateForm((f) => ({ ...f, ...v }))}
              />

              {/* Price summary */}
              {(createNights > 0 || createForm.roomId) && (
                <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t("priceSummary")}</p>
                  <div className="flex justify-between text-sm"><span className="text-gray-600">{t("roomRate")}</span><span className="font-medium">{formatCurrency(createRate)}/night</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-600">{t("nights")}</span><span className="font-medium">{createNights}</span></div>
                  <Separator />
                  <div className="flex justify-between text-sm"><span className="font-semibold text-gray-900">{t("total")}</span><span className="font-bold text-gray-900">{formatCurrency(createTotal)}</span></div>
                </div>
              )}

            </div>
          </div>

          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" onClick={closeCreateDialog}>{t("btnCancel")}</Button>
            <Button onClick={handleCreate} disabled={creating || !step1Valid} className="gap-1.5">
              {creating ? t("btnCreating") : t("btnCreateReservation")}
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Action Confirmation Dialog (Check-in / Check-out / Cancel) */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {confirmAction && ACTION_LABELS[confirmAction.type]?.icon}
              {confirmAction && ACTION_LABELS[confirmAction.type]?.label}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction && ACTION_LABELS[confirmAction.type]?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>{t("btnCancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction ? ACTION_LABELS[confirmAction.type]?.className : ""}
              onClick={handleAction}
              disabled={actionLoading}
            >
              {actionLoading ? t("btnProcessing") : confirmAction && ACTION_LABELS[confirmAction.type]?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Extend Stay Dialog ── */}
      <Dialog open={!!extendDialog} onOpenChange={(o) => { if (!o) { setExtendDialog(null); setExtendDate(""); } }}>
        <DialogContent
          className="sm:max-w-md"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "448px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
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

      {/* Payment Dialog */}
      <Dialog open={!!paymentDialog} onOpenChange={() => setPaymentDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-emerald-600" />
              {t("dialogRecordPaymentTitle")}
            </DialogTitle>
            <DialogDescription>
              {paymentDialog && (
                <>
                  {paymentDialog.guest?.name} — {t("labelRoom")} {paymentDialog.room?.number} · {t("descPaymentBalance")}{" "}
                  <span className="font-semibold text-rose-600">
                    {formatCurrency(paymentDialog.balance)}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {paymentDialog && (
            <div className="space-y-4 py-2">
              {/* Payment summary bar */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-gray-50 p-2 border">
                  <p className="text-[10px] uppercase text-gray-500 tracking-wider">{t("labelTotalUpper")}</p>
                  <p className="text-sm font-bold text-gray-900">{formatCurrency(paymentDialog.totalCost)}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-2 border border-emerald-100">
                  <p className="text-[10px] uppercase text-emerald-600 tracking-wider">{t("labelPaidUpper")}</p>
                  <p className="text-sm font-bold text-emerald-700">{formatCurrency(paymentDialog.paidAmount)}</p>
                </div>
                <div className="rounded-lg bg-rose-50 p-2 border border-rose-100">
                  <p className="text-[10px] uppercase text-rose-600 tracking-wider">{t("labelBalanceUpper")}</p>
                  <p className="text-sm font-bold text-rose-700">{formatCurrency(paymentDialog.balance)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pay-amount">
                  {t("labelAmount")} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="pay-amount"
                  type="number"
                  placeholder="0"
                  min="0"
                  max={paymentDialog.balance}
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                />
                {paymentForm.amount && Number(paymentForm.amount) > 0 && (
                  <p className="text-xs text-gray-500">
                    {t("afterPaymentRemaining", { amount: formatCurrency(paymentDialog.balance - Number(paymentForm.amount)) })}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t("labelPaymentMethod")}</Label>
                <Select
                  value={paymentForm.method}
                  onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.charAt(0) + m.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pay-ref">{t("labelRefNumber")}</Label>
                <Input
                  id="pay-ref"
                  placeholder="Transaction reference"
                  value={paymentForm.referenceNo}
                  onChange={(e) => setPaymentForm({ ...paymentForm, referenceNo: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pay-notes">{t("labelNotes")}</Label>
                <Textarea
                  id="pay-notes"
                  placeholder="Payment notes..."
                  rows={2}
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                />
              </div>

              {/* Quick amount buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setPaymentForm({ ...paymentForm, amount: String(paymentDialog.balance) })}
                >
                  <DollarSign className="h-3 w-3 mr-1" />
                  {t("btnFullBalance")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setPaymentForm({ ...paymentForm, amount: String(paymentDialog.totalCost) })}
                >
                  <DollarSign className="h-3 w-3 mr-1" />
                  {t("btnFullTotal")}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>
              {t("btnCancel")}
            </Button>
            <Button onClick={handlePayment} disabled={paying} className="bg-amber-600 hover:bg-amber-700">
              {paying ? t("btnRecording") : t("btnRecordPayment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Reservation Dialog (pending / active only) */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-violet-500" />
              {t("dialogEditResTitle")}
            </DialogTitle>
            <DialogDescription>{t("dialogEditResDesc")}</DialogDescription>
          </DialogHeader>

          {editTarget && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {/* Active-stay hint */}
              {editTarget.status === "ACTIVE" && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                  <p className="text-xs text-emerald-800">{t("editActiveHint")}</p>
                </div>
              )}

              {/* Guest combobox */}
              <div className="space-y-1.5">
                <Label>{t("labelGuest")} <span className="text-rose-500">*</span></Label>
                <Popover open={editGuestOpen} onOpenChange={setEditGuestOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={editGuestOpen} className="w-full justify-between font-normal">
                      {editForm.guestId ? allGuests.find((g) => g.id === editForm.guestId)?.name : t("placeholderSelectGuest")}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={true}>
                      <CommandInput placeholder={t("placeholderSearchGuest")} />
                      <CommandList>
                        <CommandEmpty>{t("noGuestsFound")}</CommandEmpty>
                        <CommandGroup>
                          {allGuests.map((g) => (
                            <CommandItem key={g.id} value={`${g.name} ${g.phone}`} onSelect={() => { setEditForm({ ...editForm, guestId: g.id }); setEditGuestOpen(false); }}>
                              <User className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="flex-1 truncate">{g.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">{g.phone}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Room */}
              <div className="space-y-1.5">
                <Label>{t("labelRoom")} <span className="text-rose-500">*</span></Label>
                <Select value={editForm.roomId} onValueChange={(v) => setEditForm({ ...editForm, roomId: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={t("placeholderSelectRoom")} /></SelectTrigger>
                  <SelectContent>
                    {allRooms.filter((r) => r.status !== "MAINTENANCE" || r.id === editForm.roomId).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name ? t("roomOptionWithName", { number: r.number, name: r.name, type: r.type, price: r.pricePerNight }) : t("roomOption", { number: r.number, type: r.type, price: r.pricePerNight })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("labelCheckIn")} <span className="text-rose-500">*</span></Label>
                  <Input type="date" value={editForm.checkIn} onChange={(e) => setEditForm({ ...editForm, checkIn: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("labelCheckOut")} <span className="text-rose-500">*</span></Label>
                  <Input type="date" value={editForm.checkOut} min={editForm.checkIn || undefined} onChange={(e) => setEditForm({ ...editForm, checkOut: e.target.value })} />
                </div>
              </div>

              {/* Rate / tax / discount */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("roomRate")}</Label>
                  <Input type="number" min={0} step="0.01" value={editForm.roomRate} onChange={(e) => setEditForm({ ...editForm, roomRate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("labelTax")}</Label>
                  <Input type="number" min={0} step="0.01" value={editForm.taxAmount} onChange={(e) => setEditForm({ ...editForm, taxAmount: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("labelDiscount")}</Label>
                  <Input type="number" min={0} step="0.01" value={editForm.discountAmount} onChange={(e) => setEditForm({ ...editForm, discountAmount: e.target.value })} />
                </div>
              </div>

              {/* Payment method */}
              <div className="space-y-1.5">
                <Label>{t("labelPaymentMethod")}</Label>
                <Select value={editForm.paymentMethod} onValueChange={(v) => setEditForm({ ...editForm, paymentMethod: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m.charAt(0) + m.slice(1).toLowerCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>{t("labelNotes")}</Label>
                <Textarea rows={2} placeholder={t("placeholderNotes")} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>

              {/* Live price summary */}
              {editPreview.valid && (
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs space-y-1">
                  <div className="flex justify-between text-violet-900">
                    <span>{t("roomRate")} × {t("nights")}</span>
                    <span className="font-medium">{editPreview.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-violet-900">
                    <span>{t("labelTotalUpper")}</span>
                    <span className="font-semibold">{editPreview.total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-violet-900">
                    <span>{t("labelPaidUpper")}</span>
                    <span>{editPreview.paid.toFixed(2)}</span>
                  </div>
                  <Separator className="bg-violet-200" />
                  <div className="flex justify-between text-violet-900 font-semibold">
                    <span>{t("labelBalanceUpper")}</span>
                    <span>{editPreview.balance.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>
              {t("btnCancel")}
            </Button>
            <Button onClick={handleEditSave} disabled={editSaving || !editPreview.valid} className="bg-violet-600 hover:bg-violet-700">
              {editSaving ? t("btnSavingChanges") : t("btnSaveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Room Conflict Dialog */}
      <Dialog open={!!conflictInfo} onOpenChange={(open) => { if (!open) setConflictInfo(null); }}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          {conflictInfo && (
            <>
              {/* Header with gradient */}
              <div className="bg-gradient-to-r from-rose-500 to-amber-500 px-6 py-8 text-white text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-black/5" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm ring-4 ring-white/30">
                    <BedDouble className="h-8 w-8 text-white" />
                  </div>
                  <h2 className="text-xl font-bold">{t("dialogRoomConflictTitle")}</h2>
                  <p className="mt-1 text-sm text-white/80">{t("dialogRoomConflictDesc")}</p>
                </div>
              </div>
              {/* Content */}
              <div className="px-6 py-5 space-y-4">
                {/* Room info card */}
                <div className="rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 text-rose-600 font-bold text-lg">
                        {conflictInfo.roomNumber}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{conflictInfo.roomName || `${t("labelRoom")} ${conflictInfo.roomNumber}`}</p>
                        <p className="text-xs text-rose-500 font-medium">{t("unavailableForDates")}</p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Date range display */}
                <div className="rounded-xl bg-gray-50 border p-4">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">{t("reservedPeriod")}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 text-center">
                      <CalendarDays className="h-5 w-5 mx-auto text-rose-400 mb-1" />
                      <p className="text-xs text-gray-500">{t("from")}</p>
                      <p className="font-semibold text-gray-900 text-sm">{formatDate(conflictInfo.checkIn)}</p>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="h-px w-8 bg-gray-300" />
                      <ArrowRight className="h-4 w-4 text-gray-400" />
                      <div className="h-px w-8 bg-gray-300" />
                    </div>
                    <div className="flex-1 text-center">
                      <CalendarDays className="h-5 w-5 mx-auto text-rose-400 mb-1" />
                      <p className="text-xs text-gray-500">{t("to")}</p>
                      <p className="font-semibold text-gray-900 text-sm">{formatDate(conflictInfo.checkOut)}</p>
                    </div>
                  </div>
                </div>
                {/* Info note */}
                <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800 leading-relaxed">
                    {t("conflictNote")}
                  </p>
                </div>
              </div>
              {/* Footer */}
              <div className="px-6 pb-6">
                <Button variant="outline" onClick={() => setConflictInfo(null)}>
                  {t("btnChooseAnotherRoom")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bulk Action Bar ──
          Sticky bottom bar that appears when selectionMode is on and ≥1
          reservation is selected. Shows the 4 bulk actions. */}
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
            className="gap-1.5 text-rose-700 border-rose-300 hover:bg-rose-50"
            onClick={() => setBulkAction("earlyout")}
            disabled={bulkLoading}
          >
            <LogOut className="h-3.5 w-3.5" /> {t("btnBulkEarlyOut")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 text-red-700 border-red-300 hover:bg-red-50"
            onClick={() => setBulkAction("cancel")}
            disabled={bulkLoading}
          >
            <Ban className="h-3.5 w-3.5" /> {t("btnBulkCancel")}
          </Button>
        </div>
      )}

      {/* ── Bulk Action Confirm Dialog ── */}
      <AlertDialog
        open={!!bulkAction}
        onOpenChange={(open) => { if (!open && !bulkLoading) setBulkAction(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {bulkAction === "checkin" ? <LogIn className="h-5 w-5 text-emerald-600" />
                : bulkAction === "cancel" ? <Ban className="h-5 w-5 text-red-600" />
                : <LogOut className="h-5 w-5 text-sky-600" />}
              {bulkAction === "checkin" ? t("confirmBulkCheckinTitle", { count: bulkEligibility.total })
                : bulkAction === "checkout" ? t("confirmBulkCheckoutTitle", { count: bulkEligibility.total })
                : bulkAction === "earlyout" ? t("confirmBulkEarlyOutTitle", { count: bulkEligibility.total })
                : bulkAction === "cancel" ? t("confirmBulkCancelTitle", { count: bulkEligibility.total })
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === "checkin" ? t("confirmBulkCheckinDesc", { skipped: bulkEligibility.skipped })
                : bulkAction === "checkout" ? t("confirmBulkCheckoutDesc", { skipped: bulkEligibility.skipped })
                : bulkAction === "earlyout" ? t("confirmBulkEarlyOutDesc", { skipped: bulkEligibility.skipped })
                : bulkAction === "cancel" ? t("confirmBulkCancelDesc", { skipped: bulkEligibility.skipped })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkLoading}>{t("btnCancel")}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className={
                bulkAction === "checkin" ? "bg-emerald-600 hover:bg-emerald-700"
                : bulkAction === "cancel" ? "bg-red-600 hover:bg-red-700"
                : "bg-sky-600 hover:bg-sky-700"
              }
              onClick={(e) => { e.preventDefault(); handleBulkAction(); }}
              disabled={bulkLoading || bulkEligibility.eligible === 0}
            >
              {bulkLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("processing")}
                </span>
              ) : (
                bulkAction === "checkin" ? t("btnBulkCheckin")
                : bulkAction === "checkout" ? t("btnBulkCheckout")
                : bulkAction === "earlyout" ? t("btnBulkEarlyOut")
                : bulkAction === "cancel" ? t("btnBulkCancel")
                : ""
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
