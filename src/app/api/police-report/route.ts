import { countProviders } from "@/lib/raw-queries";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function severityColor(sev: string): string {
  switch (sev) {
    case "CRITICAL": return "#dc2626";
    case "HIGH": return "#ea580c";
    case "MEDIUM": return "#ca8a04";
    case "LOW": return "#16a34a";
    default: return "#6b7280";
  }
}

function riskBadge(risk: string): string {
  const c = severityColor(risk);
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:${c}">${escHtml(risk)}</span>`;
}

export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);

    const now = new Date();
    const monthParam = req.nextUrl.searchParams.get("month");
    const yearParam = req.nextUrl.searchParams.get("year");
    const month = monthParam ? parseInt(monthParam, 10) : now.getMonth() + 1;
    const year = yearParam ? parseInt(yearParam, 10) : now.getFullYear();

    if (month < 1 || month > 12) {
      return NextResponse.json({ error: "Month must be 1-12" }, { status: 400 });
    }
    if (year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Year must be 2000-2100" }, { status: 400 });
    }

    // Build date range
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // 1. Suspect Matches in the month
    const suspectMatches = await db.suspectMatch.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      include: { suspectedPerson: true },
    });
    const totalMatches = suspectMatches.length;

    // 2. Severity Breakdown
    const severityBreakdown: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    suspectMatches.forEach((m) => {
      const sev = m.suspectedPerson.severity;
      severityBreakdown[sev] = (severityBreakdown[sev] || 0) + 1;
    });

    // 3. New Reservations in the month
    const newReservations = await db.reservation.count({
      where: { createdAt: { gte: startDate, lte: endDate } },
    });

    // 4. Hotspot Providers (grouped by suspect match count)
    const matchGrouped = suspectMatches.reduce<Record<string, { name: string; address: string; count: number; criticalCount: number; highCount: number }>>((acc, m) => {
      const pid = m.providerId || "unknown";
      if (!acc[pid]) {
        acc[pid] = { name: m.providerName || "Unknown Provider", address: "", count: 0, criticalCount: 0, highCount: 0 };
      }
      acc[pid].count++;
      if (m.suspectedPerson.severity === "CRITICAL") acc[pid].criticalCount++;
      if (m.suspectedPerson.severity === "HIGH") acc[pid].highCount++;
      return acc;
    }, {});

    const hotspots = Object.values(matchGrouped).sort((a, b) => b.count - a.count);

    // Fill in addresses from providers
    for (const h of hotspots) {
      const prov = await db.provider.findFirst({ where: { name: h.name } });
      if (prov) h.address = prov.address;
    }

    // 5. Frequent Stay Alerts in the month
    const frequentStays = await db.frequentStayAlert.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
    });

    // 6. Active Geofences
    const geofences = await db.geofence.findMany({ where: { isActive: true } });

    // 7. System-wide stats
    const totalProviders = await countProviders("APPROVED");
    const totalGuests = await db.guest.count();
    const totalRooms = await db.room.count();

    // Log audit
    logAudit(req, { action: "GENERATE_REPORT", details: `Monthly report for ${MONTH_NAMES[month - 1]} ${year}` });

    // Build HTML Report
    const monthName = MONTH_NAMES[month - 1];
    const dateRangeStr = `${monthName} 1 - ${endDate.getDate()}, ${year}`;
    const generatedAt = formatDate(new Date());

    const criticalPct = totalMatches > 0 ? Math.round((severityBreakdown.CRITICAL / totalMatches) * 100) : 0;
    const highPct = totalMatches > 0 ? Math.round((severityBreakdown.HIGH / totalMatches) * 100) : 0;
    const mediumPct = totalMatches > 0 ? Math.round((severityBreakdown.MEDIUM / totalMatches) * 100) : 0;
    const lowPct = totalMatches > 0 ? Math.round((severityBreakdown.LOW / totalMatches) * 100) : 0;

    // Build hotspot table rows
    const hotspotRows = hotspots.length > 0
      ? hotspots.map((h, i) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;color:#6b7280">${i + 1}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:500">${escHtml(h.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px">${escHtml(h.address)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:#dc2626">${h.count}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">
          ${h.criticalCount > 0 ? `<span style="color:#dc2626;font-weight:600">${h.criticalCount}</span>` : '<span style="color:#d1d5db">&mdash;</span>'}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">
          ${h.highCount > 0 ? `<span style="color:#ea580c;font-weight:600">${h.highCount}</span>` : '<span style="color:#d1d5db">&mdash;</span>'}
        </td>
      </tr>`).join("")
      : `<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af">No suspect matches detected this month</td></tr>`;

    // Build frequent stay rows
    const frequentRows = frequentStays.length > 0
      ? frequentStays.map((f) => {
        const provNames: string[] = [];
        try { provNames.push(...JSON.parse(f.providerNames)); } catch { /* empty */ }
        return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:500">${escHtml(f.guestName)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;color:#6b7280;font-size:13px">${escHtml(f.guestPhone || f.guestIdNumber)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600">${f.stayCount}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${f.avgDaysBetween.toFixed(1)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${riskBadge(f.riskLevel)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px">${provNames.map(escHtml).join(", ")}</td>
      </tr>`;
      }).join("")
      : `<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af">No frequent stay patterns detected this month</td></tr>`;

    // Build geofence rows
    const geofenceRows = geofences.length > 0
      ? geofences.map((g) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:500">${escHtml(g.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px">${escHtml(g.address)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${g.radius}m</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${riskBadge(g.severity)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">
          <span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:#16a34a">ACTIVE</span>
        </td>
      </tr>`).join("")
      : `<tr><td colspan="5" style="padding:24px;text-align:center;color:#9ca3af">No active geofences configured</td></tr>`;

    // Determine threat assessment level
    let threatLevel = "LOW";
    let threatColor = "#16a34a";
    if (severityBreakdown.CRITICAL > 0 || severityBreakdown.HIGH >= 3) { threatLevel = "ELEVATED"; threatColor = "#dc2626"; }
    else if (severityBreakdown.HIGH > 0 || severityBreakdown.MEDIUM >= 5) { threatLevel = "MODERATE"; threatColor = "#ca8a04"; }

    // Build recommendations
    const recommendations: string[] = [];
    if (severityBreakdown.CRITICAL > 0) {
      recommendations.push(`<li>Immediate operational response required for <strong>${severityBreakdown.CRITICAL} CRITICAL</strong> severity matches. Coordinate with field units for suspect apprehension.</li>`);
    }
    if (hotspots.length > 0 && hotspots[0].count >= 3) {
      recommendations.push(`<li>Provider <strong>"${escHtml(hotspots[0].name)}"</strong> has accumulated <strong>${hotspots[0].count} suspect matches</strong>. Consider deploying surveillance resources and conducting on-site inspection.</li>`);
    }
    if (frequentStays.length > 0) {
      const highRisk = frequentStays.filter(f => f.riskLevel === "HIGH").length;
      if (highRisk > 0) {
        recommendations.push(`<li><strong>${highRisk} high-risk frequent stay patterns</strong> identified. Cross-reference with known networks and consider flagging for enhanced monitoring.</li>`);
      }
    }
    if (geofences.length === 0) {
      recommendations.push(`<li>No geofences are currently active. Establishing geofences around high-priority zones will improve automated alerting.</li>`);
    }
    if (totalMatches === 0 && newReservations > 0) {
      recommendations.push(`<li>While no suspect matches were detected, ${newReservations} new reservations were processed. Continue routine monitoring.</li>`);
    }
    if (recommendations.length === 0) {
      recommendations.push(`<li>Maintain standard monitoring protocols. No elevated threats detected during this reporting period.</li>`);
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Monthly Intelligence Report — ${monthName} ${year}</title>
<style>
  @page { size: A4; margin: 20mm 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #1f2937; background: #fff; font-size: 14px; line-height: 1.5; }

  .header { border-bottom: 4px solid #1e3a5f; padding: 24px 0 20px; margin-bottom: 24px; }
  .header-inner { display: flex; align-items: center; gap: 16px; }
  .shield { width: 56px; height: 64px; flex-shrink: 0; }
  .header-text h1 { font-size: 18px; font-weight: 700; color: #1e3a5f; letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.2; }
  .header-text h2 { font-size: 13px; font-weight: 600; color: #374151; margin-top: 2px; }
  .header-meta { display: flex; gap: 24px; margin-top: 8px; font-size: 12px; color: #6b7280; }

  .classification { background: #1e3a5f; color: #fff; text-align: center; padding: 6px 0; font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 24px; }

  .threat-banner { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: 8px; margin-bottom: 24px; border: 1px solid ${threatColor}33; background: ${threatColor}0d; }
  .threat-badge { display: inline-block; padding: 4px 14px; border-radius: 6px; font-size: 13px; font-weight: 700; color: #fff; background: ${threatColor}; letter-spacing: 1px; }
  .threat-text { font-size: 13px; color: #374151; }

  .section { margin-bottom: 28px; }
  .section-title { font-size: 15px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; margin-bottom: 16px; }

  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
  .kpi-value { font-size: 28px; font-weight: 800; color: #1e3a5f; line-height: 1; }
  .kpi-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
  .kpi-card.alert .kpi-value { color: #dc2626; }
  .kpi-card.warn .kpi-value { color: #ca8a04; }

  .severity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
  .severity-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 6px; background: #f9fafb; border: 1px solid #e5e7eb; }
  .severity-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .severity-label { font-size: 12px; font-weight: 600; color: #374151; width: 70px; }
  .severity-bar-bg { flex: 1; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .severity-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .severity-count { font-size: 13px; font-weight: 700; min-width: 32px; text-align: right; }
  .severity-pct { font-size: 11px; color: #9ca3af; min-width: 36px; text-align: right; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { padding: 10px 12px; background: #f3f4f6; border-bottom: 2px solid #d1d5db; text-align: left; font-size: 11px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; }
  tbody tr:hover { background: #f9fafb; }

  .rec-list { padding-left: 20px; }
  .rec-list li { margin-bottom: 10px; font-size: 13px; color: #374151; line-height: 1.6; }
  .rec-list li strong { color: #1e3a5f; }

  .footer { margin-top: 36px; padding-top: 16px; border-top: 2px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #9ca3af; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .section { break-inside: avoid; }
    .kpi-grid { break-inside: avoid; }
    table { break-inside: avoid; }
  }
</style>
</head>
<body>

<div class="classification">OFFICIAL — LAW ENFORCEMENT SENSITIVE</div>

<div class="header">
  <div class="header-inner">
    <svg class="shield" viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30 2 L56 14 V36 C56 52 44 64 30 68 C16 64 4 52 4 36 V14 L30 2Z" fill="#1e3a5f" stroke="#0f2440" stroke-width="1.5"/>
      <path d="M30 8 L50 18 V36 C50 48 41 58 30 62 C19 58 10 48 10 36 V18 L30 8Z" fill="#234876"/>
      <path d="M22 34 L28 40 L40 26" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="header-text">
      <h1>Oromia Police</h1>
      <h2>Monthly Intelligence Report</h2>
      <div class="header-meta">
        <span>Reporting Period: ${dateRangeStr}</span>
        <span>Generated: ${generatedAt}</span>
      </div>
    </div>
  </div>
</div>

<div class="threat-banner">
  <span class="threat-badge">${threatLevel}</span>
  <span class="threat-text">Overall Threat Assessment for ${monthName} ${year} — ${threatLevel === "LOW" ? "No significant threats identified. Standard operations continue." : threatLevel === "MODERATE" ? "Elevated activity detected. Enhanced monitoring recommended." : "High threat level. Immediate attention and resource deployment advised."}</span>
</div>

<div class="section">
  <div class="section-title">1. Executive Summary</div>
  <div class="kpi-grid">
    <div class="kpi-card ${totalMatches > 0 ? 'alert' : ''}">
      <div class="kpi-value">${totalMatches}</div>
      <div class="kpi-label">Suspect Matches</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${newReservations}</div>
      <div class="kpi-label">New Reservations</div>
    </div>
    <div class="kpi-card ${frequentStays.length > 0 ? 'warn' : ''}">
      <div class="kpi-value">${frequentStays.length}</div>
      <div class="kpi-label">Stay Alerts</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${geofences.length}</div>
      <div class="kpi-label">Active Geofences</div>
    </div>
  </div>
  <p style="font-size:13px;color:#4b5563;line-height:1.7">
    During ${monthName} ${year}, the Guest House Monitoring System processed <strong>${newReservations}</strong> new reservations across
    <strong>${totalProviders}</strong> registered providers (${totalGuests} registered guests, ${totalRooms} total rooms).
    The automated screening system generated <strong>${totalMatches} suspect match alerts</strong>, of which
    <strong style="color:#dc2626">${severityBreakdown.CRITICAL} CRITICAL</strong> and
    <strong style="color:#ea580c">${severityBreakdown.HIGH} HIGH</strong> severity.
    <strong>${frequentStays.length}</strong> frequent stay patterns were flagged for review.
  </p>
</div>

<div class="section">
  <div class="section-title">2. Suspect Activity Analysis — Severity Breakdown</div>
  <div class="severity-grid">
    <div class="severity-item">
      <div class="severity-dot" style="background:#dc2626"></div>
      <span class="severity-label">CRITICAL</span>
      <div class="severity-bar-bg"><div class="severity-bar" style="width:${criticalPct}%;background:#dc2626"></div></div>
      <span class="severity-count" style="color:#dc2626">${severityBreakdown.CRITICAL}</span>
      <span class="severity-pct">${criticalPct}%</span>
    </div>
    <div class="severity-item">
      <div class="severity-dot" style="background:#ea580c"></div>
      <span class="severity-label">HIGH</span>
      <div class="severity-bar-bg"><div class="severity-bar" style="width:${highPct}%;background:#ea580c"></div></div>
      <span class="severity-count" style="color:#ea580c">${severityBreakdown.HIGH}</span>
      <span class="severity-pct">${highPct}%</span>
    </div>
    <div class="severity-item">
      <div class="severity-dot" style="background:#ca8a04"></div>
      <span class="severity-label">MEDIUM</span>
      <div class="severity-bar-bg"><div class="severity-bar" style="width:${mediumPct}%;background:#ca8a04"></div></div>
      <span class="severity-count" style="color:#ca8a04">${severityBreakdown.MEDIUM}</span>
      <span class="severity-pct">${mediumPct}%</span>
    </div>
    <div class="severity-item">
      <div class="severity-dot" style="background:#16a34a"></div>
      <span class="severity-label">LOW</span>
      <div class="severity-bar-bg"><div class="severity-bar" style="width:${lowPct}%;background:#16a34a"></div></div>
      <span class="severity-count" style="color:#16a34a">${severityBreakdown.LOW}</span>
      <span class="severity-pct">${lowPct}%</span>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">3. Provider Hotspot Rankings</div>
  <table>
    <thead>
      <tr>
        <th style="width:40px;text-align:center">#</th>
        <th>Provider Name</th>
        <th>Address</th>
        <th style="text-align:center">Total Matches</th>
        <th style="text-align:center">Critical</th>
        <th style="text-align:center">High</th>
      </tr>
    </thead>
    <tbody>
      ${hotspotRows}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">4. Frequent Stay Alerts</div>
  <table>
    <thead>
      <tr>
        <th>Guest Name</th>
        <th>Phone / ID</th>
        <th style="text-align:center">Stays</th>
        <th style="text-align:center">Avg Days</th>
        <th>Risk</th>
        <th>Providers Visited</th>
      </tr>
    </thead>
    <tbody>
      ${frequentRows}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">5. Geofence Configuration</div>
  <table>
    <thead>
      <tr>
        <th>Geofence Name</th>
        <th>Address</th>
        <th style="text-align:center">Radius</th>
        <th>Severity</th>
        <th style="text-align:center">Status</th>
      </tr>
    </thead>
    <tbody>
      ${geofenceRows}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">6. Recommendations &amp; Action Items</div>
  <ul class="rec-list">
    ${recommendations.join("")}
  </ul>
</div>

<div class="footer">
  <span>Oromia Police — Guest House Monitoring System</span>
  <span>Page 1 of 1 | Report ID: RPT-${year}${String(month).padStart(2, "0")}-${Date.now().toString(36).toUpperCase()}</span>
</div>

<div class="no-print" style="margin-top:24px;text-align:center;padding:16px">
  <button onclick="window.print()" style="padding:10px 28px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">Print / Save as PDF</button>
</div>

</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="police-report-${year}-${String(month).padStart(2, "0")}.html"`,
      },
    });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    }
    const msg = e instanceof Error ? e.message : "Failed to generate report";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
