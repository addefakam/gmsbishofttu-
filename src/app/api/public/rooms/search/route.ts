import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";

/**
 * GET /api/public/rooms/search
 *
 * Public endpoint — NO AUTH REQUIRED.
 *
 * Searches for available rooms across all APPROVED guesthouses.
 * Guests can filter by:
 *   - checkIn + checkOut (date range — only shows rooms that are available)
 *   - roomType (SINGLE, DOUBLE, SUITE, etc.)
 *   - minPrice + maxPrice (price per night range)
 *   - subCity (Bishoftu sub-city: Debaayyuu, Chalaleka, Xxulaa)
 *
 * Returns rooms with their guesthouse (Provider) info.
 *
 * Response shape:
 *   [
 *     {
 *       id, number, name, type, pricePerNight, pricePerNightWeekend,
 *       floor, capacity, amenities, description, image,
 *       provider: { id, name, phone, address, subCity },
 *       available: boolean  // false if overlapping reservation exists
 *     }
 *   ]
 */
export async function GET(req: NextRequest) {
  try {
    // Ensure schema integrity before any Prisma query.
    await ensureReservationIntegrity();
    await ensureProviderStatusEnum();

    const url = new URL(req.url);
    const checkIn = url.searchParams.get("checkIn");   // YYYY-MM-DD
    const checkOut = url.searchParams.get("checkOut"); // YYYY-MM-DD
    const roomType = url.searchParams.get("roomType"); // SINGLE, DOUBLE, etc.
    const minPrice = url.searchParams.get("minPrice");
    const maxPrice = url.searchParams.get("maxPrice");
    const subCity = url.searchParams.get("subCity");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

    // Build the WHERE clause for rooms.
    const where: Record<string, unknown> = {
      // Only rooms from APPROVED providers (visible to public).
      provider: { status: "APPROVED" },
    };

    if (roomType) {
      // Cast to enum type — Prisma's RoomType is the enum, but the namespace
      // export may not be available depending on Prisma version. Use a
      // raw cast to be safe.
      (where as Record<string, unknown>).type = roomType;
    }

    if (minPrice || maxPrice) {
      const priceFilter: Record<string, number> = {};
      if (minPrice) priceFilter.gte = parseFloat(minPrice);
      if (maxPrice) priceFilter.lte = parseFloat(maxPrice);
      where.pricePerNight = priceFilter;
    }

    if (subCity) {
      where.provider = { status: "APPROVED", subCity };
    }

    // Fetch rooms with provider info.
    const rooms = await db.room.findMany({
      where: where as any,
      select: {
        id: true,
        number: true,
        name: true,
        type: true,
        pricePerNight: true,
        pricePerNightWeekend: true,
        floor: true,
        capacity: true,
        amenities: true,
        description: true,
        image: true,
        providerId: true,
        provider: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            subCity: true,
            woreda: true,
            latitude: true,
            longitude: true,
          },
        },
      },
      orderBy: { pricePerNight: "asc" },
      take: limit,
    });

    // If no date range provided, return all rooms marked as "available"
    // (no overlap check — guest hasn't picked dates yet).
    if (!checkIn || !checkOut) {
      const result = rooms.map((r) => ({
        ...r,
        available: true, // unknown without dates
        amenitiesList: r.amenities
          ? r.amenities.split(",").map((a) => a.trim()).filter(Boolean)
          : [],
      }));
      return NextResponse.json({ rooms: result, total: result.length });
    }

    // Date range provided — check availability for each room.
    // A room is available if NO existing reservation overlaps with
    // [checkIn, checkOut). Overlap condition:
    //   existing.checkIn < new.checkOut AND existing.checkOut > new.checkIn
    //
    // Only reservations with status UPCOMING or ACTIVE block availability.
    // (COMPLETED, CANCELLED, DELETED don't block.)
    const overlappingReservations = await db.reservation.findMany({
      where: {
        status: { in: ["UPCOMING", "ACTIVE"] },
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { roomId: true },
    });
    const bookedRoomIds = new Set(overlappingReservations.map((r) => r.roomId));

    const result = rooms.map((r) => ({
      ...r,
      available: !bookedRoomIds.has(r.id),
      amenitiesList: r.amenities
        ? r.amenities.split(",").map((a) => a.trim()).filter(Boolean)
        : [],
    }));

    return NextResponse.json({ rooms: result, total: result.length });
  } catch (error: unknown) {
    console.error("[public/rooms/search] Error:", error);
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message, rooms: [], total: 0 }, { status: 500 });
  }
}
