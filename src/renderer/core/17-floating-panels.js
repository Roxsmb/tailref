/* TailRef app · floating panel geometry and gestures */
'use strict';

/* Yüzen paneller tek bir z-index bandında yaşar. Her panel tutulduğunda
   öne alınır; böylece başka bir panelin (veya araç çubuğunun) altında kalan
   panel görünür bir yerinden tutulup öne getirilebilir. Tam ekran 3D paneli
   bu bandın çok üstünde kalır (CSS'te 9000!important). */
const FLOATING_Z_BASE = 2300;
const FLOATING_Z_LIMIT = 140;
let floatingZCounter = 0;

/* Panelin gerçek (etkin) z-index'i: satır içi değer yoksa CSS'ten okunur. */
function floatingPanelZ(panel) {
  const inline = Number.parseInt(panel.style.zIndex, 10);
  if (Number.isFinite(inline)) return inline;
  const computed = Number.parseInt(getComputedStyle(panel).zIndex, 10);
  return Number.isFinite(computed) ? computed : 0;
}

function raiseFloatingPanel(panel) {
  if (!panel || panel.hidden) return 0;
  if (panel.dataset.floatingPanel !== 'true') return 0;
  if (panel.classList.contains('pose3d-fullscreen')) return floatingPanelZ(panel);
  floatingZCounter += 1;
  if (floatingZCounter > FLOATING_Z_LIMIT) {
    // Sayaç taşmasın: tüm panelleri banda geri al, sıra yeniden kurulur.
    for (const other of document.querySelectorAll('[data-floating-panel="true"]')) {
      if (!other.classList.contains('pose3d-fullscreen')) other.style.removeProperty('z-index');
    }
    floatingZCounter = 1;
  }
  const z = FLOATING_Z_BASE + floatingZCounter * 4;
  panel.style.zIndex = String(z);
  return z;
}

/* =========================================================
   Pinterest / ArtStation paneli tam ekran
   ---------------------------------------------------------
   Panel pencereyi kaplar; gerçek tam ekran isteği reddedilse bile
   görünüm uygulanır. Ayrı penceredeki kopya kendi penceresini tam
   ekrana alır (panel-window.js). */
const BROWSER_FULLSCREEN_CLASS = 'browser-fullscreen';

function browserPanelIsFullscreen(panel) {
  return !!(panel && panel.classList.contains(BROWSER_FULLSCREEN_CLASS));
}

function paintBrowserFullscreenButton(panel, on) {
  const button = panel && panel.querySelector('[data-panel-fullscreen="1"]');
  if (!button) return;
  const active = !!on;
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  const title = active ? 'Exit fullscreen (Esc)' : 'Full screen';
  button.title = title;
  button.setAttribute('aria-label', title);
  const use = button.querySelector('.toolIcon use');
  if (use) use.setAttribute('href', active ? '#icon-restore' : '#icon-maximize');
}

function setBrowserPanelFullscreen(panel, on) {
  if (!panel) return false;
  const active = !!on;
  panel.classList.toggle(BROWSER_FULLSCREEN_CLASS, active);
  document.body.classList.toggle('browser-panel-fullscreen-open', active);
  paintBrowserFullscreenButton(panel, active);
  if (active) {
    if (!document.fullscreenElement) {
      try {
        const request = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        if (request && request.catch) request.catch(() => { /* pencere içi görünüm yeterli */ });
      } catch { /* tam ekran desteklenmiyor */ }
    }
  } else if (document.fullscreenElement) {
    try {
      const exit = document.exitFullscreen();
      if (exit && exit.catch) exit.catch(() => { /* zaten kapalı */ });
    } catch { /* sessiz */ }
  }
  return active;
}

function toggleBrowserPanelFullscreen(panel) {
  if (!panel) return false;
  return setBrowserPanelFullscreen(panel, !browserPanelIsFullscreen(panel));
}

function exitBrowserPanelFullscreen(panel) {
  if (!browserPanelIsFullscreen(panel)) return false;
  return setBrowserPanelFullscreen(panel, false);
}

function exitAnyBrowserPanelFullscreen() {
  let exited = false;
  for (const panel of document.querySelectorAll(`.${BROWSER_FULLSCREEN_CLASS}`)) {
    exited = exitBrowserPanelFullscreen(panel) || exited;
  }
  return exited;
}

/* Kullanıcı Esc ile gerçek tam ekrandan çıkarsa panel görünümü de kapansın. */
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) exitAnyBrowserPanelFullscreen();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (exitAnyBrowserPanelFullscreen()) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);


/* Bir panel başka bir panelin tamamen altında kalırsa hiçbir yerine tıklanamaz
   ve bir daha tutulamaz. Bu yüzden panelin birkaç noktasından fare isabeti
   yoklanır: hiçbiri panele ulaşmıyorsa panel "gömülü" sayılır ve araç
   çubuğundaki düğmesi paneli gizlemek yerine öne alır. */
function floatingHitPoints(panel) {
  const rect = panel.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24) return null;
  const points = [
    [0.5, 0.15], [0.5, 0.5], [0.15, 0.5],
    [0.85, 0.5], [0.5, 0.85], [0.3, 0.3], [0.7, 0.7],
  ];
  return points.map(([fx, fy]) => [rect.left + rect.width * fx, rect.top + rect.height * fy]);
}

function floatingPanelIsCovered(panel) {
  if (!panel || panel.hidden) return false;
  const points = floatingHitPoints(panel);
  if (!points) return false;
  for (const [x, y] of points) {
    if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === panel || panel.contains(hit))) return false;
  }
  return true;
}

function floatingEdgeAt(panel, event) {
  const rect = panel.getBoundingClientRect();
  const tolerance = 9;
  const onLeft = event.clientX - rect.left <= tolerance;
  const onRight = rect.right - event.clientX <= tolerance;
  const onTop = event.clientY - rect.top <= tolerance;
  const onBottom = rect.bottom - event.clientY <= tolerance;
  return `${onTop ? 'n' : ''}${onBottom ? 's' : ''}${onLeft ? 'w' : ''}${onRight ? 'e' : ''}`;
}
const FLOATING_MARGIN = 8;
const FLOATING_TOOLBAR_GAP = 12;

function floatingDesktop() {
  return !!(window.tailref && window.tailref.isDesktop)
    || document.documentElement.classList.contains('desktop');
}

/* Üst sınır: masaüstünde #windowDragStrip (0–64 px) ve üst dock (#barDock,
   top:64 px) burada durur. Panel başlığı bu bölgeye girerse Electron sürükleme
   şeridi tıklamayı yutuyor, paneli tutmak yerine pencere taşınıyor ve panel bir
   daha yakalanamıyordu. Bu yüzden paneller dock'un altında başlar. */
function floatingDockRect() {
  const dock = document.getElementById('barDock') || document.getElementById('bar');
  if (!dock) return null;
  const style = getComputedStyle(dock);
  if (style.display === 'none' || style.visibility === 'hidden') return null;
  const rect = dock.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return rect;
}

function floatingTopLimit() {
  let limit = floatingDesktop() ? 68 : FLOATING_MARGIN;
  const dock = floatingDockRect();
  /* Dock üst yarıdaysa paneller onun altında başlar. Bar gizliyken yalnızca
     kendisi yukarı kayar; dock kutusu yerinde kaldığı için alan korunur. */
  if (!dock || dock.top > innerHeight / 2) return limit;
  return Math.max(limit, dock.bottom + FLOATING_TOOLBAR_GAP);
}

/* Alt dock kullanılıyorsa panel alanı onun üstünde biter; böylece ana araç
   çubuğu hiçbir zaman bir panelin altında ezilmez. */
function floatingBottomLimit() {
  const fallback = innerHeight - FLOATING_MARGIN;
  const dock = floatingDockRect();
  if (!dock || dock.top <= innerHeight / 2) return fallback;
  return Math.max(floatingTopLimit() + 80, dock.top - FLOATING_TOOLBAR_GAP);
}

function floatingPanelLimits(panel) {
  const styles = getComputedStyle(panel);
  const read = (name, fallback) => {
    const value = parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const viewportWidth = Math.max(160, innerWidth - 16);
  const topLimit = floatingTopLimit();
  const bottomLimit = floatingBottomLimit();
  const viewportHeight = Math.max(100, bottomLimit - topLimit);
  const minWidth = Math.min(read('--panel-min-w', 240), viewportWidth);
  const minHeight = Math.min(read('--panel-min-h', 120), viewportHeight);
  const maxWidth = Math.max(minWidth, Math.min(read('--panel-max-w', viewportWidth), viewportWidth));
  const maxHeight = Math.max(minHeight, Math.min(read('--panel-max-h', viewportHeight), viewportHeight));
  return { minWidth, minHeight, maxWidth, maxHeight, topLimit, bottomLimit };
}
function panelLayoutRect(panel) {
  const rect = panel.getBoundingClientRect();
  const styles = getComputedStyle(panel);
  const scale = Number.parseFloat(styles.scale) || 1;
  const translate = styles.translate && styles.translate !== 'none'
    ? styles.translate.split(/\s+/)
    : [];
  const tx = Number.parseFloat(translate[0]) || 0;
  const ty = Number.parseFloat(translate[1]) || 0;
  const width = rect.width / scale;
  const height = rect.height / scale;
  const centerX = rect.left + rect.width / 2 - tx;
  const centerY = rect.top + rect.height / 2 - ty;
  return { left: centerX - width / 2, top: centerY - height / 2, width, height };
}
function constrainFloatingPanel(panel) {
  const rect = panelLayoutRect(panel);
  /* Ölçülemez panel (display:none → 0x0) constrain çöpü yazardı: sol üst
     8,topLimit + CSS varsayılan boyut. Kullanıcı: "çizim turundan dönünce
     Seçim Özellikleri solda belirmiş". Ölçü yokken dokunma; panel
     görünür olduğunda mevcut inline konumu geçerli kalır (16 Kasım 2026). */
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  const limits = floatingPanelLimits(panel);
  const availableHeight = Math.max(limits.minHeight, limits.bottomLimit - limits.topLimit);
  const width = clamp(rect.width, limits.minWidth, limits.maxWidth);
  const height = clamp(rect.height, limits.minHeight, Math.min(limits.maxHeight, availableHeight));
  const left = clamp(rect.left, FLOATING_MARGIN, Math.max(FLOATING_MARGIN, innerWidth - width - FLOATING_MARGIN));
  const top = clamp(rect.top, limits.topLimit, Math.max(limits.topLimit, limits.bottomLimit - height));
  panel.style.position = 'fixed';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
}
function saveFloatingPanel(panel) {
  if (!panel.id || panel.id === 'contextMenu') return;
  /* Tam ekran ölçüleri kalıcı düzen olarak kaydedilmesin. */
  if (browserPanelIsFullscreen(panel)) return;
  const rect = panelLayoutRect(panel);
  /* Ölçülemez panelin (0x0) çöp düzeni kalıcı kayda yazılmaz. */
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  try {
    localStorage.setItem(`tailref-floating-${panel.id}`, JSON.stringify({
      left: rect.left, top: rect.top, width: rect.width, height: rect.height
    }));
  } catch (error) {
    console.warn(`Floating panel layout could not be saved: ${panel.id}`, error);
  }
}
function clearToolbarOverlap(panel) {
  if (!panel || panel.id === 'contextMenu' || panel.id === 'overflowMenu') return;
  /* Üst/alt dock'a taşan paneli geri çek. constrainFloatingPanel zaten dock
     sınırlarını uygular; burada yalnızca dock gizliyken eski konumdan kalan
     taşmayı temizliyoruz. */
  const limits = floatingPanelLimits(panel);
  const rect = panelLayoutRect(panel);
  const overflowBottom = rect.top + rect.height - limits.bottomLimit;
  const overflowTop = limits.topLimit - rect.top;
  if (overflowBottom > 0.5 || overflowTop > 0.5) constrainFloatingPanel(panel);
}
function prepareFloatingPanel(panel, restore = true) {
  if (!panel || panel.hidden) return;
  /* Tam ekranda panel ekranı kaplar; sabit ölçü yazmak sınıfın !important
     kurallarıyla çakışıp geri dönüşte yanlış boyut bırakabilir. */
  if (panel.classList.contains('pose3d-fullscreen')) return;
  if (browserPanelIsFullscreen(panel)) return;
  if (!panel.dataset.floatingInitialized) {
    panel.dataset.floatingInitialized = 'true';
    if (restore && panel.id) {
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(`tailref-floating-${panel.id}`) || 'null');
      } catch (error) {
        console.warn(`Floating panel layout could not be restored: ${panel.id}`, error);
      }
      // Eski sürümde paneller alt araç çubuğuna göre konumlanıyordu. Üst dock'a
      // geçince kayıtlı üst konum dock'un altına taşınır; boyut korunur.
      const minTop = floatingTopLimit();
      if (saved && Number.isFinite(saved.top) && saved.top < minTop) saved.top = minTop;
      /* Bozuk kayıt savunması (#settings): eski sürüm sürüklemeyi kırpma
         olmadan kaydettiği için panel kenara yapışmış olabiliyordu
         (kullanıcı: "sola çok yakın, ui'dan çıkacak"). Sol kenara gömülü
         kayıt güvenilir sayılmaz; CSS'teki varsayılan konum (sağ üst)
         kullanılır. */
      if (saved && panel.id === 'settings' && Number.isFinite(saved.left) && saved.left < 24) saved = null;
      if (saved && [saved.left, saved.top, saved.width, saved.height].every(Number.isFinite)) {
        panel.style.position = 'fixed';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';
        panel.style.left = `${saved.left}px`;
        panel.style.top = `${saved.top}px`;
        // Yazı panelinin eski sürümden kalan dar genişliği font
        // kontrollerini sıkıştırıyordu; boyut CSS'ten gelsin.
        if (panel.id !== 'inspector') {
          panel.style.width = `${saved.width}px`;
          panel.style.height = `${saved.height}px`;
        }
      }
    }
  }
  constrainFloatingPanel(panel);
  clearToolbarOverlap(panel);
}
function beginFloatingPanelGesture(panel, event, mode) {
  prepareFloatingPanel(panel);
  if (panel === itemBarEl) hideImpWheel();
  // Panel tutulurken odak bir inputta kalırsa Delete gibi kısayollar
  // yutulmaya devam ederdi.
  const active = document.activeElement;
  if (active && active !== document.body &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    active.blur();
  }
  const rect = panelLayoutRect(panel);
  const limits = floatingPanelLimits(panel);
  const startX = event.clientX, startY = event.clientY;
  const startLeft = rect.left, startTop = rect.top;
  const startWidth = rect.width, startHeight = rect.height;
  const canDetach = mode === 'move' && panelCanDetach(panel);
  panel.classList.add('floating-gesture');
  event.preventDefault();
  event.stopPropagation();
  try { panel.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable */ }

  const move = ev => {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    let left = startLeft, top = startTop, width = startWidth, height = startHeight;
    if (mode === 'move') {
      if (canDetach) {
        /* Ayrılabilir paneller pencere kenarını geçebilir; bırakınca
           ayrı bir pencereye taşınırlar. */
        left = startLeft + dx;
        top = startTop + dy;
      } else {
        left = clamp(startLeft + dx, FLOATING_MARGIN, Math.max(FLOATING_MARGIN, innerWidth - width - FLOATING_MARGIN));
        top = clamp(startTop + dy, limits.topLimit, Math.max(limits.topLimit, limits.bottomLimit - height));
      }
    } else {
      if (mode.includes('e')) {
        const maxWidth = Math.max(limits.minWidth, Math.min(limits.maxWidth, innerWidth - startLeft - FLOATING_MARGIN));
        width = clamp(startWidth + dx, limits.minWidth, maxWidth);
      }
      if (mode.includes('s')) {
        const maxHeight = Math.max(limits.minHeight, Math.min(limits.maxHeight, limits.bottomLimit - startTop));
        height = clamp(startHeight + dy, limits.minHeight, maxHeight);
      }
      if (mode.includes('w')) {
        const right = startLeft + startWidth;
        left = clamp(startLeft + dx, Math.max(FLOATING_MARGIN, right - limits.maxWidth), right - limits.minWidth);
        width = right - left;
      }
      if (mode.includes('n')) {
        const bottom = startTop + startHeight;
        top = clamp(startTop + dy, Math.max(limits.topLimit, bottom - limits.maxHeight), bottom - limits.minHeight);
        height = bottom - top;
      }
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.classList.toggle('detach-ready', canDetach && panelShouldDetach(panel));
    ev.preventDefault();
  };
  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    panel.classList.remove('floating-gesture', 'detach-ready');
    const detach = canDetach && panelShouldDetach(panel);
    if (!detach) {
      /* Sürükleme sonunda paneli pencere içine kırp (15 Kasım 2026):
         taşınabilir paneller hareket sırasında kenarı geçebilir; bırakınca
         ayrı pencereye gitmediyse dışarıda kalan kısmı geri çekilir.
         Önceki davranış ham konumu kaydediyordu → panel kenara yapışık/
         kırpık kalabiliyordu (kullanıcı: "ui'dan çıkacak"). */
      constrainFloatingPanel(panel);
      saveFloatingPanel(panel);
    }
    if (detach) void detachPanelToWindow(panel);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', finish, { once: true });
}
// #overflowMenu bilerek dışarıda: araç çubuğundaki ••• düğmesine sabitlenir,
// sürüklenmez ve görünüm değişince kaçmaz.
const floatingPanelSelector = '#settings,#pomodoroPanel,#youtubeMusicPanel,#pose3dPanel,#pinterestPanel,#artstationPanel,#imageEditor,#help,#inspector,#itemBar,#contextMenu';
/* Panel sürüklemesini başlatmayan gerçek denetimler. Bir panelin gövdesinde
   boş cam yüzeye basmak da taşır; böylece başlığı başka bir panelin altında
   kalan panel görünür yerinden tutulup kurtarılabilir. */
const FLOATING_INTERACTIVE_SELECTOR = 'button,input,select,textarea,option,a,label,summary,canvas,iframe,webview,video,audio,[contenteditable="true"],[role="slider"],[role="button"],[role="menuitem"]';
/* Sürükleme tutamacı olarak kabul edilen yüzeyler (başlık + boş gövde). */
const FLOATING_HANDLE_SELECTOR = '.floatingPanelHead,.pose3dHead,.ibTitle,.ambienceHead';
for (const panel of document.querySelectorAll(floatingPanelSelector)) {
  panel.dataset.floatingPanel = 'true';
  panel.addEventListener('pointermove', event => {
    if (panel.hidden || panel.classList.contains('floating-gesture')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.poseAccordion')) { panel.style.cursor = ''; return; }
    const edge = floatingEdgeAt(panel, event);
    panel.style.cursor = edge ? `${edge.length > 1 ? edge : edge[0]}-resize` : '';
  });
  panel.addEventListener('pointerdown', event => {
    if (panel.hidden || event.button !== 0) return;
    /* Tam ekranda panel sabittir: taşıma/boyutlandırma kapalı. */
    if (panel.classList.contains('pose3d-fullscreen')) return;
    if (browserPanelIsFullscreen(panel)) return;
    /* Hangi panel olursa olsun önce öne al: alt/üst komşusunun altında
       kaldığında görünür yerine tıklamak onu kurtarır. */
    raiseFloatingPanel(panel);
    const target = event.target instanceof Element ? event.target : null;
    /* 3D ayar popup'ı kendi başlığından sürüklenir; paneli taşımasın. */
    if (target?.closest('.poseAccordion')) return;
    if (target?.closest(FLOATING_INTERACTIVE_SELECTOR)) return;
    const edge = floatingEdgeAt(panel, event);
    if (edge) {
      beginFloatingPanelGesture(panel, event, edge);
      return;
    }
    const handle = target?.closest(FLOATING_HANDLE_SELECTOR);
    if (handle && panel.contains(handle)) {
      beginFloatingPanelGesture(panel, event, 'move');
      return;
    }
    /* Başlık dışındaki boş cam yüzeyler de tutulabilir: panel kendisi,
       gövde kabı veya içerik sütunu. Gerçek denetimler yukarıdaki erken
       dönüşle korunur. */
    const surface = target === panel
      || target?.classList.contains('floatingPanelBody')
      || target?.classList.contains('poseBody')
      || target?.classList.contains('itemBarContent');
    if (surface) beginFloatingPanelGesture(panel, event, 'move');
  }, true);
}
window.addEventListener('resize', () => {
  for (const panel of document.querySelectorAll(`${floatingPanelSelector}[data-floating-initialized="true"]`)) {
    if (!panel.hidden && !panel.classList.contains('pose3d-fullscreen') && !browserPanelIsFullscreen(panel)) {
      constrainFloatingPanel(panel);
      saveFloatingPanel(panel);
    }
  }
  if (typeof positionOverflowMenu === 'function') positionOverflowMenu();
});
function syncStudioPanelState() {
  const panelTriggers = {
    settings: 'btnSettings',
    pomodoroPanel: 'btnPomodoro',
    youtubeMusicPanel: 'btnYoutubeMusic',
    pose3dPanel: 'btnPose3d',
    pinterestPanel: 'btnPinterest',
    artstationPanel: 'btnArtStation',
    imageEditor: 'btnEditImage',
    help: 'btnHelp'
  };
  const panelStack = Object.entries(panelTriggers)
    .map(([panelId, triggerId]) => {
      const panel = document.getElementById(panelId);
      const trigger = document.getElementById(triggerId);
      if (panel && trigger) trigger.setAttribute('aria-expanded', String(isPanelVisible(panel)));
      return panel;
    })
    .filter(Boolean);
  // Çıkış animasyonu sürerken paneli gizli saymayız; animasyon bitince
  // closeStudioPanel callback'i bu sınıfı kaldırır.
  document.body.classList.toggle('studio-panel-open', panelStack.some(panel => !panel.hidden));
}
syncStudioPanelState();
function openStudioPanel(panel) {
  if (!panel) return false;
  /* Ayrı penceredeyse gizlemek yerine o pencereyi öne getir. */
  if (panel.dataset.detached === '1') {
    void detachPanelToWindow(panel);
    return true;
  }
  /* Panel kapalıysa aç ve her zaman bandın en üstüne al: aksi halde açılan
     panel, önceden öne alınmış başka bir panelin arkasında kalıyordu. */
  if (!isPanelVisible(panel)) {
    showPanel(panel);
    prepareFloatingPanel(panel);
    raiseFloatingPanel(panel);
    syncStudioPanelState();
    return true;
  }
  /* Panel açık ama tamamen başka bir panelin altında kalmışsa gizlemek
     yerine öne al. Kullanıcı aksi halde onu bir daha tutamıyordu. */
  if (floatingPanelIsCovered(panel)) {
    prepareFloatingPanel(panel);
    raiseFloatingPanel(panel);
    syncStudioPanelState();
    return true;
  }
  hidePanel(panel, syncStudioPanelState);
  syncStudioPanelState();
  return false;
}
function closeStudioPanel(panel) {
  hidePanel(panel, syncStudioPanelState);
  syncStudioPanelState();
}
window.tailrefOpenPanel = openStudioPanel;
window.tailrefClosePanel = closeStudioPanel;
window.tailrefPreparePanel = prepareFloatingPanel;
const btnHelpEl = $('#btnHelp');
if (btnHelpEl) btnHelpEl.onclick = () => openStudioPanel(helpEl);
const btnHelpCloseEl = $('#btnHelpClose');
if (btnHelpCloseEl) btnHelpCloseEl.onclick = () => closeStudioPanel(helpEl);
const btnInspector = $('#btnInspector');
btnInspector.onclick = () => {
  const collapsed = document.body.classList.toggle('properties-collapsed');
  btnInspector.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
};