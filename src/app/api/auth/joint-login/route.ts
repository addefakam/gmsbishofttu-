import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/init-db";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { verifyPassword, createToken, type JWTPayload } from "@/lib/auth-utils";

/**
 * POST /api/auth/joint-login
 *
 * Concurrent Dual Session login (Technique 1):
 * - Requires the primary `ghms_token` cookie to already exist (SUPERUSER or POLICE ADMIN)
 * - Validates a SECOND set of credentials for the complementary role
 * - Sets `ghms_token_joint` cookie for the second session
 * - Both SUPERUSER + POLICE(ADMIN) must be present for joint session to activate
 */
export async function POST(req: NextRequest) {
  try {
    await ensureDatabase();

    // ── 1. Verify primary session exists ──
    const primaryToken = req.cookies.get("ghms_token")?.value;
    if (!primaryToken) {
      return NextResponse.json(
        { error: "No primary session found. Please log in first." },
        { status: 401 }
      );
    }

    const { verifyToken } = await import("@/lib/auth-utils");
    const primaryPayload = await verifyToken(primaryToken);
    if (!primaryPayload) {
      return NextResponse.json(
        { error: "Primary session expired. Please log in again." },
        { status: 401 }
      );
    }

    // ── 2. Parse second credentials ──
    const body = await req.json();
    const { username, password } = body;
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username or password is not correct. Check it and try again." },
        { status: 400 }
      );
    }

    // ── 3. Look up second user ──
    const secondUser = await db.user.findUnique({
      where: { username },
      include: { provider: true },
    });

    if (!secondUser) {
      return NextResponse.json(
        { error: "Username or password is not correct. Check it and try again." },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, secondUser.password);
    if (!valid) {
      return NextResponse.json(
        { error: "Username or password is not correct. Check it and try again." },
        { status: 401 }
      );
    }

    // SECURITY FIX (C-05): Removed plain-text auto-migration.
    // verifyPassword() now REJECTS non-bcrypt passwords.
    // If a user has a plain-text password, they must reset it via
    // the password reset flow (admin generates a reset link).

    // ── 4. Validate role combination: one must be SUPERUSER, other must be POLICE(ADMIN) ──
    const primaryRole = primaryPayload.role;
    const secondRole = secondUser.role;
    const primaryRank = primaryPayload.policeRank || "";
    const secondRank = secondUser.policeRank || "";

    const isPrimarySuperuser = primaryRole === "SUPERUSER";
    const isPrimaryPoliceAdmin = primaryRole === "POLICE" && primaryRank === "ADMIN";
    const isSecondSuperuser = secondRole === "SUPERUSER";
    const isSecondPoliceAdmin = secondRole === "POLICE" && secondRank === "ADMIN";

    // Both must be SUPERUSER + POLICE(ADMIN) in some order
    const validCombo =
      (isPrimarySuperuser && isSecondPoliceAdmin) ||
      (isPrimaryPoliceAdmin && isSecondSuperuser);

    if (!validCombo) {
      return NextResponse.json(
        {
          error:
            "Joint session requires one SUPERUSER and one Police ADMIN account. " +
            "One of you must be the System Admin, and the other must be a Police Administrator.",
        },
        { status: 403 }
      );
    }

    // ── 5. Check for duplicate (same user trying to log in twice) ──
    if (primaryPayload.userId === secondUser.id) {
      return NextResponse.json(
        { error: "You cannot log in as the same user twice. The second login must be a different account." },
        { status: 400 }
      );
    }

    // ── 6. Create joint session token ──
    let permissions: string[] = [];
    try {
      permissions = JSON.parse(secondUser.permissions);
    } catch {
      permissions = [];
    }

    const jointPayload: JWTPayload = {
      userId: secondUser.id,
      username: secondUser.username,
      name: secondUser.name,
      role: secondUser.role,
      providerId: secondUser.providerId,
      permissions,
      policeRank: secondUser.policeRank || "",
      providerName: secondUser.provider?.name ?? undefined,
    };

    const jointToken = await createToken(jointPayload);

    // ── 7. Set joint cookie ──
    const isProduction = process.env.NODE_ENV === "production";
    const response = NextResponse.json({
      success: true,
      message: "Joint session activated!",
      jointUser: {
        id: secondUser.id,
        username: secondUser.username,
        name: secondUser.name,
        role: secondUser.role,
        policeRank: secondUser.policeRank || "",
      },
      primaryUser: {
        id: primaryPayload.userId,
        username: primaryPayload.username,
        name: primaryPayload.name,
        role: primaryPayload.role,
        policeRank: primaryPayload.policeRank,
      },
    });

    response.cookies.set("ghms_token_joint", jointToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours (same as primary)
    });

    // ── Audit log ──
    const superuserName = isPrimarySuperuser ? primaryPayload.name : secondUser.name;
    const policeAdminName = isPrimaryPoliceAdmin ? primaryPayload.name : secondUser.name;
    await logAudit(req, {
      action: "JOINT_SESSION_START",
      targetId: "joint-session",
      targetType: "Session",
      details: `Joint session: ${superuserName} (SUPERUSER) + ${policeAdminName} (POLICE ADMIN)`,
    });

    return response;
  } catch (error) {
    console.error("Joint login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
