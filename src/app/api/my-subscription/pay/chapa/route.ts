import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureInlineMigrations } from "@/lib/inline-migrate";
import {
  initializePayment,
  generateTxRef,
  getReturnUrl,
  getWebhookUrl,
} from "@/lib/chapa";
import { calcNextEndDate, CYCLE_DAYS } from "@/lib/subscription";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
/**
 * POST /api/my-subscription/pay/chapa
 *
 * Initializes a Chapa payment for the operator's selected plan.
 * Body: { cycle, amount, planId? }
 * Returns: { checkoutUrl, txRef }
 */
export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    await ensureInlineMigrations();

    const auth = await getAuthContext(req);
    if (!auth.providerId) {
      return NextResponse.json(
        { error: "No provider associated" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { cycle, amount, planId } = body;

    if (!cycle || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "Please select a plan and provide amount" },
        { status: 400 }
      );
    }

    const validCycles = ["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"];
    if (!validCycles.includes(cycle)) {
      return NextResponse.json(
        { error: "Invalid billing cycle" },
        { status: 400 }
      );
    }

    // Get subscription
    const subscription = await db.subscription.findFirst({
      where: { providerId: auth.providerId },
    });
    if (!subscription) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 }
      );
    }

    // Get provider info for Chapa
    const provider = await db.provider.findFirst({
      where: { id: auth.providerId },
      select: { name: true, ownerName: true, phone: true, email: true },
    });

    // Parse owner name into first/last
    const nameParts = (provider?.ownerName || provider?.name || "").split(" ");
    const firstName = nameParts[0] || "GHMS";
    const lastName = nameParts.slice(1).join(" ") || "Operator";

    // Generate unique transaction reference
    const txRef = generateTxRef(subscription.id);

    // Store the pending Chapa transaction in a SubscriptionPayment with PENDING status
    // We'll update it when the webhook confirms payment
    const periodStart = new Date(
      Math.max(Date.now(), new Date(subscription.endDate).getTime())
    );
    const periodEnd = calcNextEndDate(subscription.endDate, cycle);

    // Resolve plan ID if provided
    let resolvedPlanId = subscription.planId;
    if (planId) {
      const plan = await db.subscriptionPlan.findFirst({
        where: { id: planId, isActive: true },
      });
      if (plan) resolvedPlanId = plan.id;
    }

    // Check if subscription is expired at payment time
    const { calcSubscriptionStatus } = await import("@/lib/subscription");
    const { status: subStatus } = calcSubscriptionStatus(subscription.endDate);
    const isOverdue = subStatus === "EXPIRED";

    // Check if payment overdue tagging is enabled by superuser
    const sysSettings = await db.settings.findFirst({ where: { providerId: null } });
    const configJson = (sysSettings?.configJson || {}) as Record<string, unknown>;
    const paymentConfig = (configJson.payment || {}) as Record<string, unknown>;
    const overdueEnabled = paymentConfig.enablePaymentOverdue === true;

    const overdueTag = isOverdue
      ? overdueEnabled
        ? "[PAYMENT_OVERDUE] "
        : "[PAYMENT_OVERDUE] Will apply soon "
      : "";

    // Create a pending payment record to track this Chapa transaction
    await db.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        amount: Number(amount),
        cycle,
        periodStart,
        periodEnd,
        markedBy: auth.userId,
        notes: `${overdueTag}[CHAPA PENDING] tx_ref: ${txRef} | Amount: ${Number(amount).toLocaleString()} ETB | ${cycle} plan | Awaiting Chapa confirmation${isOverdue ? " | Subscription was expired at time of payment" : ""}`,
      },
    });

    // Normalize phone number for Chapa: must be +251XXXXXXXXX (12 digits after +)
    const rawPhone = provider?.phone || "";
    let normalizedPhone: string | undefined;
    if (rawPhone) {
      // Strip all non-digits
      const digits = rawPhone.replace(/\D/g, "");
      if (digits.startsWith("251") && digits.length === 12) {
        // Already in 251912345678 format → add + prefix
        normalizedPhone = "+" + digits;
      } else if (digits.startsWith("0") && digits.length === 10) {
        // 0912345678 → +251912345678
        normalizedPhone = "+251" + digits.substring(1);
      } else if (digits.length === 9 && /^[1-9]/.test(digits)) {
        // 912345678 → +251912345678
        normalizedPhone = "+251" + digits;
      } else {
        // Cannot normalize — omit phone_number entirely (Chapa will use business shortcode)
        normalizedPhone = undefined;
      }
    }

    console.log("[Chapa] Phone normalization:", { rawPhone, normalizedPhone });

    // Initialize Chapa payment
    const chapaResponse = await initializePayment({
      amount: Number(amount),
      currency: "ETB",
      email: provider?.email || `${auth.userId}@ghms.et`,
      first_name: firstName,
      last_name: lastName,
      phone_number: normalizedPhone,
      tx_ref: txRef,
      callback_url: getReturnUrl(subscription.id),
      return_url: getReturnUrl(subscription.id),
      webhook_url: getWebhookUrl(),
      custom_description: `GHMS Subscription - ${cycle} Plan - ${provider?.name || "Guesthouse"}`,
    });

    // Create notification for superuser
    await db.notification.create({
      data: {
        title: "[PAYMENT] Chapa Payment Initiated",
        message: `${provider?.name || "Provider"} initiated a Chapa payment of ${Number(amount).toLocaleString()} ETB (${cycle}). TxRef: ${txRef}. Awaiting payment confirmation.`,
        type: "INFO",
        link: "",
      },
    });

    return NextResponse.json({
      success: true,
      checkoutUrl: chapaResponse.data.checkout_url,
      txRef: chapaResponse.data.tx_ref,
      message: "Redirecting to Chapa payment page...",
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to initialize Chapa payment";
    console.error("[Chapa Init Error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
