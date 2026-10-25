import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/init-db";
import { db } from "@/lib/db";
import { getAuthContext, getJurisdictionFilter, AuthError } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth-utils";
import { uploadFile } from "@/lib/storage";
import { isValidPhone, isValidEmail } from "@/lib/utils";
import { ensureNewTables } from "@/lib/ensure-tables";

// ── Force dynamic rendering ──
// Prevents Vercel from caching stale provider data at the edge.
export const dynamic = "force-dynamic";

/**
 * Ensures ALL Provider columns exist by running ALTER TABLE directly
 * via pg.Client with SSL. This bypasses the cached ensureDatabase()
 * which may have failed on a previous cold start.
 */
async function ensureProviderColumns(): Promise<void> {
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL || "";
  const needsSsl = url.includes("supabase.co") || url.includes("neon.tech") || url.includes("sslmode=require");
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 30000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();

    // Create ALL enum types first — they're needed by the Provider table.
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
    } catch (enumErr) {
      console.warn("[providers] Enum creation warning (likely already exists):", enumErr instanceof Error ? enumErr.message : enumErr);
    }

    // Then add ALL missing columns
    const columns = [
      ['licenseFile', 'TEXT NOT NULL DEFAULT \'\''],
      ['type', 'TEXT NOT NULL DEFAULT \'GUESTHOUSE\''],
      ['approvedBy', 'TEXT'],
      ['approvedAt', 'TIMESTAMP(3)'],
      ['rejectionReason', 'TEXT NOT NULL DEFAULT \'\''],
      ['licenseNo', 'TEXT NOT NULL DEFAULT \'\''],
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
    for (const [col, def] of columns) {
      try {
        await client.query(`ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
      } catch {}
    }

    // Also fix the status column — it might be TEXT instead of ProviderStatus enum
    // Normalize bad values first (NULL, empty, or invalid strings → 'PENDING'),
    // then ALTER COLUMN TYPE. If this fails, the prisma.provider.create() will
    // fail with "type public.ProviderStatus does not exist" — so we log loudly.
    try {
      // Check current column type
      const statusColCheck = await client.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Provider' AND column_name='status'
        LIMIT 1
      `);
      const statusDataType = statusColCheck.rows[0]?.data_type;
      if (statusDataType === 'text' || statusDataType === 'character varying') {
        console.log("[providers] Provider.status is TEXT — converting to ProviderStatus enum...");
        await client.query(`UPDATE "Provider" SET "status" = 'PENDING' WHERE "status" IS NULL OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED')`);
        await client.query(`ALTER TABLE "Provider" ALTER COLUMN "status" TYPE "ProviderStatus" USING "status"::"ProviderStatus"`);
        console.log("[providers] Provider.status converted to ProviderStatus enum.");
      }
    } catch (statusErr) {
      // Don't swallow this — log loudly so we can debug if prisma.provider.create() fails
      console.error("[providers] Failed to convert Provider.status to ProviderStatus enum:", statusErr instanceof Error ? statusErr.message : statusErr);
    }

    await client.end();
  } catch (err) {
    try { await client.end(); } catch {}
    console.warn("[providers] ensureProviderColumns failed:", err instanceof Error ? err.message : err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureDatabase();

    const auth = await getAuthContext(req);
    // Both POLICE and SUPERUSER can list providers (guesthouses)
    if (auth.role !== "POLICE" && auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // ── Jurisdiction filter ──
    // CITY → sees all providers
    // SUBCITY → only providers in auth.subCity
    // WOREDA → only providers in auth.subCity + auth.woreda
    const jFilter = getJurisdictionFilter(auth);

    // Use raw SQL to avoid Prisma client schema mismatch issues
    const hasSubCity = !!jFilter.subCity;
    const hasWoreda = !!jFilter.woreda;
    const subCity = hasSubCity ? String(jFilter.subCity).replace(/'/g, "''") : "";
    const woreda = hasWoreda ? String(jFilter.woreda).replace(/'/g, "''") : "";

    const jurisdictionWhere = hasSubCity
      ? (hasWoreda
          ? `WHERE "subCity" = '${subCity}' AND "woreda" = '${woreda}'`
          : `WHERE "subCity" = '${subCity}'`)
      : "";

    const providers = await db.$queryRawUnsafe<{
      id: string; name: string; ownerName: string; phone: string; email: string;
      address: string; type: string; licenseNo: string; status: string;
      approvedBy: string | null; approvedAt: Date | null; rejectionReason: string;
      suspensionReason: string; suspendedAt: Date | null; suspendedBy: string;
      createdAt: Date; updatedAt: Date;
    }[]>(`
      SELECT
        "id", "name", "ownerName", "phone", "email", "address",
        "type", "licenseNo", "status",
        "approvedBy", "approvedAt", "rejectionReason",
        "suspensionReason", "suspendedAt", "suspendedBy",
        "createdAt", "updatedAt"
      FROM "Provider"
      ${jurisdictionWhere}
      ORDER BY "createdAt" DESC
    `);

    // Return with empty licenseFile so frontend type stays consistent
    const result = providers.map(p => ({ ...p, licenseFile: "" }));

    return NextResponse.json(result);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch providers";
    const status = message.includes("denied") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Ensure ALL Provider columns exist BEFORE any Prisma query.
    // This runs ALTER TABLE for each missing column via pg.Client with SSL.
    await ensureProviderColumns();
    await ensureDatabase();

    const contentType = req.headers.get("content-type") || "";

    // ── JSON body: SUPERUSER creating a guesthouse (auto-approved) ──
    if (contentType.includes("application/json")) {
      const auth = await getAuthContext(req);
      if (auth.role !== "SUPERUSER") {
        return NextResponse.json({ error: "Only superuser can create guesthouses directly" }, { status: 403 });
      }

      const body = await req.json();
      const { name, ownerName, phone, email, address, type, licenseNo, licenseFile, username, password, bedCount, subCity, woreda } = body;

      if (!name?.trim() || !ownerName?.trim() || !phone?.trim()) {
        return NextResponse.json(
          { error: "Guesthouse name, owner name, and phone are required" },
          { status: 400 }
        );
      }
      // License No is REQUIRED and must be unique across all guesthouses.
      // This is the legal business license number issued by the government —
      // no two guesthouses can share the same license.
      if (!licenseNo?.trim()) {
        return NextResponse.json(
          { error: "License No is required", code: "LICENSE_NO_REQUIRED" },
          { status: 400 }
        );
      }
      if (!isValidPhone(phone.trim())) {
        return NextResponse.json(
          { error: "Invalid phone number format. Use 7-15 digits with optional + prefix." },
          { status: 400 }
        );
      }
      if (email?.trim() && !isValidEmail(email.trim())) {
        return NextResponse.json(
          { error: "Invalid email address format" },
          { status: 400 }
        );
      }
      if (!username?.trim() || !password?.trim()) {
        return NextResponse.json(
          { error: "Operator username and password are required" },
          { status: 400 }
        );
      }

      // Username uniqueness (existing check)
      const existingUser = await db.user.findUnique({
        where: { username: username.trim() },
      });
      if (existingUser) {
        return NextResponse.json(
          { error: "Username is already taken" },
          { status: 409 }
        );
      }

      // License No uniqueness — enforced at API layer so we can return
      // a clean error message. The DB-level @unique constraint (added
      // in the schema migration) provides defense-in-depth against races.
      const existingLicense = await db.provider.findFirst({
        where: { licenseNo: licenseNo.trim() },
        select: { id: true, name: true },
      });
      if (existingLicense) {
        return NextResponse.json(
          {
            error: `License No "${licenseNo.trim()}" is already registered to another guesthouse (${existingLicense.name}).`,
            code: "LICENSE_NO_TAKEN",
            details: { licenseNo: licenseNo.trim(), existingProviderId: existingLicense.id },
          },
          { status: 409 }
        );
      }

      // Upload license file to blob storage if provided as base64
      let licenseFileUrl = "";
      if (typeof licenseFile === "string" && licenseFile.startsWith("data:")) {
        licenseFileUrl = await uploadFile(licenseFile, "licenses");
      } else if (typeof licenseFile === "string") {
        licenseFileUrl = licenseFile; // Already a URL from blob
      }

      const provider = await db.$transaction(async (tx) => {
        const p = await tx.provider.create({
          data: {
            name: name.trim(),
            ownerName: ownerName.trim(),
            phone: phone.trim(),
            email: email?.trim() || "",
            address: address?.trim() || "",
            type: type || "GUEST_HOUSE",
            licenseNo: licenseNo.trim(),
            licenseFile: licenseFileUrl,
            status: "APPROVED",
            approvedBy: auth.userId || auth.userName || "superuser",
            approvedAt: new Date(),
            bedCount: bedCount != null && !isNaN(Number(bedCount)) ? Number(bedCount) : null,
            subCity: subCity || "",
            woreda: woreda || "",
          },
        });

        const hashedPassword = await hashPassword(password.trim());

        await tx.user.create({
          data: {
            username: username.trim(),
            password: hashedPassword,
            role: "OPERATOR",
            name: ownerName.trim(),
            email: email?.trim() || null,
            phone: phone.trim(),
            providerId: p.id,
            isActive: true,
          },
        });

        return p;
      });

      return NextResponse.json(provider, { status: 201 });
    }

    // ── FormData body: Public registration (PENDING approval) ──
    const formData = await req.formData();

    const name = formData.get("name") as string;
    const ownerName = formData.get("ownerName") as string;
    const phone = formData.get("phone") as string;
    const email = (formData.get("email") as string) || "";
    const address = (formData.get("address") as string) || "";
    const latitude = parseFloat(formData.get("latitude") as string) || 9.02;
    const longitude = parseFloat(formData.get("longitude") as string) || 38.75;
    const type = (formData.get("type") as string) || "GUEST_HOUSE";
    const licenseNo = (formData.get("licenseNo") as string) || "";
    const licenseFile = formData.get("licenseFile") as File | null;
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    if (!name || !ownerName || !phone || !username || !password) {
      return NextResponse.json(
        { error: "name, ownerName, phone, username, and password are required" },
        { status: 400 }
      );
    }
    // License No is REQUIRED for public registration too — same constraint
    // as the superuser path. The license number is the legal business
    // identifier and must be present + unique.
    if (!licenseNo?.trim()) {
      return NextResponse.json(
        { error: "License No is required", code: "LICENSE_NO_REQUIRED" },
        { status: 400 }
      );
    }

    if (!isValidPhone(phone.trim())) {
      return NextResponse.json(
        { error: "Invalid phone number format. Use 7-15 digits with optional + prefix." },
        { status: 400 }
      );
    }
    if (email?.trim() && !isValidEmail(email.trim())) {
      return NextResponse.json(
        { error: "Invalid email address format" },
        { status: 400 }
      );
    }

    const existingUser = await db.user.findUnique({
      where: { username: username.trim() },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 409 }
      );
    }

    // License No uniqueness — same check as the superuser path.
    const existingLicense = await db.provider.findFirst({
      where: { licenseNo: licenseNo.trim() },
      select: { id: true, name: true },
    });
    if (existingLicense) {
      return NextResponse.json(
        {
          error: `License No "${licenseNo.trim()}" is already registered to another guesthouse (${existingLicense.name}).`,
          code: "LICENSE_NO_TAKEN",
          details: { licenseNo: licenseNo.trim(), existingProviderId: existingLicense.id },
        },
        { status: 409 }
      );
    }

    let licenseFileUrl = "";
    if (licenseFile) {
      const bytes = await licenseFile.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const mimeType = licenseFile.type || "application/octet-stream";
      const base64Uri = `data:${mimeType};base64,${buffer.toString("base64")}`;
      licenseFileUrl = await uploadFile(base64Uri, "licenses");
    }

    // ── Check the auto-approve system config setting ──
    // When autoApproveGuesthouses is enabled, new registrations are
    // immediately APPROVED (skip manual review). Otherwise PENDING.
    let autoApprove = false;
    try {
      const sysSettings = await db.settings.findFirst({
        where: { providerId: null },
      });
      if (!sysSettings) {
        console.log("[providers/register] No system config row found (providerId=null). autoApprove stays false.");
      } else if (sysSettings.configJson == null) {
        console.log("[providers/register] System config row exists but configJson is null. autoApprove stays false.");
      } else {
        // Prisma's Json? field should deserialize to an object. But some older
        // DB columns were TEXT — in that case Prisma returns a string. Parse
        // defensively so a TEXT-stored JSON still works.
        let config: Record<string, unknown>;
        if (typeof sysSettings.configJson === "string") {
          try { config = JSON.parse(sysSettings.configJson); }
          catch { console.warn("[providers/register] configJson is a string but not parseable:", sysSettings.configJson); config = {}; }
        } else if (typeof sysSettings.configJson === "object") {
          config = sysSettings.configJson as Record<string, unknown>;
        } else {
          console.warn("[providers/register] Unexpected configJson type:", typeof sysSettings.configJson);
          config = {};
        }
        const guesthouse = config.guesthouse as Record<string, unknown> | undefined;
        if (guesthouse && typeof guesthouse.autoApproveGuesthouses === "boolean") {
          autoApprove = guesthouse.autoApproveGuesthouses;
          console.log(`[providers/register] autoApprove resolved to ${autoApprove} from system config.`);
        } else {
          console.log("[providers/register] guesthouse.autoApproveGuesthouses missing or not a boolean. autoApprove stays false. config keys:", Object.keys(config));
        }
      }
    } catch (readErr) {
      // Non-blocking — log the real error so it's debuggable. Previously
      // this was `catch {}` which silently swallowed connection errors,
      // missing-column errors, etc. New registrations stayed PENDING and
      // the user had no idea why.
      console.error("[providers/register] Failed to read auto-approve system config:", readErr instanceof Error ? readErr.message : readErr);
    }

    const provider = await db.$transaction(async (tx) => {
      const p = await tx.provider.create({
        data: {
          name,
          ownerName,
          phone,
          email,
          address,
          latitude,
          longitude,
          type,
          licenseNo: licenseNo.trim(),
          licenseFile: licenseFileUrl,
          status: autoApprove ? "APPROVED" : "PENDING",
          ...(autoApprove ? { approvedBy: "SYSTEM", approvedAt: new Date() } : {}),
        },
      });

      const hashedPassword = await hashPassword(password);

      await tx.user.create({
        data: {
          username: username.trim(),
          password: hashedPassword,
          role: "OPERATOR",
          name: ownerName,
          providerId: p.id,
        },
      });

      return p;
    });

    return NextResponse.json(provider, { status: 201 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to register provider";
    // 400 = missing/required fields, 409 = uniqueness conflict (username or licenseNo taken)
    const status =
      message.includes("required") ? 400 :
      message.includes("taken") || message.includes("already registered") ? 409 :
      500;
    return NextResponse.json({ error: message }, { status });
  }
}
