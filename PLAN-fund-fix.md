# Fix Plan — Fund Display Discrepancy (T5/2026 + class of bugs)

## Goal
App's Fund tab must equal Sheet's reality for every period, every member. Make "lệch tháng 5" impossible to recur by fixing the bug class, not just the symptom.

## Scope
- Frontend: `app.js` (renderFund, syncFromSheet, saveFund)
- BFF: `api/funds.js` (cache header), `api/diagFunds.js` (already built)
- Apps Script: no changes (upsert already correct)
- Bot: prompt hardening for member name (separate change, not in this PR)

NOT in scope:
- member_id refactor (strategic, separate plan)
- Zalo bot OCR pipeline changes
- Removing `data.js` fallback (medium-term)
- Tests infrastructure setup

## Changes

### Change 1 — `app.js:312-335` `renderFund()` sum + case-insensitive match
Replace `find()` with `filter().reduce()` and normalize comparison.

```javascript
const norm = (s) => String(s || '').trim().toLocaleLowerCase('vi-VN');

function renderFund() {
  const period = FUND_PERIODS[state.currentFundPeriod - 1];
  if (!period) return;
  document.getElementById('fundPeriodLabel').textContent = period.name;

  const payments = state.fundPayments.filter(p => p.period === period.id);
  const total = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  document.getElementById('fundPeriodTotal').textContent = fmt(total) + 'đ';

  // Members shown: active members + any member appearing in payments for this period
  // (catches paused members with payments — Dashboard already counts their amount)
  const activeNames = new Set(state.members.filter(m => m.status === 'active').map(m => norm(m.name)));
  const paidNames = new Set(payments.map(p => norm(p.member)));
  const memberRows = state.members.filter(m => activeNames.has(norm(m.name)) || paidNames.has(norm(m.name)));

  const html = memberRows.map(member => {
    const memberPayments = payments.filter(p => norm(p.member) === norm(member.name));
    const paidAmount = memberPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const hasPaid = memberPayments.length > 0;
    const latestTs = memberPayments.map(p => p.timestamp).filter(Boolean).sort().pop();
    const expected = period.amount || 0;
    const isFullyPaid = expected ? paidAmount >= expected : hasPaid;
    const initials = safeInitial(member.name);
    const statusBadge = member.status === 'paused' ? ' <span class="paused-tag">(tạm nghỉ)</span>' : '';
    return `<div class="fund-row">
      <div class="fund-avatar">${initials}</div>
      <div class="fund-info">
        <div class="fund-name">${member.name}${statusBadge}</div>
        <div class="fund-detail" style="display:flex; align-items:center; gap:8px;">
          ${hasPaid ? fmt(paidAmount) + 'đ' : 'Chưa nộp'}
          ${latestTs ? `<span style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-size:0.7rem; color:#9ca3af; line-height:1;">${fmtDate(latestTs)}</span>` : ''}
          ${memberPayments.length > 1 ? `<span style="background:rgba(245,158,11,0.15); color:#f59e0b; padding:2px 6px; border-radius:4px; font-size:0.7rem;">${memberPayments.length} lần</span>` : ''}
        </div>
      </div>
      <div class="fund-status ${hasPaid ? (isFullyPaid ? 'paid' : 'partial') : 'unpaid'}">
        ${hasPaid ? (isFullyPaid ? '✓ Đủ' : `⚠ Thiếu ${fmt(expected - paidAmount)}đ`) : '✗ Chưa'}
      </div>
    </div>`;
  }).join('') || '<div class="empty-state"><p>Chưa có thành viên hoạt động</p></div>';
  document.getElementById('fundList').innerHTML = html;
}
```

### Change 2 — `app.js:1061-1066` period normalization + warn on orphans
```javascript
if (Array.isArray(data.fundPayments)) {
  const normPeriod = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  let orphanPeriodCount = 0;
  state.fundPayments = data.fundPayments.map(p => {
    const raw = normPeriod(p.period);
    const pd = FUND_PERIODS.find(f => f.name === raw);
    if (!pd) orphanPeriodCount++;
    return { ...p, period: pd ? pd.id : 0, periodRaw: raw, amount: Number(p.amount) || 0 };
  });
  if (orphanPeriodCount > 0) {
    console.warn(`syncFromSheet: ${orphanPeriodCount} payments with unrecognized period — see periodRaw`);
  }
}
```

### Change 3 — `app.js:683-717` `saveFund()` always upsert
Remove POST branch; bot already uses PUT (upsert). App should too — eliminates the "two clients race-creates duplicate rows" class.

```javascript
// Replace lines 703-706 with:
const ok = await apiCall('/api/funds', 'PUT', { period: periodName, member, amount, note });
```
Also drop `isUpdate` branch from local state mutation — always upsert in `state.fundPayments`:
```javascript
const existing = state.fundPayments.findIndex(p => p.period === periodId && p.member === member);
const prevSnapshot = existing >= 0 ? { ...state.fundPayments[existing] } : null;
if (existing >= 0) state.fundPayments[existing] = { ...state.fundPayments[existing], amount, note };
else state.fundPayments.push({ period: periodId, member, amount, note });
// ... PUT, on failure restore prevSnapshot or pop
```

### Change 4 — `api/funds.js` cache header on GET
```javascript
if (method === 'GET') {
  const data = await gsGet(`read&sheet=${sheet}`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.status(200).json(data);
}
```

### Change 5 — `style.css` add `.fund-status.partial` and `.paused-tag`
```css
.fund-status.partial { background: rgba(245,158,11,0.15); color: #f59e0b; }
.paused-tag { color: #9ca3af; font-size: 0.75rem; font-weight: normal; }
```

### Change 6 — `api/diagFunds.js` (already done)
Read-only endpoint for verification. Wire a tiny admin link in app footer (optional):
```html
<a href="/api/diagFunds" target="_blank" style="font-size:0.7rem;color:#6b7280">🔍 diag</a>
```

## Verification checklist

Pre-deploy (manual, on staging or dev branch):
1. Hit `/api/diagFunds?period=Quỹ T5/2026` → confirm `duplicates`, `orphans`, `reconciliation` arrays.
2. Note `totals.hiddenFromApp` BEFORE fix.
3. Apply changes 1-5, rebuild.
4. Open app → Fund tab → T5/2026 → manually verify amounts match `correctTotal` from diag.
5. Open Fund modal, add same member same period twice → confirm second is an update, not duplicate. Check Sheet — should still be 1 row.
6. Mark a member `paused` who has a payment in T5 → confirm they appear in Fund list with `(tạm nghỉ)` badge.

Post-deploy:
1. Diff `/api/diagFunds?period=all` before/after — `periodAnomalies` should be empty (after Sheet cleanup) or at least monitored.
2. Force-refresh PWA on mobile, verify no stale cache via Vercel CDN.

## Acceptance criteria
- For every period, `app's Fund tab total` === `/api/diagFunds correctTotal` (modulo cents — there are no cents).
- For T5/2026 specifically, every Sheet row is accounted for in the rendered list.
- Paused members with payments in the active period are visible (not silently excluded).
- No new POST `/api/funds` calls from app (all upserts). Bot unchanged.

## Risk + rollback
- Surface area: 1 frontend file, 1 BFF file, 1 CSS file. ~80 lines net.
- Rollback: git revert. Zero data migration. Zero backend (Apps Script) changes.
- Risk: changing `saveFund` to always-PUT changes server semantics from append to upsert. If user intends "I want to log a SECOND payment for same member same period" they can no longer do it via the app — that becomes correct behavior (it was a bug before).

## What this does NOT fix
- Sheet name canonicalization (still requires manual cleanup once)
- Bot returning inconsistent casing (separate change in `zalo-bot/bot.py` Gemini prompt)
- `data.js` stale fallback (cleanup later)
- Zero test coverage (add 1 Playwright test for fund flow after this lands)

## Deploy order
1. Merge frontend + BFF changes. Vercel deploys atomically.
2. Browser hard refresh (or version-bump service worker if any).
3. Run diag, eyeball Fund tab.
4. Schedule Sheet name canonicalization session (15 min, manual).
