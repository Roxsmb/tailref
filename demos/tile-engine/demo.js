/* Kiremit Motoru — çalışma demosu (bağlantı katmanı)
 *
 * Ne işe yarar?
 *   • Solda çiz (pointer), tekerlekle zoom, orta tuş/boşluk+drag ile pan.
 *   • Ctrl+Z / Ctrl+Y veya araç çubuğu düğmeleri ile undo/redo.
 *   • Sağ üstte canlı istatistik: karo sayısı, yaklaşık bellek, FPS.
 *
 * Vurgu: çizim denemesi FAZLA büyük tuvalde yapılır (8000×8000) ama
 * karo sparse yaratıldığı için bellek yalnız çizdiğin yere büyür.
 */

import {
  TILE, getBrushStamp, Camera, TileRenderer, StrokeHistory,
  TiledDocument, gridMemoryBytes,
} from './engine.js';

/* ---------- kurulum ---------- */

const DOC_W = 8000, DOC_H = 8000;
const BRUSH_R_DEFAULT = 24;
const SPACING_RATIO = 0.25;          // r*0.25 aralıklı damga (standart fırça spacing)
const HISTORY_LIMIT = 50;

const viewport = document.getElementById('view');
const cursor = document.getElementById('cursor');
const stats = document.getElementById('stats');
const hint = document.getElementById('hint');

const doc = new TiledDocument(DOC_W, DOC_H);
const cam = new Camera();
const history = new StrokeHistory(doc, HISTORY_LIMIT);

// DPR destekli viewport (ekran netliği)
const dpr = Math.max(1, window.devicePixelRatio || 1);
let canvasW = 0, canvasH = 0;
function resize() {
  const r = viewport.parentElement.getBoundingClientRect();
  canvasW = Math.max(1, Math.round(r.width));
  canvasH = Math.max(1, Math.round(r.height));
  viewport.width = Math.round(canvasW * dpr);
  viewport.height = Math.round(canvasH * dpr);
  viewport.style.width = canvasW + 'px';
  viewport.style.height = canvasH + 'px';
  viewDirty = true;
}
window.addEventListener('resize', resize);

/* ---------- render döngüsü ---------- */

let viewDirty = true;
let fpsCount = 0;

function frame() {
  if (viewDirty) {
    viewDirty = false;
    renderer.render();
    fpsCount++;
  }
  requestAnimationFrame(frame);
}

/* istatistik + fps ölçümü (fpsCount render döngüsünde artar) */
let fpsShown = 0, fpsT0 = performance.now();
setInterval(() => {
  const t = performance.now();
  const dt = t - fpsT0;
  if (dt > 200) {
    fpsShown = Math.round(fpsCount * 1000 / dt);
    fpsCount = 0;
    fpsT0 = t;
  }
  stats.textContent =
    'karo: ' + doc.grid.tiles.size +
    ' · bellek ≈ ' + (gridMemoryBytes(doc.grid) / (1024 * 1024)).toFixed(1) + ' MB' +
    ' · ' + fpsShown + ' fps' +
    ' · undo: ' + history.undoStack.length;
}, 400);

/* ---------- fırça durumu ---------- */

const brush = {
  radius: BRUSH_R_DEFAULT,
  color: '#1d4ed8',
  hardness: 0.7,
};

function stampNow() {
  return getBrushStamp(Math.max(1, Math.round(brush.radius)), brush.color, brush.hardness);
}

/* ---------- pointer: çiz / pan ---------- */

let strokeActive = false;
let panning = false;
let spaceDown = false;
let lastX = 0, lastY = 0;              // dünya koordinatı (damga spacing için)
let lastPanScreen = null;

function evPos(e) {
  const r = viewport.getBoundingClientRect();
  return {
    sx: e.clientX - r.left,
    sy: e.clientY - r.top,
  };
}
function toWorld(sx, sy) {
  return { x: sx / cam.scale + cam.x, y: sy / cam.scale + cam.y };
}

function paintTo(wx, wy) {
  // aralarda damga serisi — segment sonunda kesin bitiş damgası
  doc.paintSegment(stampNow(), brush.radius,
    Math.max(1, brush.radius * SPACING_RATIO),
    lastX, lastY, wx, wy, history);
  lastX = wx; lastY = wy;
  viewDirty = true;
}

viewport.addEventListener('pointerdown', (e) => {
  viewport.setPointerCapture(e.pointerId);
  const { sx, sy } = evPos(e);

  // pan: orta tuş, sağ tuş veya boşluk basma
  if (e.button === 1 || e.button === 2 || spaceDown) {
    panning = true;
    lastPanScreen = { sx, sy };
    return;
  }
  if (e.button !== 0) return;

  const w = toWorld(sx, sy);
  history.begin();
  strokeActive = true;
  lastX = w.x; lastY = w.y;
  doc.paintStamp(stampNow(), w.x, w.y, brush.radius, history);  // tık grounding: tek damga
  viewDirty = true;
});

viewport.addEventListener('pointermove', (e) => {
  const { sx, sy } = evPos(e);
  moveCursor(sx, sy);

  if (panning) {
    cam.x -= (sx - lastPanScreen.sx) / cam.scale;
    cam.y -= (sy - lastPanScreen.sy) / cam.scale;
    lastPanScreen = { sx, sy };
    viewDirty = true;
    return;
  }
  if (!strokeActive) return;

  // coalesced: hızlı harekette tarayıcının BİRLEŞTİRDİĞİ ara konumlar —
  // yoksa hızlı vuruşlarda aralarda kopukluk olur.
  const points = (typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents()) || [e];
  for (const p of points) {
    const q = evPos(p);
    const w = toWorld(q.sx, q.sy);
    paintTo(w.x, w.y);
  }
});

function endStroke() {
  if (strokeActive) {
    strokeActive = false;
    history.end();
  }
  panning = false;
  lastPanScreen = null;
}
viewport.addEventListener('pointerup', endStroke);
viewport.addEventListener('pointercancel', endStroke);

viewport.addEventListener('contextmenu', (e) => e.preventDefault());

function moveCursor(sx, sy) {
  const d = brush.radius * 2 * cam.scale;
  cursor.style.width = d + 'px';
  cursor.style.height = d + 'px';
  cursor.style.left = (sx - d / 2) + 'px';
  cursor.style.top = (sy - d / 2) + 'px';
}

/* ---------- zoom (imlece doğru) ---------- */

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { sx, sy } = evPos(e);
  const before = cam.screenToWorld(sx, sy);
  const k = Math.exp(-e.deltaY * 0.0015);
  cam.scale = Math.min(16, Math.max(0.05, cam.scale * k));
  const after = cam.screenToWorld(sx, sy);
  // imleç altındaki dünya noktası sabit kalsın
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  viewDirty = true;
}, { passive: false });

/* ---------- klavye ---------- */

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { spaceDown = true; e.preventDefault(); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (history.undo()) viewDirty = true;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' ||
      (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    if (history.redo()) viewDirty = true;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceDown = false;
});

/* ---------- araç çubuğu ---------- */

const ui = {
  color: document.getElementById('color'),
  size: document.getElementById('size'),
  hardness: document.getElementById('hardness'),
  undo: document.getElementById('undoBtn'),
  redo: document.getElementById('redoBtn'),
  clear: document.getElementById('clearBtn'),
  reset: document.getElementById('resetBtn'),
};

ui.color.addEventListener('input', () => { brush.color = ui.color.value; });
ui.size.addEventListener('input', () => { brush.radius = +ui.size.value; });
ui.hardness.addEventListener('input', () => { brush.hardness = +ui.hardness.value / 100; });
ui.undo.addEventListener('click', () => { if (history.undo()) viewDirty = true; });
ui.redo.addEventListener('click', () => { if (history.redo()) viewDirty = true; });
ui.clear.addEventListener('click', () => {
  doc.clearAll(history);      // undo edilebilir temizleme
  viewDirty = true;
});
ui.reset.addEventListener('click', () => {
  cam.x = DOC_W / 2; cam.y = DOC_H / 2; cam.scale = 0.5;
  viewDirty = true;
});

/* ---------- başlat ---------- */

const renderer = new TileRenderer(viewport, doc, cam, dpr);
resize();
cam.x = DOC_W / 2; cam.y = DOC_H / 2;   // kağıt ortasında aç
cam.scale = 0.5;
hint.textContent = 'Tekerlek: imlece zoom · Orta tuş / boşluk+drag / sağ tuş: pan · Ctrl+Z / Ctrl+Y: gerial / yeniden';
requestAnimationFrame(frame);
