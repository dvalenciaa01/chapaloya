function readAndCompressImage(file, maxWidth = 720, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* Logo de un negocio: el sistema lo deja listo para la web y el CRM, venga
   como venga.
   - Recorta el margen vacío: transparente, o del color de fondo cuando las
     cuatro esquinas son del mismo color. Así el dibujo ocupa el alto completo
     disponible y no se ve pequeño.
   - Conserva la transparencia (WebP; PNG si el navegador no genera WebP).
   - Lo limita a 800 × 400 px sin deformarlo. Un SVG se convierte a imagen. */
function readLogoImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try { resolve(prepareLogo(img)); } catch (err) { reject(err); }
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* Quita el fondo liso de un logo: cada píxel del color del fondo pasa a
   transparente, también los huecos encerrados (el centro de una O, el
   interior de un círculo). El contorno del dibujo queda suave (alfa parcial y
   color sin el tinte del fondo) para que no se vea un filo. */
function removeSolidBackground(px, w, h, bg) {
  const HARD = 28, SOFT = 90;           // distancia al fondo: ≤ HARD se borra; hasta SOFT, borde suave
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2]));
    if (d >= SOFT) continue;
    if (d <= HARD) { px[i + 3] = 0; continue; }
    const a = (d - HARD) / (SOFT - HARD);
    for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, Math.round((px[i + c] - bg[c] * (1 - a)) / a)));
    px[i + 3] = Math.round(255 * a);
  }
}

/* Logo ya subido con fondo liso (por ejemplo, un JPG con fondo blanco): se
   limpia al mostrarlo. Devuelve una imagen con fondo transparente, o null si
   el logo ya tenía transparencia, no tiene fondo liso o no se pudo leer. */
function cleanLogoURL(src) {
  const KEY = 'logo-limpio:' + src;
  try { const hit = sessionStorage.getItem(KEY); if (hit) return Promise.resolve(hit === '-' ? null : hit); } catch (e) { /* sin almacenamiento */ }
  return new Promise((resolve) => {
    if (!src || /^data:image\/(svg|webp|png)/.test(src)) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let out = null;
      try { out = prepareLogo(img, 800, 400, { onlyIfSolid: true }); } catch (e) { out = null; }
      try { sessionStorage.setItem(KEY, out || '-'); } catch (e) { /* lleno o sin almacenamiento */ }
      resolve(out);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function prepareLogo(img, maxW = 800, maxH = 400, opts) {
  // 1. Lienzo de trabajo (hasta 2000 px; un SVG sin tamaño se toma de 800 × 400)
  let w = img.naturalWidth || img.width || maxW;
  let h = img.naturalHeight || img.height || maxH;
  const k = Math.min(1, 2000 / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(img, 0, 0, w, h);
  const px = wctx.getImageData(0, 0, w, h).data;

  // 2. ¿Qué es margen vacío? Lo transparente o, si no hay transparencia,
  //    el color de las esquinas cuando las cuatro coinciden
  let transparent = false;
  for (let i = 3; i < px.length; i += 4) { if (px[i] < 250) { transparent = true; break; } }
  const at = (x, y) => (y * w + x) * 4;
  const bg = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].map(i => [px[i], px[i + 1], px[i + 2]]);
  const close = (i, c, tol) => Math.abs(px[i] - c[0]) <= tol && Math.abs(px[i + 1] - c[1]) <= tol && Math.abs(px[i + 2] - c[2]) <= tol;
  const solid = !transparent && bg.every(c => Math.abs(c[0] - bg[0][0]) <= 16 && Math.abs(c[1] - bg[0][1]) <= 16 && Math.abs(c[2] - bg[0][2]) <= 16);
  if (opts && opts.onlyIfSolid && !solid) return null;
  // Fondo liso: se vuelve transparente (solo lo que toca el borde, no los huecos del dibujo)
  if (solid) {
    removeSolidBackground(px, w, h, bg[0]);
    wctx.putImageData(new ImageData(px, w, h), 0, 0);
    transparent = true;
  }
  const isEmpty = (i) => transparent ? px[i + 3] <= 12 : close(i, bg[0], 24);

  // 3. Caja del dibujo (sin margen vacío alrededor)
  let left = 0, top = 0, right = w - 1, bottom = h - 1;
  if (transparent || solid) {
    let l = w, t = h, r = -1, b = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isEmpty(at(x, y))) continue;
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
    if (r >= 0) {
      // Con fondo transparente, un respiro mínimo (2 %) para que el borde del
      // dibujo no quede cortado; con fondo de color, ninguno (se vería como un filo)
      const pad = transparent ? Math.round(Math.max(r - l + 1, b - t + 1) * 0.02) : 0;
      left = Math.max(0, l - pad); top = Math.max(0, t - pad);
      right = Math.min(w - 1, r + pad); bottom = Math.min(h - 1, b + pad);
    }
  }
  const cw = right - left + 1, ch = bottom - top + 1;

  // 4. Tamaño final, sin deformar
  const s = Math.min(1, maxW / cw, maxH / ch);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * s));
  out.height = Math.max(1, Math.round(ch * s));
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(work, left, top, cw, ch, 0, 0, out.width, out.height);

  // 5. Formato que conserva la transparencia
  const webp = out.toDataURL('image/webp', 0.92);
  if (webp.indexOf('data:image/webp') === 0) return webp;
  return transparent ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.92);
}
