# CLAUDE.md — FC Manager project memory

> Đọc file này đầu mỗi session. Đây là context riêng của project + style cá nhân của anh chủ.

## Voice rules

- Em xưng **"em"**, gọi user là **"anh"**.
- Vietnamese chính, English chỉ cho thuật ngữ kỹ thuật.
- Direct, không filler, không "comprehensive/robust/crucial".
- Câu ngắn, mix 1 câu + 2-3 câu. Sound like typing fast.
- Concrete: file:line, số cụ thể, lệnh chạy được.
- Skip skill ceremony — nếu skill có 30 turn AskUserQuestion, em deliver thẳng output.
- Anh thích evidence: before/after numbers, screenshot URLs, diag JSON.
- Khi anh nói "duyệt" / "xác nhận" → execute, không hỏi lại.
- Trước khi mutate Sheet/prod, **pre-check** target exists → execute → **post-check** verify.

## Project architecture (1 phút overview)

```
PWA (index.html + app.js)  ─►  Vercel BFF (api/*.js)  ─►  Apps Script (Code.gs)  ─►  Google Sheets
       localStorage cache              GET/POST/PUT/DELETE       4 sheets: ThanhVien/TranDau/DongQuy/LichThiDau

Zalo Bot (Python, zalo-bot/bot.py)  ─PUT─►  /api/funds  (auto OCR bill → upsert)
```

- **Frontend deploy:** Vercel auto từ master push.
- **Backend deploy:** `clasp push` Code.gs → Apps Script editor → Manage deployments → New version. URL deployment giữ nguyên không cần update env.
- **clasp v3 + Workspace policy:** anh dùng `anhvt3@clevai.edu.vn` (managed by 9talk.net). Apps Script API toggle ON ở https://script.google.com/home/usersettings nhưng vẫn có thể "Invalid script key" do Workspace third-party policy. Fallback: paste tay vào editor.
- **Spreadsheet ID:** `1p9IvYqwM-dw0bpAlEie07LnUQafDeaxXOLf-oF6SzUk`
- **Apps Script ID:** `1lkUo--CGXOiacBdykHhKBNHNhLffOiontCxioacNvGK-cTGBBobYECXm` (57 chars — file `.clasp.json` đã đúng)
- **Apps Script Deployment URL:** `https://script.google.com/macros/s/AKfycbzgBkTfgT1OGV8rd25cBy4nT8WdGkQy0iyVdlzmxoiqoVO_xfIItqZMW2ytWyRrPKtdSA/exec`
- **SCRIPT_KEY (auth):** `fc_manager_secret_2026` (hardcoded ở Code.gs + googleClient.js — đã rò rỉ qua git, future TODO rotate)

## Bug class: identity matching (LESSON #1)

**Pattern:** so sánh tên member / tên period bằng `===` strict → fails khi casing / whitespace / format drift.

**Đã gặp:**
- Sheet có "HỮU TRÍ" (caps), bot ghi "Hữu Trí" (proper) → `find()` không match → row biến mất khỏi app dù vẫn nằm trên Sheet
- Period "Quỹ T5/2026" vs "Quỹ T05/2026" vs "Quỹ T5/2026 " → lệch im lặng
- `app.js` dùng numeric `period.id` (positional index) làm key → break nếu FUND_PERIODS reorder

**Fix forever:**
```js
// hoist top-level, dùng MỌI nơi so tên/period
const normName = (s) => String(s || '').trim().toLocaleLowerCase('vi-VN');
const normPeriod = (s) => String(s || '').trim().replace(/\s+/g, ' ').replace(/T0(\d)\//, 'T$1/');
```

## Bug class: silent data drift (LESSON #2)

**Pattern:** code "fallback gracefully" che bug → user không biết.

**Đã gặp:**
- `find()` thay vì `filter().reduce()` → chỉ thấy row đầu khi member có nhiều payments
- Partial sync: `if (Array.isArray(data.x)) state.x = data.x` → nếu key bị undefined, giữ stale localStorage. Phải validate ALL keys present.
- `Cache-Control: no-store` chỉ set ở 1 endpoint → endpoint khác serve stale
- `period: 0` fallback khi không match FUND_PERIODS → payment biến mất khỏi UI

**Rule:** silent failure = critical defect. Loud error > hide error. Diagnostic endpoint (`/api/diagFunds`) là gold để verify Sheet vs App.

## Bug class: concurrent write race (LESSON #3)

Apps Script **không có transactions**. `doPost` đọc sheet → tìm row → append/update. 2 PUT đồng thời = 2 dòng duplicate.

**Fix:** `LockService.getScriptLock().waitLock(10000)` wrap toàn bộ doPost body. Trả về `{error: 'Busy', code: 'LOCK_TIMEOUT'}` nếu hết thời gian chờ.

## Bug class: bot phantom data (LESSON #4)

Zalo bot OCR + Gemini không deterministic. Khi bot misidentify member, sửa = APPEND row mới, **không DELETE row sai** → phantom money cộng dồn.

**Trong session này:** session khác (Claude/script) đã thêm 4 row "Corrected from bot misidentification" timestamp 28/05 22:12 với 2.525K tiền ma. Phải DELETE timestamp-precise để xóa đúng row.

**Verify:** Google Sheets → File → Version history → trace ai ghi. Nếu phát hiện account lạ → revoke share.

## Apps Script gotchas

- **Cold start 4-8s.** Vercel hobby timeout 10s → set `AbortController` 12s ở BFF, 15s ở frontend.
- **Text amount "500.000"** từ Excel paste → `Number()` trả 500 (lệch 1000x) hoặc NaN. Phải normalize: `Number(s.replace(/[.,\s]/g, ''))`.
- **Blank row giữa sheet** → `getDataRange` trả về kèm theo. Filter `allEmpty` trong getSheetData.
- **`getValue()` của Date cell** trả về Date object. Phải `Utilities.formatDate('Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss')` để string-stable.
- **Apps Script response is HTML on auth fail** (login redirect) → BFF phải check `Content-Type: application/json` trước khi `res.json()`.

## API mutation protocol

**Anh đã yêu cầu rõ:** không POST/PUT/DELETE Sheet trừ khi anh duyệt explicitly. Em tuân thủ:
1. Pull data → propose plan (DELETE/UPDATE specific timestamps + members)
2. Show before state
3. Anh duyệt
4. Script: pre-check target rows exist → execute → post-check verify
5. Report delta clearly

**Timestamp-precise delete:** dùng `matchColumns: [1, 2, 3]` với `matchValues: [timestamp, period, member]` qua `deleteComposite`. Composite [2,3] (period+member) only safe khi member chỉ có 1 row.

## Anti-patterns trong codebase này

- `data.js` hardcoded INITIAL_MEMBERS / INITIAL_FUND_PAYMENTS — stale fallback, cold reload thấy data 2025. Should be empty arrays + loading skeleton.
- 30+ `zalo-bot/fix_*.py` scripts — band-aid mỗi lần bot lệch thay vì fix pipeline.
- Zero tests trên frontend trước commit `65b82c9`. Em đã add `test/fund.test.js` với 11 case.
- `/api/*` zero auth — anyone với URL có thể DELETE members. See [SECURITY-audit.md](SECURITY-audit.md).
- Catch-all `catch (e) { showToast('Lỗi mạng') }` ăn mất context, sai attribution.

## Working files

- [SPEC.md](SPEC.md) — overview architecture
- [PLAN-fund-fix.md](PLAN-fund-fix.md) — fix plan đã exec
- [SECURITY-audit.md](SECURITY-audit.md) — audit /api/*, H-1/H-2 critical chưa fix
- [api/diagFunds.js](api/diagFunds.js) — read-only reconciliation endpoint, gated bằng DIAG_KEY
- [test/fund.test.js](test/fund.test.js) — 11 smoke tests, `node --test test/fund.test.js`

## Quick commands

```powershell
# Pull live data (read-only)
curl.exe -sL "https://script.google.com/macros/s/AKfycbzgBkTfgT1OGV8rd25cBy4nT8WdGkQy0iyVdlzmxoiqoVO_xfIItqZMW2ytWyRrPKtdSA/exec?action=getAll&key=fc_manager_secret_2026" -o _live.json

# Run tests
node --test test/fund.test.js

# Push Code.gs (nếu clasp hoạt động)
clasp push -f

# Verify Vercel deploy
curl.exe -s "https://fcfriend.vercel.app/api/init" | head -c 500
```

## What's still broken (not yet fixed)

- H-1 SECURITY: zero auth trên `/api/*` (rotation chưa làm, key đã leak qua git)
- H-2 SECURITY: Apps Script SCRIPT_KEY rotation pending
- M-2: `cascadeMemberRename` ở Code.gs vẫn case-sensitive (frontend đã case-insensitive)
- Bot Code.gs upsert vẫn case-sensitive → bot vẫn tạo duplicate khi tên casing khác
- Bot prompt cho Gemini chưa pin canonical casing → tiếp tục mismatch
- `data.js` stale fallback chưa xóa
- `.env`, `bot.log`, `temp_*.jpg` chưa vào `.gitignore`
