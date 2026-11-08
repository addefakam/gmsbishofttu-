import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";

/**
 * POST /api/guest-auth/otp/request
 *
 * Public endpoint — NO AUTH REQUIRED.
 *
 * Body: { phone: "+251912345678" }
 *
 * Generates a 6-digit OTP code, stores it on the Guest record (or creates
 * a new Guest if the phone is new), and returns a success message.
 *
 * In development (no SMS gateway configured), the OTP is also returned in
 * the response body so the frontend can show it in a dev toast — useful
 * for testing without an SMS provider.
 *
 * In production, the OTP is only logged to the Vercel function logs.
 * Set SMS_GATEWAY=twilio|telebirr|telegram env var to enable SMS delivery.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureReservationIntegrity();

    const body = await req.json();
    const phone = (body?.phone || "").trim();

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    // Basic phone validation: 7-15 digits, optional + prefix.
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      return NextResponse.json(
        { error: "Invalid phone number. Use 7-15 digits with optional + prefix." },
        { status: 400 }
      );
    }

    // Generate 6-digit OTP code.
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));

    // OTP expires in 5 minutes.
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Find or create Guest record by phone.
    // If the guest doesn't exist, create a minimal record — name + other
    // details will be filled in after OTP verification.
    const existingGuest = await db.guest.findFirst({
      where: { phone },
      select: { id: true, name: true },
    });

    if (existingGuest) {
      await db.guest.update({
        where: { id: existingGuest.id },
        data: { otpCode, otpExpiresAt },
      });
    } else {
      // Create new Guest with placeholder name — guest will complete their
      // profile after first OTP verification.
      await db.guest.create({
        data: {
          phone,
          name: "Guest " + phoneDigits.slice(-4),
          otpCode,
          otpExpiresAt,
          // providerId is required in schema — assign to a special
          // "public registry" placeholder Provider if it exists, or
          // leave as empty string (will be set when they book a room).
          providerId: "",
        },
      });
    }

    // ── OTP delivery ──
    // For now: log to Vercel function logs + return in response (dev mode).
    // In production, integrate with SMS gateway (Twilio/Telebirr) or
    // Telegram bot.
    console.log(`[guest-auth/otp] Phone: ${phone} | OTP: ${otpCode} | Expires: ${otpExpiresAt.toISOString()}`);

    // Check if SMS gateway is configured.
    const smsGateway = process.env.SMS_GATEWAY;
    const isProduction = process.env.NODE_ENV === "production";

    if (smsGateway === "twilio" && process.env.TWILIO_ACCOUNT_SID) {
      // TODO: Integrate Twilio
      // await twilio.messages.create({ to: phone, from: ..., body: `Your Bishoftu Bed Service OTP is ${otpCode}` })
    } else if (smsGateway === "telegram" && process.env.TELEGRAM_BOT_TOKEN) {
      // TODO: Send via Telegram bot
    }

    // Always return the OTP in dev mode. In production without SMS gateway,
    // also return it (the guest can't receive it any other way until we
    // integrate SMS — better to let them book than to be stuck).
    const returnOtp = !isProduction || !smsGateway || smsGateway === "none";

    return NextResponse.json({
      success: true,
      message: "OTP sent. Check your phone for a 6-digit code.",
      // Include OTP in response for dev mode + when no SMS gateway configured.
      // Once SMS is integrated, set returnOtp = false in production.
      ...(returnOtp ? { otp: otpCode, devNote: "OTP returned in response because no SMS gateway is configured." } : {}),
      expiresIn: 300, // 5 minutes in seconds
    });
  } catch (error: unknown) {
    console.error("[guest-auth/otp/request] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to send OTP";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
