/* TailRef app — ink editor overlay (modal görsel düzenleme)
   ------------------------------------------------------------------
   Çizim artık sonsuz tahtanın üzerine "inline" yapılmıyor. Bir görsel
   seçilip "Start Drawing" denince yalnızca o görsele odaklanan modal bir
   çalışma alanı açılır:

     #inkEditor
       #inkEditorCanvas   → görsel + görsele bağlı katmanların birleşimi
       #inkEditorCursor   → fırça halkası (örnekleme pikselini kirletmez)

   Belge modeli değişmez: katmanlar `state.ink.layers` içindeki
   `kind:'attached'` katmanlardır ve her katmanın kendi tuvali vardır
   (`29-ink-render.js`). Bu modül yalnızca:

   - görünümü (fit / DPR / kompozisyon) yönetir,
   - girdiyi (basınç, eğim, hız, Catmull-Rom ara örnekleme) işler,
   - Alt tuşu ile geçici damlalık davranışını uygular,
   - silgiyi `destination-out` ile gerçekten siler,
   - pointerup'ta vuruşu katman tuvaline anında pişirir.

   Böylece panodaki kayıt (strokes + raster), geri al ve dışa aktarma
   yolları aynı kalır; editör kapanınca tahta güncel rasterı gösterir. */

'use strict';

const inkEditorUi = {
  ready: false,
  open: false,
  itemId: null,
  layerId: null,
  root: null,
  canvas: null,
  cursorCanvas: null,
  ctx: null,
  cctx: null,
  dpr: 1,
  fit: { x: 0, y: 0, w: 1, h: 1, s: 1 },
  // Görünüm: zoom 1 = "ekrana sığdır". panX/panY sığdırma merkezine
  // göre ekran pikseli cinsinden kaydırmadır. `fit` her zaman nihai
  // ekran dikdörtgenidir; koordinat dönüşümleri onu kullanır.
  // A11 (FAZ 6): rot ayrıdır — derece, tuval MERKEZİ etrafında; sıfır-
  // lama yalnız açıyı temizler, zoom/pan'e dokunmaz (PS Reset View).
  view: { zoom: 1, panX: 0, panY: 0, rot: 0 },
  space: false,
  panning: null,
  // A11: R döndürme modu — rotMode sadece basılıyken true; rotDrag
  // sürükleme durumu. HATIRR: bunlar vuruş/araç değil geçici moddur.
  rotMode: false,
  rotDrag: null,
  raf: 0,
  stroke: null,
  scratch: null,
  /* K20b · dual ağırlık kanalı: dablar şeffaf ağırlık tuvaline (dualWts)
     stroke.opacity'siz birikir; görüntü/bake = katman tabanı ⊕
     (ağırlık × opaklık) — taban orijinal alfasını korur, önceki çizimler
     sınavlardan etkilenmez. dualComp her karede tazelenir. */
  dualWts: null,
  dualComp: null,
  // M2: birikmiş kompozitte işlenen nokta sayısı (delta kutu hesabı).
  dualCompPts: 0,
  layerCanvas: null,
  // Vuruş sürerken tahtadaki öğenin üzerine basılan geçici canlı katman.
  // Referans paneli gerçek #stage'i gösterdiği için minyatür de aynı karede
  // güncellenir; vuruş bitince kaldırılır ve kalıcı katman tuvale pişer.
  liveCanvas: null,
  // Canlı önizleme: GPU varsa WebGL2 dokusu, yoksa kalıcı 2B tuval.
  previewGl: false,
  previewCanvas: null,
  previewSkip: 0,
  previewDirty: false,
  // M3: minyatür overlay sync kısınlama damgası (performance.now()).
  overlaySyncAt: 0,
  // M4: koordinat yazımı kısınlama damgası.
  coordsSyncAt: 0,
  // M6: uyarlanabilir sahne render kısınlama durumu.
  loopLastAt: 0,
  slowFrames: 0,
  renderFlip: 0,
  // Kiremit aşama 2 (dilim 2) + dilim 3: karo görüntü ızgarası.
  // tileViewOn kurulumda 'tailref-ink-tiles' ayarına göre açılır
  // (varsayılan AÇIK); 'tailref-ink-tiles'='0' kaçış hatch'i ızgarayı
  // tümüyle kapatır (karosuz tam yol). TileGridView
  // (59-ink-tile-view.js) sahne karo gridini, tileBuf painter'ın bölge
  // tamponunu, tvRegion bu karenin kirli bölgesini, tvFrame drain
  // sırasında painter bağlamını, tvLive canlı önizleme içeren karoların
  // defterini (commit yakınsaması) tutar. tileProbe prob araçlarına
  // ızgarayı görünmez ölçüm modunda koşturur.
  tileView: null,
  tileViewOn: false,
  tileProbe: false,
  tileBuf: null,
  tvRegion: null,
  tvFrame: null,
  tvLive: null,
  // Bütçeli commit yakınsaması: karo bake kalan karelerde sürüyorsa
  // true — defter korunur, yapısal resetlerde sıfırlanır.
  tvBakeLeft: false,
  // Tur 2 madde 5 · kare çipi: commit/undo sonrası sahne karesinin
  // bölgesel kurulması için bake bölgesi (katman px + uzay boyutu).
  // Render tek karede tüketir (drewChip yoksa, tam yol öncesi).
  frameChip: null,
  // GPU önizlemesinin ekranda kapladığı kutu (CSS px). Görsel kutusunun
  // ekranla kesişimidir; null ise önizleme tam kutuya yayılır (2B yol).
  previewRect: null,
  // Tur 4b · canlı şekil ayarında ÖNCEKI karenin tam-raster kutusu
  // (katman px). İz/ghost düzeltmesi: her kare birleşik kutuyu temizler.
  lastShapeRasterRect: null,
  pointerId: null,
  alt: false,
  toolBeforeAlt: '',
  toolBeforeOpen: '',
  sampling: false,
  pendingStroke: null,
  lastClient: null,
  lastAt: 0,
  speed: 0,
  smoothX: 0,
  smoothY: 0,
  outside: false,
  rawHistory: [],
  checker: null,
  // Çizim döngüsü yalnızca değişiklik olduğunda çalışır. Önceden her karede
  // tam ekran yeniden çizim yapılıyordu; büyük tuvallerde bu ciddi yavaşlık
  // ve ısınma yaratıyordu.
  needsRender: false,
  renderQueued: false,
  cursorQueued: false,
  cursorRaf: 0,
  baseCanvas: null,
  baseKey: '',
  /* A11 v5: R sürüklemesi boyunca base geniş kapsamada tutulur. */
  baseWide: false,
  // Küçük zoom'da katman tuvalleri kademeli küçültülüp önbelleklenir.
  // Doğrudan drawImage ile 3–4 kat küçültme pütürlü/kesik görünüyordu.
  scaledCache: new Map(),
  pyramid: new Map(),
  cursorRect: null,
  // Seçim / dönüştürme araçları (taşı, dikdörtgen seçim, kement).
  marquee: null,        // { x0, y0, x1, y1 } yerel 0..1
  lasso: null,          // [{ x, y }] yerel 0..1
  gizmoDrag: null,      // { mode, handle, before, start, bounds, anchor, angle, dist }
  freeTransform: false, // Ctrl+T ile serbest dönüştürme etkin
};
const inkEditorTipOutlineCache = new Map();

function inkEditorIsOpen() {
  return !!(inkEditorUi.ready && inkEditorUi.open);
}

/* =========================================================
   DOM ve yaşam döngüsü
   ========================================================= */
function inkEditorEnsureDom() {
  const ui = inkEditorUi;
  if (ui.ready) return true;
  const root = document.getElementById('inkEditor');
  if (!root) return false;
  ui.root = root;
  ui.canvas = document.getElementById('inkEditorCanvas');
  ui.cursorCanvas = document.getElementById('inkEditorCursor');
  if (!ui.canvas || !ui.cursorCanvas) return false;
  ui.ctx = ui.canvas.getContext('2d', { colorSpace: 'srgb' });
  ui.cctx = ui.cursorCanvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ui.ctx || !ui.cctx) return false;

  ui.canvas.addEventListener('pointerdown', inkEditorPointerDown);
  ui.canvas.addEventListener('pointermove', inkEditorPointerMove);
  ui.canvas.addEventListener('pointerup', inkEditorPointerUp);
  ui.canvas.addEventListener('pointercancel', inkEditorPointerCancel);
  ui.canvas.addEventListener('pointerleave', () => {
    if (!ui.stroke) {
      ui.lastClient = null;
      inkEditorDrawCursor();
      inkEditorSyncCoords(ui.fit);
    }
  });
  ui.canvas.addEventListener('wheel', inkEditorWheel, { passive: false });

  window.addEventListener('resize', () => {
    if (ui.open) {
      inkEditorResize();
      inkEditorSyncStatus();
      inkEditorInvalidate();
    }
  });
  window.addEventListener('keydown', inkEditorKeyDown, true);
  window.addEventListener('keyup', inkEditorKeyUp, true);
  window.addEventListener('blur', () => {
    if (!ui.open) return;
    inkEditorSetAlt(false);
    ui.space = false;
    ui.pendingStroke = null;
    if (ui.panning) inkEditorPanEnd(null);
    /* Yapışkan tuş temizliği: pencere odağını kaybedince keyup kaçar —
       shift (düz çizgi) ve döndürme modu KİLİTLİ kalıyordu. R bırakılmış
       gibi commit edilir (keyup yoluyla birebir), shift düşürülür. */
    ui.shiftHeld = false;
    if (ui.rotMode) {
      ui.rotMode = false;
      if (ui.rotDrag) {
        ui.pointerId = null;
        try { ui.canvas.releasePointerCapture(ui.rotDrag.pointerId); } catch { /* sessiz */ }
        ui.rotDrag = null;
        ui.baseWide = false;
        inkEditorApplyRot();
      }
      inkEditorRotHud(false);
    }
    inkEditorSyncCursorStyle();
  });

  ui.ready = true;
  /* Kiremit dilim 3: üretimde ızgara varsayılan AÇIK. Kaçış hatch'i:
     localStorage 'tailref-ink-tiles'='0' → 1.4.0 davranışı (karosuz
     tam yol). Düşük donanım profilinde performans sweep'i karoları
     kapalıya alır; tek kumanda buradan döner. */
  try { ui.tileViewOn = inkTilesEnabled(); } catch { ui.tileViewOn = true; }
  /* FAZ 6 B10: tuval kenarı Power Sliders — tuval kromu ilk kurulumda
     yerleşir; değer kanalı options bar/panel ile ortaktır. */
  try {
    inkPowerSlidersEnsure();
    inkPowerSlidersInstall();
  } catch { /* sessiz */ }
  return true;
}

/** Görsele ait, kilitli olmayan katmanı döndürür; yoksa yeni katman açar. */
function inkEditorTargetLayer(itemId) {
  const ui = inkEditorUi;
  const ownerId = itemId || ui.itemId;
  const it = getItem(ownerId);
  if (!it || it.kind !== 'image') return null;
  const ink = inkState();
  let layer = inkLayerById(ink.activeLayerId);
  if (layer && layer.kind === 'attached' && layer.ownerId === it.id && !layer.locked) return layer;
  // Birden fazla çizim katmanı varsa en üstteki (en son eklenen) hedeflenir;
  // yeni vuruşlar daima yığının en üstüne düşer.
  layer = inkLayersForOwner(it.id).filter(l => !l.locked).pop() || null;
  if (!layer) layer = inkAddLayer({ kind: 'attached', ownerId: it.id });
  if (layer) inkSetActiveLayer(layer.id);
  return layer;
}

function inkEditorOpen(itemId) {
  const ui = inkEditorUi;
  const it = getItem(itemId);
  if (!it || it.kind !== 'image') return false;
  if (!inkEditorEnsureDom()) return false;

  if (ui.open && ui.itemId === itemId) {
    inkEditorResize();
    return true;
  }
  if (ui.open) inkEditorClose();

  // Hedef katman çözümü `ui.itemId` üzerinden çalışır; bu yüzden öğe
  // kimliği katman seçilmeden ÖNCE yazılmalı. (Eskiden sonra yazıldığı
  // için `inkEditorTargetLayer()` null dönüyor ve modal hiç açılmıyordu.)
  ui.itemId = itemId;
  const layer = inkEditorTargetLayer(itemId);
  if (!layer) {
    ui.itemId = null;
    return false;
  }

  ui.layerId = layer.id;
  // Tahtada hangi araç seçiliyse modal kapanınca ona dönülür; böylece
  // editör kapatıldıktan sonra yanlışlıkla tahtaya boyanmaz.
  ui.toolBeforeOpen = inkState().tool;
  if (!['brush', 'pencil', 'eraser', 'shape'].includes(ui.toolBeforeOpen)) {
    inkSetTool('brush');
  }
  ui.alt = false;
  ui.toolBeforeAlt = '';
  ui.sampling = false;
  ui.lastClient = null;
  ui.rawHistory = [];
  ui.view.zoom = 1;
  ui.view.panX = 0;
  ui.view.panY = 0;
  ui.view.rot = 0;
  ui.rotMode = false;
  ui.rotKey = '';
  ui.rotDrag = null;
  ui.space = false;
  ui.panning = null;

  ui.root.hidden = false;
  ui.root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('ink-editor-open');
  const toolbox = document.getElementById('inkToolbox');
  if (toolbox) toolbox.hidden = false;

  ui.open = true;
  if (typeof modeNotifyEditorOpened === 'function') modeNotifyEditorOpened(ui.itemId);
  if (typeof inkApplyToolCursor === 'function') inkApplyToolCursor();
  inkEditorResize();
  inkEditorSyncCursorStyle();
  inkEditorSyncStatus();
  inkEditorInvalidate();
  /* FAZ 6 B10: şeritler açılışta güncel duruma oturur. */
  try { inkPowerSlidersSync(); } catch { /* sessiz */ }
  return true;
}

function inkEditorClose() {
  const ui = inkEditorUi;
  inkEditorSetAlt(false);
  inkEditorDropStroke();
  // A11: kapanışta döndürme izini komple temizle — sonraki açılış
  // dik başlar; canvas üzerinde eski bir transform hayatta kalmaz.
  ui.rotMode = false;
  ui.rotKey = '';
  ui.rotDrag = null;
  ui.view.rot = 0;
  if (ui.root) {
    ui.root.classList.remove('ink-rotated');
    const hud = document.getElementById('inkRotHud');
    if (hud) hud.hidden = true;
  }
  if (ui.canvas) {
    ui.canvas.style.transform = '';
  }
  ui.open = false;
  ui.space = false;
  ui.panning = null;
  ui.itemId = null;
  ui.layerId = null;
  /* FAZ 6 B10: şeritler kök gizlendiğinden zaten görünmez; drag
     durumunu temizlemek için kök gizlenir. */
  try { inkPowerSlidersSync(); } catch { /* sessiz */ }
  // Modal kapanınca tahtanın aracını geri yükle. Aksi halde son kullanılan
  // fırça/silgi tahtada etkin kalır ve yanlışlıkla inline çizim yapılırdı.
  const previousTool = ui.toolBeforeOpen;
  ui.toolBeforeOpen = '';
  if (previousTool && previousTool !== inkState().tool) {
    inkSetTool(previousTool);
  }
  if (ui.raf) cancelAnimationFrame(ui.raf);
  ui.raf = 0;
  ui.renderQueued = false;
  if (ui.cursorRaf) cancelAnimationFrame(ui.cursorRaf);
  ui.cursorRaf = 0;
  ui.cursorQueued = false;
  ui.needsRender = false;
  ui.baseCanvas = null;
  ui.baseKey = '';
  ui.baseWide = false;
  if (ui.scaledCache) ui.scaledCache.clear();
  /* FAZ 7.P: pyramit tuvalleri de serbest — katman rasterları ayrı ömür. */
  if (ui.pyramid) ui.pyramid.clear();
  /* FAZ 7.T (byte-pool): undo fallback scratch'ı kapanışta anında
     serbest bırak (4K'da 33 MB Skia backing boşta kalmasın). */
  if (typeof inkUndoScratchReleaseNow === 'function') inkUndoScratchReleaseNow();
  /* FAZ 7.T (byte-pool): dual scratch havuzu da kapanışta boşalır. */
  if (typeof inkDualScratchPoolClear === 'function') inkDualScratchPoolClear();
  /* OPT (torture-max): vuruş-baza cache de kapanışta serbest. */
  if (typeof inkStrokeBasePoolClear === 'function') inkStrokeBasePoolClear();
  ui.cursorRect = null;
  if (typeof inkApplyToolCursor === 'function') inkApplyToolCursor();
  if (ui.root) {
    ui.root.hidden = true;
    ui.root.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('ink-editor-open');
  if (typeof modeNotifyEditorClosed === 'function') modeNotifyEditorClosed();
  const toolbox = document.getElementById('inkToolbox');
  if (toolbox) toolbox.hidden = true;
  try {
    if (typeof hidePanel === 'function' && typeof inkUi !== 'undefined' && inkUi.els) {
      hidePanel(inkUi.els.brushPanel);
      hidePanel(inkUi.els.layersPanel);
    }
  } catch { /* sessiz */ }
  if (typeof inkCloseColorWheel === 'function') inkCloseColorWheel();
  if (typeof inkCancelStroke === 'function') inkCancelStroke();
}

/* =========================================================
   görünüm
   ========================================================= */
const INK_EDITOR_ZOOM_MIN = 0.05;
const INK_EDITOR_ZOOM_MAX = 16;

function inkEditorResize() {
  const ui = inkEditorUi;
  if (!ui.ready) return;
  // Yüksek DPR'de tam ekran iki tuval belleği hızla büyür; 2 ile sınırla.
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const pxW = Math.round(w * dpr);
  const pxH = Math.round(h * dpr);
  ui.dpr = dpr;
  for (const canvas of [ui.canvas, ui.cursorCanvas]) {
    // Aynı boyutta yeniden atama tuvali gereksiz yere temizler.
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  // Boyut değişince taban önbelleği ve imleç alanı geçersizdir.
  ui.baseKey = '';
  ui.baseWide = false;
  if (ui.scaledCache) ui.scaledCache.clear();
  /* FAZ 7.P: pyramit tuvalleri de serbest — boyut değişiminde bayat. */
  if (ui.pyramid) ui.pyramid.clear();
  ui.cursorRect = null;
  // Tuval görünüm alanına sabitlenmiş (position:absolute; left:0; top:0).
  // Açılış animasyonu #inkEditor'ü ölçeklediği için getBoundingClientRect
  // animasyon sırasında kayabilir; ekran dikdörtgeni daima görünüm alanıdır.
  ui.rect = { left: 0, top: 0, width: w, height: h };
  if (ui.cctx) {
    ui.cctx.setTransform(1, 0, 0, 1, 0, 0);
    ui.cctx.clearRect(0, 0, ui.cursorCanvas.width, ui.cursorCanvas.height);
  }
  ui.needsRender = true;
  /* FAZ 6 B10: pencere değişince şeritler viewport sınırına oturur
     (asinerj kanallar context: resize olayı + apply()). */
  if (typeof inkPowerSlidersSync === 'function') {
    try { inkPowerSlidersSync(); } catch { /* sessiz */ }
  }
}

/* =========================================================
   A11 (FAZ 6 7b): R tuval döndürme — PS Rotate View kalıbı
   ---------------------------------------------------------
   • rot yalnız ui.view.rot'ta yaşar: katman/karo/undo uzayı
     (dünya koordinatı) dönüşümsündür; export == ekran.
   • Görüntü dönüşümü yalnızca CSS transform (canvas, merkez origin)
     — raster re-repaint yok, sürükleme karesi başına sabit maliyet.
   • rect fullscreen (0,0)'sabit olduğundan rot merkezi rect'in
     merkezidir; kapı (inkEditorGatePoint) client noktasını rotun
     TERSİ ile tuval-px uzayına indirir. Tüm ekran→tuval yolları
     (local/sample/coords) bu tek kapıdan geçer.
   • Sıfırlama (Reset View): yalnız açı — zoom/pan data dokunulmaz.
   ========================================================= */
function inkEditorRotNorm(deg) {
  let d = Number(deg) || 0;
  if (!Number.isFinite(d)) return 0;
  d = ((d % 360) + 540) % 360 - 180; // (−180°, 180°] aralığına sarar
  return Math.abs(d) < 0.01 ? 0 : d;
}

function inkEditorApplyRot() {
  const ui = inkEditorUi;
  if (!ui.ready) return;
  ui.view.rot = inkEditorRotNorm(ui.view.rot);
  const rot = ui.view.rot;
  /* A11 v2 (kullanıcı raporu: yamuk iken pan'de kağıt "yarım
     kayboluyordu" + şeritler kalıyordu): CSS bitmap rotasyonu yerine
     içerik RENDER'da döner — bitmap dikdörtgen kalır, pan/zoom sırasında
     viewport hiçbir yerden dilimlenmez. Desk fonu CSS .ink-rotated
     ile durur. A11 v5: sürükleme kareleri de render hattından geçer
     (CSS hız yolu kaldırıldı — geniş base tek kurulumla). */
  if (ui.canvas) {
    ui.canvas.style.transform = '';
    ui.canvas.style.transformOrigin = '';
  }
  try { ui.root.classList.toggle('ink-rotated', !!rot); } catch { /* sessiz */ }
  // Çerçeve dikdörtgeni (kenar+gölge) dönmüş kağıtla çakışır; rot≠0'da
  // yalnız dik çalıştığı için gizlenir (kağıt kenarı çizimde var).
  try {
    const frame = document.getElementById('inkCanvasFrame');
    if (frame) frame.hidden = !!rot;
  } catch { /* sessiz */ }
  // Options bar "View" bilgisi kare başına yaşar; overflow ölçümü
  // atlanır (sürükleme karesinde layout tekrarı istemeyiz).
  try { if (window.__v5OptSync) window.__v5OptSync({ measure: false }); } catch { /* sessiz */ }
  inkEditorInvalidate();
}

/** A11: sürükleme karesi — A11 v5'te CSS hız yolu KALDIRILDI. CSS
    döndürme yalnız viewport-kadar canvas bitmap'ini döndürüyordu;
    zoom'luyken viewport dışında kalan kâğıt bölgeleri karede hiç yoktu
    ve dönerken kesik üçgenler + hayalet şeritler geziniyordu (kullanıcı:
    "rastgele hareket ediyor"). Şimdi sürükleme kareleri normal render
    yolundan geçer: rotDrag başında kurulan GENİŞ base (ui.baseWide)
    tüm sürüklemeyi tek kurulumla taşır, kare maliyeti bir drawImage +
    katman kompozitidir. Fonksiyon uyumluluk için no-op bırakıldı. */
function inkEditorRotFastFrame() { /* A11 v5: no-op */ }

/** A11: pan/tekerlek deltası — A11 v3 ile pivot KÂĞIT MERKEZİNE taşındı.
    Yeni pivot modelinde fit-uzayı deltası EKRANDA birebir uygulanır
    (pivot C pan ile birlikte δ kayar: s'−s = δ); eski pencere-merkezli
    pivota özel −rot gömme artık kâğıdı çapraz itiyordu (kullanıcı:
    "tam yukarı kaydırmak istiyorum, sağa sola gidiyor"). Dönüş: GİRİŞİ
   olduğu gibi verecek şekilde aynı fonksiyon adı korunur. */
function inkEditorRotFilterDelta(dx, dy) {
  return { x: dx, y: dy };
}

/** A11: canlı açı çipi — döndürme sürüklemesinde imlecin dibinde
    dereceyi gösterir (kullanıcı tam 45°/90° hedefliyorsa anaım eder).
    pointer-events:none; sürükleme bittiğinde gizlenir. */
function inkEditorRotHud(visible, rotDeg, x, y) {
  const ui = inkEditorUi;
  if (!ui.ready || !ui.root) return;
  let hud = document.getElementById('inkRotHud');
  if (!hud) {
    if (!visible) return;
    hud = document.createElement('div');
    hud.id = 'inkRotHud';
    hud.setAttribute('aria-hidden', 'true');
    ui.root.appendChild(hud);
  }
  if (!visible || !ui.rotMode) { hud.hidden = true; return; }
  if (rotDeg != null) {
    const t = rotDeg.toFixed(1);
    if (hud.textContent !== t + '°') hud.textContent = t + '°';
  }
  if (x != null && y != null) {
    hud.style.left = Math.round(x + 18) + 'px';
    hud.style.top = Math.round(y + 18) + 'px';
  }
  hud.hidden = false;
}

/** Açıyı değiştirir (mutlak). Vuruş sürerken yok sayılır — döndürme
    vuruş ortasında kapıyı büker; bu bir bug deposu olur. */
function inkEditorRotate(deg) {
  const ui = inkEditorUi;
  if (!ui.open || ui.stroke || ui.panning) return;
  ui.view.rot = inkEditorRotNorm(deg);
  inkEditorApplyRot();
  inkEditorSyncStatus();
}

/** PS "Reset View": yalnız açıyı 0'a indirir; zoom/pan'e dokunmaz. */
function inkEditorResetRot() {
  const ui = inkEditorUi;
  if (!ui.open) return;
  ui.view.rot = 0;
  inkEditorApplyRot();
  inkEditorSyncStatus();
}

/** A11 tek kapı: client ekran noktası → tuval CSS-px (rot tersine
    çevrilmiş). rectFullscreen hizası rect.left/top ile çıkarılır. */
function inkEditorGatePoint(clientX, clientY) {
  const ui = inkEditorUi;
  const rect = ui.rect || {
    left: 0, top: 0, width: window.innerWidth, height: window.innerHeight,
  };
  let x = clientX - rect.left;
  let y = clientY - rect.top;
  const rot = Number(ui.view.rot) || 0;
  if (rot) {
    /* A11 v3: pivot KÂĞIT MERKEZİ (kullanıcı raporu: rot'ta kâğıt
       pencere ortası etrafında salıncağa binip "sapıyordu" — referans uygulama/
       PS masasında kâğıt yerinde döner). Kapı, render pivotuyla birebir
       aynıdır: fit merkez. */
    const fit = ui.fit;
    const cx = fit ? fit.x + fit.w / 2 : rect.width / 2;
    const cy = fit ? fit.y + fit.h / 2 : rect.height / 2;
    const r = -rot * Math.PI / 180;
    const dx = x - cx;
    const dy = y - cy;
    x = cx + dx * Math.cos(r) - dy * Math.sin(r);
    y = cy + dx * Math.sin(r) + dy * Math.cos(r);
  }
  return { x, y };
}

/** Görselin yerleşebileceği alanı (sol ray, sağ panel, üst/alt çubuklar). */
function inkEditorViewport() {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  if (document.body.classList.contains('mode-draw')) {
    // Yeni çizim kabuğu: sol referans ve sağ kart kolonları çizim alanını
    // doğrudan sınırlar. Görünmeyen dock'lar pay bırakmaz.
    let left = 24;
    let right = 24;
    let top = 68;
    let bottom = 24;
    const leftDock = document.getElementById('inkLeftDock');
    const leftRect = leftDock ? leftDock.getBoundingClientRect() : null;
    if (leftRect && leftRect.width > 1 && !document.body.classList.contains('ps-left-closed')) {
      left = Math.max(left, leftRect.right + 22);
    }
    const rightDock = document.getElementById('inkRightDock');
    const rightRect = rightDock ? rightDock.getBoundingClientRect() : null;
    if (rightRect && rightRect.width > 1 && !document.body.classList.contains('ps-right-closed')) {
      right = Math.max(right, vw - rightRect.left + 22);
    }
    const toolbar = document.getElementById('drawFloatToolbar');
    if (toolbar && !toolbar.hidden) {
      const toolbarRect = toolbar.getBoundingClientRect();
      if (toolbarRect.height > 1) top = Math.max(top, toolbarRect.bottom + 14);
    }
    if (vw - left - right < 160) right = Math.max(16, vw - left - 160);
    if (vh - top - bottom < 160) bottom = Math.max(16, vh - top - 160);
    const aw = Math.max(120, vw - left - right);
    const ah = Math.max(120, vh - top - bottom);
    return { vw, vh, left, right, top, bottom, aw, ah };
  }
  let left = 28;      // sol dock yoksa yalnızca güvenli boşluk
  let right = 24;
  let top = 58;       // üst mod anahtarı
  let bottom = 112;   // alt durum çubuğu + fırça şeridi

  // Katman paneli açıksa araç kutusundan da solda olabilir; ikisinin de
  // sağ kenarını hesaba kat. Böylece panel kapalıyken tuval genişler.
  const layers = document.getElementById('inkLayersPanel');
  if (layers && typeof isPanelVisible === 'function' && isPanelVisible(layers)) {
    const lr = layers.offsetLeft + layers.offsetWidth;
    if (lr > 0) left = Math.max(left, lr + 12);
  }

  // Etiketli araç paneli solda; sağ kenarı çizim alanının sol sınırıdır.
  const toolbox = document.getElementById('inkToolbox');
  if (toolbox && !toolbox.hidden) {
    const tr = toolbox.offsetLeft + toolbox.offsetWidth;
    if (tr > 0) left = Math.max(left, tr + 16);
  }

  if (typeof inkUi !== 'undefined' && inkUi.els && inkUi.els.brushPanel &&
      typeof isPanelVisible === 'function' && isPanelVisible(inkUi.els.brushPanel)) {
    const panel = inkUi.els.brushPanel;
    // Panel sağda: offsetLeft dönüşümlerden etkilenmez (animasyon sırasında
    // getBoundingClientRect scale/translate içerebilir).
    right = Math.max(right, vw - panel.offsetLeft + 16);
  }

  // Dar/kısa pencerede sabit paylar çizim alanını yutmasın.
  if (vw - left - right < 160) right = Math.max(16, vw - left - 160);
  if (vh - top - bottom < 160) bottom = Math.max(16, vh - top - 160);

  const aw = Math.max(120, vw - left - right);
  const ah = Math.max(120, vh - top - bottom);
  return { vw, vh, left, right, top, bottom, aw, ah };
}

/** Görseli, açık panelleri ve zoom/kaydırmayı hesaba katarak konumlar. */
function inkEditorComputeFit() {
  const ui = inkEditorUi;
  const v = inkEditorViewport();
  const it = getItem(ui.itemId);
  if (!it) return { x: v.left, y: v.top, w: v.aw, h: v.ah, s: 1 };

  const iw = Math.max(1, it.w || 1);
  const ih = Math.max(1, it.h || 1);
  const baseS = Math.min(v.aw / iw, v.ah / ih);
  const bw = iw * baseS;
  const bh = ih * baseS;

  const view = ui.view || { zoom: 1, panX: 0, panY: 0 };
  const zoom = clamp(Number(view.zoom) || 1, INK_EDITOR_ZOOM_MIN, INK_EDITOR_ZOOM_MAX);
  const w = bw * zoom;
  const h = bh * zoom;
  const cx = v.left + v.aw / 2 + (Number(view.panX) || 0);
  const cy = v.top + v.ah / 2 + (Number(view.panY) || 0);
  // Görselin en az bir parçası ekranda kalsın; tamamen kaybolmasın.
  const mx = Math.min(96, w * 0.5);
  const my = Math.min(96, h * 0.5);
  const x = clamp(cx - w / 2, mx - w, v.vw - mx);
  const y = clamp(cy - h / 2, my - h, v.vh - my);
  return { x, y, w, h, s: w / iw };
}

/** Alt durum çubuğunu (belge, katman, araç, zoom) günceller. */
function inkEditorSyncStatus() {
  const ui = inkEditorUi;
  if (!ui.open) return;
  const it = getItem(ui.itemId);
  const fit = inkEditorComputeFit();
  const sizeEl = document.getElementById('inkScopeSize');
  const infoEl = document.getElementById('inkScopeInfo');
  const zoomEl = document.getElementById('inkZoomValue');

  if (sizeEl) {
    sizeEl.textContent = it
      ? Math.round(it.w || 0) + ' × ' + Math.round(it.h || 0) + ' px'
      : '—';
  }
  if (zoomEl) {
    const pct = it ? Math.round((fit.w / Math.max(1, it.w || 1)) * 100) : 100;
    zoomEl.textContent = Math.max(1, pct) + '%';
  }
  if (infoEl) {
    const ink = typeof inkState === 'function' ? inkState() : null;
    const meta = ink && typeof INK_TOOL_META !== 'undefined' ? INK_TOOL_META[ink.tool] : null;
    const layer = typeof inkLayerById === 'function' ? inkLayerById(ui.layerId) : null;
    const bits = [];
    if (layer) bits.push((layer.locked ? 'Kilitli · ' : '') + (layer.name || 'Layer'));
    if (ink) bits.push((meta ? meta.label : ink.tool) + ' · ' + Math.round(ink.size) + ' px');
    infoEl.textContent = bits.join(' · ') || '—';
    infoEl.title = infoEl.textContent;
  }
  inkEditorSyncCoords(fit);
  const dprEl = document.getElementById('inkScopeDpr');
  if (dprEl) {
    // Ekran ölçek faktörü gerçek devicePixelRatio'dur; render DPR'ı bellek
    // için 2 ile sınırlanır. İkisini karıştırmadan göster.
    const screen = Math.round((window.devicePixelRatio || 1) * 100) / 100;
    const render = Math.round((ui.dpr || 1) * 100) / 100;
    dprEl.textContent = 'DPR ' + screen + '×';
    dprEl.title = 'Screen scale factor ' + screen + '× · render ' + render + '× · canvas '
      + ui.canvas.width + ' × ' + ui.canvas.height + ' px';
  }
  /* FAZ 6 B10: araç değişimi/status kanalında şeritleri tazele —
     şema görünümü (text/eyedropper'da gizle vb.) burada yakalanır. */
  try { inkPowerSlidersSync(); } catch { /* sessiz */ }
}

/** İmlecin belge (piksel) koordinatını durum çubuğuna yazar. */
function inkEditorSyncCoords(fit) {
  const ui = inkEditorUi;
  const coordsEl = document.getElementById('inkScopeCoords');
  if (!coordsEl) return;
  const it = getItem(ui.itemId);
  const c = ui.lastClient;
  if (!it || !c || !fit) {
    coordsEl.textContent = 'X — · Y —';
    return;
  }
  /* A11: durum çubuğu koordinatı da kapıdan iner (rot tersine). */
  const g = inkEditorGatePoint(c.x, c.y);
  const x = g.x;
  const y = g.y;
  if (x < fit.x || x > fit.x + fit.w || y < fit.y || y > fit.y + fit.h) {
    coordsEl.textContent = 'X — · Y —';
    return;
  }
  const px = Math.round((x - fit.x) / Math.max(1e-6, fit.w) * (it.w || 1));
  const py = Math.round((y - fit.y) / Math.max(1e-6, fit.h) * (it.h || 1));
  coordsEl.textContent = 'X ' + px + ' · Y ' + py;
}

/** Zoom'u verilen ekran noktasına sabitleyerek değiştirir. */
function inkEditorSetZoom(next, anchorClient) {
  const ui = inkEditorUi;
  if (!ui.open || ui.stroke) return;
  const it = getItem(ui.itemId);
  if (!it) return;
  const zoom = clamp(Number(next) || 1, INK_EDITOR_ZOOM_MIN, INK_EDITOR_ZOOM_MAX);
  const old = clamp(Number(ui.view.zoom) || 1, INK_EDITOR_ZOOM_MIN, INK_EDITOR_ZOOM_MAX);
  if (Math.abs(zoom - old) < 1e-4) return;

  const before = inkEditorComputeFit();
  const ax = anchorClient ? anchorClient.x : before.x + before.w / 2;
  const ay = anchorClient ? anchorClient.y : before.y + before.h / 2;
  const lx = (ax - before.x) / Math.max(1, before.w);
  const ly = (ay - before.y) / Math.max(1, before.h);

  ui.view.zoom = zoom;
  const after = inkEditorComputeFit();
  /* A11 v2-zoomfix (kullanıcı: "yaklaşınca kare kanvas dikdörtgen oluyor,
     yanlardan kesiyor"): imleç altındaki İÇERİK noktası sabit kalmalı.
     Render haritası S(q) = C + R(θ)(q − C) olduğundan imleç A'nın
     içerik/fit karşılığı a = C + R(−θ)(A − C). Hedef içerik-koordinatı:
     c = (a − A1)/s1 ⇒ sabitlenen fit-origin A2* = a − c·s2. pan hedefe
     DOĞRUDAN kurulur — inkEditorComputeFit'in görünürlük clamp'i lineer
     pan-uzayını ezebilir; clamp render'da yine uygulanır (parça-koruma
     yerinde kalır, mümkünse anchor tam isabet verir). */
  let aX = ax, aY = ay;
  if (Math.abs(Number(ui.view.rot) || 0) > 0.01) {
    /* A11 v3: pivot = fit merkez (kâğıt yerinde döner). */
    const cx = before.x + before.w / 2;
    const cy = before.y + before.h / 2;
    const rr = -(Number(ui.view.rot) || 0) * Math.PI / 180;
    const cs = Math.cos(rr), sn = Math.sin(rr);
    const dx = ax - cx, dy = ay - cy;
    aX = cx + dx * cs - dy * sn;
    aY = cy + dx * sn + dy * cs;
  }
  const cX = (aX - before.x) / Math.max(1e-6, Number(before.s) || 1e-6);
  const cY = (aY - before.y) / Math.max(1e-6, Number(before.s) || 1e-6);
  const tgtX = aX - cX * after.s;
  const tgtY = aY - cY * after.s;
  const vp = inkEditorViewport();
  ui.view.panX = tgtX - (vp.left + vp.aw / 2) + after.w / 2;
  ui.view.panY = tgtY - (vp.top + vp.ah / 2) + after.h / 2;

  inkEditorInvalidate();
  inkEditorSyncStatus();
}

function inkEditorZoomBy(factor, anchorClient) {
  const ui = inkEditorUi;
  const zoom = clamp(Number(ui.view.zoom) || 1, INK_EDITOR_ZOOM_MIN, INK_EDITOR_ZOOM_MAX);
  inkEditorSetZoom(zoom * factor, anchorClient);
}

/** 0: ekrana sığdır. */
function inkEditorZoomFit() {
  const ui = inkEditorUi;
  if (!ui.open) return;
  ui.view.zoom = 1;
  ui.view.panX = 0;
  ui.view.panY = 0;
  inkEditorInvalidate();
  inkEditorSyncStatus();
}

/** 1: %100 — bir görsel pikseli bir ekran pikseli. */
function inkEditorZoomActual() {
  const ui = inkEditorUi;
  if (!ui.open) return;
  const it = getItem(ui.itemId);
  if (!it) return;
  const v = inkEditorViewport();
  const iw = Math.max(1, it.w || 1);
  const ih = Math.max(1, it.h || 1);
  const baseS = Math.min(v.aw / iw, v.ah / ih);
  ui.view.zoom = clamp(1 / Math.max(1e-6, baseS), INK_EDITOR_ZOOM_MIN, INK_EDITOR_ZOOM_MAX);
  ui.view.panX = 0;
  ui.view.panY = 0;
  inkEditorInvalidate();
  inkEditorSyncStatus();
}

function inkEditorWheel(event) {
  const ui = inkEditorUi;
  if (!ui.open) return;
  // Alt + tekerlek mevcut fırça boyutu kısayoludur.
  if (event.altKey) {
    if (typeof inkHandleWheel === 'function') inkHandleWheel(event);
    return;
  }
  if (ui.stroke) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.ctrlKey || event.metaKey) {
    /* Ctrl/Cmd + tekerlek zoom. "Cursor-anchored zoom" AÇIKSA imlecin
       altındaki nokta sabit kalır; KAPALIYSA tuval merkezi sabit kalır.
       Anahtar hiç yoksa açık kabul edilir (eski davranış bozulmasın). */
    let atCursor = true;
    try { atCursor = localStorage.getItem('tailref-zoom-cursor') !== '0'; } catch { /* sessiz */ }
    const rect = ui.canvas.getBoundingClientRect();
    const anchor = atCursor
      ? { x: event.clientX, y: event.clientY }
      : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const factor = Math.exp(-event.deltaY * 0.0022);
    inkEditorZoomBy(factor, anchor);
    return;
  }
  // Düz tekerlek: dikey kaydır; Shift ile yatay. A11 v3: delta ekran
  // uzayıdır ve pivot=fit merkez modelinde fit'e birebir eklenir
  // (−rot gömme kaldırıldı — kâğıdı çapraz bajordürüyordu).
  if (event.shiftKey) {
    const d = inkEditorRotFilterDelta(-(event.deltaY || event.deltaX), 0);
    ui.view.panX += d.x;
    ui.view.panY += d.y;
  } else {
    const d = inkEditorRotFilterDelta(-event.deltaX, -event.deltaY);
    ui.view.panX += d.x;
    ui.view.panY += d.y;
  }
  inkEditorInvalidate();
  inkEditorSyncStatus();
}

function inkEditorPanStart(event) {
  const ui = inkEditorUi;
  if (!ui.open) return false;
  ui.panning = {
    pointerId: event.pointerId,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: 0, // radial hush: gerçek sürükleme mi, yoksa mı tık mı
  };
  try { ui.canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
  // Kaydırma sırasında fırça halkası anlamsız; hemen temizlenmesi için
  // imleci yeniden çiz (halka çizimi panning durumunda atlanıyor).
  ui.lastClient = { x: event.clientX, y: event.clientY };
  inkEditorSyncCursorStyle();
  inkEditorInvalidate();
  return true;
}

function inkEditorPanMove(event) {
  const ui = inkEditorUi;
  const pan = ui.panning;
  if (!pan || pan.pointerId !== event.pointerId) return false;
  const rawX = event.clientX - pan.lastX;
  const rawY = event.clientY - pan.lastY;
  pan.moved += Math.abs(rawX) + Math.abs(rawY);
  /* A11 v3: sürükleme deltası EKRANDA birebir — fit-pan deltası ekran
     deltasıyla aynıdır (pivot=fit merkez; eski −rot gömme "yukarı
     kaydırınca sağa sola gidiyor" bug'ını geri getirmişti). */
  const d = inkEditorRotFilterDelta(rawX, rawY);
  ui.view.panX += d.x;
  ui.view.panY += d.y;
  pan.lastX = event.clientX;
  pan.lastY = event.clientY;
  // Halka gizli ama konum tazelensin: kaydırma bitince imlecin olduğu
  // yerde belirsin, kalkış noktasında takılı kalmasın.
  ui.lastClient = { x: event.clientX, y: event.clientY };
  inkEditorInvalidate();
  return true;
}

function inkEditorPanEnd(event) {
  const ui = inkEditorUi;
  const pan = ui.panning;
  if (!pan) return false;
  ui.panning = null;
  try { ui.canvas.releasePointerCapture(event ? event.pointerId : pan.pointerId); } catch { /* sessiz */ }
  /* Gerçekten kaydırıldıysa bırakışta gelen auxclick radial menüyü
     açmasın (pan bırakışı ≠ menü isteği). 6px'in altı tık sayılır. */
  if (pan.moved > 6 && typeof inkRadialHushClicks === 'function') inkRadialHushClicks(450);
  if (event && Number.isFinite(event.clientX)) {
    ui.lastClient = { x: event.clientX, y: event.clientY };
  }
  inkEditorSyncCursorStyle();
  inkEditorSyncStatus();
  inkEditorCursorInvalidate();
  return true;
}

function inkEditorCheckerPattern() {
  const ui = inkEditorUi;
  if (ui.checker) return ui.checker;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 16;
  const g = tile.getContext('2d', { colorSpace: 'srgb' });
  g.fillStyle = '#191c23';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#222732';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  ui.checker = ui.ctx.createPattern(tile, 'repeat');
  return ui.checker;
}

function inkEditorInvalidate() {
  const ui = inkEditorUi;
  if (!ui.ready || !ui.open) return;
  ui.needsRender = true;
  if (ui.renderQueued) return;
  ui.renderQueued = true;
  ui.raf = requestAnimationFrame(inkEditorLoop);
}

/** Geri al/yinele sonrası açık editörün önbelleklerini düşürür. Katman
    tuvali değiştiği hâlde taban tuvali eski kareyi tutuyorsa değişiklik
    ekranda görünmüyordu; burada taban anahtarı sıfırlanır.

    EVRE 4-C (undoChip): delta undo/redo TEK bölgede etki yaratır.
    Bölge küçükse tam kare yeniden kompozit yerine kare çipi beslenir:
    baseKey bilerek KORUNUR (taban değişmedi), karo defteri kiremitte
    reset KALDI (undo'da karo kaynağı kesin bayat). Bölge ≥ %60 tuvalse
    ya da kiremit açıksa çip devre dışı — çağıran null geçer/tam reset.
    @param {object} [undoChip] { x,y,w,h,spaceW,spaceH } katman-px */
function inkEditorAfterRestore(undoChip) {
  const ui = inkEditorUi;
  if (!ui.open) return;
  /* Sahip kilidi: bağımsız öğe/belge undo'su bu editör tuvalini etkilemez;
     çip (yanlış renk uzayı) yerinde uygulanmasın → tam reset güvenli yol. */
  if (undoChip && undoChip.ownerId && undoChip.ownerId !== ui.itemId) {
    undoChip = null;
  }
  if (undoChip) {
    /* Çip ezme yerine çip BİRLEŞTİRME. Uzun basışta (klavye tekrarı)
       undo'lar tek karede üst üste biner: eskiden her yeni undo
       bir önceki çiPE yazıyordu — basılamayan bölge bayat pikselle
       kalıyor, "tuvalin yarısı eski" görünüyor, sonraki tam kare
       yenilemede kendiliğinden düzeliyor ("bazen çalışıyor"
       algısının asıl kaynaklarından). Şimdi kesişen/bitişik çipler
       tek dikdörtgende birikir; kare birleşmiş bölgeyi bir seferde
       basar. Birleşik alan tuvalin %60'ını aşarsa çip yarsızdır →
       güvenli tam resete düşün. */
    const prev = ui.frameChip;
    if (prev && prev.spaceW === undoChip.spaceW && prev.spaceH === undoChip.spaceH &&
        !(undoChip.x + undoChip.w < prev.x || prev.x + prev.w < undoChip.x ||
          undoChip.y + undoChip.h < prev.y || prev.y + prev.h < undoChip.y)) {
      const x0 = Math.min(prev.x, undoChip.x);
      const y0 = Math.min(prev.y, undoChip.y);
      const x1 = Math.max(prev.x + prev.w, undoChip.x + undoChip.w);
      const y1 = Math.max(prev.y + prev.h, undoChip.y + undoChip.h);
      undoChip = {
        x: x0, y: y0, w: x1 - x0, h: y1 - y0,
        spaceW: undoChip.spaceW, spaceH: undoChip.spaceH,
        ownerId: undoChip.ownerId || prev.ownerId,
      };
    }
    if (undoChip && undoChip.w * undoChip.h >= undoChip.spaceW * undoChip.spaceH * 0.6) {
      undoChip = null; // birleşik bölge çok geniş — tam reset daha ucuz
    }
  }
  if (undoChip) {
    /* SEÇİMLİ yol: yalnız boyama önbellekleri düşer; taban ve sahne
       anahtarları sağlam kalır, bir sonraki inkEditorRender karesi
       inkEditorFrameChipPaint ile bölgesel kurulur. */
    ui.frameChip = undoChip;
    ui.previewDirty = false;
    ui.previewSkip = 0;
    if (ui.previewGl && typeof inkDabGlRelease === 'function') inkDabGlRelease();
    ui.previewGl = false;
    ui.previewCanvas = null;
    ui.previewRect = null;
    ui.scratch = null;
    ui.lastShapeRasterRect = null;
    ui.dualWts = null;
    ui.dualComp = null;
    ui.dualCompPts = 0;
    ui.layerCanvas = null;
    ui.overlaySyncAt = 0;
    ui.loopLastAt = 0;
    ui.slowFrames = 0;
    ui.renderFlip = 0;
    ui.stroke = null;
    ui.gizmoDrag = null;
    ui.marquee = null;
    ui.lasso = null;
    inkEditorInvalidate();
    return;
  }
  ui.baseKey = '';
  ui.baseWide = false;
  ui.previewDirty = false;
  ui.previewSkip = 0;
  if (ui.previewGl && typeof inkDabGlRelease === 'function') inkDabGlRelease();
  ui.previewGl = false;
  ui.previewCanvas = null;
  ui.previewRect = null;
  ui.scratch = null;
  ui.lastShapeRasterRect = null;
  ui.dualWts = null;
  ui.dualComp = null;
  ui.dualCompPts = 0;
  ui.layerCanvas = null;
  ui.overlaySyncAt = 0;
  ui.coordsSyncAt = 0;
  ui.loopLastAt = 0;
  ui.slowFrames = 0;
  ui.renderFlip = 0;
  ui.stroke = null;
  ui.gizmoDrag = null;
  ui.marquee = null;
  ui.lasso = null;
  // Tur 2 madde 5: bekleyen kare çipi yapısal resette geçersiz.
  ui.frameChip = null;
  // Kiremit: undo/redo/geri dönüş sonrası karo defteri bayat — kesin reset.
  // (10.11 düzeltme: yalnız tileViewOn koşuluna bağlıydı; örtü barındığında
  // tileViewOn bayrağı bayat sayılarda kalabiliyordu — kapı testi
  // ink-undo-frame-check doğru bu davranışı yakaladı.)
  inkEditorTileReset();
  ui.tvLive = null;
  ui.tvCommitArmed = false;
  inkEditorInvalidate();
}

/** Yalnızca fırça halkasını (ayrı tuval) ve koordinat metnini tazeler.
    İmleç gezdirirken tüm sahneyi yeniden çizmeye gerek yok. */
function inkEditorCursorFrame() {
  const ui = inkEditorUi;
  ui.cursorRaf = 0;
  ui.cursorQueued = false;
  if (!ui.open) return;
  inkEditorDrawCursor();
  inkEditorSyncCoords(ui.fit);
}

function inkEditorCursorInvalidate() {
  const ui = inkEditorUi;
  if (!ui.ready || !ui.open) return;
  if (ui.cursorQueued) return;
  ui.cursorQueued = true;
  ui.cursorRaf = requestAnimationFrame(inkEditorCursorFrame);
}

function inkEditorLoop() {
  const ui = inkEditorUi;
  ui.renderQueued = false;
  ui.raf = 0;
  if (!ui.open) {
    ui.needsRender = false;
    return;
  }
  if (!ui.needsRender) return;
  /* M6 · uyarlanabilir sahne render kısınlama. Sinyal rAF kadansıdır:
     vuruş sırasında kareler şişerse (dt > 25 ms ×2 arka arkaya — raster/
     kompozitör darboğazı, düşük donanım) sahne render'ı ALTERNATİF karede
     bir atlanır; şahlanmayan kare ≪ hafif olduğundan ortalama kare süresi
     yarıya iner. Hızlı makinelerde dt her zaman eşiğin altında olduğundan
     devreye girmez — his/kalite etkisi sıfır. Atlanan kareler israf
     etmez: dab yürüyüşü + kompozit de render'ın içindesin, bir sonraki
     render'a ertelenir (artımlı sayaçlar aynen). İmleç halkası kendi
     rAF döngüsünde tam hızda kalır. */
  const loopNow = performance.now();
  const loopDt = loopNow - (ui.loopLastAt || loopNow);
  ui.loopLastAt = loopNow;
  if (ui.stroke && loopDt > 25 && loopDt < 200) {
    ui.slowFrames = (ui.slowFrames || 0) + 1;
  } else if (!ui.stroke || loopDt < 18) {
    ui.slowFrames = 0;
  }
  // Kiremit otomatik profil kumpası: vuruş kare dt örnekleri + peak.
  if (ui.tileViewOn && ui.stroke && inkTileSizeSetting() === 'auto') {
    if (loopDt > 1 && loopDt < 200) {
      (ui.tileProfDt || (ui.tileProfDt = [])).push(loopDt);
    }
    ui.tileProfSlow = Math.max(ui.tileProfSlow || 0, ui.slowFrames || 0);
  }
  let skipRender = false;
  if (ui.slowFrames >= 2) {
    ui.renderFlip = ((ui.renderFlip || 0) + 1) & 1;
    skipRender = ui.renderFlip === 1;
  } else {
    ui.renderFlip = 0;
  }
  if (skipRender) {
    inkEditorInvalidate();
    return;
  }
  inkEditorRender();
  // Render sırasında yeni bir değişiklik geldiyse bir sonraki karede tamamla.
  if (ui.needsRender && !ui.renderQueued) inkEditorInvalidate();
}

/** Taban (arka plan + görsel) katmanı önbelleğe alır.
    Gölge/dama deseni her karede yeniden üretilmez; yalnızca görünüm
    değişince (fit/DPR/görsel) yeniden çizilir. */
function inkEditorDrawBase(fit, img) {
  const ui = inkEditorUi;
  const cw = ui.canvas.width;
  const ch = ui.canvas.height;
  const dpr = ui.dpr || 1;
  /* A11 v4 (kullanıcı raporu: "rotate yapılmış kanvasa yakınlaşınca
     kağıt kesiliyor"): taban bitmap taşıyıcısı görünüm alanı boyutunda
     olduğundan kâğıt dönmemiş hâliyle viewport DIŞINDA kalan bölgeyi
     hiç içermiyordu; rot ≠ 0'da o bölge ekrana dönüp girince diyagonal
     kesik bantlar görünüyordu (rot −45, zoom 1.5–2.25'de ölçüldü: kesik
     hattı x+y ≈ 1844, ile fit alt kenarının y=940 dönmüşü birebir).
     Çözüm: rot ≠ 0 iken viewport'u render pivotu etrafında −rot ile
     geri döndürüp sarıcı kutu çık, tabanı O boyut ve öteleme ile üret.
     rot = 0 iken öteleme 0 — davranış eskisi gibi. */
  let bx = 0, by = 0, bw = cw, bh = ch;
  const rotDeg = Number(ui.view.rot) || 0;
  /* A11 v5 (kullanıcı videosu 17-57-11: zoom'luyken döndürürken köşe
     kesikleri + "rastgele hareket"): sürükleme boyunca base'i tek kurulum
     taşımak için drag-başı GENİŞ kapsama kutusu kurulur. Gerekli bölge
     = her çerçevede ekrana düşen kâğıt pikselleri = kâğıt ∩ disk(pivot,
     rmax); rmax = pivotun viewport köşelerine en uzak mesafesi (dönüş
     mesafe korur). Kutu fit ∩ box(pivot±rmax) ile sınırlı — ÇOK taşan
     viewport durumunda bile kâğıt kadar büyür, (cw+ch)² aşmaz. */
  if (ui.baseWide) {
    const pcx = (fit.x + fit.w / 2) * dpr;
    const pcy = (fit.y + fit.h / 2) * dpr;
    let rmax = 0;
    for (const corner of [[0, 0], [cw, 0], [0, ch], [cw, ch]]) {
      rmax = Math.max(rmax, Math.hypot(corner[0] - pcx, corner[1] - pcy));
    }
    const fx0 = fit.x * dpr, fy0 = fit.y * dpr;
    const fx1 = (fit.x + fit.w) * dpr, fy1 = (fit.y + fit.h) * dpr;
    const QUANT = 128, PAD = 8;
    bx = Math.floor((Math.max(fx0, pcx - rmax) - PAD) / QUANT) * QUANT;
    by = Math.floor((Math.max(fy0, pcy - rmax) - PAD) / QUANT) * QUANT;
    bw = Math.ceil((Math.min(fx1, pcx + rmax) + PAD - bx) / QUANT) * QUANT;
    bh = Math.ceil((Math.min(fy1, pcy + rmax) + PAD - by) / QUANT) * QUANT;
  } else if (Math.abs(rotDeg) > 0.01) {
    const rr = -rotDeg * Math.PI / 180;
    const cr = Math.cos(rr), sr = Math.sin(rr);
    const pcx = (fit.x + fit.w / 2) * dpr; // render pivotu (device px)
    const pcy = (fit.y + fit.h / 2) * dpr;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const corner of [[0, 0], [cw, 0], [0, ch], [cw, ch]]) {
      const cdx = corner[0] - pcx, cdy = corner[1] - pcy;
      const x = pcx + cdx * cr - cdy * sr;
      const y = pcy + cdx * sr + cdy * cr;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    // Kenar yumuşatma + 128px ızgara: pan sırasında sık yeniden boyut
    // (realloc) olmasın; kutu kaydıkça nadiren değişsin.
    const QUANT = 128;
    const PAD = 2;
    bx = Math.floor((minx - PAD) / QUANT) * QUANT;
    by = Math.floor((miny - PAD) / QUANT) * QUANT;
    bw = Math.ceil((maxx + PAD - bx) / QUANT) * QUANT;
    bh = Math.ceil((maxy + PAD - by) / QUANT) * QUANT;
  }
  const key = [
    ui.dpr, cw, ch, bx, by, bw, bh,
    Math.round(fit.x * 10) / 10, Math.round(fit.y * 10) / 10,
    Math.round(fit.w * 10) / 10, Math.round(fit.h * 10) / 10,
    ui.itemId, img.currentSrc || img.src || '',
    /* A11 v5: geniş modda içerik rotasyondan bağımsız — anahtar rot
       içermez; sürükleme karelerinde base yeniden kurulmaz. */
    ui.baseWide ? 'wide' : Math.round(rotDeg * 10) / 10,
  ].join('|');
  if (ui.baseCanvas && ui.baseKey === key) return ui.baseCanvas;

  if (!ui.baseCanvas) ui.baseCanvas = document.createElement('canvas');
  const base = ui.baseCanvas;
  if (base.width !== bw || base.height !== bh) {
    base.width = bw;
    base.height = bh;
  }
  ui.baseOffset = { x: bx, y: by };
  const g = base.getContext('2d', { colorSpace: 'srgb' });
  if (!g) return null;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, bw, bh);
  // Arka plan (koyu ızgara) CSS'te #inkEditor üzerinde durur; taban
  // tuvali yalnızca görsel + dama deseni + gölgeyi taşır. Böylece ızgara
  // her pan/zoom karesinde yeniden çizilmez. Öteleme transformun öte
  // bileşeninde (bx/by device px) uygulanır; çizim kodu fit'e göre
  // değişmez.
  g.setTransform(dpr, 0, 0, dpr, -bx, -by);

  const pattern = inkEditorCheckerPattern();
  // Gölge yalnızca görselin alfa maskesinden taşar; kutunun içi dama
  // deseniyle kalır.
  g.save();
  g.shadowColor = 'rgba(0,0,0,.55)';
  g.shadowBlur = 30 * Math.max(1, ui.dpr || 1);
  g.drawImage(img, fit.x, fit.y, fit.w, fit.h);
  g.restore();

  g.save();
  if (pattern) {
    g.fillStyle = pattern;
    g.fillRect(fit.x, fit.y, fit.w, fit.h);
  } else {
    g.clearRect(fit.x, fit.y, fit.w, fit.h);
  }
  g.restore();
  g.drawImage(img, fit.x, fit.y, fit.w, fit.h);

  ui.baseKey = key;
  return base;
}

/**
 * Küçük zoom'da katman tuvalini kademeli yarımlayarak önbelleğe alır.
 *
 * Canvas2D'nin varsayılan küçültme filtresi 3–4 kat küçültmede mipmap
 * üretmediği için ince vuruşlar kesik/lekeli görünüyordu. Burada görsel
 * önce 1.25'lik kuantalı bir hedefe, her adımda yarıya indirilerek
 * taşınır; son adım hedef piksel boyutuna yüksek kaliteyle çizilir.
 *
 * Önbellek anahtarı katmanın boya dönemini (paint epoch) ve hedef boyutu
 * içerir; yeni vuruş yapıldığında eski kare kendiliğinden geçersiz olur.
 */
/* =========================================================
   FAZ 7.P — katman pyramiti (kalıcı yarımlama katmanları)
   ---------------------------------------------------------
   Eski davranış: her boya dönemi (epoch) mini tam yarımlama zincirinden
   yeniden kuruluyordu; 4K'da bu commit başına ~50 ms'e satıyordu.
   Yeni: yarımlama katmanları katman başına KALICI; epoch değişiminde
   yalnızca bildirilen kirli bölge(lar) yamanır (inkPaintEpochRectsIfFresh
   — 35-ink-worker bump köprüsü). Bölge bilgisi yoksa tam kursetlik eski
   davranışa döner (güvenli geri düşme).
   ========================================================= */
function inkPyramidLevelSize(srcW, srcH, k) {
  let w = srcW, h = srcH;
  for (let i = 0; i < k; i += 1) {
    const nw = Math.max(1, Math.round(w / 2));
    const nh = Math.max(1, Math.round(h / 2));
    if (nw === w && nh === h) return { w, h, exhausted: true };
    w = nw;
    h = nh;
  }
  return { w, h, exhausted: false };
}

/** Pyramit liflerini kurar veya patch'ler. src: katmanın TAM kanvastı.
    Donanım: her seviyenin son içeriği src'den BÖLGEYE bağımsız hiç
    değişmiyorsa tam kursettiğimiz pudding'le aynı olur; bölge yaması
    yalnızca kırpma kesitiyle değişen pikselleri taşır. */
function inkEditorPyramidSync(layer, src, epoch) {
  const ui = inkEditorUi;
  let p = ui.pyramid.get(layer.id);
  if (!p || p.srcW !== src.width || p.srcH !== src.height) {
    p = { appliedEpoch: -1, srcW: src.width, srcH: src.height, levels: new Map() };
    ui.pyramid.set(layer.id, p);
  }
  if (p.appliedEpoch === epoch) return p;
  const t0 = performance.now();
  /* Tur 4l: appliedEpoch-farkındalıklı okuma — tüketicinin görmediği
     TÜM bump'ların rect'leri birikimden gelir (eski IfFresh yalnız son
     bump'ınkini taşıyordu; mini yolun atlandığı zoom'lardaki vuruşlar
     seviyelerden kalıcı kayboluyordu). Yeni köprü yoksa eski yol. */
  const dirty = typeof inkPaintEpochDirtySince === 'function'
    ? inkPaintEpochDirtySince(layer.id, p.appliedEpoch)
    : (typeof inkPaintEpochRectsIfFresh === 'function'
      ? inkPaintEpochRectsIfFresh(layer.id, epoch) : null);
  const full = !dirty || dirty.full;
  // seviyeleri kur/bul
  const K = 5;
  for (let k = 1; k <= K; k += 1) {
    const size = inkPyramidLevelSize(src.width, src.height, k);
    if (size.exhausted || size.w < 128 || size.h < 128) break;
    let lv = p.levels.get(k);
    const needBuild = !lv || lv.w !== size.w || lv.h !== size.h;
    const g = needBuild ? null
      : (() => { try { return lv.canvas.getContext('2d', { colorSpace: 'srgb' }); } catch { return null; } })();
    if (needBuild || full) {
      // tam kursetlik: üst seviyeden (k-1) veya src'den zinusu basmalı
      const source = k === 1 ? src
        : (p.levels.get(k - 1)?.canvas || src);
      if (!lv) {
        lv = { w: size.w, h: size.h, canvas: document.createElement('canvas') };
        lv.canvas.width = size.w;
        lv.canvas.height = size.h;
        p.levels.set(k, lv);
      } else {
        lv.canvas.width = size.w;
        lv.canvas.height = size.h;
      }
      const lg = lv.canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!lg) continue;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalAlpha = 1;
      lg.globalCompositeOperation = 'source-over';
      lg.clearRect(0, 0, size.w, size.h);
      lg.imageSmoothingEnabled = true;
      lg.imageSmoothingQuality = 'high';
      lg.drawImage(source, 0, 0, source.width, source.height, 0, 0, size.w, size.h);
    } else {
      // bölge yaması: her kirli kutu src'den kırp-ölçekle (kenar örnekleme:
      // kutu dışına büyütülmüş pad ile benzer dünyaya yaklaş)
      if (!lv) {
        lv = { w: size.w, h: size.h, canvas: document.createElement('canvas') };
        lv.canvas.width = size.w;
        lv.canvas.height = size.h;
        p.levels.set(k, lv);
        const lg0 = lv.canvas.getContext('2d', { colorSpace: 'srgb' });
        if (lg0) {
          lg0.imageSmoothingEnabled = true;
          lg0.imageSmoothingQuality = 'high';
          lg0.drawImage(src, 0, 0, src.width, src.height, 0, 0, size.w, size.h);
        }
        continue;
      }
      const lg = lv.canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!lg) continue;
      lg.imageSmoothingEnabled = true;
      lg.imageSmoothingQuality = 'high';
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalAlpha = 1;
      lg.globalCompositeOperation = 'source-over';
      const pad = 3 * (1 << k);
      for (const r of dirty.rects) {
        const x = Math.max(0, Math.floor((r.x - pad) / (1 << k)));
        const y = Math.max(0, Math.floor((r.y - pad) / (1 << k)));
        const x1 = Math.min(size.w, Math.ceil((r.x + r.w + pad) / (1 << k)));
        const y1 = Math.min(size.h, Math.ceil((r.y + r.h + pad) / (1 << k)));
        if (x1 <= x || y1 <= y) continue;
        lg.clearRect(x, y, x1 - x, y1 - y);
        lg.drawImage(src, x * (1 << k), y * (1 << k),
          (x1 - x) * (1 << k), (y1 - y) * (1 << k),
          x, y, x1 - x, y1 - y);
      }
    }
  }
  p.appliedEpoch = epoch;
  /* Tur 4l: tüketim kancası — bu döneme kadar olan birikim düştü;
     sonraki sync yalnız yeni bump'ları yamar. */
  if (typeof inkPaintEpochDirtySynced === 'function') {
    inkPaintEpochDirtySynced(layer.id, epoch);
  }
  if (typeof inkPerfSpan === 'function') {
    if (full) inkPerfCount('pyrFull');
    else inkPerfCount('pyrPatch');
    inkPerfSpan('pyrSync', performance.now() - t0);
  }
  return p;
}

function inkEditorScaledSource(layer, src) {
  const ui = inkEditorUi;
  const fit = ui.fit;
  if (!layer || !src || !src.width || !src.height) return src;
  const tw = Math.max(1, Math.round(fit.w * ui.dpr));
  const th = Math.max(1, Math.round(fit.h * ui.dpr));
  // Küçültme yoksa doğrudan çiz.
  if (tw >= src.width * 0.8 || th >= src.height * 0.8) return src;

  const scale = Math.min(tw / src.width, th / src.height);
  // 1.25'lik basamaklara yuvarla; zoom oynarken aynı önbellek kullanılsın.
  const quantum = Math.pow(1.25, Math.ceil(Math.log(Math.max(scale, 0.0001)) / Math.log(1.25)));
  const qw = Math.max(1, Math.min(src.width, Math.round(src.width * quantum)));
  const qh = Math.max(1, Math.min(src.height, Math.round(src.height * quantum)));

  const epoch = typeof inkPaintEpoch === 'function' ? inkPaintEpoch(layer.id) : 0;
  const key = layer.id + '|' + epoch + '|' + qw + 'x' + qh;
  const cached = ui.scaledCache.get(key);
  const t0 = performance.now();
  if (cached) {
    // LRU yaşı: erişilen girişin önceliği tazelensin — katman sayısı
    // kapasiteyi aşan sahnelarda sık kullanılan miniler silinmesin.
    ui.scaledCache.delete(key);
    ui.scaledCache.set(key, cached);
    return cached;
  }

  /* FAZ 7.P: en derin pyramit seviyesi seç; miniyi ZAMANLA ondan bas. */
  const point = inkEditorPyramidSync(layer, src, epoch);
  let source = src;
  if (point) {
    let bestK = 0;
    point.levels.forEach((lv, k) => {
      if (lv.w >= qw && lv.h >= qh && k > bestK) bestK = k;
    });
    if (bestK > 0) source = point.levels.get(bestK).canvas;
  }

  const out = document.createElement('canvas');
  out.width = qw;
  out.height = qh;
  const g = out.getContext('2d', { colorSpace: 'srgb' });
  if (!g) return src;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, source.width, source.height, 0, 0, qw, qh);
  if (typeof inkPerfSpan === 'function') inkPerfSpan('scaledBuild', performance.now() - t0);

  /* FAZ 7.T (byte-pool): aynı (katman, boyut) küpünün BAYAT episode
     minileri ayıkla. Anahtar epoch içerdiğinden her vuruş bump yeni
     anahtar üretiyor; eski mini LRU eşiği örtülce canlı kalıyordu
     (envanter: 4K sahnede ~9× 644×362 kopya ≈ 8 MB). Tek tutar
     durağanlandır: yalnız yaşayan güncel mini kalır. */
  const stalePrefix = layer.id + '|';
  const staleSuffix = '|' + qw + 'x' + qh;
  if (ui.scaledCache.size) {
    for (const k of ui.scaledCache.keys()) {
      if (k !== key && k.startsWith(stalePrefix) && k.endsWith(staleSuffix)) {
        ui.scaledCache.delete(k);
      }
    }
  }
  ui.scaledCache.set(key, out);
  // Kapasite: sabit 16, katman sayısı 16'dan fazla sahnelarda sürekli
  // silmeye yol açıyordu (ölçüm: vuruş başına ~15-16 mini yeniden
  // kurulum). Katman sayısı + boya dönemi payı yeterli ve ölçülü.
  const cap = Math.min(64, Math.max(16,
    (inkLayersForOwner(ui.itemId) || []).length + 4));
  while (ui.scaledCache.size > cap) {
    const first = ui.scaledCache.keys().next().value;
    ui.scaledCache.delete(first);
  }
  return out;
}

/* =========================================================
   Kiremit aşama 2 (dilim 2) — karo görüntü ızgarası painter'ı.
   tileViewOn kapalıyken hiçbir yol buraya uğramaz. Referans model
   GERÇEK MOTOR DUR: inkEditorRender tam yol (tek kare). Painter'ın
   her çizim işlemi tam yolla AYNI mutlak cihaz-px konumda çalışır;
   böylece karo içeriği tam kareyle byte-parite olur:
     • YENİ DOĞAN karo: tam karo kutusuna tam sahne kompoziti
       (Krita/PS kalıbı — karo kâğıdıyla birlikte doğar).
     • YAŞAYAN karo: yalnız bu karenin kirli bölgesi (chip kutusu)
       temizlenip yeniden komposit edilir; bölge dışı içerik
       anahtarlar değişmediği için tam kareyle aynıdır.
   ========================================================= */

/* ---- karo boyutu ayarı (dilim 3) --------------------------------
   Değer: localStorage 'tailref-ink-tile-size' = 'auto'|'128'|'256'|'512'
   Otomatik: cihaz ilk vuruşta sessiz ölçülür (M6 dt + slowFrames sinyali)
   → zayıf=512 / normal=256 / güçlü=256; sonuç ta kalıcıdır.
   Kaçış hatch: 'tailref-ink-tiles'='0' → ızgara tümüyle kapalı (1.4.0
   davranışına döner). Boyut değişimi YALNIZ vuruşlar arasında uygulanır. */
const INK_TILE_SIZE_KEY = 'tailref-ink-tile-size';
const INK_TILE_AUTO_KEY = 'tailref-ink-tile-auto';

function inkTilesEnabled() {
  try { return localStorage.getItem('tailref-ink-tiles') !== '0'; }
  catch { return true; }
}

function inkTileSizeSetting() {
  try {
    const v = localStorage.getItem(INK_TILE_SIZE_KEY);
    if (v === '128' || v === '256' || v === '512') return v;
  } catch { /* sessiz */ }
  return 'auto';
}

/** Ayar → etkili karo boyutu (CSS px). Probe önceliği: window.__inkTileSize. */
function inkTileSizeCur() {
  const probe = Math.round(Number(window.__inkTileSize) || 0);
  if (INK_TILE_VIEW_SIZES.includes(probe)) return probe;
  const s = inkTileSizeSetting();
  if (s !== 'auto') return Number(s);
  let auto = 0;
  try { auto = Number(localStorage.getItem(INK_TILE_AUTO_KEY)) || 0; } catch { /* sessiz */ }
  return INK_TILE_VIEW_SIZES.includes(auto) ? auto : inkTileViewNormalizeSize(256);
}

/** Ayar yazımı; boyut yalnız vuruşlar arasında uygulanır (sözleşme). */
function inkTileSizeSet(v) {
  const val = (v === '128' || v === '256' || v === '512') ? v : 'auto';
  try { localStorage.setItem(INK_TILE_SIZE_KEY, val); } catch { /* sessiz */ }
  const ui = inkEditorUi;
  if (ui.tileView && !ui.stroke) {
    const want = inkTileSizeCur();
    if (ui.tileView.tileSize !== want) {
      ui.tileView.setTileSize(want);    // defteri tasfiye eder (sparse doğum)
    }
  }
}

/* Otomatik profilin komutu: kumpas örneklerinden tek karar.
   Yetersiz örnek → null (sonraki vuruş tekrar ölçer). */
function inkTileProfileDecide() {
  const ui = inkEditorUi;
  const dts = ui.tileProfDt || [];
  ui.tileProfDt = null;
  if (dts.length < 8) return null;             // kısa/aksak vuruş → sakın
  const s = dts.slice().sort((a, b) => a - b);
  const med = s[s.length >> 1];
  // zayıf: M6 eşiği (25 ms ×2) + medyan doygun → büyük karo (512)
  return ((ui.tileProfSlow || 0) >= 4 || med > 25) ? 512 : 256;
}

/* Görüntü karo gridini (gerekiyorsan) kurar; daima döner ya da null. */
function inkEditorTileView() {
  const ui = inkEditorUi;
  if (ui.tileView) return ui.tileView;
  if (typeof TileGridView !== 'function') return null;
  const parent = ui.canvas && ui.canvas.parentElement;
  if (!parent) return null;
  const host = document.createElement('div');
  host.setAttribute('data-ink-tile-view', '1');
  host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
    'overflow:hidden;pointer-events:none;' +
    (ui.tileProbe ? 'visibility:hidden;' : '');
  parent.insertBefore(host, ui.canvas.nextSibling);
  ui.tileView = new TileGridView({
    container: host,
    dpr: ui.dpr || 1,
    tileSize: inkTileSizeCur(),
    painter: inkEditorTilePainter,
  });
  ui.tileView.open = true;              // grid devrede (ui.tileViewOn'un muadili)
  ui.tileView.__vw = 0;
  ui.tileView.__vh = 0;
  return ui.tileView;
}

/* Bölge tamponu: cihaz-px; yalnız büyütülür (GC dostu yeniden atama). */
function inkEditorTileEnsureBuf(dw, dh) {
  const ui = inkEditorUi;
  if (!ui.tileBuf) {
    ui.tileBuf = document.createElement('canvas');
    ui.tileBuf.__tw = 0;
    ui.tileBuf.__th = 0;
  }
  if (ui.tileBuf.__tw < dw) { ui.tileBuf.width = dw; ui.tileBuf.__tw = dw; }
  if (ui.tileBuf.__th < dh) { ui.tileBuf.height = dh; ui.tileBuf.__th = dh; }
  return ui.tileBuf;
}

/* Bir karedeki kirli karo belgesi: 1) gridini boyutlandır,
   2) chip bölgesini kirli işaretle, 3) drain — her kirli karo
   painter'a verilir (yeni doğan = tam kutu, yaşayan = bölge). */
function inkEditorTileFrame(base, layers, fit, dx0, dy0, dw0, dh0) {
  const ui = inkEditorUi;
  const tv = inkEditorTileView();
  if (!tv || !base || dw0 <= 0 || dh0 <= 0) return false;
  const dpr = ui.dpr || 1;
  const viewW = Math.max(1, Math.round(ui.canvas.width / dpr));
  const viewH = Math.max(1, Math.round(ui.canvas.height / dpr));
  if (tv.__vw !== viewW || tv.__vh !== viewH) {
    tv.setSize(viewW, viewH);
    tv.__vw = viewW;
    tv.__vh = viewH;
  }
  if (tv.dpr !== dpr) {            // dpr değişti: karo geometrisi geçersiz
    tv.dpr = dpr;
    tv.disposeAll();
  }
  const want = inkTileSizeCur();   // boyut değişimi yalnız vuruşlar arası
  if (tv.tileSize !== want && !ui.stroke) tv.setTileSize(want);
  /* Tur 4i · seri-çizim dikiş onarımı: vuruşlar arası yakınsama karesi
     düşmezse (hızlı seri çizim) önceki vuruşun canlı önizleme bitleri
     tvLive'da donar; yeni vuruşun çip karesi yalnız bölge boyar ve
     bölge DIŞI bayat bitler ekranda kalır — karo sınırlarında farklı
     durumlar çakışınca çizgi "kırılıyor" (zoom, anahtar değişimiyle
     defteri sıfırlayıp düzeltiyordu). Çözüm: vuruşun İLK karo
     karesinde bekleyen tüm canlı/kirli karolar KALICI kaynaklardan
     tam kutu yakılır — commit yakınsamasının ürettiği içerikle
     birebir; defter temizlenir, çip bölgeleri tutarlı tabana biner.
     Maliyet: yalnız seri çizimde iş yapar (normalde bekleyen yok),
     vuruş başında tek seferlik — bırakış karesindeki bütçeli yakma
     ile aynı büyüklükte. Kanıt (tmp-probe-tiles-4i, 10 vuruş seri):
     görülür dikiş kırığı 172-177 px/serit → 0; px8 5185→1142
     (seri ortası), 9212→1403 (seri sonu). */
  if (ui.stroke && !ui.tvChipSeen &&
      ((ui.tvLive && ui.tvLive.size) || (ui.tvBakeLeft && tv.dirty.size))) {
    const rF = tv.viewRange();
    ui.tvFrame = { base, layers, fit, existed: new Set(), bakePerm: true };
    ui.tvRegion = null;
    try {
      for (const k of Array.from(ui.tvLive || [])) {
        const t = tv.tiles.get(k);
        if (!t) { ui.tvLive.delete(k); continue; }
        if (t.tx < rF.tx0 || t.tx > rF.tx1 ||
            t.ty < rF.ty0 || t.ty > rF.ty1) continue;   // görünmez: yakınsamaya bırak
        if (tv.painter(t)) { ui.tvLive.delete(k); tv.dirty.delete(k); }
      }
      for (const k of Array.from(tv.dirty)) {
        const t = tv.tiles.get(k);
        if (!t) { tv.dirty.delete(k); continue; }
        if (t.tx < rF.tx0 || t.tx > rF.tx1 ||
            t.ty < rF.ty0 || t.ty > rF.ty1) continue;
        if (tv.painter(t)) tv.dirty.delete(k);
      }
      ui.tvBakeLeft = tv.dirty.size > 0;
    } finally {
      ui.tvFrame = null;
      ui.tvRegion = null;
    }
  }
  const existed = new Set(tv.tiles.keys());   // işaretlemeden ÖNCEki karolar
  /* Tur 4i · bake-kirli ayrımı: markDirty ÖNCESİ kirli set, commit
     yakınsaması (bake-left) karolarıdır. Bunlar çip bölgesine
     sıkıştırılıp TEMİZLENEMEZ: painter bölge∩karo'yu boyar, karonun
     bölge DIŞI bayat canlı-önizleme bitleri ekranda kalırdı — ardışık
     hızlı vuruşlarda "karo kırılmaları" (zoom düzeltiyordu: anahtar
     değişimi defteri sıfırlayıp tam boyama yapıyordu). Painter bu
     karoları TAM KUTU ile boyar; vuruş sırasında canlı kaynak zaten
     doğru içeriktedir ve karo tvLive'a yazılıp vuruş sonunda
     yeniden bake edilir. */
  const bakeDirty = new Set(tv.dirty);
  tv.markDirtyRect(dx0 / dpr, dy0 / dpr, dw0 / dpr, dh0 / dpr);
  if (!tv.dirty.size) return false;
  ui.tvFrame = { base, layers, fit, existed, bakeDirty };
  /* Kirli bölge (device px): painter bunu okur — yaşayan karoların
     TAMAMINI değil, yalnız bölge kesişimini boyar. Atanmazsa her
     karo tam kutusunu yeniden komposit ederdi; hızlı vuruşta vuruşa
     değen karo sayısı × tam kutu = aşırı kasma (kullanıcı raporu 09.11). */
  ui.tvRegion = [Math.round(dx0), Math.round(dy0), Math.round(dw0), Math.round(dh0)];
  let drawn = 0;
  try {
    drawn = tv.drain();
  } finally {
    ui.tvRegion = null;
    ui.tvFrame = null;
  }
  return drawn > 0;
}

/* Painter: fc bağlamıyla tek karo boyar. true → karo temiz.
   Komposit = tam yolun karo kutusuna inmiş hali (aynı mutlak konum). */
function inkEditorTilePainter(tile) {
  const ui = inkEditorUi;
  const fc = ui.tvFrame;
  if (!fc || !tile || !tile.ctx) return false;
  const dpr = ui.dpr || 1;
  const fit = fc.fit;
  // commit yakınsaması için: canlı önizleme içeren karoların defteri
  // (bakePerm = kalıcı kaynak yakması → defter yazılmaz, içerik temiz)
  if (ui.stroke && !fc.bakePerm) {
    (ui.tvLive || (ui.tvLive = new Set())).add(tile.tx + ',' + tile.ty);
  }
  /* Tur 4i · bake-kirli karo TAM KUTU ile boyanır (bölgeye sıkıştırma
     yok): kirliği bu karenin çipinden değil, önceki vuruşun commit
     yakınsamasından geliyordu. */
  const isBake = !!(fc.bakeDirty && fc.bakeDirty.has(tile.tx + ',' + tile.ty));
  const region = (fc.existed.has(tile.tx + ',' + tile.ty) && !isBake)
    ? ui.tvRegion : null;
  // boyanan cihaz-px kutusu: yaşayan → bölge, yeni doğan → tam karo
  const bx = region ? region[0] : Math.round(tile.cssX * dpr);
  const by = region ? region[1] : Math.round(tile.cssY * dpr);
  const bw = region ? region[2] : tile.dev;
  const bh = region ? region[3] : tile.dev;
  const buf = inkEditorTileEnsureBuf(bw, bh);
  const bctx = buf.getContext('2d', { colorSpace: 'srgb' });
  if (!bctx) return false;
  /* tam yol ile birebir operasyon dizisi (mutlak cihaz-px konumlar) */
  bctx.setTransform(1, 0, 0, 1, -bx, -by);
  bctx.clearRect(bx, by, bw, bh);
  const off = ui.baseOffset || { x: 0, y: 0 };
  bctx.drawImage(fc.base, off.x, off.y);
  bctx.setTransform(dpr, 0, 0, dpr, -bx, -by);
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'medium';   // vuruş karesi: tam yol kuralı
  for (const layer of fc.layers) {
    if (!layer.visible || layer.opacity <= 0.001) continue;
    const previewing = !fc.bakePerm && !!ui.stroke && layer.id === ui.layerId &&
      !!(ui.previewCanvas || ui.scratch);
    const src = previewing
      ? (ui.previewCanvas || ui.scratch)
      : (inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer));
    if (!src) continue;
    bctx.save();
    bctx.globalAlpha = clamp(layer.opacity, 0, 1);
    bctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
    // GPU önizlemesi chip yoluyla uyumsuz (chipOK şartı !previewGl);
    // burada yalnız 2B canlı önizleme görülür.
    const drawSrc = previewing ? src : inkEditorScaledSource(layer, src);
    const box = (previewing && ui.previewRect) ? ui.previewRect : fit;
    bctx.drawImage(drawSrc, box.x, box.y, box.w, box.h);
    bctx.restore();
  }
  // ince çerçeve (tam yolun rot=0 kolonu ile aynı; katmanların üstünde)
  bctx.strokeStyle = 'rgba(255,255,255,.2)';
  bctx.lineWidth = 1;
  bctx.strokeRect(fit.x + 0.5, fit.y + 0.5, Math.max(0, fit.w - 1), Math.max(0, fit.h - 1));
  /* 1:1 karo aktarımı. Yaşayan karo: BÖLGE alanı önce temizlenir —
     yarı saydam base pikselleri (kâğıt gölgesi) eskide birikmesin. */
  const tctx = tile.ctx;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  let sx = 0, sy = 0, dxo = 0, dyo = 0, iw = tile.dev, ih = tile.dev;
  if (region) {
    const tdx = Math.round(tile.cssX * dpr), tdy = Math.round(tile.cssY * dpr);
    const ix0 = Math.max(bx, tdx), iy0 = Math.max(by, tdy);
    const ix1 = Math.min(bx + bw, tdx + tile.dev), iy1 = Math.min(by + bh, tdy + tile.dev);
    if (ix1 <= ix0 || iy1 <= iy0) return true;     // bölge değmedi (kirli çalık)
    iw = ix1 - ix0; ih = iy1 - iy0;
    sx = ix0 - bx; sy = iy0 - by;                  // tampon kaynak
    dxo = ix0 - tdx; dyo = iy0 - tdy;              // karo hedef
    tctx.clearRect(dxo, dyo, iw, ih);              // yarı saydam biniş yok
  } else {
    tctx.clearRect(0, 0, tile.dev, tile.dev);      // doğan karo: tümden temiz
  }
  tctx.drawImage(buf, sx, sy, iw, ih, dxo, dyo, iw, ih);
  return true;
}

/* ---- karo altı temizlik (yüzey paritesi düzeltmesi) ------------
   Ölçüm (tests/screen-parity-check.js): karo DOM katmanı ana tuvalin
   ÜSTÜNDE normal (source-over) bileşir; karo bitleri base+katman
   kompozitini SAYDAM taşımaya devam eder — kâğıt gölge kuyruğu ve
   damalı zemin gibi yarı saydam bölgelerde altındaki ana tuvalin
   AYNI içeriği sızar (ölçülen: gölge alfa 19 vs doğru 10 = çift
   biniş; kullanıcıda "parça parça kırılıyor, zoom düzeltiyor").
   Doğru semantik: karo kendi dikdörtgeninde ana tuvali DEĞİŞTİRİR.
   Çözüm: TEMİZ karoların kutuları her kare sonunda ana tuvalden
   temizlenir; KİRLİ (bayat bit taşıyan, bu karede boyanmamış)
   karoların altı korunur — bayat bitin altı boş görünmesin.
   GL önizleme ve probe (gizli ızgara) çağıranı atlar. */
function inkEditorTileClearUnder() {
  const ui = inkEditorUi;
  const tv = ui.tileView;
  if (!ui.tileViewOn || ui.tileProbe || !tv || !tv.tiles.size) return false;
  const ctx = ui.ctx;
  if (!ctx) return false;
  const dpr = tv.dpr || ui.dpr || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let cleared = 0;
  for (const [k, t] of tv.tiles) {
    if (!t.canvas || tv.dirty.has(k)) continue;
    ctx.clearRect(Math.round(t.cssX * dpr), Math.round(t.cssY * dpr), t.dev, t.dev);
    cleared++;
  }
  return cleared > 0;
}

/* Tam render yoluna düşünce karolar bayat olur → defter boşaltılır.
   İçerik ana tuvalde yeni basılır; karolar sonraki vuruş karesinde
   lazım olan yerde yeniden doğar (sparse). */
function inkEditorTileReset() {
  const ui = inkEditorUi;
  if (ui.tileView) ui.tileView.disposeAll();
  ui.tvRegion = null;
  ui.tvBakeLeft = false;
}

/* Görünürlük: host yalnız ızgara devrede + rot=0 iken görünür.
   rot ≠ 0'da tam yol döner içerik basar; dik karo içerikleri eski
   görünümdür → host saklanır (karolar yeniden doğmaz, geri gelince
   aynı içeriği taşıdıklarından değerli kalır). */
function inkEditorTileSync(rotRad) {
  const ui = inkEditorUi;
  if (!ui.tileView || !ui.tileView.container) return;
  const hide = ui.tileProbe || !ui.tileViewOn || !!rotRad;
  const cur = ui.tileView.container.style.visibility || '';
  const want = hide ? 'hidden' : '';
  if (cur !== want) ui.tileView.container.style.visibility = want;
}

/* Tur 2 · madde 5 · kare çip kompoziti (frameChip).
   Commit sonrasında gelen sahne karesi eskiden tüm tuvali temizleyip
   taban + tüm katmanları bütünüyle yeniden basıyordu (~20+ drawImage).
   Oysa bake bölgesi dışında katman etkisi yoktur: ana tuvalin bölge
   dışı içeriği sağlamdır. Bu yardımcı yalnızca bake bölgesinin ekran
   karşılığını yeniden komposit eder; kutu içi tam kareyle byte-parite.
   Çağıran taraf karo defterinin korunduğunu garanti eder: karo ızgarası
   açıkken karolar commit yakınsamasıyla zaten tazelenmiştir, bölge
   boyası ana tuvale basılır ve karo örtüsü pariteyi dışarıda korur.
   Çerçeve çizimi ve imleç render'ın kendi bloğunda kalır.
   @returns {boolean} bölgeli boya tamamlanabildi. */
function inkEditorFrameChipPaint(ctx, base, layers, fit, chip) {
  const ui = inkEditorUi;
  const dpr = ui.dpr || 1;
  // katman px → CSS px ölçeği (rot=0; y ekseni aynı oranı taşır)
  const scale = fit.w / chip.spaceW;
  let cw0 = fit.x + chip.x * scale - 2;
  let ch0 = fit.y + chip.y * scale - 2;
  let cw1 = fit.x + (chip.x + chip.w) * scale + 2;
  let ch1 = fit.y + (chip.y + chip.h) * scale + 2;
  const cnW = ui.canvas.width / dpr, cnH = ui.canvas.height / dpr;
  cw0 = Math.max(0, Math.floor(cw0));
  ch0 = Math.max(0, Math.floor(ch0));
  cw1 = Math.min(cnW, Math.ceil(cw1));
  ch1 = Math.min(cnH, Math.ceil(ch1));
  const bw = cw1 - cw0, bh = ch1 - ch0;
  if (bw <= 0 || bh <= 0) return false;
  const dx0 = Math.floor(cw0 * dpr), dy0 = Math.floor(ch0 * dpr);
  const dw0 = Math.min(ui.canvas.width, Math.ceil(cw1 * dpr)) - dx0;
  const dh0 = Math.min(ui.canvas.height, Math.ceil(ch1 * dpr)) - dy0;
  if (dw0 <= 0 || dh0 <= 0) return false;
  const off = ui.baseOffset || { x: 0, y: 0 };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx0, dy0, dw0, dh0);
  ctx.clip();
  // base dilimi: cihaz px, 1:1 (tam karedeki drawImage(base, off) dilimi)
  ctx.drawImage(base, dx0 - off.x, dy0 - off.y, dw0, dh0, dx0, dy0, dw0, dh0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // katman dilimleri: alttan üste — tam kare ile aynı sıra/alfa/karışım
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0.001) continue;
    const src = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    if (!src) continue;
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
    const drawSrc = inkEditorScaledSource(layer, src);
    /* Tur 4m · kırılma düzeltmesi: kaynak dilimi, hedef penceresiyle
       AYNI doğrusal haritamadan türetilmeli. Eskiden kaynak yalnız çip
       oranından alınıyordu; hedef ±2 CSS px genişletilip kanvas
       sınırlarına kırpılınca (çip kanvas dışına taşıdığında — kenara/
       köşeye doğru vuruşların yazı düzeni) ekran-dışı kaynak içerik
       görünür hedefe SIKIŞIYORDU: vuruş kuyruğu ekrana geri katlanıp
       "kırık/karınlı" hayalet mürekkep bırakıyordu (zoom tam boyamayla
       düzeltiyor, sonraki kenar vuruşu yeniden üretiyordu). Şimdi
       hedef penceresinin [cw0,cw1)x[ch0,ch1) karşılığı kaynakta
       (drawSrc px) birebir penceleniyor: pad + kırpım tek haritada. */
    const rw = drawSrc.width / chip.spaceW;
    const rh = drawSrc.height / chip.spaceH;
    const kx = rw / scale;              // drawSrc px / CSS px
    const ky = rh / scale;
    const sx = chip.x * rw + (cw0 - (fit.x + chip.x * scale)) * kx;
    const sy = chip.y * rh + (ch0 - (fit.y + chip.y * scale)) * ky;
    ctx.drawImage(drawSrc,
      sx, sy, bw * kx, bh * ky,
      cw0, ch0, bw, bh);
    ctx.restore();
  }
  // Çerçeve dilimi: bölge klip içinde — tam yoldaki çerçeve bloğuna
  // hiç dokunmadan, yalnız bu bölgeye bastığımız piksellerin üstüne
  // taze çerçeve (alfa birikimi yok; tam yol bayrağıyla koşullanır).
  ctx.strokeStyle = 'rgba(255,255,255,.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(fit.x + 0.5, fit.y + 0.5, Math.max(0, fit.w - 1), Math.max(0, fit.h - 1));
  ctx.restore();
  return true;
}

/* FX dalı: item'ın birleşik girdi rasterını efekt zincirinden geçirip
   nihai kanvası döndürür (ekran/export ile aynı fonksiyonlar). Zincir
   aşama önbelleği sayesinde değişmeyen karede tek drawImage maliyeti. */
function inkFxEditorRaster(it) {
  if (!it || typeof inkFxInputRaster !== 'function'
    || typeof inkFxApplyChain !== 'function') return null;
  const input = inkFxInputRaster(it);
  if (!input || !input.w || !input.h) return null;
  /* Sürükleme önizlemesi de TAM çözünürlüklü zinciri kullanır: 0.35 ölçekli
     raster piksel tabanlı parametreleri (blok/bleed/grain) ve deterministik
     gürültü dizisini değiştirdiği için bırakınca sonuç bambaşka görünüyordu.
     Yalnız kare sıklığı sınırlanır; atlanan karede son hesaplanan raster
     basılır (bayat ama tam çözünürlüklü ve doğru). */
  if (typeof inkFxPreviewShouldSkip === 'function' && inkFxPreviewShouldSkip(it)) {
    const last = inkFxRuntime && inkFxRuntime.lastRaster
      ? inkFxRuntime.lastRaster.get(it.id) : null;
    if (last) return last;
  }
  return inkFxApplyChain(it.id, input.canvas, input.w, input.h, it) || null;
}

function inkEditorRender() {
  const ui = inkEditorUi;
  if (!ui.open || !ui.ctx) return;
  ui.needsRender = false;

  if (ui.previewDirty) inkEditorRebuildPreview();

  const ctx = ui.ctx;
  const fit = inkEditorComputeFit();
  ui.fit = fit;

  /* FX (Efektler) · Faz 6: çizim tuvali de NİHAİ (efektli) rasterı gösterir.
     Efekt zinciri karolara/çiplere işlenmediği için efekt etkinken karo
     katmanı askıya alınır; efekt kalkınca ayar yeniden okunur. Vuruş
     sürerken canlı kalem görünsün diye normal katman yolu kullanılır,
     bırakınca efekt sonucu basılır. */
  const fxItem = typeof getItem === 'function' ? getItem(ui.itemId) : null;
  const fxActive = !!(fxItem && typeof inkFxItemHasActiveFx === 'function'
    && inkFxItemHasActiveFx(fxItem));
  if (fxActive) {
    if (ui.tileViewOn) {
      ui.tileFxSuspended = true;
      ui.tileViewOn = false;
      try { if (ui.tileView && ui.tileView.tiles.size) inkEditorTileReset(); } catch { /* sessiz */ }
      ui.tvLive = null;
      ui.tvBakeLeft = false;
    }
  } else if (ui.tileFxSuspended) {
    ui.tileFxSuspended = false;
    try { ui.tileViewOn = inkTilesEnabled(); } catch { ui.tileViewOn = false; }
  }
  /* A11 v2: içerik rotasyonu — bitmap orto kalır; render suçu burada:
     taban + katman çizimi pivot=canvas merkezi etrafında döner (CSS
     transform yalnız sürükleme hız yolu). rot ≠ 0 iken DOM çerçevesi
     (kenar+gölge) dik çalışıp dönmüş kağıttla çakışır — gizlidir. */
  const rotRad = (Number(ui.view.rot) || 0) * Math.PI / 180;
  if (!rotRad && typeof inkSyncCanvasFrame === 'function') inkSyncCanvasFrame();
  inkEditorTileSync(rotRad);

  const el = elMap.get(ui.itemId);
  const img = el ? el.querySelector('.media img') : null;
  if (!img || !img.complete || !img.naturalWidth) {
    // Görsel henüz yüklenmediyse tam ekran temizle ve yükleme bitince
    // tek kare çiz. Arka plan CSS'ten geldiği için tuval saydam kalır.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    ui.sceneChip = null;
    ui.frameChip = null;
    if (img && !img.complete) {
      img.addEventListener('load', inkEditorInvalidate, { once: true });
    }
    inkEditorDrawCursor();
    inkEditorSyncCoords(fit);
    return;
  }

  // Taban katmanı önbellekten tek drawImage ile basılır. Tabanın görsel
  // dışındaki alanı saydam olduğundan önce ana tuvali temizle.
  const base = inkEditorDrawBase(fit, img);

  /* M7 · sahne kirli-kutu kompoziti (kiremit aşaması 1).
     Vuruş sırasında sahnede yalnızca önizleme katmanının DEĞİŞEN kutusu
     değişir; taban/alt-üst statik katmanlar aynıdır. Eski yol tüm tuvali
     temizleyip tüm yüzeyi yeniden rasterize ediyordu. Yeni yol: chip
     (değişen katman kutusu, M2b pencere kurallarıyla üretilir) ekran
     karşılığını kesip bölge içi kompoziti yeniden yapar — kutu içi
     sonuç tam kare ile aynıdır. Yalnız 2D artımlı dual yol chip üretir:
     sym/şekil/smudge/yol-fırçası/GPU yolları chip=nullıc → eski tam yol.
     Tüketim: chip tek karede basılır sonra null; aynı içeriği yeniden
     basmak idempotent olduğundan taşan pencere israf değildir. */
  const sceneFitKey = Math.round(fit.x) + '|' + Math.round(fit.y) + '|' +
    Math.round(fit.w * 100) + '|' + Math.round(fit.h * 100) + '|' +
    (ui.baseOffset ? Math.round(ui.baseOffset.x) + '|' + Math.round(ui.baseOffset.y) : '0|0') +
    '|' + ui.canvas.width + 'x' + ui.canvas.height;
  const layers = inkLayersForOwner(ui.itemId);
  const layersKey = layers.map(l => l.id + '|' + (l.visible ? 1 : 0) + '|' +
    Math.round((Number(l.opacity) || 0) * 100) + '|' + (l.blend || 'normal')).join(';');
  // önizleme uzayı = katman tuvali (tüm kalemler aynı boyutta)
  const spaceW = ui.layerCanvas ? ui.layerCanvas.width : 0;
  const spaceH = ui.layerCanvas ? ui.layerCanvas.height : 0;
  const chipOK = !!ui.stroke && !!ui.sceneChip && !ui.previewGl && !rotRad &&
    spaceW > 0 && spaceH > 0 && base && layers.length > 0 &&
    !fxActive &&
    ui.sceneFitKey === sceneFitKey && ui.sceneLayersKey === layersKey;

  let drewChip = false;
  let fullPainted = false;   // yalnız tam-yol karesi çerçeveyi yeniden basar
  const prevFitKey = ui.sceneFitKey;        // tam-yol bayat Kontrolü için önceki anahtarlar
  const prevLayersKey = ui.sceneLayersKey;
  if (chipOK) {
    const dpr = ui.dpr || 1;
    const off = ui.baseOffset || { x: 0, y: 0 };
    // katman px → CSS px ölçeği (rot=0; y ekseni aynı oranı taşır)
    const scale = fit.w / spaceW;
    let cw0 = fit.x + ui.sceneChip.x * scale - 2;
    let ch0 = fit.y + ui.sceneChip.y * scale - 2;
    let cw1 = fit.x + (ui.sceneChip.x + ui.sceneChip.w) * scale + 2;
    let ch1 = fit.y + (ui.sceneChip.y + ui.sceneChip.h) * scale + 2;
    const cnW = ui.canvas.width / dpr, cnH = ui.canvas.height / dpr;
    cw0 = Math.max(0, Math.floor(cw0));
    ch0 = Math.max(0, Math.floor(ch0));
    cw1 = Math.min(cnW, Math.ceil(cw1));
    ch1 = Math.min(cnH, Math.ceil(ch1));
    const bw = cw1 - cw0, bh = ch1 - ch0;
    if (bw > 0 && bh > 0) {
      const dx0 = Math.floor(cw0 * dpr), dy0 = Math.floor(ch0 * dpr);
      const dw0 = Math.min(ui.canvas.width, Math.ceil(cw1 * dpr)) - dx0;
      const dh0 = Math.min(ui.canvas.height, Math.ceil(ch1 * dpr)) - dy0;
      // Kiremit aşama 2: karo ızgarası açıkken bölge karolara 1:1
      // akıtılır; ana tuval DOKUNMAZ (bölge dışı içerik zaten güncel).
      const viaTiles = ui.tileViewOn && dw0 > 0 && dh0 > 0 &&
        inkEditorTileFrame(base, layers, fit, dx0, dy0, dw0, dh0);
      if (viaTiles) {
        drewChip = true;
        ui.tvCommitArmed = true;      // commit akışı bu karelerde beslendi
        // Kiremit: bu vuruş en az bir chip karesi taşır — benign
        // tam-yol karelerinin defteri koruması bununla koşullanır.
        ui.tvChipSeen = true;
      } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx0, dy0, dw0, dh0);
      ctx.clip();
      // base dilimi: cihaz px, 1:1 (tam karedeki drawImage(base, off) dilimi)
      ctx.drawImage(base, dx0 - off.x, dy0 - off.y, dw0, dh0, dx0, dy0, dw0, dh0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      // katman dilimleri: alttan üste — tam kare ile aynı sıra/alfa/karışım
      for (const layer of layers) {
        if (!layer.visible || layer.opacity <= 0.001) continue;
        const previewing = !!ui.stroke && layer.id === ui.layerId &&
          !!(ui.previewCanvas || ui.scratch);
        const src = previewing
          ? (ui.previewCanvas || ui.scratch)
          : (inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer));
        if (!src) continue;
        ctx.save();
        ctx.globalAlpha = clamp(layer.opacity, 0, 1);
        ctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
        const drawSrc = previewing ? src : inkEditorScaledSource(layer, src);
        /* Tur 4m · kırılma düzeltmesi: frameChip ile aynı kusur — hedef
           penceresi ±2 genişletilip kanvasa kırpılınca kaynak dilim
           (çip oranı) aynı pencereye oturmuyordu; çip kanvas dışına
           taşınca ekran-dışı içerik hedefe sıkışıyordu. Kaynak
           penceresini hedef haritasından türet. */
        const rw = drawSrc.width / spaceW;
        const rh = drawSrc.height / spaceH;
        const kx = rw / scale;              // drawSrc px / CSS px
        const ky = rh / scale;
        const sx = ui.sceneChip.x * rw +
          (cw0 - (fit.x + ui.sceneChip.x * scale)) * kx;
        const sy = ui.sceneChip.y * rh +
          (ch0 - (fit.y + ui.sceneChip.y * scale)) * ky;
        ctx.drawImage(drawSrc,
          sx, sy, bw * kx, bh * ky,
          cw0, ch0, bw, bh);
        ctx.restore();
      }
      ctx.restore();
      // Çerçeve dilimi: bölge klip dahilinde — tam yolda ana çerçeve
      // bloğu alfa biriktirmeden basar; bölümde burada basılır (kural:
      // her yol kendi dokunduğu pikseller için çerçeveyi sıfırdan basar).
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(fit.x + 0.5, fit.y + 0.5,
        Math.max(0, fit.w - 1), Math.max(0, fit.h - 1));
      ctx.restore();
      drewChip = true;
      }
    }
    ui.sceneChip = null;
  }
  ui.sceneFitKey = sceneFitKey;
  ui.sceneLayersKey = layersKey;

  const tileKeysChanged = prevFitKey !== sceneFitKey ||
    prevLayersKey !== layersKey;
  if (!drewChip) {
    // Tam yol çizgileri. Karoların durumu:
    //  • vuruş sürerken tam yola düşmek (GPU/sym/şekil yolu) → içerik
    //    bu karede değişti ama chip penceresi yoktu → defteri boşalt.
    //  • anahtar değişti (fit/pan/katman yapısı) → defter boşalt.
    //  • vuruş bitmiş + canlı karo defteri DOLU → commit yakınsaması:
    //    karolar kalıcı kaynaklardan yeniden komposit (tahta byte-parite
    //    geri gelir).
    //  • vuruş bitmiş, defter boş, commit silahı
    //    (ui.tvCommitArmed) taze → commit akışı eyler, defteri
    //    sakla; öteki durumlarda (undo/redo/diğer mutasyon) reset.
    // Tur 2 madde 5: bu karede karo defteri sıfırlandıysa tvZapped işaret
    // alınır — kare çipi bölgesel boya ancak defter korunursa güvenlidir.
    let tvZapped = false;
    if (ui.tileViewOn) {
      ui.tvCommitArmed = false;
      if (ui.stroke || tileKeysChanged) {
        // Kiremet dilim 3: vuruş sürerken tam yola düşen kare benign
        // OLABİLİR — chip önceki karede tüketildi, yeni dab yok
        // (previewDirty=true olmadan gelen üst kare). İçerik öteki
        // kareyle aynıdır; defter HÂLÂ güncel → koru. Silme yalnız
        // yapısal tam yolda: chip karesi hiç görülmedi (GPU/scratch
        // vuruşlar), sym açık, rot ≠ 0 ya da anahtar değişimi.
        const benignFull = !!ui.stroke && !tileKeysChanged &&
          !!ui.tvChipSeen && !ui.previewGl && !rotRad &&
          !(ui.stroke.sym && ui.stroke.sym !== 'off') &&
          /* Tur 3: şekil oturtma anında vuruş 'shape'e döner ve
             previewCanvas bütünüyle yeniden yazılır — içerik tam yol
             karesinde değişmiştir, "benign" DEĞİLDİR. Bayat karo
             bitlerini ekranda tutmak yerine defteri boşalt: karolar
             yeni (şekilli) içeriğinden yeniden boyanır. Böylece
             oturtma, kalemi bırakmadan CANLI görünür. */
          ui.stroke.kind !== 'shape';
        if (!benignFull) {
          if (ui.tileView) inkEditorTileReset();
          ui.tvLive = null;
          ui.tvBakeLeft = false;
          tvZapped = true;
        }
      } else if (ui.tileView &&
          ((ui.tvLive && ui.tvLive.size) ||
           (ui.tvBakeLeft && ui.tileView.dirty.size))) {
        /* commit yakınsaması: vuruş boyunca canlı önizleme kaynağıyla
           boyanan karolar, bırakma sonrası KALICI katman kaynaklarından
           (scaledSource dahil) yeniden komposit edilir — tahta ile
           byte-parite geri gelir.
           BÜTÇELİ drenaj: eskiden burada tüm kirli karolar TEK karede
           tam kutuyla boyanıyordu — bırakış anında kare süresi
           kabarıyor, imleç donuk kalıyordu (kullanıcı raporu 09.11).
           Kare başına ~8 karo; kalan karo bırakışın sonraki
           karelerinde (tvBakeLeft) tamamlanır. */
        if (ui.tvLive && ui.tvLive.size) {
          for (const k of ui.tvLive) ui.tileView.dirty.add(k);
          ui.tvLive = null;
          ui.tvBakeLeft = true;
        }
        // NOT: bu blokta `layers` TDZ'li (blok-içi const) —
        // kendi çağrımızla alıp öyle veriyoruz.
        const fLayers = inkLayersForOwner(ui.itemId);
        ui.tvFrame = { base, layers: fLayers, fit, existed: new Set() };
        ui.tvRegion = null;   // tam kutu boyası (byte-parite)
        const rBake = ui.tileView.viewRange();
        const BAKE_BUDGET = 8;
        let painted = 0;
        for (const k of Array.from(ui.tileView.dirty)) {
          if (painted >= BAKE_BUDGET) break;
          const t = ui.tileView.tiles.get(k);
          if (!t) { ui.tileView.dirty.delete(k); continue; } // ölü karo
          if (t.tx < rBake.tx0 || t.tx > rBake.tx1 ||
              t.ty < rBake.ty0 || t.ty > rBake.ty1) continue; // dışarıda
          if (ui.tileView.painter(t)) {
            ui.tileView.dirty.delete(k);
            painted++;
          }
        }
        ui.tvFrame = null;
        if (!painted && ui.tileView.dirty.size) {
          // Bu karede hiç ilerleme yok: görünmez karoları buda; hâlâ
          // kirli kaldıysa bütçelemeyi bırak (sonsuz invalidate
          // döngüsünün önüne geç).
          ui.tileView.pruneOffscreen();
        }
        if (!ui.tileView.dirty.size) {
          ui.tvBakeLeft = false;
          // Tam yakınsama: otomatik profil bu vuruşun ölçümlerini tek
          // karara indirir. Uygulama BURADA yapılmaz — yakınsanmış
          // defteri bozar. Karar sonraki vuruşun başında uygulanır.
          if (inkTileSizeSetting() === 'auto') {
            const dec = inkTileProfileDecide();
            if (dec) {
              try { localStorage.setItem(INK_TILE_AUTO_KEY, String(dec)); } catch { /* sessiz */ }
            }
          }
        } else {
          // Kalan karolar sonraki karede: yeni kare iste.
          inkEditorInvalidate();
        }
      } else {
        if (ui.tileView && ui.tileView.tiles.size) inkEditorTileReset();
        ui.tvLive = null;
        ui.tvBakeLeft = false;
        tvZapped = true;
      }
    }
    // Tur 2 · madde 5 · kare çipi işlemesi: commit sonrası ilk kare,
    // bake bölgesi dışı ana tuval sağlamsa bölgesel kurulur. Güven
    // koşulları: vuruş yok, rot=0, GL yok, fit/katman anahtarları son
    // kareyle aynı, karo defteri bu karede sıfırlanmamış (tvZapped=0).
    const frameChipOK = !ui.stroke && !!ui.frameChip && !ui.previewGl &&
      !rotRad && !!base && layers.length > 0 && !fxActive &&
      prevFitKey === sceneFitKey && prevLayersKey === layersKey;
    if (frameChipOK && !tvZapped &&
        inkEditorFrameChipPaint(ctx, base, layers, fit, ui.frameChip)) {
      ui.frameChip = null;
    } else {
      if (ui.tvBakeLeft) {
        /* Bütçeli yakınsama sürüyor: ana tuval içeriği zaten doğru
           (vk çip bölgesi kalıcı kaynaklardan basıldı; öbür pikseller
           sabit). Tam-yol boyaması her devam karesinde tekrar çalışıp
           bırakış kasmını çoğaltırdı — yalnız karo bake'lerini bitir. */
        ui.frameChip = null;
      } else {
      ui.frameChip = null;
      fullPainted = true;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  ui.sceneChip = null;
  if (rotRad) {
    /* A11 v3: pivot = fit merkez (device px) — kâğıt yerinde döner. */
    const px2 = (fit.x + fit.w / 2) * ui.dpr;
    const py2 = (fit.y + fit.h / 2) * ui.dpr;
    ctx.translate(px2, py2);
    ctx.rotate(rotRad);
    ctx.translate(-px2, -py2);
  }
  if (base) {
    const off = ui.baseOffset || { x: 0, y: 0 };
    ctx.drawImage(base, off.x, off.y);
  }
  ctx.setTransform(ui.dpr, 0, 0, ui.dpr, 0, 0);
  if (rotRad) {
    const cwx = fit.x + fit.w / 2;
    const chy = fit.y + fit.h / 2;
    ctx.translate(cwx, chy);
    ctx.rotate(rotRad);
    ctx.translate(-cwx, -chy);
  }
  ctx.imageSmoothingEnabled = true;
  // M4 · vuruş sırasında resample kalitesi 'medium': büyük ölçekli
  // temel/önizleme drawImage'larında GPU resample maliyeti düşer.
  // Yalnızca CANLI karede etkilidir; commit baskısı ($bake) aynen
  // kalır — bırakılan raster ile piksel eşliği korunur.
  ctx.imageSmoothingQuality = ui.stroke ? 'medium' : 'high';

  // Görsele bağlı katmanlar: alttan üste, opaklık + karışım modu ile.
  // FX etkinken (vuruş yokken) tek nihai efekt rasterı basılır; vuruş
  // sürerken canlı kalem için normal katman yolu korunur.
  const layers = inkLayersForOwner(ui.itemId);
  const fxFinal = (fxActive && !ui.stroke) ? inkFxEditorRaster(fxItem) : null;
  if (fxFinal) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(fxFinal, fit.x, fit.y, fit.w, fit.h);
    /* Canlı vuruş: henüz commit edilmediği için efekt zincirinde yok.
       Efektli rasterın ÜSTÜNE ham önizleme basılır — kalem kalkınca vuruş
       FX girdisine girer ve aynı görünüm korunur (kaybolma yanılsaması
       olmaz). */
    if (ui.stroke) {
      if (ui.previewGl && typeof inkDabGlPresent === 'function') inkDabGlPresent();
      const liveSrc = ui.previewCanvas || ui.scratch;
      if (liveSrc) {
        const liveBox = ui.previewRect || fit;
        ctx.drawImage(liveSrc, liveBox.x, liveBox.y, liveBox.w, liveBox.h);
      }
    }
    ctx.restore();
  } else
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0.001) continue;
    const previewing = !!ui.stroke && layer.id === ui.layerId && !!(ui.previewCanvas || ui.scratch);
    let src;
    if (previewing) {
      src = ui.previewCanvas || ui.scratch;
    } else {
      src = inkRuntime.itemCanvases.get(layer.id) || inkEnsureItemCanvas(layer);
    }
    if (!src) continue;
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
    // GPU önizlemesi bir FBO'da birikiyor; drawImage'dan hemen önce
    // (aynı görevde) varsayılan tampona basılır.
    if (previewing && ui.previewGl && typeof inkDabGlPresent === 'function') {
      inkDabGlPresent();
    }
    // Küçük zoom'da mipmap benzeri kademeli küçültme kullan.
    const drawSrc = previewing ? src : inkEditorScaledSource(layer, src);
    // GPU önizlemesi yalnızca görünür parçayı taşır; o kutuya basılır.
    const box = (previewing && ui.previewRect) ? ui.previewRect : fit;
    ctx.drawImage(drawSrc, box.x, box.y, box.w, box.h);
    ctx.restore();
  }
      } // iç else sonu: tam-yol boyaması
    }
  }

  // İnce çerçeve: görsel sınırı (rot = 0 iken; rot ≠ 0'da kağıt kenarı
  // kendi çizimiyle döner, DOM çerçevesi zaten gizli). Yalnız tam-yol
  // boyamasında: bölgesel yollar (chip/frameChip) kendi bölge dilimine
  // çerçeveyi kendileri basar — burada tekrar basılsa alfa birikir ve
  // tuval çevresi her vuruşta daha beyaz parlıyordu (kullanıcı raporu).
  if (!rotRad && fullPainted) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(fit.x + 0.5, fit.y + 0.5, Math.max(0, fit.w - 1), Math.max(0, fit.h - 1));
    ctx.restore();
  }

  inkEditorDrawCursor();
  if (ui.previewDirty) ui.needsRender = true;
  // M4 · koordinat okunması (X/Y): vuruş sırasında DOM yazımı 60 Hz'de
  // karakola bindiğü için ~10 Hz'ye kısınlama. Vuruş dışında her render
  // analy (imleç gezme zaten ayrı akış); okuma deneyiminde fark yok.
  const coordsNow = performance.now();
  if (!ui.stroke || coordsNow - ui.coordsSyncAt >= 100) {
    ui.coordsSyncAt = coordsNow;
    inkEditorSyncCoords(fit);
  }
  // Referans panelindeki tahta minyatürü VURUŞ SIRASINDA ucuz değil:
  // her güncelleme ≤1024px clearRect+drawImage kopyası. Anlık canlılık
  // lüks değildir; bu yüzden vuruş boyunca 5 s'de bir tazelenir.
  // Vuruş bitince pointerup kalıcı katmanı pişirip overlay'i kaldırır:
  // mini son hali commit'ten alır (görsel doğruluk korunur).
  const syncNow = performance.now();
  if (!ui.stroke || syncNow - ui.overlaySyncAt >= 5000) {
    ui.overlaySyncAt = syncNow;
    inkEditorLiveOverlaySync();
  }
  /* Yüzey paritesi: temiz karoların altındaki ana tuval içeriği
     temizlenir (karo, dikdörtgeninde tuvali değiştirir). rot ≠ 0'da
     karo gridi gizli — dokunulmaz. */
  if (!rotRad && ui.tileViewOn) inkEditorTileClearUnder();
}

function inkEditorClearCursorArea() {
  const ui = inkEditorUi;
  if (!ui.cctx) return;
  const c = ui.cursorCanvas;
  const ctx = ui.cctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rect = ui.cursorRect;
  if (rect) {
    ctx.clearRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
  } else {
    ctx.clearRect(0, 0, c.width, c.height);
  }
  ui.cursorRect = null;
}

function inkEditorUnionRects(rects) {
  if (!rects || !rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function inkEditorTipOutline(brush, hardness) {
  const source = typeof inkBrushSourceCanvas === 'function'
    ? inkBrushSourceCanvas(brush, hardness, 128) : null;
  const cacheKey = `${brush && brush.id || 'default'}|${Math.round(hardness * 100)}`;
  const cached = inkEditorTipOutlineCache.get(cacheKey);
  if (cached && cached.source === source) {
    inkEditorTipOutlineCache.delete(cacheKey);
    inkEditorTipOutlineCache.set(cacheKey, cached);
    return cached.points;
  }

  const points = [];
  if (source && source.width && source.height) {
    const ctx = source.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
    const cx = source.width / 2;
    const cy = source.height / 2;
    const rays = 72;
    for (let i = 0; i < rays; i++) {
      const angle = i / rays * Math.PI * 2;
      let radius = 0;
      for (let step = 1; step <= 64; step++) {
        const distance = step / 64;
        const x = Math.round(cx + Math.cos(angle) * cx * distance);
        const y = Math.round(cy + Math.sin(angle) * cy * distance);
        if (x < 0 || y < 0 || x >= source.width || y >= source.height) break;
        if (pixels[(y * source.width + x) * 4 + 3] > 24) radius = distance;
      }
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * source.height / source.width,
      });
    }
  }
  if (!points.length || points.every(point => Math.hypot(point.x, point.y) < 0.01)) {
    points.length = 0;
    for (let i = 0; i < 48; i++) {
      const angle = i / 48 * Math.PI * 2;
      points.push({ x: Math.cos(angle), y: Math.sin(angle) });
    }
  }
  inkEditorTipOutlineCache.set(cacheKey, { source, points });
  while (inkEditorTipOutlineCache.size > 32) {
    inkEditorTipOutlineCache.delete(inkEditorTipOutlineCache.keys().next().value);
  }
  return points;
}

function inkEditorDrawCursor() {
  const ui = inkEditorUi;
  if (!ui.cctx) return;
  const ctx = ui.cctx;
  inkEditorClearCursorArea();
  if (!ui.open) return;

  const dpr = ui.dpr || 1;
  const parts = [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const tool = inkState().tool;
  const selection = Array.isArray(inkState().selection) ? inkState().selection : [];

  // Seçim çerçevesi + dönüştürme tutamaçları.
  const showBox = selection.length > 0 && (
    tool === 'transform' || tool === 'marquee' || tool === 'lasso' ||
    ui.freeTransform || !!ui.gizmoDrag
  );
  if (showBox) {
    const rotDrag = (ui.gizmoDrag && ui.gizmoDrag.mode === 'rot' &&
      ui.gizmoDrag.rotRect) ? ui.gizmoDrag : null;
    // Sürüklemekte olduğu döndürmede canlı AABB yerine başlangıç
    // dikdörtgeni kullanılır; içerik dönerken kutu da aynı merkezden
    // aynı açıyla döner (hizalı görünüm).
    const r = rotDrag ? rotDrag.rotRect : inkEditorGizmoRect();
    if (r) {
      ctx.save();
      if (rotDrag && rotDrag.rotDisplay) {
        ctx.translate(r.cx, r.cy);
        ctx.rotate(rotDrag.rotDisplay);
        ctx.translate(-r.cx, -r.cy);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(110,163,242,.95)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
      ctx.setLineDash([]);
      if (tool === 'transform' || ui.freeTransform || ui.gizmoDrag) {
        const handles = inkEditorGizmoHandles(r);
        ctx.fillStyle = '#0f1216';
        ctx.strokeStyle = 'rgba(160,200,255,.95)';
        for (const h of handles) {
          if (h.id === 'rot') continue;
          ctx.beginPath();
          ctx.rect(h.x - 3.5, h.y - 3.5, 7, 7);
          ctx.fill();
          ctx.stroke();
        }
        const rot = handles.find(h => h.id === 'rot');
        if (rot) {
          ctx.beginPath();
          ctx.moveTo(r.cx, r.y);
          ctx.lineTo(rot.x, rot.y + 5.5);
          ctx.stroke();
          /* dönme topuzunun yarıçapı: daha kolay yakalanır nokta */
          ctx.beginPath();
          ctx.arc(rot.x, rot.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
      /* Kirlenen alan döndürülmüş kutuyu da kapsayacak kadar geniş
         olmalı: merkezden uzaklık için köşegen yarıçapı eklenir. */
      const halfDiag = Math.hypot(r.w, r.h) / 2 + 40;
      const rcx = r.x + r.w / 2;
      const rcy = r.y + r.h / 2;
      parts.push({
        x: (rcx - halfDiag) * dpr, y: (rcy - halfDiag) * dpr,
        w: halfDiag * 2 * dpr, h: halfDiag * 2 * dpr,
      });
    }
  }

  // Dikdörtgen seçim lastiği.
  if (ui.marquee) {
    const m = ui.marquee;
    const fit = ui.fit;
    const x0 = fit.x + Math.min(m.x0, m.x1) * fit.w;
    const y0 = fit.y + Math.min(m.y0, m.y1) * fit.h;
    const w = Math.abs(m.x1 - m.x0) * fit.w;
    const h = Math.abs(m.y1 - m.y0) * fit.h;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110,163,242,.95)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.fillStyle = 'rgba(76,141,255,.10)';
    ctx.fillRect(x0, y0, w, h);
    ctx.restore();
    parts.push({ x: (x0 - 2) * dpr, y: (y0 - 2) * dpr, w: (w + 4) * dpr, h: (h + 4) * dpr });
  }

  // Kement izi.
  if (ui.lasso && ui.lasso.length > 1) {
    const fit = ui.fit;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    ctx.save();
    ctx.beginPath();
    ui.lasso.forEach((p, i) => {
      const x = fit.x + p.x * fit.w;
      const y = fit.y + p.y * fit.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(76,141,255,.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,163,242,.95)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
    parts.push({
      x: (x0 - 2) * dpr, y: (y0 - 2) * dpr,
      w: (x1 - x0 + 4) * dpr, h: (y1 - y0 + 4) * dpr,
    });
  }

  /* FAZ 6 · Damlalık büyüteci (loupe): göz aracı veya Alt basılıyken
     imlecin yanında dairesel zoom. Halka, altındaki rengi gösterir
     (istek: "yuvarlağın dış kısmı geldiğin renge döner"). Okuma tek
     kapı (inkEditorEyePeek); bu görünüm renk uygulamaz — uygulama
     yalnız base/drag'da inkEditorSample ile olur. */
  const eyeLoupeOn = (tool === 'eyedropper' || ui.alt) && ui.lastClient && !ui.stroke;
  if (eyeLoupeOn) {
    const cx0 = ui.lastClient.x;
    const cy0 = ui.lastClient.y;
    const hex = inkEditorEyePeek(cx0, cy0);
    if (hex) {
      const R = 34;          // loupe yarıçapı (CSS px)
      const zoom = 6;        // büyütme çarpanı
      let lx = clamp(cx0 + 14 + R, R + 8, Math.max(R + 8, innerWidth - R - 8));
      let ly = clamp(cy0 - 14 - R, R + 8, Math.max(R + 8, innerHeight - R - 8));
      // sağ üstte yer yoksa (toolbar/instancetaşma) imlecin sağ altına in.
      if (ly - R < 72 && cy0 + 14 + R + 30 < innerHeight - 8) ly = cy0 + 14 + R;
      ctx.save();
      // gövde + gölge
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.fillStyle = '#0c0e12';
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      // içerik: backing-store bölgesini merkeze zoom'la drawImage
      const half = (R - 2) / zoom;
      let sx = (inkEditorGatePoint(cx0, cy0).x - half) * ui.dpr;
      let sy = (inkEditorGatePoint(cx0, cy0).y - half) * ui.dpr;
      const ix0 = Math.max(sx, 0);
      const iy0 = Math.max(sy, 0);
      const ix1 = Math.min(sx + (2 * half) * ui.dpr, ui.canvas.width);
      const iy1 = Math.min(sy + (2 * half) * ui.dpr, ui.canvas.height);
      if (ix1 > ix0 && iy1 > iy0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(lx, ly, R - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(ui.canvas,
          ix0, iy0, ix1 - ix0, iy1 - iy0,
          lx - (R - 2) + ((ix0 - sx) / ui.dpr) * zoom,
          ly - (R - 2) + ((iy0 - sy) / ui.dpr) * zoom,
          ((ix1 - ix0) / ui.dpr) * zoom,
          ((iy1 - iy0) / ui.dpr) * zoom);
        ctx.restore();
      }
      // halka: örneklenen renk (yoksa nötr gri)
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.strokeStyle = hex;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx, ly, R + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx, ly, 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
      // hex etiketi
      const label = hex.toUpperCase();
      ctx.save();
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const pw = tw + 12;
      const ph = 15;
      const px0 = lx - pw / 2;
      const py0 = ly + R + 6;
      ctx.fillStyle = 'rgba(10,12,16,.82)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(px0, py0, pw, ph, 7);
      else ctx.rect(px0, py0, pw, ph);
      ctx.fill();
      const lum = hex.length === 7
        ? ((parseInt(hex.slice(1, 3), 16) * 0.299 +
            parseInt(hex.slice(3, 5), 16) * 0.587 +
            parseInt(hex.slice(5, 7), 16) * 0.114) / 255)
        : 0.5;
      ctx.fillStyle = lum > 0.55 ? '#101319' : '#e8eaf0';
      ctx.fillText(label, px0 + 6, py0 + 10.5);
      ctx.restore();
      parts.push({
        x: (lx - R - 8) * dpr, y: (ly - R - 8) * dpr,
        w: (R * 2 + 16) * dpr, h: (R * 2 + 34) * dpr,
      });
    }
  }

  const eyedrop = ui.alt || tool === 'eyedropper';
  const selectTool = tool === 'transform' || tool === 'marquee' || tool === 'lasso';
  // Dairesel fırça paneli açıkken fırça halkası menünün dışında
  // başıboş bir çember olarak kalmasın; halka hiç çizilmez.
  const radialOpen = typeof inkRadialIsOpen === 'function' && inkRadialIsOpen();
  /* Kaydırma sürerken fırça halkası çizilmez: halka ekran uzayında sabit
     kalıp görüntü altından kayarken "takılı" görünüyordu. */
  /* Fırça imleci tercihi (15 Kasım 2026): halka yalnızca 'ring' modunda
     çizilir; 'cross' artı imleci (canvas cursor 'crosshair'), 'hidden'
     hiçbir çizim yapmaz. Okuma tek kapı: inkEditorBrushCursorMode. */
  const brushCursorMode = inkEditorBrushCursorMode();
  if (brushCursorMode === 'ring' && !eyedrop && !selectTool && !radialOpen && !ui.panning && ui.lastClient) {
    const fit = ui.fit;
    const x = ui.lastClient.x;
    const y = ui.lastClient.y;
    const it = getItem(ui.itemId);
    if (it) {
      const scale = fit.w / Math.max(1, it.w || 1);
      const r = Math.max(2.5, (inkState().size || 1) * scale / 2);
      const ink = inkState();
      const brush = typeof inkGetBrush === 'function' ? inkGetBrush(ink.brushId) : null;
      const points = inkEditorTipOutline(brush, ink.hardness || 0.72);
      const roundness = clamp(Number(brush && brush.roundness) || 1, 0.05, 1);
      const angle = Number.isFinite(brush && brush.angle) ? brush.angle : 0;
      ctx.save();
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      ctx.scale(1, roundness);
      ctx.beginPath();
      points.forEach((point, index) => {
        const px = point.x * r;
        const py = point.y * r;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.78)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.94)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      parts.push({
        x: (x - r - 2) * dpr, y: (y - r - 2) * dpr,
        w: (r * 2 + 4) * dpr, h: (r * 2 + 4) * dpr,
      });
    }
  }

  ui.cursorRect = inkEditorUnionRects(parts);
}

function inkEditorSyncCursorStyle() {
  const ui = inkEditorUi;
  if (!ui.canvas) return;
  if (ui.panning) {
    ui.canvas.style.cursor = 'grabbing';
    return;
  }
  if (ui.rotMode) {
    // A11: R döndürme modu — sürüklerken sıkı kavrayış.
    ui.canvas.style.cursor = ui.rotDrag ? 'grabbing' : 'grab';
    return;
  }
  if (ui.space) {
    ui.canvas.style.cursor = 'grab';
    return;
  }
  const tool = inkState().tool;
  // Seçim/dönüştürme araçlarında fırça halkası çizilmez (22682'deki
  // seçici bunları atlar). İmleci 'none' yaparsak ekranda HİÇ imleç
  // kalmıyor (kullanıcı raporu: "Ctrl+T basınca imleç yok oluyor") —
  // bu araçlarda standart ok imleci göster.
  if (tool === 'transform' || tool === 'marquee' || tool === 'lasso') {
    ui.canvas.style.cursor = 'default';
    return;
  }
  const eyedrop = ui.alt || tool === 'eyedropper';
  if (eyedrop) { ui.canvas.style.cursor = 'crosshair'; return; }
  /* Fırça imleci tercihi (15 Kasım 2026): 'cross' → artı imleci,
     'ring'/'hidden' → 'none' (ring halkayı canvas'a, hidden hiçbir şey
     çizmez; ayrım inkEditorDrawCursor'da). Anahtar yoksa/bozuksa eski
     davranış (ring) korunur — parite kuralı. */
  const brushCursorMode = inkEditorBrushCursorMode();
  ui.canvas.style.cursor = brushCursorMode === 'cross' ? 'crosshair' : 'none';
}

/* Ayar panelindeki "Fırça imleci" seçiminin gerçek okuma kapısı.
   Yalnızca bilinen değerler kabul edilir; aksi halde 'ring'. */
function inkEditorBrushCursorMode() {
  try {
    const v = localStorage.getItem('tailref-brush-cursor');
    if (v === 'cross' || v === 'hidden') return v;
  } catch { /* sessiz */ }
  return 'ring';
}

/* =========================================================
   Alt = geçici damlalık
   ========================================================= */
function inkEditorKeyDown(event) {
  const ui = inkEditorUi;
  if (!ui.open) return;
  // Shift durumu oturtma kapısı için izlenir: Shift + çizgi = AÇIK düz
  // çizgi niyeti; oturtma bekleme zamanlayıcısı devreye girmemeli
  // (yoksa duraksayan çizgide oturt→revert ping-pongu "sapıtma" yapar).
  if (event.key === 'Shift') ui.shiftHeld = true;
  // Fırça oluşturucu açıkken editör kısayolları (Esc, Space, Ctrl+T)
  // arayüzün arkasında çalışmasın.
  const nativeBrushRoot = document.getElementById('nativeBrushLibrary');
  if (nativeBrushRoot && !nativeBrushRoot.hidden) return;

  // FAZ 7 K3: Katman Özellikleri diyaloğu açıkken editör kısayolları
  // (Esc dahil) tuşun diyaloğa inmesini engellemesin.
  const layerPropsDialog = document.getElementById('inkLayerPropsDialog');
  if (layerPropsDialog && !layerPropsDialog.hidden) return;

  // FAZ 7.W: mini gradyan durağı seçicisi açıkken Esc yalnız onu
  // kapatır (radial panel delegasyonuyla aynı kalıp).
  if (event.key === 'Escape' && typeof window.v5GradPickerClose === 'function'
      && window.v5GradPickerClose()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  // Sağ tık fırça paneli açıksa Esc yalnızca paneli kapatır; alttaki
  // seçim/dönüştürme durumu bozulmaz.
  if (event.key === 'Escape' && typeof inkRadialIsOpen === 'function' && inkRadialIsOpen()) {
    event.preventDefault();
    event.stopPropagation();
    inkRadialClose();
    return;
  }

  // Ctrl/Cmd+T: seçili vuruşları (yoksa etkin katmanı) serbest dönüştür.
  // Faz 3a: imza keymap 'editor' grubundan çözülür; keymap yoksa eski
  // Ctrl+T geçerli kalır (parite).
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const edKey = String(event.key || '').toLowerCase();
    if (edKey.length === 1) {
      const edAct = window.tailrefKeymap
        ? window.tailrefKeymap.actionFor('ctrl+' + edKey, 'editor')
        : (edKey === 't' ? 'editor.freeTransform' : '');
      if (edAct === 'editor.freeTransform') {
        /* Vuruş koruması: canlı vuruş ortasında serbest dönüştürme
           girilmez (vuruş bozulur). */
        if (ui.stroke) return;
        event.preventDefault();
        event.stopPropagation();
        inkEditorFreeTransform();
        return;
      }
    }
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    /* Canlı vuruş: Escape vuruşu iptal eder, commit etmez. Bu kontrol
       seçim/dönüştürme dallarından ÖNCE gelir (vuruş sırasında gizmo
       yoktur). */
    if (ui.stroke) {
      inkEditorDropStroke();
      return;
    }
    // Önce devam eden seçim/dönüştürme iptal edilir.
    if (ui.gizmoDrag || ui.marquee || ui.lasso) {
      inkEditorCancelSelection();
      return;
    }
    if ((Array.isArray(inkState().selection) && inkState().selection.length) || ui.freeTransform) {
      inkState().selection = [];
      ui.freeTransform = false;
      inkEditorCursorInvalidate();
      return;
    }
    // Mod değişimi yalnızca segment ve Ctrl/Cmd+1–2 ile yapılır. Esc
    // yalnızca açık bir ön izleme/renk çarkı varsa onu kapatır.
    const overlay = document.getElementById('psRefOverlay');
    if (overlay && !overlay.hidden) {
      overlay.hidden = true;
      return;
    }
    const wheel = document.getElementById('inkColorWheel');
    if (wheel && !wheel.hidden) {
      if (typeof inkCloseColorWheel === 'function') inkCloseColorWheel();
      else wheel.hidden = true;
    }
    return;
  }

  const ae = document.activeElement;
  /* K10 · range/checkbox/toggle gibi alan-girdileri "yazışma" sayılmaz:
     kaydırıcıya dokunulduktan sonra Space ile gezinme kilitlemesin —
     tahta tuşlayıcısındaki (15-menu-export) istisna listesiyle aynı. */
  const typing = !!(ae && (ae.isContentEditable || /^(TEXTAREA|SELECT)$/.test(ae.tagName) ||
    (ae.tagName === 'INPUT' &&
      !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(ae.type || 'text'))));

  if (!typing && (event.code === 'Space' || event.key === ' ')) {
    // Space + sürükle = geçici kaydırma; çizim başlatmaz.
    // repeat basışlar da engellenir: basılı tutarken gelen repeat
    // keydown'lar serest kalırsa odaklı düğme "aktif" duruma girip
    // keyup'ta TIKLANIYORDU — Space panel açıp kapatıyor, araç seçiyordu
    // (kullanıcı raporu: "o bir panelse space onu açıp kapatıyor").
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) {
      /* Kullanıcı isteği: Space'e basınca odak BIRAKILIR — son dokunulan
         düğme/panel kontrolüne yapışıklık kalkar, imleç move'a döner.
         Gerçek metin alanları typing dalında zaten erken dönüyor. */
      try {
        if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      } catch { /* sessiz */ }
      ui.space = true;
      inkEditorSyncCursorStyle();
    }
    return;
  }

  if (event.key === 'Alt' && !event.repeat) {
    if (typing) return;
    event.preventDefault();
    inkEditorSetAlt(true);
    return;
  }

  /* A11: geçici döndürme modu (PS Rotate View). Tuş keymap'ten çözülür
     (varsayılan R); Ctrl/Alt bileşimi (serialize kısayolları) sekmez;
     repeat'e gerek yok — zaten açık. */
  const rotSig = !typing && !event.altKey && !event.ctrlKey && !event.metaKey && !ui.stroke &&
    event.key && event.key.length === 1 ? event.key.toLowerCase() : '';
  if (rotSig && !event.repeat &&
      (!window.tailrefKeymap || window.tailrefKeymap.actionFor(rotSig, 'editor') === 'editor.rotateView')) {
    event.preventDefault();
    event.stopPropagation();
    if (!ui.rotMode) {
      ui.rotMode = true;
      ui.rotKey = rotSig;
      ui.rotDrag = null;
      inkEditorSyncCursorStyle();
    }
    return;
  }

  if (typing || event.altKey) return;
  /* Vuruş koruması: zoom tuşları canlı vuruşta görünümü kaydırmaz
     (vuruş ortasında tuval atlayıyordu). */
  if (ui.stroke) return;
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    event.stopPropagation();
    inkEditorZoomBy(1.25);
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    event.stopPropagation();
    inkEditorZoomBy(0.8);
  } else if (event.key === '0') {
    event.preventDefault();
    event.stopPropagation();
    inkEditorZoomFit();
  } else if (event.key === '1') {
    event.preventDefault();
    event.stopPropagation();
    inkEditorZoomActual();
  }
}

function inkEditorKeyUp(event) {
  const ui = inkEditorUi;
  if (!ui.open) return;
  if (event.key === 'Shift') ui.shiftHeld = false;
  if (event.key === 'Alt') inkEditorSetAlt(false);
  /* A11: döndürme tuşu bırakılınca mod kapanır → araç - tam ekran imleci
     geri. Tuş keymap'ten çözülen imzayla (ui.rotKey) karşılaştırılır. */
  if (ui.rotMode && ui.rotKey &&
      String(event.key || '').toLowerCase() === ui.rotKey) {
    ui.rotMode = false;
    if (ui.rotDrag) {
      ui.pointerId = null;
      try { ui.canvas.releasePointerCapture(ui.rotDrag.pointerId); } catch { /* sessiz */ }
      ui.rotDrag = null;
      ui.baseWide = false;
      /* Yolda bırakma: render commit. */
      inkEditorApplyRot();
    }
    inkEditorRotHud(false);
    inkEditorSyncCursorStyle();
  }
  if (event.code === 'Space' || event.key === ' ') {
    ui.space = false;
    if (ui.panning) inkEditorPanEnd(null);
    inkEditorSyncCursorStyle();
  }
}

function inkEditorSetAlt(on) {
  const ui = inkEditorUi;
  const next = !!on;
  if (ui.alt === next) return;
  if (next && ui.stroke) return;
  ui.alt = next;
  if (next) {
    ui.toolBeforeAlt = inkState().tool;
    if (ui.toolBeforeAlt !== 'eyedropper') inkSetTool('eyedropper');
  } else {
    const previous = ui.toolBeforeAlt;
    ui.toolBeforeAlt = '';
    if (previous && inkState().tool === 'eyedropper') inkSetTool(previous);
  }
  inkEditorSyncCursorStyle();
  inkEditorInvalidate();
}

/* =========================================================
   girdi
   ========================================================= */
function inkEditorLocalRaw(event) {
  const ui = inkEditorUi;
  const fit = ui.fit;
  /* A11: ekran→tuval tek kapı — rot altında ters-döndürülür. */
  const g = inkEditorGatePoint(event.clientX, event.clientY);
  return {
    x: (g.x - fit.x) / Math.max(1, fit.w),
    y: (g.y - fit.y) / Math.max(1, fit.h),
  };
}

function inkEditorLocal(event, clampToImage) {
  const ui = inkEditorUi;
  const local = inkEditorLocalRaw(event);
  const x = local.x;
  const y = local.y;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    // Vuruş başlangıcı görsel dışında olamaz. Sürükleme sırasında da
    // kelepçeleme yapılmaz (kenar boyunca boya yığılıyordu); nokta atlanır.
    if (!clampToImage) return null;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }
  return { x, y };
}

/* FAZ 6 · Damlalık büyüteci (loupe): imlecin yanında dairesel zoom;
   halka = o an örneklenen renk (PS kalıbı). Okuma tek kapı: peek. */
function inkEditorEyePeek(clientX, clientY) {
  const ui = inkEditorUi;
  const fit = ui.fit;
  /* A11: okuma da kapıdan geçer — rot altında doğru backing piksel. */
  const g = inkEditorGatePoint(clientX, clientY);
  if (g.x < fit.x || g.x > fit.x + fit.w || g.y < fit.y || g.y > fit.y + fit.h) return null;
  /* Kiremit görünümü açıkken (varsayılan) ana tuval YALNIZ tabanı taşır;
     katman kompoziti ayrı karo tuvallerindedir. Burada ana tuval okunursa
     damlalık mürekkep rengi yerine fotoğrafın rengini alıyordu (kullanıcı:
     "çizdiğim rengi seçmiyor"). Önce görünür karo pikseli okunur. */
  let data = null;
  const tv = ui.tileView;
  if (ui.tileViewOn && tv && tv.container &&
      tv.container.style.visibility !== 'hidden') {
    try {
      const ts = tv.tileSize;
      const tx = Math.floor(g.x / ts), ty = Math.floor(g.y / ts);
      const key = inkTileViewKey(tx, ty);
      const t = tv.tiles.get(key);
      if (t && t.ctx) {
        /* Yalnız bu karo kirliyse tazele: tüm defteri boşaltmak
           (drain) imleç gezerken her örnekte pahalı olurdu. */
        if (tv.dirty.has(key) && typeof tv.painter === 'function') {
          try { if (tv.painter(t)) tv.dirty.delete(key); } catch { /* sessiz */ }
        }
        const dpr = tv.dpr || 1;
        const lx = clamp(Math.round((g.x - tx * ts) * dpr), 0, t.canvas.width - 1);
        const ly = clamp(Math.round((g.y - ty * ts) * dpr), 0, t.canvas.height - 1);
        const td = t.ctx.getImageData(lx, ly, 1, 1).data;
        if (td && td[3] >= 8) data = td;
      }
    } catch { /* karo okunamadı → ana tuvale düş */ }
  }
  if (!data) {
    const px = clamp(Math.round(g.x * ui.dpr), 0, ui.canvas.width - 1);
    const py = clamp(Math.round(g.y * ui.dpr), 0, ui.canvas.height - 1);
    try {
      data = ui.ctx.getImageData(px, py, 1, 1).data;
    } catch { return null; }
  }
  if (!data || data[3] < 8) return null;
  return '#' + [data[0], data[1], data[2]]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

function inkEditorSample(clientX, clientY) {
  const ui = inkEditorUi;
  const hex = inkEditorEyePeek(clientX, clientY);
  if (!hex) return;
  if (typeof inkSetColor === 'function') inkSetColor(hex, true);
  else inkState().color = hex;
  if (typeof inkSyncUI === 'function') inkSyncUI();
}

/* =========================================================
   seçim · taşıma · serbest dönüştürme
   ---------------------------------------------------------
   Editör vuruşları 0..1 yerel koordinatta saklar. Seçim araçları
   bu vuruşları katman katman tarar; taşıma/kırmızı çerçeve aynı
   yerel uzayda uygulanır. Böylece tuval zoom/pan yapsa da seçim
   görüntüye yapışık kalır.
   ========================================================= */

function inkEditorItemSize() {
  const it = getItem(inkEditorUi.itemId);
  return { w: Math.max(1, it ? it.w || 1 : 1), h: Math.max(1, it ? it.h || 1 : 1) };
}

function inkEditorDocLayers() {
  return inkLayersForOwner(inkEditorUi.itemId);
}

function inkEditorSelectedEntries() {
  const ids = new Set(Array.isArray(inkState().selection) ? inkState().selection : []);
  if (!ids.size) return [];
  const out = [];
  for (const layer of inkEditorDocLayers()) {
    if (layer.locked) continue;
    for (const stroke of layer.strokes || []) {
      if (ids.has(stroke.id)) out.push({ layer, stroke });
    }
  }
  return out;
}

function inkEditorPointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Yerel noktanın altındaki vuruş (en üst katmandan aşağı). */
function inkEditorHitStroke(local) {
  if (!local) return null;
  const size = inkEditorItemSize();
  const px = local.x * size.w;
  const py = local.y * size.h;
  const layers = inkEditorDocLayers();
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li];
    if (layer.locked || layer.visible === false) continue;
    const strokes = layer.strokes || [];
    for (let si = strokes.length - 1; si >= 0; si--) {
      const stroke = strokes[si];
      const pts = stroke.points || [];
      const r = Math.max(3, (stroke.size || 0) * size.w / 2 + 2);
      if (pts.length === 1) {
        if (Math.hypot(pts[0].x * size.w - px, pts[0].y * size.h - py) <= r) {
          return { layer, stroke };
        }
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        const d = inkEditorPointSegDist(
          px, py,
          pts[i - 1].x * size.w, pts[i - 1].y * size.h,
          pts[i].x * size.w, pts[i].y * size.h
        );
        if (d <= r) return { layer, stroke };
      }
    }
  }
  return null;
}

function inkEditorStrokePxBounds(stroke, w, h) {
  const pts = stroke && stroke.points;
  if (!pts || !pts.length) return null;
  const r = Math.max(1, (stroke.size || 0) * w / 2);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x * w - r);
    x1 = Math.max(x1, p.x * w + r);
    y0 = Math.min(y0, p.y * h - r);
    y1 = Math.max(y1, p.y * h + r);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function inkEditorSelectionPxBounds() {
  const size = inkEditorItemSize();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const entry of inkEditorSelectedEntries()) {
    const b = inkEditorStrokePxBounds(entry.stroke, size.w, size.h);
    if (!b) continue;
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Seçim sınırının ekran dikdörtgeni (gizmo çizimi ve tutamaç isabeti). */
function inkEditorGizmoRect() {
  const ui = inkEditorUi;
  const b = inkEditorSelectionPxBounds();
  if (!b) return null;
  const size = inkEditorItemSize();
  const sx = ui.fit.w / size.w;
  const sy = ui.fit.h / size.h;
  const x = ui.fit.x + b.x0 * sx;
  const y = ui.fit.y + b.y0 * sy;
  const w = Math.max(1, (b.x1 - b.x0) * sx);
  const h = Math.max(1, (b.y1 - b.y0) * sy);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function inkEditorGizmoHandles(rect) {
  const { x, y, w, h, cx, cy } = rect;
  return [
    { id: 'nw', x, y },
    { id: 'n', x: cx, y },
    { id: 'ne', x: x + w, y },
    { id: 'e', x: x + w, y: cy },
    { id: 'se', x: x + w, y: y + h },
    { id: 's', x: cx, y: y + h },
    { id: 'sw', x, y: y + h },
    { id: 'w', x, y: cy },
    { id: 'rot', x: cx, y: y - 28 },
  ];
}

function inkEditorPushSnapshot(raw) {
  if (!raw) return;
  try {
    undoStack.push(raw);
    /* Adım sınırı kullanıcı ayarından (tailref-undo-steps); boşsa mevcut 60. */
    const undoLimit = (typeof tailrefUndoLimit === 'function') ? tailrefUndoLimit(60) : 60;
    while (undoStack.length > undoLimit) {
      const dropped = undoStack.shift();
      if (typeof inkUndoRasterDropRaw === 'function') inkUndoRasterDropRaw(dropped);
    }
    if (redoStack.length) {
      if (typeof inkUndoRasterDropStack === 'function') inkUndoRasterDropStack(redoStack);
      redoStack.length = 0;
    }
  } catch { return; }
  if (typeof scheduleSave === 'function') scheduleSave();
  if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
}

/** Seçili vuruşların katmanlarını yeniden rasterlar. */
function inkEditorRefreshSelection() {
  const layers = new Set(inkEditorSelectedEntries().map(e => e.layer));
  for (const layer of layers) {
    if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(layer.id, 'mutation');
    if (typeof inkRerenderLayer === 'function') inkRerenderLayer(layer.id);
  }
  if (typeof inkFlushDirtyLayers === 'function') inkFlushDirtyLayers();
  inkEditorInvalidate();
  inkEditorCursorInvalidate();
}

function inkEditorBeginGizmoDrag(mode, event, local) {
  const ui = inkEditorUi;
  const entries = inkEditorSelectedEntries();
  if (!entries.length) return false;
  const b = inkEditorSelectionPxBounds();
  if (!b) return false;
  const size = inkEditorItemSize();
  let anchor = { x: b.cx, y: b.cy };
  if (mode.length === 2) {
    anchor = {
      x: mode.includes('w') ? b.x1 : b.x0,
      y: mode.includes('n') ? b.y1 : b.y0,
    };
  } else if (mode === 'n' || mode === 's') {
    anchor = { x: b.cx, y: mode === 'n' ? b.y1 : b.y0 };
  } else if (mode === 'e' || mode === 'w') {
    anchor = { x: mode === 'e' ? b.x0 : b.x1, y: b.cy };
  }
  const px = local.x * size.w;
  const py = local.y * size.h;
  ui.gizmoDrag = {
    mode,
    start: { x: local.x, y: local.y, px, py },
    bounds: b,
    anchor,
    angle: Math.atan2(py - b.cy, px - b.cx),
    /* rot: çerçeve anlık görüntüsü — sürükleme boyunca kutu+tutamaçlar
       bu dikdörtgen etrafında içerikle birlikte döner ("sadece çizim
       dönüyor" şikâyetinin kökünden kurtaran görsel hizalama). */
    rotRect: mode === 'rot' ? inkEditorGizmoRect() : null,
    rotDisplay: 0,
    before: entries.map(entry => ({
      layer: entry.layer,
      stroke: entry.stroke,
      size: entry.stroke.size,
      points: (entry.stroke.points || []).map(p => ({ x: p.x, y: p.y })),
    })),
    moved: false,
    undo: typeof createStateSnapshot === 'function'
      ? JSON.stringify(createStateSnapshot()) : '',
  };
  return true;
}

function inkEditorUpdateGizmoDrag(event) {
  const ui = inkEditorUi;
  const g = ui.gizmoDrag;
  if (!g) return;
  const size = inkEditorItemSize();
  const raw = inkEditorLocalRaw(event);
  const px = raw.x * size.w;
  const py = raw.y * size.h;
  const b = g.bounds;
  let dx = 0;
  let dy = 0;
  let fx = 1;
  let fy = 1;
  let da = 0;

  if (g.mode === 'move') {
    dx = px - g.start.px;
    dy = py - g.start.py;
  } else if (g.mode === 'rot') {
    const a = Math.atan2(py - b.cy, px - b.cx);
    da = a - g.angle;
    if (event.shiftKey) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
    /* çerçeve çiziminde kullanılan gösterim açısı — kutu içerikle döner */
    g.rotDisplay = da;
  } else {
    const ax = g.anchor.x;
    const ay = g.anchor.y;
    const sx = g.start.px - ax;
    const sy = g.start.py - ay;
    if (g.mode.includes('e') || g.mode.includes('w')) {
      if (Math.abs(sx) > 1e-6) fx = (px - ax) / sx;
    }
    if (g.mode.includes('n') || g.mode.includes('s')) {
      if (Math.abs(sy) > 1e-6) fy = (py - ay) / sy;
    }
    // Negatif ölçek (aynalama) yerine en küçük boyutta tut.
    fx = clamp(fx, 0.02, 40);
    fy = clamp(fy, 0.02, 40);
  }

  const cos = Math.cos(da);
  const sin = Math.sin(da);
  for (const entry of g.before) {
    const stroke = entry.stroke;
    const pts = stroke.points || [];
    for (let i = 0; i < pts.length; i++) {
      const base = entry.points[i] || pts[i];
      let x = base.x * size.w;
      let y = base.y * size.h;
      if (g.mode === 'move') {
        x += dx;
        y += dy;
      } else if (g.mode === 'rot') {
        const ox = x - b.cx;
        const oy = y - b.cy;
        x = b.cx + ox * cos - oy * sin;
        y = b.cy + ox * sin + oy * cos;
      } else {
        x = (x - g.anchor.x) * fx + g.anchor.x;
        y = (y - g.anchor.y) * fy + g.anchor.y;
      }
      pts[i].x = x / size.w;
      pts[i].y = y / size.h;
    }
    if (g.mode !== 'move' && g.mode !== 'rot') {
      const f = Math.sqrt(Math.max(1e-4, fx * fy));
      stroke.size = clamp(entry.size * f, 0.00005, 4);
    }
  }
  g.moved = true;
  inkEditorRefreshSelection();
}

function inkEditorFinishGizmoDrag() {
  const ui = inkEditorUi;
  const g = ui.gizmoDrag;
  ui.gizmoDrag = null;
  if (!g) return;
  if (g.moved && g.undo) inkEditorPushSnapshot(g.undo);
  ui.freeTransform = true;
  inkEditorCursorInvalidate();
}

function inkEditorCancelSelection() {
  const ui = inkEditorUi;
  if (ui.gizmoDrag) {
    // Sürükleme sırasında Esc: vuruşları başlangıç hâline döndür.
    for (const entry of ui.gizmoDrag.before) {
      const stroke = entry.stroke;
      const pts = stroke.points || [];
      for (let i = 0; i < pts.length; i++) {
        const base = entry.points[i];
        if (!base) continue;
        pts[i].x = base.x;
        pts[i].y = base.y;
      }
      stroke.size = entry.size;
    }
    ui.gizmoDrag = null;
    inkEditorRefreshSelection();
  }
  ui.marquee = null;
  ui.lasso = null;
  ui.selMode = null;
  ui.freeTransform = false;
  inkState().selection = [];
  inkEditorCursorInvalidate();
}

function inkEditorBeginSelectTool(tool, event, local) {
  const ui = inkEditorUi;
  ui.pointerId = event.pointerId;
  try { ui.canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }

  if (tool === 'marquee') {
    ui.lasso = null;
    ui.selMode = inkSelectEffectiveMode(event);
    ui.marquee = {
      x0: clamp(local.x, 0, 1), y0: clamp(local.y, 0, 1),
      x1: clamp(local.x, 0, 1), y1: clamp(local.y, 0, 1),
      // B6: mod drag başında sabitlenir (Shift/Alt geçici üstünlüğü).
      mode: ui.selMode,
    };
    inkEditorCursorInvalidate();
    return;
  }
  if (tool === 'lasso') {
    ui.marquee = null;
    ui.selMode = inkSelectEffectiveMode(event);
    ui.lasso = [{ x: clamp(local.x, 0, 1), y: clamp(local.y, 0, 1) }];
    inkEditorCursorInvalidate();
    return;
  }
  ui.selMode = null;

  // transform
  const sel = Array.isArray(inkState().selection) ? inkState().selection : [];
  if (sel.length) {
    const rect = inkEditorGizmoRect();
    if (rect) {
      const handle = inkEditorGizmoHandles(rect).find(h =>
        Math.hypot(event.clientX - h.x, event.clientY - h.y) <=
        /* dönme topuzu küçük ve uzak olduğundan daha cömert yakalar */
        (h.id === 'rot' ? 14 : 9));
      if (handle) {
        if (inkEditorBeginGizmoDrag(handle.id, event, local)) return;
      }
      const inside = event.clientX >= rect.x - 2 && event.clientX <= rect.x + rect.w + 2 &&
        event.clientY >= rect.y - 2 && event.clientY <= rect.y + rect.h + 2;
      if (inside) {
        if (inkEditorBeginGizmoDrag('move', event, local)) return;
      }
    }
  }
  const hit = inkEditorHitStroke(local);
  if (hit) {
    /* B6: mod duyarlı tıklama (30-ink-tools ile aynı semantik). */
    const mode = inkSelectEffectiveMode(event);
    const fresh = mode === 'new' ? [hit.stroke.id]
      : inkSelectionMerge(mode, inkState().selection, [hit.stroke.id]);
    inkState().selection = fresh;
    ui.freeTransform = false;
    inkEditorCursorInvalidate();
    if (fresh.length) inkEditorBeginGizmoDrag('move', event, local);
    return;
  }
  if (inkState().selection.length) {
    /* B6: boşluğa tıklama yalnız 'new' modunda temizler. */
    if (inkSelectEffectiveMode(event) === 'new') {
      inkState().selection = [];
      ui.freeTransform = false;
      inkEditorCursorInvalidate();
    }
  }
}

function inkEditorUpdateSelectDrag(event) {
  const ui = inkEditorUi;
  if (ui.marquee) {
    const raw = inkEditorLocalRaw(event);
    ui.marquee.x1 = clamp(raw.x, 0, 1);
    ui.marquee.y1 = clamp(raw.y, 0, 1);
    inkEditorCursorInvalidate();
    return;
  }
  if (ui.lasso) {
    const raw = inkEditorLocalRaw(event);
    const last = ui.lasso[ui.lasso.length - 1];
    if (!last || Math.hypot(raw.x - last.x, raw.y - last.y) > 0.002) {
      ui.lasso.push({ x: clamp(raw.x, 0, 1), y: clamp(raw.y, 0, 1) });
      inkEditorCursorInvalidate();
    }
    return;
  }
  if (ui.gizmoDrag) inkEditorUpdateGizmoDrag(event);
}

function inkEditorPointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (((a.y > y) !== (b.y > y)) &&
        (x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x)) {
      inside = !inside;
    }
  }
  return inside;
}

function inkEditorFinishMarquee() {
  const ui = inkEditorUi;
  const m = ui.marquee;
  ui.marquee = null;
  ui.selMode = null;
  if (!m) return;
  const size = inkEditorItemSize();
  const x0 = Math.min(m.x0, m.x1) * size.w;
  const x1 = Math.max(m.x0, m.x1) * size.w;
  const y0 = Math.min(m.y0, m.y1) * size.h;
  const y1 = Math.max(m.y0, m.y1) * size.h;
  const ids = [];
  if (x1 - x0 > 2 && y1 - y0 > 2) {
    for (const layer of inkEditorDocLayers()) {
      if (layer.locked || layer.visible === false) continue;
      for (const stroke of layer.strokes || []) {
        const b = inkEditorStrokePxBounds(stroke, size.w, size.h);
        if (!b) continue;
        if (!(b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1)) ids.push(stroke.id);
      }
    }
  }
  /* B6: m.mode seçilme modu — merge motor tek yol (30-ink-tools ile
     ortak); merge {} boş parça → add/sub korur, new/intersect boşaltır. */
  inkState().selection = inkSelectionMerge(m.mode, inkState().selection, ids);
  inkEditorCursorInvalidate();
}

function inkEditorFinishLasso() {
  const ui = inkEditorUi;
  const poly = ui.lasso;
  const selMode = ui.selMode || 'new';
  ui.lasso = null;
  ui.selMode = null;
  if (!poly || poly.length < 3) {
    /* B6: merge — boş parça; add/sub günün seçimini korur. */
    inkState().selection = inkSelectionMerge(selMode, inkState().selection, []);
    inkEditorCursorInvalidate();
    return;
  }
  const size = inkEditorItemSize();
  const ids = [];
  for (const layer of inkEditorDocLayers()) {
    if (layer.locked || layer.visible === false) continue;
    for (const stroke of layer.strokes || []) {
      const pts = stroke.points || [];
      for (const p of pts) {
        if (inkEditorPointInPolygon(p.x * size.w, p.y * size.h, poly.map(q => ({
          x: q.x * size.w, y: q.y * size.h,
        })))) {
          ids.push(stroke.id);
          break;
        }
      }
    }
  }
  inkState().selection = inkSelectionMerge(selMode, inkState().selection, ids);
  inkEditorCursorInvalidate();
}

/** Ctrl+T: seçili vuruşları (yoksa etkin katmanın tamamını) dönüştürme
    moduna alır. Kullanıcı kutuyu sürükleyerek taşır, tutamaçlarla
    ölçekler, üstteki yuvarlakla döndürür. */
function inkEditorFreeTransform() {
  const ui = inkEditorUi;
  if (!ui.open) return false;
  const ink = inkState();
  let selection = Array.isArray(ink.selection) ? ink.selection.slice() : [];
  // Ctrl+T seçim yoksa etkin katmanın tamamını alır. Silgi vuruş listesini
  // boşaltmaz (sadece pikselleri eritir); bu yüzden aşağıda piksel gerçeği
  // ayrıca taranır — aksi hâlde "yokluğu seçen hayalet kutu" doğardı.
  let targetLayer = null;
  if (!selection.length) {
    const layers = inkEditorDocLayers().filter(l => !l.locked && l.visible !== false);
    const active = inkLayerById(ui.layerId);
    const target = active && layers.includes(active) ? active : layers[layers.length - 1];
    if (target && (target.strokes || []).length) targetLayer = target;
    if (target) selection = (target.strokes || []).map(s => s.id);
    if (!selection.length) {
      for (const layer of layers) {
        for (const stroke of layer.strokes || []) selection.push(stroke.id);
      }
    }
  }
  if (!selection.length) return false;
  // BOŞ KATMAN KORUMASI (PS kalıbı, istek: "Ctrl+T yokluğu seçmesin"):
  // hedef katmanın rasterında tek görünür piksel bile yoksa dönüştürme
  // hiç açılmaz; yerinde, anlaşılır bir uyarı çıkar.
  if (targetLayer && typeof inkLayerVisiblePixelRect === 'function' &&
      !inkLayerVisiblePixelRect(targetLayer)) {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice(window.__t('No visible content to transform in the layer'), 2400);
    }
    return false;
  }
  ink.selection = selection;
  inkSetTool('transform');
  ui.freeTransform = true;
  inkEditorCursorInvalidate();
  return true;
}


function inkEditorPointerDown(event) {
  const ui = inkEditorUi;
  if (!ui.open || ui.stroke || ui.panning) return;

  // Orta tuş veya Space + sol tık: kaydırma. Çizim başlatmaz.
  if (event.button === 1 || (event.button === 0 && ui.space)) {
    event.preventDefault();
    event.stopPropagation();
    inkEditorPanStart(event);
    return;
  }
  /* Kalem arkası silgi (button 5, buttons bit 32) sol tuş gibi işlenir;
     araç geçişi aşağıda inkPenEraserMaybeSwap ile yapılır. */
  if (event.button !== 0 && !inkPenEraserEvent(event)) return;

  /* A11: R modda sol tık → döndürme sürüklemesi. Sürükleme tuvalin
     MERKEZİ etrafında pointer açısıyla ilerler; <4px hareket bırakılırsa
     tek tık sayılır ve açı 0'a sıfırlanır. Vuruş üretmez. */
  if (ui.rotMode) {
    event.preventDefault();
    event.stopPropagation();
    const rect = ui.rect || { left: 0, top: 0,
      width: window.innerWidth, height: window.innerHeight };
    /* A11 v3: açı da KÂĞIT MERKEZİ etrafında ölçülür — render pivotu ile
       aynı nokta. Kâğıt yerinde dönerken imleç birebir takip eder;
       pencere merkezinden ölçülürken kâğıt uzaklaşınca açı-flatüasyon
       yapıyordu (kullanıcı raporu: "kâğıt ekranda sağa sola geziniyor"). */
    const fit = (typeof inkEditorComputeFit === 'function')
      ? (ui.fit || inkEditorComputeFit()) : null;
    const cx = fit ? fit.x + fit.w / 2 : rect.left + rect.width / 2;
    const cy = fit ? fit.y + fit.h / 2 : rect.top + rect.height / 2;
    ui.rotDrag = {
      pointerId: event.pointerId,
      startRot: Number(ui.view.rot) || 0,
      a0: Math.atan2(event.clientY - cy, event.clientX - cx),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    /* A11 v5: sürükleme boyu tek kurulum — geniş base. Geniş modda base
       anahtarı rot'i içermez; her kare render'ı base'i yeniden kurmaz. */
    ui.baseWide = true;
    /* A11 v6 (kullanıcı: "ilk döndürüşte hayalet iz var, görünüp
       kayboluyor"): çerçeve (kenar+gölge) yalnız commit'te gizleniyordu;
       İLK sürükleyişte rot 0'dan başladığı için dik çerçeve dönmüş
       kâğıdın kenarı dışında yarı-saydam bant olarak drag boyunca
       kalıyordu (yalnız ilk döndürmede — sonrakilerde zaten gizli).
       Sürüleme başında gizlenir; bırakışta inkEditorApplyRot rot=0'a
       dönerse yeniden gösterir. */
    try {
      const frame = document.getElementById('inkCanvasFrame');
      if (frame) frame.hidden = true;
    } catch { /* sessiz */ }
    ui.canvas.style.transform = '';
    ui.canvas.style.transformOrigin = '';
    inkEditorInvalidate();
    ui.pointerId = event.pointerId;
    try { ui.canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
    inkEditorSyncCursorStyle();
    return;
  }

  const local = inkEditorLocal(event);
  /* Kalem arkası silgi: vuruş öncesi geçici araç değişimi — tahta hattıyla
     aynı yardımcılar (inkPenEraserMaybeSwap/Restore, 30-ink-tools). */
  inkPenEraserMaybeSwap(event);
  const toolNow = inkState().tool;
  const paintTool = ['brush', 'pencil', 'eraser', 'fill', 'smudge', 'liquify', 'gradient', 'shape'].includes(toolNow);

  if (!local) {
    // Tuval dışında başlayan çizim: fırça basılı tutulur, ilk içeri
    // girişte tam sınır noktasından vuruş başlar. Önceden tuval dışına
    // basınca hiçbir şey olmuyordu; dışarıdan içeriye çizilemiyordu.
    if (!paintTool || event.altKey) {
      inkPenEraserRestore();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    ui.pendingStroke = {
      pointerId: event.pointerId,
      raw: inkEditorLocalRaw(event),
      clientX: event.clientX,
      clientY: event.clientY,
      at: Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
    };
    ui.pointerId = event.pointerId;
    try { ui.canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
    inkEditorSyncCursorStyle();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.altKey && !ui.alt) inkEditorSetAlt(true);

  if (event.altKey || toolNow === 'eyedropper') {
    inkEditorSample(event.clientX, event.clientY);
    ui.sampling = true;
    ui.pointerId = event.pointerId;
    try { ui.canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
    return;
  }

  if (toolNow === 'marquee' || toolNow === 'lasso' || toolNow === 'transform') {
    inkEditorBeginSelectTool(toolNow, event, local);
    return;
  }

  /* Metin aracı: v5 kabuğunda tahta minyatüre kırpıldığı (ps-ref-live)
     için tahta pointerdown'ı metin dalına hiç ulaşmıyordu; kâğıt
     tıklaması ölüydü. Tıklamayı düzenlenen öğenin dünya koordinatına
     çevirip tahta metnini oraya ekliyoruz — çizimden çıkınca metin
     kâğıtta tıklanan noktada bekler. */
  if (toolNow === 'text') {
    /* Tahta akışındaki gibi (30-ink-tools 1116): yeni metin öncesi
       açık edit commit edilir; boş metin kendiliğinden silinir. */
    if (editingId) commitEdit();
    const host = getItem(ui.itemId);
    if (host) {
      addText({ x: host.x + local.x * host.w, y: host.y + local.y * host.h });
    }
    return;
  }

  inkEditorBeginPaint(event, local, null);
}

/** FAZ 6 madde 11: vuruş simetri kimliği — beyaz lista dışındaki
    değerlerin vuruşa sızmaması için tek kapı. */
function inkSymModeOf(value) {
  return ['off', 'mirrorX', 'mirrorY', 'mirrorXY', 'radial4', 'radial8']
    .includes(value) ? value : 'off';
}

/** Parmak/fare basıldığı andaki konumdan boyamaya başlar. `pending`
    verilmişse vuruş tuval dışında başlamıştır; başlangıç noktası ve
    hız takibi o ilk basıştan devam eder. */

/** Modal çizimde gerçek boya hedefi. Aktif katman bu belgeye aitse
    kilitli/gizli katmana SESSİZCE başka katmana geçilmez: kullanıcı
    kilitli katmanı seçip çizdiğinde boya görünmeyen bir katmana
    gidiyordu. Açık bir uyarı verilir ve vuruş başlamaz. */
function inkEditorResolvePaintLayer() {
  const active = inkActiveLayer();
  const ui = inkEditorUi;
  if (active && active.kind === 'attached' && active.ownerId === ui.itemId) {
    if (active.locked) {
      if (typeof showProjectNotice === 'function') {
        showProjectNotice(window.__t('Layer is locked: unlock it to draw.'), 2400);
      }
      return null;
    }
    if (active.visible === false) {
      if (typeof showProjectNotice === 'function') {
        showProjectNotice(window.__t('Layer is hidden: show it to draw.'), 2400);
      }
      return null;
    }
    return active;
  }
  return inkEditorTargetLayer();
}

function inkEditorBeginPaint(event, local, pending) {
  const ui = inkEditorUi;
  const tool = inkState().tool;
  if (!['brush', 'pencil', 'eraser', 'fill', 'smudge', 'liquify', 'gradient', 'shape'].includes(tool)) return false;

  const layer = inkEditorResolvePaintLayer();
  if (!layer || layer.locked) return false;
  if (tool === 'fill' && layer.kind !== 'attached') {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('The paint bucket currently works only on image-linked layers.', 3200);
    }
    return false;
  }
  if (['smudge', 'liquify', 'gradient'].includes(tool) && layer.kind !== 'attached') {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('These tools currently work only on image-linked layers.', 3200);
    }
    return false;
  }
  const layerCanvas = inkEnsureItemCanvas(layer);
  if (!layerCanvas) return false;
  if (tool === 'fill' && layerCanvas.width * layerCanvas.height > INK_FILL_MAX_PIXELS) {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice('The paint bucket supports at most 8 megapixels in this layer.', 3200);
    }
    return false;
  }

  const it = getItem(ui.itemId);
  if (!it) return false;
  const ink = inkState();
  const brush = inkGetBrush(ink.brushId);
  const pressure0 = inkCurvePressure(inkEventPressure(event), ink.pressureCurve);
  let pressure = pressure0;
  const tilt = inkEventTilt(event);
  const start = inkApplyTilt({ x: local.x, y: local.y, p: pressure, s: 0 }, tilt);

  const stroke = {
    id: 'sk_' + newId(),
    kind: tool === 'shape' ? 'shape' : ['fill', 'smudge', 'liquify', 'gradient'].includes(tool) ? tool : 'stroke',
    tool: ['eraser', 'fill', 'smudge', 'liquify', 'gradient'].includes(tool) ? tool : 'brush',
    shape: tool === 'shape' ? ink.shape : '',
    color: ink.color,
    size: ink.size / Math.max(1, it.w || 1),
    opacity: ink.opacity,
    hardness: ink.hardness,
    spacing: ink.spacing,
    flow: ink.flow,
    flowJitter: ink.flowJitter,
    speedSize: clamp(Number(ink.speedSize) || 0, 0, 0.8),
    brushId: ink.brushId,
    scatter: brush ? brush.scatter : 0,
    fillTolerance: 24,
    closed: false,
    // Alfa kilidi vuruş başına kaydedilir (ilave, commit sonrası tutarlılık).
    lockAlpha: !!layer.alphaLock,
    // FAZ 6 madde 11: simetri yalnızca bağlı katman düzenlemesinden
    // taşınır; nokta noktaya örtüşme ancak bu kanalla korunur.
    sym: inkSymModeOf(ink.symMode),
    points: [start],
  };
  // FAZ 7.W: gradyan vuruşuna canlı durakların deep kopyası gömülür
  // (30-ink-tools inkBeginFreehand ile aynı pişirme; deep-copy — sonraki
  // bar düzenlemeleri pişmiş vuruşu değiştirmez).
  if (tool === 'gradient') stroke.stops = inkGradientStopsBake(ink);

  // Önizleme, her karede kalıcı katman kopyasının üstüne tam vuruşu çizer;
  // böylece commit ile aynı raster yolu kullanılabilir.
  ui.stroke = stroke;
  ui.scratch = null;
  ui.dualWts = null;
  ui.dualComp = null;
  ui.dualCompPts = 0;
  // Şekil oturtma durumu her vuruşta taze başlar.
  ui.snapHold = null;
  ui.snapped = false;
  ui.snapSaved = null;
  ui.snapFirePt = null;
  ui.snapAdj = null;
  ui.previewGl = false;
  ui.previewCanvas = null;
  ui.previewRect = null;
  ui.previewSkip = 0;
  // Tur 4b: şekil-iz kutusu vuruş başında temiz (birikme yok).
  ui.lastShapeRasterRect = null;
  // M3: vuruş başında minyatürlü overlay ilk karede anında eşitsin.
  ui.overlaySyncAt = 0;
  ui.coordsSyncAt = 0;
  // M6: vuruş başında kısınlama durumu temiz başlasın.
  ui.loopLastAt = 0;
  ui.slowFrames = 0;
  ui.renderFlip = 0;
  // Kiremit: yeni vuruşun "chip karesi görüldü" izi temiz.
  ui.tvChipSeen = false;
  // Tur 2 madde 5: yeni vuruş başında bekleyen kare çipi düşer —
  // önceki vuruşun commit karesi bitmeden yeni vuruş açıldıysa bölgesel
  // boya yerine güvenli tam yol geri gelir.
  ui.frameChip = null;
  // Kiremit otomatik profil: önceki vuruşların kararı BURADA uygulanır
  // (ilk kare öncesi — vuruşlar arası sözleşmenin tam noktası). Probe
  // ile zorlanan boyut da aynı kanaldan gelir (inkTileSizeCur
  // önceliği __inkTileSize).
  if (ui.tileView) {
    const want = inkTileSizeCur();
    if (ui.tileView.tileSize !== want) ui.tileView.setTileSize(want);
  }
  ui.layerCanvas = layerCanvas;
  ui.layerId = layer.id;
  ui.pointerId = event.pointerId;
  ui.previewDirty = true;
  ui.rawHistory = [start];
  ui.lastClient = pending
    ? { x: pending.clientX, y: pending.clientY }
    : { x: event.clientX, y: event.clientY };
  ui.lastAt = pending
    ? pending.at
    : (Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now());
  ui.speed = 0;
  ui.smoothX = local.x;
  ui.smoothY = local.y;
  ui.lastRaw = { x: local.x, y: local.y };
  ui.lastPressure = pressure;
  ui.lastTilt = tilt;
  // FAZ 2: One-Euro filtre durumu (tahta yoluyla aynı davranış).
  ui.stab = typeof inkStabilizerBegin === 'function' ? inkStabilizerBegin() : null;
  ui.outside = false;
  ui.sampling = false;
  ui.pendingStroke = null;

  try { ui.canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
  inkEditorSyncCursorStyle();
  inkEditorInvalidate();
  return true;
}

function inkEditorPointerMove(event) {
  const ui = inkEditorUi;
  if (!ui.open) return;

  if (ui.panning) {
    event.preventDefault();
    event.stopPropagation();
    inkEditorPanMove(event);
    return;
  }

  /* A11: döndürme sürüklemesi — pointer açısı (merkeze göre) başlangıca
     göre döner; açı negatif taşmayla (kısa yol) toplanır. Sadece style
     yazımı var: raster dokunulmaz, kare maliyeti sabit. */
  if (ui.rotDrag) {
    if (event.pointerId !== ui.rotDrag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = ui.rect || { left: 0, top: 0,
      width: window.innerWidth, height: window.innerHeight };
    /* A11 v3: açı ölçümü de kâğıt merkezinde (pointerdown ile aynı
       pivot) — a0 başlangıcından sapma kâğıt eksenini izler. */
    const fit = (typeof inkEditorComputeFit === 'function')
      ? (ui.fit || inkEditorComputeFit()) : null;
    const cx = fit ? fit.x + fit.w / 2 : rect.left + rect.width / 2;
    const cy = fit ? fit.y + fit.h / 2 : rect.top + rect.height / 2;
    let d = Math.atan2(event.clientY - cy, event.clientX - cx) - ui.rotDrag.a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (!ui.rotDrag.moved &&
        Math.hypot(event.clientX - ui.rotDrag.startX,
          event.clientY - ui.rotDrag.startY) > 4) {
      ui.rotDrag.moved = true;
      inkEditorSyncCursorStyle();
    }
    let target = inkEditorRotNorm(ui.rotDrag.startRot + d * 180 / Math.PI);
    /* A11: Shift = 15° ızgaraya kenetle — kullanıcı tam 45°/90° gibi
       açıları sürükleme sırasında bırakmadan yakalayabilir. */
    if (event.shiftKey) target = Math.round(target / 15) * 15;
    /* Sürükleme karesi: A11 v5 — CSS hız yolu kaldırıldı; her kare
       normal render (geniş base tek kurulum). Bırakınca commit
       inkEditorApplyRot içerik rotasyonunu devralır, görüntü değişmez. */
    ui.view.rot = target;
    ui.canvas.style.transform = '';
    ui.canvas.style.transformOrigin = '';
    inkEditorInvalidate();
    inkEditorRotHud(true, ui.view.rot, event.clientX, event.clientY);
    return;
  }

  if (ui.pendingStroke) {
    if (event.pointerId !== ui.pendingStroke.pointerId) return;
    const pending = ui.pendingStroke;
    const rawNow = inkEditorLocalRaw(event);
    const seg = inkClipUnitSegment(pending.raw, rawNow);
    if (!seg) {
      // Hâlâ tuval dışında: son dış noktayı güncelle, boyama.
      pending.raw = rawNow;
      pending.clientX = event.clientX;
      pending.clientY = event.clientY;
      pending.at = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      /* İmleç halkası da iz sürsün: aksi hâlde kâğıt dışındaki kuru
         tutuşta halka başladığı yerde donuyor, kâğıda girince
         "ışınlanıyordu" (kullanıcı raporu 09.11). */
      ui.lastClient = { x: event.clientX, y: event.clientY };
      event.preventDefault();
      event.stopPropagation();
      inkEditorCursorInvalidate();
      return;
    }
    // İlk içeri giriş: vuruş tam sınır noktasından başlar.
    const entry = {
      x: clamp(pending.raw.x + (rawNow.x - pending.raw.x) * seg.t0, 0, 1),
      y: clamp(pending.raw.y + (rawNow.y - pending.raw.y) * seg.t0, 0, 1),
    };
    event.preventDefault();
    event.stopPropagation();
    if (inkEditorBeginPaint(event, entry, pending)) {
      inkEditorMoveSample(event);
    } else {
      ui.pendingStroke = null;
    }
    return;
  }

  if (event.altKey && !ui.alt) inkEditorSetAlt(true);
  else if (!event.altKey && ui.alt) inkEditorSetAlt(false);

  if (ui.sampling) {
    ui.lastClient = { x: event.clientX, y: event.clientY };
    inkEditorSample(event.clientX, event.clientY);
    return;
  }
  if (ui.marquee || ui.lasso || ui.gizmoDrag) {
    event.preventDefault();
    event.stopPropagation();
    inkEditorUpdateSelectDrag(event);
    return;
  }
  if (!ui.stroke) {
    ui.lastClient = { x: event.clientX, y: event.clientY };
    inkEditorSyncCursorStyle();
    // Yalnızca imleç halkası + koordinat; tam sahne yeniden çizilmez.
    inkEditorCursorInvalidate();
    return;
  }

  // Vuruş sırasında `lastClient` burada güncellenmez: hız hesabı önceki
  // örnekle farkı görmeli. `inkEditorMoveSample` kendi günceller.
  event.preventDefault();
  event.stopPropagation();

  const list = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
  if (list && list.length > 1) {
    for (const sample of list) {
      if (!ui.stroke) break;
      inkEditorMoveSample(sample);
    }
  } else {
    inkEditorMoveSample(event);
  }
}

function inkEditorMoveSample(event) {
  const ui = inkEditorUi;
  const stroke = ui.stroke;
  if (!stroke) return;
  if (stroke.kind === 'fill') return;
  // Nokta kelepçelenmez: imleç tuvalin dışına çıkabilir. Dışarıda kalan
  // kısım boyanmaz ama izleme (basınç, hız, yumuşatma) sürer; kenarı
  // geçerken yol tam sınıra kırpılır. Böylece köşede vuruş kesilmez,
  // geri girince aynı vuruş kaldığı yerden devam eder.
  let raw = inkEditorLocalRaw(event);

  // Shift düz-çizgi kilidi (Photoshop tarzı): vuruşun İLK noktasına
  // göre ham nokta en yakın 45° yönüne kenetlenir. Kenetlenen ham nokta
  // yumuşatıcıya girer: ara Catmull interpolasyonu da düz kalır ve
  // bırakma kuyruğu (ui.lastRaw) doğrunun üstünde biter. `let`: FAZ 2-4
  // fare simülasyonu geçebilir.
  const lockStart = stroke.points && stroke.points[0];
  if (event.shiftKey && lockStart) {
    /* Tur 4h: kalıcı eksen durumu vuruşta taşınır; Shift bırakılınca
       sıfırlanır (yeniden basışta eksen o anki yönden taze seçilir). */
    raw = inkStraightLockPoint(lockStart, raw, getItem(ui.itemId),
      stroke.shiftLock || (stroke.shiftLock = {}));
  } else if (stroke.shiftLock) {
    stroke.shiftLock = null;
  }

  // Yeniden atanabilir: FAZ 2-4 fare simülasyonu geçebilir (let).
  let pressure = inkCurvePressure(inkEventPressure(event), inkState().pressureCurve);
  const tilt = inkEventTilt(event);

  const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const lastClient = ui.lastClient || { x: event.clientX, y: event.clientY };
  const dt = Math.max(1, now - (ui.lastAt || now));
  const moved = Math.hypot(event.clientX - lastClient.x, event.clientY - lastClient.y);
  const rawSpeed = inkSpeedInfluence(moved, dt);
  ui.speed = clamp((Number.isFinite(ui.speed) ? ui.speed : 0) * 0.6 + rawSpeed * 0.4, 0, 1);
  ui.lastAt = now;
  ui.lastClient = { x: event.clientX, y: event.clientY };

  // Şekil oturtma: hareketsiz bekleme zamanlayıcısını yönet.
  inkEditorSnapTrack(event);

  // FAZ 2-4: basınç bildirmeyen fare için hız → basınç simülasyonu
  // (tahta yolu ile aynı davranış).
  ui.mouseSim = event.pointerType === 'mouse' && !!inkState().mouseSpeedPressure;
  if (ui.mouseSim) {
    pressure = inkCurvePressure(inkSimulatedPressure(ui.speed), inkState().pressureCurve);
  }

  /* Şekil ARAÇI vuruşları iki nokta yaşar. Oturtulmuş serbest vuruş da
     kind='shape' taşır ama kalem basılıdır: kalkan (shape dalı) onu
     yakalarsa revert (yanlış-oturtma geri dönüşü) asla tetiklenmez. */
  if (stroke.kind === 'shape' && !ui.snapped) {
    const first = stroke.points[0];
    stroke.points = [
      first,
      inkApplyTilt({
        x: clamp(raw.x, 0, 1), y: clamp(raw.y, 0, 1),
        p: pressure, s: ui.speed,
      }, tilt),
    ];
    ui.previewDirty = true;
    inkEditorInvalidate();
    return;
  }

  // Yumuşatma: One-Euro filtresi (FAZ 2). Ham (kırpılmamış) konum üzerinden
  // çalışır ki tuval dışına çıkıp dönerken iz sıçramasın.
  const from = { x: ui.smoothX, y: ui.smoothY };
  let to = { x: raw.x, y: raw.y };
  if (ui.stab && typeof inkStabilizerApply === 'function') {
    const sm = inkStabilizerApply(ui.stab, raw.x, raw.y, pressure, now, inkState().smoothing);
    if (!sm.raw) to = { x: sm.x, y: sm.y };
    // Kalem basıncını da filtrele (fare simülasyonu açıkken çifte filtre yok).
    if (!ui.mouseSim && inkState().smoothing > 0.001) pressure = ui.stab.p;
  }
  ui.smoothX = to.x;
  ui.smoothY = to.y;
  // Finalize flush hedeflerini kaydet: son ham örnek, kullanılan basınç
  // ve eğim. Bırakma anında yumuşatıcı hedefte kalmışsa kalan parça
  // bunlardan pişirilir.
  ui.lastRaw = raw;
  ui.lastPressure = pressure;
  ui.lastTilt = tilt;

  // Oturtulmuş vuruş: kalem hareketi iki anlama gelebilir.
  //  · Belirgin hareket (≥ INK_SNAP_REVERT_PX) → Procreate tarzı CANLI
  //    şekil ayarı (Tur 4): kalem basılıyken şekil boylanır/küçülür —
  //    daire için en yakın kenar tutamağı (üst/alt → boy, sol/sağ → en),
  //    çizgi için serbest uç, öteki şekiller için merkezden ölçek.
  //    Eski revert-davranışı ("yanlış oturtma ham izine döner") kalktı:
  //    bırakınca şekil commit edilir; geri almak için undo var.
  if (ui.snapped) {
    const fp = ui.snapFirePt;
    const drift = fp ? Math.hypot(event.clientX - fp.x, event.clientY - fp.y) : 0;
    if (drift < INK_SNAP_REVERT_PX) return;
    inkEditorShapeAdjust(to);
    return;
  }

  inkEditorFeedSegment(from, to, pressure, tilt);
}

/** Vuruş oturtmaya uygun mu? Tüm çizim fırçalarının serbest vuruşları
    (silgi hariç — silginin şekle dönüşmesi istenmez). Her fırçada
    oturtma çalışır; şekil o vuruşun fırça özellikleriyle yazılır. */
function inkEditorSnapEligible() {
  const ui = inkEditorUi;
  const stroke = ui.stroke;
  if (!stroke || ui.snapped || stroke.kind !== 'stroke') return false;
  if (stroke.tool === 'eraser') return false;
  return !!inkState().shapeSnap;
}

/** Pointermove hattında zamanlayıcıyı yönetir (tahta yolu ile aynı sözleşme). */
function inkEditorSnapTrack(event) {
  const ui = inkEditorUi;
  /* Tur 4: Shift + çizgi = kullanıcı AÇIK düz çizgi istiyor. Oturtma
     bu niyetle yarışmamalı: duraksayan Shift çizgisinde oturtma tetiklenir,
     ≥8px harekette revert → ham iz → tekrar oturt... ("sapıtma").
     Shift basılıyken zamanlayıcı tamamen kapalı. */
  if (event.shiftKey) ui.shiftHeld = true;
  if (!inkEditorSnapEligible() || ui.shiftHeld) {
    if (ui.snapHold) { ui.snapHold.disarm(); ui.snapHold = null; }
    return;
  }
  if (!ui.snapHold) ui.snapHold = inkShapeSnapHoldCreate(inkEditorSnapFire);
  ui.snapHold.track(event.clientX, event.clientY);
}

/** Bekleme süresi doldu: vuruşu tanı, mükemmel şekle çevir ve önizlemeyi
    tam yeniden çiz. Ham izin dışarıda kalmaması için scratch tamamen
    katman kopyasına sıfırlanır (tam raster yolu zaten kutu bazlı).

    Tur 4i: bu işlev ARTIK yalnız hold zamanlayıcısından çağrılır —
    kalem kaldırıldığında (bırakış anında) oturtma YOK (Procreate
    modeli; boyama bırakışları şekle dönüşmez). */
function inkEditorSnapFire() {
  const ui = inkEditorUi;
  if (ui.snapHold) ui.snapHold.timer = null;
  /* Shift çizgi kilidiyle yarışma: Shift basılıyken tetiklenen bekleyici
     (tuş, hareketsizlik sırasında basıldıysa) oturtma yapmaz. */
  if (ui.shiftHeld) return;
  if (!inkEditorSnapEligible()) return;
  const layer = inkEditorTargetLayer();
  const it = getItem(ui.itemId);
  if (!layer || !it) return;
  /* Geri dönüş sigortası: ham izi oturtma ÖNCESİ sakla. Kalem
     basılıyken kullanıcı belirgin hareket ederse vuruş eski haline
     döner (inkEditorSnapRevert) — yanlış oturtma normal çizimi
     asla bozamaz. Çapa: zamanlayıcının son hareketsiz konumu. */
  const snapAnchor = ui.snapHold ? ui.snapHold.anchor : null;
  const rawPts = ui.stroke.points;
  const rawSkip = ui.previewSkip || 0;
  const rawDualPts = ui.dualCompPts || 0;
  if (!inkShapeSnapConvertStroke(ui.stroke, it.w || 1, it.h || 1)) {
    /* Tur 4e · smooth-on-null: tanıyıcı hiçbir şekle dönüşemedi ve
       kalem hâlâ basılı → ham izi yerinde pürüzsüzleştir ("sanki
       smooth eklenmiş gibi") ve serbest çizim normal yolla sürsün.
       Shift/uygunsuzluk erken dönüşleri smooth'a sokmaz. */
    if (inkEditorSmoothFreehandStroke(ui.stroke, it)) {
      const layerCanvas = ui.layerCanvas;
      if (layerCanvas) {
        const scratch = inkEditorEnsureScratch(layerCanvas);
        if (scratch) {
          const sctx = scratch.getContext('2d', { colorSpace: 'srgb' });
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.globalAlpha = 1;
          sctx.globalCompositeOperation = 'source-over';
          sctx.clearRect(0, 0, scratch.width, scratch.height);
          sctx.drawImage(layerCanvas, 0, 0);
        }
      }
      ui.previewDirty = true;
      inkEditorInvalidate();
    }
    return;
  }
  ui.snapSaved = { points: rawPts, skip: rawSkip, dualPts: rawDualPts };
  /* Tur 4 düzeltmesi: ayar çapası hold'un son ≥8px-aarm konumu DEĞİL,
     kalemin ateş anındaki gerçek konumu (lastClient) olmalı. Aksi hâlde
     çapa son <8px adımlar kadar geride kalır ve kullanıcının mikro
     titremesi 8px eşiğini aşar (şekil donuk kalmalı). */
  ui.snapFirePt = (ui.lastClient && Number.isFinite(ui.lastClient.x))
    ? { x: ui.lastClient.x, y: ui.lastClient.y }
    : (snapAnchor ? { x: snapAnchor.x, y: snapAnchor.y } : null);
  ui.snapped = true;
  const layerCanvas = inkEnsureItemCanvas(layer);
  if (layerCanvas) {
    const scratch = inkEditorEnsureScratch(layerCanvas);
    if (scratch) {
      const ctx = scratch.getContext('2d', { colorSpace: 'srgb' });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, scratch.width, scratch.height);
      ctx.drawImage(layerCanvas, 0, 0);
    }
  }
  ui.previewSkip = 0;
  /* FAZ 7.S: snap kancası vuruşu sıfırdan kurar (scratch tam kopya) —
     canlı rezervuar zincirleri ve basılı-dab sayacı eski nokta
     kümesine aitti, atılır. */
  if (ui.stroke) {
    delete ui.stroke.__smudgeRes;
    delete ui.stroke.__smudgeStamped;
  }
  // Tur 4b: scratch tam kopyaya sıfırlandı → şekil-iz kutusu geçersiz.
  ui.lastShapeRasterRect = null;
  /* Bayat chip'i düşür: vuruş artık kind='shape' → tam-raster yolu;
     oturtma ÖNCESİ karelerin dirty-kutu çipi sahne birleşimini eski
     bölgeye kilitler ve şekil kalem basılıyken görünmez. */
  ui.sceneChip = null;
  ui.previewDirty = true;
  inkEditorInvalidate();
}

/** Yanlış oturtma geri dönüşü: vuruş oturtma ÖNCESİ ham izine döner ve
    çizim normal yolla sürer. Dual birikim (dualWts) oturtma sırasında
    hiç yazılmadı; yalnızca önizleme sayaçları eski haline çekilir.
    Zamanlayıcı sonraki pointermove'da yeniden kurulur (snapTrack) —
    duraksamada tekrar oturtma denenir. */
function inkEditorSnapRevert() {
  const ui = inkEditorUi;
  const saved = ui.snapSaved;
  ui.snapSaved = null;
  ui.snapFirePt = null;
  ui.snapAdj = null;
  ui.snapped = false;
  const stroke = ui.stroke;
  if (!saved || !stroke) return;
  stroke.kind = 'stroke';
  stroke.shape = '';
  stroke.closed = false;
  delete stroke.snapFree;
  stroke.points = saved.points;
  ui.previewSkip = saved.skip;
  ui.dualCompPts = saved.dualPts;
  /* Scratch, oturtma döneminde şekil rasterı taşır (snapFire tam
     kopyaya sıfırladı). Artımlı non-dual yolda (kalem-bırakma-kalıcı
     sert fırçalar) devam eden dablar şekil artığına basılmasın:
     katman kopyasına geri sıfırla. */
  const layerCanvas = ui.layerCanvas;
  if (layerCanvas) {
    const scratch = inkEditorEnsureScratch(layerCanvas);
    if (scratch) {
      const sctx = scratch.getContext('2d', { colorSpace: 'srgb' });
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalAlpha = 1;
      sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.drawImage(layerCanvas, 0, 0);
    }
  }
  // Tur 4b: scratch tam kopyaya sıfırlandı → şekil-iz kutusu geçersiz.
  ui.lastShapeRasterRect = null;
  ui.sceneChip = null;
  ui.previewDirty = true;
  inkEditorInvalidate();
}

/* =========================================================
   Tur 4e/4j · smooth-on-null (serbest iz mükemmelleştirme)
   Oturtma tanıyıcı hiçbir şekle dönüşemediğinde ve kalem hâlâ
   basılıyken ham iz yerinde mükemmelleştirilir. Tur 4j: çekirdek
   30b inkShapeSnapFairPath'e taşındı (30 tahta portu ile parite):
   keskin köşeler rijit blok olarak dondurulur (Z asla S olmaz),
   yumuşak bölgeler Taubin λ/μ akıtmasıyla pürüzsüzleşir, açık izde
   yakın-düz span'ler akord üzerine dizilir (zikzak bacakları
   kusursuz düz), tepe/çukur/döngü yapısı korunur. İlk/son nokta
   bit-birebir çapa kalır → devam eden çizim zinciri kopmaz
   (ui.smoothX/smoothY dokunulmaz). br bayraklı (tuval kenarı)
   kopuk vuruşlar ve çok kısa/az noktalı izler mükemmelleştirilmez.
   Yalnızca oturtma hold yolundan çağrılır.
   ========================================================= */
function inkEditorSmoothFreehandStroke(stroke, it) {
  if (!stroke || stroke.kind !== 'stroke') return false;
  const ui = inkEditorUi;
  const dw = it && Number.isFinite(it.w) && it.w > 0 ? it.w : 1;
  const dh = it && Number.isFinite(it.h) && it.h > 0 ? it.h : 1;
  const arr = inkShapeSnapFairPath(stroke.points, dw, dh);
  if (!arr) return false;
  stroke.points = arr;
  /* Önizleme kanalları sıfır: birikimli dab/dual ağırlık eski noktalara
     aitti; tam yeniden çizim tüm dabları sıfırdan basar (inkStrokeRandom
     stroke.id anahtarlı → birebir raster). Bayat çip/iz kutuları geçersiz.
     Scratch, kancada katman kopyasına sıfırlanır (non-dual yolu için). */
  ui.previewSkip = 0;
  ui.dualCompPts = 0;
  ui.dualComp = null;
  ui.dualWts = null;
  ui.lastShapeRasterRect = null;
  ui.sceneChip = null;
  return true;
}

/* =========================================================
   Tur 4 · canlı şekil ayarı
   Kalem basılıyken oturtulan şekil kalemle boylanır/küçülür.
   Tur 4b: dairede eksen-bağımsız kenar-takip — sağa/sola en,
   yukarı/aşağı boy, çapraz ikisi birden; küçültme kenarı içeri çekerek.
   ========================================================= */

/** İlk ayar karesi: şekil parametrelerini ve tutamağı sınıflandır.
    Tüm ölçüler vuruşun yerel uzayındadır (bağlı katmanda 0..1). */
function inkEditorSnapAdjInit(stroke, q) {
  const pts = stroke.points;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let rw = (maxX - minX) / 2, rh = (maxY - minY) / 2;
  /* Tur 4d: yatay/dikey ÇİZGİ dejenere bbox taşır (rh==0 veya rw==0).
     Burada null dönmek snapRevert'i tetikliyor, vuruş ham izine
     döndürülüp Shift kilidiyle karışıyordu ("garip şekiller, farklı
     yönler"). Çizgi ayarı yalnızca İLK noktayı kullanır → bbox'ı
     kenetleyip kuruluma devam. Öteki şekillerde sıfır alan
     ayarlanamaz → eski savunmacı yol (null). */
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
    /* Tur 4b · eksen-bağımsız kenar-takip modeli: özgün kenarlar ve
       çapa saklanır; her eksen belirgin çekmede devreye girer (0.22·r0),
       0.12·r0 altında bırakır (tutuklama). Kenar tarafı: tutamak kenara
       yakınsa tutamak tarafı, değilse ilk devreye girişte hareket
       yönü — bir kez karar verilir, sonra latched. */
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
    orig: pts.map(p => ({ x: p.x, y: p.y, p: p.p })),
  };
}

/** Canlı şekil ayarı: her karede şekil noktaları yeniden üretilir ve
    önizleme kirletilir. Parametreler HER ZAMAN oturtma anındaki
    orijinalden türetilir (kare kare birikim/uyaran yok). */
function inkEditorShapeAdjust(q) {
  const ui = inkEditorUi;
  const stroke = ui.stroke;
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return;
  const adj = ui.snapAdj || (ui.snapAdj = inkEditorSnapAdjInit(stroke, q));
  if (!adj) { inkEditorSnapRevert(); return; } // savunmacı: kurulamazsa eski yol
  let newPts = null;
  if (adj.type === 'circle') {
    /* Tur 4d · AKICI + merkez-pivot küçültme:
       · Ölü bölge küçüldü: eksen ~0.03·r0 çekmede devreye girer,
         ~0.015·r0 altında bırakılır (eski 0.22/0.12 ikilisi kalem
         ~20px yol alana dek şekli donduruyordu — "takıla takıla").
         8px giriş kapısı (pointermove hattı) bilinçli ilk hamleyi
         korur; buradaki eşikler artık yalnız gürültü bandı.
       · KÜÇÜLME (tutulan kenarda dx karşı yönde): PİVOT MERKEZ —
         iki kenar da özgün merkeze simetrik çekilir (x1=ex1+dx,
         x0=ex0−dx): şekil YERİNDE küçülür, tutulan kenar kalemi
         birebir izler (kullanıcı: "ilk çizilen yuvarlağın tam
         ortasına doğru küçülmeli").
       · BÜYÜME (dx dışa): kenar-takip (karşı kenar sabit) — esnek
         elips çekme korunur. */
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
    if (!adj.eng.x && !adj.eng.y) return; // donuk: belirgin çekme yok
    let x0 = adj.ex0, x1 = adj.ex1, y0 = adj.ey0, y1 = adj.ey1;
    const minHalf = r0 * 0.2;
    if (adj.eng.x && adj.sx) {
      if (adj.sx > 0) {
        if (dx >= 0) {
          x1 = Math.max(adj.ex1 + dx, x0 + minHalf * 2); // büyüme: karşı kenar sabit
        } else {
          x1 = adj.ex1 + dx;                             // küçülme: merkez sabit
          x0 = adj.ex0 - dx;
          if (x1 - x0 < minHalf * 2) { x1 = adj.cx + minHalf; x0 = adj.cx - minHalf; }
        }
      } else {
        if (dx <= 0) {
          x0 = Math.min(adj.ex0 + dx, x1 - minHalf * 2); // büyüme (sola)
        } else {
          x0 = adj.ex0 + dx;                             // küçülme: merkez sabit
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
      newPts = adj.orig.map(p => ({
        x: adj.cx + (p.x - adj.cx) * f,
        y: adj.cy + (p.y - adj.cy) * f,
        p: p.p,
      }));
    }
  }
  if (newPts) {
    stroke.points = newPts;
    ui.previewDirty = true;
    inkEditorInvalidate();
  }
}

/** Ara örnekleme: düşük olay hızında bile damla zinciri kopmaz. */
function inkEditorAppendPoint(point) {
  const ui = inkEditorUi;
  const stroke = ui.stroke;
  if (!stroke) return;
  const points = stroke.points;
  const last = points[points.length - 1];
  const fit = ui.fit;
  const screenDist = Math.hypot((point.x - last.x) * fit.w, (point.y - last.y) * fit.h);
  if (!point.br && screenDist < 0.75) return;

  if (!point.br && !last.br && screenDist > 2 && ui.rawHistory.length >= 2) {
    const p0 = ui.rawHistory[ui.rawHistory.length - 2];
    const p1 = last;
    const p2 = point;
    // Catmull-Rom: son ham noktadan yeni noktaya, geri sıçramadan.
    // (Eski quadratic kod p0'dan başlıyordu; yumuşatma gecikmesi
    // yüzünden iz kısa bir geri dönüş çiziyordu.)
    // 24→8: uzun segmentlerde bile ~8 ara adım; eğri kalitesi pratikte
    // aynı (Catmull-Rom C1 sürekli), segment başına maliyet 3 kata kadar düşer.
    const p3 = point;
    const steps = Math.min(8, Math.max(1, Math.round(screenDist / 2)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const q = typeof inkCatmull === 'function'
        ? inkCatmull(p0, p1, p2, p3, t, fit.w, fit.h)
        : {
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
        };
      q.p = (Number.isFinite(p1.p) ? p1.p : 1) +
        ((Number.isFinite(p2.p) ? p2.p : 1) - (Number.isFinite(p1.p) ? p1.p : 1)) * t;
      q.s = (p1.s || 0) + ((p2.s || 0) - (p1.s || 0)) * t;
      if (p2.t !== undefined || p1.t !== undefined) {
        q.t = (p1.t || 0) + ((p2.t || 0) - (p1.t || 0)) * t;
        q.a = typeof inkLerpAngle === 'function'
          ? inkLerpAngle(p1.a || 0, p2.a || 0, t)
          : (p1.a || 0) + ((p2.a || 0) - (p1.a || 0)) * t;
      }
      points.push(q);
    }
  }

  points.push(point);
  // FAZ 2-5: sınır aşımında BAŞ nokta yutulmaz, simetrik seyrelt.
  // (points referansı korunur: stroke.points aynı dizi üzerine yazılır.)
  if (points.length > INK_MAX_STROKE_POINTS && typeof inkDecimateStrokePoints === 'function') {
    const dec = inkDecimateStrokePoints(points, INK_MAX_STROKE_POINTS);
    if (dec) {
      points.length = 0;
      for (const q of dec) points.push(q);
    }
  }
  ui.rawHistory.push(point);
  if (ui.rawHistory.length > 6) ui.rawHistory.shift();
  ui.previewDirty = true;
  inkEditorInvalidate();
}

/** 2B yedek için katman kopyası; yalnızca gerektiğinde oluşturulur. */
/** Ham örnek → kırpılmış segment → nokta ekleme kuyruğu.
    `inkEditorMoveSample` ve vuruş kapatma flush'u aynı yolu kullanır. */
function inkEditorFeedSegment(from, to, pressure, tilt) {
  const ui = inkEditorUi;
  const seg = inkClipUnitSegment(from, to);
  if (!seg) {
    // Tamamen tuval dışı: boya yok, izleme devam ediyor. Fırça halkası
    // yine de imleci izlemeli; yalnızca imleç tuvali tazelenir, sahne
    // yeniden çizilmez (dışarıda gezinirken kasma olmaz).
    ui.outside = true;
    inkEditorCursorInvalidate();
    return false;
  }
  const fromOutside = inkUnitOutside(from);
  const toOutside = inkUnitOutside(to);
  const at = t => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  const samples = [];
  if (fromOutside) {
    // Kenardan giriş: yeni parça tam sınırda başlar (arada çizgi çekilmez).
    samples.push({ ...at(seg.t0), br: true });
  }
  if (toOutside) {
    if (!fromOutside || seg.t1 > seg.t0 + 1e-9) samples.push(at(seg.t1));
  } else {
    samples.push(at(seg.t1));
  }

  for (const sample of samples) {
    const point = inkApplyTilt({
      x: clamp(sample.x, 0, 1),
      y: clamp(sample.y, 0, 1),
      p: pressure,
      s: ui.speed,
    }, tilt);
    if (sample.br) point.br = 1;
    inkEditorAppendPoint(point);
  }
  ui.outside = false;
  return true;
}

/** Vuruş bırakma anında yumuşatıcıyı hedefe yetiştir.
    Sentetik/çok hızlı olay dizilerinde (ve kısa vuruşlarda) One-Euro
    filtresi hedefte kalmış olabilir: ham son örnek pişirilmeden commit
    edilirse iz gerçek bırakma noktasının gerisinde kesilir.
    Yalnızca finalize (tam raster) kolidinde çağrılır: yakalama
    (rebuildPreview(true)) ve commit aynı idempotent flush'u görür —
    canlı önizleme ile pişen raster bit-paritesini korur. */
function inkEditorCatchUpStroke() {
  const ui = inkEditorUi;
  const stroke = ui.stroke;
  if (!stroke || stroke.kind === 'fill' || stroke.kind === 'shape') return;
  const raw = ui.lastRaw;
  if (!raw) return;
  const tilt = ui.lastTilt || null;
  let pressure = Number.isFinite(ui.lastPressure) ? ui.lastPressure : 1;
  const from = { x: ui.smoothX, y: ui.smoothY };
  // Stabilizatör artık örnek almayacak: kanalları ham hedefe kilitle.
  if (ui.stab) {
    ui.stab.x = raw.x;
    ui.stab.y = raw.y;
    ui.stab.p = pressure;
  }
  ui.smoothX = raw.x;
  ui.smoothY = raw.y;
  // Ham to'nun kelepçelenmediği çağrıyla aynısı: kenar kırpma ve br
  // bayrağı `inkEditorFeedSegment` içinde.
  if (!inkEditorFeedSegment(from, raw, pressure, tilt)) {
    // Bırakma tamamen tuval dışında: ek nokta yok (izleme zaten durdu).
  }
}

function inkEditorEnsureScratch(layerCanvas) {
  const ui = inkEditorUi;
  if (ui.scratch) return ui.scratch;
  const scratch = document.createElement('canvas');
  scratch.width = layerCanvas.width;
  scratch.height = layerCanvas.height;
  scratch.getContext('2d', { colorSpace: 'srgb' }).drawImage(layerCanvas, 0, 0);
  ui.scratch = scratch;
  return scratch;
}

/* K20b · dual agirlik tuvali: seffaf; dual damga agirliklari birikir. */
function inkEditorEnsureDual(layerCanvas) {
  const ui = inkEditorUi;
  if (ui.dualWts && ui.dualWts.width === layerCanvas.width &&
      ui.dualWts.height === layerCanvas.height) return ui.dualWts;
  const c = document.createElement('canvas');
  c.width = layerCanvas.width;
  c.height = layerCanvas.height;
  ui.dualWts = c;
  return c;
}

/** Görüntü/bake kompoziti: katman tabanı ⊕ (ağırlık × stroke.opacity).
    Tek geçişte opaklık: birikimdeki dual ağırlık zaten tam boyut; çarpan
    yalnızca burada bir kez uygulanır (K15/PS kuralı, byte-parite
    sözleşmesiyle aynı formül: preview == commit). */
function inkEditorDualComposite(layerCanvas, opacity) {
  const ui = inkEditorUi;
  const wts = ui.dualWts;
  if (!wts) return null;
  let comp = ui.dualComp;
  if (!comp || comp.width !== layerCanvas.width ||
      comp.height !== layerCanvas.height) {
    comp = document.createElement('canvas');
    comp.width = layerCanvas.width;
    comp.height = layerCanvas.height;
    ui.dualComp = comp;
  }
  const cctx = comp.getContext('2d', { colorSpace: 'srgb' });
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.globalAlpha = 1;
  cctx.globalCompositeOperation = 'source-over';
  cctx.clearRect(0, 0, comp.width, comp.height);
  cctx.drawImage(layerCanvas, 0, 0);
  cctx.globalAlpha = clamp(opacity, 0, 1);
  cctx.drawImage(wts, 0, 0);
  cctx.globalAlpha = 1;
  return comp;
}

/* M2 · dirty-rect kompozit yardımcıları -------------------------------
   Dual yolun kompoziti eskiden her çağrıda TÜM katmanı clear+drawImage
   ile yeniden birleştiriyordu (2K tuvalde ~2×14MB kopya / vuruş-parçası).
   Aşağıdaki ikisi yalnızca vuruşun dokunduğu bölgeyi yeniden birleşir;
   bölge dışı comp içeriği Prior вызовlardan korunur. Byte-parite:
   comp(R) = base(R) ⊕ wts(R)·op tam yeniden birleşimle PİKSEL aynıdır
   (aynı kaynak aynı bölge; drawImage 1:1). wts dual damlaların tek
   birikimidir; kutu dışı wts içeriği yoktur. */

/** Verilen nokta diliminden (yalnızca fromLen sonrası — yeni işlenen)
    px dikdörtgeni; pad kuralları inkEditorFullRasterRect ile aynı. */
function inkEditorDeltaRectFromPoints(pts, fromLen, stroke, layerCanvas, sizePx) {
  if (!pts || pts.length <= fromLen) return null;
  const W = Math.max(1, layerCanvas.width);
  const H = Math.max(1, layerCanvas.height);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = fromLen; i < pts.length; i++) {
    const p = pts[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const x = p.x * W, y = p.y * H;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  let pad = (sizePx / 2) * (1 + Math.max(0, stroke.scatter || 0)) + 2;
  const brush = typeof inkGetBrush === 'function' ? inkGetBrush(stroke.brushId) : null;
  if (brush) {
    const sc = Math.max(Number(brush.scatterX) || 0, Number(brush.scatterY) || 0);
    if (sc > 0) pad = Math.max(pad, (sizePx / 2) * (1 + sc) + 2);
    if (brush.dual) {
      const scale = clamp(Number.isFinite(brush.dual.scale) ? brush.dual.scale : 1, 0.1, 4);
      const dsc = Math.max(0, Number(brush.dual.scatter) || 0);
      pad = Math.max(pad, (sizePx / 2) * (2 + dsc) * scale + 2);
    }
  }
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const w = Math.min(W, Math.ceil(maxX + pad)) - x;
  const h = Math.min(H, Math.ceil(maxY + pad)) - y;
  return (w <= 0 || h <= 0) ? null : { x, y, w, h };
}

/** Bölgesel kompozit: region null → yalnızca mevcut comp döndür (yeniden
    birleşim yok); comp yoksa/boyutu değiştiyse tam kurulum. */
function inkEditorDualCompositeRect(layerCanvas, opacity, region) {
  const ui = inkEditorUi;
  const wts = ui.dualWts;
  if (!wts) return null;
  let comp = ui.dualComp;
  if (!comp || comp.width !== layerCanvas.width ||
      comp.height !== layerCanvas.height) {
    comp = document.createElement('canvas');
    comp.width = layerCanvas.width;
    comp.height = layerCanvas.height;
    ui.dualComp = comp;
    region = { x: 0, y: 0, w: Math.max(1, layerCanvas.width),
      h: Math.max(1, layerCanvas.height) };
  }
  if (!region) return comp;
  /* Tanı: son kompozit bölgeleri (parite derinliği için probe alanı). */
  (ui.compRegionLog = ui.compRegionLog || []).push({
    x: region.x, y: region.y, w: region.w, h: region.h,
    t: Math.round(performance.now()),
  });
  if (ui.compRegionLog.length > 16) ui.compRegionLog.shift();
  const cctx = comp.getContext('2d', { colorSpace: 'srgb' });
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.globalAlpha = 1;
  cctx.globalCompositeOperation = 'source-over';
  cctx.clearRect(region.x, region.y, region.w, region.h);
  cctx.drawImage(layerCanvas, region.x, region.y, region.w, region.h,
    region.x, region.y, region.w, region.h);
  cctx.globalAlpha = clamp(opacity, 0, 1);
  cctx.drawImage(wts, region.x, region.y, region.w, region.h,
    region.x, region.y, region.w, region.h);
  cctx.globalAlpha = 1;
  return comp;
}

/* =========================================================
   canlı vuruş · tahtadaki öğe üzerinde
   ---------------------------------------------------------
   Referans paneli tahtanın gerçek #stage kopyasını gösterir. Kalıcı
   katman tuvali yalnızca pointerup'ta güncellendiği için vuruş sürerken
   minyatür donuk kalıyordu. Burada önizleme tuvali (katman + geçerli
   vuruş) öğenin içine geçici bir katman olarak basılır; böylece pano
   minyatürü çizerken de canlı kalır. Vuruş bitince geçici katman
   kaldırılır ve vuruş kalıcı tuvale pişer.
   ========================================================= */

/** Geçerli vuruşun katman + vuruş birleşimini taşıyan önizleme tuvali. */
function inkEditorLiveSource() {
  const ui = inkEditorUi;
  if (!ui.stroke) return null;
  return ui.previewCanvas || ui.scratch || null;
}

function inkEditorLiveLayerCanvas(layer) {
  return layer ? (inkRuntime.itemCanvases.get(layer.id) || null) : null;
}

function inkEditorLiveOverlayEnd() {
  const ui = inkEditorUi;
  if (ui.liveCanvas) {
    ui.liveCanvas.remove();
    ui.liveCanvas = null;
  }
  // Vuruş sırasında gizlenen kalıcı katman tuvallerini geri aç.
  for (const canvas of inkRuntime.itemCanvases.values()) {
    if (canvas.style.visibility) canvas.style.visibility = '';
  }
}

function inkEditorLiveOverlaySync() {
  const ui = inkEditorUi;
  const src = inkEditorLiveSource();
  const layer = inkLayerById(ui.layerId);
  const it = getItem(ui.itemId);
  const el = it ? elMap.get(it.id) : null;
  if (!src || !layer || !el || !src.width || !src.height) {
    inkEditorLiveOverlayEnd();
    return;
  }
  // GPU önizlemesi yalnızca görünür parçayı taşır; minyatür için katmanın
  // tamamı gerekir. Bu durumda geçici katman basılmaz: pano son pişen
  // kareyi gösterir (kalıcı tuval gizlenmez).
  if (ui.previewGl && !inkEditorPreviewCoversFit(ui.previewRect, ui.fit)) {
    inkEditorLiveOverlayEnd();
    return;
  }

  let canvas = ui.liveCanvas;
  if (!canvas || !canvas.isConnected || canvas.parentNode !== el) {
    canvas = document.createElement('canvas');
    canvas.className = 'inkLayerCanvas inkLivePreview';
    canvas.setAttribute('aria-hidden', 'true');
    const layerCanvas = inkEditorLiveLayerCanvas(layer);
    if (layerCanvas && layerCanvas.parentNode === el) {
      el.insertBefore(canvas, layerCanvas.nextSibling);
    } else {
      const handles = el.querySelector(':scope > .handles');
      if (handles) el.insertBefore(canvas, handles);
      else el.appendChild(canvas);
    }
    ui.liveCanvas = canvas;
  }

  // Minyatür için yeterli çözünürlük; tam katman kopyası her karede
  // yapılmasın diye uzun kenar 1024 pikselde sınırlanır.
  const maxSide = 1024;
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const cw = Math.max(1, Math.round(src.width * k));
  const ch = Math.max(1, Math.round(src.height * k));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(src, 0, 0, cw, ch);

  const layerCanvas = inkEditorLiveLayerCanvas(layer);
  canvas.style.zIndex = layerCanvas ? layerCanvas.style.zIndex : '2';
  canvas.style.opacity = layer.visible ? String(layer.opacity) : '0';
  canvas.style.mixBlendMode = layer.blend === 'normal' ? 'normal' : layer.blend;
  canvas.style.display = layer.visible && layer.opacity > 0.001 ? 'block' : 'none';
  canvas.style.visibility = 'visible';
  // Önizleme katmanın kopyasını da taşıdığı için kalıcı tuvali gizle;
  // aksi halde yarı saydam katmanlarda iki kez birleşip koyulaşırdı.
  if (layerCanvas) layerCanvas.style.visibility = 'hidden';
}

/** GPU önizlemesinin kaplayacağı kutu: görselin ekranda görünen parçası.
    Görsel kutusunun tamamı ekrandan büyük olabilir (yüksek yakınlaştırma);
    önizlemeyi o boyutta ayırmak dev bir tuval istiyordu. Görünür kutu ile
    önizleme ekran çözünürlüğünde kalır. */
function inkEditorPreviewView(fit) {
  const ui = inkEditorUi;
  if (!fit || !(fit.w > 0.5) || !(fit.h > 0.5)) return null;
  const dpr = ui.dpr || 1;
  const vw = Math.max(1, ui.canvas.width / dpr);
  const vh = Math.max(1, ui.canvas.height / dpr);
  const x0 = Math.max(0, Math.min(vw, fit.x));
  const y0 = Math.max(0, Math.min(vh, fit.y));
  const x1 = Math.max(0, Math.min(vw, fit.x + fit.w));
  const y1 = Math.max(0, Math.min(vh, fit.y + fit.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 1) || !(h > 1)) return null;
  return { x: x0, y: y0, w, h, fx: fit.x, fy: fit.y, fw: fit.w, fh: fit.h };
}

/** Önizleme kutunun tamamını mı kaplıyor (minyatür canlı basılabilir mi)? */
function inkEditorPreviewCoversFit(rect, fit) {
  if (!rect || !fit) return false;
  const near = (a, b) => Math.abs(a - b) < 0.5;
  return near(rect.x, fit.x) && near(rect.y, fit.y) &&
    near(rect.w, fit.w) && near(rect.h, fit.h);
}

/**
 * Tam raster yolunun kirli kutusu (FAZ4-4). Eski yol her karede tüm
 * katmanı kopyalıyordu (O(katman)); artık yalnızca vuruşun dokunduğu
 * bölge katmandan yeniden birleşir. Kutu dışı scratch içeriği
 * inkEditorEnsureScratch'in katman kopyasıdır (vuruş sırasında kalıcı
 * katman değişmez) → çıktı tam kopyayla bit-birebir kalır.
 * Kutu, damla erişim üst sınırını kapsar: saçılma (fırça+vuruş),
 * dual kickoff (dr·(2+sc), 28:1147–1190), şekil geniş çizgisi/ok başı
 * ve smudge kendi kutusu (radiusMax + 2) — 35 raster planı pad'iyle
 * aynı sömantiği.
 * @returns {{x,y,w,h}|null} taşan boş kutu null.
 */
function inkEditorFullRasterRect(stroke, layerCanvas, sizePx) {
  if (!stroke || !layerCanvas) return null;
  // 28 dahili normalize birebir (Math.max(1, sizePx || 1)): kutu asla
  // smudge/damla iç kutusundan küçük kalmasın.
  sizePx = Math.max(1, sizePx || 1);
  const W = Math.max(1, layerCanvas.width);
  const H = Math.max(1, layerCanvas.height);
  // Boya kovası: hedef bölge tüm tuvale yayılabilir; getImageData
  // taraması da tüm tuvali okur → tam kutu.
  if (stroke.kind === 'fill' || stroke.kind === 'gradient') {
    return { x: 0, y: 0, w: W, h: H };
  }
  const ptsBase = stroke.points;
  if (!ptsBase || !ptsBase.length) return null;
  /* FAZ 6 madde 11: simetri kanalı — klonların NOKTALARINI da union et;
     ayna/radial örnekleri kutu dışında kalmasın (radial tuval kenarına
     taşabilir; previewRect tam kapsamı için şart). pointScale: tuval
     piksel ölçeği (28 inkSymRadialPoints sözleşmesi). */
  const symOn = stroke.sym && stroke.sym !== 'off';
  let pts = ptsBase;
  if (symOn && typeof inkSymmetryAllPoints === 'function') {
    try {
      pts = inkSymmetryAllPoints(stroke, { pointScale: { x: W, y: H } }) || ptsBase;
    } catch { /* sessiz — kimlikle devam */ }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const x = p.x * W, y = p.y * H;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  let pad = (sizePx / 2) * (1 + Math.max(0, stroke.scatter || 0)) + 2;
  if (stroke.kind === 'smudge') {
    // 28:508–511 ile aynı kutu — bölge == senkron smudge kutusu.
    pad = sizePx / 2 + 2;
  } else if (stroke.kind === 'shape' && !stroke.snapFree) {
    // highlight lineWidth max(6, sizePx·2.2), ok başı max(9, lw·4.2).
    pad = sizePx * 1.5 + 12;
  } else {
    const brush = typeof inkGetBrush === 'function'
      ? inkGetBrush(stroke.brushId) : null;
    if (brush) {
      const sc = Math.max(
        Number(brush.scatterX) || 0, Number(brush.scatterY) || 0);
      if (sc > 0) pad = Math.max(pad, (sizePx / 2) * (1 + sc) + 2);
      if (brush.dual) {
        const scale = clamp(Number.isFinite(brush.dual.scale)
          ? brush.dual.scale : 1, 0.1, 4);
        const dsc = Math.max(0, Number(brush.dual.scatter) || 0);
        pad = Math.max(pad, (sizePx / 2) * (2 + dsc) * scale + 2);
      }
    }
  }
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const w = Math.min(W, Math.ceil(maxX + pad)) - x;
  const h = Math.min(H, Math.ceil(maxY + pad)) - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * Canlı vuruş önizlemesi.
 *
 * Eski yol her karede tüm vuruşu baştan çiziyordu (O(vuruş) kare başına,
 * üstünde tam katman kopyası). Yeni yol artımlıdır: damlalar bir kez
 * çizilir, sonraki karelerde yalnızca eklenenler işlenir.
 *
 *   - GPU: katman bir kez dokuya yüklenir, damlalar FBO'da birikir.
 *   - 2B : kalıcı tuval üzerine yalnızca yeni damlalar (tam parite).
 *   - Yol/şekil vuruşları (tek quadratic yol) eskisi gibi tam çizilir;
 *     zaten tek geçişte ucuz.
 *   - Tam raster yolu (FAZ4-4): finalize/smudge/gradyan/kova/şekil
 *     birleşiminde katman tamammıyla değil kirli kutuyla kopyalanır.
 */
function inkEditorRebuildPreview(finalize = false) {
  const ui = inkEditorUi;
  const stroke = ui.stroke;
  const layerCanvas = ui.layerCanvas;
  if (!stroke || !layerCanvas) {
    ui.previewDirty = false;
    return null;
  }
  const srcW = Math.max(1, layerCanvas.width);
  const srcH = Math.max(1, layerCanvas.height);
  const sizePx = Math.max(0.5, stroke.size * srcW);
  const baseOpts = {
    mapPoint: p => ({ x: p.x * srcW, y: p.y * srcH }),
    sizePx,
    pointScale: { x: srcW, y: srcH },
  };
  if (ui.previewGl && typeof inkDabGlRelease === 'function') inkDabGlRelease();
  ui.previewGl = false;
  ui.previewRect = null;

  /* K20-K20b · canli == commit (referans modeli). Dual-uygun vuruslarda
     dablar dual agirlikla (n-root seyreltme yok) SEFFAF agirlik
     tuvaline (dualWts) yazilir; katman tabanina dokunulmaz. Görüntü ve
     finalize bake = taban ⊕ (ağırlık × opaklık), opaklık tek geçişte.
     Dual-uygun olmayan turler (shape/fill/smudge/
     gradient, eraser, lockAlpha, pathEligible) eski tam-raster izini
     korur: finalize'da vurus bastan cizilir (kendi icinde tutarli). */
  const dualCapable = (!stroke.kind || stroke.kind === 'stroke') &&
    stroke.tool !== 'eraser' && !stroke.lockAlpha &&
    !(typeof inkStrokePathEligible === 'function' &&
      inkStrokePathEligible(stroke, inkGetBrush(stroke.brushId), sizePx));
  let scratch, ctx;
  if (dualCapable) {
    /* K20b · birikim SEFFAF agirlik tuvalinde (dualWts): katman kopyasi
       DEGIL. Kompozit onizleme = taban ⊕ (agirlik x stroke.opacity);
       commit bake ayni kompozitten gelir. Boylece her commit'te katman
       icerigi opaklikla carpilmaz (onceki cizgiler sizmez) ve canli
       gorunum ile commit piksel esit kalir (referans uygulama: canli = device). */
    const wts = inkEditorEnsureDual(layerCanvas);
    const wctx = wts.getContext('2d', { colorSpace: 'srgb' });
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    if (finalize) {
      // Finalize flush: yumusaticiyi birakma noktasina yetistir.
      // Idempotent: ikinci cagrida hedef-zaten-yakalanmis, ek nokta yok.
      inkEditorCatchUpStroke();
    }
    // skipDabs: birikimli agirlik tuvali Onceki indeksleri tasir;
    // her cagri yalniz yeni dab indekslerini yazar. Bitiste kalan
    // kuyruk dablar ayni birikime eklenir (VURUS BASTAN CIZILMEZ,
    // CIFT AGIRLIK YOK). Ikinci finalize (testler/sweep) toplam
    // sayaci gorme yuzunden tum birikimi atlar, ayni kompoziti uretir.
    /* M5 → FAZ 7.Q: simetri yolu ARTIK artımlıdır. Klon dab indeks
       hizası sağlamdır (28-ink-brush FAZ 7.Q notu: ayna/dönüş mesafe
       korur → yürüyüş indeksleri kök==klon; inkStrokeRandom stroke.id
       anahtarlı → birebir). Artık wts sıfırlanmaz, skipDabs her çağrıda
       yalnız yeni dab indekslerini basar; finalize kalan kuyruğu aynı
       birikime ekler. Birikim tam geçişle piksel eşidir. */
    const symOn = stroke.sym && stroke.sym !== 'off';
    const callOpts = Object.assign({}, baseOpts, {
      stableOnly: !finalize,
      skipDabs: ui.previewSkip || 0,
      dualDirect: true,
    });
    let processedDabs = 0;
    try {
      processedDabs = inkDrawStrokeOnContext(wctx, stroke, callOpts) || 0;
    } finally {
      wctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ui.previewSkip = processedDabs;

    /* M2 · dirty-rect kompozit: region = sonrakezeden beri eklenen
       noktaların kutusu (+pad). Simetri klonları vuruş kapsamını
       nokta-listesinin dışına genişletebilir → sym açıkken tam kutu
       (inkEditorFullRasterRect klon noktalarını da union eder) kullanılır;
       sym==off'ta (yaygın yol) yalnızca delta kutu yeniden birleşir.
       M2b · cephe kayması düzeltmesi: stableOnly yolunda dab yürüyüşü
       son 2 segmenti İŞLEMEZ (28:312 segmentLimit=len-2) — yani çağrı N
       yeni bastığı dablar, nokta listesinin SONUNUN 2 gerisindeki
       segmentlerdedir. Bölgeyi düz "son eklenen noktalar"dan açarsak
       o dablar kutunun dışında kalır ve kompozitte pigment eksilir
       (vuruş-ortası byte-paritesi diff>0, probe ile kanıtlandı).
       Çözüm: bölge başlangıcını 3 nokta geriden açmak — pencere
       aşımı idempotent (aynı bölge tekrar kompozit edilir, base ⊕
       wts·op aynı sonucu verir). Konum düzeltilmiş kutu yine
       tam-kutu ya da tüm tuvalden çok daha küçük kalır. */
    let region;
    if (stroke.sym && stroke.sym !== 'off') {
      region = inkEditorFullRasterRect(stroke, layerCanvas, sizePx);
      ui.dualCompPts = stroke.points.length;
    } else {
      region = inkEditorDeltaRectFromPoints(stroke.points,
        Math.max(0, ui.dualCompPts - 3), stroke, layerCanvas, sizePx);
      ui.dualCompPts = stroke.points.length;
    }
    const prev = inkEditorDualCompositeRect(layerCanvas, stroke.opacity, region);
    /** M7 · sahne dirty-rect: 2D artımlı dalda, değişen piksel kutusu
        (katman px). Sahne render'ı, tam yeniden çizim yerine bu kutunun
        ekran karşılığını yeniden birleştirir. sym/rot/gpu/şekil yolları
        chip üretmez → sahne eski tam yolu kullanır. Finalize'da vuruş
        biter, sahne tam kare ile çoğunlukta ilk tam render gelir. */
    ui.sceneChip = (stroke.sym && stroke.sym !== 'off') ? null : region;
    ui.previewCanvas = prev;
    if (finalize) {
      // K20b bake: kompozit zaten stroke.opacity tasir; commit clear +
      // drawImage ile aynen katmana gecer (baski == gorunen raster).
      ui.previewDirty = false;
      return prev;
    }
    ui.previewRect = null;
    ui.previewDirty = false;
    return prev;
  }

  // --- dual-uygun olmayan turler: eski iz (K15/K16 davranisi korunur) ---
  scratch = inkEditorEnsureScratch(layerCanvas);
  ctx = scratch.getContext('2d', { colorSpace: 'srgb' });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  /* FAZ 7.R · canlı artımlı smudge: smudge CANLI'da tam raster
     YENİDEN ÇİZİM yapmaz — scratch birikimli smudge raster'ını taşır
     (EnsureScratch vuruş başında bir kez taban kopyalar), her kare
     yalnız YENİ dablar basar (skipDabs birikimli). Vuruş uzadıkça
     kuadratik kasma olmaz. */
  const smudgeRaster = stroke.kind === 'smudge';
  const smudgeInc = !finalize && smudgeRaster;
  /* FAZ 7.S · smudge finalize artık tam yeniden çizim DEĞİL: canlı
     karelerde biriken scratch, rezervuar kalıcılığı sayesinde kanonik
     sonucun ta kendisidir. Taban kopyası bozulmadan yalnız yakalanamayan
     kuyruk dabları (catch-up sonrası yeni dablar) basılır. Bu aynı anda
     bırakıştaki 1-2 sn'lik donmayı da kaldırır: tüm vuruş kutusu için
     getImageData + dab başına tam yürüyüş yapılmaz. */
  const fullRaster = finalize
    ? !smudgeRaster
    : (smudgeRaster ? false : ['shape', 'fill', 'gradient'].includes(stroke.kind));
  if (fullRaster || finalize) {
    // Finalize flush: yumusatici hedefe yetisememis olabilir (hizli
    // sentetik diziler, kisa vurus). Idempotent: ikinci cagrida
    // hedef-zaten-yakalanmis, ek nokta yok. (FAZ 7.S: smudge finalize
    // için de çalışır — kuyruk dabları skipDabs=previewSkip ile basılır.)
    inkEditorCatchUpStroke();
  }
  if (fullRaster) {
    // FAZ4-4: tam katman kopyasi yerine kirli kutu yeniden birlesimi.
    // Kutu disi scratch icerigi katman kopyasidir, parite korunur.
    /* Tur 4b · iz/ghost düzeltmesi: canlı şekil ayarı her karede şekli
       YENİDEN türetir; kutu yalnızca GÜNCEL karenin şeklini kapsar.
       Önceki karenin şekil pikselleri kutu dışında kalırsa scratch'te
       kalır → kayan dairede üst üste bantlar, çizgide kesikli izler.
       Çözüm: önceki karenin kutusuyla BİRLEŞİK kutuyu temizle + tabanı
       kopyala; iki karenin şekli de garanti dışarıda kalmaz. */
    const prevRect = ui.lastShapeRasterRect;
    let rect = inkEditorFullRasterRect(stroke, layerCanvas, sizePx);
    if (prevRect && rect) {
      const ux = Math.max(0, Math.min(rect.x, prevRect.x));
      const uy = Math.max(0, Math.min(rect.y, prevRect.y));
      const ux1 = Math.min(srcW, Math.max(rect.x + rect.w, prevRect.x + prevRect.w));
      const uy1 = Math.min(srcH, Math.max(rect.y + rect.h, prevRect.y + prevRect.h));
      rect = (ux1 > ux && uy1 > uy)
        ? { x: ux, y: uy, w: ux1 - ux, h: uy1 - uy }
        : null;
    } else if (prevRect && !rect) {
      rect = prevRect;
    }
    ui.lastShapeRasterRect = rect;
    if (rect) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.drawImage(layerCanvas, rect.x, rect.y, rect.w, rect.h,
        rect.x, rect.y, rect.w, rect.h);
    }
  }
  const drawTarget = (fullRaster || smudgeRaster) ? ctx : inkDabSink2d(ctx);
  let processedDabs = 0;
  try {
    processedDabs = inkDrawStrokeOnContext(drawTarget, stroke, Object.assign({}, baseOpts, {
      stableOnly: !fullRaster,
      /* FAZ 7.S: smudge skipDabs previewSkip'ten DEĞİL __smudgeStamped'tan
         okur. Finalize previewSkip'i sıfırlar (dual yolu sözleşmesi) ama
         basılmış-dab sayacı sıfırlanmaz: vuruş ortasında manual
         finalize + ardından commit dizisinde ikinci finalize çift
         damga basmaz (test sözleşmesi: önizleme == commit, birebir). */
      skipDabs: fullRaster ? 0 : (smudgeRaster ? (stroke.__smudgeStamped || 0) : (ui.previewSkip || 0)),
      /* FAZ 7.S: canlı smudge kareleri + finalize kuyruğu zincir
         kalıcılığını kullanır (ilk kare skipDabs=0 olsa da). */
      smudgeLiveChain: smudgeRaster && !fullRaster,
    })) || 0;
  } finally {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (smudgeRaster && !fullRaster) {
    /* FAZ 7.S: scratch'e basılı dab sayısı — finalize'idempotentliği
       bunun üzerinden kurulur (commit/mask/snap yollarında atılır). */
    stroke.__smudgeStamped = processedDabs;
  }
  if (finalize) { ui.previewSkip = 0; }
  else { ui.previewSkip = processedDabs; }
  ui.previewCanvas = scratch;
  /* Şekil oturtma · canlı gösterim: vuruş oturtma anında kind='shape'
     olur ve dual yolundan bu non-dual yola geçer; dual yolun önceki
     karelerinde kalan bayat sceneChip burada temizlenmezse sahne yalnız
     o eski kirli kutuyu yeniden birleştirir ve yeni şekil ekranda
     ÇİZİLMEZ (kalem bırakılınca commit tam kare çizince görünür).
     non-dual yol chip üretmez → bayat çipi düşür, sahne tam yolu kullansın. */
  ui.sceneChip = null;
  ui.previewRect = null;
  ui.previewDirty = false;
  return scratch;
}
function inkEditorPointerUp(event) {
  const ui = inkEditorUi;
  if (!ui.open) return;
  if (ui.panning) {
    event.preventDefault();
    event.stopPropagation();
    inkEditorPanEnd(event);
    return;
  }
  /* A11: döndürme bırakımı — <4px sürükleme "single click" demektir: PS araç
     çift-tık sıfırlama kalıbı (Reset View). Sürükleme sayıldıysa açı
     kalıcıdır; R bırakılana dek rotMode sürer (araç-atlama yok). */
  if (ui.rotDrag) {
    event.preventDefault();
    event.stopPropagation();
    const drag = ui.rotDrag;
    ui.rotDrag = null;
    ui.baseWide = false;
    ui.pointerId = null;
    try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
    if (!drag.moved) {
      inkEditorResetRot();
    } else {
      /* Commit: sürükleme kareleri zaten render'daydı; geniş base
         daralır (rest rot kutusu), içerik rotasyonu render'da kalır. */
      inkEditorApplyRot();
    }
    inkEditorSyncCursorStyle();
    inkEditorRotHud(false);
    return;
  }
  if (ui.sampling) {
    ui.sampling = false;
    ui.pointerId = null;
    try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
    inkPenEraserRestore();
    return;
  }
  if (ui.marquee || ui.lasso || ui.gizmoDrag) {
    event.preventDefault();
    event.stopPropagation();
    if (ui.marquee) inkEditorFinishMarquee();
    else if (ui.lasso) inkEditorFinishLasso();
    else inkEditorFinishGizmoDrag();
    ui.pointerId = null;
    try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
    return;
  }
  if (ui.pendingStroke) {
    // Tuval dışında başlayıp içeri girmeden bırakıldı: vuruş oluşmaz.
    event.preventDefault();
    event.stopPropagation();
    ui.pendingStroke = null;
    ui.pointerId = null;
    try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
    inkEditorCursorInvalidate();
    inkPenEraserRestore();
    return;
  }
  if (!ui.stroke) return;
  event.preventDefault();
  event.stopPropagation();
  // Zamanlayıcı vuruşla kapanır: kalem kaldırıldıysa bekleyici oturtmaz.
  if (ui.snapHold) { ui.snapHold.disarm(); ui.snapHold = null; }
  /* Tur 4i · bırakış-anı oturtması KALDIRILDI (Procreate modeli):
     kalemi beklemeden bırakmak ASLA oturtmaz — boyama/karalama/çizgi
     bırakışları ham iz olarak commit edilir. Kalkış-oturtması (Tur 4h)
     boyama bırakışlarını daireye çeviriyordu (kullanıcı: "yuvarlağa
     dönüşüyor"); oturtma yalnız bilinçli beklemede (hold) ateşler. */
  ui.snapSaved = null;
  ui.snapFirePt = null;
  ui.snapAdj = null;
  // Yumuşatıcı flush'u commit'teki inkEditorRebuildPreview(true) kolunda
  // finalize dalında yapılır: yakalama ile pişen raster bit-paritesi korunur.
  inkEditorCommitStroke();
  ui.pointerId = null;
  try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
  // Katman tuvali değişti: önizleme önbelleği ve görünüm tazelenmeli.
  inkEditorInvalidate();
  /* Kalem arkası silgi: vuruş bitti, önceki araca dön. */
  inkPenEraserRestore();
}

function inkEditorPointerCancel(event) {
  const ui = inkEditorUi;
  if (ui.rotDrag) {
    ui.rotDrag = null;
    ui.pointerId = null;
    inkEditorApplyRot();
    inkEditorSyncCursorStyle();
    inkEditorRotHud(false);
    return;
  }
  if (inkEditorPanEnd(event)) return;
  if (inkEditorUi.marquee || inkEditorUi.lasso || inkEditorUi.gizmoDrag) {
    inkEditorCancelSelection();
    return;
  }
  inkEditorDropStroke();
}

function inkEditorDropStroke() {
  const ui = inkEditorUi;
  if (ui.snapHold) { ui.snapHold.disarm(); ui.snapHold = null; }
  ui.snapped = false;
  ui.snapSaved = null;
  ui.snapFirePt = null;
  ui.snapAdj = null;
  if (ui.previewGl && typeof inkDabGlRelease === 'function') inkDabGlRelease();
  ui.previewGl = false;
  ui.previewCanvas = null;
  ui.previewRect = null;
  ui.previewSkip = 0;
  ui.dualWts = null;
  ui.dualComp = null;
  ui.dualCompPts = 0;
  /* FAZ 7.S: atılan vuruşun smudge canlı alanları da gider. */
  if (ui.stroke) {
    delete ui.stroke.__smudgeRes;
    delete ui.stroke.__smudgeStamped;
  }
  ui.stroke = null;
  ui.scratch = null;
  ui.lastShapeRasterRect = null;
  ui.layerCanvas = null;
  ui.previewDirty = false;
  ui.sampling = false;
  ui.pendingStroke = null;
  ui.rawHistory = [];
  ui.lastRaw = null;
  ui.lastPressure = null;
  ui.lastTilt = null;
  ui.pointerId = null;
  inkEditorLiveOverlayEnd();
  inkEditorInvalidate();
  /* Kalem arkası silgi: vuruş iptal edildi, önceki araca dön. */
  inkPenEraserRestore();
}

function inkEditorCommitStroke() {
  const ui = inkEditorUi;
  const stroke = ui.stroke;
  const layer = inkLayerById(ui.layerId);
  // Savunmacı: zamanlayıcı pointerup'ta kapanır; burada da garanti et.
  if (ui.snapHold) { ui.snapHold.disarm(); ui.snapHold = null; }
  ui.snapSaved = null;
  ui.snapFirePt = null;
  ui.snapAdj = null;
  const layerCanvas = ui.layerCanvas;
  if (ui.previewGl && typeof inkDabGlRelease === 'function') inkDabGlRelease();
  ui.previewGl = false;
  ui.previewCanvas = null;
  ui.previewRect = null;
  /* K20: previewSkip burada sıfırlanmaz — finalize bake, sürükleme
     boyunca birikmiş dab indekslerinin üzerine YALNIZCA kuyruğu ekler
     (skipDabs = birikim). Sıfırlamak prefix ağırlıklarını çift uygular. */
  if (!stroke || !layer || !layerCanvas) {
    inkEditorDropStroke();
    return;
  }

  // FAZ 1B (Layer Mask): maske düzenleme hedefi bu katmansa vuruş katmana
  // değil maskenin tuvaline işler (layer.strokes'a GİRMEZ).
  if (layer.kind === 'attached' && layer.mask &&
      inkState().maskEditId === layer.id) {
    if (ui.previewGl && typeof inkDabGlRelease === 'function') inkDabGlRelease();
    ui.previewCanvas = null;
    ui.previewRect = null;
    ui.previewSkip = 0;
    if (typeof inkMaskCommitStrokeFor === 'function') {
      inkMaskCommitStrokeFor(layer, stroke);
    }
    /* FAZ 7.S: canlı rezervuar zincirleri + dab sayacı mask commit'iyle atılır. */
    delete stroke.__smudgeRes;
    delete stroke.__smudgeStamped;
    // K20b: birikim kanalları atıldı.
    ui.dualWts = null;
    ui.dualComp = null;
    ui.dualCompPts = 0;
    ui.stroke = null;
    ui.scratch = null;
    ui.lastShapeRasterRect = null;
    ui.layerCanvas = null;
    ui.previewDirty = false;
    inkEditorLiveOverlayEnd();
    inkEditorInvalidate();
    if (typeof scheduleSave === 'function') scheduleSave();
    if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
    if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
    return;
  }

  if (stroke.kind === 'shape' || stroke.kind === 'gradient') {
    const a = stroke.points[0];
    const b = stroke.points[stroke.points.length - 1];
    const it = getItem(ui.itemId);
    const dx = (b.x - a.x) * (it ? it.w : 1);
    const dy = (b.y - a.y) * (it ? it.h : 1);
    /* Tur 4: snapFree KAPALI şekiller (daire/çokgen) bilinçli olarak son
       noktayı ilkine eşit yazar — serbest-el damga yolu AÇIK poliline
       çizdiği için kapanış segmenti böyle taşınır. a==b burada 'boş
       dokunuş' DEĞİL, kapanıştır. Boşluk reddi yalnızca açık şekillerde
       (çizgi: 2 nokta, sıfır uzunluk) anlamlı. */
    const closedSnap = stroke.kind === 'shape' && stroke.snapFree &&
      (stroke.closed || stroke.points.length > 2);
    if (!closedSnap && Math.hypot(dx, dy) < 1) {
      inkEditorDropStroke();
      return;
    }
  } else if (!['fill', 'gradient'].includes(stroke.kind) && stroke.points.length === 1) {
    const q = stroke.points[0];
    stroke.points.push({ ...q, x: q.x + 0.0001, y: q.y + 0.0001 });
  }

  const finalPreview = inkEditorRebuildPreview(true);
  /* FAZ 7.S: canlı rezervuar zincirleri + basılı-dab sayacı işini yaptı
     (finalize, skipDabs=__smudgeStamped ile kuyruk dabları bastı).
     Commit sonrası replay/undo/worker daima kanonik taze zincirle
     yeniden kurar — kalıntı alanlar kayıt/geri-sarmaya sızmasın. */
  delete stroke.__smudgeRes;
  delete stroke.__smudgeStamped;
  // K20b: birikim kanalları bake ile atıldı.
  ui.dualWts = null;
  ui.dualComp = null;
  ui.dualCompPts = 0;
  ui.stroke = null;
  ui.scratch = null;
  ui.lastShapeRasterRect = null;
  ui.layerCanvas = null;
  ui.previewDirty = false;

  if (typeof inkPushUndoStroke === 'function') inkPushUndoStroke(layer, stroke);
  else if (typeof pushUndo === 'function') pushUndo();
  layer.strokes.push(stroke);
  if (layer.strokes.length > 5000) layer.strokes.splice(0, layer.strokes.length - 5000);

  // FAZ 1B (Layer Mask): maskeli katmanda artımlı yama maskeyi iki kez
  // çarpar (tuval pikselleri zaten maskeli). Kaynak vuruşlardan tam
  // kurulum: maske tek kez, doğru çarpanla uygulanır.
  if (layer.mask) {
    inkEditorLiveOverlayEnd();
    /* FAZ 7.M (profiler bulgusu): tam kursettiğimiz inkRerenderLayer
       maskeli vuruşta ~177 ms/keziyordu (A3 profili). Kaydı:
       vuruş sadece bake bölgesini etkiler; baked bölge kesiti +
       kesişen vuruşların sıralı tekrarı + bölge maskesi tam
       kursettiğimizle birebir piksel eşit (noktasalı kompozisyon).
       Maske/baked çözümsüzse tam kurulum geri düşer; epoch:bölge üçlü
       bir bump'ta taşınır (FAZ 7.P) — rectsiz bump tam pyrambit kurar,
       o yüzden yalnız tek bump yapılır. */
    const bakeSize = Math.max(0.5, stroke.size * layerCanvas.width);
    const bakeRect = inkEditorFullRasterRect(stroke, layerCanvas, bakeSize);
    let ok = false;
    if (bakeRect) {
      ok = typeof inkRebuildItemLayerRegion === 'function'
        ? inkRebuildItemLayerRegion(layer, bakeRect, stroke.id) : false;
    }
    if (typeof inkBumpPaintEpoch === 'function') {
      // FAZ 7.P: bölgesel yolda pyramit yalnız bu bölgeyi yamar;
      // düşümde tam kursetlik (rect yok).
      inkBumpPaintEpoch(layer.id, 'mask', ok ? bakeRect : null);
    }
    if (!ok) {
      if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.add(layer.id);
      inkRerenderLayer(layer.id);
    } else if (finalPreview) {
      // Kare çipi: sahne karesi bu bölgeyle bölgesel kurulur (bölge
      // yeni pikselleri zaten taşıyor).
      const cl = { x: Math.max(0, bakeRect.x), y: Math.max(0, bakeRect.y),
        w: Math.min(layerCanvas.width, bakeRect.x + bakeRect.w) - Math.max(0, bakeRect.x),
        h: Math.min(layerCanvas.height, bakeRect.y + bakeRect.h) - Math.max(0, bakeRect.y) };
      if (cl.w > 0 && cl.h > 0) {
        ui.frameChip = {
          x: cl.x, y: cl.y, w: cl.w, h: cl.h,
          spaceW: layerCanvas.width, spaceH: layerCanvas.height,
        };
      }
    }
    if (typeof scheduleSave === 'function') scheduleSave();
    if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
    if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
    /* FX girdisi katman nesline bağlı: maske commit'inde de tazele. */
    if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
    const maskItem = getItem(ui.itemId);
    if (maskItem && typeof inkFxItemHasActiveFx === 'function'
      && inkFxItemHasActiveFx(maskItem)) {
      if (typeof inkFxInvalidate === 'function') inkFxInvalidate(maskItem.id);
      if (typeof inkSyncDom === 'function') inkSyncDom(maskItem);
    }
    inkEditorInvalidate();
    return;
  }

  // pointerup'ta önizlemede oluşturulan tam rasterı katmana kopyala.
  // Tur 2 madde 5: tam clear+copy yerine yalnız bake bölgesi yazılır.
  // Bölge dışı preview içeriği eski katman içeriğiyle bit-parite
  // (dualComp/scratch katman kopyasıdır; vuruş sırasında kalıcı katman
  // dışarıdan değişmez) — bölge dışı zaten eski piksellerle aynıdır.
  const ctx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
  let epochRect = null;
  if (finalPreview) {
    const bakeSize = Math.max(0.5, stroke.size * layerCanvas.width);
    const bakeRect = inkEditorFullRasterRect(stroke, layerCanvas, bakeSize);
    const bakeOK = !!bakeRect && finalPreview.width === layerCanvas.width &&
      finalPreview.height === layerCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (bakeOK) {
      ctx.clearRect(bakeRect.x, bakeRect.y, bakeRect.w, bakeRect.h);
      ctx.drawImage(finalPreview, bakeRect.x, bakeRect.y, bakeRect.w, bakeRect.h,
        bakeRect.x, bakeRect.y, bakeRect.w, bakeRect.h);
      // Kare çipi: sahne karesi bu bölgeyle bölgesel kurulur.
      ui.frameChip = {
        x: bakeRect.x, y: bakeRect.y, w: bakeRect.w, h: bakeRect.h,
        spaceW: layerCanvas.width, spaceH: layerCanvas.height,
      };
      /* FAZ 7.P: pyramit yalnız bu bölgeyi tazeler. */
      epochRect = bakeRect;
    } else {
      ctx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
      ctx.drawImage(finalPreview, 0, 0);
    }
  } else {
    inkDrawStrokeOnContext(ctx, stroke, {
      mapPoint: p => ({ x: p.x * layerCanvas.width, y: p.y * layerCanvas.height }),
      sizePx: Math.max(0.5, stroke.size * layerCanvas.width),
      pointScale: { x: layerCanvas.width, y: layerCanvas.height },
    });
  }
  if (inkRuntime.dirtyLayers) inkRuntime.dirtyLayers.delete(layer.id);
  // Katman rasterı değişti: küçültme önbelleğinin anahtarı olan boya
  // dönemini artır. Aksi halde zoom-out'ta eski (vuruşsuz) önbellek
  // yeniden kullanılıyor ve çizgi ekranda kayboluyordu.
  if (typeof inkBumpPaintEpoch === 'function') {
    // FAZ 7.P: bake bölgesi biliniyorsa pyramit yalnız bölge yamar.
    inkBumpPaintEpoch(layer.id, 'mutation', epochRect);
  }
  /* FX (Efektler) açıkken commit edilen vuruş efekt girdisine girmeli:
     katman nesli artırılıp FX önbelleği düşürülür, tahta katmanı ve
     tuval tazelenir. GERÇEK HATA: bu tazeleme yoktu → efekt açıkken
     çizgi bırakılınca eski efektli kare basılıyor, çizim kayboluyordu. */
  if (typeof inkBumpLayerGen === 'function') inkBumpLayerGen(layer.id);
  {
    const it = getItem(ui.itemId);
    if (it && typeof inkFxItemHasActiveFx === 'function' && inkFxItemHasActiveFx(it)) {
      if (typeof inkFxInvalidate === 'function') inkFxInvalidate(it.id);
      if (typeof inkSyncDom === 'function') inkSyncDom(it);
    }
  }

  // Geçici canlı katmanı kaldır; vuruş artık kalıcı tuvalde.
  inkEditorLiveOverlayEnd();

  if (typeof scheduleSave === 'function') scheduleSave();
  if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
  if (typeof inkUpdateGizmo === 'function') inkUpdateGizmo();
  // Vuruş artık katman tuvaline pişti; önizleme yerine kalıcı raster çizilir.
  inkEditorInvalidate();
}

/* =========================================================
   FAZ 6 B10: Tuval kenarı Power Sliders (referans uygulama deseni)
   ---------------------------------------------------------
   Tuval kenarında sürüklenebilir Boyut/Opaklık şeritleri — options
   bar tamamlayıcısı. Değişiklik protokolü:
   (1) Tek durum kaynağı inkState(): şerit yalnızca görünüm; değer
       yazımı buildOptionRange (draw-v5) ile BİREBİR aynı kanalı
       izler (fırça-üstüne-yazma + inkPreviewBrush/inkUpdateHud/
       scheduleSave).
   (2) Görünürlük şemadan gelir: aracın seçenek şemasında range
       size/opacity yoksa ilgili şerit gizlenir (text/eyedropper'da
       komple gizler — gereksiz arayüz yok, sözleşme 3/4).
   (3) Konum inkEditorViewport() tek kapısından: sol kenarda, kolon
       alanının içinde; SINIRLAR sözleşmesi (1) — pencere daraldığında
       da viewport içine hapsedilir.
   (4) Rot/zoom/pan'e bağımsız: şerit tuval kâğıdının değil pencere
       görünüm alanının kromudur.
   ========================================================= */
const inkPowerSlidersUi = { root: null, sliders: new Map(), wrapped: false };

/** B10: şeritler varsayılan KAPALI — Çizim Ayarları menüsünden açılır
    (draw-v5 grip → openPanelsMenu); anahtar tek: localStorage. */
function inkPowerSlidersEnabled() {
  try { return localStorage.getItem('tailref-ps-sliders') === '1'; }
  catch { return false; }
}

/** Çizim Ayarları menüsünün tek yolu — draw-v5 openPanelsMenu buraya
    bağlar (eski Ayarlar kutusu kaldırıldı; index.html notuna bak). */
function inkPowerSlidersSet(on) {
  try {
    localStorage.setItem('tailref-ps-sliders', on ? '1' : '0');
  } catch { /* sessiz */ }
  inkPowerSlidersSync();
}

function inkPowerSlidersEnsure() {
  const PS = inkPowerSlidersUi;
  if (PS.root) return PS.root;
  const ui = inkEditorUi;
  if (!ui.root) return null;
  const root = document.createElement('div');
  root.id = 'inkPowerSliders';
  for (const key of ['size', 'opacity']) {
    const box = document.createElement('div');
    box.className = 'inkPSlider';
    box.dataset.key = key;
    box.tabIndex = 0;
    box.setAttribute('role', 'slider');
    box.setAttribute('aria-orientation', 'vertical');
    const fill = document.createElement('i');
    fill.className = 'inkPSFill';
    const knob = document.createElement('i');
    knob.className = 'inkPSKnob';
    const bubble = document.createElement('span');
    bubble.className = 'inkPSBubble';
    bubble.setAttribute('aria-hidden', 'true');
    box.append(fill, knob, bubble);
    box.addEventListener('pointerdown', inkPowerSliderPointerDown);
    box.addEventListener('pointermove', inkPowerSliderMove);
    box.addEventListener('pointerup', inkPowerSliderUp);
    box.addEventListener('pointercancel', inkPowerSliderUp);
    box.addEventListener('keydown', inkPowerSliderKeyDown);
    box.addEventListener('focusin', () => { try { inkPowerSlidersSync(); } catch { /* sessiz */ } });
    root.appendChild(box);
    PS.sliders.set(key, { box, fill, knob, bubble, drag: null });
  }
  PS.root = root;
  ui.root.appendChild(root);
  PS.wrapped = false;
  return root;
}

/** Şema görünüm alanı: aracın şemasında {key} range widget'ı var mı. */
function inkPowerSliderWidgetOf(key) {
  let ink = null;
  try { ink = inkState(); } catch { return null; }
  let schema = null;
  try {
    schema = typeof inkToolOptionsSchema === 'function'
      ? inkToolOptionsSchema(ink.tool) : null;
  } catch { schema = null; }
  if (!Array.isArray(schema)) return null;
  return schema.find(w => w && w.kind === 'range' && w.key === key) || null;
}

/** Şerit değeri → durum yazımı. buildOptionRange (draw-v5) input
    yolunun BİREBİR aynı.setState kanalı: farkı yalnız giriş kaynağı. */
function inkPowerSliderApply(widget, value) {
  const key = widget.key;
  const ink = inkState();
  ink[key] = value;
  /* Panel kaydırıcılarıyla aynı fırça-üstüne-yazma davranışı
     (draw-v5 buildOptionRange sömörtüsü birebir korunur). */
  if (ink.tool !== 'eraser' && key !== 'fillTolerance') {
    const brush = typeof inkGetBrush === 'function' ? inkGetBrush(ink.brushId) : null;
    if (brush && key in brush) {
      brush[key] = value;
      if (typeof inkSaveBrushOverride === 'function') inkSaveBrushOverride(brush);
    }
  }
  if (typeof inkPreviewBrush === 'function') inkPreviewBrush();
  if (typeof inkUpdateHud === 'function') inkUpdateHud();
  if (typeof scheduleSave === 'function') scheduleSave();
  // Options bar/panel şeritleri aynı karede tazelensin (measure
  // atlanmaz — değer değişimi nadir bir girdi olayıdır).
  try { if (window.__v5OptSync) window.__v5OptSync(); } catch { /* sessiz */ }
}

/** Şeridin gösterim biçimlerinden sonra knob konumu + aria değeri
    yazar; değişmediyse DOM dokunmaz (köşe-tıklaması gerekmez). */
function inkPowerSliderPaint(key) {
  const ui = inkEditorUi;
  const PS = inkPowerSlidersUi;
  const S = PS.sliders.get(key);
  if (!S) return;
  const widget = inkPowerSliderWidgetOf(key);
  if (!widget) { S.box.hidden = true; return; }
  S.box.hidden = false;
  const min = widget.min != null ? widget.min : 0;
  const max = widget.max != null ? widget.max : 100;
  const scale = widget.scale || 1;
  const ink = inkState();
  let v = Number(ink[key]);
  if (!Number.isFinite(v)) v = min * scale;
  v = clamp(v, min * scale, max * scale);
  const t = (v - min * scale) / Math.max(1e-6, (max - min) * scale);
  S.box.style.setProperty('--v5-ps-p', String(Math.round(t * 1000) / 10) + '%');
  const shown = Math.round(v / scale);
  S.box.setAttribute('aria-valuemin', String(min));
  S.box.setAttribute('aria-valuemax', String(max));
  if (S.box.getAttribute('aria-valuenow') !== String(shown)) {
    S.box.setAttribute('aria-valuenow', String(shown));
  }
  const label = (widget.label || key) + ' — ' + shown +
    (widget.unit != null ? widget.unit : (scale === 0.01 ? '%' : ''));
  if (S.box.getAttribute('aria-label') !== label) S.box.setAttribute('aria-label', label);
  if (S.box.title !== label) S.box.title = label;
}

/** Şerit balonu: sürükleme/klavye sırasında değeri var eder. */
function inkPowerSliderBubble(S, text) {
  if (!S) return;
  S.bubble.textContent = text;
  S.bubble.classList.add('show');
  clearTimeout(S.bubbleTimer);
  S.bubbleTimer = setTimeout(() => S.bubble.classList.remove('show'), 1100);
}

/** t (0..1, yukarı artar) → şema kurallarıyla ölçekli değer.
    Adım kuantlaması state biriminde (adım × scale) uygulanır. */
function inkPowerSliderValueAt(key, t) {
  const widget = inkPowerSliderWidgetOf(key);
  if (!widget) return null;
  const scale = widget.scale || 1;
  const min = (widget.min != null ? widget.min : 0) * scale;
  const max = (widget.max != null ? widget.max : 100) * scale;
  const step = Math.max(1e-6, (widget.step || 1) * scale);
  const filled = min + clamp(t || 0, 0, 1) * (max - min);
  return Math.min(max, Math.max(min,
    min + Math.round((filled - min) / step) * step));
}

function inkPowerSliderPointer(ev, S) {
  const r = S.box.getBoundingClientRect();
  if (r.height < 4) return undefined;
  return (r.bottom - ev.clientY) / r.height;
}

function inkPowerSliderCommit(S, t, showBubble) {
  const ui = inkEditorUi;
  const key = S.box.dataset.key;
  const value = inkPowerSliderValueAt(key, t);
  if (value == null) return;
  inkPowerSliderApply({ key }, value);
  if (showBubble) inkPowerSliderBubble(S, inkPowerSliderTextAt(key, t));
}

function inkPowerSliderTextAt(key, t) {
  const widget = inkPowerSliderWidgetOf(key);
  if (!widget) return '';
  const scale = widget.scale || 1;
  const ink = inkState();
  let v = Number(ink[key]);
  if (!Number.isFinite(v)) v = (widget.min != null ? widget.min : 0) * scale;
  return Math.round(v / scale) + (widget.unit != null ? widget.unit : (scale === 0.01 ? '%' : ''));
}

function inkPowerSliderPointerDown(ev) {
  const ui = inkEditorUi;
  const PS = inkPowerSlidersUi;
  const S = PS.sliders.get(ev.currentTarget.dataset.key);
  if (!S || !ui.open || ui.stroke || ui.panning) return;
  ev.preventDefault();
  ev.stopPropagation();
  const t = inkPowerSliderPointer(ev, S);
  if (t == null) return;
  try { S.box.setPointerCapture(ev.pointerId); } catch { /* sessiz */ }
  S.drag = { id: ev.pointerId };
  S.box.classList.add('is-dragging');
  inkPowerSliderCommit(S, t, true);
}

function inkPowerSliderMove(ev) {
  const ui = inkEditorUi;
  const PS = inkPowerSlidersUi;
  for (const S of PS.sliders.values()) {
    if (!S.drag || S.drag.id !== ev.pointerId) continue;
    const t = inkPowerSliderPointer(ev, S);
    if (t == null) return;
    inkPowerSliderCommit(S, t, true);
  }
}

function inkPowerSliderUp(ev) {
  const PS = inkPowerSlidersUi;
  for (const S of PS.sliders.values()) {
    if (!S.drag || S.drag.id !== ev.pointerId) continue;
    S.drag = null;
    S.box.classList.remove('is-dragging');
    try { S.box.releasePointerCapture(ev.pointerId); } catch { /* sessiz */ }
  }
}

function inkPowerSliderKeyDown(ev) {
  const ui = inkEditorUi;
  const PS = inkPowerSlidersUi;
  const S = PS.sliders.get(ev.currentTarget.dataset.key);
  if (!S || !ui.open) return;
  const widget = inkPowerSliderWidgetOf(S.box.dataset.key);
  if (!widget) return;
  const step = widget.step || 1; // gösterim birimi cinsinden adım
  const min = widget.min != null ? widget.min : 0;
  const max = widget.max != null ? widget.max : 100;
  const scale = widget.scale || 1;
  let ink;
  try { ink = inkState(); } catch { return; }
  let v = Number(ink[widget.key]);
  if (!Number.isFinite(v)) v = min * scale;
  let shown = v / scale;
  let handled = true;
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') shown += step;
  else if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') shown -= step;
  else if (ev.key === 'PageUp') shown += step * 10;
  else if (ev.key === 'PageDown') shown -= step * 10;
  else if (ev.key === 'Home') shown = min;
  else if (ev.key === 'End') shown = max;
  else handled = false;
  if (!handled) return;
  ev.preventDefault();
  ev.stopPropagation();
  shown = clamp(shown, min, max);
  inkPowerSliderApply(widget, shown * scale);
  inkPowerSliderBubble(S, Math.round(shown) +
    (widget.unit != null ? widget.unit : (scale === 0.01 ? '%' : '')));
}

/** B10: şerit durum senkronu. Kök sadece gerçek değişimde DOM yazar;
    her karede çağrılabilir (render hattı maliyeti ölçülebilir). */
function inkPowerSlidersSync() {
  const ui = inkEditorUi;
  const PS = inkPowerSlidersUi;
  if (!PS.root || !ui.ready) return;
  const open = !!ui.open && inkPowerSlidersEnabled();
  if (PS.root.hidden !== !open) PS.root.hidden = !open;
  if (!open) return;
  const hasSize = inkPowerSliderWidgetOf('size') != null;
  const hasOpacity = inkPowerSliderWidgetOf('opacity') != null;
  const rootVisible = hasSize || hasOpacity;
  if (PS.root.style.display !== (rootVisible ? '' : 'none')) {
    PS.root.style.display = rootVisible ? '' : 'none';
  }
  if (!rootVisible) return;
  for (const key of ['size', 'opacity']) inkPowerSliderPaint(key);
  // Konum: inkEditorViewport tek kapısı; görünüm alanı değişince taşınır.
  const v = inkEditorViewport();
  const vh = v.vh;
  const maxStack = Math.max(180, vh - Math.max(v.top, v.bottom) - 32);
  const stripH = clamp(Math.round(maxStack * 0.4), 130, 250);
  const gap = 12;
  const stackH = (hasSize ? stripH : 0) + (hasSize && hasOpacity ? gap : 0) +
    (hasOpacity ? stripH : 0);
  const usableBottom = vh - (v.bottom + 58); // alt durum çubuğu payı
  const cy = v.top + v.ah / 2;
  let top = cy - stackH / 2;
  top = clamp(top, v.top + 14, Math.max(v.top + 14, usableBottom - stackH));
  const left = Math.max(14, v.left + 14);
  const nextPos = { left: Math.round(left), top: Math.round(top) };
  if (PS.root.__lastX !== nextPos.left) {
    PS.root.style.left = nextPos.left + 'px';
    PS.root.__lastX = nextPos.left;
  }
  if (PS.root.__lastY !== nextPos.top) {
    PS.root.style.top = nextPos.top + 'px';
    PS.root.__lastY = nextPos.top;
  }
  if (PS.root.__lastH !== stripH) {
    PS.root.style.setProperty('--ps-strip-h', stripH + 'px');
    PS.root.__lastH = stripH;
  }
}

/** B10: Open/Close/Resize/Status kanalları + dış yazım takibinde
    inkPreviewBrush kancası (options bar her değer yazımında çalar). */
function inkPowerSlidersInstall() {
  const PS = inkPowerSlidersUi;
  if (PS.wrapped) return;
  PS.wrapped = true;
  window.addEventListener('resize', inkPowerSlidersSync);
  if (typeof window.inkPreviewBrush === 'function') {
    const prev = window.inkPreviewBrush;
    window.inkPreviewBrush = function (...args) {
      const r = prev.apply(this, args);
      try { inkPowerSlidersSync(); } catch { /* sessiz */ }
      return r;
    };
  }
}



