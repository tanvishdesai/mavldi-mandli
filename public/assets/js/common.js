/* Shared helpers for the public pages and the admin panel. */
(function (w) {
  'use strict';

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch {
      throw Object.assign(new Error('You seem to be offline. Check your connection and try again.'), { status: 0 });
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      throw Object.assign(new Error(msg), { status: res.status, data });
    }
    return data;
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
  const config = () => (cfgPromise ||= api('/api/config'));

  w.MV = { api, esc, inr, dateLong, dateShort, dateParts, when, NAVDURGA, toast, mine, STATUS, statusPill, busy, config };
})(window);
