/* TailRef app · bar toggle, fatal error, init, GC, close save */
'use strict';

/* H: elle gizle / göster (fare üst bölgeye gelince yine açılır) */
function toggleBarManually() {
  const shouldHide = !barIsHidden() && !barFading();
  setBarHidden(shouldHide);
  barManualHide = shouldHide;
}

/* masaüstü (Electron) ise "her zaman üstte" düğmesi */
const isDesktop = !!(window.tailref && window.tailref.isDesktop);
let toggleTop = null;
let paintTopState = null;

if (isDesktop) {
  document.documentElement.classList.add('desktop');

  const btnTop = $('#btnTop');
  btnTop.hidden = false;
  const paintTop = on => {
    btnTop.setAttribute('aria-pressed', on ? 'true' : 'false');
    setButtonLabel(btnTop, on ? 'On Top ✓' : 'On Top');
    queueToolbarLayout();
  };
  paintTopState = paintTop;
  toggleTop = async () => paintTop(await window.tailref.toggleAlwaysOnTop());
  btnTop.onclick = () => toggleTop();
  window.tailref.isAlwaysOnTop().then(paintTop).catch(() => {});

  // pencere düğmeleri — Windows gibi üç denetim: küçült, tam ekran, kapat.
  // Ortadaki düğme F11 ile aynı işi yapar: tam ekrana geçer / çıkar.
  const btnMin = $('#btnMin'), btnMax = $('#btnMax'), btnClose = $('#btnClose');
  $('#sepWin').hidden = false;
  btnMin.hidden = false; btnMax.hidden = false; btnClose.hidden = false;

  /* Çizim modunda ana araç çubuğu gizlendiği için aynı denetimler
     #appModeBar içinde de bulunur. */
  const drawMin = $('#btnDrawMin'), drawMax = $('#btnDrawMax'), drawClose = $('#btnDrawClose');
  if (drawMin) drawMin.hidden = false;
  if (drawMax) drawMax.hidden = false;
  if (drawClose) drawClose.hidden = false;

  const paintFullscreenState = full => {
    for (const button of [btnMax, drawMax]) {
      if (!button) continue;
      const use = button.querySelector('.toolIcon use');
      if (use) use.setAttribute('href', full ? '#icon-restore' : '#icon-square');
      button.title = full ? __t('Exit fullscreen') : __t('Full screen');
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', full ? 'true' : 'false');
    }
  };
  /* Dil değişince pencere tam ekran düğmesinin başlığı tazelensin. */
  if (window.L10N && window.L10N.onChange) {
    window.L10N.onChange(() => {
      try {
        if (window.tailref && window.tailref.isFullscreen) {
          window.tailref.isFullscreen().then(f => paintFullscreenState(!!f)).catch(() => {});
        }
      } catch { /* sessiz */ }
    });
  }
  /* Sayfa düzeyinde tam ekran (3D modu vb.) pencere denetiminin önünde
     bırakılır; aksi halde □ tuşu "hiçbir şey yapmıyor" görünür. */
  const exitPageFullscreen = () => {
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => { });
    return Promise.resolve();
  };
  const syncFullscreenState = () => {
    if (!window.tailref || !window.tailref.isFullscreen) return;
    window.tailref.isFullscreen().then(paintFullscreenState).catch(() => {});
  };

  btnMin.onclick = () => window.tailref.minimize();
  btnMax.onclick = async () => {
    await exitPageFullscreen();
    if (!window.tailref || !window.tailref.toggleFullscreen) return;
    const full = await window.tailref.toggleFullscreen();
    paintFullscreenState(!!full);
  };
  btnClose.onclick = () => window.tailref.close();
  if (drawMin) drawMin.onclick = () => window.tailref.minimize();
  if (drawMax) {
    drawMax.onclick = async () => {
      await exitPageFullscreen();
      if (!window.tailref || !window.tailref.toggleFullscreen) return;
      const full = await window.tailref.toggleFullscreen();
      paintFullscreenState(!!full);
    };
  }
  if (drawClose) drawClose.onclick = () => window.tailref.close();

  syncFullscreenState();
  let fullSyncTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(fullSyncTimer);
    fullSyncTimer = setTimeout(syncFullscreenState, 140);
  });
  queueToolbarLayout();
}

fileInput.onchange = () => {
  if (fileInput.files && fileInput.files.length) addFiles(fileInput.files, null);
  fileInput.value = '';
};
window.addEventListener('pose-screenshot', async e => {
  const dataUrl = e.detail && e.detail.dataUrl;
  if (!dataUrl) return;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await addFiles([new File([blob], `tailref-pose-${Date.now()}.png`, { type: 'image/png' })], null);
  } catch (err) { console.error('Poz tahtaya eklenemedi', err); }
});

/* 3D capture köprüsü: BoardBridge `pose-capture` yayınlar, sonucu
   `pose-capture-done` ile geri bildirir (çoklu pass tek seferde). */
window.addEventListener('pose-capture', async e => {
  const detail = e.detail || {};
  const files = [];
  if (Array.isArray(detail.files)) {
    detail.files.forEach(file => { if (file && file.type?.startsWith('image/')) files.push(file); });
  }
  if (!files.length && detail.blob) {
    files.push(new File([detail.blob], detail.name || `tailref-pose-${Date.now()}.png`, { type: 'image/png' }));
  }
  let ok = false;
  if (files.length) {
    try {
      await addFiles(files, null);
      ok = true;
    } catch (err) {
      console.error('Poz tahtaya eklenemedi', err);
    }
  }
  window.dispatchEvent(new CustomEvent('pose-capture-done', {
    detail: { token: detail.token, ok, count: files.length },
  }));
});

/* Capture kısayolları: Ctrl+Shift+S modal, Ctrl+Shift+Alt+S hızlı.
   Panel kapalıysa önce 3D paneli açar; 2D Ctrl+S kaydına karışmaz. */
window.addEventListener('keydown', event => {
  if (typeof modeIsDraw === 'function' && modeIsDraw()) return;
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
  if (String(event.key || '').toLowerCase() !== 's') return;
  event.preventDefault();
  event.stopPropagation();
  const panel = document.querySelector('#pose3dPanel');
  if (panel && panel.hidden) document.querySelector('#mode3dBtn')?.click();
  window.dispatchEvent(new CustomEvent('pose-capture-request', { detail: { quick: !!event.altKey } }));
}, true);

$('#bgOpacity').addEventListener('input', e => {
  setBg(Number(e.target.value) / 100);
});

window.addEventListener('resize', () => applyView());

/* Sahne asla kaydırılmamalı: kaydırma olursa tuval görsel olarak kayar ama
   state.view aynı kalır (F ile ortalama, çift tıkla metin yeri şaşar).
   Tarayıcı focus() sırasında kendiliğinden kaydırabildiği için burada sıfırlıyoruz. */
stage.addEventListener('scroll', () => {
  if (stage.scrollLeft || stage.scrollTop) { stage.scrollLeft = 0; stage.scrollTop = 0; }
}, { passive: true });

/* =========================================================
   başlangıç
   ========================================================= */

/* Başlatma hatasını pencere içinde gösterir. alert() çerçevesiz/saydam
   pencerede bloklayıcı ve biçimsiz durduğu için kendi katmanımızı kullanıyoruz. */
function showFatalError(message) {
  let layer = document.getElementById('fatalError');
  if (layer) { layer.remove(); }

  layer = document.createElement('div');
  layer.id = 'fatalError';
  layer.setAttribute('role', 'alertdialog');
  layer.setAttribute('aria-modal', 'true');
  layer.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'display:flex',
    'align-items:center', 'justify-content:center', 'padding:24px',
    'background:rgba(8,10,14,.82)', 'backdrop-filter:blur(6px)',
    'font-family:\'Inter\',BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'max-width:520px', 'width:100%', 'padding:24px 26px', 'border-radius:14px',
    'background:#171b22', 'border:1px solid rgba(255,255,255,.10)',
    'box-shadow:0 24px 70px rgba(0,0,0,.55)', 'color:#eef2f7',
  ].join(';');

  const title = document.createElement('b');
  title.textContent = 'Startup error';
  title.style.cssText = 'display:block;font-size:16px;letter-spacing:.02em;margin-bottom:10px;';

  const body = document.createElement('p');
  body.textContent = message;
  body.style.cssText = 'margin:0 0 6px;font-size:13px;line-height:1.55;color:#b9c4d2;white-space:pre-wrap;';

  const hint = document.createElement('p');
  hint.textContent = 'Board data is kept in the browser store (IndexedDB) and can only be read from the app\'s own address. If you opened the page directly as a file, the data is invisible.';
  hint.style.cssText = 'margin:0 0 18px;font-size:12px;line-height:1.5;color:#7f8b9b;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Yeniden dene';
  reload.style.cssText = 'padding:9px 16px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#eef2f7;font:inherit;font-size:13px;cursor:pointer;';
  reload.onclick = () => location.reload();

  actions.appendChild(reload);
  card.append(title, body, hint, actions);
  layer.appendChild(card);
  document.body.appendChild(layer);
}

/** Yüklü panoların toplam öğe sayısı (sağlık kontrolü için). */
function totalLoadedItems() {
  const manager = workspaceManager;
  if (!manager || !manager.ready) return Array.isArray(state.items) ? state.items.length : 0;
  let total = 0;
  for (const project of manager.projects.values()) {
    const items = project && project.snapshot && Array.isArray(project.snapshot.items)
      ? project.snapshot.items
      : [];
    total += items.length;
  }
  return total;
}

/** Ana süreçte bekleyen kurtarma isteğini panolar yüklenmeden ÖNCE uygular:
    "restore" → yedeği yazar, "reset" → panoları arşivleyip IndexedDB'yi boşaltır.
    Böylece donmuş arayüzden hiçbir şey beklenmez ve ağır (bozuk) tahta hiç açılmaz. */
async function applyPendingRecoveryOnBoot() {
  const api = window.tailref;
  if (!api || !api.getRecoveryRequest) return null;
  let request = null;
  try {
    request = await api.getRecoveryRequest();
  } catch {
    return null;
  }
  if (!request) return null;

  /* "Temiz başlat": bozuk panoları arşive yaz, veriyi boşalt. */
  if (request.mode === 'reset') {
    try {
      const archivePath = await archiveAndWipeBoards();
      if (api.clearRecoveryRequest) await api.clearRecoveryRequest();
      if (api.markRecoveryHealthy) await api.markRecoveryHealthy();
      return { ok: true, mode: 'reset', archive: archivePath };
    } catch (error) {
      console.warn('clean start could not be applied', error);
      try { if (api.clearRecoveryRequest) await api.clearRecoveryRequest(); } catch { /* sessiz */ }
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }

  if (!request.backup || !api.readBackupFile) return null;
  try {
    // Mevcut (bozuk) durum emniyete alınır: yanlış yedek seçilirse geri dönülebilir.
    const emergency = await saveEmergencyCopy();
    const raw = await api.readBackupFile(request.backup);
    if (!raw) throw new Error('backup file could not be read');
    await importBackupPayload(JSON.parse(raw));
    if (api.clearRecoveryRequest) await api.clearRecoveryRequest();
    return { ok: true, mode: 'restore', backup: request.backup, emergency };
  } catch (error) {
    console.warn('recovery backup could not be applied', error);
    try { if (api.clearRecoveryRequest) await api.clearRecoveryRequest(); } catch { /* sessiz */ }
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

async function init() {
  let recovery = null;
  try {
    if (window.__bootMark) window.__bootMark('init-start');
    await openDB();
    if (window.__bootMark) window.__bootMark('database-open');

    /* Aşırı yük sonrası "son kayda dön" / "temiz başlat" seçildiyse önce uygula.
       Manuel modda açılış her zaman boş olmalı: eski panoları geri getiren
       otomatik kurtarma çalıştırılmaz. */
    if (isPersistenceAuto()) recovery = await applyPendingRecoveryOnBoot();
    if (recovery && recovery.ok && recovery.mode === 'restore') {
      /* Kurtarma yedeği bu açılışta uygulandı: "Açılışta son panoları
         geri yükle" anahtarı kapalı olsa bile bu oturumda temiz
         başlatma yapılmaz (kullanıcının açıkça geri dönüşü korunur). */
      try { workspaceManager._recoveryRestoredThisBoot = true; } catch { /* sessiz */ }
    }
    if (window.__bootMark) window.__bootMark('kurtarma-kontrol');

    // Pano/sekme mimarisi: eski tek tahta kaydı ilk panoya taşınır,
    // seçili pano canlı tahtaya uygulanır ve görselleri yüklenir.
    await workspaceManager.bootstrap();
    if (window.__bootMark) window.__bootMark('board-restored');

    // Çizim katmanları: durumu normalize et, içe aktarılan fırçaları yükle,
    // araç kutusunu bağla. Hata olsa bile ana tahta açılmaya devam eder.
    try {
      if (typeof inkInit === 'function') await inkInit();
    } catch (inkErr) {
      console.warn('drawing system failed to start', inkErr);
    }
    if (window.__bootMark) window.__bootMark('draw-engine-ready');

    // Kullanılmayan blob'ları temizle. Tüm panoların görselleri korunur.
    gcImages();

    if (typeof state.bg !== 'number') state.bg = 1;

    applyView();
    applyBackdrop();
    syncAll();
    syncSelection();
    appReady = true;
    /* Manuel mod: açılışta (boş tahta ya da .tail'den yüklenmiş tahta)
       "kaydedilmemiş değişiklik yok" taban çizgisini kur. Kapanışta canlı
       durum bu imzadan farklıysa kaydetme sorulur. */
    if (!isPersistenceAuto() && typeof markManualClean === 'function') markManualClean();
    if (window.__bootMark) window.__bootMark('ui-synced (ready for interaction)');
  } catch (e) {
    console.error(e);
    showFatalError(e && e.message ? e.message : String(e));
  } finally {
    updateTrashUI(true);
    startTrashClock();
    showTrashDock();

    /* Geri yükleme sonrası sağlık kontrolü: tahta hâlâ aşırı büyükse bunu
       bildir; ana süreç bir sonraki kurtarma çağrısında BAŞKA bir yedeği önerir. */
    const loadedItems = totalLoadedItems();
    const stillHeavy = loadedItems > OVERLOAD_SAFE_ITEMS;
    if (window.tailref && window.tailref.markRecoveryHealthy && !stillHeavy) {
      try { await window.tailref.markRecoveryHealthy(); } catch { /* sessiz */ }
    }

    if (recovery && recovery.ok && recovery.mode === 'reset') {
      showProjectNotice(recovery.archive
        ? 'Clean start completed. Old boards are in the archive: ' + recovery.archive
        : 'Clean start completed.', 9000);
    } else if (recovery && recovery.ok) {
      showProjectNotice('Reverted to the last healthy save: ' + recovery.backup, 6000);
    } else if (recovery && !recovery.ok) {
      showProjectNotice('Recovery backup could not be loaded: ' + recovery.error, 9000);
    }
    if (stillHeavy) {
      showProjectNotice(
        `The board is still very large (${loadedItems} items). You can try the previous backup with Ctrl+Alt+Shift+R.`,
        11000
      );
    }
  }
}

async function gcImages() {
  /* Manuel modda diskteki görseller otomatik modun panolarına ait olabilir;
     boş manuel tahta hiçbirini kullanmıyor diye silinmemeli. */
  if (!isPersistenceAuto()) return;
  /* Yazımı süren görseller varken hiç silme (bkz. beginImageWrite). */
  if (typeof imageWriteInFlight !== 'undefined' && imageWriteInFlight > 0) return;
  try {
    const buildUsed = () => {
      // Tahtadaki ve çöpteki görseller korunur.
      const used = inUseImageIds();
      // Kapalı sekmelerdeki panolar da görsellerini korur.
      collectWorkspaceImageIds(used);
      // Geri al/yinele yığınlarındaki görseller de gerekli olabilir.
      for (const json of [...undoStack, ...redoStack]) {
        try {
          const snap = JSON.parse(json);
          for (const item of (snap && snap.items) || []) {
            if (item && item.kind === 'image' && item.imageId) used.add(item.imageId);
          }
        } catch { /* bozuk anlık görüntü */ }
      }
      return used;
    };
    const all = await idbEntries('images');
    /* Tarama sürerken tahtaya yeni görsel eklenmiş olabilir (idbPut ile
       öğe oluşturma arasında GC denk gelirse blob silinirdi). Silme
       kararından hemen önce kullanım kümesini tazele; ayrıca yeni yazılmış
       kayıtları kısa bir ek süre boyunca koru. */
    const used = buildUsed();
    for (const [key] of all) {
      /* Tarama sürerken yeni bir görsel yazılmaya başladıysa dur: henüz
         tahta öğesine bağlanmamış blob'u silme. */
      if (typeof imageWriteInFlight !== 'undefined' && imageWriteInFlight > 0) return;
      if (used.has(key)) continue;
      await idbDel('images', key);
    }
    // Artık hiçbir yerde kullanılmayan blob URL'lerini serbest bırak.
    for (const [key, value] of [...imgCache]) {
      if (used.has(key)) continue;
      imgCache.delete(key);
      if (value && typeof value.url === 'string' && value.url.startsWith('blob:')) {
        URL.revokeObjectURL(value.url);
      }
    }
  } catch (e) { /* sessiz */ }
}

/* Pano modülü (26-projects.js) değerlendirildikten sonra başlat. Böylece
   `workspaceManager` ve pano sınıfları init sırasında hazır olur. */
queueMicrotask(() => {
  init().then(() => {
    /* Manuel modda otomatik yedek çalışmasın; ayrıca mod seçilmediyse karşılama diyaloğunu aç. */
    if (isPersistenceAuto()) setTimeout(autoBackup, 10000);
    if (!hasChosenPersistence()) showPersistenceWelcome();
  });
});

/* ---------------- tek örnek kilidi devri bildirimi ----------------
   Uygulama tek örnek kilidiyle çalışır (src/main/main.js): yenisini
   başlatınca yeni süreç sessizce çıkar, eski pencereye odaklanır.
   Kullanıcı "güncel yapıyı başlattım" sanıp eski pencerede kalmasın:
   burada hangi yapının koştuğu ve ne yapılması gerektiği söylenir. */
if (window.tailref && window.tailref.onSecondInstance) {
  window.tailref.onSecondInstance(data => {
    const stamp = data && data.stamp ? `Running build: ${data.stamp}. ` : '';
    if (typeof showProjectNotice === 'function') {
      showProjectNotice(
        `${stamp}The newly started exe was handed over to this open window. ` +
        'To run the current build, close the window and reopen the app from its icon.',
        8000);
    }
  });
}

/* Ctrl+Z teşhis: undo/redo çağrılarını halkaya yaz (Ctrl+Alt+P panelde
   görünür; tuş ulaşıp artmadığı ve yığın durumu gözle doğrulanır). */
(() => {
  const dbg = window.__undoDebug;
  if (!dbg) return;
  const wrap = (name) => {
    const base = window[name];
    if (typeof base !== 'function' || base.__undoDebugWrapped) return;
    const wrapped = function () {
      dbg.calls.push({
        name, t: Date.now(),
        stack: (typeof undoStack !== 'undefined') ? undoStack.length : -1,
      });
      if (dbg.calls.length > 12) dbg.calls.shift();
      return base.apply(this, arguments);
    };
    wrapped.__undoDebugWrapped = true;
    try { window[name] = wrapped; } catch { /* salt-okunursa sessiz */ }
  };
  wrap('undo');
  wrap('redo');
})();

/* ---------------- kapanışta kayıt garantisi ----------------
   Electron ana süreci pencereyi kapatmadan önce 'app-close-requested'
   gönderir. Burada flushSave() bitince onay veririz; böylece 400 ms'lik
   debounce beklemede kalsa bile son değişiklik kaybolmaz. */
let closeFlushStarted = false;
if (window.tailref && window.tailref.onCloseRequested) {
  window.tailref.onCloseRequested(async () => {
    /* Ana süreçteki zorla kapatma zaman aşımı yalnızca renderer gerçekten
       donduğunda devreye girsin: isteği aldığımızı ve kullanıcıya soru
       gösterdiğimizi hemen bildir. */
    try { window.tailref.ackCloseRequest(); } catch { /* sessiz */ }
    if (closeFlushStarted) return;
    closeFlushStarted = true;
    let exit = true;
    try {
      /* Manuel modda IndexedDB'ye otomatik kayıt yok. Kaydedilmemiş
         değişiklikler varsa kullanıcıya sor: kaydet / kaydetmeden çık /
         vazgeç. Soru ana süreçte sorulur çünkü buradaki senkron confirm()
         renderer'ı kilitliyor ve uygulama "yanıt vermiyor" sanılıyordu. */
      if (!isPersistenceAuto()) {
        /* Son kaydetme/açmadan beri canlı durum değişmediyse boşuna sorma:
           imza karşılaştırması olay sayımına değil gerçek içeriğe bakar. */
        const dirty = typeof manualSavedHash === 'undefined' || manualSavedHash === null ||
          manualStateSignature() !== manualSavedHash;
        if (!dirty) {
          exit = true;
        } else {
          const ask = window.tailref.askCloseChoice;
          const choice = typeof ask === 'function'
            ? await ask()
            : ((await appConfirm('Unsaved changes will be lost.', 'Save your work as a .tail file?')) ? 0 : 1);
          if (choice === 2) {
            exit = false;                        // vazgeç: pencere açık kalsın
          } else if (choice === 0) {
            /* Kaydetmeyi seçip dosya kutusunu iptal ederse (ya da kayıt
               başarısız olursa) kapanıştan vazgeç: veri kaybı olmasın. */
            exit = await saveAsTail();
          }
        }
      } else {
        await flushSave();
      }
    } catch {
      exit = false;
    } finally {
      closeFlushStarted = false;
      try {
        if (exit) await window.tailref.confirmClose();
        else window.tailref.cancelClose();
      } catch { /* sessiz */ }
    }
  });
}

/* Tarayıcı sekmesi kapanırken / arka plana atılırken son bir kayıt denemesi.
   (IndexedDB yazımı garanti değildir; asıl güvence yukarıdaki el sıkışma.) */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', () => { flushSave(); });

/* ---------------- .tail dosyasını dışarıdan aç ----------------
   1) Çift tık: exe argv'sındaki yol main'de bekler, burada tüketilir.
   2) Uygulama açıkken ikinci başlatma: second-instance push'u.
   3) Pencereye sürükle-bırak (webUtils getPathForFile ile disk yolu).
   Üçü de aynı yükleme kapısından girer: importBackupPayload + temiz
   başlangıç için yeniden yükleme. Otomatik modda panolar zaten
   yedekli olduğundan onay sorulmaz (çift tık = açık kullanıcı niyeti);
   manuel modda açık dosya tek kalıcı depo olduğundan onay sorulur. */
(function watchBoardFileOpen() {
  if (!window.tailref || !window.tailref.openBoardFileAtPath) return;
  const boardFileIn = dt => dt && dt.files && [...dt.files].some(f => /\.tail$/i.test(f.name || ''));
  let busy = false;
  const loadBoardFile = async filePath => {
    if (!filePath || busy) return;
    busy = true;
    try {
      const res = await window.tailref.openBoardFileAtPath(filePath);
      if (!res || !res.ok) {
        if (res && res.error) showProjectNotice(res.error, 6000);
        return;
      }
      if (!isPersistenceAuto() &&
          !(await appConfirm(__t('This file will be loaded in place of the current boards. Continue?')))) return;
      /* Açma öncesi güvenlik: otomatik modda son hâli diske yaz, manuel
         modda canlı tahtanın acil kopyasını al (yanlış dosyaya karşı). */
      if (isPersistenceAuto()) await flushSave();
      else await saveEmergencyCopy(true);
      suspendPersistenceForReload();
      try {
        await importBackupPayload(res.payload);
      } catch (importError) {
        resumePersistenceAfterFailedImport();
        throw importError;
      }
      location.reload();
    } catch (e) {
      showProjectNotice('Could not open .tail: ' + ((e && e.message) || e), 6000);
    } finally {
      busy = false;
    }
  };
  (async () => {
    try {
      /* Boot'un idb'yi açmasını ve panoları kurmasını bekle: consume bu
         iki aşamanın yarısına denk gelirse db null düşer ya da import
         yazımı boot kaydı tarafından ezilir (çift tık E2E bulgusu:
         "Cannot read properties of null (reading 'transaction')"). */
      for (let i = 0; i < 150; i += 1) {
        if (document.body && document.body.classList.contains('ink-workspace-ready')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const p = await window.tailref.consumeBoardLaunchFile();
      if (p) await loadBoardFile(p);
    } catch { /* sessiz */ }
  })();
  if (typeof window.tailref.onOpenBoardFile === 'function') {
    window.tailref.onOpenBoardFile(loadBoardFile);
  }
  window.addEventListener('dragover', event => {
    if (!boardFileIn(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', event => {
    if (!boardFileIn(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const file = [...event.dataTransfer.files].find(f => /\.tail$/i.test(f.name || ''));
    if (!file) return;
    const p = window.tailref.pathForDroppedFile ? window.tailref.pathForDroppedFile(file) : '';
    if (p) loadBoardFile(p);
  }, true);
})();
