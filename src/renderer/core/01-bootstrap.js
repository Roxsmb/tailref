/* TailRef app · bootstrap · DOM refs, motion helpers, item count */
'use strict';

/* =========================================================
   TailRef — sonsuz referans tahtası
   Bağımlılık yok. Görseller + yerleşim IndexedDB'de saklanır.
   ========================================================= */

const $ = (s, r = document) => r.querySelector(s);

/* Bloksuz onay: renderer'ın senkron window.confirm()'ü pencereyi KİLİTLİYOR
   ve Electron confirm'ü beklerken bir çekirdeği boş döngüde çeviriyordu
   (çift tık E2E bulgusu). Elektron'da soru ana sürece gider; yerel kutu
   pencereye bağlıdır, renderer await eder — blok yok. Diğer ortamlar
   (tarayıcı sekmesi) senkron confirm'e düşer; test otomasyonu
   window.__tailrefConfirmBypass = true ile stub yolunu seçer. */
window.__tailrefConfirmBypass = false;
async function appConfirm(message, detail, params) {
  if (!window.__tailrefConfirmBypass &&
      window.tailref && typeof window.tailref.confirmDialog === 'function') {
    try {
      const r = await window.tailref.confirmDialog(String(message), String(detail || ''), params || null);
      return r === 0;
    } catch { /* kutu açılamadı: senkron yola düş */ }
  }
  return !!window.confirm(String(message));
}
window.appConfirm = appConfirm;

/* AÇILIŞ DAMGALARI: hangi aşama ne kadar sürer? (perf-diag paneli okur)
   Sonda/'da ve zayıf makinelerde açılış yavaşlamasını aşama aşama
   görmek için; hiçbir davranış değişimi yapmaz. */
window.__bootMark = ad => {
  try {
    (window.__bootMarks = window.__bootMarks || []).push(
      ad + ' @' + Math.round(performance.now()) + ' ms');
  } catch { /* sessiz */ }
};
window.__bootMark('js-boot');

/* =========================================================
   Tercih yardımcıları — sektör standardı ayarlar (15 Kasım 2026).
   Hepsi localStorage okur; anahtar yoksa/bozuksa MEVCUT davranış
   döner (parite kuralı). Ayar arayüzü 60-settings-hub'da.
   ========================================================= */

/** Geri alma adım sınırı (Photoshop "History States" karşılığı).
 *  Boş → her yığın kendi mevcut sınırını korur (editör 30, tahta 60).
 *  5–200 adım; bellek bütçeleri (raster-drop + History byte budget)
 *  adım sınırından bağımsız olarak her zaman devrede. */
window.tailrefUndoLimit = function (fallback) {
  try {
    const v = parseInt(localStorage.getItem('tailref-undo-steps'), 10);
    if (Number.isFinite(v)) return Math.min(200, Math.max(5, v));
  } catch { /* sessiz */ }
  return fallback;
};

/** Tekerlek yönünü tersine çevirme (doğal kaydırma). */
window.tailrefWheelInvert = function () {
  try { return localStorage.getItem('tailref-wheel-invert') === '1'; } catch { return false; }
};

/** Tekerlekle yakınlaştır (tahta). Varsayılan açık — mevcut davranış. */
window.tailrefWheelZoom = function () {
  try {
    const v = localStorage.getItem('tailref-wheel-zoom');
    return v === null || v === '' || v === '1';
  } catch { return true; }
};

/* İlk frame paint sinyali: transparent pencere Windows'ta ilk DWM karesi
   boyanana kadar beyaz görünür. İki rAF = ilk kare elmasta;
   o noktada ana süreç pencereyi görünür kılar (beyaz flash önleme). */
if (window.tailref && typeof window.tailref.revealMainWindow === 'function') {
  const reveal = () => window.tailref.revealMainWindow();
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      requestAnimationFrame(() => requestAnimationFrame(reveal));
    }, { once: true });
  }
}

/* =========================================================
   Bir seferlik köprü: önceki sürümün localStorage anahtarları
   mevcut marka adına taşınır (görsel ayarlar/kısayollar korunur).
   Eski marka adı koda çıplak yazılmaz; base64 ile açılır.
   ========================================================= */
(function bridgeLegacyLocalKeys() {
  try {
    const LEG_A = atob('cHVyZXNjYXBl'); /* old-marka-a */
    const LEG_B = atob('cmVmYm9hcmQ='); /* old-marka-b */
    const LEG_C = atob('cmVmZXZlcnI='); /* old-marka-c */
    const swapCase = (k, from, to) => {
      let i = 0, out = '';
      while (i < k.length) {
        const m = k.slice(i).toLowerCase().indexOf(from.toLowerCase());
        if (m < 0) { out += k.slice(i); break; }
        out += k.slice(i, i + m) + to;
        i += m + from.length;
      }
      return out;
    };
    const LEGS = [[LEG_A, 'tailref'], [LEG_B, 'tailref'], [LEG_C, 'tailref']];
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) {
      if (!k) continue;
      const low = k.toLowerCase();
      let nk = null;
      for (const [leg, to] of LEGS) {
        if (low.includes(leg.toLowerCase())) { nk = swapCase(k, leg, to); break; }
      }
      if (!nk || nk === k) continue;
      const v = localStorage.getItem(k);
      if (localStorage.getItem(nk) == null && v != null) localStorage.setItem(nk, v);
      try { localStorage.removeItem(k); } catch { /* destroyed'da yok */ }
    }
  } catch { /* sessiz */ }
})();

const stage     = $('#stage');
const world     = $('#world');
const backdropEl = $('#backdrop');
const marqueeEl = $('#marquee');
const groupFramesEl = $('#groupFrames');
const groupFrameEls = new Map();
const hintEl    = $('#hint');
const zoomEl    = $('#zoom');
const countEl   = $('#count');
const fileInput = $('#fileInput');
const helpEl    = $('#help');

/* =========================================================
   Motion yardımcıları
   Paneller hidden olmadan önce çıkış animasyonu oynar; öğeler
   eklenirken/silinirken staggered transform + opacity kullanır.
   ========================================================= */
const motionReducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const panelEnterTimers = new WeakMap();
const panelHideStates = new WeakMap();
const ITEM_EXIT_MS = 190;

function motionReduced() {
  /* Erişilebilirlik (Faz 2): Ayarlar > Accessibility'deki "Reduce motion"
     sistem tercihinden bağımsız olarak animasyonları kapatır. */
  try { if (document.documentElement.dataset.reduceMotion === '1') return true; } catch { /* sessiz */ }
  return motionReducedQuery.matches;
}

function isPanelVisible(el) {
  return !!el && !el.hidden && !el.classList.contains('panel-leaving');
}

function showPanel(el) {
  if (!el) return;
  /* Ayrı pencerede yaşayan panel ana pencerede tekrar görünmemeli. */
  if (el.dataset && el.dataset.detached === '1') return;
  const pending = panelHideStates.get(el);
  if (pending) {
    clearTimeout(pending.timer);
    panelHideStates.delete(el);
  }
  const wasHidden = el.hidden || el.classList.contains('panel-leaving');
  el.classList.remove('panel-leaving');
  el.hidden = false;
  /* Panel görünür olduğunda tema değişimi sırada bayat kalan önizlemeleri
     boşalt (gizliyken boyama yapılmamıştı — darbokaz düzeltmesi). */
  if (typeof inkPreviewFlushStale === 'function') {
    try { inkPreviewFlushStale(); } catch { /* sessiz */ }
  }
  /* Görünen her yüzen panel bandın en üstüne gelir. Aksi halde yeni açılan
     bir panel, daha önce öne alınmış bir panelin arkasında kalabiliyordu. */
  if (el.dataset.floatingPanel === 'true') raiseFloatingPanel(el);
  if (!wasHidden || motionReduced()) return;

  // Önce ölçülebilir, animasyonsuz bir kare: prepareFloatingPanel()
  // paneli scale/translate etkisi altında yanlış ölçmesin.
  el.classList.remove('panel-enter');
  el.classList.add('panel-preenter');
  requestAnimationFrame(() => {
    if (el.hidden || !el.classList.contains('panel-preenter')) return;
    el.classList.remove('panel-preenter');
    void el.offsetWidth;
    el.classList.add('panel-enter');
    clearTimeout(panelEnterTimers.get(el));
    panelEnterTimers.set(el, setTimeout(() => {
      el.classList.remove('panel-enter');
      panelEnterTimers.delete(el);
    }, 640));
  });
}

function hidePanel(el, after) {
  if (!el) { if (after) after(); return; }
  /* Tam ekran görünümü kapatmadan panel gizlenmesin. */
  if (el.classList && el.classList.contains('browser-fullscreen')
      && typeof exitBrowserPanelFullscreen === 'function') {
    exitBrowserPanelFullscreen(el);
  }
  /* Ayrı penceredeki paneli kapatmak, uygulama içindekiyle aynı davranış:
     panel kapanır; menüden yeniden açılabilir. */
  if (el.dataset && el.dataset.detached === '1'
      && typeof tailrefCloseDetachedPanel === 'function') {
    tailrefCloseDetachedPanel(el, false);
    if (after) after();
    return;
  }
  if (el.hidden) {
    el.classList.remove('panel-leaving');
    if (after) after();
    return;
  }
  const pending = panelHideStates.get(el);
  if (pending) {
    if (after) pending.after = after;
    return;
  }

  clearTimeout(panelEnterTimers.get(el));
  panelEnterTimers.delete(el);
  el.classList.remove('panel-enter', 'panel-preenter');

  if (motionReduced()) {
    el.hidden = true;
    el.classList.remove('panel-leaving');
    if (after) after();
    return;
  }

  el.classList.add('panel-leaving');
  const state = { timer: null, after };
  state.timer = setTimeout(() => {
    el.hidden = true;
    el.classList.remove('panel-leaving');
    panelHideStates.delete(el);
    if (state.after) state.after();
  }, 200);
  panelHideStates.set(el, state);
}

function retireItemEl(el) {
  if (!el || el.classList.contains('item-leaving')) return;
  el.classList.remove('item-enter');
  el.classList.add('item-leaving');
  el.style.pointerEvents = 'none';
  setTimeout(() => el.remove(), ITEM_EXIT_MS + 40);
}

function setItemCountLabel() {
  if (!countEl) return;
  const label = itemLabel();
  if (countEl.textContent === label) return;
  countEl.textContent = label;
  countEl.classList.remove('count-pop');
  void countEl.offsetWidth;
  countEl.classList.add('count-pop');
}

/* ---------------- ayarlar ---------------- */
const MIN_SCALE   = 0.02;
const MAX_SCALE   = 40;
const MIN_SIZE    = 24;          // dünya birimi
const FONT_SIZE   = 34;

/* Yeni metin varsayılanları (aday 7): tahtaya yeni eklenen yazı
   öğesinin punto/ailesi. Anahtar yoksa/bozuksa mevcut davranış
   (FONT_SIZE ve CSS ailesi). Aileler güvenli listeye tabidir. */
window.__TailRef_TEXT_FAMILIES = [
  'Inter',
  'Georgia',
  'Arial',
  'Verdana',
  'Impact',
  "'Comic Sans MS'",
  "'Courier New'",
  "'Times New Roman'",
];
window.tailrefTextDefaults = function () {
  const out = { size: FONT_SIZE, family: '' };
  try {
    const s = Number(localStorage.getItem('tailref-text-default-size'));
    if (Number.isFinite(s) && s >= 8 && s <= 400) out.size = Math.round(s);
    const f = localStorage.getItem('tailref-text-default-family');
    if (typeof f === 'string' && window.__TailRef_TEXT_FAMILIES.includes(f)) out.family = f;
  } catch { /* sessiz */ }
  return out;
};
const SAVE_DEBOUNCE = 400;
const INIT_IMAGE_CONCURRENCY = 6;
const TRASH_RETENTION_DEFAULT = 10;
const TRASH_RETENTION_KEY = 'tailref-trash-retention';
let trashRetentionMinutes = TRASH_RETENTION_DEFAULT;
try {
  const stored = Number(localStorage.getItem(TRASH_RETENTION_KEY));
  if (Number.isFinite(stored) && stored >= 1) {
    trashRetentionMinutes = Math.min(1440, Math.max(1, Math.round(stored)));
  }
} catch { /* sessiz */ }
const HANDLES = [
  [-1,-1,'nw'], [-1,0,'w'], [-1,1,'sw'],
  [ 0,-1,'n'],              [ 0,1,'s'],
  [ 1,-1,'ne'], [ 1,0,'e'], [ 1,1,'se'],
];

/* ---------------- önemli işaret renkleri ----------------
   Her "önemli" işaretlemede paletten rastgele bir renk atanır.
   (Eski kayıtlarda renk yoksa kırmızıya düşer.) */
const IMP_PALETTE = [
  '#ff3b30', // kırmızı
  '#ff9500', // turuncu
  '#ffd60a', // sarı
  '#32d74b', // yeşil
  '#00c7be', // turkuaz
  '#0a84ff', // mavi
  '#5e5ce6', // çivit
  '#bf5af2', // mor
  '#ff2d95', // pembe
  '#ff6b3d', // mercan
  '#9ee34a', // lime
  '#64d2ff', // gök mavisi
];
const IMP_FALLBACK = '#ff3b30';
let lastImpColor = '';

function randomImpColor() {
  let c = IMP_FALLBACK;
  for (let i = 0; i < 12; i++) {
    const pick = IMP_PALETTE[Math.floor(Math.random() * IMP_PALETTE.length)];
    c = pick;
    if (pick !== lastImpColor) break;
  }
  lastImpColor = c;
  return c;
}

function impColorOf(it) {
  return (it && typeof it.impColor === 'string' && it.impColor) ? it.impColor : IMP_FALLBACK;
}

function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
  if (!m) return 'rgba(255,59,48,' + a + ')';
  return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
}

/* ---------------- durum ---------------- */
let state   = { items: [], view: { x: 0, y: 0, scale: 1 }, bg: null, groupTitles: {}, groupImportant: {}, groupParents: {}, links: [], trash: [], ink: null };
let selection = new Set();
let selectionOrder = []; // Sırayla tıklama sırasını tutar

function recordSelection(id) {
  const idx = selectionOrder.indexOf(id);
  if (idx >= 0) selectionOrder.splice(idx, 1);
  selectionOrder.push(id);
}

function cleanSelectionOrder() {
  selectionOrder = selectionOrder.filter(id => selection.has(id));
}
let editingId = null;
let spaceDown = false;

const elMap    = new Map();   // item.id -> DOM
const imgCache = new Map();   // imageId -> { img, url, name }
const MAX_CACHED_IMAGES = 50;
const imageLoadFailures = new Set();

/** Tahtada veya çöpte referansı olan görsel kimlikleri (tek geçişte). */
function inUseImageIds() {
  const used = new Set();
  for (const it of state.items) {
    if (it && it.kind === 'image' && it.imageId) used.add(it.imageId);
  }
  if (Array.isArray(state.trash)) {
    for (const entry of state.trash) {
      if (entry && entry.item && entry.item.kind === 'image' && entry.item.imageId) {
        used.add(entry.item.imageId);
      }
    }
  }
  return used;
}

function setImgCache(imageId, value) {
  imageLoadFailures.delete(imageId);
  if (!imgCache.has(imageId)) {
    // Sadece tahtada/çöpte referansı olmayan kayıtları tahliye et. Kullanımdaki
    // bir blob URL'ini iptal etmek, ekrandaki <img> öğesini bozar.
    if (imgCache.size >= MAX_CACHED_IMAGES) {
      const inUse = inUseImageIds();
      while (imgCache.size >= MAX_CACHED_IMAGES) {
        let victim = null;
        for (const key of imgCache.keys()) {
          if (!inUse.has(key)) { victim = key; break; }
        }
        if (victim === null) break;
        imgCache.delete(victim);
      }
    }
  }
  imgCache.set(imageId, value);
}

let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;
let saveTimer = null;
let saveInFlight = null;
let pendingStateJSON = null;
/* init() tahtayı okuyup yerleştirmeden önce kayıt yazmayı engeller.
   Aksi halde açılış sırasında pencere kapanırsa boş tahta kaydedilebilir. */
let appReady = false;

/* =========================================================
   Kare gecikme sayacı (jank ring) — ölçüm enstrümanı
   ---------------------------------------------------------
   Her karede rAF aralığını ölçer; 25 ms üstü kareler halkaya
   yazılır (son 200 kayıt). Ctrl+Alt+P teşhis paneli ve
   gerçek-kullanım verisi için taban. Kod davranışına dokunmaz:
   yalnız bir rAF döngüsü + küçük dizi. */
window.__inkFrameJank = (() => {
  const ring = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const delta = now - last;
    last = now;
    if (delta > 25) {
      ring.push({
        t: Math.round(now),
        ms: Math.round(delta),
        draw: typeof modeIsDraw === 'function' ? modeIsDraw() : false,
        editor: typeof inkEditorIsOpen === 'function' ? !!inkEditorIsOpen() : false,
      });
      if (ring.length > 200) ring.shift();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return ring;
})();

/* Ctrl+Z teşhis halkası (en erken modül): her tuş vuruşunu capture
   fazında yakalar. Bu dinleyici diğer kısayol dinleyicilerinden ÖNCE
   kaydedilir; böylece stopImmediatePropagation çağrılsa bile tuş
   kaydı oluşur. Ctrl+Alt+P panelinde gösterilir. */
window.__undoDebug = { keys: [], calls: [] };
window.addEventListener('keydown', e => {
  const dbg = window.__undoDebug;
  dbg.keys.push({
    key: e.key, code: e.code,
    ctrl: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey,
    trusted: e.isTrusted,
    target: (e.target && e.target.tagName) || '',
    t: Date.now(),
  });
  if (dbg.keys.length > 12) dbg.keys.shift();
}, true);

/* =========================================================
   IndexedDB
   ========================================================= */
let db = null;
