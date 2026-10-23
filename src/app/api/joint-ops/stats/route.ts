import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyToken } from "@/lib/auth-utils";
import { getAuthContext, AuthError } from "@/lib/tenant";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
/**
 * GET /api/joint-ops/stats
 *
 * Returns system-wide statistics. Requires an active joint session
 * (both ghms_token + ghms_token_joint cookies with valid SUPERUSER + POLICE ADMIN).
 */
export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    // ── Deploy-blocker fix: require authenticated session first ──
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER" && auth.role !== "POLICE") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Verify joint session (SUPERUSER + POLICE ADMIN dual auth)
    const jointValid = await verifyJointSession(req);
    if (!jointValid) {
      return NextResponse.json(
        { error: "Joint session required. Both System Admin and Police Admin must be logged in." },
        { status: 403 }
      );
    }

    const [totalUsers, totalProviders, totalGuests, totalRooms, totalReservations] =
      await Promise.all([
        db.user.count(),
        db.provider.count(),
        db.guest.count(),
        db.room.count(),
        db.reservation.count(),
      ]);

    return NextResponse.json({
      totalUsers,
      totalProviders,
      totalGuests,
      totalRooms,
      totalReservations,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Joint ops stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Verify that both primary and joint sessions exist with SUPERUSER + POLICE ADMIN roles.
 */
async function verifyJointSession(req: NextRequest): Promise<boolean> {
  const primaryToken = req.cookies.get("ghms_token")?.value;
  const jointToken = req.cookies.get("ghms_token_joint")?.value;

  if (!primaryToken || !jointToken) return false;

  const [primary, joint] = await Promise.all([
    verifyToken(primaryToken),
    verifyToken(jointToken),
  ]);

  if (!primary || !joint) return false;

  const isPrimarySuperuser = primary.role === "SUPERUSER";
  const isPrimaryPoliceAdmin = primary.role === "POLICE" && primary.policeRank === "ADMIN";
  const isJointSuperuser = joint.role === "SUPERUSER";
  const isJointPoliceAdmin = joint.role === "POLICE" && joint.policeRank === "ADMIN";

  return (isPrimarySuperuser && isJointPoliceAdmin) || (isPrimaryPoliceAdmin && isJointSuperuser);
}

export { verifyJointSession };
