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
 * Returns rooms GROUPED BY PROVIDER — each provider has its own array
 * of rooms. This makes it easy for the frontend to display:
 *   - Provider 1 (Debaayyuu) → 5 rooms
 *   - Provider 2 (Chalaleka) → 8 rooms
 *   - etc.
 *
 * Response shape:
 *   {
 *     providers: Array<{
 *       id, name, phone, email, address, subCity, woreda, latitude, longitude,
 *       rooms: Array<Room>
 *     }>,
 *     totalProviders: number,
 *     totalRooms: number
 *   }
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

    // Build the WHERE clause for rooms.
    const where: Record<string, unknown> = {
      // Only rooms from APPROVED providers (visible to public).
      provider: { status: "APPROVED" },
    };

    if (roomType) {
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

    // Fetch ALL rooms with provider info (no limit — show everything).
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
      // Sort by provider name first, then by room number — so when we
      // group, rooms from the same provider appear together.
      orderBy: [
        { provider: { name: "asc" } },
        { number: "asc" },
      ],
    });

    // If dates provided, find overlapping reservations to mark availability.
    let bookedRoomIds = new Set<string>();
    if (checkIn && checkOut) {
      const overlappingReservations = await db.reservation.findMany({
        where: {
          status: { in: ["UPCOMING", "ACTIVE"] },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
        },
        select: { roomId: true },
      });
      bookedRoomIds = new Set(overlappingReservations.map((r) => r.roomId));
    }

    // Group rooms by provider.
    const providersMap = new Map<string, {
      id: string; name: string; phone: string; email: string;
      address: string; subCity: string | null; woreda: string | null;
      latitude: number | null; longitude: number | null;
      rooms: any[];
    }>();

    for (const r of rooms) {
      const p = r.provider;
      if (!providersMap.has(p.id)) {
        providersMap.set(p.id, {
          id: p.id, name: p.name, phone: p.phone, email: p.email,
          address: p.address, subCity: p.subCity, woreda: p.woreda,
          latitude: p.latitude, longitude: p.longitude,
          rooms: [],
        });
      }
      providersMap.get(p.id)!.rooms.push({
        id: r.id,
        number: r.number,
        name: r.name,
        type: r.type,
        pricePerNight: r.pricePerNight,
        pricePerNightWeekend: r.pricePerNightWeekend,
        floor: r.floor,
        capacity: r.capacity,
        amenities: r.amenities,
        description: r.description,
        image: r.image,
        providerId: r.providerId,
        // available = true if no overlap (or no dates provided → all available)
        available: !bookedRoomIds.has(r.id),
        amenitiesList: r.amenities
          ? r.amenities.split(",").map((a) => a.trim()).filter(Boolean)
          : [],
      });
    }

    const providers = Array.from(providersMap.values());

    return NextResponse.json({
      providers,
      totalProviders: providers.length,
      totalRooms: rooms.length,
    });
  } catch (error: unknown) {
    console.error("[public/rooms/search] Error:", error);
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message, providers: [], totalProviders: 0, totalRooms: 0 }, { status: 500 });
  }
}
