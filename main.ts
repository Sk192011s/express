import { serve } from "https://deno.land/std/http/server.ts";

interface Account {
  email: string;
  password: string;
  code: string;
  expiry: string;
}

// load accounts.json
const accounts: Account[] = JSON.parse(await Deno.readTextFile("accounts.json"));

// in-memory IP map (backup)
const userAccessByIP: Record<string, string> = {};

// helper: parse cookies
function parseCookies(header: string | null) {
  const out: Record<string,string> = {};
  if (!header) return out;
  header.split(";").forEach(pair => {
    const [k, ...v] = pair.trim().split("=");
    out[k] = decodeURIComponent(v.join("="));
  });
  return out;
}

// helper: seconds until next midnight (server local time)
function secondsUntilNextMidnight() {
  const now = new Date();
  const t = new Date(now);
  t.setDate(now.getDate() + 1);
  t.setHours(0,0,0,0);
  return Math.floor((t.getTime() - now.getTime()) / 1000);
}

// days left calc
function daysLeft(expiry: string): number {
  const today = new Date();
  const exp = new Date(expiry);
  const diff = exp.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/generate") {
    // cookie check
    const cookieHeader = req.headers.get("cookie");
    const cookies = parseCookies(cookieHeader);
    const cookieGenerated = cookies["generated_on"]; // format YYYY-MM-DD if set

    // IP fallback
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("forwarded") || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
    const todayKey = new Date().toISOString().split("T")[0];

    // If cookie says already generated today -> block
    if (cookieGenerated === todayKey || userAccessByIP[ip] === todayKey) {
      // also send nextAllowed time to show friendly message
      const nextTs = new Date();
      nextTs.setDate(nextTs.getDate() + 1);
      nextTs.setHours(0,0,0,0);
      return new Response(JSON.stringify({
        error: "⚠️ You already generated today. Try again tomorrow.",
        nextAllowed: nextTs.toISOString()
      }), { headers: { "content-type": "application/json" }});
    }

    // pick random account
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ error: "No accounts available." }), { headers: { "content-type": "application/json" }});
    }
    const acc = accounts[Math.floor(Math.random() * accounts.length)];
    const left = daysLeft(acc.expiry);

    // set server-side map and HttpOnly cookie until midnight
    userAccessByIP[ip] = todayKey;
    const maxAge = secondsUntilNextMidnight();
    const cookieStr = `generated_on=${todayKey}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
    const headers = new Headers({
      "content-type": "application/json",
      "Set-Cookie": cookieStr
    });

    return new Response(JSON.stringify({
      email: acc.email,
      password: acc.password,
      code: acc.code,
      days_left: left,
      expiry: acc.expiry,
      nextAllowed: new Date(Date.now() + maxAge*1000).toISOString()
    }), { headers });
  }

  // serve main UI (same as before) - make sure client checks localStorage before calling /generate
  if (url.pathname === "/") {
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Express Giveaway</title>
<style>
/* (keep your existing styles here) */
*{box-sizing:border-box}body{font-family:Poppins, sans-serif;background:linear-gradient(135deg,#1e3a8a,#2563eb,#3b82f6);color:#111827;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow-x:hidden}h1{color:white;margin-bottom:20px;text-shadow:1px 1px 3px rgba(0,0,0,0.3)}.btn{background:white;color:#2563eb;border:none;padding:12px 28px;border-radius:10px;font-weight:600;cursor:pointer}.container{width:90%;max-width:420px;margin-top:16px}.box{background:white;border-radius:12px;padding:18px;box-shadow:0 6px 25px rgba(0,0,0,0.15);display:none}.line{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;margin:8px 0}.label{font-weight:600;color:#374151}.value{color:#111827;word-break:break-all}.copy{background:#2563eb;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;margin-left:8px}.error{color:#f87171;margin-top:10px}.small{font-size:13px;color:rgba(255,255,255,0.9);margin-top:10px}
#gifts{position:fixed;top:0;left:0;width:100%;height:0;pointer-events:none;overflow:visible}.gift{position:absolute;font-size:20px;color:#f59e0b;animation:floatUp 6s linear}.@keyframes floatUp{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(-120vh) rotate(360deg);opacity:0}}
</style></head><body>
  <div style="text-align:center;padding:22px">
    <h1>Express Giveaway</h1>
    <button class="btn" id="generateBtn">Generate</button>
    <div class="small">You can generate once per day. Use the same browser/device.</div>
    <div class="container">
      <div id="box" class="box"></div>
      <div id="error" class="error"></div>
    </div>
  </div>
  <div id="gifts"></div>
<script>
  // client-side prevention: localStorage flag
  const genBtn = document.getElementById('generateBtn');
  const box = document.getElementById('box');
  const error = document.getElementById('error');

  function todayKey() {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  function disableIfGenerated() {
    const stored = localStorage.getItem('generated_on');
    if (stored === todayKey()) {
      genBtn.disabled = true;
      genBtn.textContent = 'Generated (today)';
    } else {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate';
    }
  }

  disableIfGenerated();

  genBtn.addEventListener('click', async () => {
    // client-side quick check
    if (localStorage.getItem('generated_on') === todayKey()) {
      error.textContent = '⚠️ You already generated today (client). Try again tomorrow.';
      return;
    }

    genBtn.disabled = true;
    genBtn.textContent = 'Generating…';
    try {
      const res = await fetch('/generate');
      const data = await res.json();
      if (data.error) {
        error.textContent = data.error || 'Generate failed';
        genBtn.disabled = false;
        genBtn.textContent = 'Generate';
        return;
      }
      // success: show box, set localStorage flag until midnight
      box.innerHTML = \`
        <div class="line"><span class="label">Email:</span><span class="value">\${data.email}</span><button class="copy" onclick="copyText('\${data.email}')">Copy</button></div>
        <div class="line"><span class="label">Password:</span><span class="value">\${data.password}</span><button class="copy" onclick="copyText('\${data.password}')">Copy</button></div>
        <div class="line"><span class="label">CODE:</span><span class="value">\${data.code}</span><button class="copy" onclick="copyText('\${data.code}')">Copy</button></div>
        <div class="line"><span class="label">Days Left:</span><span class="value">\${data.days_left}</span></div>
        <div class="line"><span class="label">Expiry Date:</span><span class="value">\${data.expiry}</span></div>\`;
      box.style.display = 'block';
      error.textContent = '';
      // set localStorage so next click blocked
      localStorage.setItem('generated_on', todayKey());
      disableIfGenerated();
    } catch (e) {
      error.textContent = 'Network error, try again.';
      genBtn.disabled = false;
      genBtn.textContent = 'Generate';
    }
  });

  function copyText(text) { navigator.clipboard.writeText(text).then(()=>{ alert('Copied!'); }); }

  // floating gifts
  function createGift() {
    const g = document.createElement('div'); g.className='gift'; g.textContent='🎁';
    g.style.left = Math.random()*100 + 'vw';
    g.style.fontSize = 12 + Math.random()*28 + 'px';
    g.style.animationDuration = 3 + Math.random()*5 + 's';
    document.getElementById('gifts').appendChild(g);
    setTimeout(()=>g.remove(),9000);
  }
  setInterval(createGift,700);
</script>
</body></html>`;
    return new Response(html, { headers: { "content-type": "text/html" }});
  }

  return new Response("Not Found", { status: 404});
});
