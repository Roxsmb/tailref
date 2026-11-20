/* TailRef app · renk seçici pro paneli (57)
   --------------------------------------------------------------------
   31-ink-ui.js'teki üçgen çarkın üstüne sektör standartlarıyla
   (Photoshop / Krita kalıpları) genişletilmiş seçici:

     · Mod seçici menü: Hue Triangle · Hue Square · Color Sliders
       (HSB/RGB) · Color Harmony · Digital Mixing — orta alan dinamik
       değişir; seçim kalıcı.
     · Ön plan / arka plan kareleri (iç içe), ok/X ile takas,
       siyah-beyaza sıfırlama mini ikonu.
     · COLOR HISTORY: kullanılan renkler MRU sırayla 9×2 ızgara.
     · PALETTES: kalıcı palet; + aktif rengi ekler, sağ tık siler.

   RENK DOĞRULUĞU (önceki turun dersi): Kare/Sliders/Harmony modları
   SAF HSV üzerinde çalışır — hex↔hsv dönüşümü bayt-birebirdir
   (inkCpHsvToHex ⇄ inkCpHexToHsv idempotent: gösterilen piksel =
   seçilen hex; hue kayması matematiksel olarak imkânsız). Üçgen modu
   FAZ 3-3 OKLCH yolunu AYNEN korur (denetim: tests/color-wheel-
   audit.js). Karıştırma lineer-ışık karışımı (inkMixHexLinear —
   gamma-düzlem muhallebisi yok).

   Kalıcılık: localStorage 'tailref-color-picker' (try/catch — her
   modülde olduğu gibi bozulursa varsayılana dönüşür).

   Bağlantı noktaları (31-ink-ui.js'ten):
     inkInitUI()  → inkCpInit()
     inkSetColor()→ inkCpOnColorSet(hex, save)
     inkSyncColorWheel(updatePickers) → inkCpSync(hex, updatePickers)
     inkWheelDraw() yalnızca üçgen modundayken koşar (inkCpWheelVisible)
   ========================================================= */
'use strict';

const INK_CP_STORAGE_KEY = 'tailref-color-picker';
const INK_CP_MODES = ['triangle', 'square', 'sliders', 'harmony', 'mixing'];
const INK_CP_HISTORY_MAX = 18;      /* 9 sütun × 2 sıra */
const INK_CP_PALETTE_MAX = 27;      /* 3 sıraya kadar sar */
const INK_CP_PALETTES_MAX = 24;     /* adlı palet sayısı tavanı */
const INK_CP_PAL_NAME_MAX = 32;
const INK_CP_DEFAULT_PALETTE = [
  '#4c8dff', '#ff8a3d', '#b6f04a', '#35c77d', '#2e6bff',
  '#9a55ff', '#ff4d6d', '#f7c948', '#8adfff', '#ff5a5f',
];

const inkCp = {
  ready: false,
  mode: 'triangle',
  harmony: 'complementary',
  sliderSpace: 'hsb',
  bg: '#ffffff',
  fg: '#ff5a5f',
  history: [],
  palettes: [{ name: 'Palette 1', colors: INK_CP_DEFAULT_PALETTE.slice() }],
  activePal: 0,
  /* Kare/Sliders/Harmony modlarının SAF HSV durumu (üçgeninkinden bağımsız). */
  sv: { h: 358, s: 1, v: 1 },
  dragging: '',
  pointerId: null,
  editingSlider: false,
  squareCache: null,
  squareHue: -1,
  squarePx: 0,
  mixSeededPx: 0,
  histTimer: 0,
  saveTimer: 0,
  els: {},
};

/* -----------------------------------------------------------
   durum yükle / kaydet
   ----------------------------------------------------------- */

/** Palet adı temizliği: boşsa "Palet N" üretir (t() varsa çevirili). */
function inkCpPalName(raw, index) {
  const name = String(raw == null ? '' : raw).trim().slice(0, INK_CP_PAL_NAME_MAX);
  if (name) return name;
  const word = typeof t === 'function' ? t('Palette') : 'Palette';
  return word + ' ' + (index + 1);
}

/** Etkin palet: bozuk indeks/boş diziye karşı korumalı tek kapı. */
function inkCpActivePalette() {
  if (!Array.isArray(inkCp.palettes) || !inkCp.palettes.length) {
    inkCp.palettes = [{ name: inkCpPalName('', 0), colors: INK_CP_DEFAULT_PALETTE.slice() }];
    inkCp.activePal = 0;
  }
  if (!Number.isInteger(inkCp.activePal) ||
      inkCp.activePal < 0 || inkCp.activePal >= inkCp.palettes.length) {
    inkCp.activePal = 0;
  }
  return inkCp.palettes[inkCp.activePal];
}

/** Çakışan adları otomatik numaralandır: "Palet 2 (2)" gibi. */
function inkCpUniquePalName(base, skip = -1) {
  const taken = new Set();
  inkCp.palettes.forEach((p, i) => { if (i !== skip) taken.add(p.name.toLowerCase()); });
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = base + ' (' + n + ')';
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function inkCpLoad() {
  try {
    const raw = localStorage.getItem(INK_CP_STORAGE_KEY);
    if (!raw) return;
    const src = JSON.parse(raw);
    if (!src || typeof src !== 'object') return;
    if (INK_CP_MODES.includes(src.mode)) inkCp.mode = src.mode;
    if (['complementary', 'analogous', 'triadic'].includes(src.harmony)) {
      inkCp.harmony = src.harmony;
    }
    if (src.sliderSpace === 'rgb') inkCp.sliderSpace = 'rgb';
    if (typeof src.bg === 'string' && /^#[0-9a-f]{6}$/i.test(src.bg)) {
      inkCp.bg = src.bg.toLowerCase();
    }
    if (Array.isArray(src.history)) {
      inkCp.history = src.history
        .filter(h => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h))
        .map(h => h.toLowerCase())
        .slice(0, INK_CP_HISTORY_MAX);
    }
    if (Array.isArray(src.palettes) && src.palettes.length) {
      /* v2: adlı paletler dizisi. */
      inkCp.palettes = src.palettes.slice(0, INK_CP_PALETTES_MAX).map((p, i) => ({
        name: inkCpPalName(p && typeof p === 'object' ? p.name : '', i),
        colors: ((p && typeof p === 'object' && Array.isArray(p.colors)) ? p.colors : [])
          .filter(h => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h))
          .map(h => h.toLowerCase())
          .slice(0, INK_CP_PALETTE_MAX),
      }));
      inkCp.activePal = Number.isInteger(src.activePal) &&
        src.activePal >= 0 && src.activePal < inkCp.palettes.length
        ? src.activePal
        : 0;
    } else if (Array.isArray(src.palette) && src.palette.length) {
      /* v1 → v2 taşıma: eski düz palet, adlı ilk palet olarak devralınır. */
      inkCp.palettes = [{
        name: inkCpPalName('', 0),
        colors: src.palette
          .filter(h => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h))
          .map(h => h.toLowerCase())
          .slice(0, INK_CP_PALETTE_MAX),
      }];
      inkCp.activePal = 0;
    }
  } catch { /* bozuk kayıt → varsayılanlar */ }
}

function inkCpSave() {
  if (!inkCp.ready) return;
  clearTimeout(inkCp.saveTimer);
  inkCp.saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(INK_CP_STORAGE_KEY, JSON.stringify({
        v: 2,
        mode: inkCp.mode,
        harmony: inkCp.harmony,
        sliderSpace: inkCp.sliderSpace,
        bg: inkCp.bg,
        history: inkCp.history,
        palettes: inkCp.palettes.map(p => ({ name: p.name, colors: p.colors })),
        activePal: inkCp.activePal,
        /* v1 uyumluluğu: eski sürüm etkin paleti düz dizi olarak okur. */
        palette: inkCpActivePalette().colors,
      }));
    } catch { /* sessiz: kota/gizlilik kısıtları */ }
  }, 250);
}

/* -----------------------------------------------------------
   saf HSV matematiği (bayt-birebir; kaymasız görünüm)
   ----------------------------------------------------------- */

/** (h, s, v) → '#rrggbb'. inkHsvSectorRgb'nin sektör tanımıyla birebir:
 *  kanal = v · (1 − s · (1 − sektör_kanal)). hex→hsv→hex döngüsü
 *  bu tanımla kendini yeniden üretir (idempotent). */
function inkCpHsvToHex(h, s, v) {
  const sec = inkHsvSectorRgb(Number.isFinite(h) ? h : 0);
  const sc = Math.min(1, Math.max(0, Number(s) || 0));
  const vc = Math.min(1, Math.max(0, Number(v) || 0));
  return '#' + [sec.r, sec.g, sec.b].map(raw => {
    const f = raw / 255;
    return Math.round(255 * vc * (1 - sc * (1 - f)))
      .toString(16).padStart(2, '0');
  }).join('');
}

/** '#rrggbb' → { h: 0..360, s: 0..1, v: 0..1 } (standart RGB→HSV). */
function inkCpHexToHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  let r = 0, g = 0, b = 0;
  if (m) {
    const n = parseInt(m[1], 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  }
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const v = max;
  const s = max > 0 ? d / max : 0;
  let h = 0;
  if (d > 0) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, v };
}

function inkCpClampHsv(st) {
  const h = Number.isFinite(st && st.h) ? ((st.h % 360) + 360) % 360 : 0;
  const s = Math.min(1, Math.max(0, Number(st && st.s) || 0));
  const v = Math.min(1, Math.max(0, Number(st && st.v) || 0));
  return { h, s, v };
}

/** hex → SAF HSV durumu. Akramatik renklerde (s≈0 veya v≈0) ton
 *  tanımsızdır: mevcut ton KORUNUR — kullanıcı siyah/beyaz/griye
 *  inince halka tutamacı sıçramaz (sektör standardı davranış;
 *  hex idempotence bozulmaz: hex yalnız s,v'ye bağlı). */
function inkCpDeriveSv(hex) {
  const hsv = inkCpHexToHsv(hex);
  const achromatic = hsv.s <= 1e-6 || hsv.v <= 1e-6;
  return {
    h: achromatic ? inkCp.sv.h : hsv.h,
    s: hsv.s,
    v: hsv.v,
  };
}

function inkCpHexBytes(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* -----------------------------------------------------------
   kurulum
   ----------------------------------------------------------- */

function inkCpInit() {
  if (inkCp.ready) return;
  const ids = {
    panel: 'inkColorWheel',
    wheelCanvas: 'inkWheelCanvas',
    squareCanvas: 'inkCpSquareCanvas',
    harmonyCanvas: 'inkCpHarmonyCanvas',
    mixCanvas: 'inkCpMixCanvas',
    sliders: 'inkCpSliders',
    spaceSeg: 'inkCpSpaceSeg',
    harmonyRow: 'inkCpHarmonyRow',
    harmonySeg: 'inkCpHarmonySeg',
    harmonySwatches: 'inkCpHarmonySwatches',
    mixTools: 'inkCpMixTools',
    mixSeed: 'inkCpMixSeed',
    fg: 'inkCpFg',
    bg: 'inkCpBg',
    swap: 'inkCpSwap',
    def: 'inkCpDefault',
    modeBtn: 'inkCpModeBtn',
    modeMenu: 'inkCpModeMenu',
    eyedrop: 'inkCpEyedrop',
    history: 'inkCpHistory',
    palette: 'inkCpPalette',
    paletteAdd: 'inkCpPaletteAdd',
    palSelect: 'inkCpPalSelect',
    palRenameInput: 'inkCpPalRenameInputEl',
    palNew: 'inkCpPalNew',
    palRename: 'inkCpPalRename',
    palDelete: 'inkCpPalDelete',
  };
  const els = inkCp.els;
  for (const [key, id] of Object.entries(ids)) {
    els[key] = document.getElementById(id);
  }
  if (!els.panel) return;

  inkCpLoad();
  inkCpBindHead();
  inkCpBindSquare();
  inkCpBindSliders();
  inkCpBindHarmony();
  inkCpBindMixing();
  inkCpBindCollections();

  inkCp.ready = true;
  inkCpSetMode(inkCp.mode, false);
  inkCpSyncSegs();
  inkCpSyncSquares();
  inkCpRenderHistory();
  inkCpRenderPalette();
  inkCpRenderPalBar();
  inkCpSyncSliders(inkState().color || inkCp.fg);
}

/** Segment (radiogroup) butonlarını yüklü duruma göre işaretle. */
function inkCpSyncSegs() {
  const els = inkCp.els;
  const segs = [
    { seg: els.spaceSeg, attr: 'data-space', val: inkCp.sliderSpace },
    { seg: els.harmonySeg, attr: 'data-harmony', val: inkCp.harmony },
  ];
  for (const { seg, attr, val } of segs) {
    if (!seg) continue;
    for (const btn of seg.querySelectorAll('button[' + attr + ']')) {
      const on = btn.getAttribute(attr) === val;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
}

/** Üst şerit: ön plan/arka plan kareleri, takas, sıfırlama, mod menüsü. */
function inkCpBindHead() {
  const els = inkCp.els;
  const swap = () => inkCpSwapColors();
  if (els.swap) els.swap.addEventListener('click', swap);
  if (els.bg) els.bg.addEventListener('click', swap);
  if (els.def) {
    els.def.addEventListener('click', () => {
      inkCp.bg = '#ffffff';
      if (typeof inkSetColor === 'function') inkSetColor('#000000', true);
      inkCpSyncSquares();
      inkCpSave();
    });
  }

  const btn = els.modeBtn;
  const menu = els.modeMenu;
  if (!btn || !menu) return;
  btn.addEventListener('click', event => {
    event.stopPropagation();
    const open = !menu.hidden;
    menu.hidden = open;
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  menu.addEventListener('click', event => {
    const item = event.target instanceof Element
      ? event.target.closest('button[data-mode]') : null;
    if (!item) return;
    event.stopPropagation();
    inkCpSetMode(item.dataset.mode);
  });
  /* Menü dışına tıklama ve Escape ile kapanış (çarkın kendi dış-tık
     kapanışıyla aynı kalıp: capture + closest). */
  document.addEventListener('pointerdown', event => {
    if (menu.hidden) return;
    const t = event.target instanceof Element ? event.target : null;
    if (t && (t.closest('#inkCpModeMenu') || t.closest('#inkCpModeBtn'))) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  });
}

/* -----------------------------------------------------------
   kare modu (halka + SV karesi — saf HSV)
   ----------------------------------------------------------- */

function inkCpSquareGeom() {
  const c = inkCp.els.squareCanvas;
  if (!c) return null;
  const css = Math.max(72, c.clientWidth || 228);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.max(1, Math.round(css * dpr));
  if (c.width !== px || c.height !== px) {
    c.width = px;
    c.height = px;
    inkCp.squareCache = null;
  }
  const outer = css / 2 - 4;
  const inner = outer * 0.775;
  const half = inner * 0.72;   /* kare köşegeni iç çemberin içinde kalır */
  return {
    css, dpr, px, cx: css / 2, cy: css / 2, outer, inner, half,
    left: css / 2 - half, top: css / 2 - half, side: half * 2,
  };
}

function inkCpSquareHit(x, y, g) {
  const d = Math.hypot(x - g.cx, y - g.cy);
  if (d >= g.inner - 4 && d <= g.outer + 4) return 'ring';
  if (x >= g.left - 2 && x <= g.left + g.side + 2 &&
      y >= g.top - 2 && y <= g.top + g.side + 2) return 'sv';
  return '';
}

function inkCpSquarePoint(event, g) {
  const r = inkCp.els.squareCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - r.left) * (g.css / Math.max(1, r.width)),
    y: (event.clientY - r.top) * (g.css / Math.max(1, r.height)),
  };
}

/** SV karesi: ton değişince yeniden üretilir. Piksel rengi SAF HSV —
 *  kare üzerindeki her piksel birebir inkCpHsvToHex(h,s,v) değeridir. */
function inkCpSquareFill(g, hue) {
  if (inkCp.squareCache && inkCp.squareHue === hue && inkCp.squarePx === g.px) {
    return inkCp.squareCache;
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = g.px;
  const c = cv.getContext('2d', { colorSpace: 'srgb' });
  const img = c.createImageData(g.px, g.px);
  const data = img.data;
  const sec = inkHsvSectorRgb(hue);
  const fr = sec.r / 255, fg = sec.g / 255, fb = sec.b / 255;
  for (let py = 0; py < g.px; py++) {
    const y = (py + 0.5) / g.dpr;
    for (let pxi = 0; pxi < g.px; pxi++) {
      const x = (pxi + 0.5) / g.dpr;
      if (x < g.left || x > g.left + g.side ||
          y < g.top || y > g.top + g.side) continue;
      const s = (x - g.left) / g.side;
      const v = 1 - (y - g.top) / g.side;
      const i = (py * g.px + pxi) * 4;
      data[i] = Math.round(255 * v * (1 - s * (1 - fr)));
      data[i + 1] = Math.round(255 * v * (1 - s * (1 - fg)));
      data[i + 2] = Math.round(255 * v * (1 - s * (1 - fb)));
      data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  inkCp.squareCache = cv;
  inkCp.squareHue = hue;
  inkCp.squarePx = g.px;
  return cv;
}

function inkCpSquareDraw() {
  const c = inkCp.els.squareCanvas;
  const g = inkCpSquareGeom();
  if (!c || !g) return;
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, g.px, g.px);
  ctx.drawImage(inkWheelRing(g), 0, 0);
  ctx.drawImage(inkCpSquareFill(g, inkCp.sv.h), 0, 0);

  /* kare kenar çizgisi */
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  ctx.beginPath();
  ctx.rect(g.left + 0.5, g.top + 0.5, g.side - 1, g.side - 1);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,.4)';
  ctx.stroke();

  const a = inkCp.sv.h * Math.PI / 180;
  const hr = (g.outer + g.inner) / 2;
  inkWheelHandle(
    ctx,
    (g.cx + Math.cos(a) * hr) * g.dpr,
    (g.cy + Math.sin(a) * hr) * g.dpr,
    8 * g.dpr,
    inkWheelPureCorner(inkCp.sv.h).hex);
  inkWheelHandle(
    ctx,
    (g.left + inkCp.sv.s * g.side) * g.dpr,
    (g.top + (1 - inkCp.sv.v) * g.side) * g.dpr,
    7.5 * g.dpr,
    inkCpHsvToHex(inkCp.sv.h, inkCp.sv.s, inkCp.sv.v));
}

function inkCpSquareApply(event, mode) {
  const g = inkCpSquareGeom();
  if (!g) return;
  const p = inkCpSquarePoint(event, g);
  if (mode === 'ring') {
    const ang = Math.atan2(p.y - g.cy, p.x - g.cx);
    inkCp.sv.h = ((ang * 180 / Math.PI) + 360) % 360;
  } else if (mode === 'sv') {
    inkCp.sv.s = Math.min(1, Math.max(0, (p.x - g.left) / g.side));
    inkCp.sv.v = Math.min(1, Math.max(0, 1 - (p.y - g.top) / g.side));
  } else {
    return;
  }
  if (typeof inkSetColor === 'function') {
    inkSetColor(inkCpHsvToHex(inkCp.sv.h, inkCp.sv.s, inkCp.sv.v), false);
  }
}

function inkCpBindSquare() {
  const canvas = inkCp.els.squareCanvas;
  if (!canvas) return;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const g = inkCpSquareGeom();
    if (!g) return;
    const p = inkCpSquarePoint(event, g);
    const mode = inkCpSquareHit(p.x, p.y, g);
    if (!mode) return;
    event.preventDefault();
    event.stopPropagation();
    inkCp.dragging = mode;
    inkCp.pointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
    inkCpSquareApply(event, mode);
  });
  canvas.addEventListener('pointermove', event => {
    if (!inkCp.dragging) return;
    if (inkCp.pointerId !== null && event.pointerId !== inkCp.pointerId) return;
    if (event.buttons !== undefined && (event.buttons & 1) === 0) return;
    event.preventDefault();
    inkCpSquareApply(event, inkCp.dragging);
  });
  const end = event => {
    if (!inkCp.dragging) return;
    inkCp.dragging = '';
    inkCp.pointerId = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
    if (typeof scheduleSave === 'function') scheduleSave();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* -----------------------------------------------------------
   kaydırıcı modu (HSB / RGB — canlı gradyan raylar)
   ----------------------------------------------------------- */

function inkCpSliderRows() {
  const els = inkCp.els;
  const rows = { hsb: [], rgb: [], map: {} };
  if (!els.sliders) return rows;
  for (const row of els.sliders.querySelectorAll('.inkCpSliderRow')) {
    const ch = row.dataset.ch;
    const inputs = row.querySelectorAll('input');
    const item = { row, range: inputs[0], num: inputs[1] };
    if (['h', 's', 'b'].includes(ch)) { rows.hsb.push(item); rows.map[ch] = item; }
    else { rows.rgb.push(item); rows.map[ch] = item; }
  }
  return rows;
}

function inkCpHueRampCss() {
  const stops = [];
  for (let i = 0; i <= 6; i++) stops.push(inkCpHsvToHex(i * 60, 1, 1));
  return 'linear-gradient(to right,' + stops.join(',') + ')';
}

function inkCpSyncSliders(hex) {
  const els = inkCp.els;
  if (!els.sliders || !inkCp.ready) return;
  const { map } = inkCpSliderRows();
  if (!map.h) return;
  const hsv = inkCpHexToHsv(hex);
  const [r, g, b] = inkCpHexBytes(hex);
  const active = document.activeElement;

  const put = (item, value) => {
    if (!item) return;
    const v = String(value);
    if (item.range && active !== item.range) item.range.value = v;
    if (item.num && active !== item.num) item.num.value = v;
  };
  put(map.h, Math.round(hsv.h));
  put(map.s, Math.round(hsv.s * 100));
  put(map.b, Math.round(hsv.v * 100));
  put(map.r, r);
  put(map.g, g);
  put(map.bl, b);

  /* gradyan raylar (HSB eksenleri mevcut renge göre canlı) */
  const paint = (item, css) => {
    if (item && item.range) item.range.style.background = css;
  };
  paint(map.h, inkCpHueRampCss());
  paint(map.s, 'linear-gradient(to right,' +
    inkCpHsvToHex(hsv.h, 0, hsv.v) + ',' + inkCpHsvToHex(hsv.h, 1, hsv.v) + ')');
  paint(map.b, 'linear-gradient(to right,' +
    inkCpHsvToHex(hsv.h, hsv.s, 0) + ',' + inkCpHsvToHex(hsv.h, hsv.s, 1) + ')');
  paint(map.r, 'linear-gradient(to right,rgb(0,' + g + ',' + b + '),rgb(255,' + g + ',' + b + '))');
  paint(map.g, 'linear-gradient(to right,rgb(' + r + ',0,' + b + '),rgb(' + r + ',255,' + b + '))');
  paint(map.bl, 'linear-gradient(to right,rgb(' + r + ',' + g + ',0),rgb(' + r + ',' + g + ',255))');

  /* boşluk seçimi görünürlüğü (kullanıcı değiştirmişse koru) */
  const showHsb = inkCp.sliderSpace === 'hsb';
  for (const item of rowsList(map, 'hsb')) item.row.hidden = !showHsb;
  for (const item of rowsList(map, 'rgb')) item.row.hidden = showHsb;
}

function rowsList(map, space) {
  return space === 'hsb'
    ? ['h', 's', 'b'].map(ch => map[ch]).filter(Boolean)
    : ['r', 'g', 'bl'].map(ch => map[ch]).filter(Boolean);
}

function inkCpSliderCommit(item, save, src) {
  if (!item || !item.range) return;
  const max = Number(item.range.max) || 100;
  /* Kaynağı oku: olayı atan input (range sürüklemesi ya da num'a yazım).
     Num'a yazılan taşan girdi de kelepçelenir. Boş metin (number input
     geçersiz yazımda '' verir) NaN sayılır → son geçerli değere dönüş. */
  const rawText = src ? String(src.value).trim() : String(item.range.value);
  const raw = rawText === '' ? NaN : Number(rawText);
  if (!isFinite(raw)) {
    /* Boş/geçersiz yazım: canlı yazımda kurcalama; commit'te (Enter/
       blur) son geçerli değere — range'in tuttuğuna — sessizce dön. */
    if (save && item.num) item.num.value = String(item.range.value);
    return;
  }
  const value = Math.round(Math.min(max, Math.max(0, raw)));
  /* Gösterimi normalize et: range her zaman kelepçeli değeri taşır;
     num yalnızca canlı yazım (src=num, save=false) dışında eşitlenir —
     böylece "9999" kutuda takılı kalmaz, yazım da bozulmaz. */
  item.range.value = String(value);
  if (item.num && !(src === item.num && !save)) item.num.value = String(value);
  const { map } = inkCpSliderRows();
  let hex = '';
  if (inkCp.sliderSpace === 'hsb') {
    const h = Number(map.h.range.value) || 0;
    const s = Number(map.s.range.value) || 0;
    const b = Number(map.b.range.value) || 0;
    hex = inkCpHsvToHex(
      item === map.h ? value : h,
      item === map.s ? value / 100 : s / 100,
      item === map.b ? value / 100 : b / 100);
  } else {
    const parts = {
      r: Number(map.r.range.value) || 0,
      g: Number(map.g.range.value) || 0,
      bl: Number(map.bl.range.value) || 0,
    };
    const ch = { h: '', s: '', b: '', r: 'r', g: 'g', bl: 'bl' }[item.row.dataset.ch];
    if (ch) parts[ch] = value;
    hex = '#' + [parts.r, parts.g, parts.bl]
      .map(v => Math.round(Math.min(255, Math.max(0, v)))
        .toString(16).padStart(2, '0')).join('');
  }
  if (typeof inkSetColor === 'function') inkSetColor(hex, save);
}

function inkCpBindSliders() {
  const els = inkCp.els;
  if (!els.sliders) return;
  const { map } = inkCpSliderRows();
  for (const item of Object.values(map)) {
    if (!item || !item.range) continue;
    const pair = [item.range, item.num].filter(Boolean);
    for (const input of pair) {
      input.addEventListener('input', () => inkCpSliderCommit(item, false, input));
      input.addEventListener('change', () => inkCpSliderCommit(item, true, input));
    }
  }
  if (!els.spaceSeg) return;
  els.spaceSeg.addEventListener('click', event => {
    const btn = event.target instanceof Element
      ? event.target.closest('button[data-space]') : null;
    if (!btn) return;
    inkCp.sliderSpace = btn.dataset.space === 'rgb' ? 'rgb' : 'hsb';
    for (const seg of els.spaceSeg.querySelectorAll('button[data-space]')) {
      const on = seg.dataset.space === inkCp.sliderSpace;
      seg.classList.toggle('active', on);
      seg.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    inkCpSyncSliders(inkState().color || inkCp.fg);
    inkCpSave();
  });
}

/* -----------------------------------------------------------
   harmony modu (tamamlayıcı / benzer / üçlü)
   ----------------------------------------------------------- */

function inkCpHarmonyAngles() {
  const h = inkCp.sv.h;
  if (inkCp.harmony === 'complementary') return [h, h + 180];
  if (inkCp.harmony === 'analogous') return [h - 30, h, h + 30];
  return [h, h + 120, h + 240];   /* triadic */
}

function inkCpHarmonyGeom() {
  const c = inkCp.els.harmonyCanvas;
  if (!c) return null;
  const css = Math.max(72, c.clientWidth || 228);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.max(1, Math.round(css * dpr));
  if (c.width !== px || c.height !== px) {
    c.width = px;
    c.height = px;
  }
  const outer = css / 2 - 4;
  const inner = outer * 0.775;
  return { css, dpr, px, cx: css / 2, cy: css / 2, outer, inner };
}

function inkCpHarmonyDraw() {
  const c = inkCp.els.harmonyCanvas;
  const g = inkCpHarmonyGeom();
  if (!c || !g) return;
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, g.px, g.px);
  ctx.drawImage(inkWheelRing(g), 0, 0);

  /* merkez: aktif renk diski (ton halkasında bağlam) */
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, g.inner * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = inkState().color || inkCp.fg;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.stroke();

  const hr = (g.outer + g.inner) / 2;
  for (const angle of inkCpHarmonyAngles()) {
    const a = angle * Math.PI / 180;
    inkWheelHandle(
      ctx,
      (g.cx + Math.cos(a) * hr) * g.dpr,
      (g.cy + Math.sin(a) * hr) * g.dpr,
      7 * g.dpr,
      inkCpHsvToHex(angle, inkCp.sv.s, inkCp.sv.v));
  }
}

function inkCpRenderHarmonySwatches() {
  const wrap = inkCp.els.harmonySwatches;
  if (!wrap) return;
  wrap.replaceChildren();
  const angles = inkCpHarmonyAngles();
  const baseHex = inkState().color || inkCp.fg;
  for (let i = 0; i < angles.length; i++) {
    const hex = i === 0 ? baseHex
      : inkCpHsvToHex(angles[i], inkCp.sv.s, inkCp.sv.v);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkCpSwatch' + (i === 0 ? ' active' : '');
    btn.style.background = hex;
    btn.title = hex.toUpperCase() +
      (i === 0 ? ' · ' + (typeof t === 'function' ? t('Current color') : 'Current color') : '');
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => {
      if (typeof inkSetColor === 'function') inkSetColor(hex, true);
    });
    wrap.append(btn);
  }
}

function inkCpBindHarmony() {
  const seg = inkCp.els.harmonySeg;
  if (!seg) return;
  seg.addEventListener('click', event => {
    const btn = event.target instanceof Element
      ? event.target.closest('button[data-harmony]') : null;
    if (!btn) return;
    inkCp.harmony = btn.dataset.harmony;
    for (const item of seg.querySelectorAll('button[data-harmony]')) {
      const on = item.dataset.harmony === inkCp.harmony;
      item.classList.toggle('active', on);
      item.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (isPanelVisible(inkCp.els.panel) && inkCp.mode === 'harmony') {
      inkCpHarmonyDraw();
      inkCpRenderHarmonySwatches();
    }
    inkCpSave();
  });
}

/* -----------------------------------------------------------
   dijital karıştırma (palet bıçağı gibi harmanlama)
   ----------------------------------------------------------- */

function inkCpMixCtx() {
  const c = inkCp.els.mixCanvas;
  if (!c) return null;
  const cssW = Math.max(120, c.clientWidth || 228);
  const cssH = Math.max(64, c.clientHeight || 128);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (c.width !== pxW || c.height !== pxH) {
    c.width = pxW;
    c.height = pxH;
    inkCp.mixSeededPx = 0;
  }
  return { c, ctx: c.getContext('2d'), cssW, cssH, dpr, pxW, pxH };
}

/** Paleti geçmiş/palet renkleriyle tohumla (yumuşak diskler). */
function inkCpMixSeed() {
  const m = inkCpMixCtx();
  if (!m) return;
  const { ctx, pxW, pxH, dpr } = m;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#26282e';
  ctx.fillRect(0, 0, pxW, pxH);

  const src = [...inkCpActivePalette().colors, ...inkCp.history]
    .filter((hex, i, arr) => arr.indexOf(hex) === i)
    .slice(0, 10);
  if (!src.length) src.push('#ff5a5f', '#4c8dff', '#35c77d', '#f7c948');
  const cols = Math.min(5, Math.max(2, Math.ceil(src.length / 2)));
  const rows = Math.ceil(src.length / cols);
  const r = Math.min(pxW / (cols * 2.1), pxH / (rows * 1.6));
  for (let i = 0; i < src.length; i++) {
    const cx = ((i % cols) + 0.5) / cols * pxW;
    const cy = (Math.floor(i / cols) + 0.5) / rows * pxH;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, src[i]);
    g.addColorStop(0.62, src[i]);
    g.addColorStop(1, src[i] + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  inkCp.mixSeededPx = pxW;
}

/** Noktaya harman darnası: tuvalden örneklenen renk ile aktif renk
 *  lineer-ışık uzayında karışır (muddy yok), yumuşak alpha ile basılır. */
function inkCpMixDab(m, cssX, cssY, radiusCss) {
  const { ctx, dpr, pxW, pxH } = m;
  const dx = Math.round(cssX * dpr);
  const dy = Math.round(cssY * dpr);
  let sampled = null;
  try {
    const d = ctx.getImageData(
      Math.min(pxW - 1, Math.max(0, dx)),
      Math.min(pxH - 1, Math.max(0, dy)), 1, 1).data;
    if (d[3] > 8) {
      sampled = '#' + [d[0], d[1], d[2]]
        .map(v => v.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* tuval kirli değil; örnekleme sorununda yalın darnа */ }
  const active = inkState().color || inkCp.fg;
  const color = sampled && typeof inkMixHexLinear === 'function'
    ? inkMixHexLinear(sampled, active, 0.55)
    : active;
  const b = inkCpHexBytes(color);
  const rgba = a => 'rgba(' + b[0] + ',' + b[1] + ',' + b[2] + ',' + a + ')';
  const r = radiusCss * dpr;
  const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, r);
  g.addColorStop(0, rgba(0.85));
  g.addColorStop(0.65, rgba(0.4));
  g.addColorStop(1, rgba(0));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, Math.PI * 2);
  ctx.fill();
}

function inkCpMixPoint(event) {
  const m = inkCpMixCtx();
  if (!m) return null;
  const rect = m.c.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (m.cssW / Math.max(1, rect.width)),
    y: (event.clientY - rect.top) * (m.cssH / Math.max(1, rect.height)),
  };
}

function inkCpMixSample(event) {
  const m = inkCpMixCtx();
  const p = inkCpMixPoint(event);
  if (!m || !p) return;
  const { ctx, dpr, pxW, pxH } = m;
  try {
    const d = ctx.getImageData(
      Math.min(pxW - 1, Math.max(0, Math.round(p.x * dpr))),
      Math.min(pxH - 1, Math.max(0, Math.round(p.y * dpr))), 1, 1).data;
    if (d[3] <= 8) return;
    const hex = '#' + [d[0], d[1], d[2]]
      .map(v => v.toString(16).padStart(2, '0')).join('');
    if (typeof inkSetColor === 'function') inkSetColor(hex, true);
  } catch { /* sessiz */ }
}

function inkCpBindMixing() {
  const canvas = inkCp.els.mixCanvas;
  if (!canvas) return;
  let painting = false;
  let last = null;

  const strokeTo = (p) => {
    const m = inkCpMixCtx();
    if (!m || !p) return;
    if (last) {
      /* hızlı harekette kopukluk olmasın: segment boyunca darnala */
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      const steps = Math.max(1, Math.ceil(dist / 4));
      for (let i = 1; i <= steps; i++) {
        inkCpMixDab(m,
          last.x + (p.x - last.x) * i / steps,
          last.y + (p.y - last.y) * i / steps, 11);
      }
    } else {
      inkCpMixDab(m, p.x, p.y, 11);
    }
    last = p;
  };

  canvas.addEventListener('pointerdown', event => {
    const m = inkCpMixCtx();
    if (!m) return;
    if (event.altKey || event.button === 2) {
      event.preventDefault();
      inkCpMixSample(event);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    painting = true;
    last = null;
    inkCp.pointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
    if (!inkCp.mixSeededPx) inkCpMixSeed();
    strokeTo(inkCpMixPoint(event));
  });
  canvas.addEventListener('pointermove', event => {
    if (!painting) return;
    if (inkCp.pointerId !== null && event.pointerId !== inkCp.pointerId) return;
    event.preventDefault();
    strokeTo(inkCpMixPoint(event));
  });
  const end = event => {
    if (!painting) return;
    painting = false;
    last = null;
    inkCp.pointerId = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    inkCpMixSample(event);
  });
  if (inkCp.els.mixSeed) {
    inkCp.els.mixSeed.addEventListener('click', () => inkCpMixSeed());
  }
}

/* -----------------------------------------------------------
   ön plan / arka plan + geçmiş + palet
   ----------------------------------------------------------- */

function inkCpSyncSquares() {
  const els = inkCp.els;
  const fg = inkState().color || inkCp.fg;
  inkCp.fg = fg;
  if (els.fg) {
    els.fg.style.background = fg;
    els.fg.classList.toggle('active', true);
  }
  if (els.bg) els.bg.style.background = inkCp.bg;
}

/** X / ok ikonu: iki rengi takas eder. Aktif renk eskiden arka plan olur. */
function inkCpSwapColors(save = true) {
  const fg = inkState().color || inkCp.fg;
  const bg = inkCp.bg;
  inkCp.bg = fg;
  if (typeof inkSetColor === 'function') inkSetColor(bg, save);
  else inkState().color = bg;
  inkCpSyncSquares();
  inkCpSave();
}

/** Kancа (31-ink-ui.js inkSetColor): her renk değişiminde kareleri
 *  günceller; committed (save=true) veya durağanlaşmış (debounce)
 *  değişimleri geçmişe yazar. */
function inkCpOnColorSet(hex, save) {
  inkCp.fg = hex;
  inkCpSyncSquares();
  if (!inkCp.ready) return;
  if (save) {
    clearTimeout(inkCp.histTimer);
    inkCpRecordHistory(hex);
    return;
  }
  clearTimeout(inkCp.histTimer);
  inkCp.histTimer = setTimeout(() => inkCpRecordHistory(hex), 700);
}

function inkCpRecordHistory(hex) {
  if (!inkCp.ready) return;
  if (!/^#[0-9a-f]{6}$/i.test(String(hex || ''))) return;
  hex = hex.toLowerCase();
  if (inkCp.history[0] === hex) return;
  inkCp.history = [hex, ...inkCp.history.filter(h => h !== hex)]
    .slice(0, INK_CP_HISTORY_MAX);
  inkCpRenderHistory();
  inkCpSave();
}

function inkCpRenderHistory() {
  const wrap = inkCp.els.history;
  if (!wrap) return;
  wrap.replaceChildren();
  if (!inkCp.history.length) {
    const hint = document.createElement('span');
    hint.className = 'inkCpEmpty';
    hint.setAttribute('data-l10n', 'Colors you pick will appear here');
    hint.textContent = 'Colors you pick will appear here';
    wrap.append(hint);
    return;
  }
  for (const hex of inkCp.history) {
    wrap.append(inkCpSwatchButton(hex));
  }
}

function inkCpRenderPalette() {
  const wrap = inkCp.els.palette;
  if (!wrap) return;
  wrap.replaceChildren();
  const pal = inkCpActivePalette();
  if (!pal.colors.length) {
    /* Yeni/boş palet: ipucu göster. */
    const hint = document.createElement('div');
    hint.className = 'inkCpEmpty';
    hint.textContent = typeof t === 'function'
      ? t('Click + to add the current color')
      : 'Click + to add the current color';
    wrap.append(hint);
    return;
  }
  for (const hex of pal.colors) {
    const btn = inkCpSwatchButton(hex);
    btn.addEventListener('contextmenu', event => {
      event.preventDefault();
      pal.colors = pal.colors.filter(h => h !== hex);
      inkCpRenderPalette();
      inkCpSave();
    });
    wrap.append(btn);
  }
}

/** Palet seçici çubuğunu (ad listesi + sil düğmesi durumu) tazele. */
function inkCpRenderPalBar() {
  const sel = inkCp.els.palSelect;
  if (!sel) return;
  inkCpActivePalette(); /* indeksi normalize et */
  sel.replaceChildren();
  inkCp.palettes.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name || inkCpPalName('', i);
    sel.append(opt);
  });
  sel.value = String(inkCp.activePal);
  const del = inkCp.els.palDelete;
  if (del) del.disabled = inkCp.palettes.length <= 1;
}

function inkCpSwatchButton(hex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'inkCpSwatch';
  btn.style.background = hex;
  btn.title = hex.toUpperCase() + ' · ' +
    (typeof t === 'function' ? t('Click to use') : 'Click to use');
  btn.setAttribute('aria-label', btn.title);
  btn.addEventListener('click', () => {
    if (typeof inkSetColor === 'function') inkSetColor(hex, true);
  });
  return btn;
}

function inkCpBindCollections() {
  const add = inkCp.els.paletteAdd;
  if (add) {
    add.addEventListener('click', () => {
      const hex = (inkState().color || inkCp.fg).toLowerCase();
      const pal = inkCpActivePalette();
      if (pal.colors.includes(hex)) {
        /* zaten varsa başa taşı (MRU) */
        pal.colors = [hex, ...pal.colors.filter(h => h !== hex)];
      } else {
        pal.colors = [hex, ...pal.colors].slice(0, INK_CP_PALETTE_MAX);
      }
      inkCpRenderPalette();
      inkCpSave();
    });
  }

  /* --- adlı paletler: seç / yeni / yeniden adlandır / sil --- */
  const sel = inkCp.els.palSelect;
  if (sel) {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.value, 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < inkCp.palettes.length) {
        inkCp.activePal = idx;
        inkCpRenderPalette();
        inkCpSave();
      }
    });
  }

  const create = inkCp.els.palNew;
  if (create) {
    create.addEventListener('click', () => {
      if (inkCp.palettes.length >= INK_CP_PALETTES_MAX) return;
      const base = inkCpPalName('', inkCp.palettes.length);
      const name = inkCpUniquePalName(base);
      inkCp.palettes.push({ name, colors: [] });
      inkCp.activePal = inkCp.palettes.length - 1;
      inkCpRenderPalBar();
      inkCpRenderPalette();
      inkCpSave();
    });
  }

  const renameBtn = inkCp.els.palRename;
  if (renameBtn) renameBtn.addEventListener('click', inkCpPalRenameStart);

  const del = inkCp.els.palDelete;
  if (del) {
    del.addEventListener('click', () => {
      if (inkCp.palettes.length <= 1) return;
      inkCp.palettes.splice(inkCp.activePal, 1);
      inkCp.activePal = Math.min(inkCp.activePal, inkCp.palettes.length - 1);
      inkCpRenderPalBar();
      inkCpRenderPalette();
      inkCpSave();
    });
  }
  const drop = inkCp.els.eyedrop;
  if (drop) {
    drop.addEventListener('click', () => {
      if (typeof inkSetTool === 'function') inkSetTool('eyedropper');
    });
  }
}

/** Etkin paleti satır içi giriyle yeniden adlandır (Enter/blur onay, Esc vazgeç). */
function inkCpPalRenameStart() {
  const sel = inkCp.els.palSelect;
  const input = inkCp.els.palRenameInput;
  const pal = inkCpActivePalette();
  if (!sel || !input || sel.hidden) return;
  let done = false;
  const keys = new AbortController();
  const finish = commit => {
    if (done) return;
    done = true;
    keys.abort(); /* dinleyici sızıntısını kes */
    const next = commit
      ? String(input.value || '').trim().slice(0, INK_CP_PAL_NAME_MAX)
      : '';
    if (next && next !== pal.name) {
      pal.name = inkCpUniquePalName(next, inkCp.activePal);
      inkCpSave();
    }
    sel.hidden = false;
    input.hidden = true;
    inkCpRenderPalBar();
  };
  input.value = pal.name;
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  }, { signal: keys.signal });
  input.addEventListener('blur', () => finish(true), { once: true });
  sel.hidden = true;
  input.hidden = false;
  input.focus();
  input.select();
}

/* -----------------------------------------------------------
   mod seçimi + senkron kancası
   ----------------------------------------------------------- */

function inkCpSetMode(mode, save = true) {
  if (!INK_CP_MODES.includes(mode)) mode = 'triangle';
  inkCp.mode = mode;
  const els = inkCp.els;
  if (!els.panel) return;

  const show = (el, on) => { if (el) el.hidden = !on; };
  show(els.wheelCanvas, mode === 'triangle');
  show(els.squareCanvas, mode === 'square');
  show(els.harmonyCanvas, mode === 'harmony');
  show(els.mixCanvas, mode === 'mixing');
  show(els.sliders, mode === 'sliders');
  show(els.harmonyRow, mode === 'harmony');
  show(els.mixTools, mode === 'mixing');

  if (els.modeMenu) {
    for (const item of els.modeMenu.querySelectorAll('button[data-mode]')) {
      const on = item.dataset.mode === mode;
      item.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    els.modeMenu.hidden = true;
  }
  if (els.modeBtn) els.modeBtn.setAttribute('aria-expanded', 'false');

  if (mode === 'square' || mode === 'harmony') {
    /* SAF HSV durumunu geçerli renkten türet (bayt-birebir döngü) */
    inkCp.sv = inkCpDeriveSv(inkState().color || inkCp.fg);
  }
  if (save) inkCpSave();
  inkCpSync(inkState().color || inkCp.fg, true);
}

/** Kancа (31-ink-ui.js inkSyncColorWheel): panel görünürken aktif modun
 *  görünümünü günceller. updatePickers=true → dış senkron (renk dışarıdan
 *  değişti); sürükleme sırasında durum zaten yereldir (yeniden türetme
 *  bayt kuantalamasına geriden gelmesin diye korunur). */
function inkCpSync(hex, updatePickers) {
  if (!inkCp.ready) return;
  const els = inkCp.els;
  hex = typeof inkWheelHex === 'function'
    ? inkWheelHex(hex) : (hex || inkCp.fg);
  inkCp.fg = hex;
  inkCpSyncSquares();
  if (!els.panel || !isPanelVisible(els.panel)) return;

  if (inkCp.mode === 'square') {
    if (updatePickers && !inkCp.dragging) {
      inkCp.sv = inkCpDeriveSv(hex);
    }
    inkCpSquareDraw();
  } else if (inkCp.mode === 'sliders') {
    if (!inkCp.editingSlider) inkCpSyncSliders(hex);
  } else if (inkCp.mode === 'harmony') {
    if (updatePickers && !inkCp.dragging) {
      inkCp.sv = inkCpDeriveSv(hex);
    }
    inkCpHarmonyDraw();
    inkCpRenderHarmonySwatches();
  } else if (inkCp.mode === 'mixing') {
    const m = inkCpMixCtx();
    if (m && !inkCp.mixSeededPx) inkCpMixSeed();
  }
}

/* Pencere boyutu değişince önbellekleri düşür (31'deki resize dinleyicisi
   üçgen için aynısını yapar; buradaki modlar kendi önbelleğini tutar). */
window.addEventListener('resize', () => {
  if (!inkCp.ready) return;
  inkCp.squareCache = null;
  inkCp.squareHue = -1;
  inkCp.squarePx = 0;
  if (isPanelVisible(inkCp.els.panel) &&
      (inkCp.mode === 'square' || inkCp.mode === 'harmony')) {
    inkCpSync(inkState().color || inkCp.fg, true);
  }
});

/** Kancа (31-ink-ui.js inkWheelDraw): üçgen tuvalinin çizimi yalnızca
 *  üçgen modunda anlamlı — diğer modlarda gizli tuvale boşa piksel
 *  dökülmesini (halka drag gecikmesi) önler. Satır-içi kart da artık
 *  mod değiştirebildiği için kural tüm bağlamlarda aynıdır. */
function inkCpWheelVisible() {
  if (!inkCp.ready) return true;
  return inkCp.mode === 'triangle';
}
