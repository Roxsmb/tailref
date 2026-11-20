/* TailRef app · ink tools · pointer input, pressure, selection, transform
   ------------------------------------------------------------------
   Girdi akışı:
     pointerdown  → hedef katmanı çöz, canlı önizleme başlat
     pointermove  → coalesced olayları işle, yumuşat, damlaları çiz
     pointerup    → vuruşu katmana işle (bake), canlı katmanı temizle

   Vuruşlar pointerup anında katman tuvaline raster edilir; vektör
   noktalar geri al/yinele ve dışa aktarma için saklanır. Böylece aktif
   çizim sırasında bellek şişmez, bitmiş vuruşlar tek karede çizilir.
   ========================================================= */
'use strict';

const inkLive = {
  canvas: null,
  ctx: null,
  dpr: 1,
};

let inkPointer = null;      // aktif çizim / seçim / transform durumu
let inkTransform = null;    // gizmo sürüklemesi
let inkLastLive = null;     // son çizilen damla konumu (ekran px)
let inkShapeLast = null;
let inkLiveHolds = 0;       // worker bitene kadar canlı önizlemeyi tut

/* =========================================================
   canlı katman (tam ekran)
   ========================================================= */
function inkEnsureLiveCanvas() {
  if (inkLive.canvas && inkLive.canvas.isConnected) return inkLive.canvas;
  let c = document.getElementById('inkLive');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'inkLive';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
  }
  inkLive.canvas = c;
  inkLive.ctx = c.getContext('2d', { colorSpace: 'srgb' });
  inkSizeLiveCanvas();
  return c;
}

function inkSizeLiveCanvas() {
  const c = inkLive.canvas;
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  inkLive.dpr = dpr;
  c.width = Math.max(1, Math.round(window.innerWidth * dpr));
  c.height = Math.max(1, Math.round(window.innerHeight * dpr));
  c.style.width = window.innerWidth + 'px';
  c.style.height = window.innerHeight + 'px';
  inkLive.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Canlı katmanı temizler. Bekleyen worker işi varsa (`inkLiveHolds > 0`)
    temizleme atlanır: o vuruşun önizlemesi katmana uygulanana kadar ekranda
    kalmalı, aksi hâlde çizgi bir an kaybolur. */
function inkClearLive(force) {
  if (!inkLive.ctx) return;
  if (!force && inkLiveHolds > 0) return;
  inkLive.ctx.save();
  inkLive.ctx.setTransform(1, 0, 0, 1, 0, 0);
  inkLive.ctx.clearRect(0, 0, inkLive.canvas.width, inkLive.canvas.height);
  inkLive.ctx.restore();
  // K15: sunum opaklığı stroke.opacity element stilinde taşınıyor;
  // tampon temizlendiğinde sıfırlanmalı (sonraki vuruşa sızmaz).
  if (inkLive.canvas) inkLive.canvas.style.opacity = '';
  inkLastLive = null;
}

/** Commit sonrası raster tüketicilerini tazeler: katman nesli (FX girdi
    anahtarı), FX önbelleği, tahta üzerindeki FX katmanı ve çizim tuvali.
    GERÇEK HATA: vuruş commit edildiğinde hiçbir geçersiz kılma çağrılmıyordu;
    FX açıkken tuval son efektli kareyi gösteriyor, yeni vuruş FX girdisine
    girmediği için kalem kalkınca çizim "kayboluyordu". */
function inkAfterCommitRaster(layer) {
  if (!layer) return;
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  if (layer.kind === 'attached' && typeof inkItemForLayer === 'function') {
    const it = inkItemForLayer(layer);
    if (it && typeof inkFxItemHasActiveFx === 'function' && inkFxItemHasActiveFx(it)) {
      if (typeof inkFxInvalidate === 'function') inkFxInvalidate(it.id);
      if (typeof inkSyncDom === 'function') inkSyncDom(it);
    }
  }
  if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
}

/** Commit sonrası canlı önizlemeyi temizler. Worker asenkron çiziyorsa
    önizleme, bitmap katmana uygulanana kadar ekranda kalır. */
function inkAfterCommitPaint(task) {
  if (task && typeof task.then === 'function') {
    inkLiveHolds += 1;
    const done = () => {
      inkLiveHolds = Math.max(0, inkLiveHolds - 1);
      if (!inkPointer && inkLiveHolds === 0) inkClearLive(true);
    };
    task.then(done, done);
    return;
  }
  inkClearLive();
}

/** Görsele bağlı katmanlarda canlı önizlemeyi görselin (döndürülmüş
    olabilecek) dikdörtgenine kırpar. Böylece fırça ucu görsel sınırının
    dışına taşmış gibi görünmez; sonuç tuvali zaten kırpılıdır. */
function inkClipLiveToLayer(layer) {
  const ctx = inkLive.ctx;
  if (!ctx || !layer || layer.kind !== 'attached') return;
  const it = inkItemForLayer(layer);
  if (!it) return;
  const c = itemCenter(it);
  const r = (it.rot || 0) * Math.PI / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const hw = (it.w || 0) / 2, hh = (it.h || 0) / 2;
  const corners = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ].map(([dx, dy]) => {
    const wx = c.x + dx * cos - dy * sin;
    const wy = c.y + dx * sin + dy * cos;
    return worldToScreen({ x: wx, y: wy });
  });
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.clip();
}

/* =========================================================
   araç durumu
   ========================================================= */
const INK_TOOL_CURSORS = {
  brush: 'crosshair',
  pencil: 'crosshair',
  eraser: 'cell',
  fill: 'crosshair',
  smudge: 'crosshair',
  liquify: 'crosshair',
  gradient: 'crosshair',
  shape: 'crosshair',
  lasso: 'crosshair',
  marquee: 'crosshair',
  text: 'text',
  eyedropper: 'copy',
  transform: 'default',
};

/** Satır içi (eski) çizim yalnızca modal açıkken etkindir. Referans
    tahtasında kalem imleci, araç kısayolu ve çizim girdisi olmamalı. */
function inkInlineModeActive() {
  // Eski çizim motorunun uçtan uca testleri tahta girdisini doğrudan
  // sürer; yalnızca test koşumunda bu kapı açılır.
  if (window.__TailRef_INK_LEGACY_TEST__ === true) return true;
  return typeof inkEditorUi !== 'undefined' && !!inkEditorUi && !!inkEditorUi.open;
}

/** `body` üzerindeki kalem imleci durumunu satır içi moda göre eşitler. */
function inkApplyToolCursor() {
  const active = inkInlineModeActive();
  document.body.classList.toggle('ink-active', active);
  if (!active) {
    delete document.body.dataset.inkTool;
    document.body.style.removeProperty('--ink-cursor');
    return;
  }
  const tool = inkState().tool;
  document.body.dataset.inkTool = tool;
  document.body.style.setProperty('--ink-cursor', INK_TOOL_CURSORS[tool] || 'crosshair');
}

/** İlk kez seçilen araç için başlangıç değerleri. Silgi sert ve tam opak
    başlar; boyut kullanıcı ne kullanıyorsa ondan devralınır. */
const INK_TOOL_SETTING_DEFAULTS = {
  eraser: { hardness: 1, opacity: 1, spacing: 0.06, smoothing: 0.35, pressureCurve: 1, speedSize: 0 },
  smudge: { hardness: 0.72, opacity: 1, flow: 0.32, spacing: 0.12, smoothing: 0.3 },
  liquify: { hardness: 0.35, opacity: 0.5, spacing: 0.12, smoothing: 0.3 },
};

function inkToolSettingBucket(ink, tool, seed) {
  if (!ink.toolSettings || typeof ink.toolSettings !== 'object') ink.toolSettings = {};
  let bucket = ink.toolSettings[tool];
  if (!bucket || typeof bucket !== 'object') {
    bucket = {};
    if (seed && INK_TOOL_SETTING_DEFAULTS[tool]) {
      Object.assign(bucket, INK_TOOL_SETTING_DEFAULTS[tool]);
    }
    ink.toolSettings[tool] = bucket;
  }
  return bucket;
}

/** Araç değişirken mevcut ayarları eski araca yaz, yeni aracınkini yükle.
    Böylece fırçada yapılan ayarlar silgiye taşmaz (ve tersi). */
function inkSwapToolSettings(ink, nextTool) {
  const prevTool = ink.tool;
  if (!prevTool || prevTool === nextTool) return;
  const keys = typeof INK_TOOL_SETTING_KEYS !== 'undefined'
    ? INK_TOOL_SETTING_KEYS
    : ['brushId', 'size', 'opacity', 'hardness', 'spacing', 'smoothing', 'pressureCurve', 'speedSize', 'flow', 'flowJitter', 'scatter', 'taperStart', 'taperEnd'];
  const prev = inkToolSettingBucket(ink, prevTool);
  for (const key of keys) {
    if (ink[key] !== undefined) prev[key] = ink[key];
  }
  const next = inkToolSettingBucket(ink, nextTool, true);
  for (const key of keys) {
    if (next[key] !== undefined && next[key] !== null) ink[key] = next[key];
  }
}

function inkSetTool(tool, options = {}) {
  const ink = inkState();
  const allowed = ['brush', 'pencil', 'eraser', 'fill', 'smudge', 'liquify', 'gradient', 'shape', 'lasso', 'marquee', 'text', 'eyedropper', 'transform'];
  if (!allowed.includes(tool)) return;
  inkCancelStroke();
  inkSwapToolSettings(ink, tool);
  ink.tool = tool;
  if (options.shape) ink.shape = options.shape;
  /* deferUi: fırça değişimi zincirinin (setActiveBrush) TEK senkronda
     toplaması için UI senkronunu erteler — aksi halde çifte inkSyncUI
     fırça geçişini ~2× ağır yapıyordu (profiler bulgusu). */
  if (options.brushId) {
    ink.brushId = options.brushId;
    const b = inkGetBrush(options.brushId);
    if (b) {
      if (b.kind === 'procedural') ink.hardness = b.hardness;
      ink.spacing = b.spacing;
      ink.flow = b.flow;
      ink.flowJitter = b.flowJitter;
      ink.scatter = b.scatter;
      ink.taperStart = b.taperStart;
      ink.taperEnd = b.taperEnd;
    }
    // Sağ tık panelindeki yuvalar son kullanılan fırçaları gösterir.
    if (typeof inkRadialTouch === 'function') inkRadialTouch(options.brushId);
  }
  if (tool !== 'lasso' && tool !== 'marquee' && tool !== 'transform') {
    // Seçim korunur ama gizmo gizlenir; böylece boyarken tutamaçlar
    // fırçanın önüne geçmez.
    if (typeof inkEditorUi !== 'undefined' && inkEditorUi) inkEditorUi.freeTransform = false;
    inkUpdateGizmo();
  } else {
    inkUpdateGizmo();
  }
  if (typeof inkEditorCursorInvalidate === 'function') inkEditorCursorInvalidate();
  inkApplyToolCursor();
  if (typeof inkSyncUI === 'function' && !options.deferUi) inkSyncUI();
}

/* =========================================================
   Kalem arkası silgi (Wacom uç çevirme)
   ========================================================= */
/* PointerEvent sözleşmesi: kalemin arkası çevrildiğinde pointerType 'pen'
   + buttons bit 32 (button 5) gelir. Bu bit vuruş boyunca aracı GEÇİCİ
   olarak silgiye çevirir; bırakınca önceki araç ve o aracın ayarları
   geri yüklenir (Photoshop kalıbı). Ayarlar inkSwapToolSettings ile
   araca-açık yazılır/okunur, yani silgi kendi boyut/sertlik ayarıyla çalışır. */
function inkPenEraserEvent(e) {
  return !!e && e.pointerType === 'pen' &&
    (((e.buttons | 0) & 32) !== 0 || e.button === 5);
}

/** Vuruş başında geçici silgiye çevirir; çevrildiyse true döner. */
function inkPenEraserMaybeSwap(e) {
  if (!inkPenEraserEvent(e)) return false;
  const ink = inkState();
  if (ink.tool === 'eraser') return false; /* zaten silgi: değişim yok */
  if (!['brush', 'pencil', 'fill', 'smudge', 'liquify', 'gradient', 'shape'].includes(ink.tool)) {
    return false; /* yalnız boyama araçlarında devreye girer */
  }
  inkRuntime.penEraserRestore = { tool: ink.tool, brushId: ink.brushId };
  inkSwapToolSettings(ink, 'eraser');
  ink.tool = 'eraser';
  if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
  inkApplyToolCursor();
  if (typeof inkEditorCursorInvalidate === 'function') inkEditorCursorInvalidate();
  if (typeof inkSyncUI === 'function') inkSyncUI();
  return true;
}

/** Vuruş sonunda önceki araca döner. */
function inkPenEraserRestore() {
  const saved = inkRuntime ? inkRuntime.penEraserRestore : null;
  if (!saved) return;
  inkRuntime.penEraserRestore = null;
  const ink = inkState();
  if (ink.tool !== 'eraser') return; /* kullanıcı bu arada araç değiştirdi */
  inkSwapToolSettings(ink, saved.tool);
  ink.tool = saved.tool;
  if (saved.brushId) ink.brushId = saved.brushId;
  if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
  inkApplyToolCursor();
  if (typeof inkEditorCursorInvalidate === 'function') inkEditorCursorInvalidate();
  if (typeof inkSyncUI === 'function') inkSyncUI();
}

function inkCancelStroke() {
  if (!inkPointer && !inkTransform) return;
  if (inkPointer && inkPointer.snapHold) { inkPointer.snapHold.disarm(); inkPointer.snapHold = null; }
  inkPointer = null;
  inkTransform = null;
  inkShapeLast = null;
  inkClearLive();
}

/* =========================================================
   hedef katman ve isabet testleri
   ========================================================= */
function inkPointInItem(it, world) {
  if (!it) return false;
  const c = itemCenter(it);
  const r = -(it.rot || 0) * Math.PI / 180;
  const dx = world.x - c.x;
  const dy = world.y - c.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= it.w / 2 && Math.abs(ly) <= (it.h || 0) / 2;
}

function inkTopImageAt(world) {
  let best = null;
  for (const it of state.items) {
    if (!it || it.kind !== 'image' || it.locked) continue;
    if (!inkPointInItem(it, world)) continue;
    if (!best || (it.z || 0) > (best.z || 0)) best = it;
  }
  return best;
}

function inkUnlockedGlobalLayer(plane) {
  const ink = inkState();
  let layer = ink.layers.find(l => l.kind === 'global' && l.plane === plane && !l.locked);
  if (!layer) layer = inkAddLayer({ kind: 'global', plane, name: plane === 'above' ? 'Notes' : 'Sketch' });
  return layer;
}

/**
 * Bağlamsal çizimde yerel noktayı görselin 0..1 kutusuna kelepçeler.
 * Böylece görselin dışına taşan sürükleme, vuruş verisinde de dışarıda
 * kalmaz; seçim/gizmo sınırları görselin dışına taşmaz.
 */
function inkClampScopeLocal(layer, local) {
  if (!local) return local;
  if (!inkRuntime.imageScopeId) return local;
  if (!layer || layer.kind !== 'attached' || layer.ownerId !== inkRuntime.imageScopeId) return local;
  return { x: clamp(local.x, 0, 1), y: clamp(local.y, 0, 1) };
}

/** Yerel nokta, çizim yapılan görselin 0..1 kutusunun dışında mı? */
function inkLocalOutsideScope(layer, local) {
  if (!local) return false;
  if (!inkRuntime.imageScopeId) return false;
  if (!layer || layer.kind !== 'attached' || layer.ownerId !== inkRuntime.imageScopeId) return false;
  return local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1;
}

/** 0..1 birim kutusunun dışında mı? (küçük tolerans) */
function inkUnitOutside(p, eps = 1e-9) {
  if (!p) return true;
  return p.x < -eps || p.x > 1 + eps || p.y < -eps || p.y > 1 + eps;
}

/**
 * [a, b] doğru parçasını 0..1 birim kutusuna kırpar (Liang–Barsky).
 * Parçanın kutunun içinde kalan kısmı `{ t0, t1 }` olarak döner; hiç
 * kesişmiyorsa null. Vuruş kenarı geçerken yol bu aralıkla kesilir;
 * böylece tuvalin dışına boya taşmaz, köşede iz kopmaz.
 */
function inkClipUnitSegment(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    // p·t <= q sınırı; p === 0 ise q < 0 olmadıkça kesişim yok.
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x)) return null;
  if (!clip(dx, 1 - a.x)) return null;
  if (!clip(-dy, a.y)) return null;
  if (!clip(dy, 1 - a.y)) return null;
  if (t1 < t0 - 1e-12) return null;
  return { t0, t1 };
}

/**
 * Çizim hedefini belirler.
 * Görselin üstünde başlayan fırça otomatik olarak o görsele bağlı bir
 * katman açar (referans uygulama'taki "akıllı nesne üstüne boya" hissi).
 * "On Top" düzlemindeki global katmanlar ise görsellerin üzerine not
 * düşmek için kullanılır ve otomatik bağlanmaz.
 */
function inkResolveDrawLayer(world) {
  const ink = inkState();
  const active = inkActiveLayer();

  // 0) Bağlamsal çizim ("Start Drawing"): hedef görselin dışına çizim yok.
  //    Hangi katman seçili olursa olsun yalnızca görsele bağlı katman kullanılır.
  const scope = inkScopedImage();
  if (scope) {
    if (!inkPointInItem(scope, world)) return null;
    // Belgede seçili katman çizim hedefidir. Kilitli katman çizim almaz.
    if (active && active.kind === 'attached' && active.ownerId === scope.id) {
      return active.locked ? null : active;
    }
    const layer = inkLayersForOwner(scope.id).find(l => !l.locked) || null;
    if (layer) {
      ink.activeLayerId = layer.id;
      return layer;
    }
    return null;
  }

  // 1) Aktif görsele bağlı katman yalnızca görselin sınırları içinde geçerli.
  //    Dışına çizince dünya katmanına düşer; böylece görselin dışına taşan
  //    "görünmez" vuruşlar oluşmaz.
  if (active && !active.locked && active.kind === 'attached') {
    const owner = getItem(active.ownerId);
    if (owner && inkPointInItem(owner, world)) return active;
  }

  // 2) "On Top" global katman: görsellerin üzerine not düşmek için.
  if (active && !active.locked && active.kind === 'global' && active.plane === 'above') {
    return active;
  }

  // 3) Görselin üstünde başlayan çizim otomatik olarak ona bağlanır.
  if (ink.autoAttach) {
    const it = inkTopImageAt(world);
    if (it) {
      const unlocked = inkLayersForOwner(it.id).find(l => !l.locked);
      const layer = unlocked || inkEnsureAttachedLayer(it.id);
      if (layer && !layer.locked) {
        ink.activeLayerId = layer.id;
        return layer;
      }
    }
  }

  // 4) Aktif dünya katmanı (altta).
  if (active && !active.locked && active.kind === 'global') return active;

  const fallback = inkUnlockedGlobalLayer('below');
  if (fallback) ink.activeLayerId = fallback.id;
  return fallback;
}

function inkStrokeHit(layer, world) {
  if (!layer) return null;
  const list = layer.strokes;
  const tol = Math.max(4, 6 / Math.max(0.05, state.view.scale));
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    const b = inkStrokeWorldBounds(layer, s);
    if (!b) continue;
    if (world.x < b.x - tol || world.x > b.x + b.w + tol ||
        world.y < b.y - tol || world.y > b.y + b.h + tol) continue;
    const pts = s.points.map(p => inkLocalToWorld(layer, p)).filter(Boolean);
    if (!pts.length) continue;
    const radius = Math.max(2, inkLocalSizeToWorld(layer, s.size) / 2 + tol);
    for (let k = 0; k < pts.length - 1; k++) {
      if (inkDistToSegment(world, pts[k], pts[k + 1]) <= radius) return s;
    }
    if (pts.length === 1 && Math.hypot(world.x - pts[0].x, world.y - pts[0].y) <= radius) return s;
  }
  return null;
}

function inkDistToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function inkPointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a.y > p.y) !== (b.y > p.y)) &&
        (p.x < (b.x - a.x) * (p.y - a.y) / ((b.y - a.y) || 1e-9) + a.x)) {
      inside = !inside;
    }
  }
  return inside;
}

/* =========================================================
   basınç / palmiye reddi
   ========================================================= */
function inkEventPressure(e) {
  if (!e) return 1;
  const p = Number(e.pressure);
  const has = Number.isFinite(p);
  // Kalem ve dokunmatik: gerçek basınç varsa onu kullan. Basınç bildirmeyen
  // cihazlar 0 ya da fare varsayılanı 0.5 gönderir; o durumda nötr değer.
  if (e.pointerType === 'pen' || e.pointerType === 'touch') {
    return has && p > 0 ? clamp(p, 0.02, 1) : 0.5;
  }
  // Bazı tablet sürücüleri kalemi "mouse" olarak bildirir ama gerçek basınç
  // gönderir (0.5 = basınçsız fare). 0.5 dışındaki değeri basınç say.
  if (has && p > 0 && Math.abs(p - 0.5) > 0.001) return clamp(p, 0.02, 1);
  return 1;
}

/**
 * Kalem eğimini okur. Pointer Events `tiltX/tiltY` derece (-90..90)
 * verir; biz 0..1 büyüklük ve radyan yön olarak saklarız.
 * Dik tutulan kalemde ve farede `null` döner: çizim bugünküyle aynı kalır.
 */
function inkEventTilt(e) {
  if (!e || e.pointerType !== 'pen') return null;
  const tx = Number(e.tiltX);
  const ty = Number(e.tiltY);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  const magnitude = Math.hypot(tx, ty) / 90;
  if (!(magnitude > 0.02)) return null;
  return { t: clamp(magnitude, 0, 1), a: Math.atan2(ty, tx) };
}

/** Noktaya eğim alanlarını (varsa) ekler. */
function inkApplyTilt(point, tilt) {
  if (tilt) {
    point.t = tilt.t;
    point.a = tilt.a;
  }
  return point;
}

function inkIsPalm(e) {
  if (e.pointerType === 'pen') {
    inkRuntime.penSeenAt = performance.now();
    return false;
  }
  if (e.pointerType === 'touch') {
    // Kalem son 1,5 saniyede görüldüyse dokunmayı avuç içi say.
    if (performance.now() - inkRuntime.penSeenAt < 1500) return true;
    inkRuntime.lastTouchAt = performance.now();
  }
  return false;
}

/* =========================================================
   vuruş başlatma
   ========================================================= */
function inkBeginFreehand(e, tool, world) {
  const ink = inkState();
  const layer = inkResolveDrawLayer(world);
  if (!layer) return false;
  if (tool === 'fill' && layer.kind !== 'attached') {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('The paint bucket currently works only on image-linked layers.', 3200);
    }
    return false;
  }
  if (layer.locked) return false;

  const brush = inkGetBrush(ink.brushId);
  const local = inkClampScopeLocal(layer, inkWorldToLocal(layer, world));
  const rawPressure = inkEventPressure(e);
  const curve = clamp(Number(ink.pressureCurve) || 1, 0.2, 3);
  const pressure = inkCurvePressure(rawPressure, curve);
  const tilt = inkEventTilt(e);
  const sizeLocal = inkWorldSizeToLocal(layer, ink.size);
  const stroke = {
    id: 'sk_' + newId(),
    kind: tool === 'shape' ? 'shape' : ['fill', 'smudge', 'liquify', 'gradient'].includes(tool) ? tool : 'stroke',
    tool: ['eraser', 'fill', 'smudge', 'liquify', 'gradient'].includes(tool) ? tool : 'brush',
    shape: tool === 'shape' ? ink.shape : '',
    color: ink.color,
    size: sizeLocal,
    opacity: ink.opacity,
    hardness: ink.hardness,
    spacing: ink.spacing,
    flow: ink.flow,
    flowJitter: ink.flowJitter,
    speedSize: clamp(Number(ink.speedSize) || 0, 0, 0.8),
    flow: clamp(Number.isFinite(ink.flow) ? ink.flow : (brush ? brush.flow : 1), 0.01, 1),
    flowJitter: clamp(Number.isFinite(ink.flowJitter) ? ink.flowJitter : (brush ? brush.flowJitter : 0), 0, 1),
    taperStart: clamp(Number.isFinite(ink.taperStart) ? ink.taperStart : (brush ? brush.taperStart : 0), 0, 3),
    taperEnd: clamp(Number.isFinite(ink.taperEnd) ? ink.taperEnd : (brush ? brush.taperEnd : 0), 0, 3),
    brushId: ink.brushId,
    scatter: clamp(Number.isFinite(ink.scatter) ? ink.scatter : (brush ? brush.scatter : 0), 0, 2),
    fillTolerance: 24,
    closed: false,
    // Alfa kilidi vuruş başına kaydedilir: kilit sonradan açılırsa eski
    // vuruşların davranışı değişmez (referans uygulama anlambilimi).
    lockAlpha: !!layer.alphaLock,
    points: [inkApplyTilt({ x: local.x, y: local.y, p: pressure, s: 0 }, tilt)],
  };
  // FAZ 7.W: gradyan vuruşuna canlı durakların deep kopyası gömülür —
  // sonraki bar düzenlemeleri pişmiş vuruşu değiştirmez (alfa kilidiyle
  // aynı referans anlambilimi: kilit sonradan açılsa da eski vuruş
  // eski davranışıyla kalır).
  if (tool === 'gradient') stroke.stops = inkGradientStopsBake(ink);

  const stamp = Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now();
  inkPointer = {
    mode: tool === 'shape' ? 'shape' : 'freehand',
    tool,
    layer,
    stroke,
    smoothX: local.x,
    smoothY: local.y,
    // FAZ 2: One-Euro filtre durumu (x/y/basınç kanalları).
    stab: typeof inkStabilizerBegin === 'function' ? inkStabilizerBegin() : null,
    startWorld: world,
    startLocal: local,
    lastPressure: pressure,
    lastScreen: null,
    pressureCurve: curve,
    speed: 0,
    lastInputAt: stamp,
    lastClient: { x: e.clientX, y: e.clientY },
    collected: 0,
    outside: false,
    // Tur 4: canlı şekil ayarı durumu (Shift kilidi, ayar çapası/durumu).
    shiftHeld: !!e.shiftKey,
    snapFirePt: null,
    snapAdj: null,
  };
  inkLastLive = null;
  return true;
}

function inkBeginSelection(e, tool, world) {
  inkPointer = {
    mode: tool,
    tool,
    // FAZ 6 B6: seçim modu drag başında sabitlenir (Shift/Alt geçici
    // üstünlüğü; yoksa options bar'dan seçilen kalıcı mod).
    selMode: inkSelectEffectiveMode(e),
    worldPoints: [world],
    startWorld: world,
    startScreen: { x: e.clientX, y: e.clientY },
    lastScreen: { x: e.clientX, y: e.clientY },
    layer: inkActiveLayer(),
  };
  inkClearLive();
  return true;
}

/* =========================================================
   canlı önizleme
   ========================================================= */
function inkLiveScreenOf(layer, point) {
  return inkLocalToScreen(layer, point);
}

function inkLiveSizePx(layer, stroke) {
  const worldSize = inkLocalSizeToWorld(layer, stroke.size);
  return Math.max(0.8, worldSize * state.view.scale);
}

/** Katman nokta uzayı → ekran pikseli ölçeği (damla aralığı için). */
function inkLivePointScale(layer) {
  const s = Math.max(1e-4, state.view.scale);
  const it = layer && layer.kind === 'attached' ? inkItemForLayer(layer) : null;
  return it
    ? { x: Math.max(1e-4, it.w || 1) * s, y: Math.max(1e-4, it.h || 1) * s }
    : { x: s, y: s };
}

function inkDrawLiveDab(stroke, layer, pt, opts = {}) {
  const ctx = inkLive.ctx;
  if (!ctx) return;
  const screen = inkLiveScreenOf(layer, pt);
  if (!screen) return;
  const sizePx = inkLiveSizePx(layer, stroke);
  const pressure = clamp(pt.p, 0.02, 1);
  const brush = inkGetBrush(stroke.brushId);
  const dyn = inkBrushDynamics(brush);
  const speed = clamp(pt.s || 0, 0, 1);
  const driver = dyn.src === 'velocity' ? 1 - speed : pressure;
  const liveSpacing = Math.max(0.8, sizePx * clamp(stroke.spacing, 0.01, 2));
  const radius = Math.max(0.35,
    inkDabRadius(sizePx, brush, driver, speed, stroke.speedSize,
      Math.min(sizePx / 2, liveSpacing * 0.62)) *
    (Number.isFinite(pt.k) ? clamp(pt.k, 0, 1) : 1));
  if (!opts.force && inkLastLive) {
    const d = Math.hypot(screen.x - inkLastLive.x, screen.y - inkLastLive.y);
    if (d < Math.max(0.7, sizePx * Math.min(stroke.spacing, 0.12) * 0.35)) return;
  }
  const isEraser = stroke.tool === 'eraser';
  // FAZ 1B (Layer Mask): maske düzenleme modunda canlı damga beyaz
  // (alfa ekle) ya da kırmızımsı (alfa gizle) izi gösterir — katman
  // rengiyle karışıklık olmasın.
  const maskLive = !!(layer && layer.kind === 'attached' && layer.mask &&
    inkState().maskEditId === layer.id);
  const liveColor = maskLive
    ? (isEraser ? 'rgba(255,96,96,1)' : '#ffffff')
    : stroke.color;
  const flow = Number.isFinite(stroke.flow)
    ? clamp(stroke.flow, 0.01, 1)
    : (brush && Number.isFinite(brush.flow) ? clamp(brush.flow, 0.01, 1) : 1);
  const flowJitter = Number.isFinite(stroke.flowJitter)
    ? clamp(stroke.flowJitter, 0, 1)
    : (brush && Number.isFinite(brush.flowJitter) ? clamp(brush.flowJitter, 0, 1) : 0);
  const grain = brush && brush.texture ? inkTextureGrain(screen.x, screen.y) : 1;
  const dabIndex = Number.isFinite(opts.index) ? opts.index : 0;
  const dabFlow = flowJitter > 0
    ? flow * (1 - inkStrokeRandom(stroke, dabIndex, 2) * flowJitter)
    : flow;
  const tip = typeof inkStampFor === 'function'
    ? inkStampFor(brush, liveColor, stroke.hardness, radius * 2, isEraser).canvas
    : (isEraser ? inkProceduralTip(1, sizePx) : inkTintedTip(brush, liveColor, stroke.hardness, sizePx));
  if (typeof inkPerfCount === 'function') inkPerfCount('liveDabs');
  ctx.save();
  inkClipLiveToLayer(layer);
  const minOpacity = clamp(Number.isFinite(dyn.opacityMin) ? dyn.opacityMin : 0.35, 0, 1);
  /* K15 · canlı önizleme = commit'in çift tampon gösterimi: damla tam
     boyut ağırlığıyla stroke-scratch'e birikir; sunum (bu tuvalin
     element opaklığı) TEK geçişte stroke.opacity taşır. drawImage'ın
     sRGB bileşimiyle birebir aynı matematik — artık canlı gövde ile
     commit birebir ardışık (n-root seyreltme K15'ten beri yok). Silgi
     affordansı (0.22 beyaz izi) eskisi gibi kalır. */
  if (isEraser) {
    ctx.globalAlpha = 0.22;
    if (inkLive.canvas) inkLive.canvas.style.opacity = '';
  } else {
    const satAlpha = clamp((minOpacity + (1 - minOpacity) * pressure) *
      dabFlow * grain, 0, 1);
    ctx.globalAlpha = satAlpha;
    if (inkLive.canvas) {
      const el = inkLive.canvas.style.opacity;
      const want = String(clamp(stroke.opacity, 0, 1));
      if (el !== want) inkLive.canvas.style.opacity = want;
    }
  }
  if (isEraser) {
    // Silgi önizlemesi beyazımsı bir iz olarak gösterilir.
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
  }
  if (stroke.scatter > 0) {
    const a = inkStrokeRandom(stroke, dabIndex, 0) * Math.PI * 2;
    const r = inkStrokeRandom(stroke, dabIndex, 1) * radius * stroke.scatter;
    inkDrawTiltedStamp(ctx, tip, screen.x + Math.cos(a) * r, screen.y + Math.sin(a) * r, radius, pt.t, pt.a);
  } else {
    inkDrawTiltedStamp(ctx, tip, screen.x, screen.y, radius, pt.t, pt.a);
  }
  ctx.restore();
  inkLastLive = screen;
}

function inkLivePolylineLength(points, scale, endIndex = points.length - 1) {
  const sx = typeof scale === 'number' ? scale : scale.x;
  const sy = typeof scale === 'number' ? scale : scale.y;
  let length = 0;
  for (let i = 1; i <= endIndex && i < points.length; i++) {
    if (!points[i].br) {
      length += Math.hypot((points[i].x - points[i - 1].x) * sx,
        (points[i].y - points[i - 1].y) * sy);
    }
  }
  return length;
}

function inkEmitLiveSegment(layer, stroke, points, progress = {}) {
  if (!points.length) return;
  const sizePx = inkLiveSizePx(layer, stroke);
  const spacing = Math.max(0.8, sizePx * clamp(stroke.spacing, 0.01, 2));
  const brush = inkGetBrush(stroke.brushId);
  const dynamics = inkBrushDynamics(brush);
  inkForEachDab(points, spacing, (pt, _pressure, index) =>
    inkDrawLiveDab(stroke, layer, pt, { index }), inkLivePointScale(layer), {
      spacingJitter: dynamics.spacingJitter,
      strokeId: stroke.id,
      taperStartPx: (stroke.taperStart || 0) * sizePx,
      taperEndPx: progress.final ? (stroke.taperEnd || 0) * sizePx : 0,
      progressOffsetPx: progress.offsetPx || 0,
      totalLengthPx: progress.totalLengthPx,
    });
}

function inkDrawLiveShape(layer, stroke) {
  const ctx = inkLive.ctx;
  if (!ctx) return;
  inkClearLive();
  ctx.save();
  inkClipLiveToLayer(layer);
  inkDrawStrokeOnContext(ctx, stroke, {
    mapPoint: p => {
      const s = inkLocalToScreen(layer, p);
      return s || { x: -9999, y: -9999 };
    },
    sizePx: inkLiveSizePx(layer, stroke),
    pointScale: inkLivePointScale(layer),
  });
  ctx.restore();
  inkLastLive = null;
}

function inkDrawLivePath(worldPoints, color = '#4da3ff') {
  const ctx = inkLive.ctx;
  if (!ctx) return;
  inkClearLive();
  if (worldPoints.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  const first = worldToScreen(worldPoints[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < worldPoints.length; i++) {
    const p = worldToScreen(worldPoints[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

/* =========================================================
   şekil oturtma (kalemi bekletince şekle dönüş)
   ========================================================= */
/** Vuruş oturtmaya uygun mu? Tüm çizim fırçalarının serbest vuruşları
    (silgi hariç) — her fırçada oturtma çalışır; şekil vuruşun fırça
    özellikleriyle (akış/sertlik/doku/çift uç) yazılır. */
function inkFreehandSnapEligible(p) {
  if (!p || p.mode !== 'freehand' || p.snapped) return false;
  const stroke = p.stroke;
  if (!stroke || stroke.kind !== 'stroke') return false;
  if (stroke.tool === 'eraser') return false;
  return !!inkState().shapeSnap;
}

/** Pointermove hattında zamanlayıcıyı yönetir: hareket çapayı aşarsa
    yeniden kurulur (yavaş çizim asla tetiklemez), durursa
    INK_SNAP_HOLD_MS sonra tek geçişlik tanıyıcı koşar. */
function inkFreehandSnapTrack(e) {
  const p = inkPointer;
  /* Tur 4: Shift + çizgi = kullanıcı AÇIK düz çizgi istiyor. Oturtma
     bu niyetle yarışmamalı: duraksayan Shift çizgisinde oturtma
     tetiklenir, harekette şekil bozulur → "sapıtma". Shift basılıyken
     zamanlayıcı tamamen kapalı. */
  if (p && e.shiftKey) p.shiftHeld = true;
  if (!inkFreehandSnapEligible(p) || (p && p.shiftHeld)) {
    if (p && p.snapHold) { p.snapHold.disarm(); p.snapHold = null; }
    return;
  }
  if (!p.snapHold) p.snapHold = inkShapeSnapHoldCreate(inkFreehandSnapFire);
  p.snapHold.track(e.clientX, e.clientY);
}

/** Bekleme süresi doldu: vuruşu tanı ve mükemmel şekle çevir.

    Tur 4i: bu işlev ARTIK yalnız hold zamanlayıcısından çağrılır —
    kalem kaldırıldığında (bırakış anında) oturtma YOK (36-ink-editor
    inkEditorSnapFire ile aynı sözleşme; Procreate modeli). */
function inkFreehandSnapFire() {
  const p = inkPointer;
  if (!p) return;
  if (p.snapHold) p.snapHold.timer = null;
  /* Tur 4: Shift basılıyken tetiklenen bekleyici oturtma yapmaz. */
  if (p.shiftHeld) return;
  if (!inkFreehandSnapEligible(p)) return;
  const it = p.layer && p.layer.kind === 'attached' ? inkItemForLayer(p.layer) : null;
  const attached = p.layer && p.layer.kind === 'attached';
  const sx = attached ? (it ? (it.w || 1) : 1) : 1;
  const sy = attached ? (it ? (it.h || 1) : 1) : 1;
  if (!inkShapeSnapConvertStroke(p.stroke, sx, sy)) {
    /* Tur 4e · smooth-on-null: hiçbir şekle benzemiyorsa ve kalem hâlâ
       basılıysa ham izi yerinde pürüzsüzleştir ("sanki smooth eklenmiş
       gibi"); canlı overlay tam yeniden çizilir, serbest çizim normal
       yolla sürer. Shift erken dönüşü smooth'a sokmaz. */
    if (inkSmoothFreehandStrokeInPlace(p.stroke, sx, sy)) {
      inkDrawLiveShape(p.layer, p.stroke);
    }
    return;
  }
  /* Tur 4: ayar çapası — kalemin ATEŞ anındaki gerçek konumu (lastClient).
     hold'un anchor'ı son ≥8px harekette kalır; son <8px adımlar çapayı
     geride bırakır ve mikro titreme 8px eşiğini aşabilir (yanlışlıkla
     canlı ayar başlardı). */
  p.snapFirePt = (p.lastClient && Number.isFinite(p.lastClient.x))
    ? { x: p.lastClient.x, y: p.lastClient.y }
    : (p.snapHold && p.snapHold.anchor
      ? { x: p.snapHold.anchor.x, y: p.snapHold.anchor.y }
      : null);
  p.snapAdj = null;
  p.snapped = true;
  // Canlı önizleme: ham iz temizlenir, kusursuz şekil çizilir.
  inkDrawLiveShape(p.layer, p.stroke);
}

/* =========================================================
   Tur 4e/4j · smooth-on-null (tahta yolu)
   Oturtma tanıyıcı hiçbir şekle dönüşemediğinde ve kalem hâlâ
   basılıyken ham iz yerinde mükemmelleştirilir (36-ink-editor
   inkEditorSmoothFreehandStroke ile parite): çekirdek 30b
   inkShapeSnapFairPath — keskin köşeler rijit (Z asla S olmaz),
   Taubin λ/μ akıtma, açık izde yakın-düz span akord dizilimi,
   uçlar bit-birebir çapa → p.smoothX/smoothY dokunulmaz.
   br bayraklı kopuk vuruşlar ve çok kısa/az noktalı izler
   mükemmelleştirilmez. Dönüş true: çağıran canlı overlay'i tam
   yeniden çizer.
   ========================================================= */
function inkSmoothFreehandStrokeInPlace(stroke, dw, dh) {
  if (!stroke || stroke.kind !== 'stroke') return false;
  const arr = inkShapeSnapFairPath(stroke.points, dw, dh);
  if (!arr) return false;
  stroke.points = arr;
  return true;
}

/* =========================================================
   Tur 4 · canlı şekil ayarı (ana tahta portu — 36-ink-editor ile
   aynı sözleşme: daire → eksen-bağımsız kenar-takip (Tur 4b), çizgi →
   serbest uç, ötekiler → merkezden tek-çapraz ölçek; kare kare
   birikim yok)
   ========================================================= */
const INK_ADJUST_DRIFT_PX = 8;

/** İlk ayar karesi: şekil parametrelerini ve tutamağı sınıflandır.
    Ölçüler vuruşun yerel uzayındadır (bağlı katmanda 0..1). */
function inkFreehandSnapAdjInit(stroke, q) {
  const pts = stroke.points;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of pts) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let rw = (maxX - minX) / 2, rh = (maxY - minY) / 2;
  /* Tur 4d: yatay/dikey ÇİZGİ dejenere bbox (rh==0 / rw==0) → null
     dönme (36-ink-editor ile aynı kök neden: null → revert → ham iz +
     Shift kilidi karışımı). Çizgi ayarı ilk noktayı kullanır; kenetle. */
  if (!(rw > 1e-6) || !(rh > 1e-6)) {
    if (stroke.shape !== 'line') return null;
    rw = Math.max(rw, 1e-4);
    rh = Math.max(rh, 1e-4);
  }
  // Dönüş yönü: ikinci noktanın ilkine göre açısal işareti.
  let dir = 1;
  if (pts[1]) {
    let d = Math.atan2(pts[1].y - cy, pts[1].x - cx) -
            Math.atan2(pts[0].y - cy, pts[0].x - cx);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 1e-6) dir = d > 0 ? 1 : -1;
  }
  // Tutamak: kalem konumuna en yakın bbox kenar ortası (üst/alt/sol/sağ).
  const handles = [
    { id: 'top', x: cx, y: minY },
    { id: 'bottom', x: cx, y: maxY },
    { id: 'left', x: minX, y: cy },
    { id: 'right', x: maxX, y: cy },
  ];
  let handle = handles[0], bd = Infinity;
  for (const h of handles) {
    const d = Math.hypot(h.x - q.x, h.y - q.y);
    if (d < bd) { bd = d; handle = h; }
  }
  return {
    type: stroke.shape,
    cx, cy, rw, rh,
    /* Tur 4b · eksen-bağımsız kenar-takip modeli (36-ink-editor ile aynı
       sözleşme): özgün kenarlar + çapa saklanır; eksen 0.22·r0 çekmede
       devreye girer, 0.12·r0 altında bırakır (tutuklama). Kenar tarafı
       tutamak yakınlığına ya da ilk girişte hareket yönüne göre bir kez
       latched. */
    r0: (rw + rh) / 2,
    ex0: minX, ex1: maxX,
    ey0: minY, ey1: maxY,
    eng: { x: false, y: false },
    sx: 0, sy: 0,
    a0: Math.atan2(pts[0].y - cy, pts[0].x - cx),
    dir,
    handle: handle.id,
    q0: { x: q.x, y: q.y },
    first: { x: pts[0].x, y: pts[0].y, p: Number(pts[0].p) || 1 },
    orig: pts.map(pt => ({ x: pt.x, y: pt.y, p: pt.p })),
  };
}

/** Canlı şekil ayarı: her karede şekil noktaları yeniden üretilir.
    Parametreler HER ZAMAN oturtma anındaki orijinalden türetilir.
    Dönüş: ayar OTURUMU kurulduysa true (bu kare donuk kalabilir —
    eksen belirgin çekmeyi bekler); kurulamadıysa false (eski yol). */
function inkFreehandShapeAdjust(q) {
  const p = inkPointer;
  const stroke = p && p.stroke;
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return false;
  const adj = p.snapAdj || (p.snapAdj = inkFreehandSnapAdjInit(stroke, q));
  if (!adj) return false;
  let newPts = null;
  if (adj.type === 'circle') {
    /* Tur 4d · AKICI + merkez-pivot küçültme (36-ink-editor ile birebir):
       eksen ~0.03·r0'da devreye girer, ~0.015·r0 altında bırakılır
       (eski 0.22/0.12 donma-zıplama döngüsü "takıla takıla" hissiydi).
       KÜÇÜLME: pivot merkez — iki kenar simetrik merkeze (yerinde
       küçülme, tutulan kenar kalemi birebir izler). BÜYÜME: kenar-takip
       (karşı kenar sabit). */
    const dx = q.x - adj.q0.x, dy = q.y - adj.q0.y;
    const r0 = adj.r0;
    const ENG = r0 * 0.03, REL = r0 * 0.015;
    if (!adj.eng.x) { if (Math.abs(dx) >= ENG) adj.eng.x = true; }
    else if (Math.abs(dx) < REL) adj.eng.x = false;
    if (!adj.eng.y) { if (Math.abs(dy) >= ENG) adj.eng.y = true; }
    else if (Math.abs(dy) < REL) adj.eng.y = false;
    if (!adj.sx) {
      const off = adj.q0.x - adj.cx;
      if (Math.abs(off) >= r0 * 0.15) adj.sx = off > 0 ? 1 : -1;
      else if (adj.eng.x && dx) adj.sx = dx > 0 ? 1 : -1;
    }
    if (!adj.sy) {
      const off = adj.q0.y - adj.cy;
      if (Math.abs(off) >= r0 * 0.15) adj.sy = off > 0 ? 1 : -1;
      else if (adj.eng.y && dy) adj.sy = dy > 0 ? 1 : -1;
    }
    if (adj.eng.x || adj.eng.y) {
      let x0 = adj.ex0, x1 = adj.ex1, y0 = adj.ey0, y1 = adj.ey1;
      const minHalf = r0 * 0.2;
      if (adj.eng.x && adj.sx) {
        if (adj.sx > 0) {
          if (dx >= 0) {
            x1 = Math.max(adj.ex1 + dx, x0 + minHalf * 2);
          } else {
            x1 = adj.ex1 + dx;
            x0 = adj.ex0 - dx;
            if (x1 - x0 < minHalf * 2) { x1 = adj.cx + minHalf; x0 = adj.cx - minHalf; }
          }
        } else {
          if (dx <= 0) {
            x0 = Math.min(adj.ex0 + dx, x1 - minHalf * 2);
          } else {
            x0 = adj.ex0 + dx;
            x1 = adj.ex1 - dx;
            if (x1 - x0 < minHalf * 2) { x0 = adj.cx - minHalf; x1 = adj.cx + minHalf; }
          }
        }
      }
      if (adj.eng.y && adj.sy) {
        if (adj.sy > 0) {
          if (dy >= 0) {
            y1 = Math.max(adj.ey1 + dy, y0 + minHalf * 2);
          } else {
            y1 = adj.ey1 + dy;
            y0 = adj.ey0 - dy;
            if (y1 - y0 < minHalf * 2) { y1 = adj.cy + minHalf; y0 = adj.cy - minHalf; }
          }
        } else {
          if (dy <= 0) {
            y0 = Math.min(adj.ey0 + dy, y1 - minHalf * 2);
          } else {
            y0 = adj.ey0 + dy;
            y1 = adj.ey1 - dy;
            if (y1 - y0 < minHalf * 2) { y0 = adj.cy - minHalf; y1 = adj.cy + minHalf; }
          }
        }
      }
      const cx2 = (x0 + x1) / 2, cy2 = (y0 + y1) / 2;
      const rw2 = Math.max(1e-4, (x1 - x0) / 2);
      const rh2 = Math.max(1e-4, (y1 - y0) / 2);
      const steps = 64;
      newPts = [];
      for (let i = 0; i <= steps; i++) {
        const ang = adj.a0 + adj.dir * Math.PI * 2 * (i / steps);
        newPts.push({ x: cx2 + Math.cos(ang) * rw2, y: cy2 + Math.sin(ang) * rh2, p: adj.first.p });
      }
    }
  } else if (adj.type === 'line') {
    /* Çizgi: başlangıç sabit, uç kalemi izler. Shift basılıysa q zaten
       kilitlidir → çizgi kilitli doğrultuda uzar/kısalır. */
    if (Math.hypot(q.x - adj.first.x, q.y - adj.first.y) > 1e-4) {
      newPts = [adj.first, { x: q.x, y: q.y, p: adj.first.p }];
    }
  } else {
    /* Kare/dikdörtgen/üçgen/çokgen/yay: merkezden tek-çapraz ölçek.
       Kalem merkeze yaklaşınca küçülür, uzaklaşınca büyür. */
    const d0 = Math.hypot(adj.q0.x - adj.cx, adj.q0.y - adj.cy);
    if (d0 > 1e-6) {
      const f = clamp(Math.hypot(q.x - adj.cx, q.y - adj.cy) / d0, 0.02, 40);
      newPts = adj.orig.map(pt => ({
        x: adj.cx + (pt.x - adj.cx) * f,
        y: adj.cy + (pt.y - adj.cy) * f,
        p: pt.p,
      }));
    }
  }
  /* Donuk kare (eksen belirgin çekmeyi bekliyor) da OTURUM başarılıdır:
     ham iz ASLA şekil noktalarına karışmaz (çizgi/frozen-return
     sözleşmesi — çağıran yalnız init başarısızlığında düşer). */
  if (newPts) {
    stroke.points = newPts;
    inkDrawLiveShape(p.layer, stroke);
  }
  return true;
}

/* =========================================================
   pointerdown
   ========================================================= */
function inkOnPointerDown(e) {
  if (!state || !state.ink) return;
  // Referans tahtasında çizim yok: tuval girdisi yalnızca satır içi
  // çizim modalı açıkken işlenir.
  if (!inkInlineModeActive()) return;
  // Çizim modundaki referans minyatürü (#stage bu alana kırpılır) tahtayı
  // seçmek/taşımak için kullanılır; fırça girdisi burada çizim başlatmasın.
  // Panel gövdesi tıklamayı geçirdiği için olay tahtanın kendi işleyicisine
  // ulaşmalı; burada durdurmuyoruz.
  if (document.body.classList.contains('ps-ref-live')) return;
  /* Kalem arkası silgi button 5 (buttons bit 32) gelir; sol tuş gibi işlenir. */
  if (e.button !== 0 && !inkPenEraserEvent(e)) return;  // orta tuş pan için serbest
  if (spaceDown) return;                    // Space + sürükle pan
  const ink = inkState();
  if (!ink.tool) return;
  if (inkIsPalm(e)) { e.preventDefault(); return; }

  const target = e.target instanceof Element ? e.target : null;
  const inGizmo = target && target.closest('#inkGizmo');
  // Masaüstünde Alt + sürükle pencereyi taşır; çizim aracı açıkken de
  // bu davranış korunsun (gizmo tutamacı hariç).
  if (typeof isDesktop !== 'undefined' && isDesktop && e.altKey && !inGizmo) return;
  const world = screenToWorld({ x: e.clientX, y: e.clientY });

  // Düzenlenen metnin içine tıklanıyorsa tarayıcıya bırak; dışına
  // tıklanıyorsa önce düzenlemeyi bitir.
  if (target && target.closest('.item.editing')) return;
  if (editingId) commitEdit();

  // Akıllı tutamaçlar (görsel boyutlandırma) çizim aracı açıkken de çalışsın.
  if (target && target.closest('.handle, .ghandle')) return;
  // Metin öğeleri her zaman normal seçim/düzenleme davranışını korusun.
  if (target && target.closest('.item.is-text')) return;

  // Çizim sırasında sahne odakta kalsın: klavye kısayolları çalışmaya devam eder.
  if (document.activeElement !== stage) stage.focus({ preventScroll: true });

  if (inGizmo) {
    e.preventDefault();
    e.stopPropagation();
    inkStartGizmoDrag(e, target);
    return;
  }

  // Panel / araç kutusu tıklamalarını tuval girdisi sayma.
  if (target && target.closest('#inkToolbox, #inkBrushPanel, #inkLayersPanel, #inkFlyout, #inkColorWheel, #inkScopeBar')) return;

  // Bağlamsal çizim: hedef görselin dışında başlayan fırça/silgi/şekil
  // girdisi yok sayılır. Çizim başlamaz, seçim de değişmez.
  const scopeItem = inkScopedImage();
  if (scopeItem && !inkPointInItem(scopeItem, world) &&
      ['brush', 'pencil', 'eraser', 'smudge', 'liquify', 'gradient', 'shape', 'eyedropper'].includes(ink.tool)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (ink.tool === 'eyedropper') {
    e.preventDefault();
    e.stopPropagation();
    const color = inkSampleColor(e.clientX, e.clientY);
    if (color) {
      if (typeof inkSetColor === 'function') inkSetColor(color, true);
      else inkState().color = color;
      if (typeof inkSyncUI === 'function') inkSyncUI();
    }
    inkSetTool('brush');
    return;
  }

  if (ink.tool === 'text') {
    e.preventDefault();
    e.stopPropagation();
    addText(world);
    return;
  }

  if (ink.tool === 'transform') {
    // Çizim seçimi tutulduysa olayı biz işleriz; aksi hâlde normal tahta
    // davranışı (öğe seç / sürükle / dikdörtgen seçim) devam etsin.
    if (inkBeginTransformClick(e, world)) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  if (ink.tool === 'lasso' || ink.tool === 'marquee') {
    e.preventDefault();
    e.stopPropagation();
    inkBeginSelection(e, ink.tool, world);
    return;
  }

  if (['brush', 'pencil', 'eraser', 'fill', 'smudge', 'liquify', 'gradient', 'shape'].includes(ink.tool)) {
    e.preventDefault();
    e.stopPropagation();
    if (e.pointerType === 'pen') inkRuntime.penSeenAt = performance.now();
    /* Kalem arkası silgi: vuruş öncesi geçici araç değişimi (ink.tool
       güncellenir; pointerup'ta inkPenEraserRestore geri koyar). */
    inkPenEraserMaybeSwap(e);
    const toolNow = inkState().tool;
    const ok = inkBeginFreehand(e, toolNow, world);
    if (!ok) {
      if (typeof showProjectNotice === 'function') showProjectNotice('Layer locked. Select another layer.', 2600);
      inkPenEraserRestore();
      return;
    }
    // İlk damla
    inkEnsureLiveCanvas();
    inkClearLive();
    const first = Object.assign({}, inkPointer.stroke.points[0], {
      k: inkPointer.stroke.taperStart > 0 ? 0 : 1,
    });
    if (!['fill', 'smudge', 'liquify', 'gradient'].includes(toolNow)) {
      inkDrawLiveDab(inkPointer.stroke, inkPointer.layer, first, { force: true });
    }
    try { stage.setPointerCapture(e.pointerId); } catch { /* sessiz */ }
  }
}

/* =========================================================
   pointermove
   ========================================================= */
function inkOnPointerMove(e) {
  if (inkTransform) {
    e.preventDefault();
    e.stopPropagation();
    inkOnTransformMove(e);
    return;
  }
  if (!inkPointer) return;
  if (inkIsPalm(e)) return;
  e.preventDefault();
  e.stopPropagation();

  if (inkPointer.mode === 'lasso' || inkPointer.mode === 'marquee') {
    inkUpdateSelectionDrag(e);
    return;
  }
  if (inkPointer.mode === 'freehand' || inkPointer.mode === 'shape') {
    // getCoalescedEvents(): yüksek örneklemeli kalemde aradaki örnekler
    // kaybolmasın. Hepsi aynı karede işlenir, tek commit olur.
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (list && list.length > 1) {
      for (const sample of list) {
        if (!inkPointer) break;
        inkUpdateFreehandDrag(sample);
      }
    } else {
      inkUpdateFreehandDrag(e);
    }
  }
}

function inkUpdateSelectionDrag(e) {
  const cur = screenToWorld({ x: e.clientX, y: e.clientY });
  inkPointer.lastScreen = { x: e.clientX, y: e.clientY };

  if (inkPointer.mode === 'marquee') {
    const a = worldToScreen(inkPointer.startWorld);
    const b = { x: e.clientX, y: e.clientY };
    const ctx = inkLive.ctx;
    if (!ctx) return;
    inkClearLive();
    ctx.save();
    ctx.strokeStyle = '#4da3ff';
    ctx.fillStyle = 'rgba(77,163,255,.12)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    return;
  }

  const pts = inkPointer.worldPoints;
  const last = pts[pts.length - 1];
  if (Math.hypot(cur.x - last.x, cur.y - last.y) * state.view.scale > 1.5) {
    pts.push(cur);
    if (pts.length > 4000) pts.shift();
  }
  inkDrawLivePath(pts);
}

function inkUpdateFreehandDrag(e) {
  const p = inkPointer;
  if (p.stroke.kind === 'fill') return;
  const world = screenToWorld({ x: e.clientX, y: e.clientY });
  const rawLocal = inkWorldToLocal(p.layer, world);
  if (!rawLocal) return;
  // İmleç tuvalin dışına çıkabilir: dışarıda boya yok ama izleme sürer.
  // Kenarı geçerken yol tam sınıra kırpılır; geri girince aynı vuruş
  // kaldığı yerden devam eder (köşede kesilme olmaz).
  const scoped = !!inkRuntime.imageScopeId &&
    p.layer && p.layer.kind === 'attached' && p.layer.ownerId === inkRuntime.imageScopeId;
  // Shift düz-çizgi kilidi (Photoshop tarzı): ham nokta vuruşun ilk
  // noktasından geçen KİLİTLİ eksene izdüşürülür (Tur 4h: eksen ilk
  // belirgin harekette seçilir ve vuruş boyunca korunur; dik bileşen
  // tamamen atılır). Kırpma (scope) sonra uygulanır. Görsele bağlı
  // katmanda ölçü kâğıt pikselleriyle, global katmanda uzay tek
  // oranlı kabul edilerek yapılır.
  const lockStart = p.stroke.points && p.stroke.points[0];
  let lockedLocal = rawLocal;
  if (e.shiftKey && lockStart) {
    lockedLocal = inkStraightLockPoint(lockStart, rawLocal,
      (p.layer && p.layer.kind !== 'global') ? inkItemForLayer(p.layer) : null,
      p.stroke.shiftLock || (p.stroke.shiftLock = {}));
  } else if (p.stroke.shiftLock) {
    p.stroke.shiftLock = null; // bırakış: yeniden basışta eksen taze seçilir
  }
  const local = scoped ? lockedLocal : inkClampScopeLocal(p.layer, lockedLocal);
  let pressure = inkCurvePressure(
    inkEventPressure(e),
    Number.isFinite(p.pressureCurve) ? p.pressureCurve : 1
  );
  const tilt = inkEventTilt(e);

  // Hız: ekran px / ms. Yumuşatılmış değer noktaya yazılır; böylece
  // hız incelmesi ve `.abr` velocity dinamiği geri oynatmada da aynı kalır.
  const now = Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now();
  const lastAt = Number.isFinite(p.lastInputAt) ? p.lastInputAt : now;
  const lastClient = p.lastClient || { x: e.clientX, y: e.clientY };
  const dt = Math.max(1, now - lastAt);
  const moved = Math.hypot(e.clientX - lastClient.x, e.clientY - lastClient.y);
  const rawSpeed = inkSpeedInfluence(moved, dt);
  p.speed = clamp((Number.isFinite(p.speed) ? p.speed : 0) * 0.6 + rawSpeed * 0.4, 0, 1);
  p.lastInputAt = now;
  p.lastClient = { x: e.clientX, y: e.clientY };

  // Şekil oturtma: hareketsiz bekleme zamanlayıcısını yönet.
  inkFreehandSnapTrack(e);

  // FAZ 2-4: basınç bildirmeyen fare için hız → basınç simülasyonu.
  // Yavaş el = kalın/yoğun iz, hızlı el = ince iz (kalem hissi).
  p.mouseSim = e.pointerType === 'mouse' && !!inkState().mouseSpeedPressure;
  if (p.mouseSim) {
    pressure = inkCurvePressure(inkSimulatedPressure(p.speed),
      Number.isFinite(p.pressureCurve) ? p.pressureCurve : 1);
  }

  if (p.mode === 'shape') {
    const start = inkClampScopeLocal(p.layer, p.startLocal);
    p.stroke.points = [
      { x: start.x, y: start.y, p: pressure, s: p.speed },
      { x: clamp(local.x, 0, 1), y: clamp(local.y, 0, 1), p: pressure, s: p.speed },
    ];
    inkDrawLiveShape(p.layer, p.stroke);
    return;
  }

  // Yumuşatma: One-Euro filtresi (FAZ 2). EMA'nın aksine yavaşken yumuşak,
  // hızlıken keskin davranır; ham (kırpılmamış) konum üzerinden çalışır ki
  // tuval dışına çıkıp dönerken iz sıçramasın.
  const from = { x: p.smoothX, y: p.smoothY };
  let to = { x: local.x, y: local.y };
  if (p.stab && typeof inkStabilizerApply === 'function') {
    const sm = inkStabilizerApply(p.stab, local.x, local.y, pressure, now, inkState().smoothing);
    if (!sm.raw) to = { x: sm.x, y: sm.y };
  }
  p.smoothX = to.x;
  p.smoothY = to.y;
  // Basınç da filtrelenmiş kanaldan gelir: titreyen tablet basıncını düzeltir.
  // (Fare simülasyonu açıksa zaten sayısal simülasyon var, çifte filtre yok.)
  if (p.stab && !p.mouseSim && typeof inkStabilizerApply === 'function' && inkState().smoothing > 0.001) {
    pressure = p.stab.p;
  }

  // Oturtulmuş vuruşta devam — Tur 4: kalem hareketi iki anlama gelir.
  //  · Çapadan uzak hareket (≥ INK_ADJUST_DRIFT_PX) → CANLI şekil ayarı:
  //    eksen-bağımsız kenar-takip (Tur 4b) — sağa/sola en, yukarı/aşağı
  //    boy; ham iz YOK. Bırakınca şekil o haliyle commit edilir (undo var).
  //  · 8px altı kayma titreşim sayılır: şekil donuk kalır.
  //  · Ayar OTURUMU kurulduysa (dönüş true) donuk kare dâhil ham iz
  //    noktaları şekle KARIŞMAZ; yalnız init kurulamazsa eski yol.
  if (p.snapped) {
    const fp = p.snapFirePt;
    const drift = fp ? Math.hypot(e.clientX - fp.x, e.clientY - fp.y) : 0;
    if (drift >= INK_ADJUST_DRIFT_PX && inkFreehandShapeAdjust(to)) return;
    // Savunmacı: ayar kurulamadıysa eski davranış (nokta poliline'a eklenir).
    const isGlobal = p.layer && p.layer.kind === 'global';
    p.stroke.points.push({
      x: isGlobal ? to.x : clamp(to.x, 0, 1),
      y: isGlobal ? to.y : clamp(to.y, 0, 1),
      p: pressure, s: p.speed,
    });
    inkDrawLiveShape(p.layer, p.stroke);
    return;
  }

  if (!scoped) {
    // Kapsam yok: dünya katmanı, kırpma gerekmez.
    inkEmitFreehandPoint(p, to, pressure, tilt);
    return;
  }

  const seg = inkClipUnitSegment(from, to);
  if (!seg) {
    // Tamamen tuval dışı: boya yok, izleme devam ediyor.
    p.outside = true;
    return;
  }
  const fromOutside = inkUnitOutside(from);
  const toOutside = inkUnitOutside(to);
  const at = t => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  if (fromOutside) {
    // Kenardan giriş: yeni parça tam sınırda başlar (arada çizgi çekilmez).
    inkEmitFreehandPoint(p, at(seg.t0), pressure, tilt, true);
  }
  if (!toOutside) {
    inkEmitFreehandPoint(p, at(seg.t1), pressure, tilt);
  } else if (fromOutside && seg.t1 > seg.t0 + 1e-9) {
    inkEmitFreehandPoint(p, at(seg.t1), pressure, tilt);
  }
  p.outside = toOutside;
}

/** Kırpılmış tek bir vuruş noktasını ekler; canlı önizleme yalnızca son üç
    nokta için damlalanır. */
function inkEmitFreehandPoint(p, local, pressure, tilt, breakPath = false) {
  const it = p.layer && p.layer.kind === 'attached' ? inkItemForLayer(p.layer) : null;
  /* Bağlı katman uzayı 0..1'dir → kutuya kenetle. Global (dünya) katmanın
     uzayı dünya pikselidir; 0..1'e kenetlemek tüm orta noktaları (1,1)'e
     çökertir (tahta notu katmanında bozuk serbest el kök nedeni). */
  const globalLayer = p.layer && p.layer.kind === 'global';
  const sx = globalLayer ? local.x : clamp(local.x, 0, 1);
  const sy = globalLayer ? local.y : clamp(local.y, 0, 1);
  const last = p.stroke.points[p.stroke.points.length - 1];
  const screenDist = Math.hypot(
    (sx - last.x) * (it ? (it.w || 1) : 1),
    (sy - last.y) * (it ? (it.h || 1) : 1)
  ) * state.view.scale;
  if (!breakPath && screenDist < 0.9) return;
  // FAZ 2-5: nokta sınırına gelince BAŞ noktayı yutmak yerine simetrik
  // seyrelt (ilk + son 2 nokta korunur). Canlı damga penceresi bozulmaz.
  if (p.stroke.points.length >= INK_MAX_STROKE_POINTS && typeof inkDecimateStrokePoints === 'function') {
    const dec = inkDecimateStrokePoints(p.stroke.points, INK_MAX_STROKE_POINTS);
    if (dec) p.stroke.points = dec;
  }

  const prev2 = p.stroke.points[Math.max(0, p.stroke.points.length - 2)];
  const prev = p.stroke.points[p.stroke.points.length - 1];
  const next = inkApplyTilt({ x: sx, y: sy, p: pressure, s: p.speed }, tilt);
  if (breakPath) next.br = 1;
  p.stroke.points.push(next);

  // Sadece son üç noktayı damlala: tüm vuruşu her karede yeniden çizmeyiz.
  const points = p.stroke.points;
  const scale = inkLivePointScale(p.layer);
  const anchor = Math.max(0, points.length - 3);
  inkEmitLiveSegment(p.layer, p.stroke, [prev2, prev, next], {
    offsetPx: inkLivePolylineLength(points, scale, anchor),
    totalLengthPx: inkLivePolylineLength(points, scale),
  });
}

/* =========================================================
   pointerup / commit
   ========================================================= */
/** Vuruş bırakma anında yumuşatıcıyı hedefe yetiştir (36-ink-editor'daki
    flush'un tahta yolu karşılığı). Sentetik/çok hızlı olay dizilernde
    One-Euro hedefte kalmış olabilir: pişen iz ham bırakma konumunun
    gerisinde kesilir (soft fırça 191/480 kesilmesinin kök nedeni). */
function inkCatchUpFreehand(e) {
  const p = inkPointer;
  if (!p || !p.stroke || p.mode !== 'freehand') return;
  /* Oturtulmuş vuruş artık bir ŞEKLİDİR (kind 'shape'): bırakma konumunun
     ham noktası poliline'a eklenirse kusursuz kapanış bozulur (editör
     inkEditorCatchUpStroke ile aynı koruma). */
  if (p.stroke.kind === 'fill' || p.stroke.kind === 'shape') return;
  const world = screenToWorld({ x: e.clientX, y: e.clientY });
  const rawLocal = inkWorldToLocal(p.layer, world);
  if (!rawLocal) return;
  const scoped = !!inkRuntime.imageScopeId &&
    p.layer && p.layer.kind === 'attached' && p.layer.ownerId === inkRuntime.imageScopeId;
  // Bırakma kuyruğunda da Shift kilidi sürsün: kuyruk doğrunun üstünde
  // biter, iz kuyrukta kırılmaz (Tur 4h kalıcı eksen durumuyla).
  const lockStart = p.stroke.points && p.stroke.points[0];
  let lockedLocal = rawLocal;
  if (e.shiftKey && lockStart) {
    lockedLocal = inkStraightLockPoint(lockStart, rawLocal,
      (p.layer && p.layer.kind !== 'global') ? inkItemForLayer(p.layer) : null,
      p.stroke.shiftLock || (p.stroke.shiftLock = {}));
  } else if (p.stroke.shiftLock) {
    p.stroke.shiftLock = null;
  }
  const local = scoped ? lockedLocal : inkClampScopeLocal(p.layer, lockedLocal);
  let pressure = inkCurvePressure(
    inkEventPressure(e),
    Number.isFinite(p.pressureCurve) ? p.pressureCurve : 1
  );
  const tilt = inkEventTilt(e);
  if (p.mouseSim) {
    pressure = inkCurvePressure(inkSimulatedPressure(p.speed),
      Number.isFinite(p.pressureCurve) ? p.pressureCurve : 1);
  }
  // Basınç kanalının filtreli son değerini koru.
  if (p.stab && !p.mouseSim && inkState().smoothing > 0.001 &&
      Number.isFinite(p.stab.p)) {
    pressure = p.stab.p;
  }
  const from = { x: p.smoothX, y: p.smoothY };
  // Stabilizatör artık örnek almayacak: kanalları ham hedefe kilitle.
  if (p.stab) {
    p.stab.x = local.x;
    p.stab.y = local.y;
    p.stab.p = pressure;
  }
  p.smoothX = local.x;
  p.smoothY = local.y;
  if (!scoped) {
    // Kapsam yok: dünya katmanı, kırpma gerekmez.
    inkEmitFreehandPoint(p, local, pressure, tilt);
    return;
  }
  const seg = inkClipUnitSegment(from, local);
  if (!seg) {
    // Tamamen tuval dışında bırakıldı: ek nokta yok.
    p.outside = true;
    return;
  }
  const fromOutside = inkUnitOutside(from);
  const toOutside = inkUnitOutside(local);
  const at = t => ({ x: from.x + (local.x - from.x) * t, y: from.y + (local.y - from.y) * t });
  if (fromOutside && !toOutside) {
    // Kenardan içeride bırakıldı: parça sınırda başlayıp hedefe iner.
    inkEmitFreehandPoint(p, at(seg.t0), pressure, tilt, true);
  }
  if (!toOutside) {
    inkEmitFreehandPoint(p, at(seg.t1), pressure, tilt);
  } else if (fromOutside && seg.t1 > seg.t0 + 1e-9) {
    inkEmitFreehandPoint(p, at(seg.t1), pressure, tilt);
  }
  p.outside = toOutside;
}

function inkCommitFreehand() {
  const p = inkPointer;
  if (!p || !p.stroke) return;
  // Savunmacı: zamanlayıcı pointerup'ta kapanır; burada da garanti et.
  if (p.snapHold) { p.snapHold.disarm(); p.snapHold = null; }
  const layer = p.layer;
  const stroke = p.stroke;

  // FAZ 1B (Layer Mask): düzenleme hedefi maske olan katmandaki vuruş
  // maskenin tuvaline işler — layer.strokes'a GİRMEZ. Canlı önizleme
  // overlay'de oynadığı için katman tuvali commit öncesi bozulmaz.
  if (layer && layer.kind === 'attached' && layer.mask &&
      inkState().maskEditId === layer.id) {
    if (typeof inkMaskCommitStrokeFor === 'function') {
      inkMaskCommitStrokeFor(layer, stroke);
    }
    inkPointer = null;
    inkLastLive = null;
    inkClearLive();
    scheduleSave();
    if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
    return;
  }

  if (stroke.kind === 'shape' || stroke.kind === 'gradient') {
    const a = stroke.points[0], b = stroke.points[stroke.points.length - 1];
    const it = inkItemForLayer(layer);
    const dx = (b.x - a.x) * (layer.kind === 'attached' ? (it?.w || 1) : 1);
    const dy = (b.y - a.y) * (layer.kind === 'attached' ? (it?.h || 1) : 1);
    /* Tur 4: snapFree KAPALI şekiller son noktayı ilkine eşit yazar
       (kapanış segmenti); a==b 'boş dokunuş' değil, kapanıştır. */
    const closedSnap = stroke.kind === 'shape' && stroke.snapFree &&
      (stroke.closed || stroke.points.length > 2);
    if (!closedSnap && Math.hypot(dx, dy) < 1) return;
  } else if (!['fill', 'gradient'].includes(stroke.kind) && stroke.points.length === 1) {
    // Tek tıklama = nokta. Görünür olsun diye minik bir çizgi ekle.
    const q = stroke.points[0];
    stroke.points.push({ ...q, x: q.x + 0.0001, y: q.y + 0.0001 });
  }

  // Vuruş commit'i için tüm pano yerine yalnızca vuruş kaydı tutulur.
  if (typeof inkPushUndoStroke === 'function') inkPushUndoStroke(layer, stroke);
  else pushUndo();
  // Ölçüm: geri al anlık görüntüsü ayrı sayılır, commit raster + defter.
  const commitStart = performance.now();
  layer.strokes.push(stroke);
  if (layer.strokes.length > 5000) layer.strokes.splice(0, layer.strokes.length - 5000);

  // Vuruşu boya: hafif vuruşlar ana iş parçacığında, ağır olanlar worker'da.
  // Asenkron yolda canlı önizleme, bitmap uygulanana kadar ekranda kalır.
  let paintTask = null;
  /* Canlı final yeniden çizimi: commit'te canlı tuval temizlenip vuruşun
     TAMAMI damlalanır (artımlı pencere emisyonu aralık sürekliliği +
     taperEnd kesinliği sağlamaz). ~6k damla → 6-20 ms ana iş parçacığı
     maliyeti; inkPerfSpan('liveFinal') ile ayrı ölçülür ki commit
     dağıtım maliyetinden ayırt edilebilsin. */
  let liveFinalMs = 0;
  if (!['shape', 'fill', 'smudge', 'gradient'].includes(stroke.kind) && inkLiveHolds === 0) {
    const lf0 = performance.now();
    inkClearLive();
    const scale = inkLivePointScale(layer);
    inkEmitLiveSegment(layer, stroke, stroke.points, {
      final: true,
      totalLengthPx: inkLivePolylineLength(stroke.points, scale),
    });
    liveFinalMs = performance.now() - lf0;
    if (typeof inkPerfSpan === 'function') inkPerfSpan('liveFinal', liveFinalMs);
  }
  if (typeof inkPaintCommittedStroke === 'function') {
    paintTask = inkPaintCommittedStroke(layer, stroke);
  } else if (typeof inkPaintStrokeSync === 'function') {
    inkPaintStrokeSync(layer, stroke);
  } else if (layer.kind === 'attached') {
    const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    if (canvas) {
      inkDrawStrokeOnContext(canvas.getContext('2d', { colorSpace: 'srgb' }), stroke, {
        mapPoint: pt => ({ x: pt.x * canvas.width, y: pt.y * canvas.height }),
        sizePx: Math.max(0.5, stroke.size * canvas.width),
        pointScale: { x: canvas.width, y: canvas.height },
      });
    }
  } else {
    inkRasterizeGlobalStroke(layer, stroke);
  }

  inkPointer = null;
  inkLastLive = null;
  if (paintTask && typeof paintTask.then === 'function') {
    /* Worker hâlâ boyuyor: raster hazır olmadan FX girdisi okunursa eski
       piksel yeni nesil anahtarıyla önbelleğe girer. Tazeleme bitişte. */
    paintTask.then(() => inkAfterCommitRaster(layer), () => inkAfterCommitRaster(layer));
  } else {
    inkAfterCommitRaster(layer);
  }
  if (typeof inkAfterCommitPaint === 'function') inkAfterCommitPaint(paintTask);
  else inkClearLive();
  if (typeof inkPerfCount === 'function') inkPerfCount('points', stroke.points.length);
  if (typeof inkPerfSpan === 'function') inkPerfSpan('commit', performance.now() - commitStart);
  scheduleSave();
  if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
}

function inkOnPointerUp(e) {
  if (inkTransform) {
    e.preventDefault();
    e.stopPropagation();
    inkOnTransformUp();
    try { stage.releasePointerCapture(e.pointerId); } catch { /* sessiz */ }
    return;
  }
  if (!inkPointer) return;
  e.preventDefault();
  e.stopPropagation();
  // Bekleme zamanlayıcısı vuruşla birlikte kapanır: kalem kaldırıldıysa
  // bekleyici oturtmaz.
  if (inkPointer.snapHold) { inkPointer.snapHold.disarm(); inkPointer.snapHold = null; }

  if (inkPointer.mode === 'freehand' || inkPointer.mode === 'shape') {
    /* Tur 4i · bırakış-anı oturtması KALDIRILDI (Procreate modeli):
       kalemi beklemeden bırakmak ASLA oturtmaz — boyama/karalama/çizgi
       bırakışları ham iz olarak commit edilir. Oturtma yalnız bilinçli
       beklemede (hold zamanlayıcısı) ateşler. */
    // Commit'ten önce yumuşatıcıyı bırakma noktasına yetiştir.
    inkCatchUpFreehand(e);
    inkCommitFreehand();
  } else if (inkPointer.mode === 'lasso') {
    inkFinishLasso();
  } else if (inkPointer.mode === 'marquee') {
    inkFinishMarquee(e);
  }
  /* Kalem arkası silgi: vuruş bitti, önceki araca dön. */
  inkPenEraserRestore();
  try { stage.releasePointerCapture(e.pointerId); } catch { /* sessiz */ }
}

/* FAZ 6 B6: seçim modları (PS kalıbı Yeni/Ekle/Çıkar/Kesişim).
   Mod kaynakları: drag başında Shift=Ekle, Alt=Çıkar, Shift+Alt=Kesişim
   (geçici; kayıtta tutulmaz) — yoksa options bar'dan seçilen kalıcı
   `ink.selectionMode`. Merge motor tek yol: her seçim komiti buradan
   geçer, hem tahta (30) hem modal editör (36) aynı semantiği kullanır. */
const INK_SELECTION_MODES = ['new', 'add', 'sub', 'intersect'];

/* B6: PS haritası Shift=Ekle / Alt=Çıkar / Shift+Alt=Kesişim + masaüstü
   güvenli takma adlar: tahta üstünde Alt+drag pencere taşır (erken çıkış
   inkOnPointerDown'da) ve Alt geçici damlalık kısayoludur — bu yüzden
   Ctrl=Çıkar, Shift+Ctrl=Kesişim de aynı modları verir (tahta ve editör
   ortak, tutarlı). */
function inkSelectModeOfKey(mod) {
  if (mod && mod.shiftKey && (mod.altKey || mod.ctrlKey)) return 'intersect';
  if (mod && mod.shiftKey) return 'add';
  if (mod && mod.altKey) return 'sub';
  if (mod && mod.ctrlKey) return 'sub';
  return null;
}

function inkSelectEffectiveMode(e) {
  const overridden = inkSelectModeOfKey(e);
  if (overridden) return overridden;
  let ink = null;
  try { ink = inkState(); } catch { /* sessiz */ }
  return ink && ink.selectionMode || 'new';
}

/** Yeni seçim parçasını mevcut seçimle birleştirir.
    new → değiştir; add → birleşim (önce eski sıra korunur);
    sub → parça BOŞSA eski korunur, doluyorsa çıkarılır;
    intersect → kesişim (parça boşsa boş seçim). */
function inkSelectionMerge(mode, prev, fresh) {
  const prior = Array.isArray(prev) ? prev : [];
  const add = Array.isArray(fresh) ? fresh : [];
  if (mode === 'add') return [...new Set([...prior, ...add])];
  if (mode === 'sub') {
    if (!add.length) return prior.slice();
    const drop = new Set(add);
    return prior.filter(id => !drop.has(id));
  }
  if (mode === 'intersect') {
    const keep = new Set(add);
    return prior.filter(id => keep.has(id));
  }
  return add.slice();
}

function inkFinishLasso() {
  const pts = inkPointer.worldPoints;
  /* B6: mod drag başında sabitlendi; pointer null'lanmadan önce okunur. */
  const selMode = inkPointer && inkPointer.selMode || 'new';
  inkClearLive();
  inkPointer = null;
  const fresh = pts.length < 3 ? [] : (() => {
    const layer = inkActiveLayer();
    if (!layer) return null;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const range = {
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
    const tree = inkBuildQuadtree(layer);
    const candidates = tree ? tree.query(range) : [];
    const ids = [];
    for (const entry of candidates) {
      const b = entry.bounds;
      const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      if (inkPointInPolygon(center, pts)) ids.push(entry.stroke.id);
    }
    return ids;
  })();
  if (!fresh) return;
  inkState().selection = inkSelectionMerge(selMode, inkState().selection, fresh);
  inkUpdateGizmo();
  if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
}

function inkFinishMarquee(e) {
  const a = inkPointer.startWorld;
  const b = screenToWorld({ x: e.clientX, y: e.clientY });
  const range = {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
  };
  /* B6: mod drag başında sabitlendi. */
  const selMode = inkPointer && inkPointer.selMode || 'new';
  const wasTiny = range.w < 2 || range.h < 2;
  inkClearLive();
  inkPointer = null;
  const layer = inkActiveLayer();
  let fresh = null;
  if (!layer || wasTiny) {
    fresh = []; /* merge: add/sub korur, new boşaltır, intersect boşaltır */
  } else {
    const tree = inkBuildQuadtree(layer);
    const candidates = tree ? tree.query(range) : [];
    fresh = candidates.map(c => c.stroke.id);
  }
  inkState().selection = inkSelectionMerge(selMode, inkState().selection, fresh);
  inkUpdateGizmo();
  if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
}

/** FAZ 6 A4: seçimi bırak — options bar "Deselect" düğmesi ile
    Escape'in ortak yolu; gizmo, katman defteri ve options bar tek
    kapıdan tazelenir (inkUpdateGizmo kuyruğu widget senkronunu süter). */
function inkClearSelection() {
  const ink = inkState();
  if (!ink.selection.length) return false;
  ink.selection = [];
  inkUpdateGizmo();
  if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
  if (typeof scheduleSave === 'function') scheduleSave();
  return true;
}

/* =========================================================
   transform / gizmo
   ========================================================= */
function inkBeginTransformClick(e, world) {
  const layer = inkActiveLayer();
  if (!layer) return false;
  const hit = inkStrokeHit(layer, world);
  if (hit) {
    /* B6: mod duyarlı tıklama — new öncekini değiştirir; add/sub/
       intersect birleştirir. Sonuç boşsa (sub tümünü çıkarınca/
       intersect elemezse) gizmo kurulmaz, seçim ışıkları tazelenir. */
    const mode = inkSelectEffectiveMode(e);
    const fresh = mode === 'new' ? [hit.id]
      : inkSelectionMerge(mode, inkState().selection, [hit.id]);
    inkState().selection = fresh;
    inkUpdateGizmo();
    if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
    if (fresh.length) inkStartGizmoDrag(e, null, 'move');
    return true;
  }
  if (inkState().selection.length) {
    /* B6: boşluğa tıklama yalnız 'new' modunda temizler; add/sub/
       intersect seçimi korur (PS kalıbı). */
    if (inkSelectEffectiveMode(e) === 'new') {
      inkState().selection = [];
      inkUpdateGizmo();
      if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
    }
  }
  return false;
}

function inkGizmoHandle(e, explicit) {
  if (explicit) return explicit;
  const t = e.target instanceof Element ? e.target : null;
  const h = t && t.closest('[data-ink-handle]');
  if (h && h.dataset.inkHandle) return h.dataset.inkHandle;
  if (t && t.closest('[data-ink-gizmo-body]')) return 'move';
  return '';
}

function inkStartGizmoDrag(e, target, forcedHandle) {
  const ink = inkState();
  const layer = inkActiveLayer();
  if (!layer || !ink.selection.length) return;
  const handle = inkGizmoHandle(e, forcedHandle);
  if (!handle) return;
  const bounds = inkSelectionBounds();
  if (!bounds) return;

  const ids = new Set(ink.selection);
  const strokes = layer.strokes.filter(s => ids.has(s.id));
  if (!strokes.length) return;

  pushUndo();
  inkTransform = {
    layer,
    handle,
    bounds,
    startWorld: screenToWorld({ x: e.clientX, y: e.clientY }),
    center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
    snapshots: strokes.map(s => ({
      stroke: s,
      points: s.points.map(p => ({ ...p })),
    })),
    frame: 0,
    pending: false,
  };
  try { stage.setPointerCapture(e.pointerId); } catch { /* sessiz */ }
}

function inkTransformPoint(worldPoint, t) {
  const layer = t.layer;
  const b = t.bounds;
  const h = t.handle;
  const cur = t.curWorld;

  if (h === 'move') {
    return { x: worldPoint.x + (cur.x - t.startWorld.x), y: worldPoint.y + (cur.y - t.startWorld.y) };
  }

  if (h === 'rot') {
    const a0 = Math.atan2(t.startWorld.y - t.center.y, t.startWorld.x - t.center.x);
    const a1 = Math.atan2(cur.y - t.center.y, cur.x - t.center.x);
    const ang = a1 - a0;
    const dx = worldPoint.x - t.center.x;
    const dy = worldPoint.y - t.center.y;
    return {
      x: t.center.x + dx * Math.cos(ang) - dy * Math.sin(ang),
      y: t.center.y + dx * Math.sin(ang) + dy * Math.cos(ang),
    };
  }

  // Köşe/kenar tutamacı: karşı kenar sabit kalacak şekilde ölçekle.
  const left = b.x, top = b.y, right = b.x + b.w, bottom = b.y + b.h;
  let anchorX = h.includes('w') ? right : left;
  let anchorY = h.includes('n') ? bottom : top;
  if (h === 'n' || h === 's') anchorX = t.center.x;
  if (h === 'e' || h === 'w') anchorY = t.center.y;

  let sx = 1, sy = 1;
  if (b.w > 0.0001 && h !== 'n' && h !== 's') {
    const denom = t.startWorld.x - anchorX;
    if (Math.abs(denom) > 1e-6) sx = clamp((cur.x - anchorX) / denom, 0.02, 40);
  }
  if (b.h > 0.0001 && h !== 'e' && h !== 'w') {
    const denom = t.startWorld.y - anchorY;
    if (Math.abs(denom) > 1e-6) sy = clamp((cur.y - anchorY) / denom, 0.02, 40);
  }
  if (e_fromCorner(h)) {
    // Oranı korumak için Shift'e gerek yok; köşe tutamacı orantılıdır.
    const k = Math.max(sx, sy);
    sx = sy = k;
  }
  return {
    x: anchorX + (worldPoint.x - anchorX) * sx,
    y: anchorY + (worldPoint.y - anchorY) * sy,
  };
}

function e_fromCorner(h) {
  return h === 'nw' || h === 'ne' || h === 'sw' || h === 'se';
}

function inkApplyTransformFrame() {
  const t = inkTransform;
  if (!t) return;
  t.pending = false;
  const layer = t.layer;
  // Seçim taşınırken bekleyen worker sonucu eski konumu taşır.
  if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'mutation');
  const before = t.lastBounds || t.bounds;
  for (const snap of t.snapshots) {
    const nextPoints = [];
    for (const p of snap.points) {
      const world = inkLocalToWorld(layer, p);
      if (!world) { nextPoints.push({ ...p }); continue; }
      const moved = inkTransformPoint(world, t);
      const local = inkWorldToLocal(layer, moved);
      nextPoints.push({ x: local.x, y: local.y, p: p.p });
    }
    snap.stroke.points = nextPoints;
  }
  const after = inkSelectionBounds() || t.bounds;
  t.lastBounds = after;
  // Tam katman yerine yalnızca eski + yeni sınırı yeniden çiz.
  const dirty = typeof inkUnionRect === 'function' ? inkUnionRect(before, after) : null;
  if (dirty && typeof inkMarkLayerDirty === 'function') {
    inkMarkLayerDirty(layer, dirty);
    inkFlushDirtyLayers();
  } else {
    inkRerenderLayer(layer.id);
  }
  inkUpdateGizmo();
}

function inkOnTransformMove(e) {
  if (!inkTransform) return;
  inkTransform.curWorld = screenToWorld({ x: e.clientX, y: e.clientY });
  if (!inkTransform.pending) {
    inkTransform.pending = true;
    requestAnimationFrame(inkApplyTransformFrame);
  }
}

function inkOnTransformUp() {
  if (!inkTransform) return;
  const t = inkTransform;
  // Son pointermove bir sonraki kareye ertelenmiş olabilir; bırakmadan
  // önce uygula ki dönüşüm kaybolmasın.
  if (t.pending) inkApplyTransformFrame();
  inkTransform = null;
  // Kare kare işaretlenen kirli bölgeler son hâli zaten kapsıyor.
  if (typeof inkFlushDirtyLayers === 'function') inkFlushDirtyLayers();
  else inkRerenderLayer(t.layer.id);
  inkUpdateGizmo();
  scheduleSave();
  if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
}

/* =========================================================
   FAZ 6 B7: Transform HUD — sayısal girdi çift-yön (X/Y/W/H/R)
   =========================================================
   Options bar'daki sayısal alanlar gizmo ile aynı zemini paylaşır:
   gizmo drag → inkUpdateGizmo → widget sync değerleri tazeler;
   alana yazıp Enter/blur → inkApplyNumericTransform motor tek yoldan
   uygular (pushUndo dahil) ve bounds yeniden ölçülür.
   Hedefler mutlak: x/y seçim sınırlarının SOL-ÜST köşesi (px, dünya),
   w/h sol-üst çapayla ölçek, rot merkezden ekstra derece dönüşü
   (seçim noktalarında "duruş açısı" tutulmadığından R alanı her
   girişte merkez etrafında yeni bir döndürme uygular, akümüle
   edilmez). */
function inkApplyNumericTransform(target) {
  const ink = inkState();
  const layer = inkActiveLayer();
  if (!layer || !ink.selection.length || inkTransform) return false;
  const b = inkSelectionBounds();
  if (!b) return false;
  const num = v => typeof v === 'number' && isFinite(v);
  const wantX = num(target.x) ? target.x : b.x;
  const wantY = num(target.y) ? target.y : b.y;
  const wantW = num(target.w) && target.w > 2 ? target.w : b.w;
  const wantH = num(target.h) && target.h > 2 ? target.h : b.h;
  const wantR = num(target.rot) ? clamp(target.rot, -3600, 3600) : 0;
  const touched = (num(target.x) && wantX !== b.x) ||
    (num(target.y) && wantY !== b.y) || wantW !== b.w || wantH !== b.h ||
    wantR !== 0;
  if (!touched) return false;
  const sx = b.w > 1e-6 ? wantW / b.w : 1;
  const sy = b.h > 1e-6 ? wantH / b.h : 1;
  const dx = wantX - b.x;
  const dy = wantY - b.y;
  const rad = wantR * Math.PI / 180;
  const ids = new Set(ink.selection);
  const strokes = layer.strokes.filter(s => ids.has(s.id));
  if (!strokes.length) return false;
  pushUndo();
  if (typeof inkBumpPaintEpoch === 'function')
    inkBumpPaintEpoch(layer.id, 'mutation');
  /* Ölçek+taşıma sonrası sınırların (wantX,wantY,wantW,wantH) oturduğu
     merkez — rot bu merkez etrafında döner. */
  const cx = wantX + wantW / 2;
  const cy = wantY + wantH / 2;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const s of strokes) {
    s.points = s.points.map(p => {
      const world = inkLocalToWorld(layer, p);
      if (!world) return { ...p };
      let x = b.x + (world.x - b.x) * sx + dx;
      let y = b.y + (world.y - b.y) * sy + dy;
      if (rad) {
        const ox = x - cx;
        const oy = y - cy;
        x = cx + ox * cos - oy * sin;
        y = cy + ox * sin + oy * cos;
      }
      const local = inkWorldToLocal(layer, { x, y });
      return { x: local.x, y: local.y, p: p.p };
    });
  }
  const after = inkSelectionBounds() || b;
  const dirty = typeof inkUnionRect === 'function'
    ? inkUnionRect(b, after) : null;
  if (dirty && typeof inkMarkLayerDirty === 'function') {
    inkMarkLayerDirty(layer, dirty);
    inkFlushDirtyLayers();
  } else {
    inkRerenderLayer(layer.id);
  }
  /* B7 DİKKAT: burada inkSyncLayersPanel ÇAĞRILMAZ — sarmalayıcı zincir
     (draw-v5 katman paneli) inkDocEnsure üzerinden aktif katmanı öğe
     dokümanına taşır ve global katman seçimi HUD'i null'a düşürür.
     Alan tazeliği inkUpdateGizmo → __v5OptSync ile gelir. */
  inkUpdateGizmo();
  scheduleSave();
  return true;
}

/* =========================================================
   renk örnekleme (eyedropper)
   ========================================================= */
/* Görsel başına küçültülmüş örnek tuvali. Her örneklemede tam boy kopya
   çizmek büyük referanslarda pahalıydı; LRU(4) ile sınırlı tutulur.
   Küçük görsellerde (≤ 1536 px) kopya birebir, büyüklerde ölçeklidir. */
const INK_SAMPLE_CACHE_LIMIT = 4;
const INK_SAMPLE_MAX_SIDE = 1536;
const inkSampleCache = new Map();   // "imageId|WxH" -> { img, canvas, w, h }
const inkSampleStats = { hits: 0, misses: 0 };

function inkSampleCacheInfo() {
  return {
    size: inkSampleCache.size,
    hits: inkSampleStats.hits,
    misses: inkSampleStats.misses,
  };
}

function inkSampleCacheClear() {
  inkSampleCache.clear();
  inkSampleStats.hits = 0;
  inkSampleStats.misses = 0;
}

/** Görselin örnekleme tuvalini döndürür (gerekirse bir kez üretir). */
function inkSampleImageFor(it) {
  const cached = imgCache.get(it.imageId);
  const img = cached && cached.img;
  if (!img || !img.naturalWidth) return null;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const k = Math.min(1, INK_SAMPLE_MAX_SIDE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  const key = it.imageId + '|' + nw + 'x' + nh;

  let entry = inkSampleCache.get(key);
  if (entry && entry.img === img) {
    // LRU: son kullanılanı sona taşı.
    inkSampleCache.delete(key);
    inkSampleCache.set(key, entry);
    inkSampleStats.hits++;
    if (typeof inkPerfCount === 'function') inkPerfCount('sampleCacheHits');
    return entry;
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  try { ctx.drawImage(img, 0, 0, w, h); } catch { return null; }
  entry = { img, canvas, w, h };
  inkSampleCache.set(key, entry);
  while (inkSampleCache.size > INK_SAMPLE_CACHE_LIMIT) {
    inkSampleCache.delete(inkSampleCache.keys().next().value);
  }
  inkSampleStats.misses++;
  if (typeof inkPerfCount === 'function') inkPerfCount('sampleCacheMisses');
  return entry;
}

function inkSampleColor(clientX, clientY) {
  const world = screenToWorld({ x: clientX, y: clientY });
  const ink = inkState();

  // 1) Görsellerin üstündeki global not katmanları
  const above = ink.layers.filter(l => l.kind === 'global' && l.plane === 'above' && l.visible)
    .slice().reverse();
  for (const layer of above) {
    const c = inkSampleTileAt(layer, world);
    if (c) return c;
  }

  // 2) Görsel öğe ve ona bağlı çizim katmanları
  const it = inkTopImageAt(world);
  if (it) {
    const layers = inkLayersForOwner(it.id).slice().reverse();
    for (const layer of layers) {
      if (!layer.visible) continue;
      const canvas = inkRuntime.itemCanvases.get(layer.id);
      if (!canvas) continue;
      const local = inkWorldToLocal(layer, world);
      const px = Math.round(local.x * canvas.width);
      const py = Math.round(local.y * canvas.height);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
      const c = inkReadCanvasPixel(canvas, px, py);
      if (c) return c;
    }
    const cached = imgCache.get(it.imageId);
    if (cached && cached.img && cached.img.naturalWidth) {
      const local = inkWorldToLocal({ kind: 'attached', ownerId: it.id }, world);
      const sample = inkSampleImageFor(it);
      if (sample) {
        const px = Math.round(local.x * sample.w);
        const py = Math.round(local.y * sample.h);
        const c = inkReadCanvasPixel(sample.canvas, px, py);
        if (c) return c;
      }
    }
  }

  // 3) Alttaki global eskiz katmanları
  const below = ink.layers.filter(l => l.kind === 'global' && l.plane === 'below' && l.visible)
    .slice().reverse();
  for (const layer of below) {
    const c = inkSampleTileAt(layer, world);
    if (c) return c;
  }
  return inkState().color || '#ffffff';
}

function inkSampleTileAt(layer, world) {
  const tx = Math.floor(world.x / INK_TILE_SIZE);
  const ty = Math.floor(world.y / INK_TILE_SIZE);
  const tile = inkRuntime.tiles.get(inkTileKey(layer.id, tx, ty));
  if (!tile) return null;
  const px = Math.floor(world.x - tx * INK_TILE_SIZE);
  const py = Math.floor(world.y - ty * INK_TILE_SIZE);
  return inkReadCanvasPixel(tile.canvas, px, py);
}

function inkReadCanvasPixel(canvas, x, y) {
  try {
    const d = canvas.getContext('2d', { colorSpace: 'srgb' }).getImageData(x, y, 1, 1).data;
    if (d[3] < 8) return null;
    return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/* =========================================================
   klavye / pencere olayları
   ========================================================= */

/** Canlı vuruş var mı? Tahta hattı `inkPointer/inkTransform`, modal
    editör ise kendi `inkEditorUi.stroke` durumunu kullanır. Klavye
    korumaları iki hattı birlikte görmelidir; yoksa modalda çizerken
    Escape vuruşu iptal etmiyor ve araç tuşu vuruş ortasında aracı
    değiştiriyordu. */
function inkStrokeActive() {
  if (inkPointer || inkTransform) return true;
  return typeof inkEditorUi !== 'undefined' && !!inkEditorUi &&
    !!inkEditorUi.open && !!inkEditorUi.stroke;
}

function inkHandleKeyDown(e) {
  if (!state || !state.ink) return false;
  // Yerel fırça kütüphanesi açıkken motor kısayolları (Escape, araç tuşları)
  // arka planda çalışmamalı.
  const nativeBrushRoot = document.getElementById('nativeBrushLibrary');
  if (nativeBrushRoot && !nativeBrushRoot.hidden) return false;
  // Çizim kısayolları yalnızca çizim çalışma alanı açıkken geçerlidir.
  if (typeof inkInlineModeActive === 'function' && !inkInlineModeActive()) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const ae = document.activeElement;
  if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return false;
  if (editingId) return false;

  /* Türkçe klavye (TR-Q): 'i' tuşunun key'i 'ı' gelir; 'İ'.toLowerCase()
     ise iki karakter döner. Araç harfleri (b/p/e/i/l/m/u/v/t) fiziksel
     tuştan (e.code KeyX) çözülür, olmazsa e.key'e düşer — düzen
     bağımsız çalışır. */
  const codeLetter = /^Key([A-Z])$/.test(e.code || '') ? RegExp.$1.toLowerCase() : '';
  const key = codeLetter || e.key.toLowerCase();

  // Arka plan opaklığı: eski [ / ] kısayolu çizim araçlarında fırça boyutuna
  // ayrıldığı için Shift ile korunur (klavye düzeninden bağımsız kod ile).
  if (e.shiftKey && (
    e.code === 'BracketLeft' || e.code === 'BracketRight' ||
    e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}'
  )) {
    if (typeof setBg === 'function') {
      const left = e.code === 'BracketLeft' || e.key === '[' || e.key === '{';
      setBg((typeof state.bg === 'number' ? state.bg : 1) + (left ? -0.1 : 0.1));
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
  }

  if (e.key === 'Escape') {
    /* FAZ 7.W: mini gradyan durağı seçicisi açıkken Esc yalnız onu
       kapatır — editör kapanmaz (radial panel delegasyonu kalıbı).
       Bu dal motorun EN ERKEL Escape hattı: inkEditorKeyDown'ten
       önce koştuğu için delegasyon burada olmazsa editör kapanıyordu. */
    if (typeof window.v5GradPickerClose === 'function' && window.v5GradPickerClose()) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    if (inkStrokeActive()) {
      /* Modal editörün vuruşu kendi hattında yaşar; doğru iptal kapısı
         inkEditorDropStroke'tur (overlay + geçici katman temizliği).
         Tahta hattında inkCancelStroke kullanılır. */
      if (typeof inkEditorUi !== 'undefined' && inkEditorUi && inkEditorUi.open &&
          inkEditorUi.stroke && typeof inkEditorDropStroke === 'function') {
        inkEditorDropStroke();
      } else {
        inkCancelStroke();
      }
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    if (inkState().selection.length) {
      /* FAZ 6 A4: options bar "Deselect" ile aynı yol. */
      inkClearSelection();
      e.preventDefault();
      return true;
    }
    if (typeof inkCloseTransientUi === 'function' && inkCloseTransientUi()) {
      e.preventDefault();
      return true;
    }
    if (inkRuntime.imageScopeId && typeof inkExitImageScope === 'function') {
      inkExitImageScope();
      e.preventDefault();
      return true;
    }
    return false;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    /* Vuruş koruması: çizim sürerken Delete/Backspace katman içeriğini
       silmesin — el klavyeye değince vuruş + katman birlikte gidiyordu. */
    if (inkStrokeActive()) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    const ink = inkState();
    if (!ink.selection.length) {
      /* Kullanıcı istemi: seçim yokken Delete = aktif katmanı sil;
         son çizim katmanıysa içeriğini temizler. Tek kapı
         inkDocDeleteOrClearLayer (kendi pushUndo'su var → Ctrl+Z
         geri alır). Katman listesinde odak varsa listelerin kendi
         Delete işleyicisi zaten silmiştir — çifte silmeyi engellemek
         için burada devreye girmez. */
      const aePanel = document.activeElement;
      if (aePanel && aePanel.closest && aePanel.closest('#inkLayersPanel')) return false;
      const layer0 = inkActiveLayer();
      if (layer0 && layer0.locked) {
        if (typeof showProjectNotice === 'function') {
          showProjectNotice('Layer locked: unlock to delete.', 2200);
        }
        return false;
      }
      e.preventDefault();
      e.stopPropagation();
      const deleted = typeof inkDocDeleteOrClearLayer === 'function' &&
        inkDocDeleteOrClearLayer();
      if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
      return deleted;
    }
    const layer = inkActiveLayer();
    if (!layer || layer.locked) return false;
    e.preventDefault();
    e.stopPropagation();
    const bounds = inkSelectionBounds();
    pushUndo();
    inkDeleteSelection();
    if (bounds && typeof inkMarkLayerDirty === 'function') {
      inkMarkLayerDirty(layer, bounds);
      inkFlushDirtyLayers();
    } else {
      inkRerenderLayer(layer.id);
    }
    inkUpdateGizmo();
    scheduleSave();
    if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
    return true;
  }

  if ((e.key === '[' || e.key === ']') && !e.shiftKey) {
    if (!inkInlineModeActive()) return false;
    const ink = inkState();
    if (!['brush', 'pencil', 'eraser', 'shape'].includes(ink.tool)) return false;
    e.preventDefault();
    e.stopPropagation();
    const step = ink.size < 20 ? 1 : Math.max(2, Math.round(ink.size * 0.12));
    ink.size = clamp(ink.size + (e.key === ']' ? step : -step), INK_MIN_SIZE, INK_MAX_SIZE);
    if (typeof inkSyncUI === 'function') inkSyncUI();
    /* FAZ 6 B8: boyut değişti — imleç dibi mini balon. */
    if (typeof inkShowSizeBubble === 'function') inkShowSizeBubble();
    return true;
  }

  const map = {
    b: 'brush', p: 'pencil', e: 'eraser',
    i: 'eyedropper', l: 'lasso', m: 'marquee',
    u: 'shape', v: 'transform', t: 'text',
  };
  if (map[key] && !e.shiftKey) {
    // Kısayol yalnızca çizim modalı açıkken araç değiştirir. Referans
    // tahtasında B/P/E gibi tuşlar tahtanın kendi kısayollarına kalır.
    if (!inkInlineModeActive()) return false;
    /* Vuruş koruması: çizim sürerken gelen araç kısayolu vuruşu
       İPTAL ediyordu (inkSetTool → inkCancelStroke) — çizerken elin
       klavyeye değmesi o anki vuruşu siliyordu. Vuruş sürerken tuş
       yutulur, araç değişmez. */
    if (inkStrokeActive()) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    e.preventDefault();
    e.stopPropagation();
    if (key === 'u' && inkState().tool === 'shape') {
      const order = ['arrow', 'rect', 'ellipse', 'highlight'];
      const idx = order.indexOf(inkState().shape);
      inkSetTool('shape', { shape: order[(idx + 1) % order.length] });
    } else {
      inkSetTool(map[key]);
    }
    return true;
  }
  return false;
}

function inkHandleWheel(e) {
  if (!state || !state.ink) return false;
  if (!inkInlineModeActive()) return false;
  const ink = inkState();
  if (!['brush', 'pencil', 'eraser', 'shape'].includes(ink.tool)) return false;
  if (!e.altKey) return false;
  e.preventDefault();
  e.stopPropagation();
  const dir = e.deltaY > 0 ? -1 : 1;
  const step = ink.size < 20 ? 1 : Math.max(2, Math.round(ink.size * 0.12));
  ink.size = clamp(ink.size + dir * step, INK_MIN_SIZE, INK_MAX_SIZE);
  if (typeof inkSyncUI === 'function') inkSyncUI();
  /* FAZ 6 B8: Alt+tekerlek boyut — balon imleç noktasında. */
  if (typeof inkShowSizeBubble === 'function')
    inkShowSizeBubble(e.clientX, e.clientY);
  return true;
}

/* =========================================================
   başlatma
   ========================================================= */
function inkBindPointerEvents() {
  stage.addEventListener('pointerdown', inkOnPointerDown, true);
  window.addEventListener('pointermove', inkOnPointerMove, true);
  window.addEventListener('pointerup', inkOnPointerUp, true);
  window.addEventListener('pointercancel', () => { inkCancelStroke(); inkOnTransformUp(); inkPenEraserRestore(); }, true);
  /* blur'da da silgi dönüşü: kalem silgisiyle çizerken pencere odağını
     kaybedersen stroke pointercancel görmez — kalem SİLGİ modunda
     yapışık kalıyordu (keyup kaçan yapışkan tuş ailesinden). */
  window.addEventListener('blur', () => { inkCancelStroke(); inkOnTransformUp(); inkPenEraserRestore(); });

  window.addEventListener('keydown', e => {
    if (inkHandleKeyDown(e)) return;
  }, true);

  /* FAZ 6 B8: imleç takibi — boyut baloncuğu ([ / ] / Alt+tekerlek)
     son imleç noktasında belirir; keydown'da koordinat olmaz. */
  window.addEventListener('pointermove', e => {
    inkRuntime.cursorScreen = { x: e.clientX, y: e.clientY };
  }, { passive: true });

  stage.addEventListener('wheel', e => {
    inkHandleWheel(e);
  }, { capture: true, passive: false });

  window.addEventListener('resize', () => { inkSizeLiveCanvas(); inkCullTiles(); });
}

function inkInitTools() {
  inkEnsureLiveCanvas();
  inkBindPointerEvents();
  inkSetTool(inkState().tool || 'brush');
}
