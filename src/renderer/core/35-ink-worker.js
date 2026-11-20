/* TailRef app · ink worker bridge · ağır vuruşları ana iş parçacığından çıkar
   ------------------------------------------------------------------
   `ink-worker.js` bir vuruşun etkilediği bölgenin mevcut piksellerini alır,
   aynı fırça matematiğiyle vuruşu bu bitmap üzerine çizer ve sonucu geri
   yollar. Böylece 10.000+ noktalı yumuşak fırça vuruşları arayüzü kilitlemez.

   Tasarım kuralları:
   • Kaynak gerçek her zaman `layer.strokes` listesidir; worker yalnızca
     raster önbelleğini üretir.
   • Aynı katmandaki işler sırayla yürür. Aksi hâlde eski bir bitmap yeni
     vuruşun üzerine yazabilir.
   • Worker sonucu gelene kadar canlı önizleme ekranda kalır (`inkLiveHolds`).
   • Geri al / dönüştürme / yeniden kurulum worker işini geçersiz kılar
     (epoch). Geçersiz iş atılır; katman kaynaktan yeniden çizilir.
   • Worker veya OffscreenCanvas yoksa davranış eskisiyle birebir aynıdır.
   ========================================================= */
'use strict';

const INK_WORKER_MIN_DABS = 2400;
const INK_WORKER_MAX_PIXELS = 4194304; // 2048² (tek worker işinin üst sınırı)
const INK_WORKER_CHUNK = 2048;         // büyük bölgeler bu kenarda parçalanır
const INK_WORKER_MAX_CHUNKS = 48;      // aşarsa senkron yola düş

const inkWorkerState = {
  worker: null,
  failed: false,
  seq: 0,
  jobs: new Map(),          // id -> { resolve, layer, stroke, plan, epoch, mutations }
  chains: new Map(),        // layerId -> Promise
  epoch: new Map(),         // layerId -> sayı
  mutations: new Map(),     // layerId -> sayı (geri al / dönüştürme)
  forced: false,
  disabled: false,
  stats: { jobs: 0, applied: 0, discarded: 0, fallbacks: 0, errors: 0, totalMs: 0,
    regionJobs: 0, regionApplied: 0, regionCancelled: 0, wDabs: 0, wPath: 0 },
};

function inkWorkerSupported() {
  return !inkWorkerState.disabled && !inkWorkerState.failed &&
    typeof Worker === 'function' &&
    typeof OffscreenCanvas === 'function' &&
    typeof createImageBitmap === 'function';
}

/** Test/bench için: eşiği yok say, tüm damla vuruşlarını worker'a gönder. */
function inkWorkerForce(on) {
  inkWorkerState.forced = !!on;
}

/** Worker'ı tamamen kapat (fallback davranışını doğrulamak için). */
function inkWorkerEnable(on) {
  inkWorkerState.disabled = !on;
  if (!on) inkWorkerTerminate();
}

function inkWorkerStats() {
  return {
    supported: inkWorkerSupported(),
    failed: !!inkWorkerState.failed,
    disabled: !!inkWorkerState.disabled,
    forced: !!inkWorkerState.forced,
    pending: inkWorkerState.jobs.size,
    chains: inkWorkerState.chains.size,
    ...inkWorkerState.stats,
  };
}

function inkWorkerTerminate() {
  if (inkWorkerState.worker) {
    try { inkWorkerState.worker.terminate(); } catch { /* sessiz */ }
  }
  inkWorkerState.worker = null;
  for (const job of inkWorkerState.jobs.values()) {
    // Yalnızca hâlâ katmanda duran vuruşları senkron boya. Geri alınmış bir
    // vuruşu yeniden çizmek hayalet piksel bırakırdı.
    const layer = inkLayerById(job.layer.id);
    if (layer && layer.strokes.includes(job.stroke)) {
      try { inkPaintStrokeSync(layer, job.stroke); } catch { /* sessiz */ }
    }
    job.resolve(false);
  }
  inkWorkerState.jobs.clear();
}

/* =========================================================
   raster planı
   ========================================================= */

/** Vuruşun hedef piksel uzayındaki yaklaşık damla sayısı. */
function inkEstimateDabs(stroke, sizePx, scaleX, scaleY) {
  const pts = stroke && stroke.points;
  if (!pts || pts.length < 2) return 1;
  const spacingPx = Math.max(0.8, sizePx * clamp(stroke.spacing || 0.1, 0.01, 2));
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(
      (pts[i].x - pts[i - 1].x) * scaleX,
      (pts[i].y - pts[i - 1].y) * scaleY
    );
  }
  return len / spacingPx + 1;
}

function inkAttachedRasterPlan(layer, stroke) {
  const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
  if (!canvas || !canvas.width || !canvas.height) return null;
  const W = canvas.width, H = canvas.height;
  const sizePx = Math.max(0.5, stroke.size * W);
  const dabs = inkEstimateDabs(stroke, sizePx, W, H);

  // FAZ4-3: smudge saçılma kullanmaz; senkron smudge kutusu
  // `radiusMax + 2` pad'li olduğundan bölge birebir o kutu olmalı
  // (aksi hâlde worker kenar örnekleme clamp'i sapar).
  const scatter = stroke.kind === 'smudge' || stroke.kind === 'liquify' ? 0 : Math.max(0, stroke.scatter || 0);
  /* PARİTE (probe-parity sc_ring/sc_ellipse/dyn_sizejit bulgusu): bölge
     pad'i ana thread `inkDrawStrokeOnContext` dualPad'i ile BİREBİR
     olmalıdır. Ana scratch sınırları damla merkezleri etrafında
     0.62·sizePx + 0.55·sizePx·max(scatterX, scatterY) + 2 pad alır;
     worker pad'i yalnızca (sizePx/2)·(1+scatter)+2 idi → saçılma
     ofsetleri ve sizeJitter ile büyüyen damlalar bölge kenarında
     KIRPILIYORDU (senkron kırpmıyordu) → worker px sayısı az kalıyordu.
     Aynı pad + aynı floor/ceil → iki taraf aynı dikdörtgende aynı
     biçimde kırpar → byte paritesi. */
  const brushDef = stroke.brushId && typeof inkGetBrush === 'function'
    ? inkGetBrush(stroke.brushId) : null;
  const scatterX = stroke.kind === 'smudge' || stroke.kind === 'liquify' ? 0
    : Math.max(0, Number(brushDef && brushDef.scatterX) || 0, stroke.scatter || 0);
  const scatterY = stroke.kind === 'smudge' || stroke.kind === 'liquify' ? 0
    : Math.max(0, Number(brushDef && brushDef.scatterY) || 0, stroke.scatter || 0);
  const pad = stroke.kind === 'smudge' || stroke.kind === 'liquify'
    ? (sizePx / 2) * (1 + scatter) + 2
    : sizePx * 0.62 + sizePx * 0.55 * Math.max(scatterX, scatterY) + 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    const x = p.x * W, y = p.y * H;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const w = Math.min(W, Math.ceil(maxX + pad)) - x;
  const h = Math.min(H, Math.ceil(maxY + pad)) - y;
  if (w <= 0 || h <= 0) return null;

  return {
    mode: 'attached',
    region: { x, y, w, h },
    sizePx, dabs,
    canvasW: W, canvasH: H,
    tiles: null,
  };
}

function inkGlobalRasterPlan(layer, stroke) {
  const range = inkStrokeTileRange(stroke);
  if (!range) return null;
  const cols = range.x1 - range.x0 + 1;
  const rows = range.y1 - range.y0 + 1;
  const region = {
    x: range.x0 * INK_TILE_SIZE,
    y: range.y0 * INK_TILE_SIZE,
    w: cols * INK_TILE_SIZE,
    h: rows * INK_TILE_SIZE,
  };
  return {
    mode: 'global',
    region,
    sizePx: Math.max(0.5, stroke.size),
    dabs: inkEstimateDabs(stroke, Math.max(0.5, stroke.size), 1, 1),
    canvasW: 0, canvasH: 0,
    tiles: { x0: range.x0, y0: range.y0, x1: range.x1, y1: range.y1 },
  };
}

/** Vuruşu hangi yolla çizeceğimizi belirler. */
function inkBuildRasterPlan(layer, stroke) {
  if (!layer || !stroke || !stroke.points || !stroke.points.length) return null;
  const plan = layer.kind === 'attached'
    ? inkAttachedRasterPlan(layer, stroke)
    : inkGlobalRasterPlan(layer, stroke);
  if (!plan) return null;

  const brush = inkGetBrush(stroke.brushId);
  /* Tur 4c paritesi: snapFree şekiller de ana thread'deki gibi yol
     dalına girebilir (kind kapısı birebir aynı olmalı). */
  plan.pathEligible = (stroke.kind === 'stroke' ||
      (stroke.kind === 'shape' && stroke.snapFree)) &&
    typeof inkStrokePathEligible === 'function' &&
    inkStrokePathEligible(stroke, brush, plan.sizePx);
  plan.erase = stroke.tool === 'eraser';
  plan.brush = brush;
  plan.brushKind = brush && brush.kind === 'abr' ? 'abr' : 'procedural';
  plan.strokeKind = stroke.kind;
  // Worker, yerel kütüphane uçlarını (suluboya/tırmık/gürültü/tram dahil)
  // kendisi üretebilir; yalnızca bitmap dokuya bağlı uçlar (.abr) ve yön
  // izleyen damgalar (angleFollow) senkron çizilir.
  const workerUnsupportedTip = !!(brush && brush.kind === 'abr') ||
    !!(brush && brush.angleFollow);
  // FAZ4-2/6: worker tüm fırça dinamiklerini birebir üretiyor — noise,
  // wetEdges, airbrush, scatterX/Y/Count/Jitter, dyn (random sürücü,
  // sizeJitter, roundnessJitter/Min, opacityJitter/opacitySrc), renk
  // dinamikleri (OKLCH per-damla), dual (blend/spacing/angle/brushId).
  // Kalan risk: dual.brushId bir .abr fırçayı çözüyorsa — worker sampled
  // bitmap üretemez, o kombinasyon senkron yolda kalır.
  let dualBrushDef = null;
  try {
    dualBrushDef = brush && brush.dual && brush.dual.brushId &&
      typeof inkGetBrush === 'function' ? inkGetBrush(brush.dual.brushId) : null;
  } catch { dualBrushDef = null; }
  const dualBrushIsAbr = !!(dualBrushDef && dualBrushDef.kind === 'abr');
  // Bölge tek iş sınırını aşıyorsa parçalanır; aşırı büyükse senkron yola düşer.
  const cols = Math.max(1, Math.ceil(plan.region.w / INK_WORKER_CHUNK));
  const rows = Math.max(1, Math.ceil(plan.region.h / INK_WORKER_CHUNK));
  plan.chunks = { cols, rows };
  plan.workerCapable = stroke.kind !== 'shape' &&
    cols * rows <= INK_WORKER_MAX_CHUNKS && !workerUnsupportedTip &&
    !dualBrushIsAbr;
  plan.offload = plan.workerCapable && !plan.pathEligible &&
    (inkWorkerState.forced || plan.dabs >= INK_WORKER_MIN_DABS);
  return plan;
}

/**
 * Vuruşun bölgesini worker sınırına sığan parçalara böler. Parçalar karo
 * hizalıdır ve aynı vuruşu daha küçük tuvale çizer; taşan kısım canvas
 * tarafından kırpılır. Böylece 2048² üstü fırça darbeleri de arka planda
 * rasterlenebilir.
 * @returns {object[]|null} parçalar; bölünemeyecek kadar büyükse null
 */
function inkSplitRasterPlans(plan) {
  if (!plan) return null;
  // FAZ4-3: smudge advected alanı tek bağlamda işlenmeli (reservoir
  // chunk'lar arası taşınamaz) — büyük bölge senkron yola döner.
  // FAZ6-13: liquify da sekansel warp — chunk bölünmesine kapalı.
  if (plan.strokeKind === 'smudge' || plan.strokeKind === 'liquify') return null;
  const r = plan.region;
  const cols = Math.max(1, Math.ceil(r.w / INK_WORKER_CHUNK));
  const rows = Math.max(1, Math.ceil(r.h / INK_WORKER_CHUNK));
  if (cols * rows > INK_WORKER_MAX_CHUNKS) return null;
  if (cols === 1 && rows === 1) return [plan];

  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = r.x + col * INK_WORKER_CHUNK;
      const y = r.y + row * INK_WORKER_CHUNK;
      const w = Math.min(INK_WORKER_CHUNK, r.x + r.w - x);
      const h = Math.min(INK_WORKER_CHUNK, r.y + r.h - y);
      if (w <= 0 || h <= 0) continue;
      const sub = Object.assign({}, plan, {
        region: { x, y, w, h },
        workerCapable: true,
        offload: true,
        part: out.length,
      });
      if (plan.mode === 'global') {
        sub.tiles = {
          x0: Math.floor(x / INK_TILE_SIZE),
          y0: Math.floor(y / INK_TILE_SIZE),
          x1: Math.floor((x + w) / INK_TILE_SIZE),
          y1: Math.floor((y + h) / INK_TILE_SIZE),
        };
      }
      out.push(sub);
    }
  }
  return out.length ? out : null;
}

/* =========================================================
   senkron boyama (eski yol / fallback)
   ========================================================= */
function inkPaintStrokeSync(layer, stroke) {
  if (!layer || !stroke) return;
  if (layer.kind === 'attached') {
    const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    inkDrawStrokeOnContext(ctx, stroke, {
      mapPoint: pt => ({ x: pt.x * canvas.width, y: pt.y * canvas.height }),
      sizePx: Math.max(0.5, stroke.size * canvas.width),
      pointScale: { x: canvas.width, y: canvas.height },
    });
    // FAZ 1B (Layer Mask): tuval maskeli rasterdır; vuruş maske dışına
    // sızmasın — vuruş kutusu içinde maske çarpımı. Maske çözümsüzse tam
    // kurulum (kaynak vuruşlardan) bir kare içinde düzeltir.
    if (layer.mask && typeof inkApplyMaskRectToItemContext === 'function') {
      const box = inkStrokeRegionBoxForMask(layer, stroke, canvas);
      if (box && !inkApplyMaskRectToItemContext(layer, ctx, canvas, box)) {
        if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.add(layer.id);
        if (typeof inkRerenderLayer === 'function') {
          requestAnimationFrame(() => inkRerenderLayer(layer.id));
        }
      }
    }
  } else {
    inkRasterizeGlobalStroke(layer, stroke);
  }
}

/** Vuruşun maske uygulaması için tuval-piksel kutusu (1px pad'li).
    `inkStrokeWorldBounds` zaten tuval çözünürlüğünde döner; tuval
    sınırına kırpılır. */
function inkStrokeRegionBoxForMask(layer, stroke, canvas) {
  const bounds = typeof inkStrokeWorldBounds === 'function'
    ? inkStrokeWorldBounds(layer, stroke) : null;
  if (!bounds) return null;
  const x = clamp(Math.floor(bounds.x) - 1, 0, canvas.width);
  const y = clamp(Math.floor(bounds.y) - 1, 0, canvas.height);
  const w = clamp(Math.ceil(bounds.x + bounds.w) + 1 - x, 0, canvas.width - x);
  const h = clamp(Math.ceil(bounds.y + bounds.h) + 1 - y, 0, canvas.height - y);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/* =========================================================
   epoch — worker sonucunu geçersiz kılan değişiklikler
   ========================================================= */
function inkPaintEpoch(layerId) {
  return inkWorkerState.epoch.get(layerId) || 0;
}

function inkPaintMutations(layerId) {
  return inkWorkerState.mutations.get(layerId) || 0;
}

/* FAZ 7.P (profiler bulgusu): S2 4K'da mini-piramit her boya döneminde
   tam kuruluyordu (~50 ms / commit; render p95 46-55 ms). Kök: epoch
   tuşu minileri tümüyle bayatlar. Çözüm: değişim bölgesi (bake/dirty
   kutusu) bump anında burada taşınır; pyramit (36-ink-editor) yalnız
   bölge yaması yapar. rect yoksa tam kurulum bayrağı taşınır — davranış
   eskiye döner (güvenli geri düşme). */
const inkEpochDirty = new Map();

function inkPaintEpochRectsIfFresh(layerId, epoch) {
  const info = inkEpochDirty.get(layerId);
  if (!info || info.epoch !== epoch) return null;
  return info.full ? { full: true, rects: [] } : { full: false, rects: info.rects };
}

/* Tur 4l · appliedEpoch-farkındalıklı okuma: verilen dönemin
   SONRASINDAKİ tüm birikmiş rect'ler döner.
   Kök neden (probe kanıtlı): eski davranışta her bump önceki rect'leri
   EZİYORDU; pyramid sync mini yolun çalışmadığı zoom'larda (tw ≥
   0.8·src) atlanırken arka arkaya gelen vuruşların rect'leri
   birbirini eziyor, zoom-out'ta TEK sync yalnız son vuruşun bölgesini
   yamayıp appliedEpoch'u güncel epoch'a atlıyordu → aradaki vuruşlar
   pyramit seviyelerinden kalıcı kayboluyordu ("uzaklaştırınca çizgiler
   yok oluyor" imzası; probe: seviyeler [0,0,255] — ilk iki vuruş yok).
   Artık rect'ler epoch'lar arası BİRİKİR; kapsama garanti
   verilemiyorsa (prune, kayıp bump, üst sınır aşımı) null döner ve
   tüketici güvenli tam kursetliğe döner. */
function inkPaintEpochDirtySince(layerId, appliedEpoch) {
  const info = inkEpochDirty.get(layerId);
  if (!info || info.epoch < 0) return null;          // prune/bilinmeyen → tam kursetlik
  if (info.full) return { full: true, rects: [] };
  const a = Number.isFinite(appliedEpoch) ? appliedEpoch : 0;
  if (a < info.baseEpoch) return null;               // kaybedilmiş bump var → tam kursetlik
  let rects = null;
  for (const e of info.rects) {
    if (e.e <= a) continue;                          // tüketici bu dönemi zaten gördü
    if (!rects) rects = [];
    rects.push(e.r);
  }
  return { full: false, rects: rects || [] };
}

/* Tur 4l · tüketim kancası: senkron uygulanan dönem raporlanır; o döneme
   kadar olan birikim ve full talebi düşer (sonraki okuma yalnız yeniyi
   taşır). */
function inkPaintEpochDirtySynced(layerId, epoch) {
  const info = inkEpochDirty.get(layerId);
  if (!info || info.epoch < 0) return;
  const e = Number.isFinite(epoch) ? epoch : 0;
  if (e < info.baseEpoch) return;                    // bayat rapor — dokunma
  info.baseEpoch = e;
  while (info.rects.length && info.rects[0].e <= e) info.rects.shift();
  info.full = false;
}

/* Birikim üst sınırı: en eski kayıtlar düşürülür ve baseEpoch kaydırılır;
   o bump'ları henüz almadıysa (appliedEpoch < baseEpoch) tüketici null
   görür ve güvenli tam kursetliğe döner. */
const INK_EPOCH_DIRTY_MAX_RECTS = 24;

function inkEpochDirtyPrune(layerId) {
  if (!layerId) return;
  inkEpochDirty.set(layerId, { epoch: -1, full: false, baseEpoch: -1, rects: [] });
}

/**
 * Katmanda değişiklik olduğunu bildirir.
 * @param {string} layerId
 * @param {'rebuild'|'mutation'} reason
 * @param {{x,y,w,h}|null} [rect] — değişimin tuval-piksel bölgesi
 *   (bake/dirty kutusu). Verilirse mini pyramit yalnız bu bölgeyi tazeler;
 *   verilmezse bir sonraki yaşamda tam kursetlik.
 */
function inkBumpPaintEpoch(layerId, reason = 'mutation', rect = null) {
  if (!layerId) return;
  const next = inkPaintEpoch(layerId) + 1;
  inkWorkerState.epoch.set(layerId, next);
  if (reason !== 'rebuild') {
    inkWorkerState.mutations.set(layerId, inkPaintMutations(layerId) + 1);
  }
  /* bölge kaydı: her bump YENİ bir epoch açar. Tur 4l: rect'ler ARTIK
     epoch'lar arasında birikir (eski davranışta her bump öncekini ezer,
     mini yolun atlandığı zoom'larda aradaki vuruşlar pyramitten
     kalıcı kaybolurdu — inkPaintEpochDirtySince üstündeki kök-nota bak).
     rect'siz bump bölgeyi bilinmez kılar: full talebi TÜKETİLENE dek
     taşınır (probe mask-region-micro sözleşmesi korunur). */
  if (!rect) {
    inkEpochDirty.set(layerId, { epoch: next, full: true, baseEpoch: next, rects: [] });
    return;
  }
  const r = {
    x: Math.max(0, Math.floor(rect.x - 1)),
    y: Math.max(0, Math.floor(rect.y - 1)),
    w: Math.max(1, Math.ceil(rect.w + 2)),
    h: Math.max(1, Math.ceil(rect.h + 2)),
  };
  const prev = inkEpochDirty.get(layerId);
  const carry = prev && prev.epoch >= 0 ? prev : null;
  const info = {
    epoch: next,
    /* bekleyen full talebi korunur: tüketici tam kursetliği görmeden
       rect birikimi onun yerine geçmez. */
    full: carry ? carry.full : false,
    /* Tur 5p: baseEpoch güvenli sınır = dizideki EN ESKİ rect'in
       epoch'su − 1 (tur 4l birikimiyle tutarlı). Eski "next − 1"
       atlaması tüketilmemiş ama hâlâ dizide duran rect'leri kurban
       ediyordu: uygula-zamanı pyramit sync'i rAF yarışında koşmaz,
       worker bölge bump'ı baseEpoch'u ileri çeker, sonraki sync
       dirtySince'ta null görür → gereksiz TAM kursetlik
       (iz: eski=9 dirty=null → pyrFull=1, 20 ms/adım). */
    baseEpoch: 0,
    rects: (carry ? carry.rects : []).concat([{ e: next, r }]),
  };
  info.baseEpoch = info.rects.length ? info.rects[0].e - 1 : next;
  while (info.rects.length > INK_EPOCH_DIRTY_MAX_RECTS) {
    info.baseEpoch = Math.max(info.baseEpoch, info.rects.shift().e);
  }
  inkEpochDirty.set(layerId, info);
}

/* =========================================================
   worker yaşam döngüsü
   ========================================================= */
function inkWorkerEnsure() {
  if (!inkWorkerSupported()) return null;
  if (inkWorkerState.worker) return inkWorkerState.worker;
  try {
    const worker = new Worker('workers/ink-worker.js');
    worker.onmessage = inkWorkerOnMessage;
    worker.onerror = err => {
      console.warn('ink worker error', err && err.message ? err.message : err);
      inkWorkerState.failed = true;
      inkWorkerTerminate();
    };
    inkWorkerState.worker = worker;
    return worker;
  } catch (err) {
    console.warn('ink worker could not start', err);
    inkWorkerState.failed = true;
    return null;
  }
}

function inkWorkerOnMessage(ev) {
  const msg = ev.data || {};
  const job = inkWorkerState.jobs.get(msg.id);
  if (!job) {
    if (msg.bitmap && msg.bitmap.close) msg.bitmap.close();
    return;
  }
  inkWorkerState.jobs.delete(msg.id);

  /* İş başına raster sayacı (worker'dan): damla ve yol çizimleri ana
     inkPerf sayaçlarının görüş alanı dışında; burada biriktirilir. */
  if (msg.stats) {
    inkWorkerState.stats.wDabs += msg.stats.dabs || 0;
    inkWorkerState.stats.wPath += msg.stats.path || 0;
  }

  /* FAZ 7.U: bölge-yeniden-kurulum işleri kendi uygulayıcısını taşır
     (baked dilim + çok vuruş → tek bitmap). Ek doğrulama/uygulama
     sözleşmesi job.custom'da; yanıtın işlenmesi tek-vuruş hattından
     bağımsızdır. */
  if (job.custom) {
    const kept = job.custom(msg);
    if (!kept && job.resolve) job.resolve(kept);
    return;
  }

  const stale = () => {
    inkWorkerState.stats.discarded++;
    if (msg.bitmap && msg.bitmap.close) msg.bitmap.close();
    job.resolve(false);
  };

  // Katman yeniden kurulumda değişmiş olabilir: güncel nesneyi kullan.
  const layer = inkLayerById(job.layer.id);
  if (!layer) return stale();

  if (msg.error || !msg.bitmap) {
    inkWorkerState.stats.errors++;
    if (layer.strokes.includes(job.stroke)) {
      try { inkPaintStrokeSync(layer, job.stroke); } catch { /* sessiz */ }
    }
    job.resolve(false);
    return;
  }

  if (!layer.strokes.includes(job.stroke)) {
    // Katman silindi veya vuruş geri alındı: geç sonuç ekrana dönmemeli.
    return stale();
  }

  if (inkPaintMutations(layer.id) !== job.mutations) {
    // Araya geri al / dönüştürme / silme girdi: bitmap eski durumu taşıyor.
    // Vuruş hâlâ katmanda olduğu için yalnızca kendi bölgesini kaynaktan
    // tazelemek yeterli; tüm katmanı yeniden çizmeye gerek yok.
    inkWorkerState.stats.discarded++;
    if (msg.bitmap && msg.bitmap.close) msg.bitmap.close();
    inkRepaintStrokeRegion(layer, job.stroke);
    job.resolve(false);
    return;
  }

  if (inkPaintEpoch(layer.id) !== job.epoch) {
    // Yalnızca tam yeniden kurulum oldu: vuruş zaten kaynaktan çizildi.
    return stale();
  }

  inkApplyRegionBitmap(layer, job.plan, msg.bitmap);
  msg.bitmap.close();
  // Katman pikselleri worker çıktısıyla değişti: kırpma grubu raster
  // önbelleği eski üye görünümünü yeniden kullanmasın (gen sürümü).
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  /* FAZ 7.P: pyramit bu bölgeyi yalnızca yamanasın. */
  if (typeof inkBumpPaintEpoch === 'function') {
    inkBumpPaintEpoch(layer.id, 'mutation', job.plan.region);
  }
  inkWorkerState.stats.applied++;
  job.resolve(true);
}

/** Bir vuruşun dünya sınırlarını kirli işaretleyip hemen tazeler. */
function inkRepaintStrokeRegion(layer, stroke) {
  const bounds = typeof inkStrokeWorldBounds === 'function'
    ? inkStrokeWorldBounds(layer, stroke) : null;
  if (bounds && typeof inkMarkLayerDirty === 'function') {
    inkMarkLayerDirty(layer, bounds);
    if (typeof inkFlushDirtyLayers === 'function') inkFlushDirtyLayers();
    return;
  }
  if (typeof inkRerenderLayer === 'function') inkRerenderLayer(layer.id);
}

function inkApplyRegionBitmap(layer, plan, bitmap) {
  const r = plan.region;
  if (layer.kind === 'attached') {
    const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    // Bitmap, bölgenin mevcut piksellerini de taşır: `copy` ile birebir
    // değiştir; `source-over` yarı saydam pikselleri iki kez karıştırırdı.
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(bitmap, r.x, r.y);
    ctx.restore();
    // FAZ 1B (Layer Mask): worker bölgesi maskesiz vuruş taşır. Kırıntı
    // görünmesin: bitmap bölgesinde maske çarpımı uygulanır. Maske
    // çözümsüzse bölge kaynaktan bir kez tazelenir (tam kurulum).
    if (layer.mask && typeof inkApplyMaskRectToItemContext === 'function') {
      const box = { x: r.x, y: r.y, w: r.w, h: r.h };
      if (!inkApplyMaskRectToItemContext(layer, ctx, canvas, box)) {
        // Maske henüz çözülmedi (oturum yüklemesi): tam kurulum düzeltir.
        if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.add(layer.id);
        if (typeof inkRerenderLayer === 'function') {
          requestAnimationFrame(() => inkRerenderLayer(layer.id));
        }
        return;
      }
    }
    inkRuntime.dirtyLayers.delete(layer.id);
    return;
  }

  const t = plan.tiles;
  for (let ty = t.y0; ty <= t.y1; ty++) {
    for (let tx = t.x0; tx <= t.x1; tx++) {
      const tile = inkEnsureTile(layer, tx, ty);
      const ctx = tile.canvas.getContext('2d', { colorSpace: 'srgb' });
      const rx = r.x - tx * INK_TILE_SIZE;
      const ry = r.y - ty * INK_TILE_SIZE;
      ctx.save();
      // `copy` yalnızca kaynak dikdörtgeninde etkili olmalı: karonun geri
      // kalanı (parçalı işlerde) silinmesin.
      ctx.beginPath();
      ctx.rect(0, 0, INK_TILE_SIZE, INK_TILE_SIZE);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(rx, ry, r.w, r.h);
      ctx.clip();
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(bitmap, rx, ry);
      ctx.restore();
      inkApplyTileStyle(tile, layer);
    }
  }
}

/* =========================================================
   bölge yakalama ve iş gönderme
   ========================================================= */
async function inkCaptureRegion(layer, plan) {
  const r = plan.region;
  if (layer.kind === 'attached') {
    const canvas = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    if (!canvas) return null;
    return createImageBitmap(canvas, r.x, r.y, r.w, r.h);
  }
  const tmp = document.createElement('canvas');
  tmp.width = r.w;
  tmp.height = r.h;
  const ctx = tmp.getContext('2d', { colorSpace: 'srgb' });
  const t = plan.tiles;
  for (let ty = t.y0; ty <= t.y1; ty++) {
    for (let tx = t.x0; tx <= t.x1; tx++) {
      const tile = inkRuntime.tiles.get(inkTileKey(layer.id, tx, ty));
      if (!tile) continue;
      ctx.drawImage(tile.canvas, tx * INK_TILE_SIZE - r.x, ty * INK_TILE_SIZE - r.y);
    }
  }
  return createImageBitmap(tmp);
}

/* FAZ 7.U: tek-vuruş ve bölge-yeniden-kurulum (batch) işlerinin ORTAK
   künyesi. Çift fırça/dinamik/akış/doku alanları tek noktadan üretilir;
   yollar ayrılsa bile worker'ın damga matematiği fark edemez.
   İpucu bitmap'leri (tip/dualTip) yol kendi üretir ve f'ye ekler. */
function inkWorkerStrokeFields(plan, stroke) {
  const brush = plan.brush;
  // dual.brushId çözümü: native/prosedürel uç worker'da üretilir (.abr ise
  // gate zaten senkron yolda tutar). Madalyonu job ile taşınır.
  let dualBrushDef = null;
  try {
    dualBrushDef = brush && brush.dual && brush.dual.brushId &&
      typeof inkGetBrush === 'function' ? inkGetBrush(brush.dual.brushId) : null;
  } catch { dualBrushDef = null; }
  return {
    stroke,
    mode: plan.mode,
    canvasW: plan.canvasW,
    canvasH: plan.canvasH,
    sizePx: plan.sizePx,
    pathEligible: !!plan.pathEligible,
    erase: !!plan.erase,
    // Dinamik/çift fırça/akış/doku bilgisi worker'da da aynı damlayı üretmeli.
    dyn: brush ? brush.dynamics || null : null,
    round: brush && Number.isFinite(brush.roundness) ? brush.roundness : 1,
    angle: brush && Number.isFinite(brush.angle) ? brush.angle : 0,
    dual: (brush && brush.dual) || null,
    // Uç yığını + çevirme/dönme: worker prosedürel ucu birebir üretir.
    tipKind: brush && brush.kind !== 'abr' && brush.tip ? brush.tip : '',
    tipOptions: brush && brush.tipOptions ? brush.tipOptions : {},
    tipVariants: brush && Number.isFinite(brush.tipVariants) ? brush.tipVariants : 1,
    tipSeed: brush && Number.isFinite(brush.tipSeed) ? brush.tipSeed : 0,
    stampFlipX: brush && Number.isFinite(brush.stampFlipX) ? brush.stampFlipX : 0,
    stampFlipY: brush && Number.isFinite(brush.stampFlipY) ? brush.stampFlipY : 0,
    tipRotation: brush && Number.isFinite(brush.tipRotation) ? brush.tipRotation : 0,
    flow: stroke && Number.isFinite(stroke.flow)
      ? stroke.flow
      : (brush && Number.isFinite(brush.flow) ? brush.flow : 1),
    flowJitter: stroke && Number.isFinite(stroke.flowJitter)
      ? stroke.flowJitter
      : (brush && Number.isFinite(brush.flowJitter) ? brush.flowJitter : 0),
    texture: !!(brush && brush.texture),
    textureDepth: brush && Number.isFinite(brush.textureDepth) ? brush.textureDepth : 0.26,
    textureScale: brush && Number.isFinite(brush.textureScale) ? brush.textureScale : 1,
    // Doku türü/parlaklık/kontrast: worker grainFor birebir üretir.
    textureId: brush && brush.textureId ? brush.textureId : 'paper',
    textureBrightness: brush && Number.isFinite(brush.textureBrightness)
      ? brush.textureBrightness : 0,
    textureContrast: brush && Number.isFinite(brush.textureContrast)
      ? brush.textureContrast : 1,
    textureEachTip: !!(brush && brush.textureEachTip),
    // FAZ4-2/6: worker'da artık gereken dinamik girdiler — saçılma
    // eksen/sayı, gürültü, ıslak kenar, airbrush ve renk dinamikleri.
    scatterX: Math.max(0, Number(brush && brush.scatterX) || 0, stroke.scatter || 0),
    scatterY: Math.max(0, Number(brush && brush.scatterY) || 0, stroke.scatter || 0),
    scatterCount: Math.round(clamp(Number(brush && brush.scatterCount) || 1, 1, 16)),
    scatterCountJitter: clamp(Number(brush && brush.scatterCountJitter) || 0, 0, 1),
    noise: (brush && Number(brush.noise)) || 0,
    wetEdges: (brush && Number(brush.wetEdges)) || 0,
    airbrush: !!(brush && brush.airbrush),
    /* PARİTE (probe-trace): sync `reusable` koşulu inkPrepareStrokeColor
       sonucudur — sıfırlı (tümü 0) colorDynamics NULL döner ve sync kova
       damgası kullanır. Payload ham objeyi taşıyordu; worker res-damga
       yolu her fırçada açılıyordu (dyndyn ±1). Sıfırlı objeyi burada
       null'a çevir: worker koşulu sync ile birebir olur. */
    colorDyn: (brush && brush.colorDynamics &&
      (brush.colorDynamics.foregroundBackground ||
        brush.colorDynamics.hueJitter ||
        brush.colorDynamics.saturationJitter ||
        brush.colorDynamics.brightnessJitter ||
        brush.colorDynamics.purity))
      ? brush.colorDynamics : null,
    // smudge sertlik fallback'i (28: (brush && brush.hardness) || 0.72)
    brushHardness: (brush && brush.hardness) || 0.72,
    dualBrush: dualBrushDef ? {
      kind: dualBrushDef.kind || '',
      tip: dualBrushDef.tip || '',
      tipOptions: dualBrushDef.tipOptions || {},
      tipSeed: dualBrushDef.tipSeed || 0,
    } : null,
    speedSize: stroke && Number.isFinite(stroke.speedSize) ? stroke.speedSize : 0,
  };
}

async function inkWorkerJob(layer, stroke, plan, dabRecs = null, dabCount = 0) {
  const worker = inkWorkerEnsure();
  if (!worker) {
    inkWorkerState.stats.fallbacks++;
    inkPaintStrokeSync(layer, stroke);
    return false;
  }

  // Damga durumu yakalamadan ÖNCE okunur: yakalama sürerken gelen bir geri
  // al / dönüştürme sonucu geçersiz kılmalı, aksi hâlde eski piksel döner.
  const epoch = inkPaintEpoch(layer.id);
  const mutations = inkPaintMutations(layer.id);
  const t0 = performance.now();

  let existing = null;
  try {
    existing = await inkCaptureRegion(layer, plan);
  } catch {
    existing = null;
  }
  if (!existing) {
    inkWorkerState.stats.fallbacks++;
    inkPaintStrokeSync(layer, stroke);
    return false;
  }

  let tip = null;
  const transfers = [existing];
  // Prosedürel uçları worker kendisi üretir; yalnızca .abr uçları taşınır.
  if (!plan.pathEligible && plan.brushKind === 'abr' && !plan.erase) {
    try {
      tip = await createImageBitmap(inkTintedTip(plan.brush, stroke.color, stroke.hardness, plan.sizePx));
      transfers.push(tip);
    } catch {
      tip = null;
    }
  }

  // Gerçek çift fırça ucu (`.abr` dual `samp`): ikinci bitmap worker'a taşınır.
  let dualTip = null;
  const dual = plan.brush && plan.brush.dual;
  if (!plan.pathEligible && !plan.erase && dual && dual.tipId) {
    try {
      const dualBrush = {
        id: 'dual:' + ((plan.brush && plan.brush.id) || 'x'),
        kind: 'abr',
        tipId: dual.tipId,
        hardness: dual.hardness,
      };
      const scale = clamp(dual.scale || 1, 0.1, 4);
      dualTip = await createImageBitmap(
        inkTintedTip(dualBrush, stroke.color, dual.hardness, plan.sizePx * scale)
      );
      transfers.push(dualTip);
    } catch {
      dualTip = null;
    }
  }

  const id = ++inkWorkerState.seq;
  const msg = {
    id,
    ...inkWorkerStrokeFields(plan, stroke),
    /* EVRE 2: C++ damla emisyonu (inkcore dabList) kayıtları — varsa
       worker emisyonu JS'te yeniden hesaplamaz (structured clone kopyası). */
    dabRecs: dabRecs || null,
    dabRecsCount: dabCount > 0 ? dabCount : 0,
    width: plan.region.w,
    height: plan.region.h,
    regionX: plan.region.x,
    regionY: plan.region.y,
    existing,
  };
  if (tip) msg.tip = tip;
  if (dualTip) msg.dualTip = dualTip;

  return new Promise(resolve => {
    // Ölçüm: worker turu tamamlanınca toplam süre.
    const wrapped = value => {
      inkWorkerState.stats.totalMs += performance.now() - t0;
      resolve(value);
    };
    inkWorkerState.jobs.set(id, {
      resolve: wrapped, layer, stroke, plan, epoch, mutations,
    });
    inkWorkerState.stats.jobs++;
    try {
      worker.postMessage(msg, transfers);
    } catch (err) {
      inkWorkerState.jobs.delete(id);
      inkWorkerState.stats.fallbacks++;
      // postMessage başarısız olduysa bitmap'ler hâlâ bizde: kapat.
      try { if (msg.existing && msg.existing.close) msg.existing.close(); } catch { /* sessiz */ }
      try { if (msg.tip && msg.tip.close) msg.tip.close(); } catch { /* sessiz */ }
      try { if (msg.dualTip && msg.dualTip.close) msg.dualTip.close(); } catch { /* sessiz */ }
      try { inkPaintStrokeSync(layer, stroke); } catch { /* sessiz */ }
      wrapped(false);
    }
  });
}

/* =========================================================
   commit köprüsü
   ========================================================= */

/**
 * Commit edilen vuruşu boyar.
 * @returns {Promise|null} asenkron ise Promise, senkron bittiyse null.
 */
function inkPaintCommittedStroke(layer, stroke) {
  if (!layer || !stroke) return null;
  const plan = inkBuildRasterPlan(layer, stroke);
  if (!plan) return null;

  const busy = inkWorkerState.chains.has(layer.id);
  const supported = inkWorkerSupported() && !inkWorkerState.failed;
  // FAZ4-3: smudge vuruşlar da worker'a taşınır (advected field).
  // FAZ6-13: liquify worker DIŞI (sekansel warp tek bağlam, senkron).
  const useWorker = (stroke.kind === 'stroke' || stroke.kind === 'smudge') && supported &&
    plan.workerCapable && (plan.offload || busy);

  if (!busy && !useWorker) {
    inkPaintStrokeSync(layer, stroke);
    return null;
  }

  const prev = inkWorkerState.chains.get(layer.id) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    if (!useWorker) {
      inkPaintStrokeSync(layer, stroke);
      return false;
    }
    const parts = inkSplitRasterPlans(plan);
    if (!parts) {
      // Parçalara bölünemeyecek kadar büyük: tek seferde senkron çiz.
      inkPaintStrokeSync(layer, stroke);
      return false;
    }
    if (!inkWorkerEnsure()) {
      inkPaintStrokeSync(layer, stroke);
      return false;
    }
    /* --- EVRE 2: damla emisyonu — worker DAIMA JS emitter ------------
       C++ dabList çekirdeği (inkcore_kernel.hpp) double'da hesaplasa da
       emit zinciri (catmullKernel/taper/sigmoid01/hypot) senkron JS
       emitter ile bit-birebir aynı sonucu ÜRETMEYEBİLİYOR: scatter alt
       damlalarında ~1 float32 ulp düzeyinde sapma (probe-trace kanıtı:
       x 137.17955100726516 ↔ 137.17956279177204; alpha 1e-8). Bu, worker
       ↔ senkron raster paritesini (ink-smoke "bayt birebir" testleri)
       bozuyordu. JS emitter yolu probe-parity'de 34 varyantın TAMAMINDA
       bayt-birebir EŞİT kanıtlandı; native emisyon optimizasyonu, kayıt
       istemcisi tamamen kaldırılarak JS emitter'a devredildi. native
       dabList napi köprüsü başka tüketiciler için korunur.
       (Smudge yolu zaten JS emisyondu.) -------------------------------- */
    const dabRecs = null, dabCount = 0;
    let applied = false;
    for (const part of parts) {
      if (inkWorkerState.failed) {
        inkPaintStrokeSync(layer, stroke);
        return applied;
      }
      const ok = await inkWorkerJob(layer, stroke, part, dabRecs, dabCount);
      if (!ok) {
        // Bir parça uygulanamadı (fallback / geçersiz): yarısı boyanmış
        // vuruş bırakma. Tüm vuruş bölgesini kaynaktan bir kez tazele.
        inkRepaintStrokeRegion(layer, stroke);
        return applied;
      }
      applied = true;
    }
    return applied;
  });

  let tracked;
  tracked = run.finally(() => {
    if (inkWorkerState.chains.get(layer.id) === tracked) {
      inkWorkerState.chains.delete(layer.id);
    }
    // FAZ 8.D: zincir bittiğinde katman yığından çıkmışsa kalan tüm
    // önbellek (tuval + tiles + thumb + gen) dispose ile bırakılır.
    if (typeof inkLayerById === 'function' && !inkLayerById(layer.id)
        && typeof inkLayerDispose === 'function') {
      inkLayerDispose(layer.id);
    }
  });
  inkWorkerState.chains.set(layer.id, tracked);
  return tracked;
}

/* =========================================================
   FAZ 7.U: undo bölge yeniden kurulumundaki damga döngüsünü worker'a
   taşıma — ÖLÇÜM (undo-drill): fallback yolda rebuildRect maliyetinin
   %97'si rcStamp'dır (baked temizle + KESİŞEN tüm vuruşların scratch'e
   sıralı damgası; 73 çağrıda ort ~125-129 ms, tepe ~280-300 ms).
   Taşınan iş: baked dilim + kesişen vuruş künyeleri + bölge kutusu →
   worker tek OffscreenCanvas'ta aynı sıra/kurallarla basar, bölge
   bitmap'i döner; ana thread yalnız clearRect + drawImage + maske yapar.
   Parite zinciri: worker drawStroke == inkDrawStrokeOnContext (K15) ve
   source-over sıralı kompozit birleşikliği; jitter deterministiktir
   (stroke.id FNV) → ana/worker aynı damlaları üretir. Kanıt:
   tests/undo-worker-region-check.js (0 px) + gates tam zincir.
   ========================================================= */

/** Bölge için KESİŞEN vuruş kümesini ve işi reddeden durumları hesaplar.
 *  inkUndoRegionRebuild'in seçicisiyle birebir (inkStrokePixelBox +
 *  inkBoxIntersectsBox); fill/gradient/liquify taşınamaz (tam tuval
 *  etkisi). smudge TAŞINIR (FAZ 7.U): batch sırası içinde tam-tuval
 *  scratch'te (drawStroke'un smudge kolu) advected okuma ana scratch
 *  semantiğiyle birebir — içeriği o ana dek batch'te basılan bölge
 *  pikselleridir (baked + önceki vuruşlar), ana yoldakiyle aynı. */
function inkWorkerRegionStrokes(layer, region, canvas) {
  const bx = Math.max(0, region.x | 0), by = Math.max(0, region.y | 0);
  const bw = Math.min(canvas.width, Math.ceil(region.x + region.w)) - bx;
  const bh = Math.min(canvas.height, Math.ceil(region.y + region.h)) - by;
  if (bw <= 0 || bh <= 0) return null;
  const regionPx = { x: bx, y: by, w: bw, h: bh };
  const listed = [];
  for (const st of layer.strokes) {
    const k = st && st.kind;
    if (k === 'fill' || k === 'gradient' || k === 'liquify') return null;
    const sb = typeof inkStrokePixelBox === 'function' ? inkStrokePixelBox(st, canvas) : null;
    if (typeof inkBoxIntersectsBox === 'function') {
      if (!sb || !inkBoxIntersectsBox(sb, regionPx)) continue;
    } else if (!sb) continue;
    listed.push(st);
  }
  return { regionPx, strokes: listed };
}

/**
 * Bölge yeniden kurulum işini worker'a gönderir (asenkron).
 * @returns {Promise<'applied'|'cancelled'>|null} null = iş kabul edilmedi
 *   (ana-thread bölgesel yol düşer); Promise = iş uçuşta, dönüşte ya
 *   uygulanır ya da iptal edildiyse ANA-THREAD yolu telafi olarak çalışır
 *   (kanvas o ana dek bayat pikselleri tutar — undo zaten asenkron
 *   görünümlü; rcStamp uzun süresi ana-longtask'tan kalkar).
 */
function inkWorkerRegionRebuildJob(layer, region, canvas) {
  if (!layer || layer.kind !== 'attached' || !canvas || !region) return null;
  if (!inkWorkerSupported() || inkWorkerState.failed) return null;
  // Commit zinciri işlerken karışma: o vuruş zaten kendi yolunda.
  if (inkWorkerState.chains.has(layer.id)) return null;
  /* FAZ 7.S · simetri reddi: worker bundle'ı el yazımı kopyadır ve
     stroke.sym açılımını (inkSymmetryStrokeClones) BİLMEZ — bölgesel
     yeniden kurulumda yalnız kök yarı boyanır, ayna/radyal klonlar
     kaybolurdu (undo/redo'da sym vuruşun klon yarısı silinirdi).
     Sym'li vuruş varsa işi REDDET; ana-thread bölgesel yol
     (inkUndoRegionRebuild → inkDrawStrokeOnContext) klonları kanonik
     açılımla doğru basar. Yalnız kök smudge hâlâ worker'a gider. */
  for (const st of layer.strokes) {
    if (st && st.sym && st.sym !== 'off') return null;
  }
  const kesim = typeof inkWorkerRegionStrokes === 'function'
    ? inkWorkerRegionStrokes(layer, region, canvas) : null;
  if (!kesim) return null;
  /* FAZ 7.U: kesişen vuruş OLMASA bile iş geçerli — içerik baked dilimi
     (kalan vuruşların bölgeye dokunmaması) ya da boş bölgedir (temizlik).
     Senkron yol (inkUndoRegionRebuild) her iki durumda da aynı sonucu
     üretir; worker işi bunları ucuza taşır. */

  // Damga durumu, yakalama ÖNCE snapshot'lanır: uçuşta gelen bir değişim
  // (yeni undo, maske mutate) biten bitmap'i geçersiz kılmalı.
  const epoch = inkPaintEpoch(layer.id);
  const mutations = inkPaintMutations(layer.id);
  const t0 = performance.now();

  const baked = layer.baked && layer.baked.src
    ? (typeof inkBakedRasterSource === 'function' ? inkBakedRasterSource(layer) : null) : null;
  if (layer.baked && layer.baked.src && !baked) return null;   // çözüm bekliyor
  if (baked && (baked.width !== canvas.width || baked.height !== canvas.height)) return null;

  const transfers = [];
  const fields = [];
  const tipJobs = [];
  for (const st of kesim.strokes) {
    const plan = typeof inkBuildRasterPlan === 'function'
      ? inkBuildRasterPlan(layer, st) : null;
    if (!plan || plan.mode !== 'attached') return null;
    const f = inkWorkerStrokeFields(plan, st);
    f.regionX = kesim.regionPx.x;
    f.regionY = kesim.regionPx.y;
    fields.push(f);
    if (plan.pathEligible || plan.erase) continue;
    // Prosedürel uçları worker kendisi üretir; yalnızca .abr uçları taşınır.
    if (plan.brush && plan.brush.kind === 'abr') {
      tipJobs.push((async () => {
        try {
          const tip = await createImageBitmap(
            inkTintedTip(plan.brush, st.color, st.hardness, plan.sizePx));
          f.tip = tip; transfers.push(tip);
        } catch { /* prosedürel uçta düşer */ }
      })());
      const dual = plan.brush && plan.brush.dual;
      if (dual && dual.tipId) {
        tipJobs.push((async () => {
          try {
            const dualBrush = {
              id: 'dual:' + ((plan.brush && plan.brush.id) || 'x'),
              kind: 'abr', tipId: dual.tipId, hardness: dual.hardness,
            };
            const scale = clamp(dual.scale || 1, 0.1, 4);
            const dt = await createImageBitmap(
              inkTintedTip(dualBrush, st.color, dual.hardness, plan.sizePx * scale));
            f.dualTip = dt; transfers.push(dt);
          } catch { /* sessiz */ }
        })());
      }
    }
  }

  const worker = inkWorkerEnsure();
  if (!worker) return null;

  return Promise.all(tipJobs).then(async () => {
    let bakedCrop = null;
    if (baked) {
      try {
        bakedCrop = await createImageBitmap(baked,
          kesim.regionPx.x, kesim.regionPx.y, kesim.regionPx.w, kesim.regionPx.h);
        transfers.push(bakedCrop);
      } catch { bakedCrop = null; }
    }

    const id = ++inkWorkerState.seq;
    inkWorkerState.stats.regionJobs++;
    if (typeof inkPerfCount === 'function') inkPerfCount('rcWPosted');
    const msg = {
      id,
      batch: fields,
      baked: bakedCrop,
      width: kesim.regionPx.w,
      height: kesim.regionPx.h,
      regionX: kesim.regionPx.x,
      regionY: kesim.regionPx.y,
      canvasW: canvas.width,
      canvasH: canvas.height,
    };

    let bitti = false;
    return new Promise(resolve => {
      const tamamla = deger => {
        if (bitti) return;
        bitti = true;
        inkWorkerState.stats.totalMs += performance.now() - t0;
        resolve(deger);
      };
      const guncelKatman = () =>
        typeof inkLayerById === 'function' ? inkLayerById(layer.id) : null;
      const telafi = isciKullan => {   // ana-thread bölgesel yol (telafi)
        const cNow = inkRuntime && inkRuntime.itemCanvases
          ? inkRuntime.itemCanvases.get(layer.id) : null;
        let onarildi = false;
        /* FAZ 7.U telafi: iptal (stale) durumunda bölgeyi ana thread'de
           senkron kurmak rcStamp uzun-vuruşunu geri getirir (undo-drill:
           hızlı undo zincirinde telafi rcStamp ort 74 ms). Bölge içeriği
           worker işinde kaynaktan tam kurulduğu için telafi de aynı işle
           worker'a kotarılabilir: GÜNCEL vuruş kümesiyle yeni bölge işi
           açılır; ana thread serbest kalır. İş reddedilirse (chain aktif,
           baked bekleniyor, worker kapalı) eski senkron yol aynen çalışır.
           Katman silindi/canvas değişti/worker hatası/2500 ms bekçi
           durumunda çağrı isciKullan=false ile senkron yolda kalır
           (döngü garantisi). */
        const gl = isciKullan ? guncelKatman() : null;
        if (gl && cNow && typeof inkWorkerRegionRebuildJob === 'function' &&
            cNow === canvas) {
          const yeniden = inkWorkerRegionRebuildJob(gl, kesim.regionPx, cNow);
          if (yeniden) {
            if (typeof inkPerfCount === 'function') inkPerfCount('rcWTelafiWorker');
            return true;
          }
        }
        if (cNow && typeof inkUndoRegionRebuild === 'function') {
          onarildi = !!inkUndoRegionRebuild(
            inkLayerById(layer.id) || layer, kesim.regionPx, cNow);
          if (onarildi) {
            if (typeof inkBumpPaintEpoch === 'function') {
              inkBumpPaintEpoch(layer.id, 'mutation', kesim.regionPx);
            }
            if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
          }
        }
        if (!onarildi && typeof inkRerenderLayer === 'function') {
          inkRerenderLayer(layer.id);
        }
      };
      /* iptal(workerTelafi): bekçi (watchdog) ve custom kapit'in ortak iptal
         yolu — tamamla/telafi bölge kapsamında TANIMLI olmak zorunda.
         (Hata kaydı: kapit custom'ın içinde tanımlıyken bekçi kapit(false)
         çağırıyordu → ReferenceError → iş haritadan silinip sessizce
         kayboluyor: sayaç yok, telafi yok, wjob sonsuz askıda.) */
      const iptal = workerTelafi => {
        if (bitti) return;
        inkWorkerState.stats.regionCancelled++;
        if (typeof inkPerfCount === 'function') inkPerfCount('rcWCancelled');
        telafi(workerTelafi);
        tamamla('cancelled');
      };
      inkWorkerState.jobs.set(id, {
        resolve: tamamla,
        custom: msg2 => {
          /* kapit(workerTelafi): yalnızca stale-yolunda (araya undo/redo
             girdi) telafi worker'a kotarılır; yapısal nedenlerde senkron. */
          const kapit = workerTelafi => {
            if (msg2.bitmap && msg2.bitmap.close) msg2.bitmap.close();
            iptal(workerTelafi);
            return true;
          };
          if (bitti) {
            if (msg2.bitmap && msg2.bitmap.close) msg2.bitmap.close();
            return true;
          }
          const guncel = typeof inkLayerById === 'function' ? inkLayerById(layer.id) : layer;
          if (!guncel) return kapit(false);
          const cNow = inkRuntime && inkRuntime.itemCanvases
            ? inkRuntime.itemCanvases.get(layer.id) : null;
          if (!cNow || cNow !== canvas) return kapit(false);
          if (msg2.error || !msg2.bitmap) {
            inkWorkerState.stats.errors++;
            return kapit(false);
          }
          // Uçuşta araya değişim girdi mi? (undo/redo/maske/commit)
          if (inkPaintMutations(layer.id) !== mutations) return kapit(true);
          // Vuruş listesi birebir beklenen küme mi? (idempotans guard)
          for (const st of kesim.strokes) {
            if (!guncel.strokes.includes(st)) return kapit(true);
          }
          const ctx = cNow.getContext('2d', { colorSpace: 'srgb' });
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.beginPath();
          ctx.rect(kesim.regionPx.x, kesim.regionPx.y, kesim.regionPx.w, kesim.regionPx.h);
          ctx.clip();
          ctx.clearRect(kesim.regionPx.x, kesim.regionPx.y, kesim.regionPx.w, kesim.regionPx.h);
          ctx.drawImage(msg2.bitmap, kesim.regionPx.x, kesim.regionPx.y);
          ctx.restore();
          msg2.bitmap.close();
          // FAZ 1B: maske çarpımı bölge üzerinde — ÇÖZÜMSÜZSE funnel'daki
          // tam kurulum devralır (tek-vuruş hattıyla aynı yapı).
          if (layer.mask && typeof inkApplyMaskRectToItemContext === 'function') {
            if (!inkApplyMaskRectToItemContext(
                layer, ctx, cNow, { x: kesim.regionPx.x, y: kesim.regionPx.y,
                  w: kesim.regionPx.w, h: kesim.regionPx.h })) {
              if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.add(layer.id);
              if (typeof inkRerenderLayer === 'function') {
                requestAnimationFrame(() => inkRerenderLayer(layer.id));
              }
              inkWorkerState.stats.regionApplied++;
              tamamla('applied');
              return true;
            }
          }
          if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
          /* FAZ 7.P: bölge bilinen — piramit yalnız bu kutuyu yamar. */
          if (typeof inkBumpPaintEpoch === 'function') {
            inkBumpPaintEpoch(layer.id, 'mutation', kesim.regionPx);
          }
          if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
          if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
          inkWorkerState.stats.regionApplied++;
          if (typeof inkPerfCount === 'function') inkPerfCount('rcWApplied');
          tamamla('applied');
          return true;
        },
      });
      inkWorkerState.stats.jobs++;
      try {
        worker.postMessage(msg, transfers);
      } catch (err) {
        inkWorkerState.jobs.delete(id);
        inkWorkerState.stats.fallbacks++;
        try { if (msg.baked && msg.baked.close) msg.baked.close(); } catch { /* sessiz */ }
        for (const f of fields) {
          try { if (f.tip && f.tip.close) f.tip.close(); } catch { /* sessiz */ }
          try { if (f.dualTip && f.dualTip.close) f.dualTip.close(); } catch { /* sessiz */ }
        }
        telafi();
        tamamla(null);
      }
      // Bekçi: worker sustuysa (en kötü durum) kanvas bayat kalmasın.
      // Senkron telafi: tekrar worker işi açmak ölür worker'da döngü kurar.
      // 2500 ms: 4K bölge + baked crop işi yazılım rastersoda ~1 s sürer;
      // 800 ms bekçi her seferinde kazanıyor, telafi senkrona düşüyordu.
      setTimeout(() => {
        if (!bitti && inkWorkerState.jobs.get(id)) {
          inkWorkerState.jobs.delete(id);
          iptal(false);
        }
      }, 2500);
    });
  });
}

/** Bekleyen tüm worker işlerinin bitmesini bekler (test / bench). */
function inkPaintIdle() {
  const pending = [...inkWorkerState.chains.values()];
  if (!pending.length) return Promise.resolve();
  return Promise.allSettled(pending).then(() => (
    inkWorkerState.chains.size ? inkPaintIdle() : undefined
  ));
}

/* =========================================================
   yaşam döngüsü kancaları
   ========================================================= */
function inkWorkerResetLayer(layerId) {
  if (!layerId) return;
  inkWorkerState.chains.delete(layerId);
  inkWorkerState.epoch.delete(layerId);
  inkWorkerState.mutations.delete(layerId);
}

/* FAZ 8.D — katman yığından çıktıysa worker durumunu da bırak;
   uçuştaki zincir bittiğinde katman geri getirilmemişse (inkLayerById
   yoksa) kalan bedeli inkLayerDispose tek noktaya devreder. */
function inkWorkerReleaseLayer(layerId) {
  if (!layerId) return;
  inkWorkerState.chains.delete(layerId);
  inkWorkerState.epoch.delete(layerId);
  inkWorkerState.mutations.delete(layerId);
}
