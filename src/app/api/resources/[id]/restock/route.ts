import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureNewTables } from "@/lib/ensure-tables";
import { getAuthContext,
  getProviderFilter,
  checkWritePermission, AuthError } from "@/lib/tenant";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    checkWritePermission(auth, {
      blockSuperuser: true,
      staffPermissionKey: "resources",
    });

    const { id } = await params;
    const body = await req.json();
    const { quantity } = body;

    if (quantity == null || Number(quantity) <= 0) {
      return NextResponse.json(
        { error: "A positive quantity is required" },
        { status: 400 }
      );
    }

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    const existing = await db.resource.findFirst({ where });
    if (!existing) {
      return NextResponse.json(
        { error: "Resource not found" },
        { status: 404 }
      );
    }

    const addQty = Number(quantity);
    const newQty = existing.quantity + addQty;

    // ── Compute expense amount: qty × costPerUnit ──
    // Only create an Expense if the resource has a non-zero costPerUnit
    // (free items like donated linens don't need an expense row).
    const unitCost = existing.costPerUnit || 0;
    const expenseAmount = unitCost * addQty;
    const shouldCreateExpense = expenseAmount > 0;

    // ── Interactive transaction so we can capture the movement ID and
    // link the Expense to it. Three writes, all atomic:
    //   1. Resource update (new quantity + lastRestocked timestamp)
    //   2. StockMovement create (audit trail of the +N change)
    //   3. Expense create (only if costPerUnit > 0 — links back to movement)
    const result = await db.$transaction(async (tx) => {
      const [resource, movement] = await Promise.all([
        tx.resource.update({
          where: { id },
          data: {
            quantity: newQty,
            lastRestocked: new Date(),
          },
        }),
        tx.stockMovement.create({
          data: {
            resourceId: id,
            delta: addQty,
            reason: "restock",
            previousQty: existing.quantity,
            newQty,
            userId: auth.userId,
            userName: auth.userName || "",
            providerId: existing.providerId,
          },
        }),
      ]);

      let expense = null;
      if (shouldCreateExpense) {
        // Use today's date in YYYY-MM-DD format (matches how the
        // manual Expense form stores it — keeps the date filter working).
        const today = new Date().toISOString().split("T")[0];
        expense = await tx.expense.create({
          data: {
            date: today,
            category: "Inventory",
            description: `Restock: ${addQty} ${existing.unit} of ${existing.name}`,
            amount: expenseAmount,
            vendor: existing.supplier || "",
            paymentMethod: "CASH", // default; operator can edit later if needed
            receiptNo: "",
            taxAmount: 0,
            providerId: existing.providerId,
            stockMovementId: movement.id,
          },
        });
      }

      return { resource, movement, expense };
    });

    return NextResponse.json({
      resource: result.resource,
      expenseCreated: !!result.expense,
      expenseAmount: result.expense ? result.expense.amount : 0,
    });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Restock resource error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
