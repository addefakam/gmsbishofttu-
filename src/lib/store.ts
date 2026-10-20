import { create } from "zustand";

const STORAGE_KEY = "ghms_session";

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: string;
  providerId: string | null;
  permissions: string[];
  policeRank: string;
  providerName?: string;
  // Police jurisdiction
  jurisdictionType?: string;
  subCity?: string | null;
  woreda?: string | null;
}

interface PreselectedRoom {
  id: string;
  number: string;
  name: string;
  type: string;
  pricePerNight: number;
  /**
   * Distinguishes the user's intent when navigating to the reservations page
   * with a preselected room:
   * - "create": user clicked "Reserve" on an available room → auto-open the
   *   new-reservation dialog with that room prefilled.
   * - "manage": user clicked "Manage Reservations" on an already-reserved
   *   room → just highlight the matching reservations; do NOT auto-open the
   *   create dialog.
   * Defaults to "create" when omitted.
   */
  intent?: "create" | "manage";
  /**
   * Optional preselected guest ID — when the user clicks "Reserve" next to
   * a specific guest in the AccommodationGuestsPage, this is set so the
   * Reservations page can pre-select that guest in the New Reservation
   * dialog's "Existing Guest" tab.
   */
  guestId?: string;
  guestName?: string;
}

export interface SubscriptionInfo {
  status: "ACTIVE" | "WARNING" | "EXPIRED" | "SUSPENDED" | "NONE";
  daysRemaining: number;
  endDate: string;
  cycle: string;
  price: number;
  providerName: string;
  ownerName: string;
  phone: string;
  currencySymbol?: string;
  paymentMethod?: string;
  paymentInstructions?: string;
  penaltyAmount?: number;
  penaltyPercent?: number;
  baseAmount?: number;
}

export interface JointSessionInfo {
  active: boolean;
  superuser: { id: string; username: string; name: string } | null;
  policeAdmin: { id: string; username: string; name: string; rank: string } | null;
}

interface AppState {
  currentPage: string;
  setCurrentPage: (p: string) => void;
  currentUser: CurrentUser | null;
  setCurrentUser: (u: CurrentUser | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (o: boolean) => void;
  refreshKey: number;
  triggerRefresh: () => void;
  preselectedRoom: PreselectedRoom | null;
  setPreselectedRoom: (r: PreselectedRoom | null) => void;
  // Provider-to-provider chat: when the user clicks "Contact" on a provider
  // card in the All Guesthouses page, we store the provider ID here so the
  // Provider Messages page can open that conversation automatically.
  preselectedChatProvider: string | null;
  setPreselectedChatProvider: (id: string | null) => void;
  // Unread provider message count — polled by the sidebar every 30s to
  // show a badge on the "Provider Chat" nav item.
  unreadProviderMessages: number;
  setUnreadProviderMessages: (n: number) => void;
  /** Which tab the Accommodation page should open on. */
  accommodationTab: "rooms" | "reservations" | "group-bookings";
  setAccommodationTab: (t: "rooms" | "reservations" | "group-bookings") => void;
  // Joint session state (Concurrent Dual Session)
  jointSession: JointSessionInfo;
  setJointSession: (info: JointSessionInfo) => void;
  jointLoginDialogOpen: boolean;
  setJointLoginDialogOpen: (open: boolean) => void;
  // Subscription state
  subscription: SubscriptionInfo | null;
  setSubscription: (info: SubscriptionInfo | null) => void;
  // Operator features: pages disabled by SUPERUSER (global). null = not yet loaded.
  disabledPages: string[] | null;
  setDisabledPages: (pages: string[]) => void;
  // Owner Visibility & Operational Control feature flags.
  // Each flag controls whether the corresponding feature is rendered in the UI.
  // null = not yet loaded; once loaded, all 4 keys are guaranteed present
  // (defaults filled in by the backend).
  ownerFeatureFlags: Record<string, boolean> | null;
  setOwnerFeatureFlags: (flags: Record<string, boolean>) => void;
}

// ── localStorage helpers (SSR-safe) ──
function loadSession(): {
  currentUser: CurrentUser | null;
  currentPage: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.currentUser) {
      // Ensure required fields are present (may be missing from old/corrupted sessions)
      if (!data.currentUser.name) data.currentUser.name = "User";
      if (!data.currentUser.username) data.currentUser.username = "";
      if (!data.currentUser.role) data.currentUser.role = "STAFF";
      if (data.currentUser.policeRank === undefined) {
        data.currentUser.policeRank = "";
      }
      if (!Array.isArray(data.currentUser.permissions)) {
        data.currentUser.permissions = [];
      }
      // Migration: SUPERUSER with providerId should not land on super-admin-dashboard
      if (data.currentUser.role === "SUPERUSER" && data.currentUser.providerId && data.currentPage === "super-admin-dashboard") {
        data.currentPage = "dashboard";
      }
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function persistSession(user: CurrentUser | null, page?: string) {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          currentUser: user,
          currentPage: page || useAppStore.getState().currentPage,
        }),
      );
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage may be full or blocked — silently ignore
  }
}

// ── Load persisted session at store creation (runs once on client) ──
const initialSession = loadSession();

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: initialSession?.currentPage || "login",
  setCurrentPage: (p) => {
    const user = get().currentUser;
    if (user) {
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ currentUser: user, currentPage: p }),
          );
        } catch {}
      }
    }
    set({ currentPage: p });
  },
  currentUser: initialSession?.currentUser ?? null,
  setCurrentUser: (u) => {
    persistSession(u);
    if (!u) {
      set({ currentUser: null, currentPage: "login", jointSession: { active: false, superuser: null, policeAdmin: null } });
    } else {
      set({ currentUser: u });
    }
  },
  sidebarOpen: true,
  setSidebarOpen: (o) => set({ sidebarOpen: o }),
  refreshKey: 0,
  triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  preselectedRoom: null,
  setPreselectedRoom: (r) => set({ preselectedRoom: r }),
  preselectedChatProvider: null,
  setPreselectedChatProvider: (id) => set({ preselectedChatProvider: id }),
  unreadProviderMessages: 0,
  setUnreadProviderMessages: (n) => set({ unreadProviderMessages: n }),
  accommodationTab: "rooms",
  setAccommodationTab: (t) => set({ accommodationTab: t }),
  // Joint session (Concurrent Dual Session)
  jointSession: { active: false, superuser: null, policeAdmin: null },
  setJointSession: (info) => set({ jointSession: info }),
  jointLoginDialogOpen: false,
  setJointLoginDialogOpen: (open) => set({ jointLoginDialogOpen: open }),
  // Subscription
  subscription: null as SubscriptionInfo | null,
  setSubscription: (info) => set({ subscription: info }),
  // Operator features (null = not yet fetched from server)
  disabledPages: null,
  setDisabledPages: (pages) => set({ disabledPages: pages }),
  ownerFeatureFlags: null,
  setOwnerFeatureFlags: (flags) => set({ ownerFeatureFlags: flags }),
}));
