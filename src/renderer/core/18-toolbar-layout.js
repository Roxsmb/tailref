/* TailRef app · responsive layout, overflow menu, toolbar layout */
'use strict';

const compactLayoutQuery = window.matchMedia('(max-width: 1199px)');
function syncResponsiveLayout() {
  const compact = compactLayoutQuery.matches;
  document.body.classList.toggle('compact-ui', compact);
  document.body.classList.toggle('properties-collapsed', compact);
  btnInspector.setAttribute('aria-pressed', compact ? 'false' : 'true');
  if (!compact) closeOverflowMenu();
  queueToolbarLayout();
}
function overflowMenuOpen() {
  return isPanelVisible(overflowMenu);
}
function closeOverflowMenu() {
  const menu = $('#overflowMenu');
  const button = $('#btnPanelsBar');
  if (!menu || !button) return;
  hidePanel(menu);
  button.setAttribute('aria-expanded', 'false');
}
const overflowButton = $('#btnOverflow');
const overflowMenu = $('#overflowMenu');
const toolbarEl = $('#bar');
/* Taşma sırası: önce etiketler (CSS), sonra ikincil araçlar menüye düşer.
   PNG, zoom, opaklık ve aktif ekleme aracı en sona kalır. */
const toolbarOverflowOrder = [
  'btnGrid', 'btnTop', 'btnGroup', 'btnLink', 'btnFit', 'btnInspector',
  'btnPanels', 'btnToolEraser', 'btnToolBrush', 'btnToolSelect',
  'themeSelect', 'btnText', 'btnAdd',
  'btnMin', 'btnMax', 'btnExport',
];
const toolbarGroups = [...document.querySelectorAll('#bar > .tgroup')];
let toolbarLayoutFrame = 0;

function toolbarItemVisible(el) {
  if (!el || el.hidden) return false;
  if (el.closest('[hidden]')) return false;
  if (el.classList.contains('bar-overflowed')) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function pruneEmptyToolbarGroups() {
  for (const group of toolbarGroups) {
    const visible = [...group.children].some(child => toolbarItemVisible(child));
    group.classList.toggle('bar-group-empty', !visible);
  }
}

function syncOverflowMenuState() {
  if (!overflowMenu) return;
  for (const item of overflowMenu.querySelectorAll('[data-overflow-target]')) {
    const target = document.getElementById(item.dataset.overflowTarget);
    if (!target) {
      item.hidden = true;
      continue;
    }
    // Menüde yalnızca çubuktan TAŞAN öğeler görünür; çubukta duranların
    // kopyası gösterilmez (menü kalabalıklaşmasın).
    item.hidden = !!target.closest('[hidden]') || !target.classList.contains('bar-overflowed');
    item.disabled = !!target.disabled;
    item.classList.toggle('is-on', target.getAttribute('aria-pressed') === 'true');
  }

  // Tema seçici menüye düştüğünde burada kullanılabilir kalır.
  const themeSource = document.getElementById('themeSelect');
  const themeOverflow = document.getElementById('themeSelectOverflow');
  const themeRow = document.getElementById('overflowThemeRow');
  if (themeOverflow && themeSource) {
    if (!themeOverflow.options.length) themeOverflow.innerHTML = themeSource.innerHTML;
    themeOverflow.value = themeSource.value;
    themeOverflow.disabled = !!themeSource.disabled;
  }
  if (themeRow) {
    themeRow.hidden = !(themeSource && themeSource.classList.contains('bar-overflowed'));
  }

  for (const divider of overflowMenu.querySelectorAll('[data-overflow-divider="window"]')) {
    let any = false;
    for (let el = divider.nextElementSibling; el && !el.classList.contains('overflowDivider'); el = el.nextElementSibling) {
      if (!el.hidden) {
        any = true;
        break;
      }
    }
    divider.hidden = !any;
  }
}

/* <500 px: yalnızca çekirdek öğeler çubukta kalır. Aktif araç, zoom,
   opaklık ve PNG her koşulda görünür; kalanlar ••• menüsüne taşınır. */
function toolbarActiveToolEl() {
  for (const group of document.querySelectorAll('#psDrawTools, #psRefAdd')) {
    if (!group || group.closest('[hidden]')) continue;
    const active = group.querySelector('.tbtn[aria-pressed="true"]');
    if (active && toolbarItemVisible(active)) return active;
    const first = group.querySelector('.tbtn');
    if (first && toolbarItemVisible(first)) return first;
  }
  return null;
}

function toolbarMustStay(el) {
  if (!el) return false;
  if (el.id === 'btnExport' || el.id === 'btnOverflow') return true;
  if (el.closest('.zoombox') || el.closest('#opacityCtl')) return true;
  return el === toolbarActiveToolEl();
}

/* Yatay kaydırma çubuğu yok: sığmayan araçlar sırayla ••• menüsüne taşınır. */
function layoutToolbar() {
  if (!toolbarEl) return;
  toolbarEl.classList.add('toolbar-measuring');
  for (const el of toolbarEl.querySelectorAll('.bar-overflowed')) {
    el.classList.remove('bar-overflowed');
  }
  pruneEmptyToolbarGroups();
  void toolbarEl.offsetWidth;

  if (window.innerWidth < 500) {
    for (const el of toolbarEl.querySelectorAll('.tbtn, .themeSelect')) {
      if (el.closest('[hidden]')) continue;
      if (!toolbarMustStay(el)) el.classList.add('bar-overflowed');
    }
    pruneEmptyToolbarGroups();
    void toolbarEl.offsetWidth;
  }

  let guard = 0;
  while (toolbarEl.scrollWidth > toolbarEl.clientWidth + 1 && guard < 32) {
    const next = toolbarOverflowOrder
      .map(id => document.getElementById(id))
      .find(el => toolbarItemVisible(el) && !toolbarMustStay(el));
    if (!next) break;
    next.classList.add('bar-overflowed');
    pruneEmptyToolbarGroups();
    void toolbarEl.offsetWidth;
    guard++;
  }

  toolbarEl.classList.remove('toolbar-measuring');
  syncOverflowMenuState();
  if (overflowMenuOpen()) positionOverflowMenu();
}

function queueToolbarLayout() {
  if (toolbarLayoutFrame) return;
  toolbarLayoutFrame = requestAnimationFrame(() => {
    toolbarLayoutFrame = 0;
    layoutToolbar();
  });
}

window.addEventListener('resize', queueToolbarLayout, { passive: true });
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(queueToolbarLayout).catch(() => {});
}
window.addEventListener('load', queueToolbarLayout);

/** Menüyü verilen tetikleyici düğmenin altına sabitler; viewport dışına
    taşırmaz. ⋯ artık Ayarlar'ı açtığı için menü ▤ (#btnPanelsBar) altında. */
function positionOverflowMenu(anchor) {
  anchor = anchor || (typeof panelsBarBtn !== 'undefined' ? panelsBarBtn : overflowButton);
  if (!overflowMenu || overflowMenu.hidden || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 8;
  const width = Math.min(overflowMenu.offsetWidth || 280, innerWidth - margin * 2);
  const left = clamp(rect.right - width, margin, Math.max(margin, innerWidth - width - margin));
  const top = clamp(rect.bottom + gap, margin, Math.max(margin, innerHeight - 180));
  const maxHeight = Math.max(160, innerHeight - top - margin);

  overflowMenu.style.position = 'fixed';
  overflowMenu.style.right = 'auto';
  overflowMenu.style.bottom = 'auto';
  overflowMenu.style.left = `${Math.round(left)}px`;
  overflowMenu.style.top = `${Math.round(top)}px`;
  overflowMenu.style.width = `${Math.round(width)}px`;
  overflowMenu.style.maxHeight = `${Math.round(maxHeight)}px`;
  overflowMenu.style.transformOrigin = 'top right';
}

/* ⋯ düğmesi: artık AYARLAR penceresini açar (tüm modlarda aynı yer).
   Asıl "Panels" menüsü ▤ (#btnPanelsBar) düğmesine taşındı. */
const panelsBarBtn = $('#btnPanelsBar');
overflowButton.onclick = () => {
  if (typeof settingsHubToggle === 'function') settingsHubToggle();
};

function openPanelsBarMenu() {
  syncOverflowMenuState();
  showPanel(overflowMenu);
  /* Soğuk başlangıç yarışı: boot sırasındaki geç bir auto-hide menüyü
     kapatıyorsa bir sonraki turda geri aç (gerçek dış tık zaten click'ten
     ÖNCE geldiği için kullanıcı etkileşimini baltalamaz). */
  setTimeout(() => { if (overflowMenu.hidden) showPanel(overflowMenu); }, 70);
  overflowMenu.querySelectorAll('button').forEach((button, index) => {
    button.style.setProperty('--row-index', String(Math.min(index, 10)));
  });
  positionOverflowMenu(panelsBarBtn || overflowButton);
  /* rAF callback'i timestamp iletmesin — anchor parametresi element bekler. */
  requestAnimationFrame(() => positionOverflowMenu(panelsBarBtn || overflowButton));
  if (panelsBarBtn) panelsBarBtn.setAttribute('aria-expanded', 'true');
}
if (panelsBarBtn) {
  panelsBarBtn.onclick = () => {
    if (overflowMenuOpen()) { closeOverflowMenu(); return; }
    openPanelsBarMenu();
  };
}
overflowMenu.addEventListener('click', event => {
  const item = event.target.closest('[data-overflow-target]');
  if (!item) return;
  document.getElementById(item.dataset.overflowTarget)?.click();
  closeOverflowMenu();
});
document.addEventListener('pointerdown', event => {
  if (overflowMenuOpen() && !event.target.closest('#overflowMenu, #btnPanelsBar, #btnOverflow')) closeOverflowMenu();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !overflowMenuOpen()) return;
  closeOverflowMenu();
  (panelsBarBtn || overflowButton).focus();
});
syncResponsiveLayout();
if (compactLayoutQuery.addEventListener) compactLayoutQuery.addEventListener('change', syncResponsiveLayout);
else compactLayoutQuery.addListener(syncResponsiveLayout);
$('#btnGrid').onclick = () => {
  const grid = $('#gridOverlay');
  grid.hidden = !grid.hidden;
  $('#btnGrid').setAttribute('aria-pressed', grid.hidden ? 'false' : 'true');
};

/* ---------------- zoom kontrolleri ---------------- */
const ZOOM_STEP = 1.25;
function zoomByFactor(factor) {
  zoomAt({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, factor);
}
const btnZoomInEl = $('#btnZoomIn');
const btnZoomOutEl = $('#btnZoomOut');
if (btnZoomInEl) btnZoomInEl.onclick = () => zoomByFactor(ZOOM_STEP);
if (btnZoomOutEl) btnZoomOutEl.onclick = () => zoomByFactor(1 / ZOOM_STEP);

/* ---------------- ekleme aracı segmenti ---------------- */
const ADD_TOOL_KEY = 'tailref-add-tool';
const addToolButtons = { add: $('#btnAdd'), text: $('#btnText') };
function setAddTool(tool) {
  if (!addToolButtons[tool]) return;
  for (const [key, btn] of Object.entries(addToolButtons)) {
    if (btn) btn.setAttribute('aria-pressed', key === tool ? 'true' : 'false');
  }
  try { localStorage.setItem(ADD_TOOL_KEY, tool); } catch { /* sessiz */ }
  queueToolbarLayout();
}
// Davranış değişmiyor (tıkla = eylem); segment yalnızca son kullanılan ekleme
// aracını işaretler, böylece "aktif araç" her zaman görünür olur.
addToolButtons.add?.addEventListener('click', () => setAddTool('add'));
addToolButtons.text?.addEventListener('click', () => setAddTool('text'));
try { setAddTool(localStorage.getItem(ADD_TOOL_KEY) || 'add'); } catch { setAddTool('add'); }
btnLock.onclick = () => {
  const its = selectedImageItems();
  if (!its.length) return;
  pushUndo();
  const lock = !its.every(it => it.locked);
  its.forEach(it => { it.locked = lock; });
  btnLock.setAttribute('aria-pressed', lock ? 'true' : 'false');
  syncAll();
  scheduleSave();
};

/* =========================================================
   FAZ 6 · REFERANS BAR DARALTMA OKU
   ---------------------------------------------------------
   Çizim çubuğundaki (#v5ToolbarToggle) kalıbın referans ikizi —
   SIVI geçiş (kullanıcı: "su gibi akışkan"). display YOK:
   çocuklara .bar-fold (geçiş tanımı) eklenir, köke .bar-collapsed
   yazılır → içerik yerinde erir (opacity + scale + blur, alttan
   köklü, kabuğa doğru çöker), kabuk 48→14px yay eğrisiyle iner;
   açılışta içerik alttan yeniden büyüyerek yükselir.
   .bar-fold hareket sonunda kaldırılır (hover geçişleri normale
   döner). ••• (#btnOverflow) artık üst mod hapında (#appModeBar) —
   eski display !important savaşı bitti. #projectBar da
   body.bar-collapsed-ui ile katlanır ("pano da kaybolsun").
   Durum localStorage'da kalıcı.
   ========================================================= */
const BAR_COLLAPSE_KEY = 'tailref-bar-collapsed-v1';

/** Araç çubuğu katlanırken SEÇİM ÖZELLİKLERİ paneli de ÇUBUĞUN ALTINA
    "tucker" (kullanıcı isteği: üst barı kapatarsa panel panel de
    "barın oraya doğru gidip blendlenip yok olsun" — yeniden açınca
    panelin geri geleceği anlaşılsın). Ölçüt: cubuğun üstüne uzaklık. */
function tuckItemBarUnderBar() {
  const barEl = document.getElementById('bar');
  const itemBar = document.getElementById('itemBar');
  if (!itemBar || itemBar.hidden) return;
  let dist = 200;
  if (barEl) {
    try {
      const br = barEl.getBoundingClientRect();
      const ir = itemBar.getBoundingClientRect();
      dist = Math.min(480, Math.max(56, ir.top - br.bottom + 6));
    } catch { /* ölçüm elverişli değil: varsayılan mesafe */ }
  }
  itemBar.style.setProperty('--tuck-up', dist + 'px');
  itemBar.classList.remove('unfold-from-bar', 'panel-leaving');
  itemBar.classList.add('fold-toward-bar');
  clearTimeout(tuckItemBarUnderBar._t);
  tuckItemBarUnderBar._t = setTimeout(() => {
    /* Sınıf kaldırılırsa animasyon geri alınır ve panel O KARE için
       opaklık 100'e zıplar — sonra panel-leaving tekrar 100→0 kapanma
       oynatınca panel "kaybolup geri belirip yeniden kaybolur" (kullanıcı
       raporu: "bi geliyo bi gidiyo"). Fold bitiş karesi hâlâ opacity 0
       tutarken GÖRÜNÜR bir kare geçirmeden anlık gizliyoruz. */
    itemBar.classList.remove('fold-toward-bar');
    if (document.body.classList.contains('bar-collapsed-ui')) {
      itemBar.dataset.tucked = '1';
      itemBar.hidden = true;
      itemBar.style.removeProperty('--tuck-up');
    }
  }, 470);
}

/** Bar yeniden açıldı: tucked panel aynı yoldan geri gelir. Panel bar
    kapalıyken zaten saklıysa (tuck yok, normal gizlenme) normal biçimde
    gösterilir — kullanıcı isteği: "bar kapalıyken referans seçersem ve
    sonrasında üst paneli açarsam seçim özellikleri paneli açılmalı". */
function unfoldItemBarFromBar() {
  const itemBar = document.getElementById('itemBar');
  if (!itemBar) return;
  const wasTucked = itemBar.dataset.tucked === '1';
  delete itemBar.dataset.tucked;
  clearTimeout(tuckItemBarUnderBar._t);
  itemBar.classList.remove('fold-toward-bar', 'panel-leaving');
  if (typeof updateItemBar !== 'function') return;
  if (itemBar.hidden) {
    if (wasTucked) {
      itemBar.classList.add('unfold-from-bar');
      updateItemBar();
      /* ÇAKIŞMA DÜZELTMESİ: showPanel kendi panel-enter animasyonunu
         rAF ile ekler; id seçicili unfold animasyonu onu ezer ama
         500ms'de unfold sınıfı kalkınca enter animasyonu BAŞTAN
         oynar → panel "gelip kaybolup tekrar gelmiş" gibi görünür
         (kullanıcı raporu: "bir kez geliyor sonra kayboluyor sonra
         tekrar geliyor"). Enter animasyonu iptal — unfold tek sahip. */
      requestAnimationFrame(() => {
        itemBar.classList.remove('panel-preenter', 'panel-enter');
      });
      setTimeout(() => itemBar.classList.remove('unfold-from-bar'), 500);
    } else {
      /* Katlıyken seçim yapılmış, panel tuck'a kaydedilmemiş olamaz ama
         güvenli yol: normal gösterim. */
      updateItemBar();
    }
  }
}

function setBarCollapsed(on) {
  const bar = document.getElementById('bar');
  const btn = document.getElementById('barCollapseBtn');
  if (!bar || !btn) return;
  /* Odaklı kontrol (örn Classic tema select) kapalıyken açılmasın:
     klavye Space/Arrow ile native pop-up patlamasın. */
  const active = document.activeElement;
  if (active && bar.contains(active) && active !== btn &&
      typeof active.blur === 'function') active.blur();
  const kids = [...bar.children].filter(el => el !== btn);
  kids.forEach(el => el.classList.add('bar-fold'));
  bar.classList.toggle('bar-collapsed', on);
  document.body.classList.toggle('bar-collapsed-ui', on);
  /* Seçim özellikleri paneli: katlama ile BİRLİKTE gizlenir/açılır. */
  if (on) tuckItemBarUnderBar();
  else unfoldItemBarFromBar();
  btn.setAttribute('aria-expanded', on ? 'false' : 'true');
  try { localStorage.setItem(BAR_COLLAPSE_KEY, on ? '1' : '0'); } catch { /* sessiz */ }
  clearTimeout(setBarCollapsed._cleanup);
  if (on) {
    /* Kapalıyken .bar-fold KALICI: hedef durum (opacity 0) bu sınıfa
       bağlı — erken silinirse çocuklar 14px şeriden saçılır. */
  } else {
    setBarCollapsed._cleanup = setTimeout(() => {
      if (bar.classList.contains('bar-collapsed')) return;  // bu arada tekrar kapandıysa dokunma
      kids.forEach(el => el.classList.remove('bar-fold'));
    }, 640);
    setTimeout(queueToolbarLayout, 520);
  }
}

const barCollapseBtn = document.getElementById('barCollapseBtn');
if (barCollapseBtn) {
  barCollapseBtn.addEventListener('click', () => {
    const bar = document.getElementById('bar');
    if (!bar) return;
    setBarCollapsed(!bar.classList.contains('bar-collapsed'));
    /* Odak bırak: sonraki Space/Enter vuruşu düğmeyi tetiklemesin. */
    try { barCollapseBtn.blur(); } catch { /* sessiz */ }
  });
  try {
    setBarCollapsed(localStorage.getItem(BAR_COLLAPSE_KEY) === '1');
  } catch { /* sessiz */ }
}
