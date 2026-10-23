import { useAppStore } from "./store";

export function getHeaders(): Record<string, string> {
  const user = useAppStore.getState().currentUser;
  return {
    "Content-Type": "application/json",
    // Headers are now just for backward compat — server reads JWT from cookie
    ...(user
      ? {
          "x-user-role": user.role,
          "x-provider-id": user.providerId || "",
          "x-user-permissions": JSON.stringify(user.permissions),
          "x-user-police-rank": user.policeRank || "",
          "x-user-name": user.name || "",
        }
      : {}),
  };
}

export async function req(url: string, opts: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetch(url, {
      ...opts,
      headers: { ...getHeaders(), ...opts.headers },
      credentials: "include", // Always include cookies (JWT httpOnly)
      cache: "no-store", // Never cache API responses — always fetch fresh data
      next: { revalidate: 0 }, // Also disable Next.js fetch cache
    });
  } catch (networkErr) {
    // fetch() itself threw — this is a NETWORK-LEVEL failure, not an HTTP
    // error response. Common causes:
    //   - No internet connection (offline)
    //   - Server unreachable (DNS failure, server down, firewall)
    //   - CORS error
    //   - Request blocked by browser extension
    // Browsers throw a TypeError with message "Failed to fetch" in all
    // these cases. Replace it with a user-friendly message so users see
    // actionable guidance instead of a cryptic technical error.
    void networkErr; // suppress unused-var lint
    throw new Error("Failed to fetch data. Please check your internet connection.");
  }
  if (!res.ok) {
    // ── Auth expired detection ──
    // If the server returns 401, the JWT cookie has expired or is invalid.
    // Instead of showing a confusing "Failed to load data" error, redirect
    // the user to the login page with a clear "session expired" message.
    //
    // IMPORTANT: We skip this redirect for AUTH endpoints (/api/auth*),
    // because those return 401 for INVALID CREDENTIALS (not expired
    // sessions). Redirecting to login when the user just typed a wrong
    // password in the Joint Login dialog would log out the primary user
    // and lose their session — the error should be shown in the dialog
    // instead.
    const isAuthEndpoint =
      url.startsWith("/api/auth") ||
      url === "/api/auth" ||
      url.startsWith("/api/auth/");
    if (res.status === 401 && !isAuthEndpoint) {
      // Clear the stored user (forces login screen)
      useAppStore.getState().setCurrentUser(null);
      // If we're on the mobile app, redirect to /m (which shows login)
      // If we're on the web admin, redirect to / (which shows login)
      if (typeof window !== "undefined") {
        const currentPath = window.location.pathname;
        const isMobile = currentPath.startsWith("/m");
        const isPolice = currentPath.startsWith("/police-app");
        // Use sessionStorage to pass a flag to the login page
        try {
          sessionStorage.setItem("ghms_session_expired", "1");
        } catch {}
        // Redirect to the appropriate login page
        if (isMobile) {
          window.location.href = "/m";
        } else if (isPolice) {
          window.location.href = "/police-app";
        } else {
          window.location.href = "/";
        }
      }
      throw new Error("Session expired. Please sign in again.");
    }

    const t = await res.text().catch(() => "");
    // Try to extract a clean error message from JSON response.
    // IMPORTANT: If the body is empty (e.g. Vercel function timeout or
    // unhandled server error), JSON.parse("") throws "Unexpected end of
    // JSON input" — which then becomes the error message shown to the
    // user. That's confusing. Instead, skip parsing when body is empty
    // and throw a clean "Request failed: STATUS" message.
    if (t && t.trim()) {
      try {
        const j = JSON.parse(t);
        if (j.error) throw new Error(j.error);
        if (j.message) throw new Error(j.message);
      } catch (e) {
        if (e instanceof Error && e.message !== t) throw e; // Re-throw our extracted error
      }
      throw new Error(t || `Request failed: ${res.status}`);
    }
    // Empty body — throw a clean status-based error.
    throw new Error(`Request failed: ${res.status}`);
  }
  // ── Robust JSON parse for successful responses ──
  // Some endpoints (e.g. DELETE) return 200 with an empty body. `res.json()`
  // throws "Unexpected end of JSON input" on empty bodies. Handle that
  // gracefully by returning null for empty bodies.
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Body wasn't valid JSON even though status was 200 — return null
    // so callers don't crash.
    return null;
  }
}

// Auth
export const apiAuth = (data: { username: string; password: string }) =>
  req("/api/auth", { method: "POST", body: JSON.stringify(data) });

// Logout — calls server to clear httpOnly cookie
export const apiLogout = async () => {
  try {
    await fetch("/api/auth", {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    // Ignore logout errors
  }
};

// ── Password Reset ────────────────────────────────────────────────────
// Public endpoints — no auth required.

// Request a password reset link by email. Returns the reset URL + token
// in the response (no SMTP integration yet — admin copies the link and
// sends it to the user via SMS/WhatsApp).
export const apiRequestReset = (email: string) =>
  req("/api/auth/reset-request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

// Confirm a password reset by submitting the token + new password.
export const apiConfirmReset = (token: string, password: string) =>
  req("/api/auth/reset-confirm", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });

// ── Joint Session (Concurrent Dual Session) ──
export const apiJointLogin = (data: { username: string; password: string }) =>
  req("/api/auth/joint-login", { method: "POST", body: JSON.stringify(data) });

export const apiJointStatus = () =>
  req("/api/auth/joint-status");

export const apiJointLogout = async () => {
  try {
    await fetch("/api/auth/joint-logout", {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    // Ignore errors
  }
};

// Dashboard
export const apiDashboard = () => req("/api/dashboard");

// Rooms
export const apiGetRooms = async (q?: string, opts?: { availableFrom?: string; availableTo?: string }) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (opts?.availableFrom) params.set("availableFrom", opts.availableFrom);
  if (opts?.availableTo) params.set("availableTo", opts.availableTo);
  const qs = params.toString();
  const res = await req(`/api/rooms${qs ? `?${qs}` : ""}`);
  // API returns { rooms: [...] } — unwrap to array
  if (res && Array.isArray(res.rooms)) return res.rooms;
  return Array.isArray(res) ? res : [];
};
export const apiCreateRoom = (data: Record<string, unknown>) =>
  req("/api/rooms", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateRoom = (id: string, data: Record<string, unknown>) =>
  req(`/api/rooms/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteRoom = (id: string) =>
  req(`/api/rooms/${id}`, { method: "DELETE" });
export const apiUpdateRoomStatus = (id: string, status: string) =>
  req(`/api/rooms/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
export const apiImportRooms = (rooms: Record<string, unknown>[]) =>
  req("/api/rooms", { method: "POST", body: JSON.stringify({ bulk: rooms }) });
export const apiGetRoomAvailability = (roomId: string) =>
  req(`/api/rooms/${roomId}/availability`);

// Guests
export const apiGetGuests = async (q?: string) => {
  // Always fetch all records so frontend can client-side filter/search
  const sep = q ? '&' : '?';
  const res = await req(`/api/guests${q ? `?q=${q}` : ""}${!q ? '?limit=999' : `${sep}limit=999`}`);
  // API returns { guests: [...], total, ... } — unwrap to array
  if (res && Array.isArray(res.guests)) return res.guests;
  return Array.isArray(res) ? res : [];
};
export const apiCreateGuest = (data: Record<string, unknown>) =>
  req("/api/guests", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateGuest = (id: string, data: Record<string, unknown>) =>
  req(`/api/guests/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteGuest = (id: string) =>
  req(`/api/guests/${id}`, { method: "DELETE" });

// Guest lifecycle — full status-change history for a guest across all
// their reservations (check-ins, check-outs, early exits, cancellations,
// extensions, room shifts, payments). Used by the guest search table
// to surface "what happened to this guest" beyond the current status.
export const apiGetGuestLifecycle = (id: string) =>
  req(`/api/guests/${id}/lifecycle`);

// Reservations
export const apiGetReservations = async (q?: string) => {
  // Always fetch all records (limit=999) so frontend can client-side filter
  const sep = q ? '&' : '?';
  const res = await req(`/api/reservations${q ? `?${q}` : ""}${!q ? '?limit=999' : `${sep}limit=999`}`);
  // API returns { data: [...], total, ... } — unwrap to array
  if (res && Array.isArray(res.data)) return res.data;
  return Array.isArray(res) ? res : [];
};
export const apiCreateReservation = (data: Record<string, unknown>) =>
  req("/api/reservations", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateReservation = (id: string, data: Record<string, unknown>) =>
  req(`/api/reservations/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteReservation = (id: string) =>
  req(`/api/reservations/${id}`, { method: "DELETE" });
export const apiCheckin = (id: string) =>
  req(`/api/reservations/${id}/checkin`, { method: "POST" });
export const apiCheckout = (id: string, data?: Record<string, unknown>) =>
  req(`/api/reservations/${id}/checkout`, { method: "POST", body: JSON.stringify(data || {}) });
export const apiCancelReservation = (id: string) =>
  req(`/api/reservations/${id}/cancel`, { method: "POST" });

/**
 * Apply one action to many reservations in a single API call.
 * action: "checkin" | "checkout" | "cancel"
 * ids: array of reservation IDs to act on
 *
 * Returns: { action, total, successCount, skippedCount, failedCount, results }
 *
 * "checkout" covers BOTH "Check Out" (when checkout date is due) and
 * "Early Check Out" (any ACTIVE). The client decides which label to
 * show based on isCheckoutDue(res.checkOut); the server treats them
 * identically.
 */
export const apiBulkReservationAction = (ids: string[], action: "checkin" | "checkout" | "cancel") =>
  req("/api/reservations/bulk-action", {
    method: "POST",
    body: JSON.stringify({ ids, action }),
  });

// Payments
export const apiCreatePayment = (data: Record<string, unknown>) =>
  req("/api/payments", { method: "POST", body: JSON.stringify(data) });

// Expenses
export const apiGetExpenses = (q?: string) => req(`/api/expenses${q ? `?${q}` : ""}`);
export const apiCreateExpense = (data: Record<string, unknown>) =>
  req("/api/expenses", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateExpense = (id: string, data: Record<string, unknown>) =>
  req(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteExpense = (id: string) =>
  req(`/api/expenses/${id}`, { method: "DELETE" });

// Expense Categories
export const apiGetExpenseCategories = () => req("/api/expense-categories");
export const apiCreateExpenseCategory = (data: Record<string, unknown>) =>
  req("/api/expense-categories", { method: "POST", body: JSON.stringify(data) });
export const apiDeleteExpenseCategory = (id: string) =>
  req(`/api/expense-categories/${id}`, { method: "DELETE" });

// Resources
export const apiGetResources = (q?: string) => req(`/api/resources${q ? `?q=${q}` : ""}`);
export const apiCreateResource = (data: Record<string, unknown>) =>
  req("/api/resources", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateResource = (id: string, data: Record<string, unknown>) =>
  req(`/api/resources/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteResource = (id: string) =>
  req(`/api/resources/${id}`, { method: "DELETE" });
export const apiRestockResource = (id: string, qty: number) =>
  req(`/api/resources/${id}/restock`, { method: "POST", body: JSON.stringify({ quantity: qty }) });
export const apiGetStockMovements = (id: string, limit = 50, offset = 0) =>
  req(`/api/resources/${id}/movements?limit=${limit}&offset=${offset}`);

// Housekeeping
export const apiGetHousekeeping = (q?: string) => req(`/api/housekeeping${q ? `?${q}` : ""}`);
export const apiCreateHousekeeping = (data: Record<string, unknown>) =>
  req("/api/housekeeping", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateHousekeeping = (id: string, data: Record<string, unknown>) =>
  req(`/api/housekeeping/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteHousekeeping = (id: string) =>
  req(`/api/housekeeping/${id}`, { method: "DELETE" });

// Users
export const apiGetUsers = () => req("/api/users");
export const apiCreateUser = (data: Record<string, unknown>) =>
  req("/api/users", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateUser = (id: string, data: Record<string, unknown>) =>
  req(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteUser = (id: string) =>
  req(`/api/users/${id}`, { method: "DELETE" });

// Settings
export const apiGetSettings = () => req("/api/settings");
export const apiUpdateSettings = (data: Record<string, unknown>) =>
  req("/api/settings", { method: "PUT", body: JSON.stringify(data) });

// Notifications
export const apiGetNotifications = () => req("/api/notifications");
export const apiCreateNotification = (data: Record<string, unknown>) =>
  req("/api/notifications", { method: "POST", body: JSON.stringify(data) });
export const apiMarkNotificationRead = (id: string) =>
  req(`/api/notifications/${id}`, { method: "PUT", body: JSON.stringify({ isRead: true }) });

// Activity
export const apiGetActivity = () => req("/api/activity");

// Reports
export const apiGetReports = (q?: string) => req(`/api/reports${q ? `?${q}` : ""}`);

// Data export/import
export const apiExportData = () => req("/api/data");
export const apiImportData = (data: Record<string, unknown>) =>
  req("/api/data", { method: "POST", body: JSON.stringify(data) });

// Providers (Police)
export const apiGetProviders = () => req("/api/providers");
export const apiUpdateProvider = (id: string, data: Record<string, unknown>) =>
  req(`/api/providers/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteProvider = (id: string) =>
  req(`/api/providers/${id}`, { method: "DELETE" });

// Provider's own organization info (operator-facing)
export const apiGetMyProvider = () => req("/api/providers/me");
export const apiUpdateMyProvider = (data: Record<string, unknown>) =>
  req("/api/providers/me", { method: "PATCH", body: JSON.stringify(data) });

export const apiRegisterProvider = async (data: FormData) => {
  const res = await fetch("/api/providers", { method: "POST", body: data, credentials: "include" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Registration failed: ${res.status}`);
  }
  return json;
};

// Police
export const apiPoliceDashboard = () => req("/api/police-dashboard");
export const apiPoliceActiveReservations = (limit = 500) =>
  req(`/api/police-dashboard/active-reservations?limit=${limit}`);
export const apiPoliceGuests = (params?: { q?: string; page?: number; pageSize?: number }) => {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const qs = sp.toString();
  return req(`/api/police-guests${qs ? `?${qs}` : ""}`);
};
export const apiPoliceOfficers = () => req("/api/police-officers");
export const apiPoliceCreateOfficer = (data: Record<string, unknown>) =>
  req("/api/police-officers", { method: "POST", body: JSON.stringify(data) });
export const apiPoliceUpdateOfficer = (data: Record<string, unknown>) =>
  req("/api/police-officers", { method: "PUT", body: JSON.stringify(data) });
export const apiPoliceDeleteOfficer = (id: string) =>
  req(`/api/police-officers?id=${id}`, { method: "DELETE" });

// Suspected Persons (Police only)
export const apiGetSuspectedPersons = (params?: { q?: string; severity?: string; active?: string; page?: number; pageSize?: number }) => {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.severity) sp.set("severity", params.severity);
  if (params?.active !== undefined) sp.set("active", params.active);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const qs = sp.toString();
  return req(`/api/suspected-persons${qs ? `?${qs}` : ""}`);
};
export const apiCreateSuspectedPerson = (data: Record<string, unknown>) =>
  req("/api/suspected-persons", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateSuspectedPerson = (id: string, data: Record<string, unknown>) =>
  req(`/api/suspected-persons/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteSuspectedPerson = (id: string) =>
  req(`/api/suspected-persons/${id}`, { method: "DELETE" });

// Suspect Matches / Alerts (Police only)
export const apiGetSuspectMatches = (q?: string) => req(`/api/suspect-matches${q ? `?${q}` : ""}`);
export const apiMarkMatchesRead = (data: Record<string, unknown>) =>
  req("/api/suspect-matches", { method: "PUT", body: JSON.stringify(data) });

// Daytime
export const apiGetDaytimeServices = () => req("/api/daytime-services");
export const apiCreateDaytimeService = (data: Record<string, unknown>) =>
  req("/api/daytime-services", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateDaytimeService = (id: string, data: Record<string, unknown>) =>
  req(`/api/daytime-services/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteDaytimeService = (id: string) =>
  req(`/api/daytime-services/${id}`, { method: "DELETE" });
export const apiGetDaytimeBookings = async (q?: string) => {
  const res = await req(`/api/daytime-bookings${q ? `?${q}` : ""}`);
  // API returns a paginated envelope { data: [...], total, page, limit, totalPages }
  // — extract the .data array so the frontend gets a plain array (same
  // shape as apiGetDaytimeServices). Without this extraction, the
  // frontend's Array.isArray() check fails and the bookings list is
  // always empty even though records exist in the DB.
  if (res && Array.isArray(res.data)) return res.data;
  return Array.isArray(res) ? res : [];
};
export const apiCreateDaytimeBooking = (data: Record<string, unknown>) =>
  req("/api/daytime-bookings", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateDaytimeBooking = (id: string, data: Record<string, unknown>) =>
  req(`/api/daytime-bookings/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteDaytimeBooking = (id: string) =>
  req(`/api/daytime-bookings/${id}`, { method: "DELETE" });

// ── Daytime Room Bookings (time-based, max 12 hours) ──
export const apiGetDaytimeRoomBookings = async (q?: string) => {
  const res = await req(`/api/daytime-room-bookings${q ? `?${q}` : ""}`);
  if (res && Array.isArray(res.data)) return res.data;
  return Array.isArray(res) ? res : [];
};
export const apiCreateDaytimeRoomBooking = (data: Record<string, unknown>) =>
  req("/api/daytime-room-bookings", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateDaytimeRoomBooking = (id: string, data: Record<string, unknown>) =>
  req(`/api/daytime-room-bookings/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteDaytimeRoomBooking = (id: string) =>
  req(`/api/daytime-room-bookings/${id}`, { method: "DELETE" });

// Reviews
export const apiGetReviews = (q?: string) => req(`/api/reviews${q ? `?${q}` : ""}`);
export const apiCreateReview = (data: Record<string, unknown>) =>
  req("/api/reviews", { method: "POST", body: JSON.stringify(data) });
export const apiDeleteReview = (id: string) =>
  req(`/api/reviews/${id}`, { method: "DELETE" });

// Owner Accounts (SUPERUSER: manage provider/owner credentials only)
export const apiGetOwnerAccounts = () => req("/api/owner-accounts");
export const apiUpdateOwnerAccount = (id: string, data: Record<string, unknown>) =>
  req(`/api/owner-accounts/${id}`, { method: "PUT", body: JSON.stringify(data) });

// Police Intelligence & Investigation
export const apiPoliceIntelligence = () => req("/api/police-intelligence");
export const apiPoliceMovement = (q: string) => req(`/api/police-intelligence/movement?${q}`);
export const apiPoliceFrequentStays = (q?: string) => req(`/api/police-intelligence/frequent-stays${q ? `?${q}` : ""}`);
export const apiPoliceTriggerFrequentAnalysis = () => req("/api/police-intelligence/frequent-stays", { method: "POST" });
export const apiPoliceGuestLinking = (params?: { page?: number; pageSize?: number }) => {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const qs = sp.toString();
  return req(`/api/police-intelligence/linking${qs ? `?${qs}` : ""}`);
};
export const apiPoliceAuditLogs = (q?: string) => req(`/api/police-audit${q ? `?${q}` : ""}`);
export const apiPoliceGeofences = () => req("/api/police-geofences");
export const apiPoliceCreateGeofence = (data: Record<string, unknown>) => req("/api/police-geofences", { method: "POST", body: JSON.stringify(data) });
export const apiPoliceDeleteGeofence = (id: string) => req(`/api/police-geofences?id=${id}`, { method: "DELETE" });
export const apiPoliceAlertConfig = () => req("/api/police-alert-config");
export const apiPoliceUpdateAlertConfig = (data: Record<string, unknown>) => req("/api/police-alert-config", { method: "PUT", body: JSON.stringify(data) });
export const apiPoliceExport = (q: string) => req(`/api/police-export?${q}`);

// Police Reports (interactive data)
export const apiPoliceReports = (params?: { period?: string; date?: string; providerId?: string }) => {
  const sp = new URLSearchParams();
  if (params?.period) sp.set("period", params.period);
  if (params?.date) sp.set("date", params.date);
  if (params?.providerId) sp.set("providerId", params.providerId);
  const qs = sp.toString();
  return req(`/api/police-reports${qs ? `?${qs}` : ""}`);
};

// Police Report (HTML)
export const apiPoliceReport = (month: number, year: number) =>
  fetch(`/api/police-report?month=${month}&year=${year}`, { headers: { ...getHeaders() }, credentials: "include" }).then(async (res) => {
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || `Report generation failed: ${res.status}`);
    }
    return res.text();
  });


// ── Subscriptions (SUPERUSER) ──
export const apiGetSubscriptions = (statusFilter?: string) =>
  req(`/api/subscriptions${statusFilter ? `?status=${statusFilter}` : ""}`);
export const apiUpdateSubscription = (id: string, data: Record<string, unknown>) =>
  req(`/api/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiMarkPayment = (id: string, data: Record<string, unknown>) =>
  req(`/api/subscriptions/${id}/pay`, { method: "POST", body: JSON.stringify(data) });
export const apiGetSubscriptionPayments = (subscriptionId: string) =>
  req(`/api/subscriptions/payments?subscriptionId=${subscriptionId}`);
export const apiVerifyPayment = (paymentId: string, data: { action: "approve" | "reject"; reason?: string }) =>
  req(`/api/subscriptions/payments/${paymentId}/verify`, { method: "POST", body: JSON.stringify(data) });

// Subscription status (provider side)
export const apiSubscriptionStatus = () => req("/api/subscription/status");
export const apiMySubscription = () => req("/api/my-subscription");
export const apiSubmitPayment = (data: Record<string, unknown>) =>
  req("/api/my-subscription", { method: "POST", body: JSON.stringify(data) });

// Chapa Payment (provider side)
export const apiInitiateChapaPayment = (data: { cycle: string; amount: number; planId: string }) =>
  req("/api/my-subscription/pay/chapa", { method: "POST", body: JSON.stringify(data) });
export const apiChapaClientVerify = () =>
  req("/api/my-subscription/pay/chapa/verify", { method: "POST", body: JSON.stringify({}) });

// Subscription Plans (SUPERUSER)
export const apiGetPlans = () => req("/api/subscription-plans");
export const apiCreatePlan = (data: { name: string; cycle: string; price: number }) =>
  req("/api/subscription-plans", { method: "POST", body: JSON.stringify(data) });
export const apiUpdatePlan = (id: string, data: Record<string, unknown>) =>
  req(`/api/subscription-plans/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeletePlan = (id: string) =>
  req(`/api/subscription-plans/${id}`, { method: "DELETE" });

// Anomalies (Smart Detection)
export const apiGetAnomalies = (q?: string) => req(`/api/anomalies${q ? `?${q}` : ""}`);
export const apiReviewAnomalies = (ids: string[]) =>
  req("/api/anomalies", { method: "POST", body: JSON.stringify({ action: "review", ids }) });
export const apiTriggerAnomalyScan = () =>
  req("/api/anomalies", { method: "POST", body: JSON.stringify({ action: "scan" }) });
export const apiToggleAnomalyDetection = (enabled: boolean) =>
  req("/api/anomalies", { method: "POST", body: JSON.stringify({ action: "toggle", enabled }) });

// Police room availability (city-wide)
export const apiPoliceRoomAvailability = () => req("/api/police-room-availability");

// Operator room availability (city-wide) — gated behind the multiProviderRooms
// feature flag. Returns 403 if the flag is OFF.
export const apiOperatorRoomAvailability = () => req("/api/operator-room-availability");

// Provider-to-provider messaging (in-app chat between guesthouse operators)
export const apiGetProviderConversations = () => req("/api/provider-messages");
export const apiGetProviderThread = (withProviderId: string) =>
  req(`/api/provider-messages?with=${withProviderId}`);
export const apiSendProviderMessage = (toProviderId: string, message: string) =>
  req("/api/provider-messages", { method: "POST", body: JSON.stringify({ toProviderId, message }) });

// Get unread provider message count (for sidebar badge polling)
export const apiGetUnreadProviderMessages = async (): Promise<number> => {
  try {
    const res = await req("/api/provider-messages?unread=true");
    return Number(res?.unreadCount) || 0;
  } catch {
    return 0;
  }
};

// Police suspend provider (with reason + notification to provider)
export const apiPoliceSuspendProvider = (data: Record<string, unknown>) =>
  req("/api/police-suspend-provider", { method: "POST", body: JSON.stringify(data) });

// ── Superuser User Management ──
export const apiSuperGetUsers = (params?: {
  search?: string;
  role?: string;
  providerId?: string;
  page?: number;
  pageSize?: number;
}) => {
  const sp = new URLSearchParams();
  if (params?.search) sp.set("search", params.search);
  if (params?.role) sp.set("role", params.role);
  if (params?.providerId) sp.set("providerId", params.providerId);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const qs = sp.toString();
  return req(`/api/superuser/users${qs ? `?${qs}` : ""}`);
};
export const apiSuperGetUser = (id: string) =>
  req(`/api/superuser/users/${id}`);
export const apiSuperCreateUser = (data: Record<string, unknown>) =>
  req("/api/superuser/users", { method: "POST", body: JSON.stringify(data) });
export const apiSuperUpdateUser = (id: string, data: Record<string, unknown>) =>
  req(`/api/superuser/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiSuperDeleteUser = (id: string) =>
  req(`/api/superuser/users/${id}`, { method: "DELETE" });

// ── Superuser Profile ──
export const apiSuperGetProfile = () =>
  req("/api/superuser/users");
export const apiSuperUpdateProfile = (id: string, data: Record<string, unknown>) =>
  req(`/api/superuser/users/${id}`, { method: "PUT", body: JSON.stringify(data) });

// ── Superuser: list providers for dropdown ──
export const apiSuperGetProviders = () =>
  req("/api/providers");

// ── Superuser: create guesthouse (auto-approved) ──
export const apiSuperCreateProvider = (data: Record<string, unknown>) =>
  req("/api/providers", { method: "POST", body: JSON.stringify(data) });

// ── Superuser: bulk import guesthouses ──
export const apiSuperBulkImportProviders = (records: Record<string, string>[]) =>
  req("/api/providers/bulk-import", { method: "POST", body: JSON.stringify({ records }) });

// ── Group Bookings ──
export const apiGetGroupBookings = (params?: string) =>
  req(`/api/group-bookings${params ? `?${params}` : ""}`);
export const apiCreateGroupBooking = (data: Record<string, unknown>) =>
  req("/api/group-bookings", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateGroupBooking = (id: string, data: Record<string, unknown>) =>
  req(`/api/group-bookings/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteGroupBooking = (id: string) =>
  req(`/api/group-bookings/${id}`, { method: "DELETE" });
export const apiAutoAssignGroup = (id: string, guestIds?: string[]) =>
  req(`/api/group-bookings/${id}/auto-assign`, { method: "POST", body: JSON.stringify({ guestIds: guestIds || [] }) });
export const apiGroupCheckout = (id: string) =>
  req(`/api/group-bookings/${id}/checkout`, { method: "POST" });
export const apiGroupPayment = (id: string, data: Record<string, unknown>) =>
  req(`/api/group-bookings/${id}/payment`, { method: "POST", body: JSON.stringify(data) });

// ── Staff Logs ──
export const apiGetStaffLogs = (params?: string) =>
  req(`/api/staff-logs${params ? `?${params}` : ""}`);

// ── Tasks (formal staff work assignments) ──
export const apiGetTasks = (params?: string) =>
  req(`/api/tasks${params ? `?${params}` : ""}`);
export const apiCreateTask = (data: Record<string, unknown>) =>
  req("/api/tasks", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateTask = (id: string, data: Record<string, unknown>) =>
  req(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const apiDeleteTask = (id: string) =>
  req(`/api/tasks/${id}`, { method: "DELETE" });
export const apiGetStaffPerformance = () =>
  req("/api/tasks/performance");

// ── Notification Broadcast (Police / Admin) ──
export const apiGetBroadcastProviders = () =>
  req("/api/messages/broadcast");
export const apiSendBroadcast = (data: Record<string, unknown>) =>
  req("/api/notifications/broadcast", { method: "POST", body: JSON.stringify(data) });
export const apiGetBroadcastHistory = (params?: string) =>
  req(`/api/notifications/broadcast${params ? `?${params}` : ""}`);

// ── Messages ──
export const apiGetMessageTemplates = () =>
  req("/api/messages/templates");
export const apiCreateMessageTemplate = (data: Record<string, unknown>) =>
  req("/api/messages/templates", { method: "POST", body: JSON.stringify(data) });
export const apiUpdateMessageTemplate = (id: string, data: Record<string, unknown>) =>
  req(`/api/messages/templates/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const apiDeleteMessageTemplate = (id: string) =>
  req(`/api/messages/templates/${id}`, { method: "DELETE" });
export const apiSendMessage = (data: Record<string, unknown>) =>
  req("/api/messages/send", { method: "POST", body: JSON.stringify(data) });
export const apiBulkSendMessages = (data: Record<string, unknown>) =>
  req("/api/messages/bulk-send", { method: "POST", body: JSON.stringify(data) });
export const apiGetMessageLogs = (params?: string) =>
  req(`/api/messages/logs${params ? `?${params}` : ""}`);

// Operator Features (SUPERUSER manages which pages OPERATOR/STAFF see)
export const apiGetOperatorFeatures = () => req("/api/operator-features");
export const apiUpdateOperatorFeatures = (disabledPages: string[]) =>
  req("/api/operator-features", { method: "PUT", body: JSON.stringify({ disabledPages }) });
export const apiGetDisabledPages = async (): Promise<string[]> => {
  try {
    const res = await req("/api/operator-features");
    return Array.isArray(res?.disabledPages) ? res.disabledPages : [];
  } catch {
    return [];
  }
};

// Owner Visibility & Operational Control feature flags.
// Returns the full flag map { ownerDashboard, endOfDayReport, shiftHandover,
// maintenanceTickets, multiProviderRooms }. Used by the frontend to conditionally render the
// owner dashboard enhancements, EoD report, shift handover, and maintenance
// tickets — based on which features the system admin has enabled.
export const apiGetOwnerFeatureFlags = async (): Promise<Record<string, boolean>> => {
  try {
    const res = await req("/api/operator-features");
    if (res?.ownerFeatureFlags && typeof res.ownerFeatureFlags === "object") {
      return res.ownerFeatureFlags as Record<string, boolean>;
    }
    // Default: most features enabled, multiProviderRooms OFF (opt-in)
    return { ownerDashboard: true, endOfDayReport: true, shiftHandover: true, maintenanceTickets: true, multiProviderRooms: false };
  } catch {
    return { ownerDashboard: true, endOfDayReport: true, shiftHandover: true, maintenanceTickets: true, multiProviderRooms: false };
  }
};
export const apiUpdateOwnerFeatureFlags = (flags: Record<string, boolean>) =>
  req("/api/operator-features", { method: "PUT", body: JSON.stringify({ ownerFeatureFlags: flags }) });

// ── Owner Visibility: End-of-Day Report + Cash Reconciliation ──
// GET returns the report for a date (or a draft built from live data).
// POST signs off the report (persists countedCash, computes discrepancy).
export const apiGetEodReport = (date?: string) =>
  req(`/api/owner-eod${date ? `?date=${date}` : ""}`);
export const apiSignOffEod = (data: { reportDate: string; countedCash: number; notes?: string }) =>
  req("/api/owner-eod", { method: "POST", body: JSON.stringify(data) });

// ── Operational Control: Shift Handover ──
// GET returns { current: ShiftHandover | null, history: ShiftHandover[] }.
// POST with action='start' opens a new shift; action='end' closes it.
export const apiGetShiftHandover = () => req("/api/shift-handover");
export const apiShiftAction = (data: {
  action: "start" | "end";
  shiftType?: string;
  openingCash?: number;
  closingCash?: number;
  handoverNotes?: string;
}) => req("/api/shift-handover", { method: "POST", body: JSON.stringify(data) });
