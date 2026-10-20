import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase, resetInitFlag } from "@/lib/init-db";
import { ensureOwnerTables } from "@/lib/ensure-tables";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { hashPassword, verifyPassword, createToken, type JWTPayload } from "@/lib/auth-utils";

export async function POST(req: NextRequest) {
  try {
    // Ensure the new owner feature tables exist BEFORE any Prisma query
    // that touches the Provider model (which now has relations to these
    // tables). Without this, the auth query crashes because Prisma tries
    // to JOIN non-existent tables.
    await ensureOwnerTables();
    // Ensure database tables exist before any Prisma operation.
    resetInitFlag();
    await ensureDatabase();

    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username or password is not correct. Check it and try again." },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { username },
      select: {
        id: true, username: true, name: true, role: true,
        password: true, providerId: true, permissions: true,
        policeRank: true,
        jurisdictionType: true, subCity: true, woreda: true,
        provider: { select: { id: true, name: true, status: true } },
      },
    });

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

    // ── Auto-migrate: hash plain-text passwords in background (don't block response) ──
    if (!user.password.startsWith("$2")) {
      hashPassword(password).then((hashed) =>
        db.user.update({ where: { id: user.id }, data: { password: hashed } }).catch(() => {})
      );
    }

    const policeRank = user.policeRank || "";

    // POLICE and system admin SUPERUSER (no provider) can login directly
    if (user.role !== "POLICE" && user.providerId) {
      if (!user.provider || user.provider.status !== "APPROVED") {
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
      logAudit(req, { action: "LOGIN", targetId: user.id, targetType: "User", details: `Police login: ${user.username}` });
    }

    // ── Create JWT token ──
    const tokenPayload: JWTPayload = {
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      providerId: user.providerId,
      permissions,
      policeRank,
      providerName: user.provider?.name ?? undefined,
      jurisdictionType: user.jurisdictionType || "CITY",
      subCity: user.subCity || null,
      woreda: user.woreda || null,
    };

    const token = await createToken(tokenPayload);

    // ── Fetch public system config so client knows the support phone ──
    // Lets every toast.error() in the app append
    // "For help, call: <phone>" without an extra round-trip.
    let supportPhone = "";
    try {
      const sysSettings = await db.settings.findFirst({ where: { providerId: null } });
      if (sysSettings?.configJson && typeof sysSettings.configJson === "object") {
        const general = (sysSettings.configJson as Record<string, unknown>).general;
        if (general && typeof general === "object") {
          const phone = (general as Record<string, unknown>).supportPhone;
          if (typeof phone === "string") supportPhone = phone.trim();
        }
      }
    } catch {
      /* non-blocking — login still succeeds without support phone */
    }

    // Set token as httpOnly cookie (secure in production)
    const isProduction = process.env.NODE_ENV === "production";
    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        providerId: user.providerId,
        permissions,
        policeRank,
        jurisdictionType: user.jurisdictionType || "CITY",
        subCity: user.subCity || null,
        woreda: user.woreda || null,
      },
      providerName: user.provider?.name ?? null,
      supportPhone,
    });

    response.cookies.set("ghms_token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return response;
  } catch (error) {
    console.error("[auth] Login error:", error);
    console.error("[auth] Error stack:", error instanceof Error ? error.stack : 'no stack');
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// ── Logout endpoint ──
export async function DELETE() {
  const isProduction = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ success: true });
  // Clear primary session
  response.cookies.set("ghms_token", "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  // Also clear joint session if active
  response.cookies.set("ghms_token_joint", "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
