import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureInlineMigrations } from "@/lib/inline-migrate";
import { calcSubscriptionStatus, TRIAL_DAYS, WARNING_DAYS, GRACE_DAYS, CYCLE_DAYS } from "@/lib/subscription";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
async function getPaymentConfig() {
  try {
    const sysSettings = await db.settings.findFirst({
      where: { providerId: null },
    });
    if (sysSettings?.configJson && typeof sysSettings.configJson === "object") {
      const config = sysSettings.configJson as Record<string, unknown>;
      const payment = config.payment;
      if (payment && typeof payment === "object") {
        const p = payment as Record<string, unknown>;
        return {
          trialDays: (p.trialDays as number) ?? TRIAL_DAYS,
          warningDays: (p.warningDays as number) ?? WARNING_DAYS,
          graceDays: (p.graceDays as number) ?? GRACE_DAYS,
          currencySymbol: (p.currencySymbol as string) ?? "Br",
          paymentMethod: (p.paymentMethod as string) ?? "manual",
          paymentInstructions: (p.paymentInstructions as string) ?? "",
          latePaymentPenalty: (p.latePaymentPenalty as number) ?? 10,
          pricePerBedPerDay: (p.pricePerBedPerDay as number) ?? 15,
          // Global subscription system toggle — defaults to true (enabled)
          // when not set, so existing deployments preserve current behavior.
          subscriptionEnabled: p.subscriptionEnabled !== false,
        };
      }
    }
  } catch {
    // Fall back to defaults
  }
  return {
    trialDays: TRIAL_DAYS,
    warningDays: WARNING_DAYS,
    graceDays: GRACE_DAYS,
    currencySymbol: "Br",
    paymentMethod: "manual",
    paymentInstructions: "",
    latePaymentPenalty: 10,
    pricePerBedPerDay: 15,
    subscriptionEnabled: true,
  };
}

export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    await ensureInlineMigrations();
    const auth = await getAuthContext(req);

    // SUPERUSER and POLICE are exempt from subscription checks
    if (auth.role === "SUPERUSER" || auth.role === "POLICE") {
      return NextResponse.json({ exempt: true });
    }

    // ── Global subscription system toggle ──
    // When the super-admin disables the subscription system from the
    // System Config → Payment & Billing tab, every operator is exempt.
    // No banners, no lockout, no sidebar mini-status. They can use the
    // full system without payment. This is useful during rollout when
    // onboarding new guesthouses who shouldn't be billed yet.
    const paymentConfig = await getPaymentConfig();
    if (!paymentConfig.subscriptionEnabled) {
      return NextResponse.json({
        exempt: true,
        systemDisabled: true,
      });
    }

    if (!auth.providerId) {
      return NextResponse.json(
        { error: "No provider associated with this account" },
        { status: 400 }
      );
    }

    // Fetch subscription and provider info (paymentConfig already fetched above)
    const [subscription, provider] = await Promise.all([
      db.subscription.findFirst({ where: { providerId: auth.providerId } }),
      db.provider.findFirst({
        where: { id: auth.providerId },
        select: { name: true, ownerName: true, phone: true, status: true },
      }),
    ]);

    // Auto-create trial for APPROVED providers without subscription
    let finalSub = subscription;
    if (!subscription && provider?.status === "APPROVED") {
      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + paymentConfig.trialDays);
      try {
        finalSub = await db.subscription.create({
          data: { providerId: auth.providerId, startDate: now, endDate: trialEnd, cycle: "MONTHLY", price: 0 },
        });
      } catch {
        // Race condition — another request created it
        finalSub = await db.subscription.findFirst({ where: { providerId: auth.providerId } });
      }
    }

    if (!finalSub) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 }
      );
    }

    const { status, daysRemaining } = calcSubscriptionStatus(finalSub.endDate, {
      warningDays: paymentConfig.warningDays,
      graceDays: paymentConfig.graceDays,
    });

    // Calculate penalty if EXPIRED
    let penaltyAmount: number | undefined;
    let penaltyPercent: number | undefined;
    let baseAmount: number | undefined;
    if (status === "EXPIRED" && finalSub.price > 0) {
      penaltyPercent = paymentConfig.latePaymentPenalty;
      baseAmount = finalSub.price;
      penaltyAmount = Math.round(finalSub.price * (1 + penaltyPercent / 100));
    }

    return NextResponse.json({
      status,
      daysRemaining,
      endDate: finalSub.endDate.toISOString(),
      cycle: finalSub.cycle,
      price: finalSub.price,
      providerName: provider?.name || "",
      ownerName: provider?.ownerName || "",
      phone: provider?.phone || "",
      currencySymbol: paymentConfig.currencySymbol,
      paymentMethod: paymentConfig.paymentMethod,
      paymentInstructions: paymentConfig.paymentInstructions,
      penaltyAmount,
      penaltyPercent,
      baseAmount,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch subscription status";
    const code =
      message.includes("No provider") ? 400 :
      message.includes("not found") || message.includes("No subscription") ? 404 : 500;
    return NextResponse.json({ error: message }, { status: code });
  }
}
