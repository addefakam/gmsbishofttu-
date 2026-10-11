"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import { formatDaysRemaining, formatCycle } from "@/lib/subscription";
import { isDefaultRoomName, isCheckoutDue } from "@/lib/utils";
import {
  apiGetRooms,
  apiCreateRoom,
  apiUpdateRoom,
  apiDeleteRoom,
  apiUpdateRoomStatus,
  apiImportRooms,
  apiGetReservations,
  apiUpdateReservation,
  apiCheckout,
} from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  ChevronDown,
  Pencil,
  User,
  CalendarDays,
  CreditCard,
  Clock,
  Trash2,
  Users,
  BedSingle,
  BedDouble,
  Hotel,
  Crown,
  Star,
  Building2,
  Layers,
  Trophy,
  Wifi,
  Info,
  CalendarPlus,
  CalendarClock,
  LogOut,
  ArrowRightLeft,
  Tv,
  Wind,
  Coffee,
  ShowerHead,
  Car,
  DollarSign,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ClipboardList,
  Gem,
  Armchair,
  Sparkles,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface Room {
  id: string;
  number: string;
  name: string;
  type: string;
  pricePerNight: number;
  pricePerNightWeekend?: number | null;
  floor: number;
  capacity: number;
  status: string;
  amenities: string;
  description: string;
  image: string | null;
}

interface ImportResult {
  number: string;
  status: string;
  error?: string;
}

interface RoomReservation {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomRate: number;
  totalCost: number;
  paidAmount: number;
  balance: number;
  paymentStatus: string;
  guest: { id: string; name: string; phone: string } | null;
  roomId?: string;
}

const ROOM_TYPES = ["SINGLE", "DOUBLE", "TWIN", "SUITE", "DELUXE", "KING", "STANDARD", "STANDARD_SUITE", "JUNIOR_SUITE", "EXECUTIVE_SUITE", "PRESIDENTIAL_SUITE"] as const;

const ROOM_TYPE_ICONS: Record<string, React.ReactNode> = {
  SINGLE: <BedSingle className="h-4 w-4" />,
  DOUBLE: <BedDouble className="h-4 w-4" />,
  TWIN: <Hotel className="h-4 w-4" />,
  SUITE: <Crown className="h-4 w-4" />,
  DELUXE: <Star className="h-4 w-4" />,
  KING: <Gem className="h-4 w-4" />,
  STANDARD: <Building2 className="h-4 w-4" />,
  STANDARD_SUITE: <Layers className="h-4 w-4" />,
  JUNIOR_SUITE: <Armchair className="h-4 w-4" />,
  EXECUTIVE_SUITE: <Sparkles className="h-4 w-4" />,
  PRESIDENTIAL_SUITE: <Trophy className="h-4 w-4" />,
};

const ROOM_TYPE_COLORS: Record<string, string> = {
  SINGLE: "bg-sky-50 text-sky-700 border-sky-200",
  DOUBLE: "bg-violet-50 text-violet-700 border-violet-200",
  TWIN: "bg-teal-50 text-teal-700 border-teal-200",
  SUITE: "bg-amber-50 text-amber-700 border-amber-200",
  DELUXE: "bg-rose-50 text-rose-700 border-rose-200",
  KING: "bg-indigo-50 text-indigo-700 border-indigo-200",
  STANDARD: "bg-slate-50 text-slate-700 border-slate-200",
  STANDARD_SUITE: "bg-cyan-50 text-cyan-700 border-cyan-200",
  JUNIOR_SUITE: "bg-pink-50 text-pink-700 border-pink-200",
  EXECUTIVE_SUITE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PRESIDENTIAL_SUITE: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-300",
};

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  OCCUPIED: "bg-rose-100 text-rose-800 border-rose-200",
  MAINTENANCE: "bg-amber-100 text-amber-800 border-amber-200",
  RESERVED: "bg-sky-100 text-sky-800 border-sky-200",
};

const STATUS_DOT: Record<string, string> = {
  AVAILABLE: "bg-emerald-500",
  OCCUPIED: "bg-rose-500",
  MAINTENANCE: "bg-amber-500",
  RESERVED: "bg-sky-500",
};

const STATUS_CARD: Record<string, string> = {
  AVAILABLE: "bg-white border-l-emerald-400",
  OCCUPIED: "bg-rose-50/40 border-l-rose-400",
  MAINTENANCE: "bg-amber-50/40 border-l-amber-400",
  RESERVED: "bg-sky-50/40 border-l-sky-400",
};

const AMENITY_ICONS: Record<string, React.ReactNode> = {
  WiFi: <Wifi className="h-3 w-3" />,
  TV: <Tv className="h-3 w-3" />,
  AC: <Wind className="h-3 w-3" />,
  "Mini Bar": <Coffee className="h-3 w-3" />,
  "Hot Water": <ShowerHead className="h-3 w-3" />,
  Parking: <Car className="h-3 w-3" />,
};

// Derive floor from FIRST DIGIT of room number (e.g. "401" → 4, "102" → 1)
const getFloorFromNumber = (num: string): number | null => {
  const match = num.match(/^\d/);
  return match ? parseInt(match[0], 10) : null;
};

/** Get the floor for a room — prefers the first digit of the room number,
 *  falls back to the explicit `floor` field from the database. */
const getRoomFloor = (room: { number: string; floor?: number }): number | null => {
  const fromNum = getFloorFromNumber(room.number);
  if (fromNum !== null) return fromNum;
  if (typeof room.floor === "number" && room.floor > 0) return room.floor;
  return null;
};

const emptyForm = {
  number: "",
  name: "",
  type: "SINGLE",
  pricePerNight: "",
  pricePerNightWeekend: "",
  floor: "",
  capacity: "",
  amenities: "[]",
  description: "",
};

// ── Excel template columns ───────────────────────────────────────────────────
const TEMPLATE_COLUMNS = ["number", "type", "pricePerNight", "floor", "capacity", "amenities", "description"];
const TEMPLATE_EXAMPLE = [
  { number: "101", type: "SINGLE", pricePerNight: 500, floor: 1, capacity: 1, amenities: "WiFi, TV", description: "Standard single room" },
  { number: "102", type: "DOUBLE", pricePerNight: 900, floor: 1, capacity: 2, amenities: "WiFi, TV, AC", description: "Comfortable double room" },
  { number: "201", type: "SUITE",  pricePerNight: 1800, floor: 2, capacity: 3, amenities: "WiFi, TV, AC, Mini Bar", description: "Luxury suite" },
];

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(TEMPLATE_EXAMPLE, { header: TEMPLATE_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rooms");
  XLSX.writeFile(wb, "rooms_import_template.xlsx");
}

// ── Subscription Status Badge (for Rooms page header) ──
function SubscriptionBadge() {
  const { t } = useTranslation("rooms");
  const { currentUser, subscription } = useAppStore();

  // Only show for OPERATOR/STAFF
  if (!currentUser || (currentUser.role !== "OPERATOR" && currentUser.role !== "STAFF")) return null;
  if (!subscription) return null;

  const isActive = subscription.status === "ACTIVE";
  const isWarning = subscription.status === "WARNING";
  const isExpired = subscription.status === "EXPIRED";
  const isSuspended = subscription.status === "SUSPENDED";

  const badgeClass = isActive
    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
    : isSuspended || isExpired
    ? "border-rose-300 bg-rose-50 text-rose-700"
    : "border-amber-300 bg-amber-50 text-amber-700";

  const dotClass = isActive
    ? "bg-emerald-500"
    : isSuspended || isExpired
    ? "bg-rose-500"
    : "bg-amber-500";

  const label = isActive
    ? t("subActive")
    : isSuspended
    ? t("subSuspended")
    : isExpired
    ? t("subExpired")
    : t("subExpiring");

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass} animate-subtle-pulse`}>
      <span className={`relative flex h-2 w-2`}>
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotClass}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotClass}`} />
      </span>
      <span>{label}</span>
      <span className="font-mono text-[11px] opacity-70">{Math.abs(subscription.daysRemaining)}d</span>
    </div>
  );
}

export default function RoomsPage() {
  const { t } = useTranslation("rooms");
  const { refreshKey, triggerRefresh, setCurrentPage, setPreselectedRoom } = useAppStore();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [search, setSearch] = useState("");
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Active reservations map (roomId → reservation) for tooltip/occupancy info
  const [roomResMap, setRoomResMap] = useState<Record<string, RoomReservation>>({});
  // Separate buckets powering the date-aware status buttons:
  // ACTIVE = guest checked in right now; UPCOMING = booked, guest not yet in
  const [activeResMap, setActiveResMap] = useState<Record<string, RoomReservation>>({});
  const [upcomingResMap, setUpcomingResMap] = useState<Record<string, RoomReservation>>({});

  // single-room dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // delete
  const [deleteDialog, setDeleteDialog] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState(false);

  // room info detail
  const [infoRoom, setInfoRoom] = useState<Room | null>(null);
  const [roomReservations, setRoomReservations] = useState<RoomReservation[]>([]);
  const [roomResLoading, setRoomResLoading] = useState(false);

  // extend stay dialog
  const [extendDialog, setExtendDialog] = useState<RoomReservation | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [extending, setExtending] = useState(false);

  // early checkout dialog
  const [earlyCheckoutDialog, setEarlyCheckoutDialog] = useState<RoomReservation | null>(null);
  const [earlyCheckingOut, setEarlyCheckingOut] = useState(false);

  // room shift dialog
  const [shiftDialog, setShiftDialog] = useState<RoomReservation | null>(null);
  const [shiftTargetRoomId, setShiftTargetRoomId] = useState("");
  const [shifting, setShifting] = useState(false);

  // excel import
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const fetchRooms = useCallback(async () => {
    try {
      setLoading(true);
      const [raw, upcomingRes, activeRes] = await Promise.all([
        apiGetRooms(search),
        apiGetReservations("status=UPCOMING&limit=999").catch(() => []),
        apiGetReservations("status=ACTIVE&limit=999").catch(() => []),
      ]);
      const list = Array.isArray(raw.rooms) ? raw.rooms : Array.isArray(raw) ? raw : [];
      setRooms(list);
      const upList: RoomReservation[] = Array.isArray(upcomingRes?.data) ? upcomingRes.data : Array.isArray(upcomingRes) ? upcomingRes : [];
      const acList: RoomReservation[] = Array.isArray(activeRes?.data) ? activeRes.data : Array.isArray(activeRes) ? activeRes : [];
      // Helper: get roomId from either roomId field or room.id (enriched)
      const getResRoomId = (r: RoomReservation): string | undefined => r.roomId || r.room?.id;
      // Earliest-arriving UPCOMING booking per room
      const upMap: Record<string, RoomReservation> = {};
      for (const r of [...upList].sort((a, b) => a.checkIn.localeCompare(b.checkIn))) {
        const rid = getResRoomId(r);
        if (rid && !upMap[rid]) upMap[rid] = r;
      }
      // Checked-in (ACTIVE) reservation per room
      const acMap: Record<string, RoomReservation> = {};
      for (const r of acList) {
        const rid = getResRoomId(r);
        if (rid && !acMap[rid]) acMap[rid] = r;
      }
      setUpcomingResMap(upMap);
      setActiveResMap(acMap);
      // Tooltip map: prefer the in-house (ACTIVE) reservation, else the next booking
      const map: Record<string, RoomReservation> = {};
      for (const roomId of new Set([...Object.keys(upMap), ...Object.keys(acMap)])) {
        map[roomId] = acMap[roomId] ?? upMap[roomId];
      }
      setRoomResMap(map);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("toastFailedLoadRooms");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    // Remove the 300ms debounce — it was causing delayed updates after
    // actions (check-in, checkout, create reservation). The refreshKey
    // change should trigger an immediate re-fetch.
    fetchRooms();
  }, [fetchRooms, refreshKey]);

  // Fetch reservations for the room when info dialog opens
  useEffect(() => {
    if (!infoRoom) {
      setRoomReservations([]);
      return;
    }
    (async () => {
      try {
        setRoomResLoading(true);
        const data = await apiGetReservations(`roomId=${infoRoom.id}`);
        setRoomReservations(Array.isArray(data) ? data : []);
      } catch {
        setRoomReservations([]);
      } finally {
        setRoomResLoading(false);
      }
    })();
  }, [infoRoom]);

  const openCreate = () => {
    setEditingRoom(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (room: Room) => {
    setEditingRoom(room);
    setForm({
      number: room.number,
      name: room.name || "",
      type: room.type,
      pricePerNight: String(room.pricePerNight),
      pricePerNightWeekend: room.pricePerNightWeekend != null ? String(room.pricePerNightWeekend) : "",
      floor: String(room.floor),
      capacity: String(room.capacity),
      amenities: room.amenities,
      description: room.description,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    // pricePerNight is optional — defaults to 0 when omitted.
    if (!form.number || !form.floor || !form.capacity) {
      toast.error(t("toastFillRequired"));
      return;
    }

    try {
      setSaving(true);
      const payload = {
        number: form.number,
        name: form.name || "",
        type: form.type,
        pricePerNight: form.pricePerNight ? Number(form.pricePerNight) : 0,
        // Weekend price — empty string means "no weekend premium".
        // Send null so the API stores NULL (DB) instead of 0.
        pricePerNightWeekend: form.pricePerNightWeekend && Number(form.pricePerNightWeekend) > 0
          ? Number(form.pricePerNightWeekend)
          : null,
        floor: Number(form.floor),
        capacity: Number(form.capacity),
        amenities: form.amenities || "[]",
        description: form.description,
      };

      if (editingRoom) {
        await apiUpdateRoom(editingRoom.id, payload);
        toast.success(t("toastRoomUpdated"));
        setEditingRoom(null);
      } else {
        await apiCreateRoom(payload);
        toast.success(t("toastRoomCreated"));
      }

      setDialogOpen(false);
      setForm({ ...emptyForm });
      triggerRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("toastFailedSaveRoom");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;
    try {
      setDeleting(true);
      await apiDeleteRoom(deleteDialog.id);
      toast.success(t("toastRoomDeleted"));
      setDeleteDialog(null);
      triggerRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("toastFailedDeleteRoom");
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (room: Room, newStatus: string) => {
    try {
      await apiUpdateRoomStatus(room.id, newStatus);
      toast.success(t("toastStatusChanged", { number: room.number, status: newStatus }));
      triggerRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("toastFailedUpdateStatus");
      toast.error(message);
    }
  };

  const handleReserveFromRoom = (room: Room) => {
    setInfoRoom(null);
    setPreselectedRoom({
      id: room.id,
      number: room.number,
      name: room.name,
      type: room.type,
      pricePerNight: room.pricePerNight,
      intent: "create",
    });
    setCurrentPage("reservations");
  };

  // ── Extend Stay ──
  const openExtendDialog = (res: RoomReservation) => {
    setExtendDialog(res);
    // Default to 1 day after current check-out
    const nextDay = new Date(res.checkOut);
    nextDay.setDate(nextDay.getDate() + 1);
    setExtendDate(nextDay.toISOString().split("T")[0]);
  };

  const handleExtendStay = async () => {
    if (!extendDialog || !extendDate) return;
    if (extendDate <= extendDialog.checkOut) {
      toast.error(t("toastInvalidCheckoutDate"));
      return;
    }
    try {
      setExtending(true);
      await apiUpdateReservation(extendDialog.id, { checkOut: extendDate });
      toast.success(t("toastStayExtended"));
      setExtendDialog(null);
      setExtendDate("");
      triggerRefresh();
      // Re-fetch room reservations
      if (infoRoom) {
        const data = await apiGetReservations(`roomId=${infoRoom.id}`);
        setRoomReservations(Array.isArray(data) ? data : []);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedExtendStay"));
    } finally {
      setExtending(false);
    }
  };

  // ── Early Checkout ──
  const handleEarlyCheckout = async () => {
    if (!earlyCheckoutDialog) return;
    try {
      setEarlyCheckingOut(true);
      await apiCheckout(earlyCheckoutDialog.id);
      toast.success(t("toastGuestCheckedOut"));
      setEarlyCheckoutDialog(null);
      setInfoRoom(null);
      setRoomReservations([]);
      triggerRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedCheckOut"));
    } finally {
      setEarlyCheckingOut(false);
    }
  };

  // ── Room Shift ──
  const openShiftDialog = (res: RoomReservation) => {
    setShiftDialog(res);
    setShiftTargetRoomId("");
  };

  const handleRoomShift = async () => {
    if (!shiftDialog || !shiftTargetRoomId || !infoRoom) return;
    if (shiftTargetRoomId === infoRoom.id) {
      toast.error(t("toastCannotShiftSameRoom"));
      return;
    }
    try {
      setShifting(true);
      // Update reservation to the new room
      await apiUpdateReservation(shiftDialog.id, { roomId: shiftTargetRoomId });
      // Free the old room
      await apiUpdateRoomStatus(infoRoom.id, "AVAILABLE");
      // Occupy the new room
      await apiUpdateRoomStatus(shiftTargetRoomId, "OCCUPIED");
      toast.success(t("toastGuestShifted"));
      setShiftDialog(null);
      setShiftTargetRoomId("");
      setInfoRoom(null);
      setRoomReservations([]);
      triggerRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedShiftRoom"));
    } finally {
      setShifting(false);
    }
  };

  // Available rooms for shift (exclude current room)
  const shiftAvailableRooms = useMemo(() => {
    if (!shiftDialog || !infoRoom) return [];
    return rooms.filter((r) => r.status === "AVAILABLE" && r.id !== infoRoom.id);
  }, [shiftDialog, infoRoom, rooms]);

  // Extend cost calculation
  const extendNights = useMemo(() => {
    if (!extendDialog || !extendDate) return 0;
    const diff = new Date(extendDate).getTime() - new Date(extendDialog.checkOut).getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [extendDialog, extendDate]);

  const extendExtraCost = extendNights * (extendDialog?.roomRate || 0);

  // ── Excel import ────────────────────────────────────────────────────────────
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportFile(e.target.files?.[0] ?? null);
    setImportResults(null);
  };

  const handleImport = async () => {
    if (!importFile) { toast.error(t("toastSelectExcelFile")); return; }
    setImportLoading(true);
    try {
      const buffer = await importFile.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

      if (rows.length === 0) { toast.error(t("toastNoDataRows")); return; }

      const result = await apiImportRooms(rows as Record<string, unknown>[]);
      setImportResults(result.results);
      toast.success(t("toastImportComplete", { imported: result.imported, skipped: result.skipped }));
      triggerRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("toastImportFailed");
      toast.error(message);
    } finally {
      setImportLoading(false);
    }
  };

  const closeImportDialog = () => {
    setImportDialogOpen(false);
    setImportFile(null);
    setImportResults(null);
    if (importFileRef.current) importFileRef.current.value = "";
  };

  const parseAmenities = (amenitiesStr: string | null | undefined): string[] => {
    if (!amenitiesStr) return [];
    try {
      const parsed = JSON.parse(amenitiesStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return amenitiesStr.split(",").map((s) => s.trim()).filter(Boolean);
    }
  };

  const floors = useMemo(() => {
    const set = new Set<number>();
    rooms.forEach((r) => {
      const f = getRoomFloor(r);
      if (f !== null) set.add(f);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [rooms]);

  // Local calendar date (YYYY-MM-DD) for date-aware room status.
  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Date-aware display status per room (what the filter buttons mean):
  // - OCCUPIED: a guest is checked in right now (ACTIVE reservation)
  // - MAINTENANCE: room taken out of service
  // - RESERVED: room.status is RESERVED in the database OR has an UPCOMING
  //   reservation with checkOut >= today
  // - AVAILABLE: free for today — nothing blocks today's date
  //
  // IMPORTANT: We check room.status FIRST (before the reservation maps)
  // because the reservation maintenance auto-cancels past-checkout
  // UPCOMING reservations, which would clear the RESERVED flag. But the
  // room.status field is set to RESERVED when a reservation is created
  // and only cleared when the guest checks out or the reservation is
  // cancelled. So room.status is the "sticky" indicator that survives
  // the maintenance cleanup.
  const displayStatus = useCallback((room: Room): string => {
    if (activeResMap[room.id]) return "OCCUPIED";
    if (room.status === "MAINTENANCE") return "MAINTENANCE";
    // Check room.status first — if the DB says RESERVED, trust it
    if (room.status === "RESERVED") return "RESERVED";
    // Also check if there's an UPCOMING reservation for this room
    const up = upcomingResMap[room.id];
    if (up && up.checkOut >= todayKey) return "RESERVED";
    // If room.status is OCCUPIED but no ACTIVE reservation found, still
    // show as OCCUPIED (the reservation map may not have loaded yet)
    if (room.status === "OCCUPIED") return "OCCUPIED";
    return "AVAILABLE";
  }, [activeResMap, upcomingResMap, todayKey]);

  // ── Secondary status: does this room ALSO have a future reservation? ──
  // A room can be OCCUPIED (guest currently checked in) AND simultaneously
  // have a future UPCOMING reservation booked. The primary displayStatus
  // is OCCUPIED, but the room should ALSO appear in the RESERVED filter
  // list so the operator can see that the room has a future booking.
  const hasFutureReservation = useCallback((room: Room): boolean => {
    const up = upcomingResMap[room.id];
    return !!up && up.checkOut > todayKey;
  }, [upcomingResMap, todayKey]);

  // Status priority for the list: bookable rooms first, occupied always last.
  const STATUS_ORDER: Record<string, number> = {
    AVAILABLE: 0,
    RESERVED: 1,
    MAINTENANCE: 2,
    OCCUPIED: 3,
  };
  // Pads digit runs so "2" < "10" and "102" < "201" when comparing room numbers.
  const roomNumberKey = (s: string) => s.replace(/\d+/g, (m) => m.padStart(8, "0"));

  const filteredRooms = useMemo(() => {
    return rooms
      .filter((room) => {
        if (statusFilter) {
          const st = displayStatus(room);
          // Primary status match
          if (st !== statusFilter) {
            // ── Dual-status: OCCUPIED rooms with future reservations ──
            // If filtering by RESERVED, also include OCCUPIED rooms that
            // have a future upcoming reservation.
            if (!(statusFilter === "RESERVED" && st === "OCCUPIED" && hasFutureReservation(room))) {
              return false;
            }
          }
        }
        if (floorFilter !== null && getRoomFloor(room) !== floorFilter) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          room.number.toLowerCase().includes(q) ||
          room.name.toLowerCase().includes(q) ||
          room.type.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const so = (STATUS_ORDER[displayStatus(a)] ?? 9) - (STATUS_ORDER[displayStatus(b)] ?? 9);
        if (so !== 0) return so;
        const fa = getRoomFloor(a) ?? a.floor;
        const fb = getRoomFloor(b) ?? b.floor;
        if (fa !== fb) return fa - fb;
        return roomNumberKey(a.number).localeCompare(roomNumberKey(b.number));
      });
  }, [rooms, statusFilter, floorFilter, search, displayStatus, hasFutureReservation]);

  // Per-status counts for the filter chips (respect the floor filter, ignore search).
  // OCCUPIED rooms that ALSO have a future reservation are counted in BOTH
  // the occupied AND reserved totals — they appear in both filter lists.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { AVAILABLE: 0, RESERVED: 0, OCCUPIED: 0, MAINTENANCE: 0 };
    rooms.forEach((r) => {
      if (floorFilter !== null && getRoomFloor(r) !== floorFilter) return;
      const st = displayStatus(r);
      if (counts[st] !== undefined) counts[st] += 1;
      // Dual-status: also count in RESERVED if OCCUPIED + future booking
      if (st === "OCCUPIED" && hasFutureReservation(r)) counts.RESERVED += 1;
    });
    return counts;
  }, [rooms, floorFilter, displayStatus, hasFutureReservation]);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "ETB", maximumFractionDigits: 0 }).format(price);

  const formatDate = (str: string): string => {
    try {
      const date = new Date(str);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return str;
    }
  };

  const calculateNightsStayed = (checkIn: string): number => {
    try {
      const checkInDate = new Date(checkIn);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      checkInDate.setHours(0, 0, 0, 0);
      const diff = today.getTime() - checkInDate.getTime();
      return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    } catch {
      return 0;
    }
  };

  const calculateNightsRemaining = (checkOut: string): number => {
    try {
      const checkOutDate = new Date(checkOut);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      checkOutDate.setHours(0, 0, 0, 0);
      const diff = checkOutDate.getTime() - today.getTime();
      return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    } catch {
      return 0;
    }
  };

  const daysUntil = (date: string): number => {
    try {
      const targetDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      targetDate.setHours(0, 0, 0, 0);
      const diff = targetDate.getTime() - today.getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  };

  if (loading && rooms.length === 0) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="mt-1 h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
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
        <div className="flex gap-2 items-center flex-wrap">
          {/* Subscription status badge */}
          <SubscriptionBadge />

          <Button variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            {t("btnImportExcel")}
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("btnAddRoom")}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder={t("searchPlaceholderFull")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Floor & Status Filter Buttons */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs font-medium text-gray-500 whitespace-nowrap">{t("filterFloor")}</span>
        <div className="flex gap-1.5">
          <Button
            variant={floorFilter === null && statusFilter === null ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs px-3 shrink-0"
            onClick={() => { setFloorFilter(null); setStatusFilter(null); }}
          >
            {t("filterAll")}
            <span className="ml-1 tabular-nums opacity-60">({rooms.length})</span>
          </Button>
          {/* Show floors 1, 2 as buttons — everything else goes in "Others" */}
          {[1, 2].filter((f) => floors.includes(f)).map((f) => (
            <Button
              key={f}
              variant={floorFilter === f ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs px-3 shrink-0"
              onClick={() => setFloorFilter(floorFilter === f ? null : f)}
            >
              <Building2 className="h-3.5 w-3.5 mr-1" />
              {f}
            </Button>
          ))}
          {floors.filter((f) => f > 2).length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={floorFilter !== null && floorFilter > 2 ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs px-3 shrink-0 gap-1"
                >
                  {t("filterOthers")}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {floors.filter((f) => f > 2).map((f) => (
                  <DropdownMenuItem
                    key={f}
                    className="text-xs"
                    onClick={() => setFloorFilter(f)}
                  >
                    <Building2 className="h-3.5 w-3.5 mr-2" />
                    {t("filterFloorLabel", { floor: f })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <span className="text-xs font-medium text-gray-500 whitespace-nowrap">{t("filterStatus")}</span>
        <div className="flex gap-1.5">
          {([
            { status: "AVAILABLE", icon: <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> },
            { status: "RESERVED", icon: <CalendarClock className="h-3.5 w-3.5 mr-1" /> },
            { status: "OCCUPIED", icon: <AlertCircle className="h-3.5 w-3.5 mr-1" /> },
            { status: "MAINTENANCE", icon: <Layers className="h-3.5 w-3.5 mr-1" /> },
          ]).map(({ status, icon }) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs px-3 shrink-0"
              onClick={() => setStatusFilter(statusFilter === status ? null : status)}
            >
              {icon}
              {t("status" + status.charAt(0) + status.slice(1).toLowerCase())}
              <span className="ml-1 tabular-nums opacity-60">({statusCounts[status] ?? 0})</span>
            </Button>
          ))}
        </div>
      </div>
      {/* Room Grid */}
      {filteredRooms.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
          <Building2 className="h-12 w-12 text-gray-300 mb-3" />
          <p className="font-medium text-lg">
            {search || floorFilter || statusFilter ? t("emptyNoMatch") : t("emptyNoRooms")}
          </p>
          <p className="text-sm mt-1 text-gray-400">
            {search || floorFilter || statusFilter
              ? t("emptyNoMatchHint")
              : t("emptyNoRoomsHint")}
          </p>
          {!search && (
            <div className="mt-4 flex gap-2">
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                {t("btnAddRoom")}
              </Button>
              <Button onClick={() => setImportDialogOpen(true)} variant="outline" className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                {t("btnImportExcel")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredRooms.map((room) => {
            const amenities = parseAmenities(room.amenities);
            const st = displayStatus(room);
            return (
              <Card key={room.id} className={`gap-0 overflow-hidden py-0 border-l-4 transition-shadow hover:shadow-md cursor-pointer ${STATUS_CARD[st] || "bg-white border-l-gray-300"}`} onClick={() => setInfoRoom(room)}>
                {/* Status Bar */}
                <div className={`h-1.5 w-full ${STATUS_DOT[st]}`} />

                <CardContent className="p-4">
                  {/* Room Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${ROOM_TYPE_COLORS[room.type]}`}>
                        {ROOM_TYPE_ICONS[room.type]}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 leading-tight">
                          {!isDefaultRoomName(room.name, room.number)
                            ? t("roomLabelWithName", { number: room.number, name: room.name })
                            : t("roomLabel", { number: room.number })}
                        </h3>
                        <p className="text-sm text-gray-500">{t("roomType" + (room.type.charAt(0).toUpperCase() + room.type.slice(1).toLowerCase()))}</p>
                      </div>
                    </div>
                    {/* Dropdown menu — hidden for RESERVED rooms (they only need the Reserve button) */}
                    {st !== "RESERVED" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">{t("srActions")}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {room.status === "OCCUPIED" ? (
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setInfoRoom(room); }}>
                            <ClipboardList className="mr-2 h-4 w-4" />
                            Manage Reservations
                          </DropdownMenuItem>
                        ) : room.status === "MAINTENANCE" ? (
                          /* No Edit button on maintenance rooms — only
                             "Enable (Back to Service)" toggle. */
                          null
                        ) : (
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(room); }}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t("btnEdit")}
                          </DropdownMenuItem>
                        )}
                        {/* Toggle Availability — AVAILABLE → MAINTENANCE,
                            MAINTENANCE → AVAILABLE (Back to Service) */}
                        {(room.status === "AVAILABLE" || room.status === "MAINTENANCE") && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextStatus = room.status === "AVAILABLE" ? "MAINTENANCE" : "AVAILABLE";
                              handleStatusChange(room, nextStatus);
                            }}
                          >
                            <Layers className="mr-2 h-4 w-4" />
                            {room.status === "MAINTENANCE" ? "Enable (Back to Service)" : t("menuToggleAvailability")}
                          </DropdownMenuItem>
                        )}
                        {st === "AVAILABLE" && (
                        <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-rose-600 focus:text-rose-600"
                          onClick={(e) => { e.stopPropagation(); setDeleteDialog(room); }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t("btnDelete")}
                        </DropdownMenuItem>
                        </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                  </div>

                  {/* Badges Row */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    <Badge variant="outline" className={ROOM_TYPE_COLORS[room.type]}>
                      {t("roomType" + (room.type.charAt(0).toUpperCase() + room.type.slice(1).toLowerCase()))}
                    </Badge>
                    {(st === "RESERVED" || st === "OCCUPIED") && roomResMap[room.id] ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className={`${STATUS_STYLES[st]} cursor-help`}>
                            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[st]}`} />
                            {t("status" + st.charAt(0) + st.slice(1).toLowerCase())}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="bg-gray-900 text-white border-0">
                          <div className="text-xs space-y-1">
                            {roomResMap[room.id].guest && (
                              <p className="font-semibold">{roomResMap[room.id].guest!.name}</p>
                            )}
                            <p>{t("tooltipReservedFrom")} {formatDate(roomResMap[room.id].checkIn)}</p>
                            <p>{t("tooltipReservedTo")} {formatDate(roomResMap[room.id].checkOut)}</p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge variant="outline" className={STATUS_STYLES[st]}>
                        <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[st]}`} />
                        {t("status" + st.charAt(0) + st.slice(1).toLowerCase())}
                      </Badge>
                    )}
                    {/* ── "Also reserved" badge ──
                        When a room is OCCUPIED but also has a future UPCOMING
                        reservation, show a small sky badge so the operator
                        knows this room has a future booking. */}
                    {st === "OCCUPIED" && hasFutureReservation(room) && (
                      <Badge variant="outline" className="ml-1 bg-sky-50 text-sky-700 border-sky-200">
                        <CalendarPlus className="mr-1 h-3 w-3" />
                        {t("alsoReserved") || "Also reserved"}
                        <span className="ml-1 opacity-70">· {formatDate(upcomingResMap[room.id]?.checkIn || "")}</span>
                      </Badge>
                    )}
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <DollarSign className="h-3.5 w-3.5 text-gray-400" />
                      <span>{formatPrice(room.pricePerNight)}</span>
                      <span className="text-gray-400">{t("perNight")}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Users className="h-3.5 w-3.5 text-gray-400" />
                      <span>{t("guest", { count: room.capacity })}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Building2 className="h-3.5 w-3.5 text-gray-400" />
                      <span>{t("infoFloorLabel", { floor: getFloorFromNumber(room.number) ?? room.floor })}</span>
                    </div>
                  </div>

                  {/* Amenities */}
                  {amenities.length > 0 && (
                    <>
                      <Separator className="my-3" />
                      <div className="flex flex-wrap gap-2">
                        {amenities.slice(0, 5).map((amenity) => (
                          <div
                            key={amenity}
                            className="flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600 border border-gray-100"
                          >
                            {AMENITY_ICONS[amenity] || <Layers className="h-3 w-3" />}
                            {amenity}
                          </div>
                        ))}
                        {amenities.length > 5 && (
                          <span className="flex items-center px-2 py-1 text-xs text-gray-400">
                            {t("moreAmenities", { count: amenities.length - 5 })}
                          </span>
                        )}
                      </div>
                    </>
                  )}

                  {/* Action Buttons */}
                  <Separator className="my-3" />
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 text-xs"
                      onClick={() => setInfoRoom(room)}
                    >
                      <Info className="h-3.5 w-3.5" />
                      {t("btnInfo")}
                    </Button>
                    {st === "AVAILABLE" ? (
                      <Button
                        size="sm"
                        className="flex-1 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={(e) => { e.stopPropagation(); handleReserveFromRoom(room); }}
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                        {t("btnReserve")}
                      </Button>
                    ) : st === "RESERVED" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        onClick={(e) => { e.stopPropagation(); handleReserveFromRoom(room); }}
                        title="Reserve for different dates"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                        {t("btnReserve")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        onClick={(e) => { e.stopPropagation(); handleReserveFromRoom(room); }}
                        title="Reserve for different dates"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                        {t("btnReserve")}
                      </Button>
                    )}
                  </div>

                  {/* Manage button — only on AVAILABLE rooms.
                      Opens the room detail dialog where the operator can
                      reserve, edit room details, or delete the room.
                      Other statuses (RESERVED/OCCUPIED/MAINTENANCE) only
                      have the Info + Reserve buttons in the row above. */}
                  {st === "AVAILABLE" && (
                  <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 text-xs text-slate-600 border-slate-200 hover:bg-slate-50"
                      onClick={() => setInfoRoom(room)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t("btnManage")}
                    </Button>
                  </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog — no Room Name field */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="sm:max-w-lg"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "512px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          <DialogHeader>
            <DialogTitle>{editingRoom ? t("dialogEditRoomTitle") : t("dialogAddRoomTitle")}</DialogTitle>
            <DialogDescription>
              {editingRoom
                ? t("dialogEditRoomDesc")
                : t("dialogAddRoomDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="room-number">
                  {t("labelRoomNumber")} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="room-number"
                  value={form.number}
                  onChange={(e) => {
                    const newNumber = e.target.value;
                    // Auto-derive the floor from the first digit of the room
                    // number so the floor field always matches the room number.
                    const derivedFloor = getFloorFromNumber(newNumber);
                    // Auto-sync the room name when it's currently a default
                    // pattern (e.g. "Room 1000" or "1000"). If the operator
                    // changed the number from 1000 → 1001 and the name was
                    // "Room 1000" (auto-generated), we update the name to
                    // "Room 1001" so it stays in sync. Custom names like
                    // "Honeymoon Suite" are preserved — only default-pattern
                    // names are auto-updated.
                    const currentName = form.name;
                    const oldNumber = form.number;
                    let newName = currentName;
                    if (isDefaultRoomName(currentName, oldNumber)) {
                      // Name is a default pattern matching the OLD number.
                      // Update it to the default pattern matching the NEW number.
                      // Preserve the "Room " prefix if the original had it,
                      // otherwise use the bare number (matches how the API
                      // generates default names: `Room ${number}`).
                      newName = newNumber ? `Room ${newNumber}` : "";
                    }
                    setForm({
                      ...form,
                      number: newNumber,
                      name: newName,
                      floor: derivedFloor !== null ? String(derivedFloor) : form.floor,
                    });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-type">{t("labelRoomType")}</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => {
                    // When switching to SINGLE, cap the existing capacity
                    // at 2 — matches the backend validation. Otherwise
                    // leave capacity untouched (operator can set higher
                    // for DOUBLE/TWIN/SUITE/etc.).
                    if (v === "SINGLE") {
                      const currentCap = parseInt(form.capacity, 10);
                      if (!isNaN(currentCap) && currentCap > 2) {
                        setForm({ ...form, type: v, capacity: "2" });
                        toast.info(t("capacityCappedTo2", { defaultValue: "Capacity capped to 2 for single rooms" }));
                        return;
                      }
                    }
                    setForm({ ...form, type: v });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROOM_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        <span className="flex items-center gap-2">
                          {ROOM_TYPE_ICONS[type]}
                          {t("roomType" + (type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()))}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="room-price">
                  {t("labelPriceNight")} <span className="text-gray-400 text-xs">(optional)</span>
                </Label>
                <Input
                  id="room-price"
                  type="number"
                  placeholder="0"
                  value={form.pricePerNight}
                  onChange={(e) => setForm({ ...form, pricePerNight: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-price-weekend">
                  {t("labelPriceNightWeekend", { defaultValue: "Weekend Price / Night" })}{" "}
                  <span className="text-gray-400 text-xs">
                    {t("labelPriceNightWeekendHint", { defaultValue: "(Fri+Sat, optional)" })}
                  </span>
                </Label>
                <Input
                  id="room-price-weekend"
                  type="number"
                  placeholder="0"
                  value={form.pricePerNightWeekend}
                  onChange={(e) => setForm({ ...form, pricePerNightWeekend: e.target.value })}
                />
                {form.pricePerNightWeekend && Number(form.pricePerNightWeekend) > 0 && (
                  <p className="text-[10px] text-emerald-600">
                    {t("weekendPriceHint", { defaultValue: "Friday + Saturday nights will use this rate. Sunday uses the standard rate." })}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-floor">
                  {t("labelFloor")} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="room-floor"
                  type="number"
                  value={form.floor}
                  onChange={(e) => setForm({ ...form, floor: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-capacity">
                  {t("labelCapacity")} <span className="text-rose-500">*</span>
                  {form.type === "SINGLE" && (
                    <span className="ml-2 text-[10px] font-normal text-amber-600">
                      {t("capacityCapSingle", { defaultValue: "max 2 for single rooms" })}
                    </span>
                  )}
                </Label>
                <Input
                  id="room-capacity"
                  type="number"
                  min={1}
                  max={form.type === "SINGLE" ? 2 : undefined}
                  value={form.capacity}
                  onChange={(e) => {
                    const val = e.target.value;
                    // Hard-cap at 2 when the room type is SINGLE —
                    // matches the backend validation in /api/rooms POST/PUT.
                    // For other room types, no cap is enforced client-side
                    // (the operator decides based on physical layout).
                    if (form.type === "SINGLE") {
                      const num = parseInt(val, 10);
                      if (!isNaN(num) && num > 2) {
                        setForm({ ...form, capacity: "2" });
                        toast.error(t("capacityCapSingleError", { defaultValue: "Single rooms can hold a maximum of 2 guests" }));
                        return;
                      }
                    }
                    setForm({ ...form, capacity: val });
                  }}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("btnCancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t("btnSaving") : editingRoom ? t("btnUpdateRoom") : t("btnCreateRoom")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excel Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={closeImportDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              {t("dialogImportTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dialogImportDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Template download */}
            <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800 mb-1">{t("importRequiredColumns")}</p>
              <p className="text-xs text-emerald-700 mb-3 font-mono">
                {t("importColumns")}
              </p>
              <p className="text-xs text-emerald-600 mb-3">
                {t("importTypeHint")}<br />
                {t("importAmenitiesHint")}
              </p>
              <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2 border-emerald-400 text-emerald-700 hover:bg-emerald-100">
                <Download className="h-3.5 w-3.5" />
                {t("btnDownloadTemplate")}
              </Button>
            </div>

            {/* File picker */}
            <div className="space-y-2">
              <Label htmlFor="excel-file">{t("labelSelectExcel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="excel-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  ref={importFileRef}
                  onChange={handleImportFileChange}
                  className="flex-1"
                />
              </div>
              {importFile && (
                <p className="text-xs text-gray-500">
                  {t("importFileSelected", { name: importFile.name, size: (importFile.size / 1024).toFixed(1) })}
                </p>
              )}
            </div>

            {/* Import results */}
            {importResults && (
              <div className="rounded-lg border bg-gray-50 p-3 max-h-48 overflow-y-auto space-y-1">
                <p className="text-xs font-semibold text-gray-600 mb-2">{t("importResults")}</p>
                {importResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {r.status === "created" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : r.status === "skipped" ? (
                      <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                    )}
                    <span className="font-medium">{t("roomLabel", { number: r.number })}</span>
                    <span className={r.status === "created" ? "text-emerald-600" : "text-amber-600"}>
                      {r.status === "created" ? t("importCreated") : r.error}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeImportDialog}>
              {importResults ? t("btnClose") : t("btnCancel")}
            </Button>
            {!importResults && (
              <Button onClick={handleImport} disabled={importLoading || !importFile} className="gap-2">
                <Upload className="h-4 w-4" />
                {importLoading ? t("btnImporting") : t("btnImportRooms")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogDeleteTitle")} {deleteDialog?.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialogDeleteDesc", { name: deleteDialog?.name || deleteDialog?.number })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("btnCancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? t("btnDeleting") : t("btnDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Room Handover Detail Dialog */}
      <Dialog open={!!infoRoom} onOpenChange={(open) => { if (!open) { setInfoRoom(null); setRoomReservations([]); } }}>
        <DialogContent
          className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "512px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          {infoRoom && (() => {
            const amenities = parseAmenities(infoRoom.amenities);
            const activeRes = roomReservations.find((r) => r.status === "ACTIVE" || r.status === "CHECKED_IN");
            const upcomingRes = roomReservations.filter((r) => r.status === "UPCOMING");

            return (
              <>
                {/* Header */}
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${ROOM_TYPE_COLORS[infoRoom.type]}`}>
                      {ROOM_TYPE_ICONS[infoRoom.type]}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{!isDefaultRoomName(infoRoom.name, infoRoom.number)
                        ? t("roomLabelWithName", { number: infoRoom.number, name: infoRoom.name })
                        : t("roomLabel", { number: infoRoom.number })}</span>
                      <Badge variant="outline" className={STATUS_STYLES[infoRoom.status]}>
                        <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[infoRoom.status]}`} />
                        {t("status" + infoRoom.status.charAt(0) + infoRoom.status.slice(1).toLowerCase())}
                      </Badge>
                    </div>
                  </DialogTitle>
                  <DialogDescription>{t("dialogHandoverTitle")}</DialogDescription>
                </DialogHeader>

                {/* Room Image */}
                {infoRoom.image && (
                  <div className="rounded-lg overflow-hidden border">
                    <img
                      src={infoRoom.image}
                      alt={`Room ${infoRoom.number}`}
                      className="w-full h-48 object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}

                {/* Description */}
                {infoRoom.description && (
                  <p className="text-sm text-gray-600 leading-relaxed">{infoRoom.description}</p>
                )}

                {/* Room Info Section */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3 bg-muted/50">
                    <p className="text-xs text-gray-500 mb-1">{t("infoRoomType")}</p>
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                      {ROOM_TYPE_ICONS[infoRoom.type]} {t("roomType" + (infoRoom.type.charAt(0).toUpperCase() + infoRoom.type.slice(1).toLowerCase()))}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/50">
                    <p className="text-xs text-gray-500 mb-1">{t("infoPricePerNight")}</p>
                    <p className="text-sm font-semibold text-gray-900">{formatPrice(infoRoom.pricePerNight)}</p>
                    {infoRoom.pricePerNightWeekend != null && Number(infoRoom.pricePerNightWeekend) > 0 && (
                      <p className="text-xs text-emerald-700 mt-1">
                        {t("infoPriceWeekend", { defaultValue: "Weekend (Fri+Sat):" })}{" "}
                        <strong>{formatPrice(infoRoom.pricePerNightWeekend)}</strong>
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/50">
                    <p className="text-xs text-gray-500 mb-1">{t("infoCapacity")}</p>
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-gray-400" /> {t("guest", { count: infoRoom.capacity })}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/50">
                    <p className="text-xs text-gray-500 mb-1">{t("infoFloor")}</p>
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                      <Building2 className="h-4 w-4 text-gray-400" /> {t("infoFloorLabel", { floor: infoRoom.floor })}
                    </p>
                  </div>
                </div>

                {/* Amenities */}
                {amenities.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">{t("infoAmenities")}</p>
                    <div className="flex flex-wrap gap-2">
                      {amenities.map((amenity) => (
                        <div
                          key={amenity}
                          className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200"
                        >
                          {AMENITY_ICONS[amenity] || <Layers className="h-3.5 w-3.5" />}
                          {amenity}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                {/* Current Status Section — Handover Info */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5" /> {t("currentStatus")}
                  </p>

                  {roomResLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                      <Clock className="h-4 w-4 animate-spin" /> {t("loadingReservations")}
                    </div>
                  ) : infoRoom.status === "OCCUPIED" ? (
                    activeRes ? (
                      <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-3 sm:p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            </span>
                            <Badge className="bg-emerald-600 text-white text-xs">{t("currentGuest")}</Badge>
                          </div>
                          <span className="text-xs text-emerald-600 font-medium">{t("occupied")}</span>
                        </div>

                        {activeRes.guest && (
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                              <User className="h-5 w-5 text-emerald-700" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{activeRes.guest.name}</p>
                              <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {activeRes.guest.phone}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2 text-xs sm:text-sm">
                          <div className="flex items-center gap-2 text-gray-600">
                            <CalendarDays className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <span>{t("checkIn")} <strong>{formatDate(activeRes.checkIn)}</strong></span>
                            <span className="text-gray-300">→</span>
                            <span>{t("checkOut")} <strong>{formatDate(activeRes.checkOut)}</strong></span>
                          </div>

                          {(() => {
                            const stayed = calculateNightsStayed(activeRes.checkIn);
                            const remaining = calculateNightsRemaining(activeRes.checkOut);
                            return (
                              <div className="flex items-center gap-1.5 text-gray-600">
                                <BedDouble className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                {remaining === 0 ? (
                                  <span className="font-medium text-amber-700">
                                    {t("infoStayedNights", { stayed })} — <span className="text-amber-600">{t("infoCheckoutToday")}</span>
                                  </span>
                                ) : (
                                  <span>
                                    {t("infoStayedNights", { stayed })}, <strong className="text-amber-700">{remaining}</strong> {t("infoNightsRemaining", { remaining })}
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          <Separator className="my-2" />

                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex items-center gap-1.5 text-gray-600">
                              <CreditCard className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                              <span>{t("infoTotal")} <strong className="text-gray-900">{formatPrice(activeRes.totalCost)}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {activeRes.paymentStatus === "PAID" ? (
                                <Badge variant="outline" className="border-emerald-300 text-emerald-700 text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> {t("paymentPaid")}
                                </Badge>
                              ) : activeRes.paymentStatus === "PARTIAL" ? (
                                <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" /> {t("paymentPartial")}
                                </Badge>
                              ) : activeRes.paymentStatus === "OVERDUE" ? (
                                <Badge variant="outline" className="border-rose-300 text-rose-700 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" /> {t("paymentOverdue")}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" /> {t("paymentUnpaid")}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-rose-200 bg-rose-50 p-4 text-center">
                        <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
                        <p className="text-sm text-rose-700 font-medium">{t("infoMarkedOccupied")}</p>
                        <p className="text-xs text-rose-500 mt-1">{t("infoNoActiveRes")}</p>
                      </div>
                    )
                  ) : infoRoom.status === "RESERVED" ? (
                    upcomingRes.length > 0 ? (
                      <div className="rounded-lg border-2 border-sky-200 bg-sky-50 p-3 sm:p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <CalendarClock className="h-4 w-4 text-sky-600" />
                            <Badge className="bg-sky-600 text-white text-xs">{t("infoUpcomingGuest")}</Badge>
                          </div>
                          <span className="text-xs text-sky-600 font-medium">{t("infoReserved")}</span>
                        </div>

                        {upcomingRes[0].guest && (
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100">
                              <User className="h-5 w-5 text-sky-700" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{upcomingRes[0].guest.name}</p>
                              <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {upcomingRes[0].guest.phone}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2 text-xs sm:text-sm">
                          <div className="flex items-center gap-2 text-gray-600">
                            <CalendarDays className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <span>{t("checkIn")}: <strong>{formatDate(upcomingRes[0].checkIn)}</strong></span>
                            <span className="text-gray-300">→</span>
                            <span>{t("checkOut")}: <strong>{formatDate(upcomingRes[0].checkOut)}</strong></span>
                          </div>

                          <div className="flex items-center gap-2 text-gray-600">
                            <BedDouble className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <span>{t("infoNightsReserved", { nights: upcomingRes[0].nights })}</span>
                          </div>

                          {(() => {
                            const days = daysUntil(upcomingRes[0].checkIn);
                            return (
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                                {days <= 0 ? (
                                  <span className="font-medium text-sky-700">{t("infoCheckinToday")}</span>
                                ) : (
                                  <span className="font-medium text-sky-700">{t("infoCheckinInDays", { days })}</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-sky-200 bg-sky-50 p-4 text-center">
                        <CalendarClock className="h-8 w-8 text-sky-400 mx-auto mb-2" />
                        <p className="text-sm text-sky-700 font-medium">{t("infoMarkedReserved")}</p>
                        <p className="text-xs text-sky-500 mt-1">{t("infoNoUpcomingRes")}</p>
                      </div>
                    )
                  ) : infoRoom.status === "AVAILABLE" ? (
                    <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-3 sm:p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        <span className="text-sm font-semibold text-emerald-700">{t("infoRoomAvailable")}</span>
                      </div>
                      {upcomingRes.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          <p className="text-xs text-emerald-600 font-medium">{t("infoUpcomingReservations")}</p>
                          {upcomingRes.slice(0, 3).map((res) => (
                            <div key={res.id} className="flex items-center justify-between rounded-md bg-emerald-100 px-2.5 py-1.5 text-xs">
                              <span className="text-gray-700">
                                {res.guest?.name || t("guestFallback")} · {formatDate(res.checkIn)} → {formatDate(res.checkOut)}
                              </span>
                              <span className="text-emerald-600 font-medium">{t("inDaysShort", { days: Math.max(0, daysUntil(res.checkIn)) })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : infoRoom.status === "MAINTENANCE" ? (
                    <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-3 sm:p-4">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                        <span className="text-sm font-semibold text-amber-700">{t("infoUnderMaintenance")}</span>
                      </div>
                      <p className="text-xs text-amber-600 mt-1">{t("infoMaintenanceNote")}</p>
                    </div>
                  ) : null}
                </div>

                <Separator />

                {/* Reservations History Section */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5" /> {t("reservationsHistory")}
                  </p>
                  {roomResLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                      <Clock className="h-4 w-4 animate-spin" /> {t("loading")}
                    </div>
                  ) : roomReservations.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center">
                      <p className="text-sm text-gray-400">{t("noReservationsForRoom")}</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {roomReservations.map((res) => (
                        <div key={res.id} className="rounded-lg border p-2.5 text-xs space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 shrink-0">
                                <User className="h-3.5 w-3.5 text-gray-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{res.guest?.name || "—"}</p>
                                <p className="text-gray-500">{formatDate(res.checkIn)} → {formatDate(res.checkOut)}</p>
                              </div>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[res.status] || ""}`}>
                                {t("status" + res.status.charAt(0) + res.status.slice(1).toLowerCase())}
                              </Badge>
                              <p className="font-medium text-gray-900 mt-0.5">{formatPrice(res.totalCost)}</p>
                            </div>
                          </div>
                          {/* Per-reservation actions — only for UPCOMING or ACTIVE */}
                          {(res.status === "UPCOMING" || res.status === "ACTIVE") && (
                            <div className="flex gap-1.5 flex-wrap pt-1 border-t">
                              {/* Change Dates */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] gap-1 text-sky-700 border-sky-200 hover:bg-sky-50"
                                onClick={() => {
                                  openExtendDialog(res);
                                }}
                              >
                                <CalendarClock className="h-3 w-3" /> Change Dates
                              </Button>
                              {/* Shift Room */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] gap-1 text-violet-700 border-violet-200 hover:bg-violet-50"
                                onClick={() => {
                                  openShiftDialog(res);
                                }}
                              >
                                <ArrowRightLeft className="h-3 w-3" /> Shift Room
                              </Button>
                              {/* Cancel — only for UPCOMING */}
                              {res.status === "UPCOMING" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[10px] gap-1 text-rose-600 border-rose-200 hover:bg-rose-50"
                                  onClick={async () => {
                                    if (!confirm(`Cancel reservation for ${res.guest?.name || "this guest"}?`)) return;
                                    try {
                                      const { apiCancelReservation } = await import("@/lib/api");
                                      await apiCancelReservation(res.id);
                                      toast.success("Reservation cancelled");
                                      // Refresh room reservations
                                      if (infoRoom) {
                                        const data = await apiGetReservations(`roomId=${infoRoom.id}`);
                                        setRoomReservations(Array.isArray(data) ? data : (data?.data || []));
                                      }
                                      triggerRefresh();
                                    } catch (err) {
                                      toast.error(err instanceof Error ? err.message : "Failed to cancel");
                                    }
                                  }}
                                >
                                  <XCircle className="h-3 w-3" /> Cancel
                                </Button>
                              )}
                              {/* Check Out / Early Checkout — only for ACTIVE.
                                  Label depends on whether checkout date has arrived. */}
                              {res.status === "ACTIVE" && (
                                isCheckoutDue(res.checkOut) ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px] gap-1 text-sky-700 border-sky-300 hover:bg-sky-50"
                                    onClick={() => {
                                      setEarlyCheckoutDialog(res);
                                    }}
                                  >
                                    <LogOut className="h-3 w-3" /> {t("btnCheckOut", "Check Out")}
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px] gap-1 text-amber-700 border-amber-200 hover:bg-amber-50"
                                    onClick={() => {
                                      setEarlyCheckoutDialog(res);
                                    }}
                                  >
                                    <LogOut className="h-3 w-3" /> Early Checkout
                                  </Button>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => { setInfoRoom(null); setRoomReservations([]); }}>
                    {t("btnClose")}
                  </Button>
                  {infoRoom.status === "AVAILABLE" ? (
                    <>
                      <Button
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleReserveFromRoom(infoRoom)}
                      >
                        <CalendarPlus className="h-4 w-4" />
                        {t("btnReserveThisRoom")}
                      </Button>
                      {/* Manage button — opens room edit dialog so the
                          operator can change room type, price, capacity,
                          or delete the room without leaving the info
                          dialog. Same openEdit() used by the ⋮ dropdown. */}
                      <Button
                        variant="outline"
                        className="gap-2 text-slate-700 border-slate-300 hover:bg-slate-50"
                        onClick={() => { openEdit(infoRoom); }}
                      >
                        <Pencil className="h-4 w-4" />
                        {t("btnManage")}
                      </Button>
                    </>
                  ) : infoRoom.status === "RESERVED" ? (
                    <Button
                      variant="outline"
                      className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                      onClick={() => handleReserveFromRoom(infoRoom)}
                    >
                      <CalendarPlus className="h-4 w-4" />
                      {t("btnReserve")}
                    </Button>
                  ) : infoRoom.status === "OCCUPIED" ? (
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        className="gap-2 bg-amber-600 hover:bg-amber-700"
                        onClick={() => {
                          const active = roomReservations.find((r) => r.status === "ACTIVE");
                          if (active) openExtendDialog(active);
                          else toast.error(t("toastNoActiveReservation"));
                        }}
                      >
                        <CalendarClock className="h-4 w-4" />
                        {t("btnExtendStay")}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2 border-rose-300 text-rose-700 hover:bg-rose-50"
                        onClick={() => {
                          const active = roomReservations.find((r) => r.status === "ACTIVE");
                          if (active) setEarlyCheckoutDialog(active);
                          else toast.error(t("toastNoActiveReservation"));
                        }}
                      >
                        <LogOut className="h-4 w-4" />
                        {(() => {
                          const active = roomReservations.find((r) => r.status === "ACTIVE");
                          return active && isCheckoutDue(active.checkOut)
                            ? t("btnCheckOut", "Check Out")
                            : t("btnEarlyOut");
                        })()}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        onClick={() => handleReserveFromRoom(infoRoom)}
                      >
                        <CalendarPlus className="h-4 w-4" />
                        {t("btnReserve")}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2 text-violet-700 border-violet-300 hover:bg-violet-50"
                        onClick={() => {
                          const active = roomReservations.find((r) => r.status === "ACTIVE");
                          if (active) openShiftDialog(active);
                          else toast.error(t("toastNoActiveReservation"));
                        }}
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        {t("btnShift")}
                      </Button>
                    </div>
                  ) : infoRoom.status === "MAINTENANCE" ? (
                    /* Manage button on maintenance rooms — lets the
                       operator edit room details or set it back to
                       AVAILABLE from the room edit dialog. */
                    <Button
                      variant="outline"
                      className="gap-2 text-slate-700 border-slate-300 hover:bg-slate-50"
                      onClick={() => { openEdit(infoRoom); }}
                    >
                      <Pencil className="h-4 w-4" />
                      {t("btnManage")}
                    </Button>
                  ) : null}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Extend Stay Dialog ── */}
      <Dialog open={!!extendDialog} onOpenChange={(open) => { if (!open) { setExtendDialog(null); setExtendDate(""); } }}>
        <DialogContent
          className="sm:max-w-md"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "448px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-amber-600" /> {t("dialogExtendTitle")}
            </DialogTitle>
            <DialogDescription>{t("dialogExtendDesc")}</DialogDescription>
          </DialogHeader>
          {extendDialog && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <p className="text-sm font-medium">{extendDialog.guest?.name || t("guestFallback")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("extendCurrentCheckout")} <strong>{formatDate(extendDialog.checkOut)}</strong>
                  <span className="mx-1">·</span>
                  {extendDialog.roomRate > 0 && <span>{formatPrice(extendDialog.roomRate)}{t("perNight")}</span>}
                </p>
              </div>
              <div>
                <Label>{t("lblnewCheckoutDate")} *</Label>
                <Input
                  type="date"
                  value={extendDate}
                  min={extendDialog.checkOut}
                  onChange={(e) => setExtendDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              {extendNights > 0 && (
                <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-amber-700">{t("extendExtraNights", { nights: extendNights })}</span>
                    <span className="font-bold text-amber-800">+{formatPrice(extendExtraCost)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setExtendDialog(null); setExtendDate(""); }}>{t("cancel")}</Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={handleExtendStay} disabled={extending || !extendDate || extendDate <= (extendDialog?.checkOut || "")}>
              {extending ? t("btnExtending") : t("btnExtendStay")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Early Checkout Dialog ── */}
      <AlertDialog open={!!earlyCheckoutDialog} onOpenChange={(open) => { if (!open) setEarlyCheckoutDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5 text-rose-600" /> {t("dialogEarlyCheckoutTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {earlyCheckoutDialog && (
                <span>
                  {t("dialogEarlyCheckoutDesc", { name: earlyCheckoutDialog.guest?.name || t("earlyCheckoutGuestFallback") })}
                  {earlyCheckoutDialog.paymentStatus !== "PAID" && (
                    <span className="block mt-2 text-amber-600 font-medium">
                      {t("earlyCheckoutBalanceNote", { balance: formatPrice(earlyCheckoutDialog.balance) })}
                    </span>
                  )}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={earlyCheckingOut}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={handleEarlyCheckout}
              disabled={earlyCheckingOut}
            >
              {earlyCheckingOut ? t("btnCheckingOut") : t("btnConfirmCheckout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Room Shift Dialog ── */}
      <Dialog open={!!shiftDialog} onOpenChange={(open) => { if (!open) { setShiftDialog(null); setShiftTargetRoomId(""); } }}>
        <DialogContent
          className="sm:max-w-md"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "448px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-violet-600" /> {t("dialogShiftTitle")}
            </DialogTitle>
            <DialogDescription>{t("dialogShiftDesc")}</DialogDescription>
          </DialogHeader>
          {shiftDialog && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <p className="text-sm font-medium">{shiftDialog.guest?.name || t("guestFallback")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("shiftCurrentRoom", { number: infoRoom?.number || "" })}
                </p>
              </div>
              <div>
                <Label>{t("lbltargetRoom")} *</Label>
                {shiftAvailableRooms.length > 0 ? (
                  <Select value={shiftTargetRoomId} onValueChange={setShiftTargetRoomId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={t("shiftSelectPlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {shiftAvailableRooms.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {t("shiftRoomOption", { number: r.number, name: r.name ? ` (${r.name})` : "", type: r.type, price: formatPrice(r.pricePerNight) })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1 text-sm text-amber-600">{t("shiftNoAvailableRooms")}</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShiftDialog(null); setShiftTargetRoomId(""); }}>{t("cancel")}</Button>
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={handleRoomShift} disabled={shifting || !shiftTargetRoomId}>
              {shifting ? t("btnShifting") : t("btnConfirmShift")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
