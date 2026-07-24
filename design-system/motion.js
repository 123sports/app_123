/* ============================================================================
 * ON COURT — runtime de motion (sem dependências)
 * Implementa os padrões do sistema PK adaptados à plataforma:
 *
 *   [data-reveal]            entrada once a 80% da viewport (rise + fade)
 *   [data-reveal-stagger]    filhos entram em cascata (40ms/item, máx. 8)
 *   [data-char-button]       botão com stagger letra-a-letra (fórmula PK .02s)
 *   [data-px-reveal]         revelação pixelada 25×4 na cor do fundo
 *   [data-odometer]          número rola como hodômetro até o valor final
 *   [data-marquee]           faixa em loop infinito, pausa fora da viewport
 *
 * Uso no app (TanStack/React): importe once e chame OnMotion.scan(root) após
 * montar a rota (ou num useEffect do shell). scan() é idempotente.
 * Tudo respeita prefers-reduced-motion.
 * ========================================================================== */

(function (global) {
  'use strict';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Reveal de entrada (once, 80% viewport) ---------- */
  /* Root estendido para cima: navegação por âncora/scroll rápido salta a zona
     de interseção e nunca dispararia o callback — o que já passou revela logo. */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      revealIO.unobserve(e.target);
    });
  }, { rootMargin: '600% 0px -20% 0px' });

  function initReveal(root) {
    root.querySelectorAll('[data-reveal]:not(.on-motion-bound)').forEach((el) => {
      el.classList.add('on-motion-bound');
      if (REDUCED) { el.classList.add('is-in'); return; }
      revealIO.observe(el);
    });
    root.querySelectorAll('[data-reveal-stagger]:not(.on-motion-bound)').forEach((wrap) => {
      wrap.classList.add('on-motion-bound');
      const kids = [...wrap.children].slice(0, 8); /* orçamento: máx. 8 */
      kids.forEach((kid, i) => {
        kid.setAttribute('data-reveal', '');
        kid.style.transitionDelay = REDUCED ? '0s' : `${i * 40}ms`;
        if (REDUCED) { kid.classList.add('is-in'); return; }
        revealIO.observe(kid);
      });
      [...wrap.children].slice(8).forEach((kid) => kid.classList.add('is-in'));
    });
  }

  /* ---------- 2. Botão com stagger letra-a-letra (fórmula PK) ---------- */
  function initCharButtons(root) {
    root.querySelectorAll('[data-char-button]:not([data-charified])').forEach((btn) => {
      const label = btn.textContent.trim();
      if (!label) return;
      btn.dataset.charified = '1';
      btn.setAttribute('aria-label', label);
      btn.textContent = '';
      [...label].forEach((ch, i) => {
        const wrap = document.createElement('span');
        wrap.className = 'on-char';
        wrap.style.setProperty('--char', i + 1);
        wrap.setAttribute('aria-hidden', 'true');
        const a = document.createElement('span');
        const b = document.createElement('span');
        a.textContent = ch === ' ' ? ' ' : ch;
        b.textContent = a.textContent;
        wrap.append(a, b);
        btn.appendChild(wrap);
      });
    });
  }

  /* ---------- 3. Revelação pixelada (grid 25×4, cor do fundo) ---------- */
  function initPxReveal(root) {
    if (REDUCED) return;
    const COLS = 25, ROWS = 4;
    root.querySelectorAll('[data-px-reveal]:not(.on-motion-bound)').forEach((host) => {
      host.classList.add('on-motion-bound');
      const panel = document.createElement('div');
      panel.className = 'on-px-panel';
      const cells = [];
      for (let c = 0; c < COLS * ROWS; c++) {
        const px = document.createElement('div');
        px.className = 'on-px-cell';
        panel.appendChild(px);
        cells.push(px);
      }
      host.appendChild(panel);
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          io.unobserve(host);
          cells.forEach((el) => {
            el.style.transitionDelay = (Math.random() * 0.35).toFixed(3) + 's';
            requestAnimationFrame(() => el.classList.add('is-off'));
          });
          setTimeout(() => panel.remove(), 1200);
        });
      }, { threshold: 0.35 });
      io.observe(host);
    });
  }

  /* ---------- 4. Odometer — número rola até o valor (KPIs) ---------- */
  function initOdometer(root) {
    root.querySelectorAll('[data-odometer]:not(.on-motion-bound)').forEach((el) => {
      el.classList.add('on-motion-bound');
      const target = parseFloat(el.dataset.odometer ?? el.textContent.replace(/[^\d.-]/g, ''));
      if (Number.isNaN(target)) return;
      const prefix = el.dataset.odometerPrefix ?? '';
      const suffix = el.dataset.odometerSuffix ?? '';
      const decimals = (String(el.dataset.odometer).split('.')[1] || '').length;
      const fmt = (v) => prefix + v.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }) + suffix;
      if (REDUCED) { el.textContent = fmt(target); return; }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          io.unobserve(el);
          const t0 = performance.now();
          const DUR = 700; /* --on-dur */
          const easeOut = (t) => 1 - Math.pow(1 - t, 4);
          (function frame(now) {
            const p = Math.min(1, (now - t0) / DUR);
            el.textContent = fmt(target * easeOut(p));
            if (p < 1) requestAnimationFrame(frame);
          })(t0);
        });
      }, { threshold: 0.6 });
      io.observe(el);
    });
  }

  /* ---------- 5. Marquee — loop infinito, pausa fora da viewport ---------- */
  /* O bloco animado precisa ser >= largura do container, senão o loop abre um
     buraco quando o bloco sai. Repetimos o conjunto até cobrir o container
     (com folga) antes de clonar o bloco do loop; a duração é proporcional à
     largura para manter velocidade constante (~60px/s). */
  function fillMarquee(strip) {
    const inner = strip.firstElementChild;
    if (!inner || !inner.children.length) return;
    const originals = [...inner.children].slice(0, inner.dataset.onSetSize || inner.children.length);
    inner.dataset.onSetSize = originals.length;
    let guard = 0;
    while (inner.scrollWidth < strip.clientWidth * 1.1 && guard < 40) {
      originals.forEach((n) => inner.appendChild(n.cloneNode(true)));
      guard++;
    }
    strip.style.setProperty('--on-marquee-dur', Math.max(10, Math.round(inner.scrollWidth / 60)) + 's');
  }

  function initMarquee(root) {
    root.querySelectorAll('[data-marquee]:not(.on-motion-bound)').forEach((strip) => {
      strip.classList.add('on-motion-bound');
      if (REDUCED) return;
      const inner = strip.firstElementChild;
      if (!inner) return;
      fillMarquee(strip);
      const clone = inner.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      strip.appendChild(clone); /* segundo bloco entra quando o primeiro sai */
      strip.classList.add('on-marquee-run');
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => strip.classList.toggle('on-marquee-paused', !e.isIntersecting));
      });
      io.observe(strip);
      /* container cresceu (resize/rotação): completa os dois blocos */
      let raf = 0;
      addEventListener('resize', () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          if (inner.scrollWidth < strip.clientWidth * 1.1) {
            fillMarquee(strip);
            clone.replaceChildren(...[...inner.children].map((n) => n.cloneNode(true)));
          }
        });
      });
    });
  }

  const OnMotion = {
    scan(root) {
      const r = root || document;
      initReveal(r);
      initCharButtons(r);
      initPxReveal(r);
      initOdometer(r);
      initMarquee(r);
    },
  };

  if (document.readyState !== 'loading') OnMotion.scan(document);
  else document.addEventListener('DOMContentLoaded', () => OnMotion.scan(document));

  global.OnMotion = OnMotion;
})(typeof window !== 'undefined' ? window : globalThis);
