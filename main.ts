import { serve } from "https://deno.land/std/http/server.ts";

interface Account {
  email: string;
  password: string;
  code: string;
  expiry: string;
}

// load accounts.json
const accounts: Account[] = JSON.parse(await Deno.readTextFile("accounts.json"));

// in-memory maps
const userAccessByIP: Record<string, string> = {};
const userAccessByFingerprint: Record<string, string> = {};

// helpers
function parseCookies(header: string | null) {
  const out: Record<string, string> = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const [k, ...v] = pair.trim().split("=");
    out[k] = decodeURIComponent(v.join("="));
  });
  return out;
}

function secondsUntilNextMidnight() {
  const now = new Date();
  const t = new Date(now);
  t.setDate(now.getDate() + 1);
  t.setHours(0, 0, 0, 0);
  return Math.floor((t.getTime() - now.getTime()) / 1000);
}

function daysLeft(expiry: string): number {
  const today = new Date();
  const exp = new Date(expiry);
  const diff = exp.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

serve(async (req) => {
  const url = new URL(req.url);

  // POST /generate expects JSON: { fingerprint?: string }
  if (url.pathname === "/generate" && req.method === "POST") {
    const cookieHeader = req.headers.get("cookie");
    const cookies = parseCookies(cookieHeader);
    const cookieGenerated = cookies["generated_on"]; // YYYY-MM-DD if set

    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    const todayKey = new Date().toISOString().split("T")[0];

    // read body safely
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : null;

    // check cookie
    if (cookieGenerated === todayKey) {
      const nextTs = new Date();
      nextTs.setDate(nextTs.getDate() + 1);
      nextTs.setHours(0, 0, 0, 0);
      return new Response(JSON.stringify({
        error: "⚠️ You already generated today (cookie). Try again tomorrow.",
        nextAllowed: nextTs.toISOString(),
      }), { headers: { "content-type": "application/json" } });
    }

    // check fingerprint
    if (fingerprint && userAccessByFingerprint[fingerprint] === todayKey) {
      const nextTs = new Date();
      nextTs.setDate(nextTs.getDate() + 1);
      nextTs.setHours(0, 0, 0, 0);
      return new Response(JSON.stringify({
        error: "⚠️ You already generated today (device). Try again tomorrow.",
        nextAllowed: nextTs.toISOString(),
      }), { headers: { "content-type": "application/json" } });
    }

    // check IP fallback
    if (userAccessByIP[ip] === todayKey) {
      const nextTs = new Date();
      nextTs.setDate(nextTs.getDate() + 1);
      nextTs.setHours(0, 0, 0, 0);
      return new Response(JSON.stringify({
        error: "⚠️ You already generated today (network). Try again tomorrow.",
        nextAllowed: nextTs.toISOString(),
      }), { headers: { "content-type": "application/json" } });
    }

    // pick account
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ error: "No accounts available." }), { headers: { "content-type": "application/json" } });
    }
    const acc = accounts[Math.floor(Math.random() * accounts.length)];
    const left = daysLeft(acc.expiry);

    // mark generated
    userAccessByIP[ip] = todayKey;
    if (fingerprint) userAccessByFingerprint[fingerprint] = todayKey;

    // set HttpOnly cookie until midnight
    const maxAge = secondsUntilNextMidnight();
    const cookieStr = `generated_on=${todayKey}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
    const headers = new Headers({
      "content-type": "application/json",
      "Set-Cookie": cookieStr,
    });

    return new Response(JSON.stringify({
      email: acc.email,
      password: acc.password,
      code: acc.code,
      days_left: left,
      expiry: acc.expiry,
      nextAllowed: new Date(Date.now() + maxAge * 1000).toISOString()
    }), { headers });
  }

  // Serve main UI (GET /)
  if (url.pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Express Giveaway</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Poppins', sans-serif;
    background: linear-gradient(135deg, #1e3a8a, #2563eb, #3b82f6);
    color: #111827;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .wrap { width: 92%; max-width: 460px; text-align: center; padding: 28px; }
  h1 { color: white; margin-bottom: 18px; text-shadow: 1px 1px 3px rgba(0,0,0,0.3); }
  .btn {
    background: white; color: #2563eb; border: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; cursor: pointer;
    box-shadow: 0 6px 18px rgba(0,0,0,0.12); transition: 0.18s;
  }
  .btn:disabled { opacity: 0.6; transform: none; cursor: default; }
  .container { margin-top: 18px; }
  .box { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 6px 25px rgba(0,0,0,0.15); display: none; text-align: left; }
  .line { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin:8px 0; }
  .label { font-weight:700; color:#374151; width:38%; min-width:110px; }
  .value { color:#111827; flex:1; word-break:break-all; }
  .copy { background:#2563eb; color:white; border:none; border-radius:6px; padding:6px 10px; cursor:pointer; margin-left:8px; }
  .error { color:#f87171; margin-top:12px; font-weight:600; }
  .note { margin-top:10px; color:rgba(255,255,255,0.92); font-size:13px; }
  #gifts { position: fixed; top: 0; left: 0; width: 100%; height: 0; pointer-events: none; overflow: visible; z-index:0; }
  .gift { position:absolute; font-size:20px; color:#f59e0b; animation:floatUp linear; }
  @keyframes floatUp { 0%{ transform: translateY(0) rotate(0); opacity:1 } 100%{ transform: translateY(-120vh) rotate(360deg); opacity:0 } }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Express Giveaway</h1>
    <button class="btn" id="generateBtn">Generate</button>
    <div class="note">You can generate once per day from the same browser/device. (We use a lightweight device fingerprint + cookie.)</div>

    <div class="container">
      <div id="box" class="box"></div>
      <div id="error" class="error"></div>
    </div>
  </div>

  <div id="gifts"></div>

<script>
/*
 Client-side: build a simple fingerprint from browser characteristics,
 hash with SHA-256, then POST to /generate with { fingerprint }.
*/

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function disableIfGenerated() {
  const stored = localStorage.getItem('generated_on');
  const btn = document.getElementById('generateBtn');
  if (stored === todayKey()) {
    btn.disabled = true;
    btn.textContent = 'Generated (today)';
  } else {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}
disableIfGenerated();

async function sha256hex(str) {
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  // convert to hex
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Lightweight fingerprint string
function rawFingerprintString() {
  const nav = navigator;
  const parts = [
    nav.userAgent || '',
    nav.platform || '',
    nav.language || '',
    screen.width + 'x' + screen.height + 'x' + (screen.colorDepth || ''),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    navigator.hardwareConcurrency || '',
    (typeof navigator.deviceMemory !== 'undefined' ? navigator.deviceMemory : ''),
  ];
  return parts.join('||');
}

async function buildFingerprint() {
  const raw = rawFingerprintString();
  const hash = await sha256hex(raw);
  return hash;
}

document.getElementById('generateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('generateBtn');
  const box = document.getElementById('box');
  const error = document.getElementById('error');
  error.textContent = '';
  box.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Generating…';

  try {
    const fingerprint = await buildFingerprint();

    // quick client check
    if (localStorage.getItem('generated_on') === todayKey()) {
      error.textContent = '⚠️ You already generated today (client).';
      btn.disabled = false;
      btn.textContent = 'Generate';
      return;
    }

    const res = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint })
    });
    const data = await res.json();

    if (data.error) {
      error.textContent = data.error || 'Generate failed';
      btn.disabled = false;
      btn.textContent = 'Generate';
      return;
    }

    // success
    box.innerHTML = \`
      <div class="line"><div class="label">Email</div><div class="value">\${data.email}</div><button class="copy" onclick="copyText('\${data.email}')">Copy</button></div>
      <div class="line"><div class="label">Password</div><div class="value">\${data.password}</div><button class="copy" onclick="copyText('\${data.password}')">Copy</button></div>
      <div class="line"><div class="label">CODE</div><div class="value">\${data.code}</div><button class="copy" onclick="copyText('\${data.code}')">Copy</button></div>
      <div class="line"><div class="label">Days Left</div><div class="value">\${data.days_left}</div></div>
      <div class="line"><div class="label">Expiry Date</div><div class="value">\${data.expiry}</div></div>
    \`;
    box.style.display = 'block';

    // mark localStorage until midnight
    localStorage.setItem('generated_on', todayKey());
    disableIfGenerated();

    // set client-side small gift burst
    for (let i=0;i<6;i++) createGift();

    btn.disabled = true;
    btn.textContent = 'Generated (today)';
  } catch (e) {
    console.error(e);
    document.getElementById('error').textContent = 'Network error — try again';
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
});

function copyText(text) {
  navigator.clipboard.writeText(text).then(()=>{ alert('Copied!'); });
}

/* Floating gifts */
function createGift() {
  const g = document.createElement('div');
  g.className = 'gift';
  g.textContent = '🎁';
  g.style.left = Math.random()*100 + 'vw';
  g.style.fontSize = 12 + Math.random()*28 + 'px';
  g.style.animationDuration = 3 + Math.random()*5 + 's';
  document.getElementById('gifts').appendChild(g);
  setTimeout(()=>g.remove(), 9000);
}
setInterval(createGift, 700);
</script>
</body>
</html>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  return new Response("Not Found", { status: 404 });
});
