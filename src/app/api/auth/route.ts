import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { hashPassword, verifyPassword, createToken, type JWTPayload } from "@/lib/auth-utils";

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
      ssl: needsSsl() ? { rejectUnauthorized: false } : undefined,
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

      // ALWAYS create both tables — CREATE TABLE IF NOT EXISTS is a no-op
      // if the table already exists. Don't gate on a table existence check
      // — if User exists but Provider doesn't (partial state from a
      // previous failed attempt), the JOIN query will fail.
      await client.query(`
        CREATE TABLE IF NOT EXISTS "User" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "username" TEXT NOT NULL UNIQUE,
          "password" TEXT NOT NULL,
          "name" TEXT NOT NULL DEFAULT '',
          "email" TEXT NOT NULL DEFAULT '',
          "phone" TEXT NOT NULL DEFAULT '',
          "role" TEXT NOT NULL DEFAULT 'STAFF',
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
      await client.query(`
        CREATE TABLE IF NOT EXISTS "Provider" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "ownerName" TEXT NOT NULL DEFAULT '',
          "phone" TEXT NOT NULL DEFAULT '',
          "email" TEXT NOT NULL DEFAULT '',
          "address" TEXT NOT NULL DEFAULT '',
          "licenseNo" TEXT NOT NULL DEFAULT '',
          "latitude" DOUBLE PRECISION,
          "longitude" DOUBLE PRECISION,
          "status" TEXT NOT NULL DEFAULT 'PENDING',
          "subCity" TEXT NOT NULL DEFAULT '',
          "woreda" TEXT NOT NULL DEFAULT '',
          "bedCount" INTEGER,
          "telegramChatId" TEXT,
          "suspensionReason" TEXT NOT NULL DEFAULT '',
          "suspendedAt" TIMESTAMP(3),
          "suspendedBy" TEXT NOT NULL DEFAULT '',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[auth] User + Provider tables ensured.");

      // Add any missing columns to the User table
      try {
        await client.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT ''`);
        await client.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT ''`);
        // Add missing columns to Provider table
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'GUESTHOUSE'`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "subCity" TEXT NOT NULL DEFAULT ''`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "woreda" TEXT NOT NULL DEFAULT ''`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "bedCount" INTEGER`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT NOT NULL DEFAULT ''`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3)`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "suspendedBy" TEXT NOT NULL DEFAULT ''`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "certNumber" TEXT`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "certIssuedAt" TIMESTAMP(3)`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "certIssuedBy" TEXT`);
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "certIssuedByName" TEXT`);
      } catch (alterErr) {
        console.warn("[auth] ALTER TABLE failed (non-blocking):", alterErr instanceof Error ? alterErr.message : alterErr);
      }

      // Seed admin user if not exists
      await client.query(`
        INSERT INTO "User" ("id", "username", "password", "name", "role", "permissions", "isActive", "createdAt", "updatedAt")
        VALUES ('admin-001', 'admin', 'Admin@2024', 'System Administrator', 'SUPERUSER', '[]', true, NOW(), NOW())
        ON CONFLICT ("username") DO NOTHING
      `);
      console.log("[auth] Admin user ensured.");

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
      console.error("[auth] Database error:", msg);
      console.error("[auth] DATABASE_URL hostname:", (process.env.DATABASE_URL || "").split("@").pop()?.split("/")[0] || "unknown");
      console.error("[auth] DATABASE_URL has sslmode:", (process.env.DATABASE_URL || "").includes("sslmode"));
      // Return the actual error message (not the Amharic text) so we can debug
      return NextResponse.json(
        { error: `DB Error: ${msg}` },
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

    // Auto-migrate: hash plain-text passwords in background
    if (!user.password.startsWith("$2")) {
      hashPassword(password).then(async (hashed) => {
        try {
          const { Client } = await import("pg");
          const c = new Client({
            connectionString: process.env.DATABASE_URL,
            connectionTimeoutMillis: 30000,
            ssl: needsSsl() ? { rejectUnauthorized: false } : undefined,
          });
          await c.connect();
          await c.query(`UPDATE "User" SET "password" = $1 WHERE "id" = $2`, [hashed, user!.id]);
          await c.end();
        } catch {}
      });
    }

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
