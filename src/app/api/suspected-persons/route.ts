import { checkPolicePermission } from "@/lib/police-module-permissions";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { requirePoliceMinRank } from "@/lib/police-permissions";
import { ensureSuspectTables } from "@/lib/suspect-check";
import { Prisma } from "@prisma/client";
import { isValidPhone } from "@/lib/utils";
import { normalizeIdType } from "@/lib/national-id";
import { normalizeNationality } from "@/lib/nationalities";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 5;

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);
    const permError = checkPolicePermission(auth, "police_suspects");
    if (permError) return NextResponse.json({ error: permError }, { status: 403 });
    await ensureSuspectTables();

    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const severity = searchParams.get("severity") || "";
    const activeOnly = searchParams.get("active") !== "false";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE)))
    );
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (q) {
      // ID-only search: match against SuspectId table and legacy idNumber field
      const matchingIdPersons = await db.$queryRaw<{ suspectedPersonId: string }[]>(
        Prisma.sql`SELECT DISTINCT "suspectedPersonId" FROM "SuspectId" WHERE LOWER("idNumber") LIKE LOWER(${`%${q}%`})`
      );
      const idsFromIdTable = matchingIdPersons.map(r => r.suspectedPersonId);

      const orConditions: Record<string, unknown>[] = [
        { idNumber: { contains: q } },
      ];
      if (idsFromIdTable.length > 0) {
        orConditions.push({ id: { in: idsFromIdTable } });
      }
      where.OR = orConditions;
    }
    if (severity) {
      where.severity = severity;
    }
    if (activeOnly) {
      where.is_active = true;
    }

    const [persons, total] = await Promise.all([
      db.suspectedPerson.findMany({
        where,
        include: {
          _count: { select: { matches: true } },
          matches: {
            orderBy: { createdAt: "desc" },
            take: 1, // Latest match only — for "recently flagged" indicator
            select: {
              id: true,
              guestName: true,
              guestPhone: true,
              providerName: true,
              reservationId: true,
              matchType: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.suspectedPerson.count({ where }),
    ]);

    // Fetch all IDs for the returned persons + latest match reservation status
    if (persons.length > 0) {
      const personIds = persons.map(p => p.id);
      const allIds = await db.$queryRaw<
        { id: string; suspectedPersonId: string; idType: string; idNumber: string; createdAt: string }[]
      >(
        Prisma.sql`SELECT * FROM "SuspectId" WHERE "suspectedPersonId" IN (${Prisma.join(personIds)}) ORDER BY "createdAt" ASC`
      );

      // Group IDs by person
      const idsByPerson: Record<string, { idType: string; idNumber: string }[]> = {};
      for (const sid of allIds) {
        if (!idsByPerson[sid.suspectedPersonId]) idsByPerson[sid.suspectedPersonId] = [];
        idsByPerson[sid.suspectedPersonId].push({ idType: sid.idType, idNumber: sid.idNumber });
      }

      // Attach IDs + latest match reservation status to each person
      for (const p of persons) {
        (p as Record<string, unknown>).identifiers = idsByPerson[p.id] || [];

        // If this person has a latest match with a reservationId, fetch its current status
        const latestMatch = p.matches?.[0];
        if (latestMatch?.reservationId) {
          try {
            const res = await db.reservation.findUnique({
              where: { id: latestMatch.reservationId },
              select: { status: true, checkIn: true, checkOut: true, room: { select: { number: true } } },
            });
            if (res) {
              (p as Record<string, unknown>).latestMatchReservationStatus = res.status;
              (p as Record<string, unknown>).latestMatchReservationCheckIn = res.checkIn;
              (p as Record<string, unknown>).latestMatchReservationRoom = res.room?.number || "";
            }
          } catch { /* ignore — non-critical */ }
        }
      }
    }

    return NextResponse.json({
      persons,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: unknown) {
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
      }
    const message = error instanceof Error ? error.message : "Failed to fetch suspected persons";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);
    const permError = checkPolicePermission(auth, "police_suspects");
    if (permError) return NextResponse.json({ error: permError }, { status: 403 });
    requirePoliceMinRank(auth, "DETECTIVE");
    await ensureSuspectTables();

    const body = await req.json();
    const { name, phone, idNumber, idType, nationality, address, description, severity, identifiers } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (phone && !isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone number format. Use 7-15 digits with optional + prefix." }, { status: 400 });
    }

    // Keep the legacy single idNumber/idType for backwards compat.
    // Normalize the idType so suspect records use the same canonical
    // forms as guests ("National ID" / "Kebele ID" / "Passport" /
    // "Driver's License" / "Other"). Previously this stored the raw
    // frontend value, and the fallback at line 184 was "National_ID"
    // (with underscore) — a totally unique string that didn't match
    // anything else in the system.
    const primaryId = idNumber || "";
    const primaryIdType = normalizeIdType(idType || "") || "";

    // ── INSERT via raw SQL with literal+caset — bypass Prisma's runtime
    //    validator AND handle both TEXT and enum column types ──
    //
    // Why this is needed:
    // 1. Prisma's runtime type validator still has cached enum metadata
    //    after commit 6e0c0cf changed severity from SuspectSeverity enum
    //    to String. Native db.suspectedPerson.create() fails with:
    //      "Error converting field 'severity' of expected non-nullable
    //       type 'String', found incompatible value of 'CRITICAL'"
    // 2. Different DBs have different column states:
    //      - Some: severity column is TEXT (older deploy, before enum
    //        types were set up)
    //      - Others: severity column is SuspectSeverity enum (newer
    //        deploy, enum types created first)
    //    A parameterized INSERT (db.$executeRawUnsafe with $1) sends the
    //    value as text via the extended query protocol — Postgres can't
    //    cast text → enum implicitly → 42804 error.
    //
    // Solution: validate severity against a whitelist, INLINE it as a
    // SQL literal with explicit cast. Safe because enum values come
    // from a closed set (no SQL injection risk).
    const VALID_SUSPECT_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    const safeSeverity = VALID_SUSPECT_SEVERITIES.has(String(severity || "").toUpperCase())
      ? String(severity || "").toUpperCase()
      : "MEDIUM";

    const personId = `sus_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // Other (non-enum) parameters — still parameterized for safety.
    const otherParams = [
      personId, name.trim(), phone || "", primaryId,
      primaryIdType, normalizeNationality(nationality || ""),
      address || "", description || "", auth.role,
    ];

    // Attempt 1: with cast (works for enum column)
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "SuspectedPerson"
          ("id", "name", "phone", "idNumber", "idType", "nationality",
           "address", "description", "severity", "is_active", "registeredBy",
           "createdAt", "updatedAt")
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, '${safeSeverity}'::"SuspectSeverity",
           true, $9, NOW(), NOW())`,
        ...otherParams
      );
    } catch (castErr: unknown) {
      const castMsg = castErr instanceof Error ? castErr.message : String(castErr);
      const enumTypeMissing = castMsg.includes('type "SuspectSeverity" does not exist') || castMsg.includes('SuspectSeverity does not exist');
      const otherCastError = castMsg.includes("42804") || (castMsg.includes("is of type") && castMsg.includes("but expression is of type"));

      if (enumTypeMissing || otherCastError) {
        // Attempt 2: no cast (works for TEXT column)
        console.log(`[suspected-persons POST] Cast INSERT failed (column is TEXT or enum type missing). Retrying without cast. Error: ${castMsg}`);
        try {
          await db.$executeRawUnsafe(
            `INSERT INTO "SuspectedPerson"
              ("id", "name", "phone", "idNumber", "idType", "nationality",
               "address", "description", "severity", "is_active", "registeredBy",
               "createdAt", "updatedAt")
             VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, '${safeSeverity}',
               true, $9, NOW(), NOW())`,
            ...otherParams
          );
        } catch (noCastErr: unknown) {
          // Both paths failed — re-throw the no-cast error (more useful
          // for debugging since it shows the actual column state).
          throw noCastErr;
        }
      } else {
        throw castErr;
      }
    }

    // Fetch the created record (also via raw SQL to stay consistent).
    const persons = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "SuspectedPerson" WHERE "id" = $1`,
      personId
    );
    const person = persons[0] ?? { id: personId };

    // matches count — also via raw SQL (avoids Prisma model includes)
    let matchCount = 0;
    try {
      const mc = await db.$queryRawUnsafe<Array<{ count: bigint | number }>>(
        `SELECT COUNT(*)::int AS count FROM "SuspectMatch" WHERE "suspectedPersonId" = $1`,
        personId
      );
      matchCount = Number(mc[0]?.count ?? 0);
    } catch {}
    (person as Record<string, unknown>)._count = { matches: matchCount };

    // Create SuspectId records for all provided identifiers — also
    // normalized so multi-ID suspects have consistent types.
    const idsToCreate: { idType: string; idNumber: string }[] = [];
    if (Array.isArray(identifiers) && identifiers.length > 0) {
      for (const ident of identifiers) {
        if (ident.idNumber && ident.idNumber.trim()) {
          idsToCreate.push({
            idType: normalizeIdType(ident.idType || "") || "Other",
            idNumber: ident.idNumber.trim(),
          });
        }
      }
    }
    // Also create from legacy fields if not already in the list.
    // Fallback type changed from "National_ID" (with underscore, broken)
    // to the canonical "National ID" (with space).
    if (primaryId && !idsToCreate.some(i => i.idNumber.toLowerCase() === primaryId.toLowerCase())) {
      idsToCreate.unshift({ idType: primaryIdType || "National ID", idNumber: primaryId });
    }

    for (const sid of idsToCreate) {
      try {
        await db.$executeRaw(Prisma.sql`
          INSERT INTO "SuspectId" ("id", "suspectedPersonId", "idType", "idNumber", "createdAt")
          VALUES (gen_random_uuid()::text, ${person.id}, ${sid.idType}, ${sid.idNumber}, CURRENT_TIMESTAMP)
          ON CONFLICT ("idNumber", "idType") DO NOTHING
        `);
      } catch {
        // Skip duplicate IDs silently
      }
    }

    // Fetch the created IDs to return
    const createdIds = await db.$queryRaw<{ idType: string; idNumber: string }[]>(
      Prisma.sql`SELECT "idType", "idNumber" FROM "SuspectId" WHERE "suspectedPersonId" = ${person.id} ORDER BY "createdAt" ASC`
    );

    return NextResponse.json({
      ...person,
      identifiers: createdIds,
    }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to create suspected person";
    const status = message.includes("Police") ? 403 : message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
