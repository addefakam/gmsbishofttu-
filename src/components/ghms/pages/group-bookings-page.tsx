"use client";
import { useTranslation } from "react-i18next";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import {
  apiGetGroupBookings,
  apiCreateGroupBooking,
  apiUpdateGroupBooking,
  apiDeleteGroupBooking,
  apiAutoAssignGroup,
  apiGetRooms,
  apiGetGuests,
  apiCreateReservation,
  apiCreateGuest,
  apiUpdateReservation,
  apiCancelReservation,
  apiCheckin,
  apiCheckout,
  apiGroupCheckout,
  apiGroupPayment,
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Users,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  Phone,
  Mail,
  Building2,
  UserPlus,
  X,
  LogIn,
  LogOut,
  Wand2,
  CreditCard,
  DollarSign,
  Eye,
  Loader2,
  CheckCircle2,
  Check,
  BedDouble,
  AlertCircle,
  CalendarClock,
  ArrowRightLeft,
  XCircle,
  CalendarPlus,
  Edit,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { isValidPhone, isValidEmail } from "@/lib/utils";

interface GroupBooking {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  startDate: string;
  endDate: string;
  status: string;
  notes: string;
  totalRooms: number;
  totalGuests: number;
  totalCost: number;
  // Group discount fields
  discountType?: string;    // "AMOUNT" or "PERCENT"
  discountAmount?: number; // ETB when AMOUNT, 0-100 when PERCENT
  reservations?: Reservation[];
  _count?: { reservations: number };
  createdAt: string;
}

interface Reservation {
  id: string;
  guestId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  status: string;
  totalCost: number;
  paidAmount?: number;
  balance?: number;
  paymentStatus?: string;
  nights?: number;
  roomRate?: number;
  notes?: string;
  guest?: { id: string; name: string; phone: string; email: string };
  room?: { id: string; number: string; name: string; type: string; pricePerNight: number };
}

// ── Check-in eligibility (mirrors /api/reservations/[id]/checkin) ──
//   1. Reservation must be UPCOMING
//   2. Today's date >= scheduled checkIn   (not before arrival)
//   3. Today's date <= scheduled checkOut   (not after planned checkout)
// The room-occupied check is enforced by the API server-side — we don't
// have all the rooms loaded here, and group check-in iterates per-reservation
// anyway, so the structured 409 will surface any room conflicts.
type CheckInEligibility = {
  canCheckIn: boolean;
  reasonKey: string | null;
  reasonContext: Record<string, string | number> | null;
};

// ── Group discount calculation helper ──
// Returns the discounted grand total given the group's subtotal and
// discount fields. Used by the card, detail dialog, and payment form.
function getDiscountedTotal(group: GroupBooking): {
  subtotal: number;
  discount: number;
  grandTotal: number;
  hasDiscount: boolean;
} {
  const subtotal = group.totalCost || 0;
  const type = group.discountType || "AMOUNT";
  const amount = group.discountAmount || 0;
  let discount = 0;
  if (amount > 0) {
    if (type === "PERCENT") {
      discount = Math.round(subtotal * (amount / 100) * 100) / 100;
    } else {
      discount = Math.min(amount, subtotal); // cap at subtotal
    }
  }
  return {
    subtotal,
    discount,
    grandTotal: Math.max(0, subtotal - discount),
    hasDiscount: discount > 0,
  };
}

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

interface GuestOption {
  id: string;
  name: string;
  phone: string;
}

interface RoomOption {
  id: string;
  number: string;
  name: string;
  type: string;
  status: string;
  pricePerNight: number;
  capacity?: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 border-amber-200",
  CONFIRMED: "bg-blue-100 text-blue-700 border-blue-200",
  IN_PROGRESS: "bg-emerald-100 text-emerald-700 border-emerald-200",
  COMPLETED: "bg-green-100 text-green-700 border-green-200",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
};

const RESERVATION_STATUS_BADGE: Record<string, string> = {
  UPCOMING: "bg-sky-100 text-sky-800 border-sky-200",
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  COMPLETED: "bg-gray-100 text-gray-700 border-gray-200",
  CANCELLED: "bg-rose-100 text-rose-800 border-rose-200",
};

const GROUP_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

export default function GroupBookingsPage() {
  const { t } = useTranslation("groupBookings");
  const { refreshKey } = useAppStore();

  const STATUS_LABELS: Record<string, string> = {
    PENDING: t("statusPENDING"),
    CONFIRMED: t("statusCONFIRMED"),
    IN_PROGRESS: t("statusIN_PROGRESS"),
    COMPLETED: t("statusCOMPLETED"),
    CANCELLED: t("statusCANCELLED"),
  };
  const RES_STATUS_LABELS: Record<string, string> = {
    UPCOMING: t("resStatusUPCOMING"),
    ACTIVE: t("resStatusACTIVE"),
    COMPLETED: t("resStatusCOMPLETED"),
    CANCELLED: t("resStatusCANCELLED"),
  };
  const PAY_STATUS_LABELS: Record<string, string> = {
    PAID: t("payStatusPAID"),
    PARTIAL: t("payStatusPARTIAL"),
    UNPAID: t("payStatusUNPAID"),
  };
  const ROOM_TYPE_LABELS: Record<string, string> = {
    SINGLE: t("roomTypeSINGLE"),
    DOUBLE: t("roomTypeDOUBLE"),
    TWIN: t("roomTypeTWIN"),
    SUITE: t("roomTypeSUITE"),
    TRIPLE: t("roomTypeTRIPLE"),
    DORMITORY: t("roomTypeDORMITORY"),
  };

  const [groupBookings, setGroupBookings] = useState<GroupBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addReservationOpen, setAddReservationOpen] = useState(false);
  const [addReservationGroupId, setAddReservationGroupId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupBooking | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addingReservation, setAddingReservation] = useState(false);

  // Create group form
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  // Group discount form fields
  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [discountAmount, setDiscountAmount] = useState("");

  // Add reservation form
  const [resGuestId, setResGuestId] = useState("");
  const [resRoomId, setResRoomId] = useState("");
  const [resCheckIn, setResCheckIn] = useState("");
  const [resCheckOut, setResCheckOut] = useState("");
  const [resSecondGuestName, setResSecondGuestName] = useState("");
  const [resSecondGuestPhone, setResSecondGuestPhone] = useState("");
  const [resSecondGuestIdNumber, setResSecondGuestIdNumber] = useState("");
  const [resExceptionallyReserved, setResExceptionallyReserved] = useState(false);
  const [resExceptionReason, setResExceptionReason] = useState("");

  // Inline guest registration
  const [showNewGuest, setShowNewGuest] = useState(false);
  const [showAdditionalDetails, setShowAdditionalDetails] = useState(false);
  // Tracks guests added in the current dialog session — shown as a list
  // at the top of the dialog so the operator can see their progress and
  // know that previous entries were saved (not cancelled).
  const [addedGuests, setAddedGuests] = useState<Array<{ name: string; roomNumber: string }>>([]);
  const [newGuestName, setNewGuestName] = useState("");
  const [newGuestPhone, setNewGuestPhone] = useState("");
  const [newGuestIdNumber, setNewGuestIdNumber] = useState("");
  const [newGuestIdType, setNewGuestIdType] = useState("");
  const [registeringGuest, setRegisteringGuest] = useState(false);

  // Unlink reservation
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  // Per-reservation actions (same as individual reservations page):
  // - Change Dates (extend stay)
  // - Shift Room (move to different room)
  // - Early Checkout
  // - Cancel reservation
  // - Check-in
  const [extendTarget, setExtendTarget] = useState<Reservation | null>(null);
  const [extendForm, setExtendForm] = useState({ checkIn: "", checkOut: "" });
  const [shiftTarget, setShiftTarget] = useState<Reservation | null>(null);
  const [shiftRoomId, setShiftRoomId] = useState("");
  const [earlyCheckoutTarget, setEarlyCheckoutTarget] = useState<Reservation | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Edit group dates dialog
  const [editDatesTarget, setEditDatesTarget] = useState<GroupBooking | null>(null);
  const [editDatesForm, setEditDatesForm] = useState({ startDate: "", endDate: "" });

  // Auto-assign
  const [autoAssigning, setAutoAssigning] = useState<string | null>(null);

  // Group payment dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentGroupId, setPaymentGroupId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "CASH", referenceNo: "", notes: "" });
  const [paying, setPaying] = useState(false);

  // Group checkout confirmation
  const [checkoutTarget, setCheckoutTarget] = useState<GroupBooking | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // Reservation detail dialog
  const [detailRes, setDetailRes] = useState<Reservation | null>(null);

  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [rooms, setRooms] = useState<RoomOption[]>([]);

  const fetchGroupBookings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGetGroupBookings(`page=${page}&limit=10`);
      setGroupBookings(res.data ?? []);
      setTotalPages(res.totalPages ?? 1);
    } catch {
      toast.error(t("toastFailedLoad"));
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchGuests = useCallback(async () => {
    try {
      const data = await apiGetGuests("");
      setGuests(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    }
  }, []);

  const fetchRooms = useCallback(async () => {
    try {
      const data = await apiGetRooms();
      // apiGetRooms already unwraps { rooms: [...] } to array
      setRooms(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchGroupBookings();
  }, [fetchGroupBookings, refreshKey]);

  useEffect(() => {
    if (createOpen || addReservationOpen) {
      fetchGuests();
      fetchRooms();
    }
  }, [createOpen, addReservationOpen, fetchGuests, fetchRooms]);

  const resetCreateForm = () => {
    setName("");
    setContactName("");
    setContactPhone("");
    setContactEmail("");
    setStartDate("");
    setEndDate("");
    setNotes("");
    setDiscountType("AMOUNT");
    setDiscountAmount("");
  };

  const resetReservationForm = () => {
    setResGuestId("");
    setResRoomId("");
    setResCheckIn("");
    setResCheckOut("");
    setResSecondGuestName("");
    setResSecondGuestPhone("");
    setResSecondGuestIdNumber("");
    setResExceptionallyReserved(false);
    setResExceptionReason("");
    setShowNewGuest(false);
    setShowAdditionalDetails(false);
    setNewGuestName("");
    setNewGuestPhone("");
    setNewGuestIdNumber("");
    setNewGuestIdType("");
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error(t("toastGroupNameRequired")); return; }
    if (!startDate || !endDate) { toast.error(t("toastDatesRequired")); return; }
    // Prevent past dates — group bookings are for future stays.
    // Past-date reservations get auto-cancelled by the maintenance cron,
    // which causes confusion (guest appears as "Cancelled" immediately).
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (startDate < todayStr) {
      toast.error(t("toastStartPastDate", { defaultValue: "Start date cannot be in the past. Please select today or a future date." }));
      return;
    }
    if (endDate <= startDate) {
      toast.error(t("toastEndBeforeStart", { defaultValue: "End date must be after the start date." }));
      return;
    }
    if (contactPhone.trim() && !isValidPhone(contactPhone)) {
      toast.error(t("toastInvalidPhone"));
      return;
    }
    if (contactEmail.trim() && !isValidEmail(contactEmail)) {
      toast.error(t("toastInvalidEmail"));
      return;
    }
    // Validate discount
    const discountNum = discountAmount ? Number(discountAmount) : 0;
    if (discountAmount && (isNaN(discountNum) || discountNum < 0)) {
      toast.error(t("toastInvalidDiscount", { defaultValue: "Invalid discount value" }));
      return;
    }
    if (discountType === "PERCENT" && discountNum > 100) {
      toast.error(t("toastDiscountPercentTooHigh", { defaultValue: "Discount percentage cannot exceed 100%" }));
      return;
    }
    try {
      setCreating(true);
      await apiCreateGroupBooking({
        name: name.trim(),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim(),
        startDate, endDate,
        notes: notes.trim(),
        discountType,
        discountAmount: discountNum,
      });
      setCreateOpen(false);
      resetCreateForm();
      await fetchGroupBookings();
      toast.success(t("toastCreated"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedCreate"));
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await apiUpdateGroupBooking(id, { status });
      toast.success(t("toastStatusUpdated", { status }));
      fetchGroupBookings();
    } catch {
      toast.error(t("toastFailedUpdateStatus"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await apiDeleteGroupBooking(deleteTarget.id);
      toast.success(t("toastDeleted"));
      setDeleteTarget(null);
      if (detailId === deleteTarget.id) setDetailId(null);
      fetchGroupBookings();
    } catch {
      toast.error(t("toastFailedDelete"));
    } finally {
      setDeleting(false);
    }
  };

  const handleRegisterGuest = async () => {
    if (!newGuestName.trim()) { toast.error(t("toastGuestNameRequired")); return; }
    // Phone is optional — only validate format IF the user provided one.
    if (newGuestPhone.trim() && !isValidPhone(newGuestPhone)) {
      toast.error(t("toastInvalidGuestPhone"));
      return;
    }
    try {
      setRegisteringGuest(true);
      const guest = await apiCreateGuest({
        name: newGuestName.trim(),
        // Phone + ID fields are optional — only save if the user filled them.
        // The DB schema allows empty strings for all of these.
        phone: newGuestPhone.trim() || undefined,
        idNumber: newGuestIdNumber.trim() || undefined,
        idType: newGuestIdType || undefined,
      });
      const newGuest = { id: guest.id, name: guest.name, phone: guest.phone || "" };
      setGuests((prev) => [newGuest, ...prev]);
      setResGuestId(guest.id);
      // Reset the form but DON'T close the dialog — the operator can
      // immediately register the next group member. The "Done" button
      // at the bottom closes the dialog when they're finished.
      setNewGuestName("");
      setNewGuestPhone("");
      setNewGuestIdNumber("");
      setNewGuestIdType("");
      setShowAdditionalDetails(false);
      toast.success(t("toastGuestRegistered", { name: guest.name }));
      return guest;
    } catch {
      toast.error(t("toastFailedRegister"));
      return null;
    } finally {
      setRegisteringGuest(false);
    }
  };

  const handleAddReservation = async (overrideGuestId?: string) => {
    // overrideGuestId is used when registering a NEW guest — the guest ID
    // isn't in the resGuestId state yet (React state update is async),
    // so the combined handler passes it directly.
    const effectiveGuestId = overrideGuestId || resGuestId;
    if (!addReservationGroupId || !effectiveGuestId || !resRoomId) {
      toast.error(t("toastSelectGuestRoom"));
      return;
    }
    if (!resCheckIn || !resCheckOut) {
      toast.error(t("toastCheckinCheckoutRequired"));
      return;
    }
    // Second guest is NOT mandatory. Only validate if the user provided one.
    const selRoom = rooms.find((r) => r.id === resRoomId);
    if (resSecondGuestName.trim() && resSecondGuestPhone.trim()) {
      if (!isValidPhone(resSecondGuestPhone)) {
        toast.error(t("toastInvalidSecondPhone"));
        return;
      }
    }
    if (resExceptionallyReserved && !resExceptionReason.trim()) {
      toast.error(t("toastExceptionReasonRequired"));
      return;
    }
    try {
      setAddingReservation(true);
      await apiCreateReservation({
        guestId: effectiveGuestId,
        roomId: resRoomId,
        checkIn: resCheckIn,
        checkOut: resCheckOut,
        groupBookingId: addReservationGroupId,
        secondGuestName: resSecondGuestName,
        secondGuestPhone: resSecondGuestPhone,
        secondGuestIdNumber: resSecondGuestIdNumber,
        exceptionallyReserved: resExceptionallyReserved,
        exceptionReason: resExceptionReason,
      });
      toast.success(t("toastReservationAdded"));
      // Track the added guest for the "added so far" display
      const addedRoom = rooms.find((r) => r.id === resRoomId);
      const addedGuestName = showNewGuest
        ? (newGuestName.trim() || "(guest)")
        : (guests.find((g) => g.id === effectiveGuestId)?.name || "(guest)");
      // Note: at this point newGuestName might already be cleared by
      // handleRegisterGuest, so we use the guest name from the guests list
      // or the API response. Let's get it from the guests list.
      const guestName = guests.find((g) => g.id === effectiveGuestId)?.name || addedGuestName;
      setAddedGuests((prev) => [...prev, {
        name: guestName,
        roomNumber: addedRoom?.number || "?",
      }]);
      // DON'T close the dialog — reset the form so the operator can
      // immediately add the next group member. The "Done" button at
      // the bottom closes the dialog when they're finished.
      // Only reset guest-specific fields, NOT the dates (they stay the
      // same for the whole group).
      setResGuestId("");
      setResRoomId("");
      setResSecondGuestName("");
      setResSecondGuestPhone("");
      setResSecondGuestIdNumber("");
      setResExceptionallyReserved(false);
      setResExceptionReason("");
      setNewGuestName("");
      setNewGuestPhone("");
      setNewGuestIdNumber("");
      setNewGuestIdType("");
      setShowAdditionalDetails(false);
      // Refresh BOTH group bookings AND rooms — the room that was just
      // assigned changed status from AVAILABLE → RESERVED, so we need
      // the updated room list so the operator doesn't try to assign the
      // same room to another guest (which would fail with ROOM_CONFLICT).
      fetchGroupBookings();
      fetchRooms();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedAddReservation"));
    } finally {
      setAddingReservation(false);
    }
  };

  const handleUnlinkReservation = async (reservationId: string) => {
    try {
      setUnlinkingId(reservationId);
      await apiUpdateReservation(reservationId, { groupBookingId: null });
      toast.success(t("toastReservationRemoved"));
      fetchGroupBookings();
    } catch {
      toast.error(t("toastFailedRemoveReservation"));
    } finally {
      setUnlinkingId(null);
    }
  };

  // ── Per-reservation actions (same features as individual reservations) ──

  const handleResCheckin = async (resId: string) => {
    try {
      setActionLoading(resId);
      await apiCheckin(resId);
      toast.success(t("toastCheckedIn", { defaultValue: "Guest checked in" }));
      // Auto-transition: if group is PENDING or CONFIRMED, set to IN_PROGRESS
      const group = groupBookings.find((g) => g.reservations?.some((r) => r.id === resId));
      if (group && (group.status === "PENDING" || group.status === "CONFIRMED")) {
        try { await apiUpdateGroupBooking(group.id, { status: "IN_PROGRESS" }); } catch { /* non-blocking */ }
      }
      fetchGroupBookings();
      fetchRooms();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedCheckin", { defaultValue: "Failed to check in" }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleResCancel = async (resId: string) => {
    if (!confirm(t("confirmCancelReservation", { defaultValue: "Cancel this reservation? This cannot be undone." }))) return;
    try {
      setActionLoading(resId);
      await apiCancelReservation(resId);
      toast.success(t("toastReservationCancelled", { defaultValue: "Reservation cancelled" }));
      fetchGroupBookings();
      fetchRooms();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedCancel", { defaultValue: "Failed to cancel" }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleExtendSave = async () => {
    if (!extendTarget) return;
    if (!extendForm.checkIn || !extendForm.checkOut) {
      toast.error(t("toastDatesRequired"));
      return;
    }
    try {
      setActionLoading(extendTarget.id);
      await apiUpdateReservation(extendTarget.id, {
        checkIn: extendForm.checkIn,
        checkOut: extendForm.checkOut,
      });
      toast.success(t("toastDatesUpdated", { defaultValue: "Dates updated" }));
      setExtendTarget(null);
      fetchGroupBookings();
      fetchRooms();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedUpdate", { defaultValue: "Failed to update" }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleShiftRoom = async () => {
    if (!shiftTarget || !shiftRoomId) {
      toast.error(t("toastSelectRoom", { defaultValue: "Please select a room" }));
      return;
    }
    try {
      setActionLoading(shiftTarget.id);
      await apiUpdateReservation(shiftTarget.id, { roomId: shiftRoomId });
      toast.success(t("toastRoomShifted", { defaultValue: "Room changed successfully" }));
      setShiftTarget(null);
      setShiftRoomId("");
      fetchGroupBookings();
      fetchRooms();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedShift", { defaultValue: "Failed to change room" }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleEarlyCheckout = async () => {
    if (!earlyCheckoutTarget) return;
    try {
      setActionLoading(earlyCheckoutTarget.id);
      await apiCheckout(earlyCheckoutTarget.id);
      toast.success(t("toastCheckedOut", { defaultValue: "Guest checked out" }));
      // Auto-transition: if all reservations in the group are COMPLETED/CANCELLED,
      // set the group status to COMPLETED
      const group = groupBookings.find((g) => g.reservations?.some((r) => r.id === earlyCheckoutTarget.id));
      if (group && group.status === "IN_PROGRESS") {
        const allDone = group.reservations?.every((r) => r.status === "COMPLETED" || r.status === "CANCELLED" || r.id === earlyCheckoutTarget.id);
        if (allDone) {
          try { await apiUpdateGroupBooking(group.id, { status: "COMPLETED" }); } catch { /* non-blocking */ }
        }
      }
      setEarlyCheckoutTarget(null);
      fetchGroupBookings();
      fetchRooms();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedCheckout", { defaultValue: "Failed to check out" }));
    } finally {
      setActionLoading(null);
    }
  };

  // ── Edit group dates (propagates to all reservations) ──

  const handleEditGroupDates = async () => {
    if (!editDatesTarget) return;
    if (!editDatesForm.startDate || !editDatesForm.endDate) {
      toast.error(t("toastDatesRequired"));
      return;
    }
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (editDatesForm.startDate < todayStr) {
      toast.error(t("toastStartPastDate", { defaultValue: "Start date cannot be in the past" }));
      return;
    }
    if (editDatesForm.endDate <= editDatesForm.startDate) {
      toast.error(t("toastEndBeforeStart", { defaultValue: "End date must be after start date" }));
      return;
    }
    try {
      setActionLoading("group-dates");
      // Update the group's dates
      await apiUpdateGroupBooking(editDatesTarget.id, {
        startDate: editDatesForm.startDate,
        endDate: editDatesForm.endDate,
      });
      // Propagate to all reservations in the group
      const reservations = editDatesTarget.reservations || [];
      for (const res of reservations) {
        if (res.status === "UPCOMING" || res.status === "ACTIVE") {
          await apiUpdateReservation(res.id, {
            checkIn: editDatesForm.startDate,
            checkOut: editDatesForm.endDate,
          });
        }
      }
      toast.success(t("toastGroupDatesUpdated", { defaultValue: "Group dates updated for all guests" }));
      setEditDatesTarget(null);
      fetchGroupBookings();
      fetchRooms();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("toastFailedUpdate", { defaultValue: "Failed to update dates" }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleAutoAssign = async (groupId: string) => {
    try {
      setAutoAssigning(groupId);
      const result = await apiAutoAssignGroup(groupId);
      const { assigned, unassigned } = result as { assigned: Array<{ guestName: string; roomNumber: string; roomName: string; roomType: string; pricePerNight: number; totalCost: number; isNew: boolean }>; unassigned: Array<{ guestName: string; reason: string }> };
      if (assigned.length > 0) {
        const newCount = assigned.filter((a) => a.isNew).length;
        toast.success(t("toastAutoAssigned", { count: assigned.length, newCount: newCount > 0 ? t("toastAutoAssignedNew", { count: newCount }) : "" }));
      }
      if (unassigned.length > 0) {
        toast.warning(t("toastAutoUnassigned", { count: unassigned.length, names: unassigned.map((u) => u.guestName).join(", ") }));
      }
      if (assigned.length === 0 && unassigned.length === 0) {
        toast.info(t("toastNoUnassigned"));
      }
      setDetailId(groupId);
      fetchGroupBookings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("toastAutoAssignFailed");
      if (msg.includes("NO_ROOMS")) {
        toast.error(t("toastNoAvailableRooms"));
      } else {
        toast.error(msg);
      }
    } finally {
      setAutoAssigning(null);
    }
  };

  const handleGroupCheckin = async (group: GroupBooking) => {
    const upcomingReservations = group.reservations?.filter(
      (r) => r.status === "UPCOMING"
    ) || [];
    if (upcomingReservations.length === 0) {
      toast.info(t("toastNoUpcomingCheckin"));
      return;
    }

    // ── Pre-check eligibility per-reservation ──
    // Splits the upcoming list into "eligible" and "blocked" up-front so
    // the operator sees a clear breakdown instead of silent failures:
    //   - Eligible ones proceed to the API
    //   - Blocked ones are listed with their reason in a single toast
    //     (e.g. "2 guests could not be checked in: arrival date is
    //     tomorrow, checkout date has passed"). The API also enforces
    //     each gate server-side, so any client-side miss (e.g. room
    //     became occupied after page load) will still surface as a
    //     per-reservation failure below.
    const eligible: Reservation[] = [];
    const blocked: { res: Reservation; reasonKey: string; reasonCtx: Record<string, string | number> }[] = [];
    for (const res of upcomingReservations) {
      const elig = getCheckInEligibility(res);
      if (elig.canCheckIn) {
        eligible.push(res);
      } else if (elig.reasonKey) {
        blocked.push({ res, reasonKey: elig.reasonKey, reasonCtx: elig.reasonContext || {} });
      }
    }

    if (eligible.length === 0) {
      // All blocked — tell the user up-front rather than firing N API
      // calls that would all 409.
      const first = blocked[0];
      toast.error(
        t("toastBulkCheckinAllBlocked", {
          count: blocked.length,
          reason: first ? t(first.reasonKey, first.reasonCtx) : "",
        })
      );
      return;
    }

    try {
      let checked = 0;
      const apiFailures: { res: Reservation; message: string }[] = [];
      for (const res of eligible) {
        try {
          await apiCheckin(res.id);
          checked++;
        } catch (err: unknown) {
          // The API rejected this one — capture the structured message
          // (e.g. "Room X is already occupied by Y") so we can surface
          // a clear per-reservation failure toast instead of silently
          // skipping it. Previously these were swallowed.
          const message = err instanceof Error ? err.message : "Unknown error";
          apiFailures.push({ res, message });
        }
      }

      // Successes
      if (checked > 0) {
        toast.success(t("toastCheckedIn", { count: checked }));
      }

      // Client-side pre-check blocked ones (date window, etc.)
      if (blocked.length > 0) {
        const first = blocked[0];
        toast.warning(
          t("toastBulkCheckinPartialBlocked", {
            count: blocked.length,
            reason: t(first.reasonKey, first.reasonCtx),
          })
        );
      }

      // API-side failures (e.g. room became occupied between page load
      // and tap — the structured 409 message explains it).
      if (apiFailures.length > 0) {
        const first = apiFailures[0];
        toast.error(
          t("toastBulkCheckinPartialFailed", {
            count: apiFailures.length,
            guest: first.res.guest?.name || "—",
            reason: first.message,
          })
        );
      }

      fetchGroupBookings();
    } catch {
      toast.error(t("toastBulkCheckinFailed"));
    }
  };

  const handleGroupCheckout = async () => {
    if (!checkoutTarget) return;
    try {
      setCheckingOut(true);
      const result = await apiGroupCheckout(checkoutTarget.id);
      const r = result as { checkedOut: number; total: number; message: string };
      toast.success(r.message || t("toastCheckedOut", { count: r.checkedOut }));
      setCheckoutTarget(null);
      fetchGroupBookings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("toastCheckoutFailed");
      toast.error(msg);
    } finally {
      setCheckingOut(false);
    }
  };

  const openPaymentDialog = (group: GroupBooking) => {
    // Calculate total cost and total paid from reservations
    const subtotal = group.reservations?.reduce((s, r) => (s + (r.totalCost || 0)), 0) || 0;
    // Apply group discount to get the effective grand total
    const pricing = getDiscountedTotal({ ...group, totalCost: subtotal });
    setPaymentGroupId(group.id);
    setPaymentForm({ amount: String(pricing.grandTotal), method: "CASH", referenceNo: "", notes: "" });
    setPaymentOpen(true);
  };

  const handleGroupPayment = async () => {
    if (!paymentGroupId || !paymentForm.amount || !paymentForm.method) {
      toast.error(t("toastAmountMethodRequired"));
      return;
    }
    try {
      setPaying(true);
      const result = await apiGroupPayment(paymentGroupId, {
        amount: Number(paymentForm.amount),
        method: paymentForm.method,
        referenceNo: paymentForm.referenceNo,
        notes: paymentForm.notes,
      });
      const r = result as { message: string };
      toast.success(r.message || t("toastPaymentRecorded"));
      setPaymentOpen(false);
      setPaymentGroupId(null);
      fetchGroupBookings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("toastPaymentFailed");
      toast.error(msg);
    } finally {
      setPaying(false);
    }
  };

  const openAddReservation = (group: GroupBooking) => {
    setAddReservationGroupId(group.id);
    setResCheckIn(group.startDate);
    setResCheckOut(group.endDate);
    setAddedGuests([]); // clear the "added so far" list for the new session
    setAddReservationOpen(true);
  };

  const toggleDetail = (id: string) => {
    setDetailId((prev) => (prev === id ? null : id));
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const selectedGroup = groupBookings.find((g) => g.id === addReservationGroupId);
  const groupRoomIds = new Set(selectedGroup?.reservations?.map((r) => r.roomId) || []);
  const availableRooms = rooms.filter(
    (r) => (!r.status || r.status === "AVAILABLE") && !groupRoomIds.has(r.id)
  );
  const resCount = (g: GroupBooking) =>
    g.reservations?.length ?? g._count?.reservations ?? 0;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" />
            {t("pageTitle")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("pageSubtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t("btnNewGroupBooking")}
        </Button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-48" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full max-w-md" />
                  <Skeleton className="h-4 w-3/4 max-w-sm" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && groupBookings.length === 0 && (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center justify-center text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground">
              {t("emptyTitle")}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t("emptySubtitle")}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("btnCreateGroupBooking")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Group Booking List */}
      {!loading && groupBookings.length > 0 && (
        <div className="space-y-4">
          {groupBookings.map((group) => {
            const isExpanded = detailId === group.id;
            const badgeClass = STATUS_COLORS[group.status] ?? "bg-gray-100 text-gray-700 border-gray-200";
            const numRes = resCount(group);
            const upcomingCount = group.reservations?.filter((r) => r.status === "UPCOMING").length ?? 0;
            const activeCount = group.reservations?.filter((r) => r.status === "ACTIVE").length ?? 0;
            const completedCount = group.reservations?.filter((r) => r.status === "COMPLETED").length ?? 0;

            // ── Business rules based on group status ──
            // PENDING     → can add guests, auto-assign, edit dates, change room/dates per guest.
            //               Can also check in individual guests (auto-transitions to IN_PROGRESS).
            // CONFIRMED   → can check in (all + individual), pay, edit dates. Cannot add guests.
            // IN_PROGRESS → can check out, pay, per-reservation actions. Cannot add guests or check in new guests.
            // COMPLETED   → read-only (no actions).
            // CANCELLED   → read-only (only delete allowed).
            const gs = group.status;
            const canAddGuests = gs === "PENDING";
            const canAutoAssign = gs === "PENDING";
            const canEditDates = gs === "PENDING" || gs === "CONFIRMED";
            const canCheckinAll = (gs === "PENDING" || gs === "CONFIRMED") && upcomingCount > 0;
            const canCheckoutAll = gs === "IN_PROGRESS" && activeCount > 0;
            const canPay = gs === "PENDING" || gs === "CONFIRMED" || gs === "IN_PROGRESS";
            const canDelete = gs === "PENDING" || gs === "CANCELLED";
            const isReadOnly = gs === "COMPLETED" || gs === "CANCELLED";
            // Per-reservation actions: available in PENDING, CONFIRMED, IN_PROGRESS
            const canPerResAction = !isReadOnly;

            return (
              <Card key={group.id} className="overflow-hidden">
                {/* Card Header */}
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <CardTitle className="text-base font-semibold truncate">
                        {group.name}
                      </CardTitle>
                      <Badge variant="outline" className={badgeClass}>
                        {STATUS_LABELS[group.status] || group.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                      <Select
                        value={group.status}
                        onValueChange={(value) => handleStatusChange(group.id, value)}
                        disabled={isReadOnly}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GROUP_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{STATUS_LABELS[s] || s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {canCheckinAll && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                          onClick={() => handleGroupCheckin(group)}
                        >
                          <LogIn className="h-3.5 w-3.5 mr-1" />
                          {t("btnCheckinAll")} ({upcomingCount})
                        </Button>
                      )}
                      {/* Group check-in also auto-transitions PENDING/CONFIRMED → IN_PROGRESS */}
                      {canCheckoutAll && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-orange-600 border-orange-200 hover:bg-orange-50"
                          onClick={() => setCheckoutTarget(group)}
                        >
                          <LogOut className="h-3.5 w-3.5 mr-1" />
                          <span className="hidden sm:inline">{t("btnCheckoutAll")}</span>
                        </Button>
                      )}
                      {canPay && group.reservations?.some((r) => r.status !== "COMPLETED" && r.status !== "CANCELLED" && r.status !== "DELETED") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-blue-600 border-blue-200 hover:bg-blue-50"
                          onClick={() => openPaymentDialog(group)}
                        >
                          <CreditCard className="h-3.5 w-3.5 mr-1" />
                          <span className="hidden sm:inline">{t("btnPay")}</span>
                        </Button>
                      )}
                      {canAutoAssign && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-violet-600 border-violet-200 hover:bg-violet-50"
                          disabled={autoAssigning === group.id}
                          onClick={() => handleAutoAssign(group.id)}
                        >
                          {autoAssigning === group.id ? (
                            <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                          ) : (
                            <Wand2 className="h-3.5 w-3.5 mr-1" />
                          )}
                          <span className="hidden sm:inline">{t("btnAutoAssign")}</span>
                        </Button>
                      )}
                      {canAddGuests && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAddReservation(group)}
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1" />
                          <span className="hidden sm:inline">{t("btnAddGuest")}</span>
                        </Button>
                      )}
                      {canEditDates && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditDatesTarget(group);
                            setEditDatesForm({ startDate: group.startDate, endDate: group.endDate });
                          }}
                          title={t("btnEditDates", { defaultValue: "Edit Group Dates" })}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(group)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleDetail(group.id)}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {/* Card Body */}
                <CardContent className="pt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    {group.contactName && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{group.contactName}</span>
                      </div>
                    )}
                    {group.contactPhone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4 flex-shrink-0" />
                        <span>{group.contactPhone}</span>
                      </div>
                    )}
                    {group.contactEmail && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{group.contactEmail}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CalendarDays className="h-4 w-4 flex-shrink-0" />
                      <span>
                        {formatDate(group.startDate)} — {formatDate(group.endDate)}
                      </span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-5 mt-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      <span>{t(numRes === 1 ? "reservations_one" : "reservations_other", { count: numRes })}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      <span>{t((group.totalGuests || 0) === 1 ? "guests_one" : "guests_other", { count: group.totalGuests || 0 })}</span>
                    </div>
                    {(group.totalCost ?? 0) > 0 && (() => {
                      const pricing = getDiscountedTotal(group);
                      if (pricing.hasDiscount) {
                        return (
                          <span className="font-medium text-foreground flex items-center gap-1.5">
                            <span className="text-muted-foreground line-through text-xs">{pricing.subtotal.toLocaleString()}</span>
                            <span>{pricing.grandTotal.toLocaleString()} ETB</span>
                            <Badge variant="outline" className="text-[9px] text-emerald-700 border-emerald-300 bg-emerald-50 px-1 py-0">
                              -{pricing.discount.toLocaleString()}
                            </Badge>
                          </span>
                        );
                      }
                      return (
                        <span className="font-medium text-foreground">
                          {group.totalCost?.toLocaleString()} ETB
                        </span>
                      );
                    })()}
                  </div>

                  {group.notes && (
                    <p className="mt-3 text-sm text-muted-foreground border-l-2 border-muted pl-3">
                      {group.notes}
                    </p>
                  )}

                  {/* Expanded: Linked Reservations */}
                  {isExpanded && (
                    <div className="mt-4 border rounded-lg overflow-hidden">
                      {numRes > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("thguest")}</TableHead>
                              <TableHead>{t("thassignedRoom")}</TableHead>
                              <TableHead>{t("throomType")}</TableHead>
                              <TableHead>{t("thcost")}</TableHead>
                              <TableHead>{t("thcheckin")}</TableHead>
                              <TableHead>{t("thstatus")}</TableHead>
                              <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.reservations?.map((res) => (
                              <TableRow
                                key={res.id}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => setDetailRes(res)}
                              >
                                <TableCell className="font-medium">
                                  <div>
                                    <div>{res.guest?.name ?? t("unknownGuest")}</div>
                                    {res.guest?.phone && (
                                      <div className="text-xs text-muted-foreground">{res.guest.phone}</div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {res.room
                                    ? (
                                      <div>
                                        <div className="font-medium">{res.room.number}{res.room.name ? ` - ${res.room.name}` : ""}</div>
                                      </div>
                                    )
                                    : <span className="text-muted-foreground">{t("notAssigned")}</span>}
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                  {res.room?.type ? (
                                    <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-xs">
                                      {ROOM_TYPE_LABELS[res.room.type] || res.room.type}
                                    </Badge>
                                  ) : "—"}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  {res.totalCost > 0 ? (
                                    <span className="text-sm font-medium">{res.totalCost.toLocaleString()} ETB</span>
                                  ) : "—"}
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                  {formatDate(res.checkIn)}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={
                                      RESERVATION_STATUS_BADGE[res.status] ??
                                      "bg-gray-100 text-gray-700 border-gray-200"
                                    }
                                  >
                                    {RES_STATUS_LABELS[res.status] || res.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    {/* Check-in — for UPCOMING + group must be PENDING, CONFIRMED, or IN_PROGRESS */}
                                    {res.status === "UPCOMING" && canPerResAction && (gs === "PENDING" || gs === "CONFIRMED" || gs === "IN_PROGRESS") && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-emerald-600 hover:bg-emerald-50"
                                        disabled={actionLoading === res.id}
                                        onClick={(e) => { e.stopPropagation(); handleResCheckin(res.id); }}
                                        title={t("btnCheckIn", { defaultValue: "Check In" })}
                                      >
                                        {actionLoading === res.id ? (
                                          <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                          <LogIn className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    )}
                                    {/* Check-out — only for ACTIVE + group must be IN_PROGRESS */}
                                    {res.status === "ACTIVE" && canPerResAction && gs === "IN_PROGRESS" && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-amber-600 hover:bg-amber-50"
                                        disabled={actionLoading === res.id}
                                        onClick={(e) => { e.stopPropagation(); setEarlyCheckoutTarget(res); }}
                                        title={t("btnEarlyCheckout", { defaultValue: "Check Out" })}
                                      >
                                        {actionLoading === res.id ? (
                                          <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                          <LogOut className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    )}
                                    {/* Change Dates — for UPCOMING or ACTIVE + non-read-only */}
                                    {(res.status === "UPCOMING" || res.status === "ACTIVE") && canPerResAction && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-sky-600 hover:bg-sky-50"
                                        onClick={(e) => { e.stopPropagation(); setExtendTarget(res); setExtendForm({ checkIn: res.checkIn, checkOut: res.checkOut }); }}
                                        title={t("btnChangeDates", { defaultValue: "Change Dates" })}
                                      >
                                        <CalendarClock className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    {/* Shift Room — for UPCOMING or ACTIVE + non-read-only */}
                                    {(res.status === "UPCOMING" || res.status === "ACTIVE") && canPerResAction && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-violet-600 hover:bg-violet-50"
                                        onClick={(e) => { e.stopPropagation(); setShiftTarget(res); setShiftRoomId(""); }}
                                        title={t("btnShiftRoom", { defaultValue: "Change Room" })}
                                      >
                                        <ArrowRightLeft className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    {/* Cancel — only for UPCOMING + group must be CONFIRMED or PENDING */}
                                    {res.status === "UPCOMING" && canPerResAction && (gs === "PENDING" || gs === "CONFIRMED") && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-rose-600 hover:bg-rose-50"
                                        disabled={actionLoading === res.id}
                                        onClick={(e) => { e.stopPropagation(); handleResCancel(res.id); }}
                                        title={t("btnCancelReservation", { defaultValue: "Cancel Reservation" })}
                                      >
                                        <XCircle className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    {/* Unlink from group — only when PENDING or CONFIRMED (can't unlink from an active/completed group) */}
                                    {(gs === "PENDING" || gs === "CONFIRMED") && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                        disabled={unlinkingId === res.id}
                                        onClick={(e) => { e.stopPropagation(); handleUnlinkReservation(res.id); }}
                                        title={t("titleRemoveFromGroup")}
                                      >
                                        {unlinkingId === res.id ? (
                                          <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                          <X className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-40" />
                          {t("noReservationsYet")}
                        </div>
                      )}

                      {/* Discount breakdown + Notes — shown when the group detail is expanded */}
                      {(() => {
                        const pricing = getDiscountedTotal(group);
                        const hasNotes = group.notes && group.notes.trim().length > 0;
                        if (!pricing.hasDiscount && !hasNotes) return null;
                        return (
                          <div className="border-t bg-muted/30 px-4 py-3 space-y-3">
                            {/* Discount breakdown */}
                            {pricing.hasDiscount && (
                              <div className="space-y-1 text-sm">
                                <div className="flex items-center justify-between text-muted-foreground">
                                  <span>{t("subtotal", { defaultValue: "Subtotal" })}</span>
                                  <span>{pricing.subtotal.toLocaleString()} ETB</span>
                                </div>
                                <div className="flex items-center justify-between text-emerald-700">
                                  <span>
                                    {t("discount", { defaultValue: "Discount" })}
                                    {group.discountType === "PERCENT" && ` (${group.discountAmount}%)`}
                                  </span>
                                  <span>-{pricing.discount.toLocaleString()} ETB</span>
                                </div>
                                <div className="flex items-center justify-between font-bold text-foreground border-t pt-1">
                                  <span>{t("grandTotal", { defaultValue: "Grand Total" })}</span>
                                  <span>{pricing.grandTotal.toLocaleString()} ETB</span>
                                </div>
                              </div>
                            )}
                            {/* Notes */}
                            {hasNotes && (
                              <div className="text-sm">
                                <p className="text-xs font-medium text-muted-foreground mb-1">{t("lblnotes")}</p>
                                <p className="text-foreground whitespace-pre-wrap border-l-2 border-muted pl-3">{group.notes}</p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("btnPrevious")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("pageOf", { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("btnNext")}
          </Button>
        </div>
      )}

      {/* Create Group Booking Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => {
        if (!open) resetCreateForm();
        setCreateOpen(open);
      }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("dlgCreateTitle")}</DialogTitle>
            <DialogDescription>
              {t("dlgCreateDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="group-name">
                {t("lblgroupName")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="group-name"
                placeholder={t("lblgroupNamePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{t("lblcontactName")}</Label>
                <Input
                  id="contact-name"
                  placeholder={t("placeholderFullName")}
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("lblcontactPhone")}</Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  placeholder={t("placeholderPhone")}
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("lblcontactEmail")}</Label>
              <Input
                id="contact-email"
                type="email"
                placeholder={t("placeholderEmail")}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="start-date">
                  {t("lblstartDate")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  min={(() => {
                    const d = new Date();
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  })()}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="end-date">
                  {t("lblendDate")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || (() => {
                    const d = new Date();
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  })()}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("lblnotes")}</Label>
              <Input
                id="notes"
                placeholder={t("placeholderNotes")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Group Discount */}
            <div className="grid gap-2">
              <Label>{t("lblGroupDiscount", { defaultValue: "Group Discount (optional)" })}</Label>
              <div className="flex gap-2">
                <Select value={discountType} onValueChange={(v) => setDiscountType(v as "AMOUNT" | "PERCENT")}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AMOUNT">{t("discountTypeAmount", { defaultValue: "Amount (ETB)" })}</SelectItem>
                    <SelectItem value="PERCENT">{t("discountTypePercent", { defaultValue: "Percent (%)" })}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  max={discountType === "PERCENT" ? "100" : undefined}
                  placeholder="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="flex-1"
                />
              </div>
              {discountAmount && Number(discountAmount) > 0 && (
                <p className="text-xs text-emerald-600">
                  {discountType === "PERCENT"
                    ? t("discountPreviewPercent", { defaultValue: "{{value}}% off the group subtotal", value: discountAmount })
                    : t("discountPreviewAmount", { defaultValue: "{{value}} ETB off the group subtotal", value: Number(discountAmount).toLocaleString() })}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); resetCreateForm(); }}
              disabled={creating}
            >
              {t("btnCancel")}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? t("btnCreating") : t("btnCreateGroup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Guest / Reservation to Group Dialog */}
      <Dialog
        open={addReservationOpen}
        onOpenChange={(open) => {
          if (!open) { resetReservationForm(); setAddReservationGroupId(null); }
          setAddReservationOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("dlgAddGuestTitle")}</DialogTitle>
            <DialogDescription>
              {t("dlgAddGuestDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* "Added so far" list — shows guests added in this session.
                This gives the operator visual confirmation that previous
                entries were saved (not cancelled) when the form resets. */}
            {addedGuests.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("addedSoFar", { defaultValue: "Added to group" })} ({addedGuests.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {addedGuests.map((g, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-md bg-white border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700">
                      <Check className="h-3 w-3" />
                      {g.name} · Room {g.roomNumber}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Guest Selection with inline register toggle */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>{t("lblGuest")} <span className="text-destructive">*</span></Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowNewGuest(!showNewGuest)}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {showNewGuest ? t("btnSelectExisting") : t("btnRegisterNewGuest")}
                </Button>
              </div>

              {!showNewGuest ? (
                /* Existing guest dropdown */
                <Select value={resGuestId} onValueChange={setResGuestId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("placeholderSelectGuest")} />
                  </SelectTrigger>
                  <SelectContent>
                    {guests.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}{g.phone ? ` — ${g.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                /* Inline guest registration form */
                <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                  {/* Full Name — the only required field */}
                  <div className="grid gap-1.5">
                    <Label htmlFor="new-guest-name" className="text-xs">
                      {t("lblFullName")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="new-guest-name"
                      placeholder={t("placeholderGuestFullName")}
                      value={newGuestName}
                      onChange={(e) => setNewGuestName(e.target.value)}
                      autoFocus
                    />
                  </div>

                  {/* Collapsible "additional details" section — Phone + ID Type + ID Number.
                      All three are optional. Hidden by default to keep the form simple
                      for the common case (operator just types a name and clicks Register).
                      Expanding reveals the 3 fields in a 2-column grid. */}
                  <button
                    type="button"
                    onClick={() => setShowAdditionalDetails(!showAdditionalDetails)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                  >
                    {showAdditionalDetails ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {showAdditionalDetails
                      ? t("hideAdditionalDetails", { defaultValue: "Hide additional details" })
                      : t("showAdditionalDetails", { defaultValue: "Show additional details (optional)" })}
                  </button>

                  {showAdditionalDetails && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">
                            {t("lblphoneNumber")}{" "}
                            <span className="text-[10px] text-muted-foreground/60">
                              ({t("optional", { defaultValue: "optional" })})
                            </span>
                          </Label>
                          <Input
                            id="new-guest-phone"
                            type="tel"
                            placeholder={t("placeholderPhone")}
                            value={newGuestPhone}
                            onChange={(e) => setNewGuestPhone(e.target.value)}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">
                            {t("lblidType")}{" "}
                            <span className="text-[10px] text-muted-foreground/60">
                              ({t("optional", { defaultValue: "optional" })})
                            </span>
                          </Label>
                          <Select value={newGuestIdType} onValueChange={setNewGuestIdType}>
                            <SelectTrigger id="new-guest-id-type">
                              <SelectValue placeholder={t("placeholderSelectIdType")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="National_ID">{t("idNationalId")}</SelectItem>
                              <SelectItem value="Passport">{t("idPassport")}</SelectItem>
                              <SelectItem value="Driver_License">{t("idDriverLicense")}</SelectItem>
                              <SelectItem value="Military_ID">{t("idMilitaryId")}</SelectItem>
                              <SelectItem value="Other">{t("idOther")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">
                          {t("lblidNumber")}{" "}
                          <span className="text-[10px] text-muted-foreground/60">
                            ({t("optional", { defaultValue: "optional" })})
                          </span>
                        </Label>
                        <Input
                          id="new-guest-id-number"
                          placeholder={t("placeholderIdNumber")}
                          value={newGuestIdNumber}
                          onChange={(e) => setNewGuestIdNumber(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Room Selection — always visible (both existing + new guest modes) */}
            <div className="grid gap-2">
              <Label>{t("lblRoom")} <span className="text-destructive">*</span></Label>
              <Select value={resRoomId} onValueChange={(val) => { setResRoomId(val); setResSecondGuestName(""); setResSecondGuestPhone(""); setResSecondGuestIdNumber(""); setResExceptionallyReserved(false); setResExceptionReason(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder={t("placeholderSelectRoom")} />
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.length > 0 ? (
                    availableRooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.number}{r.name ? ` — ${r.name}` : ""}
                        {r.type ? ` (${ROOM_TYPE_LABELS[r.type] || r.type})` : ""}
                        {r.pricePerNight ? ` — ${r.pricePerNight} ${t("etbPerNight")}` : ""}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      {t("noAvailableRooms")}
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Second Guest — shown for rooms with capacity >= 2 */}
            {(() => {
              const r = rooms.find((x) => x.id === resRoomId);
              if (!r) return false;
              return Number(r.capacity || 0) >= 2;
            })() && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-3">
                <div className="flex items-center gap-2 text-amber-800">
                  <BedDouble className="h-4 w-4" />
                  <span className="text-xs font-semibold">{t("doubleRoomSecondGuest")}</span>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="grp-res-exception" checked={!resExceptionallyReserved} onChange={() => { setResExceptionallyReserved(false); setResExceptionReason(""); }} className="h-3.5 w-3.5 accent-emerald-600" />
                    <span className="text-xs font-medium">{t("twoGuests")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="grp-res-exception" checked={resExceptionallyReserved} onChange={() => { setResExceptionallyReserved(true); setResSecondGuestName(""); setResSecondGuestPhone(""); setResSecondGuestIdNumber(""); }} className="h-3.5 w-3.5 accent-amber-600" />
                    <span className="text-xs font-medium text-amber-700">{t("exceptionallyReserved")}</span>
                  </label>
                </div>
                {!resExceptionallyReserved ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-foreground">{t("secondGuestInfo")}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>{t("lblSecondGuestName")} <span className="text-rose-500">*</span></Label>
                        <Input placeholder={t("placeholderFullName")} value={resSecondGuestName} onChange={(e) => setResSecondGuestName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t("lblSecondGuestPhone")} <span className="text-rose-500">*</span></Label>
                        <Input type="tel" placeholder={t("placeholderPhone")} value={resSecondGuestPhone} onChange={(e) => setResSecondGuestPhone(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("lblSecondGuestIdNumber")}</Label>
                      <Input placeholder={t("placeholderIdNumber")} value={resSecondGuestIdNumber} onChange={(e) => setResSecondGuestIdNumber(e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-amber-700">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <p className="text-[10px] font-medium">{t("exceptionExplanation")}</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("lblExceptionReason")} <span className="text-rose-500">*</span></Label>
                      <Textarea placeholder={t("placeholderExceptionReason")} rows={2} value={resExceptionReason} onChange={(e) => setResExceptionReason(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dates — inherited from the group booking (read-only).
                The group's startDate/endDate are the single source of truth
                for all guests in the group. Showing them as read-only info
                prevents the operator from accidentally setting different
                (or past) dates per guest. */}
            {(() => {
              const grp = groupBookings.find((g) => g.id === addReservationGroupId);
              if (!grp) return null;
              return (
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                  <p className="text-xs font-medium text-blue-700 mb-1.5 flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {t("groupDatesLabel", { defaultValue: "Group dates (applied to all guests)" })}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-blue-600/70">{t("lblcheckinDate")}</p>
                      <p className="text-sm font-medium text-blue-900">{formatDate(grp.startDate)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-blue-600/70">{t("lblcheckoutDate")}</p>
                      <p className="text-sm font-medium text-blue-900">{formatDate(grp.endDate)}</p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddReservationOpen(false);
                resetReservationForm();
                setAddReservationGroupId(null);
              }}
              disabled={addingReservation || registeringGuest}
            >
              {t("btnDone", { defaultValue: "Done" })}
            </Button>
            <Button
              onClick={async () => {
                // When in "Register New Guest" mode, create the guest FIRST,
                // then create the reservation — all in one click.
                if (showNewGuest) {
                  if (!newGuestName.trim()) {
                    toast.error(t("toastGuestNameRequired"));
                    return;
                  }
                  const guest = await handleRegisterGuest();
                  if (!guest) return; // error toast already shown by handleRegisterGuest
                  // Pass the guest ID directly — don't rely on the async
                  // resGuestId state update (which hasn't applied yet).
                  if (!resRoomId) {
                    toast.error(t("toastSelectGuestRoom"));
                    return;
                  }
                  await handleAddReservation(guest.id);
                } else {
                  await handleAddReservation();
                }
              }}
              disabled={
                addingReservation ||
                registeringGuest ||
                // In existing-guest mode: need resGuestId + resRoomId
                // In new-guest mode: need newGuestName + resRoomId
                (showNewGuest ? !newGuestName.trim() || !resRoomId : !resGuestId || !resRoomId)
              }
            >
              {addingReservation || registeringGuest ? (
                <>
                  <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                  {showNewGuest
                    ? t("btnRegistering", { defaultValue: "Registering..." })
                    : t("btnAdding")}
                </>
              ) : (
                <>
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  {showNewGuest
                    ? t("btnRegisterAddToGroup", { defaultValue: "Register & Add to Group" })
                    : t("btnAddToGroup")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog — right-aligned, half-screen width */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <DialogContent className="sm:max-w-[400px]" style={{ right: '1rem', left: 'auto', transform: 'none', top: '50%', translateY: '-50%' } as React.CSSProperties}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              {t("dlgDeleteTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dlgDeleteDesc", { name: deleteTarget?.name || "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t("btnCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
              ) : null}
              {deleting ? t("btnDeleting") : t("btnDelete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Checkout Confirmation Dialog */}
      <Dialog
        open={!!checkoutTarget}
        onOpenChange={(open) => { if (!open) setCheckoutTarget(null); }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5 text-orange-500" />
              {t("dlgCheckoutTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dlgCheckoutDesc", { name: checkoutTarget?.name || "", count: checkoutTarget?.reservations?.filter((r: { status: string }) => r.status === "ACTIVE").length || 0 })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setCheckoutTarget(null)}
              disabled={checkingOut}
            >
              {t("btnCancel")}
            </Button>
            <Button
              onClick={handleGroupCheckout}
              disabled={checkingOut}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {checkingOut ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("btnCheckingOut")}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <LogOut className="h-4 w-4" /> {t("btnCheckoutAll")}
                </span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Payment Dialog */}
      <Dialog open={paymentOpen} onOpenChange={(open) => {
        if (!open) { setPaymentGroupId(null); setPaymentForm({ amount: "", method: "CASH", referenceNo: "", notes: "" }); }
        setPaymentOpen(open);
      }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-blue-500" />
              {t("dlgPaymentTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dlgPaymentDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>{t("lblAmount")} <span className="text-destructive">*</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">ETB</span>
                <Input
                  type="number"
                  min="1"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="pl-12"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("lblPaymentMethod")} <span className="text-destructive">*</span></Label>
              <Select value={paymentForm.method} onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">{t("payCash")}</SelectItem>
                  <SelectItem value="TRANSFER">{t("payTransfer")}</SelectItem>
                  <SelectItem value="CARD">{t("payCard")}</SelectItem>
                  <SelectItem value="MOBILE">{t("payMobile")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("lblreferenceNo")}</Label>
              <Input
                value={paymentForm.referenceNo}
                onChange={(e) => setPaymentForm({ ...paymentForm, referenceNo: e.target.value })}
                placeholder={t("placeholderReference")}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("lblnotes")}</Label>
              <Input
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                placeholder={t("placeholderPaymentNotes")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setPaymentOpen(false); setPaymentGroupId(null); }}
              disabled={paying}
            >
              {t("btnCancel")}
            </Button>
            <Button
              onClick={handleGroupPayment}
              disabled={paying || !paymentForm.amount || Number(paymentForm.amount) <= 0}
            >
              {paying ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("btnProcessing")}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4" /> {t("btnRecordPayment")}
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reservation Detail Dialog */}
      <Dialog open={!!detailRes} onOpenChange={(open) => { if (!open) setDetailRes(null); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {t("dlgResDetailTitle")}
            </DialogTitle>
          </DialogHeader>
          {detailRes && (
            <div className="space-y-4">
              {/* Guest info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("lblGuestDetail")}</p>
                  <p className="text-sm font-medium">{detailRes.guest?.name ?? t("unknownGuest")}</p>
                  {detailRes.guest?.phone && <p className="text-xs text-muted-foreground">{detailRes.guest.phone}</p>}
                  {detailRes.guest?.email && <p className="text-xs text-muted-foreground">{detailRes.guest.email}</p>}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("lblRoomDetail")}</p>
                  <p className="text-sm font-medium">
                    {detailRes.room ? `${detailRes.room.number}${detailRes.room.name ? ` - ${detailRes.room.name}` : ""}` : t("notAssigned")}
                  </p>
                  {detailRes.room?.type && (
                    <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-xs">
                      {ROOM_TYPE_LABELS[detailRes.room.type] || detailRes.room.type}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("lblCheckinDetail")}</p>
                  <p className="text-sm font-medium">{formatDate(detailRes.checkIn)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("lblCheckoutDetail")}</p>
                  <p className="text-sm font-medium">{formatDate(detailRes.checkOut)}</p>
                </div>
              </div>

              {/* Cost and payment */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-lg border p-3 bg-muted/30">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t("lblTotalCost")}</p>
                  <p className="text-sm font-bold">{detailRes.totalCost?.toLocaleString() ?? 0} ETB</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t("lblPaid")}</p>
                  <p className="text-sm font-medium text-emerald-600">{detailRes.paidAmount?.toLocaleString() ?? 0} ETB</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t("lblBalance")}</p>
                  <p className={`text-sm font-bold ${(detailRes.balance ?? detailRes.totalCost ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {Math.max(0, detailRes.balance ?? detailRes.totalCost ?? 0).toLocaleString()} ETB
                  </p>
                </div>
              </div>

              {/* Status row */}
              <div className="flex items-center gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">{t("lblStatus")}</p>
                  <Badge
                    variant="outline"
                    className={RESERVATION_STATUS_BADGE[detailRes.status] ?? "bg-gray-100 text-gray-700 border-gray-200"}
                  >
                    {RES_STATUS_LABELS[detailRes.status] || detailRes.status}
                  </Badge>
                </div>
                {detailRes.paymentStatus && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">{t("lblPayment")}</p>
                    <Badge
                      variant="outline"
                      className={
                        detailRes.paymentStatus === "PAID"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : detailRes.paymentStatus === "PARTIAL"
                          ? "bg-amber-100 text-amber-800 border-amber-200"
                          : "bg-gray-100 text-gray-600 border-gray-200"
                      }
                    >
                      {PAY_STATUS_LABELS[detailRes.paymentStatus] || detailRes.paymentStatus}
                    </Badge>
                  </div>
                )}
              </div>

              {detailRes.room?.pricePerNight && detailRes.nights && (
                <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3">
                  {t("nightsCalc", { nights: detailRes.nights, rate: detailRes.room.pricePerNight.toLocaleString(), total: detailRes.totalCost?.toLocaleString() ?? "0" })}
                </div>
              )}

              {/* Per-guest notes — editable inline */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  {t("perGuestNotes", { defaultValue: "Guest Notes (special requests, VIP, late arrival, etc.)" })}
                </Label>
                <Textarea
                  value={detailRes.notes || ""}
                  onChange={(e) => setDetailRes({ ...detailRes, notes: e.target.value })}
                  placeholder={t("perGuestNotesPlaceholder", { defaultValue: "e.g. VIP — wants extra towels, Late arrival at 11 PM, Allergic to feather pillows" })}
                  className="text-sm"
                  rows={2}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={async () => {
                    try {
                      await apiUpdateReservation(detailRes.id, { notes: detailRes.notes || "" });
                      toast.success(t("toastNotesSaved", { defaultValue: "Notes saved" }));
                    } catch {
                      toast.error(t("toastNotesSaveFailed", { defaultValue: "Failed to save notes" }));
                    }
                  }}
                >
                  {t("btnSaveNotes", { defaultValue: "Save Notes" })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Change Dates Dialog (per-reservation) ── */}
      <Dialog open={!!extendTarget} onOpenChange={(open) => { if (!open) setExtendTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              {t("dlgChangeDatesTitle", { defaultValue: "Change Reservation Dates" })}
            </DialogTitle>
            <DialogDescription>
              {extendTarget?.guest?.name ?? ""} — Room {extendTarget?.room?.number ?? ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="grid gap-2">
              <Label>{t("lblcheckinDate")}</Label>
              <Input type="date" value={extendForm.checkIn} onChange={(e) => setExtendForm({ ...extendForm, checkIn: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("lblcheckoutDate")}</Label>
              <Input type="date" value={extendForm.checkOut} onChange={(e) => setExtendForm({ ...extendForm, checkOut: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendTarget(null)}>{t("btnCancel")}</Button>
            <Button onClick={handleExtendSave} disabled={actionLoading === extendTarget?.id}>
              {actionLoading === extendTarget?.id ? (
                <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
              ) : null}
              {t("btnSave", { defaultValue: "Save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Shift Room Dialog (per-reservation) ── */}
      <Dialog open={!!shiftTarget} onOpenChange={(open) => { if (!open) setShiftTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              {t("dlgShiftRoomTitle", { defaultValue: "Change Room" })}
            </DialogTitle>
            <DialogDescription>
              {shiftTarget?.guest?.name ?? ""} — currently in Room {shiftTarget?.room?.number ?? ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>{t("lblRoom")} <span className="text-destructive">*</span></Label>
            <Select value={shiftRoomId} onValueChange={setShiftRoomId}>
              <SelectTrigger><SelectValue placeholder={t("placeholderSelectRoom")} /></SelectTrigger>
              <SelectContent>
                {rooms.filter((r) => r.status === "AVAILABLE" && r.id !== shiftTarget?.roomId).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.number}{r.name ? ` — ${r.name}` : ""}
                    {r.type ? ` (${r.type})` : ""}
                    {r.pricePerNight ? ` — ${r.pricePerNight} ETB` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftTarget(null)}>{t("btnCancel")}</Button>
            <Button onClick={handleShiftRoom} disabled={!shiftRoomId || actionLoading === shiftTarget?.id}>
              {actionLoading === shiftTarget?.id ? (
                <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
              ) : null}
              {t("btnShift", { defaultValue: "Change Room" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Early Checkout Confirmation ── */}
      <Dialog open={!!earlyCheckoutTarget} onOpenChange={(open) => { if (!open) setEarlyCheckoutTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-4 w-4 text-amber-600" />
              {t("dlgCheckoutTitle", { defaultValue: "Check Out Guest" })}
            </DialogTitle>
            <DialogDescription>
              {earlyCheckoutTarget?.guest?.name ?? ""} — Room {earlyCheckoutTarget?.room?.number ?? ""}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {t("dlgCheckoutConfirm", { defaultValue: "This will check out the guest, mark the reservation as completed, and free up the room. Are you sure?" })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEarlyCheckoutTarget(null)}>{t("btnCancel")}</Button>
            <Button onClick={handleEarlyCheckout} disabled={actionLoading === earlyCheckoutTarget?.id} className="bg-amber-600 hover:bg-amber-700">
              {actionLoading === earlyCheckoutTarget?.id ? (
                <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
              ) : null}
              {t("btnConfirmCheckout", { defaultValue: "Check Out" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Group Dates Dialog ── */}
      <Dialog open={!!editDatesTarget} onOpenChange={(open) => { if (!open) setEditDatesTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-4 w-4" />
              {t("dlgEditGroupDatesTitle", { defaultValue: "Edit Group Dates" })}
            </DialogTitle>
            <DialogDescription>
              {t("dlgEditGroupDatesDesc", { defaultValue: "Changes the check-in/check-out dates for ALL guests in this group." })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="grid gap-2">
              <Label>{t("lblstartDate")} <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={editDatesForm.startDate}
                onChange={(e) => setEditDatesForm({ ...editDatesForm, startDate: e.target.value })}
                min={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })()}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("lblendDate")} <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={editDatesForm.endDate}
                onChange={(e) => setEditDatesForm({ ...editDatesForm, endDate: e.target.value })}
                min={editDatesForm.startDate}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDatesTarget(null)}>{t("btnCancel")}</Button>
            <Button onClick={handleEditGroupDates} disabled={actionLoading === "group-dates"}>
              {actionLoading === "group-dates" ? (
                <span className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
              ) : null}
              {t("btnUpdateDates", { defaultValue: "Update All Dates" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
