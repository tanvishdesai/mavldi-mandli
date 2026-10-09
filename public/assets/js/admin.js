/* Admin panel — a small hash-routed app over the Convex admin API.
   Every call carries the session token that auth.login registered. */
(function () {
  'use strict';
  const { q, m, a, watch, upload, secret, fns, esc, inr, dateShort, when, PASS, toast, statusPill, busy, STATUS } = window.MV;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const TOKEN_KEY = 'mv_admin_token';
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* private mode */ }
  const F = fns.admin;
  const authed = (p) => p.catch((e) => { if (e.code === 'UNAUTHENTICATED') showLogin(); throw e; });
  const Q = (ref, args = {}) => authed(q(ref, { token, ...args }));
  const M = (ref, args = {}) => authed(m(ref, { token, ...args }));
  /* live views: subscriptions are dropped whenever the route changes */
  let subs = [];
  const live = (ref, args, cb) => {
    subs.push(watch(ref, { token, ...args }, cb, (e) => { if (e.code === 'UNAUTHENTICATED') showLogin(); else toast(e.message, 'bad'); }));
  };
  const dropLive = () => { subs.forEach((u) => u()); subs = []; };

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    bookings: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4z"/>',
    checkin: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
    passes: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    faqs: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
  const NAV = [['dashboard', 'Dashboard'], ['bookings', 'Bookings'], ['checkin', 'Gate check-in'], ['passes', 'Nights & stock'], ['faqs', 'FAQs'], ['settings', 'Settings']];

  let me = { admin: false };
  let pendingCount = 0;

  async function boot() {
    me = token ? await q(fns.auth.me, { token }).catch(() => ({ admin: false })) : { admin: false };
    if (!me.admin) return showLogin();
    shell();
    addEventListener('hashchange', route);
    route();
  }

  /* ---------------- login ---------------- */
  function showLogin() {
    dropLive();
    closeDrawerQuiet();
    app.innerHTML = `<div class="login"><form class="card" id="loginForm">
      <img src="/assets/img/logo.webp" alt="Mavladi">
      <h1>Admin sign in</h1>
      <label class="field" style="text-align:left"><span>Password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <div class="notice bad formerr" id="lerr" role="alert"></div>
      <button class="btn block" type="submit">Sign in</button>
      <a href="/" style="font-size:.88rem">← Back to site</a></form></div>`;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      busy(btn, true, 'Signing in…');
      try {
        const t = secret(32);
        await a(fns.auth.login, { password: e.target.password.value, token: t });
        try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
        location.reload();
      } catch (ex) {
        busy(btn, false);
        $('#lerr').textContent = ex.message; $('#lerr').classList.add('on');
      }
    });
  }

  /* ---------------- shell & routing ---------------- */
  function shell() {
    app.innerHTML = `<div class="mobbar"><button type="button" id="menuBtn" aria-label="Menu">☰</button><b>માવલડી Admin</b><span></span></div>
    <div class="shell">
      <nav class="side" id="side" aria-label="Admin">
        <a class="brand" href="#dashboard"><img src="/assets/img/logo-sm.webp" alt=""><span><b>માવલડી મંડળી</b><small>Admin</small></span></a>
        ${NAV.map(([k, l]) => `<a class="nav" href="#${k}" data-k="${k}">${icon(k)}<span>${l}</span>${k === 'bookings' ? '<span class="badge" id="pendBadge" hidden></span>' : ''}</a>`).join('')}
        <div class="spacer"></div>
        <div class="foot"><a href="/" target="_blank">View site ↗</a><button type="button" id="logout">Sign out</button></div>
      </nav>
      <main class="mainpane" id="pane"></main>
    </div>`;
    $('#logout').onclick = async () => {
      await m(fns.auth.logout, { token }).catch(() => {});
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      location.reload();
    };
    $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
    $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
    // the pending badge is live for the whole session
    watch(F.stats, { token }, (s) => {
      pendingCount = (s.byStatus.find((x) => x.status === 'pending') || {}).n || 0;
      const b = $('#pendBadge');
      if (b) { b.hidden = !pendingCount; b.textContent = pendingCount; }
      document.title = (pendingCount ? `(${pendingCount}) ` : '') + 'Admin — Mavladi Mandli';
    });
  }

  function route() {
    const [k, arg] = (location.hash.slice(1) || 'dashboard').split('/');
    $$('.side a.nav').forEach((a) => a.classList.toggle('on', a.dataset.k === (k === 'booking' ? 'bookings' : k)));
    const pane = $('#pane');
    const stay = (k === 'bookings' || k === 'booking') && $('#blist');
    if (!stay) { pane.dataset.view = ''; dropLive(); }
    if (k !== 'booking') closeDrawerQuiet();
    const views = { dashboard, bookings, booking: (p, id) => { bookings(p); openBooking(id); }, checkin, passes, faqs, settings };
    (views[k] || dashboard)(pane, arg && decodeURIComponent(arg));
  }

  const head = (title, sub, acts = '') => `<div class="phead"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="acts">${acts}</div></div>`;
  const fail = (pane, e) => { pane.insertAdjacentHTML('beforeend', `<div class="notice bad">${esc(e.message)}</div>`); };

  /* ================= dashboard ================= */
  function dashboard(pane) {
    pane.innerHTML = head('Dashboard', 'Everything at a glance') + '<p class="muted">Loading…</p>';
    live(F.stats, {}, (s) => drawDashboard(pane, s));
  }
  function drawDashboard(pane, s) {
    if (s.empty) {
      pane.innerHTML = head('Welcome 🙏', 'No nights are set up yet') + `<div class="panel2"><div class="pad" style="display:grid;gap:12px;justify-items:start">
        <p>Add the nights you are selling passes for, or load the sample data (ten nights of Navratri 2026 plus FAQs) and edit it. The pass price lives in Settings.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="sample" type="button">Load sample data</button><a class="btn ghost sm" href="#passes">Add nights</a></div></div></div>`;
      $('#sample').onclick = async (e) => { busy(e.target, true, 'Loading…'); try { await M(F.loadSampleData); toast('Sample data loaded', 'ok'); } catch (x) { busy(e.target, false); toast(x.message, 'bad'); } };
      return;
    }
    const st = (k) => s.byStatus.find((x) => x.status === k) || { n: 0, amount: 0 };
    const soldQty = s.inventory.reduce((a, i) => a + i.confirmed, 0);
    const heldQty = s.inventory.reduce((a, i) => a + i.held, 0);
    const def = me.default_password ? `<div class="notice bad" style="margin-bottom:16px">⚠ You are still using the default admin password. <a href="#settings">Change it now</a>.</div>` : '';
    pane.innerHTML = head('Dashboard', `Today is ${esc(dateShort(s.today))} · ${inr(s.price)} per pass · updates live`, '<a class="btn sm" href="#bookings">Open verification queue</a>') + def + `
      <div class="tiles">
        <a class="tile hot" href="#bookings"><span>Waiting for verification</span><b>${st('pending').n}</b><small>${inr(st('pending').amount)} to check</small></a>
        <div class="tile"><span>Confirmed revenue</span><b>${inr(st('confirmed').amount)}</b><small>${st('confirmed').n} bookings</small></div>
        <div class="tile"><span>Passes sold (confirmed)</span><b>${soldQty}</b><small>${heldQty} held incl. unpaid &amp; pending</small></div>
        <div class="tile"><span>Awaiting payment</span><b>${st('awaiting_payment').n}</b><small>holds that may expire</small></div>
        <a class="tile" href="#checkin"><span>Checked in tonight</span><b>${s.checkins_today}</b><small>bookings admitted</small></a>
        <div class="tile"><span>Rejected / expired</span><b>${st('rejected').n + st('expired').n}</b><small>${st('cancelled').n} cancelled</small></div>
      </div>
      <div class="panel2"><h2>Next to verify <a class="iconbtn" href="#bookings">See all</a></h2>
        ${s.pending_queue.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${s.pending_queue.map((b) => `<tr class="click" data-id="${b.id}"><td class="mono">${esc(b.code)}</td><td>${esc(b.name)}</td><td class="num">${inr(b.amount)}</td><td class="muted sm">paid ${esc(when(b.paid_at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Nothing waiting. 🪔</div>'}
      </div>
      <div class="panel2"><h2>Night by night <a class="iconbtn" href="#passes">Edit stock</a></h2><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Night</th><th class="num">Confirmed</th><th class="num">Unpaid holds</th><th class="num">Held</th><th class="num">Left</th><th>Fill</th></tr></thead><tbody>
        ${s.inventory.map((i) => { const pct = i.quantity ? Math.round((i.held / i.quantity) * 100) : 0; return `<tr class="${i.active ? '' : 'inactive'}"><td>${esc(dateShort(i.date))}${i.active ? '' : ' <span class="pill mute">off sale</span>'}</td><td class="num">${i.confirmed}</td><td class="num">${i.unpaid}</td><td class="num">${i.held}</td><td class="num">${i.quantity - i.held} / ${i.quantity}</td><td><div class="bar"><i class="${pct > 80 ? 'hi' : ''}" style="width:${pct}%"></i></div></td></tr>`; }).join('')}
        </tbody></table></div></div>`;
    pane.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `booking/${tr.dataset.id}`; });
  }

  /* ================= bookings ================= */
  const bstate = { status: 'pending', date: '', q: '', limit: 50 };
  let lastRows = [];
  async function bookings(pane) {
    if (pane.dataset.view === 'bookings') return loadBookings();
    pane.dataset.view = 'bookings';
    const tabs = [['pending', 'To verify'], ['awaiting_payment', 'Awaiting payment'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected'], ['expired', 'Expired'], ['cancelled', 'Cancelled'], ['', 'All']];
    pane.innerHTML = head('Bookings', 'Verify payments, confirm passes, manage every booking',
      '<button class="btn ghost sm" id="csvBtn" type="button">Export CSV</button><button class="btn sm" id="newBk" type="button">+ Counter booking</button>') + `
      <div class="tabs" id="btabs">${tabs.map(([k, l]) => `<button type="button" data-s="${k}" class="${bstate.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="filters">
        <input class="input" id="bq" type="search" placeholder="Search code, name, phone, UTR…" value="${esc(bstate.q)}">
        <input class="input" id="bd" type="date" value="${esc(bstate.date)}" title="Only bookings that include this night">
      </div>
      <div class="panel2" id="blist"><div class="empty-state">Loading…</div></div>`;
    $('#btabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; bstate.status = b.dataset.s; bstate.limit = 50; $$('#btabs button').forEach((x) => x.classList.toggle('on', x === b)); loadBookings(); };
    let tq;
    $('#bq').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { bstate.q = e.target.value.trim(); bstate.limit = 50; loadBookings(); }, 250); };
    $('#bd').onchange = (e) => { bstate.date = e.target.value; bstate.limit = 50; loadBookings(); };
    $('#csvBtn').onclick = (e) => exportCsv(e.target);
    $('#newBk').onclick = counterBooking;
    loadBookings();
  }
  let listUnsub = null;
  function loadBookings() {
    const box = $('#blist');
    if (!box) return;
    if (listUnsub) listUnsub();
    const args = {
      token, status: bstate.status || undefined, date: bstate.date || undefined,
      q: bstate.q || undefined, paginationOpts: { numItems: bstate.limit, cursor: null },
    };
    listUnsub = watch(F.listBookings, args, (res) => drawBookings(box, res), (e) => { box.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; });
    subs.push(() => { if (listUnsub) listUnsub(); listUnsub = null; });
  }
  function drawBookings(box, res) {
    lastRows = res.page;
    if (!res.page.length && res.isDone) { box.innerHTML = `<div class="empty-state">${bstate.status === 'pending' ? 'No payments waiting for verification. 🪔' : 'No bookings match.'}</div>`; return; }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Guest</th><th>Nights</th><th class="num">Amount</th><th>UTR</th><th>Status</th><th>${bstate.status === 'pending' ? 'Paid' : 'Created'}</th></tr></thead><tbody>
      ${res.page.map((b) => `<tr class="click" data-id="${b.id}">
        <td class="mono">${esc(b.code)}${b.source === 'counter' ? ' <span class="pill mute">counter</span>' : ''}</td>
        <td>${esc(b.name)}<div class="muted sm">${esc(b.phone)}</div></td>
        <td class="sm">${b.items.map((i) => `${i.qty}× <span class="muted">${esc(dateShort(i.date))}</span>`).join('<br>')}</td>
        <td class="num">${inr(b.amount)}</td>
        <td class="mono sm">${esc(b.utr || '—')}${b.screenshot ? ' 🖼' : ''}</td>
        <td>${statusPill(b.status)}${b.checked_in_at ? ' <span class="pill ok">in</span>' : ''}</td>
        <td class="muted sm">${esc(when(bstate.status === 'pending' ? b.paid_at : b.created_at))}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pager"><span>${res.page.length} shown · updates live</span><span>
        ${res.isDone ? '' : '<button class="iconbtn" data-more="1">Load more</button>'}</span></div>`;
    box.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => openBooking(tr.dataset.id));
    const more = box.querySelector('[data-more]');
    if (more) more.onclick = () => { bstate.limit += 50; loadBookings(); };
  }

  /* CSV of every booking matching the current filters, built in the browser */
  async function exportCsv(btn) {
    busy(btn, true, 'Exporting…');
    try {
      const all = [];
      let cursor = null;
      for (;;) {
        const r = await Q(F.exportPage, { paginationOpts: { numItems: 500, cursor } });
        all.push(...r.page);
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      const qq = bstate.q.toLowerCase();
      const rows = all.filter((b) => (!bstate.status || b.status === bstate.status)
        && (!bstate.date || b.items.some((i) => i.date === bstate.date))
        && (!qq || [b.code, b.name, b.phone, b.utr, b.email].join(' ').toLowerCase().includes(qq)));
      const cell = (v) => {
        const t = v == null ? '' : String(v);
        const safe = /^[=+\-@\t\r]/.test(t) ? "'" + t : t; // no spreadsheet formulas
        return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const iso = (ts) => (ts ? new Date(ts).toISOString() : '');
      const head = ['code', 'status', 'name', 'phone', 'email', 'amount', 'utr', 'nights', 'passes', 'source', 'created_at', 'paid_at', 'verified_at', 'last_checkin_at', 'admin_note', 'customer_note'];
      const lines = [head.join(',')].concat(rows.map((b) => [
        b.code, b.status, b.name, b.phone, b.email, b.amount, b.utr,
        b.items.map((i) => `${i.qty}x ${i.date}`).join('; '),
        b.items.reduce((s2, i) => s2 + i.qty, 0), b.source,
        iso(b.created_at), iso(b.paid_at), iso(b.verified_at), iso(b.checked_in_at), b.admin_note, b.customer_note,
      ].map(cell).join(',')));
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: `mavladi-bookings-${new Date().toISOString().slice(0, 10)}.csv` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`${rows.length} bookings exported`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
    busy(btn, false);
  }

  /* ---------------- booking drawer ---------------- */
  const drawer = $('#drawer'), scrim = $('#scrim');
  let current = null;
  scrim.onclick = closeDrawer;
  addEventListener('keydown', (e) => {
    if (!drawer.classList.contains('on') || e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') closeDrawer();
    if (current && current.status === 'pending') {
      if (e.key === 'c') act('confirm');
      if (e.key === 'r') act('reject');
    }
    if (e.key === 'j' || e.key === 'ArrowDown') step(1);
    if (e.key === 'k' || e.key === 'ArrowUp') step(-1);
  });
  function step(d) {
    if (!current) return;
    const i = lastRows.findIndex((r) => r.id === current.id);
    const n = lastRows[i + d];
    if (n) openBooking(n.id);
  }
  function closeDrawerQuiet() {
    drawer.classList.remove('on'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); current = null;
  }
  function closeDrawer() {
    drawer.classList.remove('on'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true');
    current = null;
    if (location.hash.startsWith('#booking/')) history.replaceState(null, '', '#bookings');
  }

  async function openBooking(id) {
    drawer.classList.add('on'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false');
    drawer.innerHTML = '<div class="db"><p class="muted">Loading…</p></div>';
    let b;
    try { b = await Q(F.getBooking, { id }); } catch (e) { drawer.innerHTML = `<div class="db"><div class="notice bad">${esc(e.message)}</div></div>`; return; }
    if (!b) { drawer.innerHTML = '<div class="db"><div class="notice bad">That booking no longer exists.</div></div>'; return; }
    current = b;
    b.ticket_url = `${location.origin}/ticket?code=${encodeURIComponent(b.code)}&t=${encodeURIComponent(b.secret)}`;
    const shot = b.screenshot_url;
    const admits = b.items.reduce((s, i) => s + i.qty, 0);
    const waMsg = b.status === 'confirmed'
      ? `Jay Mataji ${b.name.split(' ')[0]}! 🙏 Your Mavladi Mandli booking ${b.code} is CONFIRMED. Your e-pass (show the QR at the gate): ${b.ticket_url}`
      : b.status === 'rejected'
        ? `Hi ${b.name.split(' ')[0]}, we couldn't verify the payment for Mavladi booking ${b.code}.${b.admin_note ? ' Reason: ' + b.admin_note : ''} Details: ${b.ticket_url}`
        : `Hi ${b.name.split(' ')[0]}, about your Mavladi Mandli booking ${b.code}: ${b.ticket_url}`;
    const idx = lastRows.findIndex((r) => r.id === b.id);
    drawer.innerHTML = `
      <div class="dh"><h2 class="mono">${esc(b.code)}</h2>${statusPill(b.status)}
        <span class="muted sm">${idx > -1 ? `${idx + 1} of ${lastRows.length} <span class="kbd">j</span>/<span class="kbd">k</span>` : ''}</span>
        <button class="iconbtn x" type="button" id="dx" aria-label="Close">✕ Close</button></div>
      <div class="db"><div class="dgrid">
        <div class="dcol">
          <div class="shot">${shot ? `<img src="${shot}" alt="Payment screenshot" id="shotImg"><a class="open" href="${shot}" target="_blank">Open full ↗</a>` : `<div class="none">No screenshot uploaded${b.source === 'counter' ? ' (counter booking)' : ''}</div>`}</div>
        </div>
        <div class="dcol">
          <div class="dsec"><h3>Payment</h3>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span class="bigamt">${inr(b.amount)}</span>
            <span class="muted sm">${b.paid_at ? 'proof sent ' + esc(when(b.paid_at)) : 'no proof yet'}</span></div>
            ${b.utr ? `<div class="utrbox"><span class="muted sm">UTR</span><span class="mono" id="utrV">${esc(b.utr)}</span><button class="iconbtn" type="button" id="cpUtr" style="margin-left:auto">Copy</button></div>` : ''}
            ${b.duplicate_utr.length ? `<div class="notice bad">⚠ Same UTR used on ${b.duplicate_utr.map((d) => `<a href="#booking/${d.id}">${esc(d.code)}</a> (${esc(d.name)}, ${esc((STATUS[d.status] || [d.status])[0])})`).join(', ')}. Possible duplicate proof.</div>` : ''}
            <p class="muted sm">Match the amount and UTR against your bank / UPI app statement before confirming.</p>
          </div>
          <div class="dsec"><h3>Passes · admits ${admits}</h3>
            <ul class="itemlist" style="list-style:none;margin:0;padding:0;display:grid;gap:6px">${b.items.map((i) => `<li style="display:flex;justify-content:space-between;gap:10px"><span>${i.qty} × ${esc(PASS)} <span class="muted">· ${esc(dateShort(i.date))}</span></span><b>${inr(i.qty * i.unit_price)}</b></li>`).join('')}</ul>
            ${b.checkins.length ? `<p class="sm">Checked in: ${b.checkins.map((c) => `${esc(dateShort(c.night))} ${esc(when(c.at).split(', ').pop())}`).join(' · ')}</p>` : ''}
          </div>
          <div class="dsec"><h3>Guest <button class="iconbtn" type="button" id="editG" style="float:right">Edit</button></h3>
            <dl class="kv" id="gview"><dt>Name</dt><dd>${esc(b.name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></dd><dt>Email</dt><dd>${esc(b.email || '—')}</dd>
              ${b.customer_note ? `<dt>Their note</dt><dd>${esc(b.customer_note)}</dd>` : ''}<dt>Booked</dt><dd>${esc(when(b.created_at))} · ${esc(b.source)}</dd>
              ${b.verified_at ? `<dt>Verified</dt><dd>${esc(when(b.verified_at))}</dd>` : ''}${b.expires_at ? `<dt>Hold until</dt><dd>${esc(when(b.expires_at))}</dd>` : ''}</dl>
            ${b.same_phone.length ? `<p class="sm muted">Other bookings on this phone: ${b.same_phone.map((o) => `<a href="#booking/${o.id}">${esc(o.code)}</a>`).join(', ')}</p>` : ''}
          </div>
          <div class="dsec"><h3>Note to guest / internal note</h3>
            <textarea class="input" id="anote" rows="2" placeholder="Shown to the guest when you reject or ask for a re-upload">${esc(b.admin_note || '')}</textarea></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/91${esc(b.phone)}?text=${encodeURIComponent(waMsg)}">WhatsApp guest</a>
            <button class="btn ghost sm" type="button" id="cpLink">Copy ticket link</button>
            <button class="btn ghost sm" type="button" id="delB" style="--fg:var(--bad)">Delete</button>
          </div>
        </div>
      </div></div>
      <div class="df" id="dactions"></div>`;

    const acts = [];
    const S = b.status;
    if (S === 'pending') acts.push(['confirm', '✓ Confirm payment', 'ok', 'c'], ['reupload', 'Ask to re-upload', 'warn'], ['reject', 'Reject', 'bad', 'r']);
    if (S === 'awaiting_payment') acts.push(['confirm', '✓ Mark paid & confirm', 'ok'], ['reject', 'Reject', 'bad'], ['cancel', 'Cancel hold', 'ghost']);
    if (S === 'confirmed') {
      acts.push(['checkin', 'Check in tonight', 'ok']);
      if (b.checkins.length) acts.push(['undo_checkin', 'Undo tonight’s check-in', 'ghost']);
      acts.push(['cancel', 'Cancel booking', 'bad']);
    }
    if (['rejected', 'expired', 'cancelled'].includes(S)) acts.push(['confirm', 'Confirm anyway', 'ok'], ['reopen', 'Move back to verification', 'ghost']);
    if (['rejected', 'expired'].includes(S)) acts.push(['reupload', 'Let guest re-upload', 'warn']);
    $('#dactions').innerHTML = acts.map(([a, l, k, key]) => `<button class="btn sm ${k}" type="button" data-a="${a}">${l}${key ? ` <span class="kbd" style="color:inherit;border-color:currentColor;opacity:.7">${key}</span>` : ''}</button>`).join('');
    $('#dactions').onclick = (e) => { const x = e.target.closest('[data-a]'); if (x) act(x.dataset.a, x); };
    $('#dx').onclick = closeDrawer;
    $('#cpUtr') && ($('#cpUtr').onclick = () => navigator.clipboard.writeText(b.utr).then(() => toast('UTR copied')));
    $('#cpLink').onclick = () => navigator.clipboard.writeText(b.ticket_url).then(() => toast('Ticket link copied'));
    $('#delB').onclick = async () => {
      if (!confirm(`Delete booking ${b.code} permanently? This frees its passes and cannot be undone.`)) return;
      try { await M(F.deleteBooking, { id: b.id }); toast('Deleted'); closeDrawer(); } catch (e) { toast(e.message, 'bad'); }
    };
    $('#editG').onclick = () => formModal({
      title: `Edit guest · ${b.code}`,
      fields: [
        { name: 'name', label: 'Name', required: true, full: true },
        { name: 'phone', label: 'Phone', required: true },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'utr', label: 'UTR', full: true },
      ],
      values: b,
      submit: async (v) => { await M(F.updateBooking, { id: b.id, ...v }); toast('Saved', 'ok'); openBooking(b.id); },
    });
    const img = $('#shotImg');
    if (img) img.onclick = () => window.open(img.src, '_blank');
  }

  async function act(action, btn, force) {
    if (!current) return;
    const note = $('#anote') ? $('#anote').value.trim() : '';
    if (['reject', 'reupload'].includes(action) && !note) {
      const n = prompt(action === 'reject' ? 'Reason for rejecting (shown to the guest):' : 'What should the guest fix? (shown to them)', action === 'reject' ? 'Payment not received / amount does not match.' : 'Screenshot is unclear — please upload the full success screen with UTR.');
      if (n == null) return;
      $('#anote').value = n;
      return act(action, btn);
    }
    if (action === 'cancel' && !confirm('Cancel this booking and release its passes?')) return;
    if (btn) busy(btn, true, '…');
    try {
      const id = current.id;
      await M(F.bookingAction, { id, action, note: note || undefined, force: force || undefined });
      const b = { id };
      const msgs = { confirm: 'Confirmed ✓ — pass is live', reject: 'Rejected', reupload: 'Guest asked to re-upload', cancel: 'Cancelled', reopen: 'Back in the queue', checkin: 'Checked in ✓', undo_checkin: 'Check-in undone' };
      toast(msgs[action] || 'Done', action === 'reject' || action === 'cancel' ? '' : 'ok');
      // in the queue, move straight on to the next one (the live list drops this one)
      const i = lastRows.findIndex((r) => r.id === b.id);
      if (bstate.status === 'pending' && ['confirm', 'reject', 'reupload'].includes(action)) {
        const rest = lastRows.filter((r) => r.id !== b.id);
        const next = rest[Math.min(i, rest.length - 1)];
        if (next) return openBooking(next.id);
        closeDrawer();
        return;
      }
      openBooking(b.id);
    } catch (e) {
      if (btn) busy(btn, false);
      if (e.code === 'WRONG_NIGHT' && action === 'checkin' && confirm(e.message + '\n\nAdmit anyway?')) return act(action, null, true);
      toast(e.message, 'bad');
    }
  }

  function counterBooking() {
    Q(F.passes).then((ps) => {
      const opts = ps.filter((p) => p.active).map((p) => ({ v: p.id, l: `${dateShort(p.date)} — ${p.quantity - p.held} left` }));
      formModal({
        title: 'Counter / manual booking',
        intro: 'For cash or offline sales. Stock is checked; it is marked confirmed unless you choose otherwise. The price is the one in Settings.',
        fields: [
          { name: 'pass', label: 'Night', type: 'select', options: opts, required: true, full: true },
          { name: 'qty', label: 'Passes', type: 'number', min: 1, required: true },
          { name: 'status', label: 'Status', type: 'select', options: [{ v: 'confirmed', l: 'Confirmed (paid)' }, { v: 'pending', l: 'Pending verification' }] },
          { name: 'name', label: 'Guest name', required: true },
          { name: 'phone', label: 'Phone', required: true },
          { name: 'utr', label: 'UTR / receipt no. (optional)' },
          { name: 'note', label: 'Internal note', full: true },
        ],
        values: { qty: 1, status: 'confirmed' },
        submit: async (v) => {
          const b = await M(F.counterBooking, {
            name: v.name, phone: v.phone, note: v.note || undefined, utr: v.utr || undefined, status: v.status,
            items: [{ passId: v.pass, qty: Number(v.qty) }], secret: secret(),
          });
          toast(`Booking ${b.code} created`, 'ok');
          openBooking(b.id);
        },
      });
    }).catch((e) => toast(e.message, 'bad'));
  }

  /* ================= gate check-in ================= */
  let stream = null;
  function stopScan() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
  function checkin(pane, code) {
    pane.dataset.view = 'checkin';
    stopScan();
    const canScan = 'BarcodeDetector' in window && navigator.mediaDevices;
    pane.innerHTML = head('Gate check-in', 'Scan the guest’s QR, or type their booking code') + `
      <div class="gate">
        <form id="gform"><input class="input" name="code" placeholder="MVXXXXXXXX" autocomplete="off" autocapitalize="characters" value="${esc(code || '')}" aria-label="Booking code"><button class="btn" type="submit">Look up</button></form>
        ${canScan ? '<button class="btn ghost" type="button" id="scanBtn">📷 Scan QR with camera</button><video id="scanVideo" playsinline hidden></video>' : '<p class="muted sm">Tip: scanning the guest’s QR with your phone camera opens this page with their code filled in.</p>'}
        <div id="verdict"></div>
      </div>`;
    const form = $('#gform');
    form.onsubmit = (e) => { e.preventDefault(); lookupGate(form.code.value.trim().toUpperCase()); };
    if (canScan) $('#scanBtn').onclick = startScan;
    if (code) lookupGate(code.toUpperCase()); else form.code.focus();
  }
  async function startScan() {
    const video = $('#scanVideo');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch { toast('Camera not available', 'bad'); return; }
    video.hidden = false; video.srcObject = stream; await video.play();
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const loop = async () => {
      if (!stream) return;
      try {
        const codes = await det.detect(video);
        const raw = codes[0] && codes[0].rawValue;
        const m = raw && raw.match(/MV[A-Z0-9]{6,8}/);
        if (m) { stopScan(); video.hidden = true; $('#gform').code.value = m[0]; lookupGate(m[0]); return; }
      } catch { /* keep trying */ }
      requestAnimationFrame(loop);
    };
    loop();
  }
  async function lookupGate(code) {
    const box = $('#verdict');
    if (!code) return;
    box.innerHTML = '<p class="muted">Checking…</p>';
    let b;
    try { b = await Q(F.checkinLookup, { code }); } catch (e) { box.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    if (!b) { box.innerHTML = '<div class="verdict bad"><h2>✕ Not found</h2><p>No booking with that code.</p></div>'; return; }
    const admits = b.items.reduce((s, i) => s + i.qty, 0);
    const tonight = b.checkins.find((c) => c.night === b.night);
    const validTonight = b.items.some((i) => i.date === b.night);
    const items = `<ul>${b.items.map((i) => `<li>${i.qty} × ${esc(PASS)} · ${esc(dateShort(i.date))}</li>`).join('')}</ul>`;
    let cls, title, btn = '';
    if (b.status !== 'confirmed') { cls = 'bad'; title = `✕ Not confirmed (${esc((STATUS[b.status] || [b.status])[0])})`; }
    else if (tonight) { cls = 'warn'; title = `Already checked in at ${esc(when(tonight.at).split(', ').pop())}`; }
    else if (!validTonight) { cls = 'warn'; title = '⚠ Pass is for another night'; btn = '<button class="btn" type="button" data-force="1">Admit anyway</button>'; }
    else { cls = 'ok'; title = `✓ Valid — admit ${admits}`; btn = `<button class="btn" type="button">Admit ${admits}</button>`; }
    box.innerHTML = `<div class="verdict ${cls}"><h2>${title}</h2><div class="who"><b>${esc(b.name)}</b> · <span class="mono">${esc(b.code)}</span></div>${items}${btn}</div>
      <p style="text-align:center"><a href="#booking/${b.id}">Open booking</a></p>`;
    const ab = box.querySelector('.verdict button');
    if (ab) ab.onclick = async () => {
      busy(ab, true, 'Admitting…');
      try {
        await M(F.bookingAction, { id: b.id, action: 'checkin', force: !!ab.dataset.force || undefined });
        toast(`${b.name} admitted ✓`, 'ok');
        lookupGate(code);
        const f = $('#gform'); f.code.value = ''; f.code.focus();
      } catch (e) { busy(ab, false); toast(e.message, 'bad'); }
    };
  }
  addEventListener('hashchange', () => { if (!location.hash.startsWith('#checkin')) stopScan(); });

  /* ================= nights & stock ================= */
  /* One ground and one pass type, so the only thing to manage per night is how
     many passes exist and whether they are on sale. The price is in Settings. */
  async function passes(pane) {
    pane.dataset.view = 'passes';
    pane.innerHTML = head('Nights & stock', 'One row per night: how many passes exist, and how many are gone',
      '<button class="btn ghost sm" id="bulkP" type="button">+ Add a range of nights</button><button class="btn sm" id="addP" type="button">+ Add night</button>') + `
      <div class="filters"><span class="muted sm">“Held” counts unpaid holds, payments awaiting verification and confirmed passes. The pass price is set under <a href="#settings">Settings</a>.</span></div>
      <div class="panel2" id="pbox"><div class="empty-state">Loading…</div></div>`;
    $('#addP').onclick = () => nightForm();
    $('#bulkP').onclick = bulkForm;
    loadPasses();
  }
  let passCache = [];
  async function loadPasses() {
    const box = $('#pbox');
    try { passCache = await Q(F.passes); } catch (e) { box.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    if (!passCache.length) { box.innerHTML = '<div class="empty-state">No nights yet. Use “Add a range of nights” to create them all at once.</div>'; return; }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Night</th><th class="num">Passes</th><th class="num">Confirmed</th><th class="num">Unpaid holds</th><th class="num">Held</th><th class="num">Left</th><th>On sale</th><th></th></tr></thead><tbody>
      ${passCache.map((p) => `<tr class="${p.active ? '' : 'inactive'}"><td>${esc(dateShort(p.date))}<div class="muted sm">${esc(p.date)}</div></td>
        <td class="num">${p.quantity}</td><td class="num">${p.sold}</td><td class="num">${p.unpaid}</td><td class="num">${p.held}</td><td class="num">${p.quantity - p.held}</td>
        <td><label class="switch"><input type="checkbox" data-t="${p.id}" ${p.active ? 'checked' : ''} aria-label="On sale"></label></td>
        <td class="num"><button class="iconbtn" data-e="${p.id}">Edit</button> <button class="iconbtn danger" data-d="${p.id}">Delete</button></td></tr>`).join('')}
    </tbody></table></div>`;
    box.onclick = async (e) => {
      const t = e.target;
      if (t.dataset.e) nightForm(passCache.find((p) => p.id === t.dataset.e));
      if (t.dataset.d) {
        if (!confirm('Remove this night from sale entirely?')) return;
        try { await M(F.deletePass, { id: t.dataset.d }); toast('Night removed'); loadPasses(); } catch (ex) { toast(ex.message, 'bad'); }
      }
    };
    box.onchange = async (e) => {
      const t = e.target;
      if (!t.dataset.t) return;
      const p = passCache.find((x) => x.id === t.dataset.t);
      try { await M(F.savePass, { id: p.id, date: p.date, quantity: p.quantity, active: t.checked }); toast(t.checked ? 'On sale' : 'Taken off sale'); loadPasses(); }
      catch (ex) { toast(ex.message, 'bad'); t.checked = !t.checked; }
    };
  }
  const nightFields = [
    { name: 'date', label: 'Date of the night', type: 'date', required: true },
    { name: 'quantity', label: 'Passes available', type: 'number', min: 0, required: true },
    { name: 'active', label: 'On sale', type: 'switch' },
  ];
  function nightForm(p) {
    formModal({
      title: p ? `Edit ${dateShort(p.date)}` : 'Add a night',
      fields: nightFields,
      values: p || { quantity: 500, active: true },
      submit: async (v) => {
        await M(F.savePass, { ...(p ? { id: p.id } : {}), date: v.date, quantity: Number(v.quantity) || 0, active: !!v.active });
        toast('Night saved', 'ok'); loadPasses();
      },
    });
  }
  function bulkForm() {
    formModal({
      title: 'Add a range of nights',
      intro: 'Creates one row per night in the range — e.g. all ten nights at once. Nights that already exist are left as they are.',
      fields: [
        { name: 'from', label: 'First night', type: 'date', required: true },
        { name: 'to', label: 'Last night', type: 'date', required: true },
        { name: 'quantity', label: 'Passes available each night', type: 'number', min: 0, required: true },
        { name: 'active', label: 'On sale', type: 'switch' },
      ],
      values: { from: '2026-10-11', to: '2026-10-19', quantity: 500, active: true },
      submit: async (v) => {
        const n = await M(F.bulkPasses, { from: v.from, to: v.to, quantity: Number(v.quantity) || 0, active: !!v.active });
        toast(n ? `${n} night${n === 1 ? '' : 's'} added` : 'Those nights already existed', n ? 'ok' : '');
        loadPasses();
      },
    });
  }

  /* ================= faqs ================= */
  async function faqs(pane) {
    pane.dataset.view = 'faqs';
    pane.innerHTML = head('FAQs', 'Shown on the home page', '<button class="btn sm" id="addF" type="button">+ Add question</button>') + '<div class="panel2" id="fbox"></div>';
    $('#addF').onclick = () => faqForm();
    let fs;
    try { fs = await Q(F.faqs); } catch (e) { return fail(pane, e); }
    $('#fbox').innerHTML = fs.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${fs.map((f) => `<tr class="${f.active ? '' : 'inactive'}"><td style="width:50px" class="muted">${f.sort}</td><td><b>${esc(f.question)}</b><div class="muted sm">${esc(f.answer)}</div></td>
      <td class="num"><button class="iconbtn" data-e="${f.id}">Edit</button> <button class="iconbtn danger" data-d="${f.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No questions yet.</div>';
    $('#fbox').onclick = async (e) => {
      const t = e.target;
      if (t.dataset.e) faqForm(fs.find((f) => f.id === t.dataset.e));
      if (t.dataset.d && confirm('Delete this question?')) { await M(F.deleteFaq, { id: t.dataset.d }).catch((x) => toast(x.message, 'bad')); faqs(pane); }
    };
  }
  function faqForm(f) {
    formModal({
      title: f ? 'Edit question' : 'Add question',
      fields: [{ name: 'question', label: 'Question', required: true, full: true }, { name: 'answer', label: 'Answer', type: 'textarea', required: true, full: true }, { name: 'sort', label: 'Order', type: 'number' }, { name: 'active', label: 'Show', type: 'switch' }],
      values: f || { active: true, sort: 10 },
      submit: async (v) => { await M(F.saveFaq, { ...(f ? { id: f.id } : {}), question: v.question, answer: v.answer, sort: Number(v.sort) || 0, active: !!v.active }); toast('Saved', 'ok'); faqs($('#pane')); },
    });
  }

  /* ================= settings ================= */
  async function settings(pane) {
    pane.dataset.view = 'settings';
    let s, pay;
    try { [s, pay] = await Promise.all([Q(F.settings), Q(F.paymentSettings)]); } catch (e) { return fail(pane, e); }
    /* Where the money goes lives in its own form below, because changing it
       requires the password again — a stolen session must not be able to
       redirect every future payment. */
    const payFields = [
      { name: 'upi_id', label: 'UPI ID', required: true, placeholder: 'yourname@okhdfcbank', help: 'Money goes here. Double-check it!' },
      { name: 'upi_payee_name', label: 'Payee name', required: true },
    ];
    const groups = [
      ['The pass', [
        { name: 'pass_price', label: 'Price per pass (₹)', type: 'number', min: 0, help: 'One pass, one person, one night. This is the only price there is — changing it does not alter bookings already made.' },
        { name: 'max_items_per_booking', label: 'Max passes per booking', type: 'number', min: 1 },
        { name: 'booking_open', label: 'Online booking open', type: 'switch', full: true },
      ]],
      ['The ground', [
        { name: 'venue_address', label: 'Address', full: true },
        { name: 'venue_map_url', label: 'Google Maps link', full: true, placeholder: 'https://maps.app.goo.gl/…' },
        { name: 'venue_photo', label: 'Photo of the ground', type: 'image', full: true },
      ]],
      ['Payment window', [
        { name: 'payment_instructions', label: 'Payment instructions', type: 'textarea', full: true },
        { name: 'hold_minutes', label: 'Minutes to pay before passes are released', type: 'number', min: 5 },
      ]],
      ['Event', [
        { name: 'event_title', label: 'Event title' }, { name: 'event_dates_text', label: 'Dates (as shown)' },
        { name: 'event_time_text', label: 'Timing (as shown)' }, { name: 'tagline_gu', label: 'Gujarati tagline' },
        { name: 'site_name', label: 'Site name' }, { name: 'site_name_gu', label: 'Site name (Gujarati)' },
        { name: 'about_text', label: 'About (home page)', type: 'textarea', full: true },
        { name: 'terms_text', label: 'Terms shown at checkout', type: 'textarea', full: true },
      ]],
      ['Contact', [
        { name: 'contact_phone', label: 'Phone' }, { name: 'contact_whatsapp', label: 'WhatsApp number', placeholder: '919876543210' },
        { name: 'contact_email', label: 'Email', type: 'email' }, { name: 'instagram_url', label: 'Instagram URL' }, { name: 'youtube_url', label: 'YouTube URL' },
      ]],
    ];
    pane.innerHTML = head('Settings', 'The price, the ground, payment details, event text and contact info') + `<form class="sgrid" id="sform" novalidate>
      ${groups.map(([t, fs]) => `<section class="panel2"><h2>${t}</h2><div class="pad">${fs.map((f) => fieldHtml(f, s[f.name])).join('')}</div></section>`).join('')}
      <div class="savebar"><button class="btn" type="submit">Save settings</button></div></form>
      <form class="sgrid" id="payform" style="margin-top:10px" novalidate><section class="panel2"><h2>Payment (UPI) — where the money goes</h2><div class="pad">
        ${payFields.map((f) => fieldHtml(f, pay[f.name])).join('')}
        <label class="field"><span>Your admin password</span><input type="password" name="password" autocomplete="current-password" required></label>
        <p class="full muted sm">Changing these redirects every future payment, so your password is required and the change is recorded.</p>
        <div class="full"><button class="btn sm" type="submit">Save payment details</button></div></div></section></form>
      <form class="sgrid" id="pwform" style="margin-top:10px"><section class="panel2"><h2>Admin password</h2><div class="pad">
        <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>New password (12+ characters)</span><input type="password" name="next" minlength="12" autocomplete="new-password" required></label>
        <div class="full"><button class="btn sm" type="submit">Change password</button></div></div></section></form>
      <section class="panel2" style="margin-top:10px"><h2>Recent changes <button class="iconbtn" type="button" id="logBtn">Show</button></h2><div class="pad" id="logBox"></div></section>`;
    wireFields($('#sform'));
    wireFields($('#payform'));
    $('#payform').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('[type=submit]');
      const password = e.target.password.value;
      if (!password) { toast('Enter your admin password to change payment details.', 'bad'); return; }
      busy(btn, true, 'Saving…');
      const vals = readForm(e.target, payFields);
      try {
        await authed(a(fns.admin.savePaymentSettings, {
          token, password, values: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, String(v)])),
        }));
        toast('Payment details saved', 'ok');
        e.target.password.value = '';
      } catch (ex) { toast(ex.message, 'bad'); }
      busy(btn, false);
    };
    $('#logBtn').onclick = async (e) => {
      busy(e.target, true, 'Loading…');
      try {
        const rows = await Q(F.auditLog);
        $('#logBox').innerHTML = rows.length
          ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>Subject</th><th>From</th><th>To</th></tr></thead><tbody>
              ${rows.map((r) => `<tr><td class="muted sm">${esc(when(r.at))}</td><td class="mono sm">${esc(r.action)}</td><td>${esc(r.subject || '—')}</td><td class="sm">${esc(r.before || '—')}</td><td class="sm">${esc(r.after || '—')}</td></tr>`).join('')}
            </tbody></table></div>`
          : '<p class="muted">Nothing recorded yet.</p>';
      } catch (ex) { toast(ex.message, 'bad'); }
      busy(e.target, false);
    };
    $('#sform').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('[type=submit]');
      busy(btn, true, 'Saving…');
      const vals = readForm(e.target, groups.flatMap((g) => g[1]));
      const values = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)]));
      try { await M(F.saveSettings, { values }); toast('Settings saved', 'ok'); }
      catch (ex) { toast(ex.message, 'bad'); }
      busy(btn, false);
    };
    $('#pwform').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await authed(a(fns.auth.changePassword, { token, current: e.target.current.value, next: e.target.next.value }));
        me.default_password = false; toast('Password changed', 'ok'); e.target.reset();
      } catch (ex) { toast(ex.message, 'bad'); }
    };
  }

  /* ================= generic form bits ================= */
  function fieldHtml(f, val) {
    const v = val ?? '';
    const cls = f.full ? 'field full' : 'field';
    const req = f.required ? 'required' : '';
    const help = f.help ? `<small>${esc(f.help)}</small>` : '';
    if (f.type === 'switch') return `<label class="switch ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${String(v) === '1' || v === true ? 'checked' : ''}> ${esc(f.label)}</label>`;
    if (f.type === 'date' && v === null) return fieldHtml(f, '');
    if (f.type === 'textarea') return `<label class="${cls}"><span>${esc(f.label)}</span><textarea name="${f.name}" rows="3" ${req}>${esc(v)}</textarea>${help}</label>`;
    if (f.type === 'select') return `<label class="${cls}"><span>${esc(f.label)}</span><select name="${f.name}" ${req}>${f.options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>${help}</label>`;
    if (f.type === 'image') return `<div class="${cls}"><span>${esc(f.label)}</span><div class="imgfield"><img alt="" src="${esc(v)}" ${v ? '' : 'hidden'}>
      <input type="hidden" name="${f.name}" value="${esc(v)}"><label class="btn ghost sm" style="cursor:pointer">Upload<input type="file" accept="image/*" hidden data-up="${f.name}"></label>
      <button type="button" class="iconbtn" data-clear="${f.name}">Remove</button></div>${help}</div>`;
    return `<label class="${cls}"><span>${esc(f.label)}</span><input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.min != null ? `min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}" ${req}>${help}</label>`;
  }
  function wireFields(root) {
    root.querySelectorAll('[data-up]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast('Please choose an image', 'bad'); return; }
      try {
        const storageId = await upload(await M(F.uploadUrl), f);
        const r = { url: await M(F.fileUrl, { storageId }) };
        const wrap = inp.closest('.imgfield');
        wrap.querySelector('input[type=hidden]').value = r.url;
        const img = wrap.querySelector('img'); img.src = r.url; img.hidden = false;
        toast('Image uploaded — remember to save', 'ok');
      } catch (e) { toast(e.message, 'bad'); }
    }));
    root.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
      const wrap = b.closest('.imgfield');
      wrap.querySelector('input[type=hidden]').value = '';
      wrap.querySelector('img').hidden = true;
    }));
  }
  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (!el) continue;
      out[f.name] = f.type === 'switch' ? el.checked : f.type === 'number' ? Number(el.value) || 0 : el.value.trim();
    }
    return out;
  }

  const modal = $('#modal');
  function formModal({ title, intro, fields, values = {}, submit }) {
    modal.innerHTML = `<form method="dialog" novalidate>
      <div class="mh"><h2>${esc(title)}</h2><button class="iconbtn" type="button" value="cancel" id="mclose">✕</button></div>
      <div class="mb">${intro ? `<p class="full muted sm">${esc(intro)}</p>` : ''}${fields.map((f) => fieldHtml(f, values[f.name])).join('')}
        <div class="notice bad formerr full" id="merr" role="alert"></div></div>
      <div class="mf"><button class="btn ghost sm" type="button" id="mcancel">Cancel</button><button class="btn sm" type="submit" id="msave">Save</button></div></form>`;
    wireFields(modal);
    const close = () => modal.close();
    $('#mclose').onclick = close; $('#mcancel').onclick = close;
    modal.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const miss = fields.find((f) => f.required && !String(form.elements[f.name].value || '').trim());
      const err = $('#merr');
      if (miss) { err.textContent = `${miss.label} is required.`; err.classList.add('on'); form.elements[miss.name].focus(); return; }
      const btn = $('#msave');
      busy(btn, true, 'Saving…');
      try { await submit(readForm(form, fields)); close(); }
      catch (ex) { busy(btn, false); err.textContent = ex.message; err.classList.add('on'); }
    };
    modal.showModal();
    const first = modal.querySelector('.mb input:not([type=hidden]), .mb select, .mb textarea');
    if (first) first.focus();
  }
  boot();
})();
