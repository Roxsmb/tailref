/* TailRef app · ArtStation paneli (uygulama içi tarayıcı) */
'use strict';

/* Pinterest paneliyle aynı akış: ArtStation ayrı bir pencere yerine panelin
   içindeki <webview> ile açılır. Konuk sayfaya artstation-preload.js enjekte
   edilir; oradaki "Tahtaya ekle" düğmesi görsel adresini buraya yollar.
   Baytlar ana süreçte indirilir (CORS yok), ardından mevcut addFiles() akışıyla
   tahtaya eklenir. */

const artstationPanel      = $('#artstationPanel');
const artstationView       = $('#artstationView');
const artstationStatusEl   = $('#artstationStatus');
const artstationUrlEl      = $('#artstationUrl');
const artstationAddUrlEl   = $('#artstationAddUrl');
const artstationAddVisibleEl = $('#artstationAddVisible');
const artstationSaveDiskEl = $('#artstationSaveDisk');
const artstationOpenFolderEl = $('#artstationOpenFolder');
const artstationResetEl    = $('#artstationReset');

let artstationConfigCache = null;
let artstationLoaded = false;
let artstationAddedCount = 0;
let artstationDropIndex = 0;
let artstationMode = 'feed';
let artstationBatchBusy = false;
let artstationBatchTimer = 0;
/* Ayrı penceredeki konuk sayfanın son adresi: panel geri takılınca ana
   penceredeki webview aynı sayfada devam eder. */
let artstationDetachedUrl = '';
/* Bu oturumda tahtaya eklenen görsel adresleri: "Add visible ones" aynı
   görseli ikinci kez eklemesin. */
const artstationSeen = new Set();

function setArtStationStatus(text, tone) {
  if (!artstationStatusEl) return;
  artstationStatusEl.textContent = text;
  if (tone) artstationStatusEl.dataset.tone = tone;
  else delete artstationStatusEl.dataset.tone;
}

const ARTSTATION_READY_TEXT = 'Ready — hover over an image, add it to the board with ＋.';
const ARTSTATION_LOGIN_TEXT = 'Sign in to ArtStation once — the Google/Facebook button opens in a separate secure window; the session stays in this app.';

/* ArtStation giriş yapmamış ziyaretçiyi akışta tutar; giriş sayfasına
   yönlendirildiğimizde adres bunu doğrudan söyler. Ekstra ağ isteği yok. */
function artstationModeForUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)artstation\.com$/i.test(url.hostname)) return null;
    return /^\/users\/sign_in/i.test(url.pathname) ? 'login' : 'feed';
  } catch {
    return null;
  }
}

function applyArtStationMode(mode) {
  if (!mode) return;
  artstationMode = mode;
  if (mode === 'login') setArtStationStatus(ARTSTATION_LOGIN_TEXT);
  else setArtStationStatus(ARTSTATION_READY_TEXT, 'ok');
}

function artstationAvailable() {
  return !!(window.tailref && window.tailref.isDesktop && window.tailref.artstationConfig);
}

/* Panel şu anda ayrı pencerede mi? Konuk sayfa orada yaşıyorsa mesajlar
   oraya yönlendirilir; ana penceredeki gizli webview'e değil. */
function artstationDetached() {
  return !!(artstationPanel && artstationPanel.dataset.detached === '1');
}

function artstationSendGuest(channel, args) {
  if (!artstationPanel || !window.tailref || !window.tailref.sendPanelGuestMessage) return false;
  try {
    window.tailref.sendPanelGuestMessage(artstationPanel.id, channel, args || []);
    return true;
  } catch {
    return false;
  }
}

/* Konuk sayfadaki seçim düğmesinin etiketleri: uygulamadaki güncel dile
   göre üretilip preload'a yollanır (bağlı → webview.send, ayrı pencere →
   panel köprüsü). L10N.onChange ile dil değişiminde de yenilenir. */
function artstationGuestLabels() {
  return {
    idle: '＋ ' + __t('Add to board'),
    busy: '… ' + __t('Adding'),
    ok: '✓ ' + __t('Added'),
    err: '✕ ' + __t('Could not add'),
    aria: __t('Add the selected ArtStation image to the board'),
  };
}

function artstationPushLabels() {
  const labels = artstationGuestLabels();
  if (artstationDetached()) {
    artstationSendGuest('artstation-labels', [labels]);
    return;
  }
  if (artstationView) {
    try { artstationView.send('artstation-labels', labels); } catch { /* hazır değil */ }
  }
}

/* ---------- diske kaydetme ---------- */

const ARTSTATION_SAVE_KEY = 'tailref-artstation-save-disk';
let artstationSavedCount = 0;

function artstationSaveEnabled() {
  return !!(artstationSaveDiskEl && artstationSaveDiskEl.checked);
}

function artstationFetchOptions() {
  return artstationSaveEnabled() ? { save: true } : undefined;
}

/* Tek görsel/batch sonucu için kısa durum eki. */
function artstationSaveSuffix(saved, saveError) {
  if (saveError) return ' · disk copy failed';
  return saved ? __t(' · saved to disk') : '';
}

async function artstationConfig() {
  if (artstationConfigCache) return artstationConfigCache;
  if (!artstationAvailable()) return null;
  try {
    artstationConfigCache = await window.tailref.artstationConfig();
    return artstationConfigCache;
  } catch (error) {
    console.warn('ArtStation configuration could not be fetched', error);
    return null;
  }
}

/* Webview'i yalnızca panel ilk kez açıldığında yükle: uygulama açılışında
   gereksiz ağ trafiği olmasın. */
async function ensureArtStationView() {
  if (!artstationView || artstationLoaded) return;
  if (!artstationAvailable()) {
    setArtStationStatus('ArtStation only opens in the desktop app.', 'err');
    return;
  }
  const config = await artstationConfig();
  if (!config || !config.startUrl) {
    setArtStationStatus('ArtStation could not start.', 'err');
    return;
  }
  artstationLoaded = true;
  artstationMode = config.mode || 'feed';
  artstationView.setAttribute('partition', 'persist:artstation');
  if (config.preloadUrl) artstationView.setAttribute('preload', config.preloadUrl);
  if (config.userAgent) artstationView.setAttribute('useragent', config.userAgent);
  artstationView.setAttribute('src', config.startUrl);
  setArtStationStatus(artstationMode === 'login' ? ARTSTATION_LOGIN_TEXT : 'ArtStation is loading…',
    artstationMode === 'login' ? undefined : 'busy');
}

/* ---------- görseli tahtaya ekleme ---------- */

function artstationDropPoint() {
  const step = artstationDropIndex % 6;
  artstationDropIndex += 1;
  return screenToWorld({
    x: stage.clientWidth / 2 + ((step % 3) - 1) * 46,
    y: stage.clientHeight / 2 + (Math.floor(step / 3) - 0.5) * 46,
  });
}

async function addArtStationImage(payload) {
  if (!payload || !payload.buffer) return false;
  const bytes = payload.buffer instanceof Uint8Array ? payload.buffer : new Uint8Array(payload.buffer);
  const mime = payload.mime || 'image/png';
  const name = payload.name || `artstation-${Date.now()}.png`;
  const file = new File([bytes], name, { type: mime });
  const before = state.items.length;
  await addFiles([file], artstationDropPoint());
  return state.items.length > before;
}

function artstationReply(ok, error) {
  const result = { ok: !!ok, error: error || '' };
  if (artstationDetached()) {
    artstationSendGuest('artstation-pick-result', [result]);
    return;
  }
  if (!artstationView) return;
  try {
    artstationView.send('artstation-pick-result', result);
  } catch { /* konuk sayfa kapanmış olabilir */ }
}

async function handleArtStationPick(payload) {
  const url = payload && payload.url;
  if (!url) return;
  setArtStationStatus('Fetching image…', 'busy');
  const result = await window.tailref.artstationFetch(url, artstationFetchOptions());
  if (!result || !result.ok) {
    const message = (result && result.error) || 'Image could not be fetched';
    artstationReply(false, message);
    setArtStationStatus(message, 'err');
    return;
  }
  try {
    const added = await addArtStationImage(result);
    if (!added) throw new Error('Image could not open');
    artstationAddedCount += 1;
    artstationSeen.add(url);
    if (result.savedPath) artstationSavedCount += 1;
    artstationReply(true);
    setArtStationStatus(`${artstationAddedCount} ` + __t('images added to the board') + `${artstationSaveSuffix(!!result.savedPath, result.saveError)}`, 'ok');
  } catch (error) {
    artstationReply(false, error.message);
    setArtStationStatus(error.message || 'Image could not be added', 'err');
  }
}

async function addArtStationFromUrl() {
  if (!artstationAvailable()) {
    setArtStationStatus('ArtStation only opens in the desktop app.', 'err');
    return;
  }
  const url = (artstationUrlEl.value || '').trim();
  if (!url) { artstationUrlEl.focus(); return; }
  setArtStationStatus('Fetching image…', 'busy');
  const result = await window.tailref.artstationFetch(url, artstationFetchOptions());
  if (!result || !result.ok) {
    setArtStationStatus((result && result.error) || 'Image could not be fetched', 'err');
    return;
  }
  try {
    const added = await addArtStationImage(result);
    if (!added) throw new Error('Image could not open');
    artstationAddedCount += 1;
    artstationSeen.add(url);
    if (result.savedPath) artstationSavedCount += 1;
    artstationUrlEl.value = '';
    setArtStationStatus(`${artstationAddedCount} ` + __t('images added to the board') + `${artstationSaveSuffix(!!result.savedPath, result.saveError)}`, 'ok');
  } catch (error) {
    setArtStationStatus(error.message || 'Image could not be added', 'err');
  }
}

/* ---------- görünenleri ekle ---------- */

function finishArtStationBatch(text, tone) {
  if (artstationBatchTimer) { clearTimeout(artstationBatchTimer); artstationBatchTimer = 0; }
  artstationBatchBusy = false;
  if (artstationAddVisibleEl) artstationAddVisibleEl.disabled = false;
  if (text) setArtStationStatus(text, tone);
}

/* Konuk sayfadan yalnızca o an görünen görselleri ister. Cevap
   `artstation-collected` mesajıyla gelir; gelmezse kilit açılır. */
function addVisibleArtworks() {
  if (artstationBatchBusy) return;
  if (!artstationDetached() && (!artstationView || !artstationLoaded)) {
    setArtStationStatus('Open the ArtStation page first.', 'err');
    return;
  }
  artstationBatchBusy = true;
  if (artstationAddVisibleEl) artstationAddVisibleEl.disabled = true;
  setArtStationStatus('Scanning visible images…', 'busy');
  if (artstationDetached()) {
    if (!artstationSendGuest('artstation-collect', [])) {
      finishArtStationBatch('ArtStation page could not be reached.', 'err');
      return;
    }
  } else {
    try {
      artstationView.send('artstation-collect');
    } catch {
      finishArtStationBatch('ArtStation page could not be reached.', 'err');
      return;
    }
  }
  artstationBatchTimer = setTimeout(() => {
    if (artstationBatchBusy) finishArtStationBatch('ArtStation did not respond.', 'err');
  }, 6000);
}

async function handleCollectedArtworks(payload) {
  if (!artstationBatchBusy) return;
  if (artstationBatchTimer) { clearTimeout(artstationBatchTimer); artstationBatchTimer = 0; }

  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  const fresh = items.filter(item => item && item.url && !artstationSeen.has(item.url));
  if (!fresh.length) {
    finishArtStationBatch(items.length
      ? 'No new images — the visible ones are already on the board.'
      : 'No visible image found.', items.length ? 'ok' : 'err');
    return;
  }

  let added = 0;
  let failed = 0;
  let saved = 0;
  let saveFailed = 0;
  for (let i = 0; i < fresh.length; i++) {
    setArtStationStatus(__t('{n} adding…', { n: `${i + 1}/${fresh.length}` }), 'busy');
    let result = null;
    try {
      result = await window.tailref.artstationFetch(fresh[i].url, artstationFetchOptions());
    } catch { result = null; }
    if (!result || !result.ok) { failed += 1; continue; }
    if (result.savedPath) saved += 1;
    else if (result.saveError) saveFailed += 1;
    try {
      if (await addArtStationImage(result)) {
        added += 1;
        artstationSeen.add(fresh[i].url);
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  artstationAddedCount += added;
  artstationSavedCount += saved;
  if (!added) {
    finishArtStationBatch('Images could not be added.', 'err');
    return;
  }
  const parts = [`${added} ` + __t('images added to the board')];
  if (saved) parts.push(`${saved} ` + __t('files saved'));
  if (failed) parts.push(`${failed} skipped`);
  if (saveFailed) parts.push(`${saveFailed} disk copies failed`);
  finishArtStationBatch(parts.join(' · '), 'ok');
}

/* ---------- oturum ---------- */

async function resetArtStationSession() {
  if (!artstationAvailable()) return;
  if (!window.confirm('Sign out of the ArtStation session from this app?\n\nLogin data is cleared; you will need to sign in again.')) return;
  const config = await artstationConfig();
  const loginUrl = (config && config.loginUrl) || 'https://www.artstation.com/users/sign_in';
  const result = await window.tailref.artstationClear();
  if (result && result.ok) {
    artstationConfigCache = null;
    artstationMode = 'login';
    setArtStationStatus('Session cleared — you can sign in again.');
    if (artstationDetached()) {
      artstationSendGuest('__view-load-url', [loginUrl]);
    } else {
      try { artstationView.loadURL(loginUrl); } catch { /* henüz yüklenmemiş */ }
    }
  } else {
    setArtStationStatus((result && result.error) || 'Could not clear session', 'err');
  }
}

/* ---------- panel bağlantıları ---------- */

if (artstationPanel) {
  $('#btnArtStation').onclick = () => {
    const opened = openStudioPanel(artstationPanel);
    if (opened) ensureArtStationView();
    else if (artstationAddedCount) setArtStationStatus(`${artstationAddedCount} ` + __t('images added to the board'), 'ok');
    else if (artstationMode === 'login') setArtStationStatus(ARTSTATION_LOGIN_TEXT);
    else setArtStationStatus(ARTSTATION_READY_TEXT, 'ok');
  };
  $('#btnArtStationClose').onclick = () => closeStudioPanel(artstationPanel);
  const artstationFullscreenBtn = $('#btnArtStationFullscreen');
  if (artstationFullscreenBtn) {
    artstationFullscreenBtn.onclick = () => toggleBrowserPanelFullscreen(artstationPanel);
  }
  /* GERİ / İLERİ — webview tarihi (kullanıcı isteği). Ayrı penceredeki
     konuk webview için konuk mesaj kanalı kullanılır. */
  const artstationBackBtn = $('#btnArtStationBack');
  const artstationForwardBtn = $('#btnArtStationForward');
  function artstationSyncNavButtons() {
    let back = false, fwd = false;
    try {
      if (artstationDetached()) return; // konuk pencere kendi durumunu taşır
      if (artstationView && artstationView.src) {
        back = !!artstationView.canGoBack();
        fwd = !!artstationView.canGoForward();
      }
    } catch { /* webview henüz hazır değil */ }
    if (artstationBackBtn) artstationBackBtn.disabled = !back;
    if (artstationForwardBtn) artstationForwardBtn.disabled = !fwd;
  }
  function artstationGo(side) {
    if (artstationDetached()) {
      if (artstationSendGuest(side === 'back' ? '__view-back' : '__view-forward', [])) return;
    }
    if (!artstationView || !artstationLoaded) return;
    try { (side === 'back' ? artstationView.goBack() : artstationView.goForward()); } catch { /* sessiz */ }
    setTimeout(artstationSyncNavButtons, 350);
  }
  if (artstationBackBtn) artstationBackBtn.onclick = () => artstationGo('back');
  if (artstationForwardBtn) artstationForwardBtn.onclick = () => artstationGo('forward');
  window.__artstationSyncNav = artstationSyncNavButtons;
  $('#btnArtStationReload').onclick = () => {
    if (artstationDetached()) {
      if (artstationSendGuest('__view-reload', [])) return;
    }
    if (!artstationView || !artstationLoaded) { ensureArtStationView(); return; }
    try { artstationView.reload(); } catch { /* sessiz */ }
  };
  artstationAddUrlEl.onclick = () => addArtStationFromUrl();
  if (artstationAddVisibleEl) artstationAddVisibleEl.onclick = () => addVisibleArtworks();

  if (artstationSaveDiskEl) {
    try { artstationSaveDiskEl.checked = localStorage.getItem(ARTSTATION_SAVE_KEY) === '1'; } catch { /* sessiz */ }
    artstationSaveDiskEl.addEventListener('change', () => {
      try { localStorage.setItem(ARTSTATION_SAVE_KEY, artstationSaveDiskEl.checked ? '1' : '0'); } catch { /* sessiz */ }
      if (artstationSaveEnabled()) {
        setArtStationStatus('Added images will also be saved to disk.', 'ok');
      } else if (!artstationBatchBusy) {
        setArtStationStatus(ARTSTATION_READY_TEXT, 'ok');
      }
    });
  }
  if (artstationOpenFolderEl) {
    artstationOpenFolderEl.onclick = async () => {
      if (!window.tailref.artstationOpenFolder) return;
      const result = await window.tailref.artstationOpenFolder();
      if (result && !result.ok) setArtStationStatus((result && result.error) || 'Folder could not open', 'err');
    };
  }
  artstationUrlEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addArtStationFromUrl(); }
  });
  artstationResetEl.onclick = () => resetArtStationSession();

  if (artstationView) {
    artstationView.addEventListener('dom-ready', () => {
      applyArtStationMode(artstationModeForUrl(artstationView.getURL()) || 'feed');
      artstationSyncNavButtons();
      artstationPushLabels();
    });
    artstationView.addEventListener('did-navigate', artstationSyncNavButtons);
    artstationView.addEventListener('did-navigate-in-page', artstationSyncNavButtons);
    artstationView.addEventListener('did-fail-load', event => {
      if (event.errorCode === -3) return; // kullanıcı iptal etti
      setArtStationStatus(`ArtStation failed to load (${event.errorDescription || event.errorCode})`, 'err');
    });
    artstationView.addEventListener('ipc-message', event => {
      if (event.channel === 'artstation-pick') handleArtStationPick(event.args[0]);
      else if (event.channel === 'artstation-collected') handleCollectedArtworks(event.args[0]);
      else if (event.channel === 'artstation-labels-request') artstationPushLabels();
    });
  }

  /* Ayrı penceredeki konuk sayfadan gelen mesajlar ana uygulamaya burada
     ulaşır: seçilen görsel indirilir, "görünenleri ekle" yanıtı işlenir. */
  if (window.tailref && window.tailref.onPanelGuestMessage) {
    window.tailref.onPanelGuestMessage(data => {
      if (!data || data.panelId !== 'artstationPanel') return;
      const args = Array.isArray(data.args) ? data.args : [];
      if (data.channel === 'artstation-pick') handleArtStationPick(args[0]);
      else if (data.channel === 'artstation-collected') handleCollectedArtworks(args[0]);
      else if (data.channel === '__guest-url') artstationDetachedUrl = String(args[0] || '');
      else if (data.channel === 'artstation-labels-request') artstationPushLabels();
    });
  }

  /* Dil değişiminde konuk düğme etiketlerini güncelle. */
  if (window.L10N && window.L10N.onChange) {
    window.L10N.onChange(() => { try { artstationPushLabels(); } catch { /* sessiz */ } });
  }

  /* Panel geri takılınca ya da × ile kapatılınca ana penceredeki webview,
     ayrı pencerede kalınan sayfadan devam eder. */
  if (window.tailref && window.tailref.onPanelWindowClosed) {
    window.tailref.onPanelWindowClosed(data => {
      if (!data || data.id !== 'artstationPanel') return;
      const url = artstationDetachedUrl;
      artstationDetachedUrl = '';
      if (!url || !artstationView || !artstationLoaded) return;
      let current = '';
      try { current = artstationView.getURL() || ''; } catch { current = ''; }
      if (current === url) return;
      setTimeout(() => {
        try {
          artstationView.loadURL(url);
          applyArtStationMode(artstationModeForUrl(url) || 'feed');
        } catch { /* webview hazır değil */ }
      }, 60);
    });
  }

  if (!artstationAvailable()) {
    setArtStationStatus('ArtStation only opens in the desktop app.', 'err');
  }
}
