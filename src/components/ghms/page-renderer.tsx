"use client";

import React, { lazy, Suspense, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { apiSubscriptionStatus } from "@/lib/api";
import { JointLoginDialog } from "@/components/ghms/joint-login-dialog";
import JointSessionBanner from "@/components/ghms/joint-session-banner";
import SubscriptionBanner from "@/components/ghms/subscription-banner";
import { OperatorHelpWidget } from "@/components/operator/help-widget";

// ── Loading fallback ──
function PageLoader() {
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary/60" />
        <p className="text-sm font-medium text-slate-400">Loading page...</p>
      </div>
    </div>
  );
}

// ── Fallback for missing pages ──
function PageNotFound({ page }: { page: string }) {
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <span className="text-2xl font-bold text-slate-300">?</span>
        </div>
        <h2 className="text-lg font-semibold text-slate-700">Page Not Found</h2>
        <p className="mt-1 text-sm text-slate-400">
          The page &quot;{page}&quot; has not been implemented yet.
        </p>
      </div>
    </div>
  );
}

// ── Lazy-loaded page components ──
const lazyPage = (importFn: () => Promise<{ default: React.ComponentType }>) =>
  lazy(importFn);

const DashboardPage = lazyPage(
  () => import("@/components/ghms/pages/dashboard-page")
);
const RoomsPage = lazyPage(() => import("@/components/ghms/pages/rooms-page"));
const GuestsPage = lazyPage(() => import("@/components/ghms/pages/guests-page"));
const ReservationsPage = lazyPage(
  () => import("@/components/ghms/pages/reservations-page")
);
const GuestsReservationsPage = lazyPage(
  () => import("@/components/ghms/pages/guests-reservations-page")
);
const DaytimePage = lazyPage(
  () => import("@/components/ghms/pages/daytime-page")
);
const ExpensesPage = lazyPage(
  () => import("@/components/ghms/pages/expenses-page")
);
const ResourcesPage = lazyPage(
  () => import("@/components/ghms/pages/resources-page")
);
const HousekeepingPage = lazyPage(
  () => import("@/components/ghms/pages/housekeeping-page")
);
const ReportsPage = lazyPage(
  () => import("@/components/ghms/pages/reports-page")
);
const SettingsPage = lazyPage(
  () => import("@/components/ghms/pages/settings-page")
);
const OrganizationInfoPage = lazyPage(
  () => import("@/components/ghms/pages/organization-info-page")
);
const NotificationsPage = lazyPage(
  () => import("@/components/ghms/pages/notifications-page")
);
const ProvidersPage = lazyPage(
  () => import("@/components/ghms/pages/providers-page")
);
const PoliceDashboardPage = lazyPage(
  () => import("@/components/ghms/pages/police-dashboard-page")
);
const PoliceGuestsPage = lazyPage(
  () => import("@/components/ghms/pages/police-guests-page")
);
const SuspectAlertsPage = lazyPage(
  () => import("@/components/ghms/pages/suspect-alerts-page")
);
const SuspectedPersonsPage = lazyPage(
  () => import("@/components/ghms/pages/suspected-persons-page")
);
const PoliceIntelligencePage = lazyPage(
  () => import("@/components/ghms/pages/police-intelligence-page")
);
const PoliceInvestigationPage = lazyPage(
  () => import("@/components/ghms/pages/police-investigation-page")
);
const PoliceSecurityPage = lazyPage(
  () => import("@/components/ghms/pages/police-security-page")
);
const ReviewsPage = lazyPage(
  () => import("@/components/ghms/pages/reviews-page")
);
const OwnerAccountsPage = lazyPage(
  () => import("@/components/ghms/pages/owner-accounts-page")
);
const UsersPage = lazyPage(() => import("@/components/ghms/pages/users-page"));
const JointOperationsPage = lazyPage(
  () => import("@/components/ghms/pages/joint-operations-page")
);
const SubscriptionsPage = lazyPage(
  () => import("@/components/ghms/pages/subscriptions-page")
);
const SubscriptionPlansPage = lazyPage(
  () => import("@/components/ghms/pages/subscription-plans-page")
);
const SubscriptionLockoutPage = lazy(
  () => import("@/components/ghms/pages/subscription-lockout-page") as Promise<{ default: React.ComponentType<any> }>
);
const AnomalyDetectionPage = lazyPage(
  () => import("@/components/ghms/pages/anomalies-page")
);
const SuperAdminDashboardPage = lazyPage(
  () => import("@/components/ghms/pages/super-admin-dashboard-page")
);
const SuperSystemConfigPage = lazyPage(
  () => import("@/components/ghms/pages/super-system-config-page")
);
const SuperAuditLogsPage = lazyPage(
  () => import("@/components/ghms/pages/super-audit-logs-page")
);
const SuperDataReportsPage = lazyPage(
  () => import("@/components/ghms/pages/super-data-reports-page")
);
const SuperUserManagementPage = lazyPage(
  () => import("@/components/ghms/pages/super-user-management-page")
);
const SuperGuesthouseUsersPage = lazyPage(
  () => import("@/components/ghms/pages/super-guesthouse-users-page")
);
const SuperProfilePage = lazyPage(
  () => import("@/components/ghms/pages/super-profile-page")
);
const GuesthouseUserManagementPage = lazyPage(
  () => import("@/components/ghms/pages/guesthouse-user-management-page")
);
const AccommodationPage = lazyPage(
  () => import("@/components/ghms/pages/accommodation-page")
);
const GroupBookingsPage = lazyPage(
  () => import("@/components/ghms/pages/group-bookings-page")
);
const GuestCommunicationPage = lazyPage(
  () => import("@/components/ghms/pages/guest-communication-page")
);
const StaffLogsPage = lazyPage(
  () => import("@/components/ghms/pages/staff-logs-page")
);
const TasksPage = lazyPage(
  () => import("@/components/ghms/pages/tasks-page")
);
const StaffPerformancePage = lazyPage(
  () => import("@/components/ghms/pages/staff-performance-page")
);
const NotificationDispatchPage = lazyPage(
  () => import("@/components/ghms/pages/notification-dispatch-page")
);
const PoliceReportsPage = lazyPage(
  () => import("@/components/ghms/pages/police-reports-page")
);
const MySubscriptionPage = lazyPage(
  () => import("@/components/ghms/pages/my-subscription-page")
);
const OperatorFeaturesPage = lazyPage(
  () => import("@/components/ghms/pages/operator-features-page")
);
const OwnerEodPage = lazyPage(
  () => import("@/components/ghms/pages/owner-eod-page")
);
const ShiftHandoverPage = lazyPage(
  () => import("@/components/ghms/pages/shift-handover-page")
);
const MaintenanceTicketsPage = lazyPage(
  () => import("@/components/ghms/pages/maintenance-tickets-page")
);
const OwnerOverviewPage = lazyPage(
  () => import("@/components/ghms/pages/owner-overview-page")
);
const OperatorRoomsCitywidePage = lazyPage(
  () => import("@/components/ghms/pages/operator-rooms-citywide-page")
);
const ProviderMessagesPage = lazyPage(
  () => import("@/components/ghms/pages/provider-messages-page")
);

// ── Page registry: maps page key → lazy component ──
const PAGE_MAP: Record<string, React.LazyExoticComponent<React.ComponentType>> =
  {
    dashboard: DashboardPage,
    rooms: RoomsPage,
    accommodation: AccommodationPage,
    "guests-reservations": GuestsReservationsPage,
    guests: GuestsPage,
    reservations: ReservationsPage,
    daytime: DaytimePage,
    expenses: ExpensesPage,
    resources: ResourcesPage,
    housekeeping: HousekeepingPage,
    users: UsersPage,
    reports: ReportsPage,
    settings: SettingsPage,
    "organization-info": OrganizationInfoPage,
    notifications: NotificationsPage,
    providers: ProvidersPage,
    "police-dashboard": PoliceDashboardPage,
    "police-guests": PoliceGuestsPage,
    "suspect-alerts": SuspectAlertsPage,
    "suspected-persons": SuspectedPersonsPage,
    "police-intelligence": PoliceIntelligencePage,
    "police-investigation": PoliceInvestigationPage,
    "police-security": PoliceSecurityPage,
    reviews: ReviewsPage,
    "owner-accounts": OwnerAccountsPage,
    "joint-operations": JointOperationsPage,
    subscriptions: SubscriptionsPage,
    "subscription-plans": SubscriptionPlansPage,
    "subscription-lockout": SubscriptionLockoutPage,
    "anomaly-detection": AnomalyDetectionPage,
    "super-admin-dashboard": SuperAdminDashboardPage,
    "super-system-config": SuperSystemConfigPage,
    "super-audit-logs": SuperAuditLogsPage,
    "super-data-reports": SuperDataReportsPage,
    "super-user-management": SuperUserManagementPage,
    "super-guesthouse-users": SuperGuesthouseUsersPage,
    "super-profile": SuperProfilePage,
    "guesthouse-user-management": GuesthouseUserManagementPage,
    "group-bookings": GroupBookingsPage,
    "guest-communication": GuestCommunicationPage,
    "staff-logs": StaffLogsPage,
    "tasks": TasksPage,
    "staff-performance": StaffPerformancePage,
    "notification-dispatch": NotificationDispatchPage,
    "police-reports": PoliceReportsPage,
    "my-subscription": MySubscriptionPage,
    "operator-features": OperatorFeaturesPage,
    "owner-eod": OwnerEodPage,
    "shift-handover": ShiftHandoverPage,
    "maintenance-tickets": MaintenanceTicketsPage,
    "owner-overview": OwnerOverviewPage,
    "operator-rooms-citywide": OperatorRoomsCitywidePage,
    "provider-messages": ProviderMessagesPage,
  };

// ── Page Renderer ──
export default function PageRenderer() {
  const currentPage = useAppStore((s) => s.currentPage);
  const currentUser = useAppStore((s) => s.currentUser);
  const subscription = useAppStore((s) => s.subscription);
  const setSubscription = useAppStore((s) => s.setSubscription);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const jointLoginDialogOpen = useAppStore((s) => s.jointLoginDialogOpen);
  const setJointLoginDialogOpen = useAppStore((s) => s.setJointLoginDialogOpen);

  // ── Fetch subscription status for OPERATOR/STAFF (non-dashboard pages) ──
  // Dashboard already includes subscription data, so skip the extra API call there.
  const fetchSubscriptionStatus = useCallback(async () => {
    if (!currentUser) return;
    if (currentUser.role !== "OPERATOR" && currentUser.role !== "STAFF") return;
    // Skip if already loaded (e.g. by dashboard response)
    if (useAppStore.getState().subscription) return;
    // Skip on dashboard — it fetches subscription data itself
    if (currentPage === "dashboard") return;
    try {
      const data = await apiSubscriptionStatus();
      if (data.exempt) return;
      setSubscription(data);
    } catch {
      // Non-critical
    }
  }, [currentUser, setSubscription, currentPage]);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, [fetchSubscriptionStatus]);

  // If on the login page, don't render anything
  if (currentPage === "login") return null;

  // ── Subscription lockout: only manually SUSPENDED by superuser ──
  if (
    subscription &&
    (subscription.status === "SUSPENDED") &&
    currentPage !== "subscription-lockout"
  ) {
    setCurrentPage("subscription-lockout");
    return null;
  }

  // ── Render lockout page for SUSPENDED ──
  if (currentPage === "subscription-lockout" && subscription) {
    return (
      <Suspense fallback={<PageLoader />}>
        {React.createElement(SubscriptionLockoutPage as any, { info: subscription })}
      </Suspense>
    );
  }

  const PageComponent = PAGE_MAP[currentPage];

  if (!PageComponent) {
    return <PageNotFound page={currentPage} />;
  }

  return (
    <>
      {/* Subscription banner for WARNING / EXPIRED */}
      {subscription &&
        (subscription.status === "WARNING" || subscription.status === "EXPIRED") && (
          <div className="p-4 pb-0 md:px-6">
            <SubscriptionBanner
              status={subscription.status}
              daysRemaining={subscription.daysRemaining}
              providerName={subscription.providerName}
              paymentMethod={subscription.paymentMethod}
              paymentInstructions={subscription.paymentInstructions}
              penaltyAmount={subscription.penaltyAmount}
              baseAmount={subscription.baseAmount}
              penaltyPercent={subscription.penaltyPercent}
              currencySymbol={subscription.currencySymbol}
            />
          </div>
        )}
      <JointSessionBanner />
      <Suspense fallback={<PageLoader />}>
        <PageComponent />
      </Suspense>
      <JointLoginDialog
        open={jointLoginDialogOpen}
        onOpenChange={setJointLoginDialogOpen}
      />
      {/* Operator help widget — only show for OPERATOR and STAFF roles.
          Police and SUPERUSER have their own pages. */}
      {currentUser?.role === "OPERATOR" || currentUser?.role === "STAFF" ? (
        <OperatorHelpWidget />
      ) : null}
    </>
  );
}
