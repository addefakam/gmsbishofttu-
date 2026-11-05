import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth-utils";
import { ensureNotNullableDefaults } from "@/lib/ensure-not-null-defaults";
import {
  requirePoliceMinRank,
  POLICE_RANKS,
  RANK_LABELS,
  type PoliceRank,
} from "@/lib/police-permissions";

// Hierarchy levels — higher number = more authority
const RANK_HIERARCHY: Record<PoliceRank, number> = {
  VIEWER: 0,
  OFFICER: 1,
  DETECTIVE: 2,
  ADMIN: 3,
};

/**
 * GET /api/police-officers — List all POLICE users
 * - ADMIN & DETECTIVE: see all officers (with rank info)
 * - OFFICER & VIEWER: see all officers (read-only listing)
 * - SUPERUSER: see all police accounts
 */
export async function GET(req: NextRequest) {
    await ensureNotNullableDefaults();
  try {
    const auth = await getAuthContext(req);

    // SUPERUSER can view police accounts too
    if (auth.role !== "POLICE" && auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const officers = await db.user.findMany({
      where: { role: "POLICE" },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        permissions: true,
        policeRank: true,
        providerId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(officers);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch officers";
    const status = message.includes("Access") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * POST /api/police-officers — Create new police officer
 * - SUPERUSER: can create ADMIN rank only
 * - POLICE ADMIN: can create DETECTIVE, OFFICER, VIEWER
 * - POLICE DETECTIVE: can create OFFICER, VIEWER
 * - POLICE OFFICER: can create VIEWER only
 * - POLICE VIEWER: cannot create
 */
export async function POST(req: NextRequest) {
    await ensureNotNullableDefaults();
  try {
    const auth = await getAuthContext(req);

    if (auth.role === "SUPERUSER") {
      // SUPERUSER can create police — restricted to ADMIN rank below
    } else if (auth.role === "POLICE") {
      requirePolice(auth);
      const myRank = (auth.policeRank || "VIEWER") as PoliceRank;
      const myLevel = RANK_HIERARCHY[myRank] || 0;

      // VIEWER cannot create anyone
      if (myLevel < RANK_HIERARCHY.OFFICER) {
        return NextResponse.json(
          { error: `Requires ${RANK_LABELS.OFFICER} rank or higher to create police accounts` },
          { status: 403 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { username, password, name, policeRank } = body;

    if (!username || !password || !name) {
      return NextResponse.json(
        { error: "username, password, and name are required" },
        { status: 400 }
      );
    }

    // Validate requested rank
    const requestedRank = (policeRank && Object.values(POLICE_RANKS).includes(policeRank)
      ? policeRank
      : "OFFICER") as PoliceRank;

    // SUPERUSER can ONLY create ADMIN-rank officers
    if (auth.role === "SUPERUSER") {
      if (requestedRank !== "ADMIN") {
        return NextResponse.json(
          { error: `Superuser can only create ${RANK_LABELS.ADMIN}-rank police accounts. Lower ranks (DETECTIVE, OFFICER, VIEWER) must be created by a Police Admin.` },
          { status: 403 }
        );
      }
    }

    // POLICE users can only create ranks below their own
    if (auth.role === "POLICE") {
      const myRank = (auth.policeRank || "VIEWER") as PoliceRank;
      const myLevel = RANK_HIERARCHY[myRank] || 0;
      const requestedLevel = RANK_HIERARCHY[requestedRank] || 0;

      if (requestedLevel >= myLevel) {
        return NextResponse.json(
          { error: `Cannot create a police account with ${RANK_LABELS[requestedRank]} rank. You can only create ranks below ${RANK_LABELS[myRank]}.` },
          { status: 403 }
        );
      }
    }

    // Check for duplicate username
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 }
      );
    }

    // Hash the password before storing
    const hashedPassword = await hashPassword(password);

    const officer = await db.user.create({
      data: {
        username,
        password: hashedPassword,
        name,
        role: "POLICE",
        permissions: JSON.stringify([`police_rank:${requestedRank}`]),
        policeRank: requestedRank,
      },
    });

    await logAudit(req, {
      action: "CREATE_OFFICER",
      targetId: officer.id,
      targetType: "User",
      details: JSON.stringify({
        username,
        name,
        rank: requestedRank,
        createdBy: auth.userName || auth.userId,
        creatorRole: auth.role,
      }),
    }).catch(() => {});

    return NextResponse.json(
      { ...officer, password: undefined },
      { status: 201 }
    );
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to create officer";
    const status = message.includes("Access") || message.includes("rank") || message.includes("Cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * PUT /api/police-officers — Update officer (rank, name, password)
 * - SUPERUSER: can update ADMIN-rank officers only (cannot demote to a lower rank)
 * - POLICE ADMIN: can update any officer below ADMIN
 * - POLICE DETECTIVE: can update OFFICER/VIEWER only
 * - POLICE OFFICER: can update VIEWER only
 */
export async function PUT(req: NextRequest) {
    await ensureNotNullableDefaults();
  try {
    const auth = await getAuthContext(req);

    if (auth.role === "SUPERUSER") {
      // SUPERUSER has limited rights — can only update ADMIN-rank officers
    } else if (auth.role === "POLICE") {
      requirePolice(auth);
      requirePoliceMinRank(auth, "OFFICER");
    } else {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { id, policeRank, name, password } = body;

    if (!id) {
      return NextResponse.json({ error: "Officer ID is required" }, { status: 400 });
    }

    const officer = await db.user.findUnique({ where: { id } });
    if (!officer || officer.role !== "POLICE") {
      return NextResponse.json({ error: "Officer not found" }, { status: 404 });
    }

    // SUPERUSER can only target ADMIN-rank officers
    if (auth.role === "SUPERUSER") {
      const targetRank = (officer.policeRank || "OFFICER") as PoliceRank;
      if (targetRank !== "ADMIN") {
        return NextResponse.json(
          { error: `Superuser can only manage ${RANK_LABELS.ADMIN}-rank officers. Lower-rank officers are managed by the Police Admin.` },
          { status: 403 }
        );
      }
    }

    // Prevent self-demotion or self-promotion
    if (auth.role === "POLICE" && officer.id === auth.userId) {
      return NextResponse.json(
        { error: "Cannot modify your own account" },
        { status: 403 }
      );
    }

    const updateData: Record<string, unknown> = {};

    // Update rank
    if (policeRank && Object.values(POLICE_RANKS).includes(policeRank)) {
      // SUPERUSER cannot change rank (ADMIN stays ADMIN)
      if (auth.role === "SUPERUSER") {
        if (policeRank !== "ADMIN") {
          return NextResponse.json(
            { error: `Superuser can only assign ${RANK_LABELS.ADMIN} rank. To set a lower rank, ask a Police Admin to take over management of this officer.` },
            { status: 403 }
          );
        }
      }
      // POLICE users can only assign ranks below their own
      if (auth.role === "POLICE") {
        const myRank = (auth.policeRank || "VIEWER") as PoliceRank;
        const myLevel = RANK_HIERARCHY[myRank] || 0;
        const requestedLevel = RANK_HIERARCHY[policeRank as PoliceRank] || 0;

        if (requestedLevel >= myLevel) {
          return NextResponse.json(
            { error: `Cannot set rank to ${RANK_LABELS[policeRank as PoliceRank]}. You can only assign ranks below ${RANK_LABELS[myRank]}.` },
            { status: 403 }
          );
        }
      }
      updateData.permissions = JSON.stringify([`police_rank:${policeRank}`]);
      updateData.policeRank = policeRank;
    }

    if (name) {
      updateData.name = name;
    }

    if (password) {
      updateData.password = await hashPassword(password);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id },
      data: updateData,
    });

    await logAudit(req, {
      action: "UPDATE_OFFICER",
      targetId: id,
      targetType: "User",
      details: JSON.stringify({
        rank: policeRank,
        name,
        updatedBy: auth.userName || auth.userId,
        creatorRole: auth.role,
      }),
    }).catch(() => {});

    return NextResponse.json(updated);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to update officer";
    const status = message.includes("Access") || message.includes("rank") || message.includes("Cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/police-officers — Delete officer
 * - SUPERUSER: can delete ADMIN-rank officers only
 * - POLICE ADMIN: can delete any officer below ADMIN (except themselves)
 * - POLICE DETECTIVE: can delete OFFICER/VIEWER only
 * - POLICE OFFICER: can delete VIEWER only
 */
export async function DELETE(req: NextRequest) {
    await ensureNotNullableDefaults();
  try {
    const auth = await getAuthContext(req);

    if (auth.role === "SUPERUSER") {
      // SUPERUSER can delete ADMIN-rank officers only
    } else if (auth.role === "POLICE") {
      requirePolice(auth);
      requirePoliceMinRank(auth, "OFFICER");
    } else {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Officer ID is required" }, { status: 400 });
    }

    // Cannot delete yourself
    if (auth.role === "POLICE" && id === auth.userId) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 403 }
      );
    }

    const officer = await db.user.findUnique({ where: { id } });
    if (!officer || officer.role !== "POLICE") {
      return NextResponse.json({ error: "Officer not found" }, { status: 404 });
    }

    // SUPERUSER can only delete ADMIN-rank officers
    if (auth.role === "SUPERUSER") {
      const targetRank = (officer.policeRank || "OFFICER") as PoliceRank;
      if (targetRank !== "ADMIN") {
        return NextResponse.json(
          { error: `Superuser can only delete ${RANK_LABELS.ADMIN}-rank officers. Lower-rank officers are managed by the Police Admin.` },
          { status: 403 }
        );
      }
    }

    // POLICE users can only delete ranks below their own
    if (auth.role === "POLICE") {
      const myRank = (auth.policeRank || "VIEWER") as PoliceRank;
      const myLevel = RANK_HIERARCHY[myRank] || 0;
      const targetLevel = RANK_HIERARCHY[officer.policeRank as PoliceRank] || 0;

      if (targetLevel >= myLevel) {
        return NextResponse.json(
          { error: `Cannot delete a ${RANK_LABELS[officer.policeRank as PoliceRank] || "officer"}. You can only delete ranks below ${RANK_LABELS[myRank]}.` },
          { status: 403 }
        );
      }
    }

    await db.user.delete({ where: { id } });

    await logAudit(req, {
      action: "DELETE_OFFICER",
      targetId: id,
      targetType: "User",
      details: JSON.stringify({
        username: officer.username,
        deletedBy: auth.userName || auth.userId,
        creatorRole: auth.role,
      }),
    }).catch(() => {});

    return NextResponse.json({ message: "Officer deleted" });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to delete officer";
    const status = message.includes("Access") || message.includes("rank") || message.includes("Cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
