/* TailRef app · ink core · state, layers, geometry, spatial index
   ------------------------------------------------------------------
   Çizim sisteminin "kaynak gerçeği" (source of truth) burada tutulur.
   Her katman vuruş (stroke) listesi saklar; tuval/karolar yalnızca
   önbellektir ve gerektiğinde bu listeden yeniden üretilir.

   İki katman türü:
   • attached : bir görsel öğeye bağlıdır. Noktalar görselin 0..1
                normalize kutusunda saklanır; görsel taşınınca,
                ölçeklenince ve döndürülünce çizim de onunla gelir.
   • global   : sonsuz tuvalde dünya koordinatlarında yaşar. Dünya
                uzayı 512 birimlik karolara (tile) bölünür; yalnızca
                çizilen karolar için tuval ayrılır (spatial index).
   ========================================================= */
'use strict';

const INK_VERSION = 1;
const INK_TILE_SIZE = 512;       // dünya birimi cinsinden karo kenarı
const INK_MAX_STROKE_POINTS = 36000;
const INK_BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];
const INK_MIN_SIZE = 1;
const INK_MAX_SIZE = 400;

/* Çalışma zamanı yardımcıları — anlık görüntüye (JSON) girmez. */
const inkRuntime = {
  penSeenAt: 0,
  lastTouchAt: 0,
  importedTips: new Map(),   // tipId -> dataURL
  dirtyLayers: new Set(),    // yeniden raster edilecek katmanlar
  itemCanvases: new Map(),   // layerId -> canvas
  tiles: new Map(),          // "layerId:tx,ty" -> { canvas, tx, ty, layerId }
  gizmo: null,
  /* Bağlamsal çizim: yalnızca bu görselin içinde çizim yapılır.
     Kalıcı değildir; sayfa yenilenince kapanır. */
  imageScopeId: null,
};

/** Bağlamsal çizim hedefi varsa görseli döndürür; görsel silinmişse
    kapsamı sessizce temizler. */
function inkScopedImage() {
  const id = inkRuntime.imageScopeId;
  if (!id) return null;
  const it = getItem(id);
  if (!it || it.kind !== 'image') {
    inkRuntime.imageScopeId = null;
    if (typeof inkSyncScopeVisual === 'function') inkSyncScopeVisual();
    return null;
  }
  return it;
}

/* Normalize edilmiş durum nesneleri. `inkEnsureState()` her çağrıldığında
   tüm vuruşları yeniden klonlamak hem yavaş hem de katman referanslarını
   bayatlatıyordu (panelden yapılan değişiklikler kayboluyordu). */
const inkNormalizedStates = new WeakSet();

/* Eski kayıtlardaki fırça kimlikleri yeni yerel kütüphaneye bağlanır.
   Vuruşlar yalnızca kimlik sakladığı için çizim verisi bozulmadan
   güncel uca çözümlenir. */
const INK_BRUSH_ALIASES = {
  'ink-soft': 'native-soft-pastel',
  'ink-hard': 'native-studio-pen',
  'ink-pencil': 'native-hb-pencil',
  'ink-marker': 'native-block-in',
  'ink-air': 'native-soft-pastel',
};

function inkResolveBrushId(id) {
  return INK_BRUSH_ALIASES[id] || id;
}

function inkDefaultBrushes() {
  if (typeof inkNativeBrushDefaults === 'function') return inkNativeBrushDefaults();
  return [];
}

/* Fırça imzası: `id` dışındaki tüm alanlar. İki kayıt aynı imzaya
   sahipse kullanıcı açısından birebir aynıdır. */
function inkBrushSignature(brush) {
  if (!brush || typeof brush !== 'object') return '';
  return JSON.stringify(Object.keys(brush)
    .filter(key => key !== 'id')
    .sort()
    .map(key => [key, brush[key]]));
}

/**
 * Aynı ayarlara sahip özel fırçaları tek kayda indirir.
 *
 * Eski bir hata "Create" düğmesinin her basışında yeni bir kopya
 * ekliyordu; kayıtta 206 adet birebir aynı "Yeni Fırça" birikmişti.
 * Silinen kimlikler korunan kimliğe bağlanır, böylece aktif fırça,
 * araç ayarları ve çift fırça referansları bozulmaz.
 * Değişiklik yoksa hiçbir şey yapmaz ve 0 döner.
 */
function inkDedupeCustomBrushes(ink) {
  if (!ink || !Array.isArray(ink.brushes)) return 0;
  const keptBySignature = new Map();
  const alias = new Map();
  const kept = [];
  for (const brush of ink.brushes) {
    if (!brush || !brush.id || brush.category !== 'custom') {
      kept.push(brush);
      continue;
    }
    const signature = inkBrushSignature(brush);
    const keptId = signature ? keptBySignature.get(signature) : null;
    if (keptId) {
      alias.set(brush.id, keptId);
      continue;
    }
    if (signature) keptBySignature.set(signature, brush.id);
    kept.push(brush);
  }
  if (!alias.size) return 0;

  ink.brushes = kept;
  for (const brush of kept) {
    if (brush && brush.dual && alias.has(brush.dual.brushId)) {
      brush.dual.brushId = alias.get(brush.dual.brushId);
    }
  }
  if (alias.has(ink.brushId)) ink.brushId = alias.get(ink.brushId);
  if (Array.isArray(ink.deletedBrushIds)) {
    ink.deletedBrushIds = [...new Set(ink.deletedBrushIds.map(id => alias.get(id) || id))];
  }
  if (ink.toolSettings && typeof ink.toolSettings === 'object') {
    for (const settings of Object.values(ink.toolSettings)) {
      if (settings && alias.has(settings.brushId)) settings.brushId = alias.get(settings.brushId);
    }
  }
  return alias.size;
}

function inkCreateState() {
  const brushes = inkDefaultBrushes();
  const seed = brushes[0] || {};
  return {
    version: INK_VERSION,
    tool: 'brush',              // brush | pencil | eraser | fill | smudge | gradient | lasso | marquee | shape | text | eyedropper | transform
    shape: 'arrow',             // arrow | rect | ellipse | highlight | line | arc | circle | poly (poly: oturtma köşeli çokgenleri)
    brushId: seed.id || 'native-studio-pen',
    color: '#d4a24a',
    size: Number.isFinite(seed.size) ? seed.size : 24, // dünya birimi (ekran ölçeğinden bağımsız)
    opacity: Number.isFinite(seed.opacity) ? seed.opacity : 1,
    hardness: Number.isFinite(seed.hardness) ? seed.hardness : 0.8,
    spacing: Number.isFinite(seed.spacing) ? seed.spacing : 0.08,
    /* Tur 4i: yumuşatma ilk açılışta %5 — fırça ön ayarındaki %45-62
       değeri tohumdan sızmıyordu ("çizim moduna ilk geçtiğimde %50'de
       başlıyor"). setActiveBrush zaten fırça seçimini her zaman %5'e
       getirir (kullanıcı tercihi); ilk açılış da aynı tercihi izler. */
    smoothing: 0.05,
    // FAZ 2-4: basınç bildirmeyen fare girdisinde hız → basınç simülasyonu.
    mouseSpeedPressure: false,
    // Şekil oturtma: kalemi ~2 sn hareketsiz bekletince vuruş mükemmel
    // şekle dönüşür (30b-ink-shape-snap). Kapatılırsa serbest vuruşa
    // hiç dokunulmaz.
    shapeSnap: true,
    pressureCurve: Number.isFinite(seed.pressureCurve) ? seed.pressureCurve : 1, // 0.2 yumuşak – 3 sert (1 = doğrusal)
    speedSize: Number.isFinite(seed.speedSize) ? seed.speedSize : 0,              // 0–0.8 hız incelmesi (0 = kapalı)
    flow: Number.isFinite(seed.flow) ? seed.flow : 1,
    flowJitter: Number.isFinite(seed.flowJitter) ? seed.flowJitter : 0,
    scatter: Number.isFinite(seed.scatter) ? seed.scatter : 0,
    taperStart: Number.isFinite(seed.taperStart) ? seed.taperStart : 0,
    taperEnd: Number.isFinite(seed.taperEnd) ? seed.taperEnd : 0,
    layers: [],
    activeLayerId: null,
    selection: [],              // seçili stroke kimlikleri
    // B6: seçim modu — new | add | sub | intersect (PS kalıbı; Shift/
    // Alt drag başında geçici üstünlük kullanır).
    selectionMode: 'new',
    // FAZ 6 madde 11: simetri motoru — vuruşa uygulanacak kanal açılımı
    // (off | mirrorX | mirrorY | mirrorXY | radial4 | radial8). Yalnızca
    // bağlı katman düzenlemesi vuruşa `sym` yazar; tahta yolu üretmez.
    symMode: 'off',
    brushes,
    brushOverrides: {},
    deletedBrushIds: [],
    deletedCategories: [],
    autoAttach: true,
    // Araç başına fırça ayarları. Fırçada yapılan boyut/sertlik/opaklık
    // değişiklikleri silgiye taşmaz; her araç kendi değerlerini hatırlar.
    toolSettings: {},
    // FAZ 7.W: çok-duraklı gradyan durakları (gradient aracı durumu).
    // Durak: { pos 0..1, color '#rrggbb', alpha 0..1 }. Varsayılan iki
    // durak mevcut soluklaşmanın birebir aynısı (renk → şeffaf).
    // gradientStopSel: bar + seçici popup'ın düzenlediği durak indeksi.
    gradientStops: [
      { pos: 0, color: '#d4a24a', alpha: 1 },
      { pos: 1, color: '#d4a24a', alpha: 0 },
    ],
    gradientStopSel: 0,
    // Belge başına katman adı sayacı; silinen numaralar yeniden kullanılmaz.
    docLayerSeq: {},
  };
}

/**
 * Herhangi bir kaynaktan (eski kayıt, geri al, pano) gelen ink
 * verisini güvenli ve eksiksiz bir şekle getirir.
 */

/* FAZ 7.W · çok-duraklı gradyan durakları ------------------------------
   Durak biçimi { pos 0..1, color '#rrggbb', alpha 0..1 }. Normalize:
   dizi <2 ise varsayılan iki durak (soluklaşma) döner; pos artan sıraya
   dizilip kelepçelenir (Canvas addColorStop artan pos bekler), geçersiz
   hex/alpha savunmacı düşer. Bake: canlı state'in deep kopyası — vuruşa
   gömülür, sonraki bar düzenlemeleri pişmiş vuruşu değiştirmez. */
function inkGradientStopsNormalize(raw) {
  const cl01 = v => Math.min(1, Math.max(0, v));
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const hexOk = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  const def = [
    { pos: 0, color: '#d4a24a', alpha: 1 },
    { pos: 1, color: '#d4a24a', alpha: 0 },
  ];
  const arr = Array.isArray(raw)
    ? raw.filter(s => s && typeof s === 'object')
    : [];
  if (arr.length < 2) {
    return def.map(s => ({ pos: s.pos, color: s.color, alpha: s.alpha }));
  }
  return arr.map(s => ({
    pos: cl01(num(s.pos, 0)),
    color: hexOk(s.color) ? s.color : '#d4a24a',
    alpha: cl01(num(s.alpha, 1)),
  })).sort((a, b) => a.pos - b.pos);
}

function inkGradientStopsBake(ink) {
  return inkGradientStopsNormalize(ink && ink.gradientStops)
    .map(s => ({ pos: s.pos, color: s.color, alpha: s.alpha }));
}

function inkNormalizeState(raw) {
  const base = inkCreateState();
  if (!raw || typeof raw !== 'object') return base;

  const out = Object.assign(base, raw);
  out.version = INK_VERSION;
  // FAZ 7.W: gradyan duraklarını güvenli şekle getir (eski kayıt/pano
  // ⇒ durak yok/bozuk ise varsayılan iki-durak soluklaşma döner).
  out.gradientStops = inkGradientStopsNormalize(raw.gradientStops);
  out.gradientStopSel = Math.min(
    Math.max(0, Math.floor(Number(raw.gradientStopSel) || 0)),
    out.gradientStops.length - 1);
  out.deletedBrushIds = Array.isArray(raw.deletedBrushIds)
    ? [...new Set(raw.deletedBrushIds.filter(id => typeof id === 'string' && id))]
    : [];
  out.deletedCategories = Array.isArray(raw.deletedCategories)
    ? [...new Set(raw.deletedCategories.filter(id => typeof id === 'string' && id))]
    : [];
  // Eski sürümde panel kaydırıcıları ham 0–100 değerini doğrudan
  // yazıyordu. Kayıtlı panolarda 1'den büyük oranları 100'e bölerek
  // onar. `spacing` meşru olarak 2'ye (200%) kadar çıkabildiği için
  // eşiği 2'dir.
  const ratio = (v, legacyMax) => {
    const n = Number(v);
    return Number.isFinite(n) && n > legacyMax ? n / 100 : n;
  };
  out.size = clamp(Number(out.size) || base.size, INK_MIN_SIZE, INK_MAX_SIZE);
  out.opacity = clamp(ratio(out.opacity, 1), 0, 1);
  if (!Number.isFinite(out.opacity)) out.opacity = 1;
  out.hardness = clamp(ratio(out.hardness, 1), 0, 1);
  if (!Number.isFinite(out.hardness)) out.hardness = base.hardness;
  out.spacing = clamp(ratio(out.spacing, 2) || base.spacing, 0.01, 2);
  out.smoothing = clamp(ratio(out.smoothing, 0.95) || 0, 0, 0.95);
  out.mouseSpeedPressure = out.mouseSpeedPressure === undefined
    ? base.mouseSpeedPressure
    : !!out.mouseSpeedPressure;
  out.shapeSnap = out.shapeSnap === undefined ? base.shapeSnap : !!out.shapeSnap;
  out.pressureCurve = clamp(Number(out.pressureCurve) || 1, 0.2, 3);
  out.speedSize = clamp(Number(out.speedSize) || 0, 0, 0.8);
  out.flow = clamp(Number.isFinite(Number(out.flow)) ? Number(out.flow) : base.flow, 0.01, 1);
  out.flowJitter = clamp(Number.isFinite(Number(out.flowJitter)) ? Number(out.flowJitter) : base.flowJitter, 0, 1);
  out.scatter = clamp(Number.isFinite(Number(out.scatter)) ? Number(out.scatter) : base.scatter, 0, 2);
  out.taperStart = clamp(Number.isFinite(Number(out.taperStart)) ? Number(out.taperStart) : base.taperStart, 0, 3);
  out.taperEnd = clamp(Number.isFinite(Number(out.taperEnd)) ? Number(out.taperEnd) : base.taperEnd, 0, 3);
  out.color = typeof out.color === 'string' && out.color ? out.color : base.color;
  out.shape = ['arrow', 'rect', 'ellipse', 'highlight', 'line', 'arc', 'circle', 'poly'].includes(out.shape) ? out.shape : 'arrow';
  // FAZ 6 madde 11: simetri beyaz listesi — yabancı/kirli kayıt off'a düşer.
  out.symMode = ['off', 'mirrorX', 'mirrorY', 'mirrorXY', 'radial4', 'radial8']
    .includes(out.symMode) ? out.symMode : 'off';
  out.layers = Array.isArray(out.layers) ? out.layers.map(inkNormalizeLayer).filter(Boolean) : [];

  // Varsayılan yerel fırça listesi her zaman bulunsun; içe aktarılanlar
  // korunur fakat eski basit fırça kimlikleri kütüphaneye devredilir.
  const defaults = inkDefaultBrushes();
  const defaultIds = new Set(defaults.map(b => b.id));
  const rawOverrides = raw.brushOverrides && typeof raw.brushOverrides === 'object'
    ? raw.brushOverrides : {};
  const brushOverrides = {};
  const byId = new Map();
  for (const b of Array.isArray(out.brushes) ? out.brushes : []) {
    if (!b || !b.id || defaultIds.has(b.id)) continue;
    const normalized = inkNormalizeBrush(b);
    // Eski yerleşik fırçalar yeni kütüphanede karşılığı olan kimliklerdir.
    if (INK_BRUSH_ALIASES[normalized.id]) continue;
    byId.set(normalized.id, normalized);
  }
  for (const b of defaults) {
    const saved = rawOverrides[b.id];
    if (saved && typeof saved === 'object') {
      const normalized = inkNormalizeBrush(Object.assign({}, b, saved, { id: b.id }));
      brushOverrides[b.id] = normalized;
      byId.set(b.id, normalized);
    } else {
      byId.set(b.id, b);
    }
  }
  out.brushOverrides = brushOverrides;
  out.brushes = [...byId.values()];
  // Aynı ayarlı özel fırça kopyalarını tekilleştir (eski hata kalıntısı).
  inkDedupeCustomBrushes(out);
  out.brushId = inkResolveBrushId(out.brushId);
  const isBrushHidden = brush => out.deletedBrushIds.includes(brush.id) ||
    out.deletedCategories.includes(brush.category);
  if (!out.brushes.some(b => b.id === out.brushId && !isBrushHidden(b))) {
    const available = out.brushes.find(b => !isBrushHidden(b));
    out.brushId = available ? available.id : (defaults.length ? defaults[0].id : 'native-studio-pen');
  }

  // Hayalet/şablon katman ÜRETİLMEZ. Belge katmanları çizim belgesi
  // açıldığında `inkDocEnsure()` tarafından tam bir kez kurulur.
  if (!out.layers.some(l => l.id === out.activeLayerId)) {
    out.activeLayerId = out.layers.length ? out.layers[out.layers.length - 1].id : null;
  }
  out.selection = Array.isArray(out.selection) ? out.selection.filter(id => typeof id === 'string') : [];
  // B6: mod geçerlilik kontrolü — bilinmeyen değerlere 'new' verilir.
  if (!['new', 'add', 'sub', 'intersect'].includes(out.selectionMode)) out.selectionMode = 'new';
  out.autoAttach = out.autoAttach !== false;
  out.toolSettings = inkNormalizeToolSettings(out.toolSettings, out);
  for (const settings of Object.values(out.toolSettings)) {
    if (!settings.brushId) continue;
    const selected = out.brushes.find(brush => brush.id === settings.brushId);
    if (out.deletedBrushIds.includes(settings.brushId) ||
        (selected && out.deletedCategories.includes(selected.category))) {
      settings.brushId = out.brushId;
    }
  }
  inkNormalizedStates.add(out);
  return out;
}

function inkSaveBrushOverride(brush) {
  if (!brush || !brush.id || typeof inkDefaultBrushes !== 'function') return;
  const isDefault = typeof NativeBrushLibrary !== 'undefined' &&
    NativeBrushLibrary.some(item => item.id === brush.id);
  if (!isDefault) return;
  const ink = inkState();
  if (!ink.brushOverrides || typeof ink.brushOverrides !== 'object') ink.brushOverrides = {};
  ink.brushOverrides[brush.id] = inkNormalizeBrush(brush);
}

/** Araç başına ayar çantasını doğrular. Eski panolarda alan yoktur. */
const INK_TOOL_SETTING_KEYS = [
  'brushId', 'size', 'opacity', 'hardness', 'spacing',
  'smoothing', 'pressureCurve', 'speedSize', 'flow', 'flowJitter', 'scatter',
  'taperStart', 'taperEnd',
];

function inkNormalizeToolSettings(raw, ink) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const tool of Object.keys(raw)) {
    const src = raw[tool];
    if (!src || typeof src !== 'object') continue;
    const bucket = {};
    for (const key of INK_TOOL_SETTING_KEYS) {
      const value = src[key];
      if (value === undefined || value === null) continue;
      if (key === 'brushId') {
        if (typeof value === 'string' && value) bucket.brushId = inkResolveBrushId(value);
      } else if (Number.isFinite(Number(value))) {
        bucket[key] = Number(value);
      }
    }
    // Değerleri mevcut belgenin sınırlarına çek.
    if (bucket.size !== undefined) {
      bucket.size = clamp(bucket.size || ink.size, INK_MIN_SIZE, INK_MAX_SIZE);
    }
    if (bucket.opacity !== undefined) bucket.opacity = clamp(bucket.opacity, 0, 1);
    if (bucket.hardness !== undefined) bucket.hardness = clamp(bucket.hardness, 0, 1);
    if (bucket.spacing !== undefined) bucket.spacing = clamp(bucket.spacing, 0.01, 2);
    if (bucket.smoothing !== undefined) bucket.smoothing = clamp(bucket.smoothing, 0, 0.95);
    if (bucket.pressureCurve !== undefined) {
      bucket.pressureCurve = clamp(bucket.pressureCurve || 1, 0.2, 3);
    }
    if (bucket.speedSize !== undefined) bucket.speedSize = clamp(bucket.speedSize, 0, 0.8);
    if (bucket.flow !== undefined) bucket.flow = clamp(bucket.flow, 0.01, 1);
    if (bucket.flowJitter !== undefined) bucket.flowJitter = clamp(bucket.flowJitter, 0, 1);
    if (bucket.scatter !== undefined) bucket.scatter = clamp(bucket.scatter, 0, 2);
    if (bucket.taperStart !== undefined) bucket.taperStart = clamp(bucket.taperStart, 0, 3);
    if (bucket.taperEnd !== undefined) bucket.taperEnd = clamp(bucket.taperEnd, 0, 3);
    out[tool] = bucket;
  }
  return out;
}

function inkNormalizeBrush(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const dynRaw = raw.dynamics && typeof raw.dynamics === 'object' ? raw.dynamics : {};
  const sizeMin = Number.isFinite(dynRaw.sizeMin) ? clamp(dynRaw.sizeMin, 0, 1) : 0.18;
  const sizeMax = Number.isFinite(dynRaw.sizeMax) ? clamp(dynRaw.sizeMax, sizeMin, 1) : 1;
  const dualRaw = raw.dual && typeof raw.dual === 'object' ? raw.dual : null;
  const colorRaw = raw.colorDynamics && typeof raw.colorDynamics === 'object'
    ? raw.colorDynamics : {};
  const tipRaw = raw.tipOptions && typeof raw.tipOptions === 'object' ? raw.tipOptions : {};
  const tipOptions = {};
  for (const key of Object.keys(tipRaw)) {
    const value = tipRaw[key];
    if (typeof value === 'number' && Number.isFinite(value)) tipOptions[key] = value;
    else if (typeof value === 'boolean' || typeof value === 'string') tipOptions[key] = value;
  }
  /* Kategorisiz fırça kütüphanede hiçbir listeye düşmez (kategori filtresi
     `brush.category === categoryId`). İçe aktarılan .abr fırçaları kategori
     taşımadığı için "import ettim ama kütüphanede yok" oluyordu; boş
     kategoriyi Custom Brushes'a bağla. Eski kayıtlar da buradan onarılır. */
  const category = typeof raw.category === 'string' && raw.category
    ? raw.category : 'custom';
  const badge = typeof raw.badge === 'string' && raw.badge
    ? raw.badge : (category === 'custom' ? 'Custom' : '');
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Brush',
    kind: raw.kind === 'abr' ? 'abr' : 'procedural',
    // Yerel kütüphane alanları. `tip` doluysa uç prosedürel üreticiden gelir;
    // boşsa eski radyal maske kullanılır (içe aktarılmış uçlar gibi).
    tip: typeof raw.tip === 'string' ? raw.tip : '',
    tipOptions,
    category,
    badge,
    description: typeof raw.description === 'string' ? raw.description : '',
    size: Number.isFinite(raw.size) ? clamp(raw.size, INK_MIN_SIZE, INK_MAX_SIZE) : undefined,
    opacity: Number.isFinite(raw.opacity) ? clamp(raw.opacity, 0, 1) : undefined,
    smoothing: Number.isFinite(raw.smoothing) ? clamp(raw.smoothing, 0, 0.95) : undefined,
    pressureCurve: Number.isFinite(raw.pressureCurve) ? clamp(raw.pressureCurve, 0.2, 3) : undefined,
    speedSize: Number.isFinite(raw.speedSize) ? clamp(raw.speedSize, 0, 0.8) : undefined,
    angleFollow: !!raw.angleFollow,
    tool: raw.tool === 'pencil' ? 'pencil' : '',
    hardness: Number.isFinite(raw.hardness) ? clamp(raw.hardness, 0, 1) : 0.6,
    spacing: Number.isFinite(raw.spacing) ? clamp(raw.spacing, 0.01, 2) : 0.1,
    scatter: Number.isFinite(raw.scatter) ? clamp(raw.scatter, 0, 2) : 0,
    scatterX: Number.isFinite(raw.scatterX) ? clamp(raw.scatterX, 0, 2) :
      (Number.isFinite(raw.scatter) ? clamp(raw.scatter, 0, 2) : 0),
    scatterY: Number.isFinite(raw.scatterY) ? clamp(raw.scatterY, 0, 2) :
      (Number.isFinite(raw.scatter) ? clamp(raw.scatter, 0, 2) : 0),
    scatterCount: Number.isFinite(raw.scatterCount)
      ? Math.round(clamp(raw.scatterCount, 1, 16)) : 1,
    scatterCountJitter: Number.isFinite(raw.scatterCountJitter)
      ? clamp(raw.scatterCountJitter, 0, 1) : 0,
    tipId: typeof raw.tipId === 'string' ? raw.tipId : '',
    roundness: Number.isFinite(raw.roundness) ? clamp(raw.roundness, 0.05, 1) : 1,
    angle: Number.isFinite(raw.angle) ? raw.angle : 0,
    flow: Number.isFinite(raw.flow) ? clamp(raw.flow, 0.01, 1) : 1,
    taperStart: Number.isFinite(raw.taperStart) ? clamp(raw.taperStart, 0, 3) : 0,
    taperEnd: Number.isFinite(raw.taperEnd) ? clamp(raw.taperEnd, 0, 3) : 0,
    // Akış dinamiği: her damlada küçük rastgele azalma (referans uygulama `Flow
    // Dynamics`). 0 = sabit akış; eski panolarda alan yoktur.
    flowJitter: Number.isFinite(raw.flowJitter) ? clamp(raw.flowJitter, 0, 1) : 0,
    texture: !!raw.texture,
    // Doku: `texture` açıkken gürültünün derinliği (0..1), ölçeği ve
    // `.abr` desen kimliği. Eski boolean kayıtlar 0.26 derinlikle çalışır.
    textureDepth: Number.isFinite(raw.textureDepth) ? clamp(raw.textureDepth, 0, 1) : 0.26,
    textureScale: Number.isFinite(raw.textureScale) ? clamp(raw.textureScale, 0.1, 8) : 1,
    textureBrightness: Number.isFinite(raw.textureBrightness) ? clamp(raw.textureBrightness, -1, 1) : 0,
    textureContrast: Number.isFinite(raw.textureContrast) ? clamp(raw.textureContrast, 0.25, 3) : 1,
    textureJitter: Number.isFinite(raw.textureJitter) ? clamp(raw.textureJitter, 0, 1) : 0,
    textureId: typeof raw.textureId === 'string' ? raw.textureId :
      (raw.texture ? 'paper' : ''),
    textureName: typeof raw.textureName === 'string' ? raw.textureName : '',
    textureBlend: typeof raw.textureBlend === 'string' ? raw.textureBlend : 'multiply',
    textureEachTip: !!raw.textureEachTip,
    noise: Number.isFinite(raw.noise) ? clamp(raw.noise, 0, 1) : 0,
    wetEdges: Number.isFinite(raw.wetEdges) ? clamp(raw.wetEdges, 0, 1) : 0,
    buildUp: raw.buildUp !== false,
    airbrush: !!raw.airbrush,
    // referans tarzı uç yığını: aynı uç türünden `tipVariants` adet tohumla
    // üretilir, damla başına rastgele seçilir. stampFlipX/Y olasılıkla damlayı
    // aynalar, tipRotation damlaya rastgele açı katar. Eski panolarda 1/0.
    tipVariants: Number.isFinite(raw.tipVariants)
      ? Math.round(clamp(raw.tipVariants, 1, 8)) : 1,
    tipSeed: Number.isFinite(raw.tipSeed) ? Math.round(raw.tipSeed) : 0,
    stampFlipX: Number.isFinite(raw.stampFlipX) ? clamp(raw.stampFlipX, 0, 1) : 0,
    stampFlipY: Number.isFinite(raw.stampFlipY) ? clamp(raw.stampFlipY, 0, 1) : 0,
    tipRotation: Number.isFinite(raw.tipRotation) ? clamp(raw.tipRotation, 0, 1) : 0,
    colorDynamics: {
      background: /^#[0-9a-f]{6}$/i.test(colorRaw.background || '')
        ? colorRaw.background : '#ffffff',
      foregroundBackground: Number.isFinite(colorRaw.foregroundBackground)
        ? clamp(colorRaw.foregroundBackground, 0, 1) : 0,
      hueJitter: Number.isFinite(colorRaw.hueJitter) ? clamp(colorRaw.hueJitter, 0, 1) : 0,
      saturationJitter: Number.isFinite(colorRaw.saturationJitter)
        ? clamp(colorRaw.saturationJitter, 0, 1) : 0,
      brightnessJitter: Number.isFinite(colorRaw.brightnessJitter)
        ? clamp(colorRaw.brightnessJitter, 0, 1) : 0,
      purity: Number.isFinite(colorRaw.purity) ? clamp(colorRaw.purity, 0, 1) : 0,
    },
    dynamics: {
      sizeMin,
      sizeMax,
      src: ['velocity', 'random'].includes(dynRaw.src) ? dynRaw.src : 'pressure',
      sizeJitter: Number.isFinite(dynRaw.sizeJitter) ? clamp(dynRaw.sizeJitter, 0, 1) : 0,
      angleJitter: Number.isFinite(dynRaw.angleJitter) ? clamp(dynRaw.angleJitter, 0, 1) : 0,
      roundnessMin: Number.isFinite(dynRaw.roundnessMin) ? clamp(dynRaw.roundnessMin, 0.05, 1) : 1,
      roundnessJitter: Number.isFinite(dynRaw.roundnessJitter)
        ? clamp(dynRaw.roundnessJitter, 0, 1) : 0,
      scatterJitter: Number.isFinite(dynRaw.scatterJitter) ? clamp(dynRaw.scatterJitter, 0, 1) : 0,
      spacingJitter: Number.isFinite(dynRaw.spacingJitter) ? clamp(dynRaw.spacingJitter, 0, 1) : 0,
      opacityMin: Number.isFinite(dynRaw.opacityMin) ? clamp(dynRaw.opacityMin, 0, 1) : 0.35,
      opacityJitter: Number.isFinite(dynRaw.opacityJitter) ? clamp(dynRaw.opacityJitter, 0, 1) : 0,
      opacitySrc: dynRaw.opacitySrc === 'random' ? 'random' : 'pressure',
    },
    dual: dualRaw && Number.isFinite(dualRaw.diameter) && dualRaw.diameter > 0
      ? {
        brushId: typeof dualRaw.brushId === 'string' ? dualRaw.brushId : '',
        tipId: typeof dualRaw.tipId === 'string' ? dualRaw.tipId : '',
        diameter: clamp(dualRaw.diameter, 1, 4096),
        scale: Number.isFinite(dualRaw.scale) ? clamp(dualRaw.scale, 0.1, 4) : 1,
        spacing: Number.isFinite(dualRaw.spacing) ? clamp(dualRaw.spacing, 0.25, 3) : 1,
        scatter: Number.isFinite(dualRaw.scatter) ? clamp(dualRaw.scatter, 0, 2) : 0,
        blend: ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
          'color-burn', 'color-dodge', 'soft-light', 'hard-light'].includes(dualRaw.blend)
          ? dualRaw.blend : 'source-over',
        hardness: Number.isFinite(dualRaw.hardness) ? clamp(dualRaw.hardness, 0, 1) : 0.6,
        roundness: Number.isFinite(dualRaw.roundness) ? clamp(dualRaw.roundness, 0.05, 1) : 1,
        angle: Number.isFinite(dualRaw.angle) ? dualRaw.angle : 0,
        flow: Number.isFinite(dualRaw.flow) ? clamp(dualRaw.flow, 0.01, 1) : 0.72,
      }
      : null,
  };
}

function inkNormalizeLayer(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  /* FAZ 1 (gruplar): kind = attached | global | group.
     `group` = klasör düzlemi: kendi görünürlük/opaklık/blend'i olur,
     çizilemez (strokes yok); üyeleri `attached` katmanlardır ve
     `parentId` ile klasörlerine bağlanır (parent silinirse üyeler kalır). */
  const kind = raw.kind === 'attached' ? 'attached'
    : raw.kind === 'group' ? 'group' : 'global';
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Layer',
    kind,
    ownerId: kind === 'global' ? null : (raw.ownerId || null),
    parentId: kind === 'attached' && raw.parentId ? String(raw.parentId) : null,
    visible: raw.visible !== false,
    locked: !!raw.locked,
    // Alfa kilidi: yalnızca mevcut piksellerin içine basar (source-atop).
    alphaLock: !!raw.alphaLock,
    // Kırpma maskesi: altındaki katmana kırpılır (Porter-Duff atop).
    clip: !!raw.clip,
    opacity: Number.isFinite(raw.opacity) ? clamp(raw.opacity, 0, 1) : 1,
    blend: INK_BLEND_MODES.includes(raw.blend) ? raw.blend : 'normal',
    // FAZ 1 (piksel-gerçek merge-down / flatten): pişmiş raster. Vuruş
    // oynatma panosu yerine birebir piksel görüntüsü (dataURL); yeni
    // vuruşlar üstüne normal akışta eklenir, rebuild önce bunu basar.
    baked: (kind === 'attached' && raw.baked &&
      typeof raw.baked.src === 'string' && raw.baked.src &&
        Number.isFinite(raw.baked.w) && raw.baked.w > 0 &&
        Number.isFinite(raw.baked.h) && raw.baked.h > 0)
      ? { src: raw.baked.src, w: raw.baked.w, h: raw.baked.h }
      : null,
    /* FAZ 1B (Layer Mask): per-katman ikinci alfa kanalı (plan madde 4).
       dataURL PNG; ŞEFFAFLIK = gizlem, OPK ALFA = göster (destination-in
       çarpımı: a_o = a_d × a_mask). Yanlılık yok: beyaz maske tüm günü,
       şeffaf maske tüm gizlemi taşır. Yalnızca attached katmanlarda. */
    mask: (kind === 'attached' && raw.mask &&
      typeof raw.mask.src === 'string' && raw.mask.src &&
        Number.isFinite(raw.mask.w) && raw.mask.w > 0 &&
        Number.isFinite(raw.mask.h) && raw.mask.h > 0)
      ? { src: raw.mask.src, w: raw.mask.w, h: raw.mask.h }
      : null,
    plane: kind === 'global' ? (raw.plane === 'above' ? 'above' : 'below') : 'above',
    pxW: Number.isFinite(raw.pxW) ? raw.pxW : 0,
    pxH: Number.isFinite(raw.pxH) ? raw.pxH : 0,
    strokes: Array.isArray(raw.strokes) ? raw.strokes.map(inkNormalizeStroke).filter(Boolean) : [],
  };
}

function inkNormalizeStroke(raw) {
  if (!raw || !Array.isArray(raw.points) || !raw.points.length) return null;
  return {
    id: raw.id || ('sk_' + newId()),
    kind: ['shape', 'fill', 'smudge', 'liquify', 'gradient'].includes(raw.kind) ? raw.kind : 'stroke',
    tool: ['eraser', 'fill', 'smudge', 'liquify', 'gradient'].includes(raw.tool) ? raw.tool : 'brush',
    shape: ['arrow', 'rect', 'ellipse', 'highlight', 'line', 'arc', 'circle', 'poly'].includes(raw.shape) ? raw.shape : '',
    color: typeof raw.color === 'string' ? raw.color : '#ffffff',
    size: Number.isFinite(raw.size) ? raw.size : 12,
    opacity: Number.isFinite(raw.opacity) ? clamp(raw.opacity, 0, 1) : 1,
    hardness: Number.isFinite(raw.hardness) ? clamp(raw.hardness, 0, 1) : 0.6,
    spacing: Number.isFinite(raw.spacing) ? clamp(raw.spacing, 0.01, 2) : 0.1,
    // P3: hız incelmesi vuruşun parçasıdır; kayıt/geri al yoluyla
    // kaybolursa aynı vuruş farklı kalınlıkta yeniden çizilirdi.
    speedSize: Number.isFinite(raw.speedSize) ? clamp(raw.speedSize, 0, 0.8) : 0,
    flow: Number.isFinite(raw.flow) ? clamp(raw.flow, 0.01, 1) : undefined,
    flowJitter: Number.isFinite(raw.flowJitter) ? clamp(raw.flowJitter, 0, 1) : undefined,
    fillTolerance: Number.isFinite(raw.fillTolerance) ? clamp(raw.fillTolerance, 0, 255) : 24,
    taperStart: Number.isFinite(raw.taperStart) ? clamp(raw.taperStart, 0, 3) : 0,
    taperEnd: Number.isFinite(raw.taperEnd) ? clamp(raw.taperEnd, 0, 3) : 0,
    brushId: typeof raw.brushId === 'string' ? raw.brushId : '',
    scatter: Number.isFinite(raw.scatter) ? clamp(raw.scatter, 0, 2) : 0,
    closed: !!raw.closed,
    // Vuruş başına alfa kilidi durumu: kilit daha sonra açılırsa eski
    // vuruşların davranışı değişmemelidir (referans uygulama anlambilimi);
    // bu yüzden durum katmandan değil, vuruşa kopyalanır.
    lockAlpha: !!raw.lockAlpha,
    /* FAZ 7.W: çok-duraklı gradyan durakları — vuruşa gömülü deep kopya.
       Eski vuruşlarda alan yoktur; normalize alan eklemez (legacy bit-
       birebir korunur). Duraklar normalize edilerek (sıralı, kelepçeli)
       alınır; yoksa gradyan iki-durak soluklaşmaya düşer. */
    ...(Array.isArray(raw.stops) && raw.stops.length >= 2
      ? { stops: inkGradientStopsNormalize(raw.stops)
        .map(s => ({ pos: s.pos, color: s.color, alpha: s.alpha })) }
      : {}),
    points: raw.points.slice(0, INK_MAX_STROKE_POINTS).map(p => {
      const point = {
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        p: Number.isFinite(p.p) ? clamp(p.p, 0, 1) : 1,
      };
      // `s` = 0..1 hız etkisi (P3). Yalnızca gerçekten varsa saklanır;
      // eski panolarda noktaların çoğu bu alanı taşımaz.
      const speed = Number(p.s);
      if (Number.isFinite(speed) && speed > 0.001) point.s = clamp(speed, 0, 1);
      // Eğim yalnızca gerçekten varsa saklanır: fare vuruşları şişmesin.
      const tilt = Number(p.t);
      if (Number.isFinite(tilt) && tilt > 0.02) {
        point.t = clamp(tilt, 0, 1);
        const angle = Number(p.a);
        point.a = Number.isFinite(angle) ? angle : 0;
      }
      // Tuval dışına çıkıp geri dönülen yer: parçalar arasında çizgi çizilmez.
      if (p.br) point.br = 1;
      return point;
    }),
  };
}

function inkMakeLayer(options = {}) {
  const kind = options.kind === 'attached' ? 'attached'
    : options.kind === 'group' ? 'group' : 'global';
  return {
    id: options.id || ('ly_' + newId()),
    name: options.name || (kind === 'attached' ? 'Drawing'
      : kind === 'group' ? 'Group' : 'Layer'),
    kind,
    ownerId: kind === 'global' ? null : (options.ownerId || null),
    /* Klasör üyeliği yalnızca çizim katmanlarına bağlanır; klasörün
       kendisi kökte durur (FAZ 1: iç içe klasör henüz yok). */
    parentId: kind === 'attached' && options.parentId ? String(options.parentId) : null,
    visible: options.visible !== false,
    locked: !!options.locked,
    alphaLock: !!options.alphaLock,
    clip: !!options.clip,
    opacity: Number.isFinite(options.opacity) ? clamp(options.opacity, 0, 1) : 1,
    blend: INK_BLEND_MODES.includes(options.blend) ? options.blend : 'normal',
    plane: kind === 'global' && options.plane === 'above' ? 'above' : 'below',
    pxW: Number.isFinite(options.pxW) ? options.pxW : 0,
    pxH: Number.isFinite(options.pxH) ? options.pxH : 0,
    strokes: [],
  };
}

/* =========================================================
   durum erişimi
   ========================================================= */
function inkState() {
  if (!state.ink) {
    state.ink = inkCreateState();
    inkNormalizedStates.add(state.ink);
  }
  return state.ink;
}

function inkEnsureState() {
  if (!state.ink) return inkState();
  if (!inkNormalizedStates.has(state.ink)) {
    state.ink = inkNormalizeState(state.ink);
  }
  return state.ink;
}

function inkLayerById(id) {
  return inkState().layers.find(l => l.id === id) || null;
}

function inkActiveLayer() {
  const ink = inkState();
  let layer = inkLayerById(ink.activeLayerId);
  if (!layer) {
    layer = ink.layers[ink.layers.length - 1] || null;
    ink.activeLayerId = layer ? layer.id : null;
  }
  return layer;
}

function inkSetActiveLayer(id) {
  const layer = inkLayerById(id);
  if (!layer) return null;
  inkState().activeLayerId = layer.id;
  inkState().selection = [];
  return layer;
}

function inkItemForLayer(layer) {
  return layer && layer.kind === 'attached' ? getItem(layer.ownerId) : null;
}

function inkLayersForOwner(ownerId) {
  return inkState().layers.filter(l => l.kind === 'attached' && l.ownerId === ownerId);
}

/** FAZ 1 (gruplar): plan/z sıralaması katmanları — çizim katmanları
 *  (attached) + o görselin klasör düzlemleri (group), dizideki mevcut
 *  sırayla (alttan → üste). `inkLayersForOwner` çizim filtresini korur;
 *  compositor gezgini ve panel sırası klasörlerin de dönmesi gerekir. */
function inkOwnerStackLayers(ownerId) {
  return inkState().layers.filter(l =>
    (l.kind === 'attached' || l.kind === 'group') && l.ownerId === ownerId);
}

/** Öğeye ait katman yığınının ESAS dizesindeki bitiş noktası: owner'a
 *  ait son katmandan sonrası. Yeni global katmanlar ve yeni klasörler
 *  buraya eklenir (ekleme sırası = üst üste).
 *  Alt düzlem (plane 'below') global katmanlar klasör ÜSTÜNE değil,
 *  dizinin sonuna eklendiği için bu indeks taşınmaz. */
function inkOwnerStackInsertIndex(ownerId) {
  const layers = inkState().layers;
  const stack = layers.filter(l =>
    (l.kind === 'attached' || l.kind === 'group') && l.ownerId === ownerId);
  return stack.length
    ? layers.indexOf(stack[stack.length - 1]) + 1
    : layers.length;
}

/** Klasörün sıradaki adı: "Grup N" (N = bu görseldeki klasör sayısı+1). */
function inkGroupNextName(ownerId) {
  return 'Grup ' + (inkGroupsForOwner ? inkGroupsForOwner(ownerId).length + 1 : 1);
}

/** Yeni klasör grubu: görselin üstüne boş düzlem açar; üyeler
 *  `parentId` ile bağlanır ve dizede klasörün hemen altına yerleşir. */
function inkCreateGroup(ownerId, options = {}) {
  const it = getItem(ownerId);
  if (!it) return null;
  const layers = inkState().layers;
  const layer = inkMakeLayer({
    kind: 'group',
    ownerId,
    name: options.name || inkGroupNextName(ownerId),
    pxW: Number.isFinite(options.pxW) ? options.pxW : Math.max(64, Math.round(it.w * 2)),
    pxH: Number.isFinite(options.pxH) ? options.pxH : Math.max(64, Math.round(it.h * 2)),
  });
  const insertAt = inkOwnerStackInsertIndex(ownerId);
  layers.splice(insertAt, 0, layer);
  inkSetActiveLayer(layer.id);
  return layer;
}

/** Grup üyesi ekler (istersen mevcut bir çizim katmanını üye yapar):
 *  katman dizede klasör başlığının hemen altına taşınır, böylece gezgin
 *  "üyeler bitişik, üstte klasör" hedefini korur. parentId yalnız
 *  attached katmana bağlanır (normalizasyon şeması). */
function inkAddGroupMember(ownerId, groupId, layerOrOptions) {
  const group = inkLayerById(groupId);
  if (!group || group.kind !== 'group' || group.ownerId !== ownerId) return null;
  let layer = null;
  if (typeof layerOrOptions === 'object' && layerOrOptions && layerOrOptions.id) {
    layer = layerOrOptions;
  } else {
    layer = inkMakeLayer({
      name: (layerOrOptions && layerOrOptions.name) || (typeof inkDocNextName === 'function'
        ? inkDocNextName(ownerId) : 'Layer'),
      kind: 'attached',
      ownerId,
      pxW: group.pxW, pxH: group.pxH,
    });
  }
  if (!layer || layer.kind !== 'attached' || layer.ownerId !== ownerId) return null;
  layer.parentId = group.id;
  // FAZ 8.C ölçümünde bulunan bug: mevcut katman üye yapılırken eski
  // konumundan çıkarılmadan yeniden ekleniyor → aynı katman ink.layers
  // içinde İKİ referansla duruyordu (stack corruption). Tek referans:
  const layersArr = inkState().layers;
  const li = layersArr.indexOf(layer);
  if (li >= 0) layersArr.splice(li, 1);
  // Yapısal değişiklik: eski grup rasterını ve plan önbelleğini baypas et.
  if (typeof inkBumpLayerGen === 'function') {
    inkBumpLayerGen(group.id);
    inkBumpLayerGen(layer.id);
  }
  // FAZ 8.D ölçümünde bulunan bug: mevcut katman taşınırken çıkarma
  // SONRASI stack yeniden hesaplanıyor, gi=0 düşüyor ve katman dizede
  // grubun ÜSTÜNE giriyordu ([GRUP, üye]) → plan eşleşmesi members:[]
  // kalıyor, flatten reddediyordu. Doğru yer: dizede grubun hemen ALTı —
  // yani grubun kendi dizin noktası (üye bloğu tamamı grubu izler).
  const layersArr2 = inkState().layers;
  const gi2 = layersArr2.indexOf(group);
  layersArr2.splice(gi2 >= 0 ? gi2 : layersArr2.length, 0, layer);
  inkSetActiveLayer(layer.id);
  return layer;
}

/** Katmanı klasörden çıkarır: üyelik kopar, katman dizideki yerinde
 *  sıradan çizim katmanı olarak kalır (gezgin yalnız bitişik üyeleri
 *  birleştirdiği için konum güvenlidir). */
function inkRemoveGroupMember(layerId) {
  const layer = inkLayerById(layerId);
  if (!layer || layer.kind !== 'attached' || !layer.parentId) return null;
  const groupId = layer.parentId;
  layer.parentId = null;
  if (typeof inkBumpLayerGen === 'function') {
    inkBumpLayerGen(groupId);
    inkBumpLayerGen(layer.id);
  }
  return layer;
}

/** Bir görselin tüm klasör katmanlarını döndürür (panel sayacı vs). */
function inkGroupsForOwner(ownerId) {
  return inkState().layers.filter(l => l.kind === 'group' && l.ownerId === ownerId);
}

function inkEnsureAttachedLayer(ownerId, options = {}) {
  const existing = inkLayersForOwner(ownerId);
  if (existing.length) return existing[existing.length - 1];
  const it = getItem(ownerId);
  if (!it) return null;
  const layer = inkMakeLayer({
    name: options.name || (typeof inkDocNextName === 'function' ? inkDocNextName(ownerId) : 'Layer 1'),
    kind: 'attached',
    ownerId,
  });
  inkState().layers.push(layer);
  inkState().activeLayerId = layer.id;
  return layer;
}

/* =========================================================
   referans fotoğrafı katmana işleme (Layer 1 = fotoğraf)
   ---------------------------------------------------------
   Kullanıcı isteği: "referans fotoğraf seçip çizim yap dediysem
   sağdaki Layer 1 aslında o fotoğraf olmalı; efektler böyle çalışır".
   Bağlı katman tazeyse (vuruş yok, baked yok) fotoğraf katmanın baked
   rasterına pişirilir. Böylece ekran, dışa aktarım ve FX girdisi AYNI
   tek kaynağı (katman) kullanır: efektler fotoğrafı da işler, katman
   küçük resmi fotoğrafı gösterir. Kullanıcı vuruş/silme yaptıysa baked
   yeniden üretilmez (düzenleme kaybolmaz); fotoğraf değişirse tazelenir. */
function inkLayerPhotoSig(it, img) {
  const src = img ? (img.currentSrc || img.src || '') : '';
  let hash = 0;
  for (let i = 0; i < src.length; i++) hash = (Math.imul(hash, 31) + src.charCodeAt(i)) | 0;
  return (it ? it.id : '') + '|'
    + (img ? img.naturalWidth + 'x' + img.naturalHeight : '0x0') + '|' + hash;
}

function inkLayerCanvasHasInk(canvas) {
  try {
    const w = 16, h = 16;
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const g = t.getContext('2d', { willReadFrequently: true });
    if (!g) return true;
    g.drawImage(canvas, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    return false;
  } catch {
    return true;
  }
}

function inkLayerBakePhoto(it) {
  if (!it || it.kind !== 'image') return false;
  const layers = typeof inkLayersForOwner === 'function' ? inkLayersForOwner(it.id) : [];
  const layer = layers.filter(l => l.kind === 'attached' && l.ownerId === it.id).pop();
  if (!layer) return false;
  const el = typeof elMap !== 'undefined' ? elMap.get(it.id) : null;
  const img = el ? el.querySelector('.media img') : null;
  const strokes = layer.strokes || [];
  if (strokes.length) return false;                 // kullanıcı düzenlemesi var
  /* Katmanda fotoğraf dışı bir bake (birleştirme/flatten içeriği) varsa
     üzerine yazma: yalnız kendi fotoğraf bake'imiz tazelenir. */
  if (layer.baked && !layer.photoBakeSig) return false;
  if (layer.baked && layer.photoBakeSig === inkLayerPhotoSig(it, img)) return false;
  if (!img || !img.complete || !img.naturalWidth) {
    if (img && !img.complete && img.dataset.inkBakeHooked !== '1') {
      img.dataset.inkBakeHooked = '1';
      img.addEventListener('load', () => {
        delete img.dataset.inkBakeHooked;
        try { inkLayerBakePhoto(it); } catch { /* sessiz */ }
      }, { once: true });
    }
    return false;
  }
  const canvas = typeof inkEnsureItemCanvas === 'function' ? inkEnsureItemCanvas(layer) : null;
  if (!canvas || !canvas.width || !canvas.height) return false;
  /* Katmanda zaten piksel varsa (ör. içe aktarılmış/birleştirilmiş içerik)
     üzerine yazma. */
  if (!layer.baked && typeof inkLayerCanvasHasInk === 'function'
    && inkLayerCanvasHasInk(canvas)) return false;
  const w = canvas.width, h = canvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const g = tmp.getContext('2d', { colorSpace: 'srgb' });
  if (!g) return false;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  let src = '';
  try { src = tmp.toDataURL('image/webp', 0.95); } catch { src = ''; }
  if (!src || src.indexOf('data:image/webp') !== 0) {
    try { src = tmp.toDataURL('image/png'); } catch { return false; }
  }
  layer.baked = { src, w, h };
  layer.photoBakeSig = inkLayerPhotoSig(it, img);
  layer.pxW = w; layer.pxH = h;
  if (typeof inkBakedRasterPrime === 'function') inkBakedRasterPrime(layer.id, src, w, h, tmp);
  if (typeof inkRebuildItemLayer === 'function') inkRebuildItemLayer(layer);
  else if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  if (inkRuntime && inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
  if (typeof inkFxInvalidate === 'function') inkFxInvalidate(it.id);
  if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
  if (typeof inkSyncDom === 'function') inkSyncDom(it);
  if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
  if (typeof scheduleSave === 'function') scheduleSave();
  return true;
}

function inkLayerDisplayName(layer) {
  if (!layer) return '';
  if (layer.kind !== 'attached') return layer.name;
  const it = getItem(layer.ownerId);
  return it ? layer.name : layer.name + ' (no linked image)';
}

/** Global katmanlar: alttaki eskizler önce, üstteki notlar sonra. */
function inkLayerZ(layer, index) {
  if (!layer) return 1;
  if (layer.kind === 'attached') return 2 + index; // öğe içinde kullanılır
  return layer.plane === 'above'
    ? 200000 + index
    : 2 + index;
}

/* =========================================================
   geometri — katman uzayı ↔ dünya
   ========================================================= */
function inkLocalToWorld(layer, p) {
  if (!layer) return { x: p.x, y: p.y };
  if (layer.kind === 'global') return { x: p.x, y: p.y };
  const it = inkItemForLayer(layer);
  if (!it) return null;
  const h = it.h || 0;
  const lx = p.x * it.w;
  const ly = p.y * h;
  const c = itemCenter(it);
  const r = (it.rot || 0) * Math.PI / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = lx - it.w / 2;
  const dy = ly - h / 2;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function inkWorldToLocal(layer, world) {
  if (!layer) return { x: world.x, y: world.y };
  if (layer.kind === 'global') return { x: world.x, y: world.y };
  const it = inkItemForLayer(layer);
  if (!it || !it.w) return { x: 0, y: 0 };
  const h = it.h || 0;
  const c = itemCenter(it);
  const r = (it.rot || 0) * Math.PI / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = world.x - c.x;
  const dy = world.y - c.y;
  const lx = dx * cos + dy * sin + it.w / 2;
  const ly = -dx * sin + dy * cos + h / 2;
  return { x: lx / it.w, y: h ? ly / h : 0 };
}

/** Dünya birimindeki fırça çapını katman uzayına çevirir. */
function inkWorldSizeToLocal(layer, sizeWorld) {
  if (!layer || layer.kind === 'global') return sizeWorld;
  const it = inkItemForLayer(layer);
  return it && it.w ? sizeWorld / it.w : 0;
}

/** Shift düz-çizgi kilidi (Photoshop tarzı): `point` noktası, vuruşun
    İLK noktası olan `start`'dan geçen KİLİTLİ eksene izdüşürülür.
    `dims`: uzayın piksel ölçüsü (katman w/h) — kenar oranı 1 değilse
    açı kâğıt piksellerinde ölçülüp ekranda eğilmez; null ise uzay
    tekoranlı kabul edilir (global katman dünya uzayı). Nokta
    kelepçelenmez: tuval dışına çizim davranışı aynen korunur.

    Tur 4h · kalıcı eksen (v2 — geçici eksen + kararlılık donması):
    Eskiden her örnek başlangıca göre ANLIK en yakın 45°'ye
    yuvarlanıyordu: sağa çizerken aşağı-yukarı oynatma atan2'yi
    0° ↔ ±45°/±90° arasında gezdirir, eksen örnekten örneğe değişir,
    yumuşatıcı + Catmull ara interpolasyonu sıçramaları eğriye çevirir
    (kullanıcı raporu: Shift + dikey oynatma → kıvrımlı sapma). v1'in
    "ilk ≥3px'te kilitle" tasarımı ise değme titremesine kırılgandı:
    ilk sallantı çarpması 45°'yi kilitliyor, tüm çizgi diyagonale
    sapıyordu. Yeni tasarım:
      · Geçici faz: eksen ANLIK yönden değil, başlangıçtan NET yön
        uzaklığının en yakın 45°'sinden alınır ve her örnekte
        güncellenir (sallantı nette ortalanır).
      · Donma: geçici eksen ~INK_LOCK_AXIS_FREEZE_PX yol ve
        ≥5 örnek boyunca DEĞİŞMEZSE — ve başlangıçtan NET yer
        değiştirme INK_LOCK_NET_MIN_PX'i aşmışsa — o açıya
        KİLİTLENİR; artık dik bileşen tamamen atılır — aşağı-yukarı
        oynatma çizgiyi bükmez, eksen boyu uzatmaz da (kullanıcı:
        "aşağı yukarı yaparsam sağa sola gidilmemeli").
      · Neden NET eşik? Sallantı ortalanmadan niyet güvenilir değildir:
        ±35px salınan stres izinde ilk 6 örnek (net yalnız ~45px) 45°
        kovasında gezinir — yol+örnek eşiği o erken koşuda donar,
        tüm çizgi diyagonale sapar (probe A2: maxYDev 294px,
        axisDeg=45). NET ≥100px'te salınım başlangıç yönü etrafında
        ortalanır; o anda net açı gerçek niyeti taşır.
      · Güvenlik: NET ≥300px (uzun vuruş, niyet açık) ya da 500px yol
        (sayıklama bitmez) aşımında son geçici açıya zorla dondurulur.
    `lock` vuruş objesinde taşınır ({axis:null,...} ile başlar);
    `lock.axis` null'a çekilmesi yeniden seçim sağlar — Shift
    bırakılıp yeniden basıldığında çağrı hattı tüm durumu sıfırlar.
    `lock` verilmezse eski tek-örnek davranış korunur (geriye
    uyumluluk). */
const INK_LOCK_AXIS_FREEZE_PX = 40;
const INK_LOCK_AXIS_FREEZE_MIN_SAMPLES = 5;
const INK_LOCK_NET_MIN_PX = 100;
const INK_LOCK_NET_FORCE_PX = 300;
const INK_LOCK_AXIS_FREEZE_MAX_PX = 500;
function inkStraightLockPoint(start, point, dims, lock) {
  if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.y)) return point;
  const dw = dims && dims.w ? dims.w : 1;
  const dh = dims && dims.h ? dims.h : 1;
  const dx = (point.x - start.x) * dw;
  const dy = (point.y - start.y) * dh;
  const dist = Math.hypot(dx, dy);
  let cos, sin;
  if (lock) {
    // Ham yol uzunluğu bütçesi (sallantı dahil): donma kararları bununla.
    if (lock.lx != null && lock.ly != null) {
      lock.travel = (lock.travel || 0) + Math.hypot(dx - lock.lx, dy - lock.ly);
    }
    lock.lx = dx;
    lock.ly = dy;
    if (lock.axis != null) {
      cos = lock.cos;
      sin = lock.sin;
    } else {
      // Hareket tek pikselden küçükse yön belirsiz: kenetleme yok.
      if (!(dist > 1)) return point;
      const step = Math.PI / 4;
      const prov = Math.round(Math.atan2(dy, dx) / step) * step;
      const travel = lock.travel || 0;
      // Kararlılık donması: geçici açı son değişiminden bu yana hem
      // FREEZE_PX yol taranarak hem de FREEZE_MIN_SAMPLES örnek
      // boyunca korunduysa — ve NET yer değiştirme eşiği aşıldıysa —
      // kilitlenir. Yalnız yol/örnek eşiği yetmez: ±35px salınan
      // stres izinde ilk 6 örnek ~45px NET ile 45° kovasında gezinir,
      // erken donma tüm çizgiyi diyagonale sapıtıyordu (probe A2:
      // maxYDev 294px). NET eşiği sallantının ortalanmasını bekler;
      // NET ≥300 (uzun vuruş) ya da 500px yol (sayıklama bitmez)
      // aşımında son geçici açıya zorla donulur.
      if (lock.prov !== prov) {
        lock.prov = prov;
        lock.stableAt = travel;
        lock.stableCount = 1;
      } else {
        lock.stableCount = (lock.stableCount || 0) + 1;
      }
      if ((travel - (lock.stableAt || 0) >= INK_LOCK_AXIS_FREEZE_PX &&
           (lock.stableCount || 0) >= INK_LOCK_AXIS_FREEZE_MIN_SAMPLES &&
           dist >= INK_LOCK_NET_MIN_PX) ||
          dist >= INK_LOCK_NET_FORCE_PX ||
          travel >= INK_LOCK_AXIS_FREEZE_MAX_PX) {
        lock.axis = prov;
        lock.cos = Math.cos(prov);
        lock.sin = Math.sin(prov);
      } else {
        lock.cos = Math.cos(prov);
        lock.sin = Math.sin(prov);
      }
      cos = lock.cos;
      sin = lock.sin;
    }
  } else {
    // Durumsuz çağrı: eski davranış — hareket tek pikselden küçükse
    // yön belirsizdir, kenetleme yok.
    if (!(dist > 1)) return point;
    const step = Math.PI / 4;
    const ang = Math.round(Math.atan2(dy, dx) / step) * step;
    cos = Math.cos(ang);
    sin = Math.sin(ang);
  }
  // İzdüşürme: eksen boyu bileşen korunur, dik bileşen atılır.
  const t = dx * cos + dy * sin;
  return {
    x: start.x + (t * cos) / dw,
    y: start.y + (t * sin) / dh,
  };
}

function inkLocalSizeToWorld(layer, sizeLocal) {
  if (!layer || layer.kind === 'global') return sizeLocal;
  const it = inkItemForLayer(layer);
  return it ? sizeLocal * it.w : sizeLocal;
}

/** Katman uzayındaki bir noktayı ekran koordinatına çevirir. */
function inkLocalToScreen(layer, p) {
  const w = inkLocalToWorld(layer, p);
  return w ? worldToScreen(w) : null;
}

function inkStrokeWorldBounds(layer, stroke) {
  if (!stroke || !stroke.points.length) return null;
  if (stroke.kind === 'gradient' || stroke.kind === 'fill') {
    if (!layer || layer.kind !== 'attached') return null;
    const corners = [
      inkLocalToWorld(layer, { x: 0, y: 0 }),
      inkLocalToWorld(layer, { x: 1, y: 0 }),
      inkLocalToWorld(layer, { x: 0, y: 1 }),
      inkLocalToWorld(layer, { x: 1, y: 1 }),
    ].filter(Boolean);
    if (!corners.length) return null;
    const xs = corners.map(p => p.x);
    const ys = corners.map(p => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  const brush = typeof inkGetBrush === 'function' ? inkGetBrush(stroke.brushId) : null;
  const dynamics = brush && brush.dynamics;
  const sizeJitter = clamp(Number(dynamics && dynamics.sizeJitter) || 0, 0, 1);
  let radius = inkLocalSizeToWorld(layer, stroke.size) / 2 * (1 + sizeJitter / 2);
  if (layer && layer.kind === 'attached') {
    const item = inkItemForLayer(layer);
    if (item && layer.pxW) {
      radius = Math.max(radius, 0.35 * item.w / layer.pxW);
    }
  } else {
    radius = Math.max(radius, 0.35);
  }
  const scatterX = Math.max(0, Number(brush && brush.scatterX) || 0, stroke.scatter || 0);
  const scatterY = Math.max(0, Number(brush && brush.scatterY) || 0, stroke.scatter || 0);
  let reachX = radius * (1 + scatterX);
  let reachY = radius * (1 + scatterY);
  if (brush && brush.dual) {
    const dualReach = radius *
      (clamp(Number(brush.dual.scale) || 1, 0.1, 4) + clamp(Number(brush.dual.scatter) || 0, 0, 2));
    reachX = Math.max(reachX, dualReach);
    reachY = Math.max(reachY, dualReach);
  }
  // Rotated rectangular brush tips can extend beyond their unrotated radius.
  reachX *= Math.SQRT2;
  reachY *= Math.SQRT2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    const w = inkLocalToWorld(layer, p);
    if (!w) continue;
    minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x); maxY = Math.max(maxY, w.y);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    x: minX - reachX, y: minY - reachY,
    w: (maxX - minX) + reachX * 2, h: (maxY - minY) + reachY * 2,
  };
}

function inkLayerWorldBounds(layer) {
  let b = null;
  for (const s of layer ? layer.strokes : []) {
    const sb = inkStrokeWorldBounds(layer, s);
    if (!sb) continue;
    if (!b) b = { ...sb };
    else {
      const r = Math.max(b.x + b.w, sb.x + sb.w);
      const bo = Math.max(b.y + b.h, sb.y + sb.h);
      b.x = Math.min(b.x, sb.x);
      b.y = Math.min(b.y, sb.y);
      b.w = r - b.x;
      b.h = bo - b.y;
    }
  }
  return b;
}

/* =========================================================
    gerçek piksel taraması (tight content bounds)
    Vuruş geometrisi "ne çizmeye niyetlendiğini" bilir; silgi ise
    pikselleri gerçekten ERİTİR (destination-out). Seçim kutusu için
    ikinci gerçeğe ihtiyaç vardır: katman rasterının alfa kanalını
    tarayıp boyalı piksellerin en dış sınırlarını bulmak (PySide6
    referansındaki get_tight_content_bounding_rect karşılığı).
    ========================================================= */

/** Kanvasın boyalı piksellerinin en dar sınır kutusu. Hiç piksel
    yoksa null döner. Typed-array taraması; büyük kanvaslarda
    milisaniyeler mertebesinde, Ctrl+T anında bir kez çağrılır. */
function inkCanvasAlphaRect(canvas) {
  if (!canvas || !canvas.width || !canvas.height
      || typeof canvas.getContext !== 'function') return null;
  let data = null;
  try {
    data = canvas.getContext('2d', { colorSpace: 'srgb' })
      .getImageData(0, 0, canvas.width, canvas.height).data;
  } catch { return null; }
  if (!data) return null;
  const w = canvas.width, h = canvas.height;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * (w << 2);          // satır başı
    for (let x = 0; x < w; x++) {
      if (data[row + (x << 2) + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;                      // satırlar yukarıdan aşağı; son hit satırı en alt
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Katmanın o anki rasterında GÖRÜNÜR piksel var mı / nerede
    (kanvas piksel cinsinden). Boş katman → null. */
function inkLayerVisiblePixelRect(layer) {
  if (!layer || layer.kind !== 'attached' || layer.visible === false) return null;
  const runt = typeof inkRuntime !== 'undefined' ? inkRuntime : null;
  if (!runt || !runt.itemCanvases) return null;
  let canvas = runt.itemCanvases.get(layer.id);
  if (!canvas && typeof inkEnsureItemCanvas === 'function') {
    canvas = inkEnsureItemCanvas(layer);
  }
  if (!canvas) return null;
  // Kart bayatsa (edisyondan yeni dönen vuruşlar) önce mevcut hâle kur.
  if (runt.dirtyLayers && runt.dirtyLayers.has(layer.id) &&
      typeof inkRebuildItemLayer === 'function') inkRebuildItemLayer(layer);
  return inkCanvasAlphaRect(canvas);
}

/** Katmanın görünen piksellerinin sınır kutusu — DÜNYA koordinatında.
    Kanvas pikselleri → yerel 0..1 → inkLocalToWorld. Gizmo kutusunun
    "hayalet vuruş" yerine gerçek görünen içeriği izlemesi için hazır. */
function inkLayerVisibleWorldRect(layer) {
  const rect = inkLayerVisiblePixelRect(layer);
  if (!rect || typeof inkLocalToWorld !== 'function' || !layer) return null;
  let canvas = null;
  const runt = typeof inkRuntime !== 'undefined' ? inkRuntime : null;
  if (runt && runt.itemCanvases) canvas = runt.itemCanvases.get(layer.id);
  if (!canvas || !canvas.width || !canvas.height) return null;
  const corners = [
    inkLocalToWorld(layer, { x: rect.x / canvas.width, y: rect.y / canvas.height }),
    inkLocalToWorld(layer, { x: (rect.x + rect.w) / canvas.width, y: rect.y / canvas.height }),
    inkLocalToWorld(layer, { x: rect.x / canvas.width, y: (rect.y + rect.h) / canvas.height }),
    inkLocalToWorld(layer, { x: (rect.x + rect.w) / canvas.width, y: (rect.y + rect.h) / canvas.height }),
  ].filter(Boolean);
  if (!corners.length) return null;
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {
    x, y,
    w: Math.max(...xs) - x,
    h: Math.max(...ys) - y,
  };
}

function inkSelectionBounds() {
  const ink = inkState();
  const layer = inkActiveLayer();
  if (!layer || !ink.selection.length) return null;
  const ids = new Set(ink.selection);
  let b = null;
  for (const s of layer.strokes) {
    if (!ids.has(s.id)) continue;
    const sb = inkStrokeWorldBounds(layer, s);
    if (!sb) continue;
    if (!b) b = { ...sb };
    else {
      const r = Math.max(b.x + b.w, sb.x + sb.w);
      const bo = Math.max(b.y + b.h, sb.y + sb.h);
      b.x = Math.min(b.x, sb.x);
      b.y = Math.min(b.y, sb.y);
      b.w = r - b.x;
      b.h = bo - b.y;
    }
  }
  return b;
}

/* =========================================================
   mekânsal indeks (quadtree)
   Küçük bir quadtree, seçim araçlarında adayları hızla daraltır.
   Vuruş sayısı azken doğrudan listeyi taramak daha hızlıdır.
   ========================================================= */
class InkQuadtree {
  constructor(bounds, depth = 0, maxItems = 8) {
    this.bounds = bounds;
    this.depth = depth;
    this.maxItems = maxItems;
    this.items = [];
    this.children = null;
  }

  static overlaps(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }

  _subdivide() {
    const { x, y, w, h } = this.bounds;
    const hw = w / 2, hh = h / 2;
    this.children = [
      new InkQuadtree({ x, y, w: hw, h: hh }, this.depth + 1, this.maxItems),
      new InkQuadtree({ x: x + hw, y, w: hw, h: hh }, this.depth + 1, this.maxItems),
      new InkQuadtree({ x, y: y + hh, w: hw, h: hh }, this.depth + 1, this.maxItems),
      new InkQuadtree({ x: x + hw, y: y + hh, w: hw, h: hh }, this.depth + 1, this.maxItems),
    ];
  }

  insert(item) {
    if (!InkQuadtree.overlaps(this.bounds, item.bounds)) return false;
    if (this.children) {
      for (const c of this.children) if (c.insert(item)) return true;
      return false;
    }
    this.items.push(item);
    if (this.items.length > this.maxItems && this.depth < 8) {
      this._subdivide();
      const pending = this.items;
      this.items = [];
      for (const it of pending) {
        let placed = false;
        for (const c of this.children) { if (c.insert(it)) { placed = true; break; } }
        if (!placed) this.items.push(it);
      }
    }
    return true;
  }

  query(range, out = []) {
    if (!InkQuadtree.overlaps(this.bounds, range)) return out;
    for (const item of this.items) {
      if (InkQuadtree.overlaps(range, item.bounds)) out.push(item);
    }
    if (this.children) for (const c of this.children) c.query(range, out);
    return out;
  }
}

function inkBuildQuadtree(layer) {
  const all = layer ? layer.strokes : [];
  if (!all.length) return null;
  let world = null;
  const entries = [];
  for (const s of all) {
    const b = inkStrokeWorldBounds(layer, s);
    if (!b) continue;
    entries.push({ stroke: s, bounds: b });
    if (!world) world = { ...b };
    else {
      const r = Math.max(world.x + world.w, b.x + b.w);
      const bo = Math.max(world.y + world.h, b.y + b.h);
      world.x = Math.min(world.x, b.x);
      world.y = Math.min(world.y, b.y);
      world.w = r - world.x;
      world.h = bo - world.y;
    }
  }
  if (!world) return null;
  world.w = Math.max(world.w, 1);
  world.h = Math.max(world.h, 1);
  const q = new InkQuadtree(world);
  for (const e of entries) q.insert(e);
  return q;
}

/* =========================================================
   katman işlemleri
   ========================================================= */
function inkAddLayer(options = {}) {
  const layer = inkMakeLayer(options);
  const ink = inkState();
  if (layer.kind === 'attached') {
    const it = getItem(layer.ownerId);
    if (!it) return null;
    layer.name = options.name || (typeof inkDocNextName === 'function'
      ? inkDocNextName(layer.ownerId)
      : ('Layer ' + (inkLayersForOwner(layer.ownerId).length + 1)));
  } else {
    const count = ink.layers.filter(l => l.kind === 'global').length + 1;
    layer.name = options.name || ('Layer ' + count);
  }
  ink.layers.push(layer);
  ink.activeLayerId = layer.id;
  ink.selection = [];
  return layer;
}

function inkRemoveLayer(id) {
  const ink = inkState();
  const idx = ink.layers.findIndex(l => l.id === id);
  if (idx < 0) return false;
  const [layer] = ink.layers.splice(idx, 1);
  ink.selection = [];
  if (ink.activeLayerId === id) {
    ink.activeLayerId = ink.layers.length ? ink.layers[Math.min(idx, ink.layers.length - 1)].id : null;
  }
  return !!layer;
}

function inkMoveLayer(id, dir) {
  const ink = inkState();
  const idx = ink.layers.findIndex(l => l.id === id);
  if (idx < 0) return false;
  const next = idx + (dir < 0 ? -1 : 1);
  if (next < 0 || next >= ink.layers.length) return false;
  const [layer] = ink.layers.splice(idx, 1);
  ink.layers.splice(next, 0, layer);
  return true;
}

function inkFindStroke(layer, strokeId) {
  return layer ? layer.strokes.find(s => s.id === strokeId) || null : null;
}

function inkDeleteSelection() {
  const ink = inkState();
  const layer = inkActiveLayer();
  if (!layer || !ink.selection.length) return false;
  const ids = new Set(ink.selection);
  const before = layer.strokes.length;
  layer.strokes = layer.strokes.filter(s => !ids.has(s.id));
  ink.selection = [];
  // Bekleyen worker bitmap'i eski seçimi taşımasın.
  if (before !== layer.strokes.length && typeof inkBumpPaintEpoch === 'function') {
    inkBumpPaintEpoch(layer.id, 'mutation');
  }
  return layer.strokes.length !== before;
}

/**
 * Görsel öğe silinince bağlı katmanları da bırakır. Çöp kutusundan geri
 * getirilebilme ihtimali için vuruş verisi hemen silinmez; sadece DOM
 * temizlenir. Kalıcı çöp temizliğinde inkPruneOrphanLayers() çağrılır.
 */
function inkPruneOrphanLayers() {
  const ink = inkState();
  const ids = new Set(state.items.map(i => i.id));
  // FAZ 8.A/8.D: öksüz katmanlar sessiz silinemez — kaldırılan her katman
  // dispose ile önbelleklerinden bırakılır ve TEK bir 'remove' olayıyla
  // duyulur (abone paneli olayla tazeler; elle sync çağrısı gerekmez).
  const removed = [];
  ink.layers = ink.layers.filter(l => {
    const orphan = l.kind === 'attached' && l.ownerId && !ids.has(l.ownerId);
    if (orphan) removed.push(l);
    return !orphan;
  });
  for (const l of removed) inkLayerDispose(l.id);
  if (!ink.layers.some(l => l.id === ink.activeLayerId)) {
    ink.activeLayerId = ink.layers.length ? ink.layers[ink.layers.length - 1].id : null;
  }
  ink.selection = [];
  for (const l of removed) {
    inkLayerStoreEmit('remove', { ownerId: l.ownerId || null, layerId: l.id, reason: 'prune' });
  }
}

function inkHandleItemsRemoved(removedIds) {
  if (!removedIds || !removedIds.size) return;
  if (inkRuntime.imageScopeId && removedIds.has(inkRuntime.imageScopeId)) {
    inkRuntime.imageScopeId = null;
    if (typeof inkSyncScopeVisual === 'function') inkSyncScopeVisual();
  }
  // FAZ 8.D: DOM tuvalleri ve önbellekler dispose tek noktadan bırakılır;
  // veri çöp kutusu geri getirmesi için kalır.
  for (const layerId of [...inkRuntime.itemCanvases.keys()]) {
    const layer = inkLayerById(layerId);
    if (layer && removedIds.has(layer.ownerId)) inkLayerDispose(layerId);
  }
  /* FX önbellekleri de öğe kimliğiyle tutulur; silinen öğe için
     girdi/aşama tuvalleri bırakılmazsa bellek oturum boyunca büyür. */
  if (typeof inkFxDisposeItem === 'function') {
    for (const id of removedIds) inkFxDisposeItem(id);
  }
  inkClearGizmo();
}

function inkDuplicateLayers(oldOwnerId, newOwnerId) {
  if (!oldOwnerId || !newOwnerId) return;
  const ink = inkState();
  const clones = [];
  for (const layer of ink.layers.filter(l => l.kind === 'attached' && l.ownerId === oldOwnerId)) {
    const copy = inkNormalizeLayer(JSON.parse(JSON.stringify(layer)));
    if (!copy) continue;
    copy.id = 'ly_' + newId();
    copy.ownerId = newOwnerId;
    copy.strokes = copy.strokes.map(s => ({ ...s, id: 'sk_' + newId() }));
    clones.push(copy);
  }
  ink.layers.push(...clones);
}

/* =========================================================
   durum geri yükleme kancaları
   ========================================================= */
/* Tam anlık görüntü geri almaları (öğe taşıma, silme, katman ayarı)
   önceden tüm katmanları yeniden raster ediyordu. Artık önceki ve yeni
   çizim durumu karşılaştırılır; yalnızca vuruşları değişen katman ve
   bölge tazelenir. Görsel taşıma gibi vuruş verisini hiç değiştirmeyen
   işlemlerde raster maliyeti sıfırdır. */

/* Vuruş imzası: nokta koordinatları + stil alanları. Yerel uzayda
   1/4096 birim çözünürlük yeterli (tuval en fazla 2048 px). İki bağımsız
   32-bit akümülatör kullanılır; çakışma olasılığı pratikte yok. */
const INK_STROKE_SIG_SCALE = 4096;

function inkHashStroke(stroke) {
  const pts = (stroke && stroke.points) || [];
  let h1 = 0x811c9dc5;
  let h2 = 0x2545f491;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = Math.round((p.x || 0) * INK_STROKE_SIG_SCALE) | 0;
    const y = Math.round((p.y || 0) * INK_STROKE_SIG_SCALE) | 0;
    const pr = Math.round((Number.isFinite(p.p) ? p.p : 1) * 1024) | 0;
    const sp = Math.round((Number.isFinite(p.s) ? p.s : 0) * 1024) | 0;
    const t = Math.round((p.t || 0) * 1024) | 0;
    const a = Math.round((p.a || 0) * 1024) | 0;
    h1 = Math.imul(h1 ^ x, 16777619);
    h1 = Math.imul(h1 ^ y, 16777619);
    h1 = Math.imul(h1 ^ pr, 16777619);
    h1 = Math.imul(h1 ^ sp, 16777619);
    h1 = Math.imul(h1 ^ t, 16777619);
    h1 = Math.imul(h1 ^ a, 16777619);
    h2 = Math.imul(h2 ^ (x + 0x9e3779b9), 2246822519);
    h2 = Math.imul(h2 ^ (y + 0x85ebca6b), 3266489917);
    h2 = Math.imul(h2 ^ (pr ^ (t << 11) ^ (a << 22)), 668265263);
  }
  const meta = [
    pts.length,
    Math.round((stroke.size || 0) * 16),
    Math.round((stroke.opacity == null ? 1 : stroke.opacity) * 1024),
    Math.round((stroke.hardness == null ? 0 : stroke.hardness) * 1024),
    Math.round((stroke.scatter || 0) * 1024),
    Math.round((stroke.spacing == null ? 0 : stroke.spacing) * 1024),
    Math.round((stroke.speedSize || 0) * 1024),
    Math.round((stroke.flow == null ? 1 : stroke.flow) * 1024),
    Math.round((stroke.flowJitter || 0) * 1024),
    Math.round((stroke.spacingJitter || 0) * 1024),
    Math.round((stroke.taperStart || 0) * 1024),
    Math.round((stroke.taperEnd || 0) * 1024),
  ];
  for (let i = 0; i < meta.length; i++) h1 = Math.imul(h1 ^ meta[i], 16777619);
  const text = (stroke.color || '') + '|' + (stroke.brushId || '') + '|' +
    (stroke.tool || '') + '|' + (stroke.kind || '') + '|' + (stroke.shape || '') + '|' +
    (stroke.closed ? '1' : '0');
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 668265263);
  }
  return (h1 >>> 0) + ':' + (h2 >>> 0);
}

/**
 * İki katmanın vuruş listesini karşılaştırır.
 * @returns {null|{full?:boolean,rect?:object}} değişiklik yoksa null
 */
function inkLayerStrokeDiff(before, after) {
  const prev = (before && before.strokes) || [];
  const next = (after && after.strokes) || [];
  if (!prev.length && !next.length) return null;

  const prevById = new Map();
  for (const s of prev) prevById.set(s.id, s);
  const nextById = new Map();
  for (const s of next) nextById.set(s.id, s);

  // Ortak vuruşların sırası değiştiyse z-sırası bozulur: katmanı bütün
  // çizmek, yanlış üst üste binmeden daha güvenli.
  const prevOrder = prev.map(s => s.id).filter(id => nextById.has(id));
  const nextOrder = next.map(s => s.id).filter(id => prevById.has(id));
  if (prevOrder.length !== nextOrder.length) return { full: true };
  for (let i = 0; i < prevOrder.length; i++) {
    if (prevOrder[i] !== nextOrder[i]) return { full: true };
  }

  let rect = null;
  const addBounds = (layer, stroke) => {
    const b = typeof inkStrokeWorldBounds === 'function'
      ? inkStrokeWorldBounds(layer, stroke) : null;
    if (!b) return;
    rect = (rect && typeof inkUnionRect === 'function')
      ? inkUnionRect(rect, b) : (rect || { x: b.x, y: b.y, w: b.w, h: b.h });
  };

  for (const s of prev) {
    if (!nextById.has(s.id)) addBounds(before, s);   // kaldırılan vuruş
  }
  for (const s of next) {
    const old = prevById.get(s.id);
    if (!old) { addBounds(after, s); continue; }      // yeni vuruş
    // Noktalar yerinde değişebilir (kement/gizmo dönüştürme): imza şart.
    // Eski konum da kirlenmeli, yoksa taşınan kopya tuvalde kalır.
    if (inkHashStroke(old) !== inkHashStroke(s)) {
      addBounds(before, old);
      addBounds(after, s);
    }
  }
  return rect ? { rect } : null;
}

/** DOM önbelleği eksikse (pano değişimi / sıfırlama) artımlı yol güvenli değil. */
function inkRestoreCacheIntact(ink) {
  if (!ink || !Array.isArray(ink.layers)) return false;
  for (const layer of ink.layers) {
    if (layer.kind !== 'global' || !layer.strokes.length) continue;
    let found = false;
    for (const tile of inkRuntime.tiles.values()) {
      if (tile.layerId === layer.id) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

/** Değişen katmanları işaretler; yeni katmanlar yalnızca kendilerini kurar. */
function inkApplyRestoreDiff(prev, next) {
  if (typeof inkDirtyReset === 'function') inkDirtyReset();

  const prevById = new Map();
  for (const layer of prev.layers) prevById.set(layer.id, layer);
  const nextById = new Map();
  for (const layer of next.layers) nextById.set(layer.id, layer);

  // Artık var olmayan katmanların çalışma-zamanı önbelleği dispose'ta bırakılır
  // (itemCanvases + tiles + baked/maske raster + thumb + gen — tek nokta).
  for (const layerId of [...inkRuntime.itemCanvases.keys()]) {
    if (nextById.has(layerId)) continue;
    inkLayerDispose(layerId);
  }

  let touched = 0;
  for (const layer of next.layers) {
    const before = prevById.get(layer.id);
    const resized = !!before && (before.kind !== layer.kind ||
      before.ownerId !== layer.ownerId ||
      before.pxW !== layer.pxW || before.pxH !== layer.pxH);
    const diff = (!before || resized) ? { full: true } : inkLayerStrokeDiff(before, layer);
    if (!diff) continue;
    touched++;
    // Bekleyen worker sonucu eski durumu taşıyorsa atılmalı.
    if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'mutation');
    if (diff.full) {
      if (layer.kind === 'attached') inkRuntime.dirtyLayers.add(layer.id);
      else inkMarkLayerDirty(layer.id, null, true);
    } else if (diff.rect) {
      inkMarkLayerDirty(layer, diff.rect);
    }
  }
  if (touched && typeof inkPerfCount === 'function') inkPerfCount('restoreTouchedLayers', touched);
  inkFlushDirtyLayers();
  // Stil (opaklık/karışım/görünürlük), culling ve gizmo her durumda tazelenir.
  inkSyncDom();
  // FAZ 8.B öte: undo/redo farkını store olaylarıyla duyur — abone panel
  // olaydan tazelenir; elle sync çağrısı buna gerek bırakmaz.
  if (typeof inkLayerStoreEmitRestoreDiff === 'function') {
    inkLayerStoreEmitRestoreDiff(prev, next);
  }
}

/**
 * Geri al/yinele sonrası çizim sahnesini tazeler.
 * @param {object} [prevInk] geri yüklemeden önceki `state.ink`; verilirse
 *   yalnızca değişen katman/bölge yeniden çizilir.
 */
function inkAfterRestore(prevInk) {
  inkEnsureState();
  // Fırça kütüphanesi (özel kategoriler, sıralama, yıldızlar ve
  // proje kaydından bağımsız fırçalar) global olarak saklanır. Pano
  // değişiminden sonra da aynı kütüphane görünsün diye yeniden uygula.
  if (typeof inkNativeApplyLibraryState === 'function') {
    try { inkNativeApplyLibraryState(); } catch { /* sessiz */ }
  }
  if (typeof inkNativeSync === 'function') {
    try { inkNativeSync(); } catch { /* sessiz */ }
  }
  const incremental = !!prevInk && inkRestoreCacheIntact(prevInk) &&
    typeof inkApplyRestoreDiff === 'function';
  if (incremental) {
    const t0 = performance.now();
    inkApplyRestoreDiff(prevInk, inkState());
    if (typeof inkPerfSpan === 'function') inkPerfSpan('restoreDiff', performance.now() - t0);
    if (typeof inkPerfCount === 'function') inkPerfCount('incrementalRestores');
    if (typeof inkSyncUI === 'function') inkSyncUI();
    if (typeof inkEditorAfterRestore === 'function') inkEditorAfterRestore();
    return;
  }
  if (typeof inkPerfCount === 'function') inkPerfCount('fullRestores');
  inkRuntime.itemCanvases.clear();
  inkRuntime.tiles.clear();
  inkRuntime.dirtyLayers.clear();
  if (typeof inkDirtyReset === 'function') inkDirtyReset();
  const host = document.getElementById('inkWorld');
  if (host) host.replaceChildren();
  if (typeof inkRebuildAll === 'function') inkRebuildAll();
  // FAZ 8.B öte: tam-yol restore da farkın olaya bağlanmasını bekler
  // (önbellek durumundan bağımsız; panel abonelikten tazelenir).
  if (prevInk && typeof inkLayerStoreEmitRestoreDiff === 'function') {
    inkLayerStoreEmitRestoreDiff(prevInk, inkState());
  }
  if (typeof inkSyncUI === 'function') inkSyncUI();
  if (typeof inkEditorAfterRestore === 'function') inkEditorAfterRestore();
}

function inkResetDom() {
  inkRuntime.itemCanvases.clear();
  inkRuntime.tiles.clear();
  inkRuntime.dirtyLayers.clear();
  if (typeof inkDirtyReset === 'function') inkDirtyReset();
  const host = document.getElementById('inkWorld');
  if (host) host.replaceChildren();
  if (typeof inkClearGizmo === 'function') inkClearGizmo();
}
