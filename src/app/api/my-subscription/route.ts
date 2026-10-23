import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureInlineMigrations } from "@/lib/inline-migrate";
import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
import {
  calcSubscriptionStatus,
  calcNextEndDate,
  CYCLE_DAYS,
  TRIAL_DAYS,
  WARNING_DAYS,
  GRACE_DAYS,
} from "@/lib/subscription";

export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    // Ensure critical columns/tables exist BEFORE any Prisma query
    await ensureInlineMigrations();

    const auth = await getAuthContext(req);
    if (!auth.providerId) {
      return NextResponse.json({ error: "No provider associated" }, { status: 400 });
    }

    // Fetch everything in parallel
    const [subscription, provider, plans, payments, sysSettings] = await Promise.all([
      db.subscription.findFirst({ where: { providerId: auth.providerId } }),
      db.provider.findFirst({
        where: { id: auth.providerId },
        select: { name: true, ownerName: true, phone: true, status: true },
      }),
      db.subscriptionPlan.findMany({
        where: { isActive: true },
        include: { _count: { select: { subscriptions: true } } },
        orderBy: { price: "asc" },
      }),
      db.subscriptionPayment.findMany({
        where: { subscription: { providerId: auth.providerId } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.settings.findFirst({ where: { providerId: null } }),
    ]);

    // Extract payment config including pricing
    let paymentConfig = {
    trialDays: TRIAL_DAYS,
    warningDays: WARNING_DAYS,
    graceDays: GRACE_DAYS,
    currencySymbol: "Br",
    paymentMethod: "manual",
    paymentInstructions: "",
    pricePerBedPerDay: 15,
    pricingEnabled: false,
    latePaymentPenalty: 10,
  };
    if (sysSettings?.configJson && typeof sysSettings.configJson === "object") {
      const config = sysSettings.configJson as Record<string, unknown>;
      const payment = config.payment;
      if (payment && typeof payment === "object") {
        const p = payment as Record<string, unknown>;
        paymentConfig = {
          trialDays: (p.trialDays as number) ?? TRIAL_DAYS,
          warningDays: (p.warningDays as number) ?? WARNING_DAYS,
          graceDays: (p.graceDays as number) ?? GRACE_DAYS,
          currencySymbol: (p.currencySymbol as string) ?? "Br",
          paymentMethod: (p.paymentMethod as string) ?? "manual",
          paymentInstructions: (p.paymentInstructions as string) ?? "",
          pricePerBedPerDay: (p.pricePerBedPerDay as number) ?? 15,
          pricingEnabled: (p.pricingEnabled as boolean) ?? true,
          latePaymentPenalty: (p.latePaymentPenalty as number) ?? 10,
        };
      }
    }

    // ── Bed count for billing ──
    // Priority: 1) Admin-set Provider.bedCount (manual override)
    //           2) Auto-calculated from room types (DOUBLE + TWIN = 2 beds, all others = 1)
    let totalBeds: number;
    if (provider?.bedCount != null && provider.bedCount > 0) {
      // Admin manually set the bed count on the Provider page — use it.
      totalBeds = provider.bedCount;
    } else {
      // Auto-calculate from room types:
      //   DOUBLE rooms have 2 beds (one double-size bed = 2 sleeping positions)
      //   TWIN   rooms have 2 beds (two single-size beds)
      //   All other room types have 1 bed (the difference is SIZE, not COUNT)
      //     SINGLE         = 1 single bed
      //     SUITE          = 1 king/queen bed
      //     DELUXE         = 1 large bed
      //     KING           = 1 king-size bed
      //     STANDARD       = 1 standard bed
      //     STANDARD_SUITE = 1 bed + living area
      //     JUNIOR_SUITE   = 1 queen bed + sitting area
      //     EXECUTIVE_SUITE= 1 king bed + living room
      const rooms = await db.room.findMany({
        where: { providerId: auth.providerId },
        select: { type: true },
      });
      totalBeds = rooms.reduce((sum, r) => {
        // DOUBLE and TWIN rooms have 2 beds; all others have 1 bed
        const beds = (r.type === "DOUBLE" || r.type === "TWIN") ? 2 : 1;
        return sum + beds;
      }, 0);
    }

    // Auto-create trial if needed
    let finalSub = subscription;
    if (!finalSub && provider?.status === "APPROVED") {
      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + paymentConfig.trialDays);
      try {
        finalSub = await db.subscription.create({
          data: {
            providerId: auth.providerId,
            startDate: now,
            endDate: trialEnd,
            cycle: "MONTHLY",
            price: 0,
          },
        });
      } catch {
        finalSub = await db.subscription.findFirst({ where: { providerId: auth.providerId } });
      }
    }

    if (!finalSub) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    const { status, daysRemaining } = calcSubscriptionStatus(finalSub.endDate, {
      warningDays: paymentConfig.warningDays,
      graceDays: paymentConfig.graceDays,
    });

    // Build plans: calculate from per-bed-per-day rate x total beds x cycle days
    const planSubscriberCounts: Record<string, number> = {};
    for (const p of plans) {
      planSubscriberCounts[p.cycle] = (planSubscriberCounts[p.cycle] || 0) + p._count.subscriptions;
    }

    const CYCLE_DEFINITIONS = [
      { name: "Monthly", cycle: "MONTHLY", days: 30 },
      { name: "Quarterly", cycle: "QUARTERLY", days: 90 },
      { name: "Semi-Annual", cycle: "SEMI_ANNUAL", days: 180 },
      { name: "Annual", cycle: "YEARLY", days: 365 },
    ];

    const configPlans = CYCLE_DEFINITIONS.map((def) => {
      const price = paymentConfig.pricePerBedPerDay * totalBeds * def.days;
      return {
        id: plans.find((p) => p.cycle === def.cycle)?.id || `cfg-${def.cycle}`,
        name: def.name,
        cycle: def.cycle,
        price,
        days: def.days,
      };
    });

    const enrichedPlans = configPlans.map((p) => {
      const months = p.days / 30;
      return {
        id: p.id,
        name: p.name,
        cycle: p.cycle,
        price: p.price,
        days: p.days,
        months,
        perMonth: months > 0 ? Math.round((p.price / months) * 100) / 100 : p.price,
        subscribers: planSubscriberCounts[p.cycle] || 0,
      };
    });

    return NextResponse.json({
      subscription: {
        id: finalSub.id,
        startDate: finalSub.startDate.toISOString(),
        endDate: finalSub.endDate.toISOString(),
        cycle: finalSub.cycle,
        price: finalSub.price,
        planId: finalSub.planId,
        status,
        daysRemaining,
      },
      provider: provider,
      plans: enrichedPlans,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        cycle: p.cycle,
        periodStart: p.periodStart.toISOString(),
        periodEnd: p.periodEnd.toISOString(),
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
      })),
      config: paymentConfig,
      totalBeds,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to load subscription";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    // Ensure critical columns/tables exist BEFORE any Prisma query
    await ensureInlineMigrations();

    const auth = await getAuthContext(req);
    if (!auth.providerId) {
      return NextResponse.json({ error: "No provider associated" }, { status: 400 });
    }

    const body = await req.json();
    const { planId, cycle, amount, paymentMethod, referenceNo, notes } = body;

    if (!cycle || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "Please select a plan and enter amount" },
        { status: 400 }
      );
    }

    const validCycles = ["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"];
    if (!validCycles.includes(cycle)) {
      return NextResponse.json({ error: "Invalid billing cycle" }, { status: 400 });
    }

    // ── Duplicate reference check: prevent submitting same bill twice ──
    if (referenceNo && referenceNo.trim()) {
      const refTrimmed = referenceNo.trim();
      const existing = await db.subscriptionPayment.findFirst({
        where: {
          notes: { contains: `Ref: ${refTrimmed}` },
        },
      });
      if (existing) {
        return NextResponse.json(
          { error: "This payment reference has already been used. Each payment must have a unique reference number." },
          { status: 409 }
        );
      }
    }

    // Get current subscription
    const subscription = await db.subscription.findFirst({
      where: { providerId: auth.providerId },
    });

    if (!subscription) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    // Calculate new period
    const periodStart = new Date(
      Math.max(Date.now(), new Date(subscription.endDate).getTime())
    );
    const periodEnd = calcNextEndDate(subscription.endDate, cycle);

    // Resolve plan if provided
    let resolvedPlanId = subscription.planId;
    if (planId) {
      const plan = await db.subscriptionPlan.findFirst({
        where: { id: planId, isActive: true },
      });
      if (plan) {
        resolvedPlanId = plan.id;
      }
    }

    // Check if subscription is expired at payment time
    const { status: subStatus } = calcSubscriptionStatus(subscription.endDate, {
      warningDays: 7,
      graceDays: 2,
    });
    const isOverdue = subStatus === "EXPIRED";

    // Check if payment overdue tagging is enabled by superuser
    const sysSettings = await db.settings.findFirst({ where: { providerId: null } });
    const configJson = (sysSettings?.configJson || {}) as Record<string, unknown>;
    const paymentConfig = (configJson.payment || {}) as Record<string, unknown>;
    const overdueEnabled = paymentConfig.enablePaymentOverdue === true;

    // Build payment notes with provider's reference info
    const paymentNotes = [
      isOverdue
        ? overdueEnabled
          ? `[PAYMENT_OVERDUE]`
          : `[PAYMENT_OVERDUE] Will apply soon`
        : `[PROVIDER SUBMITTED]`,
      isOverdue ? `Subscription was expired at time of payment` : "",
      paymentMethod ? `Method: ${paymentMethod}` : "",
      referenceNo ? `Ref: ${referenceNo}` : "",
      notes || "",
    ]
      .filter(Boolean)
      .join(" | ");

    // Update subscription + create payment in transaction
    await db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          startDate: periodStart,
          endDate: periodEnd,
          cycle,
          price: Number(amount),
          ...(resolvedPlanId ? { planId: resolvedPlanId } : {}),
        },
      });
      await tx.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount: Number(amount),
          cycle,
          periodStart,
          periodEnd,
          markedBy: auth.userId,
          notes: paymentNotes,
        },
      });
    });

    // Fetch provider for notification
    const provider = await db.provider.findFirst({
      where: { id: auth.providerId },
      select: { name: true, ownerName: true },
    });

    // Create notification for superuser to verify
    await db.notification.create({
      data: {
        title: "[PAYMENT] Subscription Payment Submitted",
        message: `${provider?.name || "Provider"} submitted ${Number(amount).toLocaleString()} Br (${cycle}) payment. Reference: ${referenceNo || "N/A"}. Please verify and confirm.

${notes || ""}`,
        type: "WARNING",
        link: "",
      },
    });

    return NextResponse.json({
      success: true,
      newEndDate: periodEnd.toISOString(),
      message: "Payment submitted successfully. Your subscription will be activated once verified.",
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to submit payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
