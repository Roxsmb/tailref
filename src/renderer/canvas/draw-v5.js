/* =========================================================
   TailRef Studio · çizim modu arayüzü v5
   ---------------------------------------------------------
   Referans tasarımın ölçü, boşluk, tipografi ve tek ikon dili.
   Yalnızca body.mode-draw altında görünür. Çizim motoruna
   (stroke, katman verisi, tuval dönüşümleri) dokunmaz; var olan
   motor düğümlerini yeni panel kabuklarına taşır.
   ========================================================= */
'use strict';

(function () {
  const STORE_KEY = 'tailref-draw-v5-panels-v4';
  const SEED_KEY = 'tailref-draw-v5-seed-v4';
  const RECENT_KEY = 'tailref-draw-v5-recents-v4';
  const LAYER_SEQ_KEY = 'tailref-draw-v5-layer-seq-v3';

  const DEFAULT_RECENTS = [
    '#D4A24A', '#67AE99', '#E06C5A', '#5A8FE0',
    '#9B7BD4', '#C85C8E', '#3C3C42', '#EDEDED'
  ];

  const DEFS = [
    { id: 'reference', column: 'left',  title: 'Reference board' },
    { id: 'color',     column: 'right', title: 'Color' },
    { id: 'layers',    column: 'right', title: 'Layers' },
    { id: 'brush',     column: 'right', title: 'Brush Library' }
  ];

  /* Ayrı panel penceresi sözleşmesi (17b-panel-dock.js) kararlı DOM
     kimlikleri üzerinden çalışır; v5 panellerinin kendi kimliği yoktu. */
  const PANEL_IDS = {
    reference: 'v5ReferencePanel',
    color: 'v5ColorPanel',
    layers: 'v5LayersPanel',
    brush: 'v5BrushPanel'
  };

  const v5 = {
    ready: false,
    root: null,
    toolbar: null,
    menuLayer: null,
    insertLine: null,
    tabs: null,
    dockResizers: null,  // { left, right } dock genişlik tutamakları
    panels: {},          // id -> panel element
    states: {},          // id -> { id, docked, order, collapsed, floating, visible }
    recents: [],
    pendingRecent: '',   // çarkta sürüklenirken biriken renk; bırakınca eklenir
    seeded: false,
    toolPos: null,
    /* FAZ 6 B9: options bar ayrı sabitleme — grip sürükleyince
       kenetlenme bırakılır (optPinned), kendi konumu optPos'ta tutulur;
       çift tık geri kenetler (dock akışı syncOptionsBarPosition). */
    optPos: null,
    optPinned: false,
    // FAZ 6: araç çubuğu daraltma (alt ok). loadState store'dan yükler.
    toolbarCollapsed: false,
    narrowPanel: 'layers',
    leftWide: false,
    // Dock genişlikleri (px). null → CSS varsayılanı kullanılır.
    dockW: { left: null, right: null },
    refSig: '',
    clipRaf: 0,
    menu: null,
    applying: false,
    applyQueued: false
  };

  const $ = id => document.getElementById(id);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /* =========================================================
     ikonlar · tek set, 20×20, 1.5 px, yuvarlak uç
     ========================================================= */
  const PATHS = {
    select: '<path d="m4 3 7.1 16.9 2.5-7.4 7.4-2.5L4 3z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    brush: '<path d="M9.06 11.9 17.13 3.84a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.07"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
    fill: '<path d="M12 3 4.5 10.5a2.1 2.1 0 0 0 0 3L10.5 19.5a2.1 2.1 0 0 0 3 0L21 12"/><path d="m8 7 9 9"/><path d="M13 21h8"/>',
    smudge: '<path d="M12 3.2 6.4 8.8a7.1 7.1 0 1 0 11.2 0L12 3.2z"/><path d="M9 15.5c.8 1.2 2.4 1.7 4 1.2"/>',
    gradient: '<path d="M4 5h16v14H4z"/><path d="M4 5h4v14H4z"/><path d="M8 5h4v14H8z" opacity=".55"/><path d="M12 5h4v14h-4z" opacity=".25"/>',
    eraser: '<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    pencil: '<path d="m16.9 3.1 4 4L8 20.1l-5 1 1-5L16.9 3.1z"/><path d="m14.9 5.1 4 4"/>',
    shape: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="16.5" r="4"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/><path d="M7.5 10.5h6"/><path d="M10.5 7.5v6"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/><path d="M7.5 10.5h6"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    expand: '<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="m20 4-7 7"/><path d="m4 20 7-7"/>',
    sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    droplet: '<path d="M12 2.7 6.6 8.1a7 7 0 1 0 10.8 0L12 2.7z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5"/><path d="M12 3v12"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    panels: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    fit: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
    /* FAZ 6 B9: options bar grip noktaları */
    gripd: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>'
  };

  function svg(name, cls) {
    return '<svg class="' + (cls || 'v5-icon') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      (PATHS[name] || '') + '</svg>';
  }

  function icon(name) {
    return svg(name);
  }

  /* =========================================================
     yardımcılar
     ========================================================= */
  function isDraw() {
    return document.body.classList.contains('mode-draw');
  }

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function hexNorm(value) {
    const v = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(v) ? v : '';
  }

  function panelDef(id) {
    return DEFS.find(d => d.id === id) || null;
  }

  function panelState(id) {
    return v5.states[id] || null;
  }

  function defaultState(def, index) {
    return {
      id: def.id,
      column: def.column,
      docked: true,
      order: index,
      collapsed: false,
      dockedHeight: null,
      floating: { x: null, y: null, w: def.column === 'left' ? 280 : 340, h: null },
      visible: true
    };
  }

  /* =========================================================
     kalıcılık
     ========================================================= */
  function readStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch { return null; }
  }

  function saveStore() {
    try {
      const panels = DEFS.map(def => {
        const s = panelState(def.id) || defaultState(def, 0);
        return {
          id: def.id,
          column: s.column === 'left' ? 'left' : 'right',
          docked: s.docked !== false,
          order: Number(s.order) || 0,
          collapsed: !!s.collapsed,
          dockedHeight: Number.isFinite(s.dockedHeight) ? Math.round(s.dockedHeight) : null,
          floating: {
            x: s.floating && Number.isFinite(s.floating.x) ? Math.round(s.floating.x) : null,
            y: s.floating && Number.isFinite(s.floating.y) ? Math.round(s.floating.y) : null,
            w: s.floating && Number.isFinite(s.floating.w) ? Math.round(s.floating.w) : (def.column === 'left' ? 280 : 340),
            h: s.floating && Number.isFinite(s.floating.h) ? Math.round(s.floating.h) : null
          },
          visible: s.visible !== false
        };
      });
      localStorage.setItem(STORE_KEY, JSON.stringify({
        version: 3,
        panels,
        leftDockW: Number.isFinite(v5.dockW.left) ? Math.round(v5.dockW.left) : null,
        rightDockW: Number.isFinite(v5.dockW.right) ? Math.round(v5.dockW.right) : null,
        recents: v5.recents.slice(0, 8),
        seeded: v5.seeded,
        toolPos: v5.toolPos,
        /* FAZ 6 B9: options bar konum kalıcılığı */
        optPos: v5.optPos,
        optPinned: !!v5.optPinned,
        /* FAZ 6: araç çubuğu daraltma durumu (alt ok) */
        toolbarCollapsed: !!v5.toolbarCollapsed
      }));
      localStorage.setItem(RECENT_KEY, JSON.stringify(v5.recents.slice(0, 8)));
    } catch { /* depolama kapalıysa sessiz */ }
  }

  function loadState() {
    const saved = readStore();
    const byId = {};
    if (saved && Array.isArray(saved.panels)) {
      for (const row of saved.panels) {
        if (row && row.id) byId[row.id] = row;
      }
    }
    DEFS.forEach((def, index) => {
      const src = byId[def.id];
      const st = defaultState(def, index);
      if (src) {
        st.column = src.column === 'left' || src.column === 'right' ? src.column : def.column;
        st.docked = src.docked !== false;
        st.order = Number.isFinite(Number(src.order)) ? Number(src.order) : index;
        st.collapsed = !!src.collapsed;
        st.dockedHeight = Number.isFinite(Number(src.dockedHeight))
          ? clamp(Number(src.dockedHeight), def.id === 'color' ? 320 : 180, Math.max(180, innerHeight - 100)) : null;
        st.visible = src.visible !== false;
        if (src.floating && typeof src.floating === 'object') {
          st.floating = {
            x: Number.isFinite(Number(src.floating.x)) ? Number(src.floating.x) : null,
            y: Number.isFinite(Number(src.floating.y)) ? Number(src.floating.y) : null,
            w: Number.isFinite(Number(src.floating.w)) ? Number(src.floating.w) : (def.column === 'left' ? 280 : 340),
            h: Number.isFinite(Number(src.floating.h)) ? Number(src.floating.h) : null
          };
        }
      }
      v5.states[def.id] = st;
    });

    let recents = DEFAULT_RECENTS.slice();
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const cleaned = parsed.map(hexNorm).filter(Boolean);
        if (cleaned.length) recents = cleaned.slice(0, 8);
      }
    } catch { /* sessiz */ }
    v5.recents = recents;

    v5.seeded = !!(saved && saved.seeded);
    // Dock genişlikleri v3'te eklendi; eski kayıtlarda yoksa CSS varsayılanı.
    // null kaydı 0'a dönüştürmemek ve bozuk (0/çok küçük) değerleri yok
    // saymak için önce != null + alt sınır kontrolü gerekir.
    const savedDockW = value => (value != null && Number.isFinite(Number(value)) && Number(value) >= 160)
      ? Number(value) : null;
    v5.dockW = {
      left: saved ? savedDockW(saved.leftDockW) : null,
      right: saved ? savedDockW(saved.rightDockW) : null
    };
    if (saved && saved.toolPos && Number.isFinite(Number(saved.toolPos.left)) && Number.isFinite(Number(saved.toolPos.top))) {
      v5.toolPos = { left: Number(saved.toolPos.left), top: Number(saved.toolPos.top) };
    }
    /* FAZ 6 B9: options bar ayrı sabitleme geri yükle */
    if (saved && saved.optPos && Number.isFinite(Number(saved.optPos.left)) && Number.isFinite(Number(saved.optPos.top))) {
      v5.optPos = { left: Number(saved.optPos.left), top: Number(saved.optPos.top) };
    }
    v5.optPinned = !!(saved && saved.optPinned);
    /* FAZ 6: araç çubuğu daraltma durumu (alt ok) geri yükle. */
    v5.toolbarCollapsed = !!(saved && saved.toolbarCollapsed);
  }

  /* =========================================================
     iskelet
     ========================================================= */
  function setPanelsHidden(hidden) {
    document.body.classList.toggle('v5-panels-hidden', !!hidden);
    if (isDraw()) apply();
  }

  function buildRoot() {
    if (v5.root) return v5.root;
    const root = el('div');
    root.id = 'v5DrawUI';
    root.style.display = 'none';

    const left = el('div', 'v5-dock');
    left.id = 'v5LeftDock';
    const right = el('div', 'v5-dock');
    right.id = 'v5RightDock';
    const floats = el('div', 'v5-float-layer');
    floats.id = 'v5FloatLayer';

    const line = el('div');
    line.id = 'v5InsertLine';
    line.hidden = true;

    const menus = el('div');
    menus.id = 'v5MenuLayer';

    const tabs = el('div');
    tabs.id = 'v5PanelTabs';

    const restore = el('button', null, icon('panels') + '<span>Paneller</span>');
    restore.id = 'v5RestorePanels';
    restore.type = 'button';
    restore.title = 'Show panels (Tab)';
    restore.addEventListener('click', () => {
      setPanelsHidden(false);
    });

    // Dock genişliğini ayarlayan tutamaklar. Dock'un kendisi kaydırılabilir
    // olduğu için (overflow) tutamaklar kökte durur; layoutPanels konumlar.
    const leftResize = el('div', 'v5-dock-resize v5-dock-resize--left');
    leftResize.tabIndex = 0;
    leftResize.setAttribute('role', 'separator');
    leftResize.setAttribute('aria-orientation', 'vertical');
    leftResize.setAttribute('aria-label', 'Resize left panels');
    leftResize.title = 'Drag from the edge to resize · double-click to reset';
    const rightResize = el('div', 'v5-dock-resize v5-dock-resize--right');
    rightResize.tabIndex = 0;
    rightResize.setAttribute('role', 'separator');
    rightResize.setAttribute('aria-orientation', 'vertical');
    rightResize.setAttribute('aria-label', 'Resize right panels');
    rightResize.title = 'Drag from the edge to resize · double-click to reset';

    root.append(left, right, floats, leftResize, rightResize, line, menus, tabs, restore);

    v5.dockResizers = { left: leftResize, right: rightResize };
    bindDockResize(leftResize, 'left');
    bindDockResize(rightResize, 'right');
    document.body.appendChild(root);

    v5.root = root;
    v5.menuLayer = menus;
    v5.insertLine = line;
    v5.tabs = tabs;
    return root;
  }

  function buildToolbar() {
    if (v5.toolbar) return v5.toolbar;
    const bar = el('div');
    bar.id = 'v5Toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Drawing tools');
    bar.setAttribute('data-l10n-aria', 'Drawing tools');
    /* L10N: statik HTML etiketleri data-l10n ile işaretlenir; sonda
       L10N.applyDom doldurur ve dil değişince __v5L10nRefresh
       çubuğu yeniden kurar. */

    bar.innerHTML =
      /* Araç gövdesi: ok düğmesi (daralt/aç) bunun dışında kalır —
         çubuk kapalıyken yalnız ok görünür kalır (kullanıcı talebi:
         panelin altındaki okla aç/kapat + animasyon). */
      '<div class="v5-tb-body">' +
      /* Taşıma kolu (FAZ 6 B9): tık menü açmaz — ayarlar ⋯ → Ayarlar
         penceresinin Çizim sütununda. Tooltip yalnız taşıma/kenetme. */
      '<button class="v5-grip" type="button" data-l10n-title="Drag to move · double-click to dock" data-l10n-aria="Drag to move" aria-haspopup="false" aria-expanded="false">' +
        icon('gear') +
      '</button>' +
      '<div class="v5-group" data-group="select">' +
        '<button class="v5-tool" type="button" data-tool="transform" data-l10n-title="Select (V)" data-l10n-aria="Select">' +
          icon('select') + '<span class="v5-label" data-l10n="Select">Select</span>' +
        '</button>' +
        '<button class="v5-caret" type="button" data-menu="select" data-l10n-title="Selection tools" data-l10n-aria="Selection tools" aria-haspopup="true" aria-expanded="false">' +
          icon('chevron') +
        '</button>' +
      '</div>' +
      '<div class="v5-group" data-group="brush">' +
        '<button class="v5-tool" type="button" data-tool="brush" data-l10n-title="Brush (B)" data-l10n-aria="Brush">' +
          icon('brush') + '<span class="v5-label" data-l10n="Brush">Brush</span>' +
        '</button>' +
        '<button class="v5-caret" type="button" data-menu="paint" data-l10n-title="Paint tools" data-l10n-aria="Paint tools" aria-haspopup="true" aria-expanded="false">' +
          icon('chevron') +
        '</button>' +
      '</div>' +
      '<button class="v5-tool" type="button" data-tool="eraser" data-l10n-title="Eraser (E)" data-l10n-aria="Eraser">' +
        icon('eraser') + '<span class="v5-label" data-l10n="Eraser">Eraser</span>' +
      '</button>' +
      '<button class="v5-tool" type="button" data-tool="fill" data-l10n-title="Paint bucket · selected layer only" data-l10n-aria="Paint bucket">' +
        icon('fill') + '<span class="v5-label" data-l10n="Fill">Fill</span>' +
      '</button>' +
      '<button class="v5-tool" type="button" data-tool="smudge" data-l10n-title="Smudge (drag colors)" data-l10n-aria="Smudge tool">' +
        icon('smudge') + '<span class="v5-label" data-l10n="Smudge">Smudge</span>' +
      '</button>' +
      '<button class="v5-tool" type="button" data-tool="gradient" data-l10n-title="Gradient (foreground color to transparent)" data-l10n-aria="Gradient tool">' +
        icon('gradient') + '<span class="v5-label" data-l10n="Gradient">Gradient</span>' +
      '</button>' +
      /* Şekil düğmesi çubuktan çıkarıldı — tek yol Çizim Ayarları
         (dişli) menüsündeki "Shape tool" satırı (U kısayolu sürer). */
      '<button class="v5-tool" type="button" data-action="pan" data-l10n-title="Pan (H)" data-l10n-aria="Pan" aria-pressed="false">' +
        icon('hand') + '<span class="v5-label" data-l10n="Pan">Pan</span><span class="v5-kbd">H</span>' +
      '</button>' +
      '<button class="v5-tool" type="button" data-action="zoom" data-l10n-title="Zoom in (Z)" data-l10n-aria="Zoom in">' +
        icon('zoom') +
      '</button>' +
      '<button class="v5-tool" type="button" data-action="zoom-out" data-l10n-title="Zoom out (Shift+Z)" data-l10n-aria="Zoom out">' +
        icon('zoomOut') +
      '</button>' +
      '<button class="v5-icon-btn" type="button" data-action="alpha-lock" data-l10n-title="Alpha lock · paint applies only to existing paint" data-l10n-aria="Alpha lock" aria-pressed="false">' +
        icon('lock') +
      '</button>' +
      '<span class="v5-sep" aria-hidden="true"></span>' +
      '<button class="v5-icon-btn" type="button" data-action="undo" data-l10n-title="Undo (Ctrl+Z)" data-l10n-aria="Undo">' + icon('undo') + '</button>' +
      '<button class="v5-icon-btn" type="button" data-action="redo" data-l10n-title="Redo (Ctrl+Shift+Z)" data-l10n-aria="Redo">' + icon('redo') + '</button>' +
      '<button class="v5-icon-btn v5-only-narrow" type="button" data-action="png" data-l10n-title="Export as PNG" data-l10n-aria="Export as PNG">' + icon('download') + '</button>' +
      '</div>' +
      /* Panelin altındaki daralt/aç oku: çubuk katlanırken yukarı kayar,
         ok yerinde kalır ve yönü döner (yay eğrisi). */
      '<button id="v5ToolbarToggle" type="button" data-l10n-title="Collapse / expand toolbar" data-l10n-aria="Collapse or expand the toolbar" aria-expanded="true">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>';

    v5.root.appendChild(bar);
    v5.toolbar = bar;
    /* L10N: işaretli etiketleri güncel dile göre doldur. */
    if (window.L10N && typeof window.L10N.applyDom === 'function') window.L10N.applyDom(bar);

    bar.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const menuBtn = target.closest('[data-menu]');
      if (menuBtn) {
        event.preventDefault();
        if (menuBtn.dataset.menu === 'paint') openPaintMenu(menuBtn);
        else openSelectMenu(menuBtn);
        return;
      }
      const toolBtn = target.closest('[data-tool]');
      if (toolBtn) {
        event.preventDefault();
        /* K13 · önceki araç setTool'dan ÖNCE okunur — aksi halde
           seçimin kendisi "zaten fırçadaymış" sanıp menüyü açardı. */
        let prevTool = '';
        try { prevTool = String(inkState().tool || ''); } catch { /* sessiz */ }
        setTool(toolBtn.dataset.tool);
        /* K13 · fırça düğmesi çift işlev (kullanıcı talebi: "şuraya
           basınca fırça ayarlarını açması gerekmiyor mu"): fırça
           ZATEN seçiliyse düğme ayar menüsünü (fırça kütüphanesi)
           açar; değilse tek işi seçmek olur. */
        if (toolBtn.dataset.tool === 'brush' && prevTool === 'brush') {
          const tipBtn = document.querySelector('#v5OptionsBar .v5-opt-brush');
          if (tipBtn) tipBtn.click();
        }
        return;
      }
      const action = target.closest('[data-action]');
      if (!action) return;
      event.preventDefault();
      const name = action.dataset.action;
      if (name === 'pan') {
        const on = !(window.dpProto && dpProto.panMode);
        if (typeof dpSetPan === 'function') dpSetPan(on);
        else if (window.inkEditorUi) inkEditorUi.space = on;
        syncToolbar();
      } else if (name === 'alpha-lock') {
        /* FAZ 6 A1: aktif katmanın alfa kilidini ternär çevir; vuruş
           haritası (30-ink-tools) kiliti vuruş başında okur. */
        try {
          const layer = currentLayer();
          if (layer) layer.alphaLock = !layer.alphaLock;
          if (typeof scheduleSave === 'function') scheduleSave();
        } catch { /* sessiz */ }
        syncToolbar();
      } else if (name === 'zoom' || name === 'zoom-out') {
        /* Görünen ana yüzey çizim tuvalidir; yakınlaştırma oraya uygulanır.
           (Referans panosunun kendi zoom'u sol paneldeki kontrolde.) */
        const base = name === 'zoom' ? 1.25 : 0.8;
        const factor = event.shiftKey || event.altKey ? (base > 1 ? 0.8 : 1.25) : base;
        v5ZoomBy(factor);
      } else if (name === 'undo') {
        const btn = $('btnInkHistoryUndo');
        if (btn) btn.click();
        else if (typeof undo === 'function') undo();
      } else if (name === 'redo') {
        const btn = $('btnInkHistoryRedo');
        if (btn) btn.click();
        else if (typeof redo === 'function') redo();
      } else if (name === 'png') {
        if (typeof exportPNG === 'function') exportPNG();
      }
    });

    bindToolbarDrag(bar);

    /* FAZ 6: alt ok — çubuğu daralt/genişlet. Kayıt yaylı: v5.toolbarCollapsed
       store'a yazılır (loadstate restore eder). */
    const tbToggle = bar.querySelector('#v5ToolbarToggle');
    if (tbToggle) {
      tbToggle.addEventListener('click', () => {
        const collapse = !bar.classList.contains('is-collapsed');
        bar.classList.toggle('is-collapsed', collapse);
        tbToggle.setAttribute('aria-expanded', collapse ? 'false' : 'true');
        v5.toolbarCollapsed = collapse;
        saveStore();
        /* FAZ 6: odak HEMEN bırak — buton odakta kalırsa çizim sırasında
           Enter/Space (tuş kısayolları, onay diyalogları) odaklı butona
           click gönderip çubuğun KENDİ KENDİNE açılıp kapanmasına yol
           açıyordu (kullanıcı raporu). */
        tbToggle.blur();
        /* FAZ 6: açılışta alttaki options bar çubuğun altına İTSİN —
           üst üste binmesin (kullanıcı talebi). Sabitlenmiş (optPinned)
           bar çubuk bölgesiyle çakışıyorsa kenetleme bırakılır; akış
           barı ise animasyon sonrası çubuğun altına alınır. */
        syncOptionsBarAfterToggle(collapse);
      });
      if (v5.toolbarCollapsed) {
        bar.classList.add('is-collapsed');
        tbToggle.setAttribute('aria-expanded', 'false');
      }
    }

    return bar;
  }

  /* =========================================================
     OPTIONS BAR (FAZ 5)
     ------------------------------------------------------------------
     Seçili aracın OPTIONS_SCHEMAS şeması manifest'ten okunur ve
     araç çubuğunun altındaki ikinci hap içinde 32 px kontrol olarak
     basılır. Widget'lar doğrudan inkState alanına bağlanır; panel
     kaydırıcıları inkSyncUI kancasıyla senkron kalır. Kutu taşarsa
     fazlalık son widget'tan geriye doğru `⋯` menüsüne kaydırılır.
     ========================================================= */
  function optionValueFormat(w) {
    return v => {
      if (w.unit) return String(Math.round(v)) + w.unit;
      if (w.scale) return Math.round(v * 100) + '%';
      return String(Math.round(v * 100) / 100);
    };
  }

  /* K9 · canlı önizleme balonu: Boyut/Opaklık (ve Sertlik/Akış) sürüklenirken
     kaydırıcının altında GERÇEK boyutta ve GERÇEK opaklıkta örnek vuruş
     gösterilir — resmi motor çizici (inkDrawStrokeOnContext) ile. Sığmayacak
     kadar büyük fırçada ölçek notu ile gösterilir. */
  let v5LivePicker = null;   // {root, canvas, val}
  let v5LiveTimer = 0;
  let v5LiveShown = false;

  function v5BrushLiveHide() {
    if (!v5LivePicker) return;
    v5LivePicker.root.hidden = true;
    v5LiveShown = false;
  }

  function v5BrushLiveScheduleHide() {
    clearTimeout(v5LiveTimer);
    v5LiveTimer = setTimeout(v5BrushLiveHide, 850);
  }

  function v5BrushLiveEnsure() {
    if (v5LivePicker) return v5LivePicker;
    const root = document.createElement('div');
    root.id = 'v5LivePreview';
    root.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    const val = document.createElement('span');
    val.id = 'v5LivePreviewVal';
    root.append(val, canvas);
    document.body.appendChild(root);
    v5LivePicker = { root, canvas, val };
    document.addEventListener('pointerup', () => {
      if (v5LiveShown) v5BrushLiveScheduleHide();
    });
    return v5LivePicker;
  }

  function v5BrushLivePaint() {
    const pk = v5BrushLiveEnsure();
    const ink = inkState();
    if (!ink) return;
    const brush = typeof inkGetBrush === 'function' ? inkGetBrush(ink.brushId) : null;
    const real = clamp(Number(ink.size) || 1, 1, 400);
    /* K9-SON · TEK NOKTA: balon fırça damgasını GERÇEK boyutta ortada
       gösterir (tam basınç, gerçek sertlik/opaklık motor'undan) —
       340px'e kadar ölçek 1 ve etiket yalın; daha büyük fırçachlarda
       ekran bandına sığmak için tek dürüst × notu düşer. Önceki dalga
       biçemi user iptaliyle kaldırıldı. */
    const scale = Math.min(1, 340 / Math.max(real, 6));
    const draw = Math.max(3, real * scale);
    const cssS = Math.ceil(Math.min(360, draw + 24));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = pk.canvas;
    if (c.width !== Math.round(cssS * dpr)) c.width = Math.round(cssS * dpr);
    if (c.height !== Math.round(cssS * dpr)) c.height = Math.round(cssS * dpr);
    c.style.width = cssS + 'px';
    c.style.height = cssS + 'px';
    /* K12 · büyük damgada yerleşim kolona döner: etiket üste, damga
       altta tam ortada — satır düzeninde etiket damgayi sıkıştırıp
       kenardan taşırmasını önlemek için. */
    pk.root.classList.toggle('is-big', draw >= 150);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssS, cssS);
    /* Tek nokta: forEachDab'ın "ilk damla" yolu — tek damga, tam boyut. */
    const points = [{
      x: cssS / 2,
      y: cssS / 2,
      p: 1,
      s: 0,
    }];
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
      sizePx: draw,
    });
    pk.val.textContent = Math.round(real) + ' px · %' +
      Math.round((ink.opacity == null ? 1 : ink.opacity) * 100) +
      (scale < 1 ? ' · ×' + scale.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : '');
  }

  function v5BrushLiveShow(anchorInput) {
    const pk = v5BrushLiveEnsure();
    v5BrushLivePaint();
    pk.root.hidden = false;
    v5LiveShown = true;
    const rect = anchorInput.getBoundingClientRect();
    const w = pk.root.offsetWidth || 220;
    const left = clamp(rect.left + rect.width / 2 - w / 2, 8, (window.innerWidth || 1200) - w - 8);
    pk.root.style.left = Math.round(left) + 'px';
    pk.root.style.top = Math.round(rect.bottom + 10) + 'px';
    v5BrushLiveScheduleHide();
  }

  const LIVE_KEYS = { size: 1, opacity: 1, hardness: 1, flow: 1 };

  function buildOptionRange(w) {
    const box = el('div', 'v5-opt');
    box.dataset.opt = w.key;
    const lab = el('label', 'v5-opt-label', w.label);
    const input = el('input', 'v5-range v5-opt-range');
    input.type = 'range';
    input.id = 'v5opt_' + w.key;
    input.min = String(w.min != null ? w.min : 0);
    input.max = String(w.max != null ? w.max : 100);
    input.step = String(w.step || 1);
    input.setAttribute('aria-label', w.tip || w.label);
    input.title = w.tip || w.label;
    lab.setAttribute('for', input.id);
    const out = el('output', 'v5-opt-val');
    out.setAttribute('for', input.id);
    /* K12 · tıkla/çift-tık elle yaz: çıktı kutusu metin girişine döner —
       Enter yazar, Esc/blur iptal (blur'da geçerli değer yazar).
       Tek tık da açar (kullanıcı tık hareketini kullanıyordu). */
    out.title = 'Click: type the value';
    const openTypeEditor = ev => {
      /* K12 · tık barın kenetlenme-düğmesine sızmaz — sızardıysa
         bar yeniden boyanıp editör anında kapanıyordu (test kanalında
         bubble'sız yazım görünür ama gerçek fare iki tıkla kapanır). */
      ev.preventDefault();
      ev.stopPropagation();
      if (out.querySelector('input')) return;
      const ink0 = inkState();
      const sc = w.scale || 1;
      const cur = Number(ink0[w.key]) || 0;
      const editor = el('input', 'v5-opt-typed');
      editor.type = 'text';
      editor.inputMode = 'decimal';
      editor.value = String(Math.round(cur / sc * 100) / 100);
      editor.setAttribute('aria-label', w.label + ' — type a value');
      /* Tek çıkış noktası: finalize(cancelled). Enter/Esc doğrudan
         finalize çağırır — blur() yalnızca destek yolu. K12 düzeltmesi:
         pencere OS odağını kaybettiğinde (arka plan) Chromium odak
         üst-adımlarını ertelediğinden blur olayı hiç gelmiyordu ve
         Enter yazımı sessiz kayboluyordu. */
      let finalized = false;
      const finalize = cancelled => {
        if (finalized) return;
        finalized = true;
        editor.remove();
        const v = cancelled ? NaN : parseFloat(editor.value.replace(',', '.'));
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        if (Number.isFinite(v)) {
          const cl = clamp(v, Math.min(min, max), Math.max(min, max));
          const ink = inkState();
          ink[w.key] = cl * sc;
          if (ink.tool !== 'eraser' && w.key !== 'fillTolerance') {
            const brush = typeof inkGetBrush === 'function' ? inkGetBrush(ink.brushId) : null;
            if (brush && w.key in brush) {
              brush[w.key] = cl * sc;
              if (typeof inkSaveBrushOverride === 'function') inkSaveBrushOverride(brush);
            }
          }
          if (LIVE_KEYS[w.key]) v5BrushLiveShow(input);
          if (typeof inkPreviewBrush === 'function') inkPreviewBrush();
          if (typeof inkUpdateHud === 'function') inkUpdateHud();
          if (typeof scheduleSave === 'function') scheduleSave();
        }
        box.__v5OptSync && box.__v5OptSync();
      };
      editor.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); finalize(false); }
        else if (ev.key === 'Escape') { ev.preventDefault(); finalize(true); }
      });
      editor.addEventListener('blur', () => {
        finalize(editor.dataset.cancel === '1');
      });
      editor.addEventListener('pointerdown', ev => ev.stopPropagation());
      out.replaceChildren(editor);
      editor.focus();
      editor.select();
    };
    out.addEventListener('click', openTypeEditor);
    out.addEventListener('dblclick', openTypeEditor);
    box.append(lab, input, out);
    const scale = w.scale || 1;
    const fmt = optionValueFormat(w);
    const sync = () => {
      try {
        /* K12 · editör açıkken çıktıyı yeniden boyama — out.textContent
           ataması editörü DOM'dan siler; açılışı izleyen herhangi bir
           global tazeleme (taşma ölçümü, hud, kenetlenme) onu yazmadan
           kapatıyordu (kullanıcı raporu: "yazamadan kapanıyor"). */
        if (out.querySelector('input')) return;
        const ink = inkState();
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        let v = Number(ink[w.key]);
        if (!Number.isFinite(v)) v = min * scale;
        input.value = String(Math.round(clamp(v / scale, min, max)));
        out.textContent = fmt(v);
        input.style.setProperty('--v5-p',
          (max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0) + '%');
      } catch { /* sessiz */ }
    };
    input.addEventListener('input', () => {
      const ink = inkState();
      const v = Number(input.value) * scale;
      if (!Number.isFinite(v)) return;
      ink[w.key] = v;
      // Panel kaydırıcılarıyla aynı fırça-üstüne-yazma davranışı
      // (31-ink-ui bindRange sömöntüği).
      if (ink.tool !== 'eraser' && w.key !== 'fillTolerance') {
        const brush = typeof inkGetBrush === 'function'
          ? inkGetBrush(ink.brushId) : null;
        if (brush && w.key in brush) {
          brush[w.key] = v;
          if (typeof inkSaveBrushOverride === 'function') {
            inkSaveBrushOverride(brush);
          }
        }
      }
      /* K12 · editör da açıkken (nadir) dokunma — textContent editörü siler. */
      const editing = out.querySelector('input');
      if (!editing) {
        out.textContent = fmt(v);
        input.style.setProperty('--v5-p',
          ((Number(input.value) - Number(input.min)) /
           Math.max(1, Number(input.max) - Number(input.min))) * 100 + '%');
      }
      /* K10 · fareyle bırakınca odağı bırak: Space gezinme kaydırıcıda
         kilitli kalmasın (PS davranışı). Klavye okları etkilenmez. */
      input.addEventListener('pointerup', () => input.blur(), { once: true });
      /* K9 · kaydırıcı canlı önizleme: Boyut/Opaklık/Akış/Sertlik sürüklenirken
         gerçek değer balonu açılır. */
      if (LIVE_KEYS[w.key]) v5BrushLiveShow(input);
      if (typeof inkPreviewBrush === 'function') inkPreviewBrush();
      if (typeof inkUpdateHud === 'function') inkUpdateHud();
      if (typeof scheduleSave === 'function') scheduleSave();
    });
    box.__v5OptSync = sync;
    return box;
  }

  function buildOptionToggle(w) {
    const box = el('div', 'v5-opt');
    box.dataset.opt = w.key;
    const lab = el('span', 'v5-opt-label', w.label);
    const btn = el('button', 'v5-opt-toggle');
    btn.type = 'button';
    btn.id = 'v5opt_' + w.key;
    btn.setAttribute('role', 'switch');
    btn.title = w.tip || w.label;
    btn.setAttribute('aria-label', w.tip || w.label);
    box.append(lab, btn);
    const sync = () => {
      try {
        const on = !!inkState()[w.key];
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      } catch { /* sessiz */ }
    };
    btn.addEventListener('click', () => {
      try { inkState()[w.key] = !inkState()[w.key]; } catch { /* sessiz */ }
      sync();
      if (typeof scheduleSave === 'function') scheduleSave();
    });
    box.__v5OptSync = sync;
    return box;
  }

  function buildOptionSelect(w) {
    const box = el('div', 'v5-opt');
    box.dataset.opt = w.key;
    const lab = el('label', 'v5-opt-label', w.label);
    const sel = el('select', 'v5-opt-select');
    sel.id = 'v5opt_' + w.key;
    sel.setAttribute('aria-label', w.tip || w.label);
    sel.title = w.tip || w.label;
    (w.options || []).forEach(o => {
      const opt = new Option(o.label, o.value);
      if (o.title) { opt.title = o.title; }
      sel.appendChild(opt);
    });
    lab.setAttribute('for', sel.id);
    box.append(lab, sel);
    const sync = () => {
      try { sel.value = String(inkState()[w.key] || (w.options[0] && w.options[0].value)); }
      catch { /* sessiz */ }
    };
    sel.addEventListener('change', () => {
      try { inkState()[w.key] = sel.value; } catch { /* sessiz */ }
      if (typeof inkSyncUI === 'function') inkSyncUI();
      if (typeof scheduleSave === 'function') scheduleSave();
    });
    box.__v5OptSync = sync;
    return box;
  }

  function buildOptionBrushTip(w) {
    const box = el('div', 'v5-opt v5-opt--tip');
    box.dataset.opt = '__brushTip';
    const btn = el('button', 'v5-opt-brush');
    btn.type = 'button';
    btn.title = w.tip || w.label;
    btn.setAttribute('aria-label', w.tip || w.label);
    btn.innerHTML = icon('brush') +
      '<span class="v5-opt-brush-name">&nbsp;</span>';
    btn.addEventListener('click', () => openBrushMenu(btn));
    box.appendChild(btn);
    const sync = () => {
      const name = btn.querySelector('.v5-opt-brush-name');
      if (!name) return;
      try {
        const brush = typeof inkGetBrush === 'function'
          ? inkGetBrush(inkState().brushId) : null;
        name.textContent = brush && brush.name ? brush.name : 'Brush';
      } catch { name.textContent = 'Brush'; }
    };
    box.__v5OptSync = sync;
    return box;
  }

  function buildOptionColor(w) {
    const box = el('div', 'v5-opt v5-opt--color');
    box.dataset.opt = '__color';
    const lab = el('span', 'v5-opt-label', w.label);
    const btn = el('button', 'v5-opt-color');
    btn.type = 'button';
    btn.title = w.tip || w.label;
    btn.setAttribute('aria-label', w.tip || w.label);
    btn.addEventListener('click', () => {
      /* FAZ 7.W: gradient aracında swatch seçili durağı düzenler —
         mini alpha seçici açılır (pro panel yerine). */
      try {
        const st = inkState();
        if (String(st.tool) === 'gradient' &&
            Array.isArray(st.gradientStops) && st.gradientStops.length) {
          openGradientPicker(btn);
          return;
        }
      } catch { /* sessiz */ }
      setPanelVisible('color', true);
    });
    box.append(lab, btn);
    const sync = () => {
      try {
        const st = inkState();
        /* FAZ 7.W: gradient aracında swatch seçili durağı gösterir —
           damar deseni üstünde yarı-saydam renk (alpha görünür). */
        if (String(st.tool) === 'gradient' &&
            Array.isArray(st.gradientStops) && st.gradientStops.length) {
          const i = Math.min(Math.max(0, st.gradientStopSel | 0),
            st.gradientStops.length - 1);
          const s = st.gradientStops[i];
          const a = Math.min(1, Math.max(0, Number(s.alpha) || 0));
          btn.style.background = `linear-gradient(${s.color}, ${s.color}),` +
            ` repeating-conic-gradient(#8b8b8b 0% 25%, #c4c4c4 0% 50%)`;
          btn.style.backgroundSize = 'auto, 8px 8px';
          btn.title = `${w.tip || w.label} · ${s.color} @ ${Math.round(a * 100)}%`;
        } else {
          btn.style.background = String(st.color || '#d4a24a');
        }
      } catch { /* sessiz */ }
    };
    box.__v5OptSync = sync;
    return box;
  }

  /* ==================================================================
     FAZ 7.W · çok-duraklı gradyan barı + mini durağı seçicisi
     ------------------------------------------------------------------
     Bar: durak tutamaçları — tık: seç · sürükle: konum · şeride çift
     tık: durak ekle (komşularla lineer karışım) · tutamağa sağ tık:
     sil (en az 2 kalır). Seçili durağın rengi/alpha'sı Color swatch'ı
     ve mini seçiciyle paylaşılır; TEK KAYNAK inkState().gradientStops
     (pişirme: 30-ink-tools vuruş başına deep kopya alır). */

  function gradStops() {
    try {
      const st = inkState();
      return Array.isArray(st.gradientStops) ? st.gradientStops : [];
    } catch { return []; }
  }

  function gradSel() {
    try {
      const st = inkState();
      const n = Array.isArray(st.gradientStops) ? st.gradientStops.length : 0;
      return Math.min(Math.max(0, st.gradientStopSel | 0), Math.max(0, n - 1));
    } catch { return 0; }
  }

  function gradHexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return { r: 212, g: 162, b: 74 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** Bar + Color swatch sync'i (widget __v5OptSync'leri). */
  function gradSyncBar() {
    const bar = v5.optionsBar;
    if (!bar) return;
    bar.querySelectorAll('.v5-opt').forEach(b => {
      if (typeof b.__v5OptSync === 'function') b.__v5OptSync();
    });
  }

  function buildOptionGradientBar(w) {
    const box = el('div', 'v5-opt v5-opt--gradient');
    box.dataset.opt = '__gradientStops';
    const lab = el('span', 'v5-opt-label', w.label);
    const strip = el('div', 'v5-grad-strip');
    strip.title = w.tip || w.label;
    const fill = el('div', 'v5-grad-fill');
    const handles = el('div', 'v5-grad-handles');
    strip.append(fill, handles);
    box.append(lab, strip);

    let dragIdx = -1;
    const pct = v => `${Math.round(v * 1000) / 10}%`;

    const paintFill = () => {
      const list = gradStops();
      if (!list.length) { fill.style.backgroundImage = ''; return; }
      const cs = list.map(s => `${s.color} ${pct(s.pos)}`).join(', ');
      fill.style.backgroundImage =
        `linear-gradient(90deg, ${cs}),` +
        ' repeating-conic-gradient(#8b8b8b 0% 25%, #c4c4c4 0% 50%)';
      fill.style.backgroundSize = 'auto, 8px 8px';
    };

    const paintHandles = () => {
      const list = gradStops();
      /* Sürükleme ortasında düğüm yeniden kurmak pointer capture'ı
         koparır: sayı değişmediyse yerinde güncelle, değiştiyse kur. */
      if (list.length && handles.children.length === list.length) {
        Array.from(handles.children).forEach((h, i) => {
          const s = list[i];
          h.style.left = pct(s.pos);
          h.style.background = s.color;
          h.classList.toggle('is-sel', i === gradSel());
          h.title = `#${i + 1} · ${s.color}`;
        });
        return;
      }
      handles.replaceChildren();
      list.forEach((s, i) => {
        const h = el('button', 'v5-grad-stop' + (i === gradSel() ? ' is-sel' : ''));
        h.type = 'button';
        h.style.left = pct(s.pos);
        h.style.background = s.color;
        h.title = `#${i + 1} · ${s.color} — tık: seçici · sürükle: taşı · Alt+tık: sil`;
        /* FAZ 7.X: görünür sil düğmesi — seçili durağın yanında × belirir;
           yanlışlıkla eklenen durakları Alt+tık bilmeden silmek için
           (kullanıcı isteği). Yalnız seçilide görünür: sürüklemeye
           giderken ✕ imlecin altına belirmesi yanlış silme yaratırdı. */
        const gx = el('span', 'v5-grad-x');
        gx.textContent = '×';
        gx.title = __t('Delete this stop');
        gx.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          const l = gradStops();
          if (l.length <= 2) return; /* en az iki durak */
          const wasSel = gradSel();
          l.splice(i, 1);
          try {
            inkState().gradientStopSel = Math.min(
              Math.max(0, wasSel > i ? wasSel - 1 : wasSel), l.length - 1);
          } catch { /* sessiz */ }
          paint(); gradSyncBar();
        });
        h.appendChild(gx);
        /* FAZ 7.X: tık/sürükle ayrımı — hareketsiz bırakış (≤5px) tık sayılır
           ve o durağın renk seçiciyi açar (kullanıcı isteği: topa tıkla,
           rengini seç). Sürükleme durak taşır. */
        let mvFrom = null;
        let mvMoved = false;
        h.addEventListener('pointerdown', ev => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          const l0 = gradStops();
          /* FAZ 7.W: Alt+tık = durak sil (Photoshop kalıbı). Sağ tık
             app'in radial menü jesti olduğu için (document-capture
             contextmenu olayı yutuyor) silme Alt+tık'ta. */
          if (ev.altKey) {
            if (l0.length <= 2) return; /* en az iki durak */
            const wasSel0 = gradSel();
            l0.splice(i, 1);
            try {
              inkState().gradientStopSel = Math.min(
                Math.max(0, wasSel0 > i ? wasSel0 - 1 : wasSel0), l0.length - 1);
            } catch { /* sessiz */ }
            paint(); gradSyncBar();
            return;
          }
          try { inkState().gradientStopSel = i; } catch { /* sessiz */ }
          dragIdx = i;
          mvFrom = { x: ev.clientX, y: ev.clientY };
          mvMoved = false;
          try { h.setPointerCapture(ev.pointerId); } catch { /* sessiz */ }
          paintHandles(); gradSyncBar();
        });
        h.addEventListener('pointermove', ev => {
          if (dragIdx !== i) return;
          if (mvFrom && !mvMoved) {
            const dx = ev.clientX - mvFrom.x, dy = ev.clientY - mvFrom.y;
            if (dx * dx + dy * dy > 25) mvMoved = true; /* >5px = sürükleme */
          }
          const r = strip.getBoundingClientRect();
          if (!r.width) return;
          const l = gradStops();
          if (!l[i]) return;
          const pos = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
          try { l[i].pos = pos; } catch { /* sessiz */ }
          h.style.left = pct(pos);
          paintFill();
        });
        const endDrag = () => {
          if (dragIdx !== i) return;
          dragIdx = -1;
          const tik = !mvMoved;
          mvFrom = null;
          paintFill(); gradSyncBar();
          if (tik) openGradientPicker(h); /* tık: bu durağın seçicisi */
        };
        h.addEventListener('pointerup', endDrag);
        h.addEventListener('lostpointercapture', endDrag);
        handles.appendChild(h);
      });
    };

    const paint = () => { paintFill(); paintHandles(); };

    /* Şeride tık (FAZ 7.X): boş alana tek tık = o konumda durak ekle +
       seçiciyi aç (renk popup'tan seçilir — kullanıcı isteği). Varolan
       durağa ≤8px tık = ekleme yok, yalnız onu seç + seçiciyi aç.
       Eski çift tık ekleme kaldırıldı: tek tıkta çift ekleme yapardı. */
    strip.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      /* DİKKAT: .v5-grad-handles katmanı (inset:0) şeridin üstünü kaplar —
         gerçek fare tığı boş alanda target=handles olur (fill değil).
         Tutamaç düğmeleri kendi pointerdown'ında stopPropagation yaptığı
         için buraya düşmezler; kabın kendisi kabul edilir. */
      if (ev.target !== strip && ev.target !== fill && ev.target !== handles) return;
      const r = strip.getBoundingClientRect();
      if (!r.width) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pos = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const list = gradStops();
      if (list.length < 2) return;
      /* Yakın durak (≤8px) varsa ekleme yok: seç + aç. */
      const yakin = list.findIndex(s =>
        Math.abs(s.pos * r.width - (ev.clientX - r.left)) <= 8);
      if (yakin >= 0) {
        try { inkState().gradientStopSel = yakin; } catch { /* sessiz */ }
        paint(); gradSyncBar();
        openGradientPicker(strip);
        return;
      }
      const sorted = list.map(s => s).sort((a, b) => a.pos - b.pos);
      let lo = sorted[0], hi = sorted[sorted.length - 1];
      for (let k = 0; k < sorted.length - 1; k += 1) {
        if (pos >= sorted[k].pos && pos <= sorted[k + 1].pos) {
          lo = sorted[k]; hi = sorted[k + 1]; break;
        }
      }
      const span = hi.pos - lo.pos;
      const t = span > 0 ? (pos - lo.pos) / span : 0;
      const pc = gradHexToRgb(lo.color), hc = gradHexToRgb(hi.color);
      const mix = (a, b) => Math.round(a + (b - a) * t);
      const stop = {
        pos,
        color: '#' + [mix(pc.r, hc.r), mix(pc.g, hc.g), mix(pc.b, hc.b)]
          .map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0'))
          .join(''),
        alpha: lo.alpha + (hi.alpha - lo.alpha) * t,
      };
      const at = list.indexOf(hi);
      list.splice(at >= 0 ? at : list.length, 0, stop);
      try { inkState().gradientStopSel = list.indexOf(stop); } catch { /* sessiz */ }
      paint(); gradSyncBar();
      openGradientPicker(strip);
    });

    box.__v5OptSync = paint;
    paint();
    return box;
  }

  /* ---- mini durağı seçicisi (SV kare + hue + damarlı alpha + hex +
     swatch satırı). 57 pro seçiciye alpha katmamak için bağımsız mini
     bileşen; dönüşümler 57'nin inkCpHexToHsv/inkCpHsvToHex'idir. ---- */

  function closeGradientPicker() {
    const p = v5.gradPicker;
    if (!p) return;
    v5.gradPicker = null;
    p.remove();
    document.removeEventListener('pointerdown', gradPickerOutside, true);
    window.removeEventListener('keydown', gradPickerKeys, true);
    document.removeEventListener('scroll', closeGradientPicker, true);
  }

  function gradPickerOutside(event) {
    const p = v5.gradPicker;
    if (!p) return;
    const t = event.target instanceof Element ? event.target : null;
    if (t && (p.contains(t) ||
        (v5.optionsBar && v5.optionsBar.contains(t)))) return;
    closeGradientPicker();
  }

  /* 36-ink-editor Escape delegasyonu için global kanca: seçici açıksa
     kapatır ve true döner (editör kendi Escape'inizi çalıştırmaz). */
  window.v5GradPickerClose = function () {
    if (!v5.gradPicker) return false;
    closeGradientPicker();
    return true;
  };

  function gradPickerKeys(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeGradientPicker();
  }

  function gradPickerRefresh() {
    const p = v5.gradPicker;
    if (p && typeof p.__gradSync === 'function') p.__gradSync();
  }

  function openGradientPicker(anchor) {
    closeGradientPicker();
    const list = gradStops();
    if (list.length < 2) return;
    const panel = el('div', 'v5-menu v5-grad-picker');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', __t('Gradient stop color'));

    const sv = el('div', 'v5-grad-sv');
    const svDot = el('div', 'v5-grad-sv-dot');
    sv.appendChild(svDot);
    const hue = el('div', 'v5-grad-hue');
    const hueDot = el('div', 'v5-grad-dot');
    hue.appendChild(hueDot);
    const alpha = el('div', 'v5-grad-alpha');
    const alphaFill = el('div', 'v5-grad-alpha-fill');
    const alphaDot = el('div', 'v5-grad-dot');
    alpha.append(alphaFill, alphaDot);
    const row = el('div', 'v5-grad-row');
    const hexIn = el('input', 'v5-grad-hex');
    hexIn.type = 'text';
    hexIn.spellcheck = false;
    hexIn.maxLength = 7;
    hexIn.placeholder = '#rrggbb';
    row.appendChild(hexIn);
    /* FAZ 7.X: seçili durağı silme düğmesi — popup açıkken en az iki
       durak kalıyorsa siler; bar ve popup yeni seçime bağlanır. */
    const del = el('button', 'v5-grad-del');
    del.type = 'button';
    del.textContent = '×';
    del.title = __t('Delete selected stop');
    del.setAttribute('aria-label', __t('Delete selected stop'));
    del.addEventListener('click', () => {
      const l = gradStops();
      if (l.length <= 2) return; /* en az iki durak */
      const wasSel = gradSel();
      l.splice(wasSel, 1);
      try {
        inkState().gradientStopSel = Math.min(
          Math.max(0, wasSel), Math.max(0, l.length - 1));
      } catch { /* sessiz */ }
      gradSyncBar();
      gradPickerRefresh(); /* popup yeni durağa bağlanır */
    });
    row.append(del);
    const swRow = el('div', 'v5-grad-swatches');
    ['#ffffff', '#000000', '#ff5a5f', '#ff9f43', '#ffd23d',
      '#3dff7a', '#3d9bff', '#9b5de5'].forEach(c => {
      const sw = el('button', 'v5-grad-swatch');
      sw.type = 'button';
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => apply(inkCpHexToHsv(c)));
      swRow.appendChild(sw);
    });
    panel.append(sv, hue, alpha, row, swRow);
    /* FAZ 7.W: seçici içi pointer olayları app'e sızmaz — app tuval-
       dışı pointerdown'u "dış tık" sayıp çizim editörünü kapatıyordu
       (SV karesine basınca mode-reference'a düşüyordu). Yakalama
       evresindeki dış-tık kapanışımız (gradPickerOutside) etkilenmez:
       o document'te, bu kabarcık evresinde çalışır. */
    panel.addEventListener('pointerdown', ev => ev.stopPropagation());
    panel.addEventListener('pointerup', ev => ev.stopPropagation());
    (v5.menuLayer || v5.root).appendChild(panel);
    v5.gradPicker = panel;

    /* cur: seçili durağın hsv+alpha aynası; state tek kaynak, her
       mutasyon writeBack ile state'e yazılır. */
    let cur = { ...inkCpHexToHsv(list[gradSel()].color), a: Number(list[gradSel()].alpha) || 0 };

    const writeBack = () => {
      const l = gradStops();
      const s = l[gradSel()];
      if (!s) return;
      s.color = inkCpHsvToHex(cur.h, cur.s, cur.v);
      s.alpha = Math.min(1, Math.max(0, cur.a));
    };

    const paintPop = () => {
      const hex = inkCpHsvToHex(cur.h, cur.s, cur.v);
      sv.style.background = 'linear-gradient(to top, #000, rgba(0,0,0,0)),' +
        ` linear-gradient(to right, #fff, hsl(${cur.h} 100% 50%))`;
      svDot.style.left = `${Math.round(cur.s * 100)}%`;
      svDot.style.top = `${Math.round((1 - cur.v) * 100)}%`;
      svDot.style.background = hex;
      hueDot.style.left = `${Math.round(cur.h / 360 * 100)}%`;
      hueDot.style.background = `hsl(${cur.h} 100% 50%)`;
      alphaFill.style.backgroundImage = `linear-gradient(90deg, transparent, ${hex})`;
      alphaDot.style.left = `${Math.round(cur.a * 100)}%`;
      alphaDot.style.background = hex;
      if (document.activeElement !== hexIn) hexIn.value = hex;
    };

    const apply = patch => {
      Object.assign(cur, patch);
      cur.h = ((cur.h % 360) + 360) % 360;
      cur.s = Math.min(1, Math.max(0, cur.s));
      cur.v = Math.min(1, Math.max(0, cur.v));
      cur.a = Math.min(1, Math.max(0, cur.a));
      writeBack();
      paintPop();
      gradSyncBar();
    };

    /* Bar etkileşimi seçimi değiştirdiğinde popup yeni durağa bağlanır
       (gradCommit → gradPickerRefresh → __gradSync). */
    panel.__gradSync = () => {
      const l = gradStops();
      const s = l[gradSel()];
      if (!s) return;
      cur = { ...inkCpHexToHsv(s.color), a: Number(s.alpha) || 0 };
      paintPop();
    };

    const dragChannel = (node, fn) => {
      let on = false;
      const calc = ev => {
        const r = node.getBoundingClientRect();
        if (!r.width) return null;
        return {
          x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
          y: Math.min(1, Math.max(0, (ev.clientY - r.top) / Math.max(1, r.height))),
        };
      };
      node.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        on = true;
        try { node.setPointerCapture(ev.pointerId); } catch { /* sessiz */ }
        const p = calc(ev);
        if (p) fn(p);
      });
      node.addEventListener('pointermove', ev => {
        if (!on) return;
        const p = calc(ev);
        if (p) fn(p);
      });
      const end = () => { on = false; };
      node.addEventListener('pointerup', end);
      node.addEventListener('lostpointercapture', end);
    };

    dragChannel(sv, p => apply({ s: p.x, v: 1 - p.y }));
    dragChannel(hue, p => apply({ h: p.x * 360 }));
    dragChannel(alpha, p => apply({ a: p.x }));

    hexIn.addEventListener('change', () => {
      const raw = hexIn.value.trim();
      const v = hexNorm(raw.startsWith('#') ? raw : `#${raw}`);
      if (v) apply(inkCpHexToHsv(v));
      else paintPop(); /* geçersiz giriş — aynadan geri yaz */
    });
    /* Panel içi tuşları app.js kısayollarından izole et; Escape yine
       window-yakalayıcıda bize ulaşır (gradPickerKeys). */
    panel.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') ev.stopPropagation();
    });
    hexIn.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') hexIn.blur();
    });

    keepInViewport(panel, anchor);
    /* FAZ 7.X: ilk açılışta hemen boya — SV arka planı, alpha dolgusu ve
       nokta konumları ilk etkileşime kadar boş kalıyordu (kullanıcı
       bildirimi: ilk açılışta kare koyu/boş). */
    paintPop();
    setTimeout(() => {
      document.addEventListener('pointerdown', gradPickerOutside, true);
      /* Escape'i window yakalayıcısında yakala: app.js'in document
         seviyesindeki stopPropagation'ları Escape'i yutuyordu. */
      window.addEventListener('keydown', gradPickerKeys, true);
      document.addEventListener('scroll', closeGradientPicker, true);
    }, 0);
  }

  /** FAZ 6 A1: alfa kilidi seçenek widget'ı — katman düzeyi alan,
      inkState'ten bağımsız olduğu için özel fabrika. */
  function buildOptionAlphaLock(w) {
    const box = el('div', 'v5-opt');
    box.dataset.opt = '__alphaLock';
    const lab = el('span', 'v5-opt-label', w.label);
    const btn = el('button', 'v5-opt-toggle');
    btn.type = 'button';
    btn.id = 'v5opt_alphaLock';
    btn.setAttribute('role', 'switch');
    btn.title = w.tip || w.label;
    btn.setAttribute('aria-label', w.tip || w.label);
    box.append(lab, btn);
    const sync = () => {
      let on = false;
      try {
        const layer = currentLayer();
        on = !!(layer && layer.alphaLock);
      } catch { /* sessiz */ }
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    };
    btn.addEventListener('click', () => {
      try {
        const layer = currentLayer();
        if (layer) layer.alphaLock = !layer.alphaLock;
        if (typeof scheduleSave === 'function') scheduleSave();
      } catch { /* sessiz */ }
      sync();
      // Toolbar'daki kilidi düğmesinin de ışığı tazelenir.
      syncToolbar();
    });
    box.__v5OptSync = sync;
    return box;
  }

  /* FAZ 6 B6: seçim modu widget'ı — 4'lü segment (Yeni/Ekle/Çıkar/
     Kesişim), inkState().selectionMode'a yazar; is-active tek ışık
     (sözleşme 2). Persisted moddan bağımsız geçici Shift/Alt davranışı
     motor (30/36) tarafındadır. */
  function buildOptionSelMode(w) {
    const box = el('div', 'v5-opt v5-opt-selmode');
    box.dataset.opt = '__selmode';
    const lab = el('span', 'v5-opt-label', w.label || __t('Mode'));
    const group = el('div', 'v5-opt-selmode-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', w.tip || __t('Selection mode'));
    const MODES = [
      { value: 'new', label: 'New',
        title: 'New selection (replaces the previous)' },
      { value: 'add', label: 'Add',
        title: 'Add to selection — Shift, temporary' },
      { value: 'sub', label: 'Subtract',
        title: 'Subtract from selection — Ctrl or Alt, temporary' },
      { value: 'intersect', label: 'Intersect',
        title: 'Intersect — Shift+Ctrl or Shift+Alt, temporary' },
    ];
    const btns = [];
    for (const md of MODES) {
      const b = el('button', 'v5-selmode-btn', __t(md.label));
      b.type = 'button';
      b.dataset.value = md.value;
      b.title = __t(md.title)
        + (w.tip && w.tip !== md.title ? ' · ' + __t(md.title) : '');
      b.setAttribute('aria-label', __t(md.title));
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        try { inkState().selectionMode = md.value; } catch { /* sessiz */ }
        if (typeof inkSyncUI === 'function') inkSyncUI();
        if (typeof scheduleSave === 'function') scheduleSave();
      });
      btns.push(b);
      group.appendChild(b);
    }
    box.append(lab, group);
    const sync = () => {
      let cur = 'new';
      try { cur = String(inkState().selectionMode || 'new'); } catch { /* sessiz */ }
      for (const b of btns) {
        const on = b.dataset.value === cur;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    box.__v5OptSync = sync;
    sync();
    return box;
  }

  /* FAZ 6 A4: okunur bilgi satırı — gizmo/transform değerleri.
     state→UI tek yönlüdür; sayısal girişli çift-yön HUD (B7) ayrı maddedir. */
  function buildOptionInfo(w) {
    const box = el('div', 'v5-opt v5-opt-info');
    box.dataset.opt = '__info';
    const lab = el('span', 'v5-opt-label', w.label || '');
    const val = el('span', 'v5-opt-info-val', '—');
    box.title = w.tip || w.label || '';
    box.append(lab, val);
    const sync = () => {
      try {
        const ink = inkState();
        const b = typeof inkSelectionBounds === 'function'
          ? inkSelectionBounds() : null;
        if (!b || !ink.selection.length) {
          val.textContent = 'none';
          return;
        }
        val.textContent = Math.round(b.x) + ', ' + Math.round(b.y) +
          ' · ' + Math.round(b.w) + '×' + Math.round(b.h) + ' px';
      } catch { val.textContent = '—'; }
    };
    box.__v5OptSync = sync;
    sync();
    return box;
  }

  /* FAZ 6 B7: Transform HUD — sayısal X/Y/W/H/R alanları, gizmo ile
     çift-yön: alana yaz (Enter/blur) inkApplyNumericTransform motoru
     tek yoldan uygular; gizmo drag inkUpdateGizmo → __v5OptSync
     değerleri tazeler. Yazan alana sync dokunmaz. Seçim yokken satır
     gizlenir ("Deselect" aynı kural). R her girişte merkezden
     ekstra dönüş uygular (akümüle edilmez). */
  function buildOptionGizmoHud(w) {
    const box = el('div', 'v5-opt v5-opt-hud');
    box.dataset.opt = w.id || '__gizmohud';
    const lab = el('span', 'v5-opt-label', w.label || __t('Selection'));
    const fields = [];
    const FIELDS = [
      { key: 'x', label: 'X', title: 'Selection X — top-left corner, px' },
      { key: 'y', label: 'Y', title: 'Selection Y — top-left corner, px' },
      { key: 'w', label: 'W', title: 'Selection width, px' },
      { key: 'h', label: 'H', title: 'Selection height, px' },
      { key: 'r', label: 'R', title: 'Rotation — degrees from center, Enter applies' },
    ];
    for (const f of FIELDS) {
      const wrap = el('label', 'v5-opt-hud-field');
      wrap.title = f.title;
      wrap.setAttribute('aria-label', f.title);
      const cap = el('span', 'v5-opt-hud-cap', f.label);
      const input = el('input', 'v5-opt-hud-num');
      input.type = 'number';
      input.step = '1';
      input.setAttribute('aria-label', f.title);
      input.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') {
          ev.preventDefault();
          input.blur();
        }
      });
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (!isFinite(v)) return;
        const patch = {};
        patch[f.key === 'r' ? 'rot' : f.key] = v;
        try {
          if (typeof inkApplyNumericTransform === 'function')
            inkApplyNumericTransform(patch);
        } catch { /* sessiz */ }
      });
      fields.push({ input, key: f.key, f });
      wrap.append(cap, input);
    }
    box.append(lab, ...fields.map(f => f.input.parentElement));
    const sync = () => {
      let b = null;
      try {
        const ink = inkState();
        b = ink.selection.length &&
          typeof inkSelectionBounds === 'function'
          ? inkSelectionBounds() : null;
      } catch { /* sessiz */ }
      box.hidden = !b;
      for (const f of fields) {
        if (document.activeElement === f.input) continue;
        f.input.value = b
          ? (f.key === 'r' ? '' : String(Math.round(f.key === 'x' ? b.x :
            f.key === 'y' ? b.y : f.key === 'w' ? b.w : b.h)))
          : '';
      }
    };
    box.__v5OptSync = sync;
    sync();
    return box;
  }

  /* FAZ 6 A4: tek-eylem düğmesi — "Deselect". Seçim yokken
      gizlenir; motor tarafında inkClearSelection ile tek yol. */
  function buildOptionAction(w) {
    const box = el('div', 'v5-opt v5-opt-action');
    box.dataset.opt = '__action';
    const btn = el('button', 'v5-opt-action-btn');
    btn.type = 'button';
    btn.textContent = w.label || '';
    btn.title = w.tip || w.label || '';
    btn.setAttribute('aria-label', w.tip || w.label || '');
    btn.addEventListener('click', () => {
      try {
        if (w.id === 'clearSelection' && typeof inkClearSelection === 'function') {
          inkClearSelection();
        }
      } catch { /* sessiz */ }
    });
    box.appendChild(btn);
    const sync = () => {
      let on = false;
      try { on = !!inkState().selection.length; } catch { /* sessiz */ }
      box.hidden = !on;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    box.__v5OptSync = sync;
    sync();
    return box;
  }

  function buildOptionWidgets(tool) {    const rows = [];
    const schema = typeof inkToolOptionsSchema === 'function'
      ? inkToolOptionsSchema(tool) : [];
    for (const w0 of schema) {
      /* L10N: widget etiketi/ipliği/seçenekleri anlık dile göre çözülür */
      const w = Object.assign({}, w0, {
        label: w0.label != null ? __t(String(w0.label)) : w0.label,
        tip: w0.tip != null ? __t(String(w0.tip)) : w0.tip,
        options: w0.options
          ? w0.options.map(o => Object.assign({}, o,
              { label: o.label != null ? __t(String(o.label)) : o.label }))
          : w0.options,
      });
      if (w.kind === 'range') rows.push(buildOptionRange(w));
      else if (w.kind === 'toggle') rows.push(buildOptionToggle(w));
      else if (w.kind === 'select') rows.push(buildOptionSelect(w));
      else if (w.kind === 'brushTip') rows.push(buildOptionBrushTip(w));
      else if (w.kind === 'color') rows.push(buildOptionColor(w));
      /* FAZ 7.W: çok-duraklı gradyan barı (gradient aracı). */
      else if (w.kind === 'gradientBar') rows.push(buildOptionGradientBar(w));
      else if (w.kind === 'alphaLock') rows.push(buildOptionAlphaLock(w));
      /* FAZ 6 A4: yeni türler — okunur bilgi satırı ve tek-eylem
         düğmesi (manifest verilerinin taşır, draw-v5 haritalar). */
      else if (w.kind === 'info') rows.push(buildOptionInfo(w));
      else if (w.kind === 'action') rows.push(buildOptionAction(w));
      /* FAZ 6 B7: Transform HUD — sayısal X/Y/W/H/R alanları. */
      else if (w.kind === 'gizmohud') rows.push(buildOptionGizmoHud(w));
      /* FAZ 6 B6: seçim modu segmenti (marquee/lasso şemaları). */
      else if (w.kind === 'selmode') rows.push(buildOptionSelMode(w));
    }
    /* Ara gruplar: schema sırası korunur; manifest grupla ayrık
       (paint→touch gibi) geçişlerde ayraç basılır. */
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].dataset.opt;
      const cur = rows[i].dataset.opt;
      // Kümeler arasında renk → sayısal alan geçişi gibi doğal ayrımlar
      // yeterince küçük; yalnızca brushTip sonrası ayraca gerek yok.
      if ((prev === '__brushTip' && cur === '__brushTip') ||
          (prev === '__color' && cur === '__color')) continue;
      if ((prev === '__brushTip') === (cur === '__brushTip')) continue;
      rows.splice(i, 0, null);
      i++;
    }
    // null işaretli yerlere ayraç konur (aşağıda derleme sırasında).
    return rows;
  }

  function renderOptions(tool) {
    const bar = v5.optionsBar;
    if (!bar) return;
    closeOptionsOverflow();
    /* FAZ 7.W: araç değişiminde mini gradyan seçiciyi de kapat —
       çapası eski bar'da kalmasın. */
    closeGradientPicker();
    if (v5.optTool === tool) return;
    v5.optTool = tool;
    bar.replaceChildren();
    /* FAZ 6 B9: options bar grip'i — sürükleyerek ayrı sabitle,
       çift tıkla geri kenetle. renderOptions her araç değişiminde
       replaceChildren çağırdığı için bağlama idempotent tutuldu. */
    const grip = el('button', 'v5-opt-grip');
    grip.type = 'button';
    grip.title = __t('Drag to move · double-click to dock');
    grip.innerHTML = icon('gripd');
    bar.appendChild(grip);
    bindOptionsBarDrag(bar);
    const label = el('span', 'v5-opt-tool');
    const def = typeof INK_TOOL_DEFS === 'object' ? INK_TOOL_DEFS[tool] : null;
    const key = def && def.key ? def.key : '';
    /* FAZ 7.X: sliders ikonu kaldırıldı — "ayarlar simgesi" sanılıyordu
       (kullanıcı isteği). Yalnız araç adı + kısayol kalır. */
    label.innerHTML =
      '<span class="v5-opt-tool-name">' +
      (typeof inkToolLabel === 'function' ? inkToolLabel(tool) : tool) +
      '</span>' +
      (key ? '<span class="v5-opt-key">' + key + '</span>' : '');
    bar.appendChild(label);
    /* FAZ 6 A5: maske düzenleme rozeti — inkState.maskEditId açıkken
       hedefi adlandırır (arka planda hangi katman boyandığı belirsizdi).
       Tıkla → düzenlemeyi bırak. Durum belirticidir, widget değildir:
       `⋯` taşmasına KATILMAZ, her araçta kalır. */
    if (!v5.optMaskBadge) {
      const badge = el('button', 'v5-opt-mask');
      badge.type = 'button';
      badge.setAttribute('aria-pressed', 'false');
      badge.title = __t('Mask editing is on — click to exit');
      badge.innerHTML = icon('x') + '<span class="v5-opt-mask-label">' + __t('MASK') + '</span>' +
        '<span class="v5-opt-mask-name"></span>';
      badge.addEventListener('click', () => {
        const ink = inkState();
        if (ink.maskEditId && typeof inkDocToggleMaskEdit === 'function') {
          inkDocToggleMaskEdit(ink.maskEditId);
        }
      });
      v5.optMaskBadge = badge;
    }
    bar.appendChild(v5.optMaskBadge);
    /* FAZ 6 A11: "View" açı çipi + sıfırla — her zaman el altında
       (kullanıcı talebi: kaç derece döndüğünü görmek). Kompakt biçim:
       çip yalnız "45°" (başlık: Tuval görünüm açısı), sıfırla "⟲"
       ikonu (başlık: Görünümü sıfırla) — metinli hali taşma bütçesini
       aşarken Alfa kilidi çekirdeğini eziyordu. Reset yalnız rot ≠ 0
       iken görünür. Hassas açı hedefleme R+sürükleme HUD çipi +
       Shift 15° ızgara ile yapılır. Sıfırlama motor tek yolu
       inkEditorResetRot: yalnız açı temizler, zoom/pan kesinlikle
       dokunulmaz. */
    if (!v5.optViewBadge) {
      /* KASTEN .v5-opt DEĞİL: taşma döngüsüne katılmaz (recents şeridi
         kuralı, FAZ 6 A2) — derece çipi dar çubukta bile görünür kalır;
         bedeli en yumuşak araç satırının ⋯'e kaçmasıdır (progressive
         disclosure çekirdeği Boyut/Opaklık/Alfa kilidi korunur). */
      const wrap = el('div', 'v5-opt-view');
      const deg = el('span', 'v5-opt-view-deg', '');
      deg.title = __t('Canvas view angle (rotate with R)');
      deg.setAttribute('aria-label', deg.title);
      const reset = el('button', 'v5-opt-view-reset');
      reset.type = 'button';
      reset.textContent = '⟲';
      reset.title = __t('Reset view (0°; zoom/pan preserved)');
      reset.setAttribute('aria-label', reset.title);
      reset.addEventListener('click', () => {
        if (typeof inkEditorResetRot === 'function') inkEditorResetRot();
      });
      wrap.append(deg, reset);
      /* ⟲ yeri HEP rezerve: görünmez ama yer kaplar (visibility, hidden
         değil). Tersine çevirmede çubuk genişlemiyordu; rot ≠ 0'da ⟲
         aniden ~30px yiyip son widget'ı (Yumuşatma) ⋯'e itiyordu —
         kullanıcı talebi: "rotate yapınca yumuşatma paneli kayboluyor". */
      wrap.__v5OptSync = () => {
        let rot = 0;
        try {
          const ui = typeof inkEditorUi !== 'undefined' ? inkEditorUi : null;
          rot = ui && ui.view ? Number(ui.view.rot) || 0 : 0;
        } catch { /* sessiz */ }
        const txt = Math.round(rot) + '°';
        if (deg.textContent !== txt) deg.textContent = txt;
        reset.style.visibility = Math.abs(rot) < 0.5 ? 'hidden' : 'visible';
      };
      wrap.__v5OptSync();
      v5.optViewBadge = wrap;
    }
    const rows = typeof buildOptionWidgets === 'function' ? buildOptionWidgets(tool) : [];
    if (!rows.length) {
      /* FAZ 6 A11: "View" widget'ı. */
      bar.appendChild(v5.optViewBadge);
      const hint = el('span', 'v5-opt-empty', __t('No extra options for this tool'));
      bar.appendChild(hint);
      bar.classList.add('is-empty');
      syncOptionsBarPosition();
      measureOptionsOverflow();
      return;
    }
    bar.classList.remove('is-empty');
    rows.forEach(row => {
      if (row) bar.appendChild(row);
      else bar.appendChild(el('span', 'v5-opt-sep'));
    });
    /* FAZ 6 A11: "View" widget'ı; K11'de ÇİP EN SAĞA taşındı —
       (kullanıcı talebi: "rotate kısmını en sağa at") ⋯ düğmesinin
       sonrası çubuğun kapanışı olarak durur. */
    const more = el('button', 'v5-opt-more');
    more.type = 'button';
    more.title = __t('Other options');
    more.setAttribute('aria-label', __t('Other tool options'));
    more.setAttribute('aria-haspopup', 'true');
    more.setAttribute('aria-expanded', 'false');
    more.innerHTML = icon('more');
    more.addEventListener('click', () => openOptionsOverflow(more));
    v5.optMore = more;
    bar.appendChild(more);
    const sep = el('span', 'v5-opt-sep');
    bar.insertBefore(sep, more);
    bar.appendChild(v5.optViewBadge);
    /* FAZ 6 A2 renk geçmişi şeridi KALDIRILDI (kullanıcı talebi: renkler
       sağdaki renk panelinde zaten var — çubukta yer tutuyordu).
       Geçmiş yalnız renk panelindeki #v5Recents'te sürer. */
    syncOptionsBar({ measure: true });
    syncOptionsBarPosition();
  }

  function syncOptionsBar(options = {}) {
    const bar = v5.optionsBar;
    if (!bar) return;
    let tool = 'brush';
    try { tool = String(inkState().tool || tool); } catch { /* sessiz */ }
    if (v5.optTool !== tool) { renderOptions(tool); syncOptionsBar(options); return; }
    bar.querySelectorAll('.v5-opt').forEach(box => {
      if (typeof box.__v5OptSync === 'function') box.__v5OptSync();
    });
    /* FAZ 6 A11: derece çipi (.v5-opt muaf — taşmaya katılmaz) için
       ayrı senkron: inkEditorApplyRot her karede __v5OptSync çağırır. */
    if (v5.optViewBadge && typeof v5.optViewBadge.__v5OptSync === 'function') {
      v5.optViewBadge.__v5OptSync();
    }
    /* FAZ 6 A5: maske rozeti durumu — maskEditId açıkken görünür ve
       hedef katmanı adlandırır; kapalıyken gizli. */
    const badge = v5.optMaskBadge;
    if (badge) {
      let on = false, name = '';
      try {
        const ink = inkState();
        on = !!ink.maskEditId;
        if (on && typeof inkLayerById === 'function') {
          const layer = inkLayerById(ink.maskEditId);
          name = layer && layer.name ? layer.name : 'MASK';
        }
      } catch { /* sessiz */ }
      badge.hidden = !on;
      badge.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) {
        const nameEl = badge.querySelector('.v5-opt-mask-name');
        if (nameEl) nameEl.textContent = name;
      }
    }
    // Pencere daralınca da yeniden ölç (apply→syncToolbar buradan geçer).
    // FAZ 6 A4: gizmo sürükleme kareleri { measure: false } geçer —
    // her karede overflow ölçümü (layout tekrar) istenmez.
    // PROFİLER DÜZELTMESİ: aynı karede 2-3 sync çağrısı kare başına
    // 2-3 layout tekrarını zorluyordu — ölçüm tek rAF'a toplanır.
    if (!options || options.measure !== false) scheduleOptionOverflowMeasure();
  }

  /* FAZ 6 ölçüm toplama: kare başına en fazla bir overflow ölçümü. */
  let v5OptMeasureSkipped = false;
  function scheduleOptionOverflowMeasure() {
    if (v5OptMeasureSkipped) return;
    v5OptMeasureSkipped = true;
    requestAnimationFrame(() => {
      v5OptMeasureSkipped = false;
      measureOptionsOverflow();
    });
  }

  /** İçerik kutuya sığmıyorsa sığmayan widget'ları sona doğru `⋯`
      menüsüne taşı (18-toolbar-layout ölçüm döngüsü deseni). */
  function measureOptionsOverflow() {
    const bar = v5.optionsBar;
    if (!bar) return;
    const more = v5.optMore;
    /* FAZ 6 A4: gizli satırlar (action seçim-yok) ölçüme girmez ve
       is-overflowed alması gerekmez — display:none'dır. */
    const widgets = [...bar.querySelectorAll('.v5-opt')]
      .filter(w => {
        if (!w.hidden) return true;
        w.classList.add('is-overflowed');
        return false;
      });
    if (!widgets.length) {
      bar.classList.remove('is-overflowing');
      if (more) more.style.display = 'none';
      return;
    }
    /* PROFİLER DÜZELTMESİ: vuruş commit'leri toolbar'ı sık senkler;
       her ölçüm scrollWidth/clientWidth zorunlu düzen (layout) okur.
       Parça sayısı + kutu genişliği + gizlilik durumu değişmemişken
       taşma da değişemez: imza eşitken erken çık (yaklaşık 0.1 ms).
       FAZ 6 K11 eki: bar artık pencereyi doldurmayan kompakt hap —
       hap genişliği içerikle (taşanlar display:none) değiştiğinden
       pencere boyutu clientWidth'i taşımaz; innerWidth imzada yoksa
       dar→geniş resize'da bayat is-overflowed sınıfları kalır (A9
       öncelik kapısının kırmızısı). */
    const mSig = widgets.length + '|' + bar.clientWidth + '|' +
      window.innerWidth + 'x' + window.innerHeight + '|' +
      widgets.map(w => (w.hidden ? 1 : 0)).join('');
    if (mSig === v5.optMeasureSig) return;
    v5.optMeasureSig = mSig;
    widgets.forEach(w => {
      // Kalıcı DOM sırası (⋯ menüsü kapanınca geri takip için);
      // yalnız taşanlara değil herkese basılır ki restore sırasında
      // sıra bozulmasın (options-bar probe öncelik kontrolü).
      w.dataset.optIndex = String(widgets.indexOf(w));
      w.classList.remove('is-overflowed');
    });
    bar.classList.remove('is-overflowing');
    if (more) more.style.display = '';
    let guard = widgets.length + 2;
    while (bar.scrollWidth > bar.clientWidth + 1 && guard-- > 0) {
      const visible = widgets.filter(w => !w.classList.contains('is-overflowed'));
      if (visible.length <= 1) break;
      visible[visible.length - 1].classList.add('is-overflowed');
      bar.classList.add('is-overflowing');
    }
    if (more) more.style.display = bar.classList.contains('is-overflowing') ? '' : 'none';
  }

  function closeOptionsOverflow() {
    const panel = v5.optMenu;
    if (!panel) return;
    const bar = v5.optionsBar;
    const more = v5.optMore;
    const widgets = [...panel.querySelectorAll('.v5-opt')]
      .sort((a, b) => (Number(a.dataset.optIndex) || 0) - (Number(b.dataset.optIndex) || 0));
    widgets.forEach(w => {
      if (bar && more) bar.insertBefore(w, more);
      w.classList.remove('is-overflowed');
      w.dataset.optIndex = '';
    });
    if (bar) measureOptionsOverflow();
    panel.remove();
    v5.optMenu = null;
    if (more) more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', optMenuOutside, true);
    window.removeEventListener('keydown', optMenuKeys, true);
    document.removeEventListener('scroll', closeOptionsOverflow, true);
  }

  function optMenuOutside(event) {
    const panel = v5.optMenu;
    if (!panel || !v5.optionsBar) return;
    const t = event.target instanceof Element ? event.target : null;
    if (t && (panel.contains(t) || v5.optionsBar.contains(t) ||
         t.closest('[data-menu]'))) return;
    closeOptionsOverflow();
  }

  function optMenuKeys(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeOptionsOverflow();
  }

  function openOptionsOverflow(anchor) {
    const bar = v5.optionsBar;
    if (!bar) return;
    const overflowed = [...bar.querySelectorAll('.v5-opt.is-overflowed')];
    if (!overflowed.length) return;
    closeOptionsOverflow();
    const panel = el('div', 'v5-menu v5-options-overflow');
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', __t('Other tool options'));
    // Taşan widget'lar taşınır (aynı örnekler): değerler ve dinleyiciler
    // korunur; panel kapanınca çubuğa geri döner.
    overflowed.forEach((w, i) => {
      w.dataset.optIndex = String(i);
      panel.appendChild(w);
    });
    (v5.menuLayer || v5.root).appendChild(panel);
    v5.optMenu = panel;
    if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
    // FAZ 6 A8: konumlandırma keepInViewport'a taşındı (alignRight
    // deseni: menü sağ kenarı çapanın sağ kenarı).
    keepInViewport(panel, anchor, { alignRight: true });
    setTimeout(() => {
      document.addEventListener('pointerdown', optMenuOutside, true);
      // Escape'i window yakalayıcısında yakala: app.js'in document
      // seviyesindeki yakalayıcıları (stopPropagation) Escape'i yutuyordu;
      // window evresi onlardan önce koşar.
      window.addEventListener('keydown', optMenuKeys, true);
      document.addEventListener('scroll', closeOptionsOverflow, true);
    }, 0);
  }

  /** Options bar'ı araç çubuğunun altına kenetler (sürükleme/yeniden
      yerleşimden sonra da takip eder). */
  function syncOptionsBarPosition() {
    const bar = v5.optionsBar;
    const toolbar = v5.toolbar;
    if (!bar || !toolbar || v5.optTool === '') return;
    /* FAZ 6 B9: grip ile ayrı sabitlenmişse dock akışı barı taşımaz;
       konum optPos'tan applyOptionsBarPosition ile devam eder. */
    if (v5.optPinned) { applyOptionsBarPosition(); return; }
    const rect = toolbar.getBoundingClientRect();
    if (!rect.width) return;
    let left = rect.left;
    const maxW = innerWidth - left - 16;
    if (maxW < 280) {
      // Sağ kenara sıkışmış çubukta options bar'ı sağa kaydır.
      left = Math.max(16, innerWidth - Math.min(420, innerWidth - 32));
    }
    bar.style.transform = 'none';
    bar.style.left = Math.round(left) + 'px';
    const barH = bar.offsetHeight || 44;
    let top = Math.round(rect.bottom + 8);
    if (top + barH > innerHeight - 8) {
      top = Math.max(8, Math.round(rect.top - barH - 8));
    }
    bar.style.top = top + 'px';
  }

  /* FAZ 6 B9: pinned options bar konumu — ekran clamp'li, optPos'a yazar. */
  function applyOptionsBarPosition() {
    const bar = v5.optionsBar;
    if (!bar || !v5.optPinned || !v5.optPos) return;
    bar.classList.add('v5-opt-floating');
    bar.style.transform = 'none';
    const w = bar.offsetWidth || 360;
    const h = bar.offsetHeight || 44;
    const x = clamp(v5.optPos.left, 8, Math.max(8, innerWidth - w - 8));
    const y = clamp(v5.optPos.top, 8, Math.max(8, innerHeight - h - 8));
    bar.style.left = Math.round(x) + 'px';
    bar.style.top = Math.round(y) + 'px';
  }

  /* FAZ 6: araç çubuğu aç/kapa sonrası options bar yerleşimi. Çubuk
     14→48 (veya 48→14) arası animasyonla değişir; nihai alt kenarı
     hesapla (finalBottom), sabitlenen (optPinned) bar bu bölgeyle
     kesişiyorsa kenetleme bırak ve bar yeniden akışa girsin — akış
     barı zaten çubuğun altına itilir (kullanıcı talebi: üst üste
     binmesin). */
  function syncOptionsBarAfterToggle(collapse) {
    const tbar = v5.toolbar;
    const ob = v5.optionsBar;
    if (!tbar) return;
    const tr = tbar.getBoundingClientRect();
    const finalBottom = tr.top + (collapse ? 14 : 48);
    if (ob && v5.optPinned) {
      const or = ob.getBoundingClientRect();
      if (or.top < finalBottom && or.bottom > tr.top + 4) {
        v5.optPinned = false;
        v5.optPos = null;
        ob.classList.remove('v5-opt-floating');
        saveStore();
      }
    }
    syncOptionsBarPosition();
    /* Animasyon boyunca: bar yüksekliği geçişte değişir; üç aşamada
       nihai alt kenara oturur. */
    setTimeout(syncOptionsBarPosition, 130);
    setTimeout(syncOptionsBarPosition, 260);
    setTimeout(syncOptionsBarPosition, 430);
  }

  /* L10N: dil değişince araç çubuğu + seçenek çubuğunu yeniden kur.
     renderOptions v5.optTool ile önbelleklediği için cache zorlanır;
     araç çubuğu statik HTML olduğu için bütünüyle yeniden kurulur. */
  window.__v5L10nRefresh = function () {
    try {
      v5.optTool = '';
      /* statik etiketli önbellekli rozetler yeniden kurulsun */
      v5.optMaskBadge = null;
      v5.optViewBadge = null;
      v5.optMore = null;
      const cur = (typeof inkState === 'function' && inkState()) ? inkState().tool : '';
      if (typeof renderOptions === 'function' && v5.optionsBar) renderOptions(cur);
      if (v5.toolbar && v5.toolbar.parentNode) v5.toolbar.parentNode.removeChild(v5.toolbar);
      v5.toolbar = null;
      if (typeof buildToolbar === 'function') buildToolbar();
      if (typeof syncToolbar === 'function') { try { syncToolbar(); } catch { /* sessiz */ } }
    } catch { /* sessiz */ }
  };
  if (window.L10N && typeof window.L10N.onChange === 'function') {
    window.L10N.onChange(() => { if (typeof window.__v5L10nRefresh === 'function') window.__v5L10nRefresh(); });
  }

  function buildOptionsBar() {
    if (v5.optionsBar) return v5.optionsBar;
    if (typeof inkToolOptionsSchema !== 'function') return null;
    const bar = el('div');
    bar.id = 'v5OptionsBar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Tool options');
    v5.root.appendChild(bar);
    v5.optionsBar = bar;
    v5.optTool = '';
    v5.optMenu = null;
    v5.optMore = null;
    // Motor/panel tarayfından state senkronu (31-ink-ui kancası).
    try { window.__v5OptSync = () => syncOptionsBar(); } catch { /* sessiz */ }
    return bar;
  }

  function buildPanel(def) {
    if (v5.panels[def.id]) return v5.panels[def.id];
    const panel = el('section', 'v5-panel v5-panel--' + def.id);
    panel.id = PANEL_IDS[def.id] || ('v5Panel-' + def.id);
    panel.dataset.panel = def.id;
    panel.setAttribute('aria-label', def.title);
    panel.setAttribute('data-l10n-aria', def.title);

    const head = el('header', 'v5-panel-head');
    head.tabIndex = 0;
    head.innerHTML = '<span class="v5-panel-title" data-l10n="' + def.title + '">' + def.title + '</span>' +
      '<div class="v5-panel-actions"></div>';
    const actions = head.querySelector('.v5-panel-actions');

    const collapse = el('button', 'v5-head-extra', svg('chevron', 'v5-icon v5-collapse-chevron'));
    collapse.type = 'button';
    collapse.setAttribute('data-l10n-title', 'Collapse panel');
    collapse.setAttribute('data-l10n-aria', 'Collapse panel');
    collapse.title = __t('Collapse panel');
    collapse.setAttribute('aria-label', __t('Collapse panel'));
    collapse.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleCollapse(def.id);
    });

    const close = el('button', 'v5-head-extra', icon('x'));
    close.type = 'button';
    close.setAttribute('data-l10n-title', 'Close panel');
    close.setAttribute('data-l10n-aria', 'Close panel');
    close.title = __t('Close panel');
    close.setAttribute('aria-label', __t('Close panel'));
    close.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      /* Ayrı pencerede × paneli uygulamada kapatır; kopya pencere de
         kapanır (17b-panel-dock.js). */
      if (panel.dataset.detached === '1'
          && typeof window.tailrefCloseDetachedPanel === 'function') {
        setPanelVisible(def.id, false);
        window.tailrefCloseDetachedPanel(panel, false);
        return;
      }
      setPanelVisible(def.id, false);
    });

    actions.append(collapse, close);

    const body = el('div', 'v5-panel-body');
    body.dataset.body = def.id;

    panel.append(head, body);

    // Gövde kurucuları başlık düğmelerini panel üzerinden bulur.
    v5.panels[def.id] = panel;

    if (def.id === 'reference') buildReferenceBody(body, def);
    else if (def.id === 'color') buildColorBody(body, def);
    else if (def.id === 'layers') buildLayersBody(body, def);
    else if (def.id === 'brush') buildBrushBody(body, def);

    bindPanelHeader(panel, def, head);
    bindPanelResize(panel, def);
    v5.panels[def.id] = panel;
    /* "Dışarı çıkar" düğmesi: panel başlığı oluştuktan sonra eklenir
       (17b-panel-dock.js · installPanelPopoutButton). */
    if (typeof window.tailrefInstallPanelPopoutButton === 'function') {
      try { window.tailrefInstallPanelPopoutButton(panel); } catch { /* sessiz */ }
    }
    return panel;
  }

  /* =========================================================
     REFERANS PANELİ
     ========================================================= */
  function buildReferenceBody(body, def) {
    body.classList.add('v5-ref-body-wrap');

    // Ana referans tahtasının canlı minyatürü. Gerçek #stage katmanı bu
    // dikdörtgene kırpılır (draw-proto.css · ps-ref-live); bu öğe yalnızca
    // alanı ölçer. Salt okunurdur: tekerlekle yakınlaştırma, sürükleyerek
    // gezinme. Öğe seçme/taşıma yok (düzenleme referans modunda yapılır).
    const stage = el('div', 'v5-ref-stage');
    stage.id = 'v5RefStage';
    stage.dataset.refStage = '1';
    stage.title = 'Board thumbnail · wheel: zoom · drag: pan';

    const empty = el('p', 'v5-ref-empty', 'No images on the board yet.');
    empty.dataset.refEmpty = '1';
    stage.appendChild(empty);

    const foot = el('footer', 'v5-ref-foot');
    const zoom = el('div', 'v5-ref-zoom');
    const out = el('button', null, '−');
    out.type = 'button';
    out.title = 'Zoom out';
    const value = el('span', 'v5-ref-zoom-value', '%100');
    value.dataset.refZoom = '1';
    const inBtn = el('button', null, '+');
    inBtn.type = 'button';
    inBtn.title = 'Zoom in';
    const fit = el('button', 'v5-ref-fit', icon('fit'));
    fit.type = 'button';
    fit.title = 'Fit the board';
    fit.setAttribute('aria-label', 'Fit the board');
    zoom.append(out, value, inBtn);
    foot.append(zoom, fit);

    const fitBoard = () => {
      if (typeof dpProto !== 'undefined' && dpProto) dpProto.userTouched = false;
      if (typeof dpFitBoard === 'function') dpFitBoard();
      syncRefZoom();
    };

    out.addEventListener('click', () => {
      if (typeof dpBoardZoom === 'function') dpBoardZoom(0.8);
      syncRefZoom();
    });
    inBtn.addEventListener('click', () => {
      if (typeof dpBoardZoom === 'function') dpBoardZoom(1.25);
      syncRefZoom();
    });
    value.addEventListener('click', fitBoard);
    fit.addEventListener('click', fitBoard);

    body.append(stage, foot);

    bindRefStage(stage);

    const head = v5.panels[def.id] ? v5.panels[def.id].querySelector('.v5-panel-head') : null;
    // Başlık düğmesi panel oluşturulurken eklenir; burada yalnızca
    // genişletme davranışını panel üzerinden bağlarız.
    if (head) {
      const expand = el('button', 'v5-head-btn', icon('expand'));
      expand.type = 'button';
      expand.title = 'Expand reference panel';
      expand.setAttribute('aria-label', 'Expand reference panel');
      expand.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        v5.leftWide = !v5.leftWide;
        // Genişletme de dock genişliği olarak kalıcı olsun.
        v5.dockW.left = v5.leftWide ? 360 : null;
        const panel = v5.panels.reference;
        if (panel && panel.classList.contains('is-floating')) {
          panel.style.width = v5.leftWide ? '360px' : '280px';
          const st = panelState('reference');
          if (st) st.floating.w = v5.leftWide ? 360 : 280;
          saveStore();
        }
        apply();
      });
      const actions = head.querySelector('.v5-panel-actions');
      if (actions) actions.insertBefore(expand, actions.firstChild);
    }
  }

  /* =========================================================
     REFERANS MİNYATÜRÜ · tahta görünümü, salt okunur
     ========================================================= */
  function scheduleRefClip() {
    if (v5.clipRaf) return;
    v5.clipRaf = requestAnimationFrame(() => {
      v5.clipRaf = 0;
      if (typeof dpApplyRefClip === 'function') dpApplyRefClip();
    });
  }

  /** Sürükleme/boyutlandırma sırasında kırpma dikdörtgenini aynı karede
      günceller; aksi halde tahta bir kare geriden gelip "kayıyor" görünür. */
  function syncRefClip() {
    if (v5.clipRaf) {
      cancelAnimationFrame(v5.clipRaf);
      v5.clipRaf = 0;
    }
    const live = refStageRect();
    if (live) v5.lastRefRect = live;
    if (typeof dpApplyRefClip === 'function') dpApplyRefClip();
  }

  /** Dock kaydırıldığında referans penceresiyle birlikte tahtayı da
      kaydırır. Aksi halde pencere hareket ederken tahta yerinde kalıyor,
      panelin içi boş görünüyordu. */
  function onDockScroll() {
    const before = v5.lastRefRect || refStageRect();
    syncRefClip();
    const after = v5.lastRefRect;
    if (!before || !after) return;
    const dx = after.left - before.left;
    const dy = after.top - before.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    panBoardWithPanel(dx, dy);
    syncRefClip();
  }

  /** Referans panosunun gerçekten görünen gövdesi. Katlanmış/ gizlenmiş
      panelde yükseklik sıfırdır; o durumda "pencere" yoktur. */
  function refStageRect() {
    const stage = $('v5RefStage');
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return null;
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height
    };
  }

  /** Referans panosunun penceresi yer değiştirdiğinde tahtayı aynı oranda
      kaydırır. Ölçek bilinçli olarak korunur: kullanıcı panoyu büyütmüş/
      gezinmişse panel taşındı diye görünüm sıfırlanmaz. */
  function translateBoardForAperture(before, after) {
    if (!before || !after) return;
    const dx = (after.left + after.width / 2) - (before.left + before.width / 2);
    const dy = (after.top + after.height / 2) - (before.top + before.height / 2);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    try {
      if (typeof state === 'undefined' || !state || !state.view) return;
      state.view.x += dx;
      state.view.y += dy;
      if (typeof applyView === 'function') applyView();
      if (typeof dpSyncBoardLabel === 'function') dpSyncBoardLabel();
      else syncRefZoom();
      if (typeof scheduleSave === 'function') scheduleSave();
    } catch { /* sessiz */ }
  }

  /* Yalnızca referans panelinin kendisi taşınırken tahta aynı miktarda
     kaydırılır ki minyatürdeki görüntü pencere içinde sabit kalsın.
     Sağdaki panelleri (katman, fırça, renk) taşımak referans minyatüründeki
     fotoğrafları kesinlikle kaydırmaz; bu yüzden bu yardımcı yalnızca
     referans paneli sürüklemesinden çağrılır. */
  function panBoardWithPanel(dx, dy) {
    if (!dx && !dy) return;
    try {
      if (typeof state === 'undefined' || !state || !state.view) return;
      state.view.x += dx;
      state.view.y += dy;
      if (typeof applyView === 'function') applyView();
      if (typeof dpProto !== 'undefined' && dpProto) dpProto.userTouched = true;
    } catch { /* sessiz */ }
  }

  function syncRefZoom() {
    if (typeof dpSyncBoardLabel === 'function') {
      dpSyncBoardLabel();
      return;
    }
    const value = v5.panels.reference
      ? v5.panels.reference.querySelector('[data-ref-zoom]')
      : null;
    if (!value) return;
    let scale = 1;
    try { scale = Number(state.view.scale) || 1; } catch { /* sessiz */ }
    value.textContent = '%' + Math.max(1, Math.round(scale * 100));
  }

  /* Araç çubuğundaki yakınlaştırma hedefi: çizim tuvali açıkken tuval,
     kapalıyken referans panosu. Referans panelinin kendi +/- kontrolleri
     her zaman panoyu ölçeklemeye devam eder (bkz. buildReferencePanel). */
  function v5ZoomBy(factor) {
    if (typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()
        && typeof inkEditorZoomBy === 'function') {
      inkEditorZoomBy(factor);
      return;
    }
    if (typeof dpBoardZoom === 'function') {
      dpBoardZoom(factor);
      syncRefZoom();
      return;
    }
    if (typeof inkEditorZoomBy === 'function') inkEditorZoomBy(factor);
  }

  function syncRefMeta() {
    const panel = v5.panels.reference;
    if (!panel) return;
    let count = 0;
    try {
      if (typeof state !== 'undefined' && state && Array.isArray(state.items)) {
        for (const item of state.items) {
          if (item && item.kind === 'image') count++;
        }
      }
    } catch { count = 0; }
    const label = panel.querySelector('[data-ref-count]');
    if (label) label.textContent = count + ' image';
    const empty = panel.querySelector('[data-ref-empty]');
    if (empty) empty.hidden = count > 0;
    panel.classList.toggle('is-empty', count === 0);
  }

  /** Minyatür tahta girdisi. Panel gövdesi tıklamaları geçirir; gerçek
      #stage üzerindeki öğeler seçilip taşınır. Boş alanda sürükleme tahtayı
      gezer, öğe üzerinde sürükleme öğeyi taşır. */
  function bindRefStage(stage) {
    // Alan büyüklüğü değişince yalnızca kırpma dikdörtgenini tazele.
    // Görünüm ölçeğine dokunma: panel taşındı diye pano "sığdır"a dönmez.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (!isDraw()) return;
        syncRefClip();
      }).observe(stage);
    }
  }

  /** Gerçek tahtayı minyatür panelde etkileşimli hâle getirir. Kırpma
      yüzünden tıklamalar panelden #stage'e geçer; burada yalnızca boş alan
      sürüklemesini pan'a çeviriyoruz. Öğe/tutamaç girdisi tahtanın kendi
      seçim, taşıma ve boyutlandırma koduna bırakılır. */
  /** FAZ 6: Referans tahtasından renk alma (Alt+klik/drag). Modal
      çizim modunda Alt, tuval üstünde damlalık; soldaki canlı tahta
      minyatüründe de aynı davranış çalışsın: imlecin altındaki
      fotoğraf (img) veya katman tuvali pikseli örneklensin. */
  const v5EyeSampleCv = () => {
    if (!bindTailRef._cv) {
      bindTailRef._cv = document.createElement('canvas');
      bindTailRef._cv.width = 1;
      bindTailRef._cv.height = 1;
    }
    return bindTailRef._cv;
  };
  const v5HexByte = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  /* Öğe geometrisinden imleç çözümü: öğe translate3d+rotate ile
     taşınır (06-render) ve görünüm ölçeği üstte uygulanır — img AABB
     lineer eşlemesi DÖNDÜRÜLMÜŞ öğelerde yanlış piksele gider
     (büyüteç '—' kalıyordu). Dönmüş AABB'nin merkezi = öğenin ekran
     merkezi; ölçek AABB yarı boyutundan çözülür. */
  const v5ItemSamplePoint = (host, clientX, clientY) => {
    const it = (typeof getItem === 'function')
      ? getItem(host.dataset.id) : null;
    if (!it || !it.w || !it.h) return null;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const theta = (Number(it.rot) || 0) * Math.PI / 180;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const hw = it.w / 2;
    const hh = it.h / 2;
    /* dönmüş AABB yarı genişliği (uniform ölçek s): rw/2 = s(hw|c|+hh|sn|) */
    const ax = hw * Math.abs(c) + hh * Math.abs(sn);
    const scale = ax > 0 ? (r.width / 2) / ax : 0;
    if (!(scale > 0)) return null;
    const dx = (clientX - (r.left + r.width / 2)) / scale;
    const dy = (clientY - (r.top + r.height / 2)) / scale;
    /* rotate(−θ): [x y] = [c sn; −sn c] · [dx dy] */
    const lx = hw + c * dx + sn * dy;
    const ly = hh - sn * dx + c * dy;
    if (lx < 0 || ly < 0 || lx > it.w || ly > it.h) return null;
    return { lx, ly, it };
  };
  /* 1×1 tmp canvas'tan img pikseli oku (hex + zoom kaynağı). */
  const v5ReadImgPx = (img, px, py) => {
    if (!(img instanceof HTMLImageElement) ||
        !img.naturalWidth || !img.naturalHeight) return null;
    if (px < 0 || py < 0 || px >= img.naturalWidth || py >= img.naturalHeight) return null;
    let d = null;
    try {
      const cv = v5EyeSampleCv();
      const c2 = cv.getContext('2d');
      c2.clearRect(0, 0, 1, 1);
      c2.drawImage(img, px, py, 1, 1, 0, 0, 1, 1);
      d = c2.getImageData(0, 0, 1, 1).data;
    } catch { /* taint/yarım görsel: sessiz */ }
    if (d && d[3] >= 8) {
      return {
        hex: '#' + v5HexByte(d[0]) + v5HexByte(d[1]) + v5HexByte(d[2]),
        src: img, sx: px, sy: py, sw: img.naturalWidth, sh: img.naturalHeight,
      };
    }
    return null;
  };
  /* canvas pikseli oku (zoom kaynağı backing px) */
  const v5ReadCanvasPx = (el, px, py) => {
    if (!(el instanceof HTMLCanvasElement) || !el.width || !el.height) return null;
    if (px < 0 || py < 0 || px >= el.width || py >= el.height) return null;
    let c2 = null;
    try { c2 = el.getContext('2d'); } catch { /* sessiz */ }
    if (!c2) return null;
    let d = null;
    try { d = c2.getImageData(px, py, 1, 1).data; } catch { /* taint vb. */ }
    if (d && d[3] >= 8) {
      return {
        hex: '#' + v5HexByte(d[0]) + v5HexByte(d[1]) + v5HexByte(d[2]),
        src: el, sx: px, sy: py, sw: el.width, sh: el.height,
      };
    }
    return null;
  };
  /* Öğe İÇİNDEKİ yüzeyleri üstten alta dener; nokta öğe kutusunda
     oransal eşlenir (dönüş v5ItemSamplePoint'te çözülmüş). */
  const v5SampleItemSurfaces = (host, loc) => {
    const it = loc.it;
    const surfaces = [
      ...host.querySelectorAll('canvas'),
      host.querySelector('.media img'),
    ];
    for (const s of surfaces) {
      if (!s) continue;
      let pick = null;
      if (s instanceof HTMLCanvasElement) {
        pick = v5ReadCanvasPx(s,
          Math.floor(loc.lx / Math.max(1, it.w) * s.width),
          Math.floor(loc.ly / Math.max(1, it.h) * s.height));
      } else {
        pick = v5ReadImgPx(s,
          Math.floor(loc.lx / Math.max(1, it.w) * s.naturalWidth),
          Math.floor(loc.ly / Math.max(1, it.h) * s.naturalHeight));
      }
      if (pick) return pick;
    }
    return null;
  };
  /* Noktanın altındaki ÖĞELER (pointer-events none img'ler dahil). */
  const v5ItemsUnderClient = (clientX, clientY) => {
    let els = [];
    try {
      els = (typeof document.elementsFromPoint === 'function')
        ? document.elementsFromPoint(clientX, clientY) : [];
    } catch { /* sessiz */ }
    const out = [];
    const seen = new Set();
    for (const el of els) {
      if (!(el instanceof Element)) continue;
      const host = el.closest ? el.closest('.item.is-image') : null;
      if (host && !seen.has(host)) {
        seen.add(host);
        out.push(host);
      }
    }
    return out;
  };
  /* CSS rgb()/rgba()/hex dizesi → #rrggbb (metin öğeleri için). */
  const v5CssToHex = css => {
    if (!css) return null;
    let m = css.match(/^#([0-9a-f]{6})$/i);
    if (m) return '#' + m[1].toLowerCase();
    m = css.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (m) {
      return '#' + v5HexByte(+m[1]) + v5HexByte(+m[2]) + v5HexByte(+m[3]);
    }
    return null;
  };
  /* İmleç noktasının altındaki en üst boyalı piksel.
     1) öğe geometrisi (dönüş telafili);
     2) öğe dışı dock canvas'ları (AABB doğrusal — dönmeyenler);
     3) öğe-içi img AABB son çare;
     4) metin öğesinin hesaplanan rengi;
     5) tahta zemin rengi (src yok — büyüteç düz renk diski çizer). */
  const v5SampleClientPick = (clientX, clientY) => {
    const diag = { x: Math.round(clientX), y: Math.round(clientY), hosts: 0, loc: 0, branch: null };
    const done = key => { diag.branch = key; return true; };
    for (const host of v5ItemsUnderClient(clientX, clientY)) {
      diag.hosts++;
      const loc = v5ItemSamplePoint(host, clientX, clientY);
      if (loc) {
        diag.loc++;
        const pick = v5SampleItemSurfaces(host, loc);
        if (pick) return { ...pick, diag: done('item') };
      }
    }
    let els = [];
    try {
      els = (typeof document.elementsFromPoint === 'function')
        ? document.elementsFromPoint(clientX, clientY) : [];
    } catch { /* sessiz */ }
    for (const el of els) {
      if (el instanceof HTMLCanvasElement &&
          !(el.closest && el.closest('.item.is-image'))) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const pick = v5ReadCanvasPx(el,
          Math.floor((clientX - r.left) * el.width / r.width),
          Math.floor((clientY - r.top) * el.height / r.height));
        if (pick) return { ...pick, diag: done('canvas') };
      }
    }
    for (const host of v5ItemsUnderClient(clientX, clientY)) {
      const img = host.querySelector('.media img');
      if (!img) continue;
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const pick = v5ReadImgPx(img,
        Math.floor((clientX - r.left) * img.naturalWidth / r.width),
        Math.floor((clientY - r.top) * img.naturalHeight / r.height));
      if (pick) return { ...pick, diag: done('imgAabb') };
    }
    // metin öğesi: imlecin altındaki metnin hesaplanan rengi
    for (const el of els) {
      const th = el instanceof Element ? el.closest('.item.is-text') : null;
      if (!th) continue;
      const colorHost = th.querySelector('.text') || th;
      let css = '';
      try { css = getComputedStyle(colorHost).color; } catch { /* sessiz */ }
      const hex = v5CssToHex(css);
      if (hex) return { hex, src: null, sx: 0, sy: 0, sw: 0, sh: 0, diag: done('text') };
    }
    // tahta zemini: src yok — büyüteç pick.hex diskiyle doldurur
    const boardEl = $('stage');
    let bg = '';
    try { bg = boardEl ? getComputedStyle(boardEl).backgroundColor : ''; } catch { /* sessiz */ }
    const bgHex = v5CssToHex(bg);
    v5DiagPush({ ...diag, branch: bgHex ? 'bg' : 'none', bg, bgHex });
    if (bgHex) return { hex: bgHex, src: null, sx: 0, sy: 0, sw: 0, sh: 0, diag: 'bg' };
    return null;
  };

  /* ---- FAZ 6 · referans büyüteci (loupe) — tuval damlalığı kalıbı:
     Alt'ta imlecin yanında dairesel zoom; halka örneklenen rengi,
     altındaki etiket hex'i gösterir. Okuma tek kapı: v5SampleClientPick. */
  const LOUPE_R = 34;      // CSS px yarıçap
  const LOUPE_ZOOM = 6;    // büyütme çarpanı
  const LOUPE_DPR = 2;     // retina netliği
  let v5LoupeBox = null, v5LoupeCtx = null, v5LoupeLabel = null;
  const v5LoupeEnsure = () => {
    if (v5LoupeBox) return true;
    const box = document.createElement('div');
    box.id = 'v5RefLoupe';
    const cv = document.createElement('canvas');
    cv.width = LOUPE_R * 2 * LOUPE_DPR;
    cv.height = LOUPE_R * 2 * LOUPE_DPR;
    box.appendChild(cv);
    const lab = document.createElement('div');
    lab.className = 'v5-ref-loupe-hex';
    box.appendChild(lab);
    (document.body || document.documentElement).appendChild(box);
    v5LoupeBox = box;
    v5LoupeCtx = cv.getContext('2d');
    v5LoupeLabel = lab;
    return !!(v5LoupeCtx && v5LoupeLabel);
  };
  /* tuval büyüteciyle aynı yerleşim: sağ üst; taşarsa sağ alt. */
  const v5LoupePlace = (clientX, clientY) => {
    let lx = clamp(clientX + 14 + LOUPE_R, LOUPE_R + 8,
      Math.max(LOUPE_R + 8, innerWidth - LOUPE_R - 8));
    let ly = clamp(clientY - 14 - LOUPE_R, LOUPE_R + 8,
      Math.max(LOUPE_R + 8, innerHeight - LOUPE_R - 8));
    if (ly - LOUPE_R < 72 && clientY + 14 + LOUPE_R + 30 < innerHeight - 8) {
      ly = clientY + 14 + LOUPE_R;
    }
    v5LoupeBox.style.left = Math.round(lx - LOUPE_R) + 'px';
    v5LoupeBox.style.top = Math.round(ly - LOUPE_R) + 'px';
  };
  const v5RefLoupeShow = (pick, clientX, clientY) => {
    if (!v5LoupeEnsure()) return;
    v5LoupeBox.style.display = 'block';
    v5LoupePlace(clientX, clientY);
    const ctx = v5LoupeCtx;
    ctx.setTransform(LOUPE_DPR, 0, 0, LOUPE_DPR, 0, 0);
    ctx.clearRect(0, 0, LOUPE_R * 2, LOUPE_R * 2);
    // gövde + gölge (örneklenen renk yoksa koyu disk)
    ctx.beginPath();
    ctx.arc(LOUPE_R, LOUPE_R, LOUPE_R, 0, Math.PI * 2);
    ctx.fillStyle = pick ? pick.hex : '#0c0e12';
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    // içerik: kaynağın imleç çevresini zoom'la (kenarda kırpğp)
    const half = (LOUPE_R - 2) / LOUPE_ZOOM;
    let drawn = false;
    if (pick && pick.src && pick.sw > 0 && pick.sh > 0) {
      const sx0 = clamp(Math.floor(pick.sx - half), 0, pick.sw - 1);
      const sy0 = clamp(Math.floor(pick.sy - half), 0, pick.sh - 1);
      const sw = Math.min(pick.sw - sx0, Math.ceil(half * 2));
      const sh = Math.min(pick.sh - sy0, Math.ceil(half * 2));
      if (sw > 0 && sh > 0) {
        try {
          ctx.save();
          ctx.beginPath();
          ctx.arc(LOUPE_R, LOUPE_R, LOUPE_R - 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(pick.src, sx0, sy0, sw, sh,
            LOUPE_R - (pick.sx - sx0) * LOUPE_ZOOM,
            LOUPE_R - (pick.sy - sy0) * LOUPE_ZOOM,
            sw * LOUPE_ZOOM, sh * LOUPE_ZOOM);
          ctx.restore();
          drawn = true;
        } catch { /* güvenli: renk diski kalır */ }
      }
    }
    if (!drawn && pick && pick.hex) {
      // zoom sağlanamadıysa göz yormayan düz renk dolgusu
      ctx.fillStyle = pick.hex;
      ctx.fillRect(0, 0, LOUPE_R * 2, LOUPE_R * 2);
    }
    // halka: örneklenen renkte ışıma (glow)
    const ring = pick && pick.hex ? pick.hex : 'rgba(150,158,170,.9)';
    ctx.save();
    ctx.shadowColor = ring;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(LOUPE_R, LOUPE_R, LOUPE_R - 1, 0, Math.PI * 2);
    ctx.strokeStyle = ring;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.stroke(); // iki geçiş: doygun ışık halesi
    ctx.restore();
    ctx.beginPath();
    ctx.arc(LOUPE_R, LOUPE_R, LOUPE_R + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(LOUPE_R, LOUPE_R, 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = pick ? '#000000' : '#ffffff';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    v5LoupeLabel.textContent = pick ? pick.hex.toUpperCase() : '—';
  };
  const v5RefLoupeHide = () => {
    if (!v5LoupeBox) return;
    v5LoupeBox.style.display = 'none';
  };

  /* tek güncelleme kapısı: imleç sınıfı + büyüteç + (istekte) renk. */
  const v5RefEyeStrokeBusy = () =>
    typeof inkEditorUi !== 'undefined' && inkEditorUi && inkEditorUi.stroke;
  const v5RefEyeUpdate = (altDown, client, apply) => {
    const active = !!altDown && !v5RefEyeStrokeBusy() &&
      isDraw() && document.body.classList.contains('ps-ref-live');
    const stageEl = $('stage');
    if (stageEl && stageEl.classList.contains('v5-ref-eye') !== active) {
      stageEl.classList.toggle('v5-ref-eye', active);
    }
    if (!active) {
      v5RefLoupeHide();
      return false;
    }
    if (!client) return false;
    const pick = v5SampleClientPick(client.clientX, client.clientY);
    v5RefLoupeShow(pick, client.clientX, client.clientY);
    if (apply && pick) {
      if (typeof inkState === 'function') inkState().color = pick.hex;
      if (typeof inkSyncUI === 'function') inkSyncUI();
    }
    return !!pick;
  };
  const v5RefEyeApply = (altDown, client) => v5RefEyeUpdate(altDown, client, true);

  function bindTailRef() {
    const board = $('stage');
    if (!board || board.__v5TailRef) return;
    board.__v5TailRef = true;

    // Alt imleç + büyüteç: tahtadaki her harekette tek kapıdan güncelle.
    let lastClient = null;
    let dragLive = false;
    board.addEventListener('pointermove', event => {
      lastClient = { clientX: event.clientX, clientY: event.clientY };
      v5RefEyeUpdate(event.altKey, event, false);
    }, true);
    // Tahta üstünde dururken Alt'a basmaca/bırakma da imleci döndürsün.
    const v5RefEyeKey = event => {
      if (!isDraw() || !document.body.classList.contains('ps-ref-live')) {
        v5RefLoupeHide();
        return;
      }
      if (dragLive) {
        v5RefEyeUpdate(event.altKey, lastClient, false);
        return;
      }
      if (board.matches(':hover') && lastClient) {
        v5RefEyeUpdate(event.altKey, lastClient, false);
      } else if (!event.altKey) {
        v5RefEyeUpdate(false, null, false);
      }
    };
    window.addEventListener('keydown', v5RefEyeKey, true);
    window.addEventListener('keyup', v5RefEyeKey, true);
    // Tahtadan çıkınca büyüteç kapansın (peşinde sürüklemeye değil).
    board.addEventListener('pointerleave', () => {
      if (!dragLive) v5RefEyeUpdate(false, null, false);
    });

    board.addEventListener('pointerdown', event => {
      if (!isDraw() || !document.body.classList.contains('ps-ref-live')) return;
      if (event.button !== 0) return;
      if (typeof state === 'undefined' || !state || !state.view) return;
      // Kullanıcı tahtaya dokunduysa otomatik "sığdır" görünümü ezmesin.
      if (typeof dpProto !== 'undefined' && dpProto) dpProto.userTouched = true;
      if (event.altKey) {
        // Renk örnekleme: tahta etkileşimi (pan/taşı) kapılı.
        if (v5RefEyeStrokeBusy()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        dragLive = true;
        lastClient = { clientX: event.clientX, clientY: event.clientY };
        v5RefEyeUpdate(true, event, true);
        // Sürükleme boyunca canlı örnekleme (tuval damlalığı kalıbı).
        const pickId = event.pointerId;
        const move = ev => {
          if (ev.pointerId !== pickId) return;
          lastClient = { clientX: ev.clientX, clientY: ev.clientY };
          v5RefEyeUpdate(true, ev, true);
        };
        const end = ev => {
          if (ev.pointerId !== pickId) return;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          dragLive = false;
          if (!ev.altKey) v5RefEyeUpdate(false, null, false);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        return;
      }
      if (typeof spaceDown !== 'undefined' && spaceDown) return;

      const target = event.target instanceof Element ? event.target : null;
      // Öğe, tutamaç veya grup çerçevesi: tahtanın kendi davranışı çalışsın.
      if (!target || target !== board) return;

      event.preventDefault();
      // Aynı düğümdeki dikdörtgen seçim dinleyicisi de çalışmasın.
      event.stopImmediatePropagation();
      const pan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        vx: state.view.x,
        vy: state.view.y,
        moved: false
      };
      board.classList.add('is-panning');
      try { board.setPointerCapture(event.pointerId); } catch { /* sessiz */ }

      const move = ev => {
        if (ev.pointerId !== pan.id) return;
        const dx = ev.clientX - pan.x;
        const dy = ev.clientY - pan.y;
        if (!pan.moved && Math.hypot(dx, dy) < 3) return;
        pan.moved = true;
        state.view.x = pan.vx + dx;
        state.view.y = pan.vy + dy;
        if (typeof applyView === 'function') applyView();
        syncRefZoom();
      };

      const end = ev => {
        if (ev.pointerId !== pan.id) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        board.classList.remove('is-panning');
        try { board.releasePointerCapture(pan.id); } catch { /* sessiz */ }
        // Boş alana tıklamak seçimi bıraksın (tahtanın normal davranışı).
        if (!pan.moved) {
          try {
            selection.clear();
            selectionOrder = [];
            syncSelection();
          } catch { /* sessiz */ }
        }
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    }, true);
  }

  /* =========================================================
     RENK PANELİ
     ========================================================= */
  function buildColorBody(body, def) {
    body.classList.add('v5-color-body');

    const host = el('div');
    host.id = 'v5ColorWheelHost';
    const hexRow = el('div', 'v5-hex-row');
    const swatch = el('span', 'v5-color-swatch');
    swatch.id = 'v5ColorSwatch';
    const hexBox = el('div', 'v5-hex-box');
    const dropper = el('button', 'v5-color-dropper', icon('droplet'));
    dropper.type = 'button';
    dropper.title = 'Eyedropper (I)';
    dropper.setAttribute('aria-label', 'Eyedropper');
    dropper.addEventListener('click', () => {
      if (typeof dpSetTool === 'function') dpSetTool('eyedropper');
      else if (typeof inkSetTool === 'function') inkSetTool('eyedropper');
    });
    hexRow.append(swatch, hexBox, dropper);

    const recents = el('div', 'v5-recents');
    recents.id = 'v5Recents';
    /* Sağ uç aşağı ok: son kullanılanlar ızgarasını aç/kapatır (şeritte
       ilk 8, ızgarada 24'e kadar). Ok, liste boşken devre dışı. */
    const recStrip = el('div', 'v5-recents-strip');
    recStrip.id = 'v5RecentsStrip';
    const recToggle = el('button', 'v5-recents-toggle', icon('chevron'));
    recToggle.id = 'v5RecentsToggle';
    recToggle.type = 'button';
    recToggle.title = 'Recent colors';
    recToggle.setAttribute('aria-label', 'Recent colors open or close');
    recToggle.setAttribute('aria-expanded', 'false');
    recToggle.disabled = true;
    const recGrid = el('div', 'v5-recents-grid');
    recGrid.id = 'v5RecentsGrid';
    recGrid.hidden = true;
    recToggle.addEventListener('click', () => {
      const open = recGrid.hidden;
      recGrid.hidden = !open;
      recToggle.classList.toggle('is-open', open);
      recToggle.setAttribute('aria-expanded', String(open));
      if (open) fillRecents(recGrid, 24);
    });
    recents.append(recStrip, recToggle);

    body.append(host, hexRow, recents, recGrid);
    renderRecents();
  }

  /** FAZ 6 A2: geçmiş şerit doldurucu — hem renk panelindeki hem
      options bar'daki kardeş konteynerlere aynı veriyi basar. */
  function fillRecents(host, limit) {
    if (!host) return;
    host.replaceChildren();
    let current = '#d4a24a';
    try { current = String(inkState().color || current).toLowerCase(); } catch { /* sessiz */ }
    v5.recents.slice(0, limit || 8).forEach(hex => {
      /* v5-recents-chip: IRIX evrensel buton kuralından muaf (inline hex
         bg taşır; sınıfsız olsa bevel grileştiriyordu) */
      const b = el('button', 'v5-recents-chip');
      b.type = 'button';
      b.style.background = hex;
      b.title = hex.toUpperCase();
      b.setAttribute('aria-label', 'Color ' + hex.toUpperCase());
      if (hex.toLowerCase() === current) b.classList.add('is-current');
      b.addEventListener('click', () => {
        if (typeof inkSetColor === 'function') inkSetColor(hex, true);
        syncColor();
      });
      host.appendChild(b);
    });
  }

  function renderRecents() {
    /* Şerit (#v5OptRecents) kaldırıldı; geçmiş yalnız renk panelinde. */
    fillRecents($('v5RecentsStrip'), 8);
    const toggle = $('v5RecentsToggle');
    if (toggle) toggle.disabled = v5.recents.length === 0;
    const grid = $('v5RecentsGrid');
    if (grid && !grid.hidden) fillRecents(grid, 96);
  }

  function addRecent(value) {
    const hex = hexNorm(value);
    if (!hex) return;
    v5.recents = [hex].concat(v5.recents.filter(x => x.toLowerCase() !== hex)).slice(0, 96);
    renderRecents();
    saveStore();
  }

  function syncColor() {
    let hex = '#d4a24a';
    try { hex = String(inkState().color || hex).toLowerCase(); } catch { /* sessiz */ }
    const swatch = $('v5ColorSwatch');
    if (swatch) swatch.style.background = hex;
    const input = $('inkWheelHexInput');
    if (input && document.activeElement !== input) input.value = hex.toUpperCase();
    const recents = document.querySelectorAll('#v5RecentsStrip, #v5RecentsGrid');
    recents.forEach(host => {
      host.querySelectorAll('button').forEach(b => {
        b.classList.toggle('is-current', String(b.title || '').toLowerCase() === hex);
      });
    });
  }

  /* =========================================================
     KATMANLAR PANELİ
     ========================================================= */
  /** Panelde gösterilen katman: önce belgeye bağlı seçili katman, yoksa
      motorun aktif katmanı. Opaklık kaydırıcısı bu katmanı değiştirmeli;
      aksi hâlde değer başka bir katmana yazılıp ekranda hiçbir şey
      değişmiyordu. */
  function currentLayer() {
    let layer = null;
    try {
      const docId = typeof inkDocOwnerId === 'function' ? inkDocOwnerId() : null;
      if (docId && typeof inkDocSelectedLayer === 'function') layer = inkDocSelectedLayer(docId);
      if (!layer && typeof inkActiveLayer === 'function') layer = inkActiveLayer();
    } catch { /* sessiz */ }
    return layer;
  }

  function buildLayersBody(body, def) {
    body.classList.add('v5-layers-body');

    const blendRow = el('div', 'v5-blend-row');
    const blendSel = el('div', 'v5-blend-select');
    blendSel.appendChild(el('span', null, ''));
    blendSel.lastChild.remove();
    blendSel.insertAdjacentHTML('beforeend', svg('chevron'));

    const opacity = el('div', 'v5-layer-opacity');
    const opacityRange = el('input', 'v5-range v5-layer-opacity-range');
    opacityRange.type = 'range';
    opacityRange.min = '0';
    opacityRange.max = '100';
    opacityRange.step = '1';
    opacityRange.value = '100';
    opacityRange.id = 'v5LayerOpacityRange';
    opacityRange.title = 'Layer opacity';
    opacityRange.setAttribute('aria-label', 'Layer opacity');
    const opacityVal = el('span', 'v5-layer-opacity-val', '%100');
    opacityVal.id = 'v5LayerOpacity';
    opacity.append(opacityRange, opacityVal);

    const applyOpacity = () => {
      const layer = currentLayer();
      if (!layer) return;
      layer.opacity = clamp(Number(opacityRange.value) / 100, 0, 1);
      opacityVal.textContent = '%' + Math.round(layer.opacity * 100);
      opacityRange.style.setProperty('--v5-p', Math.round(layer.opacity * 100) + '%');
      if (typeof inkLayerRefreshPreview === 'function') inkLayerRefreshPreview();
      else {
        if (typeof inkSyncDom === 'function') inkSyncDom();
        if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
        if (typeof inkEditorLiveOverlaySync === 'function') inkEditorLiveOverlaySync();
      }
    };
    opacityRange.addEventListener('pointerdown', () => {
      if (typeof pushUndo === 'function') pushUndo();
    });
    opacityRange.addEventListener('input', applyOpacity);
    opacityRange.addEventListener('change', () => {
      if (typeof scheduleSave === 'function') scheduleSave();
    });

    blendRow.append(blendSel, opacity);

    const scroll = el('div', 'v5-layer-scroll');
    scroll.id = 'v5LayerScroll';

    /* --- Layers / FX sekmeleri ------------------------------------
       Aynı panel iki görünüm taşır: katman listesi ve efekt yığını.
       Sekme, gövdeyi değiştirir (ayrı pencere/ek bölüm yok). */
    const tabs = el('div', 'v5-layer-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabLayers = el('button', 'v5-layer-tab is-active', 'Layers');
    tabLayers.type = 'button';
    tabLayers.dataset.tab = 'layers';
    tabLayers.setAttribute('role', 'tab');
    const tabFx = el('button', 'v5-layer-tab', 'FX');
    tabFx.type = 'button';
    tabFx.dataset.tab = 'fx';
    tabFx.setAttribute('role', 'tab');
    tabs.append(tabLayers, tabFx);

    const layersView = el('div', 'v5-layer-view v5-layer-view--layers');
    layersView.id = 'v5LayersView';
    layersView.append(blendRow, scroll);

    const fxView = el('div', 'v5-layer-view v5-layer-view--fx');
    fxView.id = 'v5FxView';
    fxView.hidden = true;
    const fxHost = el('div', 'v5-fx-host');
    fxHost.id = 'v5FxHost';
    const fxEmpty = el('div', 'v5-fx-empty', 'Select an image to use effects');
    fxHost.appendChild(fxEmpty);
    fxView.appendChild(fxHost);

    body.append(tabs, layersView, fxView);

    const setTab = which => {
      const fx = which === 'fx';
      tabLayers.classList.toggle('is-active', !fx);
      tabFx.classList.toggle('is-active', fx);
      tabLayers.setAttribute('aria-selected', String(!fx));
      tabFx.setAttribute('aria-selected', String(fx));
      layersView.hidden = fx;
      fxView.hidden = !fx;
      /* Özet satırı FX sekmesinde gereksiz: efekt görünümünde bölüm
         daima açıktır (inline gizleme, tema kurallarından bağımsız). */
      const sum = document.querySelector('#inkFxSection > summary');
      if (sum) sum.style.display = fx ? 'none' : '';
      if (fx) {
        /* Efekt görünümü: bölümü buraya bağla, tarayıcıyı aç. */
        if (typeof window.inkFxUiMountV5Layers === 'function') {
          try { window.inkFxUiMountV5Layers(fxHost); } catch { /* sessiz */ }
        }
        if (typeof window.inkFxUiEnterTab === 'function') {
          try { window.inkFxUiEnterTab(); } catch { /* sessiz */ }
        }
      }
    };
    window.__v5LayersSetTab = setTab;

    tabs.addEventListener('click', event => {
      const btn = event.target.closest ? event.target.closest('.v5-layer-tab') : null;
      if (!btn || !tabs.contains(btn)) return;
      event.preventDefault();
      setTab(btn.dataset.tab === 'fx' ? 'fx' : 'layers');
    });

    /* FX bölümünü FX görünümüne bağla (varsa eski konumundan taşınır). */
    if (typeof window.inkFxUiMountV5Layers === 'function') {
      try { window.inkFxUiMountV5Layers(fxHost); } catch { /* sessiz */ }
    }

    const head = v5.panels[def.id] ? v5.panels[def.id].querySelector('.v5-panel-head') : null;
    if (head) {
      const actions = head.querySelector('.v5-panel-actions');
      const add = el('button', 'v5-head-btn', icon('plus'));
      add.type = 'button';
      add.title = 'New layer (Shift+N)';
      add.setAttribute('aria-label', 'New layer');
      add.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof inkDocAddLayer === 'function') inkDocAddLayer();
      });
      const more = el('button', 'v5-head-btn', icon('more'));
      more.type = 'button';
      more.title = 'Layer actions';
      more.setAttribute('aria-label', 'Layer actions');
      more.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof inkLayerMenuToggle === 'function') inkLayerMenuToggle(more);
      });
      if (actions) actions.prepend(add, more);
    }
  }

  function syncLayers() {
    const range = $('v5LayerOpacityRange');
    const value = $('v5LayerOpacity');
    const layer = currentLayer();
    if (range) {
      const pct = Math.round((layer && Number.isFinite(layer.opacity) ? layer.opacity : 1) * 100);
      range.value = String(pct);
      range.disabled = !layer;
      range.style.setProperty('--v5-p', pct + '%');
    }
    if (value) {
      value.textContent = '%' + (range ? range.value : '100');
    }
    const list = $('inkLayerList');
    const rows = list ? list.querySelectorAll('.inkLayerRow').length : 0;
    const del = $('btnInkDeleteLayer');
    if (del) {
      del.disabled = rows <= 1;
      del.title = rows <= 1 ? 'At least one layer is required' : 'Delete layer (Delete)';
    }
  }

  function bindLayerDrag() {
    const list = $('inkLayerList');
    if (!list || list.__v5drag) return;
    list.__v5drag = true;
    // Motorun kendi sürükleme dinleyicileri liste üzerinde; yakalama
    // fazında önce biz çalışıp olayı durdururuz. Böylece sıralama tek
    // kez ve aşağı sürüklemede de doğru indeksle uygulanır.
    const host = list.parentElement || list;
    let dragId = '';

    const clear = () => {
      dragId = '';
      list.querySelectorAll('.is-dragging, .is-drop-above, .is-drop-below').forEach(row => {
        row.classList.remove('is-dragging', 'is-drop-above', 'is-drop-below');
      });
    };

    host.addEventListener('dragstart', event => {
      const row = event.target.closest && event.target.closest('.inkLayerRow');
      /* Efekt (FX) satırları da .inkLayerRow taşır ama kendi sıralama
         sürüklemesine sahiptir: data-layerId yoksa olaya karışmayız, yoksa
         stopPropagation FX bölümünün dragstart'ını yutuyordu. */
      if (!row || !row.dataset.layerId) return;
      event.stopPropagation();
      dragId = row.dataset.layerId || '';
      row.classList.add('is-dragging');
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragId);
      } catch { /* sessiz */ }
    }, true);

    host.addEventListener('dragover', event => {
      if (!dragId) return;
      event.preventDefault();
      event.stopPropagation();
      try { event.dataTransfer.dropEffect = 'move'; } catch { /* sessiz */ }
      list.querySelectorAll('.is-drop-above, .is-drop-below').forEach(row => {
        row.classList.remove('is-drop-above', 'is-drop-below');
      });
      const row = event.target.closest && event.target.closest('.inkLayerRow');
      if (!row || row.dataset.layerId === dragId) return;
      const rect = row.getBoundingClientRect();
      row.classList.add(event.clientY > rect.top + rect.height / 2 ? 'is-drop-below' : 'is-drop-above');
    }, true);

    host.addEventListener('drop', event => {
      if (!dragId) return;
      event.preventDefault();
      event.stopPropagation();
      const row = event.target.closest && event.target.closest('.inkLayerRow');
      const rows = [...list.querySelectorAll('.inkLayerRow')].filter(r => r.dataset.layerId !== dragId);
      let index = rows.length;
      if (row && row.dataset.layerId !== dragId) {
        const rect = row.getBoundingClientRect();
        index = rows.indexOf(row) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
      }
      const id = dragId;
      clear();
      if (typeof inkDocReorderLayer === 'function') inkDocReorderLayer(id, index);
    }, true);

    host.addEventListener('dragend', event => {
      if (!dragId) return;
      event.stopPropagation();
      clear();
    }, true);
  }

  /* =========================================================
     FIRÇA PANELİ
     ========================================================= */
  /* =========================================================
     FIRÇA PANELİ · Fırça Kütüphanesi
     ---------------------------------------------------------
     Sağ alttaki eski fırça ayarları paneli artık iki sütunlu
     kütüphanedir: solda kategoriler, sağda S eğrisi önizlemeli
     fırça kartları. Boyut/opaklık/yumuşatma ve .abr içe aktarma
     panelin altındaki katlanır "Fırça Ayarları" bölümündedir.
     ========================================================= */
  function brushCategories() {
    const base = (typeof NativeBrushCategories !== 'undefined' && Array.isArray(NativeBrushCategories))
      ? NativeBrushCategories
      : (window.NativeBrushCategories || []);
    /* Yıldızlanan sanal kategorisi en üstte: native kütüphane overlay'i
       ile aynı sıra. Kartlardaki yıldız düğmesiyle beslenir. */
    const virtuals = (typeof NativeBrushVirtualCategories !== 'undefined' && Array.isArray(NativeBrushVirtualCategories))
      ? NativeBrushVirtualCategories
      : (window.NativeBrushVirtualCategories || []);
    const list = [
      ...virtuals.map(cat => ({ id: cat.id, name: cat.name, title: cat.title, virtual: true })),
      ...base.map(cat => ({ id: cat.id, name: cat.name, title: cat.title })),
    ];
    const known = new Set(list.map(cat => cat.id));
    if (brushStateList().some(brush => !known.has(brush.category))) {
      list.push({ id: '__imported', name: 'Imported', title: 'IMPORTED BRUSHES' });
    }
    if (!list.length) {
      list.push({ id: 'sketch', name: 'Sketch', title: 'SKETCH BRUSHES' });
    }
    return list;
  }

  function brushCategoryById(id) {
    const list = brushCategories();
    return list.find(cat => cat.id === id) || list[0];
  }

  function brushCategoryFor(brush) {
    if (!brush) return brushCategories()[0].id;
    const list = brushCategories();
    if (list.some(cat => cat.id === brush.category)) return brush.category;
    return list.some(cat => cat.id === '__imported') ? '__imported' : list[0].id;
  }

  function brushStateList() {
    try {
      const ink = typeof inkState === 'function' ? inkState() : null;
      return ink && Array.isArray(ink.brushes) ? ink.brushes : [];
    } catch { return []; }
  }

  function activeBrush() {
    try {
      const ink = inkState();
      if (typeof inkGetBrush === 'function') return inkGetBrush(ink.brushId);
      return (ink.brushes || []).find(brush => brush.id === ink.brushId) || null;
    } catch { return null; }
  }

  function brushesInCategory(id) {
    const known = new Set(brushCategories().filter(cat => !cat.virtual).map(cat => cat.id));
    if (id === 'favorites') {
      /* Yıldızlananlar: sanal filtre — favori setindeki tüm fırçalar. */
      let favs = null;
      try { favs = typeof inkNativeFavoriteSet === 'function' ? inkNativeFavoriteSet() : null; } catch { favs = null; }
      if (!favs) return [];
      return brushStateList().filter(brush => brush && favs.has(brush.id));
    }
    return brushStateList().filter(brush => {
      if (!brush) return false;
      if (id === '__imported') return !known.has(brush.category);
      return brush.category === id;
    });
  }

  function buildBrushBody(body, def) {
    body.classList.add('v5-brush-lib');

    const cats = el('nav', 'v5-brush-cats');
    cats.setAttribute('aria-label', 'Brush categories');
    const catsHead = el('div', 'v5-brush-cats__head', 'CATEGORIES');
    const catList = el('div', 'v5-brush-cats__list');
    catList.setAttribute('role', 'tablist');
    cats.append(catsHead, catList);

    const main = el('section', 'v5-brush-main');
    const mainHead = el('div', 'v5-brush-main__head');
    const title = el('span', 'v5-brush-main__title', 'BRUSHES');
    const count = el('span', 'v5-brush-main__count', '');
    mainHead.append(title, count);

    const list = el('div', 'v5-brush-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Brushes');

    const customCreate = el('button', 'v5-brush-custom-create',
      '<span aria-hidden="true">＋</span><span>Create your own brush</span>');
    customCreate.type = 'button';
    customCreate.addEventListener('click', event => {
      event.preventDefault();
      if (typeof inkOpenNativeBrushLibrary !== 'function') {
        if (typeof showProjectNotice === 'function') {
          showProjectNotice('Custom brush creator could not load.', 3000);
        }
        return;
      }
      inkOpenNativeBrushLibrary(customCreate, 'custom', { creatorOnly: true });
      requestAnimationFrame(() => {
        const name = $('nativeBrushCustomName');
        if (name) name.focus();
      });
    });

    const settings = el('details', 'v5-brush-settings');
    const summary = el('summary', null, '<span>BRUSH SETTINGS</span>');
    const settingsBody = el('div', 'v5-brush-settings__body');
    /* Boyut/Opaklık/Yumuşatma kaydırıcıları kaldırıldı — üst options
       bar'da zaten var (çift kontrol kargaşası). Panelde yalnız
       .abr içe aktarma + özel fırça oluşturma kalır. */
    const abrBtn = el('button', 'v5-brush-import',
      icon('upload') + '<span>Import .abr tip</span>');
    abrBtn.type = 'button';
    abrBtn.title = 'Import .abr brush file';
    abrBtn.addEventListener('click', event => {
      event.preventDefault();
      const input = $('inkAbrInput');
      if (input) input.click();
      else if (typeof showProjectNotice === 'function') {
        showProjectNotice('.abr brush import area not found', 3000);
      }
    });
    settingsBody.appendChild(abrBtn);
    settings.append(summary, settingsBody);

    settingsBody.appendChild(customCreate);
    main.append(mainHead, list, settings);
    body.append(cats, main);

    v5.brushLib = {
      category: '',
      activeId: null,
      userPicked: false,
      cats: catList,
      list,
      title,
      count,
      cards: [],
      settings
    };

    // Kart önizlemeleri panelin gerçek genişliğine göre yeniden çizilir.
    // Ayrıca kompakt yoğunluk: bölüm kısaldığında isim satırı küçülür,
    // önizlemeler daralır — fırçalar kaybolmadan listeye çok kart sığar.
    if (typeof ResizeObserver === 'function') {
      let compact = false;
      body.__v5BrushRO = new ResizeObserver(entries => {
        if (!isDraw()) return;
        paintBrushCardPreviews();
        const h = entries && entries[0] ? Math.round(entries[0].contentRect.height) : body.clientHeight;
        const want = h > 0 && h < 250;
        if (want !== compact) {
          compact = want;
          body.classList.toggle('v5-brush-lib--compact', want);
        }
      });
      body.__v5BrushRO.observe(body);
    }

    renderBrushLibrary(true);

    // Motor fırça listesi panel kurulurken henüz hazır olmayabilir (panel
    // referans modunda, motor ise fırçaları sonradan yükler). İlk gerçek
    // fırça gelene kadar kısa aralıklarla yeniden dene; aksi halde panel
    // "Eskiz" gibi ilk kategoriye düşüp aktif fırçayı göstermiyordu.
    if (!activeBrush()) {
      let tries = 0;
      const follow = () => {
        const lib = v5.brushLib;
        if (!lib || lib.userPicked) return;
        if (activeBrush() || ++tries > 60) {
          renderBrushLibrary(true);
          return;
        }
        setTimeout(follow, 100);
      };
      setTimeout(follow, 100);
    }

    const head = v5.panels[def.id] ? v5.panels[def.id].querySelector('.v5-panel-head') : null;
    if (head) {
      const actions = head.querySelector('.v5-panel-actions');
      const bigger = el('button', 'v5-head-btn', icon('expand'));
      bigger.type = 'button';
      bigger.title = 'Enlarge the library';
      bigger.setAttribute('aria-label', 'Enlarge the brush library');
      bigger.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openBrushMenu(bigger);
      });
      if (actions) actions.prepend(bigger);
    }
  }

  function renderBrushLibrary(force) {
    const lib = v5.brushLib;
    if (!lib) return;
    const brush = activeBrush();
    const activeId = brush ? brush.id : '';
    // Kullanıcı bir kategoriye elle geçtiyse orada kalır; yalnızca aktif
    // fırça değişince panel o fırçanın kategorisine döner. Aksi halde her
    // senkron (boyut sürüklemesi, tuval tazelemesi) seçimi geri sıçratıyordu.
    if (activeId !== lib.activeId) {
      lib.activeId = activeId;
      lib.userPicked = false;
      lib.category = brush ? brushCategoryFor(brush) : lib.category;
    }
    let category = lib.category;
    if (!category || !brushCategories().some(cat => cat.id === category)) {
      category = brush ? brushCategoryFor(brush) : brushCategories()[0].id;
    }
    const changed = force || category !== lib.category;
    lib.category = category;

    if (changed) {
      renderBrushCategories();
      renderBrushCards();
    } else {
      for (const item of lib.cards) {
        const on = item.brush.id === activeId;
        item.el.classList.toggle('is-active', on);
        item.el.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    syncBrushLibraryMeta();
  }

  function renderBrushCategories() {
    const lib = v5.brushLib;
    if (!lib) return;
    lib.cats.replaceChildren();
    for (const cat of brushCategories()) {
      const on = cat.id === lib.category;
      const btn = el('button', 'v5-brush-cat' + (on ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.category = cat.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      const mark = el('span', 'v5-brush-cat__mark', '›');
      const name = el('span', 'v5-brush-cat__name', cat.name || cat.id);
      btn.append(mark, name);
      btn.addEventListener('click', () => {
        if (lib.category === cat.id) return;
        lib.userPicked = true;
        lib.category = cat.id;
        renderBrushCategories();
        renderBrushCards();
      });
      lib.cats.appendChild(btn);
    }
  }

  function renderBrushCards() {
    const lib = v5.brushLib;
    if (!lib) return;
    const brush = activeBrush();
    const activeId = brush ? brush.id : '';
    const items = brushesInCategory(lib.category);
    lib.list.replaceChildren();
    lib.list.dataset.category = lib.category;
    lib.cards = [];
    for (const item of items) {
      const on = item.id === activeId;
      const card = el('button', 'v5-brush-card' + (on ? ' is-active' : ''));
      card.type = 'button';
      card.dataset.brushId = item.id;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', on ? 'true' : 'false');
      card.title = item.description || item.name || '';
      const canvas = el('canvas', 'v5-brush-card__canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const meta = el('span', 'v5-brush-card__meta');
      const name = el('span', 'v5-brush-card__name', item.name || 'Brush');
      const size = el('span', 'v5-brush-card__size',
        Number.isFinite(item.size) ? Math.round(item.size) + ' px' : '');
      meta.append(name, size);
      card.append(canvas, meta);
      /* Yıldız düğmesi: favori setine ekler/çıkarır; native kütüphane
         overlay'i ile aynı favori setini paylaşır. */
      const isFav = (typeof inkNativeIsFavorite === 'function') && (() => {
        try { return inkNativeIsFavorite(item.id); } catch { return false; }
      })();
      const star = el('span', 'v5-brush-card__star' + (isFav ? ' is-on' : ''),
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>');
      star.setAttribute('role', 'button');
      star.setAttribute('tabindex', '0');
      star.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      star.setAttribute('aria-label', (item.name || 'Brush') + (isFav ? ' — remove from favorites' : ' — add to favorites'));
      star.title = isFav ? 'Remove from favorites' : 'Add to favorites';
      const toggleStar = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        Promise.resolve(typeof inkNativeToggleFavorite === 'function' ? inkNativeToggleFavorite(item.id) : null)
          .then(() => {
            renderBrushCategories();
            renderBrushCards();
          })
          .catch(() => {});
      };
      star.addEventListener('click', toggleStar);
      star.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') toggleStar(ev);
      });
      card.append(star);
      card.addEventListener('click', () => {
        if (typeof setActiveBrush !== 'function') return;
        setActiveBrush(item.id);
        if (typeof inkSyncUI === 'function') inkSyncUI();
        syncToolbar();
        renderBrushLibrary();
      });
      lib.list.appendChild(card);
      lib.cards.push({ el: card, canvas, brush: item });
    }
    if (!items.length) {
      lib.list.appendChild(el('p', 'v5-brush-empty', lib.category === 'favorites'
        ? 'No starred brushes yet. Tap the star at the top right of the cards.'
        : 'No brushes in this category yet.'));
    }
    syncBrushLibraryMeta();
    requestAnimationFrame(paintBrushCardPreviews);
  }

  function syncBrushLibraryMeta() {
    const lib = v5.brushLib;
    if (!lib) return;
    const cat = brushCategoryById(lib.category);
    lib.title.textContent = cat.title || ((cat.name || 'Brush') + ' BRUSHES').toUpperCase();
    const total = brushesInCategory(lib.category).length;
    lib.count.textContent = total + ' brush';
  }

  /* Kartlardaki S eğrisi, motorun gerçek damla üretimiyle çizilir.
     Ölçü kartın gerçek kutusundan okunur; panel/dock yeniden
     boyutlandığında önizleme bulanıklaşmadan yeniden çizilir. */
  function paintBrushCardPreviews() {
    const lib = v5.brushLib;
    if (!lib || typeof renderStrokePreview !== 'function') return;
    for (const item of lib.cards) {
      const width = Math.round(item.canvas.clientWidth || 0);
      const height = Math.round(item.canvas.clientHeight || 0);
      if (width < 40 || height < 24) continue;
      renderStrokePreview(item.canvas, item.brush, {
        width,
        height,
        color: '#e9e3d7',
        sizePx: Math.max(3, Math.min(20, (Number(item.brush.size) || 24) * 0.3 + 3)),
      });
    }
  }

  function syncBrushLibrary() {
    if (!v5.ready || !v5.brushLib) return;
    renderBrushLibrary();
  }

  function sliderRow(label, inputId, key) {
    const row = el('div', 'v5-slider-row');
    row.dataset.slider = key;
    const lab = el('label', null, label);
    lab.setAttribute('for', inputId);
    const out = el('output');
    out.dataset.v5Out = key;
    row.append(lab);
    const input = $(inputId);
    if (input) {
      input.classList.add('v5-range');
      row.appendChild(input);
    } else {
      const placeholder = el('input', 'v5-range');
      placeholder.type = 'range';
      placeholder.id = inputId;
      row.appendChild(placeholder);
    }
    row.appendChild(out);
    return row;
  }

  function syncLabels() {
    const panel = v5.panels.brush;
    if (!panel) return;
    syncBrushLibrary();
    const out = key => panel.querySelector('output[data-v5-out="' + key + '"]');
    const size = $('inkSize');
    const sizeVal = out('size');
    if (size && sizeVal) sizeVal.textContent = Math.round(Number(size.value) || 0) + ' px';
    const opacity = $('inkOpacity');
    const opacityVal = out('opacity');
    if (opacity && opacityVal) opacityVal.textContent = Math.round(Number(opacity.value) || 0) + '%';
    const smooth = $('inkSmoothing');
    const smoothVal = out('smoothing');
    if (smooth && smoothVal) smoothVal.textContent = Math.round(Number(smooth.value) || 0) + '%';
  }

  function syncSliders() {
    ['inkSize', 'inkOpacity', 'inkSmoothing'].forEach(id => {
      const input = $(id);
      if (!input) return;
      const min = Number(input.min) || 0;
      const max = Number(input.max) || 100;
      const val = Number(input.value) || 0;
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--v5-p', pct + '%');
    });
  }

  /* Önizleme motoru tek bir vuruş çizer; referans tasarımdaki iki
     dokulu vuruşu tamamlamak için ikinci, daha açık bir vuruş ekleriz. */
  function paintPreviewSecondStroke() {
    const canvas = $('inkBrushPreview');
    if (!canvas) return;
    const cssW = canvas.clientWidth || 0;
    const cssH = canvas.clientHeight || 0;
    if (!cssW || !cssH) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let color = '#d4a24a';
    try { color = inkState().color || color; } catch { /* sessiz */ }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const y0 = cssH * 0.74;
    const amp = cssH * 0.08;
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const x0 = cssW * (0.1 + t0 * 0.8);
      const x1 = cssW * (0.1 + t1 * 0.8);
      const yy0 = y0 + Math.sin(t0 * Math.PI * 2.2) * amp;
      const yy1 = y0 + Math.sin(t1 * Math.PI * 2.2) * amp;
      ctx.lineWidth = Math.max(1.2, cssH * 0.07 * (0.7 + 0.3 * Math.sin(t0 * Math.PI)));
      ctx.beginPath();
      ctx.moveTo(x0, yy0);
      ctx.lineTo(x1, yy1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* =========================================================
     MOTOR DÜĞÜMLERİNİ TAŞI
     ========================================================= */
  function placeColorWheel() {
    const host = $('v5ColorWheelHost');
    const wheel = $('inkColorWheel');
    if (!host || !wheel) return;
    wheel.hidden = false;
    wheel.dataset.psInline = '1';
    wheel.classList.add('ps-inline-wheel');
    wheel.style.left = '';
    wheel.style.top = '';
    wheel.style.position = '';
    if (wheel.parentElement !== host) host.appendChild(wheel);
    const hexField = wheel.querySelector('.inkWheelHexField');
    const hexBox = v5.panels.color && v5.panels.color.querySelector('.v5-hex-box');
    if (hexField && hexBox && hexField.parentElement !== hexBox) hexBox.appendChild(hexField);
    // Panel daraltıldığında çark da küçülür; tuvali yeni ölçüde yeniden çiz.
    if (typeof ResizeObserver === 'function' && !host.__v5WheelRO) {
      host.__v5WheelRO = new ResizeObserver(() => {
        try {
          if (typeof inkWheelDraw === 'function') inkWheelDraw();
        } catch { /* sessiz */ }
      });
      host.__v5WheelRO.observe(host);
    }
    try {
      if (typeof inkWheelDraw === 'function') inkWheelDraw();
    } catch { /* sessiz */ }
  }

  function ensureLayerMount() {
    const scroll = $('v5LayerScroll');
    const list = $('inkLayerList');
    if (scroll && list && list.parentElement !== scroll) scroll.appendChild(list);
    return !!(scroll && list);
  }

  function mountEngineNodes() {
    if (v5.panels.color) placeColorWheel();

    const layersPanel = v5.panels.layers;
    if (layersPanel) {
      ensureLayerMount();
      const blend = $('inkLayerBlend');
      const sel = layersPanel.querySelector('.v5-blend-select');
      if (blend && sel && blend.parentElement !== sel) sel.insertBefore(blend, sel.firstChild);
      bindLayerDrag();
    }

    const brushPanel = v5.panels.brush;
    if (brushPanel) {
      ['inkSize', 'inkOpacity', 'inkSmoothing'].forEach(id => {
        const input = $(id);
        const row = brushPanel.querySelector('.v5-slider-row input#' + id)?.closest('.v5-slider-row');
        if (input && row) {
          if (input.parentElement !== row) {
            const out = row.querySelector('output');
            row.insertBefore(input, out || null);
          }
          input.classList.add('v5-range');
          if (!input.__v5Range) {
            input.__v5Range = true;
            input.addEventListener('input', () => {
              syncLabels();
              syncSliders();
            });
          }
        }
      });
    }
  }

  /* =========================================================
     GÖRÜNÜM ALANI
     ========================================================= */
  const baseViewport = typeof window.inkEditorViewport === 'function' ? window.inkEditorViewport : null;

  /* PROFİLER DÜZELTMESİ: v5Viewport bir vuruş/etkileşim akışında yüzlerce
     kez koşuyor ve her çağrıda dock ölçümü yapıyordu (gBCR 688 örnek).
     Dock rect'i kare büyüklüğünde (8 ms TTL) önbelleklenir; anahtar
     (vw, vh, gizli) değişirse yeniden ölçülür — kayma en fazla 1 kare
     (options bar overflow ölçümüyle aynı kabul). */
  function v5DockRects(vw, vh, hidden) {
    const now = performance.now();
    const c = v5.dockRectCache || (v5.dockRectCache =
      { t: -1e9, vw: 0, vh: 0, hidden: null, left: 24, right: 24 });
    if (now - c.t < 8 && c.vw === vw && c.vh === vh && c.hidden === hidden) {
      return c;
    }
    let left = 24;
    let right = 24;
    if (!hidden) {
      const ld = $('v5LeftDock');
      const rd = $('v5RightDock');
      if (ld && ld.offsetWidth > 4) {
        const r = ld.getBoundingClientRect();
        if (r.width > 4) left = Math.max(left, r.right + 24);
      }
      if (rd && rd.offsetWidth > 4) {
        const r = rd.getBoundingClientRect();
        if (r.width > 4) right = Math.max(right, vw - r.left + 24);
      }
    }
    c.t = now; c.vw = vw; c.vh = vh; c.hidden = hidden;
    c.left = left; c.right = right;
    return c;
  }

  function v5Viewport() {
    if (!isDraw()) {
      if (baseViewport) return baseViewport();
      const vw = Math.max(1, innerWidth);
      const vh = Math.max(1, innerHeight);
      return { vw, vh, left: 24, right: 24, top: 68, bottom: 24, aw: Math.max(120, vw - 48), ah: Math.max(120, vh - 92) };
    }

    const vw = Math.max(1, innerWidth);
    const vh = Math.max(1, innerHeight);
    const hidden = document.body.classList.contains('v5-panels-hidden');
    const dock = v5DockRects(vw, vh, hidden);
    let left = dock.left;
    let right = dock.right;
    let top = 80;
    let bottom = 24;

    if (vw < 700) {
      left = 12;
      right = 12;
      top = 72;
      bottom = 64;
    }

    if (vw - left - right < 160) right = Math.max(16, vw - left - 160);
    if (vh - top - bottom < 160) bottom = Math.max(16, vh - top - 160);

    return {
      vw, vh, left, right, top, bottom,
      aw: Math.max(120, vw - left - right),
      ah: Math.max(120, vh - top - bottom)
    };
  }

  function syncCanvasSoon() {
    requestAnimationFrame(() => {
      if (!isDraw()) return;
      window.inkEditorViewport = v5Viewport;
      if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
      if (typeof inkEditorSyncStatus === 'function') inkEditorSyncStatus();
      if (typeof inkSyncCanvasFrame === 'function') inkSyncCanvasFrame();
    });
  }

  /* =========================================================
     ARAÇ ÇUBUĞU EŞİTLEME
     ========================================================= */
  function syncToolbar() {
    const bar = v5.toolbar;
    if (!bar) return;
    let tool = 'brush';
    let pan = false;
    try { tool = String(inkState().tool || tool); } catch { /* sessiz */ }
    try { pan = !!(window.dpProto && dpProto.panMode); } catch { /* sessiz */ }

    const select = ['transform', 'marquee', 'lasso'].includes(tool);
    // FAZ 6 A6 (tek-ışık): fırça düğmesi yalnız fırça için yanar;
    // kadem vurgusu grup düzeyine (caret + arka plan) devredilir.
    const brushBtnOn = tool === 'brush';
    const paintGroup = ['brush', 'pencil'].includes(tool);
    const shape = tool === 'shape';
    const eraser = tool === 'eraser';
    const fill = tool === 'fill';
    const smudge = tool === 'smudge';
    const gradient = tool === 'gradient';

    bar.querySelectorAll('[data-tool]').forEach(btn => {
      const name = btn.dataset.tool;
      const on = (name === 'transform' && select) ||
        (name === 'brush' && brushBtnOn) ||
        (name === 'eraser' && eraser) ||
        (name === 'fill' && fill) ||
        (name === 'smudge' && smudge) ||
        (name === 'gradient' && gradient) ||
        (name === 'shape' && shape);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const selGroup = bar.querySelector('[data-group="select"]');
    const brushGroup = bar.querySelector('[data-group="brush"]');
    if (selGroup) selGroup.classList.toggle('is-active', select);
    if (brushGroup) brushGroup.classList.toggle('is-active', paintGroup);
    const panBtn = bar.querySelector('[data-action="pan"]');
    if (panBtn) {
      panBtn.classList.toggle('is-active', pan);
      panBtn.setAttribute('aria-pressed', pan ? 'true' : 'false');
    }
    // FAZ 6 A1: alfa kilidi düğmesi aktif katmandaki kiliti yansıtır.
    const lockBtn = bar.querySelector('[data-action="alpha-lock"]');
    if (lockBtn) {
      let lockOn = false;
      try {
        const layer = currentLayer();
        lockOn = !!(layer && layer.alphaLock);
      } catch { /* sessiz */ }
      lockBtn.classList.toggle('is-active', lockOn);
      lockBtn.setAttribute('aria-pressed', lockOn ? 'true' : 'false');
    }

    syncLabels();
    syncSliders();
    syncColor();
    // FAZ 5: seçili araç değiştiyse options bar şemasını tazele.
    syncOptionsBar();
  }

  function setTool(tool) {
    if (typeof dpSetTool === 'function') dpSetTool(tool);
    else if (typeof inkSetTool === 'function') inkSetTool(tool);
    syncToolbar();
  }

  /* =========================================================
     MENÜLER
     ========================================================= */
  function closeMenu() {
    if (!v5.menu) return;
    v5.menu.remove();
    v5.menu = null;
    if (v5.menuAnchor && v5.menuAnchor.setAttribute) {
      v5.menuAnchor.setAttribute('aria-expanded', 'false');
      v5.menuAnchor = null;
    }
    document.removeEventListener('pointerdown', menuOutside, true);
    document.removeEventListener('keydown', menuKeys, true);
    document.removeEventListener('scroll', closeMenu, true);
  }

  function menuOutside(event) {
    const menu = v5.menu;
    if (!menu) return;
    const t = event.target instanceof Element ? event.target : null;
    if (t && (menu.contains(t) || t.closest('[data-menu]') || t.closest('.v5-grip'))) return;
    closeMenu();
  }

  function menuKeys(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeMenu();
  }

  /** FAZ 6 A8: sabit konumlu popover'ı pencere geometrisine hapseder
      (sözleşme madde 1 · bounds). opts: { alignRight, left, top } —
      alignRight: panelin sağ kenarı çapanın sağ kenarına hizalanır.
      Açılışta taşma yok: yatay/dikey clamp + altta yer yoksa çapanın
      üstüne flip. */
  function keepInViewport(panel, anchor, opts = {}) {
    const rect = anchor && anchor.getBoundingClientRect
      ? anchor.getBoundingClientRect()
      : { left: 20, right: 20, top: 60, bottom: 60 };
    const width = panel.offsetWidth || 220;
    const height = panel.offsetHeight || 220;
    let left = opts.left != null ? opts.left
      : (opts.alignRight ? rect.right - width : rect.left);
    let top = opts.top != null ? opts.top : rect.bottom + 8;
    left = clamp(left, 8, Math.max(8, innerWidth - width - 8));
    if (top + height > innerHeight - 8) top = rect.top - height - 8;
    top = clamp(top, 8, Math.max(8, innerHeight - height - 8));
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }

  function openMenu(items, anchor, options = {}) {
    closeMenu();
    const layer = v5.menuLayer || v5.root;
    if (!layer) return;
    const menu = el('div', 'v5-menu');
    menu.setAttribute('role', 'menu');
    if (options.label) menu.setAttribute('aria-label', options.label);

    for (const item of items) {
      if (item.sep) {
        menu.appendChild(el('div', 'v5-menu-sep'));
        continue;
      }
      const btn = el('button');
      btn.type = 'button';
      btn.disabled = !!item.disabled;
      if (item.title) btn.title = item.title;
      if (item.danger) btn.classList.add('is-danger');
      const check = el('span', 'v5-menu-check', item.checked ? icon('check') : '');
      const text = el('span', null, item.label);
      btn.append(check, text);
      if (item.key) btn.appendChild(el('span', 'v5-menu-key', item.key));
      if (item.state) btn.appendChild(el('span', 'v5-menu-state', __t(item.state)));
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        closeMenu();
        if (typeof item.action === 'function') item.action();
      });
      menu.appendChild(btn);
    }

    layer.appendChild(menu);
    v5.menu = menu;
    v5.menuAnchor = anchor || null;
    if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');

    // FAZ 6 A8: konumlandırma ortak keepInViewport yardımcısına
    // taşındı; alignRight davranışı korunur.
    keepInViewport(menu, anchor, { alignRight: !!options.alignRight });

    setTimeout(() => {
      document.addEventListener('pointerdown', menuOutside, true);
      document.addEventListener('keydown', menuKeys, true);
      // Panel/dock kaydırılınca menü eski yerinde kalıp altındaki
      // düğmeleri kapatmasın.
      document.addEventListener('scroll', closeMenu, true);
    }, 0);
  }

  function openSelectMenu(anchor) {
    let current = 'transform';
    try { current = String(inkState().tool || current); } catch { /* sessiz */ }
    openMenu([
      { label: 'Move / Transform', key: 'V', checked: current === 'transform', action: () => setTool('transform') },
      { label: 'Rectangular Selection', key: 'M', checked: current === 'marquee', action: () => setTool('marquee') },
      { label: 'Lasso Selection', key: 'L', checked: current === 'lasso', action: () => setTool('lasso') }
    ], anchor, { label: 'Selection tools' });
  }

  /** Boyama grubu: fırça + kalem (FAZ 5). Kalem v5 çubuğa ana düğme
      olarak girmez; bu caret menüsünden seçilir. */
  function openPaintMenu(anchor) {
    let current = 'brush';
    try { current = String(inkState().tool || current); } catch { /* sessiz */ }
    openMenu([
      { label: 'Brush', key: 'B', checked: current === 'brush', action: () => setTool('brush') },
      { label: 'Pencil', key: 'P', checked: current === 'pencil', action: () => setTool('pencil') }
    ], anchor, { label: 'Paint tools' });
  }

  function openBrushMenu(anchor) {
    // Fırça seçimi artık iki sütunlu yerel kütüphanede yapılır.
    if (typeof inkOpenNativeBrushLibrary === 'function') {
      inkOpenNativeBrushLibrary(anchor);
      return;
    }
    openMenu(
      [{ label: 'Brush library could not be loaded', disabled: true }],
      anchor,
      { label: 'Brush library', alignRight: true }
    );
  }

  /** K13 · Simetri alt menüsü: Çizim Ayarları → "Simetri ▸". Altı mod;
      aktif olan işaretlidir; seçim inkState().symMode'a yazılır ve
      select (değişim hattı) ile aynı sync'ler koşar. */
  function openSymMenu(anchor) {
    const modes = [
      { value: 'off', label: 'Off', title: 'Symmetry off' },
      { value: 'mirrorX', label: 'Mirror X', title: 'Horizontal mirroring' },
      { value: 'mirrorY', label: 'Mirror Y', title: 'Vertical mirroring' },
      { value: 'mirrorXY', label: 'Mirror X+Y', title: 'Double mirror' },
      { value: 'radial4', label: 'Radial 4', title: '4-way radial' },
      { value: 'radial8', label: 'Radial 8', title: '8-way radial' },
    ];
    let cur = 'off';
    try { cur = String(inkState().symMode || 'off'); } catch { /* sessiz */ }
    const items = modes.map(m => ({
      label: m.label,
      title: m.title,
      checked: m.value === cur,
      state: m.value === cur ? 'Selected' : '',
      action: () => {
        try {
          inkState().symMode = m.value;
          if (typeof inkSyncUI === 'function') inkSyncUI();
          if (typeof scheduleSave === 'function') scheduleSave();
        } catch { /* sessiz */ }
      }
    }));
    /* B9 küçük yazım: menü sağda açılır (dişli kolonu hizası). */
    openMenu(items, anchor, { label: 'Symmetry mode', alignRight: true });
  }

  /** Kiremit aşama 2 dilim 3 · Karo boyutu alt menüsü: Çizim Ayarları →
      "Karo boyutu ▸". Otomatik (cihaz hızı sessizce ölçülür) ya da sabit
      128/256/512. Seçim 36-ink-editor.js inkTileSizeSet'e yazılır;
      boyut yalnız vuruşlar arasında uygulanır (canlı vuruş bozulmaz). */
  function openTileSizeMenu(anchor) {
    const sizes = [
      { value: 'auto', label: 'Auto', title: 'Device speed is silently measured on the first stroke' },
      { value: '128', label: '128 px', title: 'Small tile — smooth hardware' },
      { value: '256', label: '256 px', title: 'Medium tile (general case)' },
      { value: '512', label: '512 px', title: 'Large tile — weak hardware' },
    ];
    let cur = 'auto';
    try { cur = typeof inkTileSizeSetting === 'function'
      ? String(inkTileSizeSetting()) : 'auto'; } catch { /* sessiz */ }
    const items = sizes.map(s => ({
      label: s.label,
      title: s.title,
      checked: s.value === cur,
      state: s.value === cur ? 'Selected' : '',
      action: () => {
        try { if (typeof inkTileSizeSet === 'function') inkTileSizeSet(s.value); }
        catch { /* sessiz */ }
      }
    }));
    /* B9 küçük yazım: menü sağda açılır (dişli kolonu hizası). */
    openMenu(items, anchor, { label: 'Tile size', alignRight: true });
  }

  function openPanelsMenu(anchor) {
    const items = DEFS.map(def => {
      const st = panelState(def.id);
      return {
        label: def.title,
        checked: !!(st && st.visible),
        state: st && st.visible ? 'On' : 'Off',
        action: () => setPanelVisible(def.id, !(st && st.visible))
      };
    });
    items.push({ sep: true });
    const panelsHidden = document.body.classList.contains('v5-panels-hidden');
    items.push({
      label: panelsHidden ? 'Show panels' : 'Hide panels',
      key: 'Tab',
      action: () => setPanelsHidden(!panelsHidden)
    });
    /* FAZ 6 B10 taşıma: Power Sliders (tuval kenarı şeritleri) anahtarı
       Ayarlar diyaloğundan ÇALINDI; tek yolu bu "Drawing Settings" menüsü.
       API: 36-ink-editor.js inkPowerSlidersEnabled/Set. Şeritler yalnızca
       çizim modunda görünür; menü zaten çizim modundan açılır. */
    items.push({ sep: true });
    let slidersOn = false;
    try {
      slidersOn = typeof inkPowerSlidersEnabled === 'function'
        ? !!inkPowerSlidersEnabled() : false;
    } catch { /* sessiz */ }
    items.push({
      label: 'Canvas edge strips',
      title: 'Size/opacity setting from the left canvas edge (drawing mode)',
      checked: slidersOn,
      state: slidersOn ? 'On' : 'Off',
      action: () => {
        try { window.inkPowerSlidersSet(!inkPowerSlidersEnabled()); } catch { /* sessiz */ }
      }
    });
    /* K13 taşıma ("bu iki ayarı çizim ayarları kısmına taşı"): "Fare
       basıncı" ve "Simetri" options bar widget'ları buraya taşındı —
       çubuk yalın ters, ayarlar menü. State yazar + options bar sync. */
    let mspOn = false;
    try { mspOn = !!inkState().mouseSpeedPressure; } catch { /* sessiz */ }
    items.push({
      label: 'Mouse pressure',
      title: 'Generate pressure from speed when drawing with a mouse that does not report pressure',
      checked: mspOn,
      state: mspOn ? 'On' : 'Off',
      action: () => {
        try {
          const st = inkState();
          st.mouseSpeedPressure = !st.mouseSpeedPressure;
          if (typeof scheduleSave === 'function') scheduleSave();
        } catch { /* sessiz */ }
      }
    });
    const SYM_MODES = [
      { value: 'off', label: 'Off' },
      { value: 'mirrorX', label: 'Mirror X' },
      { value: 'mirrorY', label: 'Mirror Y' },
      { value: 'mirrorXY', label: 'Mirror X+Y' },
      { value: 'radial4', label: 'Radial 4' },
      { value: 'radial8', label: 'Radial 8' },
    ];
    let sym = 'off';
    try { sym = String(inkState().symMode || 'off'); } catch { /* sessiz */ }
    const symCur = SYM_MODES.find(m => m.value === sym) || SYM_MODES[0];
    items.push({
      label: 'Symmetry',
      key: '▸',
      title: 'Pick a symmetry mode (strokes draw with mirrored/radial clones)',
      checked: sym !== 'off',
      state: symCur.label,
      action: () => openSymMenu(anchor)
    });
    /* Kiremit aşama 2 dilim 3: canlı önizleme karo ızgarasının boyutu.
       Üretimde ızgara varsayılan AÇIK; bu satır boyutunu seçtirir
       (Ayarlar diyaloğunda değişmediği için tek yolu burası). */
    let tileSizeLbl = 'Auto';
    try {
      const ts = typeof inkTileSizeSetting === 'function'
        ? String(inkTileSizeSetting()) : 'auto';
      tileSizeLbl = ts === 'auto' ? 'Auto' : (ts + ' px');
    } catch { /* sessiz */ }
    items.push({
      label: 'Tile size',
      key: '▸',
      title: 'Live preview tile grid size (applied between strokes)',
      state: tileSizeLbl,
      action: () => openTileSizeMenu(anchor)
    });
    items.push({
      label: 'Help · Which key does what?',
      title: 'Open/close the key guide',
      checked: !!(document.getElementById('inkKeyHelp') &&
        !document.getElementById('inkKeyHelp').hidden),
      action: () => inkKeyHelpToggle()
    });
    /* FAZ 6: Şekil aracı çubuktan taşındı — isteyen buradan açsın.
       U kısayolu aynen çalışır; satır aktif araç ışığını gösterir. */
    let shapeOn = false;
    try { shapeOn = inkState().tool === 'shape'; } catch { /* sessiz */ }
    items.push({
      label: 'Shape tool',
      key: 'U',
      title: 'Pick the shape tool (Arrow / Rectangle / Ellipse / Highlighter)',
      checked: shapeOn,
      state: shapeOn ? 'Selected' : '',
      action: () => {
        try { setTool('shape'); } catch { /* sessiz */ }
      }
    });
    items.push({ sep: true });
    items.push({
      label: 'Reset panels',
      action: () => {
        // Sıfırlama referans panosunun yerini/boyutunu değiştirebilir
        // (yüzen panel dock'a döner, genişletme kapanır, panel yeniden
        // açılır). Tahta görünümü eski pencereye göre kaydırılmış kaldığı
        // için sol pano boş görünüyordu; yeni pencereye yeniden sığdır.
        DEFS.forEach((def, index) => {
          v5.states[def.id] = defaultState(def, index);
        });
        v5.leftWide = false;
        v5.dockW = { left: null, right: null };
        v5.toolPos = null;
        saveStore();
        apply();
        // Sıfırlama minitahtadaki takılı görüşü de düzeltsin: %4 gibi
        // aşırı uzaklaşmış ya da pencerenin dışına sürüklenmiş pano
        // görüntüsü reset sonrası boş panel gibi görünüyordu.
        if (typeof dpProto !== 'undefined' && dpProto) dpProto.userTouched = false;
        if (typeof dpFitBoard === 'function') dpFitBoard();
        if (typeof dpSyncBoardLabel === 'function') dpSyncBoardLabel();
      }
    });
    openMenu(items, anchor, { label: 'Drawing Settings', alignRight: true });
  }

  /* FAZ 6 taşıma: "Help · Which key does what?" kartı. Markup
     index.html #inkKeyHelp; Ayarlar diyaloğundaki eski details bloğu
     kaldırıldı. Tek yol bu menü satırı; Esc/Kapatma/dış tık ve mode
     çıkışı söner (v5 menüsünden bağımsız popover). */
  let keyHelpInstalled = false;
  const inkKeyHelpModeKey = () => document.body.classList.contains('mode-draw') ? 'draw' : 'other';
  function inkKeyHelpInstall() {
    if (keyHelpInstalled) return;
    keyHelpInstalled = true;
    const panel = document.getElementById('inkKeyHelp');
    if (!panel) return;
    const close = panel.querySelector('#inkKeyHelpClose');
    if (close) close.addEventListener('click', () => { panel.hidden = true; });
    panel.addEventListener('pointerdown', event => {
      if (event.target === panel) panel.hidden = true;
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) panel.hidden = true;
    });
    // Çizim modundan çıkınca kart söner (iki-program kuralı). Yalnız
    // GERÇEK mod değişiminde: gövdeye eklenen ilgisiz sınıflar (ör.
    // studio-panel-open) kartı kapatmamalı — Ayarlar > Kısayollar'dan
    // açılan rehber, ayar paneli açıkken hemen kapanıyordu.
    let keyHelpMode = inkKeyHelpModeKey();
    new MutationObserver(() => {
      const now = inkKeyHelpModeKey();
      if (now === keyHelpMode) return;
      keyHelpMode = now;
      if (!panel.hidden) panel.hidden = true;
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    /* Tur 4b.5: kbd harfleri keymap'ten gelir (tek doğruluk kaynağı).
       Statik harfler yalnızca keymap yokken fallback'tir; yeniden atama
       yapıldığında açık kart da tazelenir. */
    inkKeyHelpSyncKeys();
    try { window.addEventListener('tailref-keymap-change', inkKeyHelpSyncKeys); } catch { /* sessiz */ }
  }

  function inkKeyHelpSyncKeys() {
    const km = window.tailrefKeymap;
    if (!km) return;
    const panelEl = document.getElementById('inkKeyHelp');
    if (!panelEl) return;
    const label = typeof inkWorkspaceShortcutLabel === 'function'
      ? inkWorkspaceShortcutLabel : (s => s);
    try {
      panelEl.querySelectorAll('[data-km-help]').forEach(kbd => {
        const v = km.get(kbd.dataset.kmHelp);
        if (v) kbd.textContent = label(v);
      });
    } catch { /* sessiz */ }
  }

  function inkKeyHelpToggle() {
    inkKeyHelpInstall();
    const panel = document.getElementById('inkKeyHelp');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      /* Tur 4b.5: kart her açılışta keymap'ten tazelenir. */
      try { inkKeyHelpSyncKeys(); } catch { /* sessiz */ }
      /* Konum: Ayarlar paneli açıksa kart onun YANINA (soluna, yer yoksa
         sağına) yerleşir; böylece ayar penceresiyle üst üste binmez ve
         ikisi birlikte okunabilir. Ayarlar kapalıysa eski çapa (dişli
         altı) korunur. Dar ekranda görünüm ortasına alınır. */
      const card = panel.querySelector('.kkCard');
      if (card) {
        const margin = 12;
        const w = card.offsetWidth || 430;
        const h = card.offsetHeight || 340;
        card.style.left = '';
        card.style.top = '';
        const settingsEl = document.getElementById('settings');
        const sr = settingsEl && !settingsEl.hidden
          ? settingsEl.getBoundingClientRect() : null;
        let left = 0, top = 0;
        if (sr && sr.width > 0) {
          top = clamp(Math.round(sr.top), margin,
            Math.max(margin, innerHeight - h - margin));
          if (sr.left - w - margin >= margin) {
            left = Math.round(sr.left - w - margin);
          } else if (innerWidth - sr.right - w - margin >= margin) {
            left = Math.round(sr.right + margin);
          } else {
            left = clamp(Math.round((innerWidth - w) / 2), margin,
              Math.max(margin, innerWidth - w - margin));
            top = clamp(Math.round((innerHeight - h) / 2), margin,
              Math.max(margin, innerHeight - h - margin));
          }
        } else {
          const grip = document.querySelector('#v5Toolbar .v5-grip');
          const gr = grip ? grip.getBoundingClientRect()
            : { left: 12, bottom: 60 };
          left = clamp(Math.round(gr.left), 8, Math.max(8, innerWidth - w - 8));
          top = Math.round(gr.bottom + 8);
          if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
        }
        card.style.left = left + 'px';
        card.style.top = top + 'px';
      }
    }
  }

  /* =========================================================
     PANEL DURUMU · görünürlük / katlama
     ========================================================= */
  function setPanelVisible(id, visible) {
    const st = panelState(id);
    if (!st) return;
    runWithRefFit(() => {
      st.visible = !!visible;
      saveStore();
      apply();
    });
  }

  function toggleCollapse(id) {
    const st = panelState(id);
    if (!st) return;
    runWithRefFit(() => {
      st.collapsed = !st.collapsed;
      saveStore();
      apply();
    });
  }

  /* Referans panosunun alanını değiştiren yerleşim işlemlerinden sonra
     tahtayı yeni pencerenin merkezine taşır. Ölçek korunur; böylece panel
     taşındı diye kullanıcının yakınlaştırması/gezintisi sıfırlanmaz. */
  function runWithRefFit(fn) {
    const before = refStageRect();
    if (before) v5.lastRefRect = before;
    fn();
    const after = refStageRect();
    if (after) {
      translateBoardForAperture(before || v5.lastRefRect, after);
      v5.lastRefRect = after;
      requestAnimationFrame(() => {
        if (!isDraw()) return;
        syncRefClip();
      });
    }
    return !!after;
  }

  /** Canlı boyutlandırma sırasında referans penceresinin merkezini izler;
      pencere büyürken/küçülürken tahta içerikte ortada kalsın. */
  function followRefStage(before) {
    const after = refStageRect();
    if (before && after) {
      translateBoardForAperture(before, after);
      v5.lastRefRect = after;
    }
    syncRefClip();
    return after;
  }

  /* =========================================================
     PANEL YERLEŞİMİ
     ========================================================= */
  function applyBreakpoint() {
    const w = innerWidth;
    document.body.classList.toggle('v5-w-mid', w >= 900 && w < 1200);
    document.body.classList.toggle('v5-w-compact', w >= 700 && w < 900);
    document.body.classList.toggle('v5-w-narrow', w < 700);
  }

  function columnPanels(column) {
    return DEFS
      .filter(def => v5.states[def.id] &&
        (v5.states[def.id].column || def.column) === column &&
        v5.states[def.id].visible)
      .sort((a, b) => (v5.states[a.id].order || 0) - (v5.states[b.id].order || 0));
  }

  /* Dock genişliklerini uygular. Kayıtlı genişlik yoksa CSS varsayılanı
     (--v5-left-w / --v5-right-w) geçerli olur. */
  function applyDockWidths() {
    const leftDock = $('v5LeftDock');
    const rightDock = $('v5RightDock');
    // Kayıtlı genişlik pencereye göre sınırlanır; bozuk değer CSS'e düşer.
    const maxW = Math.max(180, Math.min(560, Math.round(innerWidth * 0.5)));
    const fitW = value => (Number.isFinite(value) ? Math.round(clamp(value, 180, maxW)) : null);
    const leftW = fitW(v5.dockW.left);
    const rightW = fitW(v5.dockW.right);
    if (leftDock) {
      leftDock.style.width = leftW != null
        ? leftW + 'px'
        : (v5.leftWide ? '360px' : '');
    }
    if (rightDock) {
      rightDock.style.width = rightW != null ? rightW + 'px' : '';
    }
    positionDockResizers();
  }

  /* Tutamakları dock'ların iç kenarına yerleştirir. */
  function positionDockResizers() {
    const narrow = document.body.classList.contains('v5-w-narrow');
    for (const side of ['left', 'right']) {
      const handle = v5.dockResizers && v5.dockResizers[side];
      const dock = $(side === 'left' ? 'v5LeftDock' : 'v5RightDock');
      if (!handle || !dock) continue;
      // Dock'ta görünür panel yoksa (hepsi yüzdürülmüş/gizlenmiş) kenar
      // tutamacı eski yerinde kalmasın; tamamen gizle.
      const hasPanel = [...dock.children].some(child =>
        child.classList && child.classList.contains('v5-panel') && child.style.display !== 'none');
      if (narrow || !hasPanel) {
        handle.style.display = 'none';
        continue;
      }
      handle.style.display = '';
      // Kenarın tamamı tutulabilir olsun: tutamak dock yüksekliği kadar.
      const r = dock.getBoundingClientRect();
      // Sol dock'un kaydırma çubuğu iç kenarda durur; tutamak onu
      // kapatmasın diye kenarın hemen dışında başlar.
      const x = side === 'left' ? r.right : r.left - 6;
      handle.style.left = Math.round(x) + 'px';
      handle.style.top = Math.round(r.top) + 'px';
      handle.style.height = Math.round(r.height) + 'px';
    }
  }

  function bindDockResize(handle, side) {
    if (!handle) return;
    const minW = 180;
    const maxW = () => Math.max(minW, Math.min(560, Math.round(innerWidth * 0.5)));
    const dockId = side === 'left' ? 'v5LeftDock' : 'v5RightDock';

    const setWidth = value => {
      v5.dockW[side] = Number.isFinite(value)
        ? Math.round(clamp(value, minW, maxW()))
        : null;
      applyDockWidths();
      syncRefClip();
    };

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const dock = $(dockId);
      if (!dock) return;
      const startX = event.clientX;
      const startW = dock.getBoundingClientRect().width;
      let next = startW;
      v5.panelBusy = 'dock-' + side;
      document.body.classList.add('v5-panel-busy', 'v5-dock-resizing');
      // Boyutlandırma sırasında tahta yeniden sığdırılmasın; yalnızca
      // görünen alan büyüsün/küçülsün (fotoğraflar yerinde kalsın).
      if (typeof dpProto !== 'undefined' && dpProto) dpProto.userTouched = true;

      const move = ev => {
        const before = refStageRect();
        const dx = ev.clientX - startX;
        next = clamp(side === 'left' ? startW + dx : startW - dx, minW, maxW());
        setWidth(next);
        followRefStage(before);
      };

      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        document.body.classList.remove('v5-panel-busy', 'v5-dock-resizing');
        v5.panelBusy = '';
        saveStore();
        apply();
        syncRefClip();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });

    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      setWidth(null);
      saveStore();
      apply();
    });

    handle.addEventListener('keydown', event => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const dock = $(dockId);
      if (!dock) return;
      const current = dock.getBoundingClientRect().width;
      if (event.key === 'Home') {
        setWidth(null);
      } else {
        const grow = side === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
        const step = event.shiftKey ? 24 : 8;
        setWidth(clamp(current + (grow ? step : -step), minW, maxW()));
      }
      saveStore();
      apply();
    });
  }

  function layoutPanels() {
    const leftDock = $('v5LeftDock');
    const rightDock = $('v5RightDock');
    const floatLayer = $('v5FloatLayer');
    if (!leftDock || !rightDock || !floatLayer) return;

    const narrow = document.body.classList.contains('v5-w-narrow');
    if (narrow) {
      // Tek panel: seçili panel float katmanında tam ekran.
      for (const def of DEFS) {
        const panel = v5.panels[def.id];
        const st = v5.states[def.id];
        if (!panel || !st) continue;
        panel.classList.remove('is-floating');
        panel.classList.remove('is-narrow-active');
        panel.style.display = st.visible && v5.narrowPanel === def.id ? 'flex' : 'none';
        if (st.visible && v5.narrowPanel === def.id) {
          panel.classList.add('is-narrow-active');
          if (panel.parentElement !== floatLayer) floatLayer.appendChild(panel);
        }
      }
      applyDockWidths();
      renderTabs();
      return;
    }

    for (const def of DEFS) {
      const panel = v5.panels[def.id];
      const st = v5.states[def.id];
      if (!panel || !st) continue;
      panel.classList.remove('is-narrow-active');
      panel.classList.toggle('is-collapsed', !!st.collapsed);

      if (!st.visible) {
        panel.style.display = 'none';
        continue;
      }
      panel.style.display = 'flex';

      if (st.docked) {
        panel.classList.remove('is-floating');
        const hasDockedHeight = Number.isFinite(st.dockedHeight);
        panel.classList.toggle('has-docked-height', hasDockedHeight);
        panel.style.left = '';
        panel.style.top = '';
        panel.style.width = '';
        panel.style.height = hasDockedHeight
          ? Math.round(st.dockedHeight) + 'px' : '';
        panel.style.minHeight = hasDockedHeight ? '0px' : '';
        // Sol dock'taki referans panosu normalde flex: 1 1 auto ile sütunu
        // doldurur. Sabit yükseklik verildiğinde bu büyüme, verilen değeri
        // yok sayıp dikey boyutlandırmayı etkisiz bırakıyordu.
        panel.style.flex = hasDockedHeight ? '0 0 auto' : '';
        const dock = (st.column || def.column) === 'left' ? leftDock : rightDock;
        if (panel.parentElement !== dock) dock.appendChild(panel);
      } else {
        panel.classList.add('is-floating');
        panel.classList.remove('has-docked-height');
        if (panel.parentElement !== floatLayer) floatLayer.appendChild(panel);
        const f = st.floating || {};
        const width = Number.isFinite(f.w) ? f.w : (def.column === 'left' ? 280 : 340);
        const height = Number.isFinite(f.h) ? f.h : null;
        const column = st.column || def.column;
        let x = Number.isFinite(f.x) ? f.x : (column === 'left' ? 20 : innerWidth - width - 20);
        let y = Number.isFinite(f.y) ? f.y : 80;
        x = clamp(x, 8, Math.max(8, innerWidth - Math.min(width, 120)));
        y = clamp(y, 8, Math.max(8, innerHeight - 48));
        panel.style.left = Math.round(x) + 'px';
        panel.style.top = Math.round(y) + 'px';
        panel.style.width = Math.round(width) + 'px';
        panel.style.height = height ? Math.round(height) + 'px' : '';
      }
    }

    // Sıralama: dock içindeki panelleri order'a göre yeniden diz.
    // Yalnızca sıra gerçekten değiştiyse DOM'a dokun; her apply'da
    // appendChild paneli taşıyıp tıklamaları ve kaydırmayı bozuyordu.
    for (const column of ['left', 'right']) {
      const dock = column === 'left' ? leftDock : rightDock;
      const desired = columnPanels(column)
        .map(def => v5.panels[def.id])
        .filter(panel => panel && panel.parentElement === dock);
      const current = [...dock.children].filter(child => child.classList && child.classList.contains('v5-panel'));
      const same = desired.length === current.length && desired.every((panel, i) => panel === current[i]);
      if (!same) {
        for (const panel of desired) dock.appendChild(panel);
      }
    }

    applyDockWidths();

    renderTabs();
  }

  function renderTabs() {
    const tabs = v5.tabs;
    if (!tabs) return;
    const narrow = document.body.classList.contains('v5-w-narrow');
    tabs.style.display = narrow ? 'flex' : 'none';
    if (!narrow) {
      tabs.replaceChildren();
      return;
    }
    tabs.replaceChildren();
    for (const def of DEFS) {
      const st = v5.states[def.id];
      if (!st || !st.visible) continue;
      const b = el('button', null, def.title.replace(' Kontrolleri', '').replace(' panosu', ''));
      b.type = 'button';
      b.classList.toggle('is-active', v5.narrowPanel === def.id);
      b.addEventListener('click', () => {
        v5.narrowPanel = def.id;
        apply();
      });
      tabs.appendChild(b);
    }
  }

  /* =========================================================
     PANEL SÜRÜKLEME
     ========================================================= */
  function dockColumnAt(x, y) {
    if (document.body.classList.contains('v5-w-narrow')) return null;
    for (const column of ['left', 'right']) {
      const dock = $(column === 'left' ? 'v5LeftDock' : 'v5RightDock');
      if (!dock || dock.offsetWidth < 4) continue;
      const rect = dock.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { column, rect, dist: 0 };
      }
    }
    // Outside the dock itself, permit snapping when released near a screen edge.
    const edgeZone = Math.max(64, Math.min(110, Math.round(innerWidth * 0.1)));
    const nearLeft = x <= edgeZone;
    const nearRight = x >= innerWidth - edgeZone;
    if (!nearLeft && !nearRight) return null;
    const el = nearLeft ? $('v5LeftDock') : $('v5RightDock');
    if (!el || el.offsetWidth < 4) return null;
    const r = el.getBoundingClientRect();
    if (y < r.top - 8 || y > r.bottom + 8) return null;
    return {
      column: nearLeft ? 'left' : 'right',
      rect: r,
      dist: nearLeft ? x - r.left : r.right - x
    };
  }

  function insertionFor(column, y, dragId) {
    const list = columnPanels(column).filter(def => def.id !== dragId);
    const panels = list.map(def => v5.panels[def.id]).filter(p => p && p.style.display !== 'none');
    let index = panels.length;
    let lineY = 0;
    for (let i = 0; i < panels.length; i++) {
      const r = panels[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        lineY = r.top;
        break;
      }
      lineY = r.bottom;
    }
    return { index, lineY, panels };
  }

  function showInsertLine(column, y, dragId) {
    const line = v5.insertLine;
    const dock = column === 'left' ? $('v5LeftDock') : $('v5RightDock');
    if (!line || !dock) return;
    const rect = dock.getBoundingClientRect();
    const info = insertionFor(column, y, dragId);
    line.style.left = Math.round(rect.left) + 'px';
    line.style.width = Math.round(rect.width) + 'px';
    line.style.top = Math.round(info.lineY) + 'px';
    line.hidden = false;
  }

  function hideInsertLine() {
    if (v5.insertLine) v5.insertLine.hidden = true;
  }

  function dockPanelAt(id, column, index) {
    const st = panelState(id);
    if (!st) return;
    // Panel başka sütuna geçerken eski sütunda verilen yüksekliği taşıma:
    // sağda uzunca boyutlandırılmış bir panel sola geçince referans panosunu
    // 240 px'e sıkıştırıp sütunu taşırıyordu.
    if (st.column && st.column !== column) st.dockedHeight = null;
    // Sol sütuna yeni bir panel gelirken referans panosunun elle verilmiş
    // yüksekliğini bırak: aksi halde sabit yükseklik yüzünden küçülemiyor,
    // yeni panel ekranın altına itiliyordu.
    if (column === 'left' && id !== 'reference') {
      const ref = panelState('reference');
      if (ref && (ref.column || 'left') === 'left') ref.dockedHeight = null;
    }
    st.docked = true;
    const list = DEFS
      .filter(def => def.id !== id && v5.states[def.id] &&
        (v5.states[def.id].column || def.column) === column &&
        v5.states[def.id].visible)
      .sort((a, b) => (v5.states[a.id].order || 0) - (v5.states[b.id].order || 0))
      .map(def => def.id);
    const slot = clamp(index, 0, list.length);
    list.splice(slot, 0, id);
    st.column = column;
    list.forEach((pid, i) => {
      const s = panelState(pid);
      if (s) s.order = i;
    });
    for (const other of ['left', 'right']) {
      if (other === column) continue;
      columnPanels(other).forEach((def, i) => {
        const s = panelState(def.id);
        if (s) s.order = i;
      });
    }
    saveStore();
    // Referans panosu dışındaki bir panel sol sütuna taşındığında referans
    // panosu küçülür (CSS flex). Tahta görünümü eski pencereye göre
    // kaydırılmış kalmasın: yeni pencereye sığdır. Referans panosunun
    // kendisi taşınırken mevcut kaydırma telafisi korunur.
    if (id === 'reference') {
      apply();
    } else {
      runWithRefFit(apply);
    }
    revealDockedPanel(id);
  }

  /* Dock'a bırakılan panelin BAŞLIĞI görünür kalsın: sütun taşıyorsa
     sadece o kadar kaydır. Eski hâl panelin TAMAMINI görünüme sokmaya
     çalışıyordu — uzun panelde dock ~300px sıçrayıp DİĞER panelleri
     ekranın üstünden fırlatıyordu (kullanıcı: "deli deli hareketler").
     Başlık görünürken hiç kaydırmayız; gövde dock'un kendi kaydırma
     çubuğunda kalır. */
  function revealDockedPanel(id) {
    const panel = v5.panels[id];
    const dock = panel ? panel.parentElement : null;
    if (!panel || !dock || (dock.id !== 'v5LeftDock' && dock.id !== 'v5RightDock')) return;
    requestAnimationFrame(() => {
      const dr = dock.getBoundingClientRect();
      if (dr.height < 4) return;
      const head = panel.querySelector('.v5-panel-head');
      const hr = (head || panel).getBoundingClientRect();
      if (hr.top < dr.top) {
        dock.scrollTop -= Math.ceil(dr.top - hr.top) + 8;
      } else if (hr.bottom > dr.bottom) {
        dock.scrollTop += Math.ceil(hr.bottom - dr.bottom) + 8;
      }
    });
  }

  function bindPanelHeader(panel, def, head) {
    head.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('button, input, select, a, .v5-head-btn, .v5-head-extra')) return;
      event.preventDefault();
      startPanelDrag(panel, def, head, event);
    });

    head.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button')) return;
      event.preventDefault();
      toggleCollapse(def.id);
    });
  }

  function startPanelDrag(panel, def, head, event) {
    const st = panelState(def.id);
    if (!st) return;
    /* Dar modda paneller tam ekran sekmedir — başlıktan sürükleme
       dock üyeliğini sessizce bozuyordu (st.docked=false + tam genişlik
       yüzen panel). Pencere genişleyince dev yüzen panel kalıyordu. */
    if (document.body.classList.contains('v5-w-narrow')) return;
    /* Pointer kilidi: kaleminle sürüklerken tablete değen avuç ikinci
       pointer yollar — denetim yoksa panel ikinci pointer'ın koordinatına
       SIÇIYORDU. Yalnız basışı başlatan pointer dinlenir. */
    const pid = event.pointerId;
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    let moved = false;
    let floating = false;
    let detaching = false;
    const isRefPanel = def.id === 'reference';
    let lastLeft = rect.left;
    let lastTop = rect.top;
    let targetColumn = '';
    let targetIndex = 0;

    try { head.setPointerCapture(event.pointerId); } catch { /* sessiz */ }

    // Sürükleme boyunca dışarıdan gelen apply() çağrıları tahtayı yeniden
    // "sığdırmasın" (fotoğraflar yer değiştirmesin).
    v5.panelBusy = def.id;
    document.body.classList.add('v5-panel-busy');
    if (def.id === 'reference' && typeof dpProto !== 'undefined' && dpProto) {
      dpProto.userTouched = true;
    }

    const ensureFloating = (left, top) => {
      if (floating) return;
      floating = true;
      st.docked = false;
      st.floating = {
        x: left,
        y: top,
        w: rect.width,
        h: rect.height
      };
      panel.classList.add('is-floating', 'is-dragging');
      const floatLayer = $('v5FloatLayer');
      if (floatLayer && panel.parentElement !== floatLayer) floatLayer.appendChild(panel);
      panel.style.left = Math.round(left) + 'px';
      panel.style.top = Math.round(top) + 'px';
      panel.style.width = Math.round(rect.width) + 'px';
      // Yükseklik korunur: panel dock'tan ayrılırken küçülüp zıplamasın.
      panel.style.height = Math.round(rect.height) + 'px';
      // Panel dock'tan çıktıysa ve dock boş kaldıysa kenar tutamacı hemen
      // gizlensin (bırakınca değil, sürükleme sırasında da).
      positionDockResizers();
      syncRefClip();
    };

    function cleanupDrag() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      hideInsertLine();
      panel.classList.remove('is-dragging');
      document.body.classList.remove('v5-panel-busy');
      v5.panelBusy = '';
      try { head.releasePointerCapture(pid); } catch { /* sessiz */ }
    }

    const move = ev => {
      if (ev.pointerId !== pid) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) moved = true;

      const width = panel.getBoundingClientRect().width || rect.width;
      let x = ev.clientX - grabX;
      let y = ev.clientY - grabY;
      x = clamp(x, 8, Math.max(8, innerWidth - Math.min(width, 120)));
      y = clamp(y, 8, Math.max(8, innerHeight - 48));
      const nextLeft = Math.round(x);
      const nextTop = Math.round(y);
      ensureFloating(nextLeft, nextTop);

      /* Pencere kenarını yeterince geçtiyse panel ayrı pencereye taşınır
         (ana panellerdeki sürükle-bırak kapısıyla aynı eşik). Böylece dört
         çizim paneli de düğmeye ek olarak doğrudan dışarı sürüklenebilir. */
      if (!detaching && (ev.clientX < -60 || ev.clientY < -60
          || ev.clientX > innerWidth + 60 || ev.clientY > innerHeight + 60)) {
        detaching = true;
        st.docked = false;
        st.floating = {
          x: ev.clientX - grabX,
          y: ev.clientY - grabY,
          w: rect.width,
          h: rect.height
        };
        try { saveStore(); } catch { /* sessiz */ }
        const place = {
          x: Math.round(window.screenX + ev.clientX - grabX),
          y: Math.round(window.screenY + ev.clientY - grabY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        cleanupDrag();
        if (typeof window.tailrefDetachPanel === 'function') {
          void window.tailrefDetachPanel(panel, { placement: place });
        }
        return;
      }

      const col = dockColumnAt(ev.clientX, ev.clientY);
      if (col) {
        targetColumn = col.column;
        const info = insertionFor(col.column, ev.clientY, def.id);
        targetIndex = info.index;
        showInsertLine(col.column, ev.clientY, def.id);
      } else {
        targetColumn = '';
        hideInsertLine();
      }

      // Yalnızca referans paneli: görüntü pencere içinde sabit kalsın.
      // Sağdaki panellerin hareketi tahtayı kaydırmaz.
      if (isRefPanel) {
        panBoardWithPanel(nextLeft - lastLeft, nextTop - lastTop);
      }
      lastLeft = nextLeft;
      lastTop = nextTop;
      panel.style.left = nextLeft + 'px';
      panel.style.top = nextTop + 'px';
      st.floating.x = x;
      st.floating.y = y;
      syncRefClip();
    };

    const end = (ev = null) => {
      if (ev && ev.pointerId !== undefined && ev.pointerId !== pid) return;
      cleanupDrag();
      if (detaching) return;

      if (!moved) {
        // Başlığa tıklamak paneli katlamasın; katlama yalnızca başlıktaki
        // chevron düğmesiyle yapılır. Aksi halde sürüklemeye çalışırken
        // panel "kapanmış" gibi görünüyordu.
        return;
      }

      if (targetColumn) {
        const stageBefore = isRefPanel ? $('v5RefStage') : null;
        const beforeRect = stageBefore ? stageBefore.getBoundingClientRect() : null;
        dockPanelAt(def.id, targetColumn, targetIndex);
        // Referans paneli dock'a oturduysa tahtayı aynı kadar kaydır;
        // görüntü yeni pencerenin içinde aynı yerde kalsın.
        const afterRect = stageBefore ? stageBefore.getBoundingClientRect() : null;
        if (beforeRect && afterRect) {
          panBoardWithPanel(afterRect.left - beforeRect.left, afterRect.top - beforeRect.top);
        }
      } else {
        st.docked = false;
        saveStore();
        apply();
      }
      // Bırakıldığı karede kırpma dikdörtgeni de yeni konuma otursun.
      syncRefClip();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    /* Pencere odağı kaybolursa pointerup kaçar → panel imlece yapışık
       kalıyordu. Blur sürüklemeyi temizce bitirir (işlenen konum korunur). */
    window.addEventListener('blur', end);
  }

  /* Yüzen panel her kenarından ve köşesinden boyutlandırılabilir.
     Görünür tutamak/çizgi yok; kenara gelince imleç değişir. */
  function bindPanelResize(panel, def) {
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const handle = el('span', 'v5-resize-edge v5-resize-' + dir);
      handle.dataset.dir = dir;
      handle.title = 'Resize';
      panel.appendChild(handle);
      bindPanelResizeHandle(panel, def, handle, dir);
    }
  }

  function bindPanelResizeHandle(panel, def, handle, dir) {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const st = panelState(def.id);
      if (!st) return;
      /* Dar modda boyutlandırma yok: tam ekran sekmelerin kenarı
         dock/yüzen durumunu bozmadan dokunulmaz kalır. */
      if (document.body.classList.contains('v5-w-narrow')) return;
      if (st.docked) {
        if (dir === 's' && !st.collapsed) startDockPanelResize(panel, def, st, event);
        return;
      }
      const pid = event.pointerId; /* pointer kilidi — avuç ikinci pointer'ı paneli kaçırmıyor */
      const rect = panel.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;
      const startW = rect.width;
      const startH = rect.height;
      // Alt sınır mevcut boyutu aşmasın: dock'tan 180px genişlikte ayrılan
      // bir panel ilk boyutlandırmada 240px'e zıplamasın.
      const minW = Math.min(240, startW);
      const minH = Math.min(def.id === 'reference' ? 240 : 180, startH);
      const hasN = dir.includes('n');
      const hasS = dir.includes('s');
      const hasE = dir.includes('e');
      const hasW = dir.includes('w');
      const rightEdge = startLeft + startW;
      const bottomEdge = startTop + startH;
      // Panel zaten ekran dışına taşıyorsa dışa doğru çekerken aniden
      // küçülmesin; mevcut boyut üst sınırın altında kalıyorsa korunur.
      const maxW = Math.max(minW, startW, innerWidth - startLeft - 8);
      const maxH = Math.max(minH, startH, innerHeight - startTop - 8);
      const minX = Math.min(8, startLeft);
      const minY = Math.min(8, startTop);
      let next = { x: startLeft, y: startTop, w: startW, h: startH };

      v5.panelBusy = def.id;
      document.body.classList.add('v5-panel-busy');
      panel.classList.add('is-resizing');
      if (def.id === 'reference' && typeof dpProto !== 'undefined' && dpProto) {
        // Boyutlandırma sonunda otomatik sığdırma tahtayı yeniden
        // ölçeklemesin; pencere büyüyünce sadece daha fazla alan görünsün.
        dpProto.userTouched = true;
      }

      const move = ev => {
        if (ev.pointerId !== pid) return;
        const before = def.id === 'reference' ? refStageRect() : null;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let x = startLeft;
        let y = startTop;
        let w = startW;
        let h = startH;

        if (hasE) w = clamp(startW + dx, minW, maxW);
        if (hasW) {
          x = clamp(startLeft + dx, minX, Math.max(minX, rightEdge - minW));
          w = rightEdge - x;
        }
        if (hasS) h = clamp(startH + dy, minH, maxH);
        if (hasN) {
          y = clamp(startTop + dy, minY, Math.max(minY, bottomEdge - minH));
          h = bottomEdge - y;
        }

        next = { x, y, w, h };
        panel.style.left = Math.round(x) + 'px';
        panel.style.top = Math.round(y) + 'px';
        panel.style.width = Math.round(w) + 'px';
        panel.style.height = Math.round(h) + 'px';
        if (before) followRefStage(before);
        else syncRefClip();
      };

      const end = (ev = null) => {
        if (ev && ev.pointerId !== undefined && ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('blur', end);
        panel.classList.remove('is-resizing');
        document.body.classList.remove('v5-panel-busy');
        v5.panelBusy = '';
        st.floating = {
          ...(st.floating || {}),
          x: Math.round(next.x),
          y: Math.round(next.y),
          w: Math.round(next.w),
          h: Math.round(next.h)
        };
        saveStore();
        apply();
        syncRefClip();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('blur', end); /* odak kaçarsa temiz bitiş */
    });
  }

  function startDockPanelResize(panel, def, st, event) {
    const pid = event.pointerId; /* pointer kilidi */
    const rect = panel.getBoundingClientRect();
    const startY = event.clientY;
    const startH = rect.height;
    /* Renk paneli çark + hex satırını tam göstersin: 180 px'e çekilince
       çarkın üst yarısı kesiliyordu (kullanıcı isteğiyle küçültülebilir
       ama içerik kırpılmasın). */
    const minH = def.id === 'color' ? 320 : (def.id === 'reference' ? 180 : 120);
    const maxH = Math.max(minH, innerHeight - 96);
    let height = startH;
    let moved = false;

    v5.panelBusy = def.id;
    document.body.classList.add('v5-panel-busy');
    panel.classList.add('is-vertical-resizing', 'has-docked-height');
    // Sürükleme boyunca da flex büyümesini kapat; yoksa referans panosu
    // fare hareketine rağmen eski yüksekliğinde kalıyordu.
    panel.style.flex = '0 0 auto';
    panel.style.height = Math.round(startH) + 'px';
    panel.style.minHeight = '0px';

    const move = ev => {
      if (ev.pointerId !== pid) return;
      if (Math.abs(ev.clientY - startY) > 1) moved = true;
      const before = refStageRect();
      height = clamp(startH + ev.clientY - startY, minH, maxH);
      panel.style.height = Math.round(height) + 'px';
      panel.style.minHeight = '0px';
      followRefStage(before);
    };
    const end = (ev = null) => {
      if (ev && ev.pointerId !== undefined && ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      panel.classList.remove('is-vertical-resizing');
      document.body.classList.remove('v5-panel-busy');
      v5.panelBusy = '';
      // Sadece tıklama: paneli sabit yüksekliğe kilitleme.
      if (!moved) {
        runWithRefFit(apply);
        return;
      }
      st.dockedHeight = Math.round(height);
      saveStore();
      runWithRefFit(apply);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end); /* odak kaçarsa temiz bitiş */
  }

  /* =========================================================
     ARAÇ ÇUBUĞU SÜRÜKLEME
     ========================================================= */
  function bindToolbarDrag(bar) {
    const grip = bar.querySelector('.v5-grip');
    if (!grip || grip.__v5drag) return;
    grip.__v5drag = true;

    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pid = event.pointerId; /* pointer kilidi — avuç ikinci pointer'ı çubuğu kaçırmıyor */
      const rect = bar.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const move = ev => {
        if (ev.pointerId !== pid) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) {
          moved = true;
          bar.style.transform = 'none';
          bar.style.left = Math.round(rect.left) + 'px';
          bar.style.top = Math.round(rect.top) + 'px';
        }
        const w = bar.offsetWidth;
        const x = clamp(rect.left + dx, 8, Math.max(8, innerWidth - w - 8));
        const y = clamp(rect.top + dy, 8, Math.max(8, innerHeight - 56));
        bar.style.left = Math.round(x) + 'px';
        bar.style.top = Math.round(y) + 'px';
        syncOptionsBarPosition();
      };

      const end = (ev = null, cancelled = false) => {
        if (ev && ev.pointerId !== undefined && ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('blur', onBlur);
        if (!moved) {
          /* Tık: Ayarlar penceresini doğrudan ÇİZİM sayfasında açar
             (60-settings-hub.js settingsHubOpenDrawing). Blur'dan gelen
             iptal tık SAYILMAZ — pencere kendi kendine açılmasın. */
          if (cancelled) return;
          try { grip.blur(); } catch { /* sessiz */ }
          if (typeof window.settingsHubOpenDrawing === 'function') window.settingsHubOpenDrawing();
          return;
        }
        v5.toolPos = {
          left: Math.round(parseFloat(bar.style.left) || 0),
          top: Math.round(parseFloat(bar.style.top) || 0)
        };
        saveStore();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      const onBlur = () => end(null, true);
      window.addEventListener('blur', onBlur);
    });
  }

  /* FAZ 6 B9: options bar sürükleme — grip: 4px eşik sonrası dock
     bırakılır (optPinned), konum optPos'a yazılır; çift tık geri kenetler. */
  function bindOptionsBarDrag(bar) {
    const grip = bar && bar.querySelector('.v5-opt-grip');
    if (!grip || grip.__v5drag) return;
    grip.__v5drag = true;

    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pid = event.pointerId; /* pointer kilidi — avuç ikinci pointer'ı barı kaçırmıyor */
      const rect = bar.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const move = ev => {
        if (ev.pointerId !== pid) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) {
          moved = true;
          v5.optPinned = true;
          bar.classList.add('v5-opt-floating');
        }
        const w = bar.offsetWidth || 360;
        const h = bar.offsetHeight || 44;
        v5.optPos = {
          left: Math.round(clamp(rect.left + dx, 8, Math.max(8, innerWidth - w - 8))),
          top: Math.round(clamp(rect.top + dy, 8, Math.max(8, innerHeight - h - 8)))
        };
        bar.style.transform = 'none';
        bar.style.left = v5.optPos.left + 'px';
        bar.style.top = v5.optPos.top + 'px';
      };

      const end = (ev = null) => {
        if (ev && ev.pointerId !== undefined && ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('blur', end);
        if (moved) { applyOptionsBarPosition(); saveStore(); }
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('blur', end); /* odak kaçarsa temiz bitiş */
    });

    grip.addEventListener('dblclick', () => {
      if (!v5.optPinned) return;
      v5.optPinned = false;
      v5.optPos = null;
      bar.classList.remove('v5-opt-floating');
      syncOptionsBarPosition();
      saveStore();
    });
  }

  function applyToolbarPosition() {
    const bar = v5.toolbar;
    if (!bar) return;
    if (v5.toolPos) {
      const w = bar.offsetWidth || 420;
      bar.style.transform = 'none';
      bar.style.left = Math.round(clamp(v5.toolPos.left, 8, Math.max(8, innerWidth - w - 8))) + 'px';
      bar.style.top = Math.round(clamp(v5.toolPos.top, 8, Math.max(8, innerHeight - 56))) + 'px';
    } else {
      bar.style.transform = '';
      bar.style.left = '';
      bar.style.top = '';
    }
    syncOptionsBarPosition();
  }

  /* Dar ekranda ortadaki çubuk ile sağ üstteki mod düğmesi çakışırsa
     çubuğu mod düğmesinin altına indir. */
  function avoidModeBarOverlap() {
    const bar = v5.toolbar;
    const mode = $('appModeBar');
    if (!bar || !mode) return;
    if (v5.toolPos) return;
    bar.style.top = '';
    document.body.classList.remove('v5-toolbar-lowered');
    if (!document.body.classList.contains('v5-w-narrow')) return;
    const a = bar.getBoundingClientRect();
    const b = mode.getBoundingClientRect();
    const clash = a.right + 8 > b.left && a.left < b.right + 8 &&
                  a.top < b.bottom + 8 && a.bottom + 8 > b.top;
    if (clash) {
      bar.style.top = Math.round(b.bottom + 8) + 'px';
      document.body.classList.add('v5-toolbar-lowered');
    }
    syncOptionsBarPosition();
  }

  /* =========================================================
     MOTOR SARMA / EŞİTLEME
     ========================================================= */
  function installWrappers() {
    const wrap = (name, after, flag) => {
      const base = window[name];
      if (typeof base !== 'function') return;
      if (base[flag]) return;
      const wrapped = function () {
        const result = base.apply(this, arguments);
        try { after.apply(this, arguments); } catch { /* sessiz */ }
        return result;
      };
      wrapped[flag] = true;
      window[name] = wrapped;
    };

    // Katman adları silinen numarayı yeniden kullanmaz; sayaç kalıcıdır.
    if (typeof window.inkDocAddLayer === 'function' && !window.inkDocAddLayer.__v5Add) {
      const baseAdd = window.inkDocAddLayer;
      const wrappedAdd = function (options) {
        if (!options || !options.name) {
          let owner = '';
          try { owner = inkDocOwnerId() || ''; } catch { /* sessiz */ }
          // Görsel yoksa genel katmanın adını motor verir (kalıcı sayaç).
          if (!owner) return baseAdd.apply(this, arguments);
          let seq = {};
          try { seq = JSON.parse(localStorage.getItem(LAYER_SEQ_KEY) || '{}') || {}; } catch { /* sessiz */ }
          let max = Number(seq[owner]) || 0;
          try {
            inkDocLayers(owner).forEach(layer => {
              const m = /(\d+)\s*$/.exec(String(layer.name || ''));
              if (m) max = Math.max(max, Number(m[1]));
            });
          } catch { /* sessiz */ }
          const next = Math.max(1, max + 1);
          seq[owner] = next;
          try { localStorage.setItem(LAYER_SEQ_KEY, JSON.stringify(seq)); } catch { /* sessiz */ }
          const opts = Object.assign({}, options, { name: 'Layer ' + next });
          return baseAdd.call(this, opts);
        }
        return baseAdd.apply(this, arguments);
      };
      wrappedAdd.__v5Add = true;
      window.inkDocAddLayer = wrappedAdd;
    }

    /* Son renkler seçildiği anda değil, o renkle kanvasa gerçekten çizim
       yapıldığında listeye eklenir. Renk seçmek listeyi değiştirmez. */
    wrap('inkSetColor', () => { syncColor(); }, '__v5Color');

    wrap('inkPushUndoStroke', (layer, stroke) => {
      if (!stroke || stroke.tool === 'eraser') return;
      if (stroke.color) addRecent(stroke.color);
      // Fırça gerçekten kullanıldığında son kullanılanlara taşınır.
      if (typeof inkRadialTouch === 'function') {
        try { inkRadialTouch(inkState().brushId); } catch { /* sessiz */ }
      }
    }, '__v5Recent');
    // Katman listesi motor tarafından eski (gizli) panele geri taşınabiliyor;
    // satırlar basılmadan önce listeyi v5 kaydırma alanına bağla. Aksi hâlde
    // yeni satır görünmez ve scrollIntoView sayfayı yukarı kaydırır.
    if (typeof window.inkSyncLayersPanel === 'function' && !window.inkSyncLayersPanel.__v5Layers) {
      const baseSyncLayersPanel = window.inkSyncLayersPanel;
      const wrappedSyncLayersPanel = function () {
        try { ensureLayerMount(); } catch { /* sessiz */ }
        const result = baseSyncLayersPanel.apply(this, arguments);
        try { syncLayers(); } catch { /* sessiz */ }
        return result;
      };
      wrappedSyncLayersPanel.__v5Layers = true;
      window.inkSyncLayersPanel = wrappedSyncLayersPanel;
    }
    wrap('dpSyncToolbar', () => { syncToolbar(); }, '__v5Toolbar');
    wrap('setActiveBrush', () => { syncBrushLibrary(); }, '__v5BrushLib');
    wrap('inkEditorSyncStatus', () => { window.inkEditorViewport = v5Viewport; }, '__v5Status');
    wrap('inkPreviewBrush', () => { paintPreviewSecondStroke(); }, '__v5Preview');

    if (typeof window.dpInstallColorWheel === 'function' && !window.dpInstallColorWheel.__v5Wheel) {
      const baseWheel = window.dpInstallColorWheel;
      const wrappedWheel = function () {
        const result = baseWheel.apply(this, arguments);
        try { placeColorWheel(); } catch { /* sessiz */ }
        return result;
      };
      wrappedWheel.__v5Wheel = true;
      window.dpInstallColorWheel = wrappedWheel;
    }

    if (typeof window.dpApplyMode === 'function' && !window.dpApplyMode.__v5Mode) {
      const baseMode = window.dpApplyMode;
      const wrappedMode = function () {
        const result = baseMode.apply(this, arguments);
        try { ensureModeBar(); scheduleApply(); } catch { /* sessiz */ }
        return result;
      };
      wrappedMode.__v5Mode = true;
      window.dpApplyMode = wrappedMode;
    }

    if (typeof window.dpMoveModeBar === 'function' && !window.dpMoveModeBar.__v5Bar) {
      const baseBar = window.dpMoveModeBar;
      const wrappedBar = function () {
        const result = baseBar.apply(this, arguments);
        try { ensureModeBar(); } catch { /* sessiz */ }
        return result;
      };
      wrappedBar.__v5Bar = true;
      window.dpMoveModeBar = wrappedBar;
    }

    if (typeof window.psShellToggleTabDocks === 'function' && !window.psShellToggleTabDocks.__v5Tab) {
      const baseTab = window.psShellToggleTabDocks;
      const wrappedTab = function () {
        if (isDraw()) {
          setPanelsHidden(!document.body.classList.contains('v5-panels-hidden'));
          return;
        }
        return baseTab.apply(this, arguments);
      };
      wrappedTab.__v5Tab = true;
      window.psShellToggleTabDocks = wrappedTab;
    }

    // Araç çubuğundaki "Panels" düğmesi de çizim modunda v5 panellerini
    // gizleyip göstermeli; eski kabuk yalnızca kendi dock'larını yönetiyordu.
    if (typeof window.psShellToggleDocks === 'function' && !window.psShellToggleDocks.__v5Docks) {
      const baseDocks = window.psShellToggleDocks;
      const wrappedDocks = function () {
        if (isDraw()) {
          setPanelsHidden(!document.body.classList.contains('v5-panels-hidden'));
          return;
        }
        return baseDocks.apply(this, arguments);
      };
      wrappedDocks.__v5Docks = true;
      window.psShellToggleDocks = wrappedDocks;
    }
  }

  function ensureModeBar() {
    const bar = $('appModeBar');
    if (bar && bar.parentElement !== document.body) document.body.appendChild(bar);
  }

  /* =========================================================
     VARSAYILANLAR
     ========================================================= */
  function seedDefaults() {
    if (v5.seeded) return;
    v5.seeded = true;
    try {
      if (typeof inkSetColor === 'function') inkSetColor('#D4A24A', true);
    } catch { /* sessiz */ }

    const seedRange = (id, value) => {
      const input = $(id);
      if (!input) return;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    seedRange('inkSize', 64);
    seedRange('inkOpacity', 85);
    seedRange('inkSmoothing', 20);

    if (typeof inkSyncUI === 'function') inkSyncUI();
    syncLabels();
    syncSliders();
    syncColor();
    saveStore();
  }

  /* =========================================================
     KISAYOLLAR
     ========================================================= */
  function bindShortcuts() {
    if (bindShortcuts.done) return;
    bindShortcuts.done = true;
    document.addEventListener('keydown', event => {
      if (!isDraw()) return;
      const tag = (event.target && event.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (event.target && event.target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      /* Vuruş koruması: canlı vuruşta h/g/z yutulur — g aracı değiştirip
         vuruşu İPTAL ediyordu (setTool → inkCancelStroke), h pan modunu
         z görünümü orta vuruşta kaydırıyordu. */
      if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 'h') {
        event.preventDefault();
        const on = !(window.dpProto && dpProto.panMode);
        if (typeof dpSetPan === 'function') dpSetPan(on);
        syncToolbar();
      } else if (key === 'g') {
        event.preventDefault();
        setTool('gradient');
      } else if (key === 'z') {
        event.preventDefault();
        v5ZoomBy(event.shiftKey ? 0.8 : 1.25);
      }
    });
  }

  /* =========================================================
     UYGULA
     ========================================================= */
  function scheduleApply() {
    if (v5.applyQueued) return;
    v5.applyQueued = true;
    setTimeout(() => {
      v5.applyQueued = false;
      apply();
    }, 0);
  }

  function apply() {
    if (v5.applying) return;
    v5.applying = true;
    try {
      buildRoot();
      ensureModeBar();
      applyBreakpoint();

      if (!isDraw()) {
        v5.root.style.display = 'none';
        document.body.classList.remove('v5-panels-hidden');
        return;
      }

      v5.root.style.display = 'block';
      installWrappers();
      buildToolbar();
      buildOptionsBar();
      DEFS.forEach(def => {
        if (!v5.panels[def.id]) buildPanel(def);
      });
      mountEngineNodes();
      layoutPanels();
      syncRefMeta();
      scheduleRefClip();
      renderRecents();
      if (!v5.seeded) seedDefaults();
      paintPreviewSecondStroke();
      syncToolbar();
      syncLayers();
      syncColor();
      syncSliders();
      applyToolbarPosition();
      avoidModeBarOverlap();
      window.inkEditorViewport = v5Viewport;
      syncCanvasSoon();
      setTimeout(() => {
        if (!isDraw()) return;
        ensureLayerMount();
        placeColorWheel();
        syncRefMeta();
        scheduleRefClip();
        // Burada dpFitBoard() çağırmıyoruz: apply() her panel değişiminde
        // çalışır ve pano görünümünü sıfırlardı. Sığdırma yalnızca çizim
        // moduna girerken ve kullanıcı "Fit the board" dediğinde yapılır.
        syncColor();
      }, 0);
    } finally {
      v5.applying = false;
    }
  }

  /* =========================================================
     BAŞLAT
     ========================================================= */
  function init() {
    if (v5.ready) {
      apply();
      return;
    }
    loadState();
    buildRoot();
    ensureModeBar();
    installWrappers();
    bindShortcuts();
    bindTailRef();

    // Gövde sınıfı değişimini izle (dpApplyMode sarmalayıcısı kaçırırsa).
    // Chromium, aynı değere yapılan classList çağrılarında bile class
    // niteliğini değiştirilmiş sayar; değer karşılaştırması olmadan
    // apply() kendini sonsuz döngüde yeniden tetikliyordu.
    let lastBodyClass = document.body.className;
    new MutationObserver(() => {
      const now = document.body.className;
      if (now === lastBodyClass) return;
      lastBodyClass = now;
      if (isDraw()) scheduleApply();
      else if (v5.root) v5.root.style.display = 'none';
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    const refList = $('psRefList');
    if (refList) {
      new MutationObserver(() => {
        if (!isDraw()) return;
        syncRefMeta();
        scheduleRefClip();
      }).observe(refList, { childList: true, subtree: true });
    }

    // Sol/sağ dock kaydırılırsa kırpma dikdörtgeni paneli takip etsin ve
    // tahta pencereyle birlikte kaydırılsın.
    for (const id of ['v5LeftDock', 'v5RightDock']) {
      const dock = $(id);
      if (dock) dock.addEventListener('scroll', onDockScroll, { passive: true });
    }

    // Motor katman listesini eski (gizli) panele yeniden eklerse hemen
    // v5 kaydırma alanına al; yeni katman satırı görünür olsun.
    const legacyLayers = document.getElementById('inkLayersPanel');
    if (legacyLayers) {
      new MutationObserver(() => {
        if (isDraw()) ensureLayerMount();
      }).observe(legacyLayers, { childList: true, subtree: true });
    }

    window.addEventListener('resize', () => {
      if (!isDraw()) return;
      applyBreakpoint();
      apply();
      // FAZ 6 A8 (bounds sözleşmesi): pencere genişleyince taşan
      // widget'lar geri dönmeli; apply() zinciri her kapıdan geçmez →
      // sonra bir kez daha ölç.
      setTimeout(() => { if (isDraw() && v5.optionsBar) syncOptionsBar(); }, 60);
    }, { passive: true });

    // FAZ 6 A8: resize olayı arasında son düzeni kaçıran ölçümler için
    // düzen-izleyici: görünüm alanı boyutu değişince options bar
    // ölçümünü tazele (rAF debounceli; bar fixed olduğu için döngü
    // çıkmaz — documentElement değişimi bar genişliğini tetiklemez,
    // bar değişimi de documentElement'i tetiklemez).
    if (typeof ResizeObserver === 'function' && !v5.docSizeRO) {
      v5.docSizeRO = new ResizeObserver(() => {
        if (!isDraw() || !v5.optionsBar) return;
        requestAnimationFrame(() => {
          if (isDraw() && v5.optionsBar) syncOptionsBar();
        });
      });
      v5.docSizeRO.observe(document.documentElement);
    }

    // Panel sürükleme sırasında fare imleci panel dışına çıksa da takip.
    document.addEventListener('pointerdown', event => {
      if (!isDraw()) return;
      const t = event.target instanceof Element ? event.target : null;
      if (!t) return;
      if (!t.closest('#v5DrawUI') && !t.closest('#appModeBar')) closeMenu();
    }, true);

    v5.ready = true;
    apply();
  }

  // Uygulama motoru (app.js) senkron betik olarak yüklenir; dpBoot bir
  // microtask'ta çalışır. Kabuğu ondan sonra kurmak için sıfır gecikme
  // kullanılır; ayrıca yükleme tamamlandığında bir kez daha uygulanır.
  setTimeout(init, 0);
  window.addEventListener('load', () => {
    installWrappers();
    apply();
  });

  /* =========================================================
     MERKEZİ AYARLAR KÖPRÜSÜ — ⋯ → Ayarlar penceresi ÇİZİM sütunu
     bu API üzerinden v5 durumunu okur/yazar. Tek sürükleme grip'i
     menü değil taşıma işi yapar (menü merkez pencereye taşındı).
     ========================================================= */
  window.inkV5Settings = {
    /** Panel görünürlükleri: [{ id, title, column, visible }] */
    panels() {
      return DEFS.map(def => {
        const st = panelState(def.id);
        return { id: def.id, title: def.title, column: def.column, visible: !!(st && st.visible) };
      });
    },
    setPanelVisible(id, visible) { setPanelVisible(id, !!visible); },
    panelsHidden() { return document.body.classList.contains('v5-panels-hidden'); },
    setPanelsHidden(hidden) { setPanelsHidden(!!hidden); },
    /** Panelleri varsayılan düzenine döndür (eski menü satırının aynısı). */
    reset() {
      DEFS.forEach((def, index) => {
        v5.states[def.id] = defaultState(def, index);
      });
      v5.leftWide = false;
      v5.dockW = { left: null, right: null };
      v5.toolPos = null;
      saveStore();
      apply();
      if (typeof dpProto !== 'undefined' && dpProto) dpProto.userTouched = false;
      if (typeof dpFitBoard === 'function') dpFitBoard();
      if (typeof dpSyncBoardLabel === 'function') dpSyncBoardLabel();
    },
    powerSliders() {
      try { return typeof inkPowerSlidersEnabled === 'function' ? !!inkPowerSlidersEnabled() : false; }
      catch { return false; }
    },
    setPowerSliders(on) {
      try { window.inkPowerSlidersSet(!!on); } catch { /* sessiz */ }
    },
    mousePressure() {
      try { return !!inkState().mouseSpeedPressure; } catch { return false; }
    },
    setMousePressure(on) {
      try { inkState().mouseSpeedPressure = !!on; scheduleSave(); } catch { /* sessiz */ }
    },
    sym() {
      try { return String(inkState().symMode || 'off'); } catch { return 'off'; }
    },
    setSym(value) {
      try {
        inkState().symMode = String(value);
        if (typeof inkSyncUI === 'function') inkSyncUI();
        scheduleSave();
      } catch { /* sessiz */ }
    },
    tileSize() {
      try { return typeof inkTileSizeSetting === 'function' ? String(inkTileSizeSetting()) : 'auto'; }
      catch { return 'auto'; }
    },
    /** Otomatikten bugun ne çıktı: etkin karo boyutu (128/256/512) veya 0. */
    tileSizeResolved() {
      try { return typeof inkTileSizeCur === 'function' ? Number(inkTileSizeCur()) : 0; }
      catch { return 0; }
    },
    /** "Yeniden ölç": otomatik karo kararını unut; birkaç vuruşta yeniden ölçer. */
    remeasureTile() {
      try { localStorage.removeItem('tailref-ink-tile-auto'); } catch { /* sessiz */ }
    },
    setTileSize(value) {
      try { if (typeof inkTileSizeSet === 'function') inkTileSizeSet(value); } catch { /* sessiz */ }
    },
    shape() {
      try { return inkState().tool === 'shape'; } catch { return false; }
    },
    setShape(on) {
      try { setTool(on ? 'shape' : 'brush'); } catch { /* sessiz */ }
    },
    keyHelp() {
      try { inkKeyHelpToggle(); } catch { /* sessiz */ }
    },
  };

  /* =========================================================
     AYRI PANEL PENCERESİ KÖPRÜSÜ (17b-panel-dock.js)
     ========================================================= */
  window.tailrefV5Panels = {
    ids: { ...PANEL_IDS },
    panel(id) { return v5.panels[id] || null; },
    /* Ayrı pencere kapandığında / panel geri takıldığında düzeni tazele. */
    refresh() { apply(); },
    isDraw,
    /* Mini tahta dikdörtgeni: panel ayrı penceredeyken #v5RefStage ana
       pencerede gizlidir; yakınlaştır/sığdır bu son geçerli alanı kullanır. */
    refRect() {
      const rect = v5.lastRefRect;
      if (!rect || !(rect.width >= 1) || !(rect.height >= 1)) return null;
      return { ...rect };
    },
    setRefRect(rect) {
      if (!rect) return;
      const next = {
        left: Number(rect.left) || 0,
        top: Number(rect.top) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0,
      };
      if (next.width >= 1 && next.height >= 1) v5.lastRefRect = next;
    },
  };
  window.tailrefV5RefRect = () => window.tailrefV5Panels.refRect();
})();
