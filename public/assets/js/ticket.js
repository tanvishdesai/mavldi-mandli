/* Ticket page: pay → upload proof → wait for verification → e-pass. */
(function () {
  'use strict';
  const { q, m, a, watch, upload, qr, fns, esc, inr, dateLong, when, PASS, toast, mine, statusPill, busy } = window.MV;
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');

  const params = new URLSearchParams(location.search);
  let code = (params.get('code') || '').toUpperCase();
  let token = params.get('t') || '';
  let booking = null, cfg = {}, timer = 0, unwatch = null, shownKey = '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  window.MV.config().then((c) => { cfg = c; if (booking) render(); }).catch(() => {});

  if (code && token) load();
  else lookupView();

  function head(gu, title, sub) {
    $('#headGu').textContent = gu;
    $('#headTitle').textContent = title;
    $('#headSub').textContent = sub || '';
  }

  /* Live: the page changes by itself the moment the team confirms. */
  function load() {
    if (unwatch) unwatch();
    unwatch = watch(fns.public.booking, { code, secret: token }, (b) => {
      if (!b) {
        head('મારો પાસ', 'Booking not found', '');
        view.innerHTML = '<div class="card lookup"><div class="notice bad">We couldn’t find that booking. Check the link, or look it up below.</div></div>';
        lookupView(true);
        return;
      }
      booking = b;
      mine.add({ code, token, amount: b.amount, status: b.status });
      // don't wipe a half-filled upload form just because something minor changed
      const key = [b.status, b.message, b.checkins.length, b.expires_at].join('|');
      if (key !== shownKey) { shownKey = key; render(); }
    }, (e) => toast(e.message, 'bad'));
  }

  function contactHtml() {
    const bits = [];
    if (cfg.contact_whatsapp) bits.push(`<a href="https://wa.me/${esc(cfg.contact_whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent('Hi, about my Mavladi booking ' + code)}" target="_blank" rel="noopener">WhatsApp us</a>`);
    if (cfg.contact_phone) bits.push(`<a href="tel:${esc(cfg.contact_phone)}">${esc(cfg.contact_phone)}</a>`);
    if (cfg.contact_email) bits.push(`<a href="mailto:${esc(cfg.contact_email)}?subject=${encodeURIComponent('Booking ' + code)}">${esc(cfg.contact_email)}</a>`);
    return bits.length ? `<p>Need help? ${bits.join(' · ')}</p>` : '';
  }

  function itemsHtml(b) {
    return `<ul class="itemlist">${b.items.map((i) => `<li><span>${i.qty} × ${esc(PASS)}<small>${esc(dateLong(i.date))}</small></span><b>${inr(i.qty * i.unit_price)}</b></li>`).join('')}</ul>`;
  }

  function render() {
    clearInterval(timer);
    const b = booking;
    $('#stepper').hidden = !['awaiting_payment', 'pending', 'confirmed'].includes(b.status);
    const steps = document.querySelectorAll('#stepper li');
    const at = b.status === 'awaiting_payment' ? 2 : 3;
    steps.forEach((li, i) => { li.classList.toggle('done', i < at || b.status === 'confirmed'); li.classList.toggle('on', i === at && b.status !== 'confirmed'); });

    if (b.status === 'awaiting_payment') return renderPay(b);
    if (b.status === 'pending') {
      head('ચકાસણી ચાલુ છે', 'Verifying your payment', `Booking ${b.code}`);
      view.innerHTML = `<div class="card frame statuscard">
        ${diya()}
        ${statusPill('pending')}
        <h2>Thank you, ${esc(b.name.split(' ')[0])}!</h2>
        <p>We’ve received your payment proof${b.utr ? ` (UTR <b>${esc(b.utr)}</b>)` : ''}. Our team matches every payment by hand — your e-pass appears right here as soon as it’s confirmed, usually within a few hours.</p>
        <p style="font-size:.9rem;color:var(--ink-3)">Keep this page bookmarked, or find it later from “My Pass” with code <b>${esc(b.code)}</b> and your phone number.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          <button class="btn ghost sm" id="copyLink" type="button">Copy link to this page</button>
        </div>
        <p class="muted" style="font-size:.85rem;color:var(--ink-3)">This page updates by itself — no need to refresh.</p>
      </div>
      <div class="card" style="padding:20px 24px"><h3 style="font-family:var(--f-display);font-size:1.3rem;color:var(--maroon-700);margin-bottom:10px">Booking ${esc(b.code)} · ${inr(b.amount)}</h3>${itemsHtml(b)}</div>`;
      $('#copyLink').onclick = copyLink;
      return;
    }
    if (b.status === 'confirmed') return renderPass(b);

    const texts = {
      rejected: ['ચુકવણી મંજૂર નથી', 'We couldn’t verify this payment', 'Your payment proof didn’t match our records.'],
      expired: ['સમય પૂરો', 'This booking expired', 'The payment window closed before we received your proof, so the passes were released.'],
      cancelled: ['રદ', 'This booking was cancelled', ''],
    }[b.status] || ['', b.status, ''];
    head(texts[0], texts[1], `Booking ${b.code}`);
    view.innerHTML = `<div class="card frame statuscard">
      ${statusPill(b.status)}
      <h2>${esc(texts[1])}</h2>
      ${texts[2] ? `<p>${esc(texts[2])}</p>` : ''}
      ${b.message ? `<div class="notice ${b.status === 'rejected' ? 'bad' : 'info'}"><b>Note from the team:</b>&nbsp;${esc(b.message)}</div>` : ''}
      ${b.status === 'expired' ? '<p><b>Already paid?</b> Don’t pay again — contact us with your booking code and screenshot and we’ll sort it out.</p>' : ''}
      ${contactHtml()}
      <a class="btn" href="/book">Book again</a>
    </div>
    <div class="card" style="padding:20px 24px">${itemsHtml(b)}</div>`;
  }

  function diya() {
    return `<svg class="diya-anim" viewBox="0 0 100 100" aria-hidden="true">
      <defs><radialGradient id="dg" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="#ffd27a" stop-opacity=".8"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient></defs>
      <circle cx="50" cy="52" r="46" fill="url(#dg)"/>
      <g class="flame"><path d="M50 18c-10 14-10 24 0 32 10-8 10-18 0-32z" fill="#f5a623"/><path d="M50 30c-5 7-5 12 0 17 5-5 5-10 0-17z" fill="#fff4d0"/></g>
      <path d="M14 58c8 22 64 22 72 0-20 8-52 8-72 0z" fill="#b3121f"/><path d="M14 58c20 8 52 8 72 0" stroke="#d9a54c" stroke-width="3" fill="none"/>
    </svg>`;
  }

  /* ---------------- pay ---------------- */
  function renderPay(b) {
    head('ચુકવણી કરો', 'Complete your payment', `Booking ${b.code} · passes held for you`);
    const pay = b.payment;
    const qrSrc = pay.qr_image || qr(pay.uri);
    view.innerHTML = `
      ${b.message ? `<div class="notice info"><b>Note from the team:</b>&nbsp;${esc(b.message)}</div>` : ''}
      <div class="paygrid">
        <section class="card frame paycard" aria-labelledby="payH">
          <h2 id="payH">1 · Pay by UPI</h2>
          <div class="amountbig">${inr(b.amount)}</div>
          <p style="color:var(--ink-3);font-size:.9rem">to <b style="color:var(--ink)">${esc(pay.payee)}</b></p>
          <p style="margin-top:10px"><span class="timer" id="timer" role="timer">⏳ <span>--:--</span> left to pay</span></p>
          <div class="qrbox"><span class="corner c1"></span><span class="corner c2"></span><span class="corner c3"></span><span class="corner c4"></span>
            <img src="${esc(qrSrc)}" alt="UPI QR code to pay ${inr(b.amount)}" width="260" height="260"></div>
          <p style="font-size:.88rem;color:var(--ink-2)">${pay.qr_image ? `Scan with any UPI app and enter <b>${inr(b.amount)}</b>` : 'Scan with any UPI app — the amount is filled in for you'}</p>
          <div class="upi"><code id="upiId">${esc(pay.upi_id)}</code><button class="btn sm" type="button" id="copyUpi">Copy</button></div>
          ${isMobile ? `<a class="btn gold block" style="margin-top:14px" href="${esc(pay.uri)}">Open UPI app to pay</a>` : ''}
          <div class="apps" aria-label="Works with"><span>GPay</span><span>PhonePe</span><span>Paytm</span><span>BHIM</span><span>any UPI app</span></div>
          <p style="margin-top:14px;font-size:.84rem;color:var(--ink-3)">Add <b>${esc(b.code)}</b> in the payment note if your app asks.</p>
        </section>

        <section class="card frame upcard" aria-labelledby="upH">
          <h2 id="upH">2 · Upload payment proof</h2>
          <ol class="steps-mini">
            <li>After paying, take a <b>screenshot</b> of the success screen.</li>
            <li>Copy the <b>UTR / UPI Ref. No.</b> (12 digits) from it.</li>
            <li>Upload both here — we’ll verify and confirm your pass.</li>
          </ol>
          <form id="payForm" novalidate>
            <label class="drop" id="drop">
              <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" required aria-label="Payment screenshot">
              <span class="ph" id="dropBody">
                <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
                <span><b>Tap to add screenshot</b><br><small>JPG, PNG or WebP · up to 8 MB</small></span>
              </span>
            </label>
            <label class="field"><span>UTR / Transaction ID</span>
              <input name="utr" inputmode="text" autocomplete="off" maxlength="35" placeholder="e.g. 412345678901" required></label>
            <div class="notice bad formerr" id="payErr" role="alert" style="margin-top:14px"></div>
            <button class="btn block" style="margin-top:16px" id="sendBtn" type="submit">Submit for verification</button>
          </form>
          <details style="margin-top:18px;font-size:.9rem;color:var(--ink-2)"><summary style="cursor:pointer">Where do I find the UTR?</summary>
            <p style="margin-top:8px">${esc(pay.instructions || '')}</p>
            <p style="margin-top:8px"><b>GPay:</b> open the payment → “UPI transaction ID”. <b>PhonePe:</b> History → payment → “UTR”. <b>Paytm:</b> the payment → “UPI Ref No”.</p></details>
        </section>
      </div>
      <div class="card" style="padding:20px 24px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <h3 style="font-family:var(--f-display);font-size:1.3rem;color:var(--maroon-700)">Booking ${esc(b.code)}</h3>${statusPill(b.status)}</div>
        ${itemsHtml(b)}
        <div class="total"><span>Total</span><b>${inr(b.amount)}</b></div>
        <p style="margin-top:14px;font-size:.88rem"><button class="linkbtn" id="cancelBtn" type="button">Cancel this booking</button> <span style="color:var(--ink-3)">— only if you haven’t paid.</span></p>
      </div>`;

    // countdown
    const tick = () => {
      const ms = new Date(b.expires_at) - Date.now();
      const el = $('#timer');
      if (!el) return;
      if (ms <= 0) { clearInterval(timer); el.querySelector('span').textContent = '0:00'; return; }
      const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
      const h = Math.floor(m / 60);
      el.querySelector('span').textContent = h ? `${h}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`;
      el.classList.toggle('low', ms < 5 * 60000);
    };
    tick(); timer = setInterval(tick, 1000);

    $('#copyUpi').onclick = () => copy(pay.upi_id, 'UPI ID copied');
    $('#cancelBtn').onclick = async () => {
      if (!confirm('Cancel this booking and release the passes? Do this only if you have NOT paid.')) return;
      try { await m(fns.public.cancelBooking, { code, secret: token }); }
      catch (e) { toast(e.message, 'bad'); }
    };

    const form = $('#payForm'), drop = $('#drop'), input = form.screenshot;
    const showFile = () => {
      const f = input.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      drop.classList.add('has');
      $('#dropBody').innerHTML = `<img src="${url}" alt="Selected screenshot"><span><b>${esc(f.name)}</b><br><small>${(f.size / 1024 / 1024).toFixed(1)} MB · tap to change</small></span>`;
    };
    input.addEventListener('change', showFile);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; showFile(); } });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#payErr');
      err.classList.remove('on');
      const fail = (m) => { err.textContent = m; err.classList.add('on'); };
      const f = input.files[0];
      const utr = form.utr.value.replace(/[\s-]/g, '');
      if (!f) return fail('Please add the payment screenshot.');
      if (f.size > 8 * 1024 * 1024) return fail('That image is too large (max 8 MB).');
      if (!/^[A-Za-z0-9]{6,35}$/.test(utr)) { form.utr.focus(); return fail('Enter the UTR / transaction ID from your payment app (usually 12 digits).'); }
      const btn = $('#sendBtn');
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return fail('Please upload a JPG, PNG or WebP image (HEIC photos: take a screenshot instead).');
      busy(btn, true, 'Uploading…');
      try {
        const url = await m(fns.public.uploadUrl, { code, secret: token });
        const storageId = await upload(url, f);
        const res = await a(fns.public.submitPayment, { code, secret: token, utr, storageId });
        if (res.error) { busy(btn, false); fail(res.error); return; }
        toast('Payment proof received 🙏', 'ok');
        scrollTo({ top: 0, behavior: 'smooth' });
      } catch (ex) {
        busy(btn, false);
        fail(ex.message);
      }
    });
  }

  /* ---------------- the e-pass ---------------- */
  function renderPass(b) {
    head('જય માતાજી', 'Your pass is confirmed', 'Show this QR code at the gate.');
    const nights = new Set(b.items.map((i) => i.date));
    view.innerHTML = `
      <article class="pass" aria-label="E-pass ${esc(b.code)}">
        <div class="ph">
          <img src="/assets/img/logo.webp" alt="Mavladi">
          <p class="ev">${esc(cfg.site_name_gu || 'માવલડી મંડળી')} · ${esc(cfg.event_title || 'Navratri')}</p>
          <span class="adm">Admit ${b.admits}</span>
          <div class="toran gold" aria-hidden="true"></div>
        </div>
        ${b.checkins && b.checkins.length ? `<span class="stamp">IN · ${b.checkins.length}×</span>` : ''}
        <div class="bd">
          <div class="who"><div><small>Guest</small><b>${esc(b.name)}</b></div><div style="text-align:right"><small>Booking</small><div class="code">${esc(b.code)}</div></div></div>
          ${itemsHtml(b)}
          <div class="perf" aria-hidden="true"></div>
          <div class="qr"><img src="${esc(qr(`${location.origin}/admin/#checkin/${b.code}`, { ec: 'Q' }))}" alt="Entry QR code for booking ${esc(b.code)}" width="230" height="230"></div>
        </div>
        <p class="foot">Verified ${esc(when(b.verified_at))}${nights.size ? ` · valid for ${nights.size} night${nights.size > 1 ? 's' : ''}` : ''}<br>Non-transferable · traditional attire please</p>
      </article>
      <div class="noprint" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn" type="button" id="printBtn">Save / print pass</button>
        <button class="btn ghost" type="button" id="copyLink">Copy pass link</button>
      </div>
      <div class="noprint" style="text-align:center;color:var(--ink-3);font-size:.9rem">Tip: take a screenshot of this pass so you have it even without signal at the ground.</div>`;
    $('#copyLink').onclick = copyLink;
    $('#printBtn').onclick = () => print();
  }

  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast(msg, 'ok'))
      .catch(() => { prompt('Copy this:', text); });
  }
  function copyLink() { copy(location.href, 'Link copied'); }

  /* ---------------- find my booking ---------------- */
  function lookupView(append) {
    head('મારો પાસ', 'Find your booking', 'Enter your booking code and the mobile number you booked with.');
    const saved = mine.list();
    const html = `
      <form class="card frame lookup" id="lookForm" novalidate>
        <div class="stack">
          <label class="field"><span>Booking code</span><input name="code" autocapitalize="characters" autocomplete="off" placeholder="MVXXXXXXXX" required maxlength="12" value="${esc(code)}"></label>
          <label class="field"><span>Mobile number</span><input name="phone" type="tel" inputmode="numeric" placeholder="10-digit mobile" required maxlength="14"></label>
          <div class="notice bad formerr" id="lookErr" role="alert"></div>
          <button class="btn block" id="lookBtn" type="submit">Find my pass</button>
        </div>
      </form>
      ${saved.length ? `<div class="mylist"><p style="font-weight:600;color:var(--ink-2)">Booked on this device</p>
        ${saved.map((s) => `<a class="card" href="/ticket?code=${encodeURIComponent(s.code)}&t=${encodeURIComponent(s.token)}"><span><b style="font-family:ui-monospace,monospace">${esc(s.code)}</b><br><small style="color:var(--ink-3)">${s.amount != null ? inr(s.amount) + ' · ' : ''}${new Date(s.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></span>${s.status ? statusPill(s.status) : '<span>→</span>'}</a>`).join('')}</div>` : ''}`;
    if (append) view.insertAdjacentHTML('beforeend', html); else view.innerHTML = html;
    $('#lookForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, err = $('#lookErr');
      err.classList.remove('on');
      const btn = $('#lookBtn');
      busy(btn, true, 'Looking…');
      try {
        const r = await a(fns.public.lookup, { code: f.code.value.trim(), phone: f.phone.value });
        location.href = `/ticket?code=${encodeURIComponent(r.code)}&t=${encodeURIComponent(r.secret)}`;
      } catch (ex) {
        busy(btn, false);
        err.textContent = ex.message; err.classList.add('on');
      }
    });
  }
})();
