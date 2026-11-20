/* TailRef · ayrı panel penceresi
   Ana penceredeki panelin DOM kopyasını gösterir; tıklama ve form
   değişikliklerini ana pencereye iletir, oradaki güncellemeleri yansıtır.
   Ayrıntılı sözleşme: 17b-panel-dock.js (renderer) + panel-window-manager.js
   (ana süreç). Bu dosya yalnız sunumu ve olay köprüsünü bilir. */
'use strict';

const bridge = window.panelBridge || null;
const root = document.getElementById('panelRoot');
let panelId = '';
let applying = false;
let panelFullscreen = false;
let keyCapture = false;
let capabilities = { files: false, shortcuts: false, v5: false, ref: false };
let v5Frame = null;
let dockLabel = '';
const guestViews = [];
/* Ana pencereden gelen kaydırma değeri, ayrı pencerede yeni kurulan
   kopyanın kendi konumunu hemen ezmesin: son yerel geri yükleme zamanı. */
const localScrollUntil = new Map();

/* ---------- ayrı pencerede tam ekran ---------- */
function paintFullscreenButton(on) {
  if (!root) return;
  const button = root.querySelector('[data-panel-fullscreen="1"]');
  if (!button) return;
  button.classList.toggle('is-active', !!on);
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  const title = on ? 'Exit full screen (Esc)' : 'Full screen';
  button.title = title;
  button.setAttribute('aria-label', title);
  const use = button.querySelector('.toolIcon use');
  if (use) use.setAttribute('href', on ? '#icon-restore' : '#icon-maximize');
}

async function togglePanelFullscreen() {
  if (!bridge || !panelId || !bridge.toggleFullscreen) return;
  try {
    const on = await bridge.toggleFullscreen(panelId);
    panelFullscreen = !!on;
    if (root) root.classList.toggle('is-fullscreen', panelFullscreen);
    paintFullscreenButton(panelFullscreen);
  } catch { /* pencere kapanmış olabilir */ }
}

function syncPanelFullscreen() {
  if (!bridge || !panelId || !bridge.isFullscreen) return;
  bridge.isFullscreen(panelId).then(on => {
    panelFullscreen = !!on;
    if (root) root.classList.toggle('is-fullscreen', panelFullscreen);
    paintFullscreenButton(panelFullscreen);
  }).catch(() => {});
}

/* Panelin içindeki <webview> (Pinterest/ArtStation) konuk sayfası mesajlarını
   doğrudan kendi barındırıcısına yollar. Ayrı pencerede bu barındırıcı burası
   olduğu için mesajları ana uygulamaya köprüleriz; yanıtlar aynı yoldan gelir. */
function bindGuestView(view) {
  if (!view || view.dataset.panelGuestBound === '1') return;
  view.dataset.panelGuestBound = '1';
  guestViews.push(view);
  view.addEventListener('ipc-message', event => {
    if (!bridge || !panelId) return;
    const channel = String(event.channel || '');
    if (!channel) return;
    bridge.sendGuestMessage(panelId, channel, Array.from(event.args || []));
  });
  const reportUrl = () => {
    if (!bridge || !panelId) return;
    let url = '';
    try { url = view.getURL() || ''; } catch { url = ''; }
    if (url) bridge.sendGuestMessage(panelId, '__guest-url', [url]);
  };
  view.addEventListener('did-navigate', reportUrl);
  view.addEventListener('did-navigate-in-page', reportUrl);
}

function bindGuestViews() {
  if (!root) return;
  for (const view of root.querySelectorAll('webview')) bindGuestView(view);
}

function setTitle(text) {
  const value = String(text || 'Panel');
  document.title = value + ' · TailRef';
}

/* Başlığı olmayan panellerde de taşınabilsin diye görünmez bir üst
   tutamak ekler; görünümü değiştirmez. */
function ensureDragRegion(clone) {
  if (!clone) return;
  const head = clone.querySelector('.v5-panel-head, .floatingPanelHead, .pose3dHead, .ibTitle');
  if (head) return;
  const strip = document.createElement('div');
  strip.setAttribute('aria-hidden', 'true');
  strip.style.cssText = 'position:absolute;left:0;right:0;top:0;height:14px;z-index:50;-webkit-app-region:drag;';
  clone.appendChild(strip);
}

function applyTheme(theme) {
  if (!theme) return;
  document.documentElement.dataset.theme = String(theme);
}

/* Simge sprite'ı kopyalanan panelin içinde yok; <use href="#icon-...">
   bağlantıları çözülsün diye sayfaya bir kez eklenir. */
function ensureSprite(sprite) {
  const html = String(sprite || '');
  if (!html) return;
  if (document.getElementById('panelIconSprite')) return;
  const holder = document.createElement('div');
  holder.id = 'panelIconSprite';
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  holder.innerHTML = html;
  document.body.appendChild(holder);
}

function isFormControl(el) {
  return !!el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
}

/* ---------- YouTube oynatıcısı (ayrı pencerede tek oynatıcı) ----------
   Ana penceredeki oynatıcı ayrı panel açıkken çalmaz; video buradaki
   <iframe> içinde oynar. IFrame API komutları doğrudan bu çerçeveye
   gönderilir (ana penceredeki youtubeCmd ile aynı biçim). */
function youtubeFrame() {
  return root ? root.querySelector('#youtubePlayer') : null;
}

function youtubeLocalCommand(func, args = []) {
  const frame = youtubeFrame();
  if (!frame || !frame.contentWindow) return false;
  try {
    frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    return true;
  } catch {
    return false;
  }
}

function youtubeVolume() {
  const slider = root && root.querySelector('#youtubeVolume');
  return slider ? Math.round(Number(slider.value) || 0) : 100;
}

function bindYoutubeFrame() {
  const frame = youtubeFrame();
  if (!frame || frame.dataset.panelYtBound === '1') return;
  frame.dataset.panelYtBound = '1';
  frame.addEventListener('load', () => {
    /* src boşsa (henüz bağlantı verilmedi) komut gönderilmez. */
    if (!frame.getAttribute('src')) return;
    youtubeLocalCommand('setVolume', [youtubeVolume()]);
    youtubeLocalCommand('playVideo');
  });
}

/* Ayrı pencerede "dışarı çıkar" düğmesi "geri tak" olur. */
function paintPopoutButton() {
  const button = root && root.querySelector('[data-panel-popout]');
  if (!button) return;
  const label = dockLabel || 'Return the panel to the app';
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = label;
}

/* ---------- v5 çizim panelleri ---------- */
function v5Root() {
  return root ? root.querySelector('.v5-panel') : null;
}

/* Eylem yolu v5'te panelin kendisinden başlar (kopya #v5DrawUI içinde). */
function actionRoot() {
  return capabilities.v5 ? v5Root() : root;
}

function v5CanvasByPath(pathText) {
  const panel = v5Root();
  if (!panel || typeof pathText !== 'string' || !pathText) return null;
  let node = panel;
  for (const part of pathText.split('/')) {
    const index = Number(part);
    if (!Number.isInteger(index) || index < 0) return null;
    node = node.children[index];
    if (!node) return null;
  }
  return node instanceof HTMLCanvasElement ? node : null;
}

function applyCanvasFrames(map) {
  if (!map || typeof map !== 'object') return;
  for (const [pathText, url] of Object.entries(map)) {
    const canvas = v5CanvasByPath(pathText);
    if (!canvas) continue;
    if (!url) {
      try { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
      catch { /* sessiz */ }
      continue;
    }
    const token = (canvas.__v5Frame || 0) + 1;
    canvas.__v5Frame = token;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (canvas.__v5Frame !== token) return;
      try {
        const ctx = canvas.getContext('2d');
        /* Raster ana panelde yeni ölçüde üretilmiş olabilir (pencere
           büyütüldüğünde çark yeniden çizilir). Kopya tuvalinin arka
           tamponunu görüntüye eşitle; aksi hâlde CSS ile büyütülen eski
           çözünürlük bulanık kalır. */
        const w = Math.max(1, image.naturalWidth || canvas.width);
        const h = Math.max(1, image.naturalHeight || canvas.height);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      } catch { /* sessiz */ }
    };
    image.src = url;
  }
}

function applyRefFrame(ref) {
  if (!ref || !ref.url) return;
  const stage = root && root.querySelector('#v5RefStage');
  if (!stage) return;
  let image = stage.querySelector('img.v5-ref-window');
  if (!image) {
    image = document.createElement('img');
    image.className = 'v5-ref-window';
    image.alt = '';
    image.draggable = false;
    stage.appendChild(image);
  }
  if (image.getAttribute('src') !== ref.url) image.setAttribute('src', ref.url);
  const empty = stage.querySelector('[data-ref-empty]');
  if (empty) empty.hidden = true;
  const label = root.querySelector('[data-ref-zoom]');
  if (label && ref.zoom) label.textContent = '%' + ref.zoom;
}

/* Eylem hedefi: olay hedefinden yukarı doğru ilk "kimlikli" ya da
   "eylemlenebilir" öğe. Dinamik üretilen düğmelerin (ör. kısayol
   satırları) kimliği yok; bunlar yol (path) ile eşlenir. */
const PANEL_ACTIONABLE = 'button, input, select, textarea, a[href], [role="button"], '
  + '[data-km-shortcut], [data-km-reset]';

function targetElement(event) {
  const node = event.target instanceof Element ? event.target : null;
  const scope = actionRoot();
  if (!node || !scope || !scope.contains(node)) return null;
  let el = node;
  while (el && el !== scope) {
    if (el.id || (el.matches && el.matches(PANEL_ACTIONABLE))) return el;
    el = el.parentElement;
  }
  return null;
}

/* Panel kökünden hedefe çocuk indeksi zinciri (kimliksiz düğmeler için).
   v5 kopyasında eylem kökü panelin kendisidir; ana penceredeki çözücü ilk
   adımı "panel indeksi" sayıp atladığı için başa bir yer tutucu eklenir. */
function elementPath(el) {
  const scope = actionRoot();
  if (!el || !scope || !scope.contains(el)) return null;
  const path = [];
  let node = el;
  while (node && node !== scope) {
    const parent = node.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, node);
    if (index < 0 || index > 9999) return null;
    path.unshift(index);
    if (path.length > 31) return null;
    node = parent;
  }
  if (node !== scope || !path.length) return null;
  return capabilities.v5 ? [0, ...path] : path;
}

function flashMessage(message) {
  const text = String(message || '');
  if (!text) return;
  let box = document.getElementById('panelMessage');
  if (!box) {
    box = document.createElement('div');
    box.id = 'panelMessage';
    box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);'
      + 'max-width:80%;padding:9px 14px;border-radius:10px;z-index:9999;'
      + 'background:rgba(18,20,26,.94);color:#eef2f7;font:12.5px/1.35 system-ui,sans-serif;'
      + 'box-shadow:0 10px 30px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.14)';
    document.body.appendChild(box);
  }
  box.textContent = text;
  clearTimeout(flashMessage.timer);
  flashMessage.timer = setTimeout(() => { if (box && box.parentNode) box.remove(); }, 5200);
}

function send(type, el, event) {
  if (!bridge || applying || !panelId || !el) return;
  if (isFormControl(el) && el.type === 'file') {
    void sendFiles(el);
    return;
  }
  const action = { type, id: el.id || '' };
  /* Kimliksiz (dinamik) düğmeler yol ile eşlenir. */
  if (!action.id) {
    const path = elementPath(el);
    if (!path) return;
    action.path = path;
    action.tag = String(el.tagName || '').slice(0, 16);
  }
  if (isFormControl(el)) {
    action.value = el.value;
    if (el.type === 'checkbox' || el.type === 'radio') action.checked = !!el.checked;
  }
  if (type === 'click' && event) {
    action.ctrlKey = !!event.ctrlKey;
    action.shiftKey = !!event.shiftKey;
    action.altKey = !!event.altKey;
    action.metaKey = !!event.metaKey;
  }
  if (type === 'keydown' && event) {
    action.key = event.key;
    action.code = event.code || '';
    action.ctrlKey = !!event.ctrlKey;
    action.shiftKey = !!event.shiftKey;
    action.altKey = !!event.altKey;
    action.metaKey = !!event.metaKey;
    action.repeat = !!event.repeat;
  }
  bridge.sendAction(panelId, action);
}

/* ---------- dosya girişleri ----------
   File nesnesi IPC'den geçemez; küçük/orta dosyaları bayt olarak taşıyıp
   ana pencerede yeniden File kurarız. Çok büyük dosyalarda panel docked
   modda içe aktarılmalıdır (bellek sınırı). */
const PANEL_FILE_MAX_BYTES = 24 * 1024 * 1024;

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sendFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length || !capabilities.files) return;
  let total = 0;
  const payload = [];
  for (const file of files) {
    if (file.size > PANEL_FILE_MAX_BYTES || total + file.size > PANEL_FILE_MAX_BYTES) {
      flashMessage('This file is too large to move to a separate window. Dock the panel back to import it.');
      return;
    }
    let buffer = null;
    try { buffer = await file.arrayBuffer(); } catch { buffer = null; }
    if (!buffer) continue;
    total += buffer.byteLength;
    payload.push({
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      base64: bytesToBase64(buffer),
    });
  }
  if (!payload.length) return;
  const action = { type: 'files', id: input.id || '', files: payload };
  if (!action.id) {
    const path = elementPath(input);
    if (!path) return;
    action.path = path;
    action.tag = 'INPUT';
  }
  bridge.sendAction(panelId, action);
}

/* ---------- olay köprüsü ---------- */
root.addEventListener('click', event => {
  const node = event.target instanceof Element ? event.target : null;
  /* "Dışarı çıkar" düğmesi ayrı pencerede "geri tak" olur. */
  if (node && node.closest('[data-panel-popout]')) {
    event.preventDefault();
    event.stopPropagation();
    if (bridge && bridge.requestDock && panelId) bridge.requestDock(panelId);
    return;
  }
  /* Tam ekran düğmesi ana pencereye iletilmez: bu pencerenin kendi
     boyutunu değiştirir. */
  if (node && node.closest('[data-panel-fullscreen="1"]')) {
    event.preventDefault();
    event.stopPropagation();
    togglePanelFullscreen();
    return;
  }
  /* Kısayol değiştirme: gerçek tıklama ana pencereye iletilir; ancak
     düğmenin kimliği olmadığı için yakalama modunu doğrudan başlatırız. */
  const capButton = node && node.closest('[data-km-shortcut]');
  if (capButton && capabilities.shortcuts) {
    keyCapture = true;
    event.preventDefault();
    event.stopPropagation();
    bridge.sendAction(panelId, {
      type: 'shortcut-begin',
      target: String(capButton.dataset.kmShortcut || ''),
    });
    return;
  }
  const el = targetElement(event);
  if (el) send('click', el, event);
}, true);

root.addEventListener('input', event => {
  const el = targetElement(event);
  if (!el) return;
  /* YouTube ses kaydırıcısı ayrı penceredeki oynatıcıyı da sürer. */
  if (el.id === 'youtubeVolume') {
    youtubeLocalCommand('setVolume', [Math.round(Number(el.value) || 0)]);
  }
  send('input', el, event);
}, true);

root.addEventListener('change', event => {
  const el = targetElement(event);
  if (el) send('change', el, event);
}, true);

root.addEventListener('keydown', event => {
  if (event.key === 'Escape' && panelFullscreen) {
    event.preventDefault();
    event.stopPropagation();
    togglePanelFullscreen();
    return;
  }
  /* Ayarlar > kısayol yakalama: tuşu ana penceredeki keymap'e ilet.
     Global kısayollar tetiklenmesin diye olay burada yutulur. */
  if (keyCapture && capabilities.shortcuts) {
    event.preventDefault();
    event.stopPropagation();
    bridge.sendAction(panelId, {
      type: 'shortcut',
      key: String(event.key || ''),
      code: String(event.code || ''),
      ctrlKey: !!event.ctrlKey,
      shiftKey: !!event.shiftKey,
      altKey: !!event.altKey,
      metaKey: !!event.metaKey,
    });
    return;
  }
  /* Form alanlarında yalnız anlamlı tuşlar: global kısayolların gizli
     ana pencerede kazara çalışmasını engeller. */
  if (event.key !== 'Enter' && event.key !== 'Escape') return;
  const el = targetElement(event);
  if (el) send('keydown', el, event);
}, true);

/* Ana penceredeki form değerleri DOM özniteliği değiştirmediği için
   kaydırma da olayla taşınır (Ayarlar'da kategori seçimi sayfayı kaydırır). */
const scrollTimers = new Map();
root.addEventListener('scroll', event => {
  if (applying || !bridge || !panelId) return;
  const el = event.target instanceof Element ? event.target : null;
  if (!el || !el.id) return;
  clearTimeout(scrollTimers.get(el.id));
  scrollTimers.set(el.id, setTimeout(() => {
    scrollTimers.delete(el.id);
    bridge.sendAction(panelId, {
      type: 'scroll', id: el.id,
      scrollTop: el.scrollTop, scrollLeft: el.scrollLeft,
    });
  }, 120));
}, true);

/* ---------- ana pencereden gelen güncellemeler ---------- */

function applyAttrs(el, attrs) {
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) el.removeAttribute(name);
    else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
  }
}

function applyElementData(el, data) {
  const formControl = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  if (data.text !== undefined && !el.children.length && !formControl
      && el.textContent !== data.text) {
    el.textContent = String(data.text);
  }
  if (data.value !== undefined && 'value' in el && el.type !== 'file') {
    const active = document.activeElement === el;
    const typing = active && el.tagName !== 'SELECT'
      && !/^(checkbox|radio|range|color|button|submit|reset)$/i.test(String(el.type || ''));
    /* Kullanıcı yazarken ana pencereden gelen yankı imleci bozmasın. */
    if (!typing) {
      const next = String(data.value);
      if (el.value !== next) el.value = next;
    }
  }
  if (data.checked !== undefined && 'checked' in el) {
    const next = !!data.checked;
    if (el.checked !== next) el.checked = next;
  }
  if (data.indeterminate !== undefined && 'indeterminate' in el) {
    el.indeterminate = !!data.indeterminate;
  }
  if (data.disabled !== undefined) {
    const next = !!data.disabled;
    if (el.disabled !== next && 'disabled' in el) el.disabled = next;
  }
  if (data.hidden !== undefined) el.hidden = !!data.hidden;
  if (data.title !== undefined && el.title !== String(data.title)) el.title = String(data.title);
  /* SVG öğelerinde className bir nesnedir; her zaman öznitelik üzerinden yaz. */
  if (data.cls !== undefined && el.getAttribute('class') !== String(data.cls)) {
    el.setAttribute('class', String(data.cls));
  }
  if (data.style !== undefined && el.getAttribute('style') !== String(data.style)) {
    el.setAttribute('style', String(data.style));
  }
  if (data.open !== undefined && 'open' in el && el.open !== !!data.open) el.open = !!data.open;
  if (data.src !== undefined && el.getAttribute('src') !== String(data.src)) {
    el.setAttribute('src', String(data.src));
    if (data.hidden !== undefined) el.hidden = !!data.hidden;
  }
  if (data.scrollTop !== undefined && el.id && Date.now() >= (localScrollUntil.get(el.id) || 0)) {
    localScrollUntil.set(el.id, Date.now() + 400);
    if (Math.abs(el.scrollTop - Number(data.scrollTop)) > 1) el.scrollTop = Number(data.scrollTop);
    if (data.scrollLeft !== undefined && Math.abs(el.scrollLeft - Number(data.scrollLeft)) > 1) {
      el.scrollLeft = Number(data.scrollLeft);
    }
  }
  applyAttrs(el, data.attrs);
}

function captureLocalViewState() {
  const state = { scroll: new Map(), focus: null };
  if (!root) return state;
  for (const el of root.querySelectorAll('[id]')) {
    if (el.scrollTop || el.scrollLeft) state.scroll.set(el.id, [el.scrollTop, el.scrollLeft]);
  }
  const active = document.activeElement;
  if (active && active !== document.body && root.contains(active) && active.id) {
    let start = null;
    let end = null;
    try { start = active.selectionStart; end = active.selectionEnd; } catch { start = null; }
    state.focus = { id: active.id, start, end };
  }
  return state;
}

function restoreLocalViewState(state) {
  if (!state) return;
  for (const [id, [top, left]] of state.scroll) {
    const el = document.getElementById(id);
    if (!el || !root.contains(el)) continue;
    /* Yeni kurulan kopyanın kaydırması ana pencereden gelen eski
       değerle ezilmesin. */
    localScrollUntil.set(id, Date.now() + 500);
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  if (state.focus) {
    const el = document.getElementById(state.focus.id);
    if (el && root.contains(el)) {
      try {
        el.focus({ preventScroll: true });
        if (typeof state.focus.start === 'number' && 'setSelectionRange' in el) {
          el.setSelectionRange(state.focus.start, state.focus.end);
        }
      } catch { /* odaklanamayan öğe */ }
    }
  }
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (snapshot.__theme !== undefined) applyTheme(snapshot.__theme);
  if (snapshot.__panel) {
    /* Yakalama modu ana pencereden gelir; kullanıcı düğmeye bastığı an
       yerel olarak da açılır (aşağıdaki tıklama köprüsü). */
    if (snapshot.__panel.keyCapture !== undefined) keyCapture = !!snapshot.__panel.keyCapture;
    const clone = capabilities.v5 ? v5Root() : (root && root.firstElementChild);
    if (clone && snapshot.__panel.cls !== undefined
        && clone.getAttribute('class') !== String(snapshot.__panel.cls)) {
      clone.setAttribute('class', String(snapshot.__panel.cls));
      if (capabilities.v5) clone.classList.remove('v5-detached-probe');
    }
  }
  /* Yapısal değişim: panel yeniden üretilir (ör. Ayarlar'da sayfa değişimi).
     Odak ve kaydırma korunur; konuk <webview> hiç taşınmaz. */
  if (typeof snapshot.__html === 'string' && snapshot.__html && root) {
    const view = captureLocalViewState();
    mountPanelHtml(snapshot.__html);
    bindGuestViews();
    bindYoutubeFrame();
    ensureDragRegion(capabilities.v5 ? v5Root() : (root && root.firstElementChild));
    restoreLocalViewState(view);
  }
  applying = true;
  try {
    if (Array.isArray(snapshot.__removed)) {
      for (const id of snapshot.__removed) {
        const el = root && root.querySelector(`#${CSS.escape(String(id))}`);
        if (el) el.remove();
      }
    }
    /* Yeni biçim: { els: { id: {...} } }; eski/tam biçim: { id: {...} }. */
    const entries = snapshot.els && typeof snapshot.els === 'object'
      ? Object.entries(snapshot.els)
      : Object.entries(snapshot).filter(([key]) => !key.startsWith('__'));
    for (const [id, data] of entries) {
      if (!data) continue;
      const el = root && root.querySelector(`#${CSS.escape(id)}`);
      if (!el) continue;
      /* Konuk sayfa kopyası anlık görüntüyle yeniden yazılmaz. */
      if (el.tagName === 'WEBVIEW') continue;
      applyElementData(el, data);
    }
  } finally {
    applying = false;
  }
  /* Anlık görüntü düğmenin className'ini ana pencereden kopyalar; yerel
     tam ekran durumu yeniden boyanır. */
  paintFullscreenButton(panelFullscreen);
  paintPopoutButton();
  /* v5: tuval pikselleri ve canlı referans görüntüsü (HTML kurulumundan
     sonra uygulanır ki yeni kopya tuvalleri boş kalmasın). */
  if (snapshot.__canvases) applyCanvasFrames(snapshot.__canvases);
  if (snapshot.__ref) applyRefFrame(snapshot.__ref);
}

function mountPanelHtml(html) {
  if (!root) return;
  /* Konuk <webview> ön yükleyicisi ana süreçte (will-attach-webview) atanır.
     Kopyalanan markup'taki preload özniteliği ana pencerenin yolunu taşır;
     ayrı pencerede bu özniteliğe güvenilmez, kaldırılır. */
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const pendingSrc = [];
  for (const view of template.content.querySelectorAll('webview')) {
    view.removeAttribute('preload');
    /* Ana penceredeki akışla aynı sıra: önce webview bağlanır, sonra src
       verilir; böylece ana süreçte atanan ön yükleyici konuk sayfaya uygulanır. */
    const src = view.getAttribute('src');
    if (src) {
      view.removeAttribute('src');
      pendingSrc.push([view, src]);
    }
  }
  root.replaceChildren(template.content);
  for (const [view, src] of pendingSrc) {
    setTimeout(() => {
      try { view.setAttribute('src', src); } catch { /* panel kapandı */ }
    }, 0);
  }
}

/* ---------- v5 çizim panelleri: işaretçi / tekerlek köprüsü ----------
   v5 panelleri canvas ve gerçek yerleşim geometrisiyle çalışır; tıklama
   köprüsü sürükleme (renk çarkı, katman sırası) ve tekerlek kaydırma
   için yetmez. Ayrı penceredeki koordinatlar ana paneldeki görünmez
   yerleşime eşlenir (17b-panel-dock.js). */
let v5Pointer = null;
let v5MoveFrame = 0;
let v5PendingMove = null;
let v5RefDrag = null;
let v5RefPending = null;
let v5RefFrame = 0;

function v5SendPointer(event, kind, fallback) {
  const panel = v5Root();
  if (!panel || !bridge || !panelId) return;
  const rect = panel.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const point = event && Number.isFinite(event.clientX)
    ? { x: event.clientX, y: event.clientY }
    : (fallback || { x: 0, y: 0 });
  const action = {
    type: 'v5-pointer', kind,
    x: point.x - rect.left,
    y: point.y - rect.top,
    w: rect.width, h: rect.height,
    buttons: kind === 'up' || kind === 'cancel' ? 0 : 1,
    ctrlKey: !!(event && event.ctrlKey),
    shiftKey: !!(event && event.shiftKey),
    altKey: !!(event && event.altKey),
    metaKey: !!(event && event.metaKey),
  };
  const target = event && event.target instanceof Element ? event.target : null;
  const el = target && panel.contains(target) ? target : panel;
  if (el.id) action.id = el.id;
  else {
    const elPath = elementPath(el);
    if (elPath) {
      action.path = elPath;
      action.tag = String(el.tagName || '').slice(0, 16);
    }
  }
  v5Pointer = v5Pointer && kind !== 'up' && kind !== 'cancel'
    ? { ...v5Pointer, x: point.x, y: point.y } : v5Pointer;
  bridge.sendAction(panelId, action);
}

function v5FlushRefPan() {
  v5RefFrame = 0;
  const pending = v5RefPending;
  v5RefPending = null;
  if (!pending || !bridge || !panelId) return;
  bridge.sendAction(panelId, {
    type: 'v5-ref-pan',
    dx: pending.dx, dy: pending.dy, w: pending.w, h: pending.h,
  });
}

/* ---------- pencereyi panel kenarından boyutlandırma ----------
   Kopya pencereyi doldurur; kenardaki v5 tutamağı sürüklenince dış
   pencere büyür/küçülür. Ana süreç gölge boşluğunu ekleyip gerçek
   pencere sınırlarını uygular (panel-window-manager.js). */
let v5PanelResize = null;
let v5MetricsTimer = 0;

function panelSurface() {
  return capabilities.v5 ? v5Root() : (root && root.firstElementChild);
}

function visiblePanelBounds() {
  const panel = panelSurface();
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: window.screenX + rect.left,
    y: window.screenY + rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/* Yeni pencere ölçüsünü ana panele bildir: gizli panel aynı ölçüde
   yerleşime sokulur, çark/önizlemeler o çözünürlükte yeniden çizilir. */
function reportV5Metrics() {
  if (!capabilities.v5 || !bridge || !panelId) return;
  const panel = v5Root();
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const action = { type: 'v5-size', w: rect.width, h: rect.height };
  if (capabilities.ref) {
    const stage = root.querySelector('#v5RefStage');
    if (stage) {
      const sr = stage.getBoundingClientRect();
      if (sr.width > 10 && sr.height > 10) {
        action.refW = sr.width;
        action.refH = sr.height;
      }
    }
  }
  bridge.sendAction(panelId, action);
}

function scheduleV5Metrics(delay = 140) {
  if (!capabilities.v5) return;
  clearTimeout(v5MetricsTimer);
  v5MetricsTimer = setTimeout(() => {
    if (v5PanelResize) return;
    reportV5Metrics();
  }, delay);
}

function beginPanelResize(event, dir) {
  if (!bridge || !panelId || !bridge.setPanelBounds || panelFullscreen || applying) return;
  const rect = visiblePanelBounds();
  if (!rect) return;
  const pid = event.pointerId;
  const startScreenX = Number.isFinite(event.screenX) ? event.screenX : window.screenX + event.clientX;
  const startScreenY = Number.isFinite(event.screenY) ? event.screenY : window.screenY + event.clientY;
  const minW = Math.max(160, Number(capabilities.minWidth) || 220);
  const minH = Math.max(120, Number(capabilities.minHeight) || 180);
  const state = {
    rect, startScreenX, startScreenY, minW, minH,
    pending: null, frame: 0, lastSent: '',
  };
  v5PanelResize = state;
  document.body.classList.add('panel-resizing');
  try { root.setPointerCapture(pid); } catch { /* sessiz */ }

  const flush = () => {
    state.frame = 0;
    if (!state.pending) return;
    const next = state.pending;
    const signature = [next.x, next.y, next.width, next.height].join(',');
    if (signature === state.lastSent) return;
    state.lastSent = signature;
    try { bridge.setPanelBounds(panelId, next); } catch { /* sessiz */ }
  };

  const move = ev => {
    if (ev.pointerId !== pid) return;
    ev.preventDefault();
    const dx = ev.screenX - startScreenX;
    const dy = ev.screenY - startScreenY;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    let x = rect.x;
    let y = rect.y;
    let width = rect.width;
    let height = rect.height;

    if (dir.includes('e')) width = Math.max(minW, rect.width + dx);
    if (dir.includes('s')) height = Math.max(minH, rect.height + dy);
    if (dir.includes('w')) {
      x = Math.min(rect.x + dx, right - minW);
      width = right - x;
    }
    if (dir.includes('n')) {
      y = Math.min(rect.y + dy, bottom - minH);
      height = bottom - y;
    }

    state.pending = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
    if (!state.frame) state.frame = requestAnimationFrame(flush);
  };

  const end = ev => {
    if (ev && ev.pointerId !== undefined && ev.pointerId !== pid) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', end);
    if (state.frame) { cancelAnimationFrame(state.frame); state.frame = 0; }
    flush();
    v5PanelResize = null;
    document.body.classList.remove('panel-resizing');
    try { root.releasePointerCapture(pid); } catch { /* sessiz */ }
    /* Görünüm yeni ölçüye oturduktan sonra çark/ref rasterı tazelenir. */
    setTimeout(() => {
      const panel = v5Root();
      if (panel) {
        const box = panel.getBoundingClientRect();
        v5Frame = { w: box.width, h: box.height };
        root.style.setProperty('--v5-copy-w', v5Frame.w + 'px');
        root.style.setProperty('--v5-copy-h', v5Frame.h + 'px');
      }
      reportV5Metrics();
    }, 120);
  };

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end, { once: true });
  window.addEventListener('pointercancel', end, { once: true });
  window.addEventListener('blur', end);
}

root.addEventListener('pointerdown', event => {
  if (!capabilities.v5 || applying || event.button !== 0) return;
  const panel = v5Root();
  if (!panel || !(event.target instanceof Element) || !panel.contains(event.target)) return;
  /* Referans mini tahtası kendi gezinme köprüsünü kullanır. */
  if (capabilities.ref && event.target.closest('#v5RefStage')) return;
  /* Kenar tutamağı pencereyi boyutlandırır; işaretçi köprüsüne gitmez. */
  if (event.target.closest('.v5-resize-edge')) return;
  /* Düğme ve metin girdileri normal tıklama/yazma köprüsüyle çalışır;
     yalnız sürükleme gerektiren yüzeyler işaretçi köprüsüne gider. */
  const control = event.target.closest(
    'button, a, input:not([type="range"]), select, textarea, [contenteditable="true"]'
  );
  if (control) return;
  v5Pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  try { root.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
  if (event.target.tagName === 'CANVAS') event.preventDefault();
  v5SendPointer(event, 'down');
}, true);

/* v5 panel kenarındaki görünmez tutamak: ayrı pencereyi boyutlandır. */
root.addEventListener('pointerdown', event => {
  if (!capabilities.v5 || applying || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  const handle = target && target.closest('.v5-resize-edge');
  if (!handle) return;
  event.preventDefault();
  event.stopPropagation();
  beginPanelResize(event, String(handle.dataset.dir || 'se'));
}, true);

root.addEventListener('pointermove', event => {
  if (!capabilities.v5) return;
  if (v5RefDrag && event.pointerId === v5RefDrag.id) {
    /* Sürükleme sırasında kopya yeniden kurulursa (yapı güncellemesi) ya da
       işaretçi pencere dışında bırakılırsa pointerup ulaşmayabilir. Tuşlar
       bırakılmışsa biriken kaydırmayı uygula ve durumu temizle; aksi halde
       sonraki hareketsiz fare hareketi panoyu kendiliğinden kaydırırdı. */
    if (!event.buttons) {
      if (v5RefPending) { cancelAnimationFrame(v5RefFrame); v5RefFrame = 0; v5FlushRefPan(); }
      v5RefDrag = null;
      return;
    }
    const dx = event.clientX - v5RefDrag.x;
    const dy = event.clientY - v5RefDrag.y;
    if (!dx && !dy) return;
    v5RefDrag.x = event.clientX;
    v5RefDrag.y = event.clientY;
    if (!v5RefPending) v5RefPending = { dx: 0, dy: 0, w: v5RefDrag.w, h: v5RefDrag.h };
    v5RefPending.dx += dx;
    v5RefPending.dy += dy;
    if (!v5RefFrame) v5RefFrame = requestAnimationFrame(v5FlushRefPan);
    return;
  }
  if (!v5Pointer || event.pointerId !== v5Pointer.id) return;
  v5PendingMove = event;
  if (v5MoveFrame) return;
  v5MoveFrame = requestAnimationFrame(() => {
    v5MoveFrame = 0;
    const pending = v5PendingMove;
    v5PendingMove = null;
    if (pending) v5SendPointer(pending, 'move');
  });
}, true);

function endV5Pointer(event) {
  if (!capabilities.v5) return;
  if (v5RefDrag && (!event || event.pointerId === undefined || event.pointerId === v5RefDrag.id)) {
    if (v5RefPending) { cancelAnimationFrame(v5RefFrame); v5RefFrame = 0; v5FlushRefPan(); }
    v5RefDrag = null;
  }
  if (!v5Pointer) return;
  if (event && event.pointerId !== undefined && event.pointerId !== v5Pointer.id) return;
  const last = { x: v5Pointer.x, y: v5Pointer.y };
  if (v5MoveFrame) { cancelAnimationFrame(v5MoveFrame); v5MoveFrame = 0; }
  v5PendingMove = null;
  v5SendPointer(event, 'up', last);
  v5Pointer = null;
}
root.addEventListener('pointerup', endV5Pointer, true);
root.addEventListener('pointercancel', endV5Pointer, true);
root.addEventListener('lostpointercapture', event => {
  if (v5Pointer || v5RefDrag) endV5Pointer(event);
}, true);

/* Mini tahta: sürükle = gezin, tekerlek = yakınlaştır. */
root.addEventListener('pointerdown', event => {
  if (!capabilities.v5 || !capabilities.ref || event.button !== 0) return;
  const stage = event.target instanceof Element ? event.target.closest('#v5RefStage') : null;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  v5RefDrag = {
    id: event.pointerId,
    x: event.clientX, y: event.clientY,
    w: rect.width, h: rect.height,
  };
  try { root.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
  event.preventDefault();
}, true);

root.addEventListener('wheel', event => {
  if (!capabilities.v5 || !bridge || !panelId) return;
  const panel = v5Root();
  if (!panel || !(event.target instanceof Element) || !panel.contains(event.target)) return;
  event.preventDefault();
  if (capabilities.ref && event.target.closest('#v5RefStage')) {
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
    bridge.sendAction(panelId, { type: 'v5-ref-zoom', factor });
    return;
  }
  const rect = panel.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const wheelTarget = event.target instanceof Element && panel.contains(event.target)
    ? event.target : panel;
  const wheelAction = {
    type: 'v5-wheel',
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    w: rect.width, h: rect.height,
    deltaX: event.deltaX, deltaY: event.deltaY,
    ctrlKey: !!event.ctrlKey, shiftKey: !!event.shiftKey, altKey: !!event.altKey,
  };
  if (wheelTarget.id) wheelAction.id = wheelTarget.id;
  else {
    const wheelPath = elementPath(wheelTarget);
    if (wheelPath) {
      wheelAction.path = wheelPath;
      wheelAction.tag = String(wheelTarget.tagName || '').slice(0, 16);
    }
  }
  bridge.sendAction(panelId, wheelAction);
}, { capture: true, passive: false });

window.addEventListener('resize', () => {
  if (!capabilities.v5) return;
  if (v5PanelResize) return;
  /* Doğal pencere kenarından boyutlandırma da ana panele yansısın. */
  scheduleV5Metrics(180);
});

if (bridge) {
  bridge.onInit(data => {
    if (!data) return;
    panelId = String(data.id || '');
    capabilities = {
      files: !!(data.capabilities && data.capabilities.files),
      shortcuts: !!(data.capabilities && data.capabilities.shortcuts),
      v5: !!(data.capabilities && data.capabilities.v5),
      ref: !!(data.capabilities && data.capabilities.ref),
      minWidth: Math.max(160, Number(data.capabilities && data.capabilities.minWidth) || 220),
      minHeight: Math.max(120, Number(data.capabilities && data.capabilities.minHeight) || 180),
    };
    if (capabilities.v5) {
      document.body.classList.add('panel-v5');
      if (data.frame && Number(data.frame.w) > 0 && Number(data.frame.h) > 0) {
        v5Frame = { w: Number(data.frame.w), h: Number(data.frame.h) };
        root.style.setProperty('--v5-copy-w', v5Frame.w + 'px');
        root.style.setProperty('--v5-copy-h', v5Frame.h + 'px');
      }
    }
    setTitle(data.title);
    applyTheme(data.theme);
    ensureSprite(data.sprite);
    mountPanelHtml(data.html);
    bindGuestViews();
    bindYoutubeFrame();
    ensureDragRegion(capabilities.v5 ? v5Root() : (root && root.firstElementChild));
    dockLabel = String(data.dockLabel || '');
    if (data.snapshot) applySnapshot(data.snapshot);
    paintFullscreenButton(false);
    paintPopoutButton();
    syncPanelFullscreen();
    /* Kopya görünümü ilk kez yerleştiğinde ölçüyü ana panele bildir:
       referans rasterı ve çark çözünürlüğü pencereyle eşleşsin. */
    setTimeout(() => { reportV5Metrics(); }, 220);
  });
  bridge.onUpdate(applySnapshot);
  bridge.onGuestSend((channel, args) => {
    const view = guestViews.find(item => {
      try { return !item.isDestroyed(); } catch { return false; }
    }) || (root && root.querySelector('webview'));
    if (!view) return;
    const list = Array.isArray(args) ? args : [];
    try {
      if (channel === '__view-reload') view.reload();
      else if (channel === '__view-load-url') view.loadURL(String(list[0] || ''));
      else if (channel === '__view-back') { try { view.goBack(); } catch { } }
      else if (channel === '__view-forward') { try { view.goForward(); } catch { } }
      else view.send(channel, ...list);
    } catch { /* konuk henüz hazır değil */ }
  });
}
