'use strict';
/* End-to-end API tests against a throwaway database. Run: npm test */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavladi-test-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'test-password-1';
const app = require('../server/index.js');
const { db } = require('../server/db');

let base, server, cookie = '';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e0005fe02fea7d6a4a90000000049454e44ae426082', 'hex');

async function call(method, url, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(base + url, init);
  const sc = res.headers.get('set-cookie');
  if (sc && sc.startsWith('mv_admin=')) cookie = sc.split(';')[0];
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const adminCall = (m, u, b) => call(m, u, b, { Cookie: cookie, 'X-Requested-With': 'fetch' });

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function firstPass(pred = () => true) {
  return db.prepare("SELECT * FROM passes WHERE date >= '2026-10-11' ORDER BY id").all().find(pred);
}
async function book(items, extra = {}) {
  return call('POST', '/api/bookings', { name: 'Test Guest', phone: '9876543210', items, ...extra });
}
async function uploadProof(code, token, utr = '412345678901') {
  const fd = new FormData();
  fd.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'shot.png');
  fd.append('utr', utr);
  return call('POST', `/api/bookings/${code}/payment?t=${token}`, fd);
}

test('catalogue lists seeded venues with availability', async () => {
  const { status, data } = await call('GET', '/api/venues');
  assert.equal(status, 200);
  assert.ok(data.venues.length >= 1);
  assert.ok(data.venues[0].passes.every((p) => typeof p.available === 'number'));
});

test('booking validates input', async () => {
  const p = firstPass();
  assert.equal((await call('POST', '/api/bookings', { name: 'A', phone: '9876543210', items: [{ passId: p.id, qty: 1 }] })).status, 400);
  assert.equal((await call('POST', '/api/bookings', { name: 'Asha', phone: '12345', items: [{ passId: p.id, qty: 1 }] })).status, 400);
  assert.equal((await call('POST', '/api/bookings', { name: 'Asha', phone: '9876543210', items: [] })).status, 400);
});

test('full lifecycle: book → pay → admin confirms → ticket QR', async () => {
  const p = firstPass();
  const r = await book([{ passId: p.id, qty: 2 }]);
  assert.equal(r.status, 201);
  assert.equal(r.data.booking.status, 'awaiting_payment');
  assert.equal(r.data.booking.amount, p.price * 2);
  assert.match(r.data.booking.payment.uri, /^upi:\/\/pay\?pa=/);
  assert.match(r.data.booking.payment.uri, new RegExp(`am=${p.price * 2}\\.00`));

  // wrong token hides the booking
  assert.equal((await call('GET', `/api/bookings/${r.data.code}?t=nope`)).status, 404);

  const up = await uploadProof(r.data.code, r.data.token);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.status, 'pending');

  // admin endpoints need a session
  assert.equal((await call('GET', '/api/admin/bookings')).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'test-password-1' })).status, 200);

  const list = await adminCall('GET', '/api/admin/bookings?status=pending');
  const row = list.data.rows.find((x) => x.code === r.data.code);
  assert.ok(row && row.screenshot);
  const shot = await fetch(`${base}/api/admin/screenshots/${row.screenshot}`, { headers: { Cookie: cookie } });
  assert.equal(shot.status, 200);
  assert.equal((await fetch(`${base}/api/admin/screenshots/${row.screenshot}`)).status, 401);

  const conf = await adminCall('POST', `/api/admin/bookings/${row.id}/action`, { action: 'confirm' });
  assert.equal(conf.data.status, 'confirmed');
  const tk = await call('GET', `/api/bookings/${r.data.code}?t=${r.data.token}`);
  assert.equal(tk.data.status, 'confirmed');
  assert.match(tk.data.ticket_qr, /^data:image\/png/);

  // a pass for another night is refused at the gate unless forced
  const ci = await adminCall('POST', `/api/admin/bookings/${row.id}/action`, { action: 'checkin' });
  assert.equal(ci.status, 422);
  const forced = await adminCall('POST', `/api/admin/bookings/${row.id}/action`, { action: 'checkin', force: true });
  assert.equal(forced.status, 200);
  assert.equal((await adminCall('POST', `/api/admin/bookings/${row.id}/action`, { action: 'checkin', force: true })).status, 409);
});

test('cannot oversell: holds count against stock', async () => {
  const p = firstPass((x) => x.quantity > 0);
  db.prepare('UPDATE passes SET quantity = (SELECT COALESCE(SUM(qty),0) FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id WHERE bi.pass_id = ? AND b.status IN (\'awaiting_payment\',\'pending\',\'confirmed\')) + 1, max_per_booking = 5 WHERE id = ?').run(p.id, p.id);
  const a = await book([{ passId: p.id, qty: 1 }]);
  assert.equal(a.status, 201);
  const b = await book([{ passId: p.id, qty: 1 }]);
  assert.equal(b.status, 409);
  // cancelling the unpaid hold frees it
  await call('POST', `/api/bookings/${a.data.code}/cancel?t=${a.data.token}`);
  assert.equal((await book([{ passId: p.id, qty: 1 }])).status, 201);
});

test('expired holds release stock; late proof re-reserves if possible', async () => {
  const p = firstPass((x) => x.id > 3);
  const a = await book([{ passId: p.id, qty: 1 }]);
  db.prepare("UPDATE bookings SET expires_at = '2000-01-01T00:00:00.000Z' WHERE code = ?").run(a.data.code);
  const view = await call('GET', `/api/bookings/${a.data.code}?t=${a.data.token}`);
  assert.equal(view.data.status, 'expired');
  const up = await uploadProof(a.data.code, a.data.token, '999988887777');
  assert.equal(up.status, 200);
  assert.equal(up.data.status, 'pending');
});

test('duplicate UTR is flagged to the admin', async () => {
  const p = firstPass((x) => x.id > 5);
  const a = await book([{ passId: p.id, qty: 1 }]);
  const b = await book([{ passId: p.id, qty: 1 }]);
  await uploadProof(a.data.code, a.data.token, '555566667777');
  await uploadProof(b.data.code, b.data.token, '555566667777');
  const id = db.prepare('SELECT id FROM bookings WHERE code = ?').get(b.data.code).id;
  const d = await adminCall('GET', `/api/admin/bookings/${id}`);
  assert.equal(d.data.duplicate_utr.length, 1);
});

test('non-images are rejected as payment proof', async () => {
  const p = firstPass((x) => x.id > 10);
  const a = await book([{ passId: p.id, qty: 1 }]);
  const fd = new FormData();
  fd.append('screenshot', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  fd.append('utr', '412345678901');
  const r = await call('POST', `/api/bookings/${a.data.code}/payment?t=${a.data.token}`, fd);
  assert.equal(r.status, 400);
});

test('admin CRUD: venue, bulk passes, settings, lookup', async () => {
  const v = await adminCall('POST', '/api/admin/venues', { name: 'Test Ground', city: 'Surat' });
  assert.equal(v.status, 201);
  const bulk = await adminCall('POST', '/api/admin/passes/bulk', { venue_id: v.data.id, from: '2026-10-11', to: '2026-10-19', label: 'Daily', price: 100, quantity: 50 });
  assert.equal(bulk.data.created, 9);
  assert.equal((await adminCall('PUT', '/api/admin/settings', { upi_id: 'not a upi' })).status, 400);
  assert.equal((await adminCall('PUT', '/api/admin/settings', { upi_id: 'mandli@okaxis' })).status, 200);
  assert.equal((await call('GET', '/api/config')).data.upi_id, 'mandli@okaxis');
  assert.equal((await call('GET', '/api/config')).data.admin_password_hash, undefined);
  // CSRF header required for admin writes
  assert.equal((await call('POST', '/api/admin/venues', { name: 'X' }, { Cookie: cookie })).status, 403);
  const p = firstPass((x) => x.id > 12);
  const a = await book([{ passId: p.id, qty: 1 }]);
  const lk = await call('POST', '/api/lookup', { code: a.data.code, phone: '+91 98765 43210' });
  assert.equal(lk.data[0].token, a.data.token);
  assert.equal((await call('POST', '/api/lookup', { code: a.data.code, phone: '9999999999' })).status, 404);
  const del = await adminCall('DELETE', `/api/admin/venues/${v.data.id}`);
  assert.equal(del.status, 200);
});
