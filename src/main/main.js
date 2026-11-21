'use strict';

/* TailRef — Electron ana süreç
   Statik dosyaları 127.0.0.1:5178 üzerinden sunar.
   Sabit port önemli: IndexedDB deposu bu origin'e bağlı. */

const { app, BrowserWindow, ipcMain, Menu, dialog, screen, session, shell, webContents, clipboard, nativeImage } = require('electron');
const { registerPinterest } = require('./pinterest');
const { registerArtStation } = require('./artstation');
const { installGuestGuards } = require('./guest-guards');
const { createPanelWindowManager } = require('./panel-window-manager');
const { normalizeExternalUrl } = require('./external-links');
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
const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');
const { startStaticServer } = require('./static-server');
/* (Canvas Editor köprüsü kaldırıldı — ayrı pencere akışı silindi.) */

/* Atomik yazım choke-point: kalıcılık dosyalarına yarım içerik asla düşmez.
   Aynı klasörde geçici dosyaya yazar, sonra tek renameSync ile yerleştirir
   (aynı klasör = aynı disk, rename atomiktir). Süreç yazım ortasında çökerse
   ya eski dosya ya tam yenisi okunur — bozuk/truncate JSON hiçbir zaman yok.
   Windows'ta hedef bir okuyucu (AV, yedekleme) tarafından kilitliyse rename
   EPERM/EBUSY verebilir: bir kez hedefi bırakıp yeniden denenir, düşerse
   doğrudan yazmaya cansıkı düşer (eski davranış; kayıp yerine yarım dosya). */
function writeFileAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir,
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.writeFileSync(tmp, data);
    try {
      fs.renameSync(tmp, file);
    } catch {
      try {
        fs.rmSync(file, { force: true });
        fs.renameSync(tmp, file);
      } catch {
        fs.writeFileSync(file, data);
      }
    }
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* sessiz */ }
  }
}

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

  // pencere ikonu (paketli sürümde extraResources/icon.ico, geliştirmede build/icon.ico)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');
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
ipcMain.on('window-close-ack', () => {
  closeAck = true;
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null; }
});

/* İlk frame boyandıktan sonra renderer sinyali: ana penceriyi görünür yap.
   Yalnızca ana pencerenin kendi sender'ı kabul edilir (webview'lerden
   gelen ping yok sayılır). */
ipcMain.on('reveal-main-window', (event) => {
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
ipcMain.handle('window-cancel-close', () => {
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
ipcMain.handle('confirm-dialog', async (_e, message, detail, params) => {
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
ipcMain.handle('window-close-choice', async () => {  if (!win || win.isDestroyed()) return 1;
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

ipcMain.handle('window-confirm-close', () => {
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null; }
  closeConfirmed = true;
  if (win && !win.isDestroyed()) win.close();
  return true;
});

ipcMain.handle('toggle-on-top', () => {
  if (!win) return false;
  alwaysOnTop = !alwaysOnTop;
  applyAlwaysOnTop();
  saveWindowState();
  return alwaysOnTop;
});

ipcMain.handle('is-on-top', () => (win ? alwaysOnTop : false));

ipcMain.handle('window-minimize', () => { if (win) win.minimize(); });
ipcMain.handle('window-close',    () => { if (win) win.close(); });
ipcMain.handle('window-toggle-max', () => {
  if (!win) return false;
  /* maximize()/unmaximize() OS'de asenktir; hemen ardından isMaximized()
     okumak eski değeri döndürebilir. Hedef durumu önce hesapla ve onu döndür;
     gerçek durum maximize/unmaximize olaylarıyla senkronlanır. */
  const target = !win.isMaximized();
  if (target) win.maximize();
  else win.unmaximize();
  return target;
});
ipcMain.handle('window-is-maximized', () => !!(win && win.isMaximized()));
ipcMain.handle('window-toggle-fullscreen', () => {
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

ipcMain.handle('window-is-fullscreen', () => !!(win && (winFullscreen || win.isFullScreen())));
ipcMain.handle('window-exit-fullscreen', () => {
  if (!win) return false;
  if (win.isKiosk()) win.setKiosk(false);
  if (winFullscreen || win.isFullScreen()) {
    win.setFullScreen(false);
    winFullscreen = false;
  }
  return false;
});
ipcMain.handle('open-external', (_e, url) => {
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

ipcMain.handle('clipboard-image', (_e, bytes) => {
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

ipcMain.handle('save-image', async (_e, bytes, suggestedName) => {
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
    fs.writeFileSync(result.filePath, buffer);
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/* Ayarlar > Genel: tercih yedeği (Faz 6) — tercih JSON'u diske yazar.
   Yalnızca metin; tahta verisi (IndexedDB) bu kanaldan geçmez. */
ipcMain.handle('save-preferences-json', async (_e, text, suggestedName) => {
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
    fs.writeFileSync(result.filePath, String(text || ''), 'utf8');
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/* Footer "Kaydet" (15 Kasım 2026): tercih JSON'unu SESSİZ yazar —
   diyalog yok. Portable kullanım güvenliği: userData her zaman denenir;
   exe yanına da yazılır (oradaki dosya profil kaybında kurtarıcıdır;
   Program Files gibi yazmaya kapalı yerlerde sessizce atlanır). */
ipcMain.handle('save-preferences-auto', async (_e, text) => {
  const targets = [path.join(app.getPath('userData'), 'tailref-preferences.json')];
  try { targets.push(path.join(path.dirname(app.getPath('exe')), 'tailref-preferences.json')); } catch { /* exe yolu okunamadı */ }
  let lastErr = '';
  let wrote = 0;
  for (const file of targets) {
    try {
      fs.writeFileSync(file, String(text || ''), 'utf8');
      wrote++;
    } catch (error) { lastErr = error.message; }
  }
  if (wrote) return { ok: true, file: targets[0], copies: wrote };
  return { ok: false, error: lastErr || 'write failed' };
});

/* Boot tercih geri yüklemesi (footer "Kaydet" ikilisi): renderer açılışta
   profilini kaybettiğini bildirirse (localStorage'da tailref- anahtarı
   kalmamışsa) kayıtlı dosyayı okur. */
ipcMain.handle('load-preferences-auto', async () => {
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
ipcMain.on('app-language', (_e, code) => {
  const gec = typeof code === 'string' ? code.slice(0, 12) : '';
  if (gec) dialogL10n.setLanguage(gec);
});
/* Test/otomasyon: ana sürecin bilinen dilini oku. */
ipcMain.handle('app-language-get', () => dialogL10n.getLanguage());

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
ipcMain.handle('choose-dir', async () => {
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
ipcMain.handle('export-image', async (_e, bytes, suggestedName, mime, dir) => {
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
      let hedef = path.join(requestedDir, fileName);
      let sira = 1;
      while (fs.existsSync(hedef)) {
        hedef = path.join(requestedDir, `${base} (${sira}).${ext}`);
        sira += 1;
      }
      fs.writeFileSync(hedef, buffer);
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
    fs.writeFileSync(result.filePath, buffer);
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
ipcMain.handle('export-abr', async (_e, bytes, suggestedName) => {
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
    fs.writeFileSync(result.filePath, buffer);
    return { ok: true, file: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('get-window-pos', () => (win ? win.getPosition() : [0, 0]));
ipcMain.handle('set-window-pos', (_e, x, y) => {
  if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return;
  win.setPosition(Math.round(x), Math.round(y));
});

/* ---------------- .tail dosyası: kaydet / aç ----------------
   Manuel kayıt modunun dosya biçimi. İçerik gzip'lenmiş JSON'dur
   (görseller base64 dataUrl olarak gömülü). Sıkıştırma sayesinde
   tekrarlı çizim verisi (state.ink) küçülür; ek bağımlılık gerekmez.
   Dosya imzası 'TAIL'dir. Eski Refeverr sürümlerinin yazdığı 'RFVR'
   imzası OKUMA tarafında kabul edilir; yeni dosyalar her zaman 'TAIL'
   olarak yazılır (kullanıcıya görünmez, 4 baytlık biçim tanıma). */
const TAIL_EXT = '.tail';
const TAIL_MAGIC = 'TAIL';
const LEGACY_TAIL_MAGIC = 'RFVR';
const TAIL_VERSION = 1;
/* Bozuk/kötü niyetli bir dosyanın belleği tüketmesini engelle: sıkıştırılmış
   dosya ve açılmış JSON için ayrı üst sınırlar. Gerçek panolar bunların çok
   altında kalır (en ağır kullanıcı panosu ~200 MB). */
const MAX_TAIL_FILE_BYTES = 1024 * 1024 * 1024;      // 1 GB (disk)
const MAX_TAIL_INFLATED_BYTES = 1536 * 1024 * 1024;  // 1,5 GB (JSON)
/* Sıkıştırma/açma senkron yapılırsa ana süreç (pencere, menü, IPC) büyük
   panolarda saniyelerce donar. Async zlib ana süreci serbest bırakır. */
function deflateAsync(buf) {
  return new Promise((resolve, reject) => {
    zlib.deflate(buf, { level: 6 }, (error, out) => (error ? reject(error) : resolve(out)));
  });
}
function inflateAsync(buf) {
  return new Promise((resolve, reject) => {
    zlib.inflate(buf, { maxOutputLength: MAX_TAIL_INFLATED_BYTES },
      (error, out) => (error ? reject(error) : resolve(out)));
  });
}

ipcMain.handle('save-tail', async (_e, payload, suggestedName) => {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const json = Buffer.from(text, 'utf8');
    if (json.length > MAX_TAIL_INFLATED_BYTES) {
      return { ok: false, error: 'Board is too large to save as .tail' };
    }
    const deflated = await deflateAsync(json);

    // Basltic: magic(4) + version(1) + deflated baytlar.
    const out = Buffer.concat([
      Buffer.from(TAIL_MAGIC, 'ascii'),
      Buffer.from([TAIL_VERSION]),
      deflated,
    ]);

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

/** Diskten .tail dosyası okur (magic + sürüm + inflate). open-tail
    diyaloğu ile çift tık / sürükle-bırak yolları aynı kapıyı kullanır.
    Eski 'RFVR' imzası geriye dönük uyumluluk için kabul edilir. */
async function readBoardFile(filePath) {
  const invalid = { ok: false, error: dialogL10n.t('This is not a valid .tail file.') };
  let stat = null;
  try { stat = fs.statSync(filePath); } catch { return invalid; }
  if (!stat.isFile() || stat.size < 6 || stat.size > MAX_TAIL_FILE_BYTES) return invalid;
  const buf = fs.readFileSync(filePath);
  const magic = buf.length >= 4 ? buf.subarray(0, 4).toString('ascii') : '';
  if (buf.length < 6 || (magic !== TAIL_MAGIC && magic !== LEGACY_TAIL_MAGIC)) {
    return invalid;
  }
  const version = buf[4];
  if (version !== TAIL_VERSION) {
    return { ok: false, error: dialogL10n.t('Unsupported .tail version ({n}).', { n: version }) };
  }
  let json = null;
  try {
    json = await inflateAsync(buf.subarray(5));
  } catch {
    /* Bozuk gövde / sınırı aşan açılım: geçersiz dosya olarak raporla. */
    return invalid;
  }
  return { ok: true, file: filePath, payload: JSON.parse(json.toString('utf8')) };
}

ipcMain.handle('open-tail', async () => {
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
ipcMain.handle('open-tail-path', async (_e, filePath) => {
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
   yakalanır. Açılışta renderer tüketir (consume), çalışırken ikinci
   başlatma push ile canlı pencereye devredilir. */
function extractBoardPath(argv) {
  for (const arg of argv || []) {
    if (typeof arg === 'string' && /\.tail$/i.test(arg)) return arg;
  }
  return null;
}
let pendingBoardFile = extractBoardPath(process.argv);
ipcMain.handle('consume-board-launch-file', () => {
  const p = pendingBoardFile;
  pendingBoardFile = null;
  return p;
});
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
ipcMain.handle('auto-backup', async (_e, payload, limit, counts) => {
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
        : inspectBackup({ name: path.basename(file), size: stat.size, mtime: stat.mtimeMs, tier: 'auto' });
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
ipcMain.handle('open-backups', async () => {
  const dir = path.join(app.getPath('userData'), 'Backups');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, path: dir, error: `Klasör oluşturulamadı: ${e.message}` };
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
ipcMain.handle('set-on-top', (_e, on) => {
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

function countBackupContent(parsed) {
  let items = 0;
  const images = Array.isArray(parsed.images) ? parsed.images.length : 0;
  const workspace = parsed.workspace;
  if (workspace && Array.isArray(workspace.projects) && workspace.projects.length) {
    for (const record of workspace.projects) {
      const snapshot = record && (record.state || record.snapshot);
      if (snapshot && Array.isArray(snapshot.items)) items += snapshot.items.length;
    }
  } else if (parsed.state && Array.isArray(parsed.state.items)) {
    items += parsed.state.items.length;
  }
  return { items, images };
}

/* Aynı dosya tekrar tekrar okunmasın (yoklama/kutu döngüsü). */
const healthCache = new Map();

/** Yedeğin içeriğine bakar: kaç öğe, kaç görsel, ne kadar büyük?
    Bozuk/aşırı yüklenmiş yedekleri elemek için kullanılır. */
function inspectBackup(entry) {
  const key = `${entry.name}:${entry.size}:${entry.mtime}`;
  const cached = healthCache.get(key);
  if (cached) return cached;

  const info = {
    name: entry.name, size: entry.size, mtime: entry.mtime,
    tier: entry.tier || 'auto', ok: false, items: 0, images: 0, reason: '',
  };
  if (entry.size > MAX_HEALTHY_BYTES) {
    info.reason = `dosya çok büyük (${Math.round(entry.size / (1024 * 1024))} MB)`;
  } else {
    try {
      const full = backupPath(entry.name);
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      const counts = countBackupContent(parsed);
      info.items = counts.items;
      info.images = counts.images;
      if (counts.items > MAX_HEALTHY_ITEMS) info.reason = `${counts.items} öğe`;
      else if (counts.images > MAX_HEALTHY_IMAGES) info.reason = `${counts.images} görsel`;
      else info.ok = true;
    } catch {
      info.reason = 'okunamadı (bozuk dosya)';
    }
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
    fs.writeFileSync(recoveryHistoryPath(), JSON.stringify({ entries }), 'utf8');
  } catch { /* sessiz */ }
}

function clearRecoveryHistory() {
  try { fs.unlinkSync(recoveryHistoryPath()); } catch { /* zaten yok */ }
}

/** Kurtarma için yedeği seçer: yeni → eski tara, İLK SAĞLIKLI olanı al.
    Bu oturumda zaten denenmiş dosyalar atlanır (zincirleme geri dönüş). */
function pickRecoveryBackup(detectedAt) {
  const entries = listBackupFiles();
  const tried = new Set(readRecoveryHistory().map(entry => entry.name));
  const scanned = [];
  const healthy = [];
  for (const entry of entries) {
    if (tried.has(entry.name)) continue;
    const info = inspectBackup(entry);
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
    fs.writeFileSync(recoveryMarkerPath(), JSON.stringify({
      mode: 'restore',
      backup: path.basename(backupName),
      reason: reason || 'watchdog',
      requestedAt: new Date().toISOString(),
    }), 'utf8');
    return true;
  } catch (error) {
    console.warn('kurtarma işareti yazılamadı', error);
    return false;
  }
}

function writeResetMarker(reason) {
  try {
    fs.writeFileSync(recoveryMarkerPath(), JSON.stringify({
      mode: 'reset',
      reason: reason || 'reset',
      requestedAt: new Date().toISOString(),
    }), 'utf8');
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

ipcMain.on('renderer-busy', (_event, active) => {
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
    const { backup, scanned, total, tried } = pickRecoveryBackup(Date.now());
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
ipcMain.handle('list-backups', () => listBackupFiles().map(entry => {
  const info = inspectBackup(entry);
  return {
    name: entry.name, size: entry.size, mtime: entry.mtime,
    tier: entry.tier || 'auto', healthy: info.ok,
    items: info.items, images: info.images, reason: info.reason,
  };
}));

ipcMain.handle('read-backup', (_e, name) => {
  try {
    const full = backupPath(name);
    if (!full) return null;
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 1024 * 1024 * 1024) return null;
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
});

/* Geri yükleme/sıfırlama ÖNCESİ mevcut durumun kopyası: yanlış yedeği
   seçme ihtimaline karşı emniyet kemeri. */
ipcMain.handle('save-emergency', (_e, payload) => {
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
ipcMain.handle('save-archive', (_e, payload) => {
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

ipcMain.handle('recovery-request', () => readRecoveryMarker());
ipcMain.handle('recovery-clear', () => { clearRecoveryMarker(); return true; });
/* Açılış sağlıklıysa "denenen yedekler" listesini unut. */
ipcMain.handle('recovery-healthy', () => { clearRecoveryHistory(); return true; });
ipcMain.handle('recovery-offer', () => offerRecovery('menu'));
/* Kutu açmadan "hangi yedek seçilirdi?" sorusunu yanıtlar (tanılama + test). */
ipcMain.handle('recovery-plan', () => {
  const plan = pickRecoveryBackup(Date.now());
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
ipcMain.handle('open-archive', () => {
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
ipcMain.handle('get-build-stamp', () => buildStamp);

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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
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
