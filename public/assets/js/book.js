/* Booking: pick nights → details → reserve (then the ticket page takes payment).
   One ground, one kind of pass, one price — the only choice is which nights and
   how many passes for each. */
(function () {
  'use strict';
  const { q, m, fns, secret, esc, inr, dateLong, dateParts, PASS, NAVDURGA, toast, mine, busy } = window.MV;
  const $ = (s, r = document) => r.querySelector(s);

  const params = new URLSearchParams(location.search);
  const CART_KEY = 'mv_cart';
  let nights = [];
  let price = 0;
  let maxTotal = 20;
  let open = true;
  const byId = new Map();          // nightId -> night
  const cart = new Map();          // nightId -> qty

  try { for (const [k, n] of JSON.parse(sessionStorage.getItem(CART_KEY) || '[]')) cart.set(String(k), +n); } catch { /* ignore */ }
  const saveCart = () => { try { sessionStorage.setItem(CART_KEY, JSON.stringify([...cart])); } catch { /* ignore */ } };

  init();

  async function init() {
    let cfg;
    try {
      const [c, cat] = await Promise.all([window.MV.config(), q(fns.public.catalogue)]);
      cfg = c;
      open = cat.booking_open;
      price = cat.price;
      nights = cat.nights;
    } catch (e) {
      $('#passArea').innerHTML = `<div class="notice bad">${esc(e.message)} <button class="linkbtn" id="retryBtn" type="button">Retry</button></div>`;
      $('#retryBtn').addEventListener('click', () => location.reload());
      return;
    }
    maxTotal = Math.max(1, parseInt(cfg.max_items_per_booking, 10) || 20);
    $('#closedNote').hidden = open;
    $('#priceLine').textContent = `${inr(price)} per person, per night`;
    if (cfg.terms_text) $('#termsText').textContent = `I have read and agree: ${cfg.terms_text}`;
    $('#groundInfo').innerHTML = [
      cfg.venue_address && `<span>📍 ${esc(cfg.venue_address)}</span>`,
      cfg.event_time_text && `<span>🕗 ${esc(cfg.event_time_text)}</span>`,
      cfg.venue_map_url && `<a href="${esc(cfg.venue_map_url)}" target="_blank" rel="noopener">Open in Maps ↗</a>`,
    ].filter(Boolean).join('');

    for (const n of nights) byId.set(n.id, n);
    // drop anything from an old cart that is no longer on sale
    for (const [id, qty] of cart) {
      const n = byId.get(id);
      if (!n || !n.bookable) cart.delete(id);
      else if (qty > n.available) cart.set(id, n.available);
    }
    saveCart();

    if (!nights.length) {
      $('#passArea').innerHTML = '<div class="notice info">The dates will be announced soon. Please check back.</div>';
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

  /* How many passes this booking may still hold for one night: what's left of
     that night's stock, bounded by the per-booking maximum overall. */
  const totalQty = () => [...cart.values()].reduce((a, b) => a + b, 0);
  const roomFor = (id) => Math.min(byId.get(id).available, (cart.get(id) || 0) + Math.max(0, maxTotal - totalQty()));

  function nightCard(n, i) {
    const qty = cart.get(n.id) || 0;
    const dp = dateParts(n.date);
    const [en, gu] = NAVDURGA[i % 9];
    const max = roomFor(n.id);
    let avail = '';
    if (n.past) avail = '<span class="gone">Over</span>';
    else if (!n.available) avail = '<span class="gone">Sold out</span>';
    else if (n.available <= 25) avail = `<span class="left">Only ${n.available} left</span>`;
    return `<article class="ncard ${qty ? 'has' : ''} ${n.past || !n.available ? 'off' : ''}" data-date="${esc(n.date)}">
      ${n.past ? '<span class="ribbon">Over</span>' : !n.available ? '<span class="ribbon">Sold out</span>' : ''}
      <div class="top"><div class="cal"><i>${esc(dp.wd)}</i><b>${esc(dp.d)}</b><s>${esc(dp.m)}</s></div>
      <div class="ttl"><b>Night ${i + 1} · ${esc(en)}</b><span class="gu">${gu}</span><small>${esc(dateLong(n.date))}</small></div></div>
      <div class="prow">
        <div class="pl"><b>${esc(PASS)}</b><small>admits one person</small>${avail ? `<small>${avail}</small>` : ''}</div>
        <span class="pr">${inr(price)}</span>
        <div class="qty ${qty ? 'has' : ''}" role="group" aria-label="Passes for ${esc(dateLong(n.date))}">
          <button type="button" data-d="-1" data-p="${esc(n.id)}" aria-label="One less" ${qty ? '' : 'disabled'}>−</button>
          <output aria-live="polite">${qty}</output>
          <button type="button" data-d="1" data-p="${esc(n.id)}" aria-label="One more" ${n.bookable && qty < max ? '' : 'disabled'}>+</button>
        </div></div></article>`;
  }

  function renderNights() {
    $('#passArea').innerHTML = `<div class="sec-title"><h2>Pick your nights</h2><span>${nights.length} night${nights.length > 1 ? 's' : ''} · ${inr(price)} each</span></div>
      <div class="nightgrid">${nights.map(nightCard).join('')}</div>`;
  }

  $('#passArea').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    const id = b.dataset.p;
    const want = (cart.get(id) || 0) + +b.dataset.d;
    const n = Math.max(0, Math.min(want, roomFor(id)));
    if (want > n) {
      toast(want > byId.get(id).available
        ? `Only ${byId.get(id).available} left for that night.`
        : `You can book at most ${maxTotal} passes at a time.`, 'bad');
    }
    if (n) cart.set(id, n); else cart.delete(id);
    saveCart();
    // re-render, then put focus back where the finger was
    const focusSel = `button[data-p="${CSS.escape(id)}"][data-d="${b.dataset.d}"]`;
    renderNights();
    const again = document.querySelector(focusSel);
    if (again && !again.disabled) again.focus();
    else document.querySelector(`button[data-p="${CSS.escape(id)}"]:not(:disabled)`)?.focus();
    renderSummary();
  });

  const lines = () => [...cart]
    .map(([id, qty]) => ({ n: byId.get(id), qty }))
    .filter((l) => l.n)
    .sort((a, b) => a.n.date.localeCompare(b.n.date));

  function renderSummary() {
    const ls = lines();
    const count = ls.reduce((s, l) => s + l.qty, 0);
    const total = count * price;
    const list = ls.length
      ? `<ul class="lines">${ls.map((l) => `<li><span>${l.qty} × ${esc(PASS)}</span><span class="amt">${inr(l.qty * price)}</span>
          <small>${esc(dateLong(l.n.date))}</small>
          <button type="button" class="linkbtn x" data-rm="${esc(l.n.id)}">Remove</button></li>`).join('')}</ul>
         <div class="total"><span>Total</span><b>${inr(total)}</b></div>`
      : '<div class="empty"><img src="/assets/svg/mandala.svg" alt="">Pick a night and tap + to add passes.</div>';
    $('#sumBody').innerHTML = list + (ls.length ? `<button class="btn block" id="goDetails" type="button" ${open ? '' : 'disabled'}>Continue</button>
      <p class="note">Passes are held for you while you pay.</p>` : '');
    $('#sumBody2').innerHTML = list.replace(/<button[^>]*data-rm[^>]*>Remove<\/button>/g, '');
    $('#goDetails')?.addEventListener('click', toDetails);
    document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      cart.delete(b.dataset.rm); saveCart(); renderNights(); renderSummary();
    }));
    $('#cbCount').textContent = `${count} pass${count === 1 ? '' : 'es'}`;
    $('#cbTotal').textContent = inr(total);
    $('#cartbar').classList.toggle('on', count > 0 && !$('#stepPick').hidden);
  }

  $('#cbGo').addEventListener('click', toDetails);

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
    $('#pageSub').innerHTML = `One pass, <b>${esc(inr(price))} per person, per night</b>. Choose your nights and pay by UPI.`;
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
        items: [...cart].map(([passId, qty]) => ({ passId, qty })), secret: key,
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
          nights = cat.nights; price = cat.price;
          byId.clear();
          for (const n of nights) byId.set(n.id, n);
          renderNights(); renderSummary();
        }
      }
    }
  });
})();
