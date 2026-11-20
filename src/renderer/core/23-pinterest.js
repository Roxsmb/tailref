/* TailRef app · Pinterest paneli (uygulama içi tarayıcı) */
'use strict';

/* Pinterest, ayrı bir pencere yerine panelin içindeki <webview> ile açılır.
   Konuk sayfaya pinterest-preload.js enjekte edilir; oradaki "Tahtaya ekle"
   düğmesi görsel adresini buraya yollar. Baytlar ana süreçte indirilir
   (CORS yok), ardından mevcut addFiles() akışıyla tahtaya eklenir. */

const pinterestPanel    = $('#pinterestPanel');
const pinterestView     = $('#pinterestView');
const pinterestStatusEl = $('#pinterestStatus');
const pinterestUrlEl    = $('#pinterestUrl');
const pinterestAddUrlEl = $('#pinterestAddUrl');
const pinterestAddVisibleEl = $('#pinterestAddVisible');
const pinterestSaveDiskEl = $('#pinterestSaveDisk');
const pinterestOpenFolderEl = $('#pinterestOpenFolder');
const pinterestResetEl  = $('#pinterestReset');

let pinterestConfigCache = null;
let pinterestLoaded = false;
let pinterestAddedCount = 0;
let pinterestDropIndex = 0;
let pinterestMode = 'feed';
let pinterestBatchBusy = false;
let pinterestBatchTimer = 0;
/* Ayrı penceredeki konuk sayfanın son adresi: panel geri takılınca ana
   penceredeki webview aynı sayfada devam eder. */
let pinterestDetachedUrl = '';
/* Bu oturumda tahtaya eklenen görsel adresleri: "Add visible ones" aynı
   görseli ikinci kez eklemesin. */
const pinterestSeen = new Set();

function setPinterestStatus(text, tone) {
  if (!pinterestStatusEl) return;
  pinterestStatusEl.textContent = text;
  if (tone) pinterestStatusEl.dataset.tone = tone;
  else delete pinterestStatusEl.dataset.tone;
}

const PINTEREST_READY_TEXT = 'Ready — hover over an image, add it to the board with ＋.';
const PINTEREST_LOGIN_TEXT = 'Sign in to Pinterest once — the Google/Facebook button opens in a separate secure window; the session stays in this app.';

/* Konuk sayfanın adresi giriş durumunu doğrudan söyler: Pinterest giriş
   yapmamış kullanıcıyı /login veya /signup sayfasında tutar, giriş yapınca
   akışa döndürür. Ekstra ağ isteği gerekmez. */
function pinterestModeForUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)pinterest\.[a-z.]+$/i.test(url.hostname)) return null;
    return /^\/(login|signup)(\/|$)/i.test(url.pathname) ? 'login' : 'feed';
  } catch {
    return null;
  }
}

function applyPinterestMode(mode) {
  if (!mode) return;
  pinterestMode = mode;
  if (mode === 'login') setPinterestStatus(PINTEREST_LOGIN_TEXT);
  else setPinterestStatus(PINTEREST_READY_TEXT, 'ok');
}

function pinterestAvailable() {
  return !!(window.tailref && window.tailref.isDesktop && window.tailref.pinterestConfig);
}

/* Panel şu anda ayrı pencerede mi? Konuk sayfa orada yaşıyorsa mesajlar
   oraya yönlendirilir; ana penceredeki gizli webview'e değil. */
function pinterestDetached() {
  return !!(pinterestPanel && pinterestPanel.dataset.detached === '1');
}

function pinterestSendGuest(channel, args) {
  if (!pinterestPanel || !window.tailref || !window.tailref.sendPanelGuestMessage) return false;
  try {
    window.tailref.sendPanelGuestMessage(pinterestPanel.id, channel, args || []);
    return true;
  } catch {
    return false;
  }
}

/* Konuk sayfadaki seçim düğmesinin etiketleri: uygulamadaki güncel dile
   göre üretilip preload'a yollanır (bağlı → webview.send, ayrı pencere →
   panel köprüsü). L10N.onChange ile dil değişiminde de yenilenir. */
function pinterestGuestLabels() {
  return {
    idle: '＋ ' + __t('Add to board'),
    busy: '… ' + __t('Adding'),
    ok: '✓ ' + __t('Added'),
    err: '✕ ' + __t('Could not add'),
    aria: __t('Add the selected Pinterest image to the board'),
  };
}

function pinterestPushLabels() {
  const labels = pinterestGuestLabels();
  if (pinterestDetached()) {
    pinterestSendGuest('pinterest-labels', [labels]);
    return;
  }
  if (pinterestView) {
    try { pinterestView.send('pinterest-labels', labels); } catch { /* hazır değil */ }
  }
}

/* ---------- diske kaydetme ---------- */

const PINTEREST_SAVE_KEY = 'tailref-pinterest-save-disk';
let pinterestSavedCount = 0;

function pinterestSaveEnabled() {
  return !!(pinterestSaveDiskEl && pinterestSaveDiskEl.checked);
}

function pinterestFetchOptions() {
  return pinterestSaveEnabled() ? { save: true } : undefined;
}

/* Tek görsel/batch sonucu için kısa durum eki. */
function pinterestSaveSuffix(saved, saveError) {
  if (saveError) return ' · disk copy failed';
  return saved ? __t(' · saved to disk') : '';
}

async function pinterestConfig() {
  if (pinterestConfigCache) return pinterestConfigCache;
  if (!pinterestAvailable()) return null;
  try {
    pinterestConfigCache = await window.tailref.pinterestConfig();
    return pinterestConfigCache;
  } catch (error) {
    console.warn('Pinterest configuration could not be fetched', error);
    return null;
  }
}

/* Webview'i yalnızca panel ilk kez açıldığında yükle: uygulama açılışında
   gereksiz ağ trafiği olmasın. */
async function ensurePinterestView() {
  if (!pinterestView || pinterestLoaded) return;
  if (!pinterestAvailable()) {
    setPinterestStatus('Pinterest only opens in the desktop app.', 'err');
    return;
  }
  const config = await pinterestConfig();
  if (!config || !config.startUrl) {
    setPinterestStatus('Pinterest could not start.', 'err');
    return;
  }
  pinterestLoaded = true;
  pinterestMode = config.mode || 'feed';
  pinterestView.setAttribute('partition', 'persist:pinterest');
  if (config.preloadUrl) pinterestView.setAttribute('preload', config.preloadUrl);
  if (config.userAgent) pinterestView.setAttribute('useragent', config.userAgent);
  pinterestView.setAttribute('src', config.startUrl);
  setPinterestStatus(pinterestMode === 'login' ? PINTEREST_LOGIN_TEXT : 'Pinterest is loading…',
    pinterestMode === 'login' ? undefined : 'busy');
}

/* ---------- görseli tahtaya ekleme ---------- */

function pinterestDropPoint() {
  const step = pinterestDropIndex % 6;
  pinterestDropIndex += 1;
  return screenToWorld({
    x: stage.clientWidth / 2 + ((step % 3) - 1) * 46,
    y: stage.clientHeight / 2 + (Math.floor(step / 3) - 0.5) * 46,
  });
}

async function addPinterestImage(payload) {
  if (!payload || !payload.buffer) return false;
  const bytes = payload.buffer instanceof Uint8Array ? payload.buffer : new Uint8Array(payload.buffer);
  const mime = payload.mime || 'image/png';
  const name = payload.name || `pinterest-${Date.now()}.png`;
  const file = new File([bytes], name, { type: mime });
  const before = state.items.length;
  await addFiles([file], pinterestDropPoint());
  return state.items.length > before;
}

function pinterestReply(ok, error) {
  const result = { ok: !!ok, error: error || '' };
  if (pinterestDetached()) {
    pinterestSendGuest('pinterest-pick-result', [result]);
    return;
  }
  if (!pinterestView) return;
  try {
    pinterestView.send('pinterest-pick-result', result);
  } catch { /* konuk sayfa kapanmış olabilir */ }
}

async function handlePinterestPick(payload) {
  const url = payload && payload.url;
  if (!url) return;
  setPinterestStatus('Fetching image…', 'busy');
  const result = await window.tailref.pinterestFetch(url, pinterestFetchOptions());
  if (!result || !result.ok) {
    const message = (result && result.error) || 'Image could not be fetched';
    pinterestReply(false, message);
    setPinterestStatus(message, 'err');
    return;
  }
  try {
    const added = await addPinterestImage(result);
    if (!added) throw new Error('Image could not open');
    pinterestAddedCount += 1;
    pinterestSeen.add(url);
    if (result.savedPath) pinterestSavedCount += 1;
    pinterestReply(true);
    setPinterestStatus(`${pinterestAddedCount} ` + __t('images added to the board') + `${pinterestSaveSuffix(!!result.savedPath, result.saveError)}`, 'ok');
  } catch (error) {
    pinterestReply(false, error.message);
    setPinterestStatus(error.message || 'Image could not be added', 'err');
  }
}

async function addPinterestFromUrl() {
  if (!pinterestAvailable()) {
    setPinterestStatus('Pinterest only opens in the desktop app.', 'err');
    return;
  }
  const url = (pinterestUrlEl.value || '').trim();
  if (!url) { pinterestUrlEl.focus(); return; }
  setPinterestStatus('Fetching image…', 'busy');
  const result = await window.tailref.pinterestFetch(url, pinterestFetchOptions());
  if (!result || !result.ok) {
    setPinterestStatus((result && result.error) || 'Image could not be fetched', 'err');
    return;
  }
  try {
    const added = await addPinterestImage(result);
    if (!added) throw new Error('Image could not open');
    pinterestAddedCount += 1;
    pinterestSeen.add(url);
    if (result.savedPath) pinterestSavedCount += 1;
    pinterestUrlEl.value = '';
    setPinterestStatus(`${pinterestAddedCount} ` + __t('images added to the board') + `${pinterestSaveSuffix(!!result.savedPath, result.saveError)}`, 'ok');
  } catch (error) {
    setPinterestStatus(error.message || 'Image could not be added', 'err');
  }
}

/* ---------- görünenleri ekle ---------- */

function finishPinterestBatch(text, tone) {
  if (pinterestBatchTimer) { clearTimeout(pinterestBatchTimer); pinterestBatchTimer = 0; }
  pinterestBatchBusy = false;
  if (pinterestAddVisibleEl) pinterestAddVisibleEl.disabled = false;
  if (text) setPinterestStatus(text, tone);
}

/* Konuk sayfadan yalnızca o an görünen görselleri ister. Cevap
   `pinterest-collected` mesajıyla gelir; gelmezse kilit açılır. */
function addVisiblePins() {
  if (pinterestBatchBusy) return;
  if (!pinterestDetached() && (!pinterestView || !pinterestLoaded)) {
    setPinterestStatus('Open the Pinterest page first.', 'err');
    return;
  }
  pinterestBatchBusy = true;
  if (pinterestAddVisibleEl) pinterestAddVisibleEl.disabled = true;
  setPinterestStatus('Scanning visible images…', 'busy');
  if (pinterestDetached()) {
    if (!pinterestSendGuest('pinterest-collect', [])) {
      finishPinterestBatch('Pinterest page could not be reached.', 'err');
      return;
    }
  } else {
    try {
      pinterestView.send('pinterest-collect');
    } catch {
      finishPinterestBatch('Pinterest page could not be reached.', 'err');
      return;
    }
  }
  pinterestBatchTimer = setTimeout(() => {
    if (pinterestBatchBusy) finishPinterestBatch('Pinterest did not respond.', 'err');
  }, 6000);
}

async function handleCollectedPins(payload) {
  if (!pinterestBatchBusy) return;
  if (pinterestBatchTimer) { clearTimeout(pinterestBatchTimer); pinterestBatchTimer = 0; }

  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  const fresh = items.filter(item => item && item.url && !pinterestSeen.has(item.url));
  if (!fresh.length) {
    finishPinterestBatch(items.length
      ? 'No new images — the visible ones are already on the board.'
      : 'No visible image found.', items.length ? 'ok' : 'err');
    return;
  }

  let added = 0;
  let failed = 0;
  let saved = 0;
  let saveFailed = 0;
  for (let i = 0; i < fresh.length; i++) {
    setPinterestStatus(__t('{n} adding…', { n: `${i + 1}/${fresh.length}` }), 'busy');
    let result = null;
    try {
      result = await window.tailref.pinterestFetch(fresh[i].url, pinterestFetchOptions());
    } catch { result = null; }
    if (!result || !result.ok) { failed += 1; continue; }
    if (result.savedPath) saved += 1;
    else if (result.saveError) saveFailed += 1;
    try {
      if (await addPinterestImage(result)) {
        added += 1;
        pinterestSeen.add(fresh[i].url);
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  pinterestAddedCount += added;
  pinterestSavedCount += saved;
  if (!added) {
    finishPinterestBatch('Images could not be added.', 'err');
    return;
  }
  const parts = [`${added} ` + __t('images added to the board')];
  if (saved) parts.push(`${saved} ` + __t('files saved'));
  if (failed) parts.push(`${failed} skipped`);
  if (saveFailed) parts.push(`${saveFailed} disk copies failed`);
  finishPinterestBatch(parts.join(' · '), 'ok');
}

/* ---------- oturum ---------- */

async function resetPinterestSession() {
  if (!pinterestAvailable()) return;
  if (!window.confirm('Sign out of the Pinterest session from this app?\n\nLogin data is cleared; you will need to sign in again.')) return;
  const result = await window.tailref.pinterestClear();
  if (result && result.ok) {
    pinterestConfigCache = null;
    pinterestMode = 'login';
    setPinterestStatus('Session cleared — you can sign in again.');
    if (pinterestDetached()) {
      pinterestSendGuest('__view-load-url', ['https://www.pinterest.com/login/']);
    } else {
      try { pinterestView.loadURL('https://www.pinterest.com/login/'); } catch { /* henüz yüklenmemiş */ }
    }
  } else {
    setPinterestStatus((result && result.error) || 'Could not clear session', 'err');
  }
}

/* ---------- panel bağlantıları ---------- */

if (pinterestPanel) {
  $('#btnPinterest').onclick = () => {
    const opened = openStudioPanel(pinterestPanel);
    if (opened) ensurePinterestView();
    else if (pinterestAddedCount) setPinterestStatus(`${pinterestAddedCount} ` + __t('images added to the board'), 'ok');
    else if (pinterestMode === 'login') setPinterestStatus(PINTEREST_LOGIN_TEXT);
    else setPinterestStatus(PINTEREST_READY_TEXT, 'ok');
  };
  $('#btnPinterestClose').onclick = () => closeStudioPanel(pinterestPanel);
  const pinterestFullscreenBtn = $('#btnPinterestFullscreen');
  if (pinterestFullscreenBtn) {
    pinterestFullscreenBtn.onclick = () => toggleBrowserPanelFullscreen(pinterestPanel);
  }
  $('#btnPinterestReload').onclick = () => {
    if (pinterestDetached()) {
      if (pinterestSendGuest('__view-reload', [])) return;
    }
    if (!pinterestView || !pinterestLoaded) { ensurePinterestView(); return; }
    try { pinterestView.reload(); } catch { /* sessiz */ }
  };
  pinterestAddUrlEl.onclick = () => addPinterestFromUrl();
  if (pinterestAddVisibleEl) pinterestAddVisibleEl.onclick = () => addVisiblePins();

  if (pinterestSaveDiskEl) {
    try { pinterestSaveDiskEl.checked = localStorage.getItem(PINTEREST_SAVE_KEY) === '1'; } catch { /* sessiz */ }
    pinterestSaveDiskEl.addEventListener('change', () => {
      try { localStorage.setItem(PINTEREST_SAVE_KEY, pinterestSaveDiskEl.checked ? '1' : '0'); } catch { /* sessiz */ }
      if (pinterestSaveEnabled()) {
        setPinterestStatus('Added images will also be saved to disk.', 'ok');
      } else if (!pinterestBatchBusy) {
        setPinterestStatus(PINTEREST_READY_TEXT, 'ok');
      }
    });
  }
  if (pinterestOpenFolderEl) {
    pinterestOpenFolderEl.onclick = async () => {
      if (!window.tailref.pinterestOpenFolder) return;
      const result = await window.tailref.pinterestOpenFolder();
      if (result && !result.ok) setPinterestStatus((result && result.error) || 'Folder could not open', 'err');
    };
  }
  pinterestUrlEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addPinterestFromUrl(); }
  });
  pinterestResetEl.onclick = () => resetPinterestSession();

  if (pinterestView) {
    pinterestView.addEventListener('dom-ready', () => {
      applyPinterestMode(pinterestModeForUrl(pinterestView.getURL()) || 'feed');
      pinterestPushLabels();
    });
    pinterestView.addEventListener('did-fail-load', event => {
      if (event.errorCode === -3) return; // kullanıcı iptal etti
      setPinterestStatus(`Pinterest failed to load (${event.errorDescription || event.errorCode})`, 'err');
    });
    pinterestView.addEventListener('ipc-message', event => {
      if (event.channel === 'pinterest-pick') handlePinterestPick(event.args[0]);
      else if (event.channel === 'pinterest-collected') handleCollectedPins(event.args[0]);
      else if (event.channel === 'pinterest-labels-request') pinterestPushLabels();
    });
  }

  /* Ayrı penceredeki konuk sayfadan gelen mesajlar ana uygulamaya burada
     ulaşır: seçilen görsel indirilir, "görünenleri ekle" yanıtı işlenir. */
  if (window.tailref && window.tailref.onPanelGuestMessage) {
    window.tailref.onPanelGuestMessage(data => {
      if (!data || data.panelId !== 'pinterestPanel') return;
      const args = Array.isArray(data.args) ? data.args : [];
      if (data.channel === 'pinterest-pick') handlePinterestPick(args[0]);
      else if (data.channel === 'pinterest-collected') handleCollectedPins(args[0]);
      else if (data.channel === '__guest-url') pinterestDetachedUrl = String(args[0] || '');
      else if (data.channel === 'pinterest-labels-request') pinterestPushLabels();
    });
  }

  /* Dil değişiminde konuk düğme etiketlerini güncelle. */
  if (window.L10N && window.L10N.onChange) {
    window.L10N.onChange(() => { try { pinterestPushLabels(); } catch { /* sessiz */ } });
  }

  /* Panel geri takılınca ya da × ile kapatılınca ana penceredeki webview,
     ayrı pencerede kalınan sayfadan devam eder. */
  if (window.tailref && window.tailref.onPanelWindowClosed) {
    window.tailref.onPanelWindowClosed(data => {
      if (!data || data.id !== 'pinterestPanel') return;
      const url = pinterestDetachedUrl;
      pinterestDetachedUrl = '';
      if (!url || !pinterestView || !pinterestLoaded) return;
      let current = '';
      try { current = pinterestView.getURL() || ''; } catch { current = ''; }
      if (current === url) return;
      setTimeout(() => {
        try {
          pinterestView.loadURL(url);
          applyPinterestMode(pinterestModeForUrl(url) || 'feed');
        } catch { /* webview hazır değil */ }
      }, 60);
    });
  }

  if (!pinterestAvailable()) {
    setPinterestStatus('Pinterest only opens in the desktop app.', 'err');
  }
}
