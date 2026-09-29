/* Admin panel — a small hash-routed app over /api/admin. */
(function () {
  'use strict';
  const { api, esc, inr, dateShort, when, toast, statusPill, busy, STATUS } = window.MV;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const A = (path, opts) => api('/api/admin' + path, opts).catch((e) => {
    if (e.status === 401) { showLogin(); }
    throw e;
  });

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    bookings: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4z"/>',
    checkin: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
    venues: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    passes: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    faqs: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
  const NAV = [['dashboard', 'Dashboard'], ['bookings', 'Bookings'], ['checkin', 'Gate check-in'], ['venues', 'Venues'], ['passes', 'Passes & dates'], ['faqs', 'FAQs'], ['settings', 'Settings']];

  let me = { admin: false };
  let venuesCache = [];
  let pendingCount = 0;

  boot();
  async function boot() {
    me = await api('/api/admin/me').catch(() => ({ admin: false }));
    if (!me.admin) return showLogin();
    shell();
    addEventListener('hashchange', route);
    route();
  }

  /* ---------------- login ---------------- */
  function showLogin() {
    closeDrawer();
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
        await api('/api/admin/login', { method: 'POST', body: { password: e.target.password.value } });
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
    $('#logout').onclick = async () => { await A('/logout', { method: 'POST' }).catch(() => {}); location.reload(); };
    $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
    $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
    refreshBadge();
    setInterval(refreshBadge, 60000);
  }
  async function refreshBadge() {
    try {
      const s = await A('/stats');
      pendingCount = (s.byStatus.find((x) => x.status === 'pending') || {}).n || 0;
      const b = $('#pendBadge');
      if (b) { b.hidden = !pendingCount; b.textContent = pendingCount; }
      document.title = (pendingCount ? `(${pendingCount}) ` : '') + 'Admin — Mavladi Mandli';
    } catch { /* ignore */ }
  }

  function route() {
    const [k, arg] = (location.hash.slice(1) || 'dashboard').split('/');
    $$('.side a.nav').forEach((a) => a.classList.toggle('on', a.dataset.k === (k === 'booking' ? 'bookings' : k)));
    const pane = $('#pane');
    if (!(k === 'bookings' || k === 'booking') || !$('#blist')) pane.dataset.view = '';
    if (k !== 'booking') closeDrawerQuiet();
    const views = { dashboard, bookings, booking: (p, id) => { bookings(p); openBooking(+id); }, checkin, venues, passes, faqs, settings };
    (views[k] || dashboard)(pane, arg && decodeURIComponent(arg));
  }

  const head = (title, sub, acts = '') => `<div class="phead"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="acts">${acts}</div></div>`;
  const fail = (pane, e) => { pane.insertAdjacentHTML('beforeend', `<div class="notice bad">${esc(e.message)}</div>`); };

  async function getVenues() {
    venuesCache = await A('/venues');
    return venuesCache;
  }

  /* ================= dashboard ================= */
  async function dashboard(pane) {
    pane.innerHTML = head('Dashboard', 'Everything at a glance') + '<p class="muted">Loading…</p>';
    let s;
    try { s = await A('/stats'); } catch (e) { return fail(pane, e); }
    const st = (k) => s.byStatus.find((x) => x.status === k) || { n: 0, amount: 0 };
    const soldQty = s.inventory.reduce((a, i) => a + i.confirmed, 0);
    const heldQty = s.inventory.reduce((a, i) => a + i.held, 0);
    const byVenue = new Map();
    for (const i of s.inventory) { if (!byVenue.has(i.venue)) byVenue.set(i.venue, []); byVenue.get(i.venue).push(i); }
    const def = me.default_password ? `<div class="notice bad" style="margin-bottom:16px">⚠ You are still using the default admin password. <a href="#settings">Change it now</a>.</div>` : '';
    pane.innerHTML = head('Dashboard', `Today is ${esc(dateShort(s.today))}`, '<a class="btn sm" href="#bookings">Open verification queue</a>') + def + `
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
      ${[...byVenue].map(([v, rows]) => `<div class="panel2"><h2>${esc(v)} — inventory</h2><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Night</th><th>Pass</th><th class="num">Price</th><th class="num">Confirmed</th><th class="num">Held</th><th class="num">Left</th><th>Fill</th></tr></thead><tbody>
        ${rows.map((i) => { const pct = i.quantity ? Math.round((i.held / i.quantity) * 100) : 0; return `<tr class="${i.active ? '' : 'inactive'}"><td>${esc(dateShort(i.date))}</td><td>${esc(i.label)}</td><td class="num">${inr(i.price)}</td><td class="num">${i.confirmed}</td><td class="num">${i.held}</td><td class="num">${i.quantity - i.held} / ${i.quantity}</td><td><div class="bar"><i class="${pct > 80 ? 'hi' : ''}" style="width:${pct}%"></i></div></td></tr>`; }).join('')}
        </tbody></table></div></div>`).join('')}`;
    pane.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `booking/${tr.dataset.id}`; });
  }

  /* ================= bookings ================= */
  const bstate = { status: 'pending', venue: '', date: '', q: '', page: 1 };
  let lastRows = [];
  async function bookings(pane) {
    if (pane.dataset.view === 'bookings') return loadBookings();
    pane.dataset.view = 'bookings';
    await getVenues().catch(() => []);
    const tabs = [['pending', 'To verify'], ['awaiting_payment', 'Awaiting payment'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected'], ['expired', 'Expired'], ['cancelled', 'Cancelled'], ['', 'All']];
    pane.innerHTML = head('Bookings', 'Verify payments, confirm passes, manage every booking',
      '<button class="btn ghost sm" id="csvBtn" type="button">Export CSV</button><button class="btn sm" id="newBk" type="button">+ Counter booking</button>') + `
      <div class="tabs" id="btabs">${tabs.map(([k, l]) => `<button type="button" data-s="${k}" class="${bstate.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="filters">
        <input class="input" id="bq" type="search" placeholder="Search code, name, phone, UTR…" value="${esc(bstate.q)}">
        <select class="input" id="bv"><option value="">All venues</option>${venuesCache.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
        <input class="input" id="bd" type="date" value="${esc(bstate.date)}" title="Pass date">
      </div>
      <div class="panel2" id="blist"><div class="empty-state">Loading…</div></div>`;
    $('#bv').value = bstate.venue;
    $('#btabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; bstate.status = b.dataset.s; bstate.page = 1; $$('#btabs button').forEach((x) => x.classList.toggle('on', x === b)); loadBookings(); };
    let tq;
    $('#bq').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { bstate.q = e.target.value.trim(); bstate.page = 1; loadBookings(); }, 250); };
    $('#bv').onchange = (e) => { bstate.venue = e.target.value; bstate.page = 1; loadBookings(); };
    $('#bd').onchange = (e) => { bstate.date = e.target.value; bstate.page = 1; loadBookings(); };
    $('#csvBtn').onclick = () => { location.href = '/api/admin/bookings.csv?' + qs(); };
    $('#newBk').onclick = counterBooking;
    loadBookings();
  }
  const qs = () => new URLSearchParams(Object.entries(bstate).filter(([, v]) => v !== '' && v != null)).toString();

  async function loadBookings() {
    const box = $('#blist');
    if (!box) return;
    let res;
    try { res = await A('/bookings?' + qs()); } catch (e) { box.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    lastRows = res.rows;
    if (!res.rows.length) { box.innerHTML = `<div class="empty-state">${bstate.status === 'pending' ? 'No payments waiting for verification. 🪔' : 'No bookings match.'}</div>`; return; }
    const pages = Math.ceil(res.total / res.limit);
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Guest</th><th>Passes</th><th class="num">Amount</th><th>UTR</th><th>Status</th><th>${bstate.status === 'pending' ? 'Paid' : 'Created'}</th></tr></thead><tbody>
      ${res.rows.map((b) => `<tr class="click" data-id="${b.id}">
        <td class="mono">${esc(b.code)}${b.source === 'counter' ? ' <span class="pill mute">counter</span>' : ''}</td>
        <td>${esc(b.name)}<div class="muted sm">${esc(b.phone)}</div></td>
        <td class="sm">${b.items.map((i) => `${i.qty}× ${esc(i.pass_label)} <span class="muted">${esc(dateShort(i.pass_date))}</span>`).join('<br>')}</td>
        <td class="num">${inr(b.amount)}</td>
        <td class="mono sm">${esc(b.utr || '—')}${b.screenshot ? ' 🖼' : ''}</td>
        <td>${statusPill(b.status)}${b.checked_in_at ? ' <span class="pill ok">in</span>' : ''}</td>
        <td class="muted sm">${esc(when(bstate.status === 'pending' ? b.paid_at : b.created_at))}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pager"><span>${res.total} booking${res.total === 1 ? '' : 's'}</span><span>
        <button class="iconbtn" ${res.page <= 1 ? 'disabled' : ''} data-pg="-1">← Prev</button> Page ${res.page} / ${pages}
        <button class="iconbtn" ${res.page >= pages ? 'disabled' : ''} data-pg="1">Next →</button></span></div>`;
    box.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => openBooking(+tr.dataset.id));
    box.querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => { bstate.page += +b.dataset.pg; loadBookings(); });
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
    try { b = await A('/bookings/' + id); } catch (e) { drawer.innerHTML = `<div class="db"><div class="notice bad">${esc(e.message)}</div></div>`; return; }
    current = b;
    const shot = b.screenshot ? `/api/admin/screenshots/${encodeURIComponent(b.screenshot)}` : null;
    const admits = b.items.reduce((s, i) => s + i.qty * i.admits, 0);
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
            <ul class="itemlist" style="list-style:none;margin:0;padding:0;display:grid;gap:6px">${b.items.map((i) => `<li style="display:flex;justify-content:space-between;gap:10px"><span>${i.qty} × ${esc(i.pass_label)} <span class="muted">· ${esc(dateShort(i.pass_date))} · ${esc(i.venue_name)}</span></span><b>${inr(i.qty * i.unit_price)}</b></li>`).join('')}</ul>
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
      try { await A('/bookings/' + b.id, { method: 'DELETE' }); toast('Deleted'); closeDrawer(); loadBookings(); refreshBadge(); } catch (e) { toast(e.message, 'bad'); }
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
      submit: async (v) => { await A('/bookings/' + b.id, { method: 'PATCH', body: v }); toast('Saved', 'ok'); openBooking(b.id); loadBookings(); },
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
      const b = await A(`/bookings/${current.id}/action`, { method: 'POST', body: { action, note, force } });
      const msgs = { confirm: 'Confirmed ✓ — pass is live', reject: 'Rejected', reupload: 'Guest asked to re-upload', cancel: 'Cancelled', reopen: 'Back in the queue', checkin: 'Checked in ✓', undo_checkin: 'Check-in undone' };
      toast(msgs[action] || 'Done', action === 'reject' || action === 'cancel' ? '' : 'ok');
      refreshBadge();
      // in the queue, move straight on to the next one
      const i = lastRows.findIndex((r) => r.id === b.id);
      await loadBookings();
      if (bstate.status === 'pending' && ['confirm', 'reject', 'reupload'].includes(action)) {
        const next = lastRows[Math.min(i, lastRows.length - 1)];
        if (next) return openBooking(next.id);
        closeDrawer();
        return;
      }
      openBooking(b.id);
    } catch (e) {
      if (btn) busy(btn, false);
      if (e.status === 422 && action === 'checkin' && confirm(e.message + '\n\nAdmit anyway?')) return act(action, null, true);
      toast(e.message, 'bad');
    }
  }

  function counterBooking() {
    A('/passes').then((ps) => {
      const opts = ps.filter((p) => p.active).map((p) => ({ v: p.id, l: `${p.venue_name} · ${dateShort(p.date)} · ${p.label} · ${inr(p.price)} (${p.quantity - p.held} left)` }));
      formModal({
        title: 'Counter / manual booking',
        intro: 'For cash or offline sales. Stock is checked; it is marked confirmed unless you choose otherwise.',
        fields: [
          { name: 'pass', label: 'Pass', type: 'select', options: opts, required: true, full: true },
          { name: 'qty', label: 'Quantity', type: 'number', min: 1, required: true },
          { name: 'status', label: 'Status', type: 'select', options: [{ v: 'confirmed', l: 'Confirmed (paid)' }, { v: 'pending', l: 'Pending verification' }] },
          { name: 'name', label: 'Guest name', required: true },
          { name: 'phone', label: 'Phone', required: true },
          { name: 'utr', label: 'UTR / receipt no. (optional)' },
          { name: 'note', label: 'Internal note', full: true },
        ],
        values: { qty: 1, status: 'confirmed' },
        submit: async (v) => {
          const b = await A('/bookings', { method: 'POST', body: { ...v, items: [{ passId: +v.pass, qty: +v.qty }] } });
          toast(`Booking ${b.code} created`, 'ok');
          loadBookings();
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
        <form id="gform"><input class="input" name="code" placeholder="MVXXXXXX" autocomplete="off" autocapitalize="characters" value="${esc(code || '')}" aria-label="Booking code"><button class="btn" type="submit">Look up</button></form>
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
        const m = raw && raw.match(/MV[A-Z0-9]{6}/);
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
    try { b = await A('/checkin/' + encodeURIComponent(code)); } catch (e) { box.innerHTML = `<div class="verdict bad"><h2>✕ Not found</h2><p>${esc(e.message)}</p></div>`; return; }
    const admits = b.items.reduce((s, i) => s + i.qty * i.admits, 0);
    const tonight = b.checkins.find((c) => c.night === b.night);
    const validTonight = b.items.some((i) => i.pass_date == null || i.pass_date === b.night);
    const items = `<ul>${b.items.map((i) => `<li>${i.qty} × ${esc(i.pass_label)} · ${esc(dateShort(i.pass_date))} · ${esc(i.venue_name)}</li>`).join('')}</ul>`;
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
        await A(`/bookings/${b.id}/action`, { method: 'POST', body: { action: 'checkin', force: !!ab.dataset.force } });
        toast(`${b.name} admitted ✓`, 'ok');
        lookupGate(code);
        const f = $('#gform'); f.code.value = ''; f.code.focus();
      } catch (e) { busy(ab, false); toast(e.message, 'bad'); }
    };
  }
  addEventListener('hashchange', () => { if (!location.hash.startsWith('#checkin')) stopScan(); });

  /* ================= venues ================= */
  async function venues(pane) {
    pane.dataset.view = 'venues';
    pane.innerHTML = head('Venues', 'The grounds you sell passes for', '<button class="btn sm" id="addV" type="button">+ Add venue</button>') + '<div id="vbox" class="vgrid"></div>';
    $('#addV').onclick = () => venueForm();
    let vs;
    try { vs = await getVenues(); } catch (e) { return fail(pane, e); }
    $('#vbox').innerHTML = vs.length ? vs.map((v) => `<article class="vcard">
      ${v.image ? `<img src="${esc(v.image)}" alt="">` : '<img alt="">'}
      <div class="b"><h3>${esc(v.name)} ${v.active ? '' : '<span class="pill mute">hidden</span>'}</h3>
        <p class="muted sm">${esc([v.name_gu, v.city, v.start_time].filter(Boolean).join(' · '))}</p>
        <p class="sm">${v.pass_count} pass line${v.pass_count === 1 ? '' : 's'}</p>
        <div class="a"><button class="iconbtn" data-e="${v.id}">Edit</button><a class="iconbtn" href="#passes" data-p="${v.id}">Passes</a><button class="iconbtn danger" data-d="${v.id}">Delete</button></div></div></article>`).join('')
      : '<div class="empty-state">No venues yet. Add your first ground.</div>';
    $('#vbox').onclick = async (e) => {
      const t = e.target;
      if (t.dataset.e) venueForm(vs.find((v) => v.id === +t.dataset.e));
      if (t.dataset.p) pstate.venue = t.dataset.p;
      if (t.dataset.d) {
        const v = vs.find((x) => x.id === +t.dataset.d);
        if (!confirm(`Delete “${v.name}” and all its passes?`)) return;
        try { await A('/venues/' + v.id, { method: 'DELETE' }); toast('Venue deleted'); venues(pane); } catch (ex) { toast(ex.message, 'bad'); }
      }
    };
  }
  function venueForm(v) {
    formModal({
      title: v ? 'Edit venue' : 'Add venue',
      fields: [
        { name: 'name', label: 'Name', required: true, full: true },
        { name: 'name_gu', label: 'Name in Gujarati' }, { name: 'city', label: 'City' },
        { name: 'address', label: 'Address', full: true },
        { name: 'map_url', label: 'Google Maps link', full: true, placeholder: 'https://maps.app.goo.gl/…' },
        { name: 'start_time', label: 'Timing', placeholder: '8:30 pm onwards' }, { name: 'sort', label: 'Order', type: 'number' },
        { name: 'description', label: 'Short description', type: 'textarea', full: true },
        { name: 'image', label: 'Photo', type: 'image', full: true },
        { name: 'active', label: 'Show on the website', type: 'switch', full: true },
      ],
      values: v || { active: 1, sort: 0 },
      submit: async (val) => {
        await A(v ? '/venues/' + v.id : '/venues', { method: v ? 'PUT' : 'POST', body: val });
        toast('Venue saved', 'ok');
        venues($('#pane'));
      },
    });
  }

  /* ================= passes ================= */
  const pstate = { venue: '' };
  async function passes(pane) {
    pane.dataset.view = 'passes';
    let vs;
    try { vs = await getVenues(); } catch (e) { return fail(pane, e); }
    if (!pstate.venue && vs[0]) pstate.venue = String(vs[0].id);
    pane.innerHTML = head('Passes & dates', 'What’s on sale: one line per venue, night and pass type',
      '<button class="btn ghost sm" id="bulkP" type="button">+ Add many nights</button><button class="btn sm" id="addP" type="button">+ Add pass</button>') + `
      <div class="filters"><select class="input" id="pv">${vs.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
      <span class="muted sm">Leave the date empty for a season pass (all nights). “Held” counts unpaid holds, pending and confirmed.</span></div>
      <div class="panel2" id="pbox"><div class="empty-state">Loading…</div></div>`;
    if (!vs.length) { $('#pbox').innerHTML = '<div class="empty-state">Add a venue first.</div>'; return; }
    $('#pv').value = pstate.venue;
    $('#pv').onchange = (e) => { pstate.venue = e.target.value; loadPasses(); };
    $('#addP').onclick = () => passForm();
    $('#bulkP').onclick = bulkForm;
    loadPasses();
  }
  let passCache = [];
  async function loadPasses() {
    const box = $('#pbox');
    try { passCache = await A('/passes?venue=' + pstate.venue); } catch (e) { box.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    if (!passCache.length) { box.innerHTML = '<div class="empty-state">No passes for this venue yet. Use “Add many nights” to create all nine at once.</div>'; return; }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Night</th><th>Pass</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Held</th><th class="num">Left</th><th class="num">Max/booking</th><th>On sale</th><th></th></tr></thead><tbody>
      ${passCache.map((p) => `<tr class="${p.active ? '' : 'inactive'}"><td>${esc(dateShort(p.date))}</td><td>${esc(p.label)}${p.admits > 1 ? ` <span class="muted sm">admits ${p.admits}</span>` : ''}${p.description ? `<div class="muted sm">${esc(p.description)}</div>` : ''}</td>
        <td class="num">${inr(p.price)}</td><td class="num">${p.quantity}</td><td class="num">${p.held}</td><td class="num">${p.quantity - p.held}</td><td class="num">${p.max_per_booking}</td>
        <td><label class="switch"><input type="checkbox" data-t="${p.id}" ${p.active ? 'checked' : ''} aria-label="On sale"></label></td>
        <td class="num"><button class="iconbtn" data-e="${p.id}">Edit</button> <button class="iconbtn danger" data-d="${p.id}">Delete</button></td></tr>`).join('')}
    </tbody></table></div>`;
    box.onclick = async (e) => {
      const t = e.target;
      if (t.dataset.e) passForm(passCache.find((p) => p.id === +t.dataset.e));
      if (t.dataset.d) {
        if (!confirm('Delete this pass line?')) return;
        try { await A('/passes/' + t.dataset.d, { method: 'DELETE' }); toast('Deleted'); loadPasses(); } catch (ex) { toast(ex.message, 'bad'); }
      }
    };
    box.onchange = async (e) => {
      const t = e.target;
      if (!t.dataset.t) return;
      const p = passCache.find((x) => x.id === +t.dataset.t);
      try { await A('/passes/' + p.id, { method: 'PUT', body: { ...p, active: t.checked ? 1 : 0 } }); toast(t.checked ? 'On sale' : 'Taken off sale'); loadPasses(); }
      catch (ex) { toast(ex.message, 'bad'); t.checked = !t.checked; }
    };
  }
  const passFields = (withDate) => [
    { name: 'venue_id', label: 'Venue', type: 'select', options: venuesCache.map((v) => ({ v: v.id, l: v.name })), required: true, full: true },
    ...(withDate ? [{ name: 'date', label: 'Date (empty = season pass)', type: 'date' }] : []),
    { name: 'label', label: 'Pass name', required: true, placeholder: 'Daily Pass / Couple Pass / Kids' },
    { name: 'price', label: 'Price (₹)', type: 'number', min: 0, required: true },
    { name: 'quantity', label: 'Quantity available', type: 'number', min: 0, required: true },
    { name: 'admits', label: 'People per pass', type: 'number', min: 1 },
    { name: 'max_per_booking', label: 'Max per booking', type: 'number', min: 1 },
    { name: 'description', label: 'Note shown to guests', full: true },
    { name: 'sort', label: 'Order', type: 'number' },
    { name: 'active', label: 'On sale', type: 'switch' },
  ];
  function passForm(p) {
    formModal({
      title: p ? 'Edit pass' : 'Add pass',
      fields: passFields(true),
      values: p || { venue_id: pstate.venue, label: 'Daily Pass', admits: 1, max_per_booking: 10, active: 1, sort: 0 },
      submit: async (v) => {
        await A(p ? '/passes/' + p.id : '/passes', { method: p ? 'PUT' : 'POST', body: v });
        toast('Pass saved', 'ok'); loadPasses();
      },
    });
  }
  function bulkForm() {
    formModal({
      title: 'Add a pass for many nights',
      intro: 'Creates one pass line per night in the range — e.g. a Daily Pass for all nine nights.',
      fields: [{ name: 'from', label: 'First night', type: 'date', required: true }, { name: 'to', label: 'Last night', type: 'date', required: true }, ...passFields(false)],
      values: { venue_id: pstate.venue, from: '2026-10-11', to: '2026-10-19', label: 'Daily Pass', admits: 1, max_per_booking: 10, active: 1, sort: 0 },
      submit: async (v) => {
        const r = await A('/passes/bulk', { method: 'POST', body: v });
        toast(`${r.created} nights added`, 'ok'); loadPasses();
      },
    });
  }

  /* ================= faqs ================= */
  async function faqs(pane) {
    pane.dataset.view = 'faqs';
    pane.innerHTML = head('FAQs', 'Shown on the home page', '<button class="btn sm" id="addF" type="button">+ Add question</button>') + '<div class="panel2" id="fbox"></div>';
    $('#addF').onclick = () => faqForm();
    let fs;
    try { fs = await A('/faqs'); } catch (e) { return fail(pane, e); }
    $('#fbox').innerHTML = fs.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${fs.map((f) => `<tr class="${f.active ? '' : 'inactive'}"><td style="width:50px" class="muted">${f.sort}</td><td><b>${esc(f.question)}</b><div class="muted sm">${esc(f.answer)}</div></td>
      <td class="num"><button class="iconbtn" data-e="${f.id}">Edit</button> <button class="iconbtn danger" data-d="${f.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No questions yet.</div>';
    $('#fbox').onclick = async (e) => {
      const t = e.target;
      if (t.dataset.e) faqForm(fs.find((f) => f.id === +t.dataset.e));
      if (t.dataset.d && confirm('Delete this question?')) { await A('/faqs/' + t.dataset.d, { method: 'DELETE' }).catch((x) => toast(x.message, 'bad')); faqs(pane); }
    };
  }
  function faqForm(f) {
    formModal({
      title: f ? 'Edit question' : 'Add question',
      fields: [{ name: 'question', label: 'Question', required: true, full: true }, { name: 'answer', label: 'Answer', type: 'textarea', required: true, full: true }, { name: 'sort', label: 'Order', type: 'number' }, { name: 'active', label: 'Show', type: 'switch' }],
      values: f || { active: 1, sort: 10 },
      submit: async (v) => { await A(f ? '/faqs/' + f.id : '/faqs', { method: f ? 'PUT' : 'POST', body: v }); toast('Saved', 'ok'); faqs($('#pane')); },
    });
  }

  /* ================= settings ================= */
  async function settings(pane) {
    pane.dataset.view = 'settings';
    let s;
    try { s = await A('/settings'); } catch (e) { return fail(pane, e); }
    const groups = [
      ['Payment (UPI)', [
        { name: 'upi_id', label: 'UPI ID', required: true, placeholder: 'yourname@okhdfcbank', help: 'Money goes here. Double-check it!' },
        { name: 'upi_payee_name', label: 'Payee name', required: true },
        { name: 'upi_qr_image', label: 'Your own QR image (optional)', type: 'image', full: true, help: 'Leave empty to auto-generate a QR per booking with the exact amount filled in (recommended).' },
        { name: 'payment_instructions', label: 'Payment instructions', type: 'textarea', full: true },
        { name: 'hold_minutes', label: 'Minutes to pay before passes are released', type: 'number', min: 5 },
        { name: 'max_items_per_booking', label: 'Max passes per booking', type: 'number', min: 1 },
        { name: 'booking_open', label: 'Online booking open', type: 'switch', full: true },
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
    pane.innerHTML = head('Settings', 'Payment details, event text and contact info') + `<form class="sgrid" id="sform" novalidate>
      ${groups.map(([t, fs]) => `<section class="panel2"><h2>${t}</h2><div class="pad">${fs.map((f) => fieldHtml(f, s[f.name])).join('')}</div></section>`).join('')}
      <div class="savebar"><button class="btn" type="submit">Save settings</button></div></form>
      <form class="sgrid" id="pwform" style="margin-top:10px"><section class="panel2"><h2>Admin password</h2><div class="pad">
        <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>New password (8+ characters)</span><input type="password" name="next" minlength="8" autocomplete="new-password" required></label>
        <div class="full"><button class="btn sm" type="submit">Change password</button></div></div></section></form>`;
    wireFields($('#sform'));
    $('#sform').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('[type=submit]');
      busy(btn, true, 'Saving…');
      try { await A('/settings', { method: 'PUT', body: readForm(e.target, groups.flatMap((g) => g[1])) }); toast('Settings saved', 'ok'); }
      catch (ex) { toast(ex.message, 'bad'); }
      busy(btn, false);
    };
    $('#pwform').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await A('/password', { method: 'POST', body: { current: e.target.current.value, next: e.target.next.value } });
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
      const fd = new FormData(); fd.append('file', f);
      try {
        const r = await A('/upload', { method: 'POST', body: fd });
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
      out[f.name] = f.type === 'switch' ? (el.checked ? 1 : 0) : el.value.trim();
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
})();
