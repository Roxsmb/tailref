/* TailRef app · araç manifesti (FAZ 5)
   ------------------------------------------------------------------
   Tek kaynak: araç tanımları (id/grup/ikon/kısayol/araç ipucu) ve
   seçenek şemaları (declarative widget seti: range/toggle/select/
   brushTip). v5 kabuk options bar bu veriyi tüketir; panel --
   ayarları doğrudan inkState alanına bağlar. DOM'suzdur.
   ========================================================= */
'use strict';

/** 7 araç kümesi (FAZ 5 madde 3): Seçim / Dönüşüm / Boyama / Dokunuş /
    Silme / Şekil / Asistan. Sıra = çubuk/flyout görüntüleme sırası. */
const INK_TOOL_GROUPS = [
  { id: 'select',    label: 'Selection',    tools: ['marquee', 'lasso'] },
  { id: 'transform', label: 'Transform',  tools: ['transform'] },
  { id: 'paint',     label: 'Paint',    tools: ['brush', 'pencil', 'fill', 'gradient'] },
  { id: 'touch',     label: 'Touch',  tools: ['smudge', 'liquify'] },
  { id: 'erase',     label: 'Erase',    tools: ['eraser'] },
  { id: 'shape',     label: 'Shape',    tools: ['shape'] },
  { id: 'assist',    label: 'Assist',   tools: ['text', 'eyedropper'] },
];

/** Araç tanımları. `bar`: v5 araç çubuğunda doğrudan düğme olarak
    durur; altı çizili araçlar küme menüsünden (caret) seçilir.
    `schema`: İNK_OPTIONS_SCHEMAS anahtarı (eskidikçe ayrı değer). */
const INK_TOOL_DEFS = {
  transform: { group: 'transform', icon: 'ink-move', label: 'Move / Transform',
    key: 'V', tip: 'Move / transform (V)', bar: true },
  marquee:   { group: 'select', icon: 'ink-marquee', label: 'Rectangular Selection',
    key: 'M', tip: 'Rectangular selection (M)' },
  lasso:     { group: 'select', icon: 'ink-lasso', label: 'Lasso Selection',
    key: 'L', tip: 'Lasso selection (L)' },
  brush:     { group: 'paint', icon: 'ink-brush', label: 'Brush',
    key: 'B', tip: 'Brush (B)', bar: true },
  pencil:    { group: 'paint', icon: 'ink-pencil', label: 'Pencil',
    key: 'P', tip: 'Pencil (P)' },
  eraser:    { group: 'erase', icon: 'ink-eraser', label: 'Eraser',
    key: 'E', tip: 'Eraser (E)', bar: true },
  fill:      { group: 'paint', icon: 'ink-fill', label: 'Paint bucket',
    key: '', tip: 'Paint bucket · selected layer only', bar: true },
  smudge:    { group: 'touch', icon: 'ink-smudge', label: 'Smudge',
    key: '', tip: 'Finger (drag colors)', bar: true },
  liquify:   { group: 'touch', icon: 'ink-liquify', label: 'Liquify',
    key: '', tip: 'Liquify · push/pull pixels (viscous liquid)', bar: true },
  gradient:  { group: 'paint', icon: 'ink-gradient', label: 'Gradient',
    key: '', tip: 'Gradient (foreground color to transparent)', bar: true },
  shape:     { group: 'shape', icon: 'ink-shape', label: 'Shape',
    key: 'U', tip: 'Shape (U)' },
  text:      { group: 'assist', icon: 'type', label: 'Text note (T)',
    key: 'T', tip: 'Text note (T)' },
  eyedropper:{ group: 'assist', icon: 'ink-dropper', label: 'Eyedropper',
    key: 'I', tip: 'Eyedropper (I)' },
};

/** Declarative seçenek şemaları. Widget türleri:
    range    { key, label, min, max, step, scale, unit, tip }
    toggle   { key, label, tip }
    select   { key, label, options:[{value,label,title}], tip }
    brushTip { label, tip } — ana fırça kütüphanesini açar
    color    { label, tip } — renk çarkını açar
    range, select, toggle inkState alanına bağlanır; scale: input değeri
    × scale = durum değeri (0–1 alanlar için 0.01). */
const INK_OPTIONS_SCHEMAS = {
  brush: [
    /* FAZ 6 A9 öncelik sırası: sık kullanılanlar (Uç-Boyut-Opaklık-
       Yumuşatma) taşmada önce görünür kalanlar; gerisi `⋯`'de.
       Alfa kilidi widget'ı options bardan kaldırıldı (kullanıcı talebi:
       çubukta gereksiz) — kilidi hâlâ toolbar kilit düğmesi ve katman
       paneli yönetir. Yumuşatma onun yerine alındı. */
    { kind: 'brushTip', label: 'Tip', tip: 'Open the brush library' },
    { kind: 'range', key: 'size', label: 'Size', min: 1, max: 400, step: 1,
      unit: ' px', tip: 'Brush size (pixels)' },
    { kind: 'range', key: 'opacity', label: 'Opacity', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Stroke opacity' },
    { kind: 'range', key: 'smoothing', label: 'Smoothing', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Stroke smoothing' },
    /* Sertlik widget'ı options bar'dan KALDIRILDI (kullanıcı talebi:
       "bu sertlik kısmını kim koy") — sertlik yine fırça motorunun
       dahili davranışında, çubukta gösterilmiyor. */
    /* K13 · "Flow" da çubuğu terk etti (kullanıcı talebi: "bunu da
       kaldır burdan") — değer radial menüdeki Akış satırından yönetilir. */
    /* K13 · "Mouse pressure" + "Symmetry" options bar'dan Çizim Ayarları
       menüsüne taşındı (kullanıcı talebi) — widget'lar artık çubukta
       değil, dişli menüsünde (draw-v5 openPanelsMenu). */
  ],
  pencil: [
    { kind: 'brushTip', label: 'Tip', tip: 'Open the brush library' },
    { kind: 'range', key: 'size', label: 'Size', min: 1, max: 400, step: 1,
      unit: ' px', tip: 'Pencil size (pixels)' },
    { kind: 'range', key: 'opacity', label: 'Opacity', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Stroke opacity' },
    { kind: 'range', key: 'smoothing', label: 'Smoothing', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Stroke smoothing' },
  ],
  eraser: [
    { kind: 'range', key: 'size', label: 'Size', min: 1, max: 400, step: 1,
      unit: ' px', tip: 'Eraser size (pixels)' },
    { kind: 'range', key: 'opacity', label: 'Opacity', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Erase opacity' },
    { kind: 'range', key: 'smoothing', label: 'Smoothing', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Stroke smoothing' },
  ],
  fill: [
    { kind: 'color', label: 'Color', tip: 'Fill color (color wheel)' },
    { kind: 'range', key: 'opacity', label: 'Opacity', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Fill opacity' },
    { kind: 'range', key: 'fillTolerance', label: 'Tolerance', min: 0,
      max: 255, step: 1, tip: 'Color tolerance (0–255)' },
  ],
  smudge: [
    { kind: 'range', key: 'size', label: 'Size', min: 1, max: 400, step: 1,
      unit: ' px', tip: 'Finger size (pixels)' },
    /* K13 · Akış widget'ı çubuktan kaldırıldı (kullanıcı talebi) —
       renk taşıma gücü radial menüdeki Akış satırında yaşar. */
    { kind: 'range', key: 'smoothing', label: 'Smoothing', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Stroke smoothing' },
  ],
  liquify: [
    { kind: 'range', key: 'size', label: 'Size', min: 1, max: 400, step: 1,
      unit: ' px', tip: 'Liquify size (pixels)' },
    { kind: 'range', key: 'opacity', label: 'Strength', min: 1, max: 100,
      step: 1, scale: 0.01, tip: 'Pixel push strength' },
    /* K15 sırasında tespit: motor kenar falloff için stroke.hardness
       okur (28-ink-brush inkDrawLiquifyOnContext) ama widget yoktu —
       merkez sertliği 0.72'ye kilitliydi. Vuruş zaten ink.hardness
       taşır (30-ink-tools inkBeginFreehand); eksik tamamlandı. */
    { kind: 'range', key: 'hardness', label: 'Hardness', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Liquify edge hardness (100 = hard region)' },
    { kind: 'range', key: 'smoothing', label: 'Smoothing', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Stroke smoothing' },
    { kind: 'range', key: 'spacing', label: 'Tightening', min: 1, max: 100,
      step: 1, scale: 0.01, tip: 'Dab frequency (small = continuous warp)' },
  ],
  gradient: [
    { kind: 'color', label: 'Color', tip: 'Selected gradient stop color (alpha picker)' },
    { kind: 'gradientBar', label: 'Stops',
      tip: 'Gradient stops — click handle: open picker · click bar: add stop · drag: move · Alt-click handle: remove' },
    { kind: 'range', key: 'opacity', label: 'Opacity', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Gradient opacity' },
  ],
  shape: [
    { kind: 'select', key: 'shape', label: 'Type',
      options: [
        { value: 'arrow', label: 'Arrow' },
        { value: 'rect', label: 'Rectangle' },
        { value: 'ellipse', label: 'Ellipse' },
        { value: 'highlight', label: 'Highlighter' },
      ], tip: 'Shape type' },
    { kind: 'range', key: 'size', label: 'Thickness', min: 1, max: 400,
      step: 1, unit: ' px', tip: 'Outline thickness (pixels)' },
    { kind: 'range', key: 'opacity', label: 'Opacity', min: 0, max: 100,
      step: 1, scale: 0.01, tip: 'Shape opacity' },
  ],
  text: [],
  eyedropper: [],
  /* FAZ 6 A4: boş şemalar dolduruldu — transform'a gizmo değer bilgi
     satırı; marquee/lasso'ya "Deselect" düğmesi (Esc ile aynı
     yol). text/eyedropper boş kalır (iface yok). */
  transform: [
    { kind: 'info', id: 'gizmoInfo', label: 'Selection',
      tip: 'Selection gizmo values (X, Y · W × H px)' },
    /* FAZ 6 B7: sayısal HUD — gizmo ile çift-yön; X/Y sol-üst (px),
       W/H ölçek sol-üst çapayla, R merkezden derece (Enter uygular). */
    { kind: 'gizmohud', id: 'gizmoHud', label: 'Number',
      tip: 'Numeric transform — X/Y top-left, W/H scale, R rotation from center' },
  ],
  /* FAZ 6 B6: seçim modu widget'ı — Yeni/Ekle/Çıkar/Kesişim; PS kalıbı
     Shift/Alt drag başında geçici üstünlük kullanır. Taşmada ilk ışık
     'selmode'dur (manifest öncelik sırası). */
  marquee: [
    { kind: 'selmode', label: 'Mode',
      tip: 'Selection mode — Shift adds, Ctrl/Alt subtracts, Shift+Ctrl intersects' },
    { kind: 'action', id: 'clearSelection', label: 'Deselect',
      tip: 'Deselect active selection (same as Esc)' },
  ],
  lasso: [
    { kind: 'selmode', label: 'Mode',
      tip: 'Selection mode — Shift adds, Ctrl/Alt subtracts, Shift+Ctrl intersects' },
    { kind: 'action', id: 'clearSelection', label: 'Deselect',
      tip: 'Deselect active selection (same as Esc)' },
  ],
};

/** Aracın grup kümesini döndürür (id). */
function inkToolGroupOf(tool) {
  const def = INK_TOOL_DEFS[tool];
  return def ? String(def.group) : '';
}

/** Aracın seçenek şeması (yoksa []). */
function inkToolOptionsSchema(tool) {
  const schema = INK_OPTIONS_SCHEMAS[tool];
  return Array.isArray(schema) ? schema : [];
}

/** Aracın görünen adı (L10N: anlık dile göre çözülür). */
function inkToolLabel(tool) {
  const def = INK_TOOL_DEFS[tool];
  return def ? (window.__t ? __t(def.label) : def.label) : String(tool || '');
}

