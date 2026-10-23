import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureInlineMigrations } from "@/lib/inline-migrate";
import { verifyPayment } from "@/lib/chapa";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
/**
 * POST /api/my-subscription/pay/chapa/verify
 *
 * Called by the frontend after Chapa redirects back with ?chapa=success.
 * This actively verifies the payment with Chapa's API (not relying on webhook).
 *
 * Body: { subPrefix?: string }  (subscription ID prefix from URL param)
 */
export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    await ensureInlineMigrations();

    const auth = await getAuthContext(req);
    if (!auth.providerId) {
      return NextResponse.json({ error: "No provider associated" }, { status: 400 });
    }

    // Find the subscription for this provider
    const subscription = await db.subscription.findFirst({
      where: { providerId: auth.providerId },
    });

    if (!subscription) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    // Find any CHAPA PENDING payment for this subscription
    const pendingPayments = await db.subscriptionPayment.findMany({
      where: {
        subscriptionId: subscription.id,
        notes: { contains: "[CHAPA PENDING]" },
      },
      orderBy: { createdAt: "desc" },
    });

    if (pendingPayments.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending Chapa payments to verify",
        alreadyVerified: true,
      });
    }

    let verifiedCount = 0;
    let failedCount = 0;
    const results: string[] = [];

    for (const payment of pendingPayments) {
      // Extract tx_ref from notes: "tx_ref: ghms-sub-XXXXXXXX-..."
      const txRefMatch = payment.notes.match(/tx_ref:\s*([\S]+)/);
      const txRef = txRefMatch ? txRefMatch[1] : null;

      if (!txRef) {
        results.push(`Payment ${payment.id}: no tx_ref found in notes`);
        failedCount++;
        continue;
      }

      // Verify with Chapa API
      try {
        const verification = await verifyPayment(txRef);

        if (verification.data.status === "success") {
          // Update payment record
          await db.subscriptionPayment.update({
            where: { id: payment.id },
            data: {
              notes: payment.notes
                .replace("[CHAPA PENDING]", "[CHAPA VERIFIED]")
                + ` | Method: ${verification.data.payment_method}`
                + (verification.data.paid_at ? ` | Paid at: ${verification.data.paid_at}` : ""),
            },
          });

          // Extend subscription (in case webhook didn't fire)
          await db.subscription.update({
            where: { id: subscription.id },
            data: {
              startDate: payment.periodStart,
              endDate: payment.periodEnd,
              cycle: payment.cycle,
              price: payment.amount,
            },
          });

          // Notify superuser
          const provider = await db.provider.findFirst({
            where: { id: auth.providerId },
            select: { name: true },
          });
          await db.notification.create({
            data: {
              title: "[PAYMENT] Chapa Payment Verified",
              message: `Chapa payment of ${payment.amount.toLocaleString()} ETB (${payment.cycle}) from ${provider?.name || "Provider"} verified. Sub extended to ${new Date(payment.periodEnd).toLocaleDateString("en-GB")}. TxRef: ${txRef} | Method: ${verification.data.payment_method}`,
              type: "SUCCESS",
              link: "",
            },
          });

          verifiedCount++;
          results.push(`Payment of ${payment.amount.toLocaleString()} ETB verified via ${verification.data.payment_method}`);
        } else {
          results.push(`Payment ${payment.id}: Chapa status is "${verification.data.status}" (not yet completed)`);
          failedCount++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Verification failed";
        results.push(`Payment ${payment.id}: ${msg}`);
        failedCount++;
      }
    }

    return NextResponse.json({
      success: verifiedCount > 0,
      verified: verifiedCount,
      failed: failedCount,
      results,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
