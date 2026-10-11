/* Booking: pick passes → details → reserve (then the ticket page takes payment).
   One ground. Each night sells single, couple and group passes; a season pass
   covers one person on every night still to come. Stock is counted in people. */
(function () {
  'use strict';
  const { q, m, fns, secret, esc, inr, dateLong, dateShort, dateParts, KINDS, NAVDURGA, toast, mine, busy } = window.MV;
  const $ = (s, r = document) => r.querySelector(s);

  const params = new URLSearchParams(location.search);
  const CART_KEY = 'mv_cart';
  let nights = [];
  let kinds = [];                  // on sale, with prices, from the catalogue
  let maxTotal = 20;
  let open = true;
  const byId = new Map();          // nightId -> night
  const kindById = new Map();      // kind -> { id, label, people, season, price }
  /* kind:nightId -> qty, or season -> qty */
  const cart = new Map();

  try {
    for (const [k, n] of JSON.parse(sessionStorage.getItem(CART_KEY) || '[]')) {
      const key = String(k);
      cart.set(key === 'season' || key.includes(':') ? key : `single:${key}`, +n); // carts from before pass kinds
    }
  } catch { /* ignore */ }
  const saveCart = () => { try { sessionStorage.setItem(CART_KEY, JSON.stringify([...cart])); } catch { /* ignore */ } };
  const keyOf = (kind, nightId) => (kind === 'season' ? 'season' : `${kind}:${nightId}`);
  const parseKey = (key) => {
    if (key === 'season') return { kind: 'season', nightId: null };
    const i = key.indexOf(':');
    return { kind: key.slice(0, i), nightId: key.slice(i + 1) };
  };

  init();

  function setCatalogue(cat) {
    open = cat.booking_open;
    nights = cat.nights;
    kinds = cat.kinds;
    byId.clear(); kindById.clear();
    for (const n of nights) byId.set(n.id, n);
    for (const k of kinds) kindById.set(k.id, k);
  }

  async function init() {
    let cfg;
    try {
      const [c, cat] = await Promise.all([window.MV.config(), q(fns.public.catalogue)]);
      cfg = c;
      setCatalogue(cat);
    } catch (e) {
      $('#passArea').innerHTML = `<div class="notice bad">${esc(e.message)} <button class="linkbtn" id="retryBtn" type="button">Retry</button></div>`;
      $('#retryBtn').addEventListener('click', () => location.reload());
      return;
    }
    maxTotal = Math.max(1, parseInt(cfg.max_items_per_booking, 10) || 20);
    $('#closedNote').hidden = open;
    if (cfg.pass_offer_gu) { $('#offerLine').textContent = cfg.pass_offer_gu; $('#offerLine').hidden = false; }
    $('#priceList').innerHTML = kinds.map((k) =>
      `<li><b>${esc(k.label)}</b><span>${inr(k.price)}</span><small>${k.season ? 'all nights' : k.people === 1 ? 'per night' : `${k.people} people · per night`}</small></li>`).join('');
    if (cfg.terms_text) $('#termsText').textContent = `I have read and agree: ${cfg.terms_text}`;
    $('#groundInfo').innerHTML = [
      cfg.venue_address && `<span>📍 ${esc(cfg.venue_address)}</span>`,
      cfg.event_time_text && `<span>🕗 ${esc(cfg.event_time_text)}</span>`,
      cfg.venue_map_url && `<a href="${esc(cfg.venue_map_url)}" target="_blank" rel="noopener">Open in Maps ↗</a>`,
    ].filter(Boolean).join('');

    pruneCart();

    if (!nights.length || !kinds.length) {
      $('#passArea').innerHTML = '<div class="notice info">Passes will be on sale soon. Please check back.</div>';
      renderSummary();
      return;
    }
    renderNights();
    renderSummary();

    const wantDate = params.get('date');
    if (wantDate) {
      const card = document.querySelector(`[data-date="${CSS.escape(wantDate)}"]`);
      if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('flash'); }
    }
  }

  /* the nights a season pass covers: every night still to come */
  const seasonNights = () => nights.filter((n) => !n.past);
  const seasonOk = () => open && kindById.has('season') && seasonNights().length > 0 && seasonNights().every((n) => n.available > 0);

  /* drop anything from an old cart that is no longer on sale, or no longer fits */
  function pruneCart() {
    for (const key of [...cart.keys()]) {
      const { kind, nightId } = parseKey(key);
      const ok = kindById.has(kind) && (kind === 'season' ? seasonOk() : byId.get(nightId)?.bookable && !kindById.get(kind).season);
      if (!ok) cart.delete(key);
    }
    for (const key of [...cart.keys()]) {
      const max = roomFor(key);
      if ((cart.get(key) || 0) > max) { if (max) cart.set(key, max); else cart.delete(key); }
    }
    saveCart();
  }

  const totalQty = () => [...cart.values()].reduce((a, b) => a + b, 0);
  /* people the cart puts on one night, across every kind (season included) */
  function headsOn(night) {
    let n = 0;
    for (const [key, qty] of cart) {
      const { kind, nightId } = parseKey(key);
      if (kind === 'season' ? !night.past : nightId === night.id) n += qty * (KINDS[kind]?.people || 1);
    }
    return n;
  }
  /* How many of this pass the booking may hold: what's left of the night's
     places (every night, for a season pass), and the per-booking maximum. */
  function roomFor(key) {
    const { kind, nightId } = parseKey(key);
    const have = cart.get(key) || 0;
    const people = KINDS[kind]?.people || 1;
    const spare = (n) => Math.max(0, n.available - headsOn(n));
    const fits = kind === 'season'
      ? Math.min(...seasonNights().map(spare))
      : Math.floor(spare(byId.get(nightId)) / people);
    return have + Math.max(0, Math.min(fits, maxTotal - totalQty()));
  }

  function stepper(key, label, enabled) {
    const qty = cart.get(key) || 0;
    return `<div class="qty ${qty ? 'has' : ''}" role="group" aria-label="${esc(label)}">
      <button type="button" data-d="-1" data-k="${esc(key)}" aria-label="One less" ${qty ? '' : 'disabled'}>−</button>
      <output aria-live="polite">${qty}</output>
      <button type="button" data-d="1" data-k="${esc(key)}" aria-label="One more" ${enabled && qty < roomFor(key) ? '' : 'disabled'}>+</button>
    </div>`;
  }

  function seasonCard() {
    const k = kindById.get('season');
    const sn = seasonNights();
    if (!k || !sn.length) return '';
    const ok = seasonOk();
    const has = cart.get('season');
    return `<article class="ncard season ${has ? 'has' : ''} ${ok ? '' : 'off'}">
      ${ok ? '' : '<span class="ribbon">Sold out</span>'}
      <div class="top"><div class="cal star" aria-hidden="true">✨</div>
      <div class="ttl"><b>${esc(k.label)} · every night</b><span class="gu">${esc(KINDS.season.gu)}</span>
      <small>One person, all ${sn.length} night${sn.length > 1 ? 's' : ''} · ${esc(dateShort(sn[0].date))}${sn.length > 1 ? ` – ${esc(dateShort(sn[sn.length - 1].date))}` : ''}</small></div></div>
      <div class="prow">
        <div class="pl"><b>${esc(k.label)}</b><small>${esc(KINDS.season.note)}</small></div>
        <span class="pr">${inr(k.price)}</span>
        ${stepper('season', `${k.label}, all nights`, ok)}
      </div></article>`;
  }

  function nightCard(n, i) {
    const has = [...cart.keys()].some((key) => parseKey(key).nightId === n.id);
    const dp = dateParts(n.date);
    const [en, gu] = NAVDURGA[i] || ['Dussehra', 'દશેરા'];
    let avail = '';
    if (n.past) avail = '<span class="gone">Over</span>';
    else if (!n.available) avail = '<span class="gone">Sold out</span>';
    else if (n.available <= 25) avail = `<span class="left">Only ${n.available} place${n.available === 1 ? '' : 's'} left</span>`;
    const rows = kinds.filter((k) => !k.season).map((k) => `<div class="prow">
        <div class="pl"><b>${esc(k.label)}</b><small>${esc(KINDS[k.id]?.note || '')}</small></div>
        <span class="pr">${inr(k.price)}</span>
        ${stepper(keyOf(k.id, n.id), `${k.label} for ${dateLong(n.date)}`, n.bookable)}
      </div>`).join('');
    return `<article class="ncard ${has ? 'has' : ''} ${n.past || !n.available ? 'off' : ''}" data-date="${esc(n.date)}">
      ${n.past ? '<span class="ribbon">Over</span>' : !n.available ? '<span class="ribbon">Sold out</span>' : ''}
      <div class="top"><div class="cal"><i>${esc(dp.wd)}</i><b>${esc(dp.d)}</b><s>${esc(dp.m)}</s></div>
      <div class="ttl"><b>Night ${i + 1} · ${esc(en)}</b><span class="gu">${gu}</span><small>${esc(dateLong(n.date))}</small>${avail ? `<small>${avail}</small>` : ''}</div></div>
      ${rows}</article>`;
  }

  function renderNights() {
    const perNight = kinds.some((k) => !k.season);
    $('#passArea').innerHTML = `${seasonCard()}
      ${perNight ? `<div class="sec-title"><h2>Pick your nights</h2><span>${nights.length} night${nights.length > 1 ? 's' : ''}</span></div>
      <div class="nightgrid">${nights.map(nightCard).join('')}</div>` : ''}`;
  }

  $('#passArea').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const key = b.dataset.k;
    const want = (cart.get(key) || 0) + +b.dataset.d;
    const n = Math.max(0, Math.min(want, roomFor(key)));
    if (want > n) {
      toast(totalQty() >= maxTotal
        ? `You can book at most ${maxTotal} passes at a time.`
        : parseKey(key).kind === 'season' ? 'Not enough places left on every night for another season pass.' : 'Not enough places left on that night.', 'bad');
    }
    if (n) cart.set(key, n); else cart.delete(key);
    saveCart();
    // re-render, then put focus back where the finger was
    const focusSel = `button[data-k="${CSS.escape(key)}"][data-d="${b.dataset.d}"]`;
    renderNights();
    const again = document.querySelector(focusSel);
    if (again && !again.disabled) again.focus();
    else document.querySelector(`button[data-k="${CSS.escape(key)}"]:not(:disabled)`)?.focus();
    renderSummary();
  });

  const ORDER = Object.keys(KINDS);
  function lines() {
    return [...cart].map(([key, qty]) => {
      const { kind, nightId } = parseKey(key);
      const k = kindById.get(kind);
      if (!k) return null;
      if (kind === 'season') {
        const sn = seasonNights();
        return { key, k, qty, sort: '', when: sn.length ? `All ${sn.length} nights · ${dateShort(sn[0].date)} – ${dateShort(sn[sn.length - 1].date)}` : '' };
      }
      const n = byId.get(nightId);
      return n ? { key, k, qty, sort: n.date, when: dateLong(n.date) } : null;
    }).filter(Boolean).sort((a, b) => a.sort.localeCompare(b.sort) || ORDER.indexOf(a.k.id) - ORDER.indexOf(b.k.id));
  }

  function renderSummary() {
    const ls = lines();
    const count = ls.reduce((s, l) => s + l.qty, 0);
    const people = ls.reduce((s, l) => s + l.qty * l.k.people, 0);
    const total = ls.reduce((s, l) => s + l.qty * l.k.price, 0);
    const list = ls.length
      ? `<ul class="lines">${ls.map((l) => `<li><span>${l.qty} × ${esc(l.k.label)}</span><span class="amt">${inr(l.qty * l.k.price)}</span>
          <small>${esc(l.when)}</small>
          <button type="button" class="linkbtn x" data-rm="${esc(l.key)}">Remove</button></li>`).join('')}</ul>
         <div class="total"><span>Total</span><b>${inr(total)}</b></div>`
      : '<div class="empty"><img src="/assets/svg/mandala.svg" alt="">Pick a night and tap + to add passes.</div>';
    $('#sumBody').innerHTML = list + (ls.length ? `<button class="btn block" id="goDetails" type="button" ${open ? '' : 'disabled'}>Continue</button>
      <p class="note">Passes are held for you while you pay.</p>` : '');
    $('#sumBody2').innerHTML = list.replace(/<button[^>]*data-rm[^>]*>Remove<\/button>/g, '');
    $('#goDetails')?.addEventListener('click', toDetails);
    document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      cart.delete(b.dataset.rm); saveCart(); renderNights(); renderSummary();
    }));
    $('#cbCount').textContent = `${count} pass${count === 1 ? '' : 'es'}${people > count ? ` · ${people} people` : ''}`;
    $('#cbTotal').textContent = inr(total);
    $('#cartbar').classList.toggle('on', count > 0 && !$('#stepPick').hidden);
  }

  $('#cbGo').addEventListener('click', toDetails);
  const PICK_SUB = $('#pageSub').textContent;

  function setStep(n) {
    document.querySelectorAll('#stepper li').forEach((li, i) => {
      li.classList.toggle('on', i === n);
      li.classList.toggle('done', i < n);
    });
  }

  function toDetails() {
    if (!cart.size) return;
    if (!open) { toast('Bookings are closed right now.', 'bad'); return; }
    $('#stepPick').hidden = true;
    $('#stepDetails').hidden = false;
    $('#cartbar').classList.remove('on');
    $('#pageTitle').textContent = 'Your details';
    $('#pageSub').textContent = 'We’ll hold your passes while you pay.';
    setStep(1);
    renderSummary();
    scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('#detailsForm [name=name]').focus({ preventScroll: true }), 300);
  }
  $('#backBtn').addEventListener('click', () => {
    $('#stepPick').hidden = false;
    $('#stepDetails').hidden = true;
    $('#pageTitle').textContent = 'Book your passes';
    $('#pageSub').textContent = PICK_SUB;
    setStep(0);
    renderSummary();
  });

  // remember details on this device
  const form = $('#detailsForm');
  try {
    const saved = JSON.parse(localStorage.getItem('mv_me') || '{}');
    for (const k of ['name', 'phone', 'email']) if (saved[k]) form[k].value = saved[k];
  } catch { /* ignore */ }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#formErr');
    err.classList.remove('on');
    const fail = (msg, field) => {
      err.textContent = msg; err.classList.add('on');
      if (field) { form[field].setAttribute('aria-invalid', 'true'); form[field].focus(); }
    };
    form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    const name = form.name.value.trim(), phone = form.phone.value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    if (name.length < 2) return fail('Please enter your full name.', 'name');
    if (!/^[6-9]\d{9}$/.test(phone)) return fail('Please enter a valid 10-digit mobile number.', 'phone');
    if (form.email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value.trim())) return fail('That email doesn’t look right.', 'email');
    if (!form.terms.checked) return fail('Please accept the terms to continue.', 'terms');
    const btn = $('#reserveBtn');
    busy(btn, true, 'Reserving…');
    try {
      const key = secret();
      const res = await m(fns.public.createBooking, {
        name, phone, email: form.email.value.trim() || undefined, note: form.note.value.trim() || undefined,
        items: [...cart].map(([k, qty]) => {
          const { kind, nightId } = parseKey(k);
          return kind === 'season' ? { kind, qty } : { kind, passId: nightId, qty };
        }), secret: key,
      });
      try { localStorage.setItem('mv_me', JSON.stringify({ name, phone, email: form.email.value.trim() })); } catch { /* ignore */ }
      mine.add({ code: res.code, token: key, amount: res.amount });
      cart.clear(); saveCart();
      location.href = `/ticket?code=${encodeURIComponent(res.code)}&t=${encodeURIComponent(key)}`;
    } catch (ex) {
      busy(btn, false);
      fail(ex.message);
      if (ex.code === 'SOLD_OUT') {
        // availability changed under us: refresh numbers
        toast('Availability changed — updated the list.', 'bad');
        const cat = await q(fns.public.catalogue).catch(() => null);
        if (cat) {
          setCatalogue(cat);
          pruneCart();
          renderNights(); renderSummary();
        }
      }
    }
  });
})();
