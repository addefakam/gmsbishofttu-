import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureNewTables } from "@/lib/ensure-tables";
import { getAuthContext,
  getProviderFilter,
  checkWritePermission, AuthError } from "@/lib/tenant";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const { id } = await params;
    const body = await req.json();

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    const existing = await db.expense.findFirst({ where });
    if (!existing) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      );
    }

    const expense = await db.expense.update({
      where: { id },
      data: {
        ...(body.date !== undefined && { date: body.date }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.amount !== undefined && { amount: Number(body.amount) }),
        ...(body.vendor !== undefined && { vendor: body.vendor }),
        ...(body.paymentMethod !== undefined && {
          paymentMethod: body.paymentMethod,
        }),
        ...(body.receiptNo !== undefined && { receiptNo: body.receiptNo }),
        ...(body.taxAmount !== undefined && {
          taxAmount: Number(body.taxAmount),
        }),
      },
    });

    return NextResponse.json({ expense });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Update expense error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const { id } = await params;

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    const existing = await db.expense.findFirst({ where });
    if (!existing) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      );
    }

    await db.expense.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Delete expense error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}