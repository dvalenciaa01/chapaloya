/* ==========================================================================
   Reservalope · Contenido editable de la landing (migración 29)
   --------------------------------------------------------------------------
   landing/index.html marca lo que se puede cambiar desde /admin → Landing:
     data-lc="<clave>"        un texto (o un <video>) editable
     data-lc-sec="<id>"       una sección (data-lc-name = su nombre en el
                              editor; data-lc-fixed = no se puede ocultar)
     data-lc-item="<id>"      un punto de una sección que se puede ocultar
   El texto de fábrica es el del HTML. En Supabase (public.landing_contenido)
   se guardan solo los cambios: { text, media, hidden, seo }.

   Textos: se ponen siempre con textContent (nunca como HTML). Lo escrito
   entre *asteriscos* usa el resaltado que el título ya tenía (el color o el
   gris de la segunda parte). Los íconos (svg) del elemento se conservan.

   Visita normal: aplica al instante la última versión guardada en este
   navegador y luego la de Supabase; LandingContent.ready se cumple cuando
   llegó (o a los 1,5 s), y la landing espera eso para quitar la pantalla de
   carga, así no se ve el texto viejo.
   Dentro del editor (?editar=1 en un marco del mismo sitio) no lee Supabase:
   manda la lista de campos a la consola y aplica el borrador que le llega.
   ========================================================================== */
const LandingContent = (() => {
  const CACHE = 'reservalope-landing-v1';
  const SVG = 'http://www.w3.org/2000/svg';
  const editing = (() => {
    try { return new URLSearchParams(location.search).get('editar') === '1' && window.parent !== window; }
    catch (e) { return false; }
  })();

  const isIcon = n => n.nodeType === 1 && n.namespaceURI === SVG;
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const safeUrl = u => typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u) && u.length <= 600;

  /* ---------- Lo de fábrica (se lee una vez, antes de cambiar nada) ---------- */
  const fields = new Map();
  document.querySelectorAll('[data-lc]').forEach(el => {
    const key = el.dataset.lc;
    if (el.tagName === 'VIDEO') {
      const src = el.querySelector('source');
      fields.set(key, { key, el, kind: 'video', src: src ? src.getAttribute('src') : '', poster: el.getAttribute('poster') || '' });
      return;
    }
    const nodes = [...el.childNodes];
    const content = nodes.filter(n => !isIcon(n));
    const hl = content.find(n => n.nodeType === 1);
    const raw = content.map(n => n.textContent).join('');
    const firstReal = nodes.find(n => !(n.nodeType === 3 && !n.textContent.trim()));
    fields.set(key, {
      key, el, kind: 'text',
      value: clean(content.map(n => n.nodeType === 1 ? '*' + clean(n.textContent) + '*' : n.textContent).join('')),
      hl: hl ? hl.cloneNode(false) : null,
      iconFirst: !!(firstReal && isIcon(firstReal)),
      pre: (raw.match(/^\s*/) || [''])[0] ? ' ' : '',
      post: (raw.match(/\s*$/) || [''])[0] ? ' ' : ''
    });
    el.dataset.lcNow = fields.get(key).value;
  });
  const meta = q => document.querySelector(q);
  const seoDefault = {
    title: document.title,
    description: (meta('meta[name="description"]') || {}).content || ''
  };
  const ogDefault = {
    title: (meta('meta[property="og:title"]') || {}).content || '',
    description: (meta('meta[property="og:description"]') || {}).content || ''
  };

  /* ---------- Aplicar ---------- */
  function setText(f, value) {
    const el = f.el;
    [...el.childNodes].forEach(n => { if (!isIcon(n)) n.remove(); });
    const frag = document.createDocumentFragment();
    const parts = f.hl ? String(value).split(/\*([^*]+)\*/) : [String(value)];
    if (f.iconFirst && f.pre) frag.appendChild(document.createTextNode(f.pre));
    parts.forEach((p, i) => {
      if (!p) return;
      if (i % 2 === 1) {
        const h = f.hl.cloneNode(false);
        h.textContent = p;
        frag.appendChild(h);
      } else frag.appendChild(document.createTextNode(p));
    });
    if (!f.iconFirst && f.post) frag.appendChild(document.createTextNode(f.post));
    // Los íconos quedan donde estaban: antes del texto (✓ de las listas) o después (flechas, +)
    if (f.iconFirst) el.appendChild(frag);
    else el.insertBefore(frag, el.firstChild);
  }

  function setVideo(f, m) {
    const v = f.el, s = v.querySelector('source');
    const src = m && safeUrl(m.src) ? m.src : f.src;
    const poster = m && safeUrl(m.poster) ? m.poster : f.poster;
    let changed = false;
    if (s && s.getAttribute('src') !== src) {
      s.setAttribute('src', src);
      s.setAttribute('type', /\.webm(\?|$)/i.test(src) ? 'video/webm' : 'video/mp4');
      changed = true;
    }
    if ((v.getAttribute('poster') || '') !== poster) { if (poster) v.setAttribute('poster', poster); else v.removeAttribute('poster'); }
    if (changed) { try { v.load(); } catch (e) {} }
  }

  const hideEl = (el, off) => { if (el) el.style.display = off ? 'none' : ''; };

  let current = null;
  function apply(content) {
    const c = content && typeof content === 'object' ? content : {};
    const text = c.text && typeof c.text === 'object' ? c.text : {};
    const media = c.media && typeof c.media === 'object' ? c.media : {};
    const hidden = new Set(Array.isArray(c.hidden) ? c.hidden : []);
    fields.forEach(f => {
      if (f.kind === 'video') return setVideo(f, media[f.key]);
      const v = typeof text[f.key] === 'string' ? text[f.key] : f.value;
      const now = f.el.dataset.lcNow;
      if (now !== v) { setText(f, v); f.el.dataset.lcNow = v; }
    });
    document.querySelectorAll('[data-lc-sec]').forEach(sec => {
      const off = !sec.hasAttribute('data-lc-fixed') && hidden.has(sec.dataset.lcSec);
      hideEl(sec, off);
      // Los enlaces del menú y del pie que llevan a una sección oculta también se ocultan
      if (sec.id) document.querySelectorAll('.nav a[href="#' + sec.id + '"], footer a[href="#' + sec.id + '"]').forEach(a => hideEl(a.closest('li') || a, off));
    });
    document.querySelectorAll('[data-lc-item]').forEach(it => hideEl(it, hidden.has(it.dataset.lcItem)));
    const seo = c.seo && typeof c.seo === 'object' ? c.seo : {};
    const title = clean(seo.title) || seoDefault.title;
    const desc = clean(seo.description) || seoDefault.description;
    document.title = title;
    const setMeta = (q, v) => { const m = meta(q); if (m && v) m.setAttribute('content', v); };
    setMeta('meta[name="description"]', desc);
    setMeta('meta[property="og:title"]', clean(seo.title) || ogDefault.title);
    setMeta('meta[property="og:description"]', clean(seo.description) || ogDefault.description);
    current = JSON.stringify(c);
  }

  /* ---------- Visita normal ---------- */
  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  if (!editing) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) {}
    if (cached) apply(cached);
    setTimeout(resolveReady, 1500);
    const cfg = window.RESERVALOPE_CONFIG || {};
    if (cfg.supabaseUrl && cfg.supabaseKey && window.fetch) {
      fetch(cfg.supabaseUrl + '/rest/v1/landing_contenido?select=contenido&id=eq.1', { headers: { apikey: cfg.supabaseKey } })
        .then(r => (r.ok ? r.json() : null))
        .then(rows => {
          if (!Array.isArray(rows)) return;   // sin la migración 29: la landing de fábrica
          const c = rows[0] && rows[0].contenido ? rows[0].contenido : {};
          if (JSON.stringify(c) !== current) apply(c);
          try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) {}
        })
        .catch(() => {})
        .then(resolveReady);
    } else resolveReady();
  }

  /* ---------- Dentro del editor de la consola ---------- */
  if (editing) {
    resolveReady();
    const send = msg => window.parent.postMessage(msg, location.origin);
    const style = document.createElement('style');
    style.textContent =
      '[data-lc]{cursor:pointer;outline:1.5px dashed transparent;outline-offset:4px;border-radius:4px;transition:outline-color .15s}' +
      '[data-lc]:hover{outline-color:rgba(139,92,246,.55)}' +
      '[data-lc].lc-on{outline:2px solid #8B5CF6}' +
      '[data-lc-sec].lc-sec-on{box-shadow:inset 0 0 0 3px rgba(139,92,246,.35)}';
    document.head.appendChild(style);

    const list = () => {
      const out = [];
      fields.forEach(f => {
        const sec = f.el.closest('[data-lc-sec]');
        const item = f.el.closest('[data-lc-item]');
        out.push({
          key: f.key, kind: f.kind,
          sec: sec ? sec.dataset.lcSec : '',
          item: item ? item.dataset.lcItem : '',
          value: f.kind === 'video' ? { src: new URL(f.src, location.href).href, poster: f.poster ? new URL(f.poster, location.href).href : '' } : f.value,
          hl: !!f.hl,
          long: f.kind === 'text' && f.value.length > 90,
          hint: f.el.dataset.lcHint || ''
        });
      });
      const sections = [...document.querySelectorAll('[data-lc-sec]')].map(s => ({
        id: s.dataset.lcSec, name: s.dataset.lcName || s.dataset.lcSec,
        itemName: s.dataset.lcItemname || 'Punto', fixed: s.hasAttribute('data-lc-fixed'),
        items: [...s.querySelectorAll('[data-lc-item]')].map(i => i.dataset.lcItem)
      }));
      return { fields: out, sections, seo: seoDefault };
    };

    let lastOn = null;
    const focusKey = key => {
      const f = fields.get(key);
      const el = f ? f.el : document.querySelector('[data-lc-sec="' + key + '"], [data-lc-item="' + key + '"]');
      if (!el || el.offsetParent === null && el.style.display === 'none') return;
      const d = el.closest('details');
      if (d) d.open = true;
      if (lastOn) lastOn.classList.remove('lc-on', 'lc-sec-on');
      el.classList.add(f ? 'lc-on' : 'lc-sec-on');
      lastOn = el;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data) return;
      if (e.data.type === 'lc:apply') apply(e.data.content);
      else if (e.data.type === 'lc:focus') focusKey(e.data.key);
    });
    // Un clic en un texto lo abre en el editor (y no sigue enlaces ni envía el formulario)
    document.addEventListener('click', e => {
      const el = e.target.closest && e.target.closest('[data-lc]');
      if (el) {
        e.preventDefault(); e.stopPropagation();
        if (lastOn) lastOn.classList.remove('lc-on', 'lc-sec-on');
        el.classList.add('lc-on'); lastOn = el;
        send({ type: 'lc:pick', key: el.dataset.lc });
        return;
      }
      const a = e.target.closest && e.target.closest('a[href]');
      if (a && !/^#/.test(a.getAttribute('href'))) e.preventDefault();
    }, true);
    document.addEventListener('submit', e => e.preventDefault(), true);
    send(Object.assign({ type: 'lc:ready' }, list()));
  }

  return { ready, apply, editing };
})();
