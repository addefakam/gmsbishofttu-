import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { calcNextEndDate, CYCLE_DAYS, TRIAL_DAYS, calcSubscriptionStatus } from "@/lib/subscription";
import { logAudit } from "@/lib/audit";

import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";
import { ensureNotNullableDefaults } from "@/lib/ensure-not-null-defaults";
const VALID_CYCLES = ["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureNotNullableDefaults();
    await ensureSettingsColumns();
  try {
    const auth = await getAuthContext(req);

    if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { amount, cycle, notes, planId } = body;

    // Find subscription by id
    const subscription = await db.subscription.findFirst({
      where: { id },
    });
    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    // If planId is provided, look up the plan and use its cycle/price as defaults
    let resolvedCycle = cycle;
    let resolvedAmount = amount;
    let resolvedPlanId: string | null = planId || null;

    if (planId) {
      const plan = await db.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!plan) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      }
      // Use plan values as defaults, but allow manual override via amount/cycle
      if (resolvedAmount === undefined || resolvedAmount === null) {
        resolvedAmount = plan.price;
      }
      if (!resolvedCycle || !VALID_CYCLES.includes(resolvedCycle)) {
        resolvedCycle = plan.cycle;
      }
    }

    // Determine amount and cycle — use provided values or fall back to current
    const paymentAmount = resolvedAmount !== undefined && resolvedAmount !== null
      ? Number(resolvedAmount)
      : subscription.price;
    const newCycle = resolvedCycle && VALID_CYCLES.includes(resolvedCycle)
      ? resolvedCycle
      : subscription.cycle;

    if (paymentAmount < 0) {
      return NextResponse.json(
        { error: "Payment amount cannot be negative" },
        { status: 400 }
      );
    }

    // Calculate period boundaries
    const now = new Date();
    const currentEnd = new Date(subscription.endDate);
    const periodStart = new Date(Math.max(now.getTime(), currentEnd.getTime()));
    const periodEnd = calcNextEndDate(currentEnd, newCycle);

    // Update subscription: new period dates, cycle, price, and optional plan link
    const updatedSubscription = await db.subscription.update({
      where: { id },
      data: {
        startDate: periodStart,
        endDate: periodEnd,
        cycle: newCycle,
        price: paymentAmount,
        ...(resolvedPlanId ? { planId: resolvedPlanId } : {}),
      },
    });

    // Check if subscription is expired at payment time
    const { status: subStatus } = calcSubscriptionStatus(subscription.endDate);
    const isOverdue = subStatus === "EXPIRED";

    // Check if payment overdue tagging is enabled
    const sysSettings = await db.settings.findFirst({ where: { providerId: null } });
    const configJson = (sysSettings?.configJson || {}) as Record<string, unknown>;
    const paymentConfig = (configJson.payment || {}) as Record<string, unknown>;
    const overdueEnabled = paymentConfig.enablePaymentOverdue === true;

    // Create payment record
    const payment = await db.subscriptionPayment.create({
      data: {
        subscriptionId: id,
        amount: paymentAmount,
        cycle: newCycle,
        periodStart,
        periodEnd,
        markedBy: auth.userId,
        notes: `${isOverdue ? (overdueEnabled ? "[PAYMENT_OVERDUE]" : "[PAYMENT_OVERDUE] Will apply soon") : ""}${isOverdue ? " " : ""}${notes || ""}${isOverdue ? " | Subscription was expired at time of payment" : ""}`.trim(),
      },
    });

    // Log audit trail
    await logAudit(req, {
      action: "SUBSCRIPTION_PAYMENT",
      targetId: id,
      targetType: "Subscription",
      details: `Payment of ${paymentAmount} ETB recorded for ${newCycle} cycle. Period: ${periodStart.toISOString()} → ${periodEnd.toISOString()}. Notes: ${notes || "none"}${resolvedPlanId ? `. Plan: ${resolvedPlanId}` : ""}`,
    });

    return NextResponse.json({
      subscription: updatedSubscription,
      payment,
    });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to record payment";
    const status =
      message.includes("not found") ? 404 :
      message.includes("denied") ? 403 :
      message.includes("cannot be negative") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
