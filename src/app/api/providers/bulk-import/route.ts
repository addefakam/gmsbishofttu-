import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/init-db";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth-utils";
import { isValidPhone, isValidEmail } from "@/lib/utils";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    await ensureDatabase();

    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { error: "Only superuser can bulk import guesthouses" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const records: Record<string, string>[] = body.records;

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { error: "records must be a non-empty array" },
        { status: 400 }
      );
    }

    if (records.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 records per import" },
        { status: 400 }
      );
    }

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const rowNum = i + 1;
      const ownerName = (r.ownerName || "").trim();
      const phone = (r.phone || "").trim();
      const email = (r.email || "").trim();
      const name = (r.name || "").trim();
      const type = (r.type || "").trim();
      const licenseNo = (r.licenseNo || "").trim();
      const address = (r.address || "").trim();
      const username = (r.username || "").trim();
      const password = (r.password || "").trim();

      // Validate
      if (!ownerName || !phone || !email || !name || !type || !licenseNo || !username || !password) {
        errors.push(`Row ${rowNum}: Missing required fields`);
        failed++;
        continue;
      }
      if (!isValidPhone(phone)) {
        errors.push(`Row ${rowNum}: Invalid phone format`);
        failed++;
        continue;
      }
      if (!isValidEmail(email)) {
        errors.push(`Row ${rowNum}: Invalid email format`);
        failed++;
        continue;
      }
      if (password.length < 4) {
        errors.push(`Row ${rowNum}: Password too short (min 4 chars)`);
        failed++;
        continue;
      }
      // License No is REQUIRED and must be unique — bulk import refuses
      // rows with empty license numbers or duplicates (either within the
      // CSV itself or against existing providers).
      if (!licenseNo) {
        errors.push(`Row ${rowNum}: License No is required`);
        failed++;
        continue;
      }

      try {
        // Check for duplicate username
        const existingUser = await db.user.findUnique({
          where: { username },
        });
        if (existingUser) {
          errors.push(`Row ${rowNum}: Username "${username}" is already taken`);
          failed++;
          continue;
        }

        // Check for duplicate license number — both against existing
        // providers AND against earlier rows in this same CSV (which
        // would have been inserted in a previous iteration of this loop).
        const existingLicense = await db.provider.findFirst({
          where: { licenseNo },
          select: { id: true, name: true },
        });
        if (existingLicense) {
          errors.push(`Row ${rowNum}: License No "${licenseNo}" is already registered to "${existingLicense.name}"`);
          failed++;
          continue;
        }

        const hashedPassword = await hashPassword(password);

        await db.$transaction(async (tx) => {
          await tx.provider.create({
            data: {
              name,
              ownerName,
              phone,
              email,
              address,
              type,
              licenseNo,
              status: "APPROVED",
              approvedBy: auth.userId || auth.userName || "superuser",
              approvedAt: new Date(),
            },
          });

          await tx.user.create({
            data: {
              username,
              password: hashedPassword,
              role: "OPERATOR",
              name: ownerName,
              email,
              phone,
              isActive: true,
            },
          });
        });

        success++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Row ${rowNum}: ${msg}`);
        failed++;
      }
    }

    return NextResponse.json({ success, failed, errors });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Bulk import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
