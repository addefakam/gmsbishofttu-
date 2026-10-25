"use client";
import { useTranslation } from "react-i18next";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import {
  apiSuperGetUsers,
  apiSuperCreateUser,
  apiSuperUpdateUser,
  apiSuperDeleteUser,
  apiSuperGetProviders,
} from "@/lib/api";
import { toast } from "sonner";
import { isValidPhone, isValidEmail } from "@/lib/utils";
import { SUB_CITY_NAMES, getWoredasForSubCity } from "@/lib/bishoftu-divisions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
  Users,
  UserPlus,
  Search,
  Filter,
  MoreVertical,
  Pencil,
  Trash2,
  Eye,
  Shield,
  ShieldCheck,
  Crown,
  UserCog,
  UserCircle,
  Building2,
  Mail,
  Phone,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Activity,
  KeyRound,
  AlertTriangle,
  TrendingUp,
  Lock,
  Unlock,
} from "lucide-react";

// ── Types ──
interface UserRecord {
  id: string;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  policeRank: string | null;
  permissions: string;
  providerId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLogin: string | null;
  provider?: { id: string; name: string; status: string } | null;
}

interface ProviderOption {
  id: string;
  name: string;
  status: string;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface StatsInfo {
  totalUsers: number;
  roleCounts: Record<string, number>;
  providerCount: number;
  activeProviderCount: number;
}

// ── Role Configuration ──
// Super-admin can only create: SUPERUSER, POLICE
// STAFF and OPERATOR are managed by operators themselves via Account Management
const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType; desc: string }> = {
  SUPERUSER: {
    label: "Superuser",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
    icon: Crown,
    desc: "Full system access",
  },
  POLICE: {
    label: "Police",
    color: "text-rose-700",
    bg: "bg-rose-50 border-rose-200",
    icon: Shield,
    desc: "Law enforcement access",
  },
  // OPERATOR and STAFF are listed for display purposes (viewing existing
  // users) but are NOT available as selectable roles when creating a
  // new user from the super-admin panel.
  OPERATOR: {
    label: "Operator",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
    icon: ShieldCheck,
    desc: "Manage guesthouse operations",
  },
  STAFF: {
    label: "Staff",
    color: "text-sky-700",
    bg: "bg-sky-50 border-sky-200",
    icon: UserCog,
    desc: "Limited access based on permissions",
  },
};

const POLICE_RANKS = [
  { value: "ADMIN", label: "Police Admin", desc: "Full police access, can manage officers" },
  { value: "DETECTIVE", label: "Detective", desc: "Investigation tools and intelligence" },
  { value: "OFFICER", label: "Officer", desc: "Standard police access" },
  { value: "VIEWER", label: "Viewer", desc: "Read-only access" },
];

const PERMISSION_OPTIONS = [
  { value: "reservations", label: "Reservations" },
  { value: "guests", label: "Guests" },
  { value: "rooms", label: "Rooms" },
  { value: "housekeeping", label: "Housekeeping" },
  { value: "daytime", label: "Daytime Services" },
  { value: "expenses", label: "Expenses" },
  { value: "reports", label: "Reports" },
  { value: "settings", label: "Settings" },
];

// ── Police module permissions ──
// Each key maps to a page in the web police module AND a tab in the
// police mobile app. The super-admin selects which of these the police
// user can access — same pattern as operator→staff permissions but
// for the police module.
const POLICE_PERMISSION_OPTIONS = [
  { value: "police_dashboard", label: "Dashboard", desc: "City-wide KPIs, occupancy, revenue" },
  { value: "police_guests", label: "Active Stays + Guests", desc: "Live reservations + guest registry" },
  { value: "police_providers", label: "Providers", desc: "Guesthouse management (view/approve/suspend)" },
  { value: "police_reports", label: "Reports", desc: "Analytics, demographics, export" },
  { value: "police_suspects", label: "Suspect Alerts + Watchlist", desc: "Suspect matching, watchlist management" },
  { value: "police_intelligence", label: "Intelligence", desc: "Crime analytics, hotspot analysis" },
  { value: "police_anomalies", label: "Anomaly Detection", desc: "Fraud detection dashboard" },
  { value: "police_security", label: "Security", desc: "Geofences, officer management" },
  { value: "police_dispatch", label: "Notification Dispatch", desc: "Emergency broadcast to guesthouses" },
];

const ROLE_TABS = [
  { value: "", label: "All Users" },
  { value: "SUPERUSER", label: "Superusers" },
  { value: "OPERATOR", label: "Operators" },
  { value: "STAFF", label: "Staff" },
  { value: "POLICE", label: "Police" },
];

const emptyForm = {
  username: "",
  password: "",
  name: "",
  email: "",
  phone: "",
  role: "STAFF",
  policeRank: "OFFICER",
  permissions: [] as string[],
  providerId: "",
  isActive: true,
  // ── Police jurisdiction ──
  jurisdictionType: "CITY",
  subCity: "",
  woreda: "",
};

// ── Stat Card Component ──
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  bgColor,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string;
  color: string;
  bgColor: string;
}) {
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
          </div>
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${bgColor} shadow-sm`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── User Row Component ──
function UserRow({
  user,
  onEdit,
  onDelete,
  onView,
  onToggleActive,
}: {
  user: UserRecord;
  onEdit: (u: UserRecord) => void;
  onDelete: (u: UserRecord) => void;
  onView: (u: UserRecord) => void;
  onToggleActive: (u: UserRecord) => void;
}) {
  const roleConf = ROLE_CONFIG[user.role] || ROLE_CONFIG.STAFF;
  const RoleIcon = roleConf.icon;
  let perms: string[] = [];
  try {
    perms = user.permissions ? JSON.parse(user.permissions) : [];
  } catch {
    perms = [];
  }

  return (
    <div className="group flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-4 transition-all hover:border-slate-200 hover:shadow-sm">
      {/* Avatar */}
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${roleConf.bg} border` }>
        <RoleIcon className={`h-5 w-5 ${roleConf.color}`} />
      </div>

      {/* User Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <h3 className="truncate text-sm font-semibold text-slate-900">{user.name}</h3>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleConf.bg} ${roleConf.color}`}>
            <RoleIcon className="h-2.5 w-2.5" />
            {roleConf.label}
          </span>
          {user.role === "POLICE" && user.policeRank && (
            <Badge
              variant="outline"
              className={`text-[10px] font-semibold px-1.5 py-0 ${
                user.policeRank === "ADMIN"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : user.policeRank === "DETECTIVE"
                  ? "bg-violet-50 text-violet-700 border-violet-200"
                  : user.policeRank === "OFFICER"
                  ? "bg-sky-50 text-sky-700 border-sky-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
              }`}
            >
              {user.policeRank}
            </Badge>
          )}
          {/* Jurisdiction badge — shows sub-city/woreda level for police users */}
          {user.role === "POLICE" && (user as Record<string, unknown>).jurisdictionType && (user as Record<string, unknown>).jurisdictionType !== "CITY" && (
            <Badge
              variant="outline"
              className="text-[10px] font-semibold px-1.5 py-0 bg-indigo-50 text-indigo-700 border-indigo-200"
            >
              {(user as Record<string, unknown>).jurisdictionType === "WOREDA" && (user as Record<string, unknown>).woreda
                ? `${(user as Record<string, unknown>).woreda} (${(user as Record<string, unknown>).subCity})`
                : (user as Record<string, unknown>).subCity
                ? `${(user as Record<string, unknown>).subCity} Sub-City`
                : "Sub-City"}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <UserCircle className="h-3 w-3" />
            @{user.username}
          </span>
          {user.email && (
            <span className="flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {user.email}
            </span>
          )}
          {user.phone && (
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {user.phone}
            </span>
          )}
        </div>
        {user.provider && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
            <Building2 className="h-3 w-3 text-slate-400" />
            <span>{user.provider.name}</span>
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 ${
                user.provider.status === "APPROVED"
                  ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                  : user.provider.status === "PENDING"
                  ? "bg-amber-50 text-amber-600 border-amber-200"
                  : "bg-slate-50 text-slate-500 border-slate-200"
              }`}
            >
              {user.provider.status}
            </Badge>
          </div>
        )}
      </div>

      {/* Right: status + meta + actions */}
      <div className="flex flex-col items-end gap-2">
        {/* Active toggle */}
        <div className="flex items-center gap-1.5">
          <Switch
            checked={user.isActive}
            onCheckedChange={() => onToggleActive(user)}
            className="data-[state=checked]:bg-emerald-500"
          />
          <span className={`text-[11px] font-medium ${user.isActive ? "text-emerald-600" : "text-slate-400"}`}>
            {user.isActive ? "Active" : "Inactive"}
          </span>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(user.createdAt).toLocaleDateString()}
          </span>
        </div>

        {/* Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onView(user)}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(user)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit User
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-rose-600 focus:text-rose-600 focus:bg-rose-50"
              onClick={() => onDelete(user)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete User
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ── Main Page Component ──
export default function SuperUserManagementPage() {
  const { t } = useTranslation();
  const { currentUser, refreshKey } = useAppStore();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [stats, setStats] = useState<StatsInfo | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeRoleTab, setActiveRoleTab] = useState("");
  const [activeProvider, setActiveProvider] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Dialog states
  const [formOpen, setFormOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [viewingUser, setViewingUser] = useState<UserRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Only approved providers can be assigned to operator/staff users
  const approvedProviders = providers.filter((p) => p.status === "APPROVED");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersData, provDataRaw] = await Promise.all([
        apiSuperGetUsers({
          search: search || undefined,
          role: activeRoleTab || undefined,
          providerId: activeProvider || undefined,
          page: currentPage,
          pageSize: 12,
        }),
        apiSuperGetProviders(),
      ]);
      setUsers(usersData.users || []);
      setPagination(usersData.pagination || null);
      setStats(usersData.stats || null);
      // Providers API returns an array directly
      const provs: any[] = Array.isArray(provDataRaw)
        ? provDataRaw
        : ((provDataRaw as Record<string, unknown>).providers as any[]) || [];
      setProviders(provs.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        name: p.name as string,
        status: p.status as string,
      })));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load data";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [search, activeRoleTab, activeProvider, currentPage]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeRoleTab, activeProvider]);

  // ── Form Handlers ──
  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  // ── Default police permissions ──
  // When a new POLICE user is created, pre-select these modules
  // so the admin doesn't have to check them manually.
  const DEFAULT_POLICE_PERMISSIONS = [
    "police_dashboard",
    "police_providers",
    "police_reports",
  ];

  const openEdit = (user: UserRecord) => {
    setEditingUser(user);
    let perms: string[] = [];
    try {
      perms = user.permissions ? JSON.parse(user.permissions) : [];
    } catch {
      perms = [];
    }
    setForm({
      username: user.username,
      password: "",
      name: user.name,
      email: user.email || "",
      phone: user.phone || "",
      role: user.role,
      policeRank: user.policeRank || "OFFICER",
      permissions: perms,
      providerId: user.providerId || "",
      isActive: user.isActive,
      jurisdictionType: (user as Record<string, unknown>).jurisdictionType as string || "CITY",
      subCity: (user as Record<string, unknown>).subCity as string || "",
      woreda: (user as Record<string, unknown>).woreda as string || "",
    });
    setFormOpen(true);
  };

  const openView = (user: UserRecord) => {
    setViewingUser(user);
    setViewOpen(true);
  };

  const handleSave = async () => {
    if (!form.username.trim() || !form.name.trim() || !form.role) {
      toast.error("Username, name, and role are required");
      return;
    }
    if (!editingUser && !form.password) {
      toast.error("Password is required for new users");
      return;
    }
    // Provider is optional — operator/staff can be created without one
    // and assigned to a guesthouse later from the Providers page.
    // No provider validation needed here.
    if (form.role === "POLICE" && !form.policeRank) {
      toast.error("Please select a police rank");
      return;
    }
    if (form.email.trim() && !isValidEmail(form.email)) {
      toast.error("Invalid email address format");
      return;
    }
    if (form.phone.trim() && !isValidPhone(form.phone)) {
      toast.error("Invalid phone number. Use format like +251 9XX XXX XXX (7-15 digits)");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        role: form.role,
        policeRank: form.role === "POLICE" ? form.policeRank : "",
        permissions: (form.role === "STAFF" || form.role === "POLICE") ? form.permissions : [],
        providerId: (form.providerId && form.providerId !== "__none__") ? form.providerId : null,
        isActive: form.isActive,
        // ── Police jurisdiction ──
        // Defensive: send "" instead of null — DB column is NOT NULL DEFAULT ''.
        // (Backend route also coerces null → "", but be explicit at the source.)
        jurisdictionType: form.role === "POLICE" ? form.jurisdictionType : "CITY",
        subCity: form.role === "POLICE" && form.jurisdictionType !== "CITY" ? (form.subCity || "") : "",
        woreda: form.role === "POLICE" && form.jurisdictionType === "WOREDA" ? (form.woreda || "") : "",
      };
      if (form.password) payload.password = form.password;

      if (editingUser) {
        await apiSuperUpdateUser(editingUser.id, payload);
        toast.success("User updated successfully");
      } else {
        await apiSuperCreateUser(payload);
        toast.success("User created successfully");
      }
      setFormOpen(false);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save user";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiSuperDeleteUser(deleteTarget.id);
      toast.success("User deleted successfully");
      setDeleteTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete user";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (user: UserRecord) => {
    try {
      await apiSuperUpdateUser(user.id, { isActive: !user.isActive });
      toast.success(`User ${user.isActive ? "deactivated" : "activated"} successfully`);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update status";
      toast.error(msg);
    }
  };

  const togglePermission = (perm: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">User Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage all user accounts, roles, and permissions across the system.
          </p>
        </div>
        <Button onClick={openCreate} className="shadow-sm">
          <UserPlus className="mr-2 h-4 w-4" />
          Add New User
        </Button>
      </div>

      {/* ── Stats Cards ── */}
      {!loading && stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={Users}
            label="Total Users"
            value={stats.totalUsers}
            sub="Across all providers"
            color="text-indigo-600"
            bgColor="bg-indigo-50"
          />
          <StatCard
            icon={Building2}
            label="Active Providers"
            value={stats.activeProviderCount}
            sub={`${stats.providerCount} total`}
            color="text-emerald-600"
            bgColor="bg-emerald-50"
          />
          <StatCard
            icon={ShieldCheck}
            label="Operators"
            value={stats.roleCounts.OPERATOR || 0}
            sub={`${stats.roleCounts.STAFF || 0} staff members`}
            color="text-teal-600"
            bgColor="bg-teal-50"
          />
          <StatCard
            icon={Shield}
            label="Police Accounts"
            value={stats.roleCounts.POLICE || 0}
            sub="Law enforcement users"
            color="text-rose-600"
            bgColor="bg-rose-50"
          />
        </div>
      )}

      {/* ── Filters & Search ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by name, username, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-slate-50 border-slate-200"
              />
            </div>

            {/* Provider Filter */}
            <Select value={activeProvider} onValueChange={setActiveProvider}>
              <SelectTrigger className="w-full lg:w-48 bg-slate-50 border-slate-200">
                <Building2 className="mr-2 h-4 w-4 text-slate-400" />
                <SelectValue placeholder="All Providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Providers</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1 py-0 ${
                          p.status === "APPROVED"
                            ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                            : p.status === "PENDING"
                            ? "bg-amber-50 text-amber-600 border-amber-200"
                            : "bg-slate-50 text-slate-500 border-slate-200"
                        }`}
                      >
                        {p.status}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Role Tabs */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {ROLE_TABS.map((tab) => {
              const count = tab.value
                ? (stats?.roleCounts[tab.value] || 0)
                : stats?.totalUsers || 0;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveRoleTab(tab.value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
                    activeRoleTab === tab.value
                      ? "bg-primary text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      activeRoleTab === tab.value
                        ? "bg-white/20 text-white"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Users List ── */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
              <Users className="h-8 w-8 text-slate-300" />
            </div>
            <p className="mt-4 font-semibold text-slate-700">No users found</p>
            <p className="mt-1 text-sm text-slate-400">
              {search || activeRoleTab
                ? "Try adjusting your search or filters."
                : "Create your first user to get started."}
            </p>
            {!search && !activeRoleTab && (
              <Button onClick={openCreate} className="mt-4" variant="outline">
                <UserPlus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
                onView={openView}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>

          {/* ── Pagination ── */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Showing {(pagination.page - 1) * pagination.pageSize + 1}
                {" - "}
                {Math.min(pagination.page * pagination.pageSize, pagination.total)}{" "}
                of {pagination.total} users
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    // Show first, last, current, and neighbors
                    return (
                      p === 1 ||
                      p === pagination.totalPages ||
                      Math.abs(p - pagination.page) <= 1
                    );
                  })
                  .map((p, idx, arr) => {
                    // Add ellipsis
                    const prev = arr[idx - 1];
                    const showEllipsis = prev && p - prev > 1;
                    return (
                      <span key={p} className="flex items-center">
                        {showEllipsis && (
                          <span className="px-1 text-slate-400">...</span>
                        )}
                        <Button
                          variant={p === pagination.page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(p)}
                          className="h-8 w-8 p-0"
                        >
                          {p}
                        </Button>
                      </span>
                    );
                  })}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* ── CREATE / EDIT DIALOG ── */}
      {/* ══════════════════════════════════════════ */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingUser ? (
                <>
                  <Pencil className="h-5 w-5 text-primary" />
                  Edit User
                </>
              ) : (
                <>
                  <UserPlus className="h-5 w-5 text-primary" />
                  Create New User
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {editingUser
                ? "Update user details. Leave password blank to keep current password."
                : "Fill in the details to create a new user account."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Role Selection */}
            <div className="grid gap-2">
              <Label>{t('lblrole', 'Role')}</Label>
              <div className="grid grid-cols-2 gap-2">
                {/* Only SUPERUSER and POLICE can be created by the super-admin.
                    STAFF creation is handled by operators via Account Management. */}
                {Object.entries(ROLE_CONFIG).filter(([key]) => ["SUPERUSER", "POLICE"].includes(key) || (editingUser && editingUser.role === key)).map(([key, conf]) => {
                  const Icon = conf.icon;
                  const isSelected = form.role === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          role: key,
                          providerId: (key === "OPERATOR" || key === "STAFF") ? f.providerId : "",
                          // Pre-select default police permissions when switching to POLICE
                          permissions: key === "POLICE" && !editingUser
                            ? DEFAULT_POLICE_PERMISSIONS
                            : (key === "STAFF" ? f.permissions.filter((p) => !p.startsWith("police_")) : f.permissions),
                        }));
                      }}
                      className={`flex items-center gap-2.5 rounded-lg border-2 p-3 text-left transition-all ${
                        isSelected
                          ? `${conf.bg} ${conf.color} border-current`
                          : "border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isSelected ? conf.color : "text-slate-400"}`} />
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${isSelected ? conf.color : "text-slate-700"}`}>
                          {conf.label}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">{conf.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Username */}
            <div className="grid gap-2">
              <Label>{t('lblusername', 'Username')}</Label>
              <Input
                id="su-username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="e.g. john_doe"
                className="bg-slate-50"
              />
            </div>

            {/* Password */}
            <div className="grid gap-2">
              <Label htmlFor="su-password">
                Password
                {editingUser && (
                  <span className="ml-1 font-normal text-slate-400">(leave blank to keep current)</span>
                )}
              </Label>
              <Input
                id="su-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editingUser ? "Leave blank to keep current" : "Minimum 6 characters"}
                className="bg-slate-50"
              />
            </div>

            {/* Full Name */}
            <div className="grid gap-2">
              <Label>{t('lblfullName', 'Full Name')}</Label>
              <Input
                id="su-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. John Doe"
                className="bg-slate-50"
              />
            </div>

            {/* Email & Phone Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>{t('lblemail', 'Email')}</Label>
                <Input
                  id="su-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="user@email.com"
                  className="bg-slate-50"
                />
              </div>
              <div className="grid gap-2">
                <Label>{t('lblphone', 'Phone')}</Label>
                <Input
                  id="su-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+251..."
                  className="bg-slate-50"
                />
              </div>
            </div>

            {/* Guesthouse Assignment — optional for OPERATOR/STAFF */}
            {(form.role === "OPERATOR" || form.role === "STAFF") && (
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <Building2 className={`h-3.5 w-3.5 ${form.role === "OPERATOR" ? "text-emerald-600" : "text-sky-600"}`} />
                  {form.role === "OPERATOR" ? "Assign to Guesthouse" : "Assign to Guesthouse"}
                  <span className="font-normal text-slate-400">(optional — can assign later)</span>
                </Label>
                <p className="text-xs text-slate-400">
                  {form.role === "OPERATOR"
                    ? "Select which guesthouse this operator will manage. You can also skip this and assign later from the Providers page."
                    : "Select which guesthouse this staff member works at. You can also skip this and assign later from the Providers page."}
                </p>
                {approvedProviders.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                    <p>No guesthouses registered yet. This {form.role.toLowerCase()} can be created now and assigned to a guesthouse later.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => { setFormOpen(false); useAppStore.getState().setCurrentPage("providers"); }}
                    >
                      <Building2 className="mr-1.5 h-3.5 w-3.5" />
                      Go to Providers to register one
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={form.providerId}
                    onValueChange={(v) => setForm((f) => ({ ...f, providerId: v }))}
                  >
                    <SelectTrigger className="bg-slate-50">
                      <SelectValue placeholder={
                        form.role === "OPERATOR"
                          ? "Select guesthouse for this operator (optional)"
                          : "Select guesthouse for this staff member (optional)"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-slate-400">— No guesthouse (skip) —</span>
                      </SelectItem>
                      {approvedProviders.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex items-center gap-2">
                            <span>{p.name}</span>
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 bg-emerald-50 text-emerald-600 border-emerald-200"
                            >
                              {p.status}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Police Rank — for POLICE role */}
            {form.role === "POLICE" && (
              <div className="grid gap-2">
                <Label>{t('lblpoliceRank', 'Police Rank')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {POLICE_RANKS.map((rank) => (
                    <button
                      key={rank.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, policeRank: rank.value }))}
                      className={`rounded-lg border-2 p-3 text-left transition-all ${
                        form.policeRank === rank.value
                          ? "border-primary bg-primary/5"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <p className={`text-sm font-semibold ${
                        form.policeRank === rank.value ? "text-primary" : "text-slate-700"
                      }`}>
                        {rank.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{rank.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Police Jurisdiction — shows when role is POLICE */}
            {form.role === "POLICE" && (
              <div className="grid gap-3 rounded-lg border-2 border-indigo-100 bg-indigo-50/30 p-4">
                <div>
                  <Label className="text-sm font-semibold">{t('lblJurisdiction', 'Jurisdiction Level')}</Label>
                  <p className="text-xs text-slate-400 mt-0.5">Controls which guesthouses this police user can see.</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "CITY", label: "City Level", desc: "Full access" },
                    { value: "SUBCITY", label: "Sub-City", desc: "One sub-city" },
                    { value: "WOREDA", label: "Woreda", desc: "One woreda" },
                  ].map((j) => (
                    <button
                      key={j.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, jurisdictionType: j.value, subCity: j.value === "CITY" ? "" : f.subCity, woreda: j.value !== "WOREDA" ? "" : f.woreda }))}
                      className={`rounded-lg border-2 p-3 text-left transition-all ${
                        form.jurisdictionType === j.value
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <p className={`text-sm font-semibold ${form.jurisdictionType === j.value ? "text-indigo-600" : "text-slate-700"}`}>
                        {j.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{j.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Sub-city dropdown — shows when SUBCITY or WOREDA */}
                {form.jurisdictionType !== "CITY" && (
                  <div className="grid gap-2">
                    <Label className="text-xs">Sub-City</Label>
                    <Select
                      value={form.subCity}
                      onValueChange={(v) => setForm((f) => ({ ...f, subCity: v, woreda: "" }))}
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="Select sub-city..." />
                      </SelectTrigger>
                      <SelectContent>
                        {SUB_CITY_NAMES.map((sc) => (
                          <SelectItem key={sc} value={sc}>{sc}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Woreda dropdown — shows only when WOREDA */}
                {form.jurisdictionType === "WOREDA" && form.subCity && (
                  <div className="grid gap-2">
                    <Label className="text-xs">Woreda</Label>
                    <Select
                      value={form.woreda}
                      onValueChange={(v) => setForm((f) => ({ ...f, woreda: v }))}
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="Select woreda..." />
                      </SelectTrigger>
                      <SelectContent>
                        {getWoredasForSubCity(form.subCity).map((w) => (
                          <SelectItem key={w} value={w}>{w}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Summary of what this user will see */}
                {form.jurisdictionType !== "CITY" && form.subCity && (
                  <div className="rounded-md bg-indigo-100 px-3 py-2 text-xs text-indigo-700">
                    {form.jurisdictionType === "WOREDA" && form.woreda
                      ? `This user will see only guesthouses in ${form.woreda} woreda (${form.subCity} sub-city).`
                      : `This user will see all guesthouses in ${form.subCity} sub-city.`
                    }
                  </div>
                )}
              </div>
            )}

            {/* Police Module Access — select which police pages this user can access */}
            {form.role === "POLICE" && (
              <div className="grid gap-2">
                <Label className="text-sm font-semibold">{t('lblModuleAccess', 'Module Access')}</Label>
                <p className="text-xs text-slate-400">Select which police module pages this user can access. Applies to both web and mobile app.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3">
                  {POLICE_PERMISSION_OPTIONS.map((perm) => {
                    const isChecked = form.permissions.includes(perm.value);
                    return (
                      <label
                        key={perm.value}
                        className="flex items-start gap-2 text-sm cursor-pointer rounded-md p-2 hover:bg-slate-50 transition-colors"
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            setForm((prev) => ({
                              ...prev,
                              permissions: checked
                                ? [...prev.permissions, perm.value]
                                : prev.permissions.filter((p) => p !== perm.value),
                            }));
                          }}
                        />
                        <div>
                          <span className="font-medium text-slate-700">{perm.label}</span>
                          <p className="text-[10px] text-slate-400">{perm.desc}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {form.permissions.length === 0 && (
                  <p className="text-xs text-amber-600">No modules selected — this user will not see any police pages.</p>
                )}
              </div>
            )}

            {/* Staff Permissions */}
            {form.role === "STAFF" && (
              <div className="grid gap-2">
                <Label>{t('lblpermissions', 'Permissions')}</Label>
                <p className="text-xs text-slate-400">Select which pages this staff member can access.</p>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3">
                  {PERMISSION_OPTIONS.map((perm) => (
                    <label
                      key={perm.value}
                      className="flex items-center gap-2 text-sm cursor-pointer rounded-md p-1.5 hover:bg-slate-50 transition-colors"
                    >
                      <Checkbox
                        checked={form.permissions.includes(perm.value)}
                        onCheckedChange={() => togglePermission(perm.value)}
                      />
                      <span className="text-slate-700">{perm.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Active Status */}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">Account Status</p>
                <p className="text-xs text-slate-400">
                  {form.isActive
                    ? "User can log in and access the system"
                    : "User account is disabled"}
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="shadow-sm">
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : editingUser ? (
                "Update User"
              ) : (
                "Create User"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════ */}
      {/* ── VIEW DETAILS DIALOG ── */}
      {/* ══════════════════════════════════════════ */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-md">
          {viewingUser && (() => {
            const roleConf = ROLE_CONFIG[viewingUser.role] || ROLE_CONFIG.STAFF;
            const RoleIcon = roleConf.icon;
            let perms: string[] = [];
            try {
              perms = viewingUser.permissions ? JSON.parse(viewingUser.permissions) : [];
            } catch {
              perms = [];
            }
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${roleConf.bg} border`}>
                      <RoleIcon className={`h-6 w-6 ${roleConf.color}`} />
                    </div>
                    <div>
                      <DialogTitle className="text-lg">{viewingUser.name}</DialogTitle>
                      <DialogDescription>
                        @{viewingUser.username} · Joined {new Date(viewingUser.createdAt).toLocaleDateString()}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  {/* Status & Role */}
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${roleConf.bg} ${roleConf.color}`}>
                      <RoleIcon className="h-3 w-3" />
                      {roleConf.label}
                    </span>
                    {viewingUser.role === "POLICE" && viewingUser.policeRank && (
                      <Badge variant="outline" className="text-xs">
                        {viewingUser.policeRank}
                      </Badge>
                    )}
                    {/* Jurisdiction badge in view dialog */}
                    {viewingUser.role === "POLICE" && (viewingUser as Record<string, unknown>).jurisdictionType && (viewingUser as Record<string, unknown>).jurisdictionType !== "CITY" && (
                      <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200">
                        {(viewingUser as Record<string, unknown>).jurisdictionType === "WOREDA" && (viewingUser as Record<string, unknown>).woreda
                          ? `${(viewingUser as Record<string, unknown>).woreda} woreda · ${(viewingUser as Record<string, unknown>).subCity}`
                          : `${(viewingUser as Record<string, unknown>).subCity} Sub-City`
                        }
                      </Badge>
                    )}
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      viewingUser.isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}>
                      {viewingUser.isActive ? (
                        <><CheckCircle2 className="h-3 w-3" /> Active</>
                      ) : (
                        <><XCircle className="h-3 w-3" /> Inactive</>
                      )}
                    </span>
                  </div>

                  <Separator />

                  {/* Contact Info */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contact Information</h4>
                    <div className="space-y-2">
                      {viewingUser.email && (
                        <div className="flex items-center gap-2.5 text-sm">
                          <Mail className="h-4 w-4 text-slate-400" />
                          <span>{viewingUser.email}</span>
                        </div>
                      )}
                      {viewingUser.phone && (
                        <div className="flex items-center gap-2.5 text-sm">
                          <Phone className="h-4 w-4 text-slate-400" />
                          <span>{viewingUser.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Provider Info */}
                  {viewingUser.provider && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Provider</h4>
                        <div className="flex items-center gap-2.5 text-sm">
                          <Building2 className="h-4 w-4 text-slate-400" />
                          <span className="font-medium">{viewingUser.provider.name}</span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${
                              viewingUser.provider.status === "APPROVED"
                                ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                                : "bg-amber-50 text-amber-600 border-amber-200"
                            }`}
                          >
                            {viewingUser.provider.status}
                          </Badge>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Staff Permissions */}
                  {viewingUser.role === "STAFF" && perms.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Permissions</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {perms.map((p) => (
                            <Badge
                              key={p}
                              variant="secondary"
                              className="text-xs bg-slate-100 text-slate-600"
                            >
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Activity */}
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Activity</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2 text-slate-500">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <span>Created: {new Date(viewingUser.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span>Updated: {new Date(viewingUser.updatedAt).toLocaleDateString()}</span>
                      </div>
                      {viewingUser.lastLogin && (
                        <div className="flex items-center gap-2 text-slate-500">
                          <Activity className="h-3.5 w-3.5 text-slate-400" />
                          <span>Last login: {new Date(viewingUser.lastLogin).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setViewOpen(false);
                      openEdit(viewingUser);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit User
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════ */}
      {/* ── DELETE CONFIRMATION ── */}
      {/* ══════════════════════════════════════════ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 border border-rose-200">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <AlertDialogTitle>Delete User</AlertDialogTitle>
                <AlertDialogDescription className="mt-1">
                  Are you sure you want to delete <strong>{deleteTarget?.name}</strong> (@{deleteTarget?.username})?
                  This action cannot be undone and will permanently remove the account.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Permanently
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
