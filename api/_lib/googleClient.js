// ⚠️ SECURITY: SCRIPT_KEY và SCRIPT_URL hardcoded ở đây đã rò rỉ qua git history
// (repo public). TODO khẩn:
//   1) Set Vercel env: APPS_SCRIPT_URL + APPS_SCRIPT_KEY (Project → Settings → Env)
//   2) Rotate key trong Code.gs (đổi SCRIPT_KEY) + redeploy Apps Script với version mới
//      → URL mới → cập nhật APPS_SCRIPT_URL trên Vercel
//   3) Sau khi xác nhận env hoạt động, xóa fallback bên dưới
//   4) (Lý tưởng) Dùng `git filter-repo` xoá secret cũ khỏi git history rồi force-push.
const SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzgBkTfgT1OGV8rd25cBy4nT8WdGkQy0iyVdlzmxoiqoVO_xfIItqZMW2ytWyRrPKtdSA/exec';
const SCRIPT_KEY = process.env.APPS_SCRIPT_KEY || 'fc_manager_secret_2026';

// 12s timeout — Apps Script cold start can take 6-8s; Vercel hard limit is 10s
// on hobby tier but 60s on pro. Pick a value that surfaces the right diagnostic.
const APPS_SCRIPT_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), APPS_SCRIPT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function parseJsonOrThrow(res, ctx) {
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status} (${ctx})`);
  // Apps Script auth/deploy issues return HTML (login page) with 200. Detect
  // and surface a clear error instead of letting res.json() throw SyntaxError.
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const body = await res.text();
    const snippet = body.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`Apps Script returned non-JSON (${ctx}, content-type=${ct}). Likely auth/deploy issue. Body: ${snippet}`);
  }
  return res.json();
}

export async function gsGet(action) {
  let res;
  try {
    res = await fetchWithTimeout(`${SCRIPT_URL}?action=${action}&key=${SCRIPT_KEY}`);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Apps Script timeout after ${APPS_SCRIPT_TIMEOUT_MS}ms (action=${action})`);
    throw e;
  }
  return parseJsonOrThrow(res, `action=${action}`);
}

export async function gsPost(payload) {
  payload.key = SCRIPT_KEY;
  let res;
  try {
    res = await fetchWithTimeout(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Apps Script timeout after ${APPS_SCRIPT_TIMEOUT_MS}ms (action=${payload.action})`);
    throw e;
  }
  return parseJsonOrThrow(res, `action=${payload.action}`);
}
