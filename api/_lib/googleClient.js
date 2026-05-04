// ⚠️ SECURITY: SCRIPT_KEY và SCRIPT_URL hardcoded ở đây đã rò rỉ qua git history
// (repo public). TODO khẩn:
//   1) Set Vercel env: APPS_SCRIPT_URL + APPS_SCRIPT_KEY (Project → Settings → Env)
//   2) Rotate key trong Code.gs (đổi SCRIPT_KEY) + redeploy Apps Script với version mới
//      → URL mới → cập nhật APPS_SCRIPT_URL trên Vercel
//   3) Sau khi xác nhận env hoạt động, xóa fallback bên dưới
//   4) (Lý tưởng) Dùng `git filter-repo` xoá secret cũ khỏi git history rồi force-push.
const SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzgBkTfgT1OGV8rd25cBy4nT8WdGkQy0iyVdlzmxoiqoVO_xfIItqZMW2ytWyRrPKtdSA/exec';
const SCRIPT_KEY = process.env.APPS_SCRIPT_KEY || 'fc_manager_secret_2026';

export async function gsGet(action) {
  const res = await fetch(`${SCRIPT_URL}?action=${action}&key=${SCRIPT_KEY}`);
  if (!res.ok) throw new Error('Apps Script HTTP ' + res.status);
  return res.json();
}

export async function gsPost(payload) {
  payload.key = SCRIPT_KEY;
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Apps Script HTTP ' + res.status);
  return res.json();
}
