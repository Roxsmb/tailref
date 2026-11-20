/* TailRef app · merkezi keymap (Tur 4b — TODO-4b-keymap.md)
   ------------------------------------------------------------------
   Tahta/çizim/3D kısayollarının TEK doğruluk kaynağı. 4b.1: çekirdek
   modül + API; 4b.2 bağlama noktalarını bu tabloya bağlar.

   Tuş imzası biçimi (ink-workspace sistemiyle aynı):
     - tek karakter (küçük harf): 'b', '1', '?', '['
     - kombinasyon: 'ctrl+z'
     - adlandırılmış: 'f2' (rezerv)
   Alt ve Shift kombinasyonları kapalıdır (motor kuralı, bkz.
   42-ink-workspace.js INK_WS_EVENT_SIGNATURE).

   Kalıcılık: localStorage 'tailref-keymap' ({eylem id: imza}, düz map).
   Çizim grubunun 16 eylemi zaten 'tailref-ink-workspace-v1' içinde
   kalıcıdır (42/44-ink-workspace): keymap bunları delegasyonla okur/yazar
   — İKİNCİ bir kopya tutmaz. 4b.2'de ink-workspace kaydolunca devreye
   girer; kayıt yoksa tablo varsayılanları döner.
   ========================================================= */
'use strict';

const KEYMAP_STORAGE_KEY = 'tailref-keymap';
const KEYMAP_STORAGE_VERSION = 1;

/* Değiştirilemez tuşlar: mod/pan/iptal/dolaşma tuşları her modda motorun
   kalır; keymap bunlara bağlanamaz. (INK_WS_FIXED_KEYS ile aynı küme.) */
const KEYMAP_FIXED_KEYS = new Set([
  'escape', 'space', 'alt', 'delete', 'backspace', 'tab',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'shift', 'control', 'meta', 'capslock', 'enter',
]);

/* Eylem tablosu — FAZ 1 (TODO-4b-keymap.md §4): çizim (delege) + tahta +
   editör tek tuşları. FAZ 2: 3D pose. FAZ 3a: shell (mod geçişleri) +
   tahta kombinasyonları + layers.
   group: ink / board / editor / shell / layers / pose3d.
   label, l10n anahtarıdır (EN kimlik; 4b.4'te 10 dile çevrilir). */
const KEYMAP_DEFS = [
  /* --- Çizim grubu: 42/44 ink-workspace'e delege (FAZ 1'de zaten var) --- */
  { id: 'toolTransform', label: 'Move / Transform', defaultKey: 'v', group: 'ink', storage: 'inkws' },
  { id: 'toolMarquee', label: 'Rectangular selection', defaultKey: 'm', group: 'ink', storage: 'inkws' },
  { id: 'toolLasso', label: 'Lasso selection', defaultKey: 'l', group: 'ink', storage: 'inkws' },
  { id: 'toolBrush', label: 'Brush', defaultKey: 'b', group: 'ink', storage: 'inkws' },
  { id: 'toolPencil', label: 'Pencil', defaultKey: 'p', group: 'ink', storage: 'inkws' },
  { id: 'toolEraser', label: 'Eraser', defaultKey: 'e', group: 'ink', storage: 'inkws' },
  { id: 'toolShape', label: 'Shape', defaultKey: 'u', group: 'ink', storage: 'inkws' },
  { id: 'toolText', label: 'Text note (T)', defaultKey: 't', group: 'ink', storage: 'inkws' },
  { id: 'toolEyedropper', label: 'Eyedropper', defaultKey: 'i', group: 'ink', storage: 'inkws' },
  { id: 'toolGradient', label: 'Gradient', defaultKey: 'g', group: 'ink', storage: 'inkws' },
  { id: 'sizeDown', label: 'Shrink brush', defaultKey: '[', group: 'ink', storage: 'inkws' },
  { id: 'sizeUp', label: 'Grow brush', defaultKey: ']', group: 'ink', storage: 'inkws' },
  { id: 'fit', label: 'Fit to screen', defaultKey: '0', group: 'ink', storage: 'inkws' },
  { id: 'actual', label: 'Actual size', defaultKey: '1', group: 'ink', storage: 'inkws' },
  { id: 'colorWheel', label: 'Color wheel', defaultKey: 'c', group: 'ink', storage: 'inkws' },
  { id: 'swapColors', label: 'Swap colors', defaultKey: 'x', group: 'ink', storage: 'inkws' },
  { id: 'undo', label: 'Undo', defaultKey: 'ctrl+z', group: 'ink', storage: 'inkws' },
  { id: 'redo', label: 'Redo', defaultKey: 'ctrl+y', group: 'ink', storage: 'inkws' },

  /* --- Tahta grubu (kaynak: 15-menu-export.js tahta tablosu) --- */
  { id: 'board.fit', label: 'Fit selection or all', defaultKey: 'f', group: 'board', storage: 'keymap' },
  { id: 'board.toggleBar', label: 'Show or hide toolbar', defaultKey: 'h', group: 'board', storage: 'keymap' },
  { id: 'board.zoom100', label: 'Zoom 100%', defaultKey: '1', group: 'board', storage: 'keymap' },
  { id: 'board.addText', label: 'Add text', defaultKey: 't', group: 'board', storage: 'keymap' },
  { id: 'board.bringFront', label: 'Bring to front', defaultKey: 'b', group: 'board', storage: 'keymap' },
  { id: 'board.group', label: 'Group selection', defaultKey: 'g', group: 'board', storage: 'keymap' },
  { id: 'board.link', label: 'Toggle link', defaultKey: 'l', group: 'board', storage: 'keymap' },
  { id: 'board.important', label: 'Mark important', defaultKey: 'x', group: 'board', storage: 'keymap' },
  { id: 'board.bgLeft', label: 'Background dimmer', defaultKey: '[', group: 'board', storage: 'keymap' },
  { id: 'board.bgRight', label: 'Background brighter', defaultKey: ']', group: 'board', storage: 'keymap' },
  { id: 'board.help', label: 'Key help', defaultKey: '?', group: 'board', storage: 'keymap' },

  /* --- Tahta kombinasyonları (FAZ 3a · kaynak: 15-menu-export.js) ---
     Ctrl+Shift+Z paritesi bağlama noktasında özel işlenir (shift'li
     basış redo yapar; pose3d kalıbı). Ctrl+0/+/-/T sabit kalır. */
  { id: 'board.undo', label: 'Undo', defaultKey: 'ctrl+z', group: 'board', storage: 'keymap' },
  { id: 'board.redo', label: 'Redo', defaultKey: 'ctrl+y', group: 'board', storage: 'keymap' },
  { id: 'board.selectAll', label: 'Select all', defaultKey: 'ctrl+a', group: 'board', storage: 'keymap' },
  { id: 'board.duplicate', label: 'Duplicate selection', defaultKey: 'ctrl+d', group: 'board', storage: 'keymap' },
  { id: 'board.save', label: 'Save board', defaultKey: 'ctrl+s', group: 'board', storage: 'keymap' },
  { id: 'board.export', label: 'Export image', defaultKey: 'ctrl+e', group: 'board', storage: 'keymap' },
  { id: 'board.open', label: 'Open file', defaultKey: 'ctrl+o', group: 'board', storage: 'keymap' },
  { id: 'board.copy', label: 'Copy selection', defaultKey: 'ctrl+c', group: 'board', storage: 'keymap' },
  { id: 'board.cut', label: 'Cut selection', defaultKey: 'ctrl+x', group: 'board', storage: 'keymap' },
  { id: 'board.paste', label: 'Paste items', defaultKey: 'ctrl+v', group: 'board', storage: 'keymap' },

  /* --- Görüntü editörü grubu (kaynak: 36-ink-editor.js) --- */
  { id: 'editor.rotateView', label: 'Temporary rotate view', defaultKey: 'r', group: 'editor', storage: 'keymap' },
  { id: 'editor.freeTransform', label: 'Free transform', defaultKey: 'ctrl+t', group: 'editor', storage: 'keymap' },

  /* --- 3D Pose grubu (kaynak: pose3d/ui/PanelController.js bindKeys) ---
     Numpad görünüm presetleri (1/3/7/5/0/×) motor tuşlarıdır ve keymap
     imza motoru (tek karakter/ctrl+X) onları temsil edemediğinden
     sabit kalır; buradaki 0/5 düz digit karşılıklarıdır. Ctrl+Shift+Z
     (shift kombinasyonu) imza motorunda kapalı olduğundan panelde
     özel ele alınır: ctrl+z imzası undo'ya bağlanırken Shift'li
     basış parite olarak redo yapar (bkz. PanelController.bindKeys). */
  { id: 'pose3d.detach', label: 'Detach gizmo', defaultKey: 'q', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.move', label: 'Move gizmo', defaultKey: 'w', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.rotate', label: 'Rotate gizmo', defaultKey: 'e', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.grow', label: 'Grow controllers', defaultKey: 'r', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.axisX', label: 'Lock axis X', defaultKey: 'x', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.axisY', label: 'Lock axis Y', defaultKey: 'y', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.axisZ', label: 'Lock axis Z', defaultKey: 'z', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.axisAll', label: 'Free all axes', defaultKey: 'a', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.focus', label: 'Focus pose', defaultKey: 'f', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.cameraMode', label: 'Switch camera mode', defaultKey: '5', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.frameAll', label: 'Frame all poses', defaultKey: '0', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.undo', label: 'Undo pose', defaultKey: 'ctrl+z', group: 'pose3d', storage: 'keymap' },
  { id: 'pose3d.redo', label: 'Redo pose', defaultKey: 'ctrl+y', group: 'pose3d', storage: 'keymap' },

  /* --- Kabuk grubu (kaynak: 48-shell.js psShellBindShortcuts) ---
     Çalışma alanı mod geçişleri. Ctrl+0 (zoom sıfırla) ve Tab (dock)
     bilinçli sabittir. */
  { id: 'shell.drawMode', label: 'Switch to draw mode', defaultKey: 'ctrl+1', group: 'shell', storage: 'keymap' },
  { id: 'shell.referenceMode', label: 'Switch to reference mode', defaultKey: 'ctrl+2', group: 'shell', storage: 'keymap' },
  { id: 'shell.poseMode', label: 'Toggle 3D pose panel', defaultKey: 'ctrl+3', group: 'shell', storage: 'keymap' },

  /* --- Katman grubu (kaynak: 50-layer-stack.js) ---
     Shift+N (yeni katman) ve Ctrl+Shift+H (görünürlük) shift'li
     kombinasyonlardır ve imza motorunda kapalı olduğundan sabittir. */
  { id: 'layers.duplicate', label: 'Duplicate layer', defaultKey: 'ctrl+j', group: 'layers', storage: 'keymap' },
  { id: 'layers.moveUp', label: 'Move layer up', defaultKey: 'ctrl+]', group: 'layers', storage: 'keymap' },
  { id: 'layers.moveDown', label: 'Move layer down', defaultKey: 'ctrl+[', group: 'layers', storage: 'keymap' },
];

const KEYMAP_DEFS_BY_ID = (() => {
  const map = Object.create(null);
  for (const def of KEYMAP_DEFS) map[def.id] = def;
  return map;
})();

/* KeyboardEvent → imza. ink-workspace kuralıyla birebir: Alt/Shift
   kombinasyonu reddedilir; tek karakter ya da ctrl+<karakter> döner.
   Değiştirilemez tuşlar '' döner (keymap'e bağlanamaz). */
function keymapSignatureFromEvent(event) {
  if (!event || event.altKey) return '';
  const key = String(event.key || '').toLowerCase();
  if (!key || key === 'dead' || key === 'unidentified') return '';
  if (event.shiftKey && !(key.length === 1 && (event.ctrlKey || event.metaKey))) return '';
  if (event.ctrlKey || event.metaKey) {
    if (key.length !== 1) return '';
    return 'ctrl+' + key;
  }
  if (key.length === 1) return key;
  return '';
}

/* Aktif element bir metin girişi mi? Tahta/çizim handler'larındaki
   istisna listesiyle aynı (4b.3 kuralının tek kaynağı). */
function keymapIsTyping() {
  try {
    const ae = document.activeElement;
    if (!ae) return false;
    if (ae.isContentEditable) return true;
    if (ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT') return true;
    if (ae.tagName === 'INPUT' &&
      !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(ae.type || 'text')) return true;
    return false;
  } catch { return false; }
}

let keymapStoreCache = null;

function keymapReadStore() {
  /* Sıcak yol: keydown başına çağrılır; ayrıştırma bir kez yapılır,
     yazım/storage olayında tazelenir. */
  if (keymapStoreCache) return keymapStoreCache;
  try {
    const raw = localStorage.getItem(KEYMAP_STORAGE_KEY);
    if (!raw) { keymapStoreCache = {}; return keymapStoreCache; }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.actions !== 'object') {
      keymapStoreCache = {};
      return keymapStoreCache;
    }
    keymapStoreCache = parsed.actions;
    return keymapStoreCache;
  } catch {
    keymapStoreCache = {};
    return keymapStoreCache;
  }
}

function keymapWriteStore(actions) {
  try {
    localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify({
      version: KEYMAP_STORAGE_VERSION,
      actions,
    }));
    keymapStoreCache = actions;
    return true;
  } catch {
    keymapStoreCache = null;
    return false;
  }
}

/* Başka sekme/pencere yazarsa önbelleği bırak. */
try {
  window.addEventListener('storage', e => {
    if (!e || e.key === null || e.key === KEYMAP_STORAGE_KEY) keymapStoreCache = null;
  });
} catch { /* test ortamı */ }

function keymapEmit(type, detail) {
  try {
    window.dispatchEvent(new CustomEvent('tailref-keymap-' + type, { detail }));
  } catch { /* test ortamı */ }
}

window.tailrefKeymap = (function () {
  /* ink-workspace delegesi 4b.2'de kaydolur; kayıt yoksa tablo varsayılanı. */
  let inkwsDelegate = null;

  function defaultOf(def) {
    return def ? String(def.defaultKey || '') : '';
  }

  function inkwsGet(def) {
    if (inkwsDelegate && typeof inkwsDelegate.get === 'function') {
      try {
        const v = inkwsDelegate.get(def.id);
        if (typeof v === 'string' && v) return v;
      } catch { /* delegasyon yok: varsayılana düş */ }
    }
    return defaultOf(def);
  }

  function get(id) {
    const def = KEYMAP_DEFS_BY_ID[id];
    if (!def) return '';
    if (def.storage === 'inkws') return inkwsGet(def);
    const store = keymapReadStore();
    const v = store[id];
    return (typeof v === 'string' && v) ? v : defaultOf(def);
  }

  function set(id, key, opts) {
    const def = KEYMAP_DEFS_BY_ID[id];
    if (!def) return { ok: false, error: 'unknown action' };
    const sig = typeof key === 'string' ? key.toLowerCase() : '';
    if (!sig) return { ok: false, error: 'empty key' };
    if (KEYMAP_FIXED_KEYS.has(sig)) return { ok: false, error: 'fixed key' };
    if (sig.length > 1 && !sig.startsWith('ctrl+')) {
      return { ok: false, error: 'unsupported key' };
    }
    const hits = conflicts(sig, id);
    const block = hits.length && !(opts && opts.force);
    if (!block) {
      if (def.storage === 'inkws') {
        if (inkwsDelegate && typeof inkwsDelegate.set === 'function') {
          const res = inkwsDelegate.set(def.id, sig);
          if (res && res.ok === false) return res;
        } else {
          return { ok: false, error: 'delegate missing' };
        }
      } else {
        const store = keymapReadStore();
        store[id] = sig;
        keymapWriteStore(store);
      }
      keymapEmit('change', { id, key: sig, group: def.group });
    }
    return { ok: !block, key: sig, conflict: block ? hits[0] : (hits.length ? hits[0] : null) };
  }

  function reset(id) {
    const def = KEYMAP_DEFS_BY_ID[id];
    if (!def) return { ok: false, error: 'unknown action' };
    if (def.storage === 'inkws') {
      if (inkwsDelegate && typeof inkwsDelegate.reset === 'function') {
        const res = inkwsDelegate.reset(def.id);
        if (res && res.ok === false) return res;
      }
    } else {
      const store = keymapReadStore();
      if (id in store) { delete store[id]; keymapWriteStore(store); }
    }
    keymapEmit('change', { id, key: defaultOf(def), group: def.group, reset: true });
    return { ok: true, key: defaultOf(def) };
  }

  function resetAll() {
    for (const def of KEYMAP_DEFS) reset(def.id);
    return { ok: true };
  }

  /* Bu imzaya bağlı TÜM eylemler (iki mağaza birlikte). excludeId ile
     kendi kendini dışla; conflict raporu 4b.4 UI'ın kararıdır. */
  function conflicts(key, excludeId) {
    const sig = typeof key === 'string' ? key.toLowerCase() : '';
    if (!sig) return [];
    const out = [];
    for (const def of KEYMAP_DEFS) {
      if (excludeId && def.id === excludeId) continue;
      let v;
      if (def.storage === 'inkws') v = inkwsGet(def);
      else {
        const store = keymapReadStore();
        v = store[def.id];
        if (!(typeof v === 'string' && v)) v = defaultOf(def);
      }
      if (v === sig) out.push({ id: def.id, label: def.label, group: def.group });
    }
    return out;
  }

  /* Hızlı çözümleme (hot path — keydown'da çağrılır): imza → eylem id.
     all() tahsisi yapmaz; iki mağazayı da tarar. */
  function actionFor(sig, group) {
    const k = typeof sig === 'string' ? sig.toLowerCase() : '';
    if (!k) return '';
    for (const def of KEYMAP_DEFS) {
      if (group && def.group !== group) continue;
      let v;
      if (def.storage === 'inkws') v = inkwsGet(def);
      else {
        const store = keymapReadStore();
        v = store[def.id];
        if (!(typeof v === 'string' && v)) v = defaultOf(def);
      }
      if (v === k) return def.id;
    }
    return '';
  }

  function all() {
    return KEYMAP_DEFS.map(def => ({
      id: def.id,
      label: def.label,
      group: def.group,
      defaultKey: def.defaultKey,
      key: get(def.id),
    }));
  }

  /* ink-workspace (4b.2): delegasyon kaydı. Tek kaynak: mevcut sistem. */
  function registerDelegate(group, delegate) {
    if (group !== 'inkws' || !delegate || typeof delegate.get !== 'function') return false;
    inkwsDelegate = delegate;
    keymapEmit('delegate', { group });
    return true;
  }

  return {
    get, set, reset, resetAll, conflicts, all,
    actionFor,
    registerDelegate,
    signatureFromEvent: keymapSignatureFromEvent,
    isTyping: keymapIsTyping,
    isFixedKey: k => KEYMAP_FIXED_KEYS.has(String(k || '').toLowerCase()),
    defs: KEYMAP_DEFS,
  };
})();
