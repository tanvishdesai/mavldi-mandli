'use strict';
/* SQLite storage. One file (DATA_DIR/mavladi.db) holds everything; uploads
   live next to it in DATA_DIR/uploads. better-sqlite3 is synchronous, so a
   transaction here is genuinely atomic: two people racing for the last pass
   cannot both get it. */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SCREENSHOT_DIR = path.join(UPLOAD_DIR, 'screenshots'); // private, admin only
const MEDIA_DIR = path.join(UPLOAD_DIR, 'media');            // public (venue photos, QR)
for (const d of [DATA_DIR, UPLOAD_DIR, SCREENSHOT_DIR, MEDIA_DIR]) fs.mkdirSync(d, { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, 'mavladi.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS venues (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  name_gu     TEXT,
  city        TEXT,
  address     TEXT,
  map_url     TEXT,
  description TEXT,
  image       TEXT,
  start_time  TEXT DEFAULT '8:30 pm onwards',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A pass is one sellable line: a venue, a night (NULL date = season pass),
-- a label (Daily / Couple / Kids...), a price and how many exist.
CREATE TABLE IF NOT EXISTS passes (
  id              INTEGER PRIMARY KEY,
  venue_id        INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  date            TEXT,
  label           TEXT NOT NULL DEFAULT 'Entry Pass',
  description     TEXT,
  price           INTEGER NOT NULL CHECK (price >= 0),
  quantity        INTEGER NOT NULL CHECK (quantity >= 0),
  max_per_booking INTEGER NOT NULL DEFAULT 10,
  admits          INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS passes_venue ON passes(venue_id, date);

-- status: awaiting_payment -> pending -> confirmed
--         awaiting_payment -> expired | cancelled
--         pending -> rejected | awaiting_payment (re-upload asked)
--         confirmed -> cancelled
CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  token            TEXT NOT NULL,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  email            TEXT,
  amount           INTEGER NOT NULL,
  status           TEXT NOT NULL,
  utr              TEXT,
  screenshot       TEXT,
  customer_note    TEXT,
  admin_note       TEXT,
  source           TEXT NOT NULL DEFAULT 'online',
  created_at       TEXT NOT NULL,
  expires_at       TEXT,
  paid_at          TEXT,
  verified_at      TEXT,
  checked_in_at    TEXT,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS bookings_phone ON bookings(phone);

-- Items keep a snapshot of what was bought so history survives edits.
CREATE TABLE IF NOT EXISTS booking_items (
  id          INTEGER PRIMARY KEY,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  pass_id     INTEGER REFERENCES passes(id) ON DELETE SET NULL,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_price  INTEGER NOT NULL,
  admits      INTEGER NOT NULL DEFAULT 1,
  venue_name  TEXT NOT NULL,
  pass_label  TEXT NOT NULL,
  pass_date   TEXT
);
CREATE INDEX IF NOT EXISTS items_pass ON booking_items(pass_id);
CREATE INDEX IF NOT EXISTS items_booking ON booking_items(booking_id);

-- one row per night a booking was admitted at the gate (season passes
-- come back every night, so a single timestamp on the booking isn't enough)
CREATE TABLE IF NOT EXISTS checkins (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  night      TEXT NOT NULL,
  at         TEXT NOT NULL,
  UNIQUE (booking_id, night)
);

CREATE TABLE IF NOT EXISTS faqs (
  id       INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  answer   TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0,
  active   INTEGER NOT NULL DEFAULT 1
);
`);

/* statuses that hold inventory */
const HOLDING = ['awaiting_payment', 'pending', 'confirmed'];
const HOLDING_SQL = HOLDING.map((s) => `'${s}'`).join(',');

const nowIso = () => new Date().toISOString();

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = {
  site_name: 'Mavladi Mandli',
  site_name_gu: 'માવલડી મંડળી',
  tagline: 'The Reality of Culture',
  tagline_gu: 'મા ના આંગણે રંગોત્સવ',
  event_title: 'Navratri 2026',
  event_dates_text: '11th – 19th October, 2026',
  event_time_text: '8:30 pm onwards',
  upi_id: 'mavladimandli@upi',
  upi_payee_name: 'Mavladi Mandli',
  upi_qr_image: '',
  payment_instructions:
    'Pay the exact amount using any UPI app (GPay, PhonePe, Paytm, BHIM). Take a screenshot of the success screen that shows the UTR / transaction ID, then upload it below.',
  hold_minutes: '30',
  booking_open: '1',
  max_items_per_booking: '20',
  contact_phone: '',
  contact_whatsapp: '',
  contact_email: '',
  instagram_url: '',
  youtube_url: '',
  about_text:
    'Mavladi is a sheri-style garba raised in the courtyard of the Mother. Nine nights of dhol, diya and devotion — where the old circles are danced the old way, and every family finds its place in the ring.',
  terms_text:
    'Passes are non-transferable and non-refundable once confirmed. Traditional attire is mandatory. Entry is subject to security checks. The management reserves the right of admission.',
  admin_password_hash: '',
  session_secret: '',
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
function getSetting(key) {
  const row = getSettingStmt.get(key);
  return row ? row.value : DEFAULT_SETTINGS[key] ?? '';
}
function setSetting(key, value) {
  setSettingStmt.run(key, value == null ? '' : String(value));
}
function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
/* keys that are safe to send to anyone */
const PUBLIC_SETTINGS = [
  'site_name', 'site_name_gu', 'tagline', 'tagline_gu', 'event_title', 'event_dates_text',
  'event_time_text', 'upi_id', 'upi_payee_name', 'upi_qr_image', 'payment_instructions',
  'hold_minutes', 'booking_open', 'contact_phone', 'contact_whatsapp', 'contact_email',
  'instagram_url', 'youtube_url', 'about_text', 'terms_text',
];
const EDITABLE_SETTINGS = PUBLIC_SETTINGS.concat(['max_items_per_booking']);

/* ---------- holds ---------- */
const expireStmt = db.prepare(
  `UPDATE bookings SET status = 'expired', updated_at = ?
   WHERE status = 'awaiting_payment' AND expires_at IS NOT NULL AND expires_at < ?`
);
function expireHolds() {
  const n = nowIso();
  return expireStmt.run(n, n).changes;
}

/* sold (held) count for every pass, optionally excluding one booking */
function soldMap(excludeBookingId = 0) {
  const rows = db
    .prepare(
      `SELECT bi.pass_id AS id, SUM(bi.qty) AS sold
       FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
       WHERE b.status IN (${HOLDING_SQL}) AND bi.pass_id IS NOT NULL AND b.id != ?
       GROUP BY bi.pass_id`
    )
    .all(excludeBookingId);
  const m = new Map();
  for (const r of rows) m.set(r.id, r.sold);
  return m;
}

module.exports = {
  db, DATA_DIR, UPLOAD_DIR, SCREENSHOT_DIR, MEDIA_DIR,
  HOLDING, HOLDING_SQL, nowIso,
  DEFAULT_SETTINGS, PUBLIC_SETTINGS, EDITABLE_SETTINGS,
  getSetting, setSetting, allSettings, expireHolds, soldMap,
};
