// Smoke tests for the fund reconciliation logic.
// Run: node --test test/fund.test.js
//
// These DO NOT touch the DOM. They guard the normalization rules and the
// per-member sum logic that fixes the "lệch T5" bug class.
// If these helpers diverge from app.js, edit app.js — these are the spec.

import test from 'node:test';
import assert from 'node:assert/strict';

const normName = (s) => String(s || '').trim().toLocaleLowerCase('vi-VN');
const normPeriod = (s) => String(s || '').trim().replace(/\s+/g, ' ').replace(/T0(\d)\//, 'T$1/');

// Mimics renderFund's per-member reconciliation (the find→filter+reduce fix).
function reconcileMember(memberName, periodPayments) {
  const rows = periodPayments.filter(p => normName(p.member) === normName(memberName));
  return {
    rowCount: rows.length,
    total: rows.reduce((s, p) => s + (Number(p.amount) || 0), 0),
  };
}

test('normName collapses casing variants (Sheet drift)', () => {
  assert.equal(normName('Huỳnh Lê'), normName('HUỲNH LÊ'));
  assert.equal(normName('Huỳnh Lê'), normName('huỳnh lê'));
  assert.equal(normName('  Hữu Trí '), normName('HỮU TRÍ'));
  assert.notEqual(normName('Như Ý'), normName('Như Ý'.replace('Ý', 'Y')));
});

test('normPeriod tolerates whitespace + zero-padded month', () => {
  assert.equal(normPeriod('Quỹ T5/2026'), 'Quỹ T5/2026');
  assert.equal(normPeriod('  Quỹ T5/2026  '), 'Quỹ T5/2026');
  assert.equal(normPeriod('Quỹ  T5/2026'), 'Quỹ T5/2026');
  assert.equal(normPeriod('Quỹ T05/2026'), 'Quỹ T5/2026');
});

test('member with TWO rows in period sums correctly (regression: app.js:323 find())', () => {
  const payments = [
    { period: 9, member: 'Trần Quyền', amount: 200000 },
    { period: 9, member: 'Trần Quyền', amount: 1860000 },
    { period: 9, member: 'Xuân Hoàn', amount: 500000 },
  ];
  const r = reconcileMember('Trần Quyền', payments);
  assert.equal(r.rowCount, 2);
  assert.equal(r.total, 2060000, 'sum must include BOTH payments — the old find() only saw the first');
});

test('member name on Sheet in DIFFERENT casing still matches', () => {
  const payments = [
    { period: 9, member: 'HỮU TRÍ', amount: 500000 },
    { period: 9, member: 'Hữu Trí', amount: 300000 },
  ];
  const r = reconcileMember('Hữu Trí', payments);
  assert.equal(r.rowCount, 2);
  assert.equal(r.total, 800000);
});

test('paused member with payment is reconcilable (not silently dropped)', () => {
  const members = [
    { name: 'Trần Quyền', status: 'paused' },
    { name: 'Xuân Hoàn', status: 'active' },
  ];
  const payments = [
    { period: 9, member: 'Trần Quyền', amount: 500000 },
    { period: 9, member: 'Xuân Hoàn', amount: 500000 },
  ];
  // mimics renderFund's union of active + paid-set
  const activeKeys = new Set(members.filter(m => m.status === 'active').map(m => normName(m.name)));
  const paidKeys = new Set(payments.map(p => normName(p.member)));
  const visible = members.filter(m => activeKeys.has(normName(m.name)) || paidKeys.has(normName(m.name)));
  assert.equal(visible.length, 2, 'paused member with payment must remain visible');
});

test('period.amount=0 (custom period) does NOT produce NaN in shortfall calc', () => {
  const expected = Number(0) || 0;
  const paidAmount = 100000;
  const shortfall = expected > 0 ? expected - paidAmount : null;
  assert.equal(shortfall, null, 'when expected=0, we must not subtract — would render NaN');
});

test('EC-5: text amount "500.000" coerces to 500000, not 500', () => {
  const coerce = (val) => {
    if (typeof val === 'number') return val;
    if (val == null || val === '') return 0;
    const n = Number(String(val).trim().replace(/[.,\s ]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  assert.equal(coerce(500000), 500000);
  assert.equal(coerce('500.000'), 500000, 'admin paste with dots must NOT become 500');
  assert.equal(coerce('500,000'), 500000, 'admin paste with commas must NOT become NaN→0');
  assert.equal(coerce('1.860.000'), 1860000);
  assert.equal(coerce(''), 0);
  assert.equal(coerce(null), 0);
  assert.equal(coerce('abc'), 0);
});

test('EC-6: period identity by name survives FUND_PERIODS array reorder', () => {
  // Simulate the lookup that happens in renderFund. Identity is the period.name,
  // not the array index. Reorder the array → name still matches.
  const FUND_A = [{ id: 1, name: 'Đợt 1' }, { id: 2, name: 'Quỹ T5/2026' }];
  const FUND_B = [{ id: 1, name: 'Quỹ T5/2026' }, { id: 2, name: 'Đợt 1' }]; // reordered
  const payment = { period: 'Quỹ T5/2026', amount: 100000 };
  const matchA = FUND_A.find(f => f.name === payment.period);
  const matchB = FUND_B.find(f => f.name === payment.period);
  assert.ok(matchA, 'name-based match works before reorder');
  assert.ok(matchB, 'name-based match SURVIVES reorder (positional id would break)');
});

test('EC-7: payment for deleted member surfaces as orphan, not silently dropped', () => {
  const members = [{ name: 'Xuân Hoàn', status: 'active' }];
  const payments = [
    { member: 'Xuân Hoàn', amount: 500000 },
    { member: 'Trần Quyền', amount: 200000 }, // member was deleted
  ];
  const normName = (s) => String(s || '').trim().toLocaleLowerCase('vi-VN');
  const memberKeys = new Set(members.map(m => normName(m.name)));
  const orphans = payments.filter(p => !memberKeys.has(normName(p.member)));
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].member, 'Trần Quyền');
  assert.equal(orphans[0].amount, 200000);
});

test('EC-3: partial sync response (missing key) must reject, not partial-apply', () => {
  const data = { members: [{ name: 'A' }], matches: [], fundPayments: undefined, fixtures: [] };
  const required = ['members', 'matches', 'fundPayments', 'fixtures'];
  const missing = required.filter(k => !Array.isArray(data[k]));
  assert.equal(missing.length, 1);
  assert.equal(missing[0], 'fundPayments');
  // Reject — stale data is better than half-fresh data
});

test('orphan period (Sheet has period not in FUND_PERIODS) is detected, not silently mapped', () => {
  const FUND_PERIODS = [
    { id: 9, name: 'Quỹ T5/2026', amount: 500000 },
  ];
  const sheetRows = [
    { period: 'Quỹ T5/2026', member: 'A', amount: 500000 },
    { period: 'Quỹ Tết/2026', member: 'B', amount: 200000 }, // custom, unmapped
  ];
  let orphans = 0;
  for (const p of sheetRows) {
    const raw = normPeriod(p.period);
    const pd = FUND_PERIODS.find(f => normPeriod(f.name) === raw);
    if (!pd) orphans++;
  }
  assert.equal(orphans, 1, 'unmapped period must surface as orphan, not silently fall to id=0');
});
