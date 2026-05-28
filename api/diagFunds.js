import { gsGet } from './_lib/googleClient.js';

// Read-only diagnostic. Compares what the Sheet contains vs what the current
// app rendering logic would display for a given period. Surfaces:
//   - duplicate (period, member) rows
//   - member name mismatches against ThanhVien
//   - period string anomalies (whitespace, casing, format)
//   - per-member delta: app-visible amount vs true total
//
// Usage:
//   GET /api/diagFunds                       → current month (Quỹ T{m}/{y})
//   GET /api/diagFunds?period=Quỹ%20T5/2026  → explicit period
//   GET /api/diagFunds?period=all            → all periods, summary only

const norm = (s) => String(s == null ? '' : s).trim();
const normLower = (s) => norm(s).toLocaleLowerCase('vi-VN');
const normPeriod = (s) => norm(s).replace(/\s+/g, ' ');

function currentPeriodName() {
  const d = new Date();
  return `Quỹ T${d.getMonth() + 1}/${d.getFullYear()}`;
}

// Shared-secret gate. Set DIAG_KEY in Vercel env for prod; the default below is
// only meant for local dev. Diag exposes the same data as /api/init (which is
// also unauthenticated — see SECURITY.md), but we gate it because the response
// is more revealing (orphans, paused members, raw rows).
const DIAG_KEY = process.env.DIAG_KEY || 'fc_diag_dev_only';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const providedKey = req.query.key || req.headers['x-fc-diag-key'];
  if (providedKey !== DIAG_KEY) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or X-FC-Diag-Key header' });
  }

  try {
    const all = await gsGet('getAll');
    const members = Array.isArray(all.members) ? all.members : [];
    const payments = Array.isArray(all.fundPayments) ? all.fundPayments : [];

    const requestedRaw = req.query.period || currentPeriodName();
    const requestedNorm = normPeriod(requestedRaw);

    // Index of canonical member names (Sheet is source of truth)
    const memberNames = members.map((m) => norm(m.name)).filter(Boolean);
    const memberByLower = new Map(memberNames.map((n) => [normLower(n), n]));

    // ---- Period-level anomalies (whole sheet) ----
    const periodCounts = new Map();
    const allPeriodVariants = new Map(); // normalized → Set(raw)
    for (const p of payments) {
      const raw = norm(p.period);
      const lo = normPeriod(raw).toLocaleLowerCase('vi-VN');
      periodCounts.set(raw, (periodCounts.get(raw) || 0) + 1);
      if (!allPeriodVariants.has(lo)) allPeriodVariants.set(lo, new Set());
      allPeriodVariants.get(lo).add(raw);
    }
    const periodAnomalies = [];
    for (const [, variants] of allPeriodVariants) {
      if (variants.size > 1) {
        periodAnomalies.push({
          variants: [...variants],
          message: 'Multiple raw spellings collapse to the same period',
        });
      }
    }
    for (const raw of periodCounts.keys()) {
      if (raw !== normPeriod(raw)) {
        periodAnomalies.push({
          raw,
          normalized: normPeriod(raw),
          message: 'Whitespace differs from normalized form',
        });
      }
    }

    if (requestedRaw === 'all') {
      // Summary-only view
      const summary = [...periodCounts.entries()]
        .map(([period, count]) => ({ period, count }))
        .sort((a, b) => a.period.localeCompare(b.period));
      return res.status(200).json({
        mode: 'summary',
        memberCount: members.length,
        paymentCount: payments.length,
        periodSummary: summary,
        periodAnomalies,
      });
    }

    // ---- Focus on requested period ----
    // Match payment row to requested period using normalized comparison.
    const matchingRows = payments
      .filter((p) => normPeriod(p.period).toLocaleLowerCase('vi-VN') === requestedNorm.toLocaleLowerCase('vi-VN'))
      .map((p) => ({
        timestamp: p.timestamp || null,
        periodRaw: norm(p.period),
        member: norm(p.member),
        amount: Number(p.amount) || 0,
        note: p.note || '',
      }));

    // Duplicates: same (period, member) appears >1 time (case-insensitive on member)
    const byMemberLower = new Map();
    for (const row of matchingRows) {
      const key = normLower(row.member);
      if (!byMemberLower.has(key)) byMemberLower.set(key, []);
      byMemberLower.get(key).push(row);
    }
    const duplicates = [];
    for (const [key, rows] of byMemberLower) {
      if (rows.length > 1) {
        duplicates.push({
          memberKey: key,
          memberVariants: [...new Set(rows.map((r) => r.member))],
          count: rows.length,
          totalAmount: rows.reduce((s, r) => s + r.amount, 0),
          rows,
        });
      }
    }

    // Name mismatches: payment.member has no case-insensitive match in ThanhVien
    const orphans = matchingRows.filter((r) => !memberByLower.has(normLower(r.member)));

    // Per-member reconciliation: what app shows (find first) vs what it should (sum)
    const reconciliation = members
      .filter((m) => (m.status || 'active') === 'active')
      .map((m) => {
        const name = norm(m.name);
        const rowsExact = matchingRows.filter((r) => r.member === name);
        const rowsCaseInsensitive = matchingRows.filter((r) => normLower(r.member) === normLower(name));
        const appShownAmount = rowsExact.length > 0 ? rowsExact[0].amount : 0; // mimics app.js:323 find()
        const correctAmount = rowsCaseInsensitive.reduce((s, r) => s + r.amount, 0);
        const delta = correctAmount - appShownAmount;
        return {
          member: name,
          status: m.status || 'active',
          rowsExactCount: rowsExact.length,
          rowsCaseInsensitiveCount: rowsCaseInsensitive.length,
          appShownAmount,
          correctAmount,
          delta,
          memberVariantsOnSheet: [...new Set(rowsCaseInsensitive.map((r) => r.member))],
        };
      });

    const totals = {
      sheetRowCount: matchingRows.length,
      sheetTotal: matchingRows.reduce((s, r) => s + r.amount, 0),
      appVisibleTotal: reconciliation.reduce((s, r) => s + r.appShownAmount, 0),
      correctTotal: reconciliation.reduce((s, r) => s + r.correctAmount, 0),
    };
    totals.hiddenFromApp = totals.sheetTotal - totals.appVisibleTotal;

    const membersWithDelta = reconciliation.filter((r) => r.delta !== 0);
    const pausedWithPayments = members
      .filter((m) => (m.status || 'active') !== 'active')
      .map((m) => {
        const name = norm(m.name);
        const rows = matchingRows.filter((r) => normLower(r.member) === normLower(name));
        return rows.length ? { member: name, status: m.status, rowCount: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) } : null;
      })
      .filter(Boolean);

    return res.status(200).json({
      mode: 'period',
      requested: { raw: requestedRaw, normalized: requestedNorm },
      generatedAt: new Date().toISOString(),
      totals,
      verdict: buildVerdict({ duplicates, orphans, membersWithDelta, pausedWithPayments, periodAnomalies, requestedRaw }),
      duplicates,
      orphans,
      pausedMembersWithPayments: pausedWithPayments,
      periodAnomalies,
      reconciliation: membersWithDelta,
      reconciliationAll: reconciliation,
      rawRows: matchingRows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function buildVerdict({ duplicates, orphans, membersWithDelta, pausedWithPayments, periodAnomalies, requestedRaw }) {
  const issues = [];
  if (duplicates.length) issues.push(`${duplicates.length} member(s) with duplicate rows — app's find() shows only the first`);
  if (orphans.length) issues.push(`${orphans.length} orphan payment row(s) — member name not in ThanhVien`);
  if (membersWithDelta.length) issues.push(`${membersWithDelta.length} member(s) with delta between app-visible and true total`);
  if (pausedWithPayments.length) issues.push(`${pausedWithPayments.length} paused member(s) have payments — hidden from Fund tab but counted in Dashboard total`);
  const periodMatch = periodAnomalies.filter((a) => (a.variants || []).some((v) => v === requestedRaw) || a.raw === requestedRaw);
  if (periodMatch.length) issues.push(`Period string anomaly affecting requested period`);
  return {
    healthy: issues.length === 0,
    issues,
  };
}
