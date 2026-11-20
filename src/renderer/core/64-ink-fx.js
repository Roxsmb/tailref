/* TailRef app · ink fx motor · non-destructive artistic effects çekirdeği
   ------------------------------------------------------------------------
   Master spec: docs/fx-motoru-spec.md (Bölüm 1/2/6/7). Faz 1: çekirdek motor.

   Mimari karar (Bölüm 12 raporu, docs/fx-bolum12-inceleme.md):
   • FX zinciri kompozitör plan girişlerinin ÜSTÜNE aşamalardır:
       Composite Input → FX1 → FX2 → … → Final Canvas Output
   • Tek kaynak fonksiyon inkFxApplyChain: ekran (inkCompositeSyncItem) ile
     export (inkDrawAttachedForExport) AYNI zinciri kullanır — ekran=export
     sapması sıfır (compositor-test parity ilkesi).
   • Aşama önbelleği: sig = prevSig + type + params + seed + size + opacity
     + blend. Parametre değişimi yalnız o aşamayı ve ALTTAKİLERİ geçersiz
     kılar (input sig değişimi prevSig'i kapsadığı için otomatik).
   • visible=false / opacity≤0 aşama pass-through: yeniden hesap YOK.
   • Deterministik PRNG (mulberry32): seed efekt kaydında; rastgelelik
     render'lar arası sabit (master spec Bölüm 11 determinizm şartı).
   • Veri modeli: it.fx = { stack: [{ id, type, params, opacity, visible,
     blend, seed }] } — item alanı olduğundan pushUndo snapshot (JSON) ve
     .tail kaydına otomatik girer (inkFxEnsure erişimde normalize eder:
     eski proje/undo restore'unda da doğru).
   • Kapsam: yalnız görsle bağlı (attached) katmanlar; global karo katmanları
     Faz 3 kararı (Bölüm 12 raporu §5-B karo dikiş kısıtı).
   ========================================================= */
'use strict';

/* =========================================================
   deterministik PRNG (mulberry32)
   ========================================================= */

function inkFxRng(seed) {
  let a = (seed | 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =========================================================
   efekt kayıt defteri
   ---------------------------------------------------------
   Efekt tanımı:
     { id, label, category, params: [şema], defaultParams,
       apply(outCtx, src, params, size, rng) }
   apply sözleşmesi: `src` (canvas, girdi rasterı) transformasyonun
   GİRDİSİDİR; `outCtx` ŞEFFAF bir tuvaldir ve efekt TAM çıktısını oraya
   basar (girdiyi kendisi kopyalamaz — aşama karışımı zincir yapar:
   output = prev OVER efektÇıktısı, fx.opacity/fx.blend ile).
   Şema param türleri: 'slider' (min/max/step), 'angle' (derece),
   'dropdown' (options), 'toggle', 'color' ('none' = şeffaf).
   ========================================================= */

const INK_FX_EFFECTS = new Map();

function inkFxRegister(def) {
  if (!def || typeof def.id !== 'string' || !def.id
    || typeof def.apply !== 'function' || !Array.isArray(def.params)) return false;
  INK_FX_EFFECTS.set(def.id, def);
  return true;
}

/**
 * Parametre görünürlüğü: `when` koşulu sağlanmıyorsa kontrol alakasızdır
 * (ör. inkCount=2 iken 3. mürekkep rengi). Inspector ve önizlemeler bu
 * yardımcıyı kullanır; preset çözümlemesi tüm parametreleri yine saklar.
 * Desteklenen koşullar: {key, in|is|neq|gte|lte} ve {all:[...]}/{any:[...]}.
 */
function inkFxParamVisible(p, params) {
  const w = p && p.when;
  if (!w) return true;
  const vals = params || {};
  if (Array.isArray(w.all)) return w.all.every(x => inkFxParamVisible({ when: x }, vals));
  if (Array.isArray(w.any)) return w.any.some(x => inkFxParamVisible({ when: x }, vals));
  const v = vals[w.key];
  if (Array.isArray(w.in)) return w.in.includes(v);
  if (w.is !== undefined) return v === w.is;
  if (w.neq !== undefined) return v !== w.neq;
  if (w.gte !== undefined) return Number(v) >= w.gte;
  if (w.lte !== undefined) return Number(v) <= w.lte;
  return true;
}

/** Verilen parametre anahtarı başka kontrollerin görünürlüğünü etkiliyor mu? */
function inkFxParamIsController(type, key) {
  const def = INK_FX_EFFECTS.get(type);
  if (!def) return false;
  return def.params.some(p => p.when && p.when.key === key);
}

function inkFxCategoryLabel(cat) {
  if (cat === 'printmaking') return 'Baskı';
  if (cat === 'traditional') return 'Geleneksel Medya';
  if (cat === 'experimental') return 'Deneysel';
  return 'Efektler';
}

/* =========================================================
   veri modeli + normalize
   ========================================================= */

const inkFxRuntime = {
  inputs: new Map(),   // itId -> { sig, canvas, w, h }
  stages: new Map(),   // itId -> Map(fxId@WxH -> { sig, canvas })
  /* Son hesaplanan nihai raster: önizleme sıklık sınırına takılan karede
     ekran/çizim tuvali bu rasterı kullanır (bayat ama DOĞRU çözünürlük). */
  lastRaster: new Map(), // itId -> canvas
  /* sürükleme önizlemesi. Eski davranış girdiyi 0.35 ölçekte işliyordu;
     piksel tabanlı parametreler ve deterministik gürültü dizisi ölçekle
     değiştiği için "sürüklerken" ile "bırakınca" tamamen farklıydı.
     Artık zincir HER ZAMAN tam çözünürlükte hesaplanır; yalnız hesaplama
     sıklığı sınırlanır (ara değerler atlanır, son durum boyanır). */
  preview: {
    itId: null,
    until: 0,
    lastRenderAt: 0,
    lastCost: 0,
    timer: 0,
    pendingItem: null,
  },
};

const INK_FX_PREVIEW_MIN_INTERVAL = 80;
const INK_FX_PREVIEW_MAX_INTERVAL = 400;

/* Ağır zincirde sabit 80 ms yetmiyordu: her kare ~1 sn sürünce istekler
   birikiyor, sürükleme kilitleniyordu. Aralık son ölçülen zincir süresine
   göre büyür (en az 80 ms, en çok 400 ms) → ara kareler atlanır, son değer
   gecikmeli boyanır; parite değişmez (tam çözünürlük korunur). */
function inkFxPreviewInterval() {
  const cost = inkFxRuntime.preview.lastCost || 0;
  return Math.min(INK_FX_PREVIEW_MAX_INTERVAL,
    Math.max(INK_FX_PREVIEW_MIN_INTERVAL, Math.round(cost * 1.1)));
}

function inkFxNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function inkFxPreviewBegin(itId) {
  if (!itId) return;
  const p = inkFxRuntime.preview;
  if (p.itId !== itId) {
    p.itId = itId;
    p.lastRenderAt = 0;
    p.lastCost = 0;
  }
  /* güvenlik: change olayı gelmezse 1500ms sonra sıklık sınırı kalkar. */
  p.until = inkFxNow() + 1500;
}

function inkFxPreviewEnd(itId) {
  const p = inkFxRuntime.preview;
  if (!itId || p.itId === itId) {
    p.itId = null;
    p.until = 0;
    p.pendingItem = null;
    if (p.timer) { clearTimeout(p.timer); p.timer = 0; }
  }
}

function inkFxPreviewActive(itId) {
  const p = inkFxRuntime.preview;
  return p.itId === itId && inkFxNow() < p.until;
}

/** Önizleme sırasında bu kare atlanmalı mı? Atlanırsa gecikmeli bir kare
    planlanır: kullanıcı sürüklemeyi bırakmadan dursa bile son durum boyanır. */
function inkFxPreviewShouldSkip(it) {
  const p = inkFxRuntime.preview;
  if (!it || !it.id || p.itId !== it.id || !inkFxPreviewActive(it.id)) return false;
  const now = inkFxNow();
  if (!p.lastRenderAt || now - p.lastRenderAt >= inkFxPreviewInterval()) return false;
  inkFxPreviewSchedule(it);
  return true;
}

function inkFxPreviewMarkRendered() {
  inkFxRuntime.preview.lastRenderAt = inkFxNow();
}

function inkFxPreviewSchedule(it) {
  const p = inkFxRuntime.preview;
  p.pendingItem = it;
  if (p.timer) return;
  const wait = Math.max(16,
    inkFxPreviewInterval() - (inkFxNow() - (p.lastRenderAt || 0)));
  p.timer = setTimeout(() => {
    p.timer = 0;
    const item = p.pendingItem;
    p.pendingItem = null;
    if (!item || !inkFxPreviewActive(item.id)) return;
    if (typeof inkSyncDom === 'function') {
      try { inkSyncDom(item); } catch { /* sessiz */ }
    }
    if (typeof inkEditorInvalidate === 'function') {
      try { inkEditorInvalidate(); } catch { /* sessiz */ }
    }
  }, wait);
}

function inkFxNewId() {
  return 'fx_' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    + '-' + Math.random().toString(36).slice(2, 6);
}

function inkFxClampParam(p, v) {
  if (v === undefined || v === null) return p.default;
  if (p.type === 'slider' || p.type === 'angle') {
    const n = Number(v);
    if (!Number.isFinite(n)) return p.default;
    return Math.min(p.max, Math.max(p.min, n));
  }
  if (p.type === 'dropdown') {
    return (Array.isArray(p.options) && p.options.includes(v)) ? v : p.default;
  }
  if (p.type === 'toggle') return !!v;
  if (p.type === 'color') {
    if (v === 'none') return 'none';
    return (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) ? v : p.default;
  }
  return v === undefined ? p.default : v;
}

/** it.fx'i normaliz eder (eksik/bozuk alanları onarır). Erişim noktalarında
 *  çağrılır: ekran senkronu, export, panel — restore/undo/eski proje
 *  sonrasında da stack tutarlıdır. Bilinmeyen efekt türü stack'ten DÜŞER
 *  (master spec Bölüm 8: eski dosyalar bozulmaz, efekt yokluğu = efekt yok). */
function inkFxEnsure(it) {
  if (!it) return null;
  if (!it.fx || typeof it.fx !== 'object') it.fx = { stack: [] };
  if (!Array.isArray(it.fx.stack)) it.fx.stack = [];
  const clean = [];
  for (const fx of it.fx.stack) {
    if (!fx || typeof fx !== 'object') continue;
    const def = INK_FX_EFFECTS.get(fx.type);
    if (!def) continue;
    const params = {};
    for (const p of def.params) {
      params[p.key] = inkFxClampParam(p, fx.params ? fx.params[p.key] : undefined);
    }
    clean.push({
      id: (typeof fx.id === 'string' && fx.id.startsWith('fx_')) ? fx.id : inkFxNewId(),
      type: fx.type,
      params,
      opacity: Math.min(1, Math.max(0, Number.isFinite(fx.opacity) ? fx.opacity : 1)),
      visible: fx.visible === undefined ? true : !!fx.visible,
      blend: (typeof fx.blend === 'string' && fx.blend) ? fx.blend : 'normal',
      seed: Number.isFinite(fx.seed) ? (fx.seed | 0) : ((Math.random() * 0xffffffff) | 0),
    });
  }
  it.fx.stack = clean;
  return it.fx;
}

/** Etkin (görünür + opak + kayıtlı) efekt var mı? */
function inkFxItemHasActiveFx(it) {
  if (!it || !it.fx || !Array.isArray(it.fx.stack)) return false;
  return it.fx.stack.some(fx => fx && fx.visible !== false
    && (fx.opacity === undefined ? true : fx.opacity > 0.001)
    && INK_FX_EFFECTS.has(fx.type));
}

/* =========================================================
   girdi rasterı (Composite Input) — ekran=export tek kaynak
   ---------------------------------------------------------
   Item'ın TÜM attached katmanlarının ekran planı sırasına göre tek
   tuvalde birleşimi. Boyama semantiği inkCompositePaintPlanToContext
   (export) ile birebir: giriş opaklığı/blend'i buraya pişirilir
   (master spec Bölüm 6 "Store effect configurations independently
   from rendered results" ✓ — pişirme yalnız önbellek, veri modeli
   parametrik kalır).
   ========================================================= */

/* Referans fotoğraf kaynağı: görsel item'ın DOM'da gösterilen <img>'i.
   FX girdisi artık "fotoğraf + mürekkep" birleşimidir (kullanıcı isteği:
   "referans fotoğrafa da efekt atmak istiyorum"). */
function inkFxPhotoSource(it) {
  if (!it || it.kind !== 'image') return null;
  const el = typeof elMap !== 'undefined' ? elMap.get(it.id) : null;
  const img = el ? el.querySelector('.media img') : null;
  if (!img || !img.complete || !img.naturalWidth) return null;
  return img;
}

/** Fotoğraf parmak izi: girdi önbelleği fotoğraf değişince tazelenir. */
function inkFxPhotoSig(it) {
  const img = inkFxPhotoSource(it);
  if (!img) return 'foto|yok';
  const src = img.currentSrc || img.src || '';
  let hash = 0;
  for (let i = 0; i < src.length; i++) hash = (Math.imul(hash, 31) + src.charCodeAt(i)) | 0;
  return 'foto|' + img.naturalWidth + 'x' + img.naturalHeight + '|' + hash;
}

function inkFxInputSig(it, plan) {
  const parts = ['fxin', it.id, it.w, it.h, inkFxPhotoSig(it)];
  for (const entry of plan) {
    const members = (entry.members || []).concat([entry.base], entry.clips || []);
    if (!inkPlanEntryVisible(entry)) { parts.push('gizli'); continue; }
    parts.push('E', Math.round(inkCompositeEntryOpacity(entry) * 1000),
      inkCompositeEntryBlend(entry) || 'normal');
    for (const layer of members) {
      parts.push(layer.id, inkLayerGen(layer.id),
        typeof inkPaintEpoch === 'function' ? inkPaintEpoch(layer.id) : 0,
        layer.visible === false ? 'g' : '', layer.clip ? 'c' : '');
    }
  }
  return parts.join('|');
}

/** Yeniden kullanılan tuvali "yeni tuval" durumuna getirir: transform,
 *  alfa, karışım, filtre, gölge ve yumuşatma varsayılana döner ve tuval
 *  temizlenir. Efektler taze tuval bekler; geri dönüşüm bunu korur. */
function inkFxResetCanvasCtx(ctx, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.clearRect(0, 0, w, h);
}

/** Item'ın birleşik girdi rasterını döndürür (önbellekli).
 *  @returns {{sig:string, canvas:HTMLCanvasElement, w:number, h:number}|null} */
function inkFxInputRaster(it) {
  const plan = inkAttachedDisplayPlan(it.id);
  /* Fotoğraf katmana pişmişse (Layer 1 = fotoğraf) DOM görseli ayrıca
     basılmaz: tek kaynak katman rasterıdır (çifte kompozit olmaz).
     Yalnız BİZİM fotoğraf bake'imiz bu kurala girer; birleştirme/flatten
     kaynaklı baked içerik fotoğrafı gizlemez. */
  const bakedPhoto = plan.some(e => e && e.base && e.base.baked
    && e.base.photoBakeSig);
  const photo = bakedPhoto ? null : inkFxPhotoSource(it);
  if (!plan.length && !photo) return null;
  let w = 0, h = 0;
  for (const entry of plan) {
    const b = entry.base;
    if (Number.isFinite(b.pxW) && b.pxW > 0) { w = b.pxW; h = b.pxH; break; }
  }
  if (!w && photo) { w = photo.naturalWidth; h = photo.naturalHeight; }
  if (!w && plan.length) {
    const s = inkGroupSizePixels(plan[0]);
    w = s.w; h = s.h;
  }
  if (!w || !h) return null;
  const sig = inkFxInputSig(it, plan);
  const cached = inkFxRuntime.inputs.get(it.id);
  if (cached && cached.sig === sig && cached.canvas.width === w
    && cached.canvas.height === h) return cached;

  /* Tuval geri dönüşümü: imza değişse de aynı boyuttaysa eski tuval
     yeniden kullanılır (4K'da her boyama değişiminde 33 MB ayırmak
     yerine clearRect). Dışarıya verilen referans yok: girdi rasterı
     yalnız zincir içinde tüketilir. */
  const canvas = cached ? cached.canvas : document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return null;
  inkFxResetCanvasCtx(ctx, w, h);
  /* Taban: referans fotoğraf (opak) — efektler fotoğrafı da işler. */
  if (photo) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, 0, 0, w, h);
    ctx.restore();
  }
  for (const entry of plan) {
    if (!inkPlanEntryVisible(entry)) continue;
    const raster = inkCompositeEntryCanvas(entry, null);
    if (!raster || !raster.width || !raster.height) continue;
    ctx.save();
    ctx.globalAlpha = inkCompositeEntryOpacity(entry);
    const blend = inkCompositeEntryBlend(entry);
    ctx.globalCompositeOperation = blend || 'source-over';
    ctx.drawImage(raster, 0, 0, w, h);
    ctx.restore();
  }
  const rec = { sig, canvas, w, h };
  inkFxRuntime.inputs.set(it.id, rec);
  return rec;
}

/* =========================================================
   aşama zinciri (Effect Stack)
   ========================================================= */

/** Aşama imzası: prevSig zinciri upstream değişimi downstream'e otomatik
 *  taşır (master spec Bölüm 2: "upstream changes correctly invalidate
 *  affected downstream rendering results" ✓). */
function inkFxStageSig(prevSig, fx, w, h) {
  return [prevSig, fx.type, JSON.stringify(fx.params), fx.seed | 0, w, h,
    Math.round((fx.opacity === undefined ? 1 : fx.opacity) * 1000),
    fx.blend || 'normal'].join('|');
}

/**
 * FX zincirini uygular. `src` girdi rasterı; dönüş NİHAİ kanvas (girdi
 * ile aynı piksel boyutu) — etkin aşama yoksa null.
 */
function inkFxApplyChain(itId, src, w, h, it) {
  /* Ağır zincir (4K'da 1.5 sn+) sırasında ana süreçteki "yanıt vermiyor"
     gözcüsüne meşgul olduğumuzu bildir; yanlış kurtarma kutusu açılmasın. */
  const busy = typeof window !== 'undefined' && window.tailref
    && typeof window.tailref.rendererBusy === 'function'
    ? window.tailref.rendererBusy : null;
  if (busy) { try { busy(true); } catch { /* sessiz */ } }
  try {
    return inkFxApplyChainInner(itId, src, w, h, it);
  } finally {
    if (busy) { try { busy(false); } catch { /* sessiz */ } }
  }
}

function inkFxApplyChainInner(itId, src, w, h, it) {
  inkFxEnsure(it);
  const inputSig = inkFxRuntime.inputs.get(itId)
    ? inkFxRuntime.inputs.get(itId).sig : 'raw';
  let prev = src;
  let prevSig = 'in|' + inputSig;
  let stages = inkFxRuntime.stages.get(itId);
  if (!stages) { stages = new Map(); inkFxRuntime.stages.set(itId, stages); }
  /* Stack'ten çıkmış efektlerin aşama tuvalleri kalmasın (bellek). */
  inkFxPruneStages(it);
  let applied = false;
  /* Sürükleme sırasında zincir süresini ölç (uyarlanabilir kare aralığı). */
  const previewCostStart = inkFxRuntime.preview.itId === itId ? inkFxNow() : 0;
  for (const fx of it.fx.stack) {
    if (fx.visible === false || (fx.opacity === undefined ? false : fx.opacity <= 0.001)) continue;
    const def = INK_FX_EFFECTS.get(fx.type);
    if (!def) continue;
    applied = true;
    const sig = inkFxStageSig(prevSig, fx, w, h);
    const key = fx.id + '@' + w + 'x' + h;
    const cached = stages.get(key);
    if (cached && cached.sig === sig && cached.canvas.width === w
      && cached.canvas.height === h) {
      prev = cached.canvas; prevSig = sig;
      continue;
    }
    /* 1) efekt çıktısı: şeffaf tuvale TAM sonuç. Aşama tuvalleri saklanıp
       clearRect ile yeniden kullanılır: her yeniden hesapta 2× tam boy
       tuval ayırmak (4K'da aşama başına ~66 MB) GC fırtınası yaratıyordu. */
    const slot = cached || { sig: '', canvas: null, tmp: null };
    let tmp = slot.tmp;
    if (!tmp) { tmp = document.createElement('canvas'); slot.tmp = tmp; }
    if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }
    const tctx = tmp.getContext('2d', { colorSpace: 'srgb' });
    if (!tctx) continue;
    inkFxResetCanvasCtx(tctx, w, h);
    def.apply(tctx, prev, fx.params, { w, h }, inkFxRng(fx.seed));
    /* 2) aşama karışımı: output = prev OVER efektÇıktısı (fx.opacity/blend) */
    let stage = slot.canvas;
    if (!stage) { stage = document.createElement('canvas'); slot.canvas = stage; }
    if (stage.width !== w || stage.height !== h) { stage.width = w; stage.height = h; }
    const sctx = stage.getContext('2d', { colorSpace: 'srgb' });
    if (!sctx) continue;
    inkFxResetCanvasCtx(sctx, w, h);
    sctx.drawImage(prev, 0, 0, w, h);
    sctx.globalAlpha = Math.min(1, Math.max(0, fx.opacity === undefined ? 1 : fx.opacity));
    if (fx.blend && fx.blend !== 'normal') sctx.globalCompositeOperation = fx.blend;
    sctx.drawImage(tmp, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
    slot.sig = sig;
    stages.set(key, slot);
    /* Aynı efektin eski boyuttaki kopyasını bırakma: imza her zaman
       WxH içerdiği için boyut değişince eski kare çöp olur. */
    const prefix = fx.id + '@';
    for (const k of [...stages.keys()]) {
      if (k !== key && k.startsWith(prefix)) stages.delete(k);
    }
    prev = stage; prevSig = sig;
  }
  if (!applied) {
    inkFxRuntime.lastRaster.delete(itId);
    return null;
  }
  inkFxRuntime.lastRaster.set(itId, prev);
  /* Sıklık sınırı bu andan itibaren ölçülür (ağır efektte art arda
     hesaplama yapılmasın). Ağırlık da son süreye göre uyarlanır. */
  if (previewCostStart) {
    inkFxRuntime.preview.lastCost = inkFxNow() - previewCostStart;
  }
  if (typeof inkFxPreviewMarkRendered === 'function') inkFxPreviewMarkRendered();
  return prev;
}

/** Önbellek temizliği: yalnız girdi rasterı. Aşama tuvalleri SİLİNMEZ:
 *  her aşamanın imzası girdiyi + önceki aşamayı + parametreleri taşır,
 *  bu yüzden değişen aşama ve sonrası kendiliğinden yeniden hesaplanır.
 *  Hepsini silmek, yeni efekt eklerken/geri alırken önceki efektlerin de
 *  yeniden hesaplanmasına yol açıyordu (4K fotoğrafta saniyeler). */
function inkFxInvalidate(itId) {
  if (!itId) return;
  inkFxRuntime.inputs.delete(itId);
  inkFxRuntime.lastRaster.delete(itId);
}

/** Öğe silindi/çöpe atıldı: tam çözünürlüklü girdi + aşama tuvalleri
 *  bırakılır. Bunlar `Map`'te öğe kimliğiyle tutuluyordu ve silinen
 *  öğeler için hiç temizlenmiyordu → 4K bir FX öğesi silindiğinde
 *  ~100 MB (girdi + aşama tuvalleri) oturum boyunca bellekte kalıyordu. */
function inkFxDisposeItem(itId) {
  if (!itId) return;
  inkFxRuntime.inputs.delete(itId);
  inkFxRuntime.stages.delete(itId);
  inkFxRuntime.lastRaster.delete(itId);
  inkFxPreviewEnd(itId);
}

/** Stack'ten çıkmış efektlerin aşama tuvalleri kalmasın (bellek).
 *  Zincir hesabı yalnız "etkin efekt var" durumunda çalıştığı için son
 *  efekt silinince `inkFxApplyChain`'deki temizlik hiç koşmuyordu: silinen
 *  4K efektin aşama tuvali (~17 MB, 4K'da daha fazla) öğe kapanana kadar
 *  bellekte kalıyordu. Yapısal değişiklikte (ekle/sil/sırala/undo) çağrılır. */
function inkFxPruneStages(it) {
  if (!it || !it.id) return;
  const stages = inkFxRuntime.stages.get(it.id);
  if (!stages || !stages.size) return;
  const live = new Set(((it.fx && it.fx.stack) || []).map(f => f.id));
  for (const k of [...stages.keys()]) {
    const at = k.indexOf('@');
    if (at > 0 && !live.has(k.slice(0, at))) stages.delete(k);
  }
}

/** Panel/araç değişiklik sonrası: önbellek + ekran + kayıt planlaması. */
function inkFxChanged(it) {
  if (!it) return;
  inkFxPreviewEnd(it.id);
  inkFxPruneStages(it);
  inkFxInvalidate(it.id);
  if (typeof inkSyncDom === 'function') inkSyncDom(it);
  /* Çizim tuvali efektli rasterı gösterir: yapısal değişiklikte kare tazelenir. */
  if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
  if (typeof scheduleSave === 'function') scheduleSave();
}

/* =========================================================
   ekran senkronu (inkCompositeSyncItem FX dalı)
   ========================================================= */

/** FX etkinse tek .inkFxCanvas overlay üretir/güncelleyip true döner;
 *  etkin değilse bayat kanvası kaldırıp false döner (normal yola geç). */
function inkFxSyncItem(it, el) {
  if (!it || !el || it.kind !== 'image') return false;
  if (!inkFxItemHasActiveFx(it)) {
    /* Tüm efektler silindi/gizlendi ya da undo ile yığın boşaldı: zincir
       hesabı koşmayacağı için aşama temizliği buradan yapılır. */
    inkFxPruneStages(it);
    inkFxRuntime.lastRaster.delete(it.id);
    const stale = el.querySelector(':scope > .inkFxCanvas');
    if (stale) stale.remove();
    return false;
  }
  if (!inkOwnerStackLayers(it.id).length) return false;
  const input = inkFxInputRaster(it);
  if (!input || !input.w || !input.h) return false;
  /* Sürükleme önizlemesinde de TAM çözünürlük kullanılır (düşük ölçekli
     önizleme piksel tabanlı parametreleri ve gürültü dizisini değiştirip
     bırakınca bambaşka bir sonuç veriyordu). Yalnız kare sıklığı sınırlı:
     mevcut fx kanvası olduğu gibi bırakılır, son durum gecikmeli boyanır. */
  if (inkFxPreviewShouldSkip(it) && el.querySelector(':scope > .inkFxCanvas')) {
    return true;
  }
  const final = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
  if (!final) return false;

  let fxCanvas = el.querySelector(':scope > .inkFxCanvas');
  if (!fxCanvas) {
    fxCanvas = document.createElement('canvas');
    fxCanvas.className = 'inkFxCanvas';
    fxCanvas.setAttribute('aria-hidden', 'true');
    const handles = el.querySelector(':scope > .handles');
    if (handles) el.insertBefore(fxCanvas, handles);
    else el.appendChild(fxCanvas);
  }
  if (fxCanvas.width !== input.w || fxCanvas.height !== input.h) {
    fxCanvas.width = input.w;
    fxCanvas.height = input.h;
  }
  const fctx = fxCanvas.getContext('2d', { colorSpace: 'srgb' });
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, input.w, input.h);
  fctx.drawImage(final, 0, 0, input.w, input.h);

  /* Katman + grup tuvallerini gizle: görüntüyü tek fx kanvası taşır.
     Z sırası: item içi en üst (katman yığını boyu + 3). */
  const layers = inkOwnerStackLayers(it.id);
  for (const layer of layers) {
    const c = inkRuntime && inkRuntime.itemCanvases
      ? inkRuntime.itemCanvases.get(layer.id) : null;
    if (c) c.style.display = 'none';
  }
  for (const g of el.querySelectorAll(':scope > .inkGroupCanvas')) g.style.display = 'none';
  fxCanvas.style.zIndex = String(2 + layers.length + 1);
  fxCanvas.style.opacity = '1';
  fxCanvas.style.mixBlendMode = 'normal';
  fxCanvas.style.display = 'block';
  return true;
}

/* =========================================================
   export yardımı (inkDrawAttachedForExport FX dalı)
   ========================================================= */

/** FX etkinse nihai rasterı item yerel uzayına (merkez 0,0) basar ve
 *  true döner; caller normal katman çizimini atlar. Ekran ile AYNI
 *  inkFxInputRaster + inkFxApplyChain kullanılır (piksel birebir). */
function inkFxExportDraw(ctx, it) {
  if (!it || !inkFxItemHasActiveFx(it)) return false;
  const input = inkFxInputRaster(it);
  if (!input || !input.w || !input.h) return false;
  const final = inkFxApplyChain(it.id, input.canvas, input.w, input.h, it);
  if (!final) return false;
  ctx.drawImage(final, -it.w / 2, -it.h / 2, it.w, it.h);
  return true;
}

/* =========================================================
   PİLOT EFEKT · 1. HALFTONE (master spec Bölüm 1.1)
   ---------------------------------------------------------
   Gerçek halftone: döner hücre ızgarası, hücre-ortalamalı luminance,
   kontrast/parlaklık/eşik, tonal duyarlılık (gamma), kenar koruma
   (gradien tabanlı dot küçültme), 4 dot şekli, mono/color.
   Deterministik: rng kullanılmaz (aynı girdi → aynı pikseller).
   ========================================================= */

inkFxRegister({
  id: 'halftone',
  label: 'Halftone',
  category: 'printmaking',
  params: [
    /* Dot Settings */
    { key: 'dotSize', label: 'Dot Size', type: 'slider', min: 2, max: 96, step: 1, default: 20 },
    { key: 'dotSpacing', label: 'Dot Spacing', type: 'slider', min: 4, max: 128, step: 1, default: 24 },
    { key: 'dotAngle', label: 'Dot Angle', type: 'angle', min: 0, max: 360, step: 1, default: 45 },
    { key: 'dotShape', label: 'Dot Shape', type: 'dropdown', default: 'circle',
      options: ['circle', 'square', 'diamond', 'line'] },
    { key: 'dotScale', label: 'Dot Scale', type: 'slider', min: 0.2, max: 1.6, step: 0.05, default: 1 },
    { key: 'dotRotation', label: 'Dot Rotation', type: 'angle', min: -180, max: 180, step: 1, default: 0,
      when: { key: 'dotShape', neq: 'circle' } },
    /* Image Processing */
    { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.2, max: 2.4, step: 0.05, default: 1 },
    { key: 'brightness', label: 'Brightness', type: 'slider', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.97 },
    { key: 'tonalSensitivity', label: 'Tonal Sensitivity', type: 'slider', min: 0.25, max: 3, step: 0.05, default: 1 },
    { key: 'patternIntensity', label: 'Pattern Intensity', type: 'slider', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'edgePreservation', label: 'Edge Preservation', type: 'slider', min: 0, max: 1, step: 0.01, default: 0 },
    /* Appearance */
    { key: 'colorMode', label: 'Color Mode', type: 'dropdown', default: 'mono',
      options: ['mono', 'color'] },
    { key: 'dotColor', label: 'Dot Color', type: 'color', default: '#111111' },
    { key: 'bgColor', label: 'Background Color', type: 'color', default: 'none' },
    { key: 'invertPattern', label: 'Invert Pattern', type: 'toggle', default: false },
  ],
  defaultParams: null, /* inkFxEnsure şemadan üretir */

  apply(outCtx, src, P, size) {
    const w = size.w, h = size.h;
    if (!src || !w || !h) return;

    /* 1) luminance + renk haritası (tek okuma) */
    const sctx = src.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!sctx) return;
    let data;
    try { data = sctx.getImageData(0, 0, w, h).data; } catch { return; }
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      const a = data[p + 3] / 255;
      const l = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
      lum[i] = a * l + (1 - a); /* şeffaflık = kâğıt (beyaz) */
    }

    /* 2) parlaklık / kontrast uygulanmış hücre-ortalama haritası
       (döner ızgara: her piksel hücre uzayına map edilir) */
    const spacing = Math.max(2, P.dotSpacing);
    const ang = (P.dotAngle % 360) * Math.PI / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const cx = w / 2, cy = h / 2;
    const gw = Math.ceil((w + h) / spacing) + 4;
    const sum = new Float32Array(gw * gw);
    const cnt = new Float32Array(gw * gw);
    const gOff = gw / 2;
    for (let y = 0; y < h; y++) {
      const dy = y + 0.5 - cy;
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        const gx = Math.floor(((dx * cosA + dy * sinA) / spacing) + gOff);
        const gy = Math.floor(((-dx * sinA + dy * cosA) / spacing) + gOff);
        const gi = gy * gw + gx;
        sum[gi] += lum[y * w + x];
        cnt[gi]++;
      }
    }

    /* 3) kenar haritası (yalnız gerekirse): hücre gradieni */
    let edge = null;
    if (P.edgePreservation > 0.001) {
      edge = new Float32Array(gw * gw);
      for (let gy = 1; gy < gw - 1; gy++) {
        for (let gx = 1; gx < gw - 1; gx++) {
          const i = gy * gw + gx;
          if (!cnt[i]) continue;
          const l = cnt[i] ? sum[i] / cnt[i] : 1;
          const r = cnt[i + 1] ? sum[i + 1] / cnt[i + 1] : l;
          const d = cnt[i + gw] ? sum[i + gw] / cnt[i + gw] : l;
          edge[i] = Math.min(1, (Math.abs(r - l) + Math.abs(d - l)) * 2);
        }
      }
    }

    /* 4) arka plan */
    const octx = outCtx;
    if (P.bgColor && P.bgColor !== 'none') {
      octx.save();
      octx.globalAlpha = 1;
      octx.fillStyle = P.bgColor;
      octx.fillRect(0, 0, w, h);
      octx.restore();
    }

    /* 5) dot taraması: hücre → kaynak merkez örneği → çizim */
    const maxR = Math.max(0.5, P.dotSize / 2) * P.dotScale;
    const colorMode = P.colorMode === 'color';
    const inv = !!P.invertPattern;
    const rot = (P.dotRotation % 360) * Math.PI / 180;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);

    octx.save();
    octx.translate(cx, cy);
    octx.rotate(-ang); /* hücre eksenine hizala */
    octx.globalAlpha = Math.min(1, Math.max(0, P.patternIntensity));

    for (let gy = 0; gy < gw; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const gi = gy * gw + gx;
        if (!cnt[gi]) continue;
        let l = sum[gi] / cnt[gi];
        /* parlaklık + kontrast */
        l = (l - 0.5) * P.contrast + 0.5 + P.brightness;
        l = Math.min(1, Math.max(0, l));
        if (inv) l = 1 - l;
        if (l >= P.threshold) continue; /* kâğıt: dot yok */
        /* tonal duyarlılık: gamma eğrisi */
        const t = Math.pow(l, 1 / Math.max(0.05, P.tonalSensitivity));
        let r = maxR * t;
        if (edge && P.edgePreservation > 0.001) {
          r *= 1 - P.edgePreservation * edge[gi];
        }
        if (r < 0.35) continue;

        /* hücre merkezi → kaynak pikseli (renk modu için) */
        const gcx = (gx + 0.5 - gOff) * spacing;
        const gcy = (gy + 0.5 - gOff) * spacing;
        const sx = Math.min(w - 1, Math.max(0, Math.round(cx + gcx * cosA - gcy * sinA)));
        const sy = Math.min(h - 1, Math.max(0, Math.round(cy + gcx * sinA + gcy * cosA)));

        octx.save();
        octx.translate(gcx, gcy);
        if (rot) octx.rotate(rot);
        if (colorMode) {
          const p4 = (sy * w + sx) * 4;
          const a = data[p4 + 3] / 255;
          octx.fillStyle = a > 0
            ? 'rgba(' + data[p4] + ',' + data[p4 + 1] + ',' + data[p4 + 2] + ',' + a + ')'
            : P.dotColor;
        } else {
          octx.fillStyle = P.dotColor;
        }
        const shape = P.dotShape;
        if (shape === 'square') {
          octx.fillRect(-r, -r, r * 2, r * 2);
        } else if (shape === 'diamond') {
          octx.beginPath();
          octx.moveTo(0, -r); octx.lineTo(r, 0);
          octx.lineTo(0, r); octx.lineTo(-r, 0);
          octx.closePath(); octx.fill();
        } else if (shape === 'line') {
          const th = Math.max(1, r * 0.6);
          octx.fillRect(-spacing / 2, -th / 2, spacing, th);
        } else { /* circle */
          octx.beginPath();
          octx.arc(0, 0, r, 0, Math.PI * 2);
          octx.fill();
        }
        octx.restore();
      }
    }
    octx.restore();
  },
});
