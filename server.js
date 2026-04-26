// ═══════════════════════════════════════════════════════════
//  TECHVERSE 2025 — Full-Stack Server
//  Pure Node.js (no npm) · node:sqlite · node:http
// ═══════════════════════════════════════════════════════════
'use strict';

process.emitWarning = () => {}; // suppress experimental warnings

const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const url      = require('url');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3000;
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'db', 'techverse.db');

// ── MIME types ──────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.pdf':  'application/pdf',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.txt':  'text/plain',
};

// ── Database Setup ────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reg_id      TEXT UNIQUE NOT NULL,
    event       TEXT NOT NULL,
    team_name   TEXT NOT NULL,
    members     TEXT NOT NULL,
    contact     TEXT NOT NULL,
    email       TEXT NOT NULL,
    utr         TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token       TEXT PRIMARY KEY,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );
`);

const ADMIN_PASS = 'techverse@2025'; // change in production

// ── Registration ID generator ─────────────────────────────
function genRegId(event) {
  const prefix = {
    hackathon: 'HCK', shortfilm: 'SFM', debate: 'DBT',
    itquiz: 'ITQ', debugging: 'DBG'
  }[event] || 'TVR';
  const rand = crypto.randomInt(10000, 99999);
  return `${prefix}-${rand}`;
}

// ── Parse POST body ───────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json')) {
          resolve(JSON.parse(body));
        } else if (ct.includes('application/x-www-form-urlencoded')) {
          const p = new URLSearchParams(body);
          const obj = {};
          for (const [k, v] of p) obj[k] = v;
          resolve(obj);
        } else {
          resolve({});
        }
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── JSON response helpers ──────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function jsonErr(res, msg, status = 400) {
  json(res, { success: false, error: msg }, status);
}

// ── Serve static files ────────────────────────────────────
function serveStatic(res, filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public,max-age=3600' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// ── Auth check ────────────────────────────────────────────
function isAdmin(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/admin_token=([^;]+)/);
  if (!match) return false;
  const row = db.prepare('SELECT token FROM admin_sessions WHERE token=?').get(match[1]);
  return !!row;
}

// ── QR Code Generator (pure JS — SVG output) ─────────────
// Minimal QR v3 (ECC-M) for short UPI strings
const QR = require('./utils/qr.js');

// ── UPI QR Data ───────────────────────────────────────────
function makeUpiQR(amount, regId, event) {
  const upiId  = '9876543210@upi'; // dummy UPI ID
  const note   = encodeURIComponent(`Techverse2025-${regId}`);
  const name   = encodeURIComponent('Techverse 2025');
  const upiStr = `upi://pay?pa=${upiId}&pn=${name}&am=${amount}&tn=${note}&cu=INR`;
  return QR.toSVG(upiStr);
}

// ── EVENT CONFIG ──────────────────────────────────────────
const EVENTS = {
  hackathon: { label: 'Hackathon',       fee: 200, members: 4 },
  shortfilm: { label: 'Short Film',      fee: 200, members: 4 },
  debate:    { label: 'Debate',          fee: 100, members: 2 },
  itquiz:    { label: 'IT Quiz',         fee: 100, members: 2 },
  debugging: { label: 'Debugging',       fee: 100, members: 2 },
};

// ── RECEIPT HTML generator ────────────────────────────────
function buildReceiptHTML(reg) {
  const ev     = EVENTS[reg.event] || { label: reg.event, fee: '?', members: 1 };
  const members = JSON.parse(reg.members);
  const now    = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<title>Receipt — ${reg.reg_id}</title>
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Space+Grotesk:wght@400;600&family=Share+Tech+Mono&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#07060f;color:#fff;font-family:'Space Grotesk',sans-serif;padding:2rem;min-height:100vh}
.receipt{max-width:600px;margin:0 auto;border:1px solid rgba(103,58,183,.4);padding:2.5rem;position:relative}
.receipt::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#673ab7,#ffca28)}
.r-logo{font-family:'Black Han Sans',sans-serif;font-size:1.4rem;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.2rem}
.r-logo span{color:#ffca28}
.r-sub{font-family:'Share Tech Mono',monospace;font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:2rem}
.r-badge{display:inline-block;background:#ffca28;color:#000;font-family:'Share Tech Mono',monospace;font-size:.65rem;font-weight:700;letter-spacing:.14em;padding:.25em .8em;text-transform:uppercase;margin-bottom:1.5rem}
.r-id{font-family:'Black Han Sans',sans-serif;font-size:2rem;letter-spacing:.06em;margin-bottom:.3rem}
.r-status{font-family:'Share Tech Mono',monospace;font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;color:#4ade80;margin-bottom:2rem}
.r-divider{height:1px;background:linear-gradient(90deg,rgba(103,58,183,.5),transparent);margin:1.5rem 0}
.r-row{display:flex;justify-content:space-between;padding:.65rem 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.9rem}
.r-row:last-child{border-bottom:none}
.r-row span:first-child{color:rgba(255,255,255,.5)}
.r-row span:last-child{color:#fff;font-weight:600;text-align:right;max-width:65%}
.r-footer{margin-top:2rem;font-family:'Share Tech Mono',monospace;font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.25);text-align:center}
.print-btn{display:block;width:100%;margin-top:2rem;padding:1em;background:#673ab7;color:#fff;border:none;cursor:pointer;font-family:'Black Han Sans',sans-serif;font-size:.85rem;letter-spacing:.12em;text-transform:uppercase}
.print-btn:hover{background:#9575cd}
@media print{.print-btn{display:none}body{background:#fff;color:#000}.receipt{border:1px solid #ccc}
.r-logo{color:#000}.r-id{color:#000}.r-row span{color:#000!important}}
</style></head><body>
<div class="receipt">
  <div class="r-logo">Tech<span>verse</span> 2025</div>
  <div class="r-sub">Registration Receipt · BCA Department</div>
  <div class="r-badge">✓ Registered</div>
  <div class="r-id">${reg.reg_id}</div>
  <div class="r-status">● Registration Confirmed</div>
  <div class="r-divider"></div>
  <div class="r-row"><span>Event</span><span>${ev.label}</span></div>
  <div class="r-row"><span>Team Name</span><span>${reg.team_name}</span></div>
  <div class="r-row"><span>Members</span><span>${members.join(', ')}</span></div>
  <div class="r-row"><span>Contact</span><span>${reg.contact}</span></div>
  <div class="r-row"><span>Email</span><span>${reg.email}</span></div>
  <div class="r-row"><span>UTR / Transaction ID</span><span>${reg.utr}</span></div>
  <div class="r-row"><span>Registration Fee</span><span>₹${ev.fee}</span></div>
  <div class="r-row"><span>Event Date</span><span>May 15–16, 2025</span></div>
  <div class="r-row"><span>Venue</span><span>DAMS, Bangalore</span></div>
  <div class="r-row"><span>Registered At</span><span>${reg.created_at}</span></div>
  <div class="r-divider"></div>
  <div class="r-footer">This is your official registration receipt. Please save or print this page.<br/>© 2025 Techverse · BCA Department · Computer Science</div>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
</div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════
//  REQUEST ROUTER
// ══════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const method   = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // ── API: Register ─────────────────────────────────────
  if (pathname === '/api/register' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { event, team_name, members, contact, email, utr } = body;

      if (!event || !team_name || !members || !contact || !email || !utr)
        return jsonErr(res, 'All fields are required');

      const ev = EVENTS[event];
      if (!ev) return jsonErr(res, 'Invalid event');

      const memberArr = Array.isArray(members) ? members : JSON.parse(members);
      const filtered  = memberArr.filter(m => m && m.trim());
      if (filtered.length < 1) return jsonErr(res, 'At least 1 member required');

      // Check duplicate UTR for same event
      const dup = db.prepare('SELECT id FROM registrations WHERE event=? AND utr=?').get(event, utr.trim());
      if (dup) return jsonErr(res, 'This UTR/Transaction ID is already registered for this event');

      const reg_id = genRegId(event);
      db.prepare(`
        INSERT INTO registrations (reg_id, event, team_name, members, contact, email, utr)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(reg_id, event, team_name.trim(), JSON.stringify(filtered), contact.trim(), email.trim(), utr.trim());

      const reg = db.prepare('SELECT * FROM registrations WHERE reg_id=?').get(reg_id);
      return json(res, { success: true, reg_id, registration: reg });
    } catch (e) {
      console.error('Register error:', e.message);
      return jsonErr(res, 'Server error: ' + e.message, 500);
    }
  }

  // ── API: Get registration by ID ───────────────────────
  if (pathname.startsWith('/api/registration/') && method === 'GET') {
    const reg_id = pathname.split('/').pop();
    const reg = db.prepare('SELECT * FROM registrations WHERE reg_id=?').get(reg_id);
    if (!reg) return jsonErr(res, 'Registration not found', 404);
    reg.members = JSON.parse(reg.members);
    return json(res, { success: true, registration: reg });
  }

  // ── API: QR Code for payment ──────────────────────────
  if (pathname.startsWith('/api/qr/') && method === 'GET') {
    const parts  = pathname.split('/');
    const event  = parts[3];
    const amount = parts[4] || '100';
    const regId  = parts[5] || 'TEMP';
    try {
      const svgData = makeUpiQR(amount, regId, event);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
      return res.end(svgData);
    } catch (e) {
      // Fallback: placeholder SVG
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" style="background:#0e0c1c">
        <text x="100" y="80" text-anchor="middle" fill="#ffca28" font-size="14" font-family="monospace">UPI QR</text>
        <text x="100" y="105" text-anchor="middle" fill="#fff" font-size="11" font-family="monospace">₹${amount}</text>
        <text x="100" y="130" text-anchor="middle" fill="rgba(255,255,255,.4)" font-size="9" font-family="monospace">9876543210@upi</text>
        <rect x="20" y="20" width="160" height="160" fill="none" stroke="#673ab7" stroke-width="1.5"/>
      </svg>`;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end(svg);
    }
  }

  // ── Receipt page ──────────────────────────────────────
  if (pathname.startsWith('/receipt/') && method === 'GET') {
    const reg_id = pathname.split('/').pop();
    const reg    = db.prepare('SELECT * FROM registrations WHERE reg_id=?').get(reg_id);
    if (!reg) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end('<h1 style="color:red;font-family:sans-serif">Registration not found</h1>');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(buildReceiptHTML(reg));
  }

  // ── Admin: Login ──────────────────────────────────────
  if (pathname === '/admin/login' && method === 'POST') {
    try {
      const body = await parseBody(req);
      if (body.password === ADMIN_PASS) {
        const token = crypto.randomUUID();
        db.prepare('INSERT INTO admin_sessions(token) VALUES(?)').run(token);
        res.writeHead(200, {
          'Set-Cookie': `admin_token=${token}; HttpOnly; Path=/; Max-Age=86400`,
          'Content-Type': 'application/json'
        });
        return res.end(JSON.stringify({ success: true }));
      }
      return jsonErr(res, 'Invalid password', 401);
    } catch (e) { return jsonErr(res, 'Error', 500); }
  }

  // ── Admin: Logout ─────────────────────────────────────
  if (pathname === '/admin/logout' && method === 'POST') {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/admin_token=([^;]+)/);
    if (match) db.prepare('DELETE FROM admin_sessions WHERE token=?').run(match[1]);
    res.writeHead(200, { 'Set-Cookie': 'admin_token=; Max-Age=0; Path=/', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // ── Admin: Stats API ──────────────────────────────────
  if (pathname === '/api/admin/stats' && method === 'GET') {
    if (!isAdmin(req)) return jsonErr(res, 'Unauthorized', 401);
    const total   = db.prepare('SELECT COUNT(*) as n FROM registrations').get().n;
    const byEvent = db.prepare('SELECT event, COUNT(*) as count FROM registrations GROUP BY event').all();
    const recent  = db.prepare('SELECT * FROM registrations ORDER BY id DESC LIMIT 10').all();
    recent.forEach(r => r.members = JSON.parse(r.members));
    const revenue = db.prepare(`
      SELECT SUM(CASE 
        WHEN event IN ('hackathon','shortfilm') THEN 200 
        ELSE 100 
      END) as total FROM registrations
    `).get().total || 0;
    return json(res, { success: true, total, byEvent, recent, revenue });
  }

  // ── Admin: All registrations ──────────────────────────
  if (pathname === '/api/admin/registrations' && method === 'GET') {
    if (!isAdmin(req)) return jsonErr(res, 'Unauthorized', 401);
    const event  = parsed.query.event || '';
    const search = parsed.query.search || '';
    let q = 'SELECT * FROM registrations WHERE 1=1';
    const params = [];
    if (event) { q += ' AND event=?'; params.push(event); }
    if (search) { q += ' AND (team_name LIKE ? OR reg_id LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    q += ' ORDER BY id DESC';
    const rows = db.prepare(q).all(...params);
    rows.forEach(r => r.members = JSON.parse(r.members));
    return json(res, { success: true, registrations: rows });
  }

  // ── Admin: Update status ──────────────────────────────
  if (pathname.startsWith('/api/admin/status/') && method === 'POST') {
    if (!isAdmin(req)) return jsonErr(res, 'Unauthorized', 401);
    const reg_id = pathname.split('/').pop();
    const body   = await parseBody(req);
    db.prepare('UPDATE registrations SET status=? WHERE reg_id=?').run(body.status, reg_id);
    return json(res, { success: true });
  }

  // ── Admin: Delete ─────────────────────────────────────
  if (pathname.startsWith('/api/admin/delete/') && method === 'POST') {
    if (!isAdmin(req)) return jsonErr(res, 'Unauthorized', 401);
    const reg_id = pathname.split('/').pop();
    db.prepare('DELETE FROM registrations WHERE reg_id=?').run(reg_id);
    return json(res, { success: true });
  }

  // ── Serve HTML pages ──────────────────────────────────
  const pageMap = {
    '/':          'index.html',
    '/index':     'index.html',
    '/hackathon': 'hackathon.html',
    '/shortfilm': 'short-film.html',
    '/debate':    'debate.html',
    '/itquiz':    'it-quiz.html',
    '/debugging': 'debugging.html',
    '/admin':     'admin.html',
  };

  if (pageMap[pathname] && method === 'GET') {
    return serveStatic(res, path.join(ROOT, 'public', pageMap[pathname]));
  }

  // ── Serve static files ────────────────────────────────
  if (method === 'GET') {
    const safe = pathname.replace(/\.\./g, '');
    const fp   = path.join(ROOT, 'public', safe);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      return serveStatic(res, fp);
    }
    // Try views folder
    const vp = path.join(ROOT, 'views', safe.replace('/', ''));
    if (fs.existsSync(vp)) return serveStatic(res, vp);
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end(`<html><body style="background:#07060f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <div style="text-align:center"><h1 style="font-size:5rem;color:#673ab7">404</h1><p>Page not found</p>
    <a href="/" style="color:#ffca28">← Go Home</a></div></body></html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ████████╗███████╗ ██████╗██╗  ██╗██╗   ██╗███████╗██████╗ ███████╗███████╗`);
  console.log(`  ╚══██╔══╝██╔════╝██╔════╝██║  ██║██║   ██║██╔════╝██╔══██╗██╔════╝██╔════╝`);
  console.log(`     ██║   █████╗  ██║     ███████║██║   ██║█████╗  ██████╔╝███████╗█████╗  `);
  console.log(`     ██║   ██╔══╝  ██║     ██╔══██║╚██╗ ██╔╝██╔══╝  ██╔══██╗╚════██║██╔══╝  `);
  console.log(`     ██║   ███████╗╚██████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║███████║███████╗`);
  console.log(`     ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝\n`);
  console.log(`  🚀 Server running → http://localhost:${PORT}`);
  console.log(`  📊 Admin panel  → http://localhost:${PORT}/admin`);
  console.log(`  🔑 Admin pass   → ${ADMIN_PASS}`);
  console.log(`  📦 DB           → ${DB_PATH}\n`);
});

module.exports = server;
