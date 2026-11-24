/* TailRef app · ink UI · toolbox, flyouts, brush & layer panels
   ------------------------------------------------------------------
   Sol dikey araç kutusu referans uygulama mantığında çalışır: ana düğme aracı
   seçer, sağ alt köşedeki küçük üçgen (veya sağ tık / uzun basma) aynı
   gruptaki alt araçları açar. Paneller yüzen panel altyapısını kullanır.
   ========================================================= */
'use strict';

const inkUi = {
  ready: false,
  els: {},
  flyout: null,
  flyoutFor: '',
  longPressTimer: 0,
  dockTimer: 0,
  autoBrushClosed: false,
  brushManual: false,
  editorOverrides: false,
};

const INK_TOOL_META = {
  transform: { label: 'Move / Transform', icon: 'ink-move', key: 'V' },
  marquee:   { label: 'Rectangular Selection', icon: 'ink-marquee', key: 'M' },
  lasso:     { label: 'Lasso Selection', icon: 'ink-lasso', key: 'L' },
  brush:     { label: 'Brush', icon: 'ink-brush', key: 'B' },
  pencil:    { label: 'Pencil', icon: 'ink-pencil', key: 'P' },
  eraser:    { label: 'Eraser', icon: 'ink-eraser', key: 'E' },
  shape:     { label: 'Shape', icon: 'ink-shape', key: 'U' },
  text:      { label: 'Text note', icon: 'type', key: 'T' },
  eyedropper:{ label: 'Eyedropper', icon: 'ink-dropper', key: 'I' },
};

const INK_SHAPE_META = {
  arrow:     { label: 'Arrow', icon: 'ink-arrow' },
  rect:      { label: 'Rectangle', icon: 'ink-rect' },
  ellipse:   { label: 'Ellipse', icon: 'ink-ellipse' },
  highlight: { label: 'Highlighter', icon: 'ink-highlight' },
};

const INK_FLYOUTS = {
  marquee: [
    { tool: 'marquee', label: 'Rectangular Selection', icon: 'ink-marquee' },
    { tool: 'lasso', label: 'Lasso Selection', icon: 'ink-lasso' },
  ],
  brush: [
    { tool: 'brush', label: 'Brush', icon: 'ink-brush', brushId: 'ink-soft' },
    { tool: 'pencil', label: 'Pencil', icon: 'ink-pencil', brushId: 'ink-pencil' },
    { tool: 'brush', label: 'Hard Brush', icon: 'ink-brush', brushId: 'ink-hard' },
    { tool: 'brush', label: 'Marker', icon: 'ink-brush', brushId: 'ink-marker' },
    { tool: 'brush', label: 'Airbrush', icon: 'ink-brush', brushId: 'ink-air' },
  ],
  eraser: [
    { tool: 'eraser', label: 'Eraser', icon: 'ink-eraser' },
    { tool: 'eraser', label: 'Soft Eraser', icon: 'ink-eraser', soft: true },
  ],
  shape: [
    { tool: 'shape', label: 'Arrow', icon: 'ink-arrow', shape: 'arrow' },
    { tool: 'shape', label: 'Rectangle', icon: 'ink-rect', shape: 'rect' },
    { tool: 'shape', label: 'Ellipse', icon: 'ink-ellipse', shape: 'ellipse' },
    { tool: 'shape', label: 'Highlighter', icon: 'ink-highlight', shape: 'highlight' },
  ],
};

function inkIcon(id) {
  return '<svg class="inkIcon" aria-hidden="true"><use href="#icon-' + id + '"/></svg>';
}

/* =========================================================
   başlatma
   ========================================================= */
async function inkInit() {
  inkEnsureState();
  inkInstallEditorUiOverrides();
  if (window.__bootMark) window.__bootMark('ink:before-brush-load');
  await inkLoadImportedBrushes();
  if (window.__bootMark) window.__bootMark('ink:imported-brushes-loaded');
  if (typeof inkNativeLoadBrushLibrary === 'function') {
    try { await inkNativeLoadBrushLibrary(); } catch { /* sessiz */ }
  }
  if (window.__bootMark) window.__bootMark('ink:library-ready');
  /* Disk önizleme önbelleğini ERKEN oku (boş-zaman kuyruğu değil:
     okuma 10-30 ms async; şerit boyamaları UI kurulumunda başlıyor —
     dekodlamanın onlara baş köşede yetişmesi için buradan tetiklenir). */
  if (typeof inkPreviewDiskWarm === 'function') {
    try { inkPreviewDiskWarm(); } catch { /* sessiz, ayrıca warm kendi yakalar */ }
  }
  inkInitTools();
  if (window.__bootMark) window.__bootMark('ink:tools-bound');
  inkInitUI();
  if (window.__bootMark) window.__bootMark('ink:UI-DOM-kuruldu');
  inkRebuildAll();
  if (window.__bootMark) window.__bootMark('ink:raster-rebuild');
  inkSyncUI();
  if (window.__bootMark) window.__bootMark('ink:ui-sync');
  // Çizim araçları yalnızca "Start Drawing" ile açılan görsel düzenleme
  // modunda görünür; boş tahtada araç çubuğu gizli kalır.
  const toolbox = document.getElementById('inkToolbox');
  if (toolbox) toolbox.hidden = true;
}

function inkInitUI() {
  if (inkUi.ready) return;
  const els = inkUi.els;
  els.toolbox = document.getElementById('inkToolbox');
  els.colorWell = document.getElementById('inkColorWell');
  els.colorSwatch = document.getElementById('inkColorSwatch');
  els.colorWheel = document.getElementById('inkColorWheel');
  els.wheelCanvas = document.getElementById('inkWheelCanvas');
  els.wheelHexInput = document.getElementById('inkWheelHexInput');
  els.wheelR = document.getElementById('inkWheelR');
  els.wheelG = document.getElementById('inkWheelG');
  els.wheelB = document.getElementById('inkWheelB');
  els.wheelPrev = document.getElementById('inkWheelPrev');
  els.wheelHex = document.getElementById('inkWheelHex');
  els.scopeBar = document.getElementById('inkScopeBar');
  els.scopeName = document.getElementById('inkScopeName');
  els.scopeSize = document.getElementById('inkScopeSize');
  els.scopeInfo = document.getElementById('inkScopeInfo');
  els.zoomOut = document.getElementById('inkZoomOut');
  els.zoomIn = document.getElementById('inkZoomIn');
  els.zoomValue = document.getElementById('inkZoomValue');
  els.zoomFit = document.getElementById('inkZoomFit');
  els.brushPanel = document.getElementById('inkBrushPanel');
  els.layersPanel = document.getElementById('inkLayersPanel');
  els.brushCollapse = document.getElementById('btnInkBrushCollapse');
  els.layerCount = document.getElementById('inkLayerCount');
  els.brushPreview = document.getElementById('inkBrushPreview');
  els.brushName = document.getElementById('inkBrushName');
  els.presetList = document.getElementById('inkPresetList');
  els.size = document.getElementById('inkSize');
  els.sizeVal = document.getElementById('inkSizeVal');
  els.opacity = document.getElementById('inkOpacity');
  els.opacityVal = document.getElementById('inkOpacityVal');
  els.hardness = document.getElementById('inkHardness');
  els.hardnessVal = document.getElementById('inkHardnessVal');
  els.spacing = document.getElementById('inkSpacing');
  els.spacingVal = document.getElementById('inkSpacingVal');
  els.smoothing = document.getElementById('inkSmoothing');
  els.smoothingVal = document.getElementById('inkSmoothingVal');
  els.mouseSpeedPressure = document.getElementById('inkMouseSpeedPressure');
  els.shapeSnap = document.getElementById('inkShapeSnap');
  els.pressureCurve = document.getElementById('inkPressureCurve');
  els.pressureCurveVal = document.getElementById('inkPressureCurveVal');
  els.speedSize = document.getElementById('inkSpeedSize');
  els.speedSizeVal = document.getElementById('inkSpeedSizeVal');
  els.flow = document.getElementById('inkFlow');
  els.flowVal = document.getElementById('inkFlowVal');
  els.flowJitter = document.getElementById('inkFlowJitter');
  els.flowJitterVal = document.getElementById('inkFlowJitterVal');
  els.scatter = document.getElementById('inkScatter');
  els.scatterVal = document.getElementById('inkScatterVal');
  els.spacingJitter = document.getElementById('inkSpacingJitter');
  els.spacingJitterVal = document.getElementById('inkSpacingJitterVal');
  els.pressureSize = document.getElementById('inkPressureSize');
  els.pressureSizeVal = document.getElementById('inkPressureSizeVal');
  els.pressureOpacity = document.getElementById('inkPressureOpacity');
  els.pressureOpacityVal = document.getElementById('inkPressureOpacityVal');
  els.angleJitter = document.getElementById('inkAngleJitter');
  els.angleJitterVal = document.getElementById('inkAngleJitterVal');
  els.taperStart = document.getElementById('inkTaperStart');
  els.taperStartVal = document.getElementById('inkTaperStartVal');
  els.taperEnd = document.getElementById('inkTaperEnd');
  els.taperEndVal = document.getElementById('inkTaperEndVal');
  els.abrInput = document.getElementById('inkAbrInput');
  els.layerList = document.getElementById('inkLayerList');
  els.layerScope = document.getElementById('inkLayerScope');
  els.layerOpacity = document.getElementById('inkLayerOpacity');
  els.layerOpacityVal = document.getElementById('inkLayerOpacityVal');
  els.layerBlend = document.getElementById('inkLayerBlend');
  els.layerPlane = document.getElementById('inkLayerPlane');
  els.layerLock = document.getElementById('inkLayerLock');
  els.hud = document.getElementById('inkHud');

  if (window.__bootMark) window.__bootMark('ui:before-bind');
  inkBindToolbox();
  inkBindBrushPanel();
  inkBindLayersPanel();
  inkBindColorWheel();
  if (typeof inkCpInit === 'function') inkCpInit();
  inkBindGlobalUi();
  if (window.__bootMark) window.__bootMark('ui:bindler-bitti');
  window.addEventListener('resize', inkLayoutDock);
  if (window.__bootMark) window.__bootMark('ui:presets-before');
  inkRenderPresets();
  if (window.__bootMark) window.__bootMark('ui:presets-bitti');
  if (typeof inkInitNativeBrushLibrary === 'function') {
    if (window.__bootMark) window.__bootMark('ui:brush-library-before');
    inkInitNativeBrushLibrary();
    if (window.__bootMark) window.__bootMark('ui:brush-library-done');
  }
  if (window.__bootMark) window.__bootMark('ui:scope-sync-before');
  inkSyncScopeVisual();
  inkSyncBrushPanelState();
  inkUi.ready = true;
}

/* =========================================================
   editör görünümü: UI katmanı düzeltmeleri
   ---------------------------------------------------------
   Çizim motoru (36-ink-editor.js) değiştirilmez. Motorun
   viewport'u eski alt fırça şeridine göre 112 px alt pay
   bırakıyordu; yeni 26 px durum çubuğunda tuval yukarıda
   kalıyordu. Burada yalnızca çalışma anında görünüm alanı
   yeniden tanımlanır: panellerin gerçek kenarları ve durum
   çubuğu yüksekliği kullanılır. Çizim verisi, dönüşümler ve
   katman koordinatları değişmez.
   ========================================================= */
function inkUiEditorViewport() {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const gap = 24; // tuval çevresinde tek nefes payı
  let left = gap;
  let right = gap;
  let top = gap;
  let bottom = gap;

  const rectOf = el => {
    if (!el || el.hidden) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };

  // Üst: yüzen araç çubuğunun alt kenarı. Çubuk görünmüyorsa 24 px pay.
  const barDock = document.getElementById('barDock');
  const barRect = rectOf(barDock);
  if (barRect) top = Math.max(top, barRect.bottom + gap);

  // Alt: yeni durum çubuğunun üst kenarı.
  const statusBar = document.getElementById('psStatusBar');
  const statusRect = rectOf(statusBar);
  if (statusRect) bottom = Math.max(bottom, vh - statusRect.top + gap);

  // Dar pencerede dock'lar tuvali kısaltmak yerine üstüne biner; tuval
  // tam genişlikte kalır ve paneller Tab ile kapatılabilir.
  const narrow = vw < 720;

  // Sol sütun: referans dock'u kapalıysa görünmez; araç rayı her zaman pay alır.
  if (!narrow) {
    const leftDock = document.getElementById('inkLeftDock');
    const leftRect = rectOf(leftDock);
    if (leftRect && leftRect.right > 0 && leftRect.left < vw) {
      left = Math.max(left, leftRect.right + gap);
    }
  }

  const toolbox = document.getElementById('inkToolbox');
  const toolRect = rectOf(toolbox);
  if (toolRect) left = Math.max(left, toolRect.right + gap);

  // Sağ sütun: panel/şerit gerçekten yer kaplıyorsa onun solu.
  if (!narrow) {
    const rightDock = document.getElementById('inkRightDock');
    const rightRect = rectOf(rightDock);
    if (rightRect && rightRect.left < vw && rightRect.right > 0) {
      right = Math.max(right, vw - rightRect.left + gap);
    }
  }

  // Dar/kısa pencerede paylar çizim alanını yutmasın; tuval panelin
  // altına taşmak yerine küçülsün.
  if (vw - left - right < 160) right = Math.max(gap, vw - left - 160);
  if (vh - top - bottom < 160) bottom = Math.max(gap, vh - top - 160);

  return {
    vw, vh, left, right, top, bottom,
    aw: Math.max(120, vw - left - right),
    ah: Math.max(120, vh - top - bottom),
  };
}

/* Tuvalin çevresine 1 px kenarlık çizer. Gölge motor tarafından
   üretilir; burada ikinci bir gölge eklenmez. */
function inkSyncCanvasFrame() {
  const frame = document.getElementById('inkCanvasFrame');
  if (!frame) return;
  const root = document.getElementById('inkEditor');
  const ui = typeof inkEditorUi !== 'undefined' ? inkEditorUi : null;
  if (!ui || !ui.open || !root || root.hidden ||
      typeof inkEditorComputeFit !== 'function') {
    frame.hidden = true;
    return;
  }
  /* A11 v2: rot ≠ 0 iken çerçeve (dik kenar + gölge) dönmüş kağıtla
     çakışıp "şerit/iz" gösteriyordu — gizli kalır (applyRot ile aynı
     kural; syncStatus override'ı her çağrıda geri açıyordu). */
  if (Math.abs(Number(ui.view && ui.view.rot) || 0) > 0.01) {
    frame.hidden = true;
    return;
  }
  /* A11 v6 (kullanıcı: "ilk döndürüşte hayalet iz var, görünüp
     kayboluyor"): R sürüklemesi aktifken çerçeve gizli kalır. İlk
     sürükleyişte rot henüz 0 olduğundan yukarıdaki dal tetiklenmiyor,
     syncStatus override'ı çerçeveyi geri açıyor ve rot ≠ 0 olunca
     render !rotRad dalı artık çağırmadığından dik çerçeve (kenar+
     gölge) dönmemiş bantlar halinde drag boyunca kalıyordu.
     Bırakışta inkEditorApplyRot rot'a göre karar verir. */
  if (ui.rotDrag) {
    frame.hidden = true;
    return;
  }
  const fit = inkEditorComputeFit();
  if (!fit || !(fit.w > 0) || !(fit.h > 0)) {
    frame.hidden = true;
    return;
  }
  frame.hidden = false;
  frame.style.left = fit.x + 'px';
  frame.style.top = fit.y + 'px';
  frame.style.width = fit.w + 'px';
  frame.style.height = fit.h + 'px';
}

/* Motor fonksiyonları klasik betikte global ada yazıldığı için
   yükleme tamamlandıktan sonra sarmalanabilir. Sarmalayıcı yalnızca
   durum çubuğu eşitlemesinden sonra kenarlık kutusunu günceller. */
function inkInstallEditorUiOverrides() {
  if (inkUi.editorOverrides) return;
  inkUi.editorOverrides = true;

  if (typeof window.inkEditorViewport === 'function') {
    window.inkEditorViewport = inkUiEditorViewport;
  }

  if (typeof window.inkEditorSyncStatus === 'function') {
    const baseSync = window.inkEditorSyncStatus;
    window.inkEditorSyncStatus = function inkUiEditorSyncStatus() {
      const result = baseSync.apply(this, arguments);
      inkSyncCanvasFrame();
      return result;
    };
  }

  // Motor koordinatı gizli #inkScopeCoords hücresine yazar. Görünen iki
  // sabit hücreye aynı değeri ayrıştırarak taşırız; motor dosyası değişmez.
  if (typeof window.inkEditorSyncCoords === 'function') {
    const baseCoords = window.inkEditorSyncCoords;
    window.inkEditorSyncCoords = function inkUiEditorSyncCoords() {
      const result = baseCoords.apply(this, arguments);
      const source = document.getElementById('inkScopeCoords');
      const xEl = document.getElementById('inkScopeX');
      const yEl = document.getElementById('inkScopeY');
      if (source && (xEl || yEl)) {
        const match = /X\s*(-?\d+)\s*·\s*Y\s*(-?\d+)/.exec(source.textContent || '');
        if (xEl) xEl.textContent = match ? match[1] : '—';
        if (yEl) yEl.textContent = match ? match[2] : '—';
      }
      return result;
    };
  }

  if (typeof window.inkEditorClose === 'function') {
    const baseClose = window.inkEditorClose;
    window.inkEditorClose = function inkUiEditorClose() {
      const result = baseClose.apply(this, arguments);
      inkSyncCanvasFrame();
      return result;
    };
  }
}

/* =========================================================
   araç kutusu + flyout
   ========================================================= */
function inkBindToolbox() {
  const box = inkUi.els.toolbox;
  if (!box) return;

  box.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;

    const flyBtn = t.closest('[data-ink-flyout]');
    if (flyBtn) {
      e.preventDefault();
      e.stopPropagation();
      inkToggleFlyout(flyBtn);
      return;
    }

    // body[data-ink-tool] imleç stilini taşır; yalnızca araç kutusu
    // içindeki düğmeler araç seçimi sayılmalı.
    const toolBtn = t.closest('[data-ink-tool]');
    if (toolBtn && box.contains(toolBtn)) {
      e.preventDefault();
      inkCloseFlyout();
      const tool = toolBtn.dataset.inkTool;
      const brushId = toolBtn.dataset.inkBrush;
      const shape = toolBtn.dataset.inkShape;
      if (tool === 'shape') inkSetTool('shape', { shape: shape || inkState().shape });
      else inkSetTool(tool, brushId ? { brushId } : {});
      return;
    }

    const action = t.closest('[data-ink-action]');
    if (action) {
      e.preventDefault();
      inkToolboxAction(action.dataset.inkAction);
    }
  });

  box.addEventListener('contextmenu', e => {
    const t = e.target instanceof Element ? e.target : null;
    const group = t && t.closest('[data-ink-group]');
    if (!group) return;
    const trigger = group.querySelector('[data-ink-flyout]');
    if (!trigger) return;
    e.preventDefault();
    inkToggleFlyout(trigger);
  });

  // Uzun basma: dokunmatik/tablet kullanıcıları için flyout.
  box.addEventListener('pointerdown', e => {
    const t = e.target instanceof Element ? e.target : null;
    const main = t && t.closest('[data-ink-tool]');
    const group = main && box.contains(main) ? main.closest('[data-ink-group]') : null;
    if (!group || (t && t.closest('[data-ink-flyout]'))) return;
    clearTimeout(inkUi.longPressTimer);
    inkUi.longPressTimer = setTimeout(() => {
      const trigger = group.querySelector('[data-ink-flyout]');
      if (trigger) inkToggleFlyout(trigger);
    }, 420);
  });
  box.addEventListener('pointerup', () => clearTimeout(inkUi.longPressTimer));
  box.addEventListener('pointerleave', () => clearTimeout(inkUi.longPressTimer));

  document.addEventListener('pointerdown', e => {
    if (!inkUi.flyout) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && (t.closest('#inkFlyout') || t.closest('[data-ink-flyout]'))) return;
    inkCloseFlyout();
  });
}

function inkToolboxAction(action) {
  inkCloseColorWheel();
  // Yeni düzende tek geçici panel fırçadır; katmanlar kalıcı sütundur.
  if (action === 'brushPanel') inkTogglePanel(inkUi.els.brushPanel);
}

/** Fırça panelinin açık/kapalı durumunu gövde sınıfına ve daraltma
    düğmesine yansıtır. Izgara sütunu bu sınıfla daralır. */
function inkSyncBrushPanelState() {
  const panel = inkUi.els.brushPanel;
  const open = isPanelVisible(panel);
  document.body.classList.toggle('ink-brush-closed', !open);
  const btn = inkUi.els.brushCollapse;
  if (!btn) return;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.title = open ? 'Close brush panel' : 'Open the brush panel';
  btn.setAttribute('aria-label', open ? 'Close brush panel' : 'Open the brush panel');
}

function inkTogglePanel(panel) {
  if (!panel) return;
  if (isPanelVisible(panel)) hidePanel(panel);
  else showPanel(panel);
  // Kullanıcı seçimi dar ekrandaki otomatik kapatmayı ezer; aksi halde
  // elle açılan panel aynı karede yeniden kapanıyordu.
  if (panel === inkUi.els.brushPanel) {
    inkUi.brushManual = true;
    inkUi.autoBrushClosed = false;
  }
  inkSyncBrushPanelState();
  inkSyncUI();
  inkLayoutDockSoon();
}

/* Eski yüzen panel konumları artık kullanılmıyor: paneller tek
   pencerenin ızgara sütunlarıdır. Burada yalnızca eski satır içi
   konumları temizler ve dar pencerede fırça panelini kapatırız. */
function inkLayoutDock() {
  const els = inkUi.els;
  const toolbox = els.toolbox;
  for (const el of [toolbox, els.layersPanel, els.brushPanel]) {
    if (!el) continue;
    el.style.left = '';
    el.style.top = '';
  }
  if (!toolbox || toolbox.hidden) return;
  inkSyncResponsivePanels();
}

/** Pencere daralınca panelleri gizlemek yerine çalışma alanının
    yoğunluğunu ve sütunlarını sıkılaştırır. Eski otomatik fırça kapatma
    davranışı kullanıcı seçimini ezdiği için kaldırıldı; görünürlük artık
    Çalışma Alanı ayarına aittir. */
function inkSyncResponsivePanels() {
  if (typeof inkWorkspaceResponsive === 'function') {
    inkWorkspaceResponsive();
    return;
  }
  const panel = inkUi.els.brushPanel;
  if (!panel) return;
  const narrow = window.innerWidth < 900;
  if (narrow && !inkUi.autoBrushClosed && !inkUi.brushManual && isPanelVisible(panel)) {
    inkUi.autoBrushClosed = true;
    hidePanel(panel);
    inkSyncBrushPanelState();
    inkLayoutDockSoon();
  } else if (!narrow) {
    if (inkUi.autoBrushClosed) {
      inkUi.autoBrushClosed = false;
      showPanel(panel);
      inkSyncBrushPanelState();
      inkLayoutDockSoon();
    }
    inkUi.brushManual = false;
  }
}

/** Panel geçişi bitince çizim görünümünü bir kez tazele. Tuval
    boyutu yeniden ayrılmaz; yalnızca sığdırma/yeniden çizim yapılır. */
function inkLayoutDockSoon() {
  inkLayoutDock();
  requestAnimationFrame(inkLayoutDock);
  clearTimeout(inkUi.dockTimer);
  inkUi.dockTimer = setTimeout(() => {
    inkLayoutDock();
    if (typeof inkEditorSyncStatus === 'function') inkEditorSyncStatus();
    if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
  }, 80);
}

function inkToggleFlyout(trigger) {
  const group = trigger.closest('[data-ink-group]');
  const groupId = group ? group.dataset.inkGroup : '';
  if (!groupId) return;
  if (inkUi.flyout && inkUi.flyoutFor === groupId) { inkCloseFlyout(); return; }
  inkCloseFlyout();

  const items = INK_FLYOUTS[groupId] || [];
  const fly = document.createElement('div');
  fly.id = 'inkFlyout';
  fly.className = 'inkFlyout';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkFlyoutItem';
    btn.innerHTML = inkIcon(item.icon) + '<span>' + (window.__t ? __t(item.label) : item.label) + '</span>';
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const opts = {};
      if (item.shape) opts.shape = item.shape;
      if (item.brushId) opts.brushId = item.brushId;
      if (item.soft) opts.brushId = 'ink-soft';
      inkSetTool(item.tool, opts);
      inkCloseFlyout();
    });
    fly.appendChild(btn);
  }
  document.body.appendChild(fly);
  const r = trigger.getBoundingClientRect();
  const boxR = inkUi.els.toolbox ? inkUi.els.toolbox.getBoundingClientRect() : r;
  fly.style.left = (boxR.right + 8) + 'px';
  fly.style.top = Math.min(window.innerHeight - fly.offsetHeight - 8, r.top) + 'px';
  inkUi.flyout = fly;
  inkUi.flyoutFor = groupId;
  requestAnimationFrame(() => fly.classList.add('open'));
  trigger.setAttribute('aria-expanded', 'true');
}

function inkCloseFlyout() {
  if (!inkUi.flyout) return;
  inkUi.flyout.remove();
  inkUi.flyout = null;
  inkUi.flyoutFor = '';
  document.querySelectorAll('#inkToolbox [data-ink-flyout]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

/* =========================================================
   fırça paneli
   ========================================================= */
function inkBindBrushPanel() {
  const els = inkUi.els;
  if (!els.brushPanel) return;

  // Kaydırıcılar 0–100 (veya 0–200) tam sayı üretir; motor ise 0..1
  // oranları bekler. `scale` olmadan opaklık/sertlik/aralık/yumuşatma
  // değerleri 100 katına çıkıp kelepçeleniyor ve panel etkisiz kalıyordu.
  const bindRange = (el, key, valEl, format, scale = 1) => {
    if (!el) return;
    el.addEventListener('input', () => {
      const ink = inkState();
      ink[key] = Number(el.value) * scale;
      if (ink.tool !== 'eraser') {
        const brush = inkGetBrush(ink.brushId);
        if (brush && key in brush) {
          brush[key] = ink[key];
          inkSaveBrushOverride(brush);
        }
      }
      if (valEl) valEl.textContent = format ? format(ink[key]) : String(ink[key]);
      inkPreviewBrush();
      inkUpdateHud();
      // FAZ 5: v5 options bar aynı durumu okur — panel kaydırıcısıyla
      // senkron kalır (script yüklenmemişse sessiz).
      if (window.__v5OptSync) window.__v5OptSync();
    });
    el.addEventListener('change', () => { scheduleSave(); });
  };

  bindRange(els.size, 'size', els.sizeVal, v => String(Math.round(v)));
  bindRange(els.opacity, 'opacity', els.opacityVal, v => Math.round(v * 100) + '%', 0.01);
  bindRange(els.hardness, 'hardness', els.hardnessVal, v => Math.round(v * 100) + '%', 0.01);
  bindRange(els.spacing, 'spacing', els.spacingVal, v => Math.round(v * 100) + '%', 0.01);
  bindRange(els.smoothing, 'smoothing', els.smoothingVal, v => Math.round(v * 100) + '%', 0.01);
  // FAZ 2-4: fare hız-basınç simülasyonuki bu slider değil checkbox.
  if (els.mouseSpeedPressure) {
    els.mouseSpeedPressure.addEventListener('change', () => {
      inkState().mouseSpeedPressure = !!els.mouseSpeedPressure.checked;
      inkUpdateHud();
      scheduleSave();
    });
  }
  // Şekil oturtma anahtarı: kapatılırsa serbest vuruşa hiç dokunulmaz.
  if (els.shapeSnap) {
    els.shapeSnap.addEventListener('change', () => {
      inkState().shapeSnap = !!els.shapeSnap.checked;
      scheduleSave();
    });
  }
  bindRange(els.pressureCurve, 'pressureCurve', els.pressureCurveVal, v => v.toFixed(2) + '×', 0.01);
  bindRange(els.speedSize, 'speedSize', els.speedSizeVal, v => Math.round(v * 100) + '%', 0.01);
  const bindBrushRange = (el, key, valEl, format, scale = 1) => {
    if (!el) return;
    el.addEventListener('input', () => {
      const ink = inkState();
      const value = Number(el.value) * scale;
      ink[key] = value;
      const brush = inkGetBrush(ink.brushId);
      if (brush) {
        brush[key] = value;
        inkSaveBrushOverride(brush);
      }
      if (valEl) valEl.textContent = format ? format(value) : String(value);
      inkPreviewBrush();
      inkUpdateHud();
    });
    el.addEventListener('change', () => { scheduleSave(); });
  };
  bindBrushRange(els.flow, 'flow', els.flowVal, v => Math.round(v * 100) + '%', 0.01);
  bindBrushRange(els.flowJitter, 'flowJitter', els.flowJitterVal, v => Math.round(v * 100) + '%', 0.01);
  bindBrushRange(els.scatter, 'scatter', els.scatterVal, v => Math.round(v * 100) + '%', 0.01);
  bindBrushRange(els.taperStart, 'taperStart', els.taperStartVal, v => v.toFixed(2) + '×', 0.01);
  bindBrushRange(els.taperEnd, 'taperEnd', els.taperEndVal, v => v.toFixed(2) + '×', 0.01);
  const bindDynamicsRange = (el, key, valEl) => {
    if (!el) return;
    el.addEventListener('input', () => {
      const brush = inkGetBrush(inkState().brushId);
      if (!brush) return;
      if (!brush.dynamics) brush.dynamics = Object.assign({}, INK_DEFAULT_DYNAMICS);
      brush.dynamics[key] = Number(el.value) / 100;
      inkSaveBrushOverride(brush);
      if (valEl) valEl.textContent = el.value + '%';
      inkPreviewBrush();
    });
    el.addEventListener('change', () => { scheduleSave(); });
  };
  bindDynamicsRange(els.spacingJitter, 'spacingJitter', els.spacingJitterVal);
  bindDynamicsRange(els.pressureSize, 'sizeMin', els.pressureSizeVal);
  bindDynamicsRange(els.pressureOpacity, 'opacityMin', els.pressureOpacityVal);
  bindDynamicsRange(els.angleJitter, 'angleJitter', els.angleJitterVal);

  const importBtn = document.getElementById('btnInkImportAbr');
  if (importBtn && els.abrInput) {
    importBtn.addEventListener('click', e => {
      e.preventDefault();
      els.abrInput.click();
    });
  }
  if (els.abrInput) {
    els.abrInput.addEventListener('change', async () => {
      const file = els.abrInput.files && els.abrInput.files[0];
      els.abrInput.value = '';
      if (!file) return;
      try {
        const result = await inkImportAbrFile(file);
        if (result.added) {
          inkRenderPresets();
          inkSyncUI();
          if (typeof showProjectNotice === 'function') {
            showProjectNotice(result.added + ' brush tip imported', 3000);
          }
        } else if (typeof showProjectNotice === 'function') {
          showProjectNotice('ABR could not be read: ' + (result.error || 'no tip'), 4200);
        }
      } catch (err) {
        console.warn(err);
        if (typeof showProjectNotice === 'function') showProjectNotice('ABR could not be imported', 4200);
      }
    });
  }

  // Fırça paneli başlığının sağ ucundaki daraltma düğmesi.
  if (els.brushCollapse) {
    els.brushCollapse.addEventListener('click', e => {
      e.preventDefault();
      inkTogglePanel(els.brushPanel);
    });
  }

  // Pencere yeniden boyutlandığında önizleme tuvalleri CSS ölçüsüne uysun.
  let previewRaf = 0;
  window.addEventListener('resize', () => {
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      inkPreviewBrush();
    });
  });
}

/* =========================================================
   fırça rengi çarkı
   ========================================================= */
const inkColorWheel = {
  h: 0,
  s: 1,
  v: 1,
  dragging: '',
  pointerId: null,
  ring: null,
  ringPx: 0,
  tri: null,
  triHue: -1,
  triPx: 0,
};

function inkWheelHex(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : '#ff5a5f';
}

function inkSetColor(value, save = true) {
  const hex = inkWheelHex(value);
  inkState().color = hex;
  if (typeof inkCpOnColorSet === 'function') inkCpOnColorSet(hex, save);
  inkSyncColorSwatch();
  inkPreviewBrush();
  inkUpdateHud();
  inkSyncColorWheel(false);
  if (save) scheduleSave();
}

/* ---------------- Renk çarkı: geometri (FAZ 3-3) ----------------
   Dış halka tonu (0–360°) — kimliği eski HSV saf ton tanımıyla birebir
   aynı (görsel devamlılık). İç üçgen ise OKLCH a/b düzlemi:
     A (sol üst)  = beyaz  {l: 1, c: 0}
     B (sol alt)  = siyah  {l: 0, c: 0}
     C (sağ uç)   = saf ton (eskiyle aynı hue kimliği, L/C OKLCH'den)
   Böylece yatay eksen doymuşluk payı, dikey eksen beyaz/siyah karışımı
   olur; renk karışımı artık gamma-düzlem muhallebisi değil, OKLCH-L
   doğrusal karışımıdır (durum ↔ hex: inkWheelStateToHex /
   inkHexToWheelState, ./56-ink-color.js). */
function inkWheelGeometry() {
  const c = inkUi.els.wheelCanvas;
  if (!c) return null;
  const css = Math.max(72, c.clientWidth || 228);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.max(1, Math.round(css * dpr));
  if (c.width !== px || c.height !== px) {
    c.width = px;
    c.height = px;
    inkColorWheel.ring = null;
    inkColorWheel.tri = null;
    inkColorWheel.triHue = -1;
  }
  const outer = css / 2 - 4;
  const inner = outer * 0.775;
  const triR = inner - Math.max(7, css * 0.045);
  const cx = css / 2;
  const cy = css / 2;
  const h3 = triR * Math.sqrt(3) / 2;
  return {
    css, dpr, px, cx, cy, outer, inner, triR,
    A: { x: cx - triR / 2, y: cy - h3 },
    B: { x: cx - triR / 2, y: cy + h3 },
    C: { x: cx + triR, y: cy },
  };
}

function inkWheelBary(x, y, g) {
  const ax = g.A.x, ay = g.A.y;
  const v0x = g.B.x - ax, v0y = g.B.y - ay;
  const v1x = g.C.x - ax, v1y = g.C.y - ay;
  const v2x = x - ax, v2y = y - ay;
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;
  const den = d00 * d11 - d01 * d01 || 1;
  const b = (d11 * d20 - d01 * d21) / den;   // siyah
  const c = (d00 * d21 - d01 * d20) / den;   // saf ton
  return { a: 1 - b - c, b, c };
}

function inkWheelClampBary(w) {
  const a = Math.max(0, w.a);
  const b = Math.max(0, w.b);
  const c = Math.max(0, w.c);
  const sum = a + b + c;
  if (sum <= 1e-9) return { a: 0, b: 0, c: 1 };
  return { a: a / sum, b: b / sum, c: c / sum };
}

function inkWheelSvPoint(g, s, v) {
  const c = clamp(s, 0, 1);
  const a = clamp(v - s, 0, 1);
  const b = clamp(1 - v, 0, 1);
  return {
    x: g.A.x * a + g.B.x * b + g.C.x * c,
    y: g.A.y * a + g.B.y * b + g.C.y * c,
  };
}

/* Halka statik; yalnızca boyut değişince yeniden üretilir.
   Piksel bazlı çizim, yay parçalarının bıraktığı dikişleri önler. */
function inkWheelRing(g) {
  if (inkColorWheel.ring && inkColorWheel.ringPx === g.px) return inkColorWheel.ring;
  const cv = document.createElement('canvas');
  cv.width = cv.height = g.px;
  const c = cv.getContext('2d');
  const img = c.createImageData(g.px, g.px);
  const data = img.data;

  // 0.1° çözünürlüklü ton tablosu; piksel başına string dönüşümü yok.
  // FAZ 3-3: halka kimliği eski HSV saf ton tanımıyla birebir aynıdır
  // (görsel devamlılık); bu nedenle gamma düzlemde kalır.
  const N = 3600;
  const table = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) {
    const rgb = inkHsvSectorRgb((i / N) * 360);
    table[i * 3] = rgb.r;
    table[i * 3 + 1] = rgb.g;
    table[i * 3 + 2] = rgb.b;
  }

  const outer = g.outer;
  const inner = g.inner;
  for (let py = 0; py < g.px; py++) {
    const y = (py + 0.5) / g.dpr;
    const dy = y - g.cy;
    for (let px = 0; px < g.px; px++) {
      const x = (px + 0.5) / g.dpr;
      const dx = x - g.cx;
      const d = Math.hypot(dx, dy);
      if (d > outer + 1 || d < inner - 1) continue;
      // İç/dış kenarda 1 css px yumuşak geçiş.
      const alpha = Math.min(outer - d + 0.5, d - inner + 0.5, 1);
      if (alpha <= 0) continue;
      let ang = Math.atan2(dy, dx);
      if (ang < 0) ang += Math.PI * 2;
      const idx = (Math.round((ang / (Math.PI * 2)) * N) % N) * 3;
      const i = (py * g.px + px) * 4;
      data[i] = table[idx];
      data[i + 1] = table[idx + 1];
      data[i + 2] = table[idx + 2];
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  c.putImageData(img, 0, 0);

  // Keskin iç/dış kenarlar.
  c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  c.beginPath();
  c.arc(g.cx, g.cy, outer - 0.75, 0, Math.PI * 2);
  c.lineWidth = 1.5;
  c.strokeStyle = 'rgba(255,255,255,.22)';
  c.stroke();
  c.beginPath();
  c.arc(g.cx, g.cy, inner + 0.75, 0, Math.PI * 2);
  c.lineWidth = 1.25;
  c.strokeStyle = 'rgba(0,0,0,.45)';
  c.stroke();
  inkColorWheel.ring = cv;
  inkColorWheel.ringPx = g.px;
  return cv;
}

/* Üçgen yalnızca ton değişince yeniden üretilir. FAZ 3-3: piksel rengi
   barycentric ağırlıkların OKLCH'de karışımıdır —
     A beyaz {l:1, c:0} · B siyah {l:0, c:0} · C saf ton {corner.l, corner.c}
   Eski gamma-düzlem karışımı (a·255 + c·hueRgb) üçgen ortasını muhallebi
   yaparken; OKLCH-L karışımı aynı uçları koyu doygun orta üretir. Chroma
   ekseni köşenin Gerçek OKLCH hue'suna (okH) iner; çark açısı yalnızca
   köşe seçicidir (kırmızı köşe: çark 0° ama okH ≈ 29.2°). */
function inkWheelTriangle(g, hue) {
  if (inkColorWheel.tri && inkColorWheel.triHue === hue &&
      inkColorWheel.triPx === g.px) return inkColorWheel.tri;
  const cv = document.createElement('canvas');
  cv.width = cv.height = g.px;
  const c = cv.getContext('2d', { colorSpace: 'srgb' });
  const corner = inkWheelPureCorner(hue);
  const xs = [g.A.x, g.B.x, g.C.x];
  const ys = [g.A.y, g.B.y, g.C.y];
  const x0 = Math.max(0, Math.floor(Math.min(...xs) * g.dpr) - 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys) * g.dpr) - 1);
  const x1 = Math.min(g.px, Math.ceil(Math.max(...xs) * g.dpr) + 1);
  const y1 = Math.min(g.px, Math.ceil(Math.max(...ys) * g.dpr) + 1);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const img = c.createImageData(w, h);
  const data = img.data;
  for (let py = 0; py < h; py++) {
    const y = (y0 + py + 0.5) / g.dpr;
    for (let px = 0; px < w; px++) {
      const x = (x0 + px + 0.5) / g.dpr;
      const b = inkWheelBary(x, y, g);
      const edge = Math.min(b.a, b.b, b.c);
      if (edge < -0.004) continue;
      // Kenarda 1 px yumuşak geçiş; içeride tam opak.
      const alpha = Math.max(0, Math.min(1, edge * 260));
      const sum = b.a + b.b + b.c || 1;
      const na = Math.max(0, b.a / sum);   // beyaz payı → L'e eklenir
      const nc = Math.max(0, b.c / sum);   // saf ton payı → L ve chroma
      // siyah payı (nb) OKLCH-L katkısı 0: l yalnız na + nc·corner.l
      const rgbB = inkOkLchToBytes(na + nc * corner.l, nc * corner.c, corner.okH);
      const i = (py * w + px) * 4;
      data[i] = rgbB.r;
      data[i + 1] = rgbB.g;
      data[i + 2] = rgbB.b;
      data[i + 3] = alpha * 255;
    }
  }
  c.putImageData(img, x0, y0);
  inkColorWheel.tri = cv;
  inkColorWheel.triHue = hue;
  inkColorWheel.triPx = g.px;
  return cv;
}

function inkWheelHandle(ctx, x, y, r, fill) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.42)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.26);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r + ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,.52)';
  ctx.stroke();
  ctx.restore();
}

function inkWheelDraw() {
  if (typeof inkCpWheelVisible === 'function' && !inkCpWheelVisible()) return;
  const canvas = inkUi.els.wheelCanvas;
  const g = inkWheelGeometry();
  if (!canvas || !g) return;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, g.px, g.px);
  ctx.drawImage(inkWheelRing(g), 0, 0);
  ctx.drawImage(inkWheelTriangle(g, inkColorWheel.h), 0, 0);

  const a = inkColorWheel.h * Math.PI / 180;
  const hr = (g.outer + g.inner) / 2;
  inkWheelHandle(
    ctx,
    (g.cx + Math.cos(a) * hr) * g.dpr,
    (g.cy + Math.sin(a) * hr) * g.dpr,
    8 * g.dpr,
    inkWheelPureCorner(inkColorWheel.h).hex
  );
  const p = inkWheelSvPoint(g, inkColorWheel.s, inkColorWheel.v);
  inkWheelHandle(
    ctx,
    p.x * g.dpr,
    p.y * g.dpr,
    7.5 * g.dpr,
    inkWheelStateToHex(inkColorWheel.h, inkColorWheel.s, inkColorWheel.v)
  );
}

function inkWheelSetInput(el, value) {
  if (!el || document.activeElement === el) return;
  el.value = value;
}

function inkWheelSyncInputs(hex) {
  const els = inkUi.els;
  /* FAZ 3-3: RGB girişleri artık hex'in baytlarının birebir kendisi
     (eski hexToHsv→hsvToRgbTriplet gidiş-dönüş aynı sonucu veriyordu;
     aracı katman kaldırıldı). */
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0;
  inkWheelSetInput(els.wheelHexInput, hex.toUpperCase());
  inkWheelSetInput(els.wheelR, String((n >> 16) & 255));
  inkWheelSetInput(els.wheelG, String((n >> 8) & 255));
  inkWheelSetInput(els.wheelB, String(n & 255));
  if (els.wheelPrev) els.wheelPrev.style.background = hex;
  if (els.wheelHex) els.wheelHex.textContent = hex.toUpperCase();
}

function inkSyncColorWheel(updatePickers = true) {
  const els = inkUi.els;
  if (!els.wheelCanvas) return;
  const hex = inkState().color || '#ff5a5f';
  if (updatePickers) {
    /* FAZ 3-3: durum eşlemesi OKLCH üzerinden (çark açısı = köşe
       seçici; ters çözüm inkWheelHueFromOkHue biseksiyonu). */
    const st = inkWheelClampStateStable(inkHexToWheelState(hex));
    inkColorWheel.h = st.h;
    inkColorWheel.s = st.s;
    inkColorWheel.v = st.v;
  }
  inkWheelSyncInputs(hex);
  if (typeof inkCpSync === 'function') inkCpSync(hex, updatePickers);
  if (!els.colorWheel || els.colorWheel.hidden) return;
  inkWheelDraw();
}

function inkPositionColorWheel() {
  const wheel = inkUi.els.colorWheel;
  const well = inkUi.wheelAnchor || inkUi.els.colorWell;
  if (!wheel || !well || wheel.hidden) return;
  if (wheel.dataset.psInline === '1') return;
  const a = well.getBoundingClientRect();
  const width = wheel.offsetWidth || 252;
  const height = wheel.offsetHeight || 360;
  const gap = 10;
  let left = a.right + gap;
  if (left + width > innerWidth - 8) left = a.left - width - gap;
  // Sağdaki panel sütununu örtmesin. Panel yeri değişse de gerçek dock
  // dikdörtgeni kullanılır.
  const dock = document.getElementById('inkRightDock');
  const dockRect = dock ? dock.getBoundingClientRect() : null;
  if (dockRect && dockRect.width > 1) {
    if (left + width > dockRect.left - gap) left = dockRect.left - width - gap;
  } else {
    const panel = inkUi.els.brushPanel;
    if (isPanelVisible(panel)) {
      const panelLeft = panel.offsetLeft;
      if (panelLeft > 0 && left + width > panelLeft - gap) left = panelLeft - width - gap;
    }
  }
  left = clamp(left, 8, Math.max(8, innerWidth - width - 8));
  const top = clamp(a.top + a.height / 2 - height / 2, 8, Math.max(8, innerHeight - height - 8));
  wheel.style.left = Math.round(left) + 'px';
  wheel.style.top = Math.round(top) + 'px';
}

function inkOpenColorWheel(anchor) {
  const wheel = inkUi.els.colorWheel;
  if (!wheel) return;
  if (wheel.dataset.psInline === '1') {
    showPanel(wheel);
    inkSyncColorWheel(false);
    requestAnimationFrame(() => inkSyncColorWheel(false));
    return;
  }
  inkUi.wheelAnchor = anchor || inkUi.els.colorWell || null;
  const st = inkWheelClampStateStable(
    inkHexToWheelState(inkState().color || '#ff5a5f'));
  inkColorWheel.h = st.h;
  inkColorWheel.s = st.s;
  inkColorWheel.v = st.v;
  showPanel(wheel);
  inkSyncColorWheel(false);
  inkPositionColorWheel();
  requestAnimationFrame(() => {
    inkSyncColorWheel(false);
    inkPositionColorWheel();
  });
  if (inkUi.els.colorWell) inkUi.els.colorWell.setAttribute('aria-expanded', 'true');
}

function inkCloseColorWheel() {
  const wheel = inkUi.els.colorWheel;
  if (!wheel) return;
  inkColorWheel.dragging = '';
  inkColorWheel.pointerId = null;
  if (wheel.dataset.psInline === '1') {
    // Çizim kabuğunda çark sağdaki renk kartının kalıcı parçasıdır.
    showPanel(wheel);
    return;
  }
  inkUi.wheelAnchor = null;
  hidePanel(wheel);
  if (inkUi.els.colorWell) inkUi.els.colorWell.setAttribute('aria-expanded', 'false');
}

/** Açık geçici panelleri (fırça, renk çarkı, flyout) kapatır.
    Katman paneli kalıcıdır; burada kapatılmaz. */
function inkCloseTransientUi() {
  let closed = false;
  if (inkUi.flyout) { inkCloseFlyout(); closed = true; }
  if (isPanelVisible(inkUi.els.colorWheel) && inkUi.els.colorWheel.dataset.psInline !== '1') { inkCloseColorWheel(); closed = true; }
  if (isPanelVisible(inkUi.els.brushPanel)) {
    hidePanel(inkUi.els.brushPanel);
    inkSyncBrushPanelState();
    closed = true;
  }
  if (closed) inkSyncUI();
  return closed;
}

function inkWheelLocalPoint(event, g) {
  const r = inkUi.els.wheelCanvas.getBoundingClientRect();
  const sx = g.css / Math.max(1, r.width);
  const sy = g.css / Math.max(1, r.height);
  return {
    x: (event.clientX - r.left) * sx,
    y: (event.clientY - r.top) * sy,
  };
}

function inkWheelHit(x, y, g) {
  const d = Math.hypot(x - g.cx, y - g.cy);
  if (d >= g.inner - 4 && d <= g.outer + 4) return 'ring';
  const w = inkWheelBary(x, y, g);
  return Math.min(w.a, w.b, w.c) >= -0.03 ? 'sv' : '';
}

function inkWheelApply(event, mode) {
  const g = inkWheelGeometry();
  if (!g) return;
  const p = inkWheelLocalPoint(event, g);
  if (mode === 'ring') {
    const ang = Math.atan2(p.y - g.cy, p.x - g.cx);
    inkColorWheel.h = ((ang * 180 / Math.PI) + 360) % 360;
  } else if (mode === 'sv') {
    const w = inkWheelClampBary(inkWheelBary(p.x, p.y, g));
    inkColorWheel.s = clamp(w.c, 0, 1);
    inkColorWheel.v = clamp(w.c + w.a, 0, 1);
  } else {
    return;
  }
  inkSetColor(inkWheelStateToHex(inkColorWheel.h, inkColorWheel.s, inkColorWheel.v), false);
}

function inkWheelApplyHex(raw, save = true) {
  let v = String(raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) {
    v = v.split('').map(ch => ch + ch).join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(v)) return false;
  const hex = '#' + v.toLowerCase();
  const st = inkWheelClampStateStable(inkHexToWheelState(hex));
  inkColorWheel.h = st.h;
  inkColorWheel.s = st.s;
  inkColorWheel.v = st.v;
  inkSetColor(hex, save);
  return true;
}

function inkWheelApplyRgb(save = false) {
  const els = inkUi.els;
  if (!els.wheelR || !els.wheelG || !els.wheelB) return false;
  const vals = [els.wheelR.value, els.wheelG.value, els.wheelB.value];
  if (vals.some(v => String(v).trim() === '')) return false;
  const rgb = vals.map(v => Math.round(clamp(Number(v), 0, 255)));
  if (rgb.some(v => !Number.isFinite(v))) return false;
  const hex = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  return inkWheelApplyHex(hex, save);
}

function inkBindColorWheel() {
  const els = inkUi.els;
  const toggleWheel = (anchor, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (isPanelVisible(els.colorWheel)) inkCloseColorWheel();
    else inkOpenColorWheel(anchor);
  };
  if (els.colorWell) {
    els.colorWell.addEventListener('click', event => toggleWheel(els.colorWell, event));
  }

  const canvas = els.wheelCanvas;
  if (canvas) {
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const g = inkWheelGeometry();
      if (!g) return;
      const p = inkWheelLocalPoint(event, g);
      const mode = inkWheelHit(p.x, p.y, g);
      if (!mode) return;
      event.preventDefault();
      event.stopPropagation();
      inkColorWheel.dragging = mode;
      inkColorWheel.pointerId = event.pointerId;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
      inkWheelApply(event, mode);
    });
    canvas.addEventListener('pointermove', event => {
      if (!inkColorWheel.dragging) return;
      if (inkColorWheel.pointerId !== null && event.pointerId !== inkColorWheel.pointerId) return;
      if (event.buttons !== undefined && (event.buttons & 1) === 0) return;
      event.preventDefault();
      inkWheelApply(event, inkColorWheel.dragging);
    });
    const end = event => {
      if (!inkColorWheel.dragging) return;
      inkColorWheel.dragging = '';
      inkColorWheel.pointerId = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
      scheduleSave();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  if (els.wheelHexInput) {
    const commit = () => {
      if (!inkWheelApplyHex(els.wheelHexInput.value)) inkSyncColorWheel(false);
    };
    els.wheelHexInput.addEventListener('change', commit);
    els.wheelHexInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit();
      els.wheelHexInput.blur();
    });
  }

  [els.wheelR, els.wheelG, els.wheelB].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => { inkWheelApplyRgb(false); });
    el.addEventListener('change', () => { if (inkWheelApplyRgb(true)) scheduleSave(); });
    el.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      el.blur();
    });
  });

  document.addEventListener('pointerdown', event => {
    if (!isPanelVisible(inkUi.els.colorWheel)) return;
    if (inkUi.els.colorWheel.dataset.psInline === '1') return;
    const t = event.target instanceof Element ? event.target : null;
    if (!t) return;
    if (t.closest('#inkColorWheel') || t.closest('#inkColorWell')) return;
    inkCloseColorWheel();
  }, true);
  window.addEventListener('resize', () => {
    if (!isPanelVisible(inkUi.els.colorWheel)) return;
    inkColorWheel.ring = null;
    inkColorWheel.tri = null;
    inkSyncColorWheel(false);
    if (inkUi.els.colorWheel.dataset.psInline === '1') return;
    inkPositionColorWheel();
  });
}

function inkRenderPresets() {
  // Hızlı şerit artık yerel fırça kütüphanesinin S eğrisi kartlarını
  // kullanır; eski renkli nokta listesi kaldırıldı.
  if (typeof inkRenderNativeQuickBrushes === 'function') {
    inkRenderNativeQuickBrushes();
    return;
  }
  const list = inkUi.els.presetList;
  if (!list) return;
  const ink = inkState();
  list.replaceChildren();
  for (const brush of ink.brushes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkPreset' + (brush.id === ink.brushId ? ' active' : '');
    btn.title = brush.name;
    btn.dataset.brushId = brush.id;
    const swatch = document.createElement('i');
    swatch.className = 'inkPresetDot';
    // Düz renk: gradyan yok. ABR uçları nötr maviyle işaretlenir.
    swatch.style.background = brush.kind === 'abr' ? '#8fd7ff' : inkState().color;
    const label = document.createElement('span');
    label.textContent = brush.name;
    btn.append(swatch, label);
    btn.addEventListener('click', () => {
      if (typeof setActiveBrush === 'function') setActiveBrush(brush.id);
      else inkSetTool(ink.tool === 'eraser' ? 'eraser' : ink.tool === 'pencil' ? 'pencil' : 'brush', { brushId: brush.id });
      inkPreviewBrush();
      inkSyncUI();
    });
    list.appendChild(btn);
  }
}

function inkPreviewBrush() {
  const ink = inkState();
  const brush = inkGetBrush(ink.brushId);

  const paint = (canvas, opts) => {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || opts.fallbackW;
    const cssH = canvas.clientHeight || opts.fallbackH;
    if (!cssW || !cssH) return;
    if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
    if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const points = [];
    const midY = cssH / 2;
    const curve = clamp(Number(ink.pressureCurve) || 1, 0.2, 3);
    const inset = opts.inset;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      points.push({
        x: inset + t * (cssW - inset * 2),
        y: midY + Math.sin(t * Math.PI * 2) * (cssH * 0.18),
        p: inkCurvePressure(0.15 + Math.sin(t * Math.PI) * 0.85, curve),
        // Önizlemede sürat soldan sağa artar: hız incelmesi açıksa
        // çizginin sonu belirgin şekilde incelir.
        s: t,
      });
    }
    // Boyut ayarı önizlemeye yansımalı. 1..300 dünya birimini tuval
    // yüksekliğine sığdırırken küçük fırçaların görünür kalması için
    // karekök ölçek kullan.
    const previewMax = Math.max(6, cssH * opts.maxRatio);
    const sizeT = Math.sqrt(clamp(ink.size, 1, 300) / 300);
    const previewSize = clamp(2 + sizeT * (previewMax - 2), 1.5, previewMax);
    const preview = {
      kind: 'stroke',
      tool: 'brush',
      color: ink.color,
      size: 1,
      opacity: ink.opacity,
      hardness: ink.hardness,
      spacing: ink.spacing,
      speedSize: ink.speedSize,
      brushId: ink.brushId,
      scatter: brush ? brush.scatter : 0,
      points,
    };
    inkDrawStrokeOnContext(ctx, preview, {
      mapPoint: p => ({ x: p.x, y: p.y }),
      sizePx: previewSize,
    });
  };

  paint(inkUi.els.brushPreview, { fallbackW: 240, fallbackH: 64, inset: 16, maxRatio: 0.72 });

  if (inkUi.els.brushName) inkUi.els.brushName.textContent = brush ? brush.name : 'Brush';
}

/* =========================================================
   katman paneli
   ========================================================= */
function inkLayerRefreshPreview() {
  inkSyncDom();
  if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
  if (typeof inkEditorLiveOverlaySync === 'function') inkEditorLiveOverlaySync();
}

function inkLayerSelectedForControls() {
  const docId = typeof inkDocOwnerId === 'function' ? inkDocOwnerId() : null;
  if (docId && typeof inkDocSelectedLayer === 'function') {
    return inkDocSelectedLayer(docId) || inkActiveLayer();
  }
  return inkActiveLayer();
}

function inkBindLayersPanel() {
  const els = inkUi.els;
  const addGlobal = document.getElementById('btnInkAddLayer');
  const addAttached = document.getElementById('btnInkAddAttached');
  const del = document.getElementById('btnInkDeleteLayer');
  const up = document.getElementById('btnInkLayerUp');
  const down = document.getElementById('btnInkLayerDown');

  // Belge katman yığını: ekleme/silme/sıralama tek kaynaktan yürür.
  if (addGlobal) addGlobal.addEventListener('click', e => {
    e.preventDefault();
    inkDocAddLayer();
  });

  if (addAttached) addAttached.addEventListener('click', e => {
    e.preventDefault();
    inkDocAddLayer();
  });

  if (del) del.addEventListener('click', e => {
    e.preventDefault();
    inkDocDeleteOrClearLayer();
  });

  if (up) up.addEventListener('click', e => {
    e.preventDefault();
    inkDocMoveLayer(null, 1);
  });
  if (down) down.addEventListener('click', e => {
    e.preventDefault();
    inkDocMoveLayer(null, -1);
  });

  if (els.layerOpacity) {
    els.layerOpacity.addEventListener('pointerdown', () => pushUndo(), { once: false });
    els.layerOpacity.addEventListener('input', () => {
      const layer = inkLayerSelectedForControls();
      if (!layer) return;
      layer.opacity = clamp(Number(els.layerOpacity.value) / 100, 0, 1);
      if (els.layerOpacityVal) els.layerOpacityVal.textContent = Math.round(layer.opacity * 100) + '%';
      inkLayerRefreshPreview();
    });
    els.layerOpacity.addEventListener('change', () => scheduleSave());
  }

  if (els.layerBlend) {
    els.layerBlend.addEventListener('change', () => {
      const layer = inkLayerSelectedForControls();
      if (!layer) return;
      pushUndo();
      layer.blend = INK_BLEND_MODES.includes(els.layerBlend.value) ? els.layerBlend.value : 'normal';
      inkLayerRefreshPreview();
      scheduleSave();
    });
  }

  if (els.layerPlane) {
    els.layerPlane.addEventListener('change', () => {
      const layer = inkLayerSelectedForControls();
      if (!layer || layer.kind !== 'global') return;
      pushUndo();
      layer.plane = els.layerPlane.checked ? 'above' : 'below';
      inkLayerRefreshPreview();
      scheduleSave();
    });
  }

  if (els.layerLock) {
    els.layerLock.addEventListener('change', () => {
      const layer = inkActiveLayer();
      if (!layer) return;
      pushUndo();
      layer.locked = els.layerLock.checked;
      inkSyncLayersPanel();
      scheduleSave();
    });
  }

  if (typeof inkLayerPanelEnhance === 'function') inkLayerPanelEnhance();
  if (typeof inkLayerShortcutsBound === 'function') inkLayerShortcutsBound();
}

function inkScopedImageItem() {
  for (const id of selection) {
    const it = getItem(id);
    if (it && it.kind === 'image') return it;
  }
  const active = inkActiveLayer();
  if (active && active.kind === 'attached') return getItem(active.ownerId);
  return null;
}

/* 32 px katman küçük görselleri önbelleklenir. Küçük görseli her panel
   tazelemesinde yeniden üretmek, 3000 vuruşlu bir katmanda geri almayı
   yüzlerce ms bekletiyordu. İmza katmanın boya dönemini (epoch) ve vuruş
   sayısını içerir; değişince görsel boşta yeniden boyanır. */
const inkLayerThumbCache = new Map(); // layerId -> { canvas, sig, paintedSig, retries }
const inkLayerThumbQueue = new Set();
let inkLayerThumbTimer = 0;
const INK_LAYER_THUMB_SIZE = 32;

function inkLayerThumbSignature(layer) {
  const epoch = typeof inkPaintEpoch === 'function' ? inkPaintEpoch(layer.id) : 0;
  let sig = layer.kind + '|' + (layer.ownerId || '') + '|' +
    (layer.strokes ? layer.strokes.length : 0) + '|' + epoch;
  if (layer.kind === 'attached') {
    const src = inkRuntime.itemCanvases.get(layer.id);
    sig += '|' + (src ? src.width + 'x' + src.height : '0');
  } else if (layer.kind === 'group') {
    /* FAZ 1 (gruplar): klasör önizlemesi üyelerinin birleşiminden doğar —
       üye listesi (üyelik), görünürlük ve boyama epoch'u imzayı taşır;
       üye boyandıkça klasör döşemesi tazelenir. */
    const members = typeof inkOwnerStackLayers === 'function'
      ? inkOwnerStackLayers(layer.ownerId).filter(
          l => l.kind === 'attached' && l.parentId === layer.id)
      : [];
    sig += '|' + members.length + '|' + members.map(m =>
      m.id + (m.clip ? 'C' : '') + (m.visible === false ? 'h' : 'v') + ':' +
      (typeof inkPaintEpoch === 'function' ? inkPaintEpoch(m.id) : 0)
    ).join(',');
  } else {
    let tiles = 0;
    for (const tile of inkRuntime.tiles.values()) {
      if (tile.layerId === layer.id) tiles += 1;
    }
    sig += '|' + tiles;
  }
  return sig;
}

/* FAZ 8.D — katman yaşam sonu: minyatür + bbox önbelleği bırakılır.
   inkLayerDispose (50-layer-stack) dağıtır; panel sync'inin GC
   süpürmesi de aynı tek noktayı kullanır. */
function inkLayerThumbRelease(layerId) {
  inkLayerThumbCache.delete(layerId);
  inkLayerThumbBBox.delete(layerId);
}

/* K6 · Önizlemeyi boyaya yakınlaştır: vuruş noktaları ortak lokal 0..1
   uzayındadır; katman tuvali (pxW×pxH) aynı ölçekte olduğu için sınırlar
   tuval pikseline bire bir gider. Büyük vuruş kuyruklarında maliyeti
   sınırlamak için sonuç vuruş sayısı + tuval boyuyla önbelleklenir;
   son 400 vuruşa kadar her tazelemede taze hesaplanır (deforme-öncesi
   doğruluk). Kırpma, tuval kısa kenarının en az %12'sini kapsar ki
   tekil küçük boyamada bağlam tamamen kaybolmasın. */
const inkLayerThumbBBox = new Map(); // layerId -> { count, pxW, pxH, box }

function inkThumbCropBox(layer) {
  const strokes = layer.strokes || [];
  if (!strokes.length || !layer.pxW || !layer.pxH) return null;
  const cached = inkLayerThumbBBox.get(layer.id);
  if (cached && cached.count === strokes.length &&
      cached.pxW === layer.pxW && cached.pxH === layer.pxH) {
    if (cached.box) return cached.box;
    if (cached.boxed === false) return null;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let reach = 0;
  for (const s of strokes) {
    const pts = s.points;
    if (!pts || !pts.length) continue;
    if (s.kind === 'gradient' || s.kind === 'fill') return null; // tam katman boyar
    reach = Math.max(reach, Math.max(0, (s.size || 1)) * 0.75);
    for (const p of pts) {
      const wx = p.x * layer.pxW;
      const wy = p.y * layer.pxH;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
  }
  let box = null;
  if (Number.isFinite(minX)) {
    const pad = Math.max(reach * layer.pxW * 0.5, layer.pxW * 0.015, 4);
    box = {
      x: minX - pad, y: minY - pad,
      w: maxX - minX + pad * 2, h: maxY - minY + pad * 2,
    };
  }
  inkLayerThumbBBox.set(layer.id, {
    count: strokes.length, pxW: layer.pxW, pxH: layer.pxH,
    box, boxed: Number.isFinite(minX),
  });
  return box;
}

function inkPaintLayerThumb(entry, layer, sig) {
  const size = INK_LAYER_THUMB_SIZE;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = entry.canvas;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = 3;
  const avail = size - pad * 2;

  if (layer.kind === 'attached') {
    const src = inkRuntime.itemCanvases.get(layer.id);
    if (src && src.width > 0 && src.height > 0) {
      // K6 · boyaya yakınlaştır: küçük vuruş tüm tuvali sığdırınca tek
      // piksel nokta kalıyordu; kırpma rect'i vuruş sınırlarından gelir.
      const crop = inkThumbCropBox(layer);
      if (crop) {
        const minSide = Math.max(src.width, src.height) * 0.12;
        const cw = Math.max(1, Math.min(src.width, Math.max(crop.w, minSide)));
        const ch = Math.max(1, Math.min(src.height, Math.max(crop.h, minSide)));
        const cx = clamp(crop.x + crop.w / 2 - cw / 2, 0, Math.max(0, src.width - cw));
        const cy = clamp(crop.y + crop.h / 2 - ch / 2, 0, Math.max(0, src.height - ch));
        const s = Math.min(avail / cw, avail / ch);
        const w = cw * s;
        const h = ch * s;
        ctx.drawImage(src, cx, cy, cw, ch, (size - w) / 2, (size - h) / 2, w, h);
      } else {
        const s = Math.min(avail / src.width, avail / src.height);
        const w = src.width * s;
        const h = src.height * s;
        ctx.drawImage(src, (size - w) / 2, (size - h) / 2, w, h);
      }
    }
    entry.paintedSig = sig;
    inkThumbRetryIfEmpty(entry, layer, sig);
    return;
  }

  // FAZ 1 (gruplar): klasör düzleminin önizlemesi birleşik rasterdır —
  // ekranın kullandığı AYNI plan girişi + entry canvas yolu.
  if (layer.kind === 'group') {
    let raster = null;
    if (typeof inkAttachedDisplayPlan === 'function' && layer.ownerId) {
      const plan = inkAttachedDisplayPlan(layer.ownerId);
      const hit = plan.find(e => e.base && e.base.id === layer.id);
      if (hit && typeof inkCompositeEntryCanvas === 'function') {
        raster = inkCompositeEntryCanvas(hit, null);
      }
    }
    if (raster && raster.width > 0 && raster.height > 0) {
      const s = Math.min(avail / raster.width, avail / raster.height);
      const w = raster.width * s;
      const h = raster.height * s;
      ctx.drawImage(raster, (size - w) / 2, (size - h) / 2, w, h);
    }
    entry.paintedSig = sig;
    inkThumbRetryIfEmpty(entry, layer, sig);
    return;
  }

  // Global katmanda vuruşları taramak yerine mevcut karoların
  // kapsamını kullan: 3000 vuruşlu sahnede bile maliyet karo sayısıyla
  // sınırlı kalır.
  const tileSize = typeof INK_TILE_SIZE === 'number' ? INK_TILE_SIZE : 512;
  let minTx = Infinity, minTy = Infinity, maxTx = -Infinity, maxTy = -Infinity;
  for (const tile of inkRuntime.tiles.values()) {
    if (tile.layerId !== layer.id) continue;
    if (tile.tx < minTx) minTx = tile.tx;
    if (tile.ty < minTy) minTy = tile.ty;
    if (tile.tx > maxTx) maxTx = tile.tx;
    if (tile.ty > maxTy) maxTy = tile.ty;
  }
  if (!Number.isFinite(minTx) || !Number.isFinite(minTy)) {
    entry.paintedSig = sig;
    return;
  }
  const bw = (maxTx - minTx + 1) * tileSize;
  const bh = (maxTy - minTy + 1) * tileSize;
  const s = Math.min(avail / bw, avail / bh);
  const ox = (size - bw * s) / 2;
  const oy = (size - bh * s) / 2;
  for (const tile of inkRuntime.tiles.values()) {
    if (tile.layerId !== layer.id) continue;
    const x = ox + (tile.tx - minTx) * tileSize * s;
    const y = oy + (tile.ty - minTy) * tileSize * s;
    ctx.drawImage(tile.canvas, x, y, tileSize * s, tileSize * s);
  }
  entry.paintedSig = sig;
  inkThumbRetryIfEmpty(entry, layer, sig);
}

/* K6 · Katman önizlemesi boş kalırsa sınırlı yeniden dene.
   Kök: imza (vuruş sayısı + boyama dönemi) commit'te hemen değişir ama
   katman/küre raster'ı asenkron pişer; ilk boyama boş kaynağa denk
   gelirse paintedSig kilitleniyor ve önizleme sonsuza dek boş kalıyordu.
   32px tuvaldeki taranma ucuz (≤1024 piksel); kaynak pişince nz>0 olur,
   deneme kotası sıfırlanır ve imza kilitlenir. */
function inkThumbRetryIfEmpty(entry, layer, sig) {
  const hasInk = (layer.strokes && layer.strokes.length > 0) ||
    (typeof inkPaintEpoch === 'function' ? inkPaintEpoch(layer.id) > 0 : false);
  if (!hasInk) {
    /* Boya hiç yokken boşluk normaldir; ayrıca "doğrulanmış dolu" kilidi
       açılır — tüm vuruşlar geri alınca sonraki boyama yeniden taranır. */
    entry.verifiedInk = false;
    return;
  }
  /* DÜZELTME (profiler bulgusu): bu tarama boyama sırasında panel her
     tazelendiğinde koşuyordu — 32×32 getImageData küçük ama ÇAĞRI BAŞINA
     GPU geri-okuma senkronludur; 50 vuruşluk probe'da 1654 çağrı ≈ saniyeler
     harcıyordu. Boya bir kez görüldüyse 400 ms'de bir en fazla bir tarama:
     K6'nın "boş-progress kilit aç" görevi pencere içinde korunur. */
  const now = performance.now();
  if (entry.verifiedInk && now - (entry.lastVerify || 0) < 400) return;
  entry.lastVerify = now;
  /* Vuruş AKTİFKEN önizleme kaynağı (katman kanıvası) henüz pişmemiş
     olur: tarama etrafı boş bulur, verifiedInk kurulmaz ve her panel
     zafağında yeniden taranır (probe: 1633 çağrı ≈ saniyeler). Vuruş
     süresince taramayı koşturma; commit bake'i dolu kaynağı bırakır,
     boşta kalan ilk tarama tek seferde doğrular. */
  const cUi = (typeof inkEditorUi !== 'undefined' && inkEditorUi) ? inkEditorUi : null;
  if (cUi && cUi.stroke) return;
  const ctx = entry.canvas.getContext('2d');
  if (!ctx) return;
  const w = entry.canvas.width;
  const h = entry.canvas.height;
  if (!w || !h) return;
  const d = ctx.getImageData(0, 0, w, h).data;
  let nz = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 24) nz += 1;
  if (nz > 0) {
    entry.retries = 0;
    entry.verifiedInk = true;
    return;
  }
  // Kilit açık bırak: kaynak piştiğinde bir sonraki tarama boyayabilir.
  entry.paintedSig = '';
  if ((entry.retries || 0) >= 3) return;
  entry.retries = (entry.retries || 0) + 1;
  inkQueueLayerThumb(layer.id);
}

function inkFlushLayerThumbs() {
  inkLayerThumbTimer = 0;
  const ids = [...inkLayerThumbQueue];
  inkLayerThumbQueue.clear();
  for (const id of ids) {
    const layer = typeof inkLayerById === 'function' ? inkLayerById(id) : null;
    const entry = inkLayerThumbCache.get(id);
    if (!layer || !entry) continue;
    const sig = inkLayerThumbSignature(layer);
    if (sig === entry.paintedSig) continue;
    entry.retries = 0; // imza değişti: yeni boyama dönemi için kotayı sıfırla.
    entry.sig = sig;
    inkPaintLayerThumb(entry, layer, sig);
  }
}

function inkQueueLayerThumb(layerId) {
  inkLayerThumbQueue.add(layerId);
  if (inkLayerThumbTimer) return;
  // Boyama, geri al / vuruş commit'i gibi kritik yolların dışında kalır.
  inkLayerThumbTimer = setTimeout(inkFlushLayerThumbs, 90);
}

function inkLayerThumb(layer) {
  const size = INK_LAYER_THUMB_SIZE;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let entry = inkLayerThumbCache.get(layer.id);
  if (!entry) {
    const c = document.createElement('canvas');
    c.className = 'inkLayerThumb';
    c.width = Math.max(1, Math.round(size * dpr));
    c.height = Math.max(1, Math.round(size * dpr));
    c.setAttribute('aria-hidden', 'true');
    entry = { canvas: c, sig: '', paintedSig: '', retries: 0 };
    /* DÜZELTME (profiler bulgusu): retry-if-empty taraması bu kanvastan
       okur; küçük ama GPU senkronlu okuma ~17 ms/call idi. Yazılım
       kanvasta ~0.1 ms. İlk bağlamı willReadFrequently ile aç. */
    c.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    inkLayerThumbCache.set(layer.id, entry);
  }
  const sig = inkLayerThumbSignature(layer);
  entry.sig = sig;
  if (entry.paintedSig !== sig) inkQueueLayerThumb(layer.id);
  return entry.canvas;
}

/** K8 · maske mini görseli: maske rasterini alfa→gri ölçeğe çevirip
 *  32px kanvase çizer (gizli=pas, görünür=açık). Raster henüz çözülme-
 *  diyse maske kivrimi beyaz düzlemle başlar (varsayılan=her yer görünür). */
function inkPaintMaskThumb(canvas, layer) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const bake = (typeof inkMaskRasterCache === 'object' || typeof inkMaskRasterCache === 'function')
    ? inkMaskRasterCache.get(layer.id) : null;
  if (bake && bake.canvas) {
    ctx.drawImage(bake.canvas, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = d.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i + 3];
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

/* FAZ 8.F — klasör katlanma durumu: PANEL-düzeyi (salt görünüm).
   Motor/normalizeState dokunulmaz; katlanmış klasörün üye satırları
   listeye yansımaz. Klasör silinince ölü id temizlenir (GC, sync'te). */
const inkFolderFoldedIds = new Set();

/* FAZ 8.E — DnD/sıra FLIP: "tak" sıçramasını kayma animasyonuna çevirir.
   DOM güncellemesi ÖNCESİ her satırın top'u ("First") kaydedilir;
   güzenleme SONRASI yeni konuma ters transform ("Invert") uygulanıp
   kimliğe ("Play") yumuşatılır. İmza-diff (8.C) appendChild taşımaları
   ile tam uyumludur: yapısal değişimde (satır sayısı değişti) animasyon
   YOK — sıçrama yalnız sıra değişiminde kaymaya döner. */
function inkLayerRowsFirst(list) {
  const first = new Map();
  for (const el of list.querySelectorAll('.inkLayerRow')) {
    if (el.dataset && el.dataset.layerId) {
      first.set(el.dataset.layerId, el.getBoundingClientRect().top);
    }
  }
  return first;
}

function inkLayerRowsFlipPlay(list, first) {
  if (!first || !first.size) return;
  if (typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = list.querySelectorAll('.inkLayerRow');
  if (els.length !== first.size) return; // yapısal değişimde animasyon yok
  for (const el of els) {
    const id = el.dataset ? el.dataset.layerId : undefined;
    const before = id !== undefined ? first.get(id) : undefined;
    if (before === undefined) continue;
    const dy = before - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 2) continue;
    if (typeof el.animate === 'function') {
      const anim = el.animate(
        [{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0px)' }],
        { duration: 170, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }
      );
      if (anim && anim.finished && typeof anim.finished.catch === 'function') {
        anim.finished.catch(error => {
          // Kaldırılan satırda abort beklenir; öbür hata duyulur.
          if (!error || error.name !== 'AbortError') console.warn('FLIP animation cancel:', error);
        });
      }
    } else {
      el.style.transform = 'translateY(' + dy + 'px)';
      requestAnimationFrame(() => {
        el.style.transition = 'transform 170ms cubic-bezier(0.2,0.7,0.3,1)';
        el.style.transform = 'translateY(0px)';
        setTimeout(() => {
          el.style.transform = '';
          el.style.transition = '';
        }, 190);
      });
    }
  }
}

function inkLayerRow(layer) {
  const active = layer.id === inkState().activeLayerId;
  // K6 · Maske rozeti aynı hesabı yeniden kullanır (mask düğmesi bloğu
  // da bu değeri taşır; TDZ çağrı sırası bozulmaz).
  const maskEditing = layer.kind === 'attached' &&
    typeof inkDocMaskPendingFor === 'function' && inkDocMaskPendingFor(layer);
  const row = document.createElement('div');
  row.className = 'inkLayerRow'
    + (active ? ' active' : '')
    + (layer.locked ? ' is-locked' : '')
    + (layer.visible ? '' : ' is-hidden')
    // FAZ 1 (gruplar): klasör düzlemi ve üye satırlarını işaretle.
    + (layer.kind === 'group' ? ' is-group' : '')
    + (layer.kind === 'attached' && layer.parentId ? ' is-group-member' : '');
  row.dataset.layerId = layer.id;
  if (layer.kind === 'group') row.dataset.layerKind = 'group';
  row.draggable = true;
  row.tabIndex = 0;
  row.setAttribute('role', 'listitem');
  row.setAttribute('aria-selected', active ? 'true' : 'false');
  row.title = inkLayerDisplayName(layer)
    + (layer.kind === 'group' ? ' (folder)' : '')
    + (layer.kind === 'attached' && layer.parentId ? ' (group member)' : '')
    + ' · ' + Math.round((layer.opacity ?? 1) * 100) + '%';

  // 1 · Göz: yalnızca görünürlüğü çevirir, seçimi değiştirmez.
  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'inkLayerBtn inkLayerEye' + (layer.visible ? ' on' : '');
  eye.title = layer.visible ? __t('Hide') : __t('Show');
  eye.setAttribute('aria-label', layer.visible ? __t('Hide layer') : __t('Show layer'));
  eye.setAttribute('aria-pressed', layer.visible ? 'true' : 'false');
  eye.innerHTML = inkIcon(layer.visible ? 'ink-eye' : 'ink-eye-off');
  eye.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    inkDocSetVisible(layer.id, !layer.visible);
  });

  // 2 · 24×24 canlı önizleme.
  const thumb = inkLayerThumb(layer);
  thumb.setAttribute('aria-hidden', 'true');

  // 3 · Ad (tek satır, taşarsa üç nokta). Klasör satırları rozet taşır.
  const name = document.createElement('div');
  name.className = 'inkLayerName';
  if (layer.kind === 'group' || (layer.kind === 'attached' && layer.parentId)) {
    const badge = document.createElement('span');
    badge.className = 'inkLayerGroupBadge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = layer.kind === 'group' ? '▣ ' : '└ ';
    name.appendChild(badge);
  }
  const b = document.createElement('b');
  b.textContent = inkLayerDisplayName(layer);
  name.appendChild(b);

  // K6 (K10 düzenlemesi) · Ad alanı tek satır kalır; maske varlığı zincir +
  // mini görsel çifti (K8) ile okunur — adın yanındaki "maske ✎" hapı
  // kaldırıldı: satırı şişiriyor, zincir çifti zaten aynı bilgiyi veriyor.
  if (layer.kind === 'attached' && layer.mask) {
    // K8 · maske kanca + mini görsel çifti: maske varlığını küçük resmin
    // yanında PS-sözleşmesindeki gibi okunur kılar; çift tıklaması maske
    // düzenlemesini açar/bırakır.
    const pair = document.createElement('span');
    pair.className = 'inkLayerMaskPair' + (maskEditing ? ' is-editing' : '');
    pair.title = maskEditing ? __t('Exit mask editing') : __t('Enter mask editing');
    const chain = document.createElement('span');
    chain.className = 'inkLayerMaskChain';
    chain.setAttribute('aria-hidden', 'true');
    chain.innerHTML =
      '<svg viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="3.1" y="1.1" width="5.8" height="4.8" rx="2.4" stroke="currentColor" stroke-width="1.5"/>' +
      '<rect x="1.1" y="8.1" width="5.8" height="4.8" rx="2.4" stroke="currentColor" stroke-width="1.5"/>' +
      '</svg>';
    const maskThumb = document.createElement('canvas');
    maskThumb.className = 'inkLayerMaskThumb';
    maskThumb.width = 32;
    maskThumb.height = 32;
    maskThumb.setAttribute('aria-hidden', 'true');
    inkPaintMaskThumb(maskThumb, layer);
    pair.append(chain, maskThumb);
    pair.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof inkDocToggleMaskEdit === 'function') inkDocToggleMaskEdit(layer.id);
    });
    name.insertBefore(pair, b);
  }
  // K6 · Grup üye sayısı: klasör satırında adın yanında sade soluk sayı
  // (toka hap değil); tooltip anlamlı haldedir.
  if (layer.kind === 'group') {
    const members = typeof inkDocLayers === 'function'
      ? inkDocLayers(layer.ownerId).filter(l => l.parentId === layer.id).length
      : 0;
    const chip = document.createElement('span');
    chip.className = 'inkLayerGroupCount';
    chip.title = members + ' member layer';
    chip.textContent = String(members);
    name.appendChild(chip);
  }

  // 4 · Kilit.
  const lock = document.createElement('button');
  lock.type = 'button';
  lock.className = 'inkLayerBtn inkLayerLock' + (layer.locked ? ' is-locked' : '');
  lock.title = layer.locked ? 'Unlock' : 'Lock layer';
  lock.setAttribute('aria-label', layer.locked ? 'Unlock layer' : 'Lock layer');
  lock.setAttribute('aria-pressed', layer.locked ? 'true' : 'false');
  lock.innerHTML = inkIcon('lock');
  lock.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    pushUndo();
    layer.locked = !layer.locked;
    inkSyncLayersPanel();
    inkSyncUI();
    if (typeof dpSyncToolbar === 'function') dpSyncToolbar();
    scheduleSave();
  });

  // K8 · Kırpma maskesi görsel işareti: klip açıkken satır, altındaki
  // tabana bükük ok rozetiyle bağlanır (satır sınıfı + thumb sol-alt
  // rozeti; canvas'a pseudo-element çizilemediğinden JS elementi).
  row.classList.toggle('is-clip-member', !!layer.clip);
  if (layer.clip) {
    const clipArrow = document.createElement('span');
    clipArrow.className = 'inkLayerClipArrow';
    clipArrow.setAttribute('aria-hidden', 'true');
    clipArrow.title = 'Clipped to the layer below';
    clipArrow.innerHTML =
      '<svg viewBox="0 0 12 13" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M8.5 1v6.2a1.3 1.3 0 0 1-1.3 1.3H2.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M5.6 6.2 2.6 8.5l3 2.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      '</svg>';
    clipArrow.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const clipBtn = row.querySelector('.inkLayerClip');
      if (clipBtn) clipBtn.click();
    });
    row.appendChild(clipArrow);
  }

  // FAZ 8.F · Klasör katlama oku (chevron): salt görünüm — tık, motorlu
  // olay üretmez, yalnızca paneli yeniler (üye satırları gizlenir).
  // Boş klasörde katlanacak üye olmadığından düğme konmaz.
  let fold = null;
  if (layer.kind === 'group') {
    const members = typeof inkDocLayers === 'function'
      ? inkDocLayers(layer.ownerId).filter(l => l.parentId === layer.id).length
      : 0;
    if (members > 0) {
      const folded = inkFolderFoldedIds.has(layer.id);
      fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'inkLayerBtn inkLayerFold' + (folded ? ' is-folded' : '');
      fold.title = folded ? 'Open folder' : 'Collapse folder';
      fold.setAttribute('aria-label', fold.title);
      fold.setAttribute('aria-expanded', folded ? 'false' : 'true');
      fold.innerHTML =
        '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M2.6 4.4 6 8l3.4-3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
      fold.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (inkFolderFoldedIds.has(layer.id)) inkFolderFoldedIds.delete(layer.id);
        else inkFolderFoldedIds.add(layer.id);
        inkSyncLayersPanel();
      });
    }
  }

  row.append(eye, thumb, name, lock);
  if (fold) row.insertBefore(fold, name);

  // 5 · Alfa kilidi ve kırpma maskesi: yalnızca görsel katmanları için.
  // Motor (53-ink-compositor.js) hazır; bu anahtarlar arayüz kolu.
  if (layer.kind === 'attached') {
    const alphaLock = document.createElement('button');
    alphaLock.type = 'button';
    const alphaOn = !!layer.alphaLock;
    alphaLock.className = 'inkLayerBtn inkLayerAlphaLock' + (alphaOn ? ' on' : '');
    alphaLock.title = alphaOn ? __t('Alpha lock on') : __t('Alpha lock off');
    alphaLock.setAttribute('aria-label', alphaLock.title);
    alphaLock.setAttribute('aria-pressed', alphaOn ? 'true' : 'false');
    alphaLock.innerHTML = inkIcon('ink-alpha-lock');
    alphaLock.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      pushUndo();
      // Katman bayrağı yeni vuruşları etkiler; eski vuruş kendi
      // lockAlpha'sını taşıdığı için pikseller bilinçli değişmez.
      layer.alphaLock = !layer.alphaLock;
      inkSyncLayersPanel();
      scheduleSave();
    });
    row.append(alphaLock);

    // Kırpma maskesi: grup üyeleri kırpılamaz (zaten klasör alfasına
    // bağlıdırlar); kalanlarda altta katman şartı korunur.
    if (!layer.parentId &&
        typeof inkCanToggleClip === 'function' && inkCanToggleClip(layer.id)) {
      const clip = document.createElement('button');
      clip.type = 'button';
      clip.className = 'inkLayerBtn inkLayerClip' + (layer.clip ? ' on' : '');
      const clipOn = !!layer.clip;
      clip.title = clipOn ? 'Detach clipping mask' : 'Clip to the layer below (clipping mask)';
      clip.setAttribute('aria-label', clip.title);
      clip.setAttribute('aria-pressed', clipOn ? 'true' : 'false');
      clip.innerHTML = inkIcon('ink-clip');
      clip.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        pushUndo();
        layer.clip = !layer.clip;
        // Grup rasterını yenile + öğenin grup tuvallerini senkron tut.
        if (typeof inkCompositeSyncItem === 'function') {
          const it = inkItemForLayer(layer);
          const el = it ? elMap.get(it.id) : null;
          if (it && el) inkCompositeSyncItem(it, el);
          else if (typeof inkCompositeInvalidate === 'function') {
            inkCompositeInvalidate(layer.ownerId);
          }
        }
        inkSyncLayersPanel();
        scheduleSave();
      });
      row.append(clip);
    }

    // FAZ 1B · Katman maskesi: maske yoksa click beyaz maske ekleyip
    // düzenlemeye geçer (sink = alfa kapatıcı); varsa düzenlemeyi aç/kapat.
    const mask = document.createElement('button');
    mask.type = 'button';
    mask.className = 'inkLayerBtn inkLayerMask'
      + (layer.mask ? ' on' : '')
      + (maskEditing ? ' is-editing' : '');
    mask.title = !layer.mask
      ? __t('Add mask (white) and start editing — Black/eraser darkens the mask (hides)')
      : maskEditing ? __t('Leave mask editing') : __t('Edit mask');
    mask.setAttribute('aria-label', mask.title);
    mask.setAttribute('aria-pressed', layer.mask ? 'true' : 'false');
    mask.innerHTML = inkIcon('ink-mask');
    mask.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      let id = null;
      if (!layer.mask) {
        const added = typeof inkDocAddMask === 'function'
          ? inkDocAddMask(layer.id, 'reveal') : null;
        id = added ? added.id : null;
      } else {
        id = typeof inkDocToggleMaskEdit === 'function' &&
          inkDocToggleMaskEdit(layer.id) ? layer.id : null;
        if (!inkState().maskEditId) id = null;
      }
      if (id) inkDocSelectLayer(id);
      inkSyncLayersPanel();
      scheduleSave();
    });
    row.append(mask);
  }

  /* Sil düğmesi — satır bazında (kullanıcı isteği: "panelin oraya").
     inkDocDeleteOrClearLayer: silinbilen katmanı siler; son çizim
     katmanındaysa içeriğini temizler; Undo her iki yolla çalışır. */
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'inkLayerBtn inkLayerDel';
  del.title = __t('Delete layer · clears the drawing if it is the last drawing layer');
  del.setAttribute('aria-label', __t('Delete layer'));
  del.innerHTML = inkIcon('trash');
  del.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof inkDocDeleteOrClearLayer === 'function') inkDocDeleteOrClearLayer(layer.id);
    else if (typeof inkDocDeleteLayer === 'function') inkDocDeleteLayer(layer.id);
  });
  row.append(del);

  row.addEventListener('click', ev => {
    if (ev.target.closest('button, input, select, label, textarea')) return;
    inkDocSelectLayer(layer.id);
  });
  row.addEventListener('focus', () => {
    if (inkState().activeLayerId !== layer.id) inkDocSelectLayer(layer.id);
  });
  return row;
}

/* FAZ 8.C — satır imzası: yeniden kurulmayıp TUTULUP güncellenecek
   satırın tüm görünüm girdileri. İmza aynıysa DOM düğümü korunur
   (seçim/is/{kilit,görünürlük,klip,maske} geçişleriyle yalnız değişen
   satır yenilenir; küçük görsel önbelleği imzayla bağlantılı). */
function inkLayerRowSig(layer, active) {
  const members = layer.kind === 'group' && typeof inkDocLayers === 'function'
    ? inkDocLayers(layer.ownerId).filter(l => l.parentId === layer.id).length
    : 0;
  const editing = layer.kind === 'attached' &&
    typeof inkDocMaskPendingFor === 'function' && inkDocMaskPendingFor(layer);
  const thumbSig = inkLayerThumbSignature(layer);
  return [
    active ? 1 : 0,
    layer.visible ? 1 : 0,
    layer.locked ? 1 : 0,
    layer.kind,
    layer.parentId || '',
    layer.clip ? 1 : 0,
    layer.alphaLock ? 1 : 0,
    layer.mask ? 1 : 0,
    editing ? 1 : 0,
    layer.name,
    Math.round((layer.opacity ?? 1) * 100),
    thumbSig,
    members,
  ].join('|');
}

function inkSyncLayersPanel() {
  const list = inkUi.els.layerList;
  if (!list) return;

  const docId = typeof inkDocOwnerId === 'function' ? inkDocOwnerId() : null;
  let rows = [];
  if (docId && typeof inkDocEnsure === 'function') {
    inkDocEnsure(docId);
    rows = inkDocLayersTopFirst(docId);
  } else {
    // Belge yoksa (tahta üzerinde çizim) dünya katmanları gösterilir.
    rows = inkState().layers.filter(l => l.kind === 'global').slice().reverse();
  }

  // FAZ 8.F: katlanmış klasörün üye satırları listeye yansımaz;
  // klasörü silinen ölü id'ler durumdan temizlenir.
  if (inkFolderFoldedIds.size) {
    for (const id of [...inkFolderFoldedIds]) {
      if (typeof inkLayerById === 'function' && !inkLayerById(id)) {
        inkFolderFoldedIds.delete(id);
      }
    }
    if (docId) {
      rows = rows.filter(l => !(l.kind === 'attached' && l.parentId
        && inkFolderFoldedIds.has(l.parentId)));
    }
  }

  if (inkUi.els.layerScope) inkUi.els.layerScope.textContent = docId ? __t('Document layers') : __t('Global layers');
  if (inkUi.els.layerCount) inkUi.els.layerCount.textContent = String(rows.length);

  // FAZ 8.E İPTALİ (profiler): First+FlipPlay diff yolu içinde değişim
  // varken koşar; değişimsiz ya da tam kurulum yolunda atlanır —
  // her tazelemede tüm satırlara gBCR okuma gereksizdi.

  /* FAZ 8.C — satır-düzeyi diff v1: DOM satır kimliği katman kimliğiyle
     BÜTÜN birebir eş Yaklaşıyorsa tam kurulum YOQ — yalnız imzası
     değişen satır yenilenir; sırasız satırlar appendChild ile
     taşınır. Tam kurulum yalnız yapısal değişimde (add/remove) veya
     DIFF tetiklenememişse (satır type/açıklaması +/-) çalışır. */
  const activeId = inkState().activeLayerId;
  const byId = new Map();
  let diffable = rows.length === list.children.length;
  if (diffable) {
    for (const el of list.children) {
      const id = el.dataset && el.dataset.layerId;
      if (!id || byId.has(id)) { diffable = false; break; }
      byId.set(id, el);
    }
  }
  if (diffable) {
    for (const layer of rows) {
      if (!byId.has(layer.id)) { diffable = false; break; }
    }
  }

  if (diffable) {
    /* PROFİLER DÜZELTMESİ: panel her tazelemede tüm satırlara First
       okuması (gBCR 720 örnek) + appendChild taşıma döngüsü + FlipPlay
       okuması (gBCR 720) yapıyordu. Şimdi tek geçişte satır imzaları ve
       DOM sırası önceden hesaplanır; hiçbir değişim yoksa DOM'a hiç
       dokunulmaz (no-op tazeleme operasyonsuz kapanır). */
    const sigCache = new Map();
    let sigDirty = false;
    let orderDirty = false;
    for (let i = 0; i < rows.length; i += 1) {
      const layer = rows[i];
      const el = byId.get(layer.id);
      const sig = inkLayerRowSig(layer, layer.id === activeId);
      sigCache.set(layer.id, sig);
      if (el.__inkLayerSig !== sig) sigDirty = true;
      if (list.children[i] !== el) orderDirty = true;
    }
    if (sigDirty || orderDirty) {
      /* FLIP yalnız SIRA değişince anlamlı: imza yenileme (replaceWith)
         satır yüksekliğini değiştirmez — First/FlipPlay ölçümü gerekmez.
         (profil: 640+640 gereksiz gBCR bu yüzden kalmıştı.) */
      const flipFirst = orderDirty ? inkLayerRowsFirst(list) : null;
      for (const layer of rows) {
        const el = byId.get(layer.id);
        const sig = sigCache.get(layer.id);
        if (el.__inkLayerSig !== sig) {
          const fresh = inkLayerRow(layer);
          fresh.__inkLayerSig = sig;
          el.replaceWith(fresh);
          byId.set(layer.id, fresh);
        }
      }
      if (orderDirty) {
        for (const layer of rows) list.appendChild(byId.get(layer.id));
        // Faz 8.E: DOM güncellemesi SONRASI kayma animasyonu (sıra değişiminde).
        inkLayerRowsFlipPlay(list, flipFirst);
      }
    }
  } else {
    list.replaceChildren();
    for (const layer of rows) {
      const active = layer.id === activeId;
      const row = inkLayerRow(layer);
      row.__inkLayerSig = inkLayerRowSig(layer, active);
      list.appendChild(row);
    }
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'inkLayersEmpty';
      empty.textContent = 'No layers · + to add';
      list.appendChild(empty);
    }
    // Yeni eklenen satır kısa bir vurguyla görünür alana gelir.
    if (inkDocFlashLayerId) {
      const flashId = inkDocFlashLayerId;
      inkDocFlashLayerId = null;
      const el = list.querySelector('.inkLayerRow[data-layer-id="' + flashId + '"]');
      if (el) {
        el.classList.add('is-new');
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
        setTimeout(() => el.classList.remove('is-new'), 180);
      }
    }
  }

  // Faz 8.E animasyonu diff yolu içinde koşar; burada (tam kurulum'da)
  // FlipPlay'e gerek yok — yapım yeniyse First eşleşmez, animasyon zaten
  // erken dönerdi.

  // Silinen katmanların küçük görselleri bellekte kalmasın.
  for (const id of [...inkLayerThumbCache.keys()]) {
    if (!inkLayerById(id)) inkLayerThumbRelease(id);
  }

  const layer = typeof inkDocSelectedLayer === 'function' && docId
    ? (inkDocSelectedLayer(docId) || inkActiveLayer())
    : inkActiveLayer();
  if (inkUi.els.layerOpacity) {
    inkUi.els.layerOpacity.disabled = !layer;
    inkUi.els.layerOpacity.value = String(Math.round((layer ? layer.opacity : 1) * 100));
    if (inkUi.els.layerOpacityVal) {
      inkUi.els.layerOpacityVal.textContent = Math.round((layer ? layer.opacity : 1) * 100) + '%';
    }
  }
  if (inkUi.els.layerBlend) {
    inkUi.els.layerBlend.disabled = !layer;
    inkUi.els.layerBlend.value = layer ? (layer.blend || 'normal') : 'normal';
  }
  if (inkUi.els.layerPlane) {
    inkUi.els.layerPlane.checked = !!(layer && layer.kind === 'global' && layer.plane === 'above');
    inkUi.els.layerPlane.disabled = !layer || layer.kind !== 'global';
  }
  if (inkUi.els.layerLock) {
    inkUi.els.layerLock.checked = !!(layer && layer.locked);
    inkUi.els.layerLock.disabled = !layer;
  }

  // K6 · Maske ipucu şeridi: maske düzenlemesinde hangi katmanın maskesi
  // düzenleniyor ve siyah/beyaz kuralı kullanıcıya görünür olur.
  const hint = document.getElementById('inkLayerMaskHint');
  if (hint) {
    const editingId = inkState().maskEditId || '';
    const editing = editingId ? (inkLayerById(editingId) || null) : null;
    hint.hidden = !editing;
    if (editing) {
      hint.dataset.layerId = editing.id;
      const nameEl = hint.querySelector('#inkLayerMaskHintName');
      if (nameEl) nameEl.textContent = inkLayerDisplayName(editing);
      const exit = hint.querySelector('#inkLayerMaskHintExit');
      if (exit) {
        exit.onclick = ev => {
          ev.preventDefault();
          if (typeof inkDocToggleMaskEdit === 'function') {
            inkDocToggleMaskEdit(editing.id);
          }
          inkSyncLayersPanel();
        };
      }
    }
  }

  // Son katman silinemez: düğme bu durumda içerik temizler, tooltip açıklayıcı.
  const del = document.getElementById('btnInkDeleteLayer');
  if (del) {
    const activeDelete = layer && layer.kind === 'attached';
    const canDelete = rows.length > 1 || activeDelete;
    del.disabled = !layer;
    del.title = rows.length > 1
      ? 'Delete layer (Delete)'
      : 'Clears the drawing inside the layer (Delete)';
    del.setAttribute('aria-disabled', canDelete ? 'false' : 'true');
  }
  const up = document.getElementById('btnInkLayerUp');
  const down = document.getElementById('btnInkLayerDown');
  const idx = layer ? rows.indexOf(layer) : -1;
  if (up) up.disabled = !layer || idx <= 0;
  if (down) down.disabled = !layer || idx < 0 || idx >= rows.length - 1;

  if (typeof inkLayerMenuRefresh === 'function') inkLayerMenuRefresh();
  if (typeof inkSyncFxPanel === 'function') inkSyncFxPanel();
}

/* =========================================================
   genel senkronizasyon
   ========================================================= */
function inkBindGlobalUi() {
  inkSyncColorSwatch();

  // Durum çubuğu yakınlaştırma kontrolleri. Motor dosyasına dokunmadan
  // yalnızca mevcut genel işlevleri çağırırız.
  const zoomBy = factor => {
    if (typeof inkEditorZoomBy === 'function') inkEditorZoomBy(factor);
  };
  if (inkUi.els.zoomOut) {
    inkUi.els.zoomOut.addEventListener('click', e => {
      e.preventDefault();
      zoomBy(0.8);
    });
  }
  if (inkUi.els.zoomIn) {
    inkUi.els.zoomIn.addEventListener('click', e => {
      e.preventDefault();
      zoomBy(1.25);
    });
  }
  const zoomFit = () => {
    if (typeof inkEditorZoomFit === 'function') inkEditorZoomFit();
  };
  if (inkUi.els.zoomValue) {
    inkUi.els.zoomValue.addEventListener('click', e => {
      e.preventDefault();
      zoomFit();
    });
  }
  if (inkUi.els.zoomFit) {
    inkUi.els.zoomFit.addEventListener('click', e => {
      e.preventDefault();
      zoomFit();
    });
  }

  const clearSel = document.getElementById('btnInkClearSelection');
  if (clearSel) clearSel.addEventListener('click', () => {
    inkState().selection = [];
    inkUpdateGizmo();
    inkSyncLayersPanel();
  });

  const scopeExit = document.getElementById('btnInkScopeExit');
  if (scopeExit) scopeExit.addEventListener('click', event => {
    event.preventDefault();
    inkExitImageScope();
  });

  const drawBtn = document.getElementById('btnDrawImage');
  if (drawBtn) drawBtn.addEventListener('click', event => {
    event.preventDefault();
    const sel = selectedImageItems();
    if (sel.length !== 1) return;
    const itemId = sel[0].id;
    /* Kullanıcı kararı: ayrı Canvas Editor penceresi KALDIRILDI —
       "Start Drawing" her zaman uygulama içi tam ekran ÇİZİM moduna
       götürür (seçili görsel referans/çizim zemini olarak). */
    if (typeof modeToggleDrawForSelection === 'function') {
      modeToggleDrawForSelection();
      return;
    }
    inkToggleImageScope(itemId);
  });
}

/* =========================================================
   bağlamsal çizim modu ("Start Drawing")
   ========================================================= */
function inkScopeActiveFor(itemId) {
  return !!itemId && inkRuntime.imageScopeId === itemId && !!inkScopedImage();
}

function inkSyncScopeVisual() {
  const it = inkScopedImage();
  const activeId = it ? it.id : '';
  for (const el of document.querySelectorAll('.item.ink-draw-scope')) {
    if (!activeId || el.dataset.id !== activeId) el.classList.remove('ink-draw-scope');
  }
  if (it) {
    const el = elMap.get(it.id);
    if (el) el.classList.add('ink-draw-scope');
  }
  document.body.classList.toggle('ink-image-scope', !!it);
  if (inkUi.els.scopeBar) inkUi.els.scopeBar.hidden = !it;
  if (inkUi.els.scopeName && it) {
    inkUi.els.scopeName.textContent = it.title || it.name || 'Image';
  }
  /* Sol-alt durum çubuğunda o anki çizim tuvalinin piksel boyutu
     (kullanıcı isteği: "o anki tuvalin ya da referans görselin kaça kaç
     pixel olduğu yazsın"). dünya boyutu %100'de piksel boyutuna eşittir
     (41-canvas-workspace'ta da aynı kural). */
  if (inkUi.els.scopeSize) {
    if (it) {
      const w = Math.round(it.w || 0);
      const h = Math.round(it.h || 0);
      const name = String(it.title || it.name || '').trim();
      const label = name || window.__t('Canvas');
      inkUi.els.scopeSize.textContent = w + ' × ' + h + ' px';
      inkUi.els.scopeSize.title = label + ' · ' + window.__t('Resolution')
        + ': ' + w + ' × ' + h + ' px';
    } else {
      inkUi.els.scopeSize.textContent = '—';
      inkUi.els.scopeSize.title = '';
    }
  }
  /* Sol-alt tuval boyut çipi (kullanıcı: "ekranın sol altında/sol üstte
     o anki tuvalin ya da referans görselin kaça kaç pixel olduğu
     yazsın"). Eski durum çubuğu kabukta bilinçli gizli (ui-shell.css,
     2026-11-04 kararı); çip yalnız çizim modunda görünür. */
  const docSizeChip = document.getElementById('inkDocSize');
  if (docSizeChip) {
    if (it) {
      const w = Math.round(it.w || 0);
      const h = Math.round(it.h || 0);
      const label = String(it.title || it.name || '').trim() || window.__t('Canvas');
      docSizeChip.textContent = w + ' × ' + h + ' px';
      docSizeChip.title = label + ' · ' + window.__t('Resolution')
        + ': ' + w + ' × ' + h + ' px';
      docSizeChip.hidden = false;
    } else {
      docSizeChip.hidden = true;
      docSizeChip.textContent = '';
      docSizeChip.title = '';
    }
  }
  const drawBtn = document.getElementById('btnDrawImage');
  if (drawBtn) {
    const sel = typeof selectedImageItems === 'function' ? selectedImageItems() : [];
    const selected = sel.length === 1 ? sel[0] : null;
    const on = !!it && !!selected && it.id === selected.id;
    drawBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    drawBtn.disabled = !selected;
    setButtonLabel(drawBtn, on ? 'Finish Drawing' : 'Start Drawing');
  }
  if (typeof modeSyncUi === 'function') modeSyncUi();
}

/** Seçili görseli, sol paneller ile sağ fırça paneli arasındaki alana ortalar. */
function inkFrameImageForDrawing(it) {
  if (!it) return;
  const pad = 40;
  const vw = stage.clientWidth || innerWidth;
  const vh = stage.clientHeight || innerHeight;
  let left = pad;
  const leftDock = document.getElementById('inkLeftDock');
  const leftRect = leftDock ? leftDock.getBoundingClientRect() : null;
  if (leftRect && leftRect.width > 0) left = Math.max(left, leftRect.right + pad);
  const toolbox = document.getElementById('inkToolbox');
  if (toolbox && !toolbox.hidden) {
    const tr = toolbox.getBoundingClientRect();
    if (tr.width > 0) left = Math.max(left, tr.right + pad);
  }
  let right = pad;
  const rightDock = document.getElementById('inkRightDock');
  const rightRect = rightDock ? rightDock.getBoundingClientRect() : null;
  if (rightRect && rightRect.width > 0) {
    right = Math.max(right, vw - rightRect.left + pad);
  } else {
    const panel = inkUi.els.brushPanel;
    if (isPanelVisible(panel) && panel.offsetLeft > 0) {
      right = Math.max(right, vw - panel.offsetLeft + pad);
    }
  }
  const top = pad;
  const bottom = pad;
  const availW = Math.max(160, vw - left - right);
  const availH = Math.max(160, vh - top - bottom);
  const b = boundsOf([it], 0);
  const s = clamp(
    Math.min(availW / Math.max(b.w, 1), availH / Math.max(b.h, 1)),
    MIN_SCALE, MAX_SCALE
  );
  state.view.scale = s;
  state.view.x = left + availW / 2 - (b.x + b.w / 2) * s;
  state.view.y = top + availH / 2 - (b.y + b.h / 2) * s;
  applyView();
  scheduleSave();
}

function inkEnterImageScope(itemId) {
  const it = getItem(itemId);
  if (!it || it.kind !== 'image') return false;
  inkRuntime.imageScopeId = it.id;

  // Belge yığını idempotent kurulur; kayıtlı seçim korunur.
  if (typeof inkDocEnsure === 'function') inkDocEnsure(it.id);
  else {
    let layer = inkLayersForOwner(it.id).filter(l => !l.locked).pop();
    if (!layer) layer = inkEnsureAttachedLayer(it.id);
    if (layer) inkSetActiveLayer(layer.id);
  }

  if (inkUi.els.layersPanel) showPanel(inkUi.els.layersPanel);
  showPanel(inkUi.els.brushPanel);
  /* Layer 1 = referans fotoğraf: taze katmana fotoğraf pişirilir ki
     efektler, ekran ve dışa aktarım aynı kaynağı kullansın. */
  if (typeof inkLayerBakePhoto === 'function') {
    try { inkLayerBakePhoto(it); } catch { /* sessiz */ }
  }
  inkCloseColorWheel();
  inkSyncScopeVisual();
  inkFrameImageForDrawing(it);
  if (typeof inkEditorOpen === 'function') inkEditorOpen(it.id);
  inkSyncUI();
  if (typeof updateItemBar === 'function') updateItemBar();
  return true;
}

function inkExitImageScope() {
  if (typeof inkEditorClose === 'function') inkEditorClose();
  if (!inkRuntime.imageScopeId) return;
  inkCancelStroke();
  inkRuntime.imageScopeId = null;
  if (typeof inkApplyToolCursor === 'function') inkApplyToolCursor();
  inkSyncScopeVisual();
  inkSyncUI();
  if (typeof updateItemBar === 'function') updateItemBar();
}

function inkToggleImageScope(itemId) {
  if (inkScopeActiveFor(itemId)) {
    inkExitImageScope();
    return false;
  }
  return inkEnterImageScope(itemId);
}

function inkSyncColorSwatch() {
  const hex = inkState().color || '#ff5a5f';
  const sw = inkUi.els.colorSwatch;
  if (sw) sw.style.background = hex;
}

/** Motor durumunu UI'a yansıtır.
    @param {object} [options]
    @param {boolean} [options.invalidateEditor=true] false ise editör sahnesi
      yeniden kompozit edilmez. Katman seçimi gibi tuval görüntüsünü
      DEĞİŞTİRMEYEN senkronlarda tam kare yeniden çizim (4K'da ~60 ms)
      boşa gidiyordu; kompozit yalnız görünür içerik değişince gerekir. */
function inkSyncUI(options = {}) {
  if (!inkUi.ready) return;
  const ink = inkState();
  const els = inkUi.els;

  document.querySelectorAll('#inkToolbox [data-ink-tool]').forEach(btn => {
    const tool = btn.dataset.inkTool;
    const brushId = btn.dataset.inkBrush || '';
    const shape = btn.dataset.inkShape || '';
    let active = tool === ink.tool;
    if (tool === 'shape' && active && shape) active = shape === ink.shape;
    if (brushId && active) active = brushId === ink.brushId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  inkSyncBrushPanelState();

  if (!isPanelVisible(els.brushPanel) &&
      !isPanelVisible(document.getElementById('inkColorPanel'))) inkCloseColorWheel();
  inkSyncColorSwatch();
  inkSyncColorWheel(true);
  inkSyncScopeVisual();

  if (els.size) els.size.value = String(Math.round(ink.size));
  if (els.sizeVal) els.sizeVal.textContent = String(Math.round(ink.size));
  if (els.opacity) els.opacity.value = String(Math.round(ink.opacity * 100));
  if (els.opacityVal) els.opacityVal.textContent = Math.round(ink.opacity * 100) + '%';
  if (els.hardness) els.hardness.value = String(Math.round(ink.hardness * 100));
  if (els.hardnessVal) els.hardnessVal.textContent = Math.round(ink.hardness * 100) + '%';
  if (els.spacing) els.spacing.value = String(Math.round(ink.spacing * 100));
  if (els.spacingVal) els.spacingVal.textContent = Math.round(ink.spacing * 100) + '%';
  if (els.smoothing) els.smoothing.value = String(Math.round(ink.smoothing * 100));
  if (els.smoothingVal) els.smoothingVal.textContent = Math.round(ink.smoothing * 100) + '%';
  if (els.mouseSpeedPressure) els.mouseSpeedPressure.checked = !!ink.mouseSpeedPressure;
  if (els.shapeSnap) els.shapeSnap.checked = !!ink.shapeSnap;
  if (els.pressureCurve) els.pressureCurve.value = String(Math.round(ink.pressureCurve * 100));
  if (els.pressureCurveVal) els.pressureCurveVal.textContent = ink.pressureCurve.toFixed(2) + '×';
  if (els.speedSize) els.speedSize.value = String(Math.round(ink.speedSize * 100));
  if (els.speedSizeVal) els.speedSizeVal.textContent = Math.round(ink.speedSize * 100) + '%';
  if (els.flow) els.flow.value = String(Math.round(ink.flow * 100));
  if (els.flowVal) els.flowVal.textContent = Math.round(ink.flow * 100) + '%';
  if (els.flowJitter) els.flowJitter.value = String(Math.round(ink.flowJitter * 100));
  if (els.flowJitterVal) els.flowJitterVal.textContent = Math.round(ink.flowJitter * 100) + '%';
  if (els.scatter) els.scatter.value = String(Math.round(ink.scatter * 100));
  if (els.scatterVal) els.scatterVal.textContent = Math.round(ink.scatter * 100) + '%';
  const activeBrush = inkGetBrush(ink.brushId);
  const dynamics = activeBrush && activeBrush.dynamics
    ? activeBrush.dynamics
    : INK_DEFAULT_DYNAMICS;
  if (els.spacingJitter) els.spacingJitter.value = String(Math.round((dynamics.spacingJitter || 0) * 100));
  if (els.spacingJitterVal) els.spacingJitterVal.textContent = Math.round((dynamics.spacingJitter || 0) * 100) + '%';
  if (els.pressureSize) els.pressureSize.value = String(Math.round((dynamics.sizeMin || 0) * 100));
  if (els.pressureSizeVal) els.pressureSizeVal.textContent = Math.round((dynamics.sizeMin || 0) * 100) + '%';
  if (els.pressureOpacity) els.pressureOpacity.value = String(Math.round((dynamics.opacityMin || 0) * 100));
  if (els.pressureOpacityVal) els.pressureOpacityVal.textContent = Math.round((dynamics.opacityMin || 0) * 100) + '%';
  if (els.angleJitter) els.angleJitter.value = String(Math.round((dynamics.angleJitter || 0) * 100));
  if (els.angleJitterVal) els.angleJitterVal.textContent = Math.round((dynamics.angleJitter || 0) * 100) + '%';
  if (els.taperStart) els.taperStart.value = String(Math.round(ink.taperStart * 100));
  if (els.taperStartVal) els.taperStartVal.textContent = ink.taperStart.toFixed(2) + '×';
  if (els.taperEnd) els.taperEnd.value = String(Math.round(ink.taperEnd * 100));
  if (els.taperEndVal) els.taperEndVal.textContent = ink.taperEnd.toFixed(2) + '×';

  if (els.brushName) {
    const b = inkGetBrush(ink.brushId);
    els.brushName.textContent = b ? b.name : 'Brush';
  }
  if (typeof inkSyncNativeBrushLibrary === 'function') inkSyncNativeBrushLibrary();
  else inkRenderPresets();
  inkPreviewBrush();
  inkUpdateHud();
  inkSyncLayersPanel();
  if (typeof inkWorkspaceSync === 'function') inkWorkspaceSync();
  inkLayoutDock();
  if (typeof inkEditorSyncStatus === 'function') inkEditorSyncStatus();
  // Araç/fırça değişikliği imleç halkasını ve canlı görünümü etkiler.
  if (options.invalidateEditor !== false && typeof inkEditorInvalidate === 'function') {
    inkEditorInvalidate();
  }
  // FAZ 5: options bar durumdan okur — her motor senkronunda tazele.
  // Ölçüm (measure) yalnız gerçek açılış/kapışlarda koşar; her senkronda
  // getBoundingClientRect fırtınası kaydırak ertekiyordu (profiler bulgusu).
  if (window.__v5OptSync) window.__v5OptSync({ measure: false });
}

function inkUpdateHud() {
  const hud = inkUi.els.hud;
  if (!hud) return;
  /* HUD çizim modu HUD konumuna göre stillenir; referans modunda araç
     çubuğu/çöp doku kısmı üzerinde kalan sabit baloncuk yanlış yerde
     görünüyor (kullanıcı: "bazen sol altta çıkıyor"). Diğer modlarda
     saklanır. */
  if (!document.body.classList.contains('mode-draw')) {
    clearTimeout(inkUi.hudTimer);
    hud.classList.remove('show');
    return;
  }
  const ink = inkState();
  const meta = INK_TOOL_META[ink.tool];
  const name = meta ? (window.__t ? __t(meta.label) : meta.label) : ink.tool;
  const extra = ink.tool === 'shape' ? ' · ' + (window.__t ? __t(INK_SHAPE_META[ink.shape]?.label || ink.shape) : (INK_SHAPE_META[ink.shape]?.label || ink.shape)) : '';
  hud.textContent = name + extra + ' · ' + Math.round(ink.size) + ' px';
  hud.style.setProperty('--ink-color', ink.color);
  hud.classList.add('show');
  clearTimeout(inkUi.hudTimer);
  inkUi.hudTimer = setTimeout(() => hud.classList.remove('show'), 1600);
}

/* =========================================================
   FAZ 6 B8: Boyut HUD'ı — referans uygulama tarzı imleç-dibi mini balon
   =========================================================
   [ / ] ve Alt+tekerlek boyut değişimlerinde imlecin dibinde nokta
   daire (görsel çap clamp'li) + "N px" etiketi belirir; 1.2s sonra
   söner. Kalıcı bir elemandır (ışınsal HUD gibi), her çağrıda güncel
   boyutla yeniden konumlanır. */
function inkShowSizeBubble(cx, cy) {
  const ink = inkState();
  let bubble = inkUi.els.sizeBubble;
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.id = 'inkSizeBubble';
    bubble.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('span');
    dot.className = 'inkSizeBubbleDot';
    const val = document.createElement('span');
    val.className = 'inkSizeBubbleVal';
    bubble.append(dot, val);
    document.body.appendChild(bubble);
    inkUi.els.sizeBubble = bubble;
    inkUi.els.sizeBubbleDot = dot;
    inkUi.els.sizeBubbleVal = val;
  }
  const dot = inkUi.els.sizeBubbleDot;
  const val = inkUi.els.sizeBubbleVal;
  bubble.style.setProperty('--ink-color', ink.color);
  /* Görsel çap: dünya birimi clamp'li — imleç-altındaki dokunuş
     alanını yaklaşık imler (üst sınırla taşmada küçülmek yerine
     sabit kalır). */
  const d = clamp(Math.round(ink.size), 6, 96);
  dot.style.width = d + 'px';
  dot.style.height = d + 'px';
  dot.style.setProperty('--ink-size-dot', d + 'px');
  val.textContent = Math.round(ink.size) + ' px';
  const px = Number.isFinite(cx) ? cx
    : (inkRuntime.cursorScreen ? inkRuntime.cursorScreen.x : innerWidth / 2);
  const py = Number.isFinite(cy) ? cy
    : (inkRuntime.cursorScreen ? inkRuntime.cursorScreen.y : innerHeight / 2);
  bubble.style.left = Math.round(px + 18) + 'px';
  bubble.style.top = Math.round(py + 18) + 'px';
  bubble.classList.add('show');
  clearTimeout(inkUi.sizeBubbleTimer);
  inkUi.sizeBubbleTimer = setTimeout(
    () => bubble.classList.remove('show'), 1200);
}

/* Dil değişince katman paneli başlığı/sil düğmeleri (dinamik yazım) ve
   durum çubuğu ipucu tazelensin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => {
    try { inkSyncLayersPanel(); } catch { /* sessiz */ }
    try { inkSyncScopeVisual(); } catch { /* sessiz */ }
  });
}
