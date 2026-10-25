#!/usr/bin/env node
// ============================================================================
// fix-provider-status.mjs
// ----------------------------------------------------------------------------
// Standalone one-shot DB fix for the recurring Prisma error:
//   "operator does not exist: text = \"ProviderStatus\"" (SQLSTATE 42883)
//
// Converts Provider.status and User.role columns from TEXT to the proper
// enum types IN-PLACE, using the `pg` package already in your deps.
//
// USAGE (from the repo root, after `npm install` / `bun install`):
//   node scripts/fix-provider-status.mjs
//
// Or with an explicit DATABASE_URL:
//   DATABASE_URL="postgresql://..." node scripts/fix-provider-status.mjs
//
// Or with a .env file in the repo root (auto-loaded):
//   node scripts/fix-provider-status.mjs
//
// FLAGS:
//   --check    Only show current column state, don't modify.
//   --verbose  Print every SQL statement as it runs.
// ============================================================================

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

// ─── Parse CLI flags ────────────────────────────────────────────────────────
const CHECK_ONLY = process.argv.includes("--check");
const VERBOSE = process.argv.includes("--verbose");

// ─── Load .env if present (so DATABASE_URL is populated) ───────────────────
async function loadEnvFile() {
  for (const p of [".env.local", ".env"]) {
    if (!existsSync(p)) continue;
    const txt = await readFile(p, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (process.env[k] !== undefined) continue; // don't override
      let v = vRaw.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
    console.log(`[fix] Loaded ${p}`);
    break;
  }
}

// ─── Smart SSL detection (same logic as the in-app guard) ───────────────────
function detectSslRequired(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  const sslmodeMatch = lower.match(/[?&]sslmode=([^&]+)/);
  if (sslmodeMatch) {
    const mode = sslmodeMatch[1];
    if (mode === "disable") return false;
    if (["require", "verify-ca", "verify-full", "prefer"].includes(mode)) return true;
  }
  const sslHosts = [
    "supabase.co", "neon.tech", "neon.dbs.host",
    "aivencloud.com", "render.com", ".rds.amazonaws.com",
    "elephantsql.com", "cleardb.com",
    "digitaloceancloud.com", "db.heydata.dev",
  ];
  return sslHosts.some((h) => lower.includes(h));
}

// ─── Pretty column-state printer ────────────────────────────────────────────
async function printColumnState(client, label) {
  const r = await client.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'Provider' AND column_name = 'status')
           OR (table_name = 'User' AND column_name = 'role'))
    ORDER BY table_name
  `);
  console.log(`\n=== ${label} ===`);
  if (r.rows.length === 0) {
    console.log("  (no matching columns — table or column doesn't exist yet)");
    return;
  }
  for (const row of r.rows) {
    const ok = row.data_type === "USER-DEFINED";
    console.log(
      `  ${row.table_name}.${row.column_name}: ${row.data_type}/${row.udt_name} (nullable=${row.is_nullable}) ${ok ? "OK" : "TEXT — needs conversion"}`
    );
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await loadEnvFile();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[fix] ERROR: DATABASE_URL not set. Either:");
    console.error("  1. Put it in .env or .env.local in the repo root, or");
    console.error("  2. Prefix the command: DATABASE_URL='...' node scripts/fix-provider-status.mjs");
    process.exit(1);
  }

  const needsSsl = detectSslRequired(url);
  console.log(`[fix] DATABASE_URL host: ${url.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@")}`);
  console.log(`[fix] SSL required: ${needsSsl}`);

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 30000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log("[fix] Connected.");

    await printColumnState(client, "BEFORE");

    if (CHECK_ONLY) {
      console.log("\n[fix] --check mode — not modifying. Done.");
      return;
    }

    // Step 1: Create enum types (idempotent)
    if (VERBOSE) console.log("[fix] SQL: CREATE TYPE ProviderStatus");
    await client.query(`DO $$ BEGIN CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    if (VERBOSE) console.log("[fix] SQL: CREATE TYPE UserRole");
    await client.query(`DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF'); EXCEPTION WHEN duplicate_object THEN null; END $$`);

    // Step 2: Check if Provider table exists
    const tCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'Provider'
      ) as exists
    `);
    if (!tCheck.rows[0]?.exists) {
      console.log("\n[fix] Provider table doesn't exist yet — nothing to convert. Done.");
      return;
    }

    // Step 3: Convert Provider.status
    const statusCol = await client.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Provider' AND column_name = 'status'
      LIMIT 1
    `);
    if (statusCol.rows.length === 0) {
      console.log("[fix] Provider.status column doesn't exist — skipping.");
    } else if (statusCol.rows[0].data_type === "USER-DEFINED" && statusCol.rows[0].udt_name === "ProviderStatus") {
      console.log("[fix] Provider.status is already ProviderStatus enum — no-op.");
    } else if (["text", "character varying"].includes(statusCol.rows[0].data_type)) {
      console.log(`[fix] Provider.status is ${statusCol.rows[0].data_type} — normalizing + converting...`);
      const norm = await client.query(`
        UPDATE "Provider"
        SET "status" = 'PENDING'
        WHERE "status" IS NULL OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED')
      `);
      if (norm.rowCount && norm.rowCount > 0) {
        console.log(`[fix]   Normalized ${norm.rowCount} row(s) with invalid status to 'PENDING'.`);
      }
      if (VERBOSE) console.log("[fix] SQL: ALTER TABLE Provider ALTER COLUMN status TYPE ProviderStatus");
      await client.query(`ALTER TABLE "Provider" ALTER COLUMN "status" TYPE "ProviderStatus" USING "status"::"ProviderStatus"`);
      await client.query(`ALTER TABLE "Provider" ALTER COLUMN "status" SET DEFAULT 'PENDING'`);
      try {
        await client.query(`ALTER TABLE "Provider" ALTER COLUMN "status" SET NOT NULL`);
      } catch { /* may already be NOT NULL */ }
      console.log("[fix]   Provider.status converted to ProviderStatus enum.");
    } else {
      console.log(`[fix] Provider.status has unexpected type ${statusCol.rows[0].data_type}/${statusCol.rows[0].udt_name} — skipping.`);
    }

    // Step 4: Convert User.role (same pattern)
    const roleCol = await client.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'role'
      LIMIT 1
    `);
    if (roleCol.rows.length === 0) {
      console.log("[fix] User.role column doesn't exist — skipping.");
    } else if (roleCol.rows[0].data_type === "USER-DEFINED" && roleCol.rows[0].udt_name === "UserRole") {
      console.log("[fix] User.role is already UserRole enum — no-op.");
    } else if (["text", "character varying"].includes(roleCol.rows[0].data_type)) {
      console.log(`[fix] User.role is ${roleCol.rows[0].data_type} — normalizing + converting...`);
      const norm = await client.query(`
        UPDATE "User" SET "role" = 'STAFF'
        WHERE "role" IS NULL OR "role"::text NOT IN ('POLICE','SUPERUSER','OPERATOR','STAFF')
      `);
      if (norm.rowCount && norm.rowCount > 0) {
        console.log(`[fix]   Normalized ${norm.rowCount} row(s) with invalid role to 'STAFF'.`);
      }
      if (VERBOSE) console.log("[fix] SQL: ALTER TABLE User ALTER COLUMN role TYPE UserRole");
      await client.query(`ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole"`);
      console.log("[fix]   User.role converted to UserRole enum.");
    } else {
      console.log(`[fix] User.role has unexpected type ${roleCol.rows[0].data_type}/${roleCol.rows[0].udt_name} — skipping.`);
    }

    await printColumnState(client, "AFTER");
    console.log("\n[fix] Done. Subsequent prisma.provider.count() will succeed.");
  } catch (err) {
    console.error("\n[fix] FAILED:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    try { await client.end(); } catch {}
  }
}

main();
