'use strict';
/* ======================================================================
   TailRef · Tur T Faz 6 — Arayüz paket deposu + içe aktarım (DOM'lu)
   ======================================================================
   02d saf doğrulayıcıyı kullanır:
   - Depo: localStorage 'tailref-ui-packages' (JSON dizisi; her öğe
     ham paket). Boot'ta HER paket yeniden doğrulanır → bozulmuşsa
     sessizce düşer (self-heal).
   - Enjeksiyon: doğrulanmış paketin derlenmiş CSS'i
     <style data-ui-skin="<id>"> elementine yazılır (link gibi skin
     kaynağıdır; 02c apply() style skin'lerini de açıp kapatır).
   - Kayıt: window.tailrefInterfaces.register() + unregister().
   - İçe aktarım: Ayarlar → Interface → "Import .json" düğmesi;
     FileReader kullanılır — dosya yolu belgeye girmez (güvenlik).
   Depolama limitleri: paket ≤ 64 KB, depo toplam ≤ 256 KB.
   ====================================================================== */

(function () {
  const UI_PKG_KEY = 'tailref-ui-packages';
  const TOTAL_LIMIT = 256 * 1024;

  function readStore() {
    try {
      const raw = localStorage.getItem(UI_PKG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function writeStore(arr) {
    try {
      localStorage.setItem(UI_PKG_KEY, JSON.stringify(arr));
      return true;
    } catch { return false; }
  }
  /** meta.name → güvenli id: ui_slate-test biçimi. */
  function slugId(name) {
    const slug = String(name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'ui';
    return 'ui_' + slug;
  }
  function injectStyle(id, css) {
    let style = document.querySelector('style[data-ui-skin="' + CSS.escape(id) + '"]');
    if (!style) {
      style = document.createElement('style');
      style.dataset.uiSkin = id;
      document.head.appendChild(style);
    }
    style.textContent = css;
    style.media = ''; /* görünür durumda */
    return style;
  }
  function bootstrap() {
    const store = readStore();
    let changed = false;
    for (let i = store.length - 1; i >= 0; i--) {
      const entry = store[i];
      if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') {
        store.splice(i, 1); changed = true; continue;
      }
      let pkg = null;
      try { pkg = JSON.parse(entry.text); } catch { /* bozuk */ }
      const res = window.tailrefUiPackageFormat.validate(pkg, entry.id);
      if (!res.ok) { store.splice(i, 1); changed = true; continue; }
      injectStyle(entry.id, res.css);
      window.tailrefInterfaces.register({
        id: entry.id,
        name: pkg.meta.name,
        desc: pkg.meta.desc || '',
        version: pkg.meta.version || 1,
      });
    }
    if (changed) writeStore(store);
  }
  /** Ham paket metnini doğrula → depola → enjekte et → kaydet. */
  function importText(text) {
    if (typeof text !== 'string' || !text.length) return { ok: false, errors: ['empty file'] };
    if (text.length > window.tailrefUiPackageFormat.MAX_BYTES) {
      return { ok: false, errors: ['package exceeds the 64 KB limit'] };
    }
    let pkg = null;
    try { pkg = JSON.parse(text); } catch (e) {
      return { ok: false, errors: ['JSON could not be parsed: ' + String(e.message).slice(0, 80)] };
    }
    const metaName = pkg && pkg.meta && pkg.meta.name;
    let id = slugId(metaName);
    const existing = readStore();
    if (window.tailrefInterfaces.list().some(d => d.id === id) ||
        existing.some(e => e.id === id)) {
      return { ok: false, errors: ['the same id is already installed: ' + id] };
    }
    const res = window.tailrefUiPackageFormat.validate(pkg, id);
    if (!res.ok) return { ok: false, errors: res.errors.slice(0, 5) };
    let total = existing.reduce((n, e) => n + e.text.length + 32, 0) + text.length;
    if (total > TOTAL_LIMIT) return { ok: false, errors: ['package store is full (256 KB)'] };
    existing.push({ id, text });
    if (!writeStore(existing)) return { ok: false, errors: ['store could not be written'] };
    injectStyle(id, res.css);
    window.tailrefInterfaces.register({
      id, name: pkg.meta.name, desc: pkg.meta.desc || '', version: pkg.meta.version || 1,
    });
    return { ok: true, id, name: pkg.meta.name };
  }
  /** Kurulu paket kaldır: etkinse classic'e dön, style'ı sök, kayıttan düş. */
  function removePackage(id) {
    const store = readStore();
    const idx = store.findIndex(e => e.id === id);
    if (idx < 0) return false;
    if (window.tailrefInterfaces.active() === id) {
      window.tailrefInterfaces.apply('classic');
    }
    const style = document.querySelector('style[data-ui-skin="' + CSS.escape(id) + '"]');
    if (style) style.remove();
    window.tailrefInterfaces.unregister(id);
    store.splice(idx, 1);
    writeStore(store);
    return true;
  }
  /** #settingsInterfacePackages içini kurulu paket satırlarıyla doldur. */
  function renderInstalled(box) {
    if (!box) return;
    const packages = readStore().map(e => e.id);
    const defs = (window.tailrefInterfaces.list() || [])
      .filter(d => d.packaged || packages.includes(d.id));
    box.replaceChildren();
    if (!defs.length) {
      const empty = document.createElement('span');
      empty.className = 'settingsThemeDraftHint';
      empty.textContent = 'No packages installed.';
      box.appendChild(empty);
      return;
    }
    for (const def of defs) {
      const row = document.createElement('div');
      row.className = 'uiPkgRow';
      const name = document.createElement('span');
      name.className = 'settingsThemeCardName';
      name.textContent = def.name;
      const tag = document.createElement('span');
      tag.className = 'settingsThemeCardTag';
      tag.textContent = 'v' + (def.version || 1) + ' · ' + def.id;
      name.appendChild(tag);
      row.appendChild(name);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settingsAction';
      btn.textContent = 'Remove';
      btn.dataset.uiPkg = def.id;
      btn.addEventListener('click', () => {
        if (removePackage(def.id)) {
          try { window.toast('Package removed: ' + def.name); } catch { /* sessiz */ }
          document.dispatchEvent(new CustomEvent('tailref-interface-changed',
            { detail: { removed: def.id } }));
        }
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  /* Dış API */
  window.tailrefUiPackages = {
    importText, removePackage, renderInstalled, bootstrap, slugId,
  };

  /* Boot: depodaki paketleri yeniden doğrula + enjekte et + kaydet.
     02c'in setTimeout(0) apply'ından ÖNCE senkron koşmalı (bu script
     sıralı yüklendiği için öyle olur). */
  try { bootstrap(); } catch { /* sessiz — classic parite */ }

  /* Ayarlar içe aktarım düğmesi (varsa) bağla. */
  function bindImportButton() {
    const btn = document.getElementById('btnUiPackageImport');
    const file = document.getElementById('uiPackageFile');
    if (!btn || !file || btn.dataset.uiPkgBound) return;
    btn.dataset.uiPkgBound = '1';
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = importText(String(reader.result || ''));
        if (res.ok) {
          try { window.toast('Package imported: ' + res.name); } catch { /* sessiz */ }
          document.dispatchEvent(new CustomEvent('tailref-interface-changed',
            { detail: { registered: res.id } }));
        } else {
          try { window.toast(__t('Package rejected') + ': ' + (res.errors[0] || __t('invalid'))); } catch { /* sessiz */ }
        }
        file.value = '';
      };
      reader.readAsText(f);
    });
  }
  setTimeout(bindImportButton, 0);
})();
