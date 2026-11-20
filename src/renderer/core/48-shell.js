/* TailRef app · birleşik kabuk davranışı
   ------------------------------------------------------------------
   Tek pencere / iki mod. Bu dosya yalnızca DOM, CSS sınıfı ve
   kullanıcı tercihi yönetir; çizim motoruna, veri biçimlerine ve
   fırça/katman mantığına dokunmaz.

   Görevleri:
   · Sağdaki mod segmenti + akordeon panel yığını
   · Çizimde soldaki referans dock'u
   · Yüzen araç çubuğunun moda göre ilk grubu
   · Panelleri sürükle-sırala, aç/kapat, mod başına hatırla
   · Dock gizleme (Paneller / Tab), kenar tutamaçları
   · Alt durum çubuğu, kısayollar, referans ön izlemesi
   ========================================================= */
'use strict';

const PS_SHELL_KEY = 'tailref-shell-v2';
const PS_SHELL_SAVE_MS = 160;
let psShellDrawPressureCurve = null;

const PS_PANEL_META = {
  layers:   { icon: 'ink-layers',  title: 'Layers' },
  brush:    { icon: 'ink-brush',   title: 'Brush Controls' },
  color:    { icon: 'palette',     title: 'Color' },
  projects: { icon: 'grid',        title: 'Boards' },
  add:      { icon: 'plus',        title: 'Add' },
  board:    { icon: 'inspector',   title: 'Board' },
};

const psShell = {
  ready: false,
  state: null,
  saveTimer: 0,
  viewportTimer: 0,
  refTimer: 0,
  dragKey: '',
  tabHidden: false,
  lastDraw: null,
  lastMode: '',
  overlayDrag: null,
  bound: false,
};

function psShellDefaultState() {
  return {
    version: 2,
    mode: 'reference',
    lastDrawItem: '',
    draw: {
      leftOpen: true,
      leftWidth: 194,
      rightOpen: true,
      rightWidth: 197,
      order: ['color', 'layers', 'brush'],
      open: { layers: true, brush: true, color: true },
      grid: false,
    },
    reference: {
      leftOpen: false,
      leftWidth: 240,
      rightOpen: true,
      rightWidth: 304,
      order: ['projects', 'add', 'board'],
      open: { projects: true, add: true, board: true },
      grid: false,
    },
  };
}

function psShellClamp(n, min, max, fallback) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function psShellLoad() {
  const base = psShellDefaultState();
  let src = null;
  try {
    const raw = localStorage.getItem(PS_SHELL_KEY);
    if (raw) src = JSON.parse(raw);
  } catch {
    src = null;
  }
  if (!src || typeof src !== 'object') return base;

  if (src.mode === 'draw' || src.mode === 'reference') base.mode = src.mode;
  if (typeof src.lastDrawItem === 'string') base.lastDrawItem = src.lastDrawItem;

  for (const mode of ['draw', 'reference']) {
    const saved = src[mode];
    if (!saved || typeof saved !== 'object') continue;
    const target = base[mode];
    if (typeof saved.leftOpen === 'boolean') target.leftOpen = saved.leftOpen;
    if (typeof saved.rightOpen === 'boolean') target.rightOpen = saved.rightOpen;
    if (typeof saved.grid === 'boolean') target.grid = saved.grid;
    target.leftWidth = psShellClamp(saved.leftWidth, 160, 560, target.leftWidth);
    target.rightWidth = psShellClamp(saved.rightWidth, 180, 440, target.rightWidth);
    if (Array.isArray(saved.order)) {
      const valid = Object.keys(PS_PANEL_META).filter(key =>
        key === 'layers' || key === 'brush' || key === 'color' ? mode === 'draw' : mode === 'reference');
      const seen = new Set();
      const order = [];
      for (const key of saved.order) {
        if (valid.includes(key) && !seen.has(key)) { order.push(key); seen.add(key); }
      }
      for (const key of valid) if (!seen.has(key)) order.push(key);
      target.order = order;
    }
    if (saved.open && typeof saved.open === 'object') {
      for (const key of Object.keys(target.open)) {
        if (typeof saved.open[key] === 'boolean') target.open[key] = saved.open[key];
      }
    }
  }
  return base;
}

function psShellSaveSoon() {
  if (!psShell.ready) return;
  clearTimeout(psShell.saveTimer);
  psShell.saveTimer = setTimeout(() => {
    if (!psShell.state) return;
    try { localStorage.setItem(PS_SHELL_KEY, JSON.stringify(psShell.state)); }
    catch { /* depolama kapalıysa sessiz */ }
  }, PS_SHELL_SAVE_MS);
}

function psShellSaveNow() {
  clearTimeout(psShell.saveTimer);
  if (!psShell.state) return;
  try { localStorage.setItem(PS_SHELL_KEY, JSON.stringify(psShell.state)); }
  catch { /* sessiz */ }
}

function psShellIsDraw() {
  return document.body.classList.contains('mode-draw');
}

function psShellMode() {
  return psShellIsDraw() ? 'draw' : 'reference';
}

function psShellModeState(mode = psShellMode()) {
  return psShell.state[mode];
}

function psShellEl(id) {
  return document.getElementById(id);
}

function psShellPanelEl(key) {
  return document.querySelector('[data-ps-panel="' + key + '"]');
}

function psShellIcon(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-' + name + '"/></svg>';
}

/* =========================================================
   KURULUM
   ========================================================= */
function psShellBuild() {
  const right = psShellEl('inkRightDock');
  const left = psShellEl('inkLeftDock');
  const toolbox = psShellEl('inkToolbox');
  const modeBar = psShellEl('appModeBar');
  const shell = psShellEl('inkDrawShell');
  if (!right || !left || !toolbox || !modeBar) return false;

  document.body.append(right, left, toolbox);
  right.prepend(modeBar);
  if (shell) shell.style.display = 'none';

  psShellBuildDrawPanels();
  psShellBuildHistory();
  psShellBuildReferenceDock();
  psShellBuildOverlay();
  psShellMoveProjects();
  psShellEnsureChevrons();

  // Eski boyutlandırma tutamaçları yeni dock'lara ait değil.
  for (const id of ['inkResizeLeft', 'inkResizeRight']) {
    const old = psShellEl(id);
    if (old) old.style.display = 'none';
  }

  // Eski alt durum çubuğu ve kapsam şeridi gizli kalır; yeni bar okur.
  const oldScope = psShellEl('inkScopeBar');
  if (oldScope) oldScope.setAttribute('aria-hidden', 'true');

  return true;
}

function psShellBuildDrawPanels() {
  const stack = psShellEl('psDrawPanels');
  if (!stack) return;

  const layers = psShellEl('inkLayersPanel');
  const brush = psShellEl('inkBrushPanel');
  const color = psShellEl('inkColorPanel');
  const history = psShellEl('inkHistoryPanel');

  for (const [key, panel] of [['layers', layers], ['brush', brush], ['color', color]]) {
    if (!panel) continue;
    panel.hidden = false;
    stack.appendChild(panel);
    psShellPreparePanel(panel, key);
  }
  if (history) {
    history.hidden = false;
    psShellEl('psHistoryNote')?.remove();
  }
}

function psShellPreparePanel(panel, key) {
  const meta = PS_PANEL_META[key];
  const oldHead = panel.querySelector('.inkPanelHead');
  let countEl = null;
  let valueEl = null;
  if (oldHead) {
    countEl = oldHead.querySelector('#inkLayerCount');
    valueEl = oldHead.querySelector('#inkColorPanelValue');
    oldHead.remove();
  }

  let head = panel.querySelector('.psPanelHead');
  if (!head) {
    head = document.createElement('header');
    head.className = 'psPanelHead';
    head.dataset.psPanel = key;
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.draggable = true;
    head.innerHTML =
      '<span class="psPanelIcon" aria-hidden="true">' + psShellIcon(meta.icon) + '</span>' +
      '<span class="psPanelTitle">' + meta.title + '</span>' +
      '<span class="psPanelMeta"></span>' +
      '<span class="psChevron" aria-hidden="true"></span>';
    panel.prepend(head);
  }
  const metaSlot = head.querySelector('.psPanelMeta');
  if (countEl) {
    if (metaSlot) metaSlot.replaceWith(countEl);
    else head.appendChild(countEl);
    countEl.classList.add('psPanelMeta');
  } else if (valueEl) {
    if (metaSlot) metaSlot.replaceWith(valueEl);
    else head.appendChild(valueEl);
    valueEl.classList.add('psPanelMeta');
  }

  let body = panel.querySelector('.inkPanelBody, .inkColorPanelBody, .psAccBody');
  if (!body) {
    body = document.createElement('div');
    body.className = 'psAccBody';
    const move = [...panel.children].filter(node => node !== head);
    for (const node of move) body.appendChild(node);
    panel.appendChild(body);
  } else {
    body.classList.add('psAccBody');
  }
  body.id = body.id || ('psBody-' + key);
  head.setAttribute('aria-controls', body.id);
  head.setAttribute('aria-expanded', 'true');
  head.setAttribute('title', meta.title + ' panel open or close');
  if (!head.querySelector('.psChevron')) {
    const chevron = document.createElement('span');
    chevron.className = 'psChevron';
    chevron.setAttribute('aria-hidden', 'true');
    head.appendChild(chevron);
  }
  panel.classList.add('psAcc');
  panel.dataset.psPanel = key;
}

function psShellBuildHistory() {
  const history = psShellEl('inkHistoryPanel');
  if (!history) return;
  const pop = document.createElement('div');
  pop.id = 'psHistoryPopover';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'History');
  pop.innerHTML =
    '<header class="psPanelHead">' +
      '<span class="psPanelIcon" aria-hidden="true">' + psShellIcon('undo') + '</span>' +
      '<span class="psPanelTitle">History</span>' +
      '<button id="psHistoryClose" class="psIconBtn" type="button" title="Close" aria-label="Close history">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-close"/></svg>' +
      '</button>' +
    '</header>' +
    '<div id="psHistoryBody"></div>';
  pop.querySelector('#psHistoryBody').appendChild(history);
  history.hidden = false;
  document.body.appendChild(pop);
  pop.querySelector('#psHistoryClose')?.addEventListener('click', () => psShellSetHistory(false));
}

function psShellBuildReferenceDock() {
  // Statik referans panelindeki kapanma düğmesi.
  psShellEl('psLeftClose')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    psShellSetLeftOpen(false);
  });
}

function psShellBuildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'psRefOverlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Reference preview');
  overlay.innerHTML =
    '<div id="psRefOverlayHead">' +
      '<span id="psRefOverlayTitle">Referans</span>' +
      '<button id="psRefOverlayClose" type="button" title="Close" aria-label="Close reference">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-close"/></svg>' +
      '</button>' +
    '</div>' +
    '<div id="psRefOverlayBody"><img id="psRefOverlayImg" alt=""></div>';
  document.body.appendChild(overlay);

  overlay.querySelector('#psRefOverlayClose')?.addEventListener('click', () => {
    overlay.hidden = true;
  });

  const head = overlay.querySelector('#psRefOverlayHead');
  head.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    const rect = overlay.getBoundingClientRect();
    psShell.overlayDrag = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    try { head.setPointerCapture(event.pointerId); } catch { /* sentetik olay */ }
  });
  head.addEventListener('pointermove', event => {
    const drag = psShell.overlayDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = overlay.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - rect.width - 8, event.clientX - drag.dx));
    const top = Math.max(8, Math.min(innerHeight - rect.height - 8, event.clientY - drag.dy));
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
  });
  const end = event => {
    if (psShell.overlayDrag && psShell.overlayDrag.pointerId === event.pointerId) {
      psShell.overlayDrag = null;
    }
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}

function psShellMoveProjects() {
  /* Panolar referans modunda üstteki sekme çubuğundan yönetilir.
     Sağ panel referansta tamamen kapalı olduğu için sekmeleri oraya
     taşımak "+" (yeni pano) düğmesini erişilemez bırakıyordu. */
  const bar = psShellEl('projectBar');
  const tabs = psShellEl('projectTabs');
  const add = psShellEl('btnNewProject');
  if (!bar) return;
  if (tabs && tabs.parentElement !== bar) bar.insertBefore(tabs, bar.firstChild);
  if (add && add.parentElement !== bar) bar.appendChild(add);
  bar.style.display = '';
}

function psShellEnsureChevrons() {
  for (const panel of document.querySelectorAll('#psRefPanels .psAcc, #psReferencePanel')) {
    const head = panel.querySelector('.psPanelHead');
    if (!head) continue;
    if (!head.querySelector('.psChevron')) {
      const chevron = document.createElement('span');
      chevron.className = 'psChevron';
      chevron.setAttribute('aria-hidden', 'true');
      const close = head.querySelector('.psIconBtn');
      if (close) head.insertBefore(chevron, close);
      else head.appendChild(chevron);
    }
    if (!head.hasAttribute('tabindex')) head.tabIndex = 0;
    if (!head.hasAttribute('role')) head.setAttribute('role', 'button');
    head.draggable = true;
  }
}

/* =========================================================
   AKORDEON + SIRALAMA
   ========================================================= */
function psShellAccordionPanels(mode = psShellMode()) {
  const selector = mode === 'draw' ? '#psDrawPanels .psAcc' : '#psRefPanels .psAcc';
  return [...document.querySelectorAll(selector)];
}

function psShellBindAccordions() {
  for (const mode of ['draw', 'reference']) {
    for (const panel of psShellAccordionPanels(mode)) {
      const key = panel.dataset.psPanel;
      if (!key) continue;
      const head = panel.querySelector('.psPanelHead');
      const body = panel.querySelector('.psAccBody');
      if (!head || !body) continue;
      if (head.dataset.psBound === '1') continue;
      head.dataset.psBound = '1';
      head.dataset.psPanel = key;
      head.draggable = true;
      head.tabIndex = 0;
      head.setAttribute('role', 'button');
      head.setAttribute('aria-controls', body.id || ('psBody-' + key));
      head.addEventListener('click', event => {
        if (event.target.closest('button')) return;
        event.preventDefault();
        psShellToggleAccordion(panel, key);
      });
      head.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        psShellToggleAccordion(panel, key);
      });
      head.addEventListener('dragstart', event => {
        psShell.dragKey = key;
        panel.classList.add('is-dragging');
        try {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', key);
        } catch { /* sessiz */ }
      });
      head.addEventListener('dragend', () => {
        psShell.dragKey = '';
        panel.classList.remove('is-dragging');
        psShellClearDropMarks();
      });
      panel.addEventListener('dragover', event => {
        if (!psShell.dragKey || psShell.dragKey === key) return;
        event.preventDefault();
        try { event.dataTransfer.dropEffect = 'move'; } catch { /* sessiz */ }
        psShellClearDropMarks();
        const rect = panel.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        panel.classList.add(after ? 'is-drop-after' : 'is-drop-before');
      });
      panel.addEventListener('drop', event => {
        if (!psShell.dragKey || psShell.dragKey === key) return;
        event.preventDefault();
        const rect = panel.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        psShellReorder(psShell.dragKey, key, after);
        psShell.dragKey = '';
        psShellClearDropMarks();
      });
    }
  }
  // Sol referans paneli de katlanabilir (tercih kaydedilmez).
  const refPanel = psShellEl('psReferencePanel');
  if (refPanel && refPanel.dataset.psBound !== '1') {
    refPanel.dataset.psBound = '1';
    const head = refPanel.querySelector('.psPanelHead');
    if (head) {
      head.addEventListener('click', event => {
        if (event.target.closest('button')) return;
        event.preventDefault();
        refPanel.classList.toggle('is-collapsed');
        const open = !refPanel.classList.contains('is-collapsed');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        const body = refPanel.querySelector('.psAccBody');
        if (body) body.style.maxHeight = open ? '' : '0px';
      });
    }
  }
}

function psShellClearDropMarks() {
  document.querySelectorAll('.psAcc.is-drop-before, .psAcc.is-drop-after')
    .forEach(panel => panel.classList.remove('is-drop-before', 'is-drop-after'));
}

function psShellReorder(fromKey, toKey, after) {
  const mode = psShellMode();
  const st = psShellModeState(mode);
  const panel = psShellPanelEl(toKey);
  if (!panel) return;
  const stack = panel.parentElement;
  const order = st.order.filter(key => key !== fromKey);
  let index = order.indexOf(toKey);
  if (index < 0) index = order.length;
  order.splice(after ? index + 1 : index, 0, fromKey);
  st.order = order;
  psShellApplyPanelOrder(mode);
  psShellSaveSoon();
}

function psShellApplyPanelOrder(mode = psShellMode()) {
  const st = psShellModeState(mode);
  const stack = psShellEl(mode === 'draw' ? 'psDrawPanels' : 'psRefPanels');
  if (!stack) return;
  const map = new Map();
  for (const panel of stack.querySelectorAll(':scope > .psAcc')) {
    if (panel.dataset.psPanel) map.set(panel.dataset.psPanel, panel);
  }
  for (const key of st.order) {
    const panel = map.get(key);
    if (panel) { stack.appendChild(panel); map.delete(key); }
  }
  for (const panel of map.values()) stack.appendChild(panel);
}

function psShellToggleAccordion(panel, key, forceOpen) {
  if (!panel) return;
  const mode = psShellMode();
  const st = psShellModeState(mode);
  if (!st.open || typeof st.open[key] !== 'boolean') return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('is-collapsed');
  const body = panel.querySelector('.psAccBody');
  const head = panel.querySelector('.psPanelHead');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced || !body) {
    panel.classList.toggle('is-collapsed', !open);
    if (body) body.style.maxHeight = open ? '' : '0px';
  } else if (open) {
    panel.classList.remove('is-collapsed');
    body.style.maxHeight = '0px';
    requestAnimationFrame(() => {
      body.style.maxHeight = body.scrollHeight + 'px';
      setTimeout(() => {
        if (!panel.classList.contains('is-collapsed')) body.style.maxHeight = '';
      }, 240);
    });
  } else {
    body.style.maxHeight = body.scrollHeight + 'px';
    requestAnimationFrame(() => {
      panel.classList.add('is-collapsed');
      body.style.maxHeight = '0px';
    });
  }
  st.open[key] = open;
  if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
  psShellSaveSoon();
}

function psShellApplyPanelOpenStates(mode = psShellMode()) {
  for (const panel of psShellAccordionPanels(mode)) {
    const key = panel.dataset.psPanel;
    if (!key) continue;
    const open = psShellModeState(mode).open[key] !== false;
    panel.classList.toggle('is-collapsed', !open);
    const head = panel.querySelector('.psPanelHead');
    const body = panel.querySelector('.psAccBody');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) body.style.maxHeight = open ? '' : '0px';
  }
}

/* =========================================================
   MOD + DOCK GÖRÜNÜRLÜĞÜ
   ========================================================= */
function psShellApplyMode() {
  if (!psShell.ready) return;
  const mode = psShellMode();
  const draw = mode === 'draw';
  const st = psShellModeState(mode);

  const drawStack = psShellEl('psDrawPanels');
  const refStack = psShellEl('psRefPanels');
  if (drawStack) drawStack.hidden = !draw;
  if (refStack) refStack.hidden = draw;

  const refAdd = psShellEl('psRefAdd');
  const drawTools = psShellEl('psDrawTools');
  if (refAdd) refAdd.hidden = draw;
  if (drawTools) drawTools.hidden = !draw;

  const bar = psShellEl('bar');
  if (bar) bar.classList.toggle('ps-is-draw', draw);

  const modeLabel = psShellEl('psStatusMode');
  if (modeLabel) modeLabel.textContent = draw ? __t('Drawing') : __t('Reference');

  for (const action of document.querySelectorAll('#overflowMenu [data-ps-action="history"], #overflowMenu [data-ps-action="workspace"]')) {
    action.hidden = !draw;
  }

  psShellApplyPanelOrder(mode);
  psShellApplyPanelOpenStates(mode);
  psShellApplyDockWidths();
  psShellApplyDockVisibility();
  psShellSyncToolButtons();
  psShellSyncBrushVisibility();
  psShellSyncStatus();
  psShellSyncReferenceInfo();
  psShellApplyGridState();

  if (psShell.lastMode !== mode) {
    psShell.lastMode = mode;
    psShell.state.mode = mode;
    if (draw && typeof appModeUi !== 'undefined' && appModeUi.itemId) {
      psShell.state.lastDrawItem = appModeUi.itemId;
    }
    psShellSaveSoon();
  }
  psShellSyncViewportSoon();
}

function psShellApplyDockVisibility() {
  const mode = psShellMode();
  const st = psShellModeState(mode);
  const rightOpen = st.rightOpen !== false && !psShell.tabHidden;
  const leftOpen = mode === 'draw' && st.leftOpen !== false && !psShell.tabHidden;

  document.body.classList.toggle('ps-right-closed', !rightOpen);
  document.body.classList.toggle('ps-left-closed', !leftOpen);

  const panelsBtn = psShellEl('btnPanels');
  if (panelsBtn) {
    panelsBtn.setAttribute('aria-pressed', rightOpen && (mode !== 'draw' || leftOpen) ? 'true' : 'false');
    panelsBtn.dataset.tooltip = rightOpen || leftOpen ? __t('Hide panels (Tab)') : __t('Show panels (Tab)');
  }
  const collapse = psShellEl('psDockCollapse');
  if (collapse) {
    collapse.setAttribute('aria-pressed', rightOpen ? 'true' : 'false');
    collapse.title = rightOpen ? __t('Hide panels (Tab)') : __t('Show panels (Tab)');
  }
  const inspector = psShellEl('btnInspector');
  if (inspector) {
    if (mode === 'draw') {
      inspector.setAttribute('aria-pressed', rightOpen ? 'true' : 'false');
      inspector.title = rightOpen ? __t('Hide panels (Tab)') : __t('Show panels (Tab)');
    } else {
      inspector.title = __t('Open or close the properties panel');
    }
  }
  const rightHandle = psShellEl('psRightHandle');
  if (rightHandle) rightHandle.hidden = rightOpen;
  const leftHandle = psShellEl('psLeftHandle');
  if (leftHandle) leftHandle.hidden = leftOpen || mode !== 'draw';

  queueMicrotask(() => {
    if (typeof queueToolbarLayout === 'function') queueToolbarLayout();
  });
}

function psShellSetRightOpen(open, save = true) {
  const st = psShellModeState();
  st.rightOpen = !!open;
  if (open) psShell.tabHidden = false;
  if (save) psShellSaveSoon();
  psShellApplyDockVisibility();
  psShellSyncViewportSoon();
}

function psShellSetLeftOpen(open, save = true) {
  const st = psShellModeState();
  st.leftOpen = !!open;
  if (open) psShell.tabHidden = false;
  if (save) psShellSaveSoon();
  psShellApplyDockVisibility();
  psShellSyncViewportSoon();
}

function psShellToggleDocks() {
  const mode = psShellMode();
  const st = psShellModeState(mode);
  const anyVisible = !psShell.tabHidden &&
    (st.rightOpen || (mode === 'draw' && st.leftOpen));
  psShell.tabHidden = false;
  if (anyVisible) {
    st.rightOpen = false;
    if (mode === 'draw') st.leftOpen = false;
  } else {
    st.rightOpen = true;
    if (mode === 'draw') st.leftOpen = true;
  }
  psShellSaveSoon();
  psShellApplyDockVisibility();
  psShellSyncViewportSoon();
}

function psShellToggleTabDocks() {
  psShell.tabHidden = !psShell.tabHidden;
  psShellApplyDockVisibility();
  psShellSyncViewportSoon();
}

function psShellApplyDockWidths() {
  const st = psShellModeState();
  const vw = Math.max(320, window.innerWidth || 0);
  /* Ekran kırılımları `ui-shell.css` «Ekran kırılımları — dock genişlikleri»
     tablosuyla birebir aynıdır. Bu değerler inline CSS değişkeni olarak
     yazıldığı için stylesheet'teki media query'leri eziyor; tablo yokken
     pencere daraldığında paneller küçülmüyordu (yalnızca <720px'de
     sert bir düşüş oluyordu). */
  const rightCaps = [[480, 200], [620, 224], [780, 248], [980, 264], [1180, 284], [Infinity, 440]];
  const leftCaps  = [[480, 160], [620, 180], [780, 200], [980, 220], [1180, 240], [Infinity, 560]];
  /* CSS tablosu `max-width` kullandığı için sınırda küçültme uygulanır
     (1180 → 284). Bu yüzden karşılaştırma `<=` olmalı: `vw < lim` idi ve
     tam kırılım genişliğinde bir üst kaba (örn. 1180'de 440) atlıyordu. */
  const rightCap = rightCaps.find(([lim]) => vw <= lim)[1];
  const leftCap = leftCaps.find(([lim]) => vw <= lim)[1];
  let leftW;
  let rightW;
  if (vw < 720) {
    // Dar pencerede iki dock üst üste binmesin; kayıtlı genişlik korunur.
    leftW = 160;
    rightW = Math.max(150, Math.min(260, rightCap, Math.round(vw * 0.46)));
  } else {
    leftW = psShellClamp(st.leftWidth, Math.min(160, leftCap), Math.min(leftCap, Math.min(560, Math.round(vw * 0.4))), 194);
    rightW = psShellClamp(st.rightWidth, Math.min(180, rightCap), Math.min(rightCap, Math.min(440, Math.round(vw * 0.42))), st === psShell.state.reference ? 304 : 197);
  }
  document.documentElement.style.setProperty('--ps-left-w', leftW + 'px');
  document.documentElement.style.setProperty('--ps-right-w', rightW + 'px');
}

function psShellSyncViewportSoon() {
  if (!psShell.ready) return;
  clearTimeout(psShell.viewportTimer);
  psShell.viewportTimer = setTimeout(() => {
    if (typeof inkEditorSyncStatus === 'function') inkEditorSyncStatus();
    if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
    if (typeof inkLayoutDockSoon === 'function') inkLayoutDockSoon();
  }, 240);
}

/* =========================================================
   ARAÇ ÇUBUĞU
   ========================================================= */
function psShellBindToolbar() {
  for (const button of document.querySelectorAll('#psDrawTools [data-ps-tool]')) {
    button.addEventListener('click', event => {
      event.preventDefault();
      const tool = button.dataset.psTool;
      if (typeof inkSetTool !== 'function') return;
      inkSetTool(tool);
      psShellSyncToolButtons();
      psShellSyncBrushVisibility();
      if (typeof inkSyncUI === 'function') inkSyncUI();
    });
  }

  const zoomReset = () => psShellZoomReset();
  const zoomIn = () => psShellZoomBy(1.25);
  const zoomOut = () => psShellZoomBy(0.8);
  const fit = () => psShellFit();

  const btn100 = psShellEl('btn100');
  if (btn100) btn100.onclick = event => { event.preventDefault(); zoomReset(); };
  const btnZoomIn = psShellEl('btnZoomIn');
  if (btnZoomIn) btnZoomIn.onclick = event => { event.preventDefault(); zoomIn(); };
  const btnZoomOut = psShellEl('btnZoomOut');
  if (btnZoomOut) btnZoomOut.onclick = event => { event.preventDefault(); zoomOut(); };
  const btnFit = psShellEl('btnFit');
  if (btnFit) btnFit.onclick = event => { event.preventDefault(); fit(); };

  const btnGrid = psShellEl('btnGrid');
  if (btnGrid) btnGrid.onclick = event => {
    event.preventDefault();
    const grid = psShellEl('gridOverlay');
    if (grid) grid.hidden = !grid.hidden;
    const on = grid ? !grid.hidden : document.body.classList.contains('ps-grid-on');
    document.body.classList.toggle('ps-grid-on', on);
    const st = psShellModeState();
    st.grid = on;
    btnGrid.setAttribute('aria-pressed', on ? 'true' : 'false');
    psShellSaveSoon();
  };

  psShellEl('btnPanels')?.addEventListener('click', event => {
    event.preventDefault();
    psShellToggleDocks();
  });
  psShellEl('psDockCollapse')?.addEventListener('click', event => {
    event.preventDefault();
    psShellSetRightOpen(false);
  });
  psShellEl('psRightHandle')?.addEventListener('click', () => psShellSetRightOpen(true));
  psShellEl('psLeftHandle')?.addEventListener('click', () => psShellSetLeftOpen(true));

  psShellEl('psRefAddImage')?.addEventListener('click', () => psShellEl('btnAdd')?.click());
  psShellEl('psRefAddText')?.addEventListener('click', () => psShellEl('btnText')?.click());
  psShellEl('psRefNewCanvas')?.addEventListener('click', () => psShellOpenNewCanvas());
  psShellEl('psRefNewCanvas2')?.addEventListener('click', () => psShellOpenNewCanvas());

  psShellEl('psStatusZoom')?.addEventListener('click', () => psShellZoomReset());
  psShellEl('psStatusSize')?.addEventListener('click', () => psShellOpenNewCanvas());
  psShellEl('psStatusColor')?.addEventListener('click', () => {
    if (psShellIsDraw()) psShellEl('inkColorWell')?.click();
  });

  if (!(window.tailref && window.tailref.isDesktop)) {
    const top = psShellEl('btnTop');
    if (top) {
      top.disabled = true;
      top.title = 'Always on Top is only available in the desktop app';
    }
  }

  // Çizimde "Properties" düğmesi seçim paneli yerine sağ panel kolonunu açar.
  const inspector = psShellEl('btnInspector');
  if (inspector) {
    const baseInspector = inspector.onclick;
    inspector.onclick = event => {
      if (psShellIsDraw()) {
        event.preventDefault();
        psShellSetRightOpen(!psShellModeState().rightOpen);
        return;
      }
      if (typeof baseInspector === 'function') baseInspector.call(inspector, event);
    };
  }

  psShellBindOverflowActions();
  psShellBindReferenceDock();
  psShellBindStatusObservers();
  psShellBindPressureCurve();
}

/* =========================================================
   BASINÇ EĞRİSİ — 48 px mini düzenleyici
   ========================================================= */
function psShellPressureCurve() {
  const range = psShellEl('inkPressureCurve');
  const value = range ? Number(range.value) / 100 : 1;
  return Number.isFinite(value) ? Math.min(3, Math.max(0.2, value)) : 1;
}

function psShellSyncPressureCurve() {
  if (typeof psShellDrawPressureCurve === 'function') psShellDrawPressureCurve();
}

function psShellBindPressureCurve() {
  const canvas = psShellEl('psPressureCurve');
  const range = psShellEl('inkPressureCurve');
  const caption = psShellEl('psCurveValue');
  if (!canvas || !range) return;
  if (canvas.dataset.psBound === '1') return;
  canvas.dataset.psBound = '1';

  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    if (width < 24) return;
    const height = 48;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const css = getComputedStyle(document.documentElement);
    const border = css.getPropertyValue('--ps-border').trim() || 'rgba(255,255,255,.08)';
    const accent = css.getPropertyValue('--ps-accent').trim() || '#0A84FF';
    const text = css.getPropertyValue('--ps-text-tertiary').trim() || '#63636A';
    const pad = 8;
    const x0 = pad;
    const y0 = height - pad;
    const x1 = width - pad;
    const y1 = pad;

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const gy = y1 + ((y0 - y1) * i) / 3;
      ctx.beginPath();
      ctx.moveTo(x0, gy);
      ctx.lineTo(x1, gy);
      ctx.stroke();
    }

    const curve = psShellPressureCurve();
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const px = x0 + (x1 - x0) * t;
      const py = y0 - (y0 - y1) * Math.pow(t, curve);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.stroke();

    const midX = x0 + (x1 - x0) * 0.5;
    const midY = y0 - (y0 - y1) * Math.pow(0.5, curve);
    ctx.beginPath();
    ctx.arc(midX, midY, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(midX, midY, 6.2, 0, Math.PI * 2);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = '9px Inter, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('0', x0, height - 2);
    ctx.textAlign = 'right';
    ctx.fillText('1', x1, height - 2);
    ctx.textAlign = 'left';

    canvas.setAttribute('aria-valuenow', curve.toFixed(2));
    if (caption) {
      caption.textContent = curve < 0.85 ? __t('Soft') : curve > 1.25 ? __t('Hard') : __t('Linear');
    }
  };

  psShellDrawPressureCurve = draw;

  const setCurve = (curve, commit) => {
    const value = Math.round(Math.min(3, Math.max(0.2, curve)) * 100);
    range.value = String(value);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    if (commit) range.dispatchEvent(new Event('change', { bubbles: true }));
    draw();
  };

  const fromPointer = event => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.height) return;
    const target = Math.min(0.97, Math.max(0.02, 1 - (event.clientY - rect.top) / rect.height));
    // 0.5^n = hedef basınç → eğri üssü n.
    setCurve(Math.log(target) / Math.log(0.5), false);
  };

  let dragging = false;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* sentetik olay */ }
    fromPointer(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    fromPointer(event);
  });
  const end = event => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
    range.dispatchEvent(new Event('change', { bubbles: true }));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('keydown', event => {
    const current = psShellPressureCurve();
    if (event.key === 'Home') {
      event.preventDefault();
      setCurve(1, true);
      return;
    }
    const step = event.shiftKey ? 0.2 : 0.05;
    let next = current;
    if (event.key === 'ArrowUp') next = current + step;
    else if (event.key === 'ArrowDown') next = current - step;
    else return;
    event.preventDefault();
    setCurve(next, true);
  });

  canvas.addEventListener('dblclick', () => setCurve(1, true));

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => draw()).observe(canvas);
  }
  requestAnimationFrame(draw);
  setTimeout(draw, 120);
}

function psShellBindOverflowActions() {
  const menu = psShellEl('overflowMenu');
  if (!menu) return;
  menu.addEventListener('click', event => {
    const action = event.target.closest('[data-ps-action]');
    if (!action) return;
    event.preventDefault();
    const name = action.dataset.psAction;
    if (name === 'panels') psShellToggleDocks();
    else if (name === 'history') psShellSetHistory(true);
    else if (name === 'workspace') {
      if (typeof inkWorkspaceOpenMenu === 'function') inkWorkspaceOpenMenu();
    }
    if (typeof closeOverflowMenu === 'function') closeOverflowMenu();
  });
}

function psShellSyncToolButtons() {
  let tool = 'brush';
  try {
    if (typeof inkState === 'function') tool = inkState().tool || 'brush';
  } catch { /* sessiz */ }
  const map = {
    transform: 'btnToolSelect',
    marquee: 'btnToolSelect',
    lasso: 'btnToolSelect',
    brush: 'btnToolBrush',
    eraser: 'btnToolEraser',
  };
  const activeId = map[tool] || '';
  for (const button of document.querySelectorAll('#psDrawTools [data-ps-tool]')) {
    const on = button.id === activeId;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  // Dar pencerede yalnızca aktif araç çubukta kalır; seçim değişince
  // taşma yerleşimi yeniden hesaplanmalı.
  if (typeof queueToolbarLayout === 'function') queueToolbarLayout();
}

function psShellSyncBrushVisibility() {
  const panel = psShellEl('inkBrushPanel');
  if (!panel) return;
  let tool = 'brush';
  try {
    if (typeof inkState === 'function') tool = inkState().tool || 'brush';
  } catch { /* sessiz */ }
  const visible = tool === 'brush' || tool === 'eraser';
  panel.classList.toggle('ps-tool-hidden', !visible);
  panel.hidden = !visible;
}

function psShellZoomReset() {
  if (psShellIsDraw()) {
    if (typeof inkEditorZoomActual === 'function') inkEditorZoomActual();
  } else if (typeof zoomTo100 === 'function') {
    zoomTo100();
  }
  psShellSyncStatus();
}

function psShellZoomBy(factor) {
  if (psShellIsDraw()) {
    if (typeof inkEditorZoomBy === 'function') inkEditorZoomBy(factor);
  } else if (typeof zoomByFactor === 'function') {
    zoomByFactor(factor);
  }
  psShellSyncStatus();
}

function psShellFit() {
  if (psShellIsDraw()) {
    if (typeof inkEditorZoomFit === 'function') inkEditorZoomFit();
  } else if (typeof selection !== 'undefined' && selection.size && typeof frameSelection === 'function') {
    frameSelection();
  } else if (typeof fitAll === 'function') {
    fitAll();
  }
  psShellSyncStatus();
}

function psShellOpenNewCanvas() {
  if (typeof modeOpenNewCanvas === 'function') modeOpenNewCanvas();
}

function psShellApplyGridState() {
  const st = psShellModeState();
  document.body.classList.toggle('ps-grid-on', !!st.grid);
  const overlay = psShellEl('gridOverlay');
  if (overlay) overlay.hidden = !st.grid;
  const btn = psShellEl('btnGrid');
  if (btn) btn.setAttribute('aria-pressed', st.grid ? 'true' : 'false');
}

/* =========================================================
   DURUM ÇUBUĞU
   ========================================================= */
function psShellBindStatusObservers() {
  const scope = psShellEl('inkScopeBar');
  if (scope) {
    new MutationObserver(() => psShellSyncStatus())
      .observe(scope, { subtree: true, childList: true, characterData: true });
  }
  const zoom = psShellEl('zoom');
  if (zoom) {
    new MutationObserver(() => psShellSyncStatus())
      .observe(zoom, { subtree: true, childList: true, characterData: true });
  }
  const count = psShellEl('count');
  if (count) {
    new MutationObserver(() => psShellSyncStatus())
      .observe(count, { subtree: true, childList: true, characterData: true });
  }
}

function psShellSyncStatus() {
  if (!psShell.ready) return;
  const draw = psShellIsDraw();
  const zoomText = draw
    ? (psShellEl('inkZoomValue')?.textContent || '100%')
    : (psShellEl('zoom')?.textContent || '100%');

  let sizeText = __t('Infinite board');
  if (draw) {
    const raw = psShellEl('inkScopeSize')?.textContent || '';
    sizeText = raw && raw.trim() && raw.trim() !== '—' ? raw.trim() : __t('Canvas');
  } else if (typeof selectedImageItems === 'function') {
    const list = selectedImageItems();
    if (list.length === 1 && list[0]) {
      sizeText = Math.round(list[0].w) + ' × ' + Math.round(list[0].h) + ' px';
    }
  }

  const countText = psShellEl('count')?.textContent || '';
  const zoomValue = psShellEl('psStatusZoomValue');
  if (zoomValue) zoomValue.textContent = zoomText.trim() || '100%';
  const sizeValue = psShellEl('psStatusSizeValue');
  if (sizeValue) sizeValue.textContent = sizeText;
  const countValue = psShellEl('psStatusCount');
  if (countValue) countValue.textContent = countText;

  let color = '';
  try { color = typeof inkState === 'function' ? (inkState().color || '') : ''; } catch { /* sessiz */ }
  const swatch = psShellEl('psStatusColorSwatch');
  if (swatch && color) swatch.style.background = color;
  const colorBtn = psShellEl('psStatusColor');
  if (colorBtn) {
    colorBtn.title = draw ? __t('Active brush color') : __t('Active color');
    colorBtn.setAttribute('aria-label', colorBtn.title);
  }
  const zoomBtn = psShellEl('psStatusZoom');
  if (zoomBtn) zoomBtn.title = __t('Reset zoom (Ctrl+0)');
}

function psShellSyncReferenceInfo() {
  if (!psShell.ready) return;
  /* 700 ms'lik tick her seferinde aynı metni yeniden yazarak layout'u
     gereksiz kirletiyor; yalnızca değişince yaz (9 Kasım optimizasyonu). */
  const setText = (el, next) => {
    if (el && el.textContent !== next) el.textContent = next;
  };
  setText(psShellEl('psBoardCount'),
    (psShellEl('count')?.textContent || __t('0 items')).replace(/\s*öğe\s*$/i, '').trim() || '0');
  const sel = psShellEl('psBoardSelection');
  if (sel) {
    if (typeof selectedImageItems === 'function') {
      const list = selectedImageItems();
      setText(sel, !list.length ? __t('None')
        : list.length === 1 ? (list[0].title || '1 ' + __t('image'))
        : list.length + ' ' + __t('image'));
    }
  }
  setText(psShellEl('psBoardZoom'), psShellEl('zoom')?.textContent || '100%');
  const projectCount = psShellEl('psProjectCount');
  if (projectCount) {
    const n = typeof workspaceManager !== 'undefined' && workspaceManager.order
      ? workspaceManager.order.length
      : 0;
    setText(projectCount, String(n));
  }
}

/* Dil değişince durum çubuğu metinleri (dinamik yazım) yeniden çevrilsin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => {
    try { psShellSyncStatus(); psShellSyncReferenceInfo(); psShellApplyDockVisibility(); } catch { /* sessiz */ }
  });
}

/* =========================================================
   REFERANS PANOSU
   ========================================================= */
function psShellBindReferenceDock() {
  const list = psShellEl('psRefList');
  if (!list) return;
  // Tıklama ve sürükleme satır düzeyinde bağlanır; liste yenilense de dinleyici kalır.
  if (list.dataset.psBound === '1') return;
  list.dataset.psBound = '1';
  list.addEventListener('click', event => {
    const row = event.target.closest('.psRefItem');
    if (!row) return;
    event.preventDefault();
    psShellShowRefOverlay(row.dataset.src || '', row.dataset.name || 'Reference');
  });
  list.addEventListener('dragstart', event => {
    const row = event.target.closest('.psRefItem');
    if (!row) return;
    const payload = JSON.stringify({
      id: row.dataset.refId || '',
      src: row.dataset.src || '',
      name: row.dataset.name || 'Reference',
    });
    try {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-tailref-ref', payload);
      event.dataTransfer.setData('text/plain', row.dataset.name || 'Reference');
    } catch { /* sessiz */ }
  });

  window.addEventListener('dragover', event => {
    if (!event.dataTransfer) return;
    const types = [...event.dataTransfer.types];
    if (!types.includes('application/x-tailref-ref')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, true);
  window.addEventListener('drop', event => {
    if (!event.dataTransfer) return;
    let payload = '';
    try { payload = event.dataTransfer.getData('application/x-tailref-ref'); } catch { /* sessiz */ }
    if (!payload) return;
    event.preventDefault();
    try {
      const data = JSON.parse(payload);
      psShellShowRefOverlay(data.src || '', data.name || 'Reference', event.clientX, event.clientY);
    } catch { /* sessiz */ }
  }, true);

  psShellRefreshRefList();
  new MutationObserver(() => psShellScheduleRefList())
    .observe(psShellEl('world') || document.body, { childList: true, subtree: true });
  new MutationObserver(() => psShellSyncReferenceInfo())
    .observe(psShellEl('projectTabs') || document.body, { childList: true });
  setInterval(() => {
    if (!psShell.ready) return;
    psShellSyncReferenceInfo();
  }, 700);
}

function psShellScheduleRefList() {
  clearTimeout(psShell.refTimer);
  psShell.refTimer = setTimeout(psShellRefreshRefList, 220);
}

function psShellRefreshRefList() {
  const list = psShellEl('psRefList');
  if (!list) return;
  const empty = psShellEl('psRefEmpty');
  const count = psShellEl('psRefCount');
  const rows = [];
  const seen = new Set();

  for (const el of document.querySelectorAll('#world .item.is-image')) {
    const id = el.dataset.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const item = typeof getItem === 'function' ? getItem(id) : null;
    if (!item) continue;
    const img = el.querySelector('.media img');
    const src = img ? (img.currentSrc || img.src || '') : '';
    const name = item.title || el.title || 'Image';
    const w = Math.round(item.w || 0);
    const h = Math.round(item.h || 0);
    rows.push({ id, src, name, w, h });
  }

  list.replaceChildren();
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'psRefItem';
    el.draggable = true;
    el.setAttribute('role', 'listitem');
    el.dataset.refId = row.id;
    el.dataset.src = row.src;
    el.dataset.name = row.name;
    el.title = row.name + ' — click: preview, drag: drop onto canvas';
    const thumb = document.createElement('img');
    thumb.className = 'psRefThumb';
    thumb.alt = '';
    if (row.src) thumb.src = row.src;
    const meta = document.createElement('span');
    meta.className = 'psRefMeta';
    const name = document.createElement('b');
    name.textContent = row.name;
    const size = document.createElement('span');
    size.textContent = row.w && row.h ? row.w + ' × ' + row.h + ' px' : 'Image';
    meta.append(name, size);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'psRefOpen';
    open.title = 'Preview';
    open.setAttribute('aria-label', row.name + ' preview its reference');
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-ink-eye"/></svg>';
    el.append(thumb, meta, open);
    list.appendChild(el);
  }

  if (empty) empty.hidden = rows.length > 0;
  if (count) count.textContent = String(rows.length);
}

function psShellShowRefOverlay(src, title, x, y) {
  const overlay = psShellEl('psRefOverlay');
  const img = psShellEl('psRefOverlayImg');
  const label = psShellEl('psRefOverlayTitle');
  if (!overlay || !img) return;
  if (!src) return;
  img.src = src;
  img.alt = title || 'Reference';
  if (label) label.textContent = title || 'Reference';
  overlay.hidden = false;
  const rect = overlay.getBoundingClientRect();
  const width = rect.width || 360;
  const height = rect.height || 260;
  const px = Number.isFinite(x) ? x : (innerWidth - width) / 2;
  const py = Number.isFinite(y) ? y : (innerHeight - height) / 2;
  overlay.style.left = Math.max(8, Math.min(innerWidth - width - 8, px + 12)) + 'px';
  overlay.style.top = Math.max(8, Math.min(innerHeight - height - 8, py + 12)) + 'px';
}

/* =========================================================
   GEÇMİŞ
   ========================================================= */
function psShellSetHistory(open) {
  const pop = psShellEl('psHistoryPopover');
  if (!pop) return;
  pop.hidden = !open;
  if (open) {
    const panel = psShellEl('inkHistoryPanel');
    if (panel) panel.hidden = false;
    if (typeof inkWorkspaceScheduleHistory === 'function') inkWorkspaceScheduleHistory();
    if (typeof inkWorkspaceRefreshHistory === 'function') inkWorkspaceRefreshHistory();
  }
}

/* =========================================================
   BOYUTLANDIRMA
   ========================================================= */
function psShellBindResizers() {
  const left = psShellEl('psLeftResize');
  const right = psShellEl('psRightResize');
  psShellBindResizeHandle(left, 'left');
  psShellBindResizeHandle(right, 'right');
}

function psShellBindResizeHandle(handle, side) {
  if (!handle) return;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const st = psShellModeState();
    const startX = event.clientX;
    const start = side === 'left' ? st.leftWidth : st.rightWidth;
    const pointerId = event.pointerId;
    try { handle.setPointerCapture(pointerId); } catch { /* sentetik olay */ }
    document.body.classList.add('ps-resizing');

    const move = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      if (side === 'left') {
        /* Tutamaç artık panelin SOL kenarında: sola çekmek genişletir
           (dx işareti kenar taşınmasıyla birlikte çevrildi). */
        const max = innerWidth < 720 ? 160 : Math.max(160, Math.min(560, innerWidth * 0.4));
        st.leftWidth = psShellClamp(start - dx, 160, max, start);
        document.documentElement.style.setProperty('--ps-left-w', st.leftWidth + 'px');
      } else {
        /* Tutamaç artık sağ kenarda: sağa çekmek genişletir. */
        const min = innerWidth < 720 ? 160 : 180;
        const max = innerWidth < 720
          ? Math.max(160, Math.round(innerWidth * 0.46))
          : Math.min(440, Math.max(260, innerWidth * 0.42));
        st.rightWidth = psShellClamp(start + dx, min, max, start);
        document.documentElement.style.setProperty('--ps-right-w', st.rightWidth + 'px');
      }
      psShellSyncViewportSoon();
    };
    const end = endEvent => {
      if (endEvent.pointerId !== pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('ps-resizing');
      psShellSaveSoon();
      psShellSyncViewportSoon();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });

  handle.addEventListener('dblclick', () => {
    const st = psShellModeState();
    if (side === 'left') st.leftWidth = 194;
    else st.rightWidth = psShellIsDraw() ? 197 : 304;
    psShellApplyDockWidths();
    psShellSaveSoon();
    psShellSyncViewportSoon();
  });

  handle.addEventListener('keydown', event => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const st = psShellModeState();
    const current = side === 'left' ? st.leftWidth : st.rightWidth;
    let next = current;
    if (event.key === 'Home') next = side === 'left' ? 194 : (psShellIsDraw() ? 197 : 304);
    else {
      const grow = side === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
      const step = event.shiftKey ? 24 : 8;
      next = current + (grow ? step : -step);
    }
    if (side === 'left') st.leftWidth = psShellClamp(next, 160, 560, current);
    else st.rightWidth = psShellClamp(next, 180, 440, current);
    psShellApplyDockWidths();
    psShellSaveSoon();
    psShellSyncViewportSoon();
  });
}

/* =========================================================
   KISAYOLLAR
   ========================================================= */
function psShellBindShortcuts() {
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    // Fırça kütüphanesi açıkken kabuk kısayolları (Ctrl+1/2/0, Tab)
    // arkadaki çalışma alanını değiştirmesin.
    const nativeBrushRoot = document.getElementById('nativeBrushLibrary');
    if (nativeBrushRoot && !nativeBrushRoot.hidden) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey) {
      /* Faz 3a: mod geçişleri keymap 'shell' grubundan çözülür; keymap
         yoksa eski Ctrl+1/2/3 davranışı geçerli (parite). Ctrl+0 sabit. */
      const shellKey = event.key;
      let shellAct = '';
      if (shellKey && shellKey.length === 1) {
        if (window.tailrefKeymap) {
          shellAct = window.tailrefKeymap.actionFor('ctrl+' + shellKey.toLowerCase(), 'shell');
        } else if (shellKey === '1') shellAct = 'shell.drawMode';
        else if (shellKey === '2') shellAct = 'shell.referenceMode';
        else if (shellKey === '3') shellAct = 'shell.poseMode';
      }
      if (shellAct === 'shell.drawMode') {
        event.preventDefault();
        if (!psShellIsDraw()) {
          if (typeof modeActivateDraw === 'function') modeActivateDraw();
          else if (typeof modeEnterDraw === 'function') modeEnterDraw();
        }
        return;
      }
      if (shellAct === 'shell.referenceMode') {
        event.preventDefault();
        /* 3D'deyken Ctrl+2 hiçbir şey yapmıyordu (kullanıcı 3D'de mahsur
           kalıyordu). Sekme tıklamasıyla aynı davranış: 3D'den referansa
           çık; çizimdeyse çizimden çık. */
        if (typeof modeIs3d === 'function' && modeIs3d()) {
          if (typeof modeExit3d === 'function') modeExit3d({ toReference: true });
        } else if (psShellIsDraw() && typeof modeExitDraw === 'function') {
          modeExitDraw();
        }
        return;
      }
      if (shellAct === 'shell.poseMode') {
        /* 3D Poz kısayolu gerçek bir anahtar: mod 3D ise çık, değilse gir.
           (Sekme tıklaması sekme gibi davranmayı sürdürür; keymap etiketi
           "Toggle 3D pose panel" olduğu için kısayolun ikinci basışı
           çıkış yapmalı — aksi hâlde kullanıcı 3D'de mahsur kalır.) */
        event.preventDefault();
        if (typeof modeIs3d === 'function' && modeIs3d()) {
          if (typeof modeExit3d === 'function') modeExit3d();
        } else {
          document.getElementById('mode3dBtn')?.click();
        }
        return;
      }
      if (shellKey === '0') {
        event.preventDefault();
        psShellZoomReset();
        return;
      }
    }
    if (event.key === 'Tab' && !mod && !event.altKey && !event.shiftKey) {
      if (!psShellShouldToggleOnTab()) return;
      event.preventDefault();
      psShellToggleTabDocks();
    }
  }, true);
}

function psShellShouldToggleOnTab() {
  const active = document.activeElement;
  if (!active) return true;
  if (active.isContentEditable) return false;
  const tag = String(active.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return false;
  if (active.closest && active.closest('#bar, #inkRightDock, #inkLeftDock, #overflowMenu, #psHistoryPopover')) return false;
  return true;
}

/* =========================================================
   MOD GERİ YÜKLEME / GLOBAL SARMA
   ========================================================= */
function psShellRestoreMode() {
  let tries = 0;
  const tick = () => {
    if (typeof workspaceManager === 'undefined' || !workspaceManager || !workspaceManager.ready) {
      if (++tries < 80) { setTimeout(tick, 250); return; }
      return;
    }
    /* Kapanış sırasında mod "reference" olarak yazılabiliyor (editör
       kapanışı state'i referansa çekiyor). Kullanıcı son çizimini
       kaybetmesin: son çizim öğesi hâlâ duruyorsa doğrudan aç.
       3D modu bilinçli tercihtir; ona dokunma. */
    if (psShell.state.mode !== '3d' && psShell.state.lastDrawItem) {
      const item = typeof getItem === 'function' ? getItem(psShell.state.lastDrawItem) : null;
      if (item && item.kind === 'image' && typeof modeEnterDraw === 'function') {
        modeEnterDraw(item.id);
        return;
      }
    }
    psShellApplyMode();
  };
  tick();
}

function psShellWrapGlobals() {
  const wrap = (name, after) => {
    const base = window[name];
    if (typeof base !== 'function' || base.__psShellWrapped) return;
    const wrapped = function psShellWrappedCall() {
      const result = base.apply(this, arguments);
      try { after(result); } catch { /* UI yan etkisi çizimi durdurmasın */ }
      return result;
    };
    wrapped.__psShellWrapped = true;
    window[name] = wrapped;
  };

  wrap('inkSyncUI', () => {
    psShellSyncToolButtons();
    psShellSyncBrushVisibility();
    psShellSyncStatus();
    psShellSyncPressureCurve();
  });
  wrap('modeSyncUi', () => {
    if (!psShell.ready) return;
    psShellApplyMode();
    if (psShellIsDraw() && typeof appModeUi !== 'undefined' && appModeUi.itemId) {
      psShell.state.lastDrawItem = appModeUi.itemId;
      psShell.state.mode = 'draw';
      psShellSaveSoon();
    }
  });
  wrap('inkEditorSyncStatus', () => psShellSyncStatus());
  wrap('inkSyncScopeVisual', () => psShellSyncStatus());
}

/* =========================================================
   AÇILIŞ
   ========================================================= */
function psShellBoot() {
  if (psShell.ready) return;
  psShell.state = psShellLoad();
  if (!psShellBuild()) return;
  psShell.ready = true;
  document.body.classList.add('ps-ready');
  // Eski otomatik gizleme artıkları kalıcı çubuğu saklamasın.
  document.body.classList.remove('bar-hidden', 'bar-fading');
  psShellBindAccordions();
  psShellBindToolbar();
  psShellBindResizers();
  psShellBindShortcuts();
  psShellApplyMode();
  psShellWrapGlobals();
  psShellSyncStatus();
  psShellSyncReferenceInfo();
  psShellSaveNow();

  new MutationObserver(() => {
    if (!psShell.ready) return;
    const draw = psShellIsDraw();
    if (draw === psShell.lastDraw) return;
    psShell.lastDraw = draw;
    psShellApplyMode();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('tailref-project-changed', () => {
    psShellScheduleRefList();
    psShellSyncReferenceInfo();
    if (psShellIsDraw() && typeof appModeUi !== 'undefined' && appModeUi.itemId) {
      psShell.state.lastDrawItem = appModeUi.itemId;
      psShellSaveSoon();
    }
  });

  let dockResizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(dockResizeTimer);
    dockResizeTimer = setTimeout(() => {
      psShellApplyDockWidths();
      psShellSyncViewportSoon();
    }, 120);
  }, { passive: true });

  psShellRestoreMode();

  // Eski çalışma alanı panel görünürlüğü yeni kabuğu ezmesin.
  for (const fn of ['inkWorkspaceApplyPanels', 'inkWorkspaceApplyLayout', 'inkWorkspaceMoveDocks']) {
    if (typeof window[fn] === 'function') window[fn] = () => {};
  }
}

queueMicrotask(psShellBoot);
