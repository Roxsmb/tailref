'use strict';
/* ======================================================================
   TailRef · Tur T Faz 2 — Özel tema kayıt defteri (15 Kasım 2026)
   ======================================================================
   Gömülü 10 tema (19-themes-effects.js) DOKUNULMAZ; bu modül onların
   ÜSTÜNE özel temalar ekler. Özel tema, mevcut mekanizmaya biner:
   her özel tema için üretim zamanında bir CSS kuralı üretilir
   (:root[data-theme="<id>"] — 7 çekirdek değişken + #backdrop) ve id
   themeNames'e runtime'da eklenir. Böylece applyTheme/mod-temaları/
   boot geri yükleme/select senkronu HİÇ değişmeden çalışır (parite).

   Depo: localStorage 'tailref-custom-themes' (JSON dizisi). Anahtar
   'tailref-' önekli olduğundan tercih yedeği whitelist'ine otomatik
   girer (60-settings-hub settingsPrefsKeys önek filtresi).

   Veri: { id, name, colors{bg,panel,border,text,dim,accent,accentInk},
          panelAlpha (40-100), backdrop{image|null,position,size,
          opacity,blur}, createdAt }
   Renkler hex; panel = rgba(panelHex, panelAlpha/100).
   ====================================================================== */

const THEME_REG_KEY = 'tailref-custom-themes';
const THEME_REG_MAX = 30;
const THEME_COLOR_SLOTS = ['bg', 'panel', 'border', 'text', 'dim', 'accent', 'accentInk'];
/* native title yasak kanalına uygun: dinamik düğmeler data-tooltip kullanır */
const THEME_SLOT_LABELS = {
  bg: 'Background', panel: 'Panel surface', border: 'Borders', text: 'Text',
  dim: 'Secondary text', accent: 'Accent', accentInk: 'Text over accent',
};

function themeRegRead() {
  try {
    const raw = localStorage.getItem(THEME_REG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(t => t && typeof t.id === 'string' && t.id.startsWith('ct_')
      && t.colors && typeof t.name === 'string');
  } catch { return []; }
}
function themeRegWrite(list) {
  try { localStorage.setItem(THEME_REG_KEY, JSON.stringify(list)); } catch { /* sessiz */ }
  document.dispatchEvent(new CustomEvent('tailref-custom-themes-changed'));
}

/* ---- hex yardımcıları ---- */
function themeRegClampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function themeRegHexToRgb(hex) {
  let h = String(hex || '').trim();
  if (h.startsWith('rgb')) {
    const m = h.match(/[\d.]+/g) || [];
    return { r: +m[0] || 0, g: +m[1] || 0, b: +m[2] || 0 };
  }
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length < 6) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function themeRegRgbToHex(r, g, b) {
  const p = v => themeRegClampByte(v).toString(16).padStart(2, '0');
  return '#' + p(r) + p(g) + p(b);
}
function themeRegMix(a, b, t) {
  const A = themeRegHexToRgb(a), B = themeRegHexToRgb(b);
  return themeRegRgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}
function themeRegLuma(hex) {
  const { r, g, b } = themeRegHexToRgb(hex);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}
function themeRegSat(hex) {
  const { r, g, b } = themeRegHexToRgb(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
function themeRegAccentInkFor(hex) {
  return themeRegLuma(hex) > 0.62 ? '#0d1013' : '#ffffff';
}
/* Accent modülüyle aynı kural — tek kaynak (62-settings-extended
   settingAccentInkFor yoksa kendi hesabımız kullanılır). */

/* ---- CSS üretimi ---- */
let themeRegStyleEl = null;
function themeRegStyleSheet() {
  if (themeRegStyleEl && document.getElementById('tailrefCustomThemeStyles')) return themeRegStyleEl;
  themeRegStyleEl = document.getElementById('tailrefCustomThemeStyles');
  if (!themeRegStyleEl) {
    themeRegStyleEl = document.createElement('style');
    themeRegStyleEl.id = 'tailrefCustomThemeStyles';
    (document.head || document.documentElement).appendChild(themeRegStyleEl);
  }
  return themeRegStyleEl;
}
function themeRegRuleFor(theme) {
  const c = theme.colors || {};
  const hex = k => themeRegSanitizeHex(c[k]);
  const alpha = Math.max(40, Math.min(100, +theme.panelAlpha || 94)) / 100;
  const pv = themeRegHexToRgb(hex('panel'));
  const panel = `rgba(${pv.r},${pv.g},${pv.b},${alpha})`;
  let css = `:root[data-theme="${theme.id}"]{` +
    `--bg:${hex('bg')};--panel:${panel};--border:${hex('border')};` +
    `--text:${hex('text')};--dim:${hex('dim')};--accent:${hex('accent')};` +
    `--accent-ink:${themeRegAccentInkFor(hex('accent'))};}`;
  const bd = theme.backdrop || null;
  if (bd && bd.image) {
    const blur = Math.max(0, Math.min(40, +bd.blur || 0));
    const op = Math.max(0.05, Math.min(1, +bd.opacity || 1));
    css += `:root[data-theme="${theme.id}"] #backdrop{` +
      `background-color:${hex('bg')};` +
      `background-image:url("${bd.image}");` +
      `background-position:${bd.position || 'center'};` +
      `background-size:${bd.size || 'cover'};background-repeat:no-repeat;` +
      `opacity:${op};filter:blur(${blur}px);}`;
  } else {
    css += `:root[data-theme="${theme.id}"] #backdrop{` +
      `background:radial-gradient(120% 90% at 70% -10%,` +
      `color-mix(in srgb, var(--accent) 9%, var(--bg)), var(--bg));` +
      `opacity:1;filter:none;}`;
  }
  return css;
}
function themeRegSanitizeHex(v) {
  const m = String(v || '').match(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  return m ? m[0] : '#4da3ff';
}
function themeRegRebuildRules() {
  const sheet = themeRegStyleSheet();
  const list = themeRegRead();
  sheet.textContent = list.map(themeRegRuleFor).join('\n');
}

/* ---- themeNames uzantısı: 19-themes-effects dizisine runtime'da ---- */
function themeRegExtendNames(list) {
  const names = (typeof themeNames === 'object' && themeNames) ? themeNames : null;
  if (!names) return;
  for (const t of list) if (!names.includes(t.id)) names.push(t.id);
  /* Silinen özel temaları diziden düşür (applyTheme guard'ı doğru kalsın) */
  for (let i = names.length - 1; i >= 0; i--) {
    const n = names[i];
    if (n.startsWith('ct_') && !list.some(t => t.id === n)) names.splice(i, 1);
  }
}

/* ---- genel API ---- */
function themeRegList() { return themeRegRead(); }
function themeRegIsCustom(id) { return themeRegRead().some(t => t.id === id); }
function themeRegActive() {
  try { return localStorage.getItem('tailref-theme') || 'classic'; } catch { return 'classic'; }
}
function themeRegEnsureRule(theme) {
  const sheet = themeRegStyleSheet();
  if (!sheet.textContent.includes(`data-theme="${theme.id}"`)) {
    sheet.textContent += '\n' + themeRegRuleFor(theme);
  }
}
function themeRegApply(id) {
  const list = themeRegRead();
  const theme = list.find(t => t.id === id);
  if (theme) { themeRegEnsureRule(theme); themeRegExtendNames(list); }
  if (typeof applyTheme === 'function') applyTheme(id);
  return !!theme || (typeof themeNames === 'object' && themeNames.includes(id));
}
function themeRegNewId() { return 'ct_' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
function themeRegValidate(theme) {
  if (!theme || typeof theme.name !== 'string' || !theme.name.trim()) return 'isim boş';
  if (theme.name.trim().length > 40) return 'isim uzun';
  const c = theme.colors || {};
  for (const k of THEME_COLOR_SLOTS) if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(c[k] || ''))) return 'renk bozuk: ' + k;
  if (theme.backdrop && theme.backdrop.image) {
    if (typeof theme.backdrop.image !== 'string' || !theme.backdrop.image.startsWith('data:image/')) return 'görsel bozuk';
    if (theme.backdrop.image.length > 1_600_000) return 'görsel çok büyük';
  }
  return null;
}
/** Kaydet/güncelle. asNew=true → daima yeni id. overwriting mevcut id
    ise üzerine yazar (çağıran taraf onayı sorar — spec kuralı). */
function themeRegSave(draft, asNew) {
  const err = themeRegValidate(draft);
  if (err) return { ok: false, error: err };
  const list = themeRegRead();
  if (list.length >= THEME_REG_MAX && (!draft.id || !list.some(t => t.id === draft.id))) {
    return { ok: false, error: 'limit' };
  }
  let id = draft.id;
  if (!id || asNew || !list.some(t => t.id === id)) {
    id = themeRegNewId();
    const entry = {
      id, name: draft.name.trim(), colors: { ...draft.colors },
      panelAlpha: Math.max(40, Math.min(100, +draft.panelAlpha || 94)),
      backdrop: draft.backdrop ? { ...draft.backdrop } : null,
      createdAt: Date.now(),
    };
    list.push(entry);
  } else {
    const t = list.find(x => x.id === id);
    t.name = draft.name.trim();
    t.colors = { ...draft.colors };
    t.panelAlpha = Math.max(40, Math.min(100, +draft.panelAlpha || 94));
    t.backdrop = draft.backdrop ? { ...draft.backdrop } : null;
  }
  themeRegWrite(list);
  themeRegRebuildRules();
  themeRegExtendNames(list);
  if (typeof applyTheme === 'function') applyTheme(id);
  return { ok: true, id };
}
function themeRegRename(id, name) {
  const list = themeRegRead();
  const t = list.find(x => x.id === id);
  if (!t || !String(name || '').trim()) return { ok: false, error: 'yok' };
  t.name = String(name).trim().slice(0, 40);
  themeRegWrite(list);
  themeRegRebuildRules();
  return { ok: true };
}
function themeRegDuplicate(id) {
  const list = themeRegRead();
  const src = list.find(x => x.id === id);
  if (!src) return { ok: false, error: 'yok' };
  if (list.length >= THEME_REG_MAX) return { ok: false, error: 'limit' };
  const copy = {
    id: themeRegNewId(), name: (src.name + ' — copy').slice(0, 40),
    colors: { ...src.colors }, panelAlpha: src.panelAlpha,
    backdrop: src.backdrop ? { ...src.backdrop } : null, createdAt: Date.now(),
  };
  list.push(copy);
  themeRegWrite(list);
  themeRegRebuildRules();
  themeRegExtendNames(list);
  return { ok: true, id: copy.id };
}
function themeRegDelete(id) {
  const list = themeRegRead();
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return { ok: false, error: 'yok' };
  list.splice(i, 1);
  themeRegWrite(list);
  themeRegRebuildRules();
  themeRegExtendNames(list);
  const active = themeRegActive();
  if (active === id && typeof applyTheme === 'function') applyTheme('classic');
  return { ok: true };
}
function themeRegSetImage(id, dataUrl, opts) {
  const list = themeRegRead();
  const t = list.find(x => x.id === id);
  if (!t) return { ok: false, error: 'yok' };
  if (dataUrl && (!String(dataUrl).startsWith('data:image/') || dataUrl.length > 1_600_000)) {
    return { ok: false, error: 'görsel bozuk' };
  }
  t.backdrop = dataUrl ? {
    image: dataUrl, position: opts && opts.position || 'center',
    size: opts && opts.size || 'cover',
    opacity: Math.max(0.05, Math.min(1, +(opts && opts.opacity) || 1)),
    blur: Math.max(0, Math.min(40, +(opts && opts.blur) || 0)),
  } : null;
  themeRegWrite(list);
  themeRegRebuildRules();
  if (themeRegActive() === id) themeRegApply(id);
  return { ok: true };
}

/* ---- palet çıkarma (yerel, median-cut; harici servis yok) ---- */
function themeRegLoadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = dataUrl;
  });
}
/** dataUrl → { palette:string[6], slots:{bg,panel,...} } — slot
    atamaları sezgisel (kullanıcı editörde değiştirebilir). */
async function themeRegExtractPalette(dataUrl) {
  const img = await themeRegLoadImage(dataUrl);
  const scale = Math.min(1, 128 / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    px.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!px.length) throw new Error('boş görsel');
  /* median-cut: en geniş kanaldan ortanca ile böl, 6 kova */
  let buckets = [px];
  while (buckets.length < 6) {
    let bi = -1, bc = null, br = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 255, mx = 0;
        for (const p of b) { if (p[ch] < mn) mn = p[ch]; if (p[ch] > mx) mx = p[ch]; }
        const range = mx - mn;
        if (range > br) { br = range; bi = i; bc = ch; }
      }
    }
    if (bi < 0) break;
    const b = buckets[bi].slice().sort((x, y) => x[bc] - y[bc]);
    const mid = b.length >> 1;
    buckets.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  const palette = buckets.map(b => {
    let r = 0, gg = 0, bl = 0;
    for (const p of b) { r += p[0]; gg += p[1]; bl += p[2]; }
    const n = Math.max(1, b.length);
    return themeRegRgbToHex(r / n, gg / n, bl / n);
  }).filter((h, i, a) => a.indexOf(h) === i);
  /* slot atamaları */
  const byLuma = palette.slice().sort((a, b2) => themeRegLuma(a) - themeRegLuma(b2));
  const bg = byLuma[0] || '#15151a';
  const text = byLuma[byLuma.length - 1] || '#e7e7ee';
  const accent = palette.slice().sort((a, b2) =>
    themeRegSat(b2) * (1 - Math.abs(themeRegLuma(b2) - 0.5)) -
    themeRegSat(a) * (1 - Math.abs(themeRegLuma(a) - 0.5)))[0] || '#4da3ff';
  const panelBase = byLuma[1] || bg;
  const slots = {
    bg, text, accent,
    panel: panelBase,
    border: themeRegMix(text, bg, 0.8),   /* text %20 + bg %80 */
    dim: themeRegMix(text, bg, 0.55),
    accentInk: themeRegAccentInkFor(accent),
  };
  return { palette, slots };
}
/** dataUrl'i toleranslı küçültür: uzun kenar ≤1600px, JPEG q.82. */
async function themeRegDownscale(dataUrl) {
  const img = await themeRegLoadImage(dataUrl);
  const scale = Math.min(1, 1600 / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', 0.82);
}

window.tailrefThemeRegistry = {
  slots: THEME_COLOR_SLOTS,
  slotLabels: THEME_SLOT_LABELS,
  list: themeRegList,
  isCustom: themeRegIsCustom,
  active: themeRegActive,
  apply: themeRegApply,
  save: themeRegSave,
  rename: themeRegRename,
  duplicate: themeRegDuplicate,
  delete: themeRegDelete,
  setImage: themeRegSetImage,
  extractPalette: themeRegExtractPalette,
  downscale: themeRegDownscale,
  accentInkFor: themeRegAccentInkFor,
  mix: themeRegMix,
};

/* Boot: 19-themes-effects modülünün kendi boot'u (applyTheme) modül
   değerlendirme sırasında çalışır; biz daha ÖNCE yüklendiğimiz için
   ertelenmiş boot ile kuralları hazırlar, themeNames'i genişletir ve
   kayıtlı özel tema gerçekte uygulamadaysa onu gerçekten uygular
   (19-themes'in applyTheme guard'ı bilinmeyen id'yi classic'e
   düşürürdü — parite bozulmasın diye burada düzeltilir). */
setTimeout(() => {
  try {
    const list = themeRegRead();
    themeRegExtendNames(list);
    themeRegRebuildRules();
    const active = themeRegActive();
    if (list.some(t => t.id === active)) themeRegApply(active);
  } catch { /* sessiz — parite: özel tema yoksa davranış yok */ }
}, 0);
