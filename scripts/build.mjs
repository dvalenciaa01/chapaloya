/* ==========================================================================
   Compilación para Cloudflare Pages: copia el sitio a dist/ sin comentarios
   --------------------------------------------------------------------------
   El código del repositorio conserva sus comentarios (son la documentación
   del proyecto); lo que se publica sale sin ellos para que no se vean al
   inspeccionar la página.
     - JS y CSS propios: esbuild les quita los comentarios y los espacios
       (minifyWhitespace). No renombra variables ni cambia la lógica; sin
       quitar los espacios, esbuild conserva algunos comentarios //.
     - HTML: se quitan los <!-- … --> y los comentarios de los <script> y
       <style> en línea.
     - js/vendor/ se copia tal cual (librerías ya minificadas; conservan su
       aviso de licencia, que exige la licencia MIT).
   Solo se publica lo que está en PUBLIC: bot/, supabase/, docs/ y los .md
   quedan fuera (no tienen que poder descargarse desde el sitio).

   Uso: npm run build   (Cloudflare Pages: comando "npm run build", salida "dist")
   ========================================================================== */
import { transform } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const PUBLIC = ['assets', 'css', 'js', 'landing', '_headers', '_redirects', 'robots.txt', 'sitemap.xml',
  'index.html', 'barberos.html', 'consultar-cita.html', 'crm.html', 'login.html', 'privacidad.html',
  'reservalope.html', 'reservar.html', 'servicios.html'];
const KEEP_AS_IS = path.join('js', 'vendor');

const opts = { target: 'esnext', legalComments: 'none', charset: 'utf8', minifyWhitespace: true };
// esbuild marca algunas expresiones con /* @__PURE__ */: también se quitan
const stripJs = async (code) => (await transform(code, { ...opts, loader: 'js' })).code.replace(/\/\* @__PURE__ \*\/\s*/g, '');
const stripCss = async (code) => (await transform(code, { ...opts, loader: 'css' })).code;

// Reemplazo asíncrono: String.replace no espera promesas
async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}

async function stripHtml(html) {
  // Primero los bloques en línea, para que un "<!--" dentro de un script no confunda
  const blocks = [];
  html = await replaceAsync(html, /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, async (all, open, body, close) => {
    if (/\bsrc=/i.test(open) || !body.trim() || (/\btype=/i.test(open) && !/type=["']?(text\/javascript|module)/i.test(open))) {
      blocks.push(all);
    } else {
      blocks.push(open + '\n' + (await stripJs(body)).trim() + '\n' + close);
    }
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  html = await replaceAsync(html, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, async (all, open, body, close) => {
    blocks.push(open + '\n' + (await stripCss(body)).trim() + '\n' + close);
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  html = html.replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n?/g, '');
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

async function build(rel) {
  const src = path.join(ROOT, rel), dst = path.join(OUT, rel);
  const entries = await readdir(src, { withFileTypes: true }).catch(() => null);
  if (entries) {
    await mkdir(dst, { recursive: true });
    for (const e of entries) await build(path.join(rel, e.name));
    return;
  }
  const ext = path.extname(rel).toLowerCase();
  const asIs = rel.startsWith(KEEP_AS_IS + path.sep);
  if (!asIs && (ext === '.js' || ext === '.css' || ext === '.html')) {
    const code = await readFile(src, 'utf8');
    const out = ext === '.js' ? await stripJs(code) : ext === '.css' ? await stripCss(code) : await stripHtml(code);
    await writeFile(dst, out);
  } else {
    await copyFile(src, dst);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const rel of PUBLIC) await build(rel);
console.log('Sitio listo en dist/ (sin comentarios).');
