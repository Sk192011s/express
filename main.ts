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

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : null;

    // check cookie/fingerprint/IP
    if (cookieGenerated === todayKey || (fingerprint && userAccessByFingerprint[fingerprint] === todayKey) || userAccessByIP[ip] === todayKey) {
      const nextTs = new Date();
      nextTs.setDate(nextTs.getDate() + 1);
      nextTs.setHours(0, 0, 0, 0);
      return new Response(JSON.stringify({
        error: "⚠️ You already generated today. Try again tomorrow.",
        nextAllowed: nextTs.toISOString(),
      }), { headers: { "content-type": "application/json" } });
    }

    // pick random account
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
.box {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 6px 25px rgba(0,0,0,0.15);
  display: none;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
}
.error { color:#f87171; margin-top:12px; font-weight:600; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Express Giveaway</h1>
  <button class="btn" id="generateBtn">Generate</button>
  <div class="container">
    <div id="box" class="box"></div>
    <div id="error" class="error"></div>
  </div>
</div>

<script>
function todayKey() { return new Date().toISOString().split('T')[0]; }

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
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function rawFingerprintString() {
  const nav = navigator;
  const parts = [
    nav.userAgent||'',
    nav.platform||'',
    nav.language||'',
    screen.width+'x'+screen.height+'x'+(screen.colorDepth||''),
    Intl.DateTimeFormat().resolvedOptions().timeZone||'',
    navigator.hardwareConcurrency||'',
    (typeof navigator.deviceMemory !== 'undefined'? navigator.deviceMemory:''),
  ];
  return parts.join('||');
}

async function buildFingerprint() { return await sha256hex(rawFingerprintString()); }

document.getElementById('generateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('generateBtn');
  const box = document.getElementById('box');
  const error = document.getElementById('error');
  error.textContent = '';
  box.style.display='none';
  btn.disabled = true;
  btn.textContent='Generating…';

  try {
    const fingerprint = await buildFingerprint();
    if (localStorage.getItem('generated_on')===todayKey()) {
      error.textContent='⚠️ You already generated today. Try again tomorrow.';
      btn.disabled=false; btn.textContent='Generate';
      return;
    }
    const res = await fetch('/generate',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ fingerprint }) });
    const data = await res.json();
    if(data.error){ error.textContent='⚠️ You already generated today. Try again tomorrow.'; btn.disabled=false; btn.textContent='Generate'; return; }

    // single-line display
    box.innerHTML = \`\${data.email} | \${data.password} | \${data.code} | Days left: \${data.days_left} | Expiry: \${data.expiry}\`;
    box.style.display='block';
    localStorage.setItem('generated_on',todayKey());
    disableIfGenerated();
    btn.disabled=true; btn.textContent='Generated (today)';
  } catch(e){ console.error(e); error.textContent='Network error — try again'; btn.disabled=false; btn.textContent='Generate'; }
});
</script>
</body>
</html>`;
    return new Response(html,{headers:{'content-type':'text/html'}});
  }

  return new Response("Not Found", { status: 404 });
});
