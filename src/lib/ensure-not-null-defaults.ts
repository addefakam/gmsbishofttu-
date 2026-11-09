/**
 * Fixes NULL values in non-nullable-with-default columns.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Several columns were added to existing tables via ALTER TABLE ADD COLUMN
 * with a DEFAULT clause. PostgreSQL's behavior:
 *   - For NEW rows: the DEFAULT applies
 *   - For EXISTING rows: NULL is stored (unless NOT NULL was added too)
 *
 * Prisma's schema declares these as `String @default("")` (non-nullable).
 * When Prisma reads existing rows with NULL values, it throws:
 *   "Error converting field 'subCity' of expected non-nullable type 'String',
 *    found incompatible value of 'null'"
 *
 * This helper backfills NULL values with their schema defaults:
 *   - User.subCity, User.woreda → ''
 *   - User.jurisdictionType → 'CITY'
 *   - User.permissions → '["reservations","guests"]'
 *   - User.policeRank → ''
 *   - User.isActive → true (already NOT NULL, but safe)
 *   - Provider.subCity, Provider.woreda → ''
 *   - Provider.type → 'GUESTHOUSE'
 *   - Provider.licenseFile → ''
 *   - Provider.rejectionReason → ''
 *   - Provider.suspensionReason → ''
 *   - Provider.suspendedBy → ''
 *
 * Cached — runs once per cold start.
 */
import { ensureDatabase } from "./init-db";

let _backfillChecked = false;
let _backfillPromise: Promise<void> | null = null;
let _backfillAttempts = 0;
const MAX_BACKFILL_ATTEMPTS = 3;

export async function ensureNotNullableDefaults(): Promise<void> {
  if (_backfillChecked) return;
  if (_backfillPromise) { await _backfillPromise; return; }

  _backfillPromise = (async () => {
    try {
      // First, make sure ensureDatabase() has run (creates tables/columns).
      await ensureDatabase();

      // Then do a direct backfill via pg.Client.
      await backfillNullsDirectly();
      _backfillChecked = true;
    } catch (err) {
      // Same contract as ensureProviderStatusEnum / ensureSettingsColumns:
      // never throw — error escapes the API handler (guard is outside the
      // try block), Vercel returns empty body, frontend fails with
      // "Unexpected end of JSON input".
      _backfillAttempts++;
      console.error(
        `[ensureNotNullableDefaults] Attempt ${_backfillAttempts}/${MAX_BACKFILL_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err
      );
      if (_backfillAttempts >= MAX_BACKFILL_ATTEMPTS) {
        console.error(`[ensureNotNullableDefaults] Giving up after ${MAX_BACKFILL_ATTEMPTS} attempts — NULL values may still cause Prisma errors.`);
        _backfillChecked = true;
      }
      _backfillPromise = null;
    }
  })();

  await _backfillPromise;
}

/**
 * Direct UPDATE statements to backfill NULL values with schema defaults.
 * Bypasses ensureDatabase() caching.
 */
async function backfillNullsDirectly(): Promise<void> {
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL || "";
  const needsSsl = url.includes("supabase.co") || url.includes("neon.tech") || url.includes("sslmode=require");

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    // ── User table ──
    // These are the columns that Prisma declares as non-nullable with
    // defaults. Existing rows may have NULL due to ALTER TABLE behavior.
    const userBackfills: Array<[string, string]> = [
      ["email", "''"],
      ["phone", "''"],
      ["permissions", "'[\"reservations\",\"guests\"]'"],
      ["policeRank", "''"],
      ["jurisdictionType", "'CITY'"],
      ["subCity", "''"],
      ["woreda", "''"],
      ["name", "''"],
    ];
    for (const [col, defaultExpr] of userBackfills) {
      try {
        const result = await client.query(
          `UPDATE "User" SET "${col}" = ${defaultExpr} WHERE "${col}" IS NULL`
        );
        if (result.rowCount && result.rowCount > 0) {
          console.log(`[ensureNotNullableDefaults] User.${col}: backfilled ${result.rowCount} NULL rows with ${defaultExpr}`);
        }
      } catch (err) {
        console.warn(`[ensureNotNullableDefaults] Could not backfill User.${col}:`, err instanceof Error ? err.message : err);
      }
    }

    // ── Provider table ──
    const providerBackfills: Array<[string, string]> = [
      ["name", "''"],
      ["ownerName", "''"],
      ["phone", "''"],
      ["email", "''"],
      ["address", "''"],
      ["type", "'GUESTHOUSE'"],
      ["licenseNo", "''"],
      ["licenseFile", "''"],
      ["rejectionReason", "''"],
      ["suspensionReason", "''"],
      ["suspendedBy", "''"],
      ["subCity", "''"],
      ["woreda", "''"],
    ];
    for (const [col, defaultExpr] of providerBackfills) {
      try {
        const result = await client.query(
          `UPDATE "Provider" SET "${col}" = ${defaultExpr} WHERE "${col}" IS NULL`
        );
        if (result.rowCount && result.rowCount > 0) {
          console.log(`[ensureNotNullableDefaults] Provider.${col}: backfilled ${result.rowCount} NULL rows with ${defaultExpr}`);
        }
      } catch (err) {
        console.warn(`[ensureNotNullableDefaults] Could not backfill Provider.${col}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log("[ensureNotNullableDefaults] NULL backfill complete.");
  } finally {
    try { await client.end(); } catch {}
  }
}

/**
 * Reset the cached state. Used by tests or when forcing a re-check.
 */
export function resetNotNullableDefaultsCheck(): void {
  _backfillChecked = false;
  _backfillPromise = null;
}
