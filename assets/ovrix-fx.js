// Ovrix motion layer: theme switch, scroll progress, reveals, cursor spotlight, product-window tilt,
// and the hero "cut" where Kaapo removes a filler word live. Everything respects reduced motion.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;

  /* ---------- theme switch (dark / light) ---------- */
  const save = t => { try { localStorage.setItem('ovrix-theme', t) } catch (e) {} };
  const meta = document.querySelector('meta[name=theme-color]');
  const apply = t => { root.dataset.theme = t; if (meta) meta.content = t === 'light' ? '#FAFAFA' : '#0A0A0A' };
  apply(root.dataset.theme || 'dark');
  const ICONS = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
    + '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const nav = document.querySelector('.nav .wrap');
  if (nav && !nav.querySelector('.tgl')) {
    const b = document.createElement('button');
    b.className = 'tgl'; b.type = 'button'; b.innerHTML = ICONS;
    const label = () => b.setAttribute('aria-label', root.dataset.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    label();
    const cta = nav.querySelector(':scope > .btn');
    cta ? nav.insertBefore(b, cta) : nav.appendChild(b);
    b.addEventListener('click', e => {
      const next = root.dataset.theme === 'light' ? 'dark' : 'light';
      const go = () => { apply(next); save(next); label() };
      if (!document.startViewTransition || reduce) return go();
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      document.startViewTransition(go).ready.then(() => {
        root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
          { duration: 650, easing: 'cubic-bezier(.7,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
      });
    });
  }

  /* ---------- scroll progress ---------- */
  const bar = document.createElement('div'); bar.className = 'progress'; document.body.appendChild(bar);
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--p', h > 0 ? Math.min(1, scrollY / h) : 0); ticking = false;
    });
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- staggered reveals ---------- */
  const io = new IntersectionObserver(es => {
    let i = 0;
    es.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.style.setProperty('--d', (reduce ? 0 : Math.min(i++, 6) * 0.07) + 's');
      en.target.classList.add('in'); io.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  const watch = () => document.querySelectorAll('.reveal:not(.in), .steps:not(.in)').forEach(el => io.observe(el));
  watch(); setTimeout(watch, 300); // catches items the page script renders later

  /* ---------- cursor spotlight on cards ---------- */
  if (fine) {
    const SEL = '.svc article, .prod, .plan, .feat article, .who div, form.brief';
    const mark = () => document.querySelectorAll(SEL).forEach(el => el.classList.add('spot'));
    mark(); setTimeout(mark, 300);
    addEventListener('pointermove', e => {
      const el = e.target.closest && e.target.closest('.spot'); if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  /* ---------- product window tilt ---------- */
  const board = document.querySelector('.hero .board');
  if (board && fine && !reduce) {
    board.addEventListener('animationend', () => {
      board.classList.add('tilt');
      const hero = board.closest('.hero');
      hero.addEventListener('pointermove', e => {
        const r = board.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / innerWidth, dy = (e.clientY - (r.top + r.height / 2)) / innerHeight;
        board.style.setProperty('--ry', (dx * 9).toFixed(2) + 'deg'); board.style.setProperty('--rx', (-dy * 7).toFixed(2) + 'deg');
      });
      hero.addEventListener('pointerleave', () => { board.style.setProperty('--ry', '0deg'); board.style.setProperty('--rx', '0deg') });
    }, { once: true });
  }

  /* ---------- counters ---------- */
  document.querySelectorAll('[data-count]').forEach(el => {
    const end = +el.dataset.count; if (reduce) { el.textContent = end; return }
    let t0; const step = t => { t0 ??= t; const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step) };
    setTimeout(() => requestAnimationFrame(step), 500);
  });

  /* ---------- hero: Kaapo cuts the filler word ---------- */
  const h1 = document.querySelector('h1.cuth'), fill = h1 && h1.querySelector('.fill'), note = document.querySelector('.cutnote');
  if (h1 && fill) {
    const ft = fill.querySelector('.ft'), ph = fill.querySelector('.ph');
    let busy = false;
    const reset = () => { fill.style.width = ''; fill.style.transition = 'none'; ft.style.clipPath = ''; ph.style.opacity = 0; ph.style.left = '0px'; note && note.classList.remove('on') };
    const cut = async () => {
      if (busy) return; busy = true; reset();
      if (reduce) { fill.style.width = '0px'; note && note.classList.add('on'); busy = false; return }
      const w = fill.getBoundingClientRect().width;
      fill.style.width = w + 'px'; void fill.offsetWidth;
      await new Promise(r => setTimeout(r, 1400));
      ph.style.opacity = 1;
      const dur = 650, ease = 'cubic-bezier(.6,0,.3,1)';
      ph.animate([{ left: '0px' }, { left: (w - 3) + 'px' }], { duration: dur, easing: ease, fill: 'forwards' });
      await ft.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: dur, easing: ease, fill: 'forwards' }).finished;
      fill.style.transition = 'width .55s cubic-bezier(.7,0,.2,1)'; fill.style.width = '0px';
      await new Promise(r => setTimeout(r, 300)); ph.style.opacity = 0;
      note && note.classList.add('on'); busy = false;
    };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(cut);
    h1.addEventListener('click', () => { ft.getAnimations().forEach(a => a.cancel()); ph.getAnimations().forEach(a => a.cancel()); cut() });
  }
})();
