# Security Audit — `/api/*` (Vercel BFF Layer)

**Audited:** 2026-05-28
**Scope:** all files in `api/` + `api/_lib/googleClient.js`

## TL;DR
The Apps Script layer is authenticated via `SCRIPT_KEY`. The Vercel BFF layer (the public attack surface at `fcfriend.vercel.app/api/*`) is **completely unauthenticated**. Anyone on the internet can read, create, update, and delete every row in the database. This is the single highest-severity finding.

This was already documented in `api/_lib/googleClient.js` comments — the key was leaked via git history. The fix is not just rotating the key; it's adding a Vercel-layer auth gate so the URL itself can't be hit by strangers.

## Findings

### 🔴 H-1 — Zero auth on public BFF endpoints
**Files:** `api/init.js`, `api/funds.js`, `api/members.js`, `api/matches.js`, `api/fixtures.js`
**Severity:** High
**Impact:** Anyone discovering the URL can:
- `GET /api/init` → read every member, payment, match, fixture
- `POST /api/funds` → inject a fake payment row
- `DELETE /api/members` → delete any member by name
- `PUT /api/matches` → rewrite any match cost

**Threat scenarios:**
- Competing team / disgruntled ex-member scrapes contributions.
- Bot scanner finds the endpoints via JS source on `fcfriend.vercel.app/app.js` (which references `/api/init`, `/api/funds` etc. in plain text).
- A single malicious DELETE wipes a sheet.

**Fix (recommended):**
1. Add `API_KEY` to Vercel env (32-byte random, e.g. `openssl rand -hex 32`).
2. Middleware in `googleClient.js` or new `api/_lib/auth.js`:
```javascript
export function requireKey(req, res) {
  const k = req.headers['x-fc-key'] || req.query.key;
  if (k !== process.env.API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
```
3. In each handler: `if (!requireKey(req, res)) return;` as first line.
4. Frontend: store key in `localStorage` (set once via existing Setup modal, similar to `fc_api_url`), send as `X-FC-Key` header on every `fetch`.
5. Bot: read from `.env`, send as header.

Trade-off: key in browser localStorage is not airtight (anyone with physical access to a member's phone can extract it), but it's two orders of magnitude better than `no auth at all`. Real auth (OAuth, signed sessions) is overkill for a 20-person utility.

### 🔴 H-2 — Apps Script key + URL leaked in git history
**File:** `api/_lib/googleClient.js` lines 8-9
**Severity:** High (already self-documented)
**Status:** Comments acknowledge the leak with a TODO. Not actioned yet.

Even after H-1 is fixed, an attacker who fishes the leaked Apps Script URL from git history can bypass the Vercel BFF entirely and hit Apps Script directly. The Apps Script also has no rate-limiting and no per-action authz beyond the single shared key.

**Fix:**
1. Rotate Apps Script: change `SCRIPT_KEY` constant in `Code.gs`, redeploy as new version → new URL.
2. Set `APPS_SCRIPT_URL` and `APPS_SCRIPT_KEY` in Vercel env.
3. Delete the hardcoded fallback in `googleClient.js`.
4. (Optional but recommended) `git filter-repo --invert-paths --path api/_lib/googleClient.js` on the old version, force-push. Or accept the leak as historical, assume rotation makes it inert.

### 🟡 M-1 — `Code.gs` has no rate limiting, no per-row authz
**File:** `Code.gs` line 31 (`doPost`)
**Severity:** Medium (mitigated if H-1 + H-2 are fixed)

A valid key holder can spam `deleteComposite` or `upsert` in a loop. Apps Script has a default 6-minute execution limit per invocation but no quota per-caller. An attacker with the key can write thousands of rows.

**Fix:** Not worth fixing standalone — close H-1 + H-2 first. If those are tight, M-1 reduces to "trusted users can break trust", which is policy not security.

### 🟡 M-2 — `cascadeMemberRename` updates DongQuy by exact (case-sensitive) match
**File:** `Code.gs` line 138-149
**Severity:** Medium (correctness, also a data integrity smell)

When admin renames "HỮU TRÍ" → "Hữu Trí" in ThanhVien, cascade only finds DongQuy rows where col 3 === "HỮU TRÍ" exactly. If the bot wrote "Hữu trí" earlier, that row is orphaned. Same root cause as the frontend bug.

**Fix:** Normalize comparison (`String(v).trim().toLocaleLowerCase()`) on both sides. Bot prompt should also pin canonical casing.

### 🟡 M-3 — `apiCall` swallows server error context
**File:** `app.js` line 996-998
**Severity:** Medium (operations, not security)

When Apps Script returns `{error: 'Sheet not found'}` with HTTP 200, `apiCall` returns null, frontend toasts "Lỗi mạng". User has no diagnostic. Should surface `data.error` in toast or console.

**Fix:**
```javascript
if (data && data.error) {
  console.error('API error payload:', endpoint, data.error);
  showToast(`Lỗi: ${data.error}`, 'error');
  return null;
}
```

### 🟢 L-1 — `Cache-Control` was missing on `/api/funds` GET
**Status:** Fixed in this patch. Added `no-store` header.

### 🟢 L-2 — `req.body` not validated for type / size
**Files:** all `api/*` POST/PUT handlers
**Severity:** Low

Vercel parses JSON body for us, but no per-field validation. A POST with `amount: "1e308"` or `member: "<script>"` flows through to Sheet untouched. Sheet escapes HTML on render, and amount is `Number()`'d at display time, so this is not exploitable today. But it's a footgun — one new render path that doesn't escape and you have stored XSS.

**Fix:** Add a tiny schema check (e.g. `typeof name === 'string' && name.length < 200`) at the top of each handler. ~5 LOC each.

### 🟢 L-3 — `.env` and `bot.log` in working tree
**Status:** `.env` shows as untracked in `git status` at session start — verify it's in `.gitignore`. `bot.log` is committed (should not be).

**Fix:** Add to `.gitignore`:
```
.env
zalo-bot/.env
zalo-bot/bot.log
zalo-bot/temp_*.jpg
zalo-bot/recent_msgs.txt
```

### 🟢 L-4 — `diagFunds.js` now gated, but with a default key
**Status:** Added in this patch. Default `DIAG_KEY = 'fc_diag_dev_only'` is intentional for local dev. **Must set `DIAG_KEY` in Vercel env before deploy** or the gate is theater.

## Suggested fix order
1. **Rotate Apps Script key + URL** (H-2). 15 min. No code change beyond `Code.gs` constant.
2. **Set Vercel envs:** `APPS_SCRIPT_URL`, `APPS_SCRIPT_KEY`, `API_KEY`, `DIAG_KEY`.
3. **Add `requireKey` middleware** (H-1). 30 min. Touches all 5 handlers + `app.js` fetch wrapper + `bot.py` headers.
4. **`.gitignore` cleanup** (L-3). 2 min.
5. **`apiCall` error surfacing** (M-3). 5 min.
6. **`cascadeMemberRename` normalize** (M-2). 10 min — coordinate with member name canonicalization session.
7. **Optional: input validation** (L-2). 20 min.

Steps 1-4 close the critical exposure. Steps 5-7 are quality-of-life.

## What's NOT a finding
- HTTPS — Vercel forces TLS, good.
- CORS — endpoints don't set permissive headers, browser-origin enforcement applies, good.
- SQL injection — no SQL, only Sheet writes via Apps Script which uses cell-level API, no injection vector.
- Prompt injection (bot Gemini) — separate audit; bot.py is out of this scope.
