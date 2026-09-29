/* ==========================================================================
   Mavladi — the walk through the gate
   Scroll drives a virtual camera down one corridor of world space: through
   the entry gate, along the yatra of banners, lanterns and diyas, then up
   over the garba ring for the drone's-eye view. Content sections stand on
   the path and rise out of the vanishing point as the camera reaches them.
   (Technique after the mandligarba.co.in "walk into the woods".)
   ========================================================================== */
(function () {
  'use strict';

  const { api, esc, inr, dateParts, NAVDURGA } = window.MV;
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* =================== content =================== */
  let catalogue = [];
  loadContent();

  async function loadContent() {
    const [cfg, cat, faqs] = await Promise.all([
      window.MV.config().catch(() => null),
      api('/api/venues').catch(() => null),
      api('/api/faqs').catch(() => []),
    ]);
    if (cfg) {
      document.querySelectorAll('[data-cfg]').forEach((el) => {
        const v = cfg[el.dataset.cfg];
        if (v) el.textContent = v;
      });
      const bits = [];
      if (cfg.contact_phone) bits.push(`<a href="tel:${esc(cfg.contact_phone)}">${esc(cfg.contact_phone)}</a>`);
      if (cfg.contact_whatsapp) bits.push(`<a href="https://wa.me/${esc(cfg.contact_whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>`);
      if (cfg.contact_email) bits.push(`<a href="mailto:${esc(cfg.contact_email)}">${esc(cfg.contact_email)}</a>`);
      if (cfg.instagram_url) bits.push(`<a href="${esc(cfg.instagram_url)}" target="_blank" rel="noopener">Instagram</a>`);
      if (cfg.youtube_url) bits.push(`<a href="${esc(cfg.youtube_url)}" target="_blank" rel="noopener">YouTube</a>`);
      $('#contactLine').innerHTML = bits.join('<span aria-hidden="true">·</span>');
    }
    catalogue = cat ? cat.venues : [];
    renderNights();
    renderVenues(cat);
    $('#faqList').innerHTML = faqs.map((f) =>
      `<details class="qa"><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('');
    // one answer open at a time keeps the panel from outgrowing the screen
    $('#faqList').addEventListener('toggle', (e) => {
      if (e.target.open) $('#faqList').querySelectorAll('details[open]').forEach((d) => { if (d !== e.target) d.open = false; });
      requestLayout();
    }, true);
    requestLayout();
  }

  function renderNights() {
    const dates = [...new Set(catalogue.flatMap((v) => v.passes.map((p) => p.date)).filter(Boolean))].sort();
    const list = dates.length ? dates.slice(0, 9) : ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'];
    $('#nightList').innerHTML = list.map((d, i) => {
      const [en, gu] = NAVDURGA[i % 9];
      const p = dateParts(d);
      return `<a class="night" href="/book?date=${d}" aria-label="Night ${i + 1}, ${en}, ${p.wd} ${p.d} ${p.m}">
        <span class="n">${i + 1}</span><span class="g">${gu}</span><span class="e">${en}</span>
        <span class="d">${p.d} ${p.m}</span></a>`;
    }).join('');
    $('#nightList').querySelectorAll('.night').forEach((a) => { a.style.textDecoration = 'none'; });
    $('#f-venues').textContent = catalogue.length || '—';
  }

  function renderVenues(cat) {
    const box = $('#venueList');
    if (!cat) { box.innerHTML = '<p class="lede">Couldn’t load venues just now. <a href="/book" style="color:var(--marigold)">Open the booking page</a>.</p>'; return; }
    if (!catalogue.length) { box.innerHTML = '<p class="lede">Venues will be announced soon. Jay Mataji!</p>'; return; }
    box.innerHTML = catalogue.map((v) => {
      const sale = v.passes.filter((p) => !p.past);
      const bookable = sale.filter((p) => p.bookable);
      const from = bookable.length ? Math.min(...bookable.map((p) => p.price)) : null;
      const qty = sale.reduce((s, p) => s + p.quantity, 0);
      const left = sale.reduce((s, p) => s + p.available, 0);
      const pct = qty ? Math.round((left / qty) * 100) : 0;
      const dated = sale.map((p) => p.date).filter(Boolean).sort();
      const range = dated.length ? `${dateParts(dated[0]).d} ${dateParts(dated[0]).m} – ${dateParts(dated[dated.length - 1]).d} ${dateParts(dated[dated.length - 1]).m}` : '';
      const availLabel = !qty ? 'Passes coming soon' : left === 0 ? 'Sold out' : pct < 25 ? `Filling fast — only ${pct}% left` : pct < 60 ? `${pct}% of passes left` : 'Plenty of passes available';
      return `<article class="venue">
        <div class="ph">${v.image ? `<img src="${esc(v.image)}" alt="" loading="lazy">` : ''}
          ${from != null ? `<span class="from">from <b>${inr(from)}</b></span>` : ''}</div>
        <div class="bd">
          <h3>${esc(v.name)}</h3>
          ${v.name_gu ? `<p class="gu">${esc(v.name_gu)}</p>` : ''}
          <p class="meta">${range ? `<span>📅 ${esc(range)}</span>` : ''}${v.start_time ? `<span>🕗 ${esc(v.start_time)}</span>` : ''}${v.city ? `<span>📍 ${esc(v.city)}</span>` : ''}</p>
          ${v.description ? `<p class="desc">${esc(v.description)}</p>` : ''}
          <div class="avail" aria-hidden="true"><i style="width:${pct}%"></i></div>
          <p class="avail-l">${availLabel}</p>
          <div class="act">
            <a class="btn sm" href="/book?venue=${v.id}">${bookable.length ? 'Book here' : 'See passes'}</a>
            ${v.map_url ? `<a class="btn ghost sm" href="${esc(v.map_url)}" target="_blank" rel="noopener">Map</a>` : ''}
          </div>
        </div>
      </article>`;
    }).join('');
    box.querySelectorAll('img').forEach((img) => img.addEventListener('load', requestLayout, { once: true }));
  }

  /* =================== scene =================== */
  const stage = $('#stage');
  const cv = $('#world');
  const gate = $('#gate');
  const gateImg = gate.querySelector('img');
  const hero = $('#hero');
  const spacer = $('#spacer');
  const rail = $('#rail');
  const dock = $('#dock');
  const embersCv = $('#embers');
  let ctx = null, ectx = null;
  try { ctx = cv.getContext('2d'); ectx = embersCv.getContext('2d'); } catch { /* scene is decoration */ }

  const motionMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let calm = motionMQ.matches;
  motionMQ.addEventListener?.('change', (e) => { calm = e.matches; dirty = true; });

  const shortSide = Math.min(innerWidth, innerHeight);
  const lean = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 8) <= 4 || shortSide < 700;

  /* world units; the floor is GY below the eye */
  const GY = 170, FAR = 5600, NEAR = 60;
  const PX = 0.7;                  // scroll px per world unit
  const GD = 1000;                 // the gate stands this far ahead at the start
  const GATE_OUT = [380, 900];     // the gate dissolves as we step through it
  const HERO_OUT = [30, 480];
  const RISE_H = 1500, RISE_PITCH = 1.0, RISE_LEN = 2600;

  let vw = 0, vh = 0, dpr = 1, F = 800, cx = 0, vy = 0;
  let Z_END = 10000, RISE0 = 8000, RISE1 = 10600, RC_Z = 11700;
  let camZ = -1, target = 0, dirty = true, t0 = performance.now();

  /* ---------- sprites ---------- */
  function sprite(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    draw(c.getContext('2d'), c.width, c.height);
    return c;
  }
  function glowSprite(rgb, core = 0.18) {
    return sprite(64, 64, (g, w) => {
      const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      r.addColorStop(0, `rgba(255,250,230,1)`);
      r.addColorStop(core, `rgba(${rgb},0.95)`);
      r.addColorStop(0.45, `rgba(${rgb},0.28)`);
      r.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = r; g.fillRect(0, 0, w, w);
    });
  }
  const GLOW = glowSprite('255,170,70');
  const GLOW_RED = glowSprite('255,90,60', 0.1);
  const BULB = glowSprite('255,214,140', 0.12);
  const DANCER_COLORS = ['226,35,47', '245,179,53', '232,137,28', '47,122,79', '231,84,128', '64,120,200', '255,236,200', '190,40,120'];
  const DANCERS = DANCER_COLORS.map((c) => sprite(24, 24, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, `rgba(${c},1)`); r.addColorStop(0.45, `rgba(${c},0.95)`); r.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  }));

  const BANNER_W = 190, BANNER_H = 600; // world units, plinth included
  const WORDS = [
    ['મમતા', 'lotus'], ['શક્તિ', 'trishul'], ['ભક્તિ', 'diya'], ['આનંદ', 'dandiya'],
    ['ઉત્સવ', 'kalash'], ['પરંપરા', 'mandala'], ['શ્રદ્ધા', 'diya'], ['રંગ', 'lotus'], ['તાલ', 'dandiya'],
  ];
  let BANNERS = [];
  let LANTERN = null;
  let MANDALA = null;

  function drawIcon(g, kind, x, y, s) {
    g.save();
    g.translate(x, y); g.scale(s / 100, s / 100);
    g.strokeStyle = '#f3cf86'; g.fillStyle = '#f3cf86'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (kind === 'trishul') {
      g.moveTo(0, 50); g.lineTo(0, -46);
      g.moveTo(-30, -40); g.quadraticCurveTo(-30, -6, 0, -4); g.quadraticCurveTo(30, -6, 30, -40);
      g.stroke();
      g.beginPath(); g.moveTo(0, -58); g.lineTo(-7, -42); g.lineTo(7, -42); g.closePath();
      g.moveTo(-30, -52); g.lineTo(-36, -38); g.lineTo(-24, -38); g.closePath();
      g.moveTo(30, -52); g.lineTo(24, -38); g.lineTo(36, -38); g.closePath(); g.fill();
      g.beginPath(); g.arc(0, 16, 7, 0, Math.PI * 2); g.stroke();
    } else if (kind === 'diya') {
      g.moveTo(-42, 10); g.quadraticCurveTo(0, 50, 42, 10); g.quadraticCurveTo(0, 22, -42, 10); g.fill();
      g.beginPath(); g.moveTo(0, 6); g.bezierCurveTo(-14, -12, -4, -30, 0, -46); g.bezierCurveTo(4, -30, 14, -12, 0, 6);
      g.fillStyle = '#ffb347'; g.fill();
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-6, -10, -2, -18, 0, -26); g.bezierCurveTo(2, -18, 6, -10, 0, 0);
      g.fillStyle = '#fff4d0'; g.fill();
    } else if (kind === 'lotus') {
      for (let i = -2; i <= 2; i++) {
        g.save(); g.rotate(i * 0.42);
        g.beginPath(); g.moveTo(0, 30); g.bezierCurveTo(-18, 0, -12, -30, 0, -44); g.bezierCurveTo(12, -30, 18, 0, 0, 30);
        g.globalAlpha = i === 0 ? 1 : 0.8; g.fill(); g.restore();
      }
      g.beginPath(); g.moveTo(-44, 38); g.quadraticCurveTo(0, 50, 44, 38); g.stroke();
    } else if (kind === 'kalash') {
      g.moveTo(-26, -10); g.bezierCurveTo(-52, 10, -34, 50, 0, 50); g.bezierCurveTo(34, 50, 52, 10, 26, -10); g.closePath(); g.fill();
      g.fillRect(-20, -20, 40, 10);
      g.beginPath(); g.arc(0, -34, 14, 0, Math.PI * 2); g.fill();
      for (const a of [-1, 1]) { g.beginPath(); g.moveTo(0, -24); g.quadraticCurveTo(a * 30, -40, a * 44, -20); g.stroke(); }
    } else if (kind === 'dandiya') {
      for (const a of [-1, 1]) {
        g.save(); g.rotate(a * 0.5);
        g.fillRect(-4, -52, 8, 104);
        g.fillStyle = '#e2232f'; for (let k = -40; k <= 40; k += 20) g.fillRect(-5, k, 10, 6);
        g.restore(); g.fillStyle = '#f3cf86';
      }
    } else { // mandala
      g.beginPath(); g.arc(0, 0, 42, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 12; i++) {
        g.save(); g.rotate((i * Math.PI) / 6);
        g.beginPath(); g.moveTo(0, -16); g.bezierCurveTo(-8, -24, -6, -34, 0, -38); g.bezierCurveTo(6, -34, 8, -24, 0, -16); g.fill();
        g.restore();
      }
    }
    g.restore();
  }

  function buildBanner(word, icon, k) {
    return sprite(BANNER_W * k, BANNER_H * k, (g, W, H) => {
      g.scale(k, k);
      const w = BANNER_W, h = BANNER_H, plinth = 70, clothB = h - plinth;
      const shape = (inset) => {
        const l = 14 + inset, r = w - 14 - inset, top = 8 + inset * 1.6, sh = 60;
        g.beginPath();
        g.moveTo(l, top + sh);
        g.bezierCurveTo(l, top + sh * 0.3, w / 2 - 34, top + sh * 0.35, w / 2, top);
        g.bezierCurveTo(w / 2 + 34, top + sh * 0.35, r, top + sh * 0.3, r, top + sh);
        g.lineTo(r, clothB - 26 - inset);
        // scalloped hem
        const n = 5, step = (r - l) / n;
        for (let i = n; i > 0; i--) {
          const x0 = l + step * i, x1 = l + step * (i - 1);
          g.quadraticCurveTo((x0 + x1) / 2, clothB - inset * 0.6, x1, clothB - 26 - inset);
        }
        g.closePath();
      };
      // gold edge
      shape(0);
      const gold = g.createLinearGradient(0, 0, w, 0);
      gold.addColorStop(0, '#8a5a1c'); gold.addColorStop(0.5, '#f3cf86'); gold.addColorStop(1, '#8a5a1c');
      g.fillStyle = gold; g.fill();
      // cloth
      shape(6);
      const cloth = g.createLinearGradient(0, 0, 0, clothB);
      cloth.addColorStop(0, '#d4202c'); cloth.addColorStop(0.55, '#a8121d'); cloth.addColorStop(1, '#6e0b12');
      g.fillStyle = cloth; g.fill();
      // inner rule
      shape(16); g.strokeStyle = 'rgba(243,207,134,.7)'; g.lineWidth = 1.5; g.stroke();
      // a warm wash as if lit from the path
      shape(6);
      const wash = g.createRadialGradient(w / 2, clothB * 0.55, 10, w / 2, clothB * 0.55, w);
      wash.addColorStop(0, 'rgba(255,190,110,.22)'); wash.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = wash; g.fill();
      // medallion + icon
      g.beginPath(); g.arc(w / 2, 150, 46, 0, Math.PI * 2);
      g.fillStyle = 'rgba(60,5,8,.45)'; g.fill();
      g.strokeStyle = 'rgba(243,207,134,.8)'; g.lineWidth = 2; g.stroke();
      drawIcon(g, icon, w / 2, 150, 62);
      // the word
      g.fillStyle = '#ffe3a6';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 50;
      g.font = `700 ${fs}px Rasa, 'Hind Vadodara', serif`;
      while (g.measureText(word).width > w - 50 && fs > 20) { fs -= 2; g.font = `700 ${fs}px Rasa, 'Hind Vadodara', serif`; }
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 8; g.shadowOffsetY = 2;
      g.fillText(word, w / 2, 300);
      g.shadowColor = 'transparent';
      // small ornaments
      g.fillStyle = '#f3cf86';
      for (const y of [250, 350]) {
        g.beginPath(); g.moveTo(w / 2 - 30, y); g.lineTo(w / 2 + 30, y); g.strokeStyle = 'rgba(243,207,134,.6)'; g.lineWidth = 1.2; g.stroke();
        g.beginPath(); g.moveTo(w / 2, y - 5); g.lineTo(w / 2 + 5, y); g.lineTo(w / 2, y + 5); g.lineTo(w / 2 - 5, y); g.fill();
      }
      // tassels
      const n = 5, step = (w - 28) / n;
      for (let i = 0; i <= n; i++) {
        const x = 14 + step * i;
        g.beginPath(); g.moveTo(x, clothB - 26); g.lineTo(x, clothB - 8);
        g.strokeStyle = '#f3cf86'; g.lineWidth = 1.5; g.stroke();
        g.beginPath(); g.ellipse(x, clothB - 4, 4, 7, 0, 0, Math.PI * 2); g.fillStyle = i % 2 ? '#e8891c' : '#f5b335'; g.fill();
      }
      // plinth with marigolds
      const py = h - plinth + 14;
      g.fillStyle = '#3a1208'; g.fillRect(24, py, w - 48, plinth - 14);
      g.fillStyle = '#6e3a14'; g.fillRect(18, py, w - 36, 10);
      for (let i = 0; i < 18; i++) {
        const x = 26 + ((w - 52) * i) / 17, y = py - 4 + Math.sin(i * 1.7) * 3;
        g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2);
        g.fillStyle = ['#f5b335', '#e8891c', '#d2232f', '#fff1d0'][i % 4]; g.fill();
      }
      g.fillStyle = 'rgba(255,180,90,.25)'; g.fillRect(24, py + 10, w - 48, 3);
    });
  }

  function buildLantern(k) {
    return sprite(60 * k, 120 * k, (g) => {
      g.scale(k, k);
      g.strokeStyle = '#c28a3a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(30, 0); g.lineTo(30, 16); g.stroke();
      g.fillStyle = '#c28a3a';
      g.beginPath(); g.moveTo(14, 26); g.lineTo(30, 14); g.lineTo(46, 26); g.closePath(); g.fill();
      const body = g.createRadialGradient(30, 58, 2, 30, 58, 28);
      body.addColorStop(0, '#fff3c4'); body.addColorStop(0.4, '#ffb347'); body.addColorStop(1, '#b8420f');
      g.fillStyle = body;
      g.beginPath(); g.moveTo(14, 28); g.bezierCurveTo(2, 50, 6, 80, 18, 92); g.lineTo(42, 92); g.bezierCurveTo(54, 80, 58, 50, 46, 28); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120,60,10,.8)'; g.lineWidth = 1.4;
      for (const x of [22, 30, 38]) { g.beginPath(); g.moveTo(x, 30); g.lineTo(x, 90); g.stroke(); }
      g.fillStyle = '#c28a3a'; g.fillRect(16, 92, 28, 6);
      g.fillStyle = '#d2232f'; g.beginPath(); g.moveTo(26, 98); g.lineTo(34, 98); g.lineTo(30, 118); g.closePath(); g.fill();
    });
  }

  function loadMandala() {
    const img = new Image();
    img.onload = () => {
      MANDALA = sprite(420, 420, (g, w) => {
        g.drawImage(img, 0, 0, w, w);
        g.globalCompositeOperation = 'source-in';
        const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        r.addColorStop(0, '#fff1c0'); r.addColorStop(0.5, '#f5b335'); r.addColorStop(1, '#d2232f');
        g.fillStyle = r; g.fillRect(0, 0, w, w);
      });
      dirty = true;
    };
    img.src = '/assets/svg/mandala.svg';
  }

  /* ---------- the world's furniture ---------- */
  let banners = [], strings = [], lanterns = [], diyas = [], rings = [], stars = [], sparks = [];
  function buildWorld() {
    const endBanner = RC_Z - 1250;
    banners = []; strings = []; lanterns = [];
    let i = 0;
    for (let z = 1500; z < endBanner; z += 620, i++) {
      const L = { x: -470, z, img: BANNERS[(i * 2) % BANNERS.length] };
      const R = { x: 470, z: z + 40, img: BANNERS[(i * 2 + 1) % BANNERS.length] };
      banners.push(L, R);
      const topY = GY - BANNER_H + 40;
      strings.push({ ax: -470, ay: topY, az: z, bx: 470, by: topY, bz: z + 40, sag: 120, n: lean ? 14 : 22 });
      if (i > 0) {
        const pz = z - 620;
        strings.push({ ax: -470, ay: topY, az: pz, bx: -470, by: topY, bz: z, sag: 50, n: lean ? 8 : 12 });
        strings.push({ ax: 470, ay: topY, az: pz + 40, bx: 470, by: topY, bz: z + 40, sag: 50, n: lean ? 8 : 12 });
      }
      if (i % 2 === 0) for (const x of [-230, 0, 230]) lanterns.push({ x, z: z + 20, phase: Math.random() * 6 });
    }
    diyas = [];
    for (let z = 250; z < RC_Z - 860; z += lean ? 150 : 115) {
      diyas.push({ x: -330, z, ph: Math.random() * 6 }, { x: 330, z, ph: Math.random() * 6 });
    }
    // the garba ring: circles of dancers turning in alternate directions
    rings = [];
    const spec = [[240, 56, 1, 0.16], [340, 84, -1, 0.12], [440, 112, 1, 0.1], [540, 140, -1, 0.085], [640, 168, 1, 0.07]];
    for (const [r, n0, dir, sp] of spec) {
      const n = lean ? Math.round(n0 * 0.6) : n0;
      const ds = [];
      for (let k = 0; k < n; k++) ds.push({ a: (k / n) * Math.PI * 2 + Math.random() * 0.04, jr: (Math.random() - 0.5) * 22, c: DANCERS[(Math.random() * DANCERS.length) | 0], ph: Math.random() * 6 });
      rings.push({ r, dir, sp, ds });
    }
    stars = [];
    for (let k = 0; k < (lean ? 70 : 140); k++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.3, ph: Math.random() * 6 });
    sparks = [];
    for (let k = 0; k < (lean ? 22 : 44); k++) sparks.push(newSpark(true));
  }
  function newSpark(anywhere) {
    return { x: Math.random(), y: anywhere ? Math.random() : 1.05, v: 0.02 + Math.random() * 0.05, s: 0.6 + Math.random() * 1.8, ph: Math.random() * 6, a: 0.25 + Math.random() * 0.5 };
  }

  /* ---------- panels on the path ---------- */
  const panels = [...document.querySelectorAll('.panel')].map((el) => ({ el, id: el.id, label: el.dataset.label, last: el.classList.contains('finale') }));

  function planPath() {
    let start = 980;
    for (const p of panels) {
      p.el.style.transform = 'translate(-50%,-50%)';
      const h = p.el.offsetHeight;
      p.over = Math.max(0, h - vh * 0.8);
      if (p.last) continue;
      p.a0 = start; p.a1 = start + 620;
      p.b0 = p.a1 + 380 + p.over / PX; p.b1 = p.b0 + 420;
      start = p.b0 + 220;
    }
    const lastBody = panels.filter((p) => !p.last).pop();
    RISE0 = lastBody.b0 - 100;
    RISE1 = RISE0 + RISE_LEN;
    // the ring sits where the camera, risen and tilted, ends up looking
    const reach = (RISE_H + GY) / Math.tan(RISE_PITCH);
    RC_Z = RISE1 + reach;
    const fin = panels.find((p) => p.last);
    fin.a0 = RISE1 - 900; fin.a1 = RISE1 - 60;
    fin.b0 = fin.b1 = Infinity;
    Z_END = RISE1 + 200 + fin.over / PX;
    spacer.style.height = Math.round(Z_END * PX + vh) + 'px';
  }

  function ease(t) { return t * t * (3 - 2 * t); }
  function panelPose(p, z) {
    const mob = vw < 600;
    const farS = calm ? 1 : mob ? 0.9 : 0.84, passS = calm ? 1 : mob ? 0.95 : 0.93;
    if (z < p.a0 || z > p.b1) return null;
    if (z < p.a1) {
      const q = ease((z - p.a0) / (p.a1 - p.a0));
      return { op: q, s: farS + (1 - farS) * q, y: p.over / 2 + (calm ? 0 : vh * (mob ? 0.05 : 0.08) * (1 - q)) };
    }
    if (z <= p.b0) {
      const t = p.b0 === Infinity ? clamp((z - p.a1) / Math.max(1, p.over / PX), 0, 1) : clamp((z - p.a1) / (p.b0 - p.a1), 0, 1);
      return { op: 1, s: 1, y: p.over / 2 - p.over * t };
    }
    const q = smooth(p.b0, p.b1, z);
    return { op: 1 - smooth(0.1, 1, q), s: 1 - (1 - passS) * q, y: -p.over / 2 - (calm ? 0 : vh * (mob ? 0.025 : 0.04) * q) };
  }

  /* ---------- layout ---------- */
  let lastW = 0, lastH = 0, layoutQueued = false;
  function requestLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; layout(); });
  }
  function layout() {
    const keep = camZ > 0 ? camZ : 0;
    vw = innerWidth; vh = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, lean ? 1.5 : 2);
    cx = vw / 2; vy = vh * 0.54;
    F = clamp(Math.min(vw * 1.1, vh * 1.05), 380, 1100);
    for (const c of [cv, embersCv]) { c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr); }
    planPath();
    buildWorld();
    fitGate();
    buildRail();
    // keep the visitor where they were
    if (keep > 0 && Math.abs(scrollY - keep * PX) > 2) scrollTo(0, keep * PX);
    lastW = vw; lastH = vh;
    dirty = true;
  }

  /* the arch opening in gate.webp (1600×900) sits at ~(800, 590): zoom into it */
  let gateScale0 = 1;
  function fitGate() {
    const iw = 1600, ih = 900;
    gateScale0 = Math.max(vw / iw, vh / ih);
    gateImg.style.width = iw * gateScale0 + 'px';
    gateImg.style.height = ih * gateScale0 + 'px';
    const ox = vw / 2 + (800 - iw / 2) * gateScale0;
    const oy = vh / 2 + (590 - ih / 2) * gateScale0;
    gate.style.transformOrigin = `${ox}px ${oy}px`;
  }

  function buildRail() {
    rail.innerHTML = '';
    [{ id: 'hero', label: 'Gate', a1: 0 }, ...panels].forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span>${esc(p.label || '')}</span>`;
      b.setAttribute('aria-label', p.label);
      b.addEventListener('click', () => goTo(p.id));
      p.railBtn = b;
      rail.appendChild(b);
    });
  }

  function goTo(id, instant) {
    const p = panels.find((x) => x.id === id);
    const z = p ? p.a1 + 20 : 0;
    scrollTo({ top: z * PX, behavior: instant || calm ? 'auto' : 'smooth' });
  }
  document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); goTo(a.dataset.go); }));
  // keyboard users tabbing into a section that is still down the path
  $('#depth').addEventListener('focusin', (e) => {
    const p = panels.find((x) => x.el.contains(e.target));
    if (p && !p.el.classList.contains('live')) goTo(p.id, true);
  });

  /* =================== drawing =================== */
  let camY = 0, cp = 1, sp = 0, rise = 0;
  // project a world point; returns false when behind the camera
  const P = { x: 0, y: 0, s: 0, d: 0 };
  function proj(x, y, z, wz) {
    const ry = y - camY, rz = z - wz;
    const y2 = ry * cp - rz * sp, z2 = ry * sp + rz * cp;
    if (z2 < NEAR) return false;
    const s = F / z2;
    P.x = cx + x * s; P.y = vy + y2 * s; P.s = s; P.d = z2;
    return true;
  }
  const fog = (d) => 1 - smooth(FAR * 0.5, FAR, d);

  function drawSky(g, t) {
    const hy = vy - F * Math.tan(rise * RISE_PITCH);   // the horizon climbs as we tilt down
    const sky = g.createLinearGradient(0, hy - vh, 0, hy);
    sky.addColorStop(0, '#07010a'); sky.addColorStop(0.55, '#16030a'); sky.addColorStop(1, '#34090c');
    g.fillStyle = sky; g.fillRect(0, 0, vw, Math.max(0, hy));
    if (hy > 0) {
      for (const s of stars) {
        const y = hy - s.y * vh * 0.9;
        if (y < 0 || y > hy - 20) continue;
        g.globalAlpha = (calm ? 0.7 : 0.45 + 0.35 * Math.sin(t * 1.3 + s.ph)) * clamp((hy - y) / 120, 0, 1);
        g.fillStyle = '#ffe9c8'; g.fillRect(s.x * vw, y, s.r, s.r);
      }
      g.globalAlpha = 1;
      // the moon
      const mx = vw * 0.8, my = hy - vh * 0.62;
      if (my > -60) {
        const m = g.createRadialGradient(mx, my, 0, mx, my, 110);
        m.addColorStop(0, 'rgba(255,240,210,.95)'); m.addColorStop(0.16, 'rgba(255,230,190,.9)'); m.addColorStop(0.2, 'rgba(255,200,140,.18)'); m.addColorStop(1, 'rgba(255,200,140,0)');
        g.fillStyle = m; g.fillRect(mx - 110, my - 110, 220, 220);
      }
      // warm city glow on the horizon
      const hg = g.createRadialGradient(cx, hy, 0, cx, hy, vw * 0.7);
      hg.addColorStop(0, 'rgba(255,120,50,.28)'); hg.addColorStop(1, 'rgba(255,120,50,0)');
      g.fillStyle = hg; g.fillRect(0, hy - vh * 0.5, vw, vh * 0.5);
    }
    // ground
    const gTop = Math.max(0, hy);
    const ground = g.createLinearGradient(0, gTop, 0, vh);
    ground.addColorStop(0, '#34090c'); ground.addColorStop(0.35, '#2a0808'); ground.addColorStop(1, '#46170d');
    g.fillStyle = ground; g.fillRect(0, gTop, vw, vh - gTop);
    // haze where sky meets ground, so there is no seam
    if (hy > -80 && hy < vh + 80) {
      const hz = g.createLinearGradient(0, hy - 70, 0, hy + 70);
      hz.addColorStop(0, 'rgba(70,18,14,0)'); hz.addColorStop(0.5, 'rgba(90,26,16,.55)'); hz.addColorStop(1, 'rgba(70,18,14,0)');
      g.fillStyle = hz; g.fillRect(0, hy - 70, vw, 140);
    }
  }

  function drawFloor(g, wz) {
    const fade = 1 - smooth(0.3, 0.9, rise);
    // the walkway: a warm runner down the middle
    if (fade > 0.01) {
      const zN = wz + 140, zF = Math.min(wz + FAR, RC_Z - 700);
      if (zF > zN) {
        const pts = [];
        for (const [x, z] of [[-170, zN], [170, zN], [170, zF], [-170, zF]]) { if (!proj(x, GY, z, wz)) return; pts.push([P.x, P.y]); }
        const rg = g.createLinearGradient(0, pts[2][1], 0, pts[0][1]);
        rg.addColorStop(0, 'rgba(120,24,20,0)'); rg.addColorStop(1, `rgba(150,30,24,${0.55 * fade})`);
        g.fillStyle = rg; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      }
    }
    // tiles: lines across the path, sliding toward us
    const step = 150;
    g.lineWidth = 1;
    for (let z = Math.ceil((wz + 100) / step) * step; z < wz + FAR * 0.7; z += step) {
      if (!proj(-900, GY, z, wz)) continue;
      const x0 = P.x, y0 = P.y; proj(900, GY, z, wz);
      const a = 0.16 * fog(P.d * 1.6) * smooth(100, 400, P.d);
      if (a < 0.01) continue;
      g.strokeStyle = `rgba(255,170,90,${a})`;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(P.x, P.y); g.stroke();
    }
  }

  function billboard(g, img, x, z, wz, w, h, alpha, yBase = GY) {
    if (!proj(x, yBase, z, wz)) return;
    const a = alpha * fog(P.d) * smooth(220, 520, P.d);
    if (a < 0.01) return;
    const W = w * P.s, H = h * P.s;
    if (P.x + W / 2 < -50 || P.x - W / 2 > vw + 50) return;
    g.globalAlpha = a;
    g.drawImage(img, P.x - W / 2, P.y - H, W, H);
  }

  function glow(g, img, x, y, z, wz, size, alpha) {
    if (!proj(x, y, z, wz)) return;
    const a = alpha * fog(P.d) * smooth(80, 240, P.d);
    if (a < 0.01) return;
    const S = Math.max(2, size * P.s);
    g.globalAlpha = a;
    g.drawImage(img, P.x - S / 2, P.y - S / 2, S, S);
  }

  function drawString(g, s, wz, t) {
    const pts = [];
    for (let k = 0; k <= s.n; k++) {
      const u = k / s.n;
      const x = lerp(s.ax, s.bx, u), z = lerp(s.az, s.bz, u);
      const y = lerp(s.ay, s.by, u) + s.sag * 4 * u * (1 - u);
      if (!proj(x, y, z, wz)) return;
      pts.push([P.x, P.y, P.s, P.d, x, y, z]);
    }
    const a = fog(pts[0][3]) * smooth(150, 420, pts[0][3]) * (1 - smooth(0.2, 0.6, rise));
    if (a < 0.01) return;
    g.globalAlpha = a * 0.6;
    g.strokeStyle = '#3b1a0c'; g.lineWidth = Math.max(0.6, 2 * pts[0][2]);
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    for (let k = 1; k < pts.length - 1; k++) {
      const [x, y, sc] = pts[k];
      const tw = calm ? 0.85 : 0.65 + 0.35 * Math.sin(t * 3 + k * 1.9 + s.az);
      const S = Math.max(3, 38 * sc);
      g.globalAlpha = a * tw;
      g.drawImage(BULB, x - S / 2, y - S / 2, S, S);
    }
  }

  function drawRing(g, wz, t) {
    if (!proj(0, GY, RC_Z, wz)) return;
    const cxr = P.x, cyr = P.y;
    const vis = fog(P.d);
    if (vis < 0.01) return;
    // lit ground disc
    g.globalAlpha = vis;
    g.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      if (!proj(Math.cos(a) * 820, GY, RC_Z + Math.sin(a) * 820, wz)) continue;
      k ? g.lineTo(P.x, P.y) : g.moveTo(P.x, P.y);
    }
    g.closePath();
    const rg = g.createRadialGradient(cxr, cyr, 0, cxr, cyr, Math.max(10, 820 * (F / Math.max(1, P.d))));
    rg.addColorStop(0, 'rgba(160,50,24,.75)'); rg.addColorStop(0.7, 'rgba(110,30,18,.55)'); rg.addColorStop(1, 'rgba(70,16,12,.2)');
    g.fillStyle = rg; g.fill();
    // mandala on the ground at the centre (affine is plenty at this distance)
    if (MANDALA && proj(0, GY, RC_Z, wz)) {
      const ox = P.x, oy = P.y, R = 200;
      proj(R, GY, RC_Z, wz); const ax = (P.x - ox) / R, ay = (P.y - oy) / R;
      proj(0, GY, RC_Z + R, wz); const bx = (P.x - ox) / R, by = (P.y - oy) / R;
      g.save(); g.globalAlpha = vis * 0.9;
      g.setTransform(ax * dpr, ay * dpr, -bx * dpr, -by * dpr, ox * dpr, oy * dpr);
      g.drawImage(MANDALA, -R, -R, R * 2, R * 2);
      g.restore();
    }
    const spin = calm ? 0 : t;
    // inner circle of diyas
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      glow(g, GLOW, Math.cos(a) * 150, GY - 6, RC_Z + Math.sin(a) * 150, wz, 60, vis * (0.8 + 0.2 * Math.sin(t * 5 + k)));
    }
    // dancers
    for (const r of rings) {
      for (const d of r.ds) {
        const a = d.a + r.dir * r.sp * spin;
        const rr = r.r + d.jr + (calm ? 0 : Math.sin(spin * 2 + d.ph) * 6);
        if (!proj(Math.cos(a) * rr, GY - 8, RC_Z + Math.sin(a) * rr, wz)) continue;
        const S = Math.max(1.5, 30 * P.s);
        g.globalAlpha = vis;
        g.drawImage(d.c, P.x - S / 2, P.y - S / 2, S, S);
      }
    }
    // outer ring of lamps
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      glow(g, BULB, Math.cos(a) * 780, GY - 30, RC_Z + Math.sin(a) * 780, wz, 70, vis * (calm ? 0.9 : 0.7 + 0.3 * Math.sin(t * 2 + k * 0.7)));
    }
    // the garbo at the centre
    glow(g, GLOW, 0, GY - 60, RC_Z, wz, 420, vis * (0.9 + (calm ? 0 : 0.1 * Math.sin(t * 4))));
    glow(g, GLOW_RED, 0, GY - 40, RC_Z, wz, 700, vis * 0.5);
  }

  const ops = [];
  function drawWorld(t) {
    if (!ctx) return;
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    // the camera: walks, then rises and tilts over the ring
    const wz = Math.min(camZ, RISE1);
    rise = calm ? smooth(RISE0, RISE1, camZ) : ease(clamp((camZ - RISE0) / (RISE1 - RISE0), 0, 1));
    camY = -RISE_H * rise;
    const pitch = RISE_PITCH * rise;
    cp = Math.cos(pitch); sp = Math.sin(pitch);

    drawSky(g, t);
    drawFloor(g, wz);

    // painter's order: collect, sort far → near
    ops.length = 0;
    const propFade = 1 - smooth(0.15, 0.55, rise);
    if (propFade > 0.01) {
      for (const b of banners) if (b.z > wz + 150 && b.z < wz + FAR) ops.push({ z: b.z, k: 0, o: b });
      for (const s of strings) if (Math.max(s.az, s.bz) > wz + 150 && Math.min(s.az, s.bz) < wz + FAR) ops.push({ z: (s.az + s.bz) / 2, k: 1, o: s });
      for (const l of lanterns) if (l.z > wz + 150 && l.z < wz + FAR) ops.push({ z: l.z - 1, k: 2, o: l });
    }
    for (const d of diyas) if (d.z > wz + 60 && d.z < wz + FAR) ops.push({ z: d.z, k: 3, o: d });
    ops.push({ z: RC_Z + 900, k: 4 });
    ops.sort((a, b) => b.z - a.z);

    for (const op of ops) {
      const o = op.o;
      if (op.k === 0) {
        billboard(g, o.img, o.x, o.z, wz, BANNER_W, BANNER_H, propFade);
        glow(g, GLOW, o.x * 0.8, GY - 4, o.z - 30, wz, 260, 0.35 * propFade);
      } else if (op.k === 1) drawString(g, o, wz, t);
      else if (op.k === 2) {
        const sway = calm ? 0 : Math.sin(t * 1.4 + o.phase) * 6;
        billboard(g, LANTERN, o.x + sway, o.z, wz, 42, 84, propFade, GY - BANNER_H + 40 + 130 + 84);
        glow(g, GLOW, o.x + sway, GY - BANNER_H + 40 + 130 + 44, o.z, wz, 150, 0.55 * propFade);
      } else if (op.k === 3) {
        const fl = calm ? 0.9 : 0.75 + 0.25 * Math.sin(t * 7 + o.ph) * Math.sin(t * 3.3 + o.ph * 2);
        const near = smooth(180, 520, o.z - wz);
        glow(g, GLOW, o.x, GY - 8, o.z, wz, 70, fl * near);
        glow(g, GLOW_RED, o.x, GY - 2, o.z, wz, 150, 0.35 * fl * near);
      } else drawRing(g, wz, t);
    }
    g.globalAlpha = 1;
  }

  function drawEmbers(t, dt) {
    if (!ectx) return;
    const g = ectx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, vw, vh);
    if (calm) return;
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      s.y -= s.v * dt;
      if (s.y < -0.05) { sparks[i] = newSpark(false); continue; }
      const x = (s.x + Math.sin(t * 0.6 + s.ph) * 0.012) * vw, y = s.y * vh;
      const a = s.a * clamp(s.y * 2, 0, 1) * (0.6 + 0.4 * Math.sin(t * 4 + s.ph));
      g.globalAlpha = a;
      g.drawImage(GLOW, x - s.s * 3, y - s.s * 3, s.s * 6, s.s * 6);
    }
    g.globalAlpha = 1;
  }

  /* =================== the frame =================== */
  const heroEl = hero;
  let heroLive = true, dockOn = false, railOn = false, lastT = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const t = (now - t0) / 1000;

    target = clamp(scrollY / PX, 0, Z_END);
    if (camZ < 0) camZ = target;
    const delta = target - camZ;
    if (calm || Math.abs(delta) < 0.5) camZ = target;
    else camZ += delta * 0.14;

    // gate: we walk up to it and through the arch
    const gz = Math.min(camZ, GD - 60);
    const gs = GD / (GD - gz);
    const gop = 1 - smooth(GATE_OUT[0], GATE_OUT[1], camZ);
    gate.style.opacity = gop.toFixed(3);
    gate.style.visibility = gop < 0.005 ? 'hidden' : 'visible';
    if (gop > 0.005) gate.style.transform = `scale(${gs.toFixed(4)})`;

    // hero leaves the way every section leaves
    const hq = smooth(HERO_OUT[0], HERO_OUT[1], camZ);
    heroEl.style.opacity = (1 - smooth(0.05, 1, hq)).toFixed(3);
    heroEl.style.transform = `translate(-50%, ${calm ? 0 : (-vh * 0.05 * hq).toFixed(1)}px) scale(${calm ? 1 : (1 - 0.06 * hq).toFixed(4)})`;
    const hl = hq < 0.5;
    if (hl !== heroLive) { heroLive = hl; heroEl.classList.toggle('live', hl); heroEl.style.visibility = hq >= 0.999 ? 'hidden' : 'visible'; }
    if (hq < 0.999) heroEl.style.visibility = 'visible';

    let cur = null;
    for (const p of panels) {
      const pose = panelPose(p, camZ);
      const op = pose ? pose.op : 0;
      const opS = op.toFixed(3);
      if (opS !== p.opS) { p.el.style.opacity = opS; p.opS = opS; }
      const vis = op > 0.003;
      if (vis !== p.vis) { p.vis = vis; p.el.style.visibility = vis ? 'visible' : 'hidden'; }
      if (pose && vis) {
        const tS = `translate(-50%,-50%) translate3d(0,${pose.y.toFixed(1)}px,0) scale(${pose.s.toFixed(4)})`;
        if (tS !== p.tS) { p.el.style.transform = tS; p.tS = tS; }
      }
      const live = op > 0.6;
      if (live !== p.live) { p.live = live; p.el.classList.toggle("live", live); }
      if (camZ >= p.a1 - 1) cur = p;
      p.railBtn?.classList.toggle('lit', camZ >= p.a1 - 1);
    }
    panels.forEach((p) => p.railBtn?.classList.toggle('cur', p === cur));

    const ro = camZ > 300;
    if (ro !== railOn) { railOn = ro; rail.classList.toggle('on', ro); }
    const fin = panels[panels.length - 1];
    const dOn = camZ > HERO_OUT[1] && camZ < fin.a0;
    if (dOn !== dockOn) { dockOn = dOn; dock.classList.toggle('on', dOn); }

    drawWorld(t);
    drawEmbers(t, dt);
  }

  /* =================== boot =================== */
  async function boot() {
    try { await document.fonts.load('700 50px Rasa', 'મમતા શક્તિ'); } catch { /* fall back */ }
    const k = lean ? 1 : 1.6;
    BANNERS = WORDS.map(([w, ic], i) => buildBanner(w, ic, k));
    LANTERN = buildLantern(k);
    loadMandala();
    layout();
    const hash = location.hash.slice(1);
    if (hash && panels.some((p) => p.id === hash)) goTo(hash, true);
    requestAnimationFrame(frame);
  }

  addEventListener('resize', () => {
    // mobile toolbars nudge the height as they slide; only re-plan on real changes
    if (innerWidth !== lastW || Math.abs(innerHeight - lastH) > 120) requestLayout();
    else { vh = innerHeight; vy = vh * 0.54; for (const c of [cv, embersCv]) c.height = Math.round(vh * dpr); }
  });
  addEventListener('hashchange', () => {
    const hash = location.hash.slice(1);
    if (panels.some((p) => p.id === hash)) goTo(hash);
  });

  boot();
})();
