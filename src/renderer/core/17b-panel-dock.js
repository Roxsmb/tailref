/* TailRef app · panel docking / undocking controller
   ---------------------------------------------------------
   Ayrı panel penceresinin renderer tarafındaki tek denetleyicisi.
   Ana süreçteki PanelWindowManager yalnız pencereyi ve IPC'yi yönetir;
   hangi panelin taşınabileceği, kopyanın nasıl senkronlanacağı ve
   etkileşimin nasıl geri iletileceği burada tanımlıdır.

   Yetenek kaydı (adapter):
   • mirror      — DOM kopyası + delta snapshot + olay köprüsü
   • guest       — mirror + <webview> konuk köprüsü (Pinterest/ArtStation)
   • unsupported — mimari olarak aynalanamaz; panel uygulamada kalır */
'use strict';

const PANEL_DOCK_SPECS = {
  settings: {
    adapter: 'mirror', files: true, shortcuts: true,
    scroll: ['settingsNav', 'settingsPages'],
  },
  pomodoroPanel: { adapter: 'mirror' },
  youtubeMusicPanel: { adapter: 'mirror' },
  itemBar: { adapter: 'mirror' },
  help: { adapter: 'mirror' },
  inspector: { adapter: 'mirror' },
  pinterestPanel: { adapter: 'guest' },
  artstationPanel: { adapter: 'guest' },
  /* Çizim modu v5 panelleri: DOM kopyası + tuval raster köprüsü.
     `canvasSync`: 'always' → her turda (renk çarkı), 'once' → yapı
     yenilendiğinde bir kez (fırça kartı önizlemeleri).
     `ref`: panonun canlı görüntüsü ayrı üretilir. */
  v5ReferencePanel: { adapter: 'v5', canvasSync: 'none', ref: true },
  v5ColorPanel: { adapter: 'v5', canvasSync: 'always' },
  v5LayersPanel: { adapter: 'v5', canvasSync: 'once' },
  v5BrushPanel: { adapter: 'v5', canvasSync: 'once', files: true },
};
const DETACHABLE_PANEL_IDS = new Set(Object.keys(PANEL_DOCK_SPECS));

/* id → { observer, timer, opening, lastSnapshot, syncCount, closedWhileOpening } */
const detachedPanelState = new Map();
/* id → { width, height }: ayrı pencerede kullanıcının verdiği son görünür
   boyut; panel geri takılıp yeniden dışarı alındığında korunur. */
const detachedWindowSizes = new Map();

function panelDockSpec(panel) {
  return panel && PANEL_DOCK_SPECS[panel.id] || null;
}

function panelCanDetach(panel) {
  return !!panelDockSpec(panel)
    && !!(window.tailref && window.tailref.openPanelWindow);
}

function panelDockText(value) {
  try {
    if (window.L10N && typeof window.L10N.t === 'function') return window.L10N.t(value);
  } catch { /* sessiz */ }
  return value;
}

function panelDockToast(message) {
  try {
    if (typeof window.toast === 'function') window.toast(panelDockText(message), 5200);
  } catch { /* sessiz */ }
}

function panelSnapshotTitle(panel) {
  if (!panel) return 'Panel';
  const head = panel.querySelector('.v5-panel-title, .floatingPanelHead b, .ibTitle, .floatingPanelHead');
  const text = head && head.textContent ? head.textContent.replace(/⠿|×/g, '').trim() : '';
  return text || panel.getAttribute('aria-label') || 'Panel';
}

/* ---------- anlık görüntü (delta'ya hazır tam kayıt) ---------- */

const PANEL_ATTR_SKIP = new Set([
  'data-detached', 'data-floating-panel', 'data-floating-initialized',
  'data-panel-guest-bound', 'data-panel-fullscreen',
]);

function collectPanelAttrs(el) {
  let names = [];
  try { names = el.getAttributeNames(); } catch { return {}; }
  const attrs = {};
  for (const name of names) {
    if (!name.startsWith('aria-') && !name.startsWith('data-')) continue;
    if (PANEL_ATTR_SKIP.has(name)) continue;
    const value = el.getAttribute(name);
    /* Uzun açıklama metinleri (data-help) her turda taşınmasın. */
    if (value == null || value.length > 120) continue;
    attrs[name] = value;
  }
  return attrs;
}

function collectPanelSnapshot(panel) {
  const snapshot = {
    __theme: document.documentElement.dataset.theme || '',
    __panel: panel ? {
      hidden: !!panel.hidden,
      cls: typeof panel.className === 'string' ? panel.className : '',
      keyCapture: typeof window.tailrefSettingsKeyCaptureActive === 'function'
        ? !!window.tailrefSettingsKeyCaptureActive() : false,
    } : null,
  };
  if (!panel) return snapshot;
  const spec = panelDockSpec(panel);
  for (const el of panel.querySelectorAll('[id]')) {
    if (!el.id) continue;
    /* Konuk <webview> kopyası anlık görüntüyle yeniden yazılmaz; kendi
       oturumunda yaşamaya devam eder. */
    if (el.tagName === 'WEBVIEW') continue;
    const data = {};
    if (!el.children.length) data.text = el.textContent;
    const isForm = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    if (isForm && el.type !== 'file') data.value = el.value;
    if (el.type === 'checkbox' || el.type === 'radio') data.checked = !!el.checked;
    if (el.type === 'checkbox') data.indeterminate = !!el.indeterminate;
    data.disabled = !!el.disabled;
    data.hidden = !!el.hidden;
    data.title = el.title || '';
    if (typeof el.className === 'string') data.cls = el.className;
    data.style = el.getAttribute('style') || '';
    data.attrs = collectPanelAttrs(el);
    if ('open' in el) data.open = !!el.open;
    if (el.tagName === 'IFRAME') data.src = el.getAttribute('src') || '';
    if (spec && Array.isArray(spec.scroll) && spec.scroll.includes(el.id) && !panel.hidden) {
      data.scrollTop = el.scrollTop;
      data.scrollLeft = el.scrollLeft;
    }
    snapshot[el.id] = data;
  }
  return snapshot;
}

function snapshotDataEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const key of Object.keys(b)) {
    if (key === 'attrs') {
      const aa = a.attrs || {};
      const bb = b.attrs || {};
      const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
      for (const name of keys) if (aa[name] !== bb[name]) return false;
      continue;
    }
    if (!Object.is(a[key], b[key])) return false;
  }
  for (const key of Object.keys(a)) if (!(key in b)) return false;
  return true;
}

/* Tam kayıtları karşılaştırır; yalnız değişen alanları döndürür.
   İlk kayıt (prev yok) tam gönderilir. */
function diffPanelSnapshot(prev, next) {
  if (!prev) return { ...next, __full: true };
  const out = {};
  if (prev.__theme !== next.__theme) out.__theme = next.__theme;
  if (!snapshotDataEqual(prev.__panel, next.__panel)) out.__panel = next.__panel;
  const els = {};
  for (const [id, data] of Object.entries(next)) {
    if (id.startsWith('__')) continue;
    const before = prev[id];
    if (!before) { els[id] = data; continue; }
    const delta = {};
    for (const key of Object.keys(data)) {
      if (key === 'attrs') {
        const aa = before.attrs || {};
        const bb = data.attrs || {};
        const attrs = {};
        let changed = false;
        for (const name of Object.keys(bb)) {
          if (aa[name] !== bb[name]) { attrs[name] = bb[name]; changed = true; }
        }
        for (const name of Object.keys(aa)) {
          if (!(name in bb)) { attrs[name] = null; changed = true; }
        }
        if (changed) delta.attrs = attrs;
      } else if (!Object.is(before[key], data[key])) {
        delta[key] = data[key];
      }
    }
    if (Object.keys(delta).length) els[id] = delta;
  }
  const removed = [];
  for (const id of Object.keys(prev)) {
    if (id.startsWith('__')) continue;
    if (!(id in next)) removed.push(id);
  }
  if (removed.length) out.__removed = removed;
  if (Object.keys(els).length) out.els = els;
  if (out.__theme === undefined && out.__panel === undefined
      && !out.els && !out.__removed) return null;
  return out;
}

/* ---------- v5 panelleri: kararlı çocuk yolu + tuval raster köprüsü ----------
   v5 panelleri iç içe canvas'larla çizilir (renk çarkı, fırça kartı
   önizlemeleri). DOM kopyası piksel taşımaz; yolları birebir aynı olan
   kopya tuvallerine data URL ile boyanır. */
function panelPathOf(panel, element) {
  if (!panel || !element || element === panel || !panel.contains(element)) return null;
  const path = [];
  let node = element;
  while (node && node !== panel) {
    const parent = node.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, node);
    if (index < 0) return null;
    path.unshift(index);
    if (path.length > 48) return null;
    node = parent;
  }
  return node === panel && path.length ? path : null;
}

function collectV5Canvases(panel, spec, state, force = false) {
  if (!spec || spec.adapter !== 'v5' || spec.canvasSync === 'none') return null;
  const now = Date.now();
  if (!force && spec.canvasSync !== 'always' && now - (state.canvasAt || 0) < 1600) {
    return null;
  }
  state.canvasAt = now;
  const out = {};
  let count = 0;
  for (const canvas of panel.querySelectorAll('canvas')) {
    if (count >= 48) break;
    if (!canvas.width || !canvas.height) continue;
    /* Çok büyük tualler (desen önizlemeleri) her turda kodlanmasın. */
    if (canvas.width * canvas.height > 900 * 900) continue;
    const path = panelPathOf(panel, canvas);
    if (!path) continue;
    let url = '';
    try { url = canvas.toDataURL('image/webp', 0.82); } catch { url = ''; }
    if (!url) continue;
    out[path.join('/')] = url;
    count += 1;
  }
  return out;
}

/* Ayrı penceredeki kopya, v5 stillerinin kapsamı olan #v5DrawUI
   sarmalayıcısıyla gönderilir; aksi halde panel biçimsiz görünür. */
function v5PanelWindowHtml(panel) {
  const copy = panel.cloneNode(true);
  copy.removeAttribute('hidden');
  copy.hidden = false;
  try { delete copy.dataset.detached; } catch { /* sessiz */ }
  copy.classList.remove('is-dragging', 'is-floating', 'v5-detached-probe');
  for (const prop of ['display', 'left', 'top', 'right', 'bottom',
    'width', 'height', 'transform', 'z-index']) {
    copy.style.removeProperty(prop);
  }
  return '<div id="v5DrawUI" class="v5-window-root">' + copy.outerHTML + '</div>';
}

/* Yapısal değişim (ör. Ayarlar'da sayfa değişimi) kopyaya yalnız veri
   olarak taşınamaz. Böyle durumlarda panelin temiz bir HTML kopyası
   gönderilir; kopya yeniden kurulur. `hidden` taşınmaz: ayrı panelin ana
   penceredeki aslı zaten gizlidir. */
function panelHtmlSnapshot(panel) {
  const spec = panelDockSpec(panel);
  if (spec && spec.adapter === 'v5') return v5PanelWindowHtml(panel);
  const copy = panel.cloneNode(true);
  copy.removeAttribute('hidden');
  copy.hidden = false;
  try { delete copy.dataset.detached; } catch { /* sessiz */ }
  /* Konuk <webview> kopyaya asla taşınmaz (kendi oturumu vardır). */
  for (const view of copy.querySelectorAll('webview')) view.remove();
  return copy.outerHTML;
}

function sendPanelSnapshot(panel, id, state, forceFull = false) {
  if (!panel || panel.dataset.detached !== '1' || state.opening) return;
  if (!window.tailref || !window.tailref.syncPanelWindow) return;
  const spec = panelDockSpec(panel);
  const full = collectPanelSnapshot(panel);
  state.syncCount = (state.syncCount || 0) + 1;
  /* Her ~20 sn'de bir tam kayıt: kaçırılan bir delta kalıcı sapmaya
     dönüşmesin (pencere yeniden yüklenirse de kendini onarır). */
  const shootFull = forceFull || !state.lastSnapshot || state.syncCount % 50 === 0;
  /* Yapı değişimi: en fazla 400 ms'de bir yeniden kur (sınırsız churn yok).
     Sık yeniden üretilen listeler (ör. kısayol satırları) aynı HTML'i
     üretiyorsa kopyayı boşuna yeniden kurmayız: odak/kaydırma korunur. */
  const now = Date.now();
  let restructure = !!state.structDirty
    && !!spec && spec.adapter !== 'guest'
    && now - (state.lastHtmlAt || 0) >= 400;
  let html = null;
  if (restructure) {
    const candidate = panelHtmlSnapshot(panel);
    if (candidate === state.lastHtml) {
      restructure = false;
    } else {
      html = candidate;
      state.lastHtml = candidate;
    }
    state.structDirty = false;
    state.lastHtmlAt = now;
  }
  let delta = (shootFull || restructure)
    ? { ...full, __full: true }
    : diffPanelSnapshot(state.lastSnapshot, full);
  state.lastSnapshot = full;

  /* Tuval pikselleri ayrı taşınır: kopya yeniden kurulduysa tüm tuvaller
     yeniden boyanmalı, aksi halde kopyadaki canvas'lar boş kalır. Pencere
     yüklenmeden gönderilen güncellemeler kaybolabilir; açılış penceresinde
     tüm tuvaller her turda yeniden gönderilir. */
  if (html) state.canvasCache = null;
  const beforeReady = Date.now() < (state.windowReadyAt || 0);
  const canvases = collectV5Canvases(panel, spec, state, !!html || shootFull || beforeReady);
  if (canvases) {
    const previous = state.canvasCache || {};
    const changed = {};
    let any = false;
    for (const [key, url] of Object.entries(canvases)) {
      if (beforeReady || previous[key] !== url) { changed[key] = url; any = true; }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in canvases)) { changed[key] = null; any = true; }
    }
    state.canvasCache = canvases;
    if (any) (delta || (delta = {})).__canvases = changed;
  }

  /* Referans panelinin canlı tahta görüntüsü. Pencere açılışı sırasında
     gönderim kaybolabilir; bu yüzden görüntü anahtarını önbelleğe alıp
     tek sefer göndermek yerine her turda tazelenir (kopya aynı URL'yi
     yeniden çözmez). */
  if (spec && spec.ref && state.refFrame) {
    const url = state.refFrame.url || '';
    if (url) (delta || (delta = {})).__ref = state.refFrame;
  }

  if (!delta) return;
  if (restructure && html) delta.__html = html;
  try { window.tailref.syncPanelWindow(id, delta); } catch { /* sessiz */ }
}

function pushDetachedPanelUpdates(panel, id) {
  const state = detachedPanelState.get(id);
  if (!state || state.opening) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (!panel || panel.dataset.detached !== '1') return;
    sendPanelSnapshot(panel, id, state);
  }, 70);
}

/* Form değerleri (select/range) DOM özniteliği değiştirmediği için
   MutationObserver tek başına yetmez; ayrı pencereler açıkken düşük
   maliyetli bir turla değişen alanları da yansıtırız. */
let detachedSyncTimer = 0;
function syncOpenDetachedPanels() {
  const drawing = document.body.classList.contains('mode-draw');
  for (const [id, state] of detachedPanelState) {
    const panel = document.getElementById(id);
    if (!panel || panel.dataset.detached !== '1' || state.opening) continue;
    /* Çizim modundan çıkınca v5 panellerinin pencereleri kapanır; panel
       uygulamadaki son görünürlük durumuna göre geri takılır. */
    if (!drawing && panel.classList.contains('v5-panel')) {
      try { window.tailref.closePanelWindow(id, true); } catch { /* sessiz */ }
      continue;
    }
    clearTimeout(state.timer);
    sendPanelSnapshot(panel, id, state);
  }
}
function ensureDetachedSyncLoop() {
  if (detachedSyncTimer || !detachedPanelState.size) return;
  detachedSyncTimer = setInterval(() => {
    if (!detachedPanelState.size) {
      clearInterval(detachedSyncTimer);
      detachedSyncTimer = 0;
      return;
    }
    syncOpenDetachedPanels();
  }, 400);
}

function panelWindowPlacement(panel) {
  const rect = panelLayoutRect(panel);
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    x: Math.round(window.screenX + rect.left),
    y: Math.round(window.screenY + rect.top),
  };
}

async function detachPanelToWindow(panel, options) {
  if (!panelCanDetach(panel)) return false;
  const spec = panelDockSpec(panel);
  if (!spec) return false;

  /* Aynalanamayan paneller: sürükleme geri çekilir, kullanıcıya nedeni
     gösterilir. Panelin docked davranışı değişmez. */
  if (spec.adapter === 'unsupported') {
    panel.classList.remove('detach-ready');
    constrainFloatingPanel(panel);
    saveFloatingPanel(panel);
    panelDockToast(spec.reason || 'This panel cannot be moved to a separate window.');
    return false;
  }

  let state = detachedPanelState.get(panel.id);
  if (panel.dataset.detached === '1') {
    /* Zaten ayrı pencerede: yalnızca öne getir. */
    try {
      await window.tailref.openPanelWindow({
        id: panel.id,
        title: panelSnapshotTitle(panel),
        ...panelWindowPlacement(panel),
      });
    } catch { /* sessiz */ }
    return true;
  }
  /* Tek uçuş: pointerup iki kez gelse bile ikinci pencere açılmaz. */
  if (state && state.opening) return true;

  /* Tarayıcı panelleri ayrı pencereye taşınırken konuk sayfa henüz
     başlatılmadıysa önce başlat: kopya boş gelmesin. */
  if (spec.adapter === 'guest') {
    try {
      if (panel.id === 'pinterestPanel' && typeof ensurePinterestView === 'function') {
        await ensurePinterestView();
      } else if (panel.id === 'artstationPanel' && typeof ensureArtStationView === 'function') {
        await ensureArtStationView();
      }
    } catch { /* konuk görünüm yoksa panel yine açılır */ }
  }

  state = {
    observer: null,
    timer: 0,
    opening: true,
    lastSnapshot: null,
    syncCount: 0,
    structDirty: false,
    lastHtmlAt: 0,
    closedWhileOpening: false,
    canvasCache: null,
    canvasAt: 0,
    windowReadyAt: Date.now() + 1500,
    pointer: null,
    refFrame: null,
    refTimer: 0,
    refBusy: false,
  };
  detachedPanelState.set(panel.id, state);

  /* v5 panelleri: pencere kopyası sarmalayıcıyla ve kendi ölçüsüyle
     açılır; canlı referans için mini tahtanın son dikdörtgeni saklanır. */
  const isV5 = spec.adapter === 'v5';
  const fallback = panelWindowPlacement(panel);
  const explicit = options && options.placement && typeof options.placement === 'object'
    ? options.placement : null;
  const placement = {
    width: Math.max(120, Math.round(
      Number(explicit && explicit.width) || fallback.width)),
    height: Math.max(80, Math.round(
      Number(explicit && explicit.height) || fallback.height)),
    x: explicit && Number.isFinite(Number(explicit.x))
      ? Math.round(Number(explicit.x)) : fallback.x,
    y: explicit && Number.isFinite(Number(explicit.y))
      ? Math.round(Number(explicit.y)) : fallback.y,
  };
  /* Kullanıcı ayrı pencerede boyut verdiyse o boyutla aç; pencere
     konumu panelin uygulamadaki yerinden gelir. */
  const savedSize = detachedWindowSizes.get(panel.id);
  if (!explicit && savedSize) {
    placement.width = savedSize.width;
    placement.height = savedSize.height;
  }
  state.panelRect = {
    width: Math.max(1, placement.width),
    height: Math.max(1, placement.height),
  };
  if (isV5) {
    const refStage = panel.id === 'v5ReferencePanel'
      ? panel.querySelector('#v5RefStage') : null;
    if (refStage) {
      const r = refStage.getBoundingClientRect();
      if (r.width >= 40 && r.height >= 40 && window.tailrefV5Panels
          && typeof window.tailrefV5Panels.setRefRect === 'function') {
        const refRect = {
          left: r.left, top: r.top, width: r.width, height: r.height,
        };
        state.refRect = refRect;
        state.refCenter = {
          x: refRect.left + refRect.width / 2,
          y: refRect.top + refRect.height / 2,
        };
        window.tailrefV5Panels.setRefRect(refRect);
      }
    }
  }

  const snapshot = collectPanelSnapshot(panel);
  /* İlk kopya için tuval pikselleri: panel-init yüklenirken güncelleme
     kaybolsa bile renk çarkı/katman/fırça önizlemeleri dolu gelsin. */
  if (isV5) {
    const initialCanvases = collectV5Canvases(panel, spec, state, true);
    if (initialCanvases && Object.keys(initialCanvases).length) {
      snapshot.__canvases = initialCanvases;
      state.canvasCache = initialCanvases;
    }
  }
  const payload = {
    id: panel.id,
    title: panelSnapshotTitle(panel),
    ...placement,
    frame: { w: Math.round(placement.width), h: Math.round(placement.height) },
    theme: document.documentElement.dataset.theme || '',
    html: isV5 ? v5PanelWindowHtml(panel) : panel.outerHTML,
    /* Simgeler <use href="#icon-..."> ile sprite'tan gelir; ayrı pencerede
       de aynı simgeler görünsün diye sprite birlikte gönderilir. */
    sprite: (document.querySelector('.iconSprite') || {}).outerHTML || '',
    dockLabel: panelDockText('Return the panel to the app'),
    snapshot,
    capabilities: {
      files: !!spec.files,
      shortcuts: !!spec.shortcuts,
      v5: isV5,
      ref: !!spec.ref,
    },
  };
  let result = null;
  try { result = await window.tailref.openPanelWindow(payload); } catch { result = null; }
  if (state.closedWhileOpening) {
    if (detachedPanelState.get(panel.id) === state) detachedPanelState.delete(panel.id);
    return false;
  }
  if (!result || !result.ok) {
    if (detachedPanelState.get(panel.id) === state) detachedPanelState.delete(panel.id);
    /* Panel ekran dışında kalmasın: başarısız taşıma geri alınır. */
    if (!isV5) {
      constrainFloatingPanel(panel);
      saveFloatingPanel(panel);
    }
    panelDockToast('The panel window could not be opened; the panel was returned to the app.');
    return false;
  }

  /* YouTube paneli ayrı pencereye taşınınca ana penceredeki oynatıcı
     duraklatılır; aksi halde iki oynatıcı aynı anda ses çalardı. Ayrı
     penceredeki kopya kendi oynatıcısıyla devam eder. */
  if (panel.id === 'youtubeMusicPanel' && typeof youtubeCmd === 'function') {
    try { youtubeCmd('pauseVideo'); } catch { /* oynatıcı yoksa */ }
  }

  /* Önce normal şekilde gizle, sonra ayrı pencere işaretini koy; aksi
     halde hidePanel paneli hemen pencereyi kapatarak geri takardı.
     v5 panelleri kendi görünürlük deposunu kullanır; gizleme CSS ile
     ([data-detached]) yapılır ki hidePanel pencereyi kapatmasın. */
  if (isV5) {
    panel.dataset.detached = '1';
    /* Ayrı pencere açıkken panel ekran dışında gerçek ölçüsüyle yerleşimde
       kalsın: çark/önizleme tuvalleri doğru çözünürlükte çizilir ve
       pointer köprüsü gerçek geometriyi kullanır. */
    applyV5PointerProbe(panel);
  } else {
    hidePanel(panel);
    panel.dataset.detached = '1';
  }
  if (typeof syncStudioPanelState === 'function') syncStudioPanelState();

  state.opening = false;
  state.lastSnapshot = snapshot;
  state.closedWhileOpening = false;
  if (typeof MutationObserver === 'function') {
    state.observer = new MutationObserver(records => {
      if (records && records.some(record => record.type === 'childList')) state.structDirty = true;
      pushDetachedPanelUpdates(panel, panel.id);
    });
    state.observer.observe(panel, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
  }
  /* Açılış sırasında değişen durumları hemen yakala. */
  sendPanelSnapshot(panel, panel.id, state, true);
  ensureDetachedSyncLoop();
  if (isV5 && spec.ref) scheduleV5RefFrame(panel, state, 60);
  return true;
}

function cleanupDetachedPanel(panel) {
  if (!panel) return;
  const state = detachedPanelState.get(panel.id);
  if (state) {
    if (state.observer) state.observer.disconnect();
    clearTimeout(state.timer);
    if (state.refTimer) clearInterval(state.refTimer);
    detachedPanelState.delete(panel.id);
  }
  delete panel.dataset.detached;
  panel.classList.remove('v5-detached-probe');
  if (!detachedPanelState.size && detachedSyncTimer) {
    clearInterval(detachedSyncTimer);
    detachedSyncTimer = 0;
  }
}

/** Ayrı pencereden geri takılan paneli bırakıldığı yere yerleştirir. */
function applyDockedPanelRect(panel, rect) {
  if (!panel || !rect) return false;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite)) return false;
  panel.style.position = 'fixed';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${Math.max(160, width)}px`;
  panel.style.height = `${Math.max(100, height)}px`;
  constrainFloatingPanel(panel);
  saveFloatingPanel(panel);
  return true;
}

/** Ayrı pencere kapanınca paneli uygulamaya geri takar (veya kapalı bırakır). */
function handleDetachedPanelClosed(data) {
  if (!data || !data.id) return;
  const panel = document.getElementById(data.id);
  /* Kapanıştan önce ayrı penceredeki kaydırma konumları toplanmıştı;
     panel geri takılınca görünür hâle geldiğinde uygulanır. */
  const state = detachedPanelState.get(panel && panel.id);
  const dockScroll = state && state.dockScroll ? state.dockScroll : null;
  const spec = panelDockSpec(panel);
  const isV5 = !!spec && spec.adapter === 'v5';
  cleanupDetachedPanel(panel);
  if (panel && data.restore !== false && !isV5) {
    showPanel(panel);
    applyDockedPanelRect(panel, data.dock);
    prepareFloatingPanel(panel);
    raiseFloatingPanel(panel);
    if (dockScroll) {
      const restore = () => {
        for (const [id, pos] of Object.entries(dockScroll)) {
          const el = document.getElementById(id);
          if (!el) continue;
          if (Number.isFinite(pos.top)) el.scrollTop = pos.top;
          if (Number.isFinite(pos.left)) el.scrollLeft = pos.left;
        }
      };
      requestAnimationFrame(() => { restore(); setTimeout(restore, 120); });
    }
    /* Ayrı penceredeki oynatıcı kapandı; sesin kesilmemesi için ana
       penceredeki oynatıcı kaldığı yerden devam eder. */
    if (panel.id === 'youtubeMusicPanel' && typeof youtubeCmd === 'function') {
      setTimeout(() => { try { youtubeCmd('playVideo'); } catch { /* sessiz */ } }, 350);
    }
  }
  /* v5 panelleri kendi yerleşimini yeniden uygular: kapatma düğmesi
     paneli gizlediyse gizli, geri takıldıysa dock'taki yerinde görünür. */
  if (isV5 && window.tailrefV5Panels
      && typeof window.tailrefV5Panels.refresh === 'function') {
    try { window.tailrefV5Panels.refresh(); } catch { /* sessiz */ }
  }
  if (typeof syncStudioPanelState === 'function') syncStudioPanelState();
}

/** Ayrı paneli kapatır; `restore=false` ise uygulamaya geri takmaz. */
function tailrefCloseDetachedPanel(panel, restore = true) {
  if (!panel || panel.dataset.detached !== '1') return false;
  if (!window.tailref || !window.tailref.closePanelWindow) return false;
  const state = detachedPanelState.get(panel.id);
  if (state && state.opening) state.closedWhileOpening = true;
  try { window.tailref.closePanelWindow(panel.id, restore !== false); } catch { /* sessiz */ }
  return true;
}

/* ---------- ayrı pencereden gelen olayları asıl panele uygula ---------- */

function panelKeyCode(key) {
  const named = {
    Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Home: 36, End: 35, PageUp: 33, PageDown: 34, ' ': 32,
  };
  if (named[key] !== undefined) return named[key];
  return typeof key === 'string' && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
}

function decodePanelBase64(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function applyDetachedPanelFiles(el, action) {
  if (!el || el.tagName !== 'INPUT' || el.type !== 'file') return;
  if (typeof File !== 'function' || typeof DataTransfer !== 'function') return;
  const files = [];
  for (const raw of action.files || []) {
    try {
      const bytes = decodePanelBase64(raw.base64);
      files.push(new File([bytes], raw.name || 'file', {
        type: raw.type || '',
        lastModified: Number(raw.lastModified) || Date.now(),
      }));
    } catch { /* bozuk dosya atlanır */ }
  }
  if (!files.length) {
    panelDockToast('The selected file could not be transferred to the app.');
    return;
  }
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  el.files = transfer.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Ayrı pencereden gelen çocuk indeksi yolunu ana paneldeki öğeye çözer.
    Etiket adı doğrulanır: panel yapısı değiştiyse yanlış öğeye tıklanmaz. */
function resolveDetachedPanelPath(panel, path, tag) {
  if (!panel || !Array.isArray(path) || path.length < 1 || path.length > 32) return null;
  let node = panel;
  /* path[0] kopyanın #panelRoot içindeki indeksidir; ana panelde kök zaten
     panelin kendisidir. */
  for (let i = 1; i < path.length; i++) {
    const index = path[i];
    if (!Number.isInteger(index) || index < 0 || index > 9999) return null;
    node = node.children[index];
    if (!node) return null;
  }
  if (tag && node.tagName !== String(tag).toUpperCase()) return null;
  return node;
}

/** Ayrı penceredeki bir denetimin olayını ana paneldeki aslına uygular. */
function applyV5PointerProbe(panel, action) {
  const state = detachedPanelState.get(panel.id);
  /* Pencere yeniden boyutlandırıldıysa işaretçi koordinatları yeni
     görünür panel ölçüsüne göre ölçeklenmeli. */
  if (state && action) {
    const w = Number(action.w);
    const h = Number(action.h);
    if (w > 0 && h > 0) state.panelRect = { width: w, height: h };
  }
  if (state && state.panelRect) {
    panel.style.setProperty('--v5-probe-w', state.panelRect.width + 'px');
    panel.style.setProperty('--v5-probe-h', state.panelRect.height + 'px');
  }
  panel.classList.add('v5-detached-probe');
  const rect = panel.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    panel.classList.remove('v5-detached-probe');
    return null;
  }
  return rect;
}

function v5PointerPoint(rect, action) {
  const w = Number(action.w) > 0 ? Number(action.w) : rect.width;
  const h = Number(action.h) > 0 ? Number(action.h) : rect.height;
  const x = Number(action.x);
  const y = Number(action.y);
  return {
    x: rect.left + (Math.min(w, Math.max(0, Number.isFinite(x) ? x : 0)) / w) * rect.width,
    y: rect.top + (Math.min(h, Math.max(0, Number.isFinite(y) ? y : 0)) / h) * rect.height,
  };
}

function v5PointerTarget(panel, action, point) {
  let el = action.id
    ? panel.querySelector(`#${CSS.escape(String(action.id))}`)
    : null;
  if (!el && action.path) el = resolveDetachedPanelPath(panel, action.path, action.tag);
  if (!el || !panel.contains(el)) {
    let hit = null;
    try { hit = document.elementFromPoint(point.x, point.y); } catch { hit = null; }
    if (hit && panel.contains(hit)) el = hit;
  }
  return el || panel;
}

function v5PointerDispatch(panel, el, kind, action, point) {
  const type = kind === 'down' ? 'pointerdown'
    : kind === 'up' ? 'pointerup'
      : kind === 'cancel' ? 'pointercancel' : 'pointermove';
  const buttons = kind === 'up' || kind === 'cancel' ? 0 : 1;
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    screenX: window.screenX + point.x,
    screenY: window.screenY + point.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons,
    ctrlKey: !!action.ctrlKey,
    shiftKey: !!action.shiftKey,
    altKey: !!action.altKey,
    metaKey: !!action.metaKey,
  });
  try { el.dispatchEvent(event); } catch { /* sessiz */ }
}

function v5ApplyRangeValue(el, rect, point) {
  const min = Number.isFinite(Number(el.min)) ? Number(el.min) : 0;
  const max = Number.isFinite(Number(el.max)) ? Number(el.max) : 100;
  const span = Math.max(1e-6, max - min);
  const ratio = Math.min(1, Math.max(0, (point.x - rect.left) / Math.max(1, rect.width)));
  const step = Math.max(0, Number(el.step) || 0);
  let value = min + span * ratio;
  if (step > 0) value = Math.round(value / step) * step;
  el.value = String(value);
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* sessiz */ }
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch { /* sessiz */ }
}

/* v5 panel köprüsü: ayrı penceredeki görünmez kopyada gerçek panel
   yerleşime sokulur (yalnız bu görev süresince, opacity 0), böylece
   çark/katman/fırça kendi gerçek geometrisiyle çalışır. */
function applyV5Pointer(panel, action) {
  const dockState = detachedPanelState.get(panel.id);
  if (!dockState) return;
  const kind = ['down', 'move', 'up', 'cancel'].includes(action.kind) ? action.kind : 'move';
  const isV5 = panel.classList.contains('v5-panel');
  if (!isV5) return;

  if (kind === 'down') {
    if (dockState.pointer) v5EndPointer(panel, dockState);
    const rect = applyV5PointerProbe(panel, action);
    if (!rect) return;
    const point = v5PointerPoint(rect, action);
    const el = v5PointerTarget(panel, action, point);
    dockState.pointer = {
      el,
      rect,
      range: el.matches && el.matches('input[type="range"]'),
      timer: setTimeout(() => {
        if (dockState.pointer && dockState.pointer.el === el) v5EndPointer(panel, dockState);
      }, 5000),
    };
    if (dockState.pointer.range) v5ApplyRangeValue(el, el.getBoundingClientRect(), point);
    else v5PointerDispatch(panel, el, 'down', action, point);
    if (!dockState.pointer.range && el && typeof el.focus === 'function'
        && (el.matches('input, textarea, [contenteditable="true"]'))) {
      try { el.focus({ preventScroll: true }); } catch { /* sessiz */ }
    }
    return;
  }

  const pointer = dockState.pointer;
  if (!pointer) return;
  clearTimeout(pointer.timer);
  /* Sürükleme sürerken probe açık kalsın; kaybolan pointerup probe'u
     sonsuza dek açık bırakmasın diye güvenlik zamanlayıcısı tazelenir. */
  pointer.timer = setTimeout(() => {
    if (dockState.pointer === pointer) v5EndPointer(panel, dockState);
  }, 8000);
  const rect = pointer.rect;
  const point = v5PointerPoint(rect, action);
  if (pointer.range) {
    v5ApplyRangeValue(pointer.el, pointer.el.getBoundingClientRect(), point);
  } else {
    v5PointerDispatch(panel, pointer.el, kind, action, point);
  }
  if (kind === 'up' || kind === 'cancel') v5EndPointer(panel, dockState);
}

function v5EndPointer(panel, dockState) {
  if (!dockState || !dockState.pointer) return;
  clearTimeout(dockState.pointer.timer);
  dockState.pointer = null;
  /* Probe bilerek açık kalır: panel ayrı pencere açıkken ekran dışında
     gerçek ölçüsüyle yerleşimde durur (tuval çözünürlüğü korunur). */
}

function applyV5Wheel(panel, action) {
  const rect = applyV5PointerProbe(panel, action);
  if (!rect) return;
  try {
    const point = v5PointerPoint(rect, action);
    let el = v5PointerTarget(panel, action, point);
    if (!el || !panel.contains(el)) el = panel;
    const dy = Number(action.deltaY) || 0;
    const dx = Number(action.deltaX) || 0;
    try {
      el.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, composed: true,
        clientX: point.x, clientY: point.y,
        deltaX: dx, deltaY: dy, deltaMode: 0,
        ctrlKey: !!action.ctrlKey, shiftKey: !!action.shiftKey,
        altKey: !!action.altKey, metaKey: !!action.metaKey,
      }));
    } catch { /* sessiz */ }
    /* Sentetik wheel varsayılan kaydırmayı tetiklemez; en yakın
       kaydırılabilir atası elle kaydırılır. */
    let node = el;
    while (node && node !== panel && node !== document.body) {
      const style = getComputedStyle(node);
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY)
        || /(auto|scroll|overlay)/.test(style.overflowX);
      if (scrollable && (node.scrollHeight > node.clientHeight + 2
          || node.scrollWidth > node.clientWidth + 2)) {
        if (dy) node.scrollTop += dy;
        if (dx) node.scrollLeft += dx;
        break;
      }
      node = node.parentElement;
    }
  } catch { /* sessiz */ }
}

function applyV5RefPan(panel, action) {
  const dockState = detachedPanelState.get(panel.id);
  const refRect = dockState && dockState.refRect;
  if (!refRect) return;
  const copyW = Number(action.w) > 0 ? Number(action.w) : refRect.width;
  const copyH = Number(action.h) > 0 ? Number(action.h) : refRect.height;
  const dx = (Number(action.dx) || 0) * (refRect.width / copyW);
  const dy = (Number(action.dy) || 0) * (refRect.height / copyH);
  try {
    if (typeof state === 'undefined' || !state || !state.view) return;
    state.view.x += dx;
    state.view.y += dy;
    if (typeof applyView === 'function') applyView();
    if (typeof scheduleSave === 'function') scheduleSave();
  } catch { /* sessiz */ }
  scheduleV5RefFrame(panel, dockState, 90);
}

function applyV5RefZoom(panel, action) {
  const factor = Math.min(4, Math.max(0.2, Number(action.factor) || 1));
  const dockState = detachedPanelState.get(panel.id);
  if (typeof state === 'undefined' || !state || !state.view) return;
  const rect = dockState && dockState.refRect;
  if (!rect) return;
  if (typeof dpBoardZoomAt === 'function') {
    dpBoardZoomAt({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }, factor);
  }
  scheduleV5RefFrame(panel, dockState, 90);
}

/* Referans panelinin canlı görüntüsü: pano görünümü küçük bir tuvalde
   yeniden çizilir ve kopya pencereye veri URL'si olarak gönderilir. */
function scheduleV5RefFrame(panel, dockState, delay = 0) {
  if (!panel || !dockState || !dockState.refRect) return;
  if (dockState.refTimer) clearTimeout(dockState.refTimer);
  dockState.refTimer = setTimeout(async () => {
    dockState.refTimer = 0;
    if (panel.dataset.detached !== '1' || !dockState.refRect) return;
    if (dockState.refBusy) {
      scheduleV5RefFrame(panel, dockState, 240);
      return;
    }
    dockState.refBusy = true;
    try {
      const rect = dockState.refRect;
      if (typeof state === 'undefined' || !state || !state.view) return;
      const scale = Math.max(1e-4, Number(state.view.scale) || 1);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      /* Çok büyük pencere + 2x DPR gereğinden fazla raster üretmesin;
         eşik aşılırsa ölçek oranı korunarak küçültülür. */
      const limit = 2200 / Math.max(1, rect.width, rect.height);
      const pixelRatio = Math.min(dpr, Math.max(0.5, limit));
      const world = {
        x: (rect.left - state.view.x) / scale,
        y: (rect.top - state.view.y) / scale,
        w: rect.width / scale,
        h: rect.height / scale,
      };
      const url = await renderBoardRegionDataUrl(
        world,
        Math.round(rect.width * pixelRatio),
        Math.round(rect.height * pixelRatio),
        { bg: 'board', includeInk: true }
      );
      if (url && panel.dataset.detached === '1') {
        dockState.refFrame = {
          url,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          zoom: Math.max(1, Math.round(scale * 100)),
        };
        sendPanelSnapshot(panel, panel.id, dockState);
      }
    } catch { /* sessiz */ } finally {
      dockState.refBusy = false;
    }
    if (panel.dataset.detached === '1') scheduleV5RefFrame(panel, dockState, 620);
  }, delay);
}

/** Ayrı pencerede kullanıcı paneli boyutlandırdı: ana panelin gizli
    yerleşimini aynı ölçüye getir, referans rasterını ve tuvalleri tazele. */
function applyV5Size(panel, action) {
  const st = detachedPanelState.get(panel.id);
  if (!st) return;
  const width = Math.max(120, Math.min(4096, Math.round(Number(action.w) || 0)));
  const height = Math.max(80, Math.min(4096, Math.round(Number(action.h) || 0)));
  if (!width || !height) return;
  st.panelRect = { width, height };
  detachedWindowSizes.set(panel.id, { width, height });
  panel.style.setProperty('--v5-probe-w', width + 'px');
  panel.style.setProperty('--v5-probe-h', height + 'px');

  if (panel.id === 'v5ReferencePanel') {
    const refW = Math.max(40, Math.min(4096, Number(action.refW) || 0));
    const refH = Math.max(40, Math.min(4096, Number(action.refH) || 0));
    const center = st.refCenter
      || (st.refRect ? {
        x: st.refRect.left + st.refRect.width / 2,
        y: st.refRect.top + st.refRect.height / 2,
      } : null);
    if (refW && refH && center) {
      const rect = {
        left: center.x - refW / 2,
        top: center.y - refH / 2,
        width: refW,
        height: refH,
      };
      st.refRect = rect;
      st.refCenter = center;
      if (window.tailrefV5Panels
          && typeof window.tailrefV5Panels.setRefRect === 'function') {
        try { window.tailrefV5Panels.setRefRect(rect); } catch { /* sessiz */ }
      }
      scheduleV5RefFrame(panel, st, 80);
    }
  }

  /* Yerleşim birkaç kare içinde oturur; çark/önizleme tuvalleri yeni
     ölçüde çizildikten sonra kopyaya bir kez gönderilir. */
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (panel.dataset.detached !== '1') return;
      if (detachedPanelState.get(panel.id) !== st) return;
      sendPanelSnapshot(panel, panel.id, st, true);
    }, 140);
  });
}

/** Ayrı penceredeki bir denetimin olayını ana paneldeki aslına uygular. */
function applyDetachedPanelAction(panel, action) {
  if (!panel || !action) return;
  if (action.type === 'shortcut') {
    const capture = window.tailrefSettingsKeyCapture;
    if (typeof capture === 'function') capture(action);
    return;
  }
  if (action.type === 'shortcut-begin') {
    const begin = window.tailrefSettingsKeyCaptureBegin;
    if (typeof begin === 'function') begin(action.target);
    return;
  }
  if (action.type === 'v5-pointer') { applyV5Pointer(panel, action); return; }
  if (action.type === 'v5-wheel') { applyV5Wheel(panel, action); return; }
  if (action.type === 'v5-ref-pan') { applyV5RefPan(panel, action); return; }
  if (action.type === 'v5-ref-zoom') { applyV5RefZoom(panel, action); return; }
  if (action.type === 'v5-size') { applyV5Size(panel, action); return; }
  let el = action.id
    ? panel.querySelector(`#${CSS.escape(String(action.id))}`)
    : null;
  if (!el && action.path) el = resolveDetachedPanelPath(panel, action.path, action.tag);
  if (!el) return;
  if (action.type === 'click') {
    if (action.ctrlKey || action.shiftKey || action.altKey || action.metaKey) {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true,
        ctrlKey: !!action.ctrlKey, shiftKey: !!action.shiftKey,
        altKey: !!action.altKey, metaKey: !!action.metaKey,
      }));
    } else {
      el.click();
    }
  } else if (action.type === 'input' || action.type === 'change') {
    if (el.type === 'file') return;
    if (action.value !== undefined && 'value' in el) el.value = action.value;
    if (action.checked !== undefined && 'checked' in el) el.checked = !!action.checked;
    el.dispatchEvent(new Event(action.type, { bubbles: true }));
  } else if (action.type === 'keydown') {
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: String(action.key || ''),
      code: String(action.code || ''),
      keyCode: panelKeyCode(action.key),
      which: panelKeyCode(action.key),
      ctrlKey: !!action.ctrlKey,
      shiftKey: !!action.shiftKey,
      altKey: !!action.altKey,
      metaKey: !!action.metaKey,
      repeat: !!action.repeat,
      bubbles: true,
      cancelable: true,
    }));
  } else if (action.type === 'files') {
    void applyDetachedPanelFiles(el, action);
  } else if (action.type === 'scroll') {
    const top = Number(action.scrollTop);
    const left = Number(action.scrollLeft);
    /* Panel ayrı penceredeyken ana kopya gizlidir: kaydırma orada
       uygulanamaz, geri takılınca uygulanmak üzere saklanır. */
    if (panel.hidden) {
      const state = detachedPanelState.get(panel.id);
      if (state) {
        state.dockScroll = state.dockScroll || {};
        state.dockScroll[el.id] = { top, left };
      }
      return;
    }
    if (Number.isFinite(top)) el.scrollTop = top;
    if (Number.isFinite(left)) el.scrollLeft = left;
  }
}

if (window.tailref && window.tailref.onPanelWindowClosed) {
  window.tailref.onPanelWindowClosed(handleDetachedPanelClosed);
}
if (window.tailref && window.tailref.onPanelAction) {
  window.tailref.onPanelAction(data => {
    if (!data || !data.id) return;
    const panel = document.getElementById(data.id);
    applyDetachedPanelAction(panel, data.action);
  });
}

/** Panel pencere kenarını yeterince geçtiyse ayrı pencereye taşınmalı. */
function panelShouldDetach(panel) {
  if (!panelCanDetach(panel)) return false;
  const rect = panelLayoutRect(panel);
  const over = 60;
  return rect.left < -over || rect.top < -over
    || rect.left + rect.width > innerWidth + over
    || rect.top + rect.height > innerHeight + over;
}

/* ---------- panel başlığındaki "dışarı çıkar" düğmesi ----------
   Yalnız gerçekten taşınabilen panellere eklenir; sürükleme jestine
   alternatif, keşfedilebilir bir kapıdır. */
function installPanelPopoutButton(panel) {
  if (!panel || panel.dataset.detached === '1') return null;
  const head = panel.querySelector('.floatingPanelHead, .v5-panel-head');
  /* Metin denetçisinin başlığı yok; ince çubuğun ilk satırı (.ibTitle)
     başlık işlevi görür. Bu satır data-l10n taşıdığı için düğme İÇİNE
     değil yanına konur (yerelleştirme metni çocukları siler). */
  const inspectorTitle = !head && panel.id === 'inspector'
    ? panel.querySelector('.ibTitle') : null;
  if (!head && !inspectorTitle) return null;
  let button = panel.querySelector('[data-panel-popout]');
  if (button) return button;
  button = document.createElement('button');
  button.type = 'button';
  button.className = 'panelPopoutBtn';
  button.dataset.panelPopout = '1';
  const label = panelDockText('Open in a separate window');
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = label;
  const v5Actions = head && head.querySelector('.v5-panel-actions');
  const close = head && head.querySelector('button[id$="Close"]');
  if (v5Actions) {
    /* v5 başlığında eylem sırası: [popout] [varsa panele özel] …
       [katla] [kapat]. Kapat son çocuktur. */
    v5Actions.insertBefore(button, v5Actions.lastElementChild || null);
  } else if (head && close && head.contains(close)) {
    close.parentElement.insertBefore(button, close);
  } else if (head) {
    head.appendChild(button);
  } else {
    inspectorTitle.parentElement.insertBefore(button, inspectorTitle.nextSibling);
  }
  if (typeof enhanceIconButton === 'function') enhanceIconButton(button, 'popout');
  return button;
}

function installPanelPopoutButtons() {
  for (const id of Object.keys(PANEL_DOCK_SPECS)) {
    installPanelPopoutButton(document.getElementById(id));
  }
}
installPanelPopoutButtons();
try {
  if (window.L10N && typeof window.L10N.onChange === 'function') {
    window.L10N.onChange(() => {
      for (const button of document.querySelectorAll('[data-panel-popout]')) {
        const label = panelDockText('Open in a separate window');
        button.setAttribute('aria-label', label);
        button.dataset.tooltip = label;
      }
    });
  }
} catch { /* sessiz */ }

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target && target.closest('[data-panel-popout]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  let panel = button.parentElement;
  while (panel && panel !== document.body && !PANEL_DOCK_SPECS[panel.id]) panel = panel.parentElement;
  if (panel && panel !== document.body) void detachPanelToWindow(panel);
}, true);

/* Test ve dış çağrılar için tek kapı. */
window.tailrefDetachPanel = detachPanelToWindow;
window.tailrefCloseDetachedPanel = tailrefCloseDetachedPanel;
/* draw-v5 panelleri sonradan kurulur; başlık düğmesi bu kapıdan eklenir. */
window.tailrefInstallPanelPopoutButton = installPanelPopoutButton;
