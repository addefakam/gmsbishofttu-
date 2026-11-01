import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";

import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";
const DEFAULT_PAYMENT = {
  trialDays: 15,
  warningDays: 7,
  graceDays: 2,
  defaultCycle: "MONTHLY",
  paymentMethod: "manual",
  latePaymentPenalty: 10,
  enableAutoReminder: true,
  reminderDaysBefore: 7,
  currency: "ETB",
  currencySymbol: "Br",
  paymentInstructions:
    "Contact your administrator to arrange payment. Payments can be made via bank transfer or mobile money.",
  enablePaymentOverdue: false,
};

/**
 * GET /api/system-config
 *
 * Returns system-wide payment configuration.
 * Deploy-blocker fix: requires authenticated session.
 */
export async function GET(req: NextRequest) {
    await ensureSettingsColumns();
  try {
    // ── Deploy-blocker fix: require auth — this leaks payment config ──
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER" && auth.role !== "OPERATOR") {
      return NextResponse.json({ error: "Operator or Superuser access required." }, { status: 403 });
    }

    const sysSettings = await db.settings.findFirst({
      where: { providerId: null },
    });

    if (sysSettings?.configJson && typeof sysSettings.configJson === "object") {
      const config = sysSettings.configJson as Record<string, unknown>;
      const payment = config.payment;
      if (payment && typeof payment === "object") {
        return NextResponse.json({ ...DEFAULT_PAYMENT, ...payment });
      }
    }

    return NextResponse.json(DEFAULT_PAYMENT);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(DEFAULT_PAYMENT);
  }
}