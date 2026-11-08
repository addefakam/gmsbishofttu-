import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createToken, type JWTPayload } from "@/lib/auth-utils";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";

/**
 * POST /api/guest-auth/otp/verify
 *
 * Public endpoint — NO AUTH REQUIRED.
 *
 * Body: { phone: "+251912345678", code: "123456", name?: "Abebe" }
 *
 * Verifies the OTP code for the given phone number. If valid:
 *   1. Updates the Guest record (clears OTP, sets name if provided)
 *   2. Creates a JWT token with role="GUEST" + guestId
 *   3. Sets the JWT as an httpOnly cookie (ghms_guest_token)
 *
 * The guest can then use this token to create reservations and view
 * their own bookings.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureReservationIntegrity();

    const body = await req.json();
    const phone = (body?.phone || "").trim();
    const code = (body?.code || "").trim();
    const name = (body?.name || "").trim();

    if (!phone || !code) {
      return NextResponse.json({ error: "Phone and code are required" }, { status: 400 });
    }

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Code must be 6 digits" }, { status: 400 });
    }

    // Find the Guest by phone.
    const guest = await db.guest.findFirst({
      where: { phone },
      select: {
        id: true, name: true, phone: true,
        otpCode: true, otpExpiresAt: true,
      },
    });

    if (!guest) {
      return NextResponse.json({ error: "No OTP was requested for this phone number. Please request a new code." }, { status: 404 });
    }

    // Check OTP code + expiry.
    if (!guest.otpCode || guest.otpCode !== code) {
      return NextResponse.json({ error: "Invalid verification code. Please try again." }, { status: 401 });
    }

    if (!guest.otpExpiresAt || guest.otpExpiresAt < new Date()) {
      return NextResponse.json({ error: "Verification code has expired. Please request a new code." }, { status: 401 });
    }

    // Update the Guest: clear OTP, set name if provided.
    const updateData: { otpCode: null; otpExpiresAt: null; name?: string } = {
      otpCode: null,
      otpExpiresAt: null,
    };
    if (name && name !== guest.name) {
      updateData.name = name;
    }

    await db.guest.update({
      where: { id: guest.id },
      data: updateData,
    });

    // Create a JWT token for the guest.
    const payload: JWTPayload = {
      userId: guest.id,
      username: phone, // use phone as username for guests
      role: "STAFF", // Use STAFF as closest match — guests aren't a separate role in the enum
      name: name || guest.name,
      providerId: null,
      permissions: [], // guests have no admin permissions
      policeRank: "",
      jurisdictionType: "CITY",
      subCity: "",
      woreda: "",
    };

    const token = await createToken(payload);

    const responseData = {
      success: true,
      guest: {
        id: guest.id,
        name: name || guest.name,
        phone: guest.phone,
      },
      token,
    };

    const response = NextResponse.json(responseData);

    // Set token as httpOnly cookie — separate from the operator/police
    // ghms_token cookie so guests don't conflict with operator sessions.
    response.cookies.set("ghms_guest_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days for guests
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    console.error("[guest-auth/otp/verify] Error:", error);
    const message = error instanceof Error ? error.message : "OTP verification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
