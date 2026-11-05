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
    const category = searchParams.get("category");
    if (category) {
      where.category = category;
    }
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const skip = (page - 1) * limit;

    const [expenses, total] = await Promise.all([
      db.expense.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      db.expense.count({ where }),
    ]);

    return NextResponse.json({ expenses, total, page, limit });
  } catch (error) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("List expenses error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const body = await req.json();
    const {
      date,
      category,
      description,
      amount,
      vendor,
      paymentMethod,
      receiptNo,
      taxAmount,
    } = body;

    if (!date || !category || !description || amount == null || !paymentMethod) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: date, category, description, amount, paymentMethod",
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

    const expense = await db.expense.create({
      data: {
        date,
        category,
        description,
        amount: Number(amount),
        vendor: vendor || "",
        paymentMethod,
        receiptNo: receiptNo || "",
        taxAmount: taxAmount != null ? Number(taxAmount) : 0,
        providerId: auth.providerId,
      },
    });

    return NextResponse.json({ expense }, { status: 201 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Create expense error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}