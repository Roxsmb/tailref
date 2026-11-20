/* TailRef app · save, backup, undo/redo, view transform */
'use strict';

/* =========================================================
   kayıt / geri al
   ========================================================= */
/* =========================================================
   kalıcılık modu (.tail)
   ---------------------------------------------------------
   auto:    her değişiklikte IndexedDB'ye kaydet, açılışta geri yükle.
   manual:  yalnızca Ctrl+S ile .tail dosyasına kaydet; otomatik kayıt/yedek kapalı.
   localStorage boşsa (ilk açılış) auto varsayılır; karşılama diyaloğu seçim yaptırır.
   scheduleSave ve autoBackup buradan geçer — tek noktadan geçit.
   ========================================================= */
const PERSISTENCE_KEY = 'tailref-persistence';
function getPersistenceMode() {
  const m = localStorage.getItem(PERSISTENCE_KEY);
  return m === 'manual' ? 'manual' : 'auto';
}
function isPersistenceAuto() { return getPersistenceMode() !== 'manual'; }
function hasChosenPersistence() { return !!localStorage.getItem(PERSISTENCE_KEY); }
function setPersistenceMode(mode) {
  localStorage.setItem(PERSISTENCE_KEY, mode === 'manual' ? 'manual' : 'auto');
  syncPersistenceUI();
  /* Manuel modda otomatik yedek zamanlayıcısını da durur; otomatik modda eski
     aralığa döner. Aralık ayarı diske yazılmaz: mod değişimi kullanıcının
     seçtiği yedekleme sıklığını sıfırlamamalı. */
  configureBackupInterval(isPersistenceAuto()
    ? Number(localStorage.getItem('tailref-backup-interval') || 5)
    : 0, false);
  /* Mod değişiminde veri kaybı penceresini kapat: manuelden otomatiğe
     geçince canlı tahtayı hemen diske yaz (uygulama çökse bile geri gelir)
     ve canlı çalışma alanında olmayan eski pano kayıtlarını temizle;
     otomatikten manuele geçerken bekleyen yazımı iptal et. */
  if (isPersistenceAuto()) {
    if (typeof appReady !== 'undefined' && appReady && typeof saveNow === 'function') {
      Promise.resolve().then(async () => {
        try {
          await saveNow();
          if (typeof pruneStaleStoredBoards === 'function') await pruneStaleStoredBoards();
        } catch { /* kullanıcıya saveNow zaten bildirir */ }
      });
    }
  } else {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function scheduleSave() {
  if (!isPersistenceAuto()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE);
}

/* İçe aktarma + location.reload() yarışı: importBackupPayload diske yazar,
   hemen ardından pagehide/visibilitychange flushSave() çalışır ve CANLI
   (eski) tahtayı import edilen verinin üstüne yazardı. Bayrak set edilince
   hem saveNow hem flushSave susar; sayfa yenilenince modül sıfırlanır.
   Import başarısız olursa bayrak geri alınır ki otomatik kayıt devam etsin. */
let persistenceSuspendedForReload = false;
function suspendPersistenceForReload() {
  persistenceSuspendedForReload = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  pendingStateJSON = null;
  pendingProjectRecord = null;
}
function resumePersistenceAfterFailedImport() {
  persistenceSuspendedForReload = false;
  if (appReady) scheduleSave();
}

/* Kayıt hatası sessiz kalmasın: depo dolu/izinsiz olduğunda kullanıcı
   "otomatik modda her şey kaydediliyor" sanmasın. Aynı mesajı oturumda
   bir kez göster (art arda hata yağmuru olmasın). */
let persistenceErrorNotified = false;
function notifyPersistenceError() {
  if (persistenceErrorNotified) return;
  persistenceErrorNotified = true;
  try {
    if (typeof showProjectNotice === 'function') {
      showProjectNotice(__t('Changes could not be saved to this device. Storage may be full.'), 9000);
    }
  } catch { /* sessiz */ }
}

/* Manuel mod: dosya kaydedildikten/ açıldıktan sonraki durumun imzası.
   Kapanışta canlı durum bu imzayla aynıysa "kaydedilmemiş değişiklik" yoktur
   ve boşuna "kaydet?" sorulmaz. Olay saymak yerine gerçek durumu karşılaştırır;
   böylece bir değişiklik yolu scheduleSave çağırmayı unutsa bile veri kaybı
   riski yoktur (imza değişir → soru sorulur). */
let manualSavedHash = null;
function manualStateSignature() {
  if (typeof createStateSnapshot !== 'function') return '';
  const projects = [];
  if (typeof workspaceManager !== 'undefined' && workspaceManager && workspaceManager.ready) {
    for (const id of workspaceManager.order) {
      const project = workspaceManager.projects.get(id);
      if (!project) continue;
      projects.push({ id: project.id, name: project.name, state: project.snapshot });
    }
  }
  const camera = typeof captureCameraTransform === 'function' ? captureCameraTransform() : null;
  const pose = typeof capturePose3d === 'function' ? capturePose3d() : null;
  return JSON.stringify({ state: createStateSnapshot(), projects, camera, pose });
}
function markManualClean() {
  manualSavedHash = manualStateSignature();
}

/* Manuel modda gcImages kapalıdır (diskteki otomatik panolara ait görseller
   silinmesin diye). Bu yüzden arka arkaya dosya açıp kapatan kullanıcıda
   görseller IDB'de birikiyordu. Yalnızca BAŞARILI bir .tail kaydından sonra
   çalışır: dosya, o an panolardaki tüm görselleri kendi içine gömdüğü için
   kalan sahipsiz kayıtları silmek güvenlidir. Geri al/yinele yığınlarındaki
   görseller korunur. */
let imagePruneInFlight = false;
async function pruneUnusedImagesNow() {
  if (imagePruneInFlight) return 0;
  if (typeof inUseImageIds !== 'function') return 0;
  if (typeof imageWriteInFlight !== 'undefined' && imageWriteInFlight > 0) return 0;
  imagePruneInFlight = true;
  try {
    const used = inUseImageIds();
    if (typeof collectWorkspaceImageIds === 'function') collectWorkspaceImageIds(used);
    /* Diskte duran ama bu oturumda yüklü olmayan panoların görsellerini de
       koru: kullanıcı otomatik moda dönerse o panolar geri gelir. (Anahtar
       sabiti 26-projects.js'te tanımlı; burada yükleme sırasında erişmemek
       için düz metin kullanılıyor.) */
    try {
      for (const [key, value] of await idbEntries('meta')) {
        const k = String(key);
        let record = null;
        if (k.startsWith('project:')) record = value;
        else if (k === 'state') { try { record = JSON.parse(value); } catch { record = null; } }
        const snapshot = record && (record.state || record.snapshot || record);
        for (const item of (snapshot && snapshot.items) || []) {
          if (item && item.kind === 'image' && item.imageId) used.add(item.imageId);
        }
      }
    } catch { /* sessiz */ }
    for (const json of [...undoStack, ...redoStack]) {
      try {
        const snap = JSON.parse(json);
        for (const item of (snap && snap.items) || []) {
          if (item && item.kind === 'image' && item.imageId) used.add(item.imageId);
        }
      } catch { /* bozuk anlık görüntü */ }
    }
    let removed = 0;
    for (const [key] of await idbEntries('images')) {
      /* Temizlik sürerken yeni görsel yazımı başladıysa dur. */
      if (typeof imageWriteInFlight !== 'undefined' && imageWriteInFlight > 0) return removed;
      if (used.has(key)) continue;
      await idbDel('images', key);
      removed++;
    }
    return removed;
  } finally {
    imagePruneInFlight = false;
  }
}

/* ---------------- arka plan opaklığı ---------------- */
/** Slider'ın içindeki yüzde etiketini thumb'ı takip edecek şekilde günceller. */
function paintOpacityValue(p) {
  const val = document.getElementById('bgOpacityVal');
  if (!val) return;
  const pct = Math.round(clamp(p, 0, 1) * 100);
  val.textContent = pct + '%';
  // Sağ uca yaklaşınca etiket thumb'ın soluna geçer (taşmasın).
  val.classList.toggle('is-left', p > 0.72);
  // Tooltip kaldırıldı: değer slider'ın altındaki yüzde etiketinde duruyor.
  // Ekran okuyucular için aria-label güncel kalsın.
  const box = document.getElementById('opacityCtl');
  if (box) {
    box.setAttribute('aria-label', 'Opacity: %' + pct);
  }
}

function applyBackdrop() {
  const v = typeof state.bg === 'number' ? state.bg : 1;
  backdropEl.style.opacity = String(v);
  const slider = $('#bgOpacity');
  if (slider && document.activeElement !== slider) slider.value = Math.round(v * 100);
  syncRangeFill(slider);
  paintOpacityValue(v);
}

function setBg(v, save = true) {
  state.bg = clamp(v, 0, 1);
  applyBackdrop();
  if (save) scheduleSave();
}

let pendingProjectRecord = null;
/* Başarılı her IndexedDB yazımında artar (bkz. autoBackup: boşta yedek yok). */
let saveSerial = 0;

async function saveNow() {
  /* Manuel modda otomatik IndexedDB kaydı yok — yalnızca .tail dosyası kalıcıdır.
     importBackupPayload (.tail açma) bu fonksiyonu kullanmaz; doğrudan idbPut yapar. */
  if (!isPersistenceAuto()) return;
  /* İçe aktarma sonrası yeniden yükleme sırasında canlı (eski) tahta
     import edilen kaydın üstüne yazılmasın. */
  if (persistenceSuspendedForReload) return;
  clearTimeout(saveTimer);
  /* Debounce kimliğini de temizle: aksi halde "bekleyen kayıt var mı?"
     kontrolü (autoBackup boşta atlama) süresi dolmuş bir zamanlayıcıyı
     hâlâ bekliyor sanır. */
  saveTimer = null;
  // Pano mimarisi hazırsa anlık görüntüyü panoya özel kayıtla birlikte
  // hazırla; kamera/poz verisi de bu karede dondurulur.
  const staged = typeof stageActiveProjectSave === 'function' ? stageActiveProjectSave() : null;
  pendingStateJSON = staged ? staged.json : JSON.stringify(createStateSnapshot());
  pendingProjectRecord = staged || null;
  if (saveInFlight) return saveInFlight;

  saveInFlight = (async () => {
    while (pendingStateJSON !== null) {
      const json = pendingStateJSON;
      const project = pendingProjectRecord;
      pendingStateJSON = null;
      pendingProjectRecord = null;
      try {
        const saveT0 = performance.now();
        await idbPut('meta', 'state', json);
        if (project) await persistStagedProject(project);
        /* Teşhis paneli (Ctrl+Alt+P) için son kaydın süresi ve boyutu. */
        try {
          window.__tailrefLastSaveStats = {
            ms: Math.round((performance.now() - saveT0) * 10) / 10,
            kb: Math.round(new TextEncoder().encode(json).byteLength / 1024),
          };
        } catch { /* sessiz */ }
        flashStatus();
        /* Değişmezlik sayacı: otomatik yedek zamanlayıcısı, son yedekten
           beri gerçekten yeni bir kayıt yazıldı mı diye buna bakar. Boşta
           duran uygulamada her 5 dakikada aynı panoyu diske yazmayı önler. */
        saveSerial++;
      } catch (e) {
        console.warn('could not save', e);
        notifyPersistenceError();
        /* Bu değişiklik diske yazılamadı: yedek zamanlayıcısı "değişiklik
           yok" diyip geçmesin, bir sonraki turda disk yedeği denensin. */
        lastBackupSerial = -1;
      }
    }
  })().finally(() => {
    saveInFlight = null;
  });

  return saveInFlight;
}

/* Bekleyen debounce'u iptal edip mevcut durumu hemen diske yazar.
   Pencere kapanırken ve sekme gizlenirken çağrılır. */
async function flushSave() {
  if (!appReady || !db) return;
  if (persistenceSuspendedForReload) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await saveNow();
    if (saveInFlight) await saveInFlight;
  } catch (e) {
    console.warn('Emergency save failed', e);
  }
}

/* ---------------- otomatik yedek ---------------- */
function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* ---------------- .tail dosyası (manuel kayıt modu) ----------------
   autoBackup ile aynı payload biçimi; tek fark diske tek bir sıkıştırılmış
   dosya yazılmasıdır. gzip ana süreçte uygulanır (renderer'ı bloklamaz). */
/** Yedeğe girecek görseller: yalnızca panolarda (canlı tahta, çöp, açık
    panolar) gerçekten referanslanan kimlikler. IDB'de unutulmuş sahipsiz
    görseller .tail/yedek dosyasını şişirmez; manuel modda gcImages
    çalışmadığı için bu filtre olmadan dosya her kayıtta büyüyordu. */
function collectSavableImageIds() {
  const used = typeof inUseImageIds === 'function' ? inUseImageIds() : new Set();
  /* .tail ve yedek dosyaları geri al/yinele yığınlarını taşımaz; yalnızca
     panolarda/çöpte görünen görseller gerekir. Geçmişi de katan liste,
     dosyaya hiç görünmeyen "hayalet" görseller ekliyordu (şişkinlik).
     gcImages ayrı yoldur ve geçmişi korumaya devam eder. */
  if (typeof collectWorkspaceImageIds === 'function') collectWorkspaceImageIds(used, false);
  return used;
}

/* Panoya bağlı görselleri data URL'e çevirir. Sıralı FileReader zinciri çok
   görselli panolarda kaydı uzatıyordu; 4'lü gruplarla paralel okunur. */
async function collectBoardImages() {
  const usedImages = collectSavableImageIds();
  const entries = (await idbEntries('images')).filter(([id, rec]) =>
    !!(rec && rec.blob && usedImages.has(id)));
  const encoded = await mapInBatches(entries, 4, async ([id, rec]) => {
    try {
      return { id, name: rec.name || 'image', dataUrl: await blobAsDataUrl(rec.blob) };
    } catch (e) {
      console.warn('backup image could not be encoded', id, e);
      return null;
    }
  });
  /* Fotoğrafı kodlanamayan pano "eksiksiz" diye işaretlenmemeli: aksi halde
     dosyayı yeniden açan kullanıcının IndexedDB'sindeki sağlam kopya,
     temizlik sırasında silinirdi. */
  return { images: encoded.filter(Boolean), complete: encoded.every(Boolean) };
}

/** .tail ve otomatik yedek için tek ortak gövde. */
async function buildBoardPayload() {
  const workspace = workspaceManager && workspaceManager.ready
    ? workspaceManager.serializeWorkspace()
    : null;
  const imageData = await collectBoardImages();
  return {
    version: 2, createdAt: new Date().toISOString(),
    state: createStateSnapshot(), workspace,
    images: imageData.images,
    /* Görsel listesi eksiksiz mi? .tail/yedek yazarken true; acil kopyalar
       görselleri bilerek dışarıda bıraktığı için bu bayrağı koymaz, böylece
       içe aktarmada IndexedDB görselleri yanlışlıkla silinmez. */
    imagesComplete: imageData.complete,
  };
}

async function buildTailPayload() {
  /* Manuel modda saveNow() diske yazmaz; yine de etkin panonun anlık
     görüntüsü .tail dosyasına yansımalı. */
  if (workspaceManager && workspaceManager.activeProject) {
    workspaceManager.activeProject.capture();
  }
  await saveNow();
  return buildBoardPayload();
}

let tailSaveInFlight = false;
async function saveAsTail() {
  if (!window.tailref || !window.tailref.saveTail) return false;
  /* Ctrl+S'ye üst üste basmak iki yerel kayıt kutusu açıyordu; tek uçuş. */
  if (tailSaveInFlight) return false;
  tailSaveInFlight = true;
  try {
    const payload = await buildTailPayload();
    const project = workspaceManager && workspaceManager.activeProject
      ? workspaceManager.activeProject.name : '';
    const suggested = (project || 'board').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'board';
    const res = await window.tailref.saveTail(JSON.stringify(payload), suggested);
    if (res && res.ok) {
      showProjectNotice(__t('Board saved: ') + res.file, 4000);
      markManualClean();
      /* Dosya artık panodaki tüm görselleri içeriyor: IDB'de birikmiş
         sahipsiz görselleri temizle (bkz. pruneUnusedImagesNow). */
      pruneUnusedImagesNow().catch(() => { /* sessiz */ });
      return true;
    }
    if (res && res.canceled) return false; // kullanıcı iptal etti
    showProjectNotice(__t('Could not save: ') + (res && res.error || __t('unknown error')), 6000);
    return false;
  } catch (e) {
    showProjectNotice(__t('Could not save: ') + e.message, 6000);
    return false;
  } finally {
    tailSaveInFlight = false;
  }
}

async function openTailFile() {
  if (!window.tailref || !window.tailref.openTail) return false;
  try {
    const res = await window.tailref.openTail();
    if (!res || !res.ok) {
      if (res && res.canceled) return false;
      showProjectNotice('Could not open: ' + (res && res.error || 'hata'), 6000);
      return false;
    }
    /* Otomatik modda panolar yedekli olduğundan ve açma öncesi son hâl
       diske yazıldığından onay sorulmaz; manuel modda dosya tek kalıcı
       depo olduğu için sorulur (sürükle-bırak yoluyla aynı sözleşme). */
    if (!isPersistenceAuto() &&
        !(await appConfirm(__t('This file will be loaded in place of the current boards. Continue?')))) return false;
    /* Açma mevcut panoların üzerine yazar. Otomatik modda son hâli diske
       yaz (yedekler zaten var); manuel modda otomatik yedek olmadığı için
       canlı durumun acil kopyasını al — yanlış dosya seçilirse geri dönüş
       noktası kalsın. */
    if (isPersistenceAuto()) await flushSave();
    else await saveEmergencyCopy(true);
    /* Import sürerken ve reload sırasında pagehide flush'ı eski tahtayı
       import edilen kaydın üstüne yazmasın. */
    suspendPersistenceForReload();
    try {
      await importBackupPayload(res.payload);
    } catch (importError) {
      resumePersistenceAfterFailedImport();
      throw importError;
    }
    location.reload();
    return true;
  } catch (e) {
    showProjectNotice('Could not open .tail: ' + e.message, 6000);
    return false;
  }
}

let backupInFlight = false;
/* Son başarılı yedekteki saveSerial. Zamanlayıcı boştayken aynı panoyu
   tekrar tekrar diske yazmasın: yalnızca yeni kayıt varsa yedek alınır.
   -1 = bu oturumda henüz yedek yok (açılıştaki ilk yedek her zaman alınır). */
let lastBackupSerial = -1;
/* Ana süreçteki sağlık kontrolü için pano öğesi sayısı (dosyayı yeniden
   okuyup JSON.parse etmesin). */
function boardItemCount(payload) {
  let total = 0;
  const workspace = payload && payload.workspace;
  if (workspace && Array.isArray(workspace.projects) && workspace.projects.length) {
    for (const record of workspace.projects) {
      const snapshot = record && record.state;
      if (snapshot && Array.isArray(snapshot.items)) total += snapshot.items.length;
    }
  } else if (payload && payload.state && Array.isArray(payload.state.items)) {
    total += payload.state.items.length;
  }
  return total;
}
/* Yedek saklama sınırı (aday 4): localStorage 'tailref-backup-limit' —
   yoksa/bozuksa undefined döner ve main eski sabit 20'yi kullanır (parite). */
function backupLimitFromSettings() {
  try {
    const raw = localStorage.getItem('tailref-backup-limit');
    if (raw === null || raw === '') return undefined;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  } catch { /* sessiz — özel mod vb. */ }
  return undefined;
}
async function autoBackup() {
  if (!isPersistenceAuto()) return;
  if (backupInFlight || !window.tailref || !window.tailref.autoBackup) return;
  /* Son yedekten beri yeni kayıt yoksa disk yazımı yapma. Uçuşta bir kayıt
     varsa (saveInFlight/pending) bu bir değişikliktir: yedek alınır. */
  if (lastBackupSerial >= 0 && saveSerial === lastBackupSerial &&
      !saveInFlight && pendingStateJSON === null && saveTimer === null) {
    return;
  }
  backupInFlight = true;
  try {
    await saveNow();
    /* Yedeğe giren kaydın serisini sabitle: payload hazırlanırken yeni bir
       kayıt oluşursa (saveSerial artar) bir sonraki tur yine yedek alır. */
    const serialAtBackup = saveSerial;
    const payload = await buildBoardPayload();
    const res = await window.tailref.autoBackup(
      JSON.stringify(payload),
      backupLimitFromSettings(),
      { items: boardItemCount(payload), images: payload.images.length }
    );
    /* Ana süreç yazamadıysa (disk dolu/izin) sessiz kalma. */
    if (res && res.ok === false) {
      console.warn('auto backup failed', res.error);
      notifyPersistenceError();
    } else {
      lastBackupSerial = serialAtBackup;
    }
  } catch (e) {
    console.warn('auto backup could not be created', e);
    notifyPersistenceError();
  } finally {
    backupInFlight = false;
  }
}

let backupTimer = null;
function configureBackupInterval(minutes, persist = true) {
  clearInterval(backupTimer);
  backupTimer = null;
  const n = Number(minutes);
  if (n > 0) backupTimer = setInterval(autoBackup, n * 60 * 1000);
  /* `persist=false` yalnızca mod değişiminde kullanılır: manuel moda geçerken
     aralığı 0 yazmak, otomatik moda dönünce yedeklemeyi kapatıyordu. */
  if (persist) {
    try { localStorage.setItem('tailref-backup-interval', String(n)); } catch { /* sessiz */ }
  }
}
/* Açılışta moda göre zamanlayıcı kur; kayıtlı aralık ayarını değiştirme. */
configureBackupInterval(
  isPersistenceAuto() ? Number(localStorage.getItem('tailref-backup-interval') || 5) : 0,
  false
);

let flashTimer = null;
function flashStatus() {
  setItemCountLabel();
}

function itemLabel() {
  const imgs  = state.items.filter(i => i.kind === 'image').length;
  const texts = state.items.filter(i => i.kind === 'text').length;
  if (!imgs && !texts) return __t('0 items');
  const parts = [];
  if (imgs)  parts.push(imgs + ' ' + __t('image'));
  if (texts) parts.push(texts + ' ' + __t('text'));
  return parts.join(' · ');
}
/* Dil değişince sayaç etiketi (dinamik yazım) yeniden çevrilsin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { setItemCountLabel(); } catch { /* sessiz */ } });
}

/* Önceden alınmış bir anlık görüntüyü yığına yazar. Sürükleyici
   (slider) etkileşimlerinde snapshot pointerdown anında alınır ama
   yalnız ilk gerçek değişiklikte yığına girer: kaydırıcıya sadece
   dokunmak boş bir geri-alma adımı bırakmaz. */
function pushUndoRaw(snap) {
  undoStack.push(snap);
  /* Adım sınırı kullanıcı ayarından (tailref-undo-steps); boşsa mevcut
     60. while: sınır düşürüldüğünde fazla kayıtlar hemen boşaltılır. */
  const undoLimit = (typeof tailrefUndoLimit === 'function') ? tailrefUndoLimit(60) : 60;
  while (undoStack.length > undoLimit) {
    const dropped = undoStack.shift();
    if (typeof inkUndoRasterDropRaw === 'function') inkUndoRasterDropRaw(dropped);
    if (typeof maskSnapReleaseRaw === 'function') maskSnapReleaseRaw(dropped);
  }
  if (redoStack.length) {
    if (typeof inkUndoRasterDropStack === 'function') inkUndoRasterDropStack(redoStack);
    if (typeof maskSnapReleaseStack === 'function') maskSnapReleaseStack(redoStack);
    redoStack.length = 0;
  }
}

function pushUndo() {
  const t0 = performance.now();
  /* A3 devamı: maske src tokenize — snapshot'ta yalnız srcRef kalır. */
  const snap = maskSnapStringify(createStateSnapshot());
  pushUndoRaw(snap);
  if (typeof inkPerfSpan === 'function') {
    inkPerfSpan('undoSnap', performance.now() - t0);
    inkPerfCount('undoSnapBytes', snap.length);
  }
}

/** Sürüp bitirilmemiş vuruşu iptal eder. Kullanıcı kalem hâlâ basılıyken
    Ctrl+Z'ye basarsa geri alma önceki kayda iner, sonra pointerup geçerli
    vuruşu yeniden ekliyordu; vuruş "geri alınmamış" gibi görünüyordu. */
function undoCancelActiveStroke() {
  try {
    if (typeof inkEditorIsOpen === 'function' && inkEditorIsOpen() &&
        typeof inkEditorUi !== 'undefined' && inkEditorUi) {
      if (inkEditorUi.gizmoDrag || inkEditorUi.marquee || inkEditorUi.lasso) {
        if (typeof inkEditorCancelSelection === 'function') inkEditorCancelSelection();
      } else if (inkEditorUi.stroke && typeof inkEditorDropStroke === 'function') {
        inkEditorDropStroke();
      }
    }
  } catch { /* sessiz */ }
  try {
    if (typeof inkPointer !== 'undefined' && inkPointer && typeof inkCancelStroke === 'function') {
      inkCancelStroke();
    }
  } catch { /* sessiz */ }
}

function undo() {
  undoCancelActiveStroke();
  // Bozuk ya da bayat (vuruşu artık bulunmayan) kayıtlar sessizce yutulur;
  // kullanıcı Ctrl+Z'ye bastığında hiçbir şey olmaması yerine bir önceki
  // geçerli kayda düşülür. Hiçbir kayıt uygulanamazsa (yığın boş ya da
  // tamamen bayat) görünür bildirim gösterilir — sessiz ölüm yok.
  let guard = 0;
  let applied = false;
  while (undoStack.length && guard++ < 12) {
    const raw = undoStack.pop();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { continue; }
    // Vuruş commit'leri delta kaydı tutar: tüm panoyu yeniden kurmaya gerek yok.
    const delta = typeof inkStrokeEntry === 'function' ? inkStrokeEntry(parsed) : null;
    if (delta) {
      if (typeof inkApplyStrokeEntry === 'function' && inkApplyStrokeEntry(delta, 'undo')) {
        redoStack.push(raw);
        applied = true;
        return;
      }
      if (typeof inkUndoRasterDropRaw === 'function') inkUndoRasterDropRaw(raw);
      if (typeof maskSnapReleaseRaw === 'function') maskSnapReleaseRaw(raw);
      continue;
    }
    // Artımlı geri yükleme için önceki çizim durumunu sakla: yalnızca
    // gerçekten değişen katman/bölge yeniden raster edilir.
    const prevInk = state.ink;
    /* Kamera (yakınlaştırma/kaydırma) geri-alınacak bir düzenleme değil:
       snapshot'taki görünüm uygulanırsa son işlemden sonra yakınlaştıran
       kullanıcının görünümü Ctrl+Z'de eski yerine sıçrar. Görünüm korunur. */
    const keepView = state.view;
    redoStack.push(maskSnapStringify(createStateSnapshot()));
    restoreSnapshot(parsed);
    state.view = keepView;
    selection.clear();
    editingId = null;
    applyView(); applyBackdrop(); syncAll(); scheduleSave();
    if (typeof inkAfterRestore === 'function') inkAfterRestore(prevInk);
    applied = true;
    return;
  }
  if (!applied && typeof showProjectNotice === 'function') {
    showProjectNotice('Nothing to undo', 1600);
  }
}

function redo() {
  undoCancelActiveStroke();
  /* undo() ile aynı sözleşme: hiçbir kayıt uygulanamazsa görünür bildirim. */
  let guard = 0;
  let applied = false;
  while (redoStack.length && guard++ < 12) {
    const raw = redoStack.pop();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const delta = typeof inkStrokeEntry === 'function' ? inkStrokeEntry(parsed) : null;
    if (delta) {
      if (typeof inkApplyStrokeEntry === 'function' && inkApplyStrokeEntry(delta, 'redo')) {
        undoStack.push(raw);
        applied = true;
        return;
      }
      if (typeof inkUndoRasterDropRaw === 'function') inkUndoRasterDropRaw(raw);
      if (typeof maskSnapReleaseRaw === 'function') maskSnapReleaseRaw(raw);
      continue;
    }
    const prevInk = state.ink;
    const keepView = state.view;
    undoStack.push(maskSnapStringify(createStateSnapshot()));
    restoreSnapshot(parsed);
    state.view = keepView;
    selection.clear();
    editingId = null;
    applyView(); applyBackdrop(); syncAll(); scheduleSave();
    if (typeof inkAfterRestore === 'function') inkAfterRestore(prevInk);
    applied = true;
    return;
  }
  if (!applied && typeof showProjectNotice === 'function') {
    showProjectNotice('Nothing to redo', 1600);
  }
}

/* =========================================================
   görünüm
   ========================================================= */
let viewScrollGuardRaf = 0;
function applyView() {
  const v = state.view;
  world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  world.style.setProperty('--inv', String(1 / v.scale));
  /* Güvenlik ağı: sahne kaydırılırsa tüm ekran↔dünya hesapları kayar.
     AŞAMA-ÖLÇÜM (zoom-drill): bu okuma transform YAZIMININ hemen ardından
     gelirse her zoom/pan olayında ZORLAMALI SENKRON LAYOUT çalışır — 120
     öğelik tahtada 300 wheel'de 2,3-2,7 sn longtask (ort ~125 ms/kare).
     Düzeltme: okuma+yazma kare sınırına (rAF, tek kez) kaydırılır; panel
     davranışı değişmez, per-olay layout temizlenmez → layout yalnız bir
     kez/frame doğal akışta çalışır. */
  if (!viewScrollGuardRaf) {
    viewScrollGuardRaf = requestAnimationFrame(() => {
      viewScrollGuardRaf = 0;
      if (stage.scrollLeft || stage.scrollTop) { stage.scrollLeft = 0; stage.scrollTop = 0; }
    });
  }
  zoomEl.textContent = Math.round(v.scale * 100) + '%';
  if (typeof queueToolbarLayout === 'function') queueToolbarLayout();
  if (typeof updateItemBar === 'function') updateItemBar();
  if (typeof updateGroupTitles === 'function') updateGroupTitles();
  if (typeof scheduleLinks === 'function') scheduleLinks();
  if (typeof inkViewChanged === 'function') inkViewChanged();
}

/* =========================================================
   bağlantı okları ("Bind")
   İki fotoğraf seçilip Bağla denince ilk seçilenden ikinciye
   bir ok çizilir; ok her zaman fotoğrafların kenarına yapışık
   kalır, nereye taşınırsa taşınsın kopmaz.
   ========================================================= */
const SVG_NS = 'http://www.w3.org/2000/svg';
const linkLayerEl = $('#linkLayer');
const linkNodes = new Map();
let linkRaf = 0;
