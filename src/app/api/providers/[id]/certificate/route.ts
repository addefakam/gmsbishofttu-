import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/init-db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";
import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
import {
  buildCertificatePdf,
  buildCertNumber,
  type CertificateData,
} from "@/lib/certificate/generator";

/**
 * GET /api/providers/[id]/certificate
 *
 * Generates (and serves) a PDF certificate of registration for a guesthouse.
 *
 * Behavior:
 *  - SUPERUSER only.
 *  - The provider must be APPROVED (you can't certify a pending/rejected guesthouse).
 *  - On first call: issues a new cert number (GHMS-CERT-YYYY-NNNN), persists
 *    certNumber/certIssuedAt/certIssuedBy/certIssuedByName, logs the action.
 *  - On subsequent calls: re-renders the same certificate (same number, same
 *    issuedAt) — the stored record is the source of truth.
 *  - Returns the PDF as application/pdf with Content-Disposition: attachment.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
    await ensureProviderStatusEnum();
  try {
    await ensureDatabase();
    const auth = await getAuthContext(req);

    // Only the system admin may issue / re-issue certificates
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { error: "Only the system administrator may issue certificates." },
        { status: 403 },
      );
    }

    const { id } = await params;
    const provider = await db.provider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        ownerName: true,
        phone: true,
        email: true,
        address: true,
        licenseNo: true,
        type: true,
        status: true,
        certNumber: true,
        certIssuedAt: true,
        certIssuedBy: true,
        certIssuedByName: true,
      },
    });

    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }

    if (provider.status !== "APPROVED") {
      return NextResponse.json(
        {
          error:
            "Provider must be APPROVED before a certificate can be issued. Current status: " +
            provider.status,
        },
        { status: 409 },
      );
    }

    // Issue new certificate record if not yet issued
    let certNumber = provider.certNumber;
    let issuedAt = provider.certIssuedAt;
    let issuedByName = provider.certIssuedByName || auth.userName || "System Administrator";

    if (!certNumber || !issuedAt) {
      // Generate the next sequence number based on existing count this year
      const year = new Date().getFullYear();
      const yearPrefix = `GHMS-CERT-${year}-`;
      const existingCount = await db.provider.count({
        where: {
          certNumber: { startsWith: yearPrefix },
        },
      });
      const seq = existingCount + 1;
      certNumber = buildCertNumber(seq, year);
      issuedAt = new Date();

      await db.provider.update({
        where: { id },
        data: {
          certNumber,
          certIssuedAt: issuedAt,
          certIssuedBy: auth.userId,
          certIssuedByName: issuedByName,
        },
      });

      // Audit log
      const { userId, userName } = getLogUserInfo(req);
      logStaffActivity({
        req,
        userId,
        userName,
        action: "ISSUE_CERTIFICATE",
        targetType: "PROVIDER",
        targetId: id,
        details: {
          providerName: provider.name,
          certNumber,
          issuedAt: issuedAt.toISOString(),
        },
        providerId: id,
      });
    }

    // Build the PDF
    const certData: CertificateData = {
      provider: {
        id: provider.id,
        name: provider.name,
        ownerName: provider.ownerName,
        address: provider.address,
        licenseNo: provider.licenseNo,
        type: provider.type,
        phone: provider.phone,
        email: provider.email,
      },
      certNumber,
      issuedAt,
      issuedByName,
    };

    const pdfBuffer = await buildCertificatePdf(certData);

    // Sanitize filename (drop non-ASCII, replace spaces)
    const safeName = provider.name
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60);
    const filename = `Certificate_${safeName || "GuestHouse"}_${certNumber}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        "X-Certificate-Number": certNumber,
        "X-Certificate-Issued-At": issuedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }
    console.error(
      "[certificate] Failed to generate certificate:",
      error instanceof Error ? error.stack : String(error),
    );
    const message =
      error instanceof Error ? error.message : "Failed to generate certificate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
