import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";

/**
 * GET /api/public/rooms/[id]
 *
 * Public endpoint — NO AUTH REQUIRED.
 *
 * Returns full details for a single room + its guesthouse (Provider).
 * Used by the room detail sheet in the guest finder app.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureReservationIntegrity();
    await ensureProviderStatusEnum();

    const { id } = await params;

    const room = await db.room.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        name: true,
        type: true,
        pricePerNight: true,
        pricePerNightWeekend: true,
        floor: true,
        capacity: true,
        status: true,
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
            status: true,
          },
        },
      },
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Don't expose rooms from non-APPROVED providers (pending/rejected/suspended)
    const providerStatus = room.provider.status;
    if (providerStatus !== "APPROVED") {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...room,
      amenitiesList: room.amenities
        ? room.amenities.split(",").map((a) => a.trim()).filter(Boolean)
        : [],
    });
  } catch (error: unknown) {
    console.error("[public/rooms/[id]] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch room";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
