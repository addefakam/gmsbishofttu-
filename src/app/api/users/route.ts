import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth-utils";
import { logStaffActivity } from "@/lib/staff-log";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    // SUPERUSER without providerId (system admin) cannot access the users list
    // — use /api/owner-accounts instead. SUPERUSER-with-providerId (owners) and
    // OPERATOR both manage their own staff accounts.
    if (auth.role === "SUPERUSER" && !auth.providerId) {
      return NextResponse.json(
        { error: "Access denied. Use Owner Accounts to manage provider credentials." },
        { status: 403 }
      );
    }
    const { isPolice, providerId } = getProviderFilter(auth);

    const { searchParams } = req.nextUrl;
    const providerFilter = searchParams.get("providerId");

    const where: Record<string, unknown> = {};
    if (isPolice) {
      if (providerFilter) where.providerId = providerFilter;
    } else if (auth.role === "OPERATOR" || (auth.role === "SUPERUSER" && auth.providerId)) {
      // OPERATOR and SUPERUSER-with-providerId (both are guesthouse owners)
      // only see STAFF accounts they personally created.
      where.providerId = providerId;
      where.createdBy = auth.userId;
      where.role = "STAFF";
    } else {
      where.providerId = providerId;
    }

    // Pagination
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true, username: true, role: true, name: true,
          permissions: true, policeRank: true, providerId: true,
          createdBy: true, isActive: true, createdAt: true, updatedAt: true,
          provider: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    return NextResponse.json({ data: users, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const body = await req.json();
    const { username, password, role, name, permissions, providerId: bodyProviderId } = body;

    if (!username || !password || !name || !role) {
      return NextResponse.json(
        { error: "username, password, name, and role are required" },
        { status: 400 }
      );
    }

    // OPERATOR and SUPERUSER-with-providerId (both are guesthouse owners)
    // can create STAFF accounts. They cannot create OPERATOR or SUPERUSER
    // accounts (only system admins can do that via owner-accounts).
    if ((auth.role === "OPERATOR" || (auth.role === "SUPERUSER" && auth.providerId)) && role !== "STAFF") {
      return NextResponse.json(
        { error: "You can only create Staff accounts for your guesthouse." },
        { status: 403 }
      );
    }

    // Hash the password before storing
    const hashedPassword = await hashPassword(password);

    const targetProviderId = bodyProviderId || providerId;

    // Set createdBy for both OPERATOR and SUPERUSER-with-providerId (both
    // are "owners" of a guesthouse). Previously only OPERATOR set this
    // field, which meant SUPERUSER owners' staff had createdBy=null.
    // The GET handler for OPERATOR filters by createdBy=auth.userId, so
    // without this, staff created by SUPERUSER owners wouldn't appear.
    const shouldSetCreatedBy = auth.role === "OPERATOR" ||
      (auth.role === "SUPERUSER" && auth.providerId);

    const user = await db.user.create({
      data: {
        username,
        password: hashedPassword,
        role,
        name,
        permissions: typeof permissions === "string" ? permissions : JSON.stringify(permissions || []),
        providerId: targetProviderId,
        createdBy: shouldSetCreatedBy ? auth.userId : undefined,
      },
    });

    const { password: _, ...userWithoutPassword } = user;

    // Staff activity log — operator creates a new staff account
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "USER_CREATE",
      targetType: "USER",
      targetId: user.id,
      details: { name: user.name || "", role: user.role || "STAFF" },
      providerId: user.providerId || "",
    });

    return NextResponse.json(userWithoutPassword, { status: 201 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to create user";
    const status =
      message.includes("required") ? 400 :
      message.includes("Unique") ? 409 :
      message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
