'use strict';

/* TailRef — Electron ana süreç
   Statik dosyaları 127.0.0.1:5178 üzerinden sunar.
   Sabit port önemli: IndexedDB deposu bu origin'e bağlı. */

const { app, BrowserWindow, ipcMain, Menu, dialog, screen, session, shell, webContents, clipboard, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { registerPinterest } = require('./pinterest');
const { registerArtStation } = require('./artstation');
const { installGuestGuards } = require('./guest-guards');
const { createPanelWindowManager } = require('./panel-window-manager');
const { createUpdateManager } = require('./update-manager');
const { isPortableEnv } = require('./update-policy');
const { normalizeExternalUrl } = require('./external-links');
const ipcGuard = require('./ipc-guard');
const {
  isTailFilePath,
  normalizeExportDir,
  isAllowedExportDir,
} = require('./path-policy');

/* Ana-süreç diyalog yerelleştirmesi (dil renderer'dan gelir). */
const dialogL10n = require('./dialog-l10n');

/* C++ çekirdek ev sahibi (çizim motoru evre 1: uç üretimi). */
const inkEngineHost = require('./ink-engine-host');

/* Performans: gereksiz Chromium özelliklerini kapat */
app.commandLine.appendSwitch('disable-features',
  'InterestFeedContentSuggestions,Translate,OptimizationHints,NetworkPrediction,BackForwardCache');
app.commandLine.appendSwitch('enable-features', 'ParallelDownloading');
/* GPU hız yolları: bazı sürücüler "eski kart" listesine girdiği için
   Chromium donanım hızlandırmayı düşürüyordu; blocklist yok sayılıp
   GPU rasterization açılır (turbo surfaces: çizim + 3D). */
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-native-gpu-rasterization');
/* Linux: Wayland oturumunda yerel Wayland arka ucunu kullan; X11 oturumunda
   XWayland'e düşer. Fedora/openSUSE gibi dağıtımlarda varsayılan X11'de
   kalındığı için açıkça istiyoruz. Diğer platformlarda etkisizdir. */
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

/* Flatpak: masaüstü girdisi com.tailref.studio.desktop olarak kurulur.
   Pencerenin Wayland app_id'si / X11 WM_CLASS'ı aynı ada uymazsa dock ve
   görev çubuğu simgeyi eşleştiremez. FLATPAK_ID yalnızca sandbox içinde
   tanımlıdır; deb, rpm ve AppImage davranışı değişmez. */
if (process.platform === 'linux' && process.env.FLATPAK_ID &&
    typeof app.setDesktopName === 'function') {
  app.setDesktopName(`${process.env.FLATPAK_ID}.desktop`);
}
const path = require('path');
const { fileURLToPath } = require('url');
const fs   = require('fs');
const { startStaticServer } = require('./static-server');
/* (Canvas Editor köprüsü kaldırıldı — ayrı pencere akışı silindi.) */

/* Atomik yazım choke-point: kalıcılık dosyalarına yarım içerik asla düşmez.
   Ayrıntı ve Windows kilit/rename geri dönüşü: src/main/atomic-write.js.
   Eski yerel kopya, rename ikinci kez düşünce hedefi silip veriyi kaybediyordu
   (P0); modül artık eski dosyayı yana alır, asla geri dönüşsüz silmez. */
const { writeFileAtomic, reserveUniqueFile } = require('./atomic-write');

/* Test/otomasyon için ortam değişkeniyle geçici port ve veri klasörü
   kullanılabilir. Paketlenmiş uygulamada bu kapalıdır; port sabit kalır
   (IndexedDB deposu bu origin'e bağlı). */
const TEST_ENV = !app.isPackaged;
/* E2E kaçış kapağı: paketlenmiş uygulamada da izole port/veri klasörü ile
   başlatılabilsin — yalnızca TailRef_E2E=1 açıkça verilirse etkindir.
   Üretim davranışı değişmez; çift tık yolunun gerçek exe'de doğrulanması
   için gereklidir (kullanıcının gerçek profili hiç dokunulmaz). */
const E2E_ENV = process.env.TailRef_E2E === '1';
/* Test botları (smoke/gates) pencere örtüldüğünde (arka plan / başka
   pencerelerin arkasında) Chromium görünürlük tahmini rAF ve WAAPI
   animasyonlarını dondurur; FLIP/ink kapıları bunun için epey flake
   üretiyordu (9 Kasım). Azaltma yalnız test modunda kapatılır — üretimin
   pil/CPU davranışı değişmez. */
if (TEST_ENV || process.env.TailRef_TEST_SCREEN) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}
const PORT = ((TEST_ENV || E2E_ENV) && Number(process.env.TailRef_PORT)) || 5178;
const HOST = '127.0.0.1';
const APP_URL = `http://${HOST}:${PORT}/`;
ipcGuard.setAllowedOrigin(APP_URL);
const SRC_ROOT = __dirname;
const PRELOAD_DIR = path.join(SRC_ROOT, '..', 'preload');
const RENDERER_DIR = path.join(SRC_ROOT, '..', 'renderer');
const ROOT = RENDERER_DIR;

/* Uygulama içi konuk paneller: her bölüm yalnızca kendi ön yükleyicisiyle
   açılabilir. Listede olmayan bir partition ile webview eklenemez. */
const GUEST_PRELOADS = {
  'persist:pinterest': 'pinterest-preload.js',
  'persist:artstation': 'artstation-preload.js',
};

/* Konuk <webview> kuralları, webview'i barındıran her pencerede aynı olmalı.
   Ayrı panel penceresi de bu kancayı kurar; ön yükleyici kopyalanan markup'taki
   özniteliğe bırakılmaz, burada mutlak yolla atanır. Kanca eksik olduğunda
   konuk sayfada "＋ Tahtaya ekle" düğmesi hiç görünmüyordu. */
function installGuestWebviewPolicy(contents) {
  if (!contents) return;
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const preloadFile = GUEST_PRELOADS[params.partition];
    if (!preloadFile) { event.preventDefault(); return; }
    delete webPreferences.preloadURL;
    delete webPreferences.preload;
    webPreferences.preload = path.join(PRELOAD_DIR, preloadFile);
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.webviewTag = false;
  });
}

/* Yalnızca kopyalama ve tam ekran izinleri verilir; kamera, mikrofon, konum,
   bildirim gibi yetenekler uygulamaya hiçbir zaman verilmez. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function hardenSession(ses) {
  if (!ses) return;
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
}

/* Konuk panelde Pinterest/ArtStation bir servis çalışanı kaydettiğinde
   gezinmeler o çalışan üzerinden yönlendiriliyor; bu durumda Electron konuk
   sayfaya ön yükleyiciyi (pinterest-preload.js / artstation-preload.js) hiç
   enjekte etmiyor. Sonuç: görsellerin üzerindeki "＋ Tahtaya ekle" düğmesi
   görünmüyordu (hata da oluşmuyordu, betik hiç çalışmıyordu).

   Çözüm: konuk oturumlarındaki kayıtlı servis çalışanları açılışta silinir ve
   yeni kayıtlar engellenir. Sayfa doğrudan ağdan yüklenir; Pinterest/ArtStation
   girişi ve gezinme etkilenmez, yalnızca çevrimdışı önbellek kullanılmaz. */
function disableGuestServiceWorkers(ses) {
  if (!ses) return;
  try {
    ses.clearStorageData({ storages: ['serviceworkers'] }).catch(() => { /* yok say */ });
  } catch { /* yok say */ }
  const filter = { urls: ['*://*.pinterest.com/*', '*://*.artstation.com/*'] };
  /* Servis çalışanı betiği istenirken Chromium "Service-Worker: script"
     başlığını gönderir. Bu isteği iptal edince kayıt hiç oluşmaz. */
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = details.requestHeaders || {};
    if (headers['Service-Worker'] || headers['service-worker']) {
      callback({ cancel: true });
      return;
    }
    callback({ requestHeaders: headers });
  });
  /* Yedek: bilinen servis çalışanı betik yolu doğrudan engellenir. */
  ses.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (/\/sw\.js(?:$|\?)/i.test(details.url)) {
      callback({ cancel: true });
      return;
    }
    callback({});
  });
}

/* Pencere çok küçültülürse üst alan (marka + araç çubuğu) pencere yüksekliğini
   aşıp kırpılıyordu. Makul bir alt sınır koyuyoruz; ekran daha küçükse ekrana uyar. */
const MIN_WIN_W = 480;
const MIN_WIN_H = 300;

/* Kullanıcı verisi kaybolmasın: klasör TailRef olarak taşınır.
   Testler TailRef_USER_DATA ile izole bir klasör kullanabilir. */
let userDataOverride = '';
try {
  userDataOverride = (TEST_ENV || E2E_ENV) ? (process.env.TailRef_USER_DATA || '') : '';
  app.setPath('userData', userDataOverride
    ? path.resolve(userDataOverride)
    : path.join(app.getPath('appData'), 'TailRef'));
} catch { /* sessiz */ }

/* Bir seferlik klasör göçü: önceki markanın kullanıcı klasörü (yedekler,
   pencere konumu, kurtarma geçmişi) varsa ve yenisi yoksa içeriğiyle
   birlikte taşınır. Test profili (override) göç dışıdır. Eski klasör adı
   koda çıplak yazılmaz; base64 ile açılır. */
if (!userDataOverride) {
  try {
    const legacyName = Buffer.from('UmVmZXZlcnI=', 'base64').toString('utf8');
    const appData = app.getPath('appData');
    const legacyDir = path.join(appData, legacyName);
    const newDir = path.join(appData, 'TailRef');
    if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory() && !fs.existsSync(newDir)) {
      fs.renameSync(legacyDir, newDir);
    }
  } catch { /* klasör kilitli/erişilemez: sessiz devam, veri eski klasörde durur */ }
}

/* MIME tablosu ve dosya sunumu static-server.js içinde. */

let win  = null;
let winFullscreen = false;
/* Ayrı panel pencerelerinin tek yetkili yöneticisi (panel-window-manager.js).
   Örnek, tüm yardımcı fonksiyonlar tanımlandıktan sonra oluşturulur. */
let panelWindowManager = null;
let splashWin = null;
let mainReady = false;
let splashDone = false;
/* İlk açılış beyaz flash'ını (transparent pencere ilk kareden önce beyaz
   görünür) gizlemek için: renderer ilk frame'i çizince reveal-main-window
   sinyali gelir, pencere opaklığı rampayla 1'e çıkar. */
let revealDone = false;
let revealTimer = null;
let srv  = null;

/* Kapanış el sıkışması: renderer son değişiklikleri IndexedDB'ye yazmadan
   pencere kapanmasın. Renderer yanıt vermezse 5 sn sonra zorla kapat. */
let closeConfirmed = false;
let closeFallbackTimer = null;
/* Renderer kapanış isteğini aldığını bildirdi: kullanıcıya "kaydet?" sorusu
   gösteriyor. Bu durumda zaman aşımı uygulanmaz — kullanıcı ne kadar
   düşünürse düşünsün pencere kendiliğinden kapanmamalı. */
let closeAck = false;
const CLOSE_FALLBACK_MS = 5000;
/* ---------------- dosya sunucusu ----------------
   Statik sunucu static-server.js içinde; tarayıcı sürümü de aynı modülü kullanır. */

/* ---------------- pencere konumu + "üstte" tercihi ---------------- */
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function loadWindowState() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (b && Number.isFinite(b.width) && Number.isFinite(b.height)) return b;
  } catch { /* yok */ }
  return { width: 1440, height: 920, top: true };
}

function saveWindowState() {
  if (!win) return;
  try {
    writeFileAtomic(boundsFile(), JSON.stringify({
      ...win.getNormalBounds(),
      top: alwaysOnTop,
    }));
  } catch { /* sessiz */ }
}

/* Başka bir bilgisayarda (küçük ekran / farklı monitör düzeni) pencere
   ekranın dışında kalmasın: boyutu ve konumu görünür alana sığdır. */
function fitToScreen(b) {
  const disp = screen.getDisplayNearestPoint({
    x: Number.isFinite(b.x) ? b.x : 0,
    y: Number.isFinite(b.y) ? b.y : 0,
  });
  const wa = disp.workArea;
  const availableWidth = Math.max(1, wa.width - 24);
  const availableHeight = Math.max(1, wa.height - 24);
  // Kaydedilen boyut alt sınırın altındaysa (eski sürümden kalmış olabilir) yukarı çek.
  const wantW = Math.max(Number.isFinite(b.width) ? b.width : 1440, MIN_WIN_W);
  const wantH = Math.max(Number.isFinite(b.height) ? b.height : 920, MIN_WIN_H);
  const w = Math.round(Math.min(wantW, availableWidth));
  const h = Math.round(Math.min(wantH, availableHeight));
  let x = Number.isFinite(b.x) ? b.x : wa.x + Math.round((wa.width - w) / 2);
  let y = Number.isFinite(b.y) ? b.y : wa.y + Math.round((wa.height - h) / 2);

  const areas = screen.getAllDisplays().map(d => d.workArea);
  const onScreen = areas.some(a =>
    x + w > a.x + 60 && x < a.x + a.width - 60 &&
    y + h > a.y + 40 && y < a.y + a.height - 40);
  if (!onScreen) {
    x = wa.x + Math.round((wa.width - w) / 2);
    y = wa.y + Math.round((wa.height - h) / 2);
  }
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  return { x, y, width: w, height: h };
}

/* Test botları (smoke/probe) uygulamayı gerçek Electron ile başlatır;
   pencere kullanıcının çalışma ekranını kaplamasın diye
   TailRef_TEST_SCREEN=<n> verildiyse pencereler n'inci ekrana açılır
   (Windows Ayarları'ndaki ekran numaralandırması: 1 = birincil).
   Üretimde env tanımsızdır → davranış değişmez. Machine'mde ekran sayısı
   azsa son görünen ekrana kelepçelenir. */
function testScreenWorkArea() {
  const n = Number(process.env.TailRef_TEST_SCREEN);
  if (!Number.isFinite(n) || n < 2) return null;
  const displays = screen.getAllDisplays();
  const disp = displays[Math.min(displays.length, n) - 1];
  return disp ? disp.workArea : null;
}

/* ---------------- pencere ---------------- */
function createWindow() {
  closeConfirmed = false;
  closeAck = false;
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null; }
  const st = loadWindowState();
  const b = fitToScreen(st);
  /* Test ekranı istendiyse pencereyi o ekrana taşı (üretime etkisi yok). */
  const waTest = testScreenWorkArea();
  if (waTest) {
    const w = Math.min(b.width, waTest.width - 24);
    const h = Math.min(b.height, waTest.height - 24);
    b.x = waTest.x + Math.round((waTest.width - w) / 2);
    b.y = waTest.y + Math.round((waTest.height - h) / 2);
    b.width = w;
    b.height = h;
  }
  // varsayılan: her zaman üstte (kullanıcı kapatmadıysa)
  alwaysOnTop = st.top !== false;

  win = new BrowserWindow({
    x: b.x, y: b.y,
    width: b.width, height: b.height,
    minWidth: Math.min(MIN_WIN_W, b.width), minHeight: Math.min(MIN_WIN_H, b.height),
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    hasShadow: false,
    autoHideMenuBar: true,
    // Pencereyi HTML tamamen yüklenene kadar bekletme; ilk görünen katman splash GIF olsun.
    show: false,
    title: 'TailRef Studio',
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Renderer'ı işletim sistemi yetkilerinden yalıt: sandbox, Node'un
      // dosya/process API'lerine erişimi tamamen kapatır.
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      backgroundThrottling: false,
      // Pinterest paneli uygulama içinde <webview> ile açılır.
      // Konuk sayfa kendi kalıcı oturumunda çalışır; Node erişimi yoktur.
      webviewTag: true,
    },
  });

  // Pencere ikonu: Windows .ico, Linux ve macOS .png (Electron Linux'ta .ico
  // okumaz; macOS'ta ikon paket içindeki .icns'ten gelir, bu yalnız yedek).
  // Paketli sürümde extraResources/icon.*, geliştirmede depo kökü build/.
  const mainContents = win.webContents;
  ipcGuard.trustMain(mainContents);

  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, iconFile)
    : path.join(__dirname, '..', '..', 'build', iconFile);
  if (fs.existsSync(iconPath)) {
    try { win.setIcon(iconPath); } catch { /* sessiz */ }
  }

  /* İlk açılış beyaz parlaması: transparent/alfa penceresi Windows'ta ilk
     DWM karesi boyanana kadar BEYAZ görünür (kullanıcı 8 Kasım: açılışta
     panel bembeyaz parlıyor). Pencere opaklık 0 ile gösterilir; renderer
     ilk kareyi çizince reveal sinyali yollar, opaklık rampayla 1'e çıkar.
     revealDone/revealTimer modül seviyesinde (ipc handler'la paylaşımlı). */
  if (!TEST_ENV) {
    try { win.setOpacity(0); } catch { /* setOpacity yoksa sessiz */ }
  }

  win.once('ready-to-show', () => {
    mainReady = true;
    applyAlwaysOnTop();
    if (splashDone && win && !win.isDestroyed()) win.show();
    /* Emin kancası: renderer "ilk frame çizildi" sinyali ne olursa olsun
       en geç buradaki süre sonunda pencere görünür. */
    if (!TEST_ENV) setTimeout(() => {
      try { if (win && !win.isDestroyed()) { revealDone = true; win.setOpacity(1); } } catch { }
    }, 1500);
  });
  win.on('close', (event) => {
    saveWindowState();
    // Renderer'a "kaydet ve kapan" de; onay gelince aşağıdaki IPC handler
    // pencereyi gerçekten kapatır. Onay gelmezse zaman aşımı devreye girer.
    if (!closeConfirmed) {
      event.preventDefault();
      requestRendererFlush();
    }
  });
  win.on('enter-full-screen', () => { winFullscreen = true; });
  win.on('leave-full-screen', () => { winFullscreen = false; });
  win.on('closed', () => {
    ipcGuard.untrustMain(mainContents);
    win = null;
    winFullscreen = false;
    // Ana pencere kapanınca ayrı panel pencereleri de kapanır.
    if (panelWindowManager) panelWindowManager.destroyAll();
    stopResponsivenessWatchdog();
    if (raiseTimer) { clearTimeout(raiseTimer); raiseTimer = null; }
    if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null; }
  });
  // Üstte modu kalıcı HWND_TOPMOST olarak ayarlanır; native select popup'larını
  // kapatmamak için pencereyi sürekli moveTop() ile zorlamıyoruz.
  win.on('focus', raiseSoon);
  win.on('show', () => { if (alwaysOnTop) applyAlwaysOnTop(); });
  win.on('restore', raiseSoon);
  win.on('move', raiseSoon);
  win.on('resize', raiseSoon);

  win.loadURL(APP_URL);
  /* Ana renderer yenilenirse/çökerse ayrı panel pencereleri öksüz kalmasın:
     yeni renderer'ın "detached" durumu yoktur; pencereler sessizce kapanır. */
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace && panelWindowManager) panelWindowManager.destroyAll();
  });
  win.webContents.on('render-process-gone', () => {
    if (panelWindowManager) panelWindowManager.destroyAll();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  /* Donmuş arayüzde de çalışan acil kurtarma kısayolu: Ctrl+Alt+Shift+R.
     Girdi olayı ana süreçte yakalanır; renderer'ın JavaScript'i yanıt
     vermese bile yerel "son kayda dön" kutusu açılabilir. */
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!(input.control && input.alt && input.shift)) return;
    if (String(input.key || '').toLowerCase() !== 'r') return;
    event.preventDefault();
    offerRecovery('shortcut');
  });

  /* Yanıt vermeyen renderer'ı yakala (aşırı yüklenen tahta). */
  startResponsivenessWatchdog(win.webContents);

  /* Ana pencere yalnızca kendi yerel sunucumuzda kalmalı. Renderer'a enjekte
     edilen bir bağlantı ya da hatalı bir yönlendirme uygulamayı harici bir
     siteye taşıyamaz. (Dış bağlantılar open-external IPC'siyle, tarayıcıda
     açılır.) */
  const isAppUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && url.hostname === HOST && Number(url.port) === PORT;
    } catch { return false; }
  };
  const guardMain = label => (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    console.warn(`Ana pencere: ${label} engellendi → ${url}`);
  };
  win.webContents.on('will-navigate', guardMain('gezinme'));
  win.webContents.on('will-redirect', guardMain('yönlendirme'));

  /* Uygulama içindeki <webview> yalnızca tanımlı panel bölümleri için var.
     Renderer tarafında bir hata/ele geçirme olsa bile konuk sayfa Node erişimi
     kazanamasın diye özellikler burada zorunlu tutuluyor. */
  installGuestWebviewPolicy(win.webContents);
}

/* ---------------- IPC ---------------- */
let alwaysOnTop = false;
let raiseTimer = null;
let restoreTopOnFocus = false;

function createSplashWindow() {
  const waTest = testScreenWorkArea();
  splashWin = new BrowserWindow({
    width: 480, height: 540, show: true, frame: false, resizable: false,
    movable: false, center: !waTest,
    /* Opak koyu arka plan: transparent pencerede Windows DWM ilk kareyi
       geç boyar (kullanıcı: "pencere çok geç açılıyor"). #060608 splash
       sayfasının arka planıyla aynı olduğundan fark görünmez. */
    backgroundColor: '#060608',
    ...(waTest ? {
      x: waTest.x + Math.round((waTest.width - 480) / 2),
      y: waTest.y + Math.round((waTest.height - 540) / 2),
    } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  splashWin.setAlwaysOnTop(true, 'screen-saver');
  splashWin.loadFile(path.join(RENDERER_DIR, 'splash.html'));
  // Splash hiçbir yere gitmez; olası bir yönlendirme/göz açma isteği reddedilir.
  splashWin.webContents.on('will-navigate', event => event.preventDefault());
  splashWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  /* Sabit 1800ms beklemek yerine: ana pencere ilk karesini çizdikten (min
     1200ms splash görünürlüğü) sonra splash kapanır; motor açılış yine
     2600ms'te zorla kapanır (uzun uyumlu yedek). */
  const splashStart = performance.now();
  const SPLASH_HOLD_MS = 1200, SPLASH_MAX_MS = 2600;
  const closeSplash = () => {
    if (!splashDone) {
      splashDone = true;
      if (splashWin && !splashWin.isDestroyed()) { splashWin.close(); splashWin = null; }
      if (mainReady && win && !win.isDestroyed()) win.show();
    }
  };
  const earlyCloseTimer = setInterval(() => {
    if (mainReady && performance.now() - splashStart >= SPLASH_HOLD_MS) {
      clearInterval(earlyCloseTimer);
      closeSplash();
    }
  }, 120);
  splashWin.on('closed', () => clearInterval(earlyCloseTimer));
  setTimeout(closeSplash, SPLASH_MAX_MS);
}

/* Windows'ta görev çubuğu da "topmost" olduğu için pencere ara ara onun altına
   düşebiliyor. Üstte modunda pencereyi sık sık HWND_TOPMOST olarak en öne
   taşıyoruz; böylece görev çubuğu dahil her şeyin önünde kalır. */
function raiseTopNow() {
  if (!win || win.isDestroyed() || !alwaysOnTop) return;
  if (!win.isVisible() || win.isMinimized()) return;
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  } catch { /* sessiz */ }
}

function raiseSoon() {
  if (!alwaysOnTop || raiseTimer) return;
  raiseTimer = setTimeout(() => { raiseTimer = null; raiseTopNow(); }, 40);
}

function applyAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? 'screen-saver' : 'normal');
  if (alwaysOnTop) raiseTopNow();
}

/* Renderer'a kapanış isteği gönderir. 5 sn içinde "aldım" onayı gelmezse
   (renderer donmuş olabilir) pencereyi zorla kapatır; uygulama asılı kalmasın.
   Onay geldiyse renderer kullanıcıya kaydetme sorusunu gösteriyor demektir:
   o durumda zorla kapatma yapılmaz, cevap beklenir. */
function requestRendererFlush() {
  if (!win || win.isDestroyed()) return;
  closeAck = false;
  try {
    win.webContents.send('app-close-requested');
  } catch { /* webContents henüz hazır değil */ }
  if (closeFallbackTimer) clearTimeout(closeFallbackTimer);
  closeFallbackTimer = setTimeout(() => {
    closeFallbackTimer = null;
    if (closeAck) return;
    closeConfirmed = true;
    if (win && !win.isDestroyed()) win.close();
  }, CLOSE_FALLBACK_MS);
}

/* Renderer isteği aldı ve kullanıcıya soruyor: zaman aşımını durdur. */
ipcGuard.on(ipcMain, 'window-close-ack', () => {
  closeAck = true;
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null; }
});

/* İlk frame boyandıktan sonra renderer sinyali: ana penceriyi görünür yap.
   Yalnızca ana pencerenin kendi sender'ı kabul edilir (webview'lerden
   gelen ping yok sayılır). */
ipcGuard.on(ipcMain, 'reveal-main-window', (event) => {
  if (TEST_ENV) return;
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  if (revealDone) return;
  revealDone = true;
  const N = 8, STEP = 12;
  let i = 0;
  const tick = () => {
    try { if (win && !win.isDestroyed()) { i += 1; win.setOpacity(Math.min(1, i / N)); } } catch { }
    if (i < N) { revealTimer = setTimeout(tick, STEP); }
  };
  try { win.setOpacity(0.4); setTimeout(tick, STEP); } catch { }
});

/* Kullanıcı kapanıştan vazgeçti (kaydetme iptal edildi / hata oldu):
   pencere açık kalır, sonraki kapatma denemesi normal çalışır. */
ipcGuard.handle(ipcMain, 'window-cancel-close', () => {
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null; }
  closeAck = false;
  closeConfirmed = false;
  return true;
});

/* Renderer'daki senkron confirm() kutusu renderer'ı kilitliyor ve Electron
   confirm'ü beklerken bir çekirdeği boş döngüde çeviriyordu (çift tık E2E
   bulgusu: diyalog açıkken CPU %100). Genel onay sorusu: pencereye bağlı
   yerel kutu, renderer blok DEĞİL (await IPC). Dönüş: 0 = Onay, 1 = İptal.
   Bilinmeyen dizeler aynen geçer (canvas-editor.toast kuralı). */
ipcGuard.handle(ipcMain, 'confirm-dialog', async (_e, message, detail, params) => {
  if (!win || win.isDestroyed()) return 1;
  try {
    const box = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'TailRef Studio',
      message: dialogL10n.t(String(message || 'Continue?'), params || undefined),
      detail: detail ? dialogL10n.t(String(detail), params || undefined) : undefined,
      buttons: [
        dialogL10n.t('Continue'),
        dialogL10n.t('Cancel'),
      ],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    return box.response;
  } catch {
    return 1;
  }
});

/* Kapanışta "kaydet?" sorusu. Renderer içindeki senkron confirm() kutusu
   renderer'ı kilitlediği için (yanıt vermiyor sanılıp kurtarma kutusu
   açılıyordu) soruyu ana süreçte, pencereye bağlı yerel kutu olarak soruyoruz.
   Dönüş: 0 = kaydet ve çık, 1 = kaydetmeden çık, 2 = vazgeç. */
ipcGuard.handle(ipcMain, 'window-close-choice', async () => {  if (!win || win.isDestroyed()) return 1;
  try {
    const box = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'TailRef Studio',
      message: dialogL10n.t('Unsaved changes will be lost.'),
      detail: dialogL10n.t('Save your work as a .tail file?'),
      buttons: [
        dialogL10n.t('Save and quit'),
        dialogL10n.t('Quit without saving'),
        dialogL10n.t('Cancel'),
      ],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return box.response;
  } catch {
    return 1;
  }
});

ipcGuard.handle(ipcMain, 'window-confirm-close', () => {
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null; }
  closeConfirmed = true;
  if (win && !win.isDestroyed()) win.close();
  return true;
});

/* ---------------- otomatik güncelleme el sıkışması ----------------
   Güncelleme kurulmadan önce renderer'a "kaydet" fırsatı verilir. Ana
   süreç, renderer'ın update-install-ready / update-install-postpone
   cevabını bekler. Cevap gelmezse (renderer dondu) kurulum iptal edilir;
   kullanıcı verisi asla zorla kapatılarak riske atılmaz. */
let installHandshakeResolve = null;
let installHandshakeTimer = null;

function finishInstallHandshake(ready) {
  const resolve = installHandshakeResolve;
  installHandshakeResolve = null;
  if (installHandshakeTimer) {
    clearTimeout(installHandshakeTimer);
    installHandshakeTimer = null;
  }
  if (resolve) resolve(!!ready);
}

function requestInstallHandshake() {
  return new Promise(resolve => {
    if (!win || win.isDestroyed()) { resolve(false); return; }
    if (installHandshakeResolve) finishInstallHandshake(false);
    installHandshakeResolve = resolve;
    /* Kaydetme diyaloğu açık kalabilir; 10 dakika sonra vazgeç say. */
    installHandshakeTimer = setTimeout(() => finishInstallHandshake(false), 10 * 60 * 1000);
    try {
      win.webContents.send('update-install-requested');
    } catch {
      finishInstallHandshake(false);
    }
  });
}

ipcGuard.handle(ipcMain, 'update-install-ready', (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  finishInstallHandshake(true);
  return true;
});

ipcGuard.handle(ipcMain, 'update-install-postpone', (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  finishInstallHandshake(false);
  return true;
});

/* Güncelleme kurulumundan önce "kaydet?" sorusu. Kapanıştaki ile aynı
   güvenlik sözleşmesi, farklı düğme metinleri: 0 = kaydet ve yeniden
   başlat, 1 = kaydetmeden yeniden başlat, 2 = vazgeç. */
ipcGuard.handle(ipcMain, 'window-install-choice', async (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return 2;
  try {
    const box = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'TailRef Studio',
      message: dialogL10n.t('Unsaved changes will be lost.'),
      detail: dialogL10n.t('Save your work before TailRef restarts to install the update?'),
      buttons: [
        dialogL10n.t('Save and restart'),
        dialogL10n.t('Restart without saving'),
        dialogL10n.t('Cancel'),
      ],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return box.response;
  } catch {
    return 2;
  }
});

let updateManager = null;

ipcGuard.handle(ipcMain, 'toggle-on-top', () => {
  if (!win) return false;
  alwaysOnTop = !alwaysOnTop;
  applyAlwaysOnTop();
  saveWindowState();
  return alwaysOnTop;
});

ipcGuard.handle(ipcMain, 'is-on-top', () => (win ? alwaysOnTop : false));

ipcGuard.handle(ipcMain, 'window-minimize', () => { if (win) win.minimize(); });
ipcGuard.handle(ipcMain, 'window-close',    () => { if (win) win.close(); });
ipcGuard.handle(ipcMain, 'window-toggle-max', () => {
  if (!win) return false;
  /* maximize()/unmaximize() OS'de asenktir; hemen ardından isMaximized()
     okumak eski değeri döndürebilir. Hedef durumu önce hesapla ve onu döndür;
     gerçek durum maximize/unmaximize olaylarıyla senkronlanır. */
  const target = !win.isMaximized();
  if (target) win.maximize();
  else win.unmaximize();
  return target;
});
ipcGuard.handle(ipcMain, 'window-is-maximized', () => !!(win && win.isMaximized()));
ipcGuard.handle(ipcMain, 'window-toggle-fullscreen', () => {
  if (!win) return false;
  /* Windows'ta saydam/çerçevesiz pencerede isFullScreen() her zaman false
     dönebiliyor; gerçek durumu enter/leave-full-screen olaylarından izle. */
  const next = !winFullscreen;
  win.setFullScreen(next);
  winFullscreen = next;
  return next;
});
/* ---------------- ayrı panel pencereleri ----------------
   Panel ana pencereden dışarı sürüklendiğinde her zaman üstte duran,
   bağımsız bir pencere açılır. Pencere yaşam döngüsü, dock sezgisi,
   tam ekran ve IPC kanalları tek bir yöneticide toplanmıştır;
   renderer tarafı (17b-panel-dock.js) yalnız bu sözleşmeyi kullanır. */
panelWindowManager = createPanelWindowManager({
  BrowserWindow, ipcMain, screen, path,
  preloadDir: PRELOAD_DIR,
  appUrl: APP_URL,
  getMainWindow: () => win,
  installGuestPolicy: installGuestWebviewPolicy,
});
panelWindowManager.registerIpc();

ipcGuard.handle(ipcMain, 'window-is-fullscreen', () => !!(win && (winFullscreen || win.isFullScreen())));
ipcGuard.handle(ipcMain, 'window-exit-fullscreen', () => {
  if (!win) return false;
  if (win.isKiosk()) win.setKiosk(false);
  if (winFullscreen || win.isFullScreen()) {
    win.setFullScreen(false);
    winFullscreen = false;
  }
  return false;
});
ipcGuard.handle(ipcMain, 'open-external', (_e, url) => {
  /* Yalnız bilinen dış hedefler (YouTube + destek sayfası). Doğrulama
     src/main/external-links.js içinde; testi tests/external-links-test.js. */
  const target = normalizeExternalUrl(url);
  if (!target) return false;
  try {
    shell.openExternal(target);
    return true;
  } catch { return false; }
});

/* --- 3D capture: pano ve diske kaydetme (P5) ---
   Renderer PNG baytlarını gönderir; burada yeniden kodlanmaz. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_BYTES = 96 * 1024 * 1024;

function pngBuffer(bytes) {
  try {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (buffer.length < 8 || buffer.length > MAX_IMAGE_BYTES) return null;
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    return buffer;
  } catch {
    return null;
  }
}

ipcGuard.handle(ipcMain, 'clipboard-image', (_e, bytes) => {
  const buffer = pngBuffer(bytes);
  if (!buffer) return false;
  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  } catch {
    return false;
  }
});

ipcGuard.handle(ipcMain, 'save-image', async (_e, bytes, suggestedName) => {
  const buffer = pngBuffer(bytes);
  if (!buffer) return { ok: false, error: dialogL10n.t('Invalid PNG.') };
  const rawName = String(suggestedName || 'tailref-pose.png').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const fileName = /\.png$/i.test(rawName) ? rawName : `${rawName}.png`;
  try {
    const result = await dialog.showSaveDialog(win, {
      title: dialogL10n.t('Save image'),
      defaultPath: path.join(app.getPath('pictures'), fileName),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    /* Kullanıcı dosyası: yarım kalan yazma (güç kesintisi / disk dolu)
       eski dosyayı bozmasın diye atomik yaz. */
    writeFileAtomic(result.filePath, buffer);
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/* Ayarlar > Genel: tercih yedeği (Faz 6) — tercih JSON'u diske yazar.
   Yalnızca metin; tahta verisi (IndexedDB) bu kanaldan geçmez. */
ipcGuard.handle(ipcMain, 'save-preferences-json', async (_e, text, suggestedName) => {
  const rawName = String(suggestedName || 'tailref-preferences.json')
    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const fileName = /\.json$/i.test(rawName) ? rawName : `${rawName}.json`;
  try {
    const result = await dialog.showSaveDialog(win, {
      title: dialogL10n.t('Save preferences'),
      defaultPath: path.join(app.getPath('documents'), fileName),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    writeFileAtomic(result.filePath, String(text || ''));
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/* Footer "Kaydet" (15 Kasım 2026): tercih JSON'unu SESSİZ yazar —
   diyalog yok. Portable kullanım güvenliği: userData her zaman denenir;
   exe yanına da yazılır (oradaki dosya profil kaybında kurtarıcıdır;
   Program Files gibi yazmaya kapalı yerlerde sessizce atlanır). */
ipcGuard.handle(ipcMain, 'save-preferences-auto', async (_e, text) => {
  const targets = [path.join(app.getPath('userData'), 'tailref-preferences.json')];
  try { targets.push(path.join(path.dirname(app.getPath('exe')), 'tailref-preferences.json')); } catch { /* exe yolu okunamadı */ }
  let lastErr = '';
  let wrote = 0;
  for (const file of targets) {
    try {
      writeFileAtomic(file, String(text || ''));
      wrote++;
    } catch (error) { lastErr = error.message; }
  }
  if (wrote) return { ok: true, file: targets[0], copies: wrote };
  return { ok: false, error: lastErr || 'write failed' };
});

/* Boot tercih geri yüklemesi (footer "Kaydet" ikilisi): renderer açılışta
   profilini kaybettiğini bildirirse (localStorage'da tailref- anahtarı
   kalmamışsa) kayıtlı dosyayı okur. */
ipcGuard.handle(ipcMain, 'load-preferences-auto', async () => {
  const candidates = [];
  try { candidates.push(path.join(path.dirname(app.getPath('exe')), 'tailref-preferences.json')); } catch { /* sessiz */ }
  candidates.push(path.join(app.getPath('userData'), 'tailref-preferences.json'));
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return { ok: true, file, text: fs.readFileSync(file, 'utf8') };
    } catch { /* sıradakini dene */ }
  }
  return { ok: false };
});

/* C++ çizim çekirdeği kanalları (tip + durum). */
inkEngineHost.register(ipcMain);

/* Renderer'ın seçili dilini ana sürece bildirir: diyaloglar (kaydet/aç,
   kapatma uyarısı, kurtarma kutuları) bu dille gösterilir. Renderer her
   açılışta ve dil değişiminde gönderir; renderer donmuşsa en son bilinen
   dil kullanılır. */
ipcGuard.on(ipcMain, 'app-language', (_e, code) => {
  const gec = typeof code === 'string' ? code.slice(0, 12) : '';
  if (gec) dialogL10n.setLanguage(gec);
});
/* Test/otomasyon: ana sürecin bilinen dilini oku. */
ipcGuard.handle(ipcMain, 'app-language-get', () => dialogL10n.getLanguage());

/* Seçili fotoğrafı orijinal baytlarıyla dışa aktarır: yeniden kodlama,
   yeniden sıkıştırma veya kalite kaybı yok. Uzantı kaynağın MIME türünden
   (yoksa dosya adından) belirlenir. */
const EXPORT_IMAGE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp',
  'image/avif': 'avif', 'image/tiff': 'tif',
};

/* Dışa aktarma klasörü allowlist'i: yalnızca kullanıcının klasör seçme
   penceresinde (veya kaydet penceresinde onayladığı) klasörlere sessiz
   yazılır. Liste ana süreçte tutulur ve userData/export-dirs.json içinde
   kalıcıdır; renderer yalnızca yol metni gönderebilir, listeyi değiştiremez.
   Böylece ele geçirilmiş bir renderer keyfi bir klasöre dosya bırakamaz. */
const EXPORT_DIRS_FILE = 'export-dirs.json';
const MAX_EXPORT_DIRS = 50;
let exportDirsCache = null;

function exportDirsFile() {
  return path.join(app.getPath('userData'), EXPORT_DIRS_FILE);
}

function loadExportDirs() {
  if (exportDirsCache) return exportDirsCache;
  exportDirsCache = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(exportDirsFile(), 'utf8'));
    if (Array.isArray(parsed)) {
      exportDirsCache = parsed
        .map(normalizeExportDir)
        .filter(Boolean)
        .slice(-MAX_EXPORT_DIRS);
    }
  } catch { /* dosya yok/bozuk: boş listeyle başla */ }
  return exportDirsCache;
}

function saveExportDirs() {
  try {
    writeFileAtomic(exportDirsFile(), JSON.stringify(loadExportDirs().slice(-MAX_EXPORT_DIRS)));
  } catch { /* yazılamazsa oturum belleğiyle devam */ }
}

function rememberExportDir(dir) {
  const normalized = normalizeExportDir(dir);
  if (!normalized) return null;
  const list = loadExportDirs();
  if (!isAllowedExportDir(normalized, list)) {
    list.push(normalized);
    if (list.length > MAX_EXPORT_DIRS) list.splice(0, list.length - MAX_EXPORT_DIRS);
    saveExportDirs();
  }
  return normalized;
}

/* Kayıt klasörü seçme penceresi: Dışa Aktar diyaloğundan klasör seçilir. */
ipcGuard.handle(ipcMain, 'choose-dir', async () => {
  try {
    const r = await dialog.showOpenDialog(win, {
      title: dialogL10n.t('Choose save folder'),
      buttonLabel: dialogL10n.t('Select this folder'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    const chosen = rememberExportDir(r.filePaths[0]) || r.filePaths[0];
    return { ok: true, dir: chosen };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcGuard.handle(ipcMain, 'export-image', async (_e, bytes, suggestedName, mime, dir) => {
  let buffer;
  try { buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []); }
  catch { return { ok: false, error: dialogL10n.t('Invalid image.') }; }
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: dialogL10n.t('Invalid image size.') };
  }
  const nameExt = (/\.([a-z0-9]+)$/i.exec(String(suggestedName || '')) || [])[1] || '';
  const normalizedNameExt = nameExt.toLowerCase().replace('jpeg', 'jpg').replace('tiff', 'tif');
  const ext = EXPORT_IMAGE_EXT[String(mime || '').toLowerCase()] || normalizedNameExt || 'png';
  const base = String(suggestedName || dialogL10n.t('photo'))
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 120) || dialogL10n.t('photo');
  const fileName = `${base}.${ext}`;
  const filterName = ext === 'jpg' ? 'JPEG' : ext.toUpperCase();
  /* Klasör verilmişse ve kullanıcı bu klasörü daha önce açıkça seçtiyse
     pencere açmadan doğrudan yaz. Allowlist dışı bir yol geldiyse sessiz
     yazma yapılmaz; aşağıdaki kaydet penceresi kullanıcıya onaylatır. */
  const requestedDir = typeof dir === 'string' ? normalizeExportDir(dir) : null;
  if (requestedDir && isAllowedExportDir(requestedDir, loadExportDirs())) {
    try {
      if (!fs.existsSync(requestedDir) || !fs.statSync(requestedDir).isDirectory()) {
        return { ok: false, error: dialogL10n.t('Folder not found.') };
      }
      /* Adı "var mı?" diye kontrol edip sonra yazmak yarışa açıktı: iki
         eşzamanlı dışa aktarma aynı dosyayı seçip birbirinin üzerine
         yazabiliyordu (P1). reserveUniqueFile adı O_EXCL ile atomik
         sahiplenir; ikinci aktarım " (1)" varyantına kayar. */
      const hedef = reserveUniqueFile(requestedDir, base, ext);
      try {
        writeFileAtomic(hedef, buffer);
      } catch (error) {
        /* Sahiplenilen boş yer tutucu kalmasın. */
        try { fs.rmSync(hedef, { force: true }); } catch { /* sessiz */ }
        throw error;
      }
      return { ok: true, file: hedef };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  /* İstenen klasör geçerliyse kaydet penceresi orada açılsın (eski
     yapılandırmadan gelen saveDir için tek seferlik onay). */
  let defaultDir = app.getPath('pictures');
  if (requestedDir) {
    try {
      if (fs.statSync(requestedDir).isDirectory()) defaultDir = requestedDir;
    } catch { /* klasör yok: resimler klasörü */ }
  }
  try {
    const result = await dialog.showSaveDialog(win, {
      title: dialogL10n.t('Export photo'),
      defaultPath: path.join(defaultDir, fileName),
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    writeFileAtomic(result.filePath, buffer);
    /* Kullanıcı bu klasörü kaydet penceresinde onayladı: sonraki sessiz
       dışa aktarmalar için hatırla. */
    rememberExportDir(path.dirname(result.filePath));
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
/* Fırça kütüphanesinden .abr dışa aktarma. Baytlar doğrudan yazılır;
   biçim tarayıcıda üretildiği için burada yeniden kodlama yapılmaz. */
ipcGuard.handle(ipcMain, 'export-abr', async (_e, bytes, suggestedName) => {
  let buffer;
  try { buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []); }
  catch { return { ok: false, error: dialogL10n.t('Invalid brush.') }; }
  if (!buffer.length || buffer.length > 16 * 1024 * 1024) {
    return { ok: false, error: dialogL10n.t('Invalid brush size.') };
  }
  const base = String(suggestedName || dialogL10n.t('brush'))
    .replace(/\.abr$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 80) || dialogL10n.t('brush');
  try {
    const result = await dialog.showSaveDialog(win, {
      title: dialogL10n.t('Export brush as .abr'),
      defaultPath: path.join(app.getPath('pictures'), `${base}.abr`),
      filters: [{ name: dialogL10n.t('.abr brush'), extensions: ['abr'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    /* Kullanıcı dosyası: yarım kalan yazma (güç kesintisi / disk dolu)
       eski dosyayı bozmasın diye atomik yaz. */
    writeFileAtomic(result.filePath, buffer);
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcGuard.handle(ipcMain, 'get-window-pos', () => (win ? win.getPosition() : [0, 0]));
ipcGuard.handle(ipcMain, 'set-window-pos', (_e, x, y) => {
  if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return;
  win.setPosition(Math.round(x), Math.round(y));
});

/* ---------------- .tail dosyası: kaydet / aç ----------------
   Manuel kayıt modunun dosya biçimi. İçerik gzip'lenmiş JSON'dur
   (görseller base64 dataUrl olarak gömülü). Sıkıştırma sayesinde
   tekrarlı çizim verisi (state.ink) küçülür; ek bağımlılık gerekmez.
   Kapsayıcı biçimi (imza, sürüm, sınırlar) src/main/tail-format.js'te;
   orası Electron olmadan test edilir (tests/tail-format-test.js). */
const TAIL_EXT = '.tail';
const {
  MAX_FILE_BYTES: MAX_TAIL_FILE_BYTES,
  encodeBoard,
  decodeBoard,
} = require('./tail-format');

ipcGuard.handle(ipcMain, 'save-tail', async (_e, payload, suggestedName) => {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    let out;
    try {
      out = await encodeBoard(text);
    } catch (error) {
      if (error && error.code === 'too-large') {
        return { ok: false, error: 'Board is too large to save as .tail' };
      }
      throw error;
    }

    const rawName = String(suggestedName || dialogL10n.t('board')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const fileName = new RegExp(TAIL_EXT.replace('.', '\\.') + '$', 'i').test(rawName) ? rawName : `${rawName}${TAIL_EXT}`;
    const result = await dialog.showSaveDialog(win, {
      title: dialogL10n.t('Save board as .tail'),
      defaultPath: path.join(app.getPath('pictures'), fileName),
      filters: [{ name: dialogL10n.t('TailRef board'), extensions: ['tail'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    writeFileAtomic(result.filePath, out);
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/** Diskten .tail dosyası okur. open-tail diyaloğu ile çift tık /
    sürükle-bırak yolları aynı kapıyı kullanır. Kapsayıcı çözümü
    tail-format.js'te; burada yalnız dosya erişimi ve yerelleştirilmiş
    hata metinleri var. */
async function readBoardFile(filePath) {
  const invalid = { ok: false, error: dialogL10n.t('This is not a valid .tail file.') };
  let stat = null;
  try { stat = await fs.promises.stat(filePath); } catch { return invalid; }
  if (!stat.isFile() || stat.size < 6 || stat.size > MAX_TAIL_FILE_BYTES) return invalid;
  let buf = null;
  /* Büyük .tail (onlarca MB) senkron okununca ana süreç ve tüm pencereler
     donuyordu (P1). I/O artık async; çözme (inflate) zaten async. */
  try { buf = await fs.promises.readFile(filePath); } catch { return invalid; }
  const decoded = await decodeBoard(buf);
  if (!decoded.ok) {
    if (decoded.reason === 'version') {
      return { ok: false, error: dialogL10n.t('Unsupported .tail version ({n}).', { n: decoded.version }) };
    }
    return invalid;
  }
  return { ok: true, file: filePath, payload: decoded.payload };
}

ipcGuard.handle(ipcMain, 'open-tail', async () => {
  try {
    const result = await dialog.showOpenDialog(win, {
      title: dialogL10n.t('Open .tail board'),
      defaultPath: app.getPath('pictures'),
      filters: [{ name: dialogL10n.t('TailRef board'), extensions: ['tail'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    return await readBoardFile(result.filePaths[0]);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/* Çift tık / pencereye sürükleme: renderer .tail yolunu gönderir, main
   aynı okuma kapısından döndürür. */
ipcGuard.handle(ipcMain, 'open-tail-path', async (_e, filePath) => {
  try {
    /* Renderer'dan gelen yol güvenilmez: yalnızca yerel, mutlak ve .tail
       uzantılı dosyalar açılır. UNC/aygıt yolları reddedilir. */
    if (!isTailFilePath(filePath)) {
      return { ok: false, error: dialogL10n.t('This is not a valid .tail file.') };
    }
    return await readBoardFile(String(filePath).trim());
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/* ---------------- .tail dosyasına çift tık ----------------
   Portable kurulumda uzantı kaydı yapılmaz; kullanıcı dosyayı bir kez
   "Birlikte aç → Her zaman" ile exe'ye bağlar. Windows exe'yi
   `TailRef Studio.exe "C:\...\pano.tail"` ile başlatır; o yol burada
   yakalanır. Linux masaüstü girdisi `%U` kullanır: dosya yöneticisi
   `file:///home/.../pano.tail` biçiminde bir URI de gönderebilir.
   Açılışta renderer tüketir (consume), çalışırken ikinci başlatma push
   ile canlı pencereye devredilir. */
function extractBoardPath(argv) {
  for (const arg of argv || []) {
    if (typeof arg !== 'string') continue;
    let candidate = arg.trim();
    if (!candidate) continue;
    if (/^file:\/\//i.test(candidate)) {
      try { candidate = fileURLToPath(candidate); } catch { continue; }
    }
    if (/\.tail$/i.test(candidate)) return candidate;
  }
  return null;
}
let pendingBoardFile = extractBoardPath(process.argv);
ipcGuard.handle(ipcMain, 'consume-board-launch-file', () => {
  const p = pendingBoardFile;
  pendingBoardFile = null;
  return p;
});
/* macOS: Finder'da "Birlikte Aç" bir argüman göndermez; sistem open-file
   olayı yayar. Olay app hazır olmadan da gelebilir, bu yüzden yol önce
   bekleyen dosyaya yazılır (renderer açılışta consume ile alır) ve açık
   pencere varsa ayrıca canlı push edilir. macOS'ta .tail çift tıklamasının
   Windows/Linux ile aynı davranması bu olaya bağlıdır. */
if (process.platform === 'darwin') {
  app.on('open-file', (event, filePath) => {
    const boardFile = extractBoardPath([filePath]);
    if (!boardFile) return;
    event.preventDefault();
    pendingBoardFile = boardFile;
    for (const target of BrowserWindow.getAllWindows()) {
      try { target.webContents.send('tailref:open-board-file', boardFile); } catch { /* sessiz */ }
    }
  });
}
/* Yedek saklama sınırı (aday 4): renderer localStorage 'tailref-backup-limit'
   okuyup 2. argümanla gönderir; yoksa/bozuksa eski sabit 20 geçerlidir
   (parite). 1–200 aralığına sıkıştırılır; good/ ve emergency-* rotasyonu
   bu sınırdan bağımsızdır. */
function autoBackupKeepCount(limit) {
  let n = Number(limit);
  if (!Number.isFinite(n)) return 20;
  n = Math.floor(n);
  if (n < 1) n = 1;
  if (n > 200) n = 200;
  return n;
}
ipcGuard.handle(ipcMain, 'auto-backup', async (_e, payload, limit, counts) => {
  try {
    const dir = path.join(app.getPath('userData'), 'Backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `tailref-${stamp}.json`);
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    writeFileAtomic(file, text);
    const files = fs.readdirSync(dir)
      .filter(n => n.endsWith('.json') && !/^emergency-/i.test(n))
      .sort()
      .reverse();
    for (const old of files.slice(autoBackupKeepCount(limit))) {
      try { fs.unlinkSync(path.join(dir, old)); } catch { /* sessiz */ }
    }

    /* Sağlıklı yedeklerin kopyasını `good/` altında tut: bozuk bir tahta
       tüm rotasyonu doldursa bile her zaman geri dönülecek bir nokta kalsın. */
    let healthy = false;
    try {
      /* Sağlık bilgisi renderer'dan gelir: az önce yazdığımız dosyayı
         yeniden okuyup JSON.parse etmek, büyük panolarda ana süreci
         saniyelerce bloklar ve yedeğin kendisini yavaşlatırdı. */
      const stat = fs.statSync(file);
      const known = counts && Number.isFinite(counts.items) && Number.isFinite(counts.images);
      const info = known
        ? {
            ok: stat.size <= MAX_HEALTHY_BYTES &&
              counts.items <= MAX_HEALTHY_ITEMS &&
              counts.images <= MAX_HEALTHY_IMAGES,
          }
        : await inspectBackup({ name: path.basename(file), size: stat.size, mtime: stat.mtimeMs, tier: 'auto' });
      healthy = info.ok;
      if (healthy) {
        const goodDir = goodBackupsDir();
        fs.mkdirSync(goodDir, { recursive: true });
        fs.copyFileSync(file, path.join(goodDir, path.basename(file)));
        const keep = fs.readdirSync(goodDir)
          .filter(n => n.endsWith('.json'))
          .sort()
          .reverse()
          .slice(GOOD_BACKUPS_KEPT);
        for (const old of keep) {
          try { fs.unlinkSync(path.join(goodDir, old)); } catch { /* sessiz */ }
        }
      }
    } catch (error) {
      console.warn('iyi yedek kopyası yazılamadı', error);
    }
    return { ok: true, file, healthy };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcGuard.handle(ipcMain, 'open-backups', async () => {
  const dir = path.join(app.getPath('userData'), 'Backups');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, path: dir, error: `Could not create the folder: ${e.message}` };
  }

  // "Her zaman üstte" modu Explorer penceresini uygulamanın arkasında bırakıyor.
  // Klasör açılırken üstte modu geçici olarak kapat, pencere tekrar odaklanınca geri aç.
  if (win && !win.isDestroyed() && alwaysOnTop) {
    restoreTopOnFocus = true;
    try { win.setAlwaysOnTop(false, 'normal'); } catch { /* sessiz */ }
    const restore = () => {
      if (!restoreTopOnFocus) return;
      restoreTopOnFocus = false;
      applyAlwaysOnTop();
    };
    win.once('focus', restore);
    setTimeout(restore, 10000);
  }

  let error = '';
  try {
    error = await shell.openPath(dir);
  } catch (e) {
    error = e.message;
  }

  // shell.openPath başarısız olursa Explorer'ı doğrudan başlatmayı dene.
  if (error) {
    try {
      const { spawn } = require('child_process');
      spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
      error = '';
    } catch (e) {
      error = e.message;
    }
  }

  return { ok: !error, path: dir, error };
});
ipcGuard.handle(ipcMain, 'set-on-top', (_e, on) => {
  if (!win) return false;
  alwaysOnTop = !!on;
  applyAlwaysOnTop();
  saveWindowState();
  return alwaysOnTop;
});

/* =========================================================
   Aşırı yük kurtarma
   ---------------------------------------------------------
   Renderer ağır bir iş yüzünden (örn. yanlışlıkla binlerce görsel)
   donduğunda ana süreç hâlâ yanıt verir. Periyodik yoklamalarla bunu
   fark edip NATIVE bir iletişim kutusu açarız: kullanıcı "Son kayda
   dön" derse bir işaret dosyası yazılır ve uygulama yeniden başlar.
   Yeniden açılışta renderer, pano verisini yüklemeden ÖNCE son temiz
   yedeği IndexedDB'ye geri yazar; böylece donmuş arayüzden hiçbir şey
   beklenmez.
   ========================================================= */

const RECOVERY_MARKER = 'recovery.json';
const RECOVERY_PROBE_MS = 3000;
const RECOVERY_PROBE_TIMEOUT_MS = 2500;
/* Kurulum öncesi: 4 ardışık başarısız yoklama (~12 sn) yanlış pozitif
   veriyordu — 4K FX zinciri/Tam çözünürlüklü önizleme tek karede 1.5 sn'yi
   aşınca "yanıt vermiyor" kutusu açılıyordu. Artık 6 ardışık (~18 sn)
   sürekli donma aranır; ayrıca renderer ağır iş sırasında `renderer-busy`
   bayrağıyla gözcüyü açıkça susturur. */
const RECOVERY_PROBE_LIMIT = 6;
const RECOVERY_SLOW_MS = 2500;

/* Bir yedeğin "sağlıklı" sayılması için üst sınırlar. Aşırı yüklenmiş bir
   tahta (örn. yanlışlıkla 5670 görsel) bu sınırları aşar; böyle bir dosya
   "son kayda dön" için ASLA seçilmez. */
const MAX_HEALTHY_BYTES = 200 * 1024 * 1024;
const MAX_HEALTHY_ITEMS = 1500;
const MAX_HEALTHY_IMAGES = 300;
const GOOD_BACKUPS_KEPT = 3;
const EMERGENCY_BACKUPS_KEPT = 5;
const RECOVERY_HISTORY_MS = 15 * 60 * 1000;

function backupsDir() {
  return path.join(app.getPath('userData'), 'Backups');
}

/** Sağlık kontrolünden geçmiş yedeklerin kopyaları (rotasyondan muaf). */
function goodBackupsDir() {
  return path.join(backupsDir(), 'good');
}

/** "Temiz başlat" öncesi saklanan veriler. */
function archiveDir() {
  return path.join(app.getPath('userData'), 'Archive');
}

function readBackupEntries(dir, tier) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter(name => /\.json$/i.test(name));
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (!stat.isFile()) continue;
      entries.push({ name, size: stat.size, mtime: stat.mtimeMs, tier });
    } catch { /* okunamayan dosyayı atla */ }
  }
  return entries;
}

/** Yedek dosyalarını yeniden eskiye doğru listeler.
    `good/` altındaki sağlıklı kopyalar da listeye girer (aynı adla). */
function listBackupFiles() {
  const good = readBackupEntries(goodBackupsDir(), 'good');
  const goodNames = new Set(good.map(entry => entry.name));
  const normal = readBackupEntries(backupsDir(), 'auto')
    .filter(entry => !goodNames.has(entry.name));
  return [...good, ...normal].sort((a, b) => b.mtime - a.mtime);
}

/** Yedeğin gerçek yolu (good/ önce). */
function backupPath(name) {
  const safe = path.basename(String(name || ''));
  if (!/\.json$/i.test(safe)) return null;
  const good = path.join(goodBackupsDir(), safe);
  if (fs.existsSync(good)) return good;
  return path.join(backupsDir(), safe);
}

/* Yedek içeriği denetimi artık worker'da koşar: 200 MB'a kadar JSON'u ana
   süreçte senkron parse etmek kurtarma kutusu açılırken uygulamayı
   saniyelerce donduruyordu (P1). Ayrıntı: src/main/backup-health.js. */
const { BackupInspector } = require('./backup-health');
const backupInspector = new BackupInspector({
  maxBytes: MAX_HEALTHY_BYTES,
  maxItems: MAX_HEALTHY_ITEMS,
  maxImages: MAX_HEALTHY_IMAGES,
});

/* Aynı dosya tekrar tekrar okunmasın (yoklama/kutu döngüsü). Sınırlı tutulur:
   saatlerce açık oturumda yedek adları birikip bellek şişmesin. */
const HEALTH_CACHE_MAX = 256;
const healthCache = new Map();

/** Yedeğin içeriğine bakar: kaç öğe, kaç görsel, ne kadar büyük?
    Bozuk/aşırı yüklenmiş yedekleri elemek için kullanılır.
    reason kodları: '' (sağlıklı) · too-large · too-many-items ·
    too-many-images · corrupt · timeout · missing (UI metni üretmez;
    kurtarma kutusu yalnız sayıyı gösterir). */
async function inspectBackup(entry) {
  const key = `${entry.name}:${entry.size}:${entry.mtime}`;
  const cached = healthCache.get(key);
  if (cached) return cached;

  const info = {
    name: entry.name, size: entry.size, mtime: entry.mtime,
    tier: entry.tier || 'auto', ok: false, items: 0, images: 0, reason: '',
  };
  const full = backupPath(entry.name);
  if (!full) {
    info.reason = 'missing';
  } else {
    const result = await backupInspector.inspect(full, entry);
    info.ok = result.ok;
    info.items = result.items;
    info.images = result.images;
    info.reason = result.reason;
  }
  if (healthCache.size >= HEALTH_CACHE_MAX) {
    healthCache.delete(healthCache.keys().next().value);
  }
  healthCache.set(key, info);
  return info;
}

/* ---- bu kurtarma oturumunda denenen yedekler ----
   "Son kayda dön" bozuk çıkarsa, tekrar açılan kutuda AYNI dosya değil
   bir sonraki sağlıklı aday önerilir. 15 dakikadan eski kayıtlar unutulur. */

function recoveryHistoryPath() {
  return path.join(app.getPath('userData'), 'recovery-history.json');
}

function readRecoveryHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(recoveryHistoryPath(), 'utf8'));
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    const now = Date.now();
    return parsed.entries.filter(entry =>
      entry && typeof entry.name === 'string' && now - (entry.at || 0) < RECOVERY_HISTORY_MS);
  } catch {
    return [];
  }
}

function rememberRecoveryTry(name) {
  try {
    const entries = readRecoveryHistory().filter(entry => entry.name !== name);
    entries.push({ name, at: Date.now() });
    /* Yarım yazılmış geçmiş JSON'u bir sonraki açılışta sessizce yok sayılır;
       atomik yaz ki kurtarma zinciri kaybolmasın. */
    writeFileAtomic(recoveryHistoryPath(), JSON.stringify({ entries }));
  } catch { /* sessiz */ }
}

function clearRecoveryHistory() {
  try { fs.unlinkSync(recoveryHistoryPath()); } catch { /* zaten yok */ }
}

/** Kurtarma için yedeği seçer: yeni → eski tara, İLK SAĞLIKLI olanı al.
    Bu oturumda zaten denenmiş dosyalar atlanır (zincirleme geri dönüş).
    Denetim async'tir: büyük JSON parse'ı ana süreçte bloklamaz. */
async function pickRecoveryBackup(detectedAt) {
  const entries = listBackupFiles();
  const tried = new Set(readRecoveryHistory().map(entry => entry.name));
  const scanned = [];
  const healthy = [];
  for (const entry of entries) {
    if (tried.has(entry.name)) continue;
    const info = await inspectBackup(entry);
    scanned.push(info);
    if (info.ok) healthy.push(info);
    if (healthy.length >= 3) break; // yeterince aday bulundu
  }
  if (!healthy.length) return { backup: null, scanned, total: entries.length, tried: tried.size };
  const detected = Number.isFinite(detectedAt) ? detectedAt : Date.now();
  /* Donma anına çok yakın (son 60 sn) yedek bozuk durumu taşıyabilir;
     daha eskisini tercih et. Hepsi yeniyse en eskisini al. */
  const safe = healthy.find(info => info.mtime <= detected - 60000);
  const chosen = safe || healthy[healthy.length - 1];
  return { backup: chosen, scanned, total: entries.length, tried: tried.size };
}

function recoveryMarkerPath() {
  return path.join(app.getPath('userData'), RECOVERY_MARKER);
}

function readRecoveryMarker() {
  try {
    const raw = fs.readFileSync(recoveryMarkerPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed) return null;
    /* "Temiz başlat": yedek yok, panolar arşivlenip sıfırlanacak. */
    if (parsed.mode === 'reset') {
      return { mode: 'reset', reason: parsed.reason || 'reset', requestedAt: parsed.requestedAt || null };
    }
    if (typeof parsed.backup !== 'string') return null;
    const name = path.basename(parsed.backup);
    const full = backupPath(name);
    if (!full || !fs.existsSync(full)) return null;
    return {
      mode: 'restore',
      backup: name,
      reason: parsed.reason || 'watchdog',
      requestedAt: parsed.requestedAt || null,
    };
  } catch {
    return null;
  }
}

function writeRecoveryMarker(backupName, reason) {
  try {
    /* İşaret dosyası yarım kalırsa sonraki açılış onu "yok" sayar ve
       kurtarma hiç teklif edilmez; atomik yaz. */
    writeFileAtomic(recoveryMarkerPath(), JSON.stringify({
      mode: 'restore',
      backup: path.basename(backupName),
      reason: reason || 'watchdog',
      requestedAt: new Date().toISOString(),
    }));
    return true;
  } catch (error) {
    console.warn('kurtarma işareti yazılamadı', error);
    return false;
  }
}

function writeResetMarker(reason) {
  try {
    writeFileAtomic(recoveryMarkerPath(), JSON.stringify({
      mode: 'reset',
      reason: reason || 'reset',
      requestedAt: new Date().toISOString(),
    }));
    return true;
  } catch (error) {
    console.warn('sıfırlama işareti yazılamadı', error);
    return false;
  }
}

function clearRecoveryMarker() {
  try { fs.unlinkSync(recoveryMarkerPath()); } catch { /* zaten yok */ }
}

let recoveryDialogOpen = false;
let recoveryCooldownUntil = 0;
let probeInFlight = false;
let probeFailures = 0;
let watchdogTimer = null;
/* Renderer ağır senkron iş yapıyorsa (FX zinciri) gözcü beklemede kalır.
   Bayrak 20 sn sonra kendiliğinden düşer: renderer çökerse kurtarma yine
   devreye girer. */
let rendererBusyUntil = 0;

ipcGuard.on(ipcMain, 'renderer-busy', (_event, active) => {
  rendererBusyUntil = active ? Date.now() + 20000 : 0;
  if (active) probeFailures = 0;
});

/** Uygulamayı yeniden başlatır (taşınabilir sürümde gerçek exe ile). */
function relaunchApp() {
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExe && fs.existsSync(portableExe)) {
    app.relaunch({ execPath: path.resolve(portableExe) });
  } else {
    app.relaunch();
  }
  app.exit(0);
}

async function offerRecovery(reason) {
  if (recoveryDialogOpen) return false;
  recoveryDialogOpen = true;
  try {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    const parent = win && !win.isDestroyed() ? win : undefined;
    const { backup, scanned, total, tried } = await pickRecoveryBackup(Date.now());
    const skipped = scanned.filter(info => !info.ok).length;

    /* Sağlıklı yedek yoksa "Son kayda dön" sunmanın anlamı yok: tek çıkış
       "Temiz başlat" (veriyi arşivleyip boş pano). */
    if (!backup) {
      const lines = [];
      if (tried) lines.push(dialogL10n.t('Backups tried in this session: {n} — the problem was not fixed.', { n: tried }));
      if (total) {
        lines.push(scanned.length
          ? dialogL10n.t('Healthy backups among the {n} scanned: none (too large / too many items).', { n: scanned.length })
          : dialogL10n.t('No backup that could be considered healthy was found.'));
      } else {
        lines.push(dialogL10n.t('No backup files exist. Backups are created only while Settings → "Auto backup" is enabled.'));
      }
      lines.push(dialogL10n.t('If "Clean start" is chosen, the current (corrupted) data is NOT deleted: it is moved to the Archive folder and the app opens with a single empty board.'));
      lines.push(dialogL10n.t('Archive: {dir}', { dir: archiveDir() }));

      const box = await dialog.showMessageBox(parent, {
        type: 'warning',
        title: dialogL10n.t('TailRef Studio is not responding'),
        message: dialogL10n.t('No healthy backup was found to recover from.'),
        detail: lines.join('\n\n'),
        buttons: [dialogL10n.t('Clean start'), dialogL10n.t('Wait')],
        /* Varsayılan VE Escape = "Bekle": yanlış alarmda Enter'a basmak
           veriyi arşivleyip boş panoya geçmesin. */
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (box.response !== 0) {
        recoveryCooldownUntil = Date.now() + 45000;
        return false;
      }
      console.warn('[kurtarma] temiz başlatılıyor (sağlıklı yedek yok)');
      writeResetMarker(reason);
      relaunchApp();
      return true;
    }

    const when = new Date(backup.mtime).toLocaleString(dialogL10n.localeTag());
    const sizeText = backup.size >= 1024 * 1024
      ? `${(backup.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(backup.size / 1024))} KB`;
    const detail = [
      dialogL10n.t('Which option would you like?'),
      dialogL10n.t('Selected healthy backup: {name}', { name: backup.name }) + '\n' + when
        + '\n' + dialogL10n.t('Items: {items} · Images: {images} · Size: {size}',
          { items: backup.items, images: backup.images, size: sizeText })
        + (skipped ? '\n' + dialogL10n.t('(Backups skipped as unhealthy: {n} — too large / too many items)', { n: skipped }) : ''),
      dialogL10n.t('"Return to last healthy save": the app restarts and loads this backup. Changes made after that save will be lost.'),
      dialogL10n.t('"Clean start": current data is moved to the Archive folder and the app opens with a single empty board.'),
    ].join('\n\n');

    const box = await dialog.showMessageBox(parent, {
      type: 'warning',
      title: dialogL10n.t('TailRef Studio is not responding'),
      message: dialogL10n.t('The app is overloaded and not responding.'),
      detail,
      buttons: [
        dialogL10n.t('Return to last healthy save'),
        dialogL10n.t('Clean start'),
        dialogL10n.t('Wait'),
      ],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (box.response === 2) {
      /* "Bekle": kullanıcıya nefes alma süresi tanı; kutu hemen tekrar açılmasın. */
      recoveryCooldownUntil = Date.now() + 45000;
      return false;
    }
    if (box.response === 1) {
      console.warn('[kurtarma] temiz başlatılıyor');
      writeResetMarker(reason);
      relaunchApp();
      return true;
    }

    console.warn('[kurtarma] son sağlıklı kayda dönülüyor:', backup.name);
    // Aynı dosya tekrar önerilmesin (bozuk çıkarsa sıradaki adaya geçilir).
    rememberRecoveryTry(backup.name);
    writeRecoveryMarker(backup.name, reason);
    relaunchApp();
    return true;
  } catch (error) {
    console.warn('kurtarma iletişim kutusu açılamadı', error);
    return false;
  } finally {
    recoveryDialogOpen = false;
  }
}

async function probeRenderer(contents) {
  if (!contents || contents.isDestroyed() || contents.isLoading()) return;
  if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return;
  if (recoveryDialogOpen || probeInFlight) return;
  /* Kapanış sırasında renderer'a "kaydet?" sorusu gösteriliyor olabilir;
     bu senkron kutu renderer'ı kısa süre meşgul eder, yanıt vermiyor
     sanıp kurtarma kutusu açmayalım. */
  if (closeAck && !closeConfirmed) return;
  if (Date.now() < recoveryCooldownUntil) return;
  /* Bilinçli ağır iş (FX zinciri) sürüyorsa yanlış pozitif üretme. */
  if (Date.now() < rendererBusyUntil) { probeFailures = 0; return; }
  probeInFlight = true;
  const started = Date.now();
  let ok = false;
  try {
    ok = await Promise.race([
      contents.executeJavaScript('1', true).then(() => true, () => false),
      new Promise(resolve => setTimeout(() => resolve(false), RECOVERY_PROBE_TIMEOUT_MS)),
    ]);
  } catch {
    ok = false;
  } finally {
    probeInFlight = false;
  }
  const elapsed = Date.now() - started;
  /* Tam donmanın yanı sıra ağır ama canlı arayüzü de yakala: yoklama
     1,2 sn'den uzun sürdüyse renderer pratikte kullanılamaz durumdadır. */
  const healthy = ok && elapsed <= RECOVERY_SLOW_MS;
  if (healthy) {
    probeFailures = 0;
    return;
  }
  probeFailures += 1;
  if (probeFailures < RECOVERY_PROBE_LIMIT) return;
  probeFailures = 0;
  console.warn('[kurtarma] renderer yanıt vermiyor; son kayda dönme kutusu açılıyor',
    { sonYoklamaTemiz: ok, gecikmeMs: elapsed });
  offerRecovery('watchdog');
}

function startResponsivenessWatchdog(contents) {
  stopResponsivenessWatchdog();
  /* Sentetik yük koşuları (fx-bench/fx-profile/fx-hash) renderer'ı bilinçli
     olarak dakikalarca senkron kilitler; üretimdeki gözcü bunu "çökme"
     sanıp veri arşivlemeyi öneren kutuyu açıyordu. Bu probe'lar
     TailRef_NO_RECOVERY=1 ile başlar; gerçek uygulama etkilenmez. */
  if (process.env.TailRef_NO_RECOVERY === '1') return;
  probeFailures = 0;
  watchdogTimer = setInterval(() => { probeRenderer(contents); }, RECOVERY_PROBE_MS);
  if (watchdogTimer.unref) watchdogTimer.unref();
}

function stopResponsivenessWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
  probeFailures = 0;
}

/* ---- kurtarma IPC ---- */
ipcGuard.handle(ipcMain, 'list-backups', async () => {
  /* Sıralı denetim: aynı anda birden çok 200 MB'lık parse belleği şişirmesin.
     Handler async olduğu için ana süreç/UI beklemez. */
  const out = [];
  for (const entry of listBackupFiles()) {
    const info = await inspectBackup(entry);
    out.push({
      name: entry.name, size: entry.size, mtime: entry.mtime,
      tier: entry.tier || 'auto', healthy: info.ok,
      items: info.items, images: info.images, reason: info.reason,
    });
  }
  return out;
});

ipcGuard.handle(ipcMain, 'read-backup', async (_e, name) => {
  try {
    const full = backupPath(name);
    if (!full) return null;
    const stat = await fs.promises.stat(full);
    if (!stat.isFile() || stat.size > 1024 * 1024 * 1024) return null;
    /* 1 GB'a kadar yedek: senkron okuma tüm pencereyi donduruyordu. */
    return await fs.promises.readFile(full, 'utf8');
  } catch {
    return null;
  }
});

/* Geri yükleme/sıfırlama ÖNCESİ mevcut durumun kopyası: yanlış yedeği
   seçme ihtimaline karşı emniyet kemeri. */
ipcGuard.handle(ipcMain, 'save-emergency', (_e, payload) => {
  try {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `emergency-${stamp}.json`);
    /* Acil kopya, veri kaybı anında güvenilen son çare: yarım yazılmış
       JSON bırakmamak için atomik yaz. */
    writeFileAtomic(file, typeof payload === 'string' ? payload : JSON.stringify(payload));
    const old = fs.readdirSync(dir)
      .filter(name => /^emergency-.*\.json$/i.test(name))
      .sort()
      .reverse()
      .slice(EMERGENCY_BACKUPS_KEPT);
    for (const name of old) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* sessiz */ }
    }
    return { ok: true, file: path.basename(file) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/* "Temiz başlat" öncesi panoları arşive yazar (görseller hariç: asıl
   şişkinlik onlarda). Arşiv kullanıcı tarafından geri alınabilir. */
ipcGuard.handle(ipcMain, 'save-archive', (_e, payload) => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(archiveDir(), stamp);
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(path.join(dir, 'workspace.json'),
      typeof payload === 'string' ? payload : JSON.stringify(payload));
    // Yedek dosyalarının da bir kopyası arşive gitsin (bozuk tahta dahil).
    try {
      const target = path.join(dir, 'Backups');
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(backupsDir()).filter(n => /\.json$/i.test(n)).slice(0, 25)) {
        try { fs.copyFileSync(path.join(backupsDir(), name), path.join(target, name)); } catch { /* sessiz */ }
      }
    } catch { /* yedekler kopyalanamadıysa devam */ }
    return { ok: true, path: dir };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcGuard.handle(ipcMain, 'recovery-request', () => readRecoveryMarker());
ipcGuard.handle(ipcMain, 'recovery-clear', () => { clearRecoveryMarker(); return true; });
/* Açılış sağlıklıysa "denenen yedekler" listesini unut. */
ipcGuard.handle(ipcMain, 'recovery-healthy', () => { clearRecoveryHistory(); return true; });
ipcGuard.handle(ipcMain, 'recovery-offer', () => offerRecovery('menu'));
/* Kutu açmadan "hangi yedek seçilirdi?" sorusunu yanıtlar (tanılama + test). */
ipcGuard.handle(ipcMain, 'recovery-plan', async () => {
  const plan = await pickRecoveryBackup(Date.now());
  return {
    total: plan.total,
    tried: plan.tried,
    chosen: plan.backup ? {
      name: plan.backup.name, mtime: plan.backup.mtime, size: plan.backup.size,
      items: plan.backup.items, images: plan.backup.images, tier: plan.backup.tier,
    } : null,
    scanned: plan.scanned.map(info => ({
      name: info.name, ok: info.ok, items: info.items, images: info.images,
      size: info.size, reason: info.reason,
    })),
  };
});
ipcGuard.handle(ipcMain, 'open-archive', () => {
  const dir = archiveDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* sessiz */ }
  return shell.openPath(dir);
});


/* ---------------- yaşam döngüsü ---------------- */
const gotLock = app.requestSingleInstanceLock();

/* Electron 32: pencere kapanırken yüklemesi süren bir <webview> çerçevesi
   elden çıkarıldığında ana süreçte iç bir istisna fırlayabiliyor ve kullanıcıya
   "A JavaScript error occurred in the main process" diyaloğu gösteriliyor.
   Yalnızca bu bilinen kapanış yarışını yutuyoruz; diğer hatalar normal
   şekilde raporlanır. */
process.on('uncaughtException', error => {
  const message = String((error && error.message) || error || '');
  if (/Render frame was disposed before WebFrameMain could be accessed/i.test(message)) return;
  /* Konsol çıktısı kapatılmış bir boruya yazılırsa (uygulama bir terminalden
     başlatılıp terminal kapatıldığında) Node EPIPE fırlatır. Bu yalnızca log
     kaybıdır; kullanıcıya çökme diyaloğu göstermenin anlamı yok. */
  if (error && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')) return;
  if (/broken pipe/i.test(message)) return;
  console.error('Ana süreç hatası:', error);
  try { dialog.showErrorBox('TailRef Studio', message || dialogL10n.t('Unknown error')); } catch { /* sessiz */ }
});

/* Port sabit tutulmalı: IndexedDB deposu bu origin'e bağlı. Bu yüzden başka bir
   porta sessizce düşmüyoruz (tahta boş görünürdü). Bunun yerine kısa süre
   yeniden dener, sonra ne yapılacağını açıkça söyleriz. */
async function startServerWithRetry(attempts = 6, delayMs = 350) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      srv = await startStaticServer({ root: ROOT, port: PORT, host: HOST });
      return srv;
    } catch (e) {
      lastError = e;
      if (!e || e.code !== 'EADDRINUSE') break;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

/* Paketlenen uygulamanın yapı damgası (app.asar'ın paketlendiği an).
   Dev modda app.asar yok; boş döner. Tek örnek kilidi yüzünden "yeni
   başlatma"nın eski pencereye devredilmesini görünür yapar: kullanıcı
   hangi yapının koştuğunu teşhis panelinde (Ctrl+Alt+P) ve bildirimde
   görür — eski yapıda "düzeltme işe yaramadı" sanılmasın. */
const buildStamp = (() => {
  try {
    const d = fs.statSync(path.join(process.resourcesPath, 'app.asar')).mtime;
    const two = n => String(n).padStart(2, '0');
    return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ` +
      `${two(d.getHours())}:${two(d.getMinutes())}`;
  } catch { return ''; }
})();
ipcGuard.handle(ipcMain, 'get-build-stamp', () => buildStamp);

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    /* Çalışırken .tail dosyasına çift tık / "Birlikte aç": yol yeni
       süreçten devralınır — canlı pencereye push'lanır. */
    const boardFile = extractBoardPath(argv);
    if (boardFile) pendingBoardFile = boardFile;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      /* Kilit sahibi biziz: yeni başlatılan exe buradan devralındı. */
      try {
        win.webContents.send('tailref:second-instance', { stamp: buildStamp });
        if (boardFile) win.webContents.send('tailref:open-board-file', boardFile);
      }
      catch { /* pencere kapanıyor olabilir */ }
    }
  });

  app.whenReady().then(async () => {
    // Ekran süresi her şeyden önce: splash en ilk iş olarak açılır;
    // oturum sertleştirme, panel kayıtları ve sunucu arkada devam eder.
    createSplashWindow();

    Menu.setApplicationMenu(null);
    hardenSession(session.defaultSession);
    hardenSession(session.fromPartition('persist:pinterest'));
    hardenSession(session.fromPartition('persist:artstation'));
    disableGuestServiceWorkers(session.fromPartition('persist:pinterest'));
    disableGuestServiceWorkers(session.fromPartition('persist:artstation'));
    registerPinterest({ isTest: TEST_ENV });
    registerArtStation({ isTest: TEST_ENV });
    installGuestGuards({ isTest: TEST_ENV });

    try {
      await startServerWithRetry();
    } catch (e) {
      const inUse = e && e.code === 'EADDRINUSE';
      const msg = inUse
        ? dialogL10n.t('Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)', { n: PORT })
        : dialogL10n.t('Could not start the local server: {msg}', { msg: e && e.message });
      if (splashWin && !splashWin.isDestroyed()) { splashWin.close(); splashWin = null; }
      dialog.showErrorBox('TailRef Studio', msg);
      app.quit();
      return;
    }

    createWindow();

    /* Otomatik güncelleme: yalnızca kurulumlu (NSIS) pakette etkin.
       Başlatmayı bloklamaz; ilk kontrol gecikmeli yapılır. */
    try {
      updateManager = createUpdateManager({
        app,
        ipcMain,
        autoUpdater,
        getMainWindow: () => win,
        isPortable: () => isPortableEnv(process.env),
        onInstallRequest: requestInstallHandshake,
        openExternal: url => shell.openExternal(url),
      });
      updateManager.start();
    } catch (error) {
      console.warn('[updates] manager could not start:', error && error.message);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    if (updateManager) { try { updateManager.stop(); } catch { /* sessiz */ } }
    try { backupInspector.dispose(); } catch { /* sessiz */ }
    finishInstallHandshake(false);
    // Yükleme sürerken pencereleri kapatmak Electron'da iç bir kapanış
    // yarışına yol açabiliyor; önce konuk sayfaları durdur.
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() === 'webview') {
        try { contents.stop(); } catch { /* zaten kapanmış */ }
      }
    }
    if (srv) { try { srv.close(); } catch { /* sessiz */ } }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
