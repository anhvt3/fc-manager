const SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxvJNf_P7JCtQ1eAdK1fswkpkZaNB-q69TiBl13XxbZnLJB3teSLzOvWghAD7tZXoejcw/exec';
const SCRIPT_KEY = process.env.APPS_SCRIPT_KEY || 'fc_manager_secret_2026';

export async function gsGet(action) {
  const res = await fetch(`${SCRIPT_URL}?action=${action}&key=${SCRIPT_KEY}`);
  return res.json();
}

export async function gsPost(payload) {
  payload.key = SCRIPT_KEY;
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });
  return res.json();
}
