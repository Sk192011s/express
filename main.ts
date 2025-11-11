import { serve } from "https://deno.land/std/http/server.ts";

interface Account {
  email: string;
  password: string;
  code: string;
  expiry: string;
}

// File read
const accounts: Account[] = JSON.parse(await Deno.readTextFile("accounts.json"));

// Store daily users (reset every 24h)
const userAccess: Record<string, string> = {};

function daysLeft(expiry: string): number {
  const today = new Date();
  const exp = new Date(expiry);
  const diff = exp.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/generate") {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const today = new Date().toDateString();

    // check daily limit
    if (userAccess[ip] === today) {
      return new Response(JSON.stringify({ error: "You can only generate once per day!" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // random account
    const acc = accounts[Math.floor(Math.random() * accounts.length)];
    const left = daysLeft(acc.expiry);

    userAccess[ip] = today;

    return new Response(
      JSON.stringify({
        email: acc.email,
        password: acc.password,
        code: acc.code,
        days_left: left,
        expiry: acc.expiry,
      }),
      { headers: { "content-type": "application/json" } },
    );
  }

  // HTML UI
  if (url.pathname === "/") {
    const html = `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ExpressVPN Giveaway</title>
<style>
  body { font-family: Poppins, sans-serif; background: #f3f4f6; text-align: center; padding: 40px; }
  .btn { background: #2563eb; color: white; border: none; padding: 12px 30px; border-radius: 8px; cursor: pointer; font-size: 16px; }
  .btn:hover { background: #1e40af; }
  .box { background: white; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); padding: 25px; width: 350px; margin: 30px auto; display: none; text-align: left; }
  .line { margin: 10px 0; font-weight: 500; }
  .copy { color: #2563eb; cursor: pointer; font-size: 14px; margin-left: 8px; }
  .error { color: red; font-weight: bold; margin-top: 20px; }
</style>
</head>
<body>
  <h1>🎁 ExpressVPN Account Giveaway</h1>
  <button class="btn" id="generateBtn">Generate</button>
  <div id="box" class="box"></div>
  <div id="error" class="error"></div>
<script>
document.getElementById('generateBtn').onclick = async () => {
  const res = await fetch('/generate');
  const data = await res.json();
  const box = document.getElementById('box');
  const error = document.getElementById('error');
  if (data.error) {
    error.textContent = data.error;
    box.style.display = 'none';
  } else {
    error.textContent = '';
    box.innerHTML = \`
      <div class='line'><b>Email:</b> \${data.email} <span class='copy' onclick='copyText("\${data.email}")'>Copy</span></div>
      <div class='line'><b>Password:</b> \${data.password} <span class='copy' onclick='copyText("\${data.password}")'>Copy</span></div>
      <div class='line'><b>CODE:</b> \${data.code} <span class='copy' onclick='copyText("\${data.code}")'>Copy</span></div>
      <div class='line'><b>Days Left:</b> \${data.days_left}</div>
      <div class='line'><b>Expiry Date:</b> \${data.expiry}</div>
    \`;
    box.style.display = 'block';
  }
};

function copyText(text) {
  navigator.clipboard.writeText(text);
  alert('Copied!');
}
</script>
</body>
</html>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  return new Response("Not Found", { status: 404 });
});
