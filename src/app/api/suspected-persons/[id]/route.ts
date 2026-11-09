import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { requirePoliceMinRank } from "@/lib/police-permissions";
import { ensureSuspectTables } from "@/lib/suspect-check";
import { Prisma } from "@prisma/client";
import { isValidPhone } from "@/lib/utils";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[[id]] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);
    await ensureSuspectTables();

    const { id } = await params;
    const person = await db.suspectedPerson.findUnique({
      where: { id },
      include: {
        matches: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        _count: { select: { matches: true } },
      },
    });

    if (!person) {
      return NextResponse.json({ error: "Suspected person not found" }, { status: 404 });
    }

    // Fetch all identifiers
    const identifiers = await db.$queryRaw<
      { id: string; idType: string; idNumber: string }[]
    >(
      Prisma.sql`SELECT "idType", "idNumber", "id" FROM "SuspectId" WHERE "suspectedPersonId" = ${id} ORDER BY "createdAt" ASC`
    );

    // Fetch the CURRENT reservation status for each match's reservationId
    // so the police can see ALL places this person has been flagged, with
    // their current status (Upcoming / Checked-in / Completed / Cancelled).
    const reservationIds = person.matches
      .map((m) => m.reservationId)
      .filter((rid): rid is string => !!rid);

    const reservationStatuses: Record<string, {
      status: string; checkIn: string; checkOut: string;
      roomNumber: string; guestName: string; providerName: string;
    }> = {};

    if (reservationIds.length > 0) {
      const reservations = await db.reservation.findMany({
        where: { id: { in: reservationIds } },
        select: {
          id: true,
          status: true,
          checkIn: true,
          checkOut: true,
          room: { select: { number: true } },
          guest: { select: { name: true } },
          provider: { select: { name: true } },
        },
      });
      for (const r of reservations) {
        reservationStatuses[r.id] = {
          status: r.status,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          roomNumber: r.room?.number || "",
          guestName: r.guest?.name || "",
          providerName: r.provider?.name || "",
        };
      }
    }

    // Attach the live reservation status to each match
    const matchesWithStatus = person.matches.map((m) => {
      const resInfo = m.reservationId ? reservationStatuses[m.reservationId] : null;
      return {
        ...m,
        reservationStatus: resInfo?.status || null,
        reservationCheckIn: resInfo?.checkIn || null,
        reservationCheckOut: resInfo?.checkOut || null,
        reservationRoomNumber: resInfo?.roomNumber || null,
        reservationProviderName: resInfo?.providerName || m.providerName || "",
      };
    });

    return NextResponse.json({
      ...person,
      matches: matchesWithStatus,
      identifiers,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch suspected person";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[[id]] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);
    requirePoliceMinRank(auth, "DETECTIVE");
    await ensureSuspectTables();

    const { id } = await params;
    const body = await req.json();
    const { name, phone, idNumber, idType, nationality, address, description, severity, is_active, identifiers } = body;

    if (phone !== undefined && phone && !isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone number format. Use 7-15 digits with optional + prefix." }, { status: 400 });
    }

    const person = await db.suspectedPerson.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(phone !== undefined ? { phone: phone } : {}),
        ...(idNumber !== undefined ? { idNumber: idNumber } : {}),
        ...(idType !== undefined ? { idType: idType } : {}),
        ...(nationality !== undefined ? { nationality: nationality } : {}),
        ...(address !== undefined ? { address: address } : {}),
        ...(description !== undefined ? { description: description } : {}),
        ...(severity !== undefined ? { severity: severity } : {}),
        ...(is_active !== undefined ? { is_active: is_active } : {}),
      },
      include: {
        _count: { select: { matches: true } },
      },
    });

    // If identifiers array is provided, replace all IDs
    if (Array.isArray(identifiers)) {
      // Delete existing IDs
      await db.$executeRaw(Prisma.sql`DELETE FROM "SuspectId" WHERE "suspectedPersonId" = ${id}`);

      // Also update legacy field with first ID if provided
      if (identifiers.length > 0 && identifiers[0].idNumber) {
        await db.suspectedPerson.update({
          where: { id },
          data: { idNumber: identifiers[0].idNumber, idType: identifiers[0].idType || "National_ID" },
        });
      }

      // Create new IDs
      for (const ident of identifiers) {
        if (ident.idNumber && ident.idNumber.trim()) {
          try {
            await db.$executeRaw(Prisma.sql`
              INSERT INTO "SuspectId" ("id", "suspectedPersonId", "idType", "idNumber", "createdAt")
              VALUES (gen_random_uuid()::text, ${id}, ${ident.idType || "Other"}, ${ident.idNumber.trim()}, CURRENT_TIMESTAMP)
              ON CONFLICT ("idNumber", "idType") DO NOTHING
            `);
          } catch {
            // Skip duplicates
          }
        }
      }
    }

    // Fetch updated identifiers
    const updatedIds = await db.$queryRaw<
      { id: string; idType: string; idNumber: string }[]
    >(
      Prisma.sql`SELECT "idType", "idNumber", "id" FROM "SuspectId" WHERE "suspectedPersonId" = ${id} ORDER BY "createdAt" ASC`
    );

    return NextResponse.json({ ...person, identifiers: updatedIds });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to update suspected person";
    const status = message.includes("Police") ? 403 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[[id]] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);
    requirePoliceMinRank(auth, "DETECTIVE");
    await ensureSuspectTables();

    const { id } = await params;
    // Delete IDs first, then matches, then the person (cascade should handle this but be safe)
    await db.$executeRaw(Prisma.sql`DELETE FROM "SuspectId" WHERE "suspectedPersonId" = ${id}`);
    await db.suspectMatch.deleteMany({ where: { suspectedPersonId: id } });
    await db.suspectedPerson.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to delete suspected person";
    const status = message.includes("Police") ? 403 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
