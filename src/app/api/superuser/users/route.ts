import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase, resetInitFlag } from "@/lib/init-db";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth-utils";
import { isValidPhone, isValidEmail } from "@/lib/utils";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
// GET /api/superuser/users — List ALL users across all providers with stats
export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    resetInitFlag();
    await ensureDatabase();

    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Superuser access required" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const search = searchParams.get("search") || "";
    const roleFilter = searchParams.get("role") || "";
    const providerFilter = searchParams.get("providerId") || "";
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");

    // Build where clause
    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { username: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    if (roleFilter) {
      where.role = roleFilter;
    }

    if (providerFilter) {
      where.providerId = providerFilter;
    }

    // Fetch users with provider info
    const [users, total, stats] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          policeRank: true,
          permissions: true,
          providerId: true,
          isActive: true,
          jurisdictionType: true,
          subCity: true,
          woreda: true,
          createdAt: true,
          updatedAt: true,
          lastLogin: true,
          provider: {
            select: { id: true, name: true, status: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.user.count({ where }),
      // Aggregate stats
      db.user.groupBy({
        by: ["role"],
        _count: { role: true },
      }),
    ]);

    // Provider count
    const providerCount = await db.provider.count();
    const activeProviderCount = await db.provider.count({
      where: { status: "APPROVED" },
    });

    const roleCounts: Record<string, number> = {};
    for (const s of stats) {
      roleCounts[s.role] = s._count.role;
    }

    return NextResponse.json({
      users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      stats: {
        totalUsers: total,
        roleCounts,
        providerCount,
        activeProviderCount,
      },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/superuser/users — Create a new user (any role, any provider)
export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    resetInitFlag();
    await ensureDatabase();

    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Superuser access required" }, { status: 403 });
    }

    const body = await req.json();
    const { username, password, name, email, phone, role, policeRank, permissions, providerId, isActive, jurisdictionType, subCity, woreda } = body;

    if (!username || !password || !name || !role) {
      return NextResponse.json(
        { error: "Username, password, name, and role are required" },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles = ["SUPERUSER", "OPERATOR", "STAFF", "POLICE"];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }, { status: 400 });
    }

    // For POLICE role, policeRank is required
    if (role === "POLICE" && !policeRank) {
      return NextResponse.json({ error: "Police rank is required for police users" }, { status: 400 });
    }

    // Note: providerId is optional for OPERATOR/STAFF — they can be assigned later

    // Validate phone/email format if provided
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
    }
    if (phone && !isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone number format. Use 7-15 digits with optional + prefix." }, { status: 400 });
    }

    // Check username uniqueness
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    }

    const hashedPassword = await hashPassword(password);

    const user = await db.user.create({
      data: {
        username,
        password: hashedPassword,
        name,
        email: email || null,
        phone: phone || null,
        role,
        policeRank: role === "POLICE" ? policeRank : "",
        permissions: typeof permissions === "string" ? permissions : JSON.stringify(permissions || []),
        providerId: providerId || null,
        isActive: isActive !== undefined ? isActive : true,
        jurisdictionType: jurisdictionType || "CITY",
        subCity: subCity || null,
        woreda: woreda || null,
      },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        policeRank: true,
        permissions: true,
        providerId: true,
        isActive: true,
        jurisdictionType: true,
        subCity: true,
        woreda: true,
        createdAt: true,
        updatedAt: true,
        provider: {
          select: { id: true, name: true, status: true },
        },
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
