import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { hashPassword, verifyPassword, createToken, type JWTPayload } from "@/lib/auth-utils";
import { ensureNewTables } from "@/lib/ensure-tables";
import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";
import { ensureNotNullableDefaults } from "@/lib/ensure-not-null-defaults";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";

// Detect if SSL is needed based on DATABASE_URL
function needsSsl(): boolean {
  const url = process.env.DATABASE_URL || "";
  return url.includes("supabase.co") || url.includes("neon.tech") || url.includes("sslmode=require");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username or password is not correct. Check it and try again." },
        { status: 400 }
      );
    }

    // Use raw pg.Client — more reliable than Prisma for fresh databases
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 30000,
      ssl: needsSsl() ? { rejectUnauthorized: true } : undefined,
    });

    let user: {
      id: string; username: string; name: string; role: string;
      password: string; providerId: string | null; permissions: string;
      policeRank: string;
      jurisdictionType: string; subCity: string; woreda: string;
      providerName: string | null; providerStatus: string | null;
    } | null = null;

    try {
      await client.connect();
      console.log("[auth] Connected to database successfully.");

      // ── Step 1: Create ALL enum types FIRST ──
      // Without this, CREATE TABLE for Provider will fail with:
      //   type "public.ProviderStatus" does not exist (42704)
      // Use a single SQL string (template literal) — avoids the bug where
      // mixed single/double quotes in JS arrays break the parser.
      const ENUM_CREATE_SQL = `
        DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "RoomType" AS ENUM ('SINGLE','DOUBLE','TWIN','SUITE','DELUXE','KING','STANDARD','STANDARD_SUITE','JUNIOR_SUITE','EXECUTIVE_SUITE','PRESIDENTIAL_SUITE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "PaymentStatusType" AS ENUM ('PAID','PARTIAL','PENDING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "PaymentMethodType" AS ENUM ('CASH','TRANSFER','CARD','MOBILE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "ReservationStatus" AS ENUM ('UPCOMING','ACTIVE','COMPLETED','CANCELLED','DELETED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "NotificationType" AS ENUM ('INFO','WARNING','SUCCESS','ERROR'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "HousekeepingTaskType" AS ENUM ('CLEANING','MAINTENANCE','INSPECTION'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "HousekeepingTaskStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "TaskStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "TaskPriority" AS ENUM ('LOW','MEDIUM','HIGH','URGENT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "SuspectSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "SubscriptionCycle" AS ENUM ('MONTHLY','QUARTERLY','SEMI_ANNUAL','YEARLY'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "GroupBookingStatus" AS ENUM ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "MessageChannel" AS ENUM ('SMS','WHATSAPP'); EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN CREATE TYPE "MessageStatus" AS ENUM ('PENDING','SENT','FAILED','DELIVERED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      `;
      try {
        await client.query(ENUM_CREATE_SQL);
        console.log("[auth] Enum types ensured.");
      } catch (enumErr) {
        console.warn("[auth] Enum creation warning (likely already exists):", enumErr instanceof Error ? enumErr.message : enumErr);
      }

      // ── Step 2: Create User table ──
      // Use proper "UserRole" enum type for the role column — NOT TEXT.
      // Older deploys created this as TEXT; the FIX_ENUM_COLUMNS_SQL migration
      // in ensureDatabase() will convert any existing TEXT column to the enum.
      await client.query(`
        CREATE TABLE IF NOT EXISTS "User" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "username" TEXT NOT NULL UNIQUE,
          "password" TEXT NOT NULL,
          "name" TEXT NOT NULL DEFAULT '',
          "email" TEXT NOT NULL DEFAULT '',
          "phone" TEXT NOT NULL DEFAULT '',
          "role" "UserRole" NOT NULL DEFAULT 'STAFF',
          "permissions" TEXT NOT NULL DEFAULT '["reservations","guests"]',
          "policeRank" TEXT NOT NULL DEFAULT '',
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "lastLogin" TIMESTAMP(3),
          "providerId" TEXT,
          "createdBy" TEXT,
          "jurisdictionType" TEXT NOT NULL DEFAULT 'CITY',
          "subCity" TEXT NOT NULL DEFAULT '',
          "woreda" TEXT NOT NULL DEFAULT '',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // ── Step 3: Create Provider table ──
      // Use proper "ProviderStatus" enum type for the status column.
      // If the table was previously created with status TEXT (by an older
      // deploy), drop & recreate it to use the proper enum type.
      // We only drop if the column type is TEXT (not enum).
      const statusTypeCheck = await client.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Provider' AND column_name = 'status'
        LIMIT 1
      `);
      const statusDataType = statusTypeCheck.rows[0]?.data_type;
      if (statusDataType === 'text' || statusDataType === 'character varying') {
        console.log("[auth] Provider.status is TEXT — converting to ProviderStatus enum...");
        // Convert in-place: normalize bad values first, then ALTER COLUMN TYPE
        try {
          await client.query(`UPDATE "Provider" SET "status" = 'PENDING' WHERE "status" IS NULL OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED')`);
          await client.query(`ALTER TABLE "Provider" ALTER COLUMN "status" TYPE "ProviderStatus" USING "status"::"ProviderStatus"`);
          console.log("[auth] Provider.status converted to ProviderStatus enum.");
        } catch (convErr) {
          console.error("[auth] Failed to convert Provider.status to enum:", convErr instanceof Error ? convErr.message : convErr);
        }
      }

      // Drop and recreate Provider table ONLY IF 'type' column is missing
      // (legacy schema from old deploy). This is destructive — only do it
      // when truly necessary.
      const typeCheck = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Provider' AND column_name = 'type'
        ) as exists
      `);
      if (!typeCheck.rows[0]?.exists) {
        console.log("[auth] Provider table missing 'type' column. Dropping + recreating...");
        await client.query(`DROP TABLE IF EXISTS "Provider" CASCADE`);
      }

      // Check ALL missing columns and add them via ALTER TABLE
      const providerColumns = [
        ['licenseFile', 'TEXT NOT NULL DEFAULT \'\''],
        ['type', 'TEXT NOT NULL DEFAULT \'GUESTHOUSE\''],
        ['approvedBy', 'TEXT'],
        ['approvedAt', 'TIMESTAMP(3)'],
        ['rejectionReason', 'TEXT NOT NULL DEFAULT \'\''],
        ['subCity', 'TEXT NOT NULL DEFAULT \'\''],
        ['woreda', 'TEXT NOT NULL DEFAULT \'\''],
        ['bedCount', 'INTEGER'],
        ['telegramChatId', 'TEXT'],
        ['suspensionReason', 'TEXT NOT NULL DEFAULT \'\''],
        ['suspendedAt', 'TIMESTAMP(3)'],
        ['suspendedBy', 'TEXT NOT NULL DEFAULT \'\''],
        ['certNumber', 'TEXT'],
        ['certIssuedAt', 'TIMESTAMP(3)'],
        ['certIssuedBy', 'TEXT'],
        ['certIssuedByName', 'TEXT'],
      ];
      for (const [col, def] of providerColumns) {
        try {
          await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
        } catch {}
      }
      // Same for User table — add ALL columns referenced in the login query
      // (and elsewhere). Older deploys created User with just the basics
      // (id, username, password, name, role, createdAt, updatedAt) so we
      // must ALTER ADD COLUMN for everything else.
      const userColumns = [
        ['email', 'TEXT NOT NULL DEFAULT \'\''],
        ['phone', 'TEXT NOT NULL DEFAULT \'\''],
        ['permissions', 'TEXT NOT NULL DEFAULT \'["reservations","guests"]\''],
        ['policeRank', 'TEXT NOT NULL DEFAULT \'\''],
        ['isActive', 'BOOLEAN NOT NULL DEFAULT true'],
        ['lastLogin', 'TIMESTAMP(3)'],
        ['providerId', 'TEXT'],
        ['createdBy', 'TEXT'],
        ['jurisdictionType', 'TEXT NOT NULL DEFAULT \'CITY\''],
        ['subCity', 'TEXT NOT NULL DEFAULT \'\''],
        ['woreda', 'TEXT NOT NULL DEFAULT \'\''],
      ];
      for (const [col, def] of userColumns) {
        try {
          await client.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
        } catch (colErr) {
          console.warn(`[auth] Could not add User.${col}:`, colErr instanceof Error ? colErr.message : colErr);
        }
      }

      // Now create the Provider table with proper enum type (if it doesn't exist)
      await client.query(`
        CREATE TABLE IF NOT EXISTS "Provider" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "ownerName" TEXT NOT NULL DEFAULT '',
          "phone" TEXT NOT NULL DEFAULT '',
          "email" TEXT NOT NULL DEFAULT '',
          "address" TEXT NOT NULL DEFAULT '',
          "licenseNo" TEXT NOT NULL DEFAULT '',
          "licenseFile" TEXT NOT NULL DEFAULT '',
          "type" TEXT NOT NULL DEFAULT 'GUESTHOUSE',
          "latitude" DOUBLE PRECISION,
          "longitude" DOUBLE PRECISION,
          "status" "ProviderStatus" NOT NULL DEFAULT 'PENDING',
          "approvedBy" TEXT,
          "approvedAt" TIMESTAMP(3),
          "rejectionReason" TEXT NOT NULL DEFAULT '',
          "subCity" TEXT NOT NULL DEFAULT '',
          "woreda" TEXT NOT NULL DEFAULT '',
          "bedCount" INTEGER,
          "telegramChatId" TEXT,
          "suspensionReason" TEXT NOT NULL DEFAULT '',
          "suspendedAt" TIMESTAMP(3),
          "suspendedBy" TEXT NOT NULL DEFAULT '',
          "certNumber" TEXT,
          "certIssuedAt" TIMESTAMP(3),
          "certIssuedBy" TEXT,
          "certIssuedByName" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[auth] User + Provider tables ensured (with proper enum types).");

      // ── SECURITY FIX (C-01 + C-05): No more hardcoded credentials ──
      //
      // Previously, the admin + police users were seeded with hardcoded
      // plain-text passwords ('Admin@2024', 'Police@2024') on EVERY login
      // attempt. Since the repo is public on GitHub, anyone could read
      // these credentials and log in as SUPERUSER or POLICE ADMIN.
      //
      // Now: admin/police users are seeded ONLY from environment variables:
      //   - INITIAL_ADMIN_USERNAME (default: admin)
      //   - INITIAL_ADMIN_PASSWORD (REQUIRED in production, no default)
      //   - INITIAL_POLICE_USERNAME (default: police)
      //   - INITIAL_POLICE_PASSWORD (REQUIRED in production, no default)
      //
      // Passwords are bcrypt-hashed at creation time (never plain text).
      // If the env vars are not set, no seed users are created — the
      // system admin must create the first account via a secure setup script.
      //
      // The seeding is idempotent (ON CONFLICT DO NOTHING) so it only
      // creates the user if they don't already exist.
      try {
        const { hashPassword } = await import("@/lib/auth-utils");

        const adminUsername = process.env.INITIAL_ADMIN_USERNAME || "admin";
        const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
        if (adminPassword) {
          const hashedAdmin = await hashPassword(adminPassword);
          await client.query(
            `INSERT INTO "User" ("id", "username", "password", "name", "role", "permissions", "isActive", "createdAt", "updatedAt")
             SELECT 'admin-001', $1, $2, 'System Administrator', 'SUPERUSER', '[]', true, NOW(), NOW()
             WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "username" = $1)`,
            [adminUsername, hashedAdmin]
          );
          console.log("[auth] Admin user ensured (from INITIAL_ADMIN_PASSWORD env var).");
        } else if (process.env.NODE_ENV === "production") {
          console.warn("[auth] INITIAL_ADMIN_PASSWORD not set — no admin user seeded. Use the setup script to create the first admin.");
        }

        const policeUsername = process.env.INITIAL_POLICE_USERNAME || "police";
        const policePassword = process.env.INITIAL_POLICE_PASSWORD;
        if (policePassword) {
          const hashedPolice = await hashPassword(policePassword);
          await client.query(
            `INSERT INTO "User" ("id", "username", "password", "name", "role", "permissions", "policeRank", "jurisdictionType", "isActive", "createdAt", "updatedAt")
             SELECT 'police-admin-001', $1, $2, 'Police Administrator', 'POLICE', '[]', 'ADMIN', 'CITY', true, NOW(), NOW()
             WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "username" = $1)`,
            [policeUsername, hashedPolice]
          );
          console.log("[auth] Police admin user ensured (from INITIAL_POLICE_PASSWORD env var).");
        } else if (process.env.NODE_ENV === "production") {
          console.warn("[auth] INITIAL_POLICE_PASSWORD not set — no police user seeded.");
        }
      } catch (seedErr) {
        console.warn("[auth] User seeding failed (non-blocking):", seedErr instanceof Error ? seedErr.message : seedErr);
      }

      // Run the FULL database migration (creates ALL 30+ tables with ALL
      // columns). This runs via init-db.ts which uses pg.Client with SSL.
      // This ensures that by the time login completes, ALL tables exist
      // with ALL columns — so subsequent API calls (e.g. provider.create)
      // don't fail with 'column does not exist'.
      try {
        await ensureNewTables();
        console.log("[auth] Full database migration completed.");
      } catch (migErr) {
        console.warn("[auth] Migration failed (non-blocking — will retry on next request):", migErr instanceof Error ? migErr.message : migErr);
      }

      // Ensure Settings table + ALL columns (especially configJson).
      try { await ensureSettingsColumns(); } catch (e) {
        console.warn("[auth] ensureSettingsColumns failed:", e instanceof Error ? e.message : e);
      }

      // Backfill NULL values in non-nullable User/Provider columns.
      try { await ensureNotNullableDefaults(); } catch (e) {
        console.warn("[auth] ensureNotNullableDefaults failed:", e instanceof Error ? e.message : e);
      }

      // Repair Reservation → Room referential integrity (creates placeholder
      // Room, reassigns orphan reservations, backfills NULLs, adds FK).
      try { await ensureReservationIntegrity(); } catch (e) {
        console.warn("[auth] ensureReservationIntegrity failed:", e instanceof Error ? e.message : e);
      }

      // Query the user
      const result = await client.query(
        `SELECT u."id", u."username", u."name", u."role", u."password",
                u."providerId", u."permissions", u."policeRank",
                u."jurisdictionType", u."subCity", u."woreda",
                p."name" AS "providerName", p."status" AS "providerStatus"
         FROM "User" u
         LEFT JOIN "Provider" p ON p."id" = u."providerId"
         WHERE u."username" = $1
         LIMIT 1`,
        [username]
      );

      if (result.rows.length === 0) {
        await client.end();
        return NextResponse.json(
          { error: "Username or password is not correct. Check it and try again." },
          { status: 401 }
        );
      }

      user = result.rows[0] as typeof user;
      await client.end();
    } catch (dbErr) {
      try { await client.end(); } catch {}
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      // SECURITY FIX (H-07): Don't leak raw DB errors to the client.
      // Log full details server-side only; return generic message to user.
      console.error("[auth] Database error:", msg);
      console.error("[auth] DATABASE_URL hostname:", (process.env.DATABASE_URL || "").split("@").pop()?.split("/")[0] || "unknown");
      console.error("[auth] DATABASE_URL has sslmode:", (process.env.DATABASE_URL || "").includes("sslmode"));
      return NextResponse.json(
        { error: "Login temporarily unavailable. Please try again later." },
        { status: 503 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "Username or password is not correct. Check it and try again." },
        { status: 401 }
      );
    }

    // Verify password (supports both hashed and plain text for backward compat)
    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return NextResponse.json(
        { error: "Username or password is not correct. Check it and try again." },
        { status: 401 }
      );
    }

    // SECURITY FIX (C-05): Removed plain-text auto-migration.
    // verifyPassword() now REJECTS non-bcrypt passwords.
    // Users with plain-text passwords must reset via the password reset flow.

    const policeRank = user.policeRank || "";

    // Check provider approval — skip if no providerId (system admin)
    if (user.role !== "POLICE" && user.providerId) {
      if (!user.providerStatus || user.providerStatus !== "APPROVED") {
        return NextResponse.json(
          { error: "Your registration is pending approval. Please wait for police to approve your account." },
          { status: 403 }
        );
      }
    }

    let permissions: string[] = [];
    try {
      permissions = JSON.parse(user.permissions);
    } catch {
      permissions = [];
    }

    if (user.role === "POLICE") {
      if (policeRank === "ADMIN") {
        permissions = ["police_dashboard", "police_guests", "police_providers", "police_reports", "police_suspects", "police_intelligence", "police_anomalies", "police_security", "police_dispatch"];
      }
    }

    const payload: JWTPayload = {
      userId: user.id,
      role: user.role,
      providerId: user.providerId || undefined,
      permissions,
      policeRank,
      jurisdictionType: user.jurisdictionType || "CITY",
      subCity: user.subCity || "",
      woreda: user.woreda || "",
    };

    const token = await createToken(payload);

    const responseData = {
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        providerId: user.providerId,
        permissions,
        policeRank,
        jurisdictionType: user.jurisdictionType || "CITY",
        subCity: user.subCity || "",
        woreda: user.woreda || "",
      },
      token,
    };

    try {
      logAudit({
        req,
        officerName: user.name,
        action: "LOGIN",
        targetType: "USER",
        targetId: user.id,
        details: { username: user.username, role: user.role },
      });
    } catch {}

    // Set token as httpOnly cookie — the server reads the JWT from this
    // cookie on ALL subsequent API requests (via getAuthContext).
    // Without this, the user is redirected back to login after a
    // successful login because the next API call (e.g. /api/dashboard)
    // can't find the token.
    const response = NextResponse.json(responseData);
    response.cookies.set("ghms_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60, // 24 hours
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    console.error("[auth] Login error:", error);
    const message = error instanceof Error ? error.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
