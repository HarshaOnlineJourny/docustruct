// Tiny fetch wrapper with auth support.
//
// Normal GET/POST/DELETE go through Vite's proxy (relative '/api/...').
// File uploads (multipart) go DIRECTLY to the Express server on port 4000
// in development because Vite's proxy has long-standing issues buffering
// large multipart bodies — symptom: ECONNRESET on the proxy with the
// server never seeing the request. In production both client and server
// are on the same origin so the absolute URL collapses to relative.
const base = '/api';
const uploadBase = (import.meta.env?.DEV ? 'http://localhost:4000/api' : '/api');

function getAuthHeader() {
  const token = localStorage.getItem('session_token');
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

async function handle(res) {
  if (!res.ok) {
    let detail = '';
    let extra = '';
    try {
      const j = await res.json();
      detail = j.error || '';
      // Pass through skipped + diagnostic stack from dev mode.
      if (j.detail) extra = ` — ${j.detail}`;
      if (j.skipped) extra = ` [${j.skipped}]${extra}`;
    } catch {
      try { detail = (await res.text()).slice(0, 200); } catch {}
    }
    // Strip any HTML tags so the server can't accidentally inject markup
    // through a toast message.
    detail = String(detail).replace(/<[^>]*>/g, '').trim();
    extra = String(extra).replace(/<[^>]*>/g, '').trim();
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}${extra ? ' ' + extra : ''}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  get(path) {
    return fetch(base + path, {
      headers: getAuthHeader(),
    }).then(handle);
  },
  post(path, body) {
    return fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    }).then(handle);
  },
  delete(path) {
    return fetch(base + path, {
      method: 'DELETE',
      headers: getAuthHeader(),
    }).then(handle);
  },
  upload(path, formData) {
    return fetch(uploadBase + path, {
      method: 'POST',
      body: formData,
      headers: getAuthHeader(),
    }).then(handle);
  },
};

// Same direct-to-server URL builder for raw uploads (used by Import.jsx's
// uploadWithBody which needs to read the JSON body on non-2xx responses).
export function uploadUrl(path) { return uploadBase + path; }
