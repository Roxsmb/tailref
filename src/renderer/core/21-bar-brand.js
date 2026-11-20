/* TailRef app · auto-hiding toolbar, brand fade, easter egg */
'use strict';

/* Yüzen araç çubuğu, ekranın üst kenarına yaklaşınca açılır. */
const barEl = $('#bar');
const BAR_SHOW_Y = 66;        // bu yüksekliğin üstü "açılma bölgesi"
const BAR_HIDE_DELAY = 3200;  // fare uzaklaştıktan sonra açık kalma süresi
const BAR_FADE_MS = 220;      // hızlı sönüm: 10 sn'lik yavaş kaybolma yerine
let barHideTimer = null;
let barFadeTimer = null;
let barManualHide = false;    // H ile elle gizlendiyse: fare üst kenardan çıkana kadar açılmasın
let ptrY = -1;
let themeMenuOpen = false;

function themeMenuActive() {
  return themeMenuOpen;
}

document.addEventListener('pointerdown', e => {
  if (!themeMenuOpen) return;
  const t = e.target;
  if (t === themeSelect || (t && t.closest && t.closest('.themeSelect'))) return;
  themeMenuOpen = false;
}, true);

function barIsHidden() {
  return document.body.classList.contains('bar-hidden');
}

/* Birleşik kabukta araç çubuğu kalıcıdır. Eski "üst kenara yaklaşınca
   aç / uzaklaşınca kapan" davranışı yalnızca kabuk hazır değilken çalışır;
   böylece iki modda da aynı yüzen çubuk her zaman görünür kalır. */
function shellKeepsBarVisible() {
  return document.body.classList.contains('ps-ready');
}

function barFading() {
  return document.body.classList.contains('bar-fading');
}

function pointerAtDockEdge() {
  return ptrY >= 0 && ptrY <= BAR_SHOW_Y;
}

function setBarHidden(hidden) {
  if (hidden && shellKeepsBarVisible()) hidden = false;
  if (hidden) {
    if (overflowMenuOpen()) closeOverflowMenu();
    if (barIsHidden() || barFading()) return;
    // Kısa bir beklemeden sonra hızla sönümlenip çekilsin.
    document.body.classList.add('bar-fading');
    clearTimeout(barFadeTimer);
    barFadeTimer = setTimeout(() => {
      barFadeTimer = null;
      document.body.classList.remove('bar-fading');
      document.body.classList.add('bar-hidden');
      setTimeout(updateItemBar, 360);
    }, BAR_FADE_MS);
    setTimeout(updateItemBar, 360);
    return;
  }

  clearTimeout(barFadeTimer);
  barFadeTimer = null;
  document.body.classList.remove('bar-fading');
  if (!barIsHidden()) return;
  document.body.classList.remove('bar-hidden');
  setTimeout(updateItemBar, 360);
}

function barHideSoon(delay = BAR_HIDE_DELAY) {
  if (shellKeepsBarVisible()) return;
  clearTimeout(barHideTimer);
  barHideTimer = setTimeout(() => {
    barHideTimer = null;
    if (barIsHidden() || barFading()) return;
    if (themeMenuActive()) return;
    if (overflowMenuOpen()) return;           // ••• menüsü açıkken dock kalsın
    if (barEl.matches(':hover')) return;      // panelin üstündeyse kalsın
    if (overflowMenu && overflowMenu.matches(':hover')) return;
    if (pointerAtDockEdge()) return;
    setBarHidden(true);
  }, delay);
}

function barHoverUpdate() {
  if (barIsHidden()) {
    if (!pointerAtDockEdge()) barManualHide = false;
    if (barManualHide) return;
    if (pointerAtDockEdge()) setBarHidden(false);
    return;
  }
  if (barFading()) {
    // sönüm sırasında fare geri gelirse sönümü iptal et
    if (barEl.matches(':hover') || pointerAtDockEdge()) setBarHidden(false);
    return;
  }
  if (barEl.matches(':hover')) { clearTimeout(barHideTimer); barHideTimer = null; return; }
  if (overflowMenuOpen() && overflowMenu && overflowMenu.matches(':hover')) {
    clearTimeout(barHideTimer);
    barHideTimer = null;
    return;
  }
  const r = barEl.getBoundingClientRect();
  if (ptrY > r.bottom + 10) barHideSoon();
}

window.addEventListener('pointermove', e => {
  ptrY = e.clientY;
  barHoverUpdate();
  if (brandNear(e.clientX, e.clientY)) brandTouch();
  if (toprightNear(e.clientX, e.clientY)) toprightTouch();
  if (barpillNear(e.clientX, e.clientY)) barpillTouch();
}, { passive: true });

/* ---- TailRef yazısı: 1 dakika boyunca fare uğramazsa yavaşça kaybolur ----
   Sayaç başlar başlamaz sönüm de başlar (yavaş → sonda hızlanır); fare yazının
   üzerine/çevresine gelince anında geri gelir. */
const brandEl = $('#brand');

/* Marka görseli yüklenemezse SVG işarete düş. CSP (script-src 'self') inline
   onerror handler'larına izin vermediği için bu geri dönüş JS ile yapılır. */
const BRAND_MARK_FALLBACK = 'assets/tailref-mark.svg';
function installBrandMarkFallback() {
  const fix = img => {
    if (img.dataset.markFallback === '1') return;   // döngüye girme
    if (img.getAttribute('src') === BRAND_MARK_FALLBACK) return;
    img.dataset.markFallback = '1';
    img.src = BRAND_MARK_FALLBACK;
  };
  for (const img of document.querySelectorAll('img.brandMark')) {
    img.addEventListener('error', () => fix(img), { once: true });
    // Hata, bu betik çalışmadan önce oluştuysa error olayı kaçırılır.
    if (img.complete && img.naturalWidth === 0) fix(img);
  }
}
installBrandMarkFallback();

/* ---- Boşta soldurma süresi (Ayarlar → General → Idle fade) ----
   Marka yazısı, sağ üst düğmeler ve katlı çubuk oku TEK süreyi paylaşır.
   0 = hiç kaybolma. Kalıcılık: localStorage 'tailref-idle-fade' (sn). */
const IDLE_FADE_KEY = 'tailref-idle-fade';
let idleFadeSeconds = 60;
try {
  const n = Number(localStorage.getItem(IDLE_FADE_KEY));
  if (n === 0 || (Number.isFinite(n) && n > 0)) idleFadeSeconds = n;
} catch { /* sessiz */ }
function idleFadeMs() { return idleFadeSeconds * 1000; }
function tailrefIdleFadeSeconds() { return idleFadeSeconds; }
function tailrefIdleFadeSet(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  idleFadeSeconds = s;
  try { localStorage.setItem(IDLE_FADE_KEY, String(s)); } catch { /* sessiz */ }
  /* Tüm grupları uyanık getir: 'never'a çekildiyse sönük kalan kalmasın. */
  brandTouch();
  toprightTouch();
  barpillTouch();
}
window.tailrefIdleFadeSeconds = tailrefIdleFadeSeconds;
window.tailrefIdleFadeSet = tailrefIdleFadeSet;

const BRAND_IDLE_MS = 60000; /* artık kullanılmıyor; idleFadeMs() tek kaynak */
let brandLastTouch = Date.now();
let brandIdleTimer = null;

function brandNear(x, y) {
  if (!brandEl) return false;
  const r = brandEl.getBoundingClientRect();
  if (!r.width) return false;
  const padX = 36, padY = 24;
  return x >= r.left - padX && x <= r.right + padX &&
         y >= r.top - padY && y <= r.bottom + padY;
}

let brandPaintedO = '';
function paintBrandFade() {
  if (!brandEl) return;
  const ms = idleFadeMs();
  if (!ms) {
    /* Hiç kaybolma: tam opak tut. */
    if (brandPaintedO !== '1') { brandPaintedO = '1'; brandEl.style.setProperty('--brand-o', '1'); }
    document.body.classList.remove('brand-idle');
    return;
  }
  const t = clamp((Date.now() - brandLastTouch) / ms, 0, 1);
  const o = 1 - t * t * t;
  const s = o.toFixed(3);
  /* Değer değişmediyse style yazma: her tick'tki gereksiz yazım küçük de
     olsa bir stil invalidasyonu tetikliyor (9 Kasım optimizasyonu). */
  if (s !== brandPaintedO) {
    brandPaintedO = s;
    brandEl.style.setProperty('--brand-o', s);
  }
  if (t >= 1) {
    document.body.classList.add('brand-idle');
    /* Tam sönükse değer artık değişmez — tick boşa döner; sayacı durdur.
       Fare yazıya değince brandTouch yeniden kurar. */
    if (brandIdleTimer) { clearInterval(brandIdleTimer); brandIdleTimer = null; }
  }
}

function brandTouch() {
  brandLastTouch = Date.now();
  if (document.body.classList.contains('brand-idle')) {
    document.body.classList.remove('brand-idle');
  }
  if (!brandIdleTimer) {
    brandIdleTimer = setInterval(paintBrandFade, 250);
  }
  paintBrandFade();
}

/* ---- Üst şerit (#appModeBar): marka gibi idle'da bütünüyle kaybolur ----
   Fare şeride yaklaşınca anında geri gelir; ••• menüsü açıkken gizlenmez.
   Parça parça soldurma yerine şerit TEK birimde söner — segmentler açık
   kalıp düğmelerin tek tek kaybolması "problemli fade" görünümü veriyordu
   (kullanıcı raporu, 17 Kasım 2026). Süre: idleFadeMs(). */
const toprightEl = document.getElementById('appModeBar');
let toprightLastTouch = Date.now();
let toprightPaintedO = '1';
let toprightIdleTimer = null;

function toprightHeldOpen() {
  try { if (typeof overflowMenuOpen === 'function' && overflowMenuOpen()) return true; } catch { /* sessiz */ }
  return false;
}

function toprightNear(x, y) {
  if (!toprightEl) return false;
  const r = toprightEl.getBoundingClientRect();
  const padX = 70, padY = 34;
  return x >= r.left - padX && x <= r.right + padX &&
         y >= r.top - padY && y <= r.bottom + padY;
}

function toprightTouch() {
  if (!toprightEl) return;
  toprightLastTouch = Date.now();
  document.body.classList.remove('topright-idle');
  if (!toprightIdleTimer) toprightIdleTimer = setInterval(paintToprightFade, 250);
  paintToprightFade();
}

function paintToprightFade() {
  if (!toprightEl) return;
  const ms = idleFadeMs();
  if (!ms) {
    /* Hiç kaybolma: tam opak tut. */
    if (toprightPaintedO !== '1') {
      toprightPaintedO = '1';
      toprightEl.style.opacity = '1';
      document.body.classList.remove('topright-idle');
    }
    return;
  }
  if (toprightHeldOpen()) { toprightLastTouch = Date.now(); return; }
  const t = clamp((Date.now() - toprightLastTouch) / ms, 0, 1);
  const o = 1 - t * t * t;
  const s = o.toFixed(3);
  if (s !== toprightPaintedO) {
    toprightPaintedO = s;
    toprightEl.style.opacity = s;
    document.body.classList.toggle('topright-idle', o <= 0.001);
  }
  /* Tam sönükse tick boşa döner; fare bölgeye gelince toprightTouch kurar. */
  if (o <= 0.001 && toprightIdleTimer) {
    clearInterval(toprightIdleTimer);
    toprightIdleTimer = null;
  }
}

/* ---- Katlı referans çubuğu oku (#barCollapseBtn) ----
   Yalnız çubuk KATLIYKEN (hap tek başına görünürken) aynı ritimle söner;
   çubuk açıkken hap hep görünür kalır. Fare bölgeye yaklaşınca anında
   geri gelir — aksi halde çubuğu geri açmanın tek yolu kaybolurdu. */
const barpillEl = document.getElementById('barCollapseBtn');
let barpillLastTouch = Date.now();
let barpillPaintedO = '1';
let barpillIdleTimer = null;

function barpillNear(x, y) {
  if (!barpillEl) return false;
  const r = barpillEl.getBoundingClientRect();
  const padX = 70, padY = 40;
  return x >= r.left - padX && x <= r.right + padX &&
         y >= r.top - padY && y <= r.bottom + padY;
}

function barpillTouch() {
  if (!barpillEl) return;
  barpillLastTouch = Date.now();
  document.body.classList.remove('barpill-idle');
  if (!barpillIdleTimer) barpillIdleTimer = setInterval(paintBarpillFade, 250);
  paintBarpillFade();
}

function paintBarpillFade() {
  if (!barpillEl) return;
  const bar = document.getElementById('bar');
  if (!bar || !bar.classList.contains('bar-collapsed')) {
    /* Çubuk açık: hap her zaman görünür. */
    if (barpillPaintedO !== '1') { barpillPaintedO = '1'; barpillEl.style.opacity = '1'; }
    document.body.classList.remove('barpill-idle');
    return;
  }
  const ms = idleFadeMs();
  if (!ms) {
    if (barpillPaintedO !== '1') { barpillPaintedO = '1'; barpillEl.style.opacity = '1'; }
    document.body.classList.remove('barpill-idle');
    return;
  }
  const t = clamp((Date.now() - barpillLastTouch) / ms, 0, 1);
  const o = 1 - t * t * t;
  const s = o.toFixed(3);
  if (s !== barpillPaintedO) {
    barpillPaintedO = s;
    barpillEl.style.opacity = s;
    document.body.classList.toggle('barpill-idle', o <= 0.001);
  }
  if (o <= 0.001 && barpillIdleTimer) {
    clearInterval(barpillIdleTimer);
    barpillIdleTimer = null;
  }
}
if (barpillEl) barpillIdleTimer = setInterval(paintBarpillFade, 250);

let brandClickCount = 0;
let brandClickTimer = null;
let brandIsEgg = false;
const origBrandHTML = brandEl ? brandEl.innerHTML : '';

function triggerBrandEasterEgg() {
  if (brandIsEgg || !brandEl) return;
  brandIsEgg = true;
  brandClickCount = 0;
  if (brandClickTimer) { clearTimeout(brandClickTimer); brandClickTimer = null; }

  brandEl.innerHTML = '<span style="letter-spacing:.25em; font-size:19px; color:#60d6ff; text-shadow:0 0 25px rgba(96,214,255,1);">MADE BY ROXS</span>';
  brandEl.classList.add('easter-egg');

  setTimeout(() => {
    brandEl.classList.remove('easter-egg');
    brandEl.innerHTML = origBrandHTML;
    brandIsEgg = false;
  }, 1800);
}

if (brandEl) {
  brandEl.addEventListener('pointerenter', brandTouch);
  brandEl.addEventListener('pointermove', brandTouch);
  brandIdleTimer = setInterval(paintBrandFade, 250);

  let isDraggingBrand = false;
  let brandDragToken = 0;
  let brandPosReady = false;
  let brandStartX = 0, brandStartY = 0;
  let winStartX = 0, winStartY = 0;

  brandEl.addEventListener('dragstart', e => e.preventDefault());

  brandEl.addEventListener('pointerdown', e => {
    brandTouch();
    if (e.button !== 0) return;
    e.preventDefault();

    const token = ++brandDragToken;
    isDraggingBrand = true;
    brandPosReady = false;
    brandStartX = e.screenX;
    brandStartY = e.screenY;
    winStartX = 0;
    winStartY = 0;

    const onPointerMove = eMove => {
      if (!isDraggingBrand || token !== brandDragToken || !brandPosReady) return;
      const dx = eMove.screenX - brandStartX;
      const dy = eMove.screenY - brandStartY;
      if (Math.hypot(dx, dy) > 4 && window.tailref && window.tailref.setWindowPos) {
        window.tailref.setWindowPos(winStartX + dx, winStartY + dy);
      }
    };

    const finish = eUp => {
      if (token !== brandDragToken) return;
      isDraggingBrand = false;
      brandPosReady = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);

      const dx = eUp.screenX - brandStartX;
      const dy = eUp.screenY - brandStartY;

      if (eUp.type !== 'pointercancel' && Math.hypot(dx, dy) <= 5) {
        brandClickCount++;
        clearTimeout(brandClickTimer);
        brandClickTimer = setTimeout(() => { brandClickCount = 0; }, 1400);

        if (brandClickCount >= 3) {
          triggerBrandEasterEgg();
        }
      }
    };

    // Dinleyicileri beklemeden kaydet: hızlı tıklamada pointerup kaçmasın.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);

    if (window.tailref && window.tailref.getWindowPos) {
      window.tailref.getWindowPos().then(pos => {
        if (!isDraggingBrand || token !== brandDragToken) return;
        if (Array.isArray(pos)) {
          winStartX = pos[0];
          winStartY = pos[1];
          brandPosReady = true;
        }
      }).catch(() => { /* konum alınamazsa sürükleme yapma */ });
    }
  });
}

document.addEventListener('mouseleave', () => {
  if (themeMenuActive()) return;
  ptrY = 99999;
  barHideSoon(280);
});
window.addEventListener('blur', () => {
  if (themeMenuActive()) return;
  barHideSoon(420);
});
