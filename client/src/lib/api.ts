// API client. No hardcoded localhost: relative '/api' in dev + on Render.
// The __PORT_5000__ token is rewritten when the app is deployed behind a proxy.
const RAW = '__PORT_5000__';
export const API_BASE = RAW.startsWith('__') ? '' : RAW;

let authToken: string | null = null; // memory only — cookies can be blocked in sandboxed iframes
export const setToken = (t: string | null) => { authToken = t; };
export const getToken = () => authToken;

export async function api<T = any>(path: string, opts: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as any) };
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers, credentials: 'include' });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (opts.raw) return res as any;
  return res.status === 204 ? (null as any) : res.json();
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: any, headers?: Record<string, string>) =>
  api<T>(p, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}), headers });
export const patch = <T = any>(p: string, body?: any) => api<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const put = <T = any>(p: string, body?: any) => api<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

export const money = (n: number | null | undefined) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const shortDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(+d)) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const fullDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(+d)) return s;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const dayDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s.replace(' ', 'T'));
  if (isNaN(+d)) return s;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export const STATUS_FLOW = ['new', 'proof', 'approved', 'print', 'finishing', 'ready', 'shipped', 'completed'] as const;
export const STATUS_LABEL: Record<string, string> = {
  new: 'New', proof: 'Proof', approved: 'Approved', print: 'Print', finishing: 'Finishing',
  ready: 'Ready', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled',
};
export const STATUS_TONE: Record<string, string> = {
  new: 'bg-[#00AEEF]/12 text-[#0475A0] border-[#00AEEF]/30',
  proof: 'bg-[#EC008C]/10 text-[#B00A6C] border-[#EC008C]/25',
  approved: 'bg-[#FFF200]/25 text-[#7A6A00] border-[#D6CB00]/50',
  print: 'bg-ink/8 text-ink border-ink/20',
  finishing: 'bg-[#7C3AED]/10 text-[#5B21B6] border-[#7C3AED]/25',
  ready: 'bg-[#059669]/10 text-[#046B4D] border-[#059669]/25',
  shipped: 'bg-[#0F766E]/10 text-[#0B5D57] border-[#0F766E]/25',
  completed: 'bg-ink-100 text-ink-500 border-ink-100',
  cancelled: 'bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25',
};
export const PAY_TONE: Record<string, string> = {
  paid: 'bg-[#059669]/10 text-[#046B4D] border-[#059669]/25',
  deposit: 'bg-[#FFF200]/25 text-[#7A6A00] border-[#D6CB00]/50',
  unpaid: 'bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25',
};
export const CATEGORIES = ['Apparel', 'Signage & Banners', 'Vinyl & Decals', 'Business Print', 'Blueprints', 'Promo'];
export const CATEGORY_TONE: Record<string, string> = {
  Apparel: 'border-l-[#00AEEF]', 'Signage & Banners': 'border-l-[#EC008C]', 'Vinyl & Decals': 'border-l-[#E11D2E]',
  'Business Print': 'border-l-[#1F2328]', Blueprints: 'border-l-[#0F766E]', Promo: 'border-l-[#D6CB00]',
};
export const CHART_COLORS = ['#00AEEF', '#EC008C', '#1F2328', '#E11D2E', '#0F766E', '#D6CB00'];

/** Resolve an image path for both Render (absolute root) and proxied preview hosting. */
export function asset(url?: string | null): string {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`; // served by the API
  return url.startsWith('/') ? `.${url}` : url;               // static client asset
}
