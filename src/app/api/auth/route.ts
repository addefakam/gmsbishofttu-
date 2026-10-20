import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { hashPassword, verifyPassword, createToken, type JWTPayload } from "@/lib/auth-utils";

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

    // Prisma query with retry — Neon's free tier auto-suspends the database
    // after 5 min of inactivity. The first query attempt wakes up Neon but
    // may fail with "Can't reach database server". Retry after 5s should
    // succeed (Neon takes 5-10s to fully wake up).
    //
    // IMPORTANT: No ensureOwnerTables() or ensureDatabase() calls here.
    // Those create separate PrismaClient instances (in init-db.ts) that
    // each open their own connection — 4 extra connections × 5s timeout =
    // 20s of latency before the actual login query can run.
    let user = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        user = await db.user.findUnique({
          where: { username },
          select: {
            id: true, username: true, name: true, role: true,
            password: true, providerId: true, permissions: true,
            policeRank: true,
            jurisdictionType: true, subCity: true, woreda: true,
            provider: { select: { id: true, name: true, status: true } },
          },
        });
        break; // Success — exit the retry loop
      } catch (queryErr) {
        const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
        console.warn(`[auth] Query attempt ${attempt}/3 failed:`, errMsg);
        if (attempt < 3) {
          // Wait before retrying: 3s, then 5s
          const waitMs = attempt === 1 ? 3000 : 5000;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        } else {
          // All 3 attempts failed — return a user-friendly error
          console.error("[auth] All 3 query attempts failed.");
          return NextResponse.json(
            { error: "Database is starting up. Please wait a few seconds and try again." },
            { status: 503 }
          );
        }
      }
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
