/* TailRef app · ink workspace · menü, geçmiş, renk, kısayollar
   ------------------------------------------------------------------
   42-ink-workspace.js durumunu görünür denetimlere bağlar. Menüde yalnızca
   gerçekten çalışan seçenekler vardır; hiçbir düğme dekoratif değildir.
   ========================================================= */
'use strict';

const INK_WS_SWATCHES = [
  '#111318', '#ffffff', '#ff5a5f', '#f08a3c', '#f2cf4a',
  '#48b774', '#39b9c8', '#4c8dff', '#8b6cf2', '#e56a8b',
];

function inkWorkspaceFindPreset(id) {
  return INK_WS_PRESETS.find(item => item.id === id) || null;
}

function inkWorkspaceLayoutEquals(a, b) {
  if (!a || !b) return false;
  return a.layersWidth === b.layersWidth &&
    a.brushWidth === b.brushWidth &&
    a.swap === b.swap &&
    a.density === b.density &&
    a.accent === b.accent &&
    ['layers', 'brush', 'color', 'history', 'advanced']
      .every(key => !!a.panels[key] === !!b.panels[key]);
}

function inkWorkspaceCustomLayout(item) {
  return item && item.layout ? inkWorkspaceSanitizeLayout(item.layout) : null;
}

function inkWorkspaceRenderPresets() {
  const box = document.getElementById('inkWsPresets');
  if (!box) return;
  const current = inkWorkspaceCaptureLayout();
  box.replaceChildren();
  for (const preset of INK_WS_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkWsPreset' +
      (inkWorkspaceLayoutEquals(current, inkWorkspaceSanitizeLayout(preset.layout)) ? ' is-active' : '');
    btn.dataset.wsPreset = preset.id;
    const name = document.createElement('b');
    name.textContent = preset.name;
    const hint = document.createElement('span');
    hint.textContent = preset.hint;
    btn.append(name, hint);
    box.appendChild(btn);
  }
}

function inkWorkspaceRenderCustomList() {
  const box = document.getElementById('inkWsCustomList');
  if (!box) return;
  const workspaces = inkWorkspaceUi.state.workspaces || [];
  box.replaceChildren();
  if (!workspaces.length) {
    const empty = document.createElement('p');
    empty.className = 'inkWsEmpty';
    empty.textContent = __t('No saved layouts yet.');
    box.appendChild(empty);
    return;
  }
  for (const item of workspaces) {
    const row = document.createElement('div');
    row.className = 'inkWsCustomRow';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'inkWsCustomApply';
    apply.dataset.wsCustom = item.id;
    const name = document.createElement('b');
    name.textContent = item.name;
    const hint = document.createElement('span');
    const layout = inkWorkspaceCustomLayout(item);
    hint.textContent = layout
      ? layout.layersWidth + ' / ' + layout.brushWidth + ' px · ' +
        (layout.density === 'tight' ? __t('Dense') : __t('Relaxed'))
      : __t('Layout');
    apply.append(name, hint);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'inkWsCustomDelete';
    del.dataset.wsDelete = item.id;
    del.title = __t('Delete layout');
    del.setAttribute('aria-label', __t('{name} delete layout', { name: item.name }));
    del.innerHTML = inkIcon('trash');
    row.append(apply, del);
    box.appendChild(row);
  }
}

function inkWorkspaceRenderTools() {
  const box = document.getElementById('inkWsTools');
  if (!box) return;
  const st = inkWorkspaceUi.state;
  box.replaceChildren();
  st.tools.forEach((id, index) => {
    const meta = INK_WS_TOOLS.find(item => item.id === id);
    if (!meta) return;
    const hidden = st.hiddenTools.includes(id);
    const row = document.createElement('div');
    row.className = 'inkWsToolRow' + (hidden ? ' is-hidden' : '');
    row.dataset.wsToolRow = id;
    row.draggable = true;

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'inkWsToolEye';
    eye.dataset.wsToolToggle = id;
    eye.title = hidden ? __t('Show tool') : __t('Hide tool');
    eye.setAttribute('aria-label', eye.title);
    eye.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    eye.innerHTML = inkIcon(hidden ? 'ink-eye-off' : 'ink-eye');

    const grip = document.createElement('span');
    grip.className = 'inkWsToolGrip';
    grip.setAttribute('aria-hidden', 'true');
    grip.textContent = '⋮⋮';

    const name = document.createElement('span');
    name.className = 'inkWsToolName';
    name.textContent = meta.label;

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'inkWsTinyBtn';
    up.dataset.wsToolUp = id;
    up.disabled = index === 0;
    up.title = __t('Move up');
    up.setAttribute('aria-label', __t('{name} tool up', { name: meta.label }));
    up.textContent = '↑';

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'inkWsTinyBtn';
    down.dataset.wsToolDown = id;
    down.disabled = index === st.tools.length - 1;
    down.title = __t('Move down');
    down.setAttribute('aria-label', __t('{name} tool down', { name: meta.label }));
    down.textContent = '↓';

    row.append(eye, grip, name, up, down);
    box.appendChild(row);
  });
}

function inkWorkspaceShortcutLabel(key) {
  if (!key) return '—';
  return String(key).split('+').map(part => {
    if (part === 'ctrl') return 'Ctrl';
    return part.length === 1 ? part.toUpperCase() : part;
  }).join('+');
}

/* ---- Faz 4b: kısayol listesi ARTIK iki kapsayıcıya da basılır ----
   Tek doğruluk kaynağı inkWorkspaceUi.state.shortcuts + INK_WS_SHORTCUT_DEFS;
   Çizim modu menüsü (#inkWsShortcuts) ve Ayarlar > Shortcuts
   (#settingsInkShortcuts) aynı render'ı paylaşır. */
const INK_WS_SHORTCUT_BOXES = ['inkWsShortcuts', 'settingsInkShortcuts'];

function inkWorkspaceRenderShortcuts() {
  const st = inkWorkspaceUi.state;
  if (!st) return;
  for (const boxId of INK_WS_SHORTCUT_BOXES) {
    const box = document.getElementById(boxId);
    if (!box) continue;
    box.replaceChildren();
    for (const item of INK_WS_SHORTCUT_DEFS) {
      const row = document.createElement('div');
      row.className = 'inkWsShortcutRow';
      const label = document.createElement('span');
      label.textContent = item.label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inkWsKbd' +
        (inkWorkspaceUi.captureShortcut === item.id ? ' is-capturing' : '');
      btn.dataset.wsShortcut = item.id;
      btn.textContent = inkWorkspaceUi.captureShortcut === item.id
        ? __t('Waiting for key…')
        : inkWorkspaceShortcutLabel(st.shortcuts[item.id]);
      /* Native title yasak (pill ile üst üste biniyor): data-tooltip kanalı. */
      btn.dataset.tooltip = __t('Change shortcut');
      btn.setAttribute('aria-label', __t('{name} shortcut: {key}. Press to change.', {
        name: item.label, key: inkWorkspaceShortcutLabel(st.shortcuts[item.id]),
      }));
      row.append(label, btn);
      /* Tekil sıfırlama: kısayol özelleştirilmişse ↺ göster — hub keymap
         satırlarıyla (60-settings-hub .is-reset) aynı kalıp. Bu yüzeyde
         reset hiç sunulmadığı için özelleştirilen ink kısayolu
         varsayılana geri döndürülemezdi. */
      if (st.shortcuts[item.id] !== item.fallback) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'inkWsKbd is-reset';
        reset.dataset.wsReset = item.id;
        reset.textContent = '↺';
        reset.dataset.tooltip = 'Reset to default (' +
          inkWorkspaceShortcutLabel(item.fallback) + ')';
        reset.setAttribute('aria-label', __t('{name} · Reset to default', { name: item.label }));
        row.append(reset);
      }
      box.appendChild(row);
    }
  }
}

function inkWorkspaceRenderAccents() {
  const box = document.getElementById('inkWsAccents');
  if (!box) return;
  const st = inkWorkspaceUi.state;
  box.replaceChildren();
  for (const accent of INK_WS_ACCENTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkWsAccent' + (st.accent === accent.id ? ' is-active' : '');
    btn.dataset.wsAccent = accent.id;
    btn.title = accent.label;
    btn.setAttribute('aria-label', accent.label + ' ' + __t('accent color'));
    btn.setAttribute('aria-pressed', st.accent === accent.id ? 'true' : 'false');
    btn.style.setProperty('--ws-swatch', accent.color);
    box.appendChild(btn);
  }
}

function inkWorkspaceRefreshMenu() {
  if (!inkWorkspaceUi.state) return;
  const st = inkWorkspaceUi.state;
  document.querySelectorAll('#inkWorkspaceMenu [data-ws-panel]').forEach(input => {
    input.checked = !!st.panels[input.dataset.wsPanel];
  });
  const swap = document.getElementById('inkWsSwap');
  if (swap) swap.checked = !!st.swap;
  const layersW = document.getElementById('inkWsLayersWidth');
  const brushW = document.getElementById('inkWsBrushWidth');
  if (layersW) {
    layersW.value = String(st.layersWidth);
    const out = document.getElementById('inkWsLayersWidthVal');
    if (out) out.textContent = st.layersWidth + ' px';
  }
  if (brushW) {
    brushW.value = String(st.brushWidth);
    const out = document.getElementById('inkWsBrushWidthVal');
    if (out) out.textContent = st.brushWidth + ' px';
  }
  document.querySelectorAll('input[name="inkWsDensity"]').forEach(input => {
    input.checked = input.value === st.density;
  });
  const note = document.getElementById('inkWsDensityNote');
  if (note) {
    const auto = st.density !== 'tight' && inkWorkspaceIsTight();
    note.textContent = st.density === 'tight'
      ? __t('Tight layout selected manually.')
      : auto
        ? __t('View auto-tightened in the small window.')
        : __t('Density auto-tightens in small windows.');
  }
  document.querySelectorAll('#inkWorkspaceMenu [data-ws-accent]').forEach(btn => {
    const on = btn.dataset.wsAccent === st.accent;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.querySelectorAll('#inkWsPresets [data-ws-preset]').forEach(btn => {
    const preset = inkWorkspaceFindPreset(btn.dataset.wsPreset);
    btn.classList.toggle('is-active', !!preset &&
      inkWorkspaceLayoutEquals(inkWorkspaceCaptureLayout(), inkWorkspaceSanitizeLayout(preset.layout)));
  });
  const trigger = document.getElementById('btnInkWorkspace');
  if (trigger) trigger.setAttribute('aria-expanded', inkWorkspaceUi.menuOpen ? 'true' : 'false');
}

function inkWorkspaceRenderMenu() {
  if (!inkWorkspaceUi.ready) return;
  inkWorkspaceRenderPresets();
  inkWorkspaceRenderCustomList();
  inkWorkspaceRenderTools();
  inkWorkspaceRenderShortcuts();
  inkWorkspaceRenderAccents();
  inkWorkspaceRefreshMenu();
}

/* Dil değişince menü metinleri (dinamik yazım) yeniden çevrilsin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { inkWorkspaceRefreshMenu(); } catch { /* sessiz */ } });
}

function inkWorkspaceNote(text, isError = false) {
  const note = document.getElementById('inkWsSaveNote');
  if (!note) return;
  note.textContent = text;
  note.classList.toggle('is-error', !!isError);
  clearTimeout(inkWorkspaceUi.noteTimer);
  inkWorkspaceUi.noteTimer = setTimeout(() => {
    note.textContent = __t('Saved layouts are stored on this device.');
    note.classList.remove('is-error');
  }, 3200);
}

function inkWorkspaceShowConflict(text) {
  /* Faz 4b: çakışma notu her iki kapsayıcıya da yansır. */
  for (const boxId of ['inkWsConflict', 'settingsInkConflict']) {
    const box = document.getElementById(boxId);
    if (!box) continue;
    box.textContent = text;
    box.hidden = !text;
  }
  clearTimeout(inkWorkspaceUi.conflictTimer);
  if (text) {
    inkWorkspaceUi.conflictTimer = setTimeout(() => {
      for (const boxId of ['inkWsConflict', 'settingsInkConflict']) {
        const box = document.getElementById(boxId);
        if (!box) continue;
        box.textContent = '';
        box.hidden = true;
      }
    }, 4200);
  }
}

function inkWorkspaceApplyCustom(id) {
  const st = inkWorkspaceUi.state;
  const item = (st.workspaces || []).find(ws => ws.id === id);
  if (!item) return;
  const layout = inkWorkspaceSanitizeLayout(item.layout);
  st.panels = { ...layout.panels };
  st.layersWidth = layout.layersWidth;
  st.brushWidth = layout.brushWidth;
  st.swap = layout.swap;
  st.density = layout.density;
  st.accent = layout.accent;

  if (layout.tools && layout.tools.length) st.tools = layout.tools.slice();
  if (Array.isArray(layout.hiddenTools)) {
    st.hiddenTools = layout.hiddenTools.filter(tool =>
      INK_WS_TOOLS.some(meta => meta.id === tool));
  }
  inkWorkspaceApply({ forcePanels: true });
  inkWorkspaceRenderMenu();
  inkWorkspaceSaveNow();
  inkWorkspaceNote('“' + item.name + ' layout applied.');
}

function inkWorkspaceSaveCustom() {
  const st = inkWorkspaceUi.state;
  const input = document.getElementById('inkWsName');
  if (!st || !input) return;
  const fallback = 'Layout ' + ((st.workspaces || []).length + 1);
  const name = (input.value || '').trim().slice(0, 32) || fallback;
  const layout = inkWorkspaceCaptureLayout();
  layout.tools = st.tools.slice();
  layout.hiddenTools = st.hiddenTools.slice();
  const item = {
    id: 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name,
    layout,
  };
  st.workspaces = (st.workspaces || []).concat(item).slice(-12);
  input.value = '';
  inkWorkspaceSaveNow();
  inkWorkspaceRenderMenu();
  inkWorkspaceNote('“' + name + __t('” saved.'));
}

function inkWorkspaceDeleteCustom(id) {
  const st = inkWorkspaceUi.state;
  const item = (st.workspaces || []).find(ws => ws.id === id);
  if (!item) return;
  st.workspaces = st.workspaces.filter(ws => ws.id !== id);
  inkWorkspaceSaveNow();
  inkWorkspaceRenderMenu();
  inkWorkspaceNote('“' + item.name + __t('” deleted.'));
}

function inkWorkspaceMoveTool(id, direction) {
  const st = inkWorkspaceUi.state;
  const index = st.tools.indexOf(id);
  if (index < 0) return;
  const next = index + direction;
  if (next < 0 || next >= st.tools.length) return;
  st.tools.splice(index, 1);
  st.tools.splice(next, 0, id);
  inkWorkspaceApplyTools();
  inkWorkspaceApplyLayout();
  inkWorkspaceRenderMenu();
  inkWorkspaceSave();
}

function inkWorkspaceToggleTool(id) {
  const st = inkWorkspaceUi.state;
  if (!INK_WS_TOOLS.some(item => item.id === id)) return;
  if (st.hiddenTools.includes(id)) st.hiddenTools = st.hiddenTools.filter(tool => tool !== id);
  else st.hiddenTools = st.hiddenTools.concat(id);
  inkWorkspaceApplyTools();
  inkWorkspaceRenderMenu();
  inkWorkspaceSave();
}

function inkWorkspaceDropTool(sourceId, targetId) {
  const st = inkWorkspaceUi.state;
  if (!sourceId || !targetId || sourceId === targetId) return;
  const from = st.tools.indexOf(sourceId);
  const to = st.tools.indexOf(targetId);
  if (from < 0 || to < 0) return;
  st.tools.splice(from, 1);
  st.tools.splice(to, 0, sourceId);
  inkWorkspaceApplyTools();
  inkWorkspaceRenderMenu();
  inkWorkspaceSave();
}

function inkWorkspaceBindMenu() {
  const trigger = document.getElementById('btnInkWorkspace');
  if (trigger) {
    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      inkWorkspaceToggleMenu();
    });
  }
  const close = document.getElementById('inkWsClose');
  const done = document.getElementById('inkWsDone');
  if (close) close.addEventListener('click', () => inkWorkspaceCloseMenu());
  if (done) done.addEventListener('click', () => inkWorkspaceCloseMenu());

  const reset = document.getElementById('inkWsReset');
  if (reset) reset.addEventListener('click', () => {
    inkWorkspaceReset();
    inkWorkspaceNote(__t('Returned to the default layout.'));
  });

  document.querySelectorAll('#inkWorkspaceMenu [data-ws-panel]').forEach(input => {
    input.addEventListener('change', () => {
      inkWorkspaceSetPanel(input.dataset.wsPanel, input.checked);
    });
  });

  const swap = document.getElementById('inkWsSwap');
  if (swap) swap.addEventListener('change', () => inkWorkspaceSetSwap(swap.checked));

  const layersW = document.getElementById('inkWsLayersWidth');
  if (layersW) {
    layersW.addEventListener('input', () => inkWorkspaceSetWidth('layers', layersW.value, false));
    layersW.addEventListener('change', () => inkWorkspaceSetWidth('layers', layersW.value, true));
  }
  const brushW = document.getElementById('inkWsBrushWidth');
  if (brushW) {
    brushW.addEventListener('input', () => inkWorkspaceSetWidth('brush', brushW.value, false));
    brushW.addEventListener('change', () => inkWorkspaceSetWidth('brush', brushW.value, true));
  }

  document.querySelectorAll('input[name="inkWsDensity"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) inkWorkspaceSetDensity(input.value);
    });
  });

  const presets = document.getElementById('inkWsPresets');
  if (presets) {
    presets.addEventListener('click', event => {
      const t = event.target instanceof Element ? event.target : null;
      const btn = t && t.closest('[data-ws-preset]');
      if (!btn) return;
      inkWorkspaceApplyPreset(btn.dataset.wsPreset);
      inkWorkspaceRenderMenu();
      inkWorkspaceNote('Preset layout applied.');
    });
  }

  const accents = document.getElementById('inkWsAccents');
  if (accents) {
    accents.addEventListener('click', event => {
      const t = event.target instanceof Element ? event.target : null;
      const btn = t && t.closest('[data-ws-accent]');
      if (!btn) return;
      inkWorkspaceSetAccent(btn.dataset.wsAccent);
      inkWorkspaceRenderMenu();
    });
  }

  const custom = document.getElementById('inkWsCustomList');
  if (custom) {
    custom.addEventListener('click', event => {
      const t = event.target instanceof Element ? event.target : null;
      if (!t) return;
      const apply = t.closest('[data-ws-custom]');
      if (apply) {
        inkWorkspaceApplyCustom(apply.dataset.wsCustom);
        return;
      }
      const del = t.closest('[data-ws-delete]');
      if (del) inkWorkspaceDeleteCustom(del.dataset.wsDelete);
    });
  }

  const save = document.getElementById('inkWsSave');
  if (save) save.addEventListener('click', inkWorkspaceSaveCustom);
  const name = document.getElementById('inkWsName');
  if (name) name.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    inkWorkspaceSaveCustom();
  });

  const tools = document.getElementById('inkWsTools');
  if (tools) {
    tools.addEventListener('click', event => {
      const t = event.target instanceof Element ? event.target : null;
      if (!t) return;
      const toggle = t.closest('[data-ws-tool-toggle]');
      if (toggle) { inkWorkspaceToggleTool(toggle.dataset.wsToolToggle); return; }
      const up = t.closest('[data-ws-tool-up]');
      if (up) { inkWorkspaceMoveTool(up.dataset.wsToolUp, -1); return; }
      const down = t.closest('[data-ws-tool-down]');
      if (down) inkWorkspaceMoveTool(down.dataset.wsToolDown, 1);
    });
    let dragTool = '';
    tools.addEventListener('dragstart', event => {
      const t = event.target instanceof Element ? event.target : null;
      const row = t && t.closest('[data-ws-tool-row]');
      if (!row) return;
      dragTool = row.dataset.wsToolRow;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragTool);
      }
      row.classList.add('is-dragging');
    });
    tools.addEventListener('dragover', event => {
      const t = event.target instanceof Element ? event.target : null;
      const row = t && t.closest('[data-ws-tool-row]');
      if (!row) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    tools.addEventListener('drop', event => {
      const t = event.target instanceof Element ? event.target : null;
      const row = t && t.closest('[data-ws-tool-row]');
      if (!row) return;
      event.preventDefault();
      inkWorkspaceDropTool(dragTool, row.dataset.wsToolRow);
      dragTool = '';
    });
    tools.addEventListener('dragend', () => {
      dragTool = '';
      tools.querySelectorAll('.is-dragging').forEach(row => row.classList.remove('is-dragging'));
    });
  }

  /* Faz 4b: yakalama tıklaması document düzeyinde delege — hem çizim
     menüsündeki (#inkWsShortcuts) hem Ayarlar'daki (#settingsInkShortcuts)
     [data-ws-shortcut] düğmeleri aynı kanaldan yakalamayı başlatır. */
  document.addEventListener('click', event => {
    const t = event.target instanceof Element ? event.target : null;
    const btn = t && t.closest('[data-ws-shortcut]');
    if (!btn) return;
    if (!inkWorkspaceUi.state) return;
    inkWorkspaceUi.captureShortcut = btn.dataset.wsShortcut;
    inkWorkspaceShowConflict('');
    inkWorkspaceRenderShortcuts();
  });

  /* ↺ tekil sıfırlama: keymap.reset delegasyona (23-keymap → 44 reset)
     yönlenir; iki yüzey de (menü + Ayarlar) tazeLenir. */
  document.addEventListener('click', event => {
    const t = event.target instanceof Element ? event.target : null;
    const btn = t && t.closest('[data-ws-reset]');
    if (!btn) return;
    const id = btn.dataset.wsReset;
    if (!id) return;
    if (window.tailrefKeymap && typeof window.tailrefKeymap.reset === 'function') {
      window.tailrefKeymap.reset(id);
    } else if (inkWorkspaceUi.state) {
      const def = INK_WS_SHORTCUT_DEFS.find(item => item.id === id);
      if (def) { inkWorkspaceUi.state.shortcuts[id] = def.fallback; inkWorkspaceSaveNow(); }
    }
    if (inkWorkspaceUi.captureShortcut === id) inkWorkspaceUi.captureShortcut = '';
    inkWorkspaceShowConflict('');
    inkWorkspaceRenderShortcuts();
  });

  document.addEventListener('pointerdown', event => {
    if (!inkWorkspaceUi.menuOpen) return;
    const t = event.target instanceof Element ? event.target : null;
    if (!t) return;
    if (t.closest('#inkWorkspaceMenu') || t.closest('#btnInkWorkspace')) return;
    inkWorkspaceCloseMenu();
  }, true);
}
