/* TailRef app — Referans / Çizim çalışma modları
   ------------------------------------------------------------------
   Aynı pencerede iki ayrı program gibi davranan iki mod:

     Referans  → sonsuz referans tahtası (mevcut tüm tahta arayüzü)
     Çizim     → yalnızca seçili görsele odaklanan tam ekran atölye

   Kurallar:
   - Aynı anda yalnızca bir mod etkindir; `body.mode-draw` /
     `body.mode-reference` sınıfı tahta kabuğunu ve çizim kabuğunu
     birbirinden ayırır.
   - Çizim moduna giriş/çıkış tek kapıdan yapılır (`modeEnterDraw` /
     `modeExitDraw`); doğrudan `inkEnterImageScope` çağrıları da
     `inkEditorOpen/Close` üzerinden modu senkronlar.
   - Tahta kısayolları çizim modunda çalışmaz; çizim kısayolları
     referans modunda çalışmaz. Böylece "iki program" birbirine karışmaz. */

'use strict';

const appModeUi = {
  mode: 'reference',
  itemId: null,
  bound: false,
};

function modeIsDraw() {
  return appModeUi.mode === 'draw';
}

function modeIsReference() {
  return !modeIsDraw();
}

/** Seçimde tam olarak bir görsel varsa onu döndürür. */
function modeSelectedImage() {
  if (typeof selectedImageItems !== 'function') return null;
  const list = selectedImageItems();
  return list.length === 1 ? list[0] : null;
}

/* 3D Poz: çizim/referans gibi AYRI bir çalışma ortamı — aynı anda
   yalnız birisi aktiftir. */
function modeIs3d() {
  return appModeUi.mode === '3d';
}

function modeDisplayName(item) {
  if (!item) return 'Image';
  const name = item.title || item.name || '';
  return name ? String(name) : 'Image';
}

/** Mod göstergesini (üst anahtar, başlık, gövde sınıfları) eşitler. */
function modeSyncUi() {
  const draw = modeIsDraw();
  const three = modeIs3d();
  const body = document.body;
  if (body) {
    body.classList.toggle('mode-draw', draw);
    body.classList.toggle('mode-reference', !draw);
    body.classList.toggle('mode-3d', three);
  }

  const bar = document.getElementById('appModeBar');
  if (bar) bar.dataset.mode = draw ? 'draw' : three ? '3d' : 'reference';
  // 3D panel gibi diğer bileşenler mod değişimini duysun.
  window.dispatchEvent(new CustomEvent('tailref-mode-changed', {
    detail: { mode: draw ? 'draw' : three ? '3d' : 'reference' },
  }));

  const selected = modeSelectedImage();
  const refBtn = document.getElementById('modeRefBtn');
  const drawBtn = document.getElementById('modeDrawBtn');
  const tab3d = document.getElementById('mode3dBtn');
  const newBtn = document.getElementById('modeNewBtn');
  const nameEl = document.getElementById('modeDrawName');

  if (refBtn) {
    refBtn.classList.toggle('is-active', !draw && !three);
    refBtn.setAttribute('aria-selected', draw || three ? 'false' : 'true');
    refBtn.title = __t(draw || three ? 'Switch to Reference mode (Ctrl+2)' : 'Reference board (Ctrl+2)');
    // Segment etiketi sabittir; mod değişimi yalnızca seçim durumuyla anlatılır.
    const label = refBtn.querySelector('.modeBtnText');
    if (label) label.textContent = __t('Reference');
  }

  if (tab3d) {
    tab3d.classList.toggle('is-active', three);
    tab3d.setAttribute('aria-selected', String(three));
    tab3d.title = __t(three ? '3D pose mode active (Ctrl+3)' : '3D character pose (Ctrl+3)');
  }

  if (drawBtn) {
    // Mod anahtarı asla kilitlenmez: seçim yoksa "Drawing" yeni tuval
    // boyutu sorar. Önceden disabled kaldığı için sağ üstten mod
    // değiştirilemiyor sanılıyordu.
    drawBtn.classList.toggle('is-active', draw);
    drawBtn.setAttribute('aria-selected', draw ? 'true' : 'false');
    drawBtn.disabled = false;
    drawBtn.title = __t(draw
      ? 'Drawing mode (Ctrl+1)'
      : selected
        ? 'Open drawing mode on the selected image (Ctrl+1)'
        : 'New drawing canvas, ask size (Ctrl+1)');
  }

  if (newBtn) {
    newBtn.title = __t('New drawing canvas (ask pixel size)');
    newBtn.setAttribute('aria-label', __t('New drawing canvas'));
  }

  if (nameEl) {
    const item = draw && appModeUi.itemId ? getItem(appModeUi.itemId) : null;
    // Düzenleme sürerken metni ezme; yalnızca görünürlüğü eşitle.
    if (nameEl.dataset.editing !== '1') nameEl.textContent = draw ? modeDisplayName(item) : '';
    nameEl.hidden = !draw;
  }

  /* Tooltip'ler AŞAĞI açılır: pencere tepesindeki native title
     yukarı taşarak kirpilip okunmaz oluyordu (kullanıcı 8 Kasım).
     modeSyncUi her seferinde title'ları yeniden yazdığından dönüş
     BURADA yapılır; native title kalkar, kendi data-tooltip
     sistemine (style.css tooltip-pop-down) taşınır. */
  for (const btn of document.querySelectorAll('#appModeBar button[title]')) {
    const tip = btn.getAttribute('title');
    btn.removeAttribute('title');
    if (tip && !btn.hasAttribute('data-tooltip')) btn.setAttribute('data-tooltip', tip);
  }
}

/** Çizim üst çubuğundaki tuval adını yerinde düzenlemeyi bitirir. */
function modeCommitCanvasName() {
  const nameEl = document.getElementById('modeDrawName');
  if (!nameEl || nameEl.dataset.editing !== '1') return;
  const prev = nameEl.dataset.prevName || '';
  const next = String(nameEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 64);
  delete nameEl.dataset.editing;
  delete nameEl.dataset.prevName;
  nameEl.contentEditable = 'false';
  nameEl.removeAttribute('contenteditable');
  nameEl.title = __t('Double-click to rename');
  const item = modeIsDraw() && appModeUi.itemId ? getItem(appModeUi.itemId) : null;
  if (!item) { modeSyncUi(); return; }
  if (next && next !== prev) {
    item.title = next;
    item.name = next;
    if (typeof scheduleSave === 'function') scheduleSave();
    if (typeof syncAll === 'function') syncAll();
  }
  modeSyncUi();
}

/** Yerinde ad düzenlemesini iptal eder. */
function modeCancelCanvasName() {
  const nameEl = document.getElementById('modeDrawName');
  if (!nameEl || nameEl.dataset.editing !== '1') return;
  delete nameEl.dataset.editing;
  delete nameEl.dataset.prevName;
  nameEl.contentEditable = 'false';
  nameEl.removeAttribute('contenteditable');
  nameEl.title = __t('Double-click to rename');
  modeSyncUi();
}

/** Tuval adına çift tıklayınca yerinde düzenleme başlatır. */
function modeBeginCanvasRename() {
  const nameEl = document.getElementById('modeDrawName');
  if (!nameEl || nameEl.dataset.editing === '1') return;
  if (!modeIsDraw() || !appModeUi.itemId) return;
  nameEl.dataset.editing = '1';
  nameEl.dataset.prevName = nameEl.textContent;
  nameEl.contentEditable = 'plaintext-only';
  nameEl.title = 'Enter: save · Esc: cancel';
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}

/** Çizim moduna geç. Tek görsel seçili değilse false döner. */
function modeEnterDraw(itemId) {
  if (modeIs3d()) modeExit3d();
  const item = typeof getItem === 'function' ? getItem(itemId) : null;
  if (!item || item.kind !== 'image') return false;
  if (typeof inkEnterImageScope !== 'function') return false;

  if (modeIsDraw() && appModeUi.itemId === itemId) return true;
  if (modeIsDraw()) modeExitDraw();

  // Mod anahtarı tahtadaki seçimle aynı görseli göstersin.
  if (typeof selection !== 'undefined' && typeof selectionOrder !== 'undefined') {
    if (selection.size !== 1 || !selection.has(itemId)) {
      selection = new Set([itemId]);
      selectionOrder = [itemId];
      if (typeof syncSelection === 'function') syncSelection();
    }
  }

  // Referans tahtasının görünümü, çizim için görsel çerçevelenmeden ÖNCE
  // saklanmalı; çıkışta birebir bu görünüme dönülür.
  if (typeof dpCaptureRefView === 'function') dpCaptureRefView();

  const ok = inkEnterImageScope(itemId);
  if (!ok) return false;
  if (typeof inkEditorIsOpen === 'function' && !inkEditorIsOpen()) return false;

  appModeUi.mode = 'draw';
  appModeUi.itemId = itemId;
  modeSyncUi();
  /* FX paneli önceki görselin efekt yığınını göstermeye devam ediyordu:
     v5 paneli yeniden kurulmadığı için FX sekmesi açık kalıyor ve
     `inkSyncFxPanel` çağrılmıyordu → B görselinde A'nın efektleri
     listeleniyordu (kontroller tepkisiz). Kapsam değişince tazele. */
  if (typeof inkSyncFxPanel === 'function') inkSyncFxPanel();
  if (typeof showProjectNotice !== 'function') { /* isteğe bağlı */ }
  return true;
}

/** 3D Poz moduna geç: tek kapıdan açılır, her zaman tam ekran.
    Paneli küçültmek YOK; başka bir sekmeye geçişle moddan çıkılır. */
function modeEnter3d() {
  if (modeIs3d()) return true;
  /* prevMode VE açık kâğıt, modeExitDraw modu referansa çevirmeden ÖNCE
     saklanmalı: modeExitDraw appModeUi.mode = 'reference' yazar; önce
     alınmasa prevMode hiçbir zaman 'draw' olmaz ve çıkışta çizim
     oturumu geri açılamaz. */
  appModeUi.prevDrawItem = modeIsDraw() ? appModeUi.itemId : null;
  appModeUi.prevMode = appModeUi.mode;
  if (modeIsDraw()) modeExitDraw();
  appModeUi.itemId = null;
  appModeUi.mode = '3d';
  /* Tam ekran sınıfı panel gösterilmeden ÖNCE uygulanır: aksi halde
     openPanel önce küçük yüzen boyutu kilitliyor, kullanıcı küçük
     pencereyi görüp büyümeyi izliyordu. Bu panelin küçük ekran modu
     kalktı; her zaman tam ekran (kullanıcı, 12 Kasım). */
  const panel = document.getElementById('pose3dPanel');
  if (typeof window.pose3dFullscreenSet === 'function') {
    window.pose3dFullscreenSet(true);
  } else {
    panel?.classList.add('pose3d-fullscreen');
    document.body.classList.add('pose3d-fullscreen-open');
  }
  if (panel && panel.hidden) {
    if (window.tailrefOpenPanel) window.tailrefOpenPanel(panel);
    else panel.hidden = false;
  }
  modeSyncUi();
  return true;
}

/** 3D Poz modundan çık: panel kapanır. Çizim'den gelindiyse çizim oturumu
    aynı kâğıtla geri açılır; açıkça Referans isteniyorsa (Referans sekmesi
    vb.) opts.toReference ile referans tahtasına dönülür. */
function modeExit3d(opts) {
  if (!modeIs3d()) return false;
  window.pose3dFullscreenSet?.(false);
  const panel = document.getElementById('pose3dPanel');
  if (panel) {
    if (window.tailrefClosePanel) window.tailrefClosePanel(panel);
    else panel.hidden = true;
  }
  const fromDraw = appModeUi.prevMode === 'draw' && !(opts && opts.toReference);
  const drawItem = appModeUi.prevDrawItem;
  delete appModeUi.prevMode;
  delete appModeUi.prevDrawItem;
  appModeUi.mode = 'reference';
  appModeUi.itemId = null;
  modeSyncUi();
  /* Çizimden gelindiyse çizimi geri aç; kâğıt bu arada kalktıysa
     modeEnterDraw false döner ve güvenle Referans'ta kalınır. */
  if (fromDraw && drawItem && typeof modeEnterDraw === 'function') {
    modeEnterDraw(drawItem);
  }
  return true;
}

/** Referans tahtasına dön. Tahta görünümü, seçim ve önceki araç korunur. */
function modeExitDraw() {
  if (typeof inkExitImageScope === 'function') inkExitImageScope();
  appModeUi.mode = 'reference';
  appModeUi.itemId = null;
  modeSyncUi();
  const stageEl = document.getElementById('stage');
  if (stageEl && typeof stageEl.focus === 'function') {
    try { stageEl.focus({ preventScroll: true }); } catch { /* sessiz */ }
  }
  return true;
}

/** Çizim editörü açıldığında (hangi yoldan gelirse gelsin) modu eşitler. */
function modeNotifyEditorOpened(itemId) {
  if (!appModeUi.bound) modeBind();
  /* 3D'den doğrudan çizim açılamaz: önce 3D modu dürüstçe kapat.
     Editör zaten yeni bir kâğıtla açılıyor — eski oturumu geri açma
     (toReference) yoksa iki editör açılışı birbirine girer. */
  if (modeIs3d()) modeExit3d({ toReference: true });
  appModeUi.mode = 'draw';
  appModeUi.itemId = itemId || appModeUi.itemId;
  modeSyncUi();
}

/** Çizim editörü kapandığında modu referansa döndürür. */
function modeNotifyEditorClosed() {
  appModeUi.mode = 'reference';
  appModeUi.itemId = null;
  modeSyncUi();
}

/** Sağ üstteki "Drawing" sekmesi: seçili görsel varsa onu, yoksa yeni tuval açar. */
function modeActivateDraw() {
  if (modeIsDraw()) return true;
  if (modeIs3d()) modeExit3d();
  const item = modeSelectedImage();
  if (item) return modeEnterDraw(item.id);
  return modeOpenNewCanvas();
}

/** Yeni tuval: her zaman piksel boyutu, ad ve arka planı soran pencereyi
    açar. Seçim yokken çizim moduna geçiş de bu pencereyi kullanır. */
function modeOpenNewCanvas() {
  if (typeof newCanvasOpen === 'function') {
    newCanvasOpen();
    return true;
  }
  if (typeof showProjectNotice === 'function') {
    showProjectNotice('New canvas window could not load.', 2600);
  }
  return false;
}

/** Tek bir görselde çizim modunu açar; yoksa yeni tuval boyutu sorar. */
function modeToggleDrawForSelection() {
  if (modeIsDraw()) return modeExitDraw();
  const item = modeSelectedImage();
  if (!item) return modeOpenNewCanvas();
  return modeEnterDraw(item.id);
}

function modeBind() {
  if (appModeUi.bound) return true;
  const bar = document.getElementById('appModeBar');
  if (!bar) return false;

  const refBtn = document.getElementById('modeRefBtn');
  const drawBtn = document.getElementById('modeDrawBtn');
  const newBtn = document.getElementById('modeNewBtn');
  if (!refBtn || !drawBtn) return false;

  refBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    // Referans sekmesi açıkça referans ister: çizimden gelinse bile çizim
    // oturumu geri açılmaz (bkz. modeExit3d opts.toReference).
    if (modeIs3d()) modeExit3d({ toReference: true });
    else if (modeIsDraw()) modeExitDraw();
    else modeSyncUi();
  });

  /* 3D Poz sekmesi: ayrı bir çalışma ortamı. Aynı anda yalnız biri aktif. */
  const tab3d = document.getElementById('mode3dBtn');
  if (tab3d) {
    tab3d.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (appModeUi.mode === '3d') return;
      modeEnter3d();
    });
  }

  drawBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    // Çizim sekmesi bir "sekme" gibi davranır: çizimdeyken tekrar
    // tıklamak moddan çıkarmaz, yalnızca çalışma alanını korur.
    modeActivateDraw();
  });

  if (newBtn) {
    newBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      // Shift+tık: piksel boyutu ve arka plan seçilen ayrıntılı pencere.
      modeOpenNewCanvas(!!event.shiftKey);
    });
  }

  /* Çizim üst çubuğundaki tuval adı: çift tıkla yeniden adlandır. */
  const nameEl = document.getElementById('modeDrawName');
  if (nameEl && nameEl.dataset.renameBound !== '1') {
    nameEl.dataset.renameBound = '1';
    nameEl.title = __t('Double-click to rename');
    nameEl.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      modeBeginCanvasRename();
    });
    nameEl.addEventListener('keydown', event => {
      if (nameEl.dataset.editing !== '1') return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        modeCommitCanvasName();
        nameEl.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        modeCancelCanvasName();
        nameEl.blur();
      }
    });
    nameEl.addEventListener('blur', () => {
      if (nameEl.dataset.editing === '1') modeCommitCanvasName();
    });
  }

  // Pano değişirse çizim modu açık kalmaz: her pano kendi belgesidir.
  // 3D pozu pano verisine bağlı değildir; proje geçişi onu kapatmaz.
  window.addEventListener('tailref-project-changed', () => {
    if (modeIsDraw()) modeExitDraw();
    else modeSyncUi();
  });

  appModeUi.bound = true;
  modeSyncUi();
  return true;
}

queueMicrotask(() => {
  if (modeBind()) return;
  /* DOM geç hazırlanırsa da kaçırma: mod anahtarı mutlaka bağlanmalı. */
  const iv = setInterval(() => { if (modeBind()) clearInterval(iv); }, 120);
  setTimeout(() => clearInterval(iv), 10000);
});

/* pose3d UI katmanı (PanelController/Hud) ve kısayollar için global erişim.
   app.js tek paket içinde derlenir ama pose3d modülleri `typeof`
   guard'larıyla window'dan bakan senaryolar çağırıyor olabilir. */
window.modeEnter3d = window.modeEnter3d || modeEnter3d;
window.modeExit3d = window.modeExit3d || modeExit3d;
window.modeIs3d = window.modeIs3d || modeIs3d;

/* Dil değişince mod çubuğu başlıkları/etiketleri (dinamik yazım) tazelensin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { modeSyncUi(); } catch { /* sessiz */ } });
}

/* =========================================================
   Üst şerit daraltma oku (#appModeCollapse) — SLIDER WIPE
   Ok şeridin sol kenarına çapalı tutamaçtır. Kapanış soldan
   sağa wipe: ok kenarla birlikte sağa kayar, üzerinden
   geçtiği menüler kırpılarak kaybolur; geride yalnız pencere
   düğmeleri kalır, ok sola döner. Açılışta aynı wipe tersine
   oynar. Durum localStorage'da saklanır. */
const APPMODE_COLLAPSE_KEY = 'tailref-appmode-collapsed-v1';
const APPMODE_WIPE_MS = 340;   /* CSS transition .32s + pay */
let appModeWipeTimer = null;
let appModeWiping = false;

function appModeFoldables() {
  const bar = document.getElementById('appModeBar');
  if (!bar) return [];
  return [...bar.querySelectorAll(
    '.modeSeg, .psDockCollapse, .overflowToggle, #modeDrawName, #btnInkWorkspace, .v5-mode-divider'
  )];
}

function appModeApplyState(bar, btn, on) {
  bar.classList.toggle('appMode-collapsed', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/* Barın tam ve dar genişliğini ölçer; ölçüm sonrası görünüm eski haline döner.
   (appMode-collapsed çocukları display:none yaptığından her iki uç da
   sınıf geçici olarak takılarak ölçülür; senkron kodda paint olmaz.) */
function appModeBarWidths(bar) {
  const collapsed = bar.classList.contains('appMode-collapsed');
  let full, slim;
  if (collapsed) {
    slim = bar.offsetWidth;
    bar.classList.remove('appMode-collapsed');
    full = bar.offsetWidth;
    bar.classList.add('appMode-collapsed');
  } else {
    full = bar.offsetWidth;
    bar.classList.add('appMode-collapsed');
    slim = bar.offsetWidth;
    bar.classList.remove('appMode-collapsed');
  }
  return { full, slim };
}

function setAppModeCollapsed(on, animate = true) {
  const bar = document.getElementById('appModeBar');
  const btn = document.getElementById('appModeCollapse');
  if (!bar || !btn) return;
  clearTimeout(appModeWipeTimer);
  appModeWipeTimer = null;
  /* Kesintiye uğramış bir wipe varsa temizle. */
  bar.classList.remove('appMode-anim');
  bar.style.width = '';

  appModeFoldables().forEach(el => el.classList.add('appModeFoldable'));

  const reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduced) {
    appModeWiping = false;
    appModeApplyState(bar, btn, on);
    return;
  }

  const { full, slim } = appModeBarWidths(bar);
  const from = on ? full : slim;
  const to = on ? slim : full;
  if (from === to || !from || !to) {
    appModeWiping = false;
    appModeApplyState(bar, btn, on);
    return;
  }

  appModeWiping = true;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) {
    /* Kapanış: çocuklar görünür kalır, genişlik akarken overflow kırpılır. */
    bar.classList.add('appMode-anim');
    bar.style.width = from + 'px';
  } else {
    /* Açılış: dar durumdan tam genişliğe; çocuklar hemen gelir, genişlik akar. */
    bar.classList.remove('appMode-collapsed');
    bar.classList.add('appMode-anim');
    bar.style.width = from + 'px';
  }
  void bar.offsetWidth; /* başlangıç genişliğini kilitle */
  requestAnimationFrame(() => { bar.style.width = to + 'px'; });

  appModeWipeTimer = setTimeout(() => {
    appModeWipeTimer = null;
    appModeWiping = false;
    bar.classList.remove('appMode-anim');
    bar.style.width = '';
    appModeApplyState(bar, btn, on);
  }, APPMODE_WIPE_MS);
}

(function initAppModeCollapse() {
  const btn = document.getElementById('appModeCollapse');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (appModeWiping) return; /* wipe sürerken yeniden tetikleme yok */
    const bar = document.getElementById('appModeBar');
    const on = !bar.classList.contains('appMode-collapsed');
    try { localStorage.setItem(APPMODE_COLLAPSE_KEY, on ? '1' : ''); } catch { /* sessiz */ }
    setAppModeCollapsed(on);
  });
  let saved = '';
  try { saved = localStorage.getItem(APPMODE_COLLAPSE_KEY) || ''; } catch { /* sessiz */ }
  if (saved === '1') setAppModeCollapsed(true, false);
})();
