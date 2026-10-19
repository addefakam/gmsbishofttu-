"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import {
  apiGetUsers,
  apiCreateUser,
  apiUpdateUser,
  apiDeleteUser,
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
  Plus,
  Pencil,
  Trash2,
  UserCog,
  Users,
  Eye,
  EyeOff,
  Loader2,
  Shield,
  CalendarCheck,
  Sun,
  Sparkles,
  Bed,
  BarChart3,
  Star,
  Bell,
  Settings,
  Search,
  ChevronRight,
  KeyRound,
  ScrollText,
  ClipboardList,
} from "lucide-react";

// ── Permission options that OPERATOR can assign to staff ──
// 'guests' removed — redundant with 'reservations' (both map to the same
//   Accommodation → Reservations page).
// 'daytime' removed — Daytime Services feature is deactivated.
const PERMISSION_OPTIONS_RAW = [
  { value: "rooms", tKey: "permRooms", icon: Bed, color: "text-violet-600 bg-violet-50 border-violet-200" },
  { value: "reservations", tKey: "permReservations", icon: CalendarCheck, color: "text-blue-600 bg-blue-50 border-blue-200" },
  { value: "housekeeping", tKey: "permHousekeeping", icon: Sparkles, color: "text-amber-600 bg-amber-50 border-amber-200" },
  { value: "reports", tKey: "permReports", icon: BarChart3, color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  { value: "reviews", tKey: "permReviews", icon: Star, color: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  { value: "notifications", tKey: "permNotifications", icon: Bell, color: "text-rose-600 bg-rose-50 border-rose-200" },
  { value: "settings", tKey: "permSettings", icon: Settings, color: "text-slate-600 bg-slate-50 border-slate-200" },
  { value: "staff_logs_view", tKey: "permStaffLogsView", icon: ScrollText, color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  { value: "tasks", tKey: "permTasks", icon: ClipboardList, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
];

// PERM_MAP built dynamically inside component using t()

interface StaffUser {
  id: string;
  username: string;
  name: string;
  role: string;
  permissions: string;
  providerId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = {
  username: "",
  password: "",
  name: "",
  permissions: ["rooms", "reservations"] as string[],
};

// ── Map each permission to its sidebar page key + feature flag ──
// Used to filter the permission options shown in the Add/Edit Staff dialog:
//   - If the page is in `disabledPages` (hidden from operator sidebar), the
//     permission is hidden.
//   - If the corresponding feature flag is OFF, the permission is hidden.
// null in either field means "no dependency" — always show.
const PERM_PAGE_MAP: Record<string, { pageKey: string | null; flagKey: string | null }> = {
  rooms:          { pageKey: "accommodation",  flagKey: null },
  reservations:   { pageKey: "accommodation",  flagKey: null },
  housekeeping:   { pageKey: null,            flagKey: "maintenanceTickets" },
  reports:        { pageKey: "reports",       flagKey: null },
  reviews:        { pageKey: null,            flagKey: null },
  notifications:  { pageKey: null,            flagKey: null },
  settings:       { pageKey: "settings",       flagKey: null },
  staff_logs_view:{ pageKey: "staff-logs",     flagKey: null },
  tasks:          { pageKey: null,            flagKey: null },
};

export default function UsersPage() {
  const { t } = useTranslation("users");
  const { refreshKey, currentUser, disabledPages, ownerFeatureFlags } = useAppStore();

  // Build translated permission map
  const PERM_MAP: Record<string, { label: string; icon: React.ElementType; color: string }> = {};
  PERMISSION_OPTIONS_RAW.forEach((p) => {
    PERM_MAP[p.value] = { label: t(p.tKey), icon: p.icon, color: p.color };
  });

  // ── Filter permission options based on Operator Features settings ──
  // Only show permissions for features that are currently ENABLED:
  //   1. If the feature's page is in `disabledPages` → hide
  //   2. If the feature's flag in `ownerFeatureFlags` is false → hide
  // disabledPages is null until fetched; treat null as "no restrictions"
  // (show all) so the dialog isn't empty during the initial load.
  const disabledSet = new Set(disabledPages || []);
  const visiblePermissions = PERMISSION_OPTIONS_RAW.filter((perm) => {
    const mapping = PERM_PAGE_MAP[perm.value];
    if (!mapping) return true; // unknown permission — show by default
    // Check if the page is disabled
    if (mapping.pageKey && disabledSet.has(mapping.pageKey)) return false;
    // Check if the feature flag is OFF
    if (mapping.flagKey && ownerFeatureFlags) {
      if (ownerFeatureFlags[mapping.flagKey] === false) return false;
    }
    return true;
  });
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Reset credentials dialog
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<StaffUser | null>(null);
  const [resetUsername, setResetUsername] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetSaving, setResetSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await apiGetUsers();
      // API returns { data: [...], total, page, ... } — extract the array
      const users = Array.isArray(raw) ? raw : (raw?.data ?? []);
      setStaff(users as StaffUser[]);
    } catch {
      toast.error(t("toastLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff, refreshKey]);

  // Filter staff by search
  const filteredStaff = staff.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase())
  );

  // ── Parse permissions helper ──
  const parsePerms = (permissions: string): string[] => {
    try {
      return permissions ? JSON.parse(permissions) : [];
    } catch {
      return [];
    }
  };

  // ── Open create dialog ──
  const openCreate = () => {
    setEditingUser(null);
    setForm({ ...emptyForm });
    setShowPassword(false);
    setDialogOpen(true);
  };

  // ── Open edit dialog ──
  const openEdit = (user: StaffUser) => {
    setEditingUser(user);
    const perms = parsePerms(user.permissions);
    setForm({
      username: user.username,
      password: "",
      name: user.name,
      permissions: perms,
    });
    setShowPassword(false);
    setDialogOpen(true);
  };

  // ── Open reset credentials dialog ──
  const openReset = (user: StaffUser) => {
    setResetTarget(user);
    setResetUsername(user.username);
    setResetPassword("");
    setShowResetPassword(false);
    setResetOpen(true);
  };

  // ── Toggle permission in form ──
  const togglePermission = (perm: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  // ── Save (create or update) ──
  const handleSave = async () => {
    if (!form.username.trim() || !form.name.trim()) {
      toast.error(t("validNameUsernameReq"));
      return;
    }
    if (!editingUser && !form.password) {
      toast.error(t("validPasswordReq"));
      return;
    }
    if (form.permissions.length === 0) {
      toast.error(t("validPermReq"));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        name: form.name.trim(),
        role: "STAFF",
        permissions: form.permissions,
      };
      if (form.password) payload.password = form.password;

      if (editingUser) {
        await apiUpdateUser(editingUser.id, payload);
        toast.success(t("toastUpdated"));
      } else {
        await apiCreateUser(payload);
        toast.success(t("toastCreated"));
      }
      setDialogOpen(false);
      fetchStaff();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("toastSaveFailed");
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Reset credentials ──
  const handleReset = async () => {
    if (!resetTarget) return;
    if (!resetUsername.trim()) {
      toast.error(t("resetValidUsername"));
      return;
    }
    setResetSaving(true);
    try {
      const payload: Record<string, unknown> = { username: resetUsername.trim() };
      if (resetPassword.trim()) payload.password = resetPassword.trim();
      await apiUpdateUser(resetTarget.id, payload);
      toast.success(t("resetToastSaved"));
      setResetOpen(false);
      fetchStaff();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("resetToastFailed");
      toast.error(msg);
    } finally {
      setResetSaving(false);
    }
  };

  // ── Delete staff ──
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDeleteUser(deleteTarget.id);
      toast.success(t("deleteToastDeleted"));
      setDeleteTarget(null);
      fetchStaff();
    } catch {
      toast.error(t("deleteToastFailed"));
    } finally {
      setDeleting(false);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-sm" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("pageSubtitle")}
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("btnAddStaff")}
        </Button>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* ── Staff List ── */}
      {filteredStaff.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <UserCog className="mb-4 h-12 w-12 opacity-30" />
          <p className="font-medium text-lg">
            {search ? t("emptyNoMatch") : t("emptyNoAccounts")}
          </p>
          <p className="text-sm mt-1">
            {search
              ? t("emptyNoMatchHint")
              : t("emptyNoAccountsHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredStaff.map((user) => {
            const perms = parsePerms(user.permissions);
            return (
              <div
                key={user.id}
                className="rounded-lg border p-4 hover:bg-muted/30 transition-colors"
              >
                {/* Staff header row */}
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100">
                    <Users className="h-5 w-5 text-sky-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate">{user.name}</p>
                      <Badge variant="outline" className="text-[10px] px-1.5 bg-sky-100 text-sky-700 border-sky-200">
                        {t("badgeStaff")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{user.username}</code>
                      <span className="ml-2">{t("createdOn", { date: new Date(user.createdAt).toLocaleDateString() })}</span>
                    </p>
                  </div>
                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(user)}>
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t("btnEdit")}</span>
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openReset(user)}>
                      <KeyRound className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t("btnReset")}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-red-600 hover:text-red-700"
                      onClick={() => setDeleteTarget(user)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Rights/Permissions section */}
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t("assignedRights")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {perms.length > 0 ? (
                      perms.map((p) => {
                        const info = PERM_MAP[p];
                        if (!info) return null;
                        const Icon = info.icon;
                        return (
                          <Badge
                            key={p}
                            variant="outline"
                            className={`text-xs gap-1 ${info.color}`}
                          >
                            <Icon className="h-3 w-3" />
                            {info.label}
                          </Badge>
                        );
                      })
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("noRightsAssigned")}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Staff Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="mx-4 sm:mx-0 w-[calc(100%-2rem)] sm:w-full sm:max-w-md max-h-[85vh] overflow-y-auto"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "448px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-primary" />
              {editingUser ? t("dialogTitleEdit") : t("dialogTitleAdd")}
            </DialogTitle>
            <DialogDescription>
              {editingUser
                ? t("dialogDescEdit")
                : t("dialogDescAdd")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Username */}
            {!editingUser && (
              <div className="grid gap-2">
                <Label htmlFor="username">{t("labelUsername")}</Label>
                <Input
                  id="username"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder={t("placeholderUsername")}
                  autoFocus
                />
              </div>
            )}

            {/* Password */}
            <div className="grid gap-2">
              <Label htmlFor="password">
                {editingUser ? t("labelPasswordEdit") : t("labelPasswordNew")}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editingUser ? t("placeholderPasswordEdit") : t("placeholderPasswordNew")}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Full Name */}
            <div className="grid gap-2">
              <Label htmlFor="name">{t("labelFullName")}</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("placeholderFullName")}
              />
            </div>

            {/* Rights/Permissions */}
            <div className="grid gap-2">
              <Label>{t("labelAccessRights")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("accessRightsHint")}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {visiblePermissions.map((perm) => {
                  const Icon = perm.icon;
                  const isChecked = form.permissions.includes(perm.value);
                  return (
                    <label
                      key={perm.value}
                      className={`flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 transition-colors ${isChecked ? perm.color + " border-current" : "border-transparent hover:bg-muted/50"}`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => togglePermission(perm.value)}
                      />
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {t(perm.tKey)}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("btnCancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {editingUser ? t("btnUpdating") : t("btnCreating")}
                </>
              ) : (
                <>
                  <UserCog className="h-4 w-4" />
                  {editingUser ? t("btnUpdateStaff") : t("btnCreateStaff")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Credentials Dialog ── */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent
          className="mx-4 sm:mx-0 w-[calc(100%-2rem)] sm:w-full sm:max-w-md"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "448px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              {t("resetTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("resetDesc", { name: resetTarget?.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="reset-username">{t("resetLabelUsername")}</Label>
              <Input
                id="reset-username"
                value={resetUsername}
                onChange={(e) => setResetUsername(e.target.value)}
                placeholder={t("resetPlaceholderUsername")}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reset-password">{t("resetLabelPassword")}</Label>
              <div className="relative">
                <Input
                  id="reset-password"
                  type={showResetPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder={t("resetPlaceholderPassword")}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              {t("btnCancel")}
            </Button>
            <Button onClick={handleReset} disabled={resetSaving} className="gap-2">
              {resetSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("resetSaving")}
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  {t("resetBtnSave")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent
          className="sm:max-w-[400px]"
          style={{ left: "auto", right: "1rem", transform: "translateY(-50%)", width: "auto", maxWidth: "400px" }}
          overlayStyle={{ backgroundColor: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              {t("deleteTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("deleteDesc", { name: deleteTarget?.name, username: deleteTarget?.username })}
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
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  {t("deleteDeleting")}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1" />
                  {t("deleteBtnDelete")}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
