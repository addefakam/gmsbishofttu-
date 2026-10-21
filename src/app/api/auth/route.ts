import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { hashPassword, verifyPassword, createToken, type JWTPayload } from "@/lib/auth-utils";
import { ensureNewTables } from "@/lib/ensure-tables";

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

    // First: ensure all tables exist (creates them if this is a fresh database)
    // This is critical for Supabase — the database starts empty.
    try {
      await ensureNewTables();
    } catch (tableErr) {
      console.warn("[auth] ensureNewTables failed:", tableErr instanceof Error ? tableErr.message : tableErr);
    }

    // Use raw pg.Client for the login query — more reliable than Prisma
    // for the initial connection to a fresh database.
    const { Client } = await import("pg");

    // Build connection string — handle @ in password by URL-encoding
    let connStr = process.env.DATABASE_URL || "";
    // pg.Client handles connection strings natively, no URL-encoding needed

    const client = new Client({
      connectionString: connStr,
      connectionTimeoutMillis: 30000,
      ssl: connStr.includes("supabase.co") || connStr.includes("neon.tech")
        ? { rejectUnauthorized: false }
        : undefined,
    });

    let user: {
      id: string; username: string; name: string; role: string;
      password: string; providerId: string | null; permissions: string;
      policeRank: string;
      jurisdictionType: string; subCity: string; woreda: string;
      providerId2: string | null; providerName: string | null; providerStatus: string | null;
    } | null = null;

    try {
      await client.connect();

      // Check if User table exists
      const tableCheck = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User') as exists`
      );

      if (!tableCheck.rows[0]?.exists) {
        // Table doesn't exist — ensureNewTables should have created it,
        // but if it failed, return the error message
        await client.end();
        console.error("[auth] User table does not exist. ensureNewTables may have failed.");
        return NextResponse.json(
          { error: "System is being set up. Please try again in 30 seconds." },
          { status: 503 }
        );
      }

      // Query the user
      const result = await client.query(
        `SELECT u."id", u."username", u."name", u."role", u."password",
                u."providerId", u."permissions", u."policeRank",
                u."jurisdictionType", u."subCity", u."woreda",
                p."id" AS "providerId2", p."name" AS "providerName", p."status" AS "providerStatus"
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
      console.error("[auth] Database query failed:", msg);
      return NextResponse.json(
        { error: "ስርዓቱን ለመጠቀም እስከ ኦክቶበር 1/2026 ድረስ የሲስተም አድሚኑን ያነጋግሩ እና የደንበኝነት ክፍያውን ይክፈሉ::" },
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
            ssl: (process.env.DATABASE_URL || "").includes("supabase.co") || (process.env.DATABASE_URL || "").includes("neon.tech")
              ? { rejectUnauthorized: false }
              : undefined,
          });
          await c.connect();
          await c.query(`UPDATE "User" SET "password" = $1 WHERE "id" = $2`, [hashed, user!.id]);
          await c.end();
        } catch {}
      });
    }

    const policeRank = user.policeRank || "";

    // Check provider approval
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

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    console.error("[auth] Login error:", error);
    const message = error instanceof Error ? error.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
