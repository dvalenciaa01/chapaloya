/* ==========================================================================
   Pantalla de carga de la web pública
   --------------------------------------------------------------------------
   Mientras se piden los datos del negocio y su tipografía, la página está
   oculta (html.brand-pending, ver publico.css). En su lugar se muestra el
   logo del negocio (o su nombre) con una barra animada en su color.
   El logo, nombre y colores se recuerdan de la visita anterior
   (TenantBrand.rememberBrand); en la primera visita solo se ve la barra.
   Se carga en <head>, justo después de routes.js.
   ========================================================================== */
(function () {
  'use strict';
  var KEY = 'RL_MARCA_';
  var HEX = /^#[0-9a-fA-F]{6}$/;

  function slug() {
    var s = null;
    try { s = new URLSearchParams(location.search).get('b'); } catch (e) { s = null; }
    if (!s && window.Routes && Routes.pathSlug) s = Routes.pathSlug();
    if (!s) { try { s = sessionStorage.getItem('BARBERSUITE_PUBLIC_SLUG'); } catch (e) { s = null; } }
    return s;
  }

  function remembered(s) {
    if (!s) return null;
    try {
      var m = JSON.parse(localStorage.getItem(KEY + s) || 'null');
      return (m && typeof m === 'object') ? m : null;
    } catch (e) { return null; }
  }

  function build() {
    var root = document.documentElement;
    if (!root.classList.contains('brand-pending') || document.getElementById('page-loader')) return;
    var m = remembered(slug()) || {};
    var box = document.createElement('div');
    box.id = 'page-loader';
    box.className = 'page-loader';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-label', 'Cargando');
    if (HEX.test(m.tertiary || '')) box.style.setProperty('--loader-bg', m.tertiary);
    if (HEX.test(m.primary || '')) box.style.setProperty('--loader-fg', m.primary);
    if (HEX.test(m.accent || '')) box.style.setProperty('--loader-accent', m.accent);
    if (typeof m.logo === 'string' && /^https:\/\/[^\s"'<>()]+$/i.test(m.logo)) {
      var img = document.createElement('img');
      img.className = 'page-loader-logo';
      img.src = m.logo;
      img.alt = '';
      box.appendChild(img);
    } else if (typeof m.name === 'string' && m.name.trim()) {
      var name = document.createElement('span');
      name.className = 'page-loader-name';
      name.textContent = m.name.trim().slice(0, 60);
      box.appendChild(name);
    }
    var bar = document.createElement('span');
    bar.className = 'page-loader-bar';
    box.appendChild(bar);
    document.body.insertBefore(box, document.body.firstChild);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
