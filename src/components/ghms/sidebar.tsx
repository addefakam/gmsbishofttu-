"use client";

import React, { useSyncExternalStore, useState, useEffect } from "react";
import {
  LayoutDashboard,
  Bed,
  Users,
  CalendarCheck,
  Sun,
  Receipt,
  Package,
  Sparkles,
  UserCog,
  BarChart3,
  Settings,
  Bell,
  Building2,
  Search,
  Shield,
  Star,
  ChevronLeft,
  Menu,
  UsersRound,
  ShieldAlert,
  UserX,
  CreditCard,
  ShieldCheck,
  Clock,
  AlertTriangle,
  UserCircle,
  UserPlus,
  ChevronDown,
  LogOut,
  BrainCircuit,
  ClipboardList,
  DoorOpen,
  Hotel,
  MessageSquare,
  ScrollText,
  Megaphone,
  Smartphone,
  ExternalLink,
  TrendingUp,
  FileText,
  RefreshCw as RefreshCwIcon,
  Wrench,
} from "lucide-react";

import { useTranslation } from "react-i18next";

import { useAppStore, type CurrentUser } from "@/lib/store";
import { formatDaysRemaining, formatCycle } from "@/lib/subscription";
import { useIsMobile } from "@/hooks/use-mobile";
import { POLICE_RANK_PERMISSIONS, RANK_BADGE_CLASSES, type PoliceRank } from "@/lib/police-permissions";
import { apiLogout, apiGetDisabledPages, apiGetOwnerFeatureFlags } from "@/lib/api";
import LanguageSwitcher from "@/components/ghms/language-switcher";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Navigation item definition ──
interface NavItem {
  page: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
  section?: string;
  // Optional: which tab inside the page should be pre-selected when this
  // item is clicked. Used by the 'Accommodation' parent's children
  // (Rooms → tab=rooms, Reservations → tab=reservations). When undefined,
  // the page opens with its default tab (controlled by useAppStore's
  // accommodationTab state).
  tab?: "rooms" | "reservations" | "group-bookings";
  // Optional: child items rendered as an expandable sub-list beneath this
  // parent. Only 'Accommodation' uses this today — its children are Rooms
  // and Reservations. Parents with children render with a chevron toggle
  // + an expandable region; clicking the parent label still navigates
  // (default tab), clicking the chevron only expands/collapses.
  children?: NavItem[];
}

// ── All available navigation items ──
const ALL_NAV_ITEMS: NavItem[] = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  // Owner Overview — consolidated view of KPIs + alerts + EoD + shift + tickets.
  // Only visible to SUPERUSER-with-providerId (owners). Falls back gracefully
  // (item not shown) for staff/operators who don't have ownerFeatureFlags
  // fully enabled.
  { page: "owner-overview", label: "Owner Overview", icon: TrendingUp },
  {
    page: "accommodation",
    label: "Accommodation",
    icon: DoorOpen,
    // Expandable section — click chevron to expand, click label to navigate
    // (default tab). Auto-expands when the user is on the accommodation page
    // so the active child is visible.
    children: [
      { page: "accommodation", label: "Rooms", icon: Bed, tab: "rooms" },
      { page: "accommodation", label: "Reservations", icon: CalendarCheck, tab: "reservations" },
      { page: "accommodation", label: "Group Bookings", icon: Users, tab: "group-bookings" },
    ],
  },
  { page: "users", label: "Account Management", icon: UserCog },
  { page: "resources", label: "Stock Management", icon: Package },
  { page: "expenses", label: "Expenses", icon: Receipt },
  { page: "guest-communication", label: "Messages", icon: MessageSquare },
  { page: "staff-logs", label: "Staff Activity", icon: ScrollText },
  { page: "my-subscription", label: "Subscription", icon: CreditCard },
  { page: "settings", label: "Settings", icon: Settings },
  // Reports moved to the bottom of the sidebar — it's a summary/analytics
  // page that operators access less frequently than the operational pages.
  { page: "reports", label: "Reports", icon: BarChart3 },
];

const POLICE_NAV_ITEMS: NavItem[] = [
  {
    page: "police-dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  { page: "providers", label: "Providers", icon: Building2 },
  {
    page: "police-reports",
    label: "Reports",
    icon: BarChart3,
  },
];

const JOINT_SESSION_POLICE_ITEMS: NavItem[] = [
  {
    page: "police-guests",
    label: "Guest Search",
    icon: Search,
  },
  {
    page: "suspect-alerts",
    label: "Suspect Alerts",
    icon: ShieldAlert,
    badge: "new",
    section: "suspect-watch",
  },
  {
    page: "suspected-persons",
    label: "Watchlist",
    icon: UserX,
    section: "suspect-watch",
  },
  {
    page: "notification-dispatch",
    label: "Dispatch Notification",
    icon: Megaphone,
  },
  {
    page: "police-investigation",
    label: "Investigation & Settings",
    icon: Search,
  },
  {
    page: "police-security",
    label: "Security",
    icon: Shield,
  },
  {
    page: "anomaly-detection",
    label: "Anomaly Detection",
    icon: BrainCircuit,
  },
  {
    page: "owner-accounts",
    label: "Manage Officers",
    icon: UserCog,
  },
];

// SUPERUSER (admin): admin dashboard, user management, guesthouses, subscriptions, system config, operator features, audit logs, data & reports, notifications
const SUPERUSER_NAV_ITEMS: NavItem[] = [
  { page: "super-admin-dashboard", label: "Admin Dashboard", icon: LayoutDashboard },
  { page: "super-user-management", label: "User Management", icon: UserCog },
  { page: "guesthouse-user-management", label: "Guesthouses", icon: Hotel },
  { page: "subscriptions", label: "Subscriptions", icon: CreditCard },
  { page: "super-system-config", label: "System Configuration", icon: Settings },
  { page: "operator-features", label: "Operator Features", icon: ShieldCheck },
  { page: "super-audit-logs", label: "Audit Logs", icon: ClipboardList },
  { page: "super-data-reports", label: "Data & Reports", icon: BarChart3 },
];

const OPERATOR_EXCLUDED = new Set<string>(["owner-accounts"]);

// ── Permission → page mapping for STAFF role ──
// Note: 'daytime' / 'daytime_view' permissions are deprecated — the
// Daytime Services tab has been deactivated. These keys now map to
// the main 'accommodation' page so legacy STAFF permissions still
// resolve to a valid destination.
const PERMISSION_PAGE_MAP: Record<string, NavItem> = {
  // New keys with _view suffix
  rooms_view: { page: "accommodation", label: "Accommodation", icon: DoorOpen },
  daytime_view: { page: "accommodation", label: "Accommodation", icon: DoorOpen },
  reports_view: { page: "reports", label: "Reports", icon: BarChart3 },
  reviews_view: { page: "reviews", label: "Reviews", icon: Star },
  notifications_view: {
    page: "notifications",
    label: "Notifications",
    icon: Bell,
  },
  settings_view: { page: "settings", label: "Settings", icon: Settings },
  // Legacy keys without _view suffix (backward compat)
  rooms: { page: "accommodation", label: "Accommodation", icon: DoorOpen },
  daytime: { page: "accommodation", label: "Accommodation", icon: DoorOpen },
  reports: { page: "reports", label: "Reports", icon: BarChart3 },
  reviews: { page: "reviews", label: "Reviews", icon: Star },
  notifications: {
    page: "notifications",
    label: "Notifications",
    icon: Bell,
  },
  settings: { page: "settings", label: "Settings", icon: Settings },
  reservations: { page: "accommodation", label: "Accommodation", icon: DoorOpen },
  guests: { page: "accommodation", label: "Accommodation", icon: DoorOpen },
  housekeeping: { page: "maintenance-tickets", label: "Maintenance Tickets", icon: Wrench },
  staff_logs_view: { page: "staff-logs", label: "Staff Activity", icon: ScrollText },
  guest_communication_view: { page: "guest-communication", label: "Messages", icon: MessageSquare },
  group_bookings_view: { page: "accommodation", label: "Group Bookings", icon: Users, tab: "group-bookings" },
};

// ── Police permission → page mapping ──
// Maps police permission keys (stored in User.permissions) to sidebar pages.
// Used to filter which police nav items a police user sees based on their
// selected module access.
const POLICE_PERMISSION_PAGE_MAP: Record<string, string[]> = {
  police_dashboard: ["police-dashboard"],
  police_guests: ["police-guests"],
  police_providers: ["providers"],
  police_reports: ["police-reports"],
  police_suspects: ["suspect-alerts", "suspected-persons"],
  police_intelligence: ["police-intelligence"],
  police_anomalies: ["anomaly-detection"],
  police_security: ["police-security"],
  police_dispatch: ["notification-dispatch"],
};

// ── Owner Visibility & Operational Control nav items ──
// These are added to the operator sidebar conditionally based on the
// ownerFeatureFlags set by the system admin in Operator Features.
const OWNER_EOD_NAV: NavItem = { page: "owner-eod", label: "End of Day", icon: FileText };
const SHIFT_HANDOVER_NAV: NavItem = { page: "shift-handover", label: "Shift Handover", icon: RefreshCwIcon };
const MAINTENANCE_TICKETS_NAV: NavItem = { page: "maintenance-tickets", label: "Maintenance Tickets", icon: Wrench };
const MULTI_PROVIDER_ROOMS_NAV: NavItem = { page: "operator-rooms-citywide", label: "All Guesthouses", icon: Building2 };
const PROVIDER_MESSAGES_NAV: NavItem = { page: "provider-messages", label: "Provider Chat", icon: MessageSquare };

// ── Helper: get nav items based on role ──
function getNavItems(
  user: CurrentUser,
  disabledPages: string[] = [],
  ownerFeatureFlags: Record<string, boolean> | null = null,
): NavItem[] {
  const disabledSet = new Set(disabledPages);

  // Build the operator nav items list — start with ALL_NAV_ITEMS, then
  // conditionally append the owner feature items if their flags are on.
  // Default to enabled if ownerFeatureFlags is null (not yet loaded) so
  // the items appear immediately on first load — better UX than a flash
  // of "missing items" while the flags fetch in parallel.
  const ownerEodEnabled = ownerFeatureFlags == null || ownerFeatureFlags.endOfDayReport !== false;
  const shiftHandoverEnabled = ownerFeatureFlags == null || ownerFeatureFlags.shiftHandover !== false;
  const maintenanceTicketsEnabled = ownerFeatureFlags == null || ownerFeatureFlags.maintenanceTickets !== false;
  // multiProviderRooms defaults to FALSE — only show the nav item when the
  // admin has explicitly enabled it. Use `=== true` (not `!== false`) so
  // null/undefined (not yet loaded) keeps the item hidden.
  const multiProviderRoomsEnabled = ownerFeatureFlags?.multiProviderRooms === true;

  const operatorItems: NavItem[] = [...ALL_NAV_ITEMS];
  // Owner Overview page is for SUPERUSER-with-providerId (owners) AND OPERATOR.
  // Both roles are "operators" of a guesthouse and should see the consolidated
  // owner view. STAFF + system-admin SUPERUSER (no providerId) don't see it.
  if ((user.role !== "SUPERUSER" && user.role !== "OPERATOR") || !user.providerId) {
    const idx = operatorItems.findIndex((i) => i.page === "owner-overview");
    if (idx >= 0) operatorItems.splice(idx, 1);
  }
  if (ownerEodEnabled) operatorItems.push(OWNER_EOD_NAV);
  if (shiftHandoverEnabled) operatorItems.push(SHIFT_HANDOVER_NAV);
  if (maintenanceTicketsEnabled) operatorItems.push(MAINTENANCE_TICKETS_NAV);
  if (multiProviderRoomsEnabled) {
    operatorItems.push(MULTI_PROVIDER_ROOMS_NAV);
    operatorItems.push(PROVIDER_MESSAGES_NAV);
  }

  switch (user.role) {
    case "POLICE": {
      const rank = (user.policeRank || "OFFICER") as PoliceRank;
      const allowedPages = POLICE_RANK_PERMISSIONS[rank] || POLICE_RANK_PERMISSIONS.OFFICER;

      // ── Filter by police module permissions ──
      // If the user has police_* permission keys in their permissions array,
      // filter the nav items to only show pages they have access to.
      // If no police_* permissions are set, show all (backwards compat).
      const hasPolicePerms = user.permissions.some((p) => p.startsWith("police_"));
      if (hasPolicePerms) {
        // Build set of allowed page keys from the user's police permissions
        const allowedPageKeys = new Set<string>();
        for (const perm of user.permissions) {
          const pages = POLICE_PERMISSION_PAGE_MAP[perm];
          if (pages) pages.forEach((p) => allowedPageKeys.add(p));
        }
        return POLICE_NAV_ITEMS.filter(
          (item) => allowedPages.includes(item.page) && allowedPageKeys.has(item.page)
        );
      }

      // No police permissions set → show all (existing behavior)
      return POLICE_NAV_ITEMS.filter((item) => allowedPages.includes(item.page));
    }

    case "SUPERUSER": {
      // Guest house owners (SUPERUSER with providerId) see the provider dashboard.
      // System admins (SUPERUSER without providerId) see the admin dashboard.
      if (user.providerId) {
        return operatorItems.filter(
          (item) => !OPERATOR_EXCLUDED.has(item.page) && !disabledSet.has(item.page)
        );
      }
      return SUPERUSER_NAV_ITEMS;
    }

    case "OPERATOR":
      return operatorItems.filter(
        (item) => !OPERATOR_EXCLUDED.has(item.page) && !disabledSet.has(item.page)
      );

    case "STAFF": {
      const items: NavItem[] = [];
      // Always give staff access to dashboard
      if (!disabledSet.has("dashboard")) {
        items.push({
          page: "dashboard",
          label: "Dashboard",
          icon: LayoutDashboard,
        });
      }
      // Add items based on permissions (deduplicate by page key)
      const seen = new Set<string>();
      for (const perm of user.permissions) {
        const mapped = PERMISSION_PAGE_MAP[perm];
        if (mapped && !seen.has(mapped.page) && !disabledSet.has(mapped.page)) {
          seen.add(mapped.page);
          // ── Merge children from ALL_NAV_ITEMS if the mapped page has
          // children defined there (e.g. 'accommodation' has Rooms +
          // Reservations as children). Filter the children based on the
          // staff's actual permissions so a staff member with ONLY
          // 'reservations' sees the Reservations sub-item but NOT Rooms,
          // and vice versa.
          const allNavItem = ALL_NAV_ITEMS.find((n) => n.page === mapped.page);
          if (allNavItem?.children && allNavItem.children.length > 0) {
            // Filter children: Rooms visible if staff has rooms/rooms_view,
            // Reservations visible if staff has reservations.
            const filteredChildren = allNavItem.children.filter((child) => {
              if (child.tab === "rooms") {
                return user.permissions.includes("rooms") ||
                       user.permissions.includes("rooms_view");
              }
              if (child.tab === "reservations") {
                return user.permissions.includes("reservations");
              }
              return true;
            });
            // Only add the parent with children if at least one child is visible.
            // If no children are visible (e.g. staff has 'guests' which maps to
            // accommodation but has no rooms/reservations permission), don't
            // add the parent at all — it would show an empty expandable section.
            if (filteredChildren.length > 0) {
              items.push({ ...mapped, children: filteredChildren });
            }
          } else {
            items.push(mapped);
          }
        }
      }
      return items;
    }

    default:
      return [
        { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      ];
  }
}

// ── Helper: get initials from name ──
function getInitials(name: string | undefined | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Helper: get role badge className (no label — use t() for that) ──
function getRoleBadgeClass(role: string): string {
  switch (role) {
    case "SUPERUSER": return "bg-amber-100 text-amber-700 border-amber-200";
    case "OPERATOR": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "STAFF": return "bg-sky-100 text-sky-700 border-sky-200";
    case "POLICE": return "bg-rose-100 text-rose-700 border-rose-200";
    default: return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

// ── Nav item button component ──
// Renders a single sidebar entry. If `item.children` is set, the button
// shows a chevron that toggles expand/collapse; clicking the label still
// navigates (default tab). When expanded, children are rendered as
// NavItemChildButton instances below; their clicks dispatch
// `onChildClick(childItem)` so the parent component can pre-select the
// tab via setAccommodationTab before navigating.
//
// Parents with children render as ONE cohesive row (label + chevron
// inside the same button) so they visually match other top-level items
// like Dashboard/Reports. The chevron is a separate hit area but lives
// inside the same rounded highlight box.
function NavItemButton({
  item,
  currentPage,
  currentTab,
  onClick,
  onChildClick,
  expanded,
  onToggleExpand,
  depth = 0,
}: {
  item: NavItem;
  currentPage: string;
  currentTab?: "rooms" | "reservations";
  onClick: () => void;
  onChildClick?: (item: NavItem) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  depth?: number;
}) {
  const { t } = useTranslation("sidebar");
  const Icon = item.icon;
  const hasChildren = !!item.children && item.children.length > 0;
  // Active highlight logic:
  //   - For leaf items (no children): active when currentPage matches AND
  //     (no tab on the item OR currentTab matches the item's tab).
  //   - For parents (with children): active when currentPage matches the
  //     parent's page AND no child is currently active (so the parent
  //     only highlights when collapsed, not when an expanded child is
  //     the actual active route).
  const childIsActive = hasChildren && item.children!.some(
    (c) => c.page === currentPage && (!c.tab || currentTab === c.tab)
  );
  const isActive = hasChildren
    ? currentPage === item.page && !childIsActive
    : currentPage === item.page && (!item.tab || currentTab === item.tab);

  return (
    <div className="relative">
      <button
        onClick={onClick}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        className={`group relative flex w-full items-center gap-3 rounded-lg pr-2.5 py-2.5 text-sm font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
          isActive
            ? "bg-primary/10 text-primary"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        {isActive && (
          <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-primary" />
        )}
        <Icon
          className={`size-[18px] shrink-0 transition-colors ${
            isActive ? "text-primary" : "text-slate-400 group-hover:text-slate-600"
          }`}
        />
        <span className="truncate flex-1 text-left">{t(item.label)}</span>
        {item.badge && (
          <Badge
            variant="secondary"
            className="h-5 min-w-[20px] items-center justify-center bg-rose-500 px-1.5 text-[10px] font-bold text-white"
          >
            {t(item.badge)}
          </Badge>
        )}
        {hasChildren && onToggleExpand && (
          <ChevronDown
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            role="button"
            tabIndex={0}
            aria-label={expanded ? t("Collapse") : t("Expand sidebar")}
            aria-expanded={expanded}
            className={`shrink-0 size-4 p-0.5 cursor-pointer rounded transition-all ${
              expanded ? "rotate-180" : ""
            } ${
              isActive
                ? "text-primary hover:bg-primary/20"
                : "text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            }`}
          />
        )}
      </button>
      {/* Expandable children — indented under the parent, smaller font,
          with a subtle left border to visually nest them. */}
      {hasChildren && expanded && (
        <div className="mt-0.5 ml-4 pl-2 border-l border-slate-200/70 space-y-0.5">
          {item.children!.map((child) => (
            <NavItemChildButton
              key={`${child.page}-${child.tab || ""}`}
              item={child}
              currentPage={currentPage}
              currentTab={currentTab}
              onChildClick={onChildClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Child nav button (for items inside an expandable section) ──
// Visually smaller than the parent — smaller font (13px vs 14px),
// smaller icon (16px vs 18px), and rendered inside an indented container
// with a subtle left border (provided by the parent's wrapper div).
// Always a leaf — no children of its own.
function NavItemChildButton({
  item,
  currentPage,
  currentTab,
  onChildClick,
}: {
  item: NavItem;
  currentPage: string;
  currentTab?: "rooms" | "reservations";
  onChildClick?: (item: NavItem) => void;
  depth?: number;
}) {
  const { t } = useTranslation("sidebar");
  const Icon = item.icon;
  const isActive = currentPage === item.page && (!item.tab || currentTab === item.tab);
  return (
    <button
      onClick={() => onChildClick?.(item)}
      className={`group relative flex w-full items-center gap-2.5 rounded-md pl-2.5 pr-2 py-1.5 text-[13px] font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        isActive
          ? "bg-primary/10 text-primary"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {isActive && (
        <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-primary" />
      )}
      <Icon
        className={`size-4 shrink-0 transition-colors ${
          isActive ? "text-primary" : "text-slate-400 group-hover:text-slate-600"
        }`}
      />
      <span className="truncate">{t(item.label)}</span>
    </button>
  );
}

// ── Sidebar content (shared between desktop & mobile) ──
// ── Subscription status widget for provider sidebar ──
function SubscriptionStatusCard({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation("sidebar");
  const subscription = useAppStore((s) => s.subscription);

  if (!subscription) return null;

  const isActive = subscription.status === "ACTIVE";
  const isWarning = subscription.status === "WARNING";
  const isExpired = subscription.status === "EXPIRED";
  const isSuspended = subscription.status === "SUSPENDED";

  // Collapsed mode — icon indicator
  if (collapsed) {
    const bgClass = isActive
      ? "bg-emerald-100"
      : isSuspended || isExpired
      ? "bg-rose-100"
      : "bg-amber-100";
    const iconClass = isActive
      ? "text-emerald-600"
      : isSuspended || isExpired
      ? "text-rose-600"
      : "text-amber-600";
    return (
      <div className="flex flex-col items-center gap-1 px-2 py-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${bgClass} animate-pulse shadow-sm`}> 
          <Clock className={`size-4 ${iconClass}`} />
        </div>
      </div>
    );
  }

  // Expanded card
  const containerClass = isActive
    ? "border-emerald-200 bg-emerald-50"
    : isSuspended || isExpired
    ? "border-rose-200 bg-rose-50"
    : "border-amber-200 bg-amber-50";

  const iconColorClass = isActive
    ? "text-emerald-600"
    : isSuspended || isExpired
    ? "text-rose-600"
    : "text-amber-600";

  const titleClass = isActive
    ? "text-emerald-800"
    : isSuspended || isExpired
    ? "text-rose-800"
    : "text-amber-800";

  const subtextClass = isActive
    ? "text-emerald-700"
    : isSuspended || isExpired
    ? "text-rose-700"
    : "text-amber-700";

  const badgeClass = isActive
    ? "bg-emerald-200/60 text-emerald-800"
    : isSuspended || isExpired
    ? "bg-rose-200/60 text-rose-800"
    : "bg-amber-200/60 text-amber-800";

  const Icon = isSuspended || isExpired ? AlertTriangle : Clock;

  return (
    <div className={`rounded-lg border p-3 ${containerClass} animate-subtle-pulse shadow-sm`}> 
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${iconColorClass}`} />
        <p className={`text-xs font-semibold ${titleClass}`}>
          {isActive
            ? t("Subscription Active")
            : isSuspended
            ? t("Service Suspended")
            : isExpired
            ? t("Subscription Expired")
            : t("Expiring Soon")}
        </p>
      </div>
      <div className={`mt-1.5 flex items-center justify-between text-[11px] ${subtextClass}`}>
        <span>{formatDaysRemaining(subscription.daysRemaining)}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${badgeClass}`}>
          <Clock className="h-3 w-3" />
          {Math.abs(subscription.daysRemaining)}d
        </span>
      </div>
      {subscription.price > 0 ? (
        <div className={`mt-1 text-[11px] ${subtextClass}`}>
          {t("Due: ")}{subscription.price.toLocaleString()} ETB / {formatCycle(subscription.cycle)}
        </div>
      ) : (
        <div className={`mt-1 text-[11px] ${subtextClass}`}>
          {formatCycle(subscription.cycle)} {t("cycle — Free trial")}
        </div>
      )}
    </div>
  );
}

function SidebarContent({
  user,
  currentPage,
  onNavigate,
  onLogout,
  collapsed,
  onToggleCollapse,
}: {
  user: CurrentUser;
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const { t } = useTranslation("sidebar");
  const { jointSession, setJointLoginDialogOpen, subscription, disabledPages, ownerFeatureFlags, accommodationTab, setAccommodationTab } = useAppStore();

  // ── Prevent flash of soon-to-be-hidden nav items ──
  // disabledPages starts as null (not yet fetched from the API).
  // For roles that might have disabled pages, we show skeleton nav
  // items instead of real ones until the fetch completes — otherwise
  // the user sees ALL items for ~1 second before the disabled ones
  // disappear (visible flicker).
  const role = user.role;
  const mightHaveDisabledPages =
    role === "OPERATOR" || role === "STAFF" ||
    (role === "SUPERUSER" && user.providerId);
  const waitingForDisabledPages = mightHaveDisabledPages && disabledPages === null;

  const navItems = waitingForDisabledPages ? [] : getNavItems(user, disabledPages ?? [], ownerFeatureFlags);
  const roleBadgeClass = getRoleBadgeClass(user.role);

  // ── Expandable sidebar sections (currently only 'Accommodation') ──
  // Persisted in localStorage so the operator's choice is remembered.
  // Auto-expanded when the user is on a page that matches the parent's
  // page (so the active child is always visible).
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("ghms.sidebar.expandedSections");
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      /* private mode / corrupted JSON — ignore */
    }
    return new Set();
  });
  // Auto-expand any section whose parent page matches currentPage.
  // Done as an effect (not initial state) so navigation AFTER first
  // render also triggers the expand. Doesn't override an explicit
  // collapse — if the user manually collapses, we respect that until
  // they navigate away and back.
  useEffect(() => {
    const pagesWithChildren = new Set(
      navItems.filter((i) => i.children && i.children.length > 0).map((i) => i.page)
    );
    if (pagesWithChildren.has(currentPage)) {
      setExpandedSections((prev) => prev.has(currentPage) ? prev : new Set(prev).add(currentPage));
    }
  }, [currentPage, navItems]);
  const toggleSection = (page: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      try { localStorage.setItem("ghms.sidebar.expandedSections", JSON.stringify(Array.from(next))); } catch { /* private mode */ }
      return next;
    });
  };
  // Click handler that respects the item's `tab` field (children of the
  // Accommodation parent). If tab is set, call setAccommodationTab first
  // so the page opens with the right tab pre-selected.
  const handleItemClick = (item: NavItem) => {
    if (item.tab) setAccommodationTab(item.tab);
    onNavigate(item.page);
  };

  // Translated role label
  const getRoleLabel = (role: string) => {
    const map: Record<string, string> = {
      SUPERUSER: t("roleSuperuser"),
      OPERATOR: t("roleOperator"),
      STAFF: t("roleStaff"),
      POLICE: t("rolePolice"),
    };
    return map[role] || role;
  };

  // Translated rank label
  const getRankLabel = (rank: string) => {
    const map: Record<string, string> = {
      ADMIN: t("rankAdmin"),
      DETECTIVE: t("rankDetective"),
      OFFICER: t("rankOfficer"),
      VIEWER: t("rankViewer"),
    };
    return map[rank] || rank;
  };

  // Determine if user can start a joint session (SUPERUSER or POLICE ADMIN)
  const canStartJoint =
    user.role === "SUPERUSER" ||
    (user.role === "POLICE" && user.policeRank === "ADMIN");

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* ── User profile section ── */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div
          className={`flex items-center gap-3 ${collapsed ? "flex-col text-center" : ""}`}
        >
          <Avatar className="h-10 w-10 shrink-0 ring-2 ring-primary/20">
            <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              {/* All roles: Name with dropdown menu (My Profile + Sign Out) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center justify-between gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-slate-50 group">
                    <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-primary">
                      {user.name}
                    </p>
                    <ChevronDown className="size-3.5 shrink-0 text-slate-400 group-hover:text-primary transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  {/* User info header */}
                  <div className="flex items-center gap-2.5 px-2 py-2.5">
                    <Avatar className="h-9 w-9 ring-2 ring-primary/20">
                      <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                        {getInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
                      <p className="truncate text-[11px] text-slate-400">{getRoleLabel(user.role)}{user.providerName ? ` · ${user.providerName}` : ""}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="flex items-center gap-2.5 cursor-pointer"
                    onClick={() => onNavigate("settings")}
                  >
                    <UserCircle className="size-4 text-slate-500" />
                    <span>{t("My Profile")}</span>
                  </DropdownMenuItem>
                  {/* Organization Profile — only show for operators/staff (users with a providerId).
                      Superusers and Police don't have an organization to manage. */}
                  {user.providerId && (
                    <DropdownMenuItem
                      className="flex items-center gap-2.5 cursor-pointer"
                      onClick={() => onNavigate("organization-info")}
                    >
                      <Building2 className="size-4 text-slate-500" />
                      <span>{t("Organization Profile")}</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="flex items-center gap-2.5 cursor-pointer text-rose-600 focus:text-rose-600 focus:bg-rose-50"
                    onClick={() => onLogout()}
                  >
                    <LogOut className="size-4" />
                    <span>{t("Sign Out")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="mt-0.5 flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-[10px] font-semibold leading-none px-1.5 py-0.5 ${roleBadgeClass}`}
                >
                  <Shield className="mr-1 size-2.5" />
                  {getRoleLabel(user.role)}
                </Badge>
                {user.role === "POLICE" && user.policeRank && (
                  <Badge
                    variant="outline"
                    className={`text-[9px] font-semibold leading-none px-1.5 py-0.5 ${RANK_BADGE_CLASSES[(user.policeRank as PoliceRank)] || ""}`}
                  >
                    {getRankLabel(user.policeRank as string) || user.policeRank}
                  </Badge>
                )}
                {user.providerName && (
                  <span className="truncate text-[11px] text-slate-400">
                    {user.providerName}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Separator className="shrink-0 bg-slate-200/60" />

      {/* ── Navigation links ── */}
      <ScrollArea className="flex-1 min-h-0 px-3 py-3">
        <nav className="flex flex-col gap-1" aria-label={t("Main navigation")}>
          {waitingForDisabledPages ? (
            // Skeleton placeholders while disabledPages is being fetched.
            // Prevents the flash of soon-to-be-hidden nav items.
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                <div className="size-[18px] shrink-0 animate-pulse rounded bg-slate-200" />
                <div className="h-3.5 w-24 animate-pulse rounded bg-slate-200" />
              </div>
            ))
          ) : (
          navItems.map((item) => (
            <NavItemButton
              key={item.page + (item.tab ? `-${item.tab}` : "")}
              item={item}
              currentPage={currentPage}
              currentTab={accommodationTab}
              expanded={expandedSections.has(item.page)}
              onToggleExpand={item.children && item.children.length > 0 ? () => toggleSection(item.page) : undefined}
              onClick={() => handleItemClick(item)}
              onChildClick={handleItemClick}
            />
          ))
          )}

          {/* Joint Operations — only shown during active joint session */}
          {jointSession.active && (
            <>
              <Separator className="my-2 bg-slate-200/60" />
              <p className={`px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${collapsed ? "text-center" : ""}`}>
                {t("Joint Session")}
              </p>
              <NavItemButton
                item={{ page: "joint-operations", label: "Joint Operations", icon: ShieldCheck }}
                currentPage={currentPage}
                onClick={() => onNavigate("joint-operations")}
              />
              {!collapsed && (
                <p className="px-3 mt-2 text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                  {t("Police Tools")}
                </p>
              )}
              {JOINT_SESSION_POLICE_ITEMS.map((item, idx) => {
                // Show section label before the first item in a new section
                const showSection =
                  !collapsed &&
                  item.section &&
                  (idx === 0 || JOINT_SESSION_POLICE_ITEMS[idx - 1]?.section !== item.section);
                return (
                  <React.Fragment key={item.page}>
                    {showSection && (
                      <>
                        <Separator className="my-2 bg-slate-200/60" />
                        <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {t("Suspect Watch")}
                        </p>
                      </>
                    )}
                    <NavItemButton
                      item={item}
                      currentPage={currentPage}
                      onClick={() => onNavigate(item.page)}
                    />
                  </React.Fragment>
                );
              })}
            </>
          )}

          {/* Start Joint Session button — shown for SUPERUSER/POLICE ADMIN when no joint session */}
          {canStartJoint && !jointSession.active && !collapsed && (
            <>
              <Separator className="my-2 bg-slate-200/60" />
              <button
                onClick={() => setJointLoginDialogOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2.5 text-sm font-medium text-amber-700 transition-all hover:bg-amber-50 hover:border-amber-400 hover:text-amber-800 outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <ShieldCheck className="size-[18px] shrink-0" />
                <span>{t("Start Joint Session")}</span>
              </button>
            </>
          )}
          {canStartJoint && !jointSession.active && collapsed && (
            <button
              onClick={() => setJointLoginDialogOpen(true)}
              className="flex items-center justify-center rounded-lg border border-dashed border-amber-300 p-2 text-amber-600 hover:bg-amber-50 transition-colors outline-none"
              title={t("Start Joint Session")}
            >
              <ShieldCheck className="size-[18px]" />
            </button>
          )}
        </nav>
      </ScrollArea>

      {/* ── Subscription status for providers ── */}
      {(user.role === "OPERATOR" || user.role === "STAFF") && (
        <div className="shrink-0 px-3 py-2">
          <SubscriptionStatusCard collapsed={collapsed} />
        </div>
      )}

      <Separator className="shrink-0 bg-slate-200/60" />

      {/* ── Bottom section: language switcher + collapse toggle ── */}
      <div className="shrink-0 p-3 flex flex-col gap-2">
        {/* Language switcher */}
        {collapsed ? (
          <div className="flex justify-center">
            <LanguageSwitcher />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-1">
            <LanguageSwitcher />
            <span className="text-xs text-slate-400">{t("Language")}</span>
          </div>
        )}
        {/* Desktop collapse toggle */}
        {!collapsed && (
          <button
            onClick={onToggleCollapse}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-[18px] text-slate-400" />
            <span>{t("Collapse")}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Sidebar Component ──
export default function Sidebar() {
  const { t } = useTranslation("sidebar");
  const { currentUser, currentPage, setCurrentPage, setCurrentUser, sidebarOpen, setSidebarOpen, setDisabledPages, setOwnerFeatureFlags } =
    useAppStore();
  const isMobile = useIsMobile();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Fetch disabled operator pages + owner feature flags for OPERATOR/STAFF/SUPERUSER(with providerId).
  // Both come from the same /api/operator-features endpoint — fetched in parallel.
  React.useEffect(() => {
    if (!mounted || !currentUser) return;
    const role = currentUser.role;
    const shouldFetch =
      role === "OPERATOR" || role === "STAFF" ||
      (role === "SUPERUSER" && currentUser.providerId);
    if (!shouldFetch) return;
    // Skip if already loaded (null = not yet fetched)
    if (useAppStore.getState().disabledPages !== null) return;
    apiGetDisabledPages().then((pages) => setDisabledPages(pages)).catch(() => setDisabledPages([]));
    // Also fetch the owner feature flags (ownerDashboard, endOfDayReport, etc.)
    // so the dashboard page + other components can conditionally render features.
    if (useAppStore.getState().ownerFeatureFlags === null) {
      apiGetOwnerFeatureFlags()
        .then((flags) => setOwnerFeatureFlags(flags))
        .catch(() => setOwnerFeatureFlags({ ownerDashboard: true, endOfDayReport: true, shiftHandover: true, maintenanceTickets: true, multiProviderRooms: false }));
    }
  }, [mounted, currentUser, setDisabledPages, setOwnerFeatureFlags]);

  if (!mounted || !currentUser) return null;

  async function handleLogout() {
    // Clear httpOnly cookie on server
    await apiLogout();
    // Clear local state
    setCurrentUser(null);
    setCurrentPage("login");
    if (isMobile) setSidebarOpen(false);
  }

  function handleNavigate(page: string) {
    setCurrentPage(page);
    if (isMobile) setSidebarOpen(false);
  }

  // ── Mobile: render as a Sheet ──
  if (isMobile) {
    return (
      <>
        {/* Mobile hamburger button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm transition-colors hover:bg-slate-50 active:bg-slate-100"
          aria-label={t("Open navigation menu")}
        >
          <Menu className="size-5 text-slate-700" />
        </button>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-64 p-0 flex flex-col overflow-hidden">
            <SheetHeader className="border-b border-slate-100 px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
                  <Building2 className="size-4 text-white" />
                </div>
                <SheetTitle className="text-sm font-bold text-slate-900">
                  GHMS
                </SheetTitle>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent
                user={currentUser}
                currentPage={currentPage}
                onNavigate={handleNavigate}
                onLogout={handleLogout}
                collapsed={false}
                onToggleCollapse={() => {}}
              />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // ── Desktop: render as a fixed sidebar ──
  const collapsed = !sidebarOpen;

  return (
    <aside
      className={`relative flex h-full flex-col min-h-0 border-r border-slate-200 bg-white transition-all duration-300 ease-in-out ${
        collapsed ? "w-[60px]" : "w-56"
      }`}
    >
      {/* ── Logo / Brand ── */}
      <div
        className={`flex h-16 items-center border-b border-slate-200/60 px-4 ${collapsed ? "justify-center" : "gap-3"}`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
          <Building2 className="size-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-slate-900">
              Bishoftu GMS
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {t("Bishoftu Guest Management")}
            </p>
          </div>
        )}
        {/* Expand button when collapsed */}
        {collapsed && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute -right-3 top-5 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-colors hover:bg-slate-50"
            aria-label={t("Expand sidebar")}
          >
            <Menu className="size-3 text-slate-500" />
          </button>
        )}
      </div>

      {/* ── Switch to Mobile App link ──
          Top-left corner shortcut — lets the operator jump to the
          mobile-optimized UI (/m) without typing the URL. Hidden when
          the sidebar is collapsed (matches the brand block pattern);
          the collapsed state shows just the Smartphone icon as a
          compact button. */}
      <a
        href="/m"
        title={t("Switch to Mobile App") || "Switch to Mobile App"}
        className={`group flex items-center gap-2 px-4 py-2 text-[12px] font-medium text-slate-500 transition-colors hover:bg-emerald-50 hover:text-emerald-700 border-b border-slate-100 ${
          collapsed ? "justify-center" : ""
        }`}
      >
        <Smartphone className="size-3.5 shrink-0" />
        {!collapsed && (
          <span className="flex items-center gap-1">
            {t("Switch to Mobile App") || "Switch to Mobile App"}
            <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </span>
        )}
      </a>

      <SidebarContent
        user={currentUser}
        currentPage={currentPage}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        collapsed={collapsed}
        onToggleCollapse={() => setSidebarOpen(!sidebarOpen)}
      />
    </aside>
  );
}