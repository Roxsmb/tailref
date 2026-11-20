/* TailRef app · ink compositor · Porter–Duff tek doğruluk kaynağı
   ------------------------------------------------------------------
   Bu modül, görsele bağlı katman yığınının GÖRÜNTÜ alanı planını üretir.
   Ekran (DOM), editör önizlemesi ve PNG dışa aktarım AYNI planı ve AYNI
   grup rasterını kullanmak zorundadır; aksi hâlde ekranla dışa aktarım
   farklı görünebiliyordu (ekran CSS mix-blend-mode → tüm DOM arka planı,
   dışa aktarım globalCompositeOperation → yalnızca tuval).

   Porter–Duff semantiği (premultiplied yaklaşım, Canvas2D karşılığıyla):

   • source-over  : normal boyama.  a_o = a_s + a_d(1 − a_s)
   • source-atop  : ALFA KİLİDİ ve KIRPMA MASKESİ. Yalnızca hedef alfasının
                    olduğu yere basar.  a_o = a_d;  C_o = C_s·a_d + C_d(1 − a_s)
   • destination-out : silgi. a_o = a_d(1 − a_s)

   Grup / kırpma modeli (referans uygulama anlambilimi):
     Bir katman `clip: true` ise, hemen altındaki ilk görünür "temel"
     katmana kırpılır; ardışık kırpılanlar AYNI temele zincirlenir.
     Temel gizliyse/zayıf görünmezse tüm zincir de görünmez olur.
     Görünstleride grup tek bir pikselden (buffer) bir düzlem olarak
     üstteki yığına girer: buffer = base OVER-RASTER sonra her clip
     source-atop ile buffer'a bırakılır.

   Ayrıca konuşan EDM: map/cache işlemlerine bellek dikkatini getirmek adına
   bu modül ayrı bir `55-ink-mask.js`'e bağımlılığı yoktur.
   ========================================================= */
'use strict';

/* Bellek: katman piksel generations. Herhangi bir katman tuvali boyandığında
   artar; grup raster önbellekleri geçerlilik imzasında bunları kullanır. */
const inkCompositeRuntime = {
  gen: new Map(),        // layerId -> sayı (raster sürümü)
  groups: new Map(),     // baseLayerId -> { canvas, sig, w, h }
};

function inkBumpLayerGen(layerId) {
  if (!layerId) return;
  const cur = inkCompositeRuntime.gen.get(layerId) || 0;
  inkCompositeRuntime.gen.set(layerId, cur + 1);
}

function inkLayerGen(layerId) {
  return inkCompositeRuntime.gen.get(layerId) || 0;
}

/* =========================================================
   Görüntü planı (bottom → top)
   ========================================================= */

/** Bir görselin ekran sırasındaki planı: her giriş ya tek katman, bir
 *  kırpma grubu (base + clipMembers) ya da bir klasör grubu (kind:'group'
 *  + parentId üyeleri, FAZ 1) olur. Gizli/zayıf temeller zinciri taşır
 *  (barrier) AMA görüntüde görünmez.
 *
 *  Düzlem dizinde klasör: [üye1, üye2, ..., GRUP] (alttan → üste)
 *  — üyeler klasör girişinin hemen ALTINDA bitişik tablo. Gezgin bunları
 *  toplayıp tek plan girişine bağlamadan önce geçersiz üye arasına
 *  düz katman girerse (bozuk parent) üyeleri sıradan katman olarak
 *  bırakır; plan içinde ayrımı bozmaz. */
function inkAttachedDisplayPlan(ownerId) {
  const layers = typeof inkOwnerStackLayers === 'function'
    ? inkOwnerStackLayers(ownerId)
    : (typeof inkLayersForOwner === 'function' ? inkLayersForOwner(ownerId) : []);
  const plan = [];
  let pendingMembers = null;
  const flushOrphanMembers = () => {
    if (!pendingMembers) return;
    /* Bitişik olmayan üye: klasör düzlemine giremez AMA üyeliği gerçektir
       (panel parentId gösterir). `bound` ile klasörüne bağlanır — klasörün
       görünürlük/opaklığı bu üyeye de uygulanır. Değişmez: paneldeki üyelik
       ile kompozitörün davranışı ASLA ayrışmaz (hayalet üye yok). */
    for (const member of pendingMembers) {
      plan.push({ base: member, clips: null, members: null, bound: member.parentId || null });
    }
    pendingMembers = null;
  };
  for (const layer of layers) {
    if (layer.kind === 'group') {
      // Klasör: o ana dek biriktirilen bitişik üyeler bu giriş içine girer.
      plan.push({ base: layer, clips: null, members: pendingMembers || [] });
      pendingMembers = null;
    } else if (layer.parentId) {
      (pendingMembers = pendingMembers || []).push(layer);
    } else {
      flushOrphanMembers();
      if (layer.clip && plan.length && plan[plan.length - 1].base.ownerId === layer.ownerId) {
        const entry = plan[plan.length - 1];
        if (!entry.clips) entry.clips = [];
        entry.clips.push(layer);
      } else {
        plan.push({ base: layer, clips: null });
      }
    }
  }
  flushOrphanMembers();
  return plan;
}

/** Plan girişinin bağlı olduğu klasör: `bound` yalnız bitişik olmayan
 *  klasör üyelerinde doludur (üyelik gerçeği — panel parentId). */
function inkBoundGroupOf(entry) {
  return entry && entry.bound && typeof inkLayerById === 'function'
    ? inkLayerById(entry.bound) : null;
}

/** Plan girişi görünür mü? Temel görünür + opak > 0 ise giriş görünür.
 *  Klasöre bağlı (bound) bağımsız üyelerde klasörün görünürlüğü de taşınır. */
function inkPlanEntryVisible(entry) {
  if (!entry || !entry.base) return false;
  if (entry.base.visible === false || entry.base.opacity <= 0.001) return false;
  const bound = inkBoundGroupOf(entry);
  if (bound && (bound.visible === false || (bound.opacity ?? 1) <= 0.001)) return false;
  return true;
}

/* =========================================================
   grup raster üretimi
   ========================================================= */

/** base'den grup tuvali piksel boyutu: base'in kendi pxW/pxH'yi kullanılır;
 *  clip üyeleri aynı boyuta ölçeklenerek basılır (aynı görselin katmanları
 *  normalde zaten aynı boyuttadır). */
function inkGroupSizePixels(entry) {
  const base = entry.base;
  let w = Number.isFinite(base.pxW) && base.pxW > 0 ? base.pxW : 0;
  let h = Number.isFinite(base.pxH) && base.pxH > 0 ? base.pxH : 0;
  if (!w || !h) {
    const it = typeof getItem === 'function' ? getItem(base.ownerId) : null;
    w = w || Math.max(64, Math.round(it ? it.w : 256));
    h = h || Math.max(64, Math.round(it ? it.h : 256));
  }
  return { w, h };
}

function inkMemberRasterOf(layer, override) {
  if (override && override.get(layer.id)) return override.get(layer.id);
  return inkRuntime && inkRuntime.itemCanvases
    ? inkRuntime.itemCanvases.get(layer.id)
    : null;
}

function inkGroupCacheSig(entry, w, h, override) {
  const parts = [w, 'x', h, entry.base.kind || 'attached'];
  // Klasör durum: [üyeler..., base] (alttan → üste); üye boyutu klasör
  // yapısını yeniden üretitmeye zorlar (besim genleri değiştikçe).
  const members = (entry.members || []).concat([entry.base], entry.clips || []);
  for (const layer of members) {
    if (override && override.has(layer.id)) {
      parts.push(layer.id, '#live');
    } else {
      parts.push(layer.id, inkLayerGen(layer.id),
        Math.round((layer.opacity ?? 1) * 1000), layer.blend || 'normal',
        layer.clip ? 1 : 0, layer.visible === false ? 'gizli' : '');
    }
  }
  return parts.join('|');
}

/** Plan girişinin buffer'a bileştirilecek katmanlarını (alttan → üste)
 *  döndürür: klasör ise [üyeler..., clip üyeleri], kırpma zinciri ise
 *  [temel, ...clips]. Klasörün kendisi zabıt pikselsizdir; tek katman
 *  girişi direkt kaynak tuvaliyle geçer. */
function inkCompositeCompositeLayers(entry) {
  const paintList = [];
  if (entry.members && entry.members.length) {
    for (const member of entry.members) paintList.push({ layer: member, over: true });
  } else if (entry.base.kind !== 'group') {
    /* Giriş tabanı: opaklık/blend ekranda grup düzleminde uygulanır
       (flat) — buffer'a pişirilirse çifte uygulanır. */
    paintList.push({ layer: entry.base, over: true, flat: true });
  }
  for (const layer of entry.clips || []) paintList.push({ layer, over: false });
  return paintList.length ? paintList : null;
}

/**
 * Plan girişinin tek düzlem rasterını üretir (bellek önbellekli).
 * Kırpma zinciri VE klasör grubu için ortak yoldur: alttan → üste
 * `inkCompositeCompositeLayers` listesindeki her tuval kendi opaklığıyla
 * basılır; klip üyeleri (over:false) daha önce basılan alfanın İÇİNE
 * düşer (source-atop). Klasörün kendi düzlemi pikselsizdir — yalnızca
 * görünürlük/opaklık/blend taşıyıcısıdır.
 * @param {object} entry plan girişi ({ base, clips, members })
 * @param {Map<string,CanvasRenderingContext2D>} override canlı önizleme
 *        ikameleri (girdi varsa önbellek baypas edilir).
 * @returns {HTMLCanvasElement|null}
 */
function inkCompositeGroupRaster(entry, override) {
  if (!entry || !entry.base) return null;
  const clips = entry.clips || [];
  const members = entry.members || [];
  const baseRaster = inkMemberRasterOf(entry.base, override);
  if (!baseRaster && !clips.length && !members.length) return null;
  // Kırpma zincirsiz tek katman girişi: birleşik raster yok, kaynak gider.
  if (baseRaster && !clips.length && !members.length && !override) return baseRaster;

  const { w, h } = inkGroupSizePixels(entry);
  const sig = inkGroupCacheSig(entry, w, h, override);
  const cacheKey = entry.base.id;
  if (!override) {
    const cached = inkCompositeRuntime.groups.get(cacheKey);
    if (cached && cached.sig === sig && cached.canvas && cached.canvas.width === w
        && cached.canvas.height === h) {
      return cached.canvas;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);

  // Buffer'a basılacak katman listesi (paintList null olamaz: girdi bu
  // fonksiyona yalnızca çok katmanlı girişlerden ulaşır).
  const paintList = inkCompositeCompositeLayers(entry) || [];
  ctx.save();
  for (const unit of paintList) {
    const layer = unit.layer;
    const raster = inkMemberRasterOf(layer, override);
    if (!raster || layer.visible === false || layer.opacity <= 0.001) continue;
    /* Klip üyeleri: katı atop — süründüğü pager alfa boşsa görünmez
       (referans uygulama anlambilimi). Üyeler: kendi blend'i, taban/klip
       olmadıkça source-over. */
    ctx.globalCompositeOperation = unit.over
      ? (!unit.flat && layer.blend && layer.blend !== 'normal'
        ? layer.blend : 'source-over')
      : 'source-atop';
    ctx.globalAlpha = unit.flat ? 1 : Math.min(1, Math.max(0, layer.opacity ?? 1));
    ctx.drawImage(raster, 0, 0, w, h);
  }
  ctx.restore();

  if (!override) {
    inkCompositeRuntime.groups.set(cacheKey, { canvas, sig, w, h });
  }
  return canvas;
}

/** Plan girişinin ekran/piksel dışa aktarım kaynak tuvalini döndürür. */
function inkCompositeEntryCanvas(entry, override) {
  if (!entry) return null;
  if ((entry.clips && entry.clips.length) || (entry.members && entry.members.length)) {
    const raster = inkCompositeGroupRaster(entry, override);
    // Grup rasterı boyutsuz kalırsa (tuval yoksa) temele düş.
    if (raster && (raster.width || raster.height)) return raster;
  }
  return inkMemberRasterOf(entry.base, override);
}

/** Plan girişinin görüntü opaklığı: gruplar temel opaklığını taşır
 *  (üküye opaklığı rasterde işlenmiştir). Klasöre bağlı (bound) bağımsız
 *  üyede klasörün opaklığı da çarpan olarak girer. */
function inkCompositeEntryOpacity(entry) {
  const base = entry.base;
  let o = Number.isFinite(base.opacity) ? base.opacity : 1;
  const bound = inkBoundGroupOf(entry);
  if (bound) o *= Number.isFinite(bound.opacity) ? bound.opacity : 1;
  return Math.min(1, Math.max(0, o));
}

function inkCompositeEntryBlend(entry) {
  return entry.base && entry.base.blend && entry.base.blend !== 'normal'
    ? entry.base.blend
    : null;
}

/** Plan girişinin üye katman id'leri: klasörse [grup, ...üyeler],
 *  kırpma zinciriyse [temel, ...clips]. Ekran senkronu member tuvalleri
 *  bu listeden gizler/kurtarır. */
function inkCompositeEntryMembers(entry) {
  if (entry.members && entry.members.length) {
    /* Grup düzleminin kendi tuvali yoktur; id'si yine akışta olsun,
       temizlik senkronu (stale) buna dayanır. */
    return [entry.base.id, ...entry.members.map(l => l.id)];
  }
  return entry.clips && entry.clips.length
    ? [entry.base.id, ...entry.clips.map(l => l.id)]
    : null;
}

/* =========================================================
   EKRAN (DOM) birleştirme · görsele bağlı katman tuvalleri
   ========================================================= */

function inkCompositeSyncItem(it, el) {
  if (!it || !el || it.kind !== 'image') return;
  const layers = typeof inkOwnerStackLayers === 'function'
    ? inkOwnerStackLayers(it.id)
    : (typeof inkLayersForOwner === 'function' ? inkLayersForOwner(it.id) : []);
  if (!layers.length) return;
  /* FX dalı (Faz 1 — docs/fx-motoru-spec.md Bölüm 6): etkin efekt varsa
     görüntüyü TEK .inkFxCanvas taşır; katman/grup tuvalleri gizlenir.
     Ekran ile export AYNI inkFxApplyChain'i kullanır (piksel birebir). */
  if (typeof inkFxSyncItem === 'function' && inkFxSyncItem(it, el)) return;
  // Kırpma zinciri VE klasör üyeliği (parentId) birleşik düzlem gerektirir.
  const hasComposite = layers.some(
    l => l.clip || l.parentId || l.kind === 'group');
  if (!hasComposite) {
    // Grupsuz görünüm: eski grup tuvallerini kaldır, üye tuvalleri serbest bırak.
    for (const g of el.querySelectorAll(':scope > .inkGroupCanvas')) g.remove();
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0.001) continue;
      const canvas = inkRuntime && inkRuntime.itemCanvases.get(layer.id);
      if (canvas && canvas.style.display === 'none') canvas.style.display = '';
    }
    return;
  }

  const plan = inkAttachedDisplayPlan(it.id);
  for (const entry of plan) {
    const members = inkCompositeEntryMembers(entry);
    if (!members || !inkPlanEntryVisible(entry)) {
      // Görünmeyen grup: üyeler gizli kalır (grubun görünürlüğü onları taşır).
      const stale = el.querySelector(':scope > .inkGroupCanvas[data-ink-base="' + entry.base.id + '"]');
      if (stale) stale.remove();
      continue;
    }
    const raster = inkCompositeEntryCanvas(entry, null);
    if (!raster || !raster.width || !raster.height) continue;

    let groupCanvas = el.querySelector(
      ':scope > .inkGroupCanvas[data-ink-base="' + entry.base.id + '"]');
    if (!groupCanvas) {
      groupCanvas = document.createElement('canvas');
      groupCanvas.className = 'inkGroupCanvas';
      groupCanvas.dataset.inkBase = entry.base.id;
      groupCanvas.setAttribute('aria-hidden', 'true');
      const handles = el.querySelector(':scope > .handles');
      const baseEl = inkRuntime && inkRuntime.itemCanvases.get(entry.base.id);
      // Tutamaçlardan önce, katman tuvalleriyle aynı yığına yerleşir.
      if (handles) el.insertBefore(groupCanvas, handles);
      else if (baseEl && baseEl.parentNode === el) el.insertBefore(groupCanvas, null);
      else el.appendChild(groupCanvas);
    }
    if (groupCanvas.width !== raster.width || groupCanvas.height !== raster.height) {
      groupCanvas.width = raster.width;
      groupCanvas.height = raster.height;
    }
    const gctx = groupCanvas.getContext('2d', { colorSpace: 'srgb' });
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, groupCanvas.width, groupCanvas.height);
    gctx.drawImage(raster, 0, 0);

    // Grup, temel katmanın z sırasını, opaklığını ve blend modunu taşır.
    // Z tabanı: attached + group karışık yığın (plan ile aynı liste).
    const stacked = layers;
    const idx = Math.max(0, stacked.findIndex(l => l.id === entry.base.id));
    groupCanvas.dataset.inkLayer = entry.base.id;
    groupCanvas.style.zIndex = String(2 + idx);
    groupCanvas.style.opacity = String(inkCompositeEntryOpacity(entry));
    const blend = inkCompositeEntryBlend(entry);
    groupCanvas.style.mixBlendMode = blend ? blend : 'normal';
    groupCanvas.style.display = 'block';
  }

  // Grupta/kırpma zincirinde yer alan üye tuvalleri gözden gizle
  // (rasterın kendisi canlı kalır).
  for (const entry of plan) {
    const members = inkCompositeEntryMembers(entry);
    if (!members) continue;
    for (const memberId of members) {
      if (memberId === entry.base.id && entry.base.kind === 'group') continue;
      const canvas = inkRuntime && inkRuntime.itemCanvases.get(memberId);
      if (canvas) canvas.style.display = 'none';
    }
  }
  // Grupta/kırpma zincirinde olmayan katmanların tuvalleri normal akışta kalır.
  // Üyelik (girişe dahil olma) görünürlükten bağımsızdır: gizli grubun
  // üyeleri sırıtmamalı (restore edilirse yarı şeffaf ikizler çizilirdi).
  for (const layer of layers) {
    if (layer.kind !== 'attached') continue;
    const belongs = plan.some(entry => {
      const members = inkCompositeEntryMembers(entry);
      return !!(members && members.includes(layer.id));
    });
    if (!belongs && layer.visible && layer.opacity > 0.001) {
      const canvas = inkRuntime && inkRuntime.itemCanvases.get(layer.id);
      if (canvas && canvas.style.display === 'none') canvas.style.display = '';
    }
  }
}

/** Raster üretiminden sonra grup önbelleklerini geçersiz kılmak gerekir;
 *  gen sayaçları bunu zaten sağlar (inkBumpLayerGen). */
function inkCompositeInvalidate(ownerId) {
  if (ownerId) inkCompositeRuntime.groups.delete(ownerId);
}

/* =========================================================
   kırpma / alfa kilidi yardımcı API (panel + köprü kullanır)
   ========================================================= */

/** Bir katmanı kırpılabilir yapar: üstünde bir clip üyesi veya base olabildiği
 *  yalnızca altında başka katmanlar varken etkilidir. */
function inkCanToggleClip(layerId) {
  const layer = typeof inkLayerById === 'function' ? inkLayerById(layerId) : null;
  if (!layer || layer.kind !== 'attached') return false;
  // FAZ 1 (gruplar): klasör üyesi zaten grup alfasına bağlıdır — ikinci kırpma yok.
  if (layer.parentId) return false;
  const ownerId = layer.ownerId;
  const stack = inkLayersForOwner(ownerId);
  return stack.indexOf(layer) > 0;
}

/** FAZ 1 (piksel-gerçek merge-down): kaynak katmanın rasterını alt
 *  katmanın rasterının ÜZERİNE render kurallarıyla (kaynak opaklığı +
 *  kaynak blend) birleştirir ve dataURL döndürür. Alt katmanın kendi
 *  blend/opaklığı ekran düzeyinde kalır (çifte uygulama yok).
 *  Kırpma semantiği korunur: kaynak bir klip üyesiyse YALNIZCA zincir
 *  tabanı alt katmanın kendisiyken kabul edilir ve atop ile basılır.
 *  @returns {{src, w, h}|null} pişen görüntü ya da ret.
 */
function inkCompositeMergeDownPixels(source, below) {
  if (!source || source.kind !== 'attached' ||
      !below || below.kind !== 'attached') return null;
  const runtime = (typeof inkRuntime !== 'undefined' && inkRuntime) ? inkRuntime : null;
  if (!runtime) return null;
  const belowCanvas = runtime.itemCanvases.get(below.id);
  const sourceCanvas = runtime.itemCanvases.get(source.id);
  if (!belowCanvas || !belowCanvas.width || !belowCanvas.height) return null;

  // Kırpma zinciri denetimi: kaynak kendi zincirinin tabanıysa
    // (üzerine kırpılan üyeleri varsa) birleştirme reddedilir.
  let sourceOp = 'source-over';
  if (typeof inkAttachedDisplayPlan === 'function') {
    const plan = inkAttachedDisplayPlan(source.ownerId);
    const ownChain = plan.find(e => e.base && e.base.id === source.id &&
      e.clips && e.clips.length);
    if (ownChain) return null;
    const asClip = plan.find(e => e.base && e.base.id !== source.id &&
      e.clips && e.clips.some(l => l.id === source.id));
    if (asClip) {
      // Kaynak klip: zincir tabanı alt katman olmalı (atop doğru olur).
      if (asClip.base.id !== below.id) return null;
      sourceOp = 'source-atop';
    }
  }

  const out = document.createElement('canvas');
  out.width = belowCanvas.width;
  out.height = belowCanvas.height;
  const ctx = out.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return null;
  ctx.drawImage(belowCanvas, 0, 0);
  if (sourceCanvas && source.visible !== false && source.opacity > 0.001) {
    ctx.save();
    if (sourceOp === 'source-atop') ctx.globalCompositeOperation = sourceOp;
    else if (source.blend && source.blend !== 'normal') {
      ctx.globalCompositeOperation = source.blend;
    }
    ctx.globalAlpha = Math.min(1, Math.max(0, source.opacity));
    ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
    ctx.restore();
  }
  return {
    src: out.toDataURL('image/png'),
    w: out.width, h: out.height,
    canvas: out, // bake önbelleğine senkron koyulmak için (baked'a yazılmaz)
  };
}

/* Alt taraftaki export yardımı: bir görselin plan girişlerini sırayla
   basar (screen ile aynı raster/kural). */function inkCompositePaintPlanToContext(ctx, ownerId, override,
  drawFn) {
  const plan = inkAttachedDisplayPlan(ownerId);
  for (const entry of plan) {
    if (!inkPlanEntryVisible(entry)) continue;
    const raster = inkCompositeEntryCanvas(entry, override);
    if (!raster || !raster.width || !raster.height) continue;
    drawFn(ctx, entry, raster);
  }
}

/** Bir görselin birleşik düzlem içeren katmanları var mı?
 *  (kırpma zinciri veya klasör üyeliği) Panel köprüsü ve render kapısı kullanır. */
function inkCompositeHasClips(ownerId) {
  const layers = typeof inkOwnerStackLayers === 'function'
    ? inkOwnerStackLayers(ownerId)
    : (typeof inkLayersForOwner === 'function' && ownerId
      ? inkLayersForOwner(ownerId) : []);
  return layers.some(l => l.clip || l.parentId || l.kind === 'group');
}
