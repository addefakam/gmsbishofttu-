/**
 * Setup Script — Securely creates the initial admin + police users.
 *
 * Run this ONCE after deploying to a fresh database.
 * Do NOT run on an existing production database (it won't duplicate
 * users — uses ON CONFLICT DO NOTHING — but it's unnecessary).
 *
 * Usage:
 *   node scripts/setup-admin.js
 *
 * Requires environment variables:
 *   - DATABASE_URL (Neon connection string)
 *   - INITIAL_ADMIN_USERNAME (default: admin)
 *   - INITIAL_ADMIN_PASSWORD (REQUIRED — bcrypt-hashed before storing)
 *   - INITIAL_POLICE_USERNAME (default: police)
 *   - INITIAL_POLICE_PASSWORD (REQUIRED — bcrypt-hashed before storing)
 *
 * SECURITY:
 *   - Passwords are bcrypt-hashed (12 rounds) before storing
 *   - Never prints passwords to console
 *   - Idempotent — safe to run multiple times
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const { Client } = pg;
const SALT_ROUNDS = 12;

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const adminUsername = process.env.INITIAL_ADMIN_USERNAME || "admin";
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const policeUsername = process.env.INITIAL_POLICE_USERNAME || "police";
  const policePassword = process.env.INITIAL_POLICE_PASSWORD;

  if (!adminPassword || !policePassword) {
    console.error("ERROR: INITIAL_ADMIN_PASSWORD and INITIAL_POLICE_PASSWORD must be set.");
    console.error("Generate strong passwords with: openssl rand -base64 16");
    process.exit(1);
  }

  const needsSsl = dbUrl.includes("neon.tech") || dbUrl.includes("supabase.co") || dbUrl.includes("sslmode=require");

  const client = new Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 30000,
    ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
  });

  try {
    await client.connect();
    console.log("✓ Connected to database");

    // Create admin user
    const hashedAdmin = await bcrypt.hash(adminPassword, SALT_ROUNDS);
    await client.query(
      `INSERT INTO "User" ("id", "username", "password", "name", "role", "permissions", "isActive", "createdAt", "updatedAt")
       SELECT 'admin-001', $1, $2, 'System Administrator', 'SUPERUSER', '[]', true, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "username" = $1)`,
      [adminUsername, hashedAdmin]
    );
    console.log(`✓ Admin user '${adminUsername}' created (or already existed)`);

    // Create police admin user
    const hashedPolice = await bcrypt.hash(policePassword, SALT_ROUNDS);
    await client.query(
      `INSERT INTO "User" ("id", "username", "password", "name", "role", "permissions", "policeRank", "jurisdictionType", "isActive", "createdAt", "updatedAt")
       SELECT 'police-admin-001', $1, $2, 'Police Administrator', 'POLICE', '[]', 'ADMIN', 'CITY', true, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "username" = $1)`,
      [policeUsername, hashedPolice]
    );
    console.log(`✓ Police admin user '${policeUsername}' created (or already existed)`);

    console.log("\n✅ Setup complete!");
    console.log("\n⚠️  IMPORTANT: Remove INITIAL_ADMIN_PASSWORD and INITIAL_POLICE_PASSWORD");
    console.log("   from your environment variables after setup is confirmed working.");
    console.log("   These should only be set during initial deployment.");

    await client.end();
  } catch (err) {
    console.error("✗ Setup failed:", err instanceof Error ? err.message : err);
    try { await client.end(); } catch {}
    process.exit(1);
  }
}

main();
