/**
 * GMS API Client SDK
 * ==================
 *
 * Copy this file into the TMS project (e.g. src/lib/gms-client.ts).
 * It provides functions to fetch accommodation data from the GMS.
 *
 * Setup:
 *   1. Set environment variables in the TMS:
 *      GMS_API_URL=https://guesthousewithpolicemodule-ghjo-k4f2dpooj.vercel.app
 *      GMS_API_KEY=ghms_live_xxxxxxxxxxxxxxxxxxxxxxxx
 *
 *   2. Import and use:
 *      import { getProviders, getRooms, checkAvailability } from '@/lib/gms-client';
 *      const hotels = await getProviders();
 */

// ── Configuration ────────────────────────────────────────────────────

const GMS_API_URL = process.env.GMS_API_URL || "";
const GMS_API_KEY = process.env.GMS_API_KEY || "";

// ── Types ────────────────────────────────────────────────────────────

export interface GmsProvider {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  subCity?: string;
  woreda?: string;
  type?: string;
  latitude?: number;
  longitude?: number;
  bedCount?: number;
  status?: string;
}

export interface GmsRoom {
  id: string;
  number: string;
  name: string;
  type: string;
  pricePerNight: number;
  pricePerNightWeekend?: number;
  capacity: number;
  floor: number;
  amenities: string;
  description: string;
  image?: string;
  status: string;
  available?: boolean;
  provider?: {
    id: string;
    name: string;
    phone?: string;
  };
}

export interface GmsReservation {
  id: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  totalCost: number;
  paymentStatus: string;
}

export interface GmsGuest {
  id: string;
  name: string;
  phone?: string;
  nationality?: string;
  vip?: boolean;
}

export interface GmsPaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta?: {
    requestId: string;
    timestamp: string;
    responseTimeMs: number;
  };
}

// ── Internal fetch helper ────────────────────────────────────────────

async function gmsFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  if (!GMS_API_URL || !GMS_API_KEY) {
    throw new Error("GMS not configured. Set GMS_API_URL and GMS_API_KEY environment variables.");
  }

  const url = new URL(`${GMS_API_URL}/api/v1${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": GMS_API_KEY,
      "Accept": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error("GMS API key is invalid or revoked. Check GMS_API_KEY.");
    }
    if (res.status === 403) {
      throw new Error("GMS API key doesn't have permission for this data.");
    }
    if (res.status === 429) {
      throw new Error("GMS API rate limit exceeded. Try again later.");
    }
    throw new Error(`GMS API error (${res.status}): ${text || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ── Public API Functions ─────────────────────────────────────────────

/**
 * Test the GMS connection — verifies the API key works.
 * Call this from the admin settings page.
 */
export async function testGmsConnection(): Promise<{
  connected: boolean;
  integrationName?: string;
  scopes?: string[];
  error?: string;
}> {
  try {
    const res = await gmsFetch<{ success: boolean; data: { status: string; integration: { name: string; scopes: string[] } } }>("/health");
    return {
      connected: true,
      integrationName: res.data?.integration?.name,
      scopes: res.data?.integration?.scopes,
    };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/**
 * Get all approved guesthouses (hotels/resorts/guest houses).
 */
export async function getProviders(opts?: {
  page?: number;
  limit?: number;
  subCity?: string;
  type?: string;
  search?: string;
}): Promise<GmsPaginatedResponse<GmsProvider>> {
  return gmsFetch("/providers", {
    page: String(opts?.page || 1),
    limit: String(opts?.limit || 50),
    subCity: opts?.subCity || "",
    type: opts?.type || "",
    q: opts?.search || "",
  });
}

/**
 * Get a single guesthouse by ID.
 */
export async function getProviderById(id: string): Promise<{ success: boolean; data: GmsProvider }> {
  return gmsFetch(`/providers/${id}`);
}

/**
 * Get rooms for a specific guesthouse (or all guesthouses).
 */
export async function getRooms(opts?: {
  providerId?: string;
  type?: string;
  minPrice?: string;
  maxPrice?: string;
  available?: boolean;
  checkIn?: string;
  checkOut?: string;
  page?: number;
  limit?: number;
}): Promise<GmsPaginatedResponse<GmsRoom>> {
  return gmsFetch("/rooms", {
    providerId: opts?.providerId || "",
    type: opts?.type || "",
    minPrice: opts?.minPrice || "",
    maxPrice: opts?.maxPrice || "",
    available: opts?.available ? "true" : "",
    checkIn: opts?.checkIn || "",
    checkOut: opts?.checkOut || "",
    page: String(opts?.page || 1),
    limit: String(opts?.limit || 50),
  });
}

/**
 * Get a single room by ID.
 */
export async function getRoomById(id: string): Promise<{ success: boolean; data: GmsRoom }> {
  return gmsFetch(`/rooms/${id}`);
}

/**
 * Check room availability for a date range across ALL guesthouses.
 * Returns only rooms that are available (no overlapping reservations).
 */
export async function checkAvailability(opts: {
  checkIn: string;  // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  providerId?: string;
  type?: string;
}): Promise<GmsPaginatedResponse<GmsRoom>> {
  return gmsFetch("/rooms/available", {
    checkIn: opts.checkIn,
    checkOut: opts.checkOut,
    providerId: opts.providerId || "",
    type: opts.type || "",
  });
}

/**
 * Get reservations (if the GMS admin authorized this scope).
 */
export async function getReservations(opts?: {
  status?: string;
  providerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}): Promise<GmsPaginatedResponse<GmsReservation>> {
  return gmsFetch("/reservations", {
    status: opts?.status || "",
    providerId: opts?.providerId || "",
    dateFrom: opts?.dateFrom || "",
    dateTo: opts?.dateTo || "",
    page: String(opts?.page || 1),
    limit: String(opts?.limit || 50),
  });
}

/**
 * Get guests (if the GMS admin authorized this scope).
 * Only fields the GMS admin explicitly authorized will be returned.
 */
export async function getGuests(opts?: {
  nationality?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<GmsPaginatedResponse<GmsGuest>> {
  return gmsFetch("/guests", {
    nationality: opts?.nationality || "",
    q: opts?.search || "",
    page: String(opts?.page || 1),
    limit: String(opts?.limit || 50),
  });
}

// ── Configuration helpers (for admin settings page) ──────────────────

/**
 * Check if the GMS is configured (env vars set).
 */
export function isGmsConfigured(): boolean {
  return !!GMS_API_URL && !!GMS_API_KEY;
}

/**
 * Get the GMS API URL (for display in admin settings).
 */
export function getGmsApiUrl(): string {
  return GMS_API_URL;
}

/**
 * Get the API key prefix (for display — first 12 chars only).
 */
export function getApiKeyPrefix(): string {
  return GMS_API_KEY.slice(0, 12) + "••••••••";
}
