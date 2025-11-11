import { serve } from "https://deno.land/std/http/server.ts";

interface Account {
  email: string;
  password: string;
  code: string;
  expiry: string;
}

// Read account list from JSON file
const accounts: Account[] = JSON.parse(await Deno.readTextFile("accounts.json"));

// Track which IPs have generated today
const userAccess: Record<string, string> = {};

// Calculate days left
function daysLeft(expiry: string): number {
  const today = new Date();
  const exp = new Date(expiry);
  const diff = exp.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

serve(async (req) => {
  const url = new URL(req.url);

  // API endpoint for generating an account
  if (url.pathname === "/generate") {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const today = new Date().toDateString();

    // Limit user to 1 per day
    if (userAccess[ip] === today) {
      return new Response(JSON.stringify({ error: "⚠️ You can only generate once per day. Please try again tomorrow." }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Pick random account
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

  // Main UI page
  if (url.pathname === "/") {
    const html = `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ExpressVPN Giveaway</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Poppins', sans-serif;
    background: linear-gradient(135deg, #1e3a8a, #2563eb, #3b82f6);
    color: #111827;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  h1 {
    color: white;
    margin-bottom: 25px;
    text-shadow: 1px 1px 3px rgba(0,0,0,0.3);
  }
  .btn {
    background: white;
    color: #2563eb;
    border: none;
    padding: 14px 36px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 17px;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    transition: 0.25s;
  }
  .btn:hover {
    background: #f3f4f6;
    transform: scale(1.03);
  }
  .container {
    width: 90%;
    max-width: 420px;
    margin-top: 25px;
  }
  .box {
    background: white;
    border-radius: 16px;
    padding: 25px;
    box-shadow: 0 6px 25px rgba(0,0,0,0.15);
    display: none;
    animation: fadeIn 0.5s ease;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(15px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .line {
    margin: 10px 0;
    font-size: 15px;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
  }
  .label {
    font-weight: 600;
    color: #374151;
  }
  .value {
    color: #111827;
    word-break: break-all;
  }
  .copy {
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 13px;
    cursor: pointer;
    margin-left: 8px;
  }
  .copy:hover { background: #1e40af; }
  .error {
    color: #f87171;
    font-weight: bold;
    margin-top: 15px;
  }
</style>
</head>
<body>
  <h1>🎁 ExpressVPN Account Giveaway</h1>
  <button class="btn" id="generateBtn">Generate</button>

  <div class="container">
    <div id="box" class="box"></div>
    <div id="error" class="error"></div>
  </div>

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
      <div class='line'><span class='label'>Email:</span> <span class='value'>\${data.email}</span> <button class='copy' onclick='copyText("\${data.email}")'>Copy</button></div>
      <div class='line'><span class='label'>Password:</span> <span class='value'>\${data.password}</span> <button class='copy' onclick='copyText("\${data.password}")'>Copy</button></div>
      <div class='line'><span class='label'>CODE:</span> <span class='value'>\${data.code}</span> <button class='copy' onclick='copyText("\${data.code}")'>Copy</button></div>
      <div class='line'><span class='label'>Days Left:</span> <span class='value'>\${data.days_left}</span></div>
      <div class='line'><span class='label'>Expiry Date:</span> <span class='value'>\${data.expiry}</span></div>
    \`;
    box.style.display = 'block';
  }
};

function copyText(text) {
  navigator.clipboard.writeText(text);
  alert('Copied to clipboard!');
}
</script>
</body>
</html>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  return new Response("Not Found", { status: 404 });
});
