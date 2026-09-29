'use strict';
/* Booking rules live here so the public and admin routes share them. */
const crypto = require('crypto');
const QRCode = require('qrcode');
const {
  db, HOLDING, nowIso, getSetting, expireHolds, soldMap,
} = require('./db');

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
/* Garba runs past midnight: until 6 am the gate still counts as the
   previous night. */
const gateNight = () => new Date(Date.now() - 6 * 3600_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

/* ---------- validation ---------- */
function cleanText(v, max = 200) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function normPhone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
function validPhone(d) { return /^[6-9]\d{9}$/.test(d); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function normUtr(v) { return String(v ?? '').replace(/[\s-]/g, '').toUpperCase(); }

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = crypto.randomBytes(6);
  let s = 'MV';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

/* ---------- catalogue ---------- */
function passRows() {
  return db.prepare(
    `SELECT p.*, v.name AS venue_name, v.active AS venue_active
     FROM passes p JOIN venues v ON v.id = p.venue_id
     ORDER BY v.sort, v.id, p.date IS NOT NULL, p.date, p.sort, p.id`
  ).all();
}

function isBookable(p, today = todayIST()) {
  return !!(p.active && p.venue_active && (p.date == null || p.date >= today));
}

/* Public catalogue: active venues, each with its passes and live availability. */
function publicCatalogue() {
  expireHolds();
  const sold = soldMap();
  const today = todayIST();
  const open = getSetting('booking_open') === '1';
  const venues = db.prepare('SELECT * FROM venues WHERE active = 1 ORDER BY sort, id').all();
  const byVenue = new Map(venues.map((v) => [v.id, { ...v, passes: [] }]));
  for (const p of passRows()) {
    const v = byVenue.get(p.venue_id);
    if (!v || !p.active) continue;
    const available = Math.max(0, p.quantity - (sold.get(p.id) || 0));
    const past = p.date != null && p.date < today;
    v.passes.push({
      id: p.id, date: p.date, label: p.label, description: p.description,
      price: p.price, quantity: p.quantity, available, admits: p.admits,
      max_per_booking: p.max_per_booking,
      past, bookable: open && !past && available > 0,
    });
  }
  return [...byVenue.values()].map((v) => ({
    id: v.id, name: v.name, name_gu: v.name_gu, city: v.city, address: v.address,
    map_url: v.map_url, description: v.description, image: v.image, start_time: v.start_time,
    passes: v.passes,
  }));
}

/* ---------- create ---------- */
function createBooking(input, opts = {}) {
  const admin = !!opts.admin;
  const name = cleanText(input.name, 80);
  const phone = normPhone(input.phone);
  const email = cleanText(input.email, 120).toLowerCase();
  const note = cleanText(input.note, 500);

  if (!admin && getSetting('booking_open') !== '1') throw new UserError('Bookings are closed right now.');
  if (name.length < 2) throw new UserError('Please enter your full name.');
  if (!validPhone(phone)) throw new UserError('Please enter a valid 10-digit mobile number.');
  if (email && !validEmail(email)) throw new UserError('That email address does not look right.');

  // merge duplicate lines
  const want = new Map();
  for (const it of Array.isArray(input.items) ? input.items : []) {
    const id = parseInt(it.passId ?? it.pass_id, 10);
    const qty = parseInt(it.qty, 10);
    if (!id || !qty || qty < 1) continue;
    want.set(id, (want.get(id) || 0) + qty);
  }
  if (!want.size) throw new UserError('Pick at least one pass.');
  const maxTotal = parseInt(getSetting('max_items_per_booking'), 10) || 20;
  const totalQty = [...want.values()].reduce((a, b) => a + b, 0);
  if (!admin && totalQty > maxTotal) throw new UserError(`You can book at most ${maxTotal} passes at a time.`);

  const status = opts.status || 'awaiting_payment';
  const holdMin = Math.max(5, parseInt(getSetting('hold_minutes'), 10) || 30);

  return db.transaction(() => {
    expireHolds();
    const sold = soldMap();
    const today = todayIST();
    const passes = new Map(passRows().map((p) => [p.id, p]));
    const lines = [];
    for (const [id, qty] of want) {
      const p = passes.get(id);
      if (!p) throw new UserError('One of the passes you picked no longer exists. Please refresh.');
      const what = `${p.label}${p.date ? ' · ' + fmtDate(p.date) : ''}`;
      if (!admin && !isBookable(p, today)) throw new UserError(`${what} is not on sale any more.`);
      if (!admin && qty > p.max_per_booking) throw new UserError(`At most ${p.max_per_booking} × ${what} per booking.`);
      const available = p.quantity - (sold.get(id) || 0);
      if (qty > available) {
        throw new UserError(available > 0 ? `Only ${available} left for ${what}.` : `${what} just sold out.`, 409);
      }
      lines.push({ p, qty });
    }
    const amount = lines.reduce((s, l) => s + l.p.price * l.qty, 0);

    let code;
    do code = newCode(); while (db.prepare('SELECT 1 FROM bookings WHERE code = ?').get(code));
    const token = crypto.randomBytes(18).toString('base64url');
    const now = nowIso();
    const finalStatus = status === 'awaiting_payment' && amount === 0 ? 'pending' : status;

    const id = db.prepare(
      `INSERT INTO bookings (code, token, name, phone, email, amount, status, customer_note, admin_note,
                             source, created_at, expires_at, verified_at, paid_at, utr, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      code, token, name, phone, email || null, amount, finalStatus,
      admin ? null : note || null, admin ? note || null : null,
      opts.source || 'online', now,
      finalStatus === 'awaiting_payment' ? addMinutes(holdMin) : null,
      finalStatus === 'confirmed' ? now : null,
      finalStatus === 'confirmed' ? now : null,
      admin ? normUtr(input.utr) || null : null,
      now
    ).lastInsertRowid;

    const ins = db.prepare(
      `INSERT INTO booking_items (booking_id, pass_id, qty, unit_price, admits, venue_name, pass_label, pass_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const { p, qty } of lines) ins.run(id, p.id, qty, p.price, p.admits, p.venue_name, p.label, p.date);
    return getBookingById(id);
  })();
}

/* ---------- read ---------- */
function getBookingById(id) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) return null;
  b.items = db.prepare('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY pass_date IS NOT NULL, pass_date, id').all(id);
  b.checkins = db.prepare('SELECT night, at FROM checkins WHERE booking_id = ? ORDER BY night').all(id);
  return b;
}
function getBookingByCode(code) {
  const row = db.prepare('SELECT id FROM bookings WHERE code = ?').get(String(code || '').toUpperCase());
  return row ? getBookingById(row.id) : null;
}
function tokenMatches(b, token) {
  if (!b || !token) return false;
  const a = Buffer.from(String(token)), t = Buffer.from(b.token);
  return a.length === t.length && crypto.timingSafeEqual(a, t);
}

function upiUri(b) {
  const pa = getSetting('upi_id');
  const pn = getSetting('upi_payee_name');
  const params = new URLSearchParams({ pa, pn, am: b.amount.toFixed(2), cu: 'INR', tn: `Mavladi ${b.code}` });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

const qrOpts = { margin: 1, color: { dark: '#3a0a0c', light: '#fffaf0' }, errorCorrectionLevel: 'M' };

/* What the customer is allowed to see about their own booking. */
async function publicView(b, origin) {
  const view = {
    code: b.code, name: b.name, phone: maskPhone(b.phone), email: b.email,
    amount: b.amount, status: b.status, utr: b.utr, has_screenshot: !!b.screenshot,
    created_at: b.created_at, expires_at: b.expires_at, paid_at: b.paid_at,
    verified_at: b.verified_at, checked_in_at: b.checked_in_at,
    checkins: b.checkins.map((c) => c.night),
    message: ['rejected', 'awaiting_payment', 'cancelled'].includes(b.status) ? b.admin_note || null : null,
    items: b.items.map((i) => ({
      venue: i.venue_name, label: i.pass_label, date: i.pass_date, qty: i.qty,
      unit_price: i.unit_price, admits: i.admits,
    })),
    admits: b.items.reduce((s, i) => s + i.qty * i.admits, 0),
  };
  if (b.status === 'awaiting_payment') {
    const uri = upiUri(b);
    view.payment = {
      upi_id: getSetting('upi_id'), payee: getSetting('upi_payee_name'), uri,
      qr: await QRCode.toDataURL(uri, { ...qrOpts, width: 520 }),
      qr_image: getSetting('upi_qr_image') || null,
      instructions: getSetting('payment_instructions'),
    };
  }
  if (b.status === 'confirmed') {
    const checkUrl = `${origin}/admin/#checkin/${b.code}`;
    view.ticket_qr = await QRCode.toDataURL(checkUrl, { ...qrOpts, width: 520, errorCorrectionLevel: 'Q' });
  }
  return view;
}
function maskPhone(p) { return p ? p.slice(0, 2) + '••••' + p.slice(-4) : ''; }

/* ---------- payment proof ---------- */
function submitPayment(b, { utr, screenshot }) {
  const u = normUtr(utr);
  if (!/^[A-Z0-9]{6,35}$/.test(u)) throw new UserError('Enter the UTR / transaction ID from your payment app (usually 12 digits).');
  if (!screenshot) throw new UserError('Attach the payment screenshot.');
  // an error thrown inside the transaction would roll back the saved proof,
  // so the "expired and sold out" case is reported after it commits
  const res = db.transaction(() => {
    expireHolds();
    const cur = getBookingById(b.id);
    const now = nowIso();
    if (cur.status === 'pending') throw new UserError('We already have your payment proof — it is being verified.');
    if (cur.status === 'confirmed') throw new UserError('This booking is already confirmed.');
    if (['rejected', 'cancelled'].includes(cur.status)) throw new UserError('This booking was closed. Please contact us with your booking code.');
    if (cur.status === 'expired') {
      // They may have paid just after the hold ran out. Re-reserve if we still can.
      const short = shortfall(cur);
      if (short) {
        db.prepare('UPDATE bookings SET utr = ?, screenshot = ?, paid_at = ?, updated_at = ? WHERE id = ?')
          .run(u, screenshot, now, now, cur.id);
        return { soldOut: short, code: cur.code };
      }
    }
    db.prepare(
      `UPDATE bookings SET status = 'pending', utr = ?, screenshot = ?, paid_at = ?, expires_at = NULL, updated_at = ? WHERE id = ?`
    ).run(u, screenshot, now, now, cur.id);
    return { booking: getBookingById(cur.id) };
  })();
  if (res.soldOut) {
    throw new UserError(`Your hold expired and ${res.soldOut} sold out meanwhile. We have saved your payment proof — please contact us with code ${res.code} for a refund or swap.`, 409);
  }
  return res.booking;
}

/* returns a description of the first line that can't be re-reserved, or null */
function shortfall(b) {
  const sold = soldMap(b.id);
  for (const it of b.items) {
    if (!it.pass_id) return `${it.pass_label}`;
    const p = db.prepare('SELECT quantity FROM passes WHERE id = ?').get(it.pass_id);
    if (!p || it.qty > p.quantity - (sold.get(it.pass_id) || 0)) {
      return `${it.pass_label}${it.pass_date ? ' · ' + fmtDate(it.pass_date) : ''}`;
    }
  }
  return null;
}

/* ---------- admin transitions ---------- */
const ACTIONS = {
  confirm:      { from: ['pending', 'awaiting_payment', 'expired', 'rejected', 'cancelled'], to: 'confirmed' },
  reject:       { from: ['pending', 'awaiting_payment'], to: 'rejected' },
  reupload:     { from: ['pending', 'rejected', 'expired'], to: 'awaiting_payment' },
  cancel:       { from: ['awaiting_payment', 'pending', 'confirmed'], to: 'cancelled' },
  reopen:       { from: ['rejected', 'expired', 'cancelled'], to: 'pending' },
  checkin:      { from: ['confirmed'] },
  undo_checkin: { from: ['confirmed'] },
};

function adminAction(id, action, note, opts = {}) {
  const rule = ACTIONS[action];
  if (!rule) throw new UserError('Unknown action.');
  return db.transaction(() => {
    expireHolds();
    const b = getBookingById(id);
    if (!b) throw new UserError('Booking not found.', 404);
    if (!rule.from.includes(b.status)) throw new UserError(`Cannot ${action.replace('_', ' ')} a booking that is ${b.status.replace('_', ' ')}.`);
    const now = nowIso();
    const n = cleanText(note, 500) || null;

    if (action === 'checkin') {
      const night = gateNight();
      const done = db.prepare('SELECT at FROM checkins WHERE booking_id = ? AND night = ?').get(id, night);
      if (done) throw new UserError(`Already checked in tonight at ${new Date(done.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}.`, 409);
      const valid = b.items.some((i) => i.pass_date == null || i.pass_date === night);
      if (!valid && !opts.force) {
        const dates = [...new Set(b.items.map((i) => fmtDate(i.pass_date)))].join(', ');
        throw new UserError(`This pass is for ${dates}, not tonight.`, 422);
      }
      db.prepare('INSERT INTO checkins (booking_id, night, at) VALUES (?, ?, ?)').run(id, night, now);
      db.prepare('UPDATE bookings SET checked_in_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
      return getBookingById(id);
    }
    if (action === 'undo_checkin') {
      db.prepare('DELETE FROM checkins WHERE booking_id = ? AND night = ?').run(id, gateNight());
      const last = db.prepare('SELECT MAX(at) AS at FROM checkins WHERE booking_id = ?').get(id).at;
      db.prepare('UPDATE bookings SET checked_in_at = ?, updated_at = ? WHERE id = ?').run(last || null, now, id);
      return getBookingById(id);
    }
    // moving from a released state back into a holding one needs stock
    if (!HOLDING.includes(b.status) && HOLDING.includes(rule.to)) {
      const short = shortfall(b);
      if (short) throw new UserError(`Not enough stock left for ${short}. Increase its quantity first.`, 409);
    }
    const sets = ['status = ?', 'updated_at = ?'];
    const vals = [rule.to, now];
    if (n !== null || ['reject', 'reupload', 'cancel'].includes(action)) { sets.push('admin_note = ?'); vals.push(n); }
    if (rule.to === 'confirmed') { sets.push('verified_at = ?'); vals.push(now); }
    if (rule.to === 'awaiting_payment') { sets.push('expires_at = ?'); vals.push(addMinutes(24 * 60)); }
    else { sets.push('expires_at = NULL'); }
    db.prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    return getBookingById(id);
  })();
}

function fmtDate(iso) {
  if (!iso) return 'Season';
  return new Date(iso + 'T00:00:00+05:30').toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  });
}

module.exports = {
  UserError, todayIST, gateNight, cleanText, normPhone, validPhone, validEmail, normUtr,
  publicCatalogue, createBooking, getBookingById, getBookingByCode, tokenMatches,
  publicView, submitPayment, adminAction, passRows, fmtDate, upiUri, ACTIONS,
};
