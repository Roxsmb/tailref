/* TailRef app · belge katman yığını
   ------------------------------------------------------------------
   Katman yığını belgenin (görselin) parçasıdır. Bu dosya yığın üzerinde
   yalnızca okuma/yazma yapan işlemleri toplar; panel her açıldığında
   yığın yeniden ÜRETİLMEZ. Belge başına başlatma idempotenttir.

   Sıra: `ink.layers` dizisinde ALTTAKİ katman önce, ÜSTTEKİ sonra gelir.
   Panelde ise en üstteki satır en üstteki katmandır (ters gösterim).
   ========================================================= */
'use strict';

const INK_DOC_LAYER_MIN = 1;

/** Canlı vuruş koruması: tahta hattı `inkPointer/inkTransform`, modal
    editör `inkEditorUi.stroke` kullanır. Katman işlemleri (ekle/sil/
    çoğalt/birleştir/sırala/gizle) vuruş ortasında çalışırsa undo noktası
    ve aktif katman kayar; iki hattı birlikte kontrol et. */
function inkLayerStrokeActive() {
  if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) return true;
  return typeof inkEditorUi !== 'undefined' && !!inkEditorUi &&
    !!inkEditorUi.open && !!inkEditorUi.stroke;
}

/** Geçerli çizim belgesinin (görselin) kimliği. */
function inkDocOwnerId() {
  try {
    if (typeof inkRuntime !== 'undefined' && inkRuntime && inkRuntime.imageScopeId) {
      return inkRuntime.imageScopeId;
    }
  } catch { /* sessiz */ }
  try {
    if (typeof inkEditorUi !== 'undefined' && inkEditorUi && inkEditorUi.open && inkEditorUi.itemId) {
      return inkEditorUi.itemId;
    }
  } catch { /* sessiz */ }
  const it = typeof inkScopedImageItem === 'function' ? inkScopedImageItem() : null;
  if (it) return it.id;
  const active = typeof inkActiveLayer === 'function' ? inkActiveLayer() : null;
  if (active && active.kind === 'attached' && active.ownerId) return active.ownerId;
  if (typeof modeIsDraw === 'function' && modeIsDraw() &&
      typeof appModeUi !== 'undefined' && appModeUi && appModeUi.itemId) {
    return appModeUi.itemId;
  }
  return null;
}

/** Belgenin katmanları: alttan üste doğru.
 *  FAZ 1 (gruplar): karışık yığın — çizim katmanları (attached) ve klasör
 *  düzlemleri (group) dizideki gerçek sırayla (plana birebir) döner. */
function inkDocLayers(ownerId) {
  const id = ownerId || inkDocOwnerId();
  if (!id) return [];
  return typeof inkOwnerStackLayers === 'function'
    ? inkOwnerStackLayers(id)
    : inkState().layers.filter(l => l.kind === 'attached' && l.ownerId === id);
}

/** Belgeye ait klasör düzlemleri. */
function inkDocGroups(ownerId) {
  const id = ownerId || inkDocOwnerId();
  if (!id) return [];
  return typeof inkGroupsForOwner === 'function'
    ? inkGroupsForOwner(id)
    : [];
}

/** Panelin gösterdiği sıra: en üstteki katman ilk satır. */
function inkDocLayersTopFirst(ownerId) {
  return inkDocLayers(ownerId).slice().reverse();
}

function inkDocSelectedLayer(ownerId) {
  const stack = inkDocLayers(ownerId);
  if (!stack.length) return null;
  const active = typeof inkActiveLayer === 'function' ? inkActiveLayer() : null;
  return active && stack.includes(active) ? active : null;
}

function inkDocNameNumber(name) {
  const m = /(\d+)\s*$/.exec(String(name || ''));
  return m ? Number(m[1]) : 0;
}

/** Mevcut en büyük numaranın bir fazlası; silinen numara yeniden kullanılmaz. */
function inkDocNextName(ownerId) {
  const id = ownerId || inkDocOwnerId() || '_';
  const ink = typeof inkState === 'function' ? inkState() : null;
  if (ink) {
    if (!ink.docLayerSeq || typeof ink.docLayerSeq !== 'object') ink.docLayerSeq = {};
    let max = Number(ink.docLayerSeq[id]) || 0;
    for (const layer of inkDocLayers(ownerId)) {
      max = Math.max(max, inkDocNameNumber(layer.name));
    }
    const next = Math.max(1, max + 1);
    ink.docLayerSeq[id] = next;
    return 'Layer ' + next;
  }
  let max = 0;
  for (const layer of inkDocLayers(ownerId)) {
    max = Math.max(max, inkDocNameNumber(layer.name));
  }
  return 'Layer ' + (max + 1);
}

/**
 * Belge katmanlarını garanti eder: boşsa tam olarak bir "Katman 1" açar,
 * seçim geçersizse en üstteki katmanı seçer. Yeniden çağrılması yeni
 * katman üretmez (idempotent).
 */
function inkDocEnsure(ownerId) {
  const id = ownerId || inkDocOwnerId();
  if (!id) return null;
  const ink = inkState();
  let stack = inkDocLayers(id);

  if (!stack.length) {
    const layer = inkMakeLayer({ kind: 'attached', ownerId: id, name: 'Layer 1' });
    ink.layers.push(layer);
    ink.activeLayerId = layer.id;
    stack = [layer];
  } else {
    // Eski otomatik adlar ("Çizim 1") belge adlandırmasına çevrilir.
    for (const layer of stack) {
      if (/^Çizim(?: ·)?\s*\d+$/.test(layer.name)) {
        layer.name = 'Layer ' + Math.max(1, inkDocNameNumber(layer.name));
      }
    }
  }
  // Sayaç, mevcut en büyük numaradan geri kalmasın.
  if (!ink.docLayerSeq || typeof ink.docLayerSeq !== 'object') ink.docLayerSeq = {};
  let seq = Number(ink.docLayerSeq[id]) || 0;
  for (const layer of stack) seq = Math.max(seq, inkDocNameNumber(layer.name));
  ink.docLayerSeq[id] = Math.max(1, seq);

  const active = typeof inkLayerById === 'function' ? inkLayerById(ink.activeLayerId) : null;
  // FAZ 1 (gruplar): klasör düzlemi de seçilebilir (göz/kilit/yeniden ad ve
  // taşıma için); yalnız başka görselin / genel katmanın seçimi düşürülür.
  if (!active || active.ownerId !== id ||
      (active.kind !== 'attached' && active.kind !== 'group')) {
    ink.activeLayerId = stack[stack.length - 1].id;
  }
  return inkDocSelectedLayer(id);
}

/** Seçili katmanı değiştirir (tek seçim). */
function inkDocSelectLayer(layerId) {
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer) return null;
  if (typeof inkSetActiveLayer === 'function') inkSetActiveLayer(layer.id);
  inkState().activeLayerId = layer.id;
  /* FAZ 8.B: panel sync artık 'select' aboneliğinden gelir.
     Katman seçimi tuval görüntüsünü değiştirmez: editörün tam kare
     yeniden kompozitini tetiklemeyiz (4K'da ~60 ms donma oluyordu).
     maskEditId burada değişmediğinden maske düzenleme görünümü de sabit. */
  if (typeof inkSyncUI === 'function') inkSyncUI({ invalidateEditor: false });
  if (typeof dpSyncToolbar === 'function') dpSyncToolbar();
  inkLayerStoreEmit('select', { layerId: layer.id, ownerId: layer.ownerId || null });
  return layer;
}

/** FAZ 1B: maske vuruşunu maskenin tuvaline işler (katmana DEĞİL).
 *  Beyaz/silgi ayrımı stroke.tool'dan gelir: eraser → destination-out
 *  (alfayı azalt), diğerleri → source-over (alfayı ekler). Stroke
 *  katman defterine girmez; undo tam pushUndo ile alınır (maske src'si
 *  state.ink içinde olduğundan ücretsiz geri gelir). */
/* A3 (maske idle-encode): maske vuruşu mask.src'te yaşadığından her
   commit tam tuval PNG kodlaması (~20 ms @1600×1200, ~57 ms @4K)
   yapardı. Görüntü yolu inkMaskRasterPrime ile canlı tuvaliden beslendiği
   için kodlamayı idle'a erteliyoruz; herhangi bir serileştirme anında
   (pushUndo/undo/save → createStateSnapshot) pending senkron flush
   edilir → kayıt/undo/redo doğruluğu bit-parite korunur. Bayatlık
   koruması: fire anında layer.mask.src değişmişse (undo restore,
   mask silme) kodlama atılır. */
const inkMaskPending = new Map();
const inkMaskIdleFn = (typeof requestIdleCallback === 'function'
  ? cb => requestIdleCallback(cb, { timeout: 400 })
  : cb => setTimeout(cb, 120));
const inkMaskIdleCancel = (typeof cancelIdleCallback === 'function');
function inkMaskQueueEncode(layer, canvas) {
  if (typeof document === 'undefined' || !layer || !layer.mask || !canvas) return false;
  const id = layer.id;
  const prior = inkMaskPending.get(id);
  if (prior && prior.timer) {
    if (prior.ric && inkMaskIdleCancel) cancelIdleCallback(prior.timer);
    else clearTimeout(prior.timer);
  }
  const entry = { canvas, basis: layer.mask.src, ric: true, timer: 0 };
  inkMaskPending.set(id, entry);
  entry.timer = inkMaskIdleFn(() => {
    const e = inkMaskPending.get(id);
    if (!e || e !== entry) return;
    inkMaskPending.delete(id);
    const L = typeof inkLayerById === 'function' ? inkLayerById(id) : null;
    if (!L || !L.mask || L.mask.src !== e.basis) return; /* bayat */
    inkMaskAssignSource(L, e.canvas);
  });
  return true;
}
function inkMaskAssignSource(layer, canvas) {
  const t0 = typeof inkPerfSpan === 'function' ? performance.now() : 0;
  layer.mask.src = canvas.toDataURL('image/png');
  if (typeof inkMaskRasterCache !== 'undefined' && inkMaskRasterCache) {
    const h = inkMaskRasterCache.get(layer.id);
    if (h) h.len = layer.mask.src.length;
  }
  if (typeof inkPerfSpan === 'function' && t0) {
    inkPerfSpan('maskEncode', performance.now() - t0);
    inkPerfCount('maskEncodeNx', 1);
  }
}
/** Pending kodlamaları ANINDA senkron tamamlar (createStateSnapshot
    kancası; pending yoksa maliyetsiz). */
function inkMaskFlushPending() {
  if (!inkMaskPending.size) return;
  for (const [id, e] of [...inkMaskPending.entries()]) {
    inkMaskPending.delete(id);
    if (e.ric && inkMaskIdleCancel) cancelIdleCallback(e.timer);
    else clearTimeout(e.timer);
    const L = typeof inkLayerById === 'function' ? inkLayerById(id) : null;
    if (!L || !L.mask || L.mask.src !== e.basis) continue; /* bayat */
    inkMaskAssignSource(L, e.canvas);
  }
}
/** Yeni maske düzlemi: tam tuval kodlaması yerine 1×1 sabit dataURL.
    inkMaskRasterSource çözerken tuval boyutuna gerer (uniform düzlem
    için birebir eşdeğer); ilk vuruşla zaten tam src yazılacak. */
let inkMaskTinyCache = null;
function inkMaskTinyDataUrl(color) {
  if (typeof document === 'undefined') return '';
  if (!inkMaskTinyCache) inkMaskTinyCache = {};
  if (inkMaskTinyCache[color]) return inkMaskTinyCache[color];
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const g = c.getContext('2d', { colorSpace: 'srgb' });
  if (color !== 'rgba(0,0,0,0)') { g.fillStyle = color; g.fillRect(0, 0, 1, 1); }
  return (inkMaskTinyCache[color] = c.toDataURL('image/png'));
}

function inkMaskCommitStrokeFor(layer, stroke) {
  if (!layer || !stroke || layer.kind !== 'attached' || !layer.mask) return false;
  if (stroke.kind === 'smudge' || stroke.kind === 'gradient') {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('This tool does not work on a mask', 2400);
    }
    return false;
  }
  const __mc0 = typeof inkPerfSpan === 'function' ? performance.now() : 0;
  const canvas = typeof inkMaskRasterSource === 'function'
    ? inkMaskRasterSource(layer) : null;
  if (!canvas) {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('Mask raster not ready yet — try again next frame', 2400);
    }
    return false;
  }
  if (typeof pushUndo === 'function') pushUndo();
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  const eff = ctx && stroke.tool === 'eraser'
    ? { ...stroke, tool: 'eraser' } : stroke;
  if (ctx) {
    inkDrawStrokeOnContext(ctx, eff, {
      mapPoint: pt => ({ x: clamp(pt.x, 0, 1) * canvas.width, y: clamp(pt.y, 0, 1) * canvas.height }),
      sizePx: Math.max(0.5, stroke.size * canvas.width),
      pointScale: { x: canvas.width, y: canvas.height },
    });
  }
  /* A3: snapshot idleye ertelenir; görüntü yolu prime'lı canlı
     tuvaliden senkron beslenir.createStateSnapshot kancası serialize
     anında flush eder (undo/redo/kayıt paritesi korunur). */
  if (typeof inkMaskQueueEncode === 'function' && inkMaskQueueEncode(layer, canvas)) {
    /* ertelendi — idle encode */
  } else {
    layer.mask = {
      src: canvas.toDataURL('image/png'),
      w: canvas.width, h: canvas.height,
    };
  }
  if (typeof inkMaskRasterPrime === 'function') {
    inkMaskRasterPrime(layer.id, layer.mask.src, canvas.width, canvas.height, canvas);
  }
  /* FAZ 7.M-MA (mask funnel): vuruş yalnız kendi piksel kutusundaki
     maske alfa'sını değiştirir — item kompozit de yalnız bu kutuda
     yeniden kurulabilir (baked kesit + kesişen vuruşlar + bölge
     maskesi = tam kursetmittel birebir kompozit kuralları). Bölge
     > %60 tuval ya da inkRebuildItemLayerRegion yoksa eski tam yol
     güvenli hâlde yürürlükte kalır. */
  const maskBox = typeof inkStrokePixelBox === 'function'
    ? inkStrokePixelBox(stroke, canvas, 2) : null;
  const maskeBolge = !!maskBox && maskBox.w > 0 && maskBox.h > 0 &&
    maskBox.w * maskBox.h < canvas.width * canvas.height * 0.6;
  let maskeOnarildi = false;
  if (typeof inkBumpPaintEpoch === 'function') {
    // FAZ 7.P: bölgesel yolda pyramit yalnız bu kutuyu yamar;
    // kutussuz bump tam pyramit kurar — TEK çağrı yeterli.
    inkBumpPaintEpoch(layer.id, 'mask', maskeBolge ? maskBox : undefined);
  }
  if (maskeBolge && typeof inkRebuildItemLayerRegion === 'function') {
    maskeOnarildi = inkRebuildItemLayerRegion(layer, maskBox);
    if (typeof inkPerfCount === 'function') {
      inkPerfCount(maskeOnarildi ? 'maskCommitRectOK' : 'maskCommitRectSkips');
    }
  }
  /* FAZ 8.B: maske vuruş bundan böyle mask funnel'dan geçer — dirty/
     rerender/gen + 'mask' olayı inkMaskAfterChange'de tek noktadan. */
  if (typeof inkPerfSpan === 'function' && __mc0) {
    inkPerfSpan('maskCommit', performance.now() - __mc0);
  }
  inkMaskAfterChange(layer, layer.id, maskeOnarildi ? { rerender: false } : undefined);
  return true;
}

/* =========================================================
   yığın işlemleri
   ========================================================= */
let inkDocFlashLayerId = null;

/* =========================================================
   FAZ 8.A — Observer Store (v1)
   Katman mutasyonlarının tek olay kaynağı. Amaç: "sync çağrısı
   unutuldu" hatası kökten kalkar — panel ve diğer aboneler elle
   inkSyncLayersPanel çağırmak yerine olaya abone olur (8.B).
   Olay türleri: add | remove | reorder | rename | property |
   mask | select. Kural: her mutasyon FAZ 8.A tablosundaki olay
   sayısını tam yaymalı (scripts/layer-store-test.js bunu sayar).
   Bilinçli tercih: emit'te try/catch YOK — abone hata yaparsa
   hata iletişimi kapatılmaz (sessiz try kuralı; yalnız bootstrap
   loglanır, render sıcak yolu istisnadır — burada ikisi de yok).
   ========================================================= */
const inkLayerStore = { subs: new Map() };   // type -> Set<fn>
function inkLayerStoreOn(type, fn) {
  let set = inkLayerStore.subs.get(type);
  if (!set) { set = new Set(); inkLayerStore.subs.set(type, set); }
  set.add(fn);
  return () => inkLayerStoreOff(type, fn);
}
function inkLayerStoreOff(type, fn) {
  const set = inkLayerStore.subs.get(type);
  if (set) set.delete(fn);
}
function inkLayerStoreEmit(type, payload) {
  const set = inkLayerStore.subs.get(type);
  if (!set || !set.size) return;
  for (const fn of Array.from(set)) fn(type, payload || {});
}

/* FAZ 8.B öte — undo/yinele restore'unu store olaylarına bağlar.
   Bütün-durum restore'sunda (04-persistence-view undo/redo) önceki ve
   sonraki `state.ink` anlık görüntüleri satır görünüm alanında
   karşılaştırılır; satır görünümünde GERÇEKTEN değişen şeyler olaydır:
   yok olan katman → remove(reason:restore), yeni gelen → add,
   isim → rename, konum → reorder (yalnız konum değişimi — diğeri
   değişmediyse), satır gövdesi (görünürlük/opaklık/maske/klip/kilit +
   vuruş sayısı → raster) → property. Değişmeyen satır 0 olay;
   aktif katman değiştiyse TEK 'select'. */
function inkRestoreRowParts(layer, layers) {
  const members = layer.kind === 'group'
    ? layers.filter(l => l.kind === 'attached' && l.parentId === layer.id).length
    : 0;
  return {
    pos: layers.length - 1 - layers.indexOf(layer),   // üstten-ilk konum
    name: layer.name,
    body: [
      layer.visible ? 1 : 0,
      layer.locked ? 1 : 0,
      layer.kind,
      layer.parentId || '',
      layer.clip ? 1 : 0,
      layer.alphaLock ? 1 : 0,
      layer.mask ? 1 : 0,
      Math.round((layer.opacity ?? 1) * 100),
      layer.strokes ? layer.strokes.length : 0,
      members,
    ].join('|'),
  };
}

function inkLayerStoreEmitRestoreDiff(prev, next) {
  if (!prev || !next) return;
  if (!Array.isArray(prev.layers) || !Array.isArray(next.layers)) return;
  if (typeof inkLayerStoreEmit !== 'function') return;
  const prevById = new Map(prev.layers.map(l => [l.id, l]));
  const nextById = new Map(next.layers.map(l => [l.id, l]));
  for (const layer of prev.layers) {
    if (nextById.has(layer.id)) continue;
    inkLayerStoreEmit('remove', {
      ownerId: layer.ownerId || null, layerId: layer.id, reason: 'restore',
    });
  }
  for (const layer of next.layers) {
    const before = prevById.get(layer.id);
    if (!before) {
      inkLayerStoreEmit('add', {
        ownerId: layer.ownerId || null, layerId: layer.id, kind: layer.kind,
      });
      continue;
    }
    const partsA = inkRestoreRowParts(before, prev.layers);
    const partsB = inkRestoreRowParts(layer, next.layers);
    // Her satırda basta 0 olay (eski imza karşılaştırmasındaki
    // "değişiklik satır başına en az bir property" gürültüsü kalktı).
    if (partsA.name !== partsB.name) {
      inkLayerStoreEmit('rename', {
        ownerId: layer.ownerId || null, layerId: layer.id, name: partsB.name,
      });
    }
    if (partsA.body !== partsB.body) {
      inkLayerStoreEmit('property', {
        ownerId: layer.ownerId || null, layerId: layer.id, field: 'restore',
      });
    }
    if (partsA.pos !== partsB.pos) {
      inkLayerStoreEmit('reorder', {
        ownerId: layer.ownerId || null, layerId: layer.id,
      });
    }
  }
  if (prev.activeLayerId !== next.activeLayerId) {
    const active = next.layers.find(l => l.id === next.activeLayerId);
    inkLayerStoreEmit('select', {
      layerId: active ? active.id : null,
      ownerId: active ? (active.ownerId || null) : null,
    });
  }
}

/* =========================================================
   FAZ 8.D — dispose(layerId): tek noktadan yaşam sonu temizliği
   Bir katman yığından kaldırıldığında (sil / birleştir / düzleştir /
   undo geri dönüşümü / görselin tahtadan çıkması) sahip olduğu TÜM
   çalışma zamanı önbellekleri burada tek yerden bırakılır:
   ekran tuvali (itemCanvases), karo aynaları (tiles), baked/maske
   raster çözümleri, minyatür + bbox cache, kirli-setler ve gen sayacı.
   Kaldırılmadan önce: baked/maske cache'te delete YOKTU — silinen her
   katmanın dataURL'rasterı bellekte kalıyordu (ölçüm: dispose-test).
   ========================================================= */
function inkLayerDispose(layerId) {
  if (!layerId) return;
  const runt = typeof inkRuntime !== 'undefined' ? inkRuntime : null;
  if (runt) {
    const canvas = runt.itemCanvases.get(layerId);
    if (canvas) {
      if (canvas.parentNode) canvas.remove();
      runt.itemCanvases.delete(layerId);
    }
    if (runt.tiles && runt.tiles.size) {
      for (const [key, tile] of [...runt.tiles]) {
        if (tile && tile.layerId === layerId) {
          if (tile.canvas && tile.canvas.parentNode) tile.canvas.remove();
          runt.tiles.delete(key);
        }
      }
    }
    if (runt.dirtyLayers) runt.dirtyLayers.delete(layerId);
    if (runt.dirty && runt.dirty.layers) runt.dirty.layers.delete(layerId);
  }
  if (typeof inkMaskRasterCache !== 'undefined') inkMaskRasterCache.delete(layerId);
  if (typeof inkBakedRasterCache !== 'undefined') inkBakedRasterCache.delete(layerId);
  if (typeof inkLayerThumbRelease === 'function') inkLayerThumbRelease(layerId);
  if (typeof inkWorkerReleaseLayer === 'function') inkWorkerReleaseLayer(layerId);
  if (typeof inkCompositeRuntime !== 'undefined' && inkCompositeRuntime) {
    inkCompositeRuntime.gen.delete(layerId);
    inkCompositeRuntime.groups.delete(layerId);
  }
  if (typeof inkDirty !== 'undefined' && inkDirty && inkDirty.layers) {
    inkDirty.layers.delete(layerId);
  }
}

function inkDocAfterChange(flashId) {
  if (flashId) inkDocFlashLayerId = flashId;
  if (typeof inkLayerRefreshPreview === 'function') inkLayerRefreshPreview();
  else if (typeof inkSyncDom === 'function') inkSyncDom();
  /* FAZ 8.B: panel sync'siz — çağıran mutasyon kendi olayını yayıyor
     (store aboneliği paneli olayda besler). inkDocAfterChange artık
     yalnız görünüm/toolbar/save zarflarını tazeler. */
  if (typeof inkSyncUI === 'function') inkSyncUI();
  if (typeof dpSyncToolbar === 'function') dpSyncToolbar();
  if (typeof scheduleSave === 'function') scheduleSave();
}

/** "+" — seçili katmanın hemen üstüne ekler, seçer ve görünür alana kaydırır. */
function inkDocAddLayer(options = {}) {
  /* Vuruş koruması: canlı vuruşta katman ekleme — pushUndo vuruşla
     iç içe giriyor, üstüne aktif katman değişip vuruş başka katmana
     sapıyordu. Vuruş sürerken "+" dokunuşu yutulur. */
  if (inkLayerStrokeActive()) return null;
  const ownerId = options.ownerId || inkDocOwnerId();
  if (!ownerId) {
    // Görsel seçili değilken (tahta üzerinde çizim) "+" genel katman ekler.
    if (typeof pushUndo === 'function') pushUndo();
    const layer = typeof inkAddLayer === 'function'
      ? inkAddLayer({ kind: 'global', name: options.name })
      : null;
    if (!layer) {
      if (typeof showProjectNotice === 'function') showProjectNotice('Could not add layer', 2400);
      return null;
    }
    inkDocAfterChange(layer.id);
    inkLayerStoreEmit('add', { ownerId: null, layerId: layer.id, kind: 'global' });
    return layer;
  }
  inkDocEnsure(ownerId);
  const ink = inkState();
  const stack = inkDocLayers(ownerId);
  const selected = inkDocSelectedLayer(ownerId);
  // 0.B.6 öte: katman ekleme ARTIK undo noktası üretir — Ctrl+Z yeni
  // katmanı kaldırır (restore-diff 'remove(reason:restore)' duyurur).
  if (typeof pushUndo === 'function') pushUndo();
  const layer = inkMakeLayer({
    kind: 'attached',
    ownerId,
    name: options.name || inkDocNextName(ownerId),
  });
  /* Photoshop davranışı: klasör ÜYESİ seçiliyken yeni katman aynı klasörün
     İÇİNDE açılır. Aksi hâlde yeni katman üye ile klasör başlığının arasına
     girer; kompozitör bitişik olmayan üyeyi klasör dışına düşürür ama panel
     "üye" göstermeye devam eder — klasörü gizleyince üye görünür kalırdı. */
  if (selected && selected.parentId) layer.parentId = selected.parentId;

  if (selected) {
    ink.layers.splice(ink.layers.indexOf(selected) + 1, 0, layer);
  } else if (stack.length) {
    ink.layers.splice(ink.layers.indexOf(stack[stack.length - 1]) + 1, 0, layer);
  } else {
    ink.layers.push(layer);
  }

  ink.activeLayerId = layer.id;
  ink.selection = [];
  inkDocAfterChange(layer.id);
  inkLayerStoreEmit('add', { ownerId, layerId: layer.id, kind: 'attached' });
  return layer;
}

/* =========================================================
   FAZ 1B — katman maskesi (plan madde 4)
   Maske = katman çizgilerinin ALFA kanalını çarpan ikinci alfa düzlemi
   (destination-in: a_o = a_d × a_mask). Şeffaflık = gizle, opaklık =
   göster; "beyaz maske" her şeyi gösterir, "şeffaf maske" her şeyi
   gizler. Veri: layer.mask = { src, w, h } (dataURL PNG; baked ile
   aynı desen) → kayıt/undo/çoğaltma çekirdekten ücretsiz gelir.
   ========================================================= */

/** Maske düzenleme hedefi (yalnızca bir katmandır). */
function inkMaskEditingId() {
  const ink = inkState();
  return ink.maskEditId || null;
}

function inkMaskEditingLayer() {
  const id = inkMaskEditingId();
  return id ? (typeof inkLayerById === 'function' ? inkLayerById(id) : null) : null;
}

/** Maskenin piksel boyutu: katman tuvaliyle birebir (pxW/pxH). */
function inkMaskPixelSize(layer) {
  if (!layer) return null;
  const w = Number(layer.pxW), h = Number(layer.pxH);
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    return { w: Math.round(w), h: Math.round(h) };
  }
  const it = layer.ownerId ? getItem(layer.ownerId) : null;
  if (it && typeof inkPickAttachedBitmapSize === 'function') {
    return inkPickAttachedBitmapSize(it);
  }
  return null;
}

/** Maske CRUD sonrası ortak tazeleme: raster + görünüm + kayıt.
    opts.rerender === false: piksel bakımından etkisiz maske değişimi
    (reveal = tam-beyaz düzlem: destination-in kimlik davranışıdır),
    tam kurulum atlanır — ÖLÇÜM (ink-torture F3.2): maske ekleme
    başına tam kurulum ~300 ms (baza cache LRU'dan düşmüş katmanda
    tüm vuruş re-stamp).
    opts.itemCanvasOp === 'hide': maskesiz düzlem tüm alfa'yı 0'a
    çarpar; tam kurulum yerine item canvas doğrudan clearRect edilir. */
function inkMaskAfterChange(layer, flashId, opts) {
  const kural = (opts && opts.rerender === false) ||
    (opts && opts.itemCanvasOp === 'hide');
  if (kural && inkRuntime && inkRuntime.dirtyLayers && layer) {
    inkRuntime.dirtyLayers.delete(layer.id);
  } else if (inkRuntime && inkRuntime.dirtyLayers && layer) {
    inkRuntime.dirtyLayers.add(layer.id);
  }
  if (kural && layer && opts.itemCanvasOp === 'hide') {
    const canvas = inkRuntime.itemCanvases.get(layer.id);
    if (canvas) {
      const cc = canvas.getContext('2d', { colorSpace: 'srgb' });
      cc.save();
      cc.setTransform(1, 0, 0, 1, 0, 0);
      cc.globalAlpha = 1;
      cc.globalCompositeOperation = 'source-over';
      cc.clearRect(0, 0, canvas.width, canvas.height);
      cc.restore();
    }
  }
  if (!kural && layer && typeof inkRerenderLayer === 'function') {
    inkRerenderLayer(layer.id);
  }
  if (kural && layer && typeof inkBumpLayerGen === 'function') {
    inkBumpLayerGen(layer.id);
  }
  if (kural && typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
  if (typeof inkLayerStoreEmit === 'function') {
    inkLayerStoreEmit('mask', { ownerId: layer.ownerId || null, layerId: layer.id });
  }
  inkDocAfterChange(flashId || layer.id);
}

/** Menü: "Maske ekle" — mode 'reveal' (beyaz, her şeyi göster) veya
 *  'hide' (tamamen şeffaf, her şeyi gizle). Ekleme anında maskenin
 *  çözülmüş tuvali sync prime edilir; görüntü ilk karede doğru olur. */
function inkDocAddMask(layerId, mode) {
  /* Vuruş koruması: maske pushUndo üretir ve maskEditId'yi oynatır —
     vuruşla karışır. */
  if (inkLayerStrokeActive()) return null;
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer || layer.kind !== 'attached') return null;
  if (layer.mask) return layer;
  const size = inkMaskPixelSize(layer);
  if (!size) return null;
  if (typeof pushUndo === 'function') pushUndo();
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (ctx && mode !== 'hide') {
    // reveal: beyaz düzlem → tüm alfa gösterilir. hide: boş (şeffaf)
    // düzlem → alfa 0'a çarpılır, katman görünmez (çizimler saklıdır).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);
  }
  /* A3: boş/beyaz düzlem için tam tuval kodlaması yerine 1×1 sabit
     dataURL — decoder tuval boyutuna gerer (uniform düzlemde birebir). */
  const __encAdd0 = typeof inkPerfSpan === 'function' ? performance.now() : 0;
  layer.mask = {
    src: inkMaskTinyDataUrl(mode === 'hide' ? 'rgba(0,0,0,0)' : '#ffffff'),
    w: size.w, h: size.h,
  };
  if (typeof inkPerfSpan === 'function' && __encAdd0) {
    inkPerfSpan('maskEncode', performance.now() - __encAdd0);
    inkPerfCount('maskEncodeNx', 1);
  }
  if (typeof inkMaskRasterPrime === 'function') {
    inkMaskRasterPrime(layer.id, layer.mask.src, size.w, size.h, canvas);
  }
  inkState().maskEditId = layer.id;
  /* FAZ 6 A5: options bar "MASKE" rozeti bu an yanmalı — sync zarfi
     inkSyncLayersPanel + options bar'ı tazeler (inkMaskAfterChange
     yolunu koşmaz, rozet sonraki senkrona takılıp kalırdı). */
  if (typeof inkSyncUI === 'function') inkSyncUI();
  /* ADD düzlemi piksel-etkisizdir: reveal = destination-in kimlik
     (beyaz ×1), hide = tüm alfa 0 (canvas clear ile aynı sonuç).
     Tam kurulum yalnız maske-commit (bölgesel fark) anında gerekir. */
  inkMaskAfterChange(layer, layer.id, mode === 'hide'
    ? { itemCanvasOp: 'hide' }
    : { rerender: false });
  return layer;
}

/** Menü: "Maske sil" — raster cache düşürülür, tam kurulum maskesiz
 *  tüm çizimlerin görünmesini geri getirir. */
function inkDocRemoveMask(layerId) {
  /* Vuruş koruması: maske silme pushUndo + rerender üretir. */
  if (inkLayerStrokeActive()) return false;
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer || !layer.mask) return false;
  if (typeof pushUndo === 'function') pushUndo();
  layer.mask = null;
  const ink = inkState();
  if (ink.maskEditId === layer.id) ink.maskEditId = null;
  /* FAZ 6 A5: rozet sönmalı — silinen maske o an düzenlemedeyse
     options bar güncellenmelidir (inkMaskAfterChange sync koşmaz). */
  if (typeof inkSyncUI === 'function') inkSyncUI();
  if (inkRuntime && inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
  inkMaskAfterChange(layer, layer.id);
  return true;
}

/** Menü: "Edit mask" — hedef katmanı açar/kapatır. Açılışta
 *  maskenin çözülmüş tuvali editör tuvali olarak hazır olmalı: raster
 *  önbelleğinde çözülmüş hâlini beklemek yeterli (session yüklemesinden
 *  gelmişse ilk Image onload bir karede yetişir). */
function inkDocToggleMaskEdit(layerId) {
  /* Vuruş koruması: maske düzeni vuruşun piksellerini maske düzlemine
     yönlendirir — vuruş ortasında hedef değişmez. */
  if (inkLayerStrokeActive()) return false;
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer || layer.kind !== 'attached' || !layer.mask) return false;
  const ink = inkState();
  if (ink.maskEditId === layer.id) {
    ink.maskEditId = null;
  } else {
    ink.maskEditId = layer.id;
    // Raster yoksa kareyi çözüye uğraşmadan tam kurulumla besle:
    // onload zaten dirtyLayers + rerender tetikler.
    if (typeof inkMaskRasterSource === 'function') inkMaskRasterSource(layer);
  }
  /* FAZ 8.B: panel sync 'mask' aboneliğinden gelir. */
  if (typeof inkSyncUI === 'function') inkSyncUI();
  inkLayerStoreEmit('mask', {
    ownerId: layer.ownerId || null,
    layerId: layer.id,
    edit: inkState().maskEditId === layer.id,
  });
  return true;
}

/** Maske kenarı sınırı: maske olmayan katmanda vuruşları maskeye
 *  yönlendirme (test/playground erişimi için). */
function inkDocMaskPendingFor(layer) {
  return layer && layer.kind === 'attached' && !!layer.mask &&
    inkState().maskEditId === layer.id;
}

/** Seçili katmanı çoğaltır; kopya hemen üstüne gelir. */
function inkDocDuplicateLayer(layerId) {
  /* Vuruş koruması: canlı vuruşta çoğaltma — pushUndo vuruşun undo
     noktasını ezmezi, kopya vuruşun aktif katmanını kaydırırdı. */
  if (inkLayerStrokeActive()) return null;
  const ownerId = inkDocOwnerId();
  const source = typeof inkLayerById === 'function' ? inkLayerById(layerId || inkState().activeLayerId) : null;
  if (!source || source.kind !== 'attached' || source.ownerId !== ownerId) return null;
  const ink = inkState();
  // 0.B.6 öte: çoğaltma undo noktası üretir — Ctrl+Z kopyayı kaldırır.
  if (typeof pushUndo === 'function') pushUndo();
  const copy = inkMakeLayer({
    kind: 'attached',
    ownerId,
    name: inkDocNextName(ownerId),
    visible: source.visible,
    opacity: source.opacity,
    blend: source.blend,
  });
  copy.strokes = (source.strokes || []).map(s => JSON.parse(JSON.stringify(s)));
  /* Üyelik taşınır: kopya kaynağının hemen üstünde ve AYNI klasörde açılır.
     parentId'siz kopya, üye ile başlık arasına girip alt üyeyi klasörden
     düşürürdü (bitişiklik kopması). */
  if (source.parentId) copy.parentId = source.parentId;
  // FAZ 1B: maske de çoğaltılır (baked ile aynı dataURL yolu).
  if (source.mask) {
    copy.mask = { src: source.mask.src, w: source.mask.w, h: source.mask.h };
  }
  ink.layers.splice(ink.layers.indexOf(source) + 1, 0, copy);
  ink.activeLayerId = copy.id;
  ink.selection = [];
  if (typeof inkRerenderAllLayers === 'function') inkRerenderAllLayers();
  inkDocAfterChange(copy.id);
  inkLayerStoreEmit('add', {
    ownerId, layerId: copy.id, duplicatedFrom: source.id,
  });
  return copy;
}

/** FAZ 1: katman tuval + DOM kalıntısını temizle (sil/flatten sonrası).
 *  FAZ 8.D: tüm yaşam-sonu önbelleği tek noktaya devredildi —
 *  itemCanvases, tiles, dirty-setler, baked/maske raster, thumb, gen. */
function inkDocDropLayerDom(layer) {
  if (!layer) return;
  if (typeof inkLayerDispose === 'function') {
    inkLayerDispose(layer.id);
    return;
  }
  const canvas = inkRuntime && inkRuntime.itemCanvases
    ? inkRuntime.itemCanvases.get(layer.id) : null;
  if (canvas) {
    canvas.remove();
    inkRuntime.itemCanvases.delete(layer.id);
  }
  if (inkRuntime && inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
}

/** Seçili katmanı bir alttakiyle birleştirir.
 *  FAZ 1 (piksel-gerçek): vuruş birleştirme YERİNE kaynak tuvalin
 *  birebir rasterı, alt katman tuvalinin üzerine kaynak opaklığı +
 *  blend'i ile basılır ve sonuç alt katmana pişirilir (baked). Rebuild
 *  pişmiş görüntüyü önce basar; alt katmana gelen yeni vuruşlar üstüne
 *  normal akışla eklenir. Klasör düzlemine birleştirme ve klip zinciri
 *  tabanı üzerinden birleştirme reddedilir (53'teki çekirdek kuralları). */
function inkDocMergeDownLayer(layerId) {
  /* Vuruş koruması: canlı vuruşta birleştirme — vuruşun kaynağı katman
     bake edilip DOM'dan düşer; vuruş boş katmana düşer. */
  if (inkLayerStrokeActive()) return false;
  const ownerId = inkDocOwnerId();
  const stack = inkDocLayers(ownerId);
  const source = typeof inkLayerById === 'function' ? inkLayerById(layerId || inkState().activeLayerId) : null;
  if (!source || source.kind !== 'attached' || source.ownerId !== ownerId) return false;
  const idx = stack.indexOf(source);
  if (idx <= 0) {
    if (typeof showProjectNotice === 'function') showProjectNotice('No layer below to merge into', 2400);
    return false;
  }
  const below = stack[idx - 1];
  if (below.locked) {
    if (typeof showProjectNotice === 'function') showProjectNotice('Layer below is locked', 2400);
    return false;
  }
  if (below.kind !== 'attached') {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('Folder cannot merge into the plane — flatten the folder', 2400);
    }
    return false;
  }
  // Tuvaller güncel olsun: bekleyen kurulumları şimdi yinee kur.
  if (typeof inkRerenderLayer === 'function') {
    inkRerenderLayer(below.id);
    inkRerenderLayer(source.id);
  }
  const bakedData = typeof inkCompositeMergeDownPixels === 'function'
    ? inkCompositeMergeDownPixels(source, below) : null;
  if (!bakedData) {
    if (typeof showProjectNotice === 'function') showProjectNotice('Could not merge', 2400);
    return false;
  }
  if (typeof pushUndo === 'function') pushUndo();
  const ink = inkState();
  below.baked = { src: bakedData.src, w: bakedData.w, h: bakedData.h };
  // Bake aynı karede sync önbelleğe koy: rebuild bir kare boş kalmasın.
  if (typeof inkBakedRasterPrime === 'function' && bakedData.canvas) {
    inkBakedRasterPrime(below.id, bakedData.src, bakedData.w, bakedData.h, bakedData.canvas);
  }
  below.strokes = [];
  // Pişmiş raster alfa-kilit / kırpma taşımadan yeni bir piksel düzlemdir.
  below.alphaLock = false;
  below.clip = false;
  if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(below.id, 'mutation');
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(below.id);
  inkDocDropLayerDom(source);
  ink.layers.splice(ink.layers.indexOf(source), 1);
  ink.activeLayerId = below.id;
  ink.selection = [];
  if (typeof inkRerenderAllLayers === 'function') inkRerenderAllLayers();
  inkDocAfterChange(below.id);
  inkLayerStoreEmit('remove', {
    ownerId, layerId: source.id, mergedInto: below.id,
  });
  inkLayerStoreEmit('property', { ownerId, layerId: below.id, field: 'raster' });
  return true;
}

/** Katmanı siler; son katman korunur, seçim üstteki (yoksa alttaki) katmana geçer.
 *  FAZ 1 (gruplar): klasör düzlemi de silinebilir — üyeler korunur,
 *  `parentId` bağları koparılır ve sıradan çizim katmanı olurlar. */
function inkDocDeleteLayer(layerId) {
  /* Vuruş koruması: canlı vuruşta katman/klasör silme — vuruşun katmanı
     dispose edilir, vuruş yok olur. */
  if (inkLayerStrokeActive()) return false;
  const ownerId = inkDocOwnerId();
  const target = typeof inkLayerById === 'function' ? inkLayerById(layerId || inkState().activeLayerId) : null;
  if (!target || target.ownerId !== ownerId ||
      (target.kind !== 'attached' && target.kind !== 'group')) return false;
  const stack = inkDocLayers(ownerId);
  const idx = stack.indexOf(target);
  if (idx < 0) return false;
  // En az bir ÇİZİM katmanı kalmalı (klasör sayılmaz — pikselsizdir).
  if (target.kind === 'attached' && inkLayersForOwner(ownerId).length <= INK_DOC_LAYER_MIN) {
    if (typeof showProjectNotice === 'function') showProjectNotice('At least one layer is required', 2400);
    return false;
  }

  if (typeof pushUndo === 'function') pushUndo();
  const ink = inkState();
  // Klasör: üyelerin bağlarını kopar (üyesi silmenin yolu birebir silmek).
  if (target.kind === 'group') {
    const stackAll = inkOwnerStackLayers(ownerId);
    for (const layer of stackAll) {
      if (layer.kind === 'attached' && layer.parentId === target.id) {
        layer.parentId = null;
        if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
      }
    }
    if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(target.id);
  }
  // FAZ 8.D: yığından çıkan katmanın tüm çalışma-zamanı önbelleği
  // (tuval + baked/maske raster + thumb + gen) dispose tek noktadan bırakılır.
  if (typeof inkLayerDispose === 'function') inkLayerDispose(target.id);
  ink.layers.splice(ink.layers.indexOf(target), 1);
  ink.selection = [];
  // Silme sonrası klip değişmezi: en alttaki çizim katmanı klip üyesi
  // kalmamalı — plan onu düz katman olarak işler ama bayrak bayat kalır;
  // sonradan altına katman eklenince kırpma sessizce yeniden aktifleşirdi.
  const kalanYigin = inkOwnerStackLayers(ownerId);
  for (const kalan of kalanYigin) {
    if (kalan.kind === 'group') continue;
    if (kalan.clip) {
      kalan.clip = false;
      if (typeof inkLayerStoreEmit === 'function') {
        inkLayerStoreEmit('property', { ownerId, layerId: kalan.id, field: 'clip' });
      }
    }
    break;
  }
  // FAZ 1B: silinen katman maske düzenleme hedefiyse mod kapatılır.
  if (ink.maskEditId === target.id) ink.maskEditId = null;

  // Seçim: görsel olarak üstteki katman (dizide +1), yoksa alttaki.
  const next = stack[idx + 1] || stack[idx - 1] || null;
  ink.activeLayerId = next ? next.id : null;
  /* Silme performansı (kullanıcı raporu: "katman silince aşırı kasma"):
     kalan katmanların rasterı DEĞİŞMEZ — silinen katmanın tuvalleri
     inkLayerDispose ile DOM'dan zaten bırakıldı. Tüm vuruşları sıfırdan
     yeniden oynatan inkRerenderAllLayers burada gereksiz ağır bir işti
     (vuruş sayısı arttıkça saniyelerce sürüyordu). Yalnız DOM/z-index/
     opaklık gecikmesini tazeleyen inkSyncDom yeter. */
  if (typeof inkSyncDom === 'function') inkSyncDom();
  inkDocAfterChange(next ? next.id : null);
  inkLayerStoreEmit('remove', {
    ownerId, layerId: target.id, kind: target.kind,
    nextLayerId: next ? next.id : null,
  });
  return true;
}

/* Sil düğmelerinin TEK kapısı (kullanıcı isteği: "son 1 katman
   kaldıysa ve Sil'e basıldıysa içindeki çizim silinmeli"): silinbilen
   katmanı siler; silinemeyen son çizim katmanından aktifse İÇERİĞİNİ
   temizler. Grup/boş/kilitli kuralları alttaki işlevlerde aynen korunur. */
function inkDocDeleteOrClearLayer(layerId) {
  /* Vuruş koruması: canlı vuruş varken katman silme/temizleme — katman
     panelindeki buton yolu Delete tuşu korumasını BYPASS ediyordu.
     Kalem çizerken avuç silme butonuna değerse vuruş + katman birlikte
     gidiyordu. Motor kapısı burası: bütün çağıranlar kaplanır. */
  if (inkLayerStrokeActive()) return false;
  const ownerId = inkDocOwnerId();
  const target = typeof inkLayerById === 'function'
    ? inkLayerById(layerId || (typeof inkState === 'function' ? inkState().activeLayerId : null)) : null;
  if (!target) {
    // Aktif katman yok: silme işlemi kendi uyarısı verir.
    return inkDocDeleteLayer(layerId);
  }
  const count = typeof inkLayersForOwner === 'function'
    ? inkLayersForOwner(ownerId).length : inkDocLayers(ownerId).length;
  const blocked = target.kind === 'attached' && count <= INK_DOC_LAYER_MIN;
  if (!blocked) return inkDocDeleteLayer(target.id);
  // Silinemiyor → içeriğini temizle; boşsa bilgilendir.
  const empty = !Array.isArray(target.strokes) || target.strokes.length === 0;
  const cleared = (typeof inkDocClearLayer === 'function') ? inkDocClearLayer(target.id) : false;
  if (!cleared && empty && typeof showProjectNotice === 'function') {
    showProjectNotice(window.__t('Layer is already empty'), 2200);
  }
  return cleared;
}


/** K2 · "Clear Contents": katmanın piksel düzlemini RGBA(0,0,0,0)'a döndürür.
 *  "Delete" komutundan KESİNLİKLE ayrıdır: düğüm (ad/karışım/opaklık/kilit) ve
 *  maske düzlemi aynen korunur; yalnızca vuruşlar boşaltılır. Undo:pushUndo
 *  anlık görüntü zinciriyle çalışır; paint epoch bump worker bitmap'ini
 *  bayatlar. Kilitli katmanda çalışmaz (menü girdisi de devre dışı). */
function inkDocClearLayer(layerId) {
  const ownerId = inkDocOwnerId();
  const layer = typeof inkLayerById === 'function'
    ? inkLayerById(layerId || inkState().activeLayerId) : null;
  if (!layer || layer.ownerId !== ownerId || layer.kind !== 'attached') return false;
  if (layer.locked) {
    if (typeof showProjectNotice === 'function') showProjectNotice(window.__t('Layer is locked'), 2000);
    return false;
  }
  const count = Array.isArray(layer.strokes) ? layer.strokes.length : 0;
  if (!count) return false; // düzlem zaten saydam — işlem yok
  if (typeof pushUndo === 'function') pushUndo();
  const ink = inkState();
  layer.strokes = [];
  /* Görsel gerçek (kullanıcı raporu: "Sil diyorum ama çizimleri
     silmiyor"): temizlik yalnız vuruş listesini boşaltıyordu; katman
     rasterı dirty işareti bekledikçe ESKİ GÖRÜNTÜYÜ bırakıyordu.
     Tam düzlem dirty işareti → sync oynatım katmanı sıfırdan
     çizerek rasterı saydam hâle getirir. */
  if (typeof inkMarkLayerDirty === 'function') inkMarkLayerDirty(layer.id, null, true);
  // Temizlenen katmanın vuruş seçimi artık orphan kalmasın.
  ink.selection = [];
  if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'mutation');
  inkDocAfterChange(layer.id);
  inkLayerStoreEmit('property', { ownerId, layerId: layer.id, field: 'clear' });
  return true;
}

/** Görsel sırada yukarı/aşağı taşır. dir: +1 yukarı, -1 aşağı.
 *  FAZ 1 (gruplar): klasör düzlemi de taşınır. Üyelik (parentId) taşımayla
 *  DEĞİŞMEZ; üye başlığın üstüne kayarsa kompozitör onu `bound` ile klasörüne
 *  bağlar (53-ink-compositor) — panel ile kompozitör asla ayrışmaz. */
function inkDocMoveLayer(layerId, dir) {
  /* Vuruş koruması: canlı vuruşta sıralama değişimi — pushUndo vuruşla
     karışır, z-index değişimi vuruşun göründüğü yeri oynatır. */
  if (inkLayerStrokeActive()) return false;
  const ownerId = inkDocOwnerId();
  const stack = inkDocLayers(ownerId);
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId || inkState().activeLayerId) : null;
  if (!layer || layer.ownerId !== ownerId ||
      (layer.kind !== 'attached' && layer.kind !== 'group')) return false;
  const idx = stack.indexOf(layer);
  const next = idx + (dir > 0 ? 1 : -1);
  if (next < 0 || next >= stack.length) return false;
  if (typeof pushUndo === 'function') pushUndo();
  const ink = inkState();
  const reordered = stack.slice();
  reordered.splice(idx, 1);
  reordered.splice(next, 0, layer);
  inkDocApplyOrder(ownerId, reordered);
  /* Üyelik bitişikliği taşımayla bozulursa kompozitör plan düzeyinde çözer:
     bitişik olmayan üye `bound` ile klasörüne bağlanır (53-ink-compositor).
     Burada parentId'e dokunmak YASAK — konum değişimi üyeliği değiştirmez,
     aksi hâlde restore-undo fazladan property olayı üretirdi (0.B.5 öte). */
  inkDocAfterChange(layer.id);
  inkLayerStoreEmit('reorder', { ownerId, layerId: layer.id });
  return true;
}

/** Sürükle-bırak sıralaması: hedef görsel satır indeksi (0 = en üst).
 *  Satırlar karışık yığındır (klasörler dahil). */
function inkDocReorderLayer(layerId, rowIndex) {
  /* Vuruş koruması: sürükle-bırak sıralama vuruşla karışır. */
  if (inkLayerStrokeActive()) return false;
  const ownerId = inkDocOwnerId();
  const stack = inkDocLayers(ownerId);
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer || layer.ownerId !== ownerId ||
      (layer.kind !== 'attached' && layer.kind !== 'group')) return false;
  const rows = stack.slice().reverse().filter(l => l.id !== layer.id);
  const slot = Math.max(0, Math.min(rows.length, rowIndex));
  rows.splice(slot, 0, layer);
  if (typeof pushUndo === 'function') pushUndo();
  inkDocApplyOrder(ownerId, rows.reverse());
  /* Bkz. inkDocMoveLayer notu: üyelik taşımayla değişmez; bitişiklik
     kompozitör planında `bound` ile çözülür. */
  inkDocAfterChange(layer.id);
  inkLayerStoreEmit('reorder', { ownerId, layerId: layer.id });
  return true;
}

/** Yeni alttan-üste sırayı `ink.layers` içindeki belge yuvalarına yazar.
 *  Yuvalar karışık yığındır: attached + group (aynı owner). */
function inkDocApplyOrder(ownerId, bottomToTop) {
  const ink = inkState();
  const slots = [];
  ink.layers.forEach((layer, index) => {
    if ((layer.kind === 'attached' || layer.kind === 'group') &&
        layer.ownerId === ownerId) slots.push(index);
  });
  slots.forEach((slot, i) => {
    if (bottomToTop[i]) ink.layers[slot] = bottomToTop[i];
  });
}

/* =========================================================
   FAZ 1 (gruplar): klasör düzlemi işlemleri
   ========================================================= */
/** "Yeni grup": görselin yığın tepesinde boş klasör düzlemi açar ve seçer. */
function inkDocNewGroup() {
  /* Vuruş koruması: klasör açma pushUndo üretir — vuruşla karışır. */
  if (inkLayerStrokeActive()) return null;
  const ownerId = inkDocOwnerId();
  if (!ownerId) return null;
  // 0.B.6 öte: klasör oluşturma undo noktası üretir — Ctrl+Z klasörü kaldırır.
  if (typeof pushUndo === 'function') pushUndo();
  const group = typeof inkCreateGroup === 'function' ? inkCreateGroup(ownerId) : null;
  if (!group) {
    if (typeof showProjectNotice === 'function') showProjectNotice('Could not create the group', 2400);
    return null;
  }
  inkDocAfterChange(group.id);
  inkLayerStoreEmit('add', { ownerId, layerId: group.id, kind: 'group' });
  return group;
}

/** "Gruba ekle": seçili çizim katmanını en yakın üstteki klasöre üye yapar;
 *  üstte klasör yoksa yığındaki en üst klasöre taşınır. */
function inkDocAddToGroup(layerId) {
  /* Vuruş koruması: üye taşıma pushUndo üretir — vuruşla karışır. */
  if (inkLayerStrokeActive()) return null;
  const ownerId = inkDocOwnerId();
  const layer = typeof inkLayerById === 'function'
    ? inkLayerById(layerId || inkState().activeLayerId)
    : null;
  if (!layer || layer.kind !== 'attached' || layer.ownerId !== ownerId) return null;
  const stack = inkDocLayers(ownerId);
  const idx = stack.indexOf(layer);
  let group = null;
  // Klasör girişi üyelerinin ÜSTÜNDE durur: iletişim noktası hemen üstü.
  for (let i = idx + 1; i < stack.length; i++) {
    if (stack[i].kind === 'group') { group = stack[i]; break; }
  }
  if (!group) {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind === 'group') { group = stack[i]; break; }
    }
  }
  if (!group) return null;
  // 0.B.6 öte: gruba üye taşıma undo noktası üretir — Ctrl+Z üyeliği geri alır.
  if (typeof pushUndo === 'function') pushUndo();
  const added = typeof inkAddGroupMember === 'function'
    ? inkAddGroupMember(ownerId, group.id, layer)
    : null;
  if (added) {
    inkDocAfterChange(added.id);
    inkLayerStoreEmit('reorder', { ownerId, layerId: added.id });
  }
  return added || null;
}

/** "Remove from group": seçili çizim katmanının `parentId` bağını koparır;
 *  katman dizideki yerinde sıradan katman olarak kalır. */
function inkDocRemoveFromGroup(layerId) {
  /* Vuruş koruması: gruptan çıkarma pushUndo üretir (inkRemoveGroupMember)
     — vuruşla karışır. */
  if (inkLayerStrokeActive()) return null;
  const ownerId = inkDocOwnerId();
  const layer = typeof inkLayerById === 'function'
    ? inkLayerById(layerId || inkState().activeLayerId)
    : null;
  if (!layer || layer.kind !== 'attached' || layer.ownerId !== ownerId) return null;
  const freed = typeof inkRemoveGroupMember === 'function'
    ? inkRemoveGroupMember(layer.id)
    : null;
  if (freed) {
    inkDocAfterChange(freed.id);
    inkLayerStoreEmit('reorder', { ownerId, layerId: freed.id });
  }
  return freed || null;
}

/** FAZ 1 (piksel-gerçek flatten): klasör düzlemini ve bitişik üyelerini
 *  tek bir pişmiş katmana indirger. Klasörün opaklık/blend/görünürlüğü
 *  YENİ katmana taşınır (pixels'e pişmez — ekranda aynı sonucu verir);
 *  üyelerin kendi opaklık/blend'i rasterda pişmiş olur (grup rasterı
 *  kuralları). Geri al: tam snapshot (pushUndo) üzerinden. */
function inkDocFlattenGroup(layerId) {
  /* Vuruş koruması: flatten üye katmanları bake edip düşürür — canlı
     vuruşun katmanı yok olurdu. */
  if (inkLayerStrokeActive()) return false;
  const ownerId = inkDocOwnerId();
  const group = typeof inkLayerById === 'function' ? inkLayerById(layerId || inkState().activeLayerId) : null;
  if (!group || group.kind !== 'group' || group.ownerId !== ownerId) return false;
  const stack = inkDocLayers(ownerId);
  const gi = stack.indexOf(group);
  if (gi < 0) return false;
  const members = inkLayersForOwner(ownerId).filter(l => l.parentId === group.id);

  // Üye tuvalleri güncel olsun: bekleyen kurulumları şimdi yinee kur
  // (rebuild gen patlatır → grup raster önbelleği otomatik bozulur).
  if (typeof inkRerenderLayer === 'function') {
    for (const member of members) {
      if (inkRuntime && inkRuntime.dirtyLayers && inkRuntime.dirtyLayers.has(member.id)) {
        inkRerenderLayer(member.id);
      }
    }
  }
  const plan = typeof inkAttachedDisplayPlan === 'function' ? inkAttachedDisplayPlan(ownerId) : null;
  const entry = plan ? plan.find(e => e.base && e.base.id === group.id) : null;
  if (!entry) return false;
  // Yalnızca gezginin toplayabildiği Bitişik üyeler düzleştirilir; orhana
  // (kırık bitişiklik) kalan üyeler piksel kaybına açar — reddet.
  const entryMembers = (entry.members || []).map(l => l.id);
  if (members.length !== entryMembers.length) {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('Folder members mixed on the plane — move/align first', 2400);
    }
    return false;
  }
  const raster = (entry.members && entry.members.length)
    ? inkCompositeEntryCanvas(entry, null)
    : null;
  if (entry.members && entry.members.length && (!raster || !raster.width || !raster.height)) {
    if (typeof showProjectNotice === 'function') showProjectNotice('Could not flatten', 2400);
    return false;
  }

  if (typeof pushUndo === 'function') pushUndo();
  const ink = inkState();
  const replacement = inkMakeLayer({
    kind: 'attached',
    ownerId,
    name: group.name,
    visible: group.visible,
    opacity: group.opacity,
    blend: group.blend,
    pxW: group.pxW || (raster ? raster.width : 0),
    pxH: group.pxH || (raster ? raster.height : 0),
  });
  if (raster) {
    replacement.baked = {
      src: raster.toDataURL('image/png'),
      w: raster.width,
      h: raster.height,
    };
    if (typeof inkBakedRasterPrime === 'function') {
      inkBakedRasterPrime(replacement.id, replacement.baked.src,
        replacement.baked.w, replacement.baked.h, raster);
    }
  }
  // Aynı dize konumuna koy: klasörün üstüne, üyelerin çıkarılmasından önce.
  ink.layers.splice(ink.layers.indexOf(group), 0, replacement);
  // Üyeleri + klasörü kaldır (tuval kalıntılarıyla).
  for (const member of members) {
    inkDocDropLayerDom(member);
    ink.layers.splice(ink.layers.indexOf(member), 1);
  }
  inkDocDropLayerDom(group);
  ink.layers.splice(ink.layers.indexOf(group), 1);
  // FAZ 8.D: ölü grup id'sine gen girisi yaratmamak için bump kaldırıldı
  // (dispose grup raster/plan önbelleğini zaten bıraktı).
  ink.activeLayerId = replacement.id;
  ink.selection = [];
  if (typeof inkRerenderAllLayers === 'function') inkRerenderAllLayers();
  inkDocAfterChange(replacement.id);
  inkLayerStoreEmit('remove', {
    ownerId, layerId: group.id, kind: 'group',
    members: members.map(m => m.id), replacedBy: replacement.id,
  });
  inkLayerStoreEmit('add', {
    ownerId, layerId: replacement.id, kind: 'attached', flattenedFrom: group.id,
  });
  return true;
}

/** Satır içi yeniden adlandırma. */
function inkDocRenameLayer(layerId, name) {
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer || layer.kind !== 'attached') return false;
  const next = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 64);
  if (!next || next === layer.name) return false;
  if (typeof pushUndo === 'function') pushUndo();
  layer.name = next;
  if (typeof scheduleSave === 'function') scheduleSave();
  inkLayerStoreEmit('rename', { ownerId: layer.ownerId || null, layerId: layer.id, name: next });
  return true;
}

function inkDocSetVisible(layerId, visible) {
  /* Vuruş koruması: canlı vuruşta göz kapatma — pushUndo vuruşla
     iç içe giriyor ve katman gözden kaçıp körüne çiziliyordu. */
  if (inkLayerStrokeActive()) return false;
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer) return false;
  const next = visible !== false;
  if (layer.visible === next) return false;
  if (typeof pushUndo === 'function') pushUndo();
  layer.visible = next;
  if (typeof inkLayerRefreshPreview === 'function') inkLayerRefreshPreview();
  else if (typeof inkSyncDom === 'function') inkSyncDom();
  if (typeof scheduleSave === 'function') scheduleSave();
  inkLayerStoreEmit('property', {
    ownerId: layer.ownerId || null, layerId: layer.id,
    field: 'visible', value: next,
  });
  return true;
}

function inkDocHideAll(ownerId) {
  if (inkLayerStrokeActive()) return false; /* vuruş koruması */
  const stack = inkDocLayers(ownerId);
  if (!stack.length) return false;
  if (typeof pushUndo === 'function') pushUndo();
  for (const layer of stack) layer.visible = false;
  if (typeof inkLayerRefreshPreview === 'function') inkLayerRefreshPreview();
  else if (typeof inkSyncDom === 'function') inkSyncDom();
  if (typeof scheduleSave === 'function') scheduleSave();
  inkLayerStoreEmit('property', { ownerId, field: 'visible', value: false, all: true });
  return true;
}

function inkDocResetOpacity(layerId) {
  /* Vuruş koruması: pushUndo üretir — vuruşla karışır. */
  if (inkLayerStrokeActive()) return false;
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer || layer.opacity === 1) return false;
  if (typeof pushUndo === 'function') pushUndo();
  layer.opacity = 1;
  if (typeof inkLayerRefreshPreview === 'function') inkLayerRefreshPreview();
  else if (typeof inkSyncDom === 'function') inkSyncDom();
  if (typeof scheduleSave === 'function') scheduleSave();
  inkLayerStoreEmit('property', {
    ownerId: layer.ownerId || null, layerId: layer.id, field: 'opacity', value: 1,
  });
  return true;
}

/** Seçili (veya verilen) katman çizim alabilir mi?
 *  FAZ 1 (gruplar): klasör düzlemi pikselsizdir — çizim hedefi olamaz. */
function inkDocCanPaint(layer) {
  const target = layer || inkDocSelectedLayer();
  return !!(target && target.kind === 'attached' && target.visible && !target.locked);
}

/* =========================================================
   panel başlığı ve üst satır
   ========================================================= */
function inkLayerPanelEnhance() {
  const panel = document.getElementById('inkLayersPanel');
  const list = document.getElementById('inkLayerList');
  if (!panel || !list) return;
  inkLayerPanelStoreSubscribe();

  // Başlıkta "⋯" menüsü (+ düğmesinin yanında).
  const head = panel.querySelector('.psPanelHead');
  if (head && !head.querySelector('.dpLayerMenuBtn')) {
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'dpPanelMenu dpLayerMenuBtn';
    menuBtn.title = __t('Layer menu');
    menuBtn.setAttribute('aria-label', __t('Layer menu'));
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.innerHTML = '<span aria-hidden="true">⋯</span>';
    menuBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      inkLayerMenuToggle(menuBtn);
    });
    const chevron = head.querySelector('.psChevron');
    if (chevron) head.insertBefore(menuBtn, chevron);
    else head.appendChild(menuBtn);
  }

  // Üst satır: karışım seçici + opaklık.
  const props = document.getElementById('inkLayerProps');
  const opacity = document.getElementById('inkLayerOpacity');
  const opacityVal = document.getElementById('inkLayerOpacityVal');
  const blend = document.getElementById('inkLayerBlend');
  if (props && opacity && blend && !props.querySelector('.dpLayerTopRow')) {
    const row = document.createElement('div');
    row.className = 'dpLayerTopRow';
    const opacityWrap = document.createElement('span');
    opacityWrap.className = 'dpLayerOpacity';
    const blendWrap = document.createElement('span');
    blendWrap.className = 'dpLayerBlend';
    blendWrap.appendChild(blend);
    opacityWrap.append(opacity, opacityVal || document.createTextNode(''));
    row.append(blendWrap, opacityWrap);
    props.appendChild(row);
    // Eski iki satır gizlenir, tek satır kalır.
    for (const old of props.querySelectorAll('.inkSliderRow, .inkSelectRow')) old.hidden = true;
  }

  inkLayerBindList(list);
}

/* FAZ 8.B — panel, store aboneliğiyle beslenir (bir kez bağlanır).
   Mutasyon olayları panel tazelemesini taşır: 50-layer-stack.js
   mutasyonlarında kalan elle inkSyncLayersPanel çağrısı bu noktadan
   sonra gereksizdir (8.B temizliğinde kaldırıldı). Satır-düzeyi diff
   İÇİNDE bu aboneliye koşar (8.C). */
function inkLayerPanelStoreSubscribe() {
  if (inkLayerPanelStoreSubscribe.done) return;
  inkLayerPanelStoreSubscribe.done = true;
  const sync = () => {
    if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
  };
  for (const type of ['add', 'remove', 'reorder', 'rename',
    'property', 'mask', 'select']) {
    inkLayerStoreOn(type, sync);
  }
}

/* =========================================================
   menü
   ========================================================= */
function inkLayerMenu() {
  let menu = document.getElementById('dpLayerMenu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'dpLayerMenu';
  menu.className = 'dpLayerMenu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', __t('Layer actions'));
  document.body.appendChild(menu);
  menu.addEventListener('click', event => {
    const btn = event.target && event.target.closest('[data-layer-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.layerAction;
    inkLayerMenuClose();
    const layerId = menu.dataset.layerId || inkState().activeLayerId;
    if (action === 'add') inkDocAddLayer();
    else if (action === 'duplicate') inkDocDuplicateLayer(layerId);
    else if (action === 'clear-content') inkDocClearLayer(layerId);
    else if (action === 'props') inkLayerPropsOpen(layerId);
    else if (action === 'merge') inkDocMergeDownLayer(layerId);
    else if (action === 'flatten') inkDocFlattenGroup(layerId);
    else if (action === 'new-group') inkDocNewGroup();
    else if (action === 'add-to-group') inkDocAddToGroup(layerId);
    else if (action === 'remove-from-group') inkDocRemoveFromGroup(layerId);
    else if (action === 'delete') inkDocDeleteLayer(layerId);
    else if (action === 'up') inkDocMoveLayer(layerId, 1);
    else if (action === 'down') inkDocMoveLayer(layerId, -1);
    else if (action === 'hide-all') inkDocHideAll();
    else if (action === 'reset-opacity') inkDocResetOpacity(layerId);
    else if (action === 'mask-add') inkDocAddMask(layerId, btn.dataset.maskMode || 'reveal');
    else if (action === 'mask-edit') inkDocToggleMaskEdit(layerId);
    else if (action === 'mask-remove') inkDocRemoveMask(layerId);
  });
  return menu;
}

function inkLayerMenuToggle(anchor) {
  const menu = inkLayerMenu();
  if (!menu.hidden) { inkLayerMenuClose(); return; }
  inkLayerMenuOpen(anchor, null);
}

function inkLayerMenuOpen(anchor, layerId, at) {
  const menu = inkLayerMenu();
  const stack = inkDocLayers();
  const layer = layerId
    ? (typeof inkLayerById === 'function' ? inkLayerById(layerId) : null)
    : inkDocSelectedLayer();
  menu.dataset.layerId = layer ? layer.id : '';
  const idx = layer ? stack.indexOf(layer) : -1;
  const isAttached = !!layer && layer.kind === 'attached';
  const isGroup = !!layer && layer.kind === 'group';
  const hasGroups = inkDocGroups().length > 0;
  const entries = [
    ['add', 'New layer', 'Shift+N', true],
    ['duplicate', 'Duplicate', 'Ctrl+J', isAttached],
    ['merge', 'Merge', '', !!(isAttached && idx > 0 && stack[idx - 1].kind === 'attached')],
    ['flatten', 'Flatten folder', '', isGroup],
    ['new-group', 'New group', '', true],
    ['add-to-group', 'Add to group', '', !!(isAttached && !layer.parentId && hasGroups)],
    ['remove-from-group', 'Remove from group', '', !!(isAttached && !!layer.parentId)],
    ['up', 'Move up', 'Ctrl+]', !!(layer && idx < stack.length - 1)],
    ['down', 'Move down', 'Ctrl+[', !!(layer && idx > 0)],
    ['hide-all', 'Hide all', '', true],
    ['reset-opacity', 'Reset opacity', '', !!layer],
    ['mask-add', 'Add mask (show)', '', !!(isAttached && !layer.mask)],
    ['mask-add', 'Add mask (hide)', '', !!(isAttached && !layer.mask)],
    ['mask-edit', 'Edit mask', '', !!(isAttached && !!layer.mask)],
    ['mask-remove', 'Delete mask', '', !!(isAttached && !!layer.mask)],
    ['clear-content', 'Clear Contents', '', !!(isAttached && !layer.locked &&
      Array.isArray(layer.strokes) && layer.strokes.length > 0)],
    ['props', 'Properties…', '', !!layer],
    ['delete', 'Delete', 'Delete', stack.length > 0],
  ];
  // FAZ 1B: iki "mask-add" girdisi tek aksiyondur; ikincisi hide modu.
  let maskAddSeen = false;
  menu.replaceChildren();
  for (const [action, label, key, enabled] of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.layerAction = action;
    if (action === 'mask-add') {
      btn.dataset.maskMode = maskAddSeen ? 'hide' : 'reveal';
      maskAddSeen = true;
    }
    btn.disabled = !enabled;
    if (action === 'duplicate' && isGroup) btn.title = __t('Folder cannot be duplicated');
    if (action === 'merge' && isGroup) btn.title = __t('Folder cannot be merged');
    if (action === 'add-to-group' && !hasGroups && isAttached) btn.title = __t('Create a group first');
    if (action === 'delete' && stack.length <= 1) btn.title = __t('At least one layer is required');
    if (action === 'mask-edit') {
      btn.title = (inkState().maskEditId === layer.id) ? __t('Leave mask editing') : __t('Write mask strokes into the mask');
    }
    const text = document.createElement('span');
    text.textContent = label;
    btn.appendChild(text);
    if (key) {
      const k = document.createElement('span');
      k.className = 'dpLayerMenuKey';
      k.textContent = key;
      btn.appendChild(k);
    }
    if (action === 'delete') btn.classList.add('is-danger');
    menu.appendChild(btn);
  }
  menu.hidden = false;
  const width = menu.offsetWidth || 176;
  const height = menu.offsetHeight || 220;
  /* K10 · konum: sağ tıkta imlecin köşesinden; düğme gibi bir anchor
     verilirse satırın altından. Kenarlar pencereye sıkıştırılır —
     sol kenar klampesinin menüyü ekran boyunca fırlatması engellendi. */
  let left;
  let top;
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
    left = Math.round(at.x + 2);
    top = Math.round(at.y + 2);
  } else {
    const rect = anchor.getBoundingClientRect();
    left = Math.round(rect.right - width);
    top = Math.round(rect.bottom + 6);
  }
  left = Math.min(Math.max(left, 8), Math.max(8, innerWidth - width - 8));
  if (top + height > innerHeight - 8) {
    /* Yukarı flip: imleçle (contextmenu) açılıyorsa menünün ALT kenarı
       imlecin bandına yapışmalı (K10 — aksi hâlde imleç menünün 6px altında
       kalıp "panel imleçten kopuk" hissi veriyordu); düğme anchor'ında
       düğmenin görünür kalması için 6px boşluk korunur. */
    if (at && Number.isFinite(at.y)) {
      top = Math.max(8, Math.round(at.y - height + 2));
    } else {
      top = Math.max(8, Math.round(anchor.getBoundingClientRect().top - height - 6));
    }
  }
  top = Math.min(Math.max(top, 8), Math.max(8, innerHeight - height - 8));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  setTimeout(() => document.addEventListener('pointerdown', inkLayerMenuOutside, true), 0);
}

/** Menü açıksa öğelerin etkinliğini tazeler (sil/taşı durumları). */
function inkLayerMenuRefresh() {
  const menu = document.getElementById('dpLayerMenu');
  if (!menu || menu.hidden) return;
  const stack = inkDocLayers();
  const layer = menu.dataset.layerId
    ? (typeof inkLayerById === 'function' ? inkLayerById(menu.dataset.layerId) : null)
    : inkDocSelectedLayer();
  const idx = layer ? stack.indexOf(layer) : -1;
  const state = {
    duplicate: !!layer && layer.kind === 'attached',
    merge: !!(layer && layer.kind === 'attached' && idx > 0 &&
      stack[idx - 1] && stack[idx - 1].kind === 'attached'),
    flatten: !!layer && layer.kind === 'group',
    'new-group': true,
    'add-to-group': !!(layer && layer.kind === 'attached' && !layer.parentId &&
      inkDocGroups().length > 0),
    'remove-from-group': !!(layer && layer.kind === 'attached' && !!layer.parentId),
    up: !!(layer && idx < stack.length - 1),
    down: !!(layer && idx > 0),
    'reset-opacity': !!layer,
    delete: stack.length > 0,
  };
  // FAZ 1B: maske girdileri — sadece gövde (görünür) katmanlarda.
  const isAttachedNow = !!layer && layer.kind === 'attached';
  state['mask-add'] = !!(isAttachedNow && !layer.mask);
  state['mask-edit'] = !!(isAttachedNow && !!layer.mask);
  state['mask-remove'] = state['mask-edit'];
  for (const btn of menu.querySelectorAll('[data-layer-action]')) {
    const key = btn.dataset.layerAction;
    if (key in state) btn.disabled = !state[key];
    if (key === 'delete') btn.title = stack.length > 0 ? '' : __t('At least one layer is required');
  }
}

function inkLayerMenuOutside(event) {  const menu = document.getElementById('dpLayerMenu');
  if (!menu || menu.hidden) return;
  const target = event.target;
  if (target && (target.closest('#dpLayerMenu') || target.closest('.dpLayerMenuBtn'))) return;
  inkLayerMenuClose();
}

function inkLayerMenuClose() {
  const menu = document.getElementById('dpLayerMenu');
  if (!menu) return;
  menu.hidden = true;
  document.removeEventListener('pointerdown', inkLayerMenuOutside, true);
}

/* =========================================================
   FAZ 7 · K3 · Katman Özellikleri diyaloğu
   ========================================================= */
/** Diyaloğu açar ve alanları katmandan doldurur. Kapa gibi runnner değil:
 *  tek Uygula tek pushUndo'lu tek undo kaydı üretir. */
function inkLayerPropsOpen(layerId) {
  const dialog = document.getElementById('inkLayerPropsDialog');
  if (!dialog || dialog.dataset.lpBound !== '1') return null;
  const layer = typeof inkLayerById === 'function'
    ? inkLayerById(layerId || inkState().activeLayerId) : null;
  if (!layer || layer.kind !== 'attached') {
    if (typeof showProjectNotice === 'function') showProjectNotice(__t('Select a drawing layer'), 2000);
    return null;
  }
  const name = document.getElementById('inkPropsName');
  const opacity = document.getElementById('inkPropsOpacity');
  const opacityVal = document.getElementById('inkPropsOpacityVal');
  const blend = document.getElementById('inkPropsBlend');
  const clip = document.getElementById('inkPropsClip');
  const alpha = document.getElementById('inkPropsAlpha');
  const lock = document.getElementById('inkPropsLock');
  if (!name || !opacity || !blend) return null;

  dialog.dataset.layerId = layer.id;
  const title = document.getElementById('inkLayerPropsTitle');
  if (title) title.textContent = __t('Layer Properties — {name}', { name: layer.name });
  name.value = layer.name;
  opacity.value = String(Math.round((layer.opacity ?? 1) * 100));
  if (opacityVal) opacityVal.textContent = Math.round((layer.opacity ?? 1) * 100) + '%';
  blend.value = INK_BLEND_MODES.includes(layer.blend) ? layer.blend : 'normal';
  alpha.checked = !!layer.alphaLock;
  lock.checked = !!layer.locked;
  // Kırpma: grup üyeleri kırpılamaz (klasör alfasına bağlı); konsensus
  // satır içi düğmeyle aynı — inkCanToggleClip.
  const clipRow = document.getElementById('inkPropsClipRow');
  const canClip = typeof inkCanToggleClip === 'function' && inkCanToggleClip(layer.id);
  if (clipRow) clipRow.hidden = !canClip;
  if (clip) clip.checked = canClip ? !!layer.clip : false;
  dialog.hidden = false;
  if (name instanceof HTMLElement && 'focus' in name) { name.focus(); name.select(); }
  return dialog;
}

/** Diyaloğu kapatır (değer yazmaz). */
function inkLayerPropsClose() {
  const dialog = document.getElementById('inkLayerPropsDialog');
  if (!dialog) return;
  dialog.hidden = true;
  dialog.dataset.layerId = '';
}

/** Tek Uygula: pushUndo → alanları yaz → repaint/senkron → kapat.
 *  Kırpma değiştiyse grup rasterı invalidate edilir (satır içi düğmeyle
 *  aynı yol). */
function inkLayerPropsApply() {
  const dialog = document.getElementById('inkLayerPropsDialog');
  if (!dialog || dialog.hidden) return false;
  const layer = typeof inkLayerById === 'function'
    ? inkLayerById(dialog.dataset.layerId) : null;
  if (!layer || layer.kind !== 'attached') { inkLayerPropsClose(); return false; }

  const name = document.getElementById('inkPropsName');
  const opacity = document.getElementById('inkPropsOpacity');
  const blend = document.getElementById('inkPropsBlend');
  const clip = document.getElementById('inkPropsClip');
  const alpha = document.getElementById('inkPropsAlpha');
  const lock = document.getElementById('inkPropsLock');

  const nextName = String(name.value || '').replace(/\s+/g, ' ').trim()
    .slice(0, 64) || layer.name;
  const nextOpacity = clamp(Number(opacity.value) / 100, 0, 1);
  const nextBlend = INK_BLEND_MODES.includes(blend.value) ? blend.value : 'normal';
  const clipRow = document.getElementById('inkPropsClipRow');
  const canClip = typeof inkCanToggleClip === 'function' && inkCanToggleClip(layer.id);
  const nextClip = canClip && (!clipRow || !clipRow.hidden) ? !!clip.checked : !!layer.clip;

  const changed =
    nextName !== layer.name ||
    nextOpacity !== (layer.opacity ?? 1) ||
    nextBlend !== layer.blend ||
    nextClip !== !!layer.clip ||
    !!alpha.checked !== !!layer.alphaLock ||
    !!lock.checked !== !!layer.locked;
  if (!changed) { inkLayerPropsClose(); return true; }

  // Karışım/opaklık/kırpma kompoziti değiştirir; kilit/alfa kilidi paneli.
  const composited =
    nextOpacity !== (layer.opacity ?? 1) ||
    nextBlend !== layer.blend ||
    nextClip !== !!layer.clip;
  if (typeof pushUndo === 'function') pushUndo();
  /* FAZ 8.B: eski değerler mutasyondan ÖNCE yakalanır — olay payload'ı
     bunları taşır; tek undo kaydı da bu noktada açılır. */
  const old = {
    name: layer.name, opacity: layer.opacity ?? 1,
    blend: layer.blend, clip: !!layer.clip,
    alphaLock: !!layer.alphaLock, locked: !!layer.locked,
  };
  layer.name = nextName;
  layer.opacity = nextOpacity;
  layer.blend = nextBlend;
  if (canClip) layer.clip = nextClip;
  layer.alphaLock = !!alpha.checked;
  layer.locked = !!lock.checked;

  if (typeof inkLayerRefreshPreview === 'function') inkLayerRefreshPreview();
  else if (typeof inkSyncDom === 'function') inkSyncDom();
  if (composited && typeof inkCompositeInvalidate === 'function') {
    inkCompositeInvalidate(layer.ownerId);
  }
  if (typeof scheduleSave === 'function') scheduleSave();
  inkLayerPropsClose();
  /* FAZ 8.B: diyalog mutasyonu da store olayı yayıyor — değişen alan
     listesi payload'da; ad değiştiyse ayrıca 'rename'. */
  const changedFields = [];
  if (old.opacity !== nextOpacity) changedFields.push('opacity');
  if (old.blend !== nextBlend) changedFields.push('blend');
  if (old.clip !== !!layer.clip) changedFields.push('clip');
  if (old.alphaLock !== !!layer.alphaLock) changedFields.push('alphaLock');
  if (old.locked !== !!layer.locked) changedFields.push('locked');
  inkLayerStoreEmit('property', {
    ownerId: layer.ownerId || null, layerId: layer.id, field: 'props',
    fields: changedFields,
  });
  if (old.name !== nextName) {
    inkLayerStoreEmit('rename', {
      ownerId: layer.ownerId || null, layerId: layer.id, name: nextName,
    });
  }
  return true;
}

/** Bir kez bağlanır: Uygula (submit) + İptal + Escape + karart'a tıklayınca. */
function inkLayerPropsBind() {
  const dialog = document.getElementById('inkLayerPropsDialog');
  if (!dialog || dialog.dataset.lpBound === '1') return;
  dialog.dataset.lpBound = '1';
  const form = document.getElementById('inkLayerPropsForm');
  if (form) form.addEventListener('submit', event => {
    event.preventDefault();
    inkLayerPropsApply();
  });
  const cancel = document.getElementById('inkPropsCancel');
  if (cancel) cancel.addEventListener('click', inkLayerPropsClose);
  const opacity = document.getElementById('inkPropsOpacity');
  if (opacity) opacity.addEventListener('input', () => {
    const val = document.getElementById('inkPropsOpacityVal');
    if (val) val.textContent = opacity.value + '%';
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      inkLayerPropsClose();
    }
  });
  dialog.addEventListener('pointerdown', event => {
    if (event.target === dialog) inkLayerPropsClose();
  });
}
inkLayerPropsBind();

/* =========================================================
   liste etkileşimi (seçim, sürükleme, yeniden adlandırma)
   ========================================================= */
function inkLayerBindList(list) {
  if (list.dataset.dpBound === '1') return;
  list.dataset.dpBound = '1';
  let dragId = null;

  const clearDropMarks = () => {
    for (const row of list.querySelectorAll('.inkLayerRow')) {
      row.classList.remove('is-drop-above', 'is-drop-below');
    }
  };

  list.addEventListener('dragstart', event => {
    const row = event.target.closest('.inkLayerRow');
    if (!row) return;
    dragId = row.dataset.layerId;
    row.classList.add('is-dragging');
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragId);
    } catch { /* sessiz */ }
  });

  list.addEventListener('dragover', event => {
    if (!dragId) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = 'move'; } catch { /* sessiz */ }
    const row = event.target.closest('.inkLayerRow');
    clearDropMarks();
    if (!row) return;
    const rect = row.getBoundingClientRect();
    row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'is-drop-above' : 'is-drop-below');
  });

  list.addEventListener('dragleave', event => {
    if (event.target === list) clearDropMarks();
  });

  list.addEventListener('drop', event => {
    if (!dragId) return;
    event.preventDefault();
    const rows = [...list.querySelectorAll('.inkLayerRow')];
    const row = event.target.closest('.inkLayerRow');
    let slot = rows.length;
    if (row) {
      const idx = rows.indexOf(row);
      const rect = row.getBoundingClientRect();
      slot = event.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
    }
    const id = dragId;
    dragId = null;
    clearDropMarks();
    inkDocReorderLayer(id, slot);
  });

  list.addEventListener('dragend', () => {
    dragId = null;
    clearDropMarks();
    for (const row of list.querySelectorAll('.inkLayerRow')) row.classList.remove('is-dragging');
  });

  // Çift tık: adı yerinde düzenle.
  list.addEventListener('dblclick', event => {
    const nameEl = event.target.closest('.inkLayerName');
    if (!nameEl) return;
    const row = nameEl.closest('.inkLayerRow');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    inkLayerBeginRename(row, nameEl);
  });

  // Sağ tık: katman menüsü — imlecin olduğu noktada açılır (K10: satır
  // hizalaması geniş pencerede menüyü ekranın en soluna fırlatıyordu).
  list.addEventListener('contextmenu', event => {
    const row = event.target.closest('.inkLayerRow');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    inkDocSelectLayer(row.dataset.layerId);
    inkLayerMenuOpen(row, row.dataset.layerId,
      { x: event.clientX, y: event.clientY });
  });
}

function inkLayerBeginRename(row, nameEl) {
  const layer = typeof inkLayerById === 'function' ? inkLayerById(row.dataset.layerId) : null;
  if (!layer || nameEl.querySelector('input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dpLayerRename';
  input.value = layer.name;
  input.maxLength = 64;
  input.setAttribute('aria-label', __t('Layer name'));
  nameEl.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = commit => {
    if (done) return;
    done = true;
    const value = input.value;
    if (commit) inkDocRenameLayer(layer.id, value);
    else if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    event.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('pointerdown', event => event.stopPropagation());
  input.addEventListener('click', event => event.stopPropagation());
}

/* =========================================================
   kısayollar
   ========================================================= */
function inkLayerShortcutsBound() {
  if (inkLayerShortcutsBound.done) return;
  inkLayerShortcutsBound.done = true;
  document.addEventListener('keydown', event => {
    if (typeof modeIsDraw === 'function' && !modeIsDraw()) return;
    const tag = (event.target && event.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (event.target && event.target.isContentEditable)) return;
    if (typeof inkEditorIsOpen === 'function' && !inkEditorIsOpen()) return;
    /* Vuruş ortasında katman kısayolu (Ctrl+J/[/]/Shift+N/Ctrl+Shift+H)
       undo noktasını ve aktif katmanı kaydırıyordu. */
    if (typeof inkLayerStrokeActive === 'function' && inkLayerStrokeActive()) return;
    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;

    if (!mod && event.shiftKey && (key === 'N' || key === 'n')) {
      event.preventDefault();
      inkDocAddLayer();
      return;
    }
    /* Faz 3a: Ctrl+J/[ ] keymap 'layers' grubundan çözülür; keymap
       yoksa eski tuşlar geçerli kalır (parite). Shift+N ve
       Ctrl+Shift+H shift kombinasyonları sabittir. */
    let layersAct = '';
    if (mod && !event.altKey && !event.shiftKey && key.length === 1) {
      if (window.tailrefKeymap) {
        layersAct = window.tailrefKeymap.actionFor('ctrl+' + key.toLowerCase(), 'layers');
      } else if (key === 'j' || key === 'J') layersAct = 'layers.duplicate';
      else if (key === ']') layersAct = 'layers.moveUp';
      else if (key === '[') layersAct = 'layers.moveDown';
    }
    if (layersAct === 'layers.duplicate') {
      event.preventDefault();
      inkDocDuplicateLayer();
      return;
    }
    if (layersAct === 'layers.moveUp') {
      event.preventDefault();
      inkDocMoveLayer(null, 1);
      return;
    }
    if (layersAct === 'layers.moveDown') {
      event.preventDefault();
      inkDocMoveLayer(null, -1);
      return;
    }
    if (mod && event.shiftKey && (key === 'H' || key === 'h')) {
      event.preventDefault();
      const layer = inkDocSelectedLayer();
      if (layer) inkDocSetVisible(layer.id, !layer.visible);
      return;
    }
    if (!mod && (key === 'Delete' || key === 'Backspace')) {
      const inPanel = event.target && event.target.closest && event.target.closest('#inkLayersPanel');
      if (!inPanel && !(document.activeElement && document.activeElement.closest('#inkLayersPanel'))) return;
      event.preventDefault();
      inkDocDeleteOrClearLayer();
    }
  }, true);
}
