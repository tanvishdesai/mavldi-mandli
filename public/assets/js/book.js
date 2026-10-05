/* Booking: pick passes → details → reserve (then the ticket page takes payment). */
(function () {
  'use strict';
  const { q, m, fns, secret, esc, inr, dateLong, dateParts, NAVDURGA, toast, mine, busy } = window.MV;
  const $ = (s, r = document) => r.querySelector(s);

  const params = new URLSearchParams(location.search);
  const CART_KEY = 'mv_cart';
  let venues = [];
  let venueId = null;
  let open = true;
  const byId = new Map();          // passId -> { p, v }
  const cart = new Map();          // passId -> qty
  const nightIndex = new Map();    // date -> 0..8

  try { for (const [k, n] of JSON.parse(sessionStorage.getItem(CART_KEY) || '[]')) cart.set(String(k), +n); } catch { /* ignore */ }
  const saveCart = () => { try { sessionStorage.setItem(CART_KEY, JSON.stringify([...cart])); } catch { /* ignore */ } };

  init();

  async function init() {
    try {
      const [cfg, cat] = await Promise.all([window.MV.config(), q(fns.public.catalogue)]);
      open = cfg.booking_open === '1';
      $('#closedNote').hidden = open;
      if (cfg.terms_text) $('#termsText').textContent = `I have read and agree: ${cfg.terms_text}`;
      venues = cat.venues;
    } catch (e) {
      $('#passArea').innerHTML = `<div class="notice bad">${esc(e.message)} <button class="linkbtn" id="retryBtn" type="button">Retry</button></div>`;
      $('#retryBtn').addEventListener('click', () => location.reload());
      return;
    }
    const dates = [...new Set(venues.flatMap((v) => v.passes.map((p) => p.date)).filter(Boolean))].sort();
    dates.forEach((d, i) => nightIndex.set(d, i));
    for (const v of venues) for (const p of v.passes) byId.set(p.id, { p, v });
    // drop anything from an old cart that is no longer on sale
    for (const [id, q] of cart) {
      const e = byId.get(id);
      if (!e || !e.p.bookable) cart.delete(id);
      else if (q > Math.min(e.p.available, e.p.max_per_booking)) cart.set(id, Math.min(e.p.available, e.p.max_per_booking));
    }
    saveCart();

    if (!venues.length) {
      $('#passArea').innerHTML = '<div class="notice info">Venues will be announced soon. Please check back.</div>';
      renderSummary();
      return;
    }
    const want = params.get('venue');
    venueId = venues.some((v) => v.id === want) ? want : venues[0].id;
    // a date link from the home page: pick the first venue that has it
    const wantDate = params.get('date');
    if (wantDate && !want) {
      const v = venues.find((x) => x.passes.some((p) => p.date === wantDate && p.bookable));
      if (v) venueId = v.id;
    }
    renderVenues();
    renderPasses();
    renderSummary();
    if (wantDate) {
      const card = document.querySelector(`[data-date="${CSS.escape(wantDate)}"]`);
      if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('flash'); }
    }
  }

  function renderVenues() {
    const box = $('#venuePick');
    box.hidden = venues.length < 2;
    box.innerHTML = venues.map((v) => {
      const n = v.passes.reduce((s, p) => s + (cart.get(p.id) || 0), 0);
      return `<button type="button" class="vopt" data-v="${esc(v.id)}" aria-pressed="${v.id === venueId}">
        ${v.image ? `<img src="${esc(v.image)}" alt="">` : ''}
        <span><b>${esc(v.name)}</b><small>${esc([v.name_gu, v.city].filter(Boolean).join(' · '))}</small></span>
        <span class="n ${n ? 'on' : ''}" aria-label="${n} selected">${n}</span></button>`;
    }).join('');
    box.querySelectorAll('.vopt').forEach((b) => b.addEventListener('click', () => {
      venueId = b.dataset.v;
      renderVenues();
      renderPasses();
    }));
    const v = venues.find((x) => x.id === venueId);
    $('#venueInfo').innerHTML = [
      v.address && `<span>📍 ${esc(v.address)}</span>`,
      v.start_time && `<span>🕗 ${esc(v.start_time)}</span>`,
      v.map_url && `<a href="${esc(v.map_url)}" target="_blank" rel="noopener">Open in Maps ↗</a>`,
    ].filter(Boolean).join('');
  }

  function passRow(p) {
    const q = cart.get(p.id) || 0;
    const max = Math.min(p.available, p.max_per_booking);
    let avail = '';
    if (p.past) avail = '<span class="gone">Over</span>';
    else if (!p.available) avail = '<span class="gone">Sold out</span>';
    else if (p.available <= 25) avail = `<span class="left">Only ${p.available} left</span>`;
    const sub = [p.admits > 1 ? `admits ${p.admits}` : '', p.date ? '' : p.description || ''].filter(Boolean).join(' · ');
    return `<div class="prow">
      <div class="pl"><b>${esc(p.label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${avail ? `<small>${avail}</small>` : ''}</div>
      <span class="pr">${inr(p.price)}</span>
      <div class="qty ${q ? 'has' : ''}" role="group" aria-label="${esc(p.label)} quantity">
        <button type="button" data-d="-1" data-p="${esc(p.id)}" aria-label="One less" ${q ? '' : 'disabled'}>−</button>
        <output aria-live="polite">${q}</output>
        <button type="button" data-d="1" data-p="${esc(p.id)}" aria-label="One more" ${p.bookable && q < max ? '' : 'disabled'}>+</button>
      </div></div>`;
  }

  function renderPasses() {
    const v = venues.find((x) => x.id === venueId);
    const season = v.passes.filter((p) => !p.date);
    const groups = new Map();
    for (const p of v.passes.filter((p) => p.date)) {
      if (!groups.has(p.date)) groups.set(p.date, []);
      groups.get(p.date).push(p);
    }
    let html = '';
    if (season.length) {
      html += `<div class="sec-title"><h2>Season pass</h2><span>every night of Navratri</span></div>
        <div class="nightgrid"><article class="ncard season ${season.some((p) => cart.get(p.id)) ? 'has' : ''}">
          <div class="top"><div class="cal"><i>All</i><b>9</b><s>nights</s></div>
          <div class="ttl"><b>All nine nights</b><span class="gu">નવેનવ રાત</span></div></div>
          ${season.map(passRow).join('')}</article></div>`;
    }
    if (groups.size) {
      html += `<div class="sec-title"><h2>Daily passes</h2><span>${groups.size} night${groups.size > 1 ? 's' : ''}</span></div><div class="nightgrid">`;
      for (const [d, ps] of groups) {
        const dp = dateParts(d);
        const i = nightIndex.get(d);
        const [en, gu] = NAVDURGA[(i ?? 0) % 9];
        const past = ps.every((p) => p.past);
        const out = !past && ps.every((p) => !p.available);
        html += `<article class="ncard ${ps.some((p) => cart.get(p.id)) ? 'has' : ''} ${past || out ? 'off' : ''}" data-date="${d}">
          ${past ? '<span class="ribbon">Over</span>' : out ? '<span class="ribbon">Sold out</span>' : ''}
          <div class="top"><div class="cal"><i>${dp.wd}</i><b>${dp.d}</b><s>${dp.m}</s></div>
          <div class="ttl"><b>Night ${i + 1} · ${esc(en)}</b><span class="gu">${gu}</span><small>${esc(dateLong(d))}</small></div></div>
          ${ps.map(passRow).join('')}</article>`;
      }
      html += '</div>';
    }
    if (!html) html = '<div class="notice info">No passes are on sale for this venue yet.</div>';
    $('#passArea').innerHTML = html;
  }

  $('#passArea').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    const id = b.dataset.p;
    const { p } = byId.get(id);
    const n = Math.max(0, Math.min((cart.get(id) || 0) + +b.dataset.d, Math.min(p.available, p.max_per_booking)));
    if (n) cart.set(id, n); else cart.delete(id);
    saveCart();
    // re-render just this card to keep focus steady
    const focusSel = `button[data-p="${CSS.escape(id)}"][data-d="${b.dataset.d}"]`;
    renderPasses();
    renderVenues();
    const again = document.querySelector(focusSel);
    if (again && !again.disabled) again.focus();
    else document.querySelector(`button[data-p="${CSS.escape(id)}"]:not(:disabled)`)?.focus();
    renderSummary();
  });

  function lines() {
    return [...cart].map(([id, q]) => ({ ...byId.get(id), q })).filter((l) => l.p);
  }

  function renderSummary() {
    const ls = lines();
    const total = ls.reduce((s, l) => s + l.p.price * l.q, 0);
    const count = ls.reduce((s, l) => s + l.q, 0);
    const list = ls.length
      ? `<ul class="lines">${ls.map((l) => `<li><span>${l.q} × ${esc(l.p.label)}</span><span class="amt">${inr(l.p.price * l.q)}</span>
          <small>${esc(l.p.date ? dateLong(l.p.date) : 'All nine nights')} · ${esc(l.v.name)}</small>
          <button type="button" class="linkbtn x" data-rm="${esc(l.p.id)}">Remove</button></li>`).join('')}</ul>
         <div class="total"><span>Total</span><b>${inr(total)}</b></div>`
      : '<div class="empty"><img src="/assets/svg/mandala.svg" alt="">Pick a night and tap + to add passes.</div>';
    $('#sumBody').innerHTML = list + (ls.length ? `<button class="btn block" id="goDetails" type="button" ${open ? '' : 'disabled'}>Continue</button>
      <p class="note">Passes are held for you while you pay.</p>` : '');
    $('#sumBody2').innerHTML = list.replace(/<button[^>]*data-rm[^>]*>Remove<\/button>/g, '');
    $('#goDetails')?.addEventListener('click', toDetails);
    document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      cart.delete(b.dataset.rm); saveCart(); renderPasses(); renderVenues(); renderSummary();
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
    $('#pageSub').textContent = 'Pick a ground, choose your nights, and pay by UPI.';
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
        if (cat) { venues = cat.venues; byId.clear(); for (const v of venues) for (const p of v.passes) byId.set(p.id, { p, v }); renderPasses(); renderSummary(); }
      }
    }
  });
})();
