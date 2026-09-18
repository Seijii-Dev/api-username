import { UAParser } from 'ua-parser-js';
import type { Request } from 'express';
import type { Hit } from './telegram';

const IP_HEADERS = [
  'cf-connecting-ip',
  'true-client-ip',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'x-client-ip',
  'x-cluster-client-ip',
];

const PRIVATE = [
  '10.', '192.168.', '127.', '169.254.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.',
  '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.',
];

function pickIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (typeof raw === 'string' && raw.length) {
    const first = raw.split(',')[0].trim();
    if (first) return first;
  }
  for (const h of IP_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string' && v.length) return v.split(',')[0].trim();
  }
  return (req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function chain(req: Request): string[] {
  const out: string[] = [];
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (typeof raw === 'string') {
    for (const p of raw.split(',')) {
      const t = p.trim();
      if (t) out.push(t);
    }
  }
  const r = req.socket?.remoteAddress;
  if (r && !out.includes(r)) out.push(r.replace(/^::ffff:/, ''));
  return out;
}

function isPrivate(ip: string): boolean {
  if (!ip || ip === 'unknown' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return PRIVATE.some(p => ip.startsWith(p));
}

async function geo(ip: string): Promise<Hit['geo']> {
  if (isPrivate(ip)) return undefined;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as`,
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    if (!r.ok) return undefined;
    const d: any = await r.json();
    if (d.status !== 'success') return undefined;
    return {
      country: d.country,
      countryCode: d.countryCode,
      region: d.regionName,
      city: d.city,
      zip: d.zip,
      lat: d.lat,
      lon: d.lon,
      timezone: d.timezone,
      isp: d.isp,
      org: d.org,
      as: d.as,
    };
  } catch {
    return undefined;
  }
}

export async function buildHit(req: Request, tag?: string): Promise<Hit> {
  const ip = pickIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');
  const r = new UAParser(ua).getResult();
  const hdrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    hdrs[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  const clientData = req.body && typeof req.body === 'object' ? req.body : undefined;
  return {
    ip,
    ipChain: chain(req),
    method: req.method,
    path: req.path,
    query: Object.entries(req.query)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v ?? '')}`)
      .join('&'),
    host: String(req.headers.host || ''),
    timestamp: new Date().toISOString(),
    userAgent: ua,
    referer: String(req.headers.referer || ''),
    origin: String(req.headers.origin || ''),
    acceptLanguage: String(req.headers['accept-language'] || ''),
    cookies: String(req.headers.cookie || ''),
    device: {
      browser: r.browser.name || 'unknown',
      browserVersion: r.browser.version || '',
      os: r.os.name || 'unknown',
      osVersion: r.os.version || '',
      vendor: r.device.vendor || '',
      model: r.device.model || '',
      type: r.device.type || 'desktop',
      cpu: r.cpu.architecture || '',
      engine: r.engine.name || '',
    },
    headers: hdrs,
    geo: await geo(ip),
    clientData,
    tag,
  };
}

export function clientIp(req: Request): string {
  return pickIp(req);
}
