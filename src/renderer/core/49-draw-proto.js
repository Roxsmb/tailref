/* TailRef app · çizim modu prototip katmanı
   ------------------------------------------------------------------
   PySide6 prototipindeki koyu çizim düzenini web kabuğuna bağlar.
   Görsel dil draw-proto.css içindedir; bu dosya yalnızca davranış ekler:

   · Sol sütundaki gerçek referans tahtasını canlı olarak kırpar
   · Yüzen araç çubuğunu (Seç / Fırça / Silgi / Kaydır / Yakınlaştır)
     ve alt araç menülerini kurar
   · Renk çarkını sağdaki renk kartına taşır
   · Kart yüksekliği tutamaçlarını ve katman ekleme düğmesini ekler
   · Referans sütununun alt yakınlaştırma çubuğunu bağlar

   Referans moduna hiçbir şekilde dokunmaz; tüm etkiler body.mode-draw
   altında çalışır. */

'use strict';

const DP_CARD_STORE = 'tailref-draw-cards-v1';
const DP_TOOL_GROUPS = {
  select: ['transform', 'marquee', 'lasso'],
  brush: ['brush', 'pencil', 'shape'],
};

const dpProto = {
  ready: false,
  toolbar: null,
  menu: null,
  panMode: false,
  inDraw: false,
  userTouched: false,
  refView: null,
  leftExpanded: false,
  cardHeights: { color: 176, layers: 210, brush: 244 },
  fitTimer: 0,
  clipRaf: 0,
  syncTimer: 0,
  boundWheel: false,
};

function dpEl(id) {
  return document.getElementById(id);
}

function dpIsDraw() {
  return document.body.classList.contains('mode-draw');
}

function dpIcon(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-' + name + '"/></svg>';
}

function dpInlineIcon(paths) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
}

/* =========================================================
   YÜZEN ARAÇ ÇUBUĞU
   ========================================================= */
function dpBuildToolbar() {
  if (dpProto.toolbar) return dpProto.toolbar;
  if (!dpIsDraw() && !document.body.classList.contains('mode-reference')) {
    // Gövde sınıfları henüz kurulmadıysa yine de kur; gizli kalır.
  }

  const bar = document.createElement('div');
  bar.id = 'drawFloatToolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Drawing tools');
  bar.setAttribute('data-l10n-aria', 'Drawing tools');
  bar.hidden = true;
  bar.innerHTML =
    '<div class="dftSelectWrap" data-dp-group="select">' +
      '<button class="dftBtn" type="button" data-dp-tool="transform" data-l10n-title="Move / Transform (V)" data-l10n-aria="Move or transform">' +
        dpInlineIcon('<path d="m6 3 12 8-5.2 1.2L10 18z"/>') + '<span data-l10n="Select">Select</span>' +
      '</button>' +
      '<button class="dftCaret" type="button" data-dp-menu="select" data-l10n-title="Selection tools" data-l10n-aria="Selection tools" aria-haspopup="true" aria-expanded="false">▾</button>' +
    '</div>' +
    '<div class="dftSelectWrap" data-dp-group="brush">' +
      '<button class="dftBtn" type="button" data-dp-tool="brush" data-l10n-title="Brush (B)" data-l10n-aria="Brush">' +
        dpIcon('ink-brush') + '<span data-l10n="Brush">Brush</span>' +
      '</button>' +
      '<button class="dftCaret" type="button" data-dp-menu="brush" data-l10n-title="Brush tools" data-l10n-aria="Brush tools" aria-haspopup="true" aria-expanded="false">▾</button>' +
    '</div>' +
    '<button class="dftBtn" type="button" data-dp-tool="eraser" data-l10n-title="Eraser (E)" data-l10n-aria="Eraser">' +
      dpIcon('ink-eraser') + '<span data-l10n="Eraser">Eraser</span>' +
    '</button>' +
    '<span class="dftSep" aria-hidden="true"></span>' +
    '<button class="dftBtn" type="button" data-dp-action="pan" data-l10n-title="Pan (Space)" data-l10n-aria="Pan" aria-pressed="false">' +
      dpInlineIcon('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5V4.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V13m0-2.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.4a6 6 0 0 1-4.8-2.4L5 14.5a1.6 1.6 0 0 1 2.4-2.1l.6.6"/>') +
      '<span data-l10n="Pan">Pan</span>' +
    '</button>' +
    '<button class="dftBtn" type="button" data-dp-action="zoom" data-l10n-title="Zoom in (Shift to zoom out)" data-l10n-aria="Zoom in">' +
      dpInlineIcon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5M7.5 10.5h6M10.5 7.5v6"/>') +
      '<span data-l10n="Zoom in">Zoom in</span>' +
    '</button>' +
    '<span class="dftSep" aria-hidden="true"></span>' +
    '<button class="dftIcon" type="button" data-dp-action="undo" data-l10n-title="Undo (Ctrl+Z)" data-l10n-aria="Undo">' + dpIcon('undo') + '</button>' +
    '<button class="dftIcon" type="button" data-dp-action="redo" data-l10n-title="Redo (Ctrl+Y)" data-l10n-aria="Redo">' + dpIcon('redo') + '</button>';

  document.body.appendChild(bar);
  dpProto.toolbar = bar;
  /* L10N: işaretli etiketleri güncel dile göre doldur. */
  if (window.L10N && typeof window.L10N.applyDom === 'function') window.L10N.applyDom(bar);

  bar.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const menuBtn = target.closest('[data-dp-menu]');
    if (menuBtn) {
      event.preventDefault();
      dpToggleMenu(menuBtn.dataset.dpMenu, menuBtn);
      return;
    }

    const toolBtn = target.closest('[data-dp-tool]');
    if (toolBtn) {
      event.preventDefault();
      dpSetTool(toolBtn.dataset.dpTool);
      return;
    }

    const action = target.closest('[data-dp-action]');
    if (!action) return;
    event.preventDefault();
    const name = action.dataset.dpAction;
    if (name === 'pan') dpSetPan(!dpProto.panMode);
    else if (name === 'zoom') {
      if (typeof inkEditorZoomBy === 'function') inkEditorZoomBy(event.shiftKey || event.altKey ? 0.8 : 1.25);
    } else if (name === 'undo') {
      dpEl('btnInkHistoryUndo')?.click();
      dpSyncToolbar();
    } else if (name === 'redo') {
      dpEl('btnInkHistoryRedo')?.click();
      dpSyncToolbar();
    }
  });

  dpBuildMenu();
  return bar;
}

function dpBuildMenu() {
  if (dpProto.menu) return dpProto.menu;
  const menu = document.createElement('div');
  menu.id = 'dftSelectMenu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  dpProto.menu = menu;

  menu.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const btn = target && target.closest('[data-dp-menu-tool]');
    if (!btn) return;
    event.preventDefault();
    dpSetTool(btn.dataset.dpMenuTool);
    dpCloseMenu();
  });
  return menu;
}

function dpMenuEntries(group) {
  if (group === 'select') {
    return [
      { tool: 'transform', label: 'Move / Transform', icon: 'ink-move', key: 'V' },
      { tool: 'marquee', label: 'Rectangular Selection', icon: 'ink-marquee', key: 'M' },
      { tool: 'lasso', label: 'Lasso Selection', icon: 'ink-lasso', key: 'L' },
    ];
  }
  return [
    { tool: 'brush', label: 'Brush', icon: 'ink-brush', key: 'B' },
    { tool: 'pencil', label: 'Pencil', icon: 'ink-pencil', key: 'P' },
    { tool: 'shape', label: 'Shape', icon: 'ink-shape', key: 'U' },
  ];
}

function dpToggleMenu(group, anchor) {
  if (dpProto.menu && !dpProto.menu.hidden && dpProto.menu.dataset.dpGroup === group) {
    dpCloseMenu();
    return;
  }
  dpOpenMenu(group, anchor);
}

function dpOpenMenu(group, anchor) {
  const menu = dpBuildMenu();
  menu.replaceChildren();
  menu.dataset.dpGroup = group;
  menu.setAttribute('aria-label', group === 'select' ? 'Selection tools' : 'Brush tools');

  let current = 'transform';
  try { if (typeof inkState === 'function') current = inkState().tool || current; } catch { /* sessiz */ }

  for (const entry of dpMenuEntries(group)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitemradio');
    btn.setAttribute('aria-checked', entry.tool === current ? 'true' : 'false');
    btn.dataset.dpMenuTool = entry.tool;
    btn.innerHTML = dpIcon(entry.icon) + '<span>' + (window.__t ? __t(entry.label) : entry.label) + '</span><span class="dftMenuKey">' + entry.key + '</span>';
    menu.appendChild(btn);
  }

  menu.hidden = false;
  menu.style.transform = 'none';
  const r = anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 176;
  const left = Math.min(innerWidth - width - 10, Math.max(10, r.left + r.width / 2 - width / 2));
  let top = r.bottom + 7;
  const height = menu.offsetHeight || 110;
  if (top + height > innerHeight - 10) top = Math.max(10, r.top - height - 7);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  dpProto.menu.dataset.dpAnchor = anchor.dataset.dpMenu || '';

  setTimeout(() => {
    document.addEventListener('pointerdown', dpMenuOutside, true);
  }, 0);
}

function dpMenuOutside(event) {
  const menu = dpProto.menu;
  if (!menu || menu.hidden) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target && (target.closest('#dftSelectMenu') || target.closest('[data-dp-menu]'))) return;
  dpCloseMenu();
}

function dpCloseMenu() {
  const menu = dpProto.menu;
  if (!menu) return;
  menu.hidden = true;
  delete menu.dataset.dpGroup;
  document.removeEventListener('pointerdown', dpMenuOutside, true);
  dpProto.toolbar?.querySelectorAll('[data-dp-menu]').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

function dpSetTool(tool) {
  if (!tool) return;
  dpSetPan(false, true);
  if (typeof inkSetTool === 'function') inkSetTool(tool);
  dpSyncToolbar();
}

function dpSetPan(on, quiet) {
  dpProto.panMode = !!on;
  if (typeof inkEditorUi !== 'undefined' && inkEditorUi) {
    inkEditorUi.space = !!on && !quiet ? true : (quiet ? false : !!on);
  }
  if (typeof inkEditorSyncCursorStyle === 'function') inkEditorSyncCursorStyle();
  if (!quiet) dpSyncToolbar();
}

function dpSyncToolbar() {
  const bar = dpProto.toolbar;
  if (!bar) return;
  let tool = 'transform';
  try { if (typeof inkState === 'function') tool = inkState().tool || tool; } catch { /* sessiz */ }

  bar.querySelectorAll('[data-dp-group]').forEach(group => {
    const list = DP_TOOL_GROUPS[group.dataset.dpGroup] || [];
    const active = list.includes(tool);
    group.classList.toggle('is-active', active);
    group.querySelector('.dftBtn')?.classList.toggle('is-active', active);
  });

  const eraser = bar.querySelector('[data-dp-tool="eraser"]');
  if (eraser) eraser.classList.toggle('is-active', tool === 'eraser');

  const pan = bar.querySelector('[data-dp-action="pan"]');
  if (pan) {
    pan.classList.toggle('is-active', dpProto.panMode);
    pan.setAttribute('aria-pressed', dpProto.panMode ? 'true' : 'false');
  }

  const hasUndo = typeof undoStack !== 'undefined' && Array.isArray(undoStack) && undoStack.length > 0;
  const hasRedo = typeof redoStack !== 'undefined' && Array.isArray(redoStack) && redoStack.length > 0;
  const undo = bar.querySelector('[data-dp-action="undo"]');
  const redo = bar.querySelector('[data-dp-action="redo"]');
  if (undo) undo.disabled = !hasUndo;
  if (redo) redo.disabled = !hasRedo;
}

/* =========================================================
   RENK ÇARKI · sağdaki renk kartı
   ========================================================= */
function dpInstallColorWheel() {
  const wheel = dpEl('inkColorWheel');
  const body = document.querySelector('#inkColorPanel .psAccBody');
  if (!wheel || !body) return;
  wheel.dataset.psInline = '1';
  wheel.classList.add('ps-inline-wheel');
  wheel.hidden = false;
  if (wheel.parentElement !== body) body.appendChild(wheel);
  if (typeof showPanel === 'function') showPanel(wheel);
  requestAnimationFrame(() => {
    if (typeof inkSyncColorWheel === 'function') inkSyncColorWheel(false);
  });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (dpIsDraw() && typeof inkSyncColorWheel === 'function') inkSyncColorWheel(false);
    }).observe(wheel);
  }
}

/* =========================================================
   SAĞ KARTLAR · katman ekleme, yükseklik tutamaçları
   ========================================================= */
function dpPreparePanels() {
  const layers = dpEl('inkLayersPanel');
  if (layers) {
    const props = dpEl('inkLayerProps');
    if (props) props.open = true;
    const list = dpEl('inkLayerList');
    if (props && list && props.nextElementSibling !== list) {
      list.parentElement?.insertBefore(props, list);
    }
    const head = layers.querySelector('.psPanelHead');
    if (head && !head.querySelector('.dpPanelAdd')) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'dpPanelAdd';
      add.title = 'New layer';
      add.setAttribute('aria-label', 'Add new layer');
      add.innerHTML = dpIcon('plus');
      add.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        dpEl('btnInkAddLayer')?.click();
      });
      const chevron = head.querySelector('.psChevron');
      if (chevron) head.insertBefore(add, chevron);
      else head.appendChild(add);
    }
    /* Kullanıcı raporu: "⋯ menüsünü açmak çok zor" — başlıkta TEK TIK
       Sil düğmesi. Aktif katmanı inkDocDeleteLayer() ile siler; son
       katman hiresen işlevin kendi korumasıyla uyarı verir. */
    if (head && !head.querySelector('.dpPanelDelete')) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'dpPanelDelete';
      del.title = 'Delete layer · clears the drawing if it is the last layer';
      del.setAttribute('aria-label', 'Delete active layer');
      del.innerHTML = dpIcon('trash');
      del.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof inkDocDeleteOrClearLayer === 'function') inkDocDeleteOrClearLayer();
        else if (typeof inkDocDeleteLayer === 'function') inkDocDeleteLayer();
      });
      const chevron = head.querySelector('.psChevron');
      if (chevron) head.insertBefore(del, chevron);
      else head.appendChild(del);
    }
  }

  dpLoadCardHeights();
  dpArrangeBrushPanel();
  for (const panel of document.querySelectorAll('#psDrawPanels > .psAcc')) {
    if (panel.querySelector(':scope > .psCardGrip')) continue;
    const grip = document.createElement('span');
    grip.className = 'psCardGrip';
    grip.setAttribute('aria-hidden', 'true');
    panel.appendChild(grip);
    dpBindCardGrip(panel, grip);
  }
  dpApplyCardHeights();
}

function dpCardKey(panel) {
  return panel && panel.dataset ? panel.dataset.psPanel || '' : '';
}

/** Fırça uçları şeridi artık v5 panelinde yerel kütüphane tarafından
    yönetilir; eski prototip listenin yerini değiştirmez. */
function dpArrangeBrushPanel() {
  return;
}

function dpLoadCardHeights() {
  try {
    const raw = localStorage.getItem(DP_CARD_STORE);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    for (const key of Object.keys(dpProto.cardHeights)) {
      const value = Number(data[key]);
      if (Number.isFinite(value)) dpProto.cardHeights[key] = Math.round(Math.min(560, Math.max(96, value)));
    }
  } catch { /* depolama kapalıysa sessiz */ }
}

function dpSaveCardHeights() {
  try { localStorage.setItem(DP_CARD_STORE, JSON.stringify(dpProto.cardHeights)); }
  catch { /* sessiz */ }
}

function dpApplyCardHeights() {
  for (const panel of document.querySelectorAll('#psDrawPanels > .psAcc')) {
    const key = dpCardKey(panel);
    const height = dpProto.cardHeights[key];
    if (height) panel.style.height = height + 'px';
  }
}

function dpBindCardGrip(panel, grip) {
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const key = dpCardKey(panel);
    if (!key) return;
    const startY = event.clientY;
    const startH = panel.getBoundingClientRect().height;
    const pointerId = event.pointerId;
    panel.classList.add('is-resizing');
    document.body.classList.add('ps-card-resizing');

    const move = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      const max = Math.max(140, Math.min(560, innerHeight - 150));
      const next = Math.round(Math.min(max, Math.max(96, startH + moveEvent.clientY - startY)));
      panel.style.height = next + 'px';
      dpProto.cardHeights[key] = next;
    };
    const end = endEvent => {
      if (endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      panel.classList.remove('is-resizing');
      document.body.classList.remove('ps-card-resizing');
      dpSaveCardHeights();
    };
    // Yakalama bazı ortamlarda reddedilebilir; dinleyiciler pencereye
    // bağlandığı için sürükleme yine de çalışır ve sınıflar takılı kalmaz.
    try { grip.setPointerCapture(pointerId); } catch { /* sessiz */ }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

/* =========================================================
   SOL · gerçek referans tahtası
   ========================================================= */
function dpApertureRect() {
  // v5 çizim kabuğunda mini tahta, referans panelinin gövdesindeki
  // #v5RefStage dikdörtgenine kırpılır. Görünmüyorsa (panel kapalı,
  // katlanmış ya da çizim modu dışı) eski aperture'a düşülür.
  const v5Stage = dpEl('v5RefStage');
  if (v5Stage) {
    const v5Rect = v5Stage.getBoundingClientRect();
    if (v5Rect.width >= 40 && v5Rect.height >= 40) {
      // Dock kaydırıldığında sahne dock'un görünür alanından taşabilir.
      // Tahtayı yalnızca görünen kesişim kadar kırp; aksi halde panelin
      // altına kayan canlı tahta panellerin üstüne taşıyordu.
      const dock = v5Stage.closest('#v5LeftDock, #v5RightDock');
      if (!dock) return v5Rect;
      const d = dock.getBoundingClientRect();
      const left = Math.max(v5Rect.left, d.left);
      const top = Math.max(v5Rect.top, d.top);
      const right = Math.min(v5Rect.right, d.right);
      const bottom = Math.min(v5Rect.bottom, d.bottom);
      if (right - left < 40 || bottom - top < 40) return null;
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
      };
    }
  }
  const aperture = dpEl('psRefAperture');
  if (!aperture) return null;
  const rect = aperture.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;
  return rect;
}

function dpApplyRefClip() {
  const body = document.body;
  const panel = dpEl('psReferencePanel');
  // v5 kabuğu varsa eski panelin "kapalı/katlanmış" sınıfları geçersizdir;
  // görünürlüğü doğrudan #v5RefStage dikdörtgeni belirler.
  const v5Stage = dpEl('v5RefStage');
  const live = dpIsDraw() && (v5Stage
    ? true
    : (!body.classList.contains('ps-left-closed') &&
       !!panel && !panel.classList.contains('is-collapsed')));
  const rect = live ? dpApertureRect() : null;
  if (!rect) {
    body.classList.remove('ps-ref-live');
    return;
  }
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const root = document.documentElement;
  root.style.setProperty('--dp-ref-top', Math.max(0, Math.round(rect.top)) + 'px');
  root.style.setProperty('--dp-ref-right', Math.max(0, Math.round(vw - rect.right)) + 'px');
  root.style.setProperty('--dp-ref-bottom', Math.max(0, Math.round(vh - rect.bottom)) + 'px');
  root.style.setProperty('--dp-ref-left', Math.max(0, Math.round(rect.left)) + 'px');
  body.classList.add('ps-ref-live');
}

function dpScheduleClip() {
  if (dpProto.clipRaf) return;
  dpProto.clipRaf = requestAnimationFrame(() => {
    dpProto.clipRaf = 0;
    dpApplyRefClip();
    dpSyncBoardLabel();
  });
}

function dpBoardSnapshot() {
  try {
    return { x: state.view.x, y: state.view.y, scale: state.view.scale };
  } catch {
    return null;
  }
}

/** Çizim moduna girmeden hemen önce tahta görünümünü saklar. */
function dpCaptureRefView() {
  if (dpIsDraw()) return;
  dpProto.refView = dpBoardSnapshot();
}

function dpRestoreBoardView() {
  const saved = dpProto.refView;
  dpProto.refView = null;
  if (!saved) return;
  try {
    state.view.x = saved.x;
    state.view.y = saved.y;
    state.view.scale = saved.scale;
    if (typeof applyView === 'function') applyView();
    // Çizim sırasında mini tahtada kaydırma olduysa kayıt eski görünüme dönsün.
    if (typeof scheduleSave === 'function') scheduleSave();
  } catch { /* sessiz */ }
}

  function dpFitBoard() {
  /* Ayrı panel penceresindeyken #v5RefStage ana pencerede gizli olduğu
     için canlı aperture yoktur; son geçerli mini tahta dikdörtgeni
     kullanılır (draw-v5 bunu panel taşınırken saklar). */
  const rect = dpApertureRect()
    || (typeof window.tailrefV5RefRect === 'function' ? window.tailrefV5RefRect() : null);
  if (!rect) return;
  try {
    // Boyutu bozuk/aşırı büyük öğeler (bozuk yapıştırma, bozuk kayıt vb.)
    // sınır kutusunu şişirip sığdırmayı %4 gibi kullanılmaz ölçeklere
    // düşürüyordu; sağlıklı boyuttaki öğeler sığdırma hesabına katılır.
    const all = Array.isArray(state.items) ? state.items : [];
    const items = all.filter(item => {
      if (!item) return false;
      const w = Number(item.w);
      const h = Number(item.h);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
      return w <= 30000 && h <= 30000;
    });
    if (!items.length) {
      state.view.scale = 1;
      state.view.x = rect.left + rect.width / 2;
      state.view.y = rect.top + rect.height / 2;
      if (typeof applyView === 'function') applyView();
      dpSyncBoardLabel();
      return;
    }
    const bounds = boundsOf(items, 0);
    const pad = 14;
    const aw = Math.max(40, rect.width - pad * 2);
    const ah = Math.max(40, rect.height - pad * 2);
    const min = typeof MIN_SCALE !== 'undefined' ? MIN_SCALE : 0.05;
    const max = typeof MAX_SCALE !== 'undefined' ? MAX_SCALE : 8;
    const scale = Math.min(max, Math.max(min, Math.min(aw / Math.max(1, bounds.w), ah / Math.max(1, bounds.h))));
    state.view.scale = scale;
    state.view.x = rect.left + rect.width / 2 - (bounds.x + bounds.w / 2) * scale;
    state.view.y = rect.top + rect.height / 2 - (bounds.y + bounds.h / 2) * scale;
    if (typeof applyView === 'function') applyView();
    dpSyncBoardLabel();
  } catch { /* sessiz */ }
}

function dpBoardZoomAt(point, factor) {
  try {
    const s0 = Number(state.view.scale) || 1;
    const min = typeof MIN_SCALE !== 'undefined' ? MIN_SCALE : 0.05;
    const max = typeof MAX_SCALE !== 'undefined' ? MAX_SCALE : 8;
    const s1 = Math.min(max, Math.max(min, s0 * factor));
    if (s1 === s0) return;
    const wx = (point.x - state.view.x) / s0;
    const wy = (point.y - state.view.y) / s0;
    state.view.scale = s1;
    state.view.x = point.x - wx * s1;
    state.view.y = point.y - wy * s1;
    if (typeof applyView === 'function') applyView();
    dpSyncBoardLabel();
  } catch { /* sessiz */ }
}

function dpBoardZoom(factor) {
  const rect = dpApertureRect()
    || (typeof window.tailrefV5RefRect === 'function' ? window.tailrefV5RefRect() : null);
  if (!rect) return;
  dpProto.userTouched = true;
  dpBoardZoomAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, factor);
}

function dpSyncBoardLabel() {
  let scale = 1;
  try { scale = Number(state.view.scale) || 1; } catch { /* sessiz */ }
  const text = '%' + Math.max(1, Math.round(scale * 100));
  const label = dpEl('psRefZoomValue');
  if (label) label.textContent = text;
  // v5 referans panelinin alt şeridi aynı ölçeği gösterir.
  for (const node of document.querySelectorAll('#v5DrawUI [data-ref-zoom]')) {
    node.textContent = text;
  }
  dpSyncRefMeta();
}

function dpSyncRefMeta() {
  const count = dpEl('psRefSubCount');
  if (!count) return;
  const n = document.querySelectorAll('#psRefList .psRefItem').length;
  count.textContent = n + ' ' + __t('image');
}

function dpBindLeftPanel() {
  dpEl('psRefZoomOut')?.addEventListener('click', () => dpBoardZoom(0.8));
  dpEl('psRefZoomIn')?.addEventListener('click', () => dpBoardZoom(1.25));
  dpEl('psRefFit')?.addEventListener('click', () => {
    dpProto.userTouched = false;
    dpFitBoard();
  });
  dpEl('psRefZoomValue')?.addEventListener('click', () => {
    dpProto.userTouched = false;
    dpFitBoard();
  });

  dpEl('psRefExpand')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    dpProto.leftExpanded = !dpProto.leftExpanded;
    const st = typeof psShellModeState === 'function' ? psShellModeState('draw') : null;
    if (st) {
      st.leftWidth = dpProto.leftExpanded ? 320 : 194;
      if (typeof psShellApplyDockWidths === 'function') psShellApplyDockWidths();
      if (typeof psShellSaveSoon === 'function') psShellSaveSoon();
    }
    dpProto.userTouched = false;
    setTimeout(() => {
      dpApplyRefClip();
      dpFitBoard();
    }, 220);
  });

  const list = dpEl('psRefList');
  if (list) {
    new MutationObserver(() => dpSyncRefMeta())
      .observe(list, { childList: true });
  }
  dpSyncRefMeta();
}

/* =========================================================
   MOD GEÇİŞİ
   ========================================================= */
function dpMoveModeBar() {
  // Mod anahtarı iki modda da aynı yerde (sağ üstte, sabit) durur.
  // Referans modunda #bar içine taşınmıyor; aksi hâlde çizimden
  // referansa geçerken konum ve boyut değişiyordu.
  const bar = dpEl('appModeBar');
  if (!bar) return;
  if (bar.parentElement !== document.body) document.body.appendChild(bar);
}

function dpApplyMode() {
  const draw = dpIsDraw();
  const toolbar = dpBuildToolbar();
  toolbar.hidden = !draw;

  if (draw) {
    dpMoveModeBar();
    if (!dpProto.inDraw) {
      dpProto.inDraw = true;
      dpProto.userTouched = false;
      if (!dpProto.refView) dpProto.refView = dpBoardSnapshot();
      dpApplyRefClip();
      dpFitBoard();
      clearTimeout(dpProto.fitTimer);
      dpProto.fitTimer = setTimeout(() => {
        if (!dpProto.inDraw) return;
        dpApplyRefClip();
        if (!dpProto.userTouched) dpFitBoard();
      }, 650);
    } else {
      dpScheduleClip();
    }
    dpInstallColorWheel();
    dpSyncToolbar();
  } else {
    dpCloseMenu();
    dpSetPan(false, true);
    if (dpProto.inDraw) {
      dpProto.inDraw = false;
      clearTimeout(dpProto.fitTimer);
      dpRestoreBoardView();
    }
    dpMoveModeBar();
    dpApplyRefClip();
  }
}

function dpObserve() {
  let lastBody = '';
  new MutationObserver(() => {
    const now = document.body.className;
    if (now === lastBody) return;
    lastBody = now;
    dpApplyMode();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  lastBody = document.body.className;

  const panel = dpEl('psReferencePanel');
  if (panel) {
    new MutationObserver(() => dpScheduleClip())
      .observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  if (typeof ResizeObserver === 'function') {
    const aperture = dpEl('psRefAperture');
    if (aperture) {
      new ResizeObserver(() => {
        if (!dpIsDraw()) return;
        dpApplyRefClip();
        if (!dpProto.userTouched) dpFitBoard();
      }).observe(aperture);
    }
  }

  window.addEventListener('resize', () => {
    if (!dpIsDraw()) return;
    dpScheduleClip();
    if (!dpProto.userTouched) dpFitBoard();
  }, { passive: true });

  // Mini tahtadaki tekerlek yakınlaştırması pano görünümünü kalıcı olarak
  // kaydetmesin; referans moduna dönünce eski görünüm geri gelir.
  if (!dpProto.boundWheel) {
    dpProto.boundWheel = true;
    window.addEventListener('wheel', event => {
      if (!dpIsDraw() || !document.body.classList.contains('ps-ref-live')) return;
      const rect = dpApertureRect();
      if (!rect) return;
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dpProto.userTouched = true;
      /* Minitahta da doğal yön tercihini izler (ana tahta ile tutarlı). */
      const dir = (typeof tailrefWheelInvert === 'function' && tailrefWheelInvert()) ? -1 : 1;
      const factor = Math.exp(-event.deltaY * dir * (event.deltaMode === 1 ? 0.05 : 0.0015));
      dpBoardZoomAt({ x: event.clientX, y: event.clientY }, factor);
    }, { capture: true, passive: false });
  }

  // Boşluk tuşuyla geçici kaydırma, açık "Kaydır" modunu kapatmasın.
  window.addEventListener('keyup', event => {
    if (!dpProto.panMode) return;
    if (event.code !== 'Space' && event.key !== ' ') return;
    setTimeout(() => {
      if (!dpProto.panMode || typeof inkEditorUi === 'undefined' || !inkEditorUi) return;
      inkEditorUi.space = true;
      if (typeof inkEditorSyncCursorStyle === 'function') inkEditorSyncCursorStyle();
    }, 0);
  }, true);
}

function dpWrapSync() {
  const base = window.inkSyncUI;
  if (typeof base !== 'function' || base.__dpProtoWrapped) {
    dpSyncToolbar();
    return;
  }
  const wrapped = function dpProtoSyncCall() {
    const result = base.apply(this, arguments);
    try { dpSyncToolbar(); } catch { /* sessiz */ }
    return result;
  };
  wrapped.__dpProtoWrapped = true;
  window.inkSyncUI = wrapped;
}

function dpBoot() {
  if (dpProto.ready) return;
  if (!dpEl('inkEditor') || !dpEl('inkRightDock')) return;
  dpBuildToolbar();
  dpBuildMenu();
  dpInstallColorWheel();
  dpPreparePanels();
  dpBindLeftPanel();
  dpObserve();
  dpWrapSync();
  dpProto.ready = true;

  dpProto.syncTimer = setInterval(() => {
    if (!dpIsDraw()) return;
    dpSyncToolbar();
    dpSyncBoardLabel();
  }, 400);

  dpApplyMode();
}

queueMicrotask(dpBoot);
