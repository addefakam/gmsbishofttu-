/**
 * Bishoftu City administrative divisions.
 *
 * Used by:
 * - Provider registration form (sub-city + woreda dropdowns)
 * - Police account creation (jurisdiction selection)
 * - Police API routes (jurisdiction-based filtering)
 * - /find app (sub-city filter)
 * - Mobile app login (jurisdiction selection)
 *
 * Source: User-provided data for Bishoftu (Debre Zeit), Ethiopia.
 *
 * NOTE: These are HARDCODED DEFAULTS. The admin can override them via
 * System Config → Divisions tab (stored in Settings.configJson.divisions).
 * Components that need the admin-configured values should use the async
 * fetchDivisions() helper below — it fetches from /api/public/divisions
 * with a 5-minute client-side cache, falling back to these defaults
 * if the API fails.
 */

export interface BishoftuSubCity {
  name: string;
  woredas: string[];
}

export const BISHOFTU_SUB_CITIES: BishoftuSubCity[] = [
  {
    name: "Debaayyuu",
    woredas: ["Dhakaa Boora", "Dirree", "Horaa", "Biiftuu"],
  },
  {
    name: "Chalaleka",
    woredas: ["Erere", "Arsedee", "Kilolee"],
  },
  {
    name: "Dukem",
    woredas: ["Odaa Nabee", "Xaddachaa", "Malkaa", "Abbuu Seeraa"],
  },
];

/** Quick lookup: subCity name → array of woredas */
export const SUB_CITY_WOREDAS: Record<string, string[]> = Object.fromEntries(
  BISHOFTU_SUB_CITIES.map((sc) => [sc.name, sc.woredas])
);

/** Get all sub-city names as a flat array */
export const SUB_CITY_NAMES: string[] = BISHOFTU_SUB_CITIES.map((sc) => sc.name);

/** Get woredas for a specific sub-city */
export function getWoredasForSubCity(subCity: string): string[] {
  return SUB_CITY_WOREDAS[subCity] || [];
}

// ── Async fetch with caching (for components that can wait) ──────────

let cachedDivisions: BishoftuSubCity[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches the admin-configured divisions from /api/public/divisions.
 * Falls back to BISHOFTU_SUB_CITIES (hardcoded) if the API fails or
 * returns nothing.
 *
 * Client-side only — uses fetch(). Cached for 5 minutes to avoid
 * re-fetching on every page navigation.
 *
 * Usage:
 *   const divisions = await fetchDivisions();
 *   // divisions[0].name = "Debaayyuu"
 *   // divisions[0].woredas = ["Dhakaa Boora", ...]
 */
export async function fetchDivisions(): Promise<BishoftuSubCity[]> {
  // Use cache if fresh
  if (cachedDivisions && Date.now() < cacheExpiry) {
    return cachedDivisions;
  }

  // Server-side or no fetch available → use defaults
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return BISHOFTU_SUB_CITIES;
  }

  try {
    const res = await fetch("/api/public/divisions", { cache: "no-store" });
    const data = await res.json();
    if (Array.isArray(data.divisions) && data.divisions.length > 0) {
      cachedDivisions = data.divisions;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return data.divisions;
    }
  } catch (err) {
    console.warn("[fetchDivisions] Failed to fetch, using defaults:", err);
  }

  return BISHOFTU_SUB_CITIES;
}

/**
 * Synchronous accessor that returns the cached divisions (or defaults if
 * nothing cached yet). Useful for components that can't await.
 *
 * After calling fetchDivisions() once, subsequent calls to
 * getCachedDivisions() will return the admin-configured values.
 */
export function getCachedDivisions(): BishoftuSubCity[] {
  return cachedDivisions || BISHOFTU_SUB_CITIES;
}

/** Police jurisdiction types */
export type JurisdictionType = "CITY" | "SUBCITY" | "WOREDA";

export const JURISDICTION_LABELS: Record<JurisdictionType, string> = {
  CITY: "City Level (Full Access)",
  SUBCITY: "Sub-City Level",
  WOREDA: "Woreda Level",
};
