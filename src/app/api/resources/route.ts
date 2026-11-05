import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureNewTables } from "@/lib/ensure-tables";
import { getAuthContext,
  getProviderFilter,
  checkWritePermission, AuthError } from "@/lib/tenant";

export async function GET(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);

    const where: Record<string, unknown> = filter.isPolice
      ? {}
      : { providerId: filter.providerId };

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");

    if (q) {
      where.OR = [
        { name: { contains: q } },
        { category: { contains: q } },
        { supplier: { contains: q } },
      ];
    }

    const resources = await db.resource.findMany({
      where,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ resources });
  } catch (error) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("List resources error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const body = await req.json();
    const {
      name,
      category,
      quantity,
      unit,
      minLevel,
      costPerUnit,
      supplier,
    } = body;

    if (!name || quantity == null || !unit) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: name, quantity, unit",
        },
        { status: 400 }
      );
    }

    if (!auth.providerId) {
      return NextResponse.json(
        { error: "No provider assigned to this user" },
        { status: 403 }
      );
    }

    const resource = await db.resource.create({
      data: {
        name,
        // Category is optional — default to "Uncategorized" when empty
        // so the DB constraint (NOT NULL) is satisfied without forcing
        // the operator to classify every item.
        category: category || "Uncategorized",
        quantity: Number(quantity),
        unit,
        minLevel: minLevel != null ? Number(minLevel) : 0,
        costPerUnit: costPerUnit != null ? Number(costPerUnit) : 0,
        supplier: supplier || "",
        providerId: auth.providerId,
      },
    });

    return NextResponse.json({ resource }, { status: 201 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Create resource error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}