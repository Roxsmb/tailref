'use strict';

/* TailRef — ayrı panel pencereleri (tek yetkili yönetici)
   ---------------------------------------------------------
   Panel ana pencereden dışarı sürüklendiğinde burada her zaman üstte
   duran, bağımsız bir pencere açılır. İçerik ana penceredeki panelin
   kopyasıdır; etkileşim IPC ile ana panele iletilir, güncellemeler geri
   yansıtılır.

   Bu modül hem pencere yaşam döngüsünün hem de IPC kanallarının TEK
   sahibidir. Renderer tarafındaki denetleyici (17b-panel-dock.js) yalnız
   buradaki sözleşmeyi kullanır; ikinci bir pencere yöneticisi yoktur. */

const PANEL_WINDOW_PAD = Object.freeze({ top: 22, side: 42, bottom: 62 });
const PANEL_DOCK_GRACE_MS = 900;
const PANEL_DOCK_INSET = 16;

/* Panel kimliği başına varsayılan görünür boyut ve yetenek.
   `guest`: kopyada <webview> taşır (Pinterest/ArtStation).
   `files`/`shortcuts`: ayrı pencereden dosya ve kısayol köprüsü kullanır. */
const PANEL_WINDOW_SPECS = Object.freeze({
  settings: { width: 380, height: 560, minWidth: 260, minHeight: 220, files: true, shortcuts: true },
  pomodoroPanel: { width: 300, height: 430, minWidth: 240, minHeight: 200 },
  youtubeMusicPanel: { width: 420, height: 600, minWidth: 300, minHeight: 220 },
  itemBar: { width: 360, height: 620, minWidth: 260, minHeight: 220 },
  help: { width: 520, height: 620, minWidth: 300, minHeight: 220 },
  inspector: { width: 360, height: 520, minWidth: 260, minHeight: 180 },
  pinterestPanel: { width: 700, height: 780, minWidth: 360, minHeight: 300, guest: true },
  artstationPanel: { width: 700, height: 780, minWidth: 360, minHeight: 300, guest: true },
  /* Çizim modu v5 panelleri: DOM kopyası + tuval raster + işaretçi köprüsü. */
  v5ReferencePanel: { width: 300, height: 420, minWidth: 220, minHeight: 180, v5: true, ref: true },
  v5ColorPanel: { width: 300, height: 560, minWidth: 240, minHeight: 260, v5: true },
  v5LayersPanel: { width: 300, height: 480, minWidth: 240, minHeight: 200, v5: true },
  v5BrushPanel: { width: 320, height: 560, minWidth: 240, minHeight: 240, v5: true, files: true },
});

const HTML_MAX_BYTES = 2 * 1024 * 1024;
const SPRITE_MAX_BYTES = 512 * 1024;
const MAX_ACTION_STRING = 512;
const MAX_FILE_COUNT = 8;
const MAX_FILE_BASE64 = 48 * 1024 * 1024;
const ACTION_TYPES = new Set([
  'click', 'input', 'change', 'keydown', 'files', 'shortcut',
  'shortcut-begin', 'scroll',
  /* v5 çizim panelleri: koordinatlı işaretçi/tekerlek ve mini tahta
     gezinme köprüsü. */
  'v5-pointer', 'v5-wheel', 'v5-ref-pan', 'v5-ref-zoom', 'v5-size',
]);

function text(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPanelBounds(screen, bounds) {
  const width = Math.max(240, Math.round(Number(bounds.width) || 360));
  const height = Math.max(160, Math.round(Number(bounds.height) || 420));
  let x = Math.round(Number(bounds.x) || 0);
  let y = Math.round(Number(bounds.y) || 0);
  try {
    const display = screen.getDisplayMatching({ x, y, width, height });
    const area = display.workArea;
    x = Math.max(area.x, Math.min(x, area.x + area.width - width));
    y = Math.max(area.y, Math.min(y, area.y + area.height - height));
    return { x, y, width, height };
  } catch {
    return { x, y, width, height };
  }
}

/* Saydam pencere boşluğu çıkarıldığında kullanıcının gördüğü panel alanı. */
function visiblePanelBounds(bounds) {
  return {
    x: bounds.x + PANEL_WINDOW_PAD.side,
    y: bounds.y + PANEL_WINDOW_PAD.top,
    width: Math.max(120, bounds.width - PANEL_WINDOW_PAD.side * 2),
    height: Math.max(80, bounds.height - PANEL_WINDOW_PAD.top - PANEL_WINDOW_PAD.bottom),
  };
}

function createPanelWindowManager(options) {
  const {
    BrowserWindow, ipcMain, screen, path,
    preloadDir, appUrl, getMainWindow, installGuestPolicy,
  } = options;

  /* id → entry. Tek örnek kuralı: aynı panel için ikinci pencere açılmaz. */
  const windows = new Map();

  const mainWindow = () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  const panelId = value => {
    const id = text(value, 64);
    return Object.prototype.hasOwnProperty.call(PANEL_WINDOW_SPECS, id) ? id : '';
  };

  function entryFor(id, sender) {
    const entry = windows.get(panelId(id));
    if (!entry) return null;
    if (!entry.win || entry.win.isDestroyed()) {
      windows.delete(panelId(id));
      return null;
    }
    if (sender && entry.win.webContents !== sender) return null;
    return entry;
  }

  function sendToMain(channel, payload) {
    const win = mainWindow();
    if (!win) return;
    try { win.webContents.send(channel, payload); } catch { /* kapanmış olabilir */ }
  }

  function setFullscreen(entry, on) {
    if (!entry || !entry.win || entry.win.isDestroyed()) return false;
    const active = !!on;
    if (active === !!entry.fullscreen) return active;
    if (active) {
      entry.preFullscreenBounds = entry.win.getBounds();
      entry.fullscreen = true;
      let area = null;
      try { area = screen.getDisplayMatching(entry.win.getBounds()).workArea; } catch { area = null; }
      if (area) entry.win.setBounds(area);
    } else {
      entry.fullscreen = false;
      const back = entry.preFullscreenBounds || entry.homeBounds;
      entry.preFullscreenBounds = null;
      if (back) entry.win.setBounds(back);
    }
    return active;
  }

  /* Ayrı panel uygulama penceresinin içine geri bırakıldıysa onu yeniden
     uygulamaya takar. Panelin merkezi ana pencerenin içindeyse yeterli
     sayılır; böylece kenara bırakılan panel de geri döner. */
  /* Panelin görünen merkezi ana pencerenin içinde mi? */
  function panelCenterInsideMain(bounds, main) {
    if (!main || !bounds) return false;
    const panel = visiblePanelBounds(bounds);
    const content = main.getContentBounds();
    const cx = panel.x + panel.width / 2;
    const cy = panel.y + panel.height / 2;
    return cx >= content.x + PANEL_DOCK_INSET
      && cx <= content.x + content.width - PANEL_DOCK_INSET
      && cy >= content.y + PANEL_DOCK_INSET
      && cy <= content.y + content.height - PANEL_DOCK_INSET;
  }

  function maybeDock(entry) {
    if (!entry || entry.docking || entry.closing) return;
    if (!entry.win || entry.win.isDestroyed()) return;
    /* Tam ekrandaki panel ekranı kapladığı için yanlışlıkla "içeri bırakıldı"
       sayılıp geri takılmamalı. */
    if (entry.fullscreen) return;
    /* Boyutlandırma sırasında kenar taşıma olarak yorumlanıp panel
       kendiliğinden geri takılmasın. */
    if (entry.resizingUntil && Date.now() < entry.resizingUntil) return;
    const main = mainWindow();
    if (!main || !main.isVisible() || main.isMinimized()) return;
    if (!entry.shownAt || Date.now() - entry.shownAt < PANEL_DOCK_GRACE_MS) return;
    const b = entry.win.getBounds();
    const inside = panelCenterInsideMain(b, main);
    /* Düğmeyle açılan pencere uygulamanın üstünde doğar. İlk hareket
       geri takma sayılırsa panel tutulamıyordu: pencere en az bir kez
       uygulamanın dışına çıkmadan geri takılmaz. */
    if (!inside) {
      entry.dockArmed = true;
      entry.dockRect = null;
      return;
    }
    if (!entry.dockArmed) return;
    const panel = visiblePanelBounds(b);
    const content = main.getContentBounds();
    /* Geri takılan panelin uygulama içinde görünür kalacağı dikdörtgen;
       ana pencerenin dışına taşarsa kırpılır. */
    const maxW = Math.max(160, content.width - 16);
    const maxH = Math.max(100, content.height - 16);
    entry.dockRect = {
      left: Math.max(0, Math.min(panel.x - content.x, maxW - Math.min(panel.width, maxW))),
      top: Math.max(0, Math.min(panel.y - content.y, maxH - Math.min(panel.height, maxH))),
      width: Math.min(panel.width, maxW),
      height: Math.min(panel.height, maxH),
    };
    entry.docking = true;
    entry.restoreOnClose = true;
    try { main.show(); main.focus(); } catch { /* pencere kapanmış olabilir */ }
    entry.win.close();
  }

  function open(event, payload) {
    const main = mainWindow();
    if (!main || event.sender !== main.webContents) return { ok: false };
    const data = payload && typeof payload === 'object' ? payload : {};
    const id = panelId(data.id);
    if (!id) return { ok: false };
    const spec = PANEL_WINDOW_SPECS[id];

    const existing = entryFor(id);
    if (existing) {
      existing.restoreOnClose = true;
      existing.dockRect = null;
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show();
      existing.win.focus();
      return { ok: true, reused: true };
    }

    /* Panelin gölgesi pencere kenarında kırpılmasın: saydam pencerede
       panelin çevresine boşluk bırakılır. Gölge 40 px yana, 20 px yukarı,
       60 px aşağı taşar; boşluk buna göre asimetriktir. Görünen panel
       boyutu ve konumu uygulama içindekiyle aynı kalır. */
    const contentW = Math.max(240, Math.min(4096, Math.round(finiteNumber(data.width, spec.width))));
    const contentH = Math.max(160, Math.min(4096, Math.round(finiteNumber(data.height, spec.height))));
    const bounds = clampPanelBounds(screen, {
      x: Math.round(finiteNumber(data.x, 0)) - PANEL_WINDOW_PAD.side,
      y: Math.round(finiteNumber(data.y, 0)) - PANEL_WINDOW_PAD.top,
      width: contentW + PANEL_WINDOW_PAD.side * 2,
      height: contentH + PANEL_WINDOW_PAD.top + PANEL_WINDOW_PAD.bottom,
    });

    const panelWin = new BrowserWindow({
      x: bounds.x, y: bounds.y,
      width: bounds.width, height: bounds.height,
      /* Görünen panel alt sınırı + gölge boşluğu. */
      minWidth: Math.min(spec.minWidth + PANEL_WINDOW_PAD.side * 2, bounds.width),
      minHeight: Math.min(spec.minHeight + PANEL_WINDOW_PAD.top + PANEL_WINDOW_PAD.bottom, bounds.height),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      roundedCorners: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      autoHideMenuBar: true,
      show: false,
      title: text(data.title || 'TailRef panel', 120),
      webPreferences: {
        preload: path.join(preloadDir, 'panel-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,
        /* Yalnızca konuk panel (Pinterest/ArtStation) <webview> barındırır. */
        webviewTag: !!spec.guest,
      },
    });
    const entry = {
      id,
      win: panelWin,
      restoreOnClose: true,
      shownAt: 0,
      docking: false,
      closing: false,
      silent: false,
      dockRect: null,
      moveTimer: 0,
      homeBounds: null,
      fullscreen: false,
      preFullscreenBounds: null,
      /* Açılış konumu uygulamanın içindeyse geri takma ancak pencere bir
         kez dışarı çıktıktan sonra etkinleşir. */
      dockArmed: !panelCenterInsideMain(panelWin.getBounds(), main),
      resizingUntil: 0,
    };
    windows.set(id, entry);

    if (spec.guest && typeof installGuestPolicy === 'function') {
      installGuestPolicy(panelWin.webContents);
    }
    try { panelWin.setAlwaysOnTop(true, 'floating'); } catch { /* pencere yöneticisi desteklemiyorsa */ }
    panelWin.loadURL(appUrl + 'panel.html');
    panelWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    /* Ayrı panel penceresi yalnızca uygulamanın kendi origin'inde kalır.
       Kopyalanan panel HTML'i bir bağlantı içerse bile pencere harici bir
       siteye gezemez; dış bağlantılar ana penceredeki open-external
       kapısından geçer. */
    let panelOrigin = '';
    try { panelOrigin = new URL(appUrl).origin; } catch { /* appUrl sabit */ }
    const guardPanelNavigation = (event, url) => {
      try {
        if (panelOrigin && new URL(url).origin === panelOrigin) return;
      } catch { /* geçersiz URL: engelle */ }
      event.preventDefault();
    };
    panelWin.webContents.on('will-navigate', guardPanelNavigation);
    panelWin.webContents.on('will-redirect', guardPanelNavigation);

    panelWin.once('ready-to-show', () => {
      if (panelWin.isDestroyed()) return;
      entry.shownAt = Date.now();
      entry.homeBounds = panelWin.getBounds();
      panelWin.show();
    });

    /* Sürükleme bitince panel ana pencerenin üstündeyse geri tak. Electron
       Windows'ta 'moved' olayını her sürüklemede yaymadığı için 'move'
       olayı kısa bir gecikmeyle sonlandırılır. */
    const scheduleDockCheck = () => {
      if (entry.closing) return;
      entry.dockRect = null;
      clearTimeout(entry.moveTimer);
      entry.moveTimer = setTimeout(() => maybeDock(entry), 200);
    };
    panelWin.on('move', scheduleDockCheck);
    panelWin.on('moved', scheduleDockCheck);

    panelWin.webContents.once('did-finish-load', () => {
      if (panelWin.isDestroyed()) return;
      const frame = data.frame && typeof data.frame === 'object'
        ? {
            w: Math.max(120, Math.min(4096, Math.round(finiteNumber(data.frame.w, contentW)))),
            h: Math.max(80, Math.min(4096, Math.round(finiteNumber(data.frame.h, contentH)))),
          }
        : null;
      panelWin.webContents.send('panel-init', {
        id,
        title: text(data.title || 'Panel', 120),
        theme: text(data.theme || '', 64),
        html: text(data.html || '', HTML_MAX_BYTES),
        sprite: text(data.sprite || '', SPRITE_MAX_BYTES),
        dockLabel: text(data.dockLabel || '', 120),
        snapshot: data.snapshot && typeof data.snapshot === 'object' ? data.snapshot : null,
        frame,
        capabilities: {
          files: !!spec.files && !!(data.capabilities && data.capabilities.files),
          shortcuts: !!spec.shortcuts && !!(data.capabilities && data.capabilities.shortcuts),
          v5: !!spec.v5 && !!(data.capabilities && data.capabilities.v5),
          ref: !!spec.ref && !!(data.capabilities && data.capabilities.ref),
          minWidth: spec.minWidth,
          minHeight: spec.minHeight,
        },
      });
    });

    panelWin.on('closed', () => {
      clearTimeout(entry.moveTimer);
      if (windows.get(id) === entry) windows.delete(id);
      if (entry.silent) return;
      sendToMain('panel-window-closed', {
        id,
        restore: entry.restoreOnClose !== false,
        dock: entry.dockRect || null,
      });
    });

    return { ok: true };
  }

  function closeEntry(entry, restore) {
    if (!entry || !entry.win || entry.win.isDestroyed()) return false;
    entry.restoreOnClose = restore !== false;
    entry.closing = true;
    entry.win.close();
    return true;
  }

  function sanitizeAction(action) {
    if (!action || typeof action !== 'object') return null;
    const type = text(action.type, 32);
    if (!ACTION_TYPES.has(type)) return null;
    if (type === 'shortcut-begin') {
      const target = text(action.target, 64);
      return target ? { type, target } : null;
    }
    const id = text(action.id, 128);
    /* Kimliksiz dinamik düğmeler çocuk indeksi yoluyla eşlenir. */
    let path = null;
    if (!id && Array.isArray(action.path) && action.path.length
        && action.path.length <= 32) {
      path = [];
      for (const step of action.path) {
        const index = Number(step);
        if (!Number.isInteger(index) || index < 0 || index > 9999) { path = null; break; }
        path.push(index);
      }
    }
    if (!id && !path && type !== 'shortcut'
        && type !== 'v5-ref-pan' && type !== 'v5-ref-zoom'
        && type !== 'v5-size') return null;
    const clean = { type, id };
    if (path) {
      clean.path = path;
      clean.tag = text(action.tag, 16);
    }
    if (type === 'click' || type === 'input' || type === 'change' || type === 'keydown') {
      if (action.value !== undefined) clean.value = text(action.value, 64 * 1024);
      if (action.checked !== undefined) clean.checked = !!action.checked;
      if (action.key !== undefined) clean.key = text(action.key, 32);
      if (action.code !== undefined) clean.code = text(action.code, 32);
      if (action.repeat !== undefined) clean.repeat = !!action.repeat;
      for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
        if (action[key] !== undefined) clean[key] = !!action[key];
      }
    } else if (type === 'shortcut') {
      clean.key = text(action.key, 32);
      clean.code = text(action.code, 32);
      for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
        clean[key] = !!action[key];
      }
    } else if (type === 'scroll') {
      clean.scrollTop = finiteNumber(action.scrollTop, 0);
      clean.scrollLeft = finiteNumber(action.scrollLeft, 0);
    } else if (type === 'files') {
      const files = Array.isArray(action.files) ? action.files.slice(0, MAX_FILE_COUNT) : [];
      clean.files = [];
      let total = 0;
      for (const file of files) {
        if (!file || typeof file !== 'object') continue;
        const base64 = text(file.base64, MAX_FILE_BASE64);
        total += base64.length;
        if (!base64 || total > MAX_FILE_BASE64) continue;
        clean.files.push({
          name: text(file.name || 'file', 256),
          type: text(file.type || '', 128),
          lastModified: finiteNumber(file.lastModified, Date.now()),
          base64,
        });
      }
      if (!clean.files.length) return null;
    } else if (type === 'v5-pointer') {
      const kind = text(action.kind, 12);
      clean.kind = ['down', 'move', 'up', 'cancel'].includes(kind) ? kind : 'move';
      clean.x = finiteNumber(action.x, 0);
      clean.y = finiteNumber(action.y, 0);
      clean.w = Math.max(0, finiteNumber(action.w, 0));
      clean.h = Math.max(0, finiteNumber(action.h, 0));
      clean.buttons = finiteNumber(action.buttons, 0) | 0;
      for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
        clean[key] = !!action[key];
      }
    } else if (type === 'v5-wheel') {
      clean.x = finiteNumber(action.x, 0);
      clean.y = finiteNumber(action.y, 0);
      clean.w = Math.max(0, finiteNumber(action.w, 0));
      clean.h = Math.max(0, finiteNumber(action.h, 0));
      clean.deltaX = finiteNumber(action.deltaX, 0);
      clean.deltaY = finiteNumber(action.deltaY, 0);
      for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
        clean[key] = !!action[key];
      }
    } else if (type === 'v5-ref-pan') {
      clean.dx = finiteNumber(action.dx, 0);
      clean.dy = finiteNumber(action.dy, 0);
      clean.w = Math.max(0, finiteNumber(action.w, 0));
      clean.h = Math.max(0, finiteNumber(action.h, 0));
    } else if (type === 'v5-ref-zoom') {
      clean.factor = Math.min(4, Math.max(0.2, finiteNumber(action.factor, 1)));
    } else if (type === 'v5-size') {
      clean.w = Math.max(0, Math.min(4096, finiteNumber(action.w, 0)));
      clean.h = Math.max(0, Math.min(4096, finiteNumber(action.h, 0)));
      clean.refW = Math.max(0, Math.min(4096, finiteNumber(action.refW, 0)));
      clean.refH = Math.max(0, Math.min(4096, finiteNumber(action.refH, 0)));
    }
    return clean;
  }

  function registerIpc() {
    ipcMain.handle('panel-window-open', (event, payload) => open(event, payload));

    ipcMain.on('panel-sync', (event, id, snapshot) => {
      const main = mainWindow();
      if (!main || event.sender !== main.webContents) return;
      const entry = entryFor(id);
      if (!entry || !snapshot || typeof snapshot !== 'object') return;
      const payload = snapshot.__html && String(snapshot.__html).length > HTML_MAX_BYTES
        ? { ...snapshot, __html: undefined }
        : snapshot;
      try { entry.win.webContents.send('panel-update', payload); } catch { /* kapanmış */ }
    });

    ipcMain.on('panel-action-from-window', (event, id, action) => {
      const entry = entryFor(id, event.sender);
      if (!entry) return;
      const clean = sanitizeAction(action);
      if (!clean) return;
      sendToMain('panel-action', { id: entry.id, action: clean });
    });

    /* Ayrı panel penceresindeki <webview> konuk sayfası ile ana pencere
       arasındaki köprü. Konuk betik mesajı kendi barındırıcısına yollar;
       burada ana uygulamaya iletilir. "Tahtaya ekle" yanıtı ve "görünenleri
       topla" komutu aynı yoldan döner. */
    ipcMain.on('panel-guest-message', (event, id, channel, args) => {
      const entry = entryFor(id, event.sender);
      if (!entry) return;
      sendToMain('panel-guest-message', {
        panelId: entry.id,
        channel: text(channel, 128),
        args: Array.isArray(args) ? args : [],
      });
    });

    ipcMain.on('panel-guest-send', (event, id, channel, args) => {
      const main = mainWindow();
      if (!main || event.sender !== main.webContents) return;
      const entry = entryFor(id);
      if (!entry) return;
      try {
        entry.win.webContents.send('panel-guest-send', text(channel, 128), Array.isArray(args) ? args : []);
      } catch { /* kapanmış */ }
    });

    ipcMain.on('panel-window-dock', (event, id) => {
      const entry = entryFor(id, event.sender);
      if (entry) closeEntry(entry, true);
    });

    ipcMain.on('panel-window-close', (event, id) => {
      const entry = entryFor(id, event.sender);
      if (entry) closeEntry(entry, true);
    });

    ipcMain.handle('panel-window-toggle-fullscreen', (event, id) => {
      const entry = entryFor(id, event.sender);
      return entry ? setFullscreen(entry, !entry.fullscreen) : false;
    });

    ipcMain.handle('panel-window-is-fullscreen', (event, id) => {
      const entry = entryFor(id, event.sender);
      return entry ? !!entry.fullscreen : false;
    });

    /* Ayrı penceredeki panelden gelen canlı boyutlandırma. Renderer görünen
       panelin ekran dikdörtgenini gönderir; gölge boşluğu burada eklenir. */
    ipcMain.on('panel-window-set-bounds', (event, id, bounds) => {
      const entry = entryFor(id, event.sender);
      if (!entry || entry.fullscreen || !bounds || typeof bounds !== 'object') return;
      const spec = PANEL_WINDOW_SPECS[entry.id] || {};
      const current = entry.win.getBounds();
      const minW = Math.max(160, Math.round(finiteNumber(spec.minWidth, 220)));
      const minH = Math.max(120, Math.round(finiteNumber(spec.minHeight, 180)));
      const width = Math.max(minW, Math.min(4096,
        Math.round(finiteNumber(bounds.width, current.width - PANEL_WINDOW_PAD.side * 2))));
      const height = Math.max(minH, Math.min(4096,
        Math.round(finiteNumber(bounds.height, current.height - PANEL_WINDOW_PAD.top - PANEL_WINDOW_PAD.bottom))));
      const x = Math.round(finiteNumber(bounds.x, current.x + PANEL_WINDOW_PAD.side));
      const y = Math.round(finiteNumber(bounds.y, current.y + PANEL_WINDOW_PAD.top));
      entry.resizingUntil = Date.now() + 400;
      try {
        entry.win.setBounds({
          x: x - PANEL_WINDOW_PAD.side,
          y: y - PANEL_WINDOW_PAD.top,
          width: width + PANEL_WINDOW_PAD.side * 2,
          height: height + PANEL_WINDOW_PAD.top + PANEL_WINDOW_PAD.bottom,
        }, false);
      } catch { /* pencere kapanmış olabilir */ }
    });

    /* Ana pencereden ayrı paneli kapatma (ör. seçim boşalınca itemBar).
       `restore=false` ise panel geri takılmaz, kapalı kalır. */
    ipcMain.handle('panel-window-force-close', (event, id, restore = true) => {
      const main = mainWindow();
      if (!main || event.sender !== main.webContents) return false;
      const entry = entryFor(id);
      return closeEntry(entry, restore);
    });
  }

  /* Ana pencere kapanırken / yenilenirken ayrı pencereler öksüz kalmasın.
     `notify=false`: renderer zaten gidiyor, kapanış mesajı göndermeyiz. */
  function destroyAll() {
    for (const entry of windows.values()) {
      entry.silent = true;
      entry.closing = true;
      clearTimeout(entry.moveTimer);
      try { if (entry.win && !entry.win.isDestroyed()) entry.win.destroy(); } catch { /* sessiz */ }
    }
    windows.clear();
  }

  return {
    registerIpc,
    destroyAll,
    has: id => !!entryFor(id),
    close: (id, restore = true) => closeEntry(entryFor(id), restore),
    specs: PANEL_WINDOW_SPECS,
  };
}

module.exports = {
  createPanelWindowManager,
  PANEL_WINDOW_SPECS,
  PANEL_WINDOW_PAD,
};
