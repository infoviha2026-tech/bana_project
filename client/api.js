const TOKEN_KEY = 'bana.token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch('/api' + url, { method, headers, body: payload });
  if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized();
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : res;
  if (!res.ok) throw new Error((isJson && data.error) || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

/** Build a query string, dropping empty values */
export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
};

async function fetchBlob(url) {
  const res = await fetch('/api' + url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed');
  }
  const name = decodeURIComponent(res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'download');
  return { blob: await res.blob(), name };
}

/** Download an authenticated file (exports, templates) */
export async function download(url) {
  const { blob, name } = await fetchBlob(url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Open an authenticated file (certificate) in a new tab */
export async function openFile(url) {
  const win = window.open('', '_blank');
  try {
    const { blob } = await fetchBlob(url);
    const href = URL.createObjectURL(blob);
    if (win) win.location.href = href;
    else window.location.href = href;
  } catch (e) {
    win?.close();
    throw e;
  }
}
