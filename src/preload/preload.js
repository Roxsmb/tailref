'use strict';

const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

/* =========================================================
   EVRE 5.1 - transferable yan kanal (renderer tarafı)
   ---------------------------------------------------------
   invoke() tamponları yapısal klonlar (30-50× ceza); MessagePort
   taşıma listesiyle buffer KOPYASIZ gider. Aşağıdaki yardımcılar
   bu modülün kapatılışında bir kere bağlanır; port hazır olmadan
   gelen istek klasik invoke köprüsüne düşer (yedek).
   ========================================================= */
let enginePort = null;
const enginePortPending = new Map();
let enginePortSeq = 0;
/* Port yanıtı hiç gelmezse istek sonsuza kadar asılı kalıyordu (P1):
   undo karo isteği çözülmüyor, çağıran zincir kilitleniyordu. Sınır
   aşılırsa port oturumu kapatılır ve bekleyen istekler hata olarak
   çözülür; çağıran taraf senkron JS yoluna düşer. */
const ENGINE_PORT_TIMEOUT_MS = 8000;

function enginePortDrop(reason) {
  const port = enginePort;
  enginePort = null;
  for (const [id, req] of enginePortPending) {
    enginePortPending.delete(id);
    clearTimeout(req.timer);
    req.resolve({ ok: false, error: reason, timeout: true });
  }
  try { if (port && typeof port.close === 'function') port.close(); } catch { /* zaten kapalı */ }
}

function enginePortWire() {
  if (enginePort !== null) return;
  try {
    ipcRenderer.send('ink-engine:port-open');
    ipcRenderer.on('ink-engine:port-open-reply', (event) => {
      const port = event.ports && event.ports[0];
      if (!port || enginePort) return;
      enginePort = port;
      port.onmessage = (e) => {
        const msg = e.data;
        const p = msg ? enginePortPending.get(msg.id) : null;
        if (!p) return;
        enginePortPending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg);
      };
      if ('onmessageerror' in port) {
        port.onmessageerror = () => enginePortDrop('Engine port message error');
      }
    });
  } catch { /* sessiz: invoke yedeği yürür */ }
}

/** tileSlice isteği — port yoksa/hata varsa invoke yedeğine düşer. */
async function enginePortTilesImpl(src, srcW, srcH, slices) {
  const port = enginePort;
  if (!port || !src || src.length == null || !slices || !slices.length ||
      srcW == null || srcH == null) {
    return invokeEngineTiles(src, srcW, srcH, slices);
  }
  const id = ++enginePortSeq;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (!enginePortPending.has(id)) return;
      enginePortPending.delete(id);
      resolve({ ok: false, error: 'Engine port request timed out', timeout: true });
      enginePortDrop('Engine port request timed out');
    }, ENGINE_PORT_TIMEOUT_MS);
    enginePortPending.set(id, { resolve, timer });
    try {
      port.postMessage(
        { id, fn: 'tileSlice',
          w: Math.trunc(srcW), h: Math.trunc(srcH), src, slices },
        [src.buffer, slices.buffer]);
    } catch (error) {
      enginePortPending.delete(id);
      clearTimeout(timer);
      resolve({ ok: false, error: String(error && error.message || error) });
    }
  });
}

function invokeEngineTiles(src, srcW, srcH, slices) {
  return ipcRenderer.invoke('ink-engine:tiles', src, srcW, srcH, slices);
}

if (typeof enginePortWire === 'function') {
  enginePortWire();
}

contextBridge.exposeInMainWorld('tailref', {
  isDesktop: true,
  /* UI ölçekleme (Ayarlar > Görünüm — fizibilite): webFrame zoom.
     Layout zoom'dur; getBoundingClientRect zaten final CSS px verir. */
  setZoomFactor:  (f) => { try { webFrame.setZoomFactor(Number(f) || 1); return webFrame.getZoomFactor(); } catch { return null; } },
  getZoomFactor:  () => { try { return webFrame.getZoomFactor(); } catch { return null; } },
  /* Yapı damgası (paketlenme zamanı) + tek örnek kilidi devri bildirimi. */
  getBuildStamp:    () => ipcRenderer.invoke('get-build-stamp'),
  /* Renderer'ın seçili dilini ana sürece bildir: diyaloglar bu dilde açılır. */
  sendAppLanguage:  (code) => ipcRenderer.send('app-language', String(code || '').slice(0, 12)),
  getAppLanguage:   () => ipcRenderer.invoke('app-language-get'),
  onSecondInstance: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('tailref:second-instance', (_event, data) => cb(data || {}));
  },
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-on-top'),
  isAlwaysOnTop:     () => ipcRenderer.invoke('is-on-top'),
  minimize:          () => ipcRenderer.invoke('window-minimize'),
  close:             () => ipcRenderer.invoke('window-close'),
  toggleMaximize:    () => ipcRenderer.invoke('window-toggle-max'),
  isMaximized:       () => ipcRenderer.invoke('window-is-maximized'),
  toggleFullscreen:  () => ipcRenderer.invoke('window-toggle-fullscreen'),
  isFullscreen:      () => ipcRenderer.invoke('window-is-fullscreen'),
  exitFullscreen:    () => ipcRenderer.invoke('window-exit-fullscreen'),
  getWindowPos:      () => ipcRenderer.invoke('get-window-pos'),
  setWindowPos:      (x, y) => ipcRenderer.invoke('set-window-pos', x, y),
  /* Ayrı (her zaman üstte) panel pencereleri. */
  openPanelWindow:   (payload) => ipcRenderer.invoke('panel-window-open', payload),
  syncPanelWindow:   (id, snapshot) => ipcRenderer.send('panel-sync', id, snapshot),
  closePanelWindow:  (id, restore = true) => ipcRenderer.invoke('panel-window-force-close', id, restore),
  onPanelWindowClosed: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('panel-window-closed', (_event, data) => cb(data || null));
  },
  onPanelAction: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('panel-action', (_event, data) => cb(data || null));
  },
  /* Ayrı paneldeki <webview> konuk sayfasıyla mesajlaşma. */
  sendPanelGuestMessage: (id, channel, args) =>
    ipcRenderer.send('panel-guest-send', id, channel, args),
  onPanelGuestMessage: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('panel-guest-message', (_event, data) => cb(data || null));
  },
  autoBackup:        (payload, limit, counts) => ipcRenderer.invoke('auto-backup', payload, limit, counts),
  /* Ağır senkron iş (FX zinciri) sırasında "yanıt vermiyor" gözcüsünü
     sustur: 4K efekt zinciri 1.5 sn'yi aşabiliyor ve yanlış kurtarma
     kutusu açılıyordu. Ana süreç bu bayrağı en çok 20 sn tutar. */
  rendererBusy:      (active) => ipcRenderer.send('renderer-busy', !!active),
  openBackups:       () => ipcRenderer.invoke('open-backups'),
  listBackups:       () => ipcRenderer.invoke('list-backups'),
  readBackupFile:    (name) => ipcRenderer.invoke('read-backup', name),
  getRecoveryRequest: () => ipcRenderer.invoke('recovery-request'),
  clearRecoveryRequest: () => ipcRenderer.invoke('recovery-clear'),
  offerRecovery:     () => ipcRenderer.invoke('recovery-offer'),
  getRecoveryPlan:   () => ipcRenderer.invoke('recovery-plan'),
  markRecoveryHealthy: () => ipcRenderer.invoke('recovery-healthy'),
  saveEmergency:     (payload) => ipcRenderer.invoke('save-emergency', payload),
  saveArchive:       (payload) => ipcRenderer.invoke('save-archive', payload),
  openArchive:       () => ipcRenderer.invoke('open-archive'),
  setAlwaysOnTop:    (on) => ipcRenderer.invoke('set-on-top', on),
  openExternal:      (url) => ipcRenderer.invoke('open-external', url),
  // 3D capture (P5): PNG baytları doğrudan taşınır (yeniden kodlama yok).
  copyImage:         (bytes) => ipcRenderer.invoke('clipboard-image', bytes),
  saveImage:         (bytes, name) => ipcRenderer.invoke('save-image', bytes, name),
  // Seçili fotoğrafı orijinal baytlarıyla (yeniden kodlamadan) diske yazar.
  // dir verilirse doğrudan o klasöre yazar; verilmezse kaydet penceresi açar.
  exportImage:       (bytes, name, mime, dir) => ipcRenderer.invoke('export-image', bytes, name, mime, dir),
  // Kayıt klasörü seçme penceresi (Dışa Aktar diyaloğu kullanır).
  chooseDirectory:   () => ipcRenderer.invoke('choose-dir'),
  // Fırça kütüphanesindeki fırçayı .abr dosyası olarak kaydeder.
  exportAbr:         (bytes, name) => ipcRenderer.invoke('export-abr', bytes, name),
  // Ayarlar > Genel: tercih yedeğini JSON olarak kaydeder (Faz 6).
  savePreferencesJson: (text, name) => ipcRenderer.invoke('save-preferences-json', text, name),
  // Footer "Kaydet": diyalogsuz sessiz yazma (userData + exe yanı).
  savePreferencesAuto: (text) => ipcRenderer.invoke('save-preferences-auto', text),
  // Footer "Kaydet" ikilisi: açılışta kayıp profil için okuma.
  loadPreferencesAuto: () => ipcRenderer.invoke('load-preferences-auto'),

  /* C++ çizim çekirdeği (evre 1: uç üretimi).
     kind: 'noiseTip' | 'watercolorTip'; kalan beş sayı işin değişkenleri:
     noiseTip      → px, density, edge, seed, step
     watercolorTip → px, core, ring, edge, seed
     Dönüş: { ok, data, stat } — data piksel dizisi (Uint8ClampedArray). */
  engineTip: (kind, px, a, b, c, d) =>
    ipcRenderer.invoke('ink-engine:tip', kind, px, a, b, c, d),
  engineStatus: () => ipcRenderer.invoke('ink-engine:status'),
  /* C++ çekirdek evre 2: damla emisyonu (Catmull-Rom + carry).
     points: Float64Array (stride 7: x,y,p,s,t,a,br; yokluk = NaN).
     totalLength NaN geçilebilir (yok). Dönüş:
     { ok, count, data } — data Float64Array (stride 9:
     x,y,k,p,s,t,a,br,tilted; "yok" alanlar NaN). */
  engineDabs: (points, spacing, sx, sy, stableOnly, jitter,
    taperStart, taperEnd, progressOffset, totalLength, strokeId) =>
    ipcRenderer.invoke('ink-engine:dabs', points, spacing, sx, sy,
      stableOnly, jitter, taperStart, taperEnd, progressOffset,
      totalLength, strokeId),
  /* C++ çekirdek evre 4: undo karo dilimleri (tileSlice).
     src: Uint8ClampedArray bölge RGBA (satır adımı srcW*4);
     slices: Int32Array stride 4 relX,relY,w,h. Dönüş:
     { ok, count, data } — data Uint8Array, dilim sırasıyla bitişik.
     EVRE 5.1: enginePortTiles transferable port kanalını kullanır
     (sıfır-kopya); port hazır değilse invoke yedeğine düşer. */
  engineTiles: (src, srcW, srcH, slices) =>
    ipcRenderer.invoke('ink-engine:tiles', src, srcW, srcH, slices),
  enginePortTiles: (src, srcW, srcH, slices) =>
    enginePortTilesImpl(src, srcW, srcH, slices),
  // .tail tahta dosyası (manuel kayıt modu): gzip'lenmiş JSON. İç imza 'TAIL'.
  saveTail:          (payload, name) => ipcRenderer.invoke('save-tail', payload, name),
  openTail:          () => ipcRenderer.invoke('open-tail'),
  /* .tail'i dışarıdan açma yolları: çift tık (exe argv'sı) ve pencereye
     sürükleme. pathForDroppedFile: bırakılan File'ın disk yolunu verir
     (Electron 29+ webUtils). */
  pathForDroppedFile:    (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  openBoardFileAtPath:   (p) => ipcRenderer.invoke('open-tail-path', String(p || '')),
  consumeBoardLaunchFile: () => ipcRenderer.invoke('consume-board-launch-file'),
  onOpenBoardFile: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('tailref:open-board-file', (_event, p) => cb(p || ''));
  },
  // Pinterest paneli (uygulama içi tarayıcı)
  pinterestConfig:   () => ipcRenderer.invoke('pinterest-config'),
  pinterestSession:  () => ipcRenderer.invoke('pinterest-session'),
  pinterestFetch:    (url, options) => ipcRenderer.invoke('pinterest-fetch', url, options),
  pinterestOpenFolder: () => ipcRenderer.invoke('pinterest-open-folder'),
  pinterestClear:    () => ipcRenderer.invoke('pinterest-clear'),
  // ArtStation paneli (uygulama içi tarayıcı)
  artstationConfig:  () => ipcRenderer.invoke('artstation-config'),
  artstationFetch:   (url, options) => ipcRenderer.invoke('artstation-fetch', url, options),
  artstationOpenFolder: () => ipcRenderer.invoke('artstation-open-folder'),
  artstationClear:   () => ipcRenderer.invoke('artstation-clear'),
  // Kapanmadan önce renderer'ın son değişiklikleri kaydetmesi için el sıkışma.
  onCloseRequested:  (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('app-close-requested', () => cb());
  },
  confirmClose:      () => ipcRenderer.invoke('window-confirm-close'),
  /* Kapanış el sıkışması: "isteği aldım, kullanıcıya soruyorum" ve
     "kapanıştan vazgeçtim" bildirimleri. */
  ackCloseRequest:   () => ipcRenderer.send('window-close-ack'),
  cancelClose:       () => ipcRenderer.invoke('window-cancel-close'),
  askCloseChoice:    () => ipcRenderer.invoke('window-close-choice'),
  /* Renderer confirm()'ünün bloksuz hali: soru ana süreçte yerel kutu olarak
     sorulur (senkron confirm renderer'ı kilitliyor + CPU yakıyordu).
     Dönüş: 0 = Onay, 1 = İptal. */
  confirmDialog:     (message, detail, params) => ipcRenderer.invoke('confirm-dialog', String(message || ''), String(detail || ''), params || null),
  /* İlk frame çizildi: ana pencereyi görünür yap (beyaz flash önleme). */
  revealMainWindow:  () => ipcRenderer.send('reveal-main-window'),
  /* Automatic updates. Every decision lives in the main process; the
     renderer can only ask for state and confirm that saving is done. */
  updateGetState:        () => ipcRenderer.invoke('update:get-state'),
  updateGetPreferences:  () => ipcRenderer.invoke('update:get-preferences'),
  updateSetPreferences:  (patch) => ipcRenderer.invoke('update:set-preferences', patch),
  updateCheck:           (manual) => ipcRenderer.invoke('update:check', !!manual),
  updateDownload:        () => ipcRenderer.invoke('update:download'),
  updateInstall:         () => ipcRenderer.invoke('update:install'),
  updateOpenDownload:    () => ipcRenderer.invoke('update:open-download'),
  updateInstallChoice:   () => ipcRenderer.invoke('window-install-choice'),
  updateInstallReady:    () => ipcRenderer.invoke('update-install-ready'),
  updateInstallPostpone: () => ipcRenderer.invoke('update-install-postpone'),
  onUpdateState: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('update:state', (_event, state) => cb(state || null));
  },
  onUpdateInstallRequested: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('update-install-requested', () => cb());
  },
});
