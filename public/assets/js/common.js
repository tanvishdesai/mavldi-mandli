/* Shared helpers for the public pages and the admin panel. */
(function (w) {
  'use strict';

  /* ---------- Convex ---------- */
  if (!w.convex || !w.CONVEX_URL) {
    console.error('Convex client or CONVEX_URL missing — run `npm run build`.');
  }
  const client = w.convex && w.CONVEX_URL ? new w.convex.ConvexClient(w.CONVEX_URL) : null;
  const fns = w.convex ? w.convex.anyApi : {};

  /* Turn Convex errors into something a person can read. Our own errors carry
     { message, code }; anything else is a server fault or a network problem. */
  function friendly(e) {
    if (e && e.data && typeof e.data === 'object' && e.data.message) {
      return Object.assign(new Error(e.data.message), { code: e.data.code, data: e.data });
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    console.error(e);
    return Object.assign(new Error(offline ? 'You seem to be offline. Check your connection and try again.' : 'Something went wrong on our side. Please try again.'), { code: 'SERVER' });
  }
  const call = (kind) => async (ref, args = {}) => {
    if (!client) throw new Error('The site is not connected to its backend yet.');
    try { return await client[kind](ref, args); } catch (e) { throw friendly(e); }
  };
  const q = call('query'), m = call('mutation'), a = call('action');
  /* live query: cb runs now and on every change; returns an unsubscribe fn */
  function watch(ref, args, cb, onErr) {
    if (!client) return () => {};
    return client.onUpdate(ref, args, cb, (e) => onErr && onErr(friendly(e)));
  }
  /* upload a File to Convex storage via a one-time URL; returns the storage id */
  async function upload(url, file) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    } catch { throw new Error('Upload failed — check your connection and try again.'); }
    if (!res.ok) throw new Error('Upload failed. Please try again.');
    return (await res.json()).storageId;
  }
  /* an unguessable token made in the browser (booking secret, admin session) */
  function secret(n = 24) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  /* QR code as an SVG data URI, in the site's ink colour */
  function qr(text, { dark = '#3a0a0c', light = '#fffaf0', ec = 'M' } = {}) {
    const code = w.qrcode(0, ec);
    code.addData(text);
    code.make();
    const n = code.getModuleCount(), pad = 2, size = n + pad * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  /* dates are stored as YYYY-MM-DD and always mean an evening in India */
  const asDate = (iso) => new Date(iso + 'T12:00:00+05:30');
  const fmt = (iso, o) => asDate(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
  const dateLong = (iso) => (iso ? fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }) : 'All nine nights');
  const dateShort = (iso) => (iso ? fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Season');
  const dateParts = (iso) => ({
    wd: fmt(iso, { weekday: 'short' }),
    d: fmt(iso, { day: 'numeric' }),
    m: fmt(iso, { month: 'short' }),
  });
  const when = (ts) => ts
    ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '';

  /* Navadurga — the form of the Goddess worshipped on each night */
  const NAVDURGA = [
    ['Shailaputri', 'શૈલપુત્રી'], ['Brahmacharini', 'બ્રહ્મચારિણી'], ['Chandraghanta', 'ચંદ્રઘંટા'],
    ['Kushmanda', 'કૂષ્માંડા'], ['Skandamata', 'સ્કંદમાતા'], ['Katyayani', 'કાત્યાયની'],
    ['Kalaratri', 'કાલરાત્રિ'], ['Mahagauri', 'મહાગૌરી'], ['Siddhidatri', 'સિદ્ધિદાત્રી'],
  ];

  /* ---------- toasts ---------- */
  function toast(msg, kind = '') {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, 3800);
    setTimeout(() => t.remove(), 4200);
  }

  /* ---------- bookings remembered on this device ---------- */
  const KEY = 'mv_bookings';
  const mine = {
    list() {
      try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
    },
    add(entry) {
      try {
        const l = mine.list().filter((b) => b.code !== entry.code);
        l.unshift({ ...entry, at: Date.now() });
        localStorage.setItem(KEY, JSON.stringify(l.slice(0, 20)));
      } catch { /* private mode: fine, the URL still works */ }
    },
  };

  const STATUS = {
    awaiting_payment: ['Awaiting payment', 'warn'],
    pending: ['Verifying payment', 'info'],
    confirmed: ['Confirmed', 'ok'],
    rejected: ['Rejected', 'bad'],
    cancelled: ['Cancelled', 'mute'],
    expired: ['Expired', 'mute'],
  };
  const statusPill = (s) => {
    const [label, kind] = STATUS[s] || [s, ''];
    return `<span class="pill ${kind}">${esc(label)}</span>`;
  };

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.classList.add('is-busy');
      btn.innerHTML = `<span class="spin" aria-hidden="true"></span> ${esc(label || 'Please wait…')}`;
    } else {
      btn.classList.remove('is-busy');
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  let cfgPromise;
  const config = () => (cfgPromise ||= q(fns.public.config));

  w.MV = { q, m, a, watch, upload, secret, qr, fns, esc, inr, dateLong, dateShort, dateParts, when, NAVDURGA, toast, mine, STATUS, statusPill, busy, config };
})(window);
