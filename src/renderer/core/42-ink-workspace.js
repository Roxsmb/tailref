/* TailRef app · ink workspace · kalıcı yerleşim ve paneller
   ------------------------------------------------------------------
   Çizim modunun "Workspace" katmanı. Motor dosyalarına dokunmaz;
   yalnızca mevcut DOM'u, panel görünürlüğünü, genişlikleri ve kısayol
   eşlemesini yönetir.

   Temel kural: panel değişiklikleri tuvalin arka depolamasını yeniden
   ayırmaz. Yerleşim biter, kısa bir debounce sonrası motorun yalnızca
   durum/görünüm tazeleme kapıları çağrılır.
   ========================================================= */
'use strict';

const INK_WS_KEY = 'tailref-ink-workspace-v1';
const INK_WS_SAVE_MS = 140;
const INK_WS_VIEW_MS = 90;
const INK_WS_MIN_SIDE = 180;

const INK_WS_ACCENTS = [
  { id: 'blue', label: 'Blue', color: '#4c8dff' },
  { id: 'teal', label: 'Turquoise', color: '#2fb8a6' },
  { id: 'violet', label: 'Purple', color: '#9b7bf7' },
  { id: 'amber', label: 'Amber', color: '#e0a24a' },
  { id: 'rose', label: 'Rose', color: '#e56a8b' },
];

const INK_WS_TOOLS = [
  { id: 'transform', label: 'Move', icon: 'ink-move' },
  { id: 'marquee', label: 'Selection', icon: 'ink-marquee' },
  { id: 'brush', label: 'Brush', icon: 'ink-brush' },
  { id: 'pencil', label: 'Pencil', icon: 'ink-pencil' },
  { id: 'eraser', label: 'Eraser', icon: 'ink-eraser' },
  { id: 'shape', label: 'Shape', icon: 'ink-shape' },
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'eyedropper', label: 'Eyedropper', icon: 'ink-dropper' },
];

const INK_WS_SHORTCUT_DEFS = [
  { id: 'toolTransform', label: 'Move / Transform', fallback: 'v' },
  { id: 'toolMarquee', label: 'Rectangular selection', fallback: 'm' },
  { id: 'toolLasso', label: 'Lasso selection', fallback: 'l' },
  { id: 'toolBrush', label: 'Brush', fallback: 'b' },
  { id: 'toolPencil', label: 'Pencil', fallback: 'p' },
  { id: 'toolEraser', label: 'Eraser', fallback: 'e' },
  { id: 'toolShape', label: 'Shape', fallback: 'u' },
  { id: 'toolText', label: 'Text note (T)', fallback: 't' },
  { id: 'toolEyedropper', label: 'Eyedropper', fallback: 'i' },
  { id: 'toolGradient', label: 'Gradient', fallback: 'g' },
  { id: 'sizeDown', label: 'Shrink brush', fallback: '[' },
  { id: 'sizeUp', label: 'Grow brush', fallback: ']' },
  { id: 'undo', label: 'Undo', fallback: 'ctrl+z' },
  { id: 'redo', label: 'Redo', fallback: 'ctrl+y' },
  { id: 'fit', label: 'Fit to screen', fallback: '0' },
  { id: 'actual', label: 'Actual size', fallback: '1' },
  { id: 'colorWheel', label: 'Color wheel', fallback: 'c' },
  { id: 'swapColors', label: 'Swap colors', fallback: 'x' },
];

const INK_WS_DEFAULT_SHORTCUTS = (() => {
  const out = {};
  for (const item of INK_WS_SHORTCUT_DEFS) out[item.id] = item.fallback;
  return out;
})();

/* Motorun eski sabit kısayolları. Kullanıcı birini başka tuşa taşırsa
   eski tuş yutulur; böylece iki eylem aynı anda tetiklenmez. */
const INK_WS_ENGINE_KEYS = new Set([
  'v', 'm', 'l', 'b', 'p', 'e', 'u', 't', 'i',
  '[', ']', '0', '1', 'ctrl+z', 'ctrl+y',
]);

const INK_WS_FIXED_KEYS = new Set([
  'escape', 'space', 'alt', 'delete', 'backspace', 'tab',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'shift', 'control', 'meta', 'capslock',
]);

const INK_WS_PRESETS = [
  {
    id: 'calm',
    name: 'Calm',
    hint: 'Layer + brush, wide canvas',
    layout: {
      panels: { layers: true, brush: true, color: false, history: false, advanced: false },
      layersWidth: 240,
      brushWidth: 272,
      swap: false,
      density: 'loose',
      accent: 'blue',
    },
  },
  {
    id: 'canvas',
    name: 'Wide Canvas',
    hint: 'Brush only, full focus',
    layout: {
      panels: { layers: false, brush: true, color: false, history: false, advanced: false },
      layersWidth: 240,
      brushWidth: 272,
      swap: false,
      density: 'loose',
      accent: 'blue',
    },
  },
  {
    id: 'studio',
    name: 'Full Studio',
    hint: 'All panels, tight layout',
    layout: {
      panels: { layers: true, brush: true, color: true, history: true, advanced: true },
      layersWidth: 260,
      brushWidth: 300,
      swap: false,
      density: 'tight',
      accent: 'blue',
    },
  },
];

const inkWorkspaceUi = {
  ready: false,
  state: null,
  applying: false,
  menuOpen: false,
  captureShortcut: '',
  saveTimer: 0,
  viewTimer: 0,
  layoutRaf: 0,
  historyTimer: 0,
  colorTimer: 0,
  drag: null,
  lastBrushCollapsed: null,
  booted: false,
};

function inkWorkspaceClampWidth(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.round(clamp(Number.isFinite(fallback) ? fallback : min, min, max));
  }
  return Math.round(clamp(n, min, max));
}

function inkWorkspaceDefaultState() {
  return {
    version: 1,
    panels: { layers: true, brush: true, color: false, history: false, advanced: false },
    layersWidth: 240,
    brushWidth: 272,
    swap: false,
    density: 'loose',
    accent: 'blue',
    tools: INK_WS_TOOLS.map(item => item.id),
    hiddenTools: [],
    shortcuts: { ...INK_WS_DEFAULT_SHORTCUTS },
    workspaces: [],
  };
}

function inkWorkspaceClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function inkWorkspaceAccent(id) {
  return INK_WS_ACCENTS.find(item => item.id === id) || INK_WS_ACCENTS[0];
}

/** Kayıtlı ayarı güvenli biçimde okur; bilinmeyen alanlar varsayılana döner. */
function inkWorkspaceLoad() {
  const base = inkWorkspaceDefaultState();
  let src = null;
  try {
    const raw = localStorage.getItem(INK_WS_KEY);
    if (raw) src = JSON.parse(raw);
  } catch {
    src = null;
  }
  if (!src || typeof src !== 'object') return base;

  if (src.panels && typeof src.panels === 'object') {
    for (const key of ['layers', 'brush', 'color', 'history', 'advanced']) {
      if (typeof src.panels[key] === 'boolean') base.panels[key] = src.panels[key];
    }
  }
  base.layersWidth = inkWorkspaceClampWidth(src.layersWidth, 200, 360, base.layersWidth);
  base.brushWidth = inkWorkspaceClampWidth(src.brushWidth, 200, 380, base.brushWidth);
  base.swap = src.swap === true;
  base.density = src.density === 'tight' ? 'tight' : 'loose';
  base.accent = INK_WS_ACCENTS.some(item => item.id === src.accent) ? src.accent : 'blue';

  if (Array.isArray(src.tools)) {
    const valid = INK_WS_TOOLS.map(item => item.id);
    const seen = new Set();
    const ordered = [];
    for (const id of src.tools) {
      if (valid.includes(id) && !seen.has(id)) { ordered.push(id); seen.add(id); }
    }
    for (const id of valid) {
      if (!seen.has(id)) ordered.push(id);
    }
    base.tools = ordered;
  }
  if (Array.isArray(src.hiddenTools)) {
    base.hiddenTools = [...new Set(src.hiddenTools.filter(id =>
      INK_WS_TOOLS.some(item => item.id === id)))];
  }

  if (src.shortcuts && typeof src.shortcuts === 'object') {
    for (const item of INK_WS_SHORTCUT_DEFS) {
      const key = inkWorkspaceNormalizeKey(src.shortcuts[item.id]);
      if (key && !INK_WS_FIXED_KEYS.has(key)) base.shortcuts[item.id] = key;
    }
  }

  if (Array.isArray(src.workspaces)) {
    base.workspaces = src.workspaces
      .filter(item => item && typeof item === 'object' && typeof item.name === 'string')
      .slice(0, 12)
      .map(item => ({
        id: String(item.id || ('ws-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7))),
        name: item.name.slice(0, 32),
        layout: inkWorkspaceSanitizeLayout(item.layout),
      }));
  }
  return base;
}

function inkWorkspaceSanitizeLayout(layout) {
  const base = {
    panels: { layers: true, brush: true, color: false, history: false, advanced: false },
    layersWidth: 240,
    brushWidth: 272,
    swap: false,
    density: 'loose',
    accent: 'blue',
  };
  if (!layout || typeof layout !== 'object') return base;
  if (layout.panels && typeof layout.panels === 'object') {
    for (const key of ['layers', 'brush', 'color', 'history', 'advanced']) {
      if (typeof layout.panels[key] === 'boolean') base.panels[key] = layout.panels[key];
    }
  }
  base.layersWidth = inkWorkspaceClampWidth(layout.layersWidth, 200, 360, base.layersWidth);
  base.brushWidth = inkWorkspaceClampWidth(layout.brushWidth, 200, 380, base.brushWidth);
  base.swap = layout.swap === true;
  base.density = layout.density === 'tight' ? 'tight' : 'loose';
  base.accent = INK_WS_ACCENTS.some(item => item.id === layout.accent) ? layout.accent : 'blue';
  if (Array.isArray(layout.tools)) {
    const valid = INK_WS_TOOLS.map(item => item.id);
    const seen = new Set();
    const tools = [];
    for (const id of layout.tools) {
      if (valid.includes(id) && !seen.has(id)) { tools.push(id); seen.add(id); }
    }
    for (const id of valid) {
      if (!seen.has(id)) tools.push(id);
    }
    base.tools = tools;
  }
  if (Array.isArray(layout.hiddenTools)) {
    base.hiddenTools = [...new Set(layout.hiddenTools.filter(id =>
      INK_WS_TOOLS.some(item => item.id === id)))];
  }
  return base;
}

function inkWorkspaceCaptureLayout() {
  const st = inkWorkspaceUi.state;
  return inkWorkspaceSanitizeLayout({
    panels: { ...st.panels },
    layersWidth: st.layersWidth,
    brushWidth: st.brushWidth,
    swap: st.swap,
    density: st.density,
    accent: st.accent,
  });
}

function inkWorkspaceSaveNow() {
  clearTimeout(inkWorkspaceUi.saveTimer);
  inkWorkspaceUi.saveTimer = 0;
  if (!inkWorkspaceUi.state) return;
  try {
    localStorage.setItem(INK_WS_KEY, JSON.stringify(inkWorkspaceUi.state));
  } catch {
    /* Depo dolu veya kapalıysa çizim çalışmaya devam eder. */
  }
}

function inkWorkspaceSave() {
  clearTimeout(inkWorkspaceUi.saveTimer);
  inkWorkspaceUi.saveTimer = setTimeout(inkWorkspaceSaveNow, INK_WS_SAVE_MS);
}

/** Motoru yeniden boyutlandırmadan yalnızca görünümü tazeler. */
function inkWorkspaceScheduleViewportSync() {
  clearTimeout(inkWorkspaceUi.viewTimer);
  inkWorkspaceUi.viewTimer = setTimeout(() => {
    if (typeof inkEditorSyncStatus === 'function') inkEditorSyncStatus();
    if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
    if (typeof inkSyncCanvasFrame === 'function') inkSyncCanvasFrame();
  }, INK_WS_VIEW_MS);
}

function inkWorkspacePanelEl(id) {
  if (id === 'layers') return document.getElementById('inkLayersPanel');
  if (id === 'brush') return document.getElementById('inkBrushPanel');
  if (id === 'history') return document.getElementById('inkHistoryPanel');
  if (id === 'color') return document.getElementById('inkColorPanel');
  return null;
}

function inkWorkspaceDock(id) {
  return document.getElementById(id === 'left' ? 'inkLeftDock' : 'inkRightDock');
}

/** Panelleri gerçek yerleşim taraflarına taşır. Düğümler yalnızca taşınır;
    kimlikler ve olay dinleyicileri korunur. */
function inkWorkspaceMoveDocks() {
  const st = inkWorkspaceUi.state;
  const left = document.querySelector('#inkLeftDock');
  const right = document.querySelector('#inkRightDock');
  if (!left || !right) return;

  const sideFor = id => {
    if (id === 'brush') return st.swap ? 'left' : 'right';
    return st.swap ? 'right' : 'left';
  };
  const families = ['layers', 'history', 'color', 'brush'];
  for (const id of families) {
    const panel = inkWorkspacePanelEl(id);
    if (!panel) continue;
    const dock = sideFor(id) === 'left' ? left : right;
    const handle = dock.querySelector('.inkResizeHandle');
    if (handle) dock.insertBefore(panel, handle);
    else dock.appendChild(panel);
  }
  // Tutamaçlar her zaman dış kenarda ve en son çocuk olarak kalır.
  for (const dock of [left, right]) {
    const handle = dock.querySelector('.inkResizeHandle');
    if (handle && dock.lastElementChild !== handle) dock.appendChild(handle);
  }
  const leftHandle = document.getElementById('inkResizeLeft');
  const rightHandle = document.getElementById('inkResizeRight');
  if (leftHandle) {
    leftHandle.setAttribute('aria-label', st.swap ? 'Brush panel width' : 'Layer panel width');
  }
  if (rightHandle) {
    rightHandle.setAttribute('aria-label', st.swap ? 'Layer panels width' : 'Brush panel width');
  }
}

/** Panel görünürlüğünü uygular. `force` yalnızca menü/çizime giriş gibi
    açık kullanıcı isteklerinde fırçanın daraltılmış şeridini de açar. */
function inkWorkspaceApplyPanels(force = false) {
  const st = inkWorkspaceUi.state;
  inkWorkspaceUi.applying = true;
  try {
    for (const id of ['layers', 'history', 'color', 'brush']) {
      const el = inkWorkspacePanelEl(id);
      if (!el) continue;
      const desired = !!st.panels[id];
      const collapsed = id === 'brush' && document.body.classList.contains('ink-brush-closed');
      if (desired && collapsed && !force) {
        el.hidden = true;
      } else {
        el.hidden = !desired;
      }
      if (!el.hidden) {
        el.classList.remove('panel-leaving', 'panel-enter', 'panel-preenter');
      }
    }
    document.body.classList.toggle('ink-ws-brush-hidden', !st.panels.brush);

    const adv = document.querySelector('#inkBrushPanel .inkAdvanced');
    if (adv) {
      const on = !!st.panels.advanced;
      adv.hidden = !on;
      if (on) adv.open = true;
      else adv.open = false;
    }
    if (typeof inkSyncBrushPanelState === 'function') inkSyncBrushPanelState();
  } finally {
    inkWorkspaceUi.applying = false;
  }
}

function inkWorkspaceApplyTools() {
  const st = inkWorkspaceUi.state;
  const box = document.getElementById('inkToolbox');
  if (!box) return;
  const colorRow = box.querySelector('.inkColorRow');
  for (const id of st.tools) {
    const el = box.querySelector('[data-ws-tool="' + id + '"]');
    if (!el) continue;
    if (colorRow) box.insertBefore(el, colorRow);
    else box.appendChild(el);
    el.hidden = st.hiddenTools.includes(id);
  }
}

function inkWorkspaceLayerSideVisible() {
  const p = inkWorkspaceUi.state.panels;
  return !!(p.layers || p.history || p.color);
}

function inkWorkspaceBrushVisible() {
  const st = inkWorkspaceUi.state;
  return !!st.panels.brush;
}

function inkWorkspaceIsTight() {
  const st = inkWorkspaceUi.state;
  if (!st) return false;
  return st.density === 'tight' || window.innerWidth < 1080 || window.innerHeight < 700;
}

/** CSS değişkenleriyle sütun genişliklerini hesaplar. Dar pencerede
    kalıcı tercih değişmez; yalnızca görünen genişlik kelepçelenir. */
function inkWorkspaceApplyLayout() {
  const st = inkWorkspaceUi.state;
  if (!st) return;
  const brushCollapsed = document.body.classList.contains('ink-brush-closed') && st.panels.brush;
  const layerSide = inkWorkspaceLayerSideVisible();
  const brushSide = inkWorkspaceBrushVisible();
  const tight = inkWorkspaceIsTight();
  const rail = tight ? 72 : 92;
  let layerW = layerSide ? st.layersWidth : 0;
  let brushW = brushSide ? (brushCollapsed ? 40 : st.brushWidth) : 0;

  const vw = Math.max(320, window.innerWidth || 1200);
  const canvasMin = Math.max(120, Math.min(320, vw * 0.28));
  const available = Math.max(0, vw - rail - canvasMin);
  if (layerW + brushW > available && layerW + brushW > 0) {
    const scale = available / (layerW + brushW);
    if (layerW) layerW = Math.max(INK_WS_MIN_SIDE, Math.floor(layerW * scale));
    if (brushW) brushW = Math.max(INK_WS_MIN_SIDE, Math.floor(brushW * scale));
    if (layerW + brushW > available) {
      if (brushW && layerW) brushW = Math.max(INK_WS_MIN_SIDE, available - layerW);
      if (layerW + brushW > available && layerW) {
        layerW = Math.max(INK_WS_MIN_SIDE, available - brushW);
      }
    }
  }

  const leftW = st.swap ? brushW : layerW;
  const rightW = st.swap ? layerW : brushW;
  const body = document.body;
  body.style.setProperty('--ink-tools-w', rail + 'px');
  body.style.setProperty('--ink-left-w', (leftW > 0 ? leftW : 0) + 'px');
  body.style.setProperty('--ink-right-w', (rightW > 0 ? rightW : 0) + 'px');
  body.style.setProperty('--ink-layers-w', st.layersWidth + 'px');
  body.style.setProperty('--ink-brush-w', st.brushWidth + 'px');
  body.classList.toggle('ink-ws-side-left-empty', layerSide === false && brushSide === false);
  const leftHandle = document.getElementById('inkResizeLeft');
  const rightHandle = document.getElementById('inkResizeRight');
  if (leftHandle) leftHandle.hidden = leftW <= 0;
  if (rightHandle) rightHandle.hidden = rightW <= 0;
}

function inkWorkspaceRefreshDensity() {
  const st = inkWorkspaceUi.state;
  if (!st) return;
  const tight = inkWorkspaceIsTight();
  document.body.classList.toggle('ink-ws-tight', tight);
  document.body.dataset.inkWsDensity = st.density;
  const note = document.getElementById('inkWsDensityNote');
  if (note) {
    note.textContent = st.density === 'tight'
      ? __t('Tight layout selected manually.')
      : tight
        ? __t('View auto-tightened in the small window.')
        : __t('Density auto-tightens in small windows.');
  }
}

/* Dil değişince yoğunluk notu (dinamik yazım) yeniden çevrilsin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { inkWorkspaceRefreshDensity(); } catch { /* sessiz */ } });
}

function inkWorkspaceApplyAccent() {
  const accent = inkWorkspaceAccent(inkWorkspaceUi.state.accent);
  document.body.dataset.inkWsAccent = accent.id;
  document.body.style.setProperty('--ink-accent', accent.color);
}

/** Yerleşimi tek kapıdan uygular. */
function inkWorkspaceApply(options = {}) {
  if (!inkWorkspaceUi.ready) return;
  inkWorkspaceMoveDocks();
  inkWorkspaceApplyPanels(!!options.forcePanels);
  inkWorkspaceApplyTools();
  inkWorkspaceRefreshDensity();
  inkWorkspaceApplyAccent();
  inkWorkspaceApplyLayout();
  if (typeof inkWorkspaceRefreshMenu === 'function') inkWorkspaceRefreshMenu();
  inkWorkspaceScheduleViewportSync();
}

/** Pencere boyutu değişince panelleri gizlemeden yalnızca yoğunluk ve
    sütunları sıkılaştırır. */
function inkWorkspaceResponsive() {
  if (!inkWorkspaceUi.ready) return;
  cancelAnimationFrame(inkWorkspaceUi.layoutRaf);
  inkWorkspaceUi.layoutRaf = requestAnimationFrame(() => {
    inkWorkspaceRefreshDensity();
    inkWorkspaceApplyLayout();
    inkWorkspaceScheduleViewportSync();
  });
}

function inkWorkspaceSetPanel(id, on) {
  if (!inkWorkspaceUi.state || !(id in inkWorkspaceUi.state.panels)) return;
  inkWorkspaceUi.state.panels[id] = !!on;
  // Yalnızca fırça açıkça açıldığında daraltılmış şerit de açılır;
  // başka bir paneli açmak kullanıcının fırça kararını bozmaz.
  inkWorkspaceApplyPanels(id === 'brush');
  inkWorkspaceApplyLayout();
  if (typeof inkWorkspaceRefreshMenu === 'function') inkWorkspaceRefreshMenu();
  inkWorkspaceSave();
  inkWorkspaceScheduleViewportSync();
}

function inkWorkspaceSetDensity(value) {
  if (!inkWorkspaceUi.state) return;
  inkWorkspaceUi.state.density = value === 'tight' ? 'tight' : 'loose';
  inkWorkspaceRefreshDensity();
  inkWorkspaceApplyLayout();
  if (typeof inkWorkspaceRefreshMenu === 'function') inkWorkspaceRefreshMenu();
  inkWorkspaceSave();
  inkWorkspaceScheduleViewportSync();
}

function inkWorkspaceSetAccent(id) {
  if (!inkWorkspaceUi.state) return;
  inkWorkspaceUi.state.accent = INK_WS_ACCENTS.some(item => item.id === id) ? id : 'blue';
  inkWorkspaceApplyAccent();
  if (typeof inkWorkspaceRefreshMenu === 'function') inkWorkspaceRefreshMenu();
  inkWorkspaceSave();
}

function inkWorkspaceSetSwap(on) {
  if (!inkWorkspaceUi.state) return;
  inkWorkspaceUi.state.swap = !!on;
  inkWorkspaceApply();
  inkWorkspaceSave();
}

function inkWorkspaceSetWidth(side, value, save = true, refreshMenu = true) {
  if (!inkWorkspaceUi.state) return;
  if (side === 'layers') {
    inkWorkspaceUi.state.layersWidth = inkWorkspaceClampWidth(value, 200, 360);
  } else {
    inkWorkspaceUi.state.brushWidth = inkWorkspaceClampWidth(value, 200, 380);
  }
  inkWorkspaceApplyLayout();
  if (refreshMenu && typeof inkWorkspaceRefreshMenu === 'function') inkWorkspaceRefreshMenu();
  if (save) inkWorkspaceSave();
  inkWorkspaceScheduleViewportSync();
}

function inkWorkspaceApplyPreset(id) {
  const preset = INK_WS_PRESETS.find(item => item.id === id);
  if (!preset || !inkWorkspaceUi.state) return;
  const st = inkWorkspaceUi.state;
  const layout = inkWorkspaceSanitizeLayout(preset.layout);
  st.panels = { ...layout.panels };
  st.layersWidth = layout.layersWidth;
  st.brushWidth = layout.brushWidth;
  st.swap = layout.swap;
  st.density = layout.density;
  st.accent = layout.accent;
  inkWorkspaceApply({ forcePanels: true });
  inkWorkspaceSave();
}

function inkWorkspaceApplyLayoutObject(layout) {
  if (!inkWorkspaceUi.state) return;
  const clean = inkWorkspaceSanitizeLayout(layout);
  const st = inkWorkspaceUi.state;
  st.panels = { ...clean.panels };
  st.layersWidth = clean.layersWidth;
  st.brushWidth = clean.brushWidth;
  st.swap = clean.swap;
  st.density = clean.density;
  st.accent = clean.accent;
  inkWorkspaceApply({ forcePanels: true });
  inkWorkspaceSave();
}

function inkWorkspaceReset() {
  const keepWorkspaces = inkWorkspaceUi.state ? inkWorkspaceUi.state.workspaces : [];
  inkWorkspaceUi.state = inkWorkspaceDefaultState();
  inkWorkspaceUi.state.workspaces = keepWorkspaces;
  inkWorkspaceApply({ forcePanels: true });
  if (typeof inkWorkspaceRenderMenu === 'function') inkWorkspaceRenderMenu();
  inkWorkspaceSaveNow();
}

function inkWorkspaceCloseMenu() {
  const wasOpen = inkWorkspaceUi.menuOpen;
  inkWorkspaceUi.menuOpen = false;
  /* Menü zaten kapalıyken yakalama seansını bozma: Ayarlar → Shortcuts
     yakalaması menüyle ilgisizken body class mutasyonu (idle fade,
     tema/accent değişimi…) aşağıdaki observer'ı tetikleyip
     yakalamayı sessizce silebiliyordu (settings-hub-test bulgusu). */
  if (wasOpen) inkWorkspaceUi.captureShortcut = '';
  const menu = document.getElementById('inkWorkspaceMenu');
  if (menu) menu.hidden = true;
  const trigger = document.getElementById('btnInkWorkspace');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (typeof inkWorkspaceRenderMenu === 'function') inkWorkspaceRenderMenu();
}

function inkWorkspaceOpenMenu() {
  if (typeof modeIsDraw === 'function' && !modeIsDraw()) return;
  inkWorkspaceUi.menuOpen = true;
  inkWorkspaceUi.captureShortcut = '';
  const menu = document.getElementById('inkWorkspaceMenu');
  if (menu) menu.hidden = false;
  const trigger = document.getElementById('btnInkWorkspace');
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  if (typeof inkWorkspaceRenderMenu === 'function') inkWorkspaceRenderMenu();
}

function inkWorkspaceToggleMenu() {
  if (inkWorkspaceUi.menuOpen) inkWorkspaceCloseMenu();
  else inkWorkspaceOpenMenu();
}

/** 31-ink-ui.js içindeki inkSyncUI() tarafından çağrılır. Ağır iş yapmaz;
    yalnızca yan panelleri ve menüyü gerçek durumla eşitler. */
function inkWorkspaceSync() {
  if (!inkWorkspaceUi.ready) return;
  if (inkWorkspaceUi.state) {
    const collapsed = document.body.classList.contains('ink-brush-closed') &&
      !!inkWorkspaceUi.state.panels.brush;
    if (collapsed !== inkWorkspaceUi.lastBrushCollapsed) {
      inkWorkspaceUi.lastBrushCollapsed = collapsed;
      inkWorkspaceApplyLayout();
      inkWorkspaceScheduleViewportSync();
    }
  }
  if (typeof inkWorkspaceSyncColor === 'function') inkWorkspaceSyncColor();
  if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
  if (typeof modeIsDraw === 'function' && !modeIsDraw()) {
    if (inkWorkspaceUi.menuOpen) inkWorkspaceCloseMenu();
  } else if (typeof inkWorkspaceRefreshMenu === 'function' && inkWorkspaceUi.menuOpen) {
    inkWorkspaceRefreshMenu();
  }
}

/** Global motor fonksiyonlarını yalnızca yan etki için sarar. */
function inkWorkspaceWrapGlobals() {
  const wrap = (name, after) => {
    const base = window[name];
    if (typeof base !== 'function' || base.__inkWorkspaceWrapped) return;
    const wrapped = function inkWorkspaceWrappedCall() {
      const result = base.apply(this, arguments);
      try { after.apply(this, arguments); } catch { /* UI yan etkisi çizimi durdurmasın */ }
      return result;
    };
    wrapped.__inkWorkspaceWrapped = true;
    window[name] = wrapped;
  };

  wrap('inkEnterImageScope', () => {
    if (!inkWorkspaceUi.ready) return;
    inkWorkspaceApplyPanels(true);
    inkWorkspaceApplyLayout();
    inkWorkspaceScheduleViewportSync();
  });
  wrap('inkEditorOpen', () => {
    if (!inkWorkspaceUi.ready) return;
    if (typeof inkEditorIsOpen === 'function' && !inkEditorIsOpen()) return;
    inkWorkspaceApplyPanels(true);
    inkWorkspaceApplyLayout();
    inkWorkspaceScheduleViewportSync();
  });
  wrap('inkExitImageScope', () => inkWorkspaceCloseMenu());
  wrap('pushUndo', () => {
    if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
  });
  wrap('undo', () => {
    if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
  });
  wrap('redo', () => {
    if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
  });
  wrap('inkPushUndoStroke', () => {
    if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
  });
  wrap('inkSetColor', () => {
    if (typeof inkWorkspaceScheduleColor === 'function') inkWorkspaceScheduleColor();
  });
}

function inkWorkspaceBoot() {
  if (inkWorkspaceUi.booted) return;
  inkWorkspaceUi.booted = true;
  inkWorkspaceUi.state = inkWorkspaceLoad();
  inkWorkspaceUi.ready = true;
  document.body.classList.add('ink-workspace-ready');
  inkWorkspaceMoveDocks();
  inkWorkspaceApplyTools();
  inkWorkspaceRefreshDensity();
  inkWorkspaceApplyAccent();
  inkWorkspaceApplyLayout();
  inkWorkspaceUi.lastBrushCollapsed = document.body.classList.contains('ink-brush-closed');
  inkWorkspaceWrapGlobals();

  window.addEventListener('resize', inkWorkspaceResponsive);
  window.addEventListener('tailref-project-changed', () => {
    inkWorkspaceCloseMenu();
    inkWorkspaceApplyPanels(false);
    if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
  });

  const observer = new MutationObserver(() => {
    if (typeof modeIsDraw === 'function' && !modeIsDraw()) inkWorkspaceCloseMenu();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  if (typeof inkWorkspaceBindMenu === 'function') inkWorkspaceBindMenu();
  if (typeof inkWorkspaceBindResizers === 'function') inkWorkspaceBindResizers();
  if (typeof inkWorkspaceBindPanels === 'function') inkWorkspaceBindPanels();
  if (typeof inkWorkspaceSyncColor === 'function') inkWorkspaceSyncColor();
  if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
  if (typeof inkWorkspaceBindShortcuts === 'function') inkWorkspaceBindShortcuts();
}

queueMicrotask(inkWorkspaceBoot);
