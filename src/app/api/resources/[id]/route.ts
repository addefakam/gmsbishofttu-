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

    const existing = await db.resource.findFirst({ where });
    if (!existing) {
      return NextResponse.json(
        { error: "Resource not found" },
        { status: 404 }
      );
    }

    // Detect a quantity change so we can record a StockMovement row.
    // Non-quantity edits (name, supplier, minLevel, etc.) don't create
    // a movement — only quantity changes do.
    const newQuantity =
      body.quantity !== undefined ? Number(body.quantity) : existing.quantity;
    const quantityChanged = newQuantity !== existing.quantity;
    const delta = quantityChanged ? newQuantity - existing.quantity : 0;

    const tx = [
      db.resource.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.category !== undefined && { category: body.category }),
          ...(body.quantity !== undefined && { quantity: newQuantity }),
          ...(body.unit !== undefined && { unit: body.unit }),
          ...(body.minLevel !== undefined && {
            minLevel: Number(body.minLevel),
          }),
          ...(body.costPerUnit !== undefined && {
            costPerUnit: Number(body.costPerUnit),
          }),
          ...(body.supplier !== undefined && { supplier: body.supplier }),
        },
      }),
    ];

    if (quantityChanged) {
      tx.push(
        db.stockMovement.create({
          data: {
            resourceId: id,
            delta,
            reason: "edit",
            previousQty: existing.quantity,
            newQty: newQuantity,
            userId: auth.userId,
            userName: auth.userName || "",
            providerId: existing.providerId,
          },
        })
      );
    }

    const [resource] = await db.$transaction(tx);

    return NextResponse.json({ resource });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Update resource error:", error);
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

    const existing = await db.resource.findFirst({ where });
    if (!existing) {
      return NextResponse.json(
        { error: "Resource not found" },
        { status: 404 }
      );
    }

    await db.resource.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Delete resource error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}