import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
// Hard cap to prevent runaway exports. Vercel hobby plan has 1GB memory limit.
// 10K rows × ~1KB each ≈ 10MB — well within budget.
const MAX_ROWS_PER_ENTITY = 10000;

// Stream a JSON response chunk-by-chunk instead of buffering the whole
// result in memory. Uses ReadableStream + TextEncoder.
function streamJsonResponse(
  chunks: AsyncGenerator<string>,
  filename: string
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Transfer-Encoding": "chunked",
    },
  });
}

function streamCsvResponse(
  chunks: AsyncGenerator<string>,
  filename: string
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Transfer-Encoding": "chunked",
    },
  });
}

// Escape a string for CSV (wrap in quotes if it contains comma, quote, or newline).
function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Convert a Date object to ISO string for JSON streaming.
function serialize(val: unknown): unknown {
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val)) return val.map(serialize);
  if (val && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out;
  }
  return val;
}

export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);

    const { searchParams } = req.nextUrl;
    const format = searchParams.get("format") || "json";
    const entity = searchParams.get("entity") || "all";
    const stamp = Date.now();

    logAudit(req, { action: "EXPORT_DATA", details: `entity=${entity} format=${format}` });

    if (format === "csv") {
      // CSV streaming — only one entity at a time. If entity=all, default to guests.
      const targetEntity = entity === "all" ? "guests" : entity;
      const filename = `police-export-${targetEntity}-${stamp}.csv`;

      const generator = (async function* (): AsyncGenerator<string> {
        // Yield header row
        if (targetEntity === "guests") {
          yield "name,phone,idNumber,idType,nationality\n";
          // Use cursor-based iteration to avoid loading all rows at once
          let skip = 0;
          const take = 500;
          while (true) {
            const rows = await db.guest.findMany({
              include: { provider: { select: { name: true } } },
              orderBy: { createdAt: "desc" },
              skip,
              take,
            });
            if (rows.length === 0) break;
            for (const r of rows) {
              yield [
                csvEscape(r.name),
                csvEscape(r.phone),
                csvEscape(r.idNumber),
                csvEscape(r.idType),
                csvEscape(r.nationality),
              ].join(",") + "\n";
            }
            if (rows.length < take) break;
            skip += take;
            if (skip >= MAX_ROWS_PER_ENTITY) break;
          }
        } else if (targetEntity === "reservations") {
          yield "guestName,guestPhone,roomNumber,provider,checkIn,checkOut,nights,totalCost,status,createdAt\n";
          let skip = 0;
          const take = 500;
          while (true) {
            const rows = await db.reservation.findMany({
              include: {
                guest: { select: { name: true, phone: true } },
                
                provider: { select: { name: true } },
              },
              orderBy: { createdAt: "desc" },
              skip,
              take,
            });
            if (rows.length === 0) break;
            for (const r of rows) {
              yield [
                csvEscape(r.guest?.name || ""),
                csvEscape(r.guest?.phone || ""),
                csvEscape(r.room?.number || ""),
                csvEscape(r.provider?.name || ""),
                csvEscape(r.checkIn),
                csvEscape(r.checkOut),
                csvEscape(r.nights),
                csvEscape(r.totalCost),
                csvEscape(r.status),
                csvEscape(r.createdAt.toISOString()),
              ].join(",") + "\n";
            }
            if (rows.length < take) break;
            skip += take;
            if (skip >= MAX_ROWS_PER_ENTITY) break;
          }
        } else if (targetEntity === "suspects") {
          yield "suspectName,suspectSeverity,guestName,guestPhone,providerName,matchType,detectedAt\n";
          let skip = 0;
          const take = 500;
          while (true) {
            const rows = await db.$queryRaw<{name: string; severity: string; guestName: string; guestPhone: string; providerName: string; matchType: string; createdAt: Date}[]>(
              Prisma.sql`SELECT sp."name", sp."severity", sm."guestName", sm."guestPhone", sm."providerName", sm."matchType", sm."createdAt"
               FROM "SuspectMatch" sm
               LEFT JOIN "SuspectedPerson" sp ON sm."suspectedPersonId" = sp."id"
               ORDER BY sm."createdAt" DESC
               LIMIT ${take} OFFSET ${skip}`
            );
            if (rows.length === 0) break;
            for (const r of rows) {
              yield [
                csvEscape(r.name),
                csvEscape(r.severity),
                csvEscape(r.guestName),
                csvEscape(r.guestPhone),
                csvEscape(r.providerName),
                csvEscape(r.matchType),
                csvEscape(r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)),
              ].join(",") + "\n";
            }
            if (rows.length < take) break;
            skip += take;
            if (skip >= MAX_ROWS_PER_ENTITY) break;
          }
        } else if (targetEntity === "providers") {
          yield "name,ownerName,phone,email,address,type,status,createdAt\n";
          const rows = await db.provider.findMany({ select: { id: true, name: true, ownerName: true, phone: true, email: true, address: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: MAX_ROWS_PER_ENTITY });
          for (const r of rows) {
            yield [
              csvEscape(r.name),
              csvEscape(r.ownerName),
              csvEscape(r.phone),
              csvEscape(r.email),
              csvEscape(r.address),
              csvEscape(r.type),
              csvEscape(r.status),
              csvEscape(r.createdAt.toISOString()),
            ].join(",") + "\n";
          }
        }
      })();

      return streamCsvResponse(generator, filename);
    }

    // JSON streaming
    const filename = `police-export-${entity}-${stamp}.json`;
    const generator = (async function* (): AsyncGenerator<string> {
      yield `{"_metadata":{"exportedAt":"` + new Date().toISOString() + `","exportedBy":"` + auth.role + `","entity":"` + entity + `"},`;
      yield `"data":{`;

      const sections: string[] = [];
      if (entity === "all" || entity === "guests") sections.push("guests");
      if (entity === "all" || entity === "reservations") sections.push("reservations");
      if (entity === "all" || entity === "suspects") sections.push("suspectMatches");
      if (entity === "all" || entity === "providers") sections.push("providers");

      for (let i = 0; i < sections.length; i++) {
        const key = sections[i];
        yield `"${key}":[`;

        if (key === "guests") {
          let skip = 0;
          const take = 500;
          let first = true;
          while (skip < MAX_ROWS_PER_ENTITY) {
            const rows = await db.guest.findMany({
              include: { provider: { select: { name: true } } },
              orderBy: { createdAt: "desc" },
              skip, take,
            });
            if (rows.length === 0) break;
            for (const r of rows) {
              if (!first) yield ",";
              first = false;
              yield JSON.stringify(serialize(r));
            }
            if (rows.length < take) break;
            skip += take;
          }
        } else if (key === "reservations") {
          let skip = 0;
          const take = 500;
          let first = true;
          while (skip < MAX_ROWS_PER_ENTITY) {
            const rows = await db.reservation.findMany({
              include: {
                guest: { select: { name: true, phone: true } },
                
                provider: { select: { name: true } },
              },
              orderBy: { createdAt: "desc" },
              skip, take,
            });
            if (rows.length === 0) break;
            for (const r of rows) {
              if (!first) yield ",";
              first = false;
              yield JSON.stringify(serialize(r));
            }
            if (rows.length < take) break;
            skip += take;
          }
        } else if (key === "suspectMatches") {
          let skip = 0;
          const take = 500;
          let first = true;
          while (skip < MAX_ROWS_PER_ENTITY) {
            const rows = await db.$queryRaw<Record<string, unknown>[]>(
              Prisma.sql`SELECT sm.*, sp."name" as "suspectName", sp."severity" as "suspectSeverity"
               FROM "SuspectMatch" sm
               LEFT JOIN "SuspectedPerson" sp ON sm."suspectedPersonId" = sp."id"
               ORDER BY sm."createdAt" DESC
               LIMIT ${take} OFFSET ${skip}`
            );
            if (rows.length === 0) break;
            for (const r of rows) {
              if (!first) yield ",";
              first = false;
              yield JSON.stringify(serialize(r));
            }
            if (rows.length < take) break;
            skip += take;
          }
        } else if (key === "providers") {
          const rows = await db.provider.findMany({ select: { id: true, name: true, ownerName: true, phone: true, email: true, address: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: MAX_ROWS_PER_ENTITY });
          let first = true;
          for (const r of rows) {
            if (!first) yield ",";
            first = false;
            yield JSON.stringify(serialize(r));
          }
        }

        yield "]";
        if (i < sections.length - 1) yield ",";
      }

      yield "}}";
    })();

    return streamJsonResponse(generator, filename);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to export data";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
