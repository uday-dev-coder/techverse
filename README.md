# Techverse 2025 — Full-Stack Platform

A complete full-stack registration system for the Techverse 2025 inter-college tech fest.

## 🚀 Stack

- **Backend**: Pure Node.js (no npm dependencies)
- **Database**: SQLite via `node:sqlite` (built into Node.js 22+)
- **QR Codes**: Pure JavaScript SVG generator (no libraries)
- **Frontend**: Vanilla HTML/CSS/JS
- **Auth**: Cookie-based admin sessions

## 📦 Requirements

- **Node.js v22+** (uses `node:sqlite` experimental API)
- No npm install needed

## ▶️ Running

```bash
node --no-warnings server.js
```

Or use npm:
```bash
npm start
```

Server starts at: **http://localhost:3000**

## 🗂️ Project Structure

```
techverse_fullstack/
├── server.js              # Main HTTP server + all API routes
├── package.json
├── db/
│   └── techverse.db       # SQLite database (auto-created)
├── utils/
│   └── qr.js              # Pure JS QR code SVG generator
└── public/
    ├── index.html          # Main homepage
    ├── hackathon.html      # Event registration pages (×5)
    ├── short-film.html
    ├── debate.html
    ├── it-quiz.html
    ├── debugging.html
    ├── admin.html          # Admin dashboard
    ├── css/
    │   └── event.css       # All event page styles
    └── images/             # All images
```

## 🔗 Routes

| Route | Description |
|-------|-------------|
| `GET /` | Homepage |
| `GET /hackathon` | Hackathon registration |
| `GET /shortfilm` | Short Film registration |
| `GET /debate` | Debate registration |
| `GET /itquiz` | IT Quiz registration |
| `GET /debugging` | Debugging registration |
| `GET /admin` | Admin dashboard |
| `GET /receipt/:id` | Printable receipt |

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/register` | Submit registration |
| `GET` | `/api/registration/:id` | Get one registration |
| `GET` | `/api/qr/:event/:amount/:team` | Generate UPI QR SVG |
| `POST` | `/admin/login` | Admin login |
| `POST` | `/admin/logout` | Admin logout |
| `GET` | `/api/admin/stats` | Dashboard stats |
| `GET` | `/api/admin/registrations` | All registrations |
| `POST` | `/api/admin/status/:id` | Update status |
| `POST` | `/api/admin/delete/:id` | Delete registration |

## 🔐 Admin Access

- URL: `http://localhost:3000/admin`
- Default password: `techverse@2025`
- Change in `server.js` → `const ADMIN_PASS`

## 💳 Payment Flow

1. User fills team details (Step 1)
2. UPI QR code generated (Step 2) — dummy UPI ID: `9876543210@upi`
3. User scans QR with any UPI app and pays
4. User enters UTR/Transaction ID
5. Registration saved → Confirmation shown (Step 3)
6. Printable receipt available at `/receipt/:id`

## 🗄️ Database Schema

```sql
CREATE TABLE registrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_id     TEXT UNIQUE,
  event      TEXT,
  team_name  TEXT,
  members    TEXT (JSON array),
  contact    TEXT,
  email      TEXT,
  utr        TEXT,
  status     TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

## 🎨 Color Palette (unchanged from original)

- Primary: `#673ab7`
- Secondary: `#9575cd`
- Accent: `#ffca28`

## ✏️ Customization

- Change UPI ID in `server.js` → `makeUpiQR()` function
- Change admin password in `server.js` → `ADMIN_PASS`
- Change event dates in HTML files
- Add real email sending via SMTP by extending `server.js`
