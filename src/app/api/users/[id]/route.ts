import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, checkWritePermission, AuthError } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth-utils";

import { logStaffActivity } from "@/lib/staff-log";
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const { id } = await params;
    const body = await req.json();

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // OPERATOR and SUPERUSER-with-providerId (both are guesthouse owners)
    // can only manage STAFF accounts in their own guesthouse.
    if (auth.role === "OPERATOR" || (auth.role === "SUPERUSER" && auth.providerId)) {
      if (existing.role !== "STAFF") {
        return NextResponse.json(
          { error: "You can only manage Staff accounts in your guesthouse." },
          { status: 403 }
        );
      }
      if (body.role && body.role !== "STAFF") {
        return NextResponse.json(
          { error: "You can only assign Staff role to users in your guesthouse." },
          { status: 403 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.username !== undefined) updateData.username = body.username;
    if (body.password) {
      // Hash the new password
      updateData.password = await hashPassword(body.password);
    }
    if (body.role !== undefined) updateData.role = body.role;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.permissions !== undefined) {
      updateData.permissions = typeof body.permissions === "string"
        ? body.permissions
        : JSON.stringify(body.permissions);
    }
    if (body.policeRank !== undefined) updateData.policeRank = body.policeRank || "";
    if (body.providerId !== undefined) updateData.providerId = body.providerId;

    const user = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        role: true,
        name: true,
        permissions: true,
        policeRank: true,
        providerId: true,
        createdAt: true,
        updatedAt: true,
        provider: {
          select: { name: true },
        },
      },
    });

    // Staff activity log — operator updates a staff account
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "USER_UPDATE",
      targetType: "USER",
      targetId: id,
      details: { name: user.name || "", role: user.role || "", active: user.isActive },
      providerId: user.providerId || "",
    });

    return NextResponse.json(user);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to update user";
    const status =
      message.includes("not found") ? 404 :
      message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const { id } = await params;

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if ((auth.role === "OPERATOR" || (auth.role === "SUPERUSER" && auth.providerId)) && existing.role !== "STAFF") {
      return NextResponse.json(
        { error: "You can only delete Staff accounts in your guesthouse." },
        { status: 403 }
      );
    }

    await db.user.delete({ where: { id } });

        // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "USER_DELETE",
      targetType: "USER",
      targetId: id,
      details: { name: existing.name || "", role: existing.role || "" },
      providerId: existing.providerId || "",
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to delete user";
    const status =
      message.includes("not found") ? 404 :
      message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
