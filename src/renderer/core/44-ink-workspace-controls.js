/* TailRef app · ink workspace · kısayollar, geçmiş, renk, tutamaçlar
   ------------------------------------------------------------------
   Bu dosya 42/43'teki çalışma alanı durumuna gerçek davranış ekler:
   kısayol eşlemesi, motorun undoStack/redoStack'iyle beslenen geçmiş,
   gerçek HSV çarkına bağlanan renk paneli ve sürüklenebilir genişlikler.
   ========================================================= */
'use strict';

function inkWorkspaceNormalizeKey(value) {
  if (typeof value !== 'string') return '';
  let key = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!key) return '';
  key = key.replace(/^control\+/, 'ctrl+').replace(/^cmd\+/, 'ctrl+').replace(/^meta\+/, 'ctrl+');
  if (key.includes('+')) {
    const parts = key.split('+');
    if (parts.length === 2 && parts[0] === 'ctrl' && parts[1].length === 1) return key;
    return '';
  }
  if (key.length === 1) return key;
  return '';
}

function inkWorkspaceEventSignature(event) {
  if (!event || event.altKey) return '';
  const key = String(event.key || '').toLowerCase();
  if (!key || key === 'dead' || key === 'unidentified') return '';
  if (INK_WS_FIXED_KEYS.has(key)) return '';
  if (event.shiftKey) return '';
  if (event.ctrlKey || event.metaKey) {
    if (key.length !== 1) return '';
    return 'ctrl+' + key;
  }
  if (key.length === 1) return key;
  return '';
}

function inkWorkspaceFindShortcutAction(signature) {
  if (!signature) return '';
  const st = inkWorkspaceUi.state;
  if (!st) return '';
  const found = INK_WS_SHORTCUT_DEFS.find(item => st.shortcuts[item.id] === signature);
  return found ? found.id : '';
}

function inkWorkspaceShortcutsAllowed() {
  if (typeof modeIsDraw === 'function' && !modeIsDraw()) return false;
  if (inkWorkspaceUi.menuOpen) return false;
  const ae = document.activeElement;
  // Yalnızca metin girişi kısayolları engeller; kaydırıcı/onay kutusu odakta
  // kalsa da Ctrl+Z çalışsın.
  const isTextField = ae && (
    ae.isContentEditable ||
    ae.tagName === 'TEXTAREA' ||
    (ae.tagName === 'INPUT' &&
      !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(ae.type || 'text'))
  );
  if (isTextField) return false;
  const modal = document.getElementById('newCanvasModal');
  if (modal && !modal.hidden) return false;
  return true;
}

function inkWorkspaceRunShortcut(action) {
  if (!action || !inkWorkspaceUi.state) return;
  const toolMap = {
    toolTransform: 'transform',
    toolMarquee: 'marquee',
    toolLasso: 'lasso',
    toolBrush: 'brush',
    toolPencil: 'pencil',
    toolEraser: 'eraser',
    toolShape: 'shape',
    toolText: 'text',
    toolEyedropper: 'eyedropper',
    toolGradient: 'gradient',
  };
  if (toolMap[action]) {
    /* Vuruş koruması: çizim sürerken araç kısayolu vuruşu iptal
       etmesin (inkSetTool → inkCancelStroke vuruşu öldürüyordu).
       Editörün canlı vuruşu (ui.stroke) da korunur — motor vuruşu
       değil, yarısı eski yarısı yeni fırçayla commit oluyordu. */
    const editorStroke = typeof inkEditorUi !== 'undefined' && inkEditorUi && inkEditorUi.stroke;
    if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform || editorStroke)) return;
    if (typeof inkSetTool === 'function') inkSetTool(toolMap[action]);
    return;
  }
  if (action === 'sizeDown' || action === 'sizeUp') {
    const ink = typeof inkState === 'function' ? inkState() : null;
    if (!ink) return;
    if (!['brush', 'pencil', 'eraser', 'shape'].includes(ink.tool)) return;
    const step = ink.size < 20 ? 1 : Math.max(2, Math.round(ink.size * 0.12));
    const min = typeof INK_MIN_SIZE === 'number' ? INK_MIN_SIZE : 1;
    const max = typeof INK_MAX_SIZE === 'number' ? INK_MAX_SIZE : 400;
    ink.size = clamp(ink.size + (action === 'sizeUp' ? step : -step), min, max);
    if (typeof inkSyncUI === 'function') inkSyncUI();
    return;
  }
  if (action === 'undo' || action === 'redo') {
    if (action === 'undo') {
      if (typeof undo === 'function') undo();
    } else if (typeof redo === 'function') {
      redo();
    }
    if (typeof inkSyncUI === 'function') inkSyncUI();
    return;
  }
  if (action === 'fit') {
    if (typeof inkEditorZoomFit === 'function') inkEditorZoomFit();
    return;
  }
  if (action === 'actual') {
    if (typeof inkEditorZoomActual === 'function') inkEditorZoomActual();
    return;
  }
  if (action === 'colorWheel') {
    const wheel = document.getElementById('inkColorWheel');
    if (wheel && !wheel.hidden) {
      if (typeof inkCloseColorWheel === 'function') inkCloseColorWheel();
      return;
    }
    const anchor = document.getElementById('btnInkColorWheelOpen') ||
      document.getElementById('inkColorWell');
    if (anchor && typeof inkOpenColorWheel === 'function') inkOpenColorWheel(anchor);
  }
  if (action === 'swapColors') {
    if (typeof inkCpSwapColors === 'function') inkCpSwapColors();
    return;
  }
}

function inkWorkspaceHandleShortcutCapture(event) {
  if (!inkWorkspaceUi.captureShortcut) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
  if (event.key === 'Escape') {
    inkWorkspaceUi.captureShortcut = '';
    inkWorkspaceShowConflict('');
    inkWorkspaceRenderShortcuts();
    return true;
  }
  if (event.key === 'Tab') return true;
  const signature = inkWorkspaceEventSignature(event);
  if (!signature) {
    inkWorkspaceShowConflict('Use a single letter, number or Ctrl+a key. Shift and Alt are fixed.');
    return true;
  }
  const id = inkWorkspaceUi.captureShortcut;
  const conflict = INK_WS_SHORTCUT_DEFS.find(item =>
    item.id !== id && inkWorkspaceUi.state.shortcuts[item.id] === signature);
  if (conflict) {
    inkWorkspaceShowConflict('“' + inkWorkspaceShortcutLabel(signature) + '” zaten “' +
      conflict.label + '” is in use for ');
    inkWorkspaceUi.captureShortcut = '';
    inkWorkspaceRenderShortcuts();
    return true;
  }
  inkWorkspaceUi.state.shortcuts[id] = signature;
  inkWorkspaceUi.captureShortcut = '';
  inkWorkspaceShowConflict('');
  inkWorkspaceRenderShortcuts();
  inkWorkspaceSaveNow();
  return true;
}

/** Motorun kendi işlediği varsayılan tuşlar. Bunlar değiştirilmediyse
    olay motorun dinleyicisine bırakılır; böylece U ile şekil döngüsü,
    [ ] ile oransal boyut adımı gibi davranışlar aynen korunur. */
const INK_WS_ENGINE_DEFAULTS = {
  toolTransform: 'v',
  toolMarquee: 'm',
  toolLasso: 'l',
  toolBrush: 'b',
  toolPencil: 'p',
  toolEraser: 'e',
  toolShape: 'u',
  toolText: 't',
  toolEyedropper: 'i',
  sizeDown: '[',
  sizeUp: ']',
  fit: '0',
  actual: '1',
};

/** Kısayol dinleyicisi motorun kendi dinleyicilerinden önce çalışır. Böylece
    kullanıcı bir kısayolu taşıdığında eski sabit tuş sessizce yutulur. */
function inkWorkspaceKeyHandler(event) {
  // Fırça kütüphanesi / oluşturucu açıkken uygulama kısayolları arayüzün
  // arkasında çalışmamalı; Ctrl+Z oluşturucunun test tuvaline gider.
  const nativeBrushRoot = document.getElementById('nativeBrushLibrary');
  if (nativeBrushRoot && !nativeBrushRoot.hidden) return;
  if (inkWorkspaceUi.captureShortcut) {
    inkWorkspaceHandleShortcutCapture(event);
    return;
  }
  if (inkWorkspaceUi.menuOpen && event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    inkWorkspaceCloseMenu();
    return;
  }
  /* K12 · metin alanında tuşlar kısayol değildir: çift-tık değer
     editörü (v5-opt-typed) ve alan/textarea girdileri tam yazım
     özgürlüğüne sahiptir — harf/rakam kısayol hattına düşmez. Kaydırıcı,
     onay kutusu, aralık ve düşme listesi (SELECT) metin değildir:
     Ctrl+Z/Ctrl+Y orada da yaşamalı (15-menu-export ile aynı yargı);
     yoksa paneldeki bir denetime dokunduktan sonra geri al sessizce ölüyor. */
  const aeKey = document.activeElement;
  const typeField = aeKey && (
    aeKey.isContentEditable ||
    aeKey.tagName === 'TEXTAREA' ||
    (aeKey.tagName === 'INPUT' &&
      !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(aeKey.type || 'text')));
  const modKey = event.ctrlKey || event.metaKey;
  const keyLower = String(event.key || '').toLowerCase();
  // Ctrl+Z / Ctrl+Y çizim modunda doğrudan burada işlenir. Tahta kısayolu
  // (15-menu-export) çizim modunda erken çıkıyor, motorun tuş dinleyicisi
  // ise Ctrl/Cmd tuşlarını yok sayıyordu; bu yüzden çizim editöründe
  // Ctrl+Z tamamen ölüydü. Kullanıcı kısayolu başka tuşa taşısa bile
  // standart geri al / yinele tuşları çalışmaya devam eder.
  if (modKey && !event.altKey && (keyLower === 'z' || keyLower === 'y')) {
    if (typeField) return;
    /* Vuruş koruması: canlı vuruş varken geri al yapılmaz — önceki
       commit geri dönüp üstüne canlı vuruş commit olunca yığın
       karışıyordu. Vuruş sürerken tuş yutulur. Editör vuruşu da sayılır. */
    const editorStroke = typeof inkEditorUi !== 'undefined' && inkEditorUi && inkEditorUi.stroke;
    if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform || editorStroke)) return;
    if (!inkWorkspaceShortcutsAllowed()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (keyLower === 'y' || event.shiftKey) {
      if (typeof redo === 'function') redo();
    } else if (typeof undo === 'function') {
      undo();
    }
    if (typeof inkSyncUI === 'function') inkSyncUI();
    return;
  }
  if (aeKey && (aeKey.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(aeKey.tagName))) return;
  if (!inkWorkspaceShortcutsAllowed()) return;
  const signature = inkWorkspaceEventSignature(event);
  if (!signature) return;
  const action = inkWorkspaceFindShortcutAction(signature);
  if (action) {
    if (INK_WS_ENGINE_DEFAULTS[action] === signature) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    inkWorkspaceRunShortcut(action);
    return;
  }
  if (INK_WS_ENGINE_KEYS.has(signature)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function inkWorkspaceBindShortcuts() {
  window.addEventListener('keydown', inkWorkspaceKeyHandler, true);
  /* Tur 4b: keymap delegasyonu — çizim grubunun tek kaynağı bu sistem
     kalır; keymap kendi kopyasını tutmaz (TODO-4b-keymap.md §4). */
  if (window.tailrefKeymap && !window.tailrefKeymap.__inkwsDelegate) {
    window.tailrefKeymap.registerDelegate('inkws', {
      get: id => (inkWorkspaceUi.state && inkWorkspaceUi.state.shortcuts[id]) || '',
      set: (id, sig) => {
        if (!inkWorkspaceUi.state) return { ok: false, error: 'state missing' };
        inkWorkspaceUi.state.shortcuts[id] = sig;
        inkWorkspaceSaveNow();
        return { ok: true };
      },
      reset: id => {
        if (!inkWorkspaceUi.state) return { ok: false, error: 'state missing' };
        const def = INK_WS_SHORTCUT_DEFS.find(item => item.id === id);
        if (!def) return { ok: false, error: 'unknown action' };
        inkWorkspaceUi.state.shortcuts[id] = INK_WS_DEFAULT_SHORTCUTS[id];
        inkWorkspaceSaveNow();
        return { ok: true, key: INK_WS_DEFAULT_SHORTCUTS[id] };
      },
    });
    window.tailrefKeymap.__inkwsDelegate = true;
  }
}

/* =========================================================
   geçmiş paneli · gerçek undoStack / redoStack
   ========================================================= */
function inkWorkspaceScheduleHistory() {
  clearTimeout(inkWorkspaceUi.historyTimer);
  inkWorkspaceUi.historyTimer = setTimeout(() => {
    inkWorkspaceUi.historyTimer = 0;
    inkWorkspaceRenderHistory();
  }, 24);
}

function inkWorkspaceHistoryKind(raw) {
  /* Profiler bulgusu: bu işlev her geçmiş-satır gördüğünde undoStack
     kaydının TAMAMINI JSON.parse ediyordu — vuruş XML'i yüzlerce nokta
     taşır, 60 kayıtlık dize her 24 ms'lik panel tazelemede yeniden
     ayrıştırılıp vuruş sırasında omurgayı ödünç veriyordu. Vuruş
     kayıtları daima {"__inkStroke":… ile başlar (pusUndoStroke tek
     üretici) → ilk 15 karakter insan parmak izi sınıflandırma içindir. */
  if (typeof raw === 'string' &&
      raw.startsWith('{"' + INK_UNDO_STROKE_KEY + '":')) return 'stroke';
  /* PROFİLER DÜZELTMESİ 2: vuruş olmayan kayıtlar (snapshot/duzenlenme)
     hâlâ her tazelerde JSON.parse ediliyordu (258 örnek). tür kararını
     ham kayıt metnine göre önbelleğe al — heap'te LRU 512 tavan. */
  const cache = inkWorkspaceHistoryKindCache;
  if (cache.has(raw)) return cache.get(raw);
  let kind = 'snapshot';
  try {
    const parsed = JSON.parse(raw);
    if (typeof inkStrokeEntry === 'function' && inkStrokeEntry(parsed)) kind = 'stroke';
  } catch { /* snapshot */ }
  if (cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(raw, kind);
  return kind;
}
const inkWorkspaceHistoryKindCache = new Map();

function inkWorkspaceHistoryLabel(raw) {
  return inkWorkspaceHistoryKind(raw) === 'stroke' ? 'Brush stroke' : 'Editing';
}

function inkWorkspaceHistoryRow(raw, kind, count) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'inkHistoryRow is-' + kind;
  row.dataset.historyKind = kind;
  row.dataset.historyCount = String(count);
  const icon = document.createElement('span');
  icon.className = 'inkHistoryIcon';
  icon.innerHTML = '<svg class="inkIcon" aria-hidden="true"><use href="#icon-' +
    (kind === 'undo' ? 'undo' : 'redo') + '"/></svg>';
  const label = document.createElement('span');
  label.className = 'inkHistoryLabel';
  label.textContent = inkWorkspaceHistoryLabel(raw);
  const meta = document.createElement('span');
  meta.className = 'inkHistoryMeta';
  meta.textContent = count === 1 ? '1 step' : count + ' steps';
  row.append(icon, label, meta);
  row.title = kind === 'undo'
    ? 'Undo up to here (' + count + ' steps)'
    : 'Redo up to here (' + count + ' steps)';
  return row;
}

function inkWorkspaceRenderHistory() {
  const list = document.getElementById('inkHistoryList');
  if (!list) return;
  const undoItems = Array.isArray(undoStack) ? undoStack : [];
  const redoItems = Array.isArray(redoStack) ? redoStack : [];
  const count = document.getElementById('inkHistoryCount');
  if (count) count.textContent = String(undoItems.length + redoItems.length);
  const undoBtn = document.getElementById('btnInkHistoryUndo');
  const redoBtn = document.getElementById('btnInkHistoryRedo');
  if (undoBtn) undoBtn.disabled = undoItems.length === 0;
  if (redoBtn) redoBtn.disabled = redoItems.length === 0;
  list.replaceChildren();

  if (!undoItems.length && !redoItems.length) {
    const empty = document.createElement('div');
    empty.className = 'inkHistoryEmpty';
    empty.textContent = 'No history yet · steps appear here after the first stroke.';
    list.appendChild(empty);
    return;
  }

  if (redoItems.length) {
    const head = document.createElement('div');
    head.className = 'inkHistoryHead';
    head.textContent = 'REDOABLE';
    list.appendChild(head);
    for (let i = redoItems.length - 1; i >= 0; i--) {
      list.appendChild(inkWorkspaceHistoryRow(redoItems[i], 'redo', redoItems.length - i));
    }
  }

  const now = document.createElement('div');
  now.className = 'inkHistoryNow';
  now.innerHTML = '<span class="inkHistoryDot" aria-hidden="true"></span><b>Now</b>';
  list.appendChild(now);

  if (undoItems.length) {
    const head = document.createElement('div');
    head.className = 'inkHistoryHead';
    head.textContent = 'RESTORABLE';
    list.appendChild(head);
    for (let i = undoItems.length - 1; i >= 0; i--) {
      list.appendChild(inkWorkspaceHistoryRow(undoItems[i], 'undo', undoItems.length - i));
    }
  }
}

function inkWorkspaceTravelHistory(kind, count) {
  /* Vuruş koruması: kalemle çizim sürerken avuç history satırına
     değerse belge vuruşun ORTASINDA zıplıyordu — canlı vuruşta geçiş
     yapılmaz (Ctrl+Z korumasının tık yolu). */
  if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) return;
  if (kind === 'undo' && typeof undo === 'function') {
    for (let i = 0; i < count; i++) {
      if (!undoStack.length) break;
      undo();
    }
  } else if (kind === 'redo' && typeof redo === 'function') {
    for (let i = 0; i < count; i++) {
      if (!redoStack.length) break;
      redo();
    }
  }
  if (typeof inkSyncUI === 'function') inkSyncUI();
}

/* =========================================================
   renk paneli · mevcut HSV çarkını kullanır
   ========================================================= */
function inkWorkspaceRenderColorSwatches() {
  const box = document.getElementById('inkColorPanelSwatches');
  if (!box) return;
  box.replaceChildren();
  for (const hex of INK_WS_SWATCHES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkColorChip';
    btn.dataset.color = hex;
    btn.style.background = hex;
    btn.title = hex.toUpperCase();
    btn.setAttribute('aria-label', hex.toUpperCase() + ' pick its color');
    box.appendChild(btn);
  }
}

function inkWorkspaceScheduleColor() {
  clearTimeout(inkWorkspaceUi.colorTimer);
  inkWorkspaceUi.colorTimer = setTimeout(() => {
    inkWorkspaceUi.colorTimer = 0;
    inkWorkspaceSyncColor();
  }, 24);
}

function inkWorkspaceSyncColor() {
  if (!inkWorkspaceUi.ready || typeof inkState !== 'function') return;
  const ink = inkState();
  const hex = String(ink.color || '#ff5a5f').toLowerCase();
  const value = hex.toUpperCase();
  const valueEl = document.getElementById('inkColorPanelValue');
  const hexEl = document.getElementById('inkColorPanelHex');
  const rgbEl = document.getElementById('inkColorPanelRgb');
  const swatch = document.getElementById('inkColorPanelSwatch');
  if (valueEl) valueEl.textContent = value;
  if (hexEl) hexEl.textContent = value;
  if (swatch) swatch.style.background = hex;
  if (rgbEl) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    rgbEl.textContent = 'RGB ' + r + ' · ' + g + ' · ' + b;
  }
  document.querySelectorAll('#inkColorPanelSwatches [data-color]').forEach(btn => {
    btn.classList.toggle('is-active', String(btn.dataset.color).toLowerCase() === hex);
  });
}

function inkWorkspaceBindPanels() {
  inkWorkspaceRenderColorSwatches();
  inkWorkspaceSyncColor();

  const swatches = document.getElementById('inkColorPanelSwatches');
  if (swatches) {
    swatches.addEventListener('click', event => {
      const t = event.target instanceof Element ? event.target : null;
      const btn = t && t.closest('[data-color]');
      if (!btn || typeof inkSetColor !== 'function') return;
      inkSetColor(btn.dataset.color, true);
      inkWorkspaceSyncColor();
    });
  }

  const wheelOpen = document.getElementById('btnInkColorWheelOpen');
  if (wheelOpen) {
    wheelOpen.addEventListener('click', event => {
      event.preventDefault();
      if (typeof inkOpenColorWheel === 'function') inkOpenColorWheel(wheelOpen);
    });
  }

  const undoBtn = document.getElementById('btnInkHistoryUndo');
  if (undoBtn) undoBtn.addEventListener('click', () => {
    /* Vuruş koruması: canlı vuruşta geri al (bkz. Ctrl+Z dalı). */
    if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) return;
    if (typeof undo === 'function') undo();
    if (typeof inkSyncUI === 'function') inkSyncUI();
  });
  const redoBtn = document.getElementById('btnInkHistoryRedo');
  if (redoBtn) redoBtn.addEventListener('click', () => {
    if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) return;
    if (typeof redo === 'function') redo();
    if (typeof inkSyncUI === 'function') inkSyncUI();
  });
  const history = document.getElementById('inkHistoryList');
  if (history) {
    history.addEventListener('click', event => {
      /* Vuruş koruması: avuç satıra değerse durum zıplamaz. */
      if (typeof inkPointer !== 'undefined' && (inkPointer || inkTransform)) return;
      const t = event.target instanceof Element ? event.target : null;
      const row = t && t.closest('[data-history-kind]');
      if (!row) return;
      inkWorkspaceTravelHistory(row.dataset.historyKind, Number(row.dataset.historyCount) || 1);
    });
  }
}

/* =========================================================
   genişlik tutamaçları
   ========================================================= */
function inkWorkspaceWidthFor(family) {
  return family === 'layers'
    ? inkWorkspaceUi.state.layersWidth
    : inkWorkspaceUi.state.brushWidth;
}

function inkWorkspaceResizeFamily(handle) {
  const left = handle && handle.id === 'inkResizeLeft';
  return left
    ? (inkWorkspaceUi.state.swap ? 'brush' : 'layers')
    : (inkWorkspaceUi.state.swap ? 'layers' : 'brush');
}

function inkWorkspaceBindResizers() {
  const handles = [
    document.getElementById('inkResizeLeft'),
    document.getElementById('inkResizeRight'),
  ].filter(Boolean);

  for (const handle of handles) {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !inkWorkspaceUi.state) return;
      event.preventDefault();
      const family = inkWorkspaceResizeFamily(handle);
      const left = handle.id === 'inkResizeLeft';
      inkWorkspaceUi.drag = {
        handle,
        family,
        left,
        startX: event.clientX,
        startWidth: inkWorkspaceWidthFor(family),
        nextWidth: inkWorkspaceWidthFor(family),
        raf: 0,
        pointerId: event.pointerId,
      };
      document.body.classList.add('ink-ws-resizing');
      try { handle.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
    });

    handle.addEventListener('pointermove', event => {
      const drag = inkWorkspaceUi.drag;
      if (!drag || drag.handle !== handle) return;
      const delta = drag.left
        ? event.clientX - drag.startX
        : drag.startX - event.clientX;
      const min = drag.family === 'layers' ? 200 : 200;
      const max = drag.family === 'layers' ? 360 : 380;
      drag.nextWidth = Math.round(clamp(drag.startWidth + delta, min, max));
      if (drag.raf) return;
      drag.raf = requestAnimationFrame(() => {
        drag.raf = 0;
        if (!inkWorkspaceUi.drag) return;
        inkWorkspaceSetWidth(drag.family, drag.nextWidth, false, false);
      });
    });

    const finish = event => {
      const drag = inkWorkspaceUi.drag;
      if (!drag || drag.handle !== handle) return;
      if (event && event.pointerId != null && drag.pointerId !== event.pointerId) return;
      if (drag.raf) cancelAnimationFrame(drag.raf);
      inkWorkspaceSetWidth(drag.family, drag.nextWidth, false, false);
      inkWorkspaceUi.drag = null;
      document.body.classList.remove('ink-ws-resizing');
      try { handle.releasePointerCapture(drag.pointerId); } catch { /* sessiz */ }
      inkWorkspaceSave();
      inkWorkspaceRefreshMenu();
      inkWorkspaceScheduleViewportSync();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);

    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      const family = inkWorkspaceResizeFamily(handle);
      inkWorkspaceSetWidth(family, family === 'layers' ? 240 : 272, true);
      inkWorkspaceSaveNow();
    });

    handle.addEventListener('keydown', event => {
      if (!inkWorkspaceUi.state) return;
      const keys = ['ArrowLeft', 'ArrowRight', 'Home'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const family = inkWorkspaceResizeFamily(handle);
      const defaults = { layers: 240, brush: 272 };
      const bounds = family === 'layers' ? { min: 200, max: 360 } : { min: 200, max: 380 };
      let next = inkWorkspaceWidthFor(family);
      if (event.key === 'Home') {
        next = defaults[family];
      } else {
        const grow = handle.id === 'inkResizeLeft'
          ? event.key === 'ArrowRight'
          : event.key === 'ArrowLeft';
        const step = event.shiftKey ? 24 : 8;
        next = clamp(next + (grow ? step : -step), bounds.min, bounds.max);
      }
      inkWorkspaceSetWidth(family, next, true);
      inkWorkspaceSaveNow();
    });
  }
}
