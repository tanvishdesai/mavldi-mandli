'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const {
  db, SCREENSHOT_DIR, MEDIA_DIR, HOLDING_SQL, nowIso,
  allSettings, getSetting, setSetting, PUBLIC_SETTINGS, EDITABLE_SETTINGS, expireHolds, soldMap,
} = require('./db');
const { seedIfEmpty } = require('./seed');
const auth = require('./auth');
const B = require('./bookings');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '200kb' }));

const origin = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const ip = (req) => req.ip || req.socket.remoteAddress || '?';

/* async-safe route wrapper: UserErrors become friendly JSON */
const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof B.UserError) return res.status(e.status).json({ error: e.message });
    if (e && e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(409).json({ error: 'That record is still in use.' });
    console.error(e);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  }
};

/* ---------- uploads: images only, sniffed by magic bytes ---------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  return null;
}
function saveImage(file, dir, prefix) {
  if (!file) return null;
  const ext = sniffImage(file.buffer);
  if (!ext) throw new B.UserError('Please upload a JPG, PNG or WebP image (HEIC photos: take a screenshot instead).');
  const name = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return name;
}
const withUpload = (field) => (req, res, next) =>
  upload.single(field)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large (max 8 MB).' : 'Upload failed. Please try again.';
    res.status(400).json({ error: msg });
  });

/* =====================================================================
   PUBLIC API
   ===================================================================== */
app.get('/api/config', (req, res) => {
  const s = allSettings();
  const out = {};
  for (const k of PUBLIC_SETTINGS) out[k] = s[k];
  res.json(out);
});

app.get('/api/venues', h((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ today: B.todayIST(), venues: B.publicCatalogue() });
}));

app.get('/api/faqs', (req, res) => {
  res.json(db.prepare('SELECT id, question, answer FROM faqs WHERE active = 1 ORDER BY sort, id').all());
});

app.post('/api/bookings', h(async (req, res) => {
  if (!auth.throttle(`book:${ip(req)}`, 20, 15 * 60_000)) throw new B.UserError('Too many attempts. Please wait a few minutes.', 429);
  const b = B.createBooking(req.body || {});
  res.status(201).json({ code: b.code, token: b.token, booking: await B.publicView(b, origin(req)) });
}));

function loadOwned(req) {
  const b = B.getBookingByCode(req.params.code);
  const token = req.query.t || req.get('X-Booking-Token');
  if (!b || !B.tokenMatches(b, token)) throw new B.UserError('Booking not found.', 404);
  return b;
}

app.get('/api/bookings/:code', h(async (req, res) => {
  expireHolds();
  res.setHeader('Cache-Control', 'no-store');
  res.json(await B.publicView(loadOwned(req), origin(req)));
}));

app.post('/api/bookings/:code/payment', withUpload('screenshot'), h(async (req, res) => {
  if (!auth.throttle(`pay:${ip(req)}`, 30, 15 * 60_000)) throw new B.UserError('Too many attempts. Please wait a few minutes.', 429);
  const b = loadOwned(req);
  if (!req.file) throw new B.UserError('Attach the payment screenshot.');
  const file = saveImage(req.file, SCREENSHOT_DIR, b.code);
  try {
    const nb = B.submitPayment(b, { utr: req.body.utr, screenshot: file });
    res.json(await B.publicView(nb, origin(req)));
  } catch (e) {
    // keep the file only if the booking now points at it
    const cur = B.getBookingById(b.id);
    if (!cur || cur.screenshot !== file) fs.rm(path.join(SCREENSHOT_DIR, file), () => {});
    throw e;
  }
}));

app.post('/api/bookings/:code/cancel', h(async (req, res) => {
  const b = loadOwned(req);
  if (b.status !== 'awaiting_payment') throw new B.UserError('Only unpaid bookings can be cancelled here. Contact us for anything else.');
  db.prepare("UPDATE bookings SET status = 'cancelled', expires_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), b.id);
  res.json(await B.publicView(B.getBookingById(b.id), origin(req)));
}));

/* find my booking: code + phone -> token */
app.post('/api/lookup', h((req, res) => {
  if (!auth.throttle(`lookup:${ip(req)}`, 15, 15 * 60_000)) throw new B.UserError('Too many attempts. Please wait a few minutes.', 429);
  const phone = B.normPhone(req.body.phone);
  const code = String(req.body.code || '').trim().toUpperCase();
  let rows;
  if (code) {
    rows = db.prepare('SELECT code, token, status, amount, created_at FROM bookings WHERE code = ? AND phone = ?').all(code, phone);
  } else {
    throw new B.UserError('Enter your booking code (it starts with MV).');
  }
  if (!rows.length) throw new B.UserError('No booking matches that code and phone number.', 404);
  res.json(rows);
}));

/* =====================================================================
   ADMIN API
   ===================================================================== */
const admin = express.Router();

admin.post('/login', h((req, res) => {
  if (!auth.throttle(`login:${ip(req)}`, 8, 15 * 60_000)) throw new B.UserError('Too many attempts. Try again in 15 minutes.', 429);
  if (!auth.verifyPassword(String(req.body.password || ''), getSetting('admin_password_hash'))) {
    throw new B.UserError('Wrong password.', 401);
  }
  auth.setSession(req, res);
  res.json({ ok: true });
}));
admin.post('/logout', (req, res) => { auth.clearSession(res); res.json({ ok: true }); });
admin.get('/me', (req, res) => {
  res.json({ admin: auth.isAdmin(req), default_password: getSetting('admin_password_is_default') === '1' });
});

admin.use(auth.requireAdmin);

/* ---------- dashboard ---------- */
admin.get('/stats', h((req, res) => {
  expireHolds();
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n, SUM(amount) AS amount FROM bookings GROUP BY status').all();
  const sold = soldMap();
  const confirmedQty = new Map(
    db.prepare(
      `SELECT bi.pass_id AS id, SUM(bi.qty) AS n FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
       WHERE b.status = 'confirmed' GROUP BY bi.pass_id`
    ).all().map((r) => [r.id, r.n])
  );
  const inventory = B.passRows().map((p) => ({
    id: p.id, venue_id: p.venue_id, venue: p.venue_name, date: p.date, label: p.label, price: p.price,
    quantity: p.quantity, held: sold.get(p.id) || 0, confirmed: confirmedQty.get(p.id) || 0, active: !!p.active,
  }));
  const today = B.todayIST();
  const checkins = db.prepare(
    'SELECT COUNT(*) AS n FROM checkins WHERE night = ?'
  ).get(B.gateNight()).n;
  const recent = db.prepare(
    "SELECT id, code, name, amount, status, created_at, paid_at FROM bookings WHERE status = 'pending' ORDER BY paid_at LIMIT 8"
  ).all();
  res.json({ byStatus, inventory, checkins_today: checkins, pending_queue: recent, today });
}));

/* ---------- bookings ---------- */
function bookingFilters(q) {
  const where = [];
  const vals = [];
  if (q.status) { where.push('b.status = ?'); vals.push(q.status); }
  if (q.venue) { where.push('EXISTS (SELECT 1 FROM booking_items i JOIN passes p ON p.id = i.pass_id WHERE i.booking_id = b.id AND p.venue_id = ?)'); vals.push(+q.venue); }
  if (q.date) {
    if (q.date === 'season') where.push('EXISTS (SELECT 1 FROM booking_items i WHERE i.booking_id = b.id AND i.pass_date IS NULL)');
    else { where.push('EXISTS (SELECT 1 FROM booking_items i WHERE i.booking_id = b.id AND i.pass_date = ?)'); vals.push(q.date); }
  }
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push('(b.code LIKE ? OR b.name LIKE ? OR b.phone LIKE ? OR b.utr LIKE ? OR b.email LIKE ?)');
    vals.push(like, like, like, like, like);
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', vals };
}
function itemsFor(ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT * FROM booking_items WHERE booking_id IN (${ids.map(() => '?').join(',')}) ORDER BY pass_date IS NOT NULL, pass_date, id`).all(...ids);
  const m = new Map();
  for (const r of rows) { if (!m.has(r.booking_id)) m.set(r.booking_id, []); m.get(r.booking_id).push(r); }
  return m;
}

admin.get('/bookings', h((req, res) => {
  expireHolds();
  const f = bookingFilters(req.query);
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const order = req.query.status === 'pending' ? 'b.paid_at ASC' : 'b.id DESC';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM bookings b ${f.sql}`).get(...f.vals).n;
  const rows = db.prepare(
    `SELECT b.id, b.code, b.name, b.phone, b.email, b.amount, b.status, b.utr, b.screenshot, b.source,
            b.created_at, b.paid_at, b.verified_at, b.checked_in_at, b.expires_at
     FROM bookings b ${f.sql} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).all(...f.vals, limit, (page - 1) * limit);
  const items = itemsFor(rows.map((r) => r.id));
  for (const r of rows) r.items = items.get(r.id) || [];
  res.json({ total, page, limit, rows });
}));

admin.get('/bookings.csv', h((req, res) => {
  const f = bookingFilters(req.query);
  const rows = db.prepare(`SELECT b.* FROM bookings b ${f.sql} ORDER BY b.id`).all(...f.vals);
  const items = itemsFor(rows.map((r) => r.id));
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    // neutralise spreadsheet formulas
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['code', 'status', 'name', 'phone', 'email', 'amount', 'utr', 'passes', 'admits', 'source', 'created_at', 'paid_at', 'verified_at', 'checked_in_at', 'admin_note'];
  const lines = [head.join(',')];
  for (const r of rows) {
    const its = items.get(r.id) || [];
    lines.push([
      r.code, r.status, r.name, r.phone, r.email, r.amount, r.utr,
      its.map((i) => `${i.qty}x ${i.venue_name} / ${i.pass_label} / ${i.pass_date || 'Season'}`).join('; '),
      its.reduce((s, i) => s + i.qty * i.admits, 0),
      r.source, r.created_at, r.paid_at, r.verified_at, r.checked_in_at, r.admin_note,
    ].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mavladi-bookings-${B.todayIST()}.csv"`);
  res.send('﻿' + lines.join('\n'));
}));

admin.get('/bookings/:id', h((req, res) => {
  expireHolds();
  const b = B.getBookingById(+req.params.id);
  if (!b) throw new B.UserError('Booking not found.', 404);
  b.duplicate_utr = b.utr
    ? db.prepare('SELECT id, code, name, status FROM bookings WHERE utr = ? AND id != ?').all(b.utr, b.id)
    : [];
  b.same_phone = db.prepare('SELECT id, code, status, amount FROM bookings WHERE phone = ? AND id != ? ORDER BY id DESC LIMIT 10').all(b.phone, b.id);
  b.ticket_url = `${origin(req)}/ticket.html?code=${b.code}&t=${b.token}`;
  delete b.token;
  res.json(b);
}));

admin.get('/checkin/:code', h((req, res) => {
  const b = B.getBookingByCode(req.params.code);
  if (!b) throw new B.UserError('No booking with that code.', 404);
  delete b.token;
  b.night = B.gateNight();
  res.json(b);
}));

admin.post('/bookings', h((req, res) => {
  const status = ['confirmed', 'pending', 'awaiting_payment'].includes(req.body.status) ? req.body.status : 'confirmed';
  const b = B.createBooking(req.body || {}, { admin: true, status, source: 'counter' });
  res.status(201).json(b);
}));

admin.patch('/bookings/:id', h((req, res) => {
  const b = B.getBookingById(+req.params.id);
  if (!b) throw new B.UserError('Booking not found.', 404);
  const body = req.body || {};
  const next = {
    name: body.name !== undefined ? B.cleanText(body.name, 80) : b.name,
    phone: body.phone !== undefined ? B.normPhone(body.phone) : b.phone,
    email: body.email !== undefined ? B.cleanText(body.email, 120).toLowerCase() || null : b.email,
    utr: body.utr !== undefined ? B.normUtr(body.utr) || null : b.utr,
    admin_note: body.admin_note !== undefined ? B.cleanText(body.admin_note, 500) || null : b.admin_note,
  };
  if (next.name.length < 2) throw new B.UserError('Name is too short.');
  if (!B.validPhone(next.phone)) throw new B.UserError('Invalid phone number.');
  if (next.email && !B.validEmail(next.email)) throw new B.UserError('Invalid email.');
  db.prepare('UPDATE bookings SET name=?, phone=?, email=?, utr=?, admin_note=?, updated_at=? WHERE id=?')
    .run(next.name, next.phone, next.email, next.utr, next.admin_note, nowIso(), b.id);
  res.json(B.getBookingById(b.id));
}));

admin.post('/bookings/:id/action', h((req, res) => {
  res.json(B.adminAction(+req.params.id, String(req.body.action || ''), req.body.note, { force: !!req.body.force }));
}));

admin.delete('/bookings/:id', h((req, res) => {
  const b = B.getBookingById(+req.params.id);
  if (!b) throw new B.UserError('Booking not found.', 404);
  db.prepare('DELETE FROM bookings WHERE id = ?').run(b.id);
  if (b.screenshot) fs.rm(path.join(SCREENSHOT_DIR, path.basename(b.screenshot)), () => {});
  res.json({ ok: true });
}));

admin.get('/screenshots/:file', (req, res) => {
  const file = path.basename(req.params.file);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(SCREENSHOT_DIR, file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

/* ---------- venues ---------- */
function venueInput(body) {
  const v = {
    name: B.cleanText(body.name, 120),
    name_gu: B.cleanText(body.name_gu, 120) || null,
    city: B.cleanText(body.city, 80) || null,
    address: B.cleanText(body.address, 300) || null,
    map_url: B.cleanText(body.map_url, 500) || null,
    description: B.cleanText(body.description, 1000) || null,
    image: B.cleanText(body.image, 500) || null,
    start_time: B.cleanText(body.start_time, 60) || null,
    active: body.active === false || body.active === 0 || body.active === '0' ? 0 : 1,
    sort: parseInt(body.sort, 10) || 0,
  };
  if (v.name.length < 2) throw new B.UserError('Venue name is required.');
  if (v.map_url && !/^https?:\/\//i.test(v.map_url)) throw new B.UserError('Map link must start with http(s)://');
  if (v.image && !/^(https?:\/\/|\/)/i.test(v.image)) throw new B.UserError('Image must be an uploaded file or a full URL.');
  return v;
}
admin.get('/venues', (req, res) => {
  res.json(db.prepare(
    `SELECT v.*, (SELECT COUNT(*) FROM passes p WHERE p.venue_id = v.id) AS pass_count FROM venues v ORDER BY sort, id`
  ).all());
});
admin.post('/venues', h((req, res) => {
  const v = venueInput(req.body || {});
  const id = db.prepare(
    `INSERT INTO venues (name, name_gu, city, address, map_url, description, image, start_time, active, sort)
     VALUES (@name, @name_gu, @city, @address, @map_url, @description, @image, @start_time, @active, @sort)`
  ).run(v).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM venues WHERE id = ?').get(id));
}));
admin.put('/venues/:id', h((req, res) => {
  const v = venueInput(req.body || {});
  const r = db.prepare(
    `UPDATE venues SET name=@name, name_gu=@name_gu, city=@city, address=@address, map_url=@map_url,
       description=@description, image=@image, start_time=@start_time, active=@active, sort=@sort WHERE id=@id`
  ).run({ ...v, id: +req.params.id });
  if (!r.changes) throw new B.UserError('Venue not found.', 404);
  res.json(db.prepare('SELECT * FROM venues WHERE id = ?').get(+req.params.id));
}));
admin.delete('/venues/:id', h((req, res) => {
  const live = db.prepare(
    `SELECT COUNT(*) AS n FROM booking_items i JOIN bookings b ON b.id = i.booking_id JOIN passes p ON p.id = i.pass_id
     WHERE p.venue_id = ? AND b.status IN (${HOLDING_SQL})`
  ).get(+req.params.id).n;
  if (live) throw new B.UserError(`This venue has ${live} live booking line(s). Deactivate it instead, or cancel those bookings first.`, 409);
  db.prepare('DELETE FROM venues WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
}));

/* ---------- passes ---------- */
function passInput(body) {
  const p = {
    venue_id: parseInt(body.venue_id, 10),
    date: body.date ? String(body.date).slice(0, 10) : null,
    label: B.cleanText(body.label, 80) || 'Entry Pass',
    description: B.cleanText(body.description, 300) || null,
    price: parseInt(body.price, 10),
    quantity: parseInt(body.quantity, 10),
    max_per_booking: parseInt(body.max_per_booking, 10) || 10,
    admits: Math.max(1, parseInt(body.admits, 10) || 1),
    active: body.active === false || body.active === 0 || body.active === '0' ? 0 : 1,
    sort: parseInt(body.sort, 10) || 0,
  };
  if (!p.venue_id || !db.prepare('SELECT 1 FROM venues WHERE id = ?').get(p.venue_id)) throw new B.UserError('Pick a venue.');
  if (p.date && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new B.UserError('Date must be YYYY-MM-DD.');
  if (!Number.isFinite(p.price) || p.price < 0) throw new B.UserError('Price must be 0 or more.');
  if (!Number.isFinite(p.quantity) || p.quantity < 0) throw new B.UserError('Quantity must be 0 or more.');
  return p;
}
admin.get('/passes', h((req, res) => {
  const sold = soldMap();
  const rows = B.passRows().filter((p) => !req.query.venue || p.venue_id === +req.query.venue);
  res.json(rows.map((p) => ({ ...p, held: sold.get(p.id) || 0 })));
}));
admin.post('/passes', h((req, res) => {
  const p = passInput(req.body || {});
  const id = db.prepare(
    `INSERT INTO passes (venue_id, date, label, description, price, quantity, max_per_booking, admits, active, sort)
     VALUES (@venue_id, @date, @label, @description, @price, @quantity, @max_per_booking, @admits, @active, @sort)`
  ).run(p).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM passes WHERE id = ?').get(id));
}));
admin.post('/passes/bulk', h((req, res) => {
  const body = req.body || {};
  const from = String(body.from || ''), to = String(body.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new B.UserError('Pick a valid date range.');
  const base = passInput({ ...body, date: from });
  const ins = db.prepare(
    `INSERT INTO passes (venue_id, date, label, description, price, quantity, max_per_booking, admits, active, sort)
     VALUES (@venue_id, @date, @label, @description, @price, @quantity, @max_per_booking, @admits, @active, @sort)`
  );
  let n = 0;
  db.transaction(() => {
    for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      if (++n > 60) throw new B.UserError('That range is longer than 60 nights.');
      ins.run({ ...base, date: d.toISOString().slice(0, 10) });
    }
  })();
  res.status(201).json({ created: n });
}));
admin.put('/passes/:id', h((req, res) => {
  const p = passInput(req.body || {});
  const id = +req.params.id;
  const held = soldMap().get(id) || 0;
  if (p.quantity < held) throw new B.UserError(`${held} of these are already booked or held — quantity can't go below that.`);
  const r = db.prepare(
    `UPDATE passes SET venue_id=@venue_id, date=@date, label=@label, description=@description, price=@price,
       quantity=@quantity, max_per_booking=@max_per_booking, admits=@admits, active=@active, sort=@sort WHERE id=@id`
  ).run({ ...p, id });
  if (!r.changes) throw new B.UserError('Pass not found.', 404);
  res.json(db.prepare('SELECT * FROM passes WHERE id = ?').get(id));
}));
admin.delete('/passes/:id', h((req, res) => {
  const held = soldMap().get(+req.params.id) || 0;
  if (held) throw new B.UserError(`${held} of these are booked or held. Deactivate the pass instead.`, 409);
  db.prepare('DELETE FROM passes WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
}));

/* ---------- faqs ---------- */
admin.get('/faqs', (req, res) => res.json(db.prepare('SELECT * FROM faqs ORDER BY sort, id').all()));
function faqInput(b) {
  const f = {
    question: B.cleanText(b.question, 300), answer: String(b.answer || '').trim().slice(0, 2000),
    sort: parseInt(b.sort, 10) || 0, active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
  };
  if (!f.question || !f.answer) throw new B.UserError('Question and answer are both required.');
  return f;
}
admin.post('/faqs', h((req, res) => {
  const id = db.prepare('INSERT INTO faqs (question, answer, sort, active) VALUES (@question, @answer, @sort, @active)').run(faqInput(req.body || {})).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM faqs WHERE id = ?').get(id));
}));
admin.put('/faqs/:id', h((req, res) => {
  db.prepare('UPDATE faqs SET question=@question, answer=@answer, sort=@sort, active=@active WHERE id=@id').run({ ...faqInput(req.body || {}), id: +req.params.id });
  res.json(db.prepare('SELECT * FROM faqs WHERE id = ?').get(+req.params.id));
}));
admin.delete('/faqs/:id', (req, res) => {
  db.prepare('DELETE FROM faqs WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

/* ---------- settings ---------- */
admin.get('/settings', (req, res) => {
  const s = allSettings();
  const out = {};
  for (const k of EDITABLE_SETTINGS) out[k] = s[k];
  res.json(out);
});
admin.put('/settings', h((req, res) => {
  const body = req.body || {};
  if (body.upi_id !== undefined && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(String(body.upi_id).trim())) {
    throw new B.UserError('UPI ID should look like name@bank.');
  }
  if (body.hold_minutes !== undefined) {
    const m = parseInt(body.hold_minutes, 10);
    if (!(m >= 5 && m <= 1440)) throw new B.UserError('Payment window must be between 5 and 1440 minutes.');
  }
  db.transaction(() => {
    for (const k of EDITABLE_SETTINGS) {
      if (body[k] !== undefined) setSetting(k, String(body[k]).trim().slice(0, 4000));
    }
  })();
  res.json({ ok: true });
}));
admin.post('/password', h((req, res) => {
  const { current, next } = req.body || {};
  if (!auth.verifyPassword(String(current || ''), getSetting('admin_password_hash'))) throw new B.UserError('Current password is wrong.', 401);
  if (!next || String(next).length < 8) throw new B.UserError('New password must be at least 8 characters.');
  setSetting('admin_password_hash', auth.hashPassword(String(next)));
  setSetting('admin_password_is_default', '0');
  setSetting('session_gen', String((parseInt(getSetting('session_gen'), 10) || 0) + 1));
  auth.setSession(req, res);
  res.json({ ok: true });
}));

/* ---------- media upload (venue photos, static QR) ---------- */
admin.post('/upload', withUpload('file'), h((req, res) => {
  if (!req.file) throw new B.UserError('No file received.');
  const name = saveImage(req.file, MEDIA_DIR, 'media');
  res.status(201).json({ url: `/media/${name}` });
}));

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* =====================================================================
   STATIC
   ===================================================================== */
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', index: false }));
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, file) {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

/* =====================================================================
   BOOT
   ===================================================================== */
auth.ensureAdminPassword();
if (seedIfEmpty()) console.log('  Fresh database — seeded sample venues, passes and FAQs.');

const PORT = parseInt(process.env.PORT, 10) || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`  Mavladi Mandli running on http://localhost:${PORT}  (admin: /admin)`));
  setInterval(expireHolds, 60_000).unref();
}

module.exports = app;
