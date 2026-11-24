/* =========================================================
   TailRef Studio · web demo bootstrap
   ---------------------------------------------------------
   Yalnızca itch.io HTML5 derlemesinde (dist-web) yüklenir; masaüstü
   paketlerinde bu dosya hiç yoktur.

   Tarayıcıda Electron köprüsü (window.tailref) bulunmadığı için:
     · .tail kaydetme / açma, otomatik yedek, güncelleme çalışmaz
     · tahta yalnızca bu tarayıcının IndexedDB'sinde durur
   Bu yüzden kayıt modu "auto"ya sabitlenir ve kaydetme kısayolu
   kullanıcıya bunu söyleyen bir bildirim gösterir.
   ========================================================= */
'use strict';

(function () {
  window.__TAILREF_WEB_DEMO__ = true;

  /* Kayıt modu: manuel (.tail) modu köprü ister; tarayıcıda seçilirse
     hiçbir şey kaydedilmezdi. localStorage'ı yazma anında da eziyoruz ki
     Ayarlar'dan manuel moda geçmek sessiz veri kaybına dönüşmesin. */
  try { localStorage.setItem('tailref-persistence', 'auto'); } catch { /* sessiz */ }
  try {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tailref-persistence' && String(value) === 'manual') value = 'auto';
      return setItem.call(this, key, value);
    };
  } catch { /* sessiz */ }

  /* Ctrl/Cmd+S: masaüstünde .tail kaydı, burada hiçbir şey. Sessiz
     kalmak yerine tek satır bilgi göster. */
  window.addEventListener('keydown', function (event) {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || String(event.key).toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof window.showProjectNotice === 'function') {
      window.showProjectNotice('Web demo — saving is off. Download the desktop app to keep boards.', 3600);
    }
  }, true);

  /* =========================================================
     Mouse pressure — açılışta açık
     ---------------------------------------------------------
     Tarayıcıda gerçek kalem basıncı yok; fare hızından basınç
     üretimi kapalı başlarsa demo ilk denemede "ölü" hissettiriyor.
     Kullanıcı ayarı elle kapatırsa seçimi hatırlanır (localStorage)
     ve bir daha zorla açılmaz; hiç seçim yapılmadıysa açılır.
     ========================================================= */
  const MSP_CHOICE_KEY = 'tailref-web-mouse-pressure-choice';

  function applyMousePressureDefault() {
    let attempts = 0;
    const tick = () => {
      let ready = false;
      try { ready = (typeof appReady !== 'undefined') && appReady; } catch { ready = false; }
      if (!ready) {
        if (++attempts < 200) setTimeout(tick, 250);
        return;
      }
      let choice = null;
      try { choice = localStorage.getItem(MSP_CHOICE_KEY); } catch { /* sessiz */ }
      const desired = choice !== 'off';
      try {
        if (window.inkV5Settings && typeof window.inkV5Settings.setMousePressure === 'function' &&
            window.inkV5Settings.mousePressure() !== desired) {
          window.inkV5Settings.setMousePressure(desired);
        }
        if (typeof inkSyncUI === 'function') inkSyncUI();
        else {
          const box = document.getElementById('inkMouseSpeedPressure');
          if (box) box.checked = desired;
        }
      } catch { /* sessiz */ }
    };
    tick();
  }

  /* Kullanıcı iki yerden de (çizim ayarları / Ayarlar) kapatabilir;
     ikisini de dinleyip seçimi kalıcı say. Ayarlar'daki satır gerçek bir
     checkbox değil aria-pressed düğmesi olduğu için click'i de dinle. */
  document.addEventListener('change', function (event) {
    const el = event.target;
    if (!el || (el.id !== 'inkMouseSpeedPressure' && el.id !== 'settingsMousePressure')) return;
    try { localStorage.setItem(MSP_CHOICE_KEY, el.checked ? 'on' : 'off'); } catch { /* sessiz */ }
  }, true);
  document.addEventListener('click', function (event) {
    const el = event.target && event.target.closest ? event.target.closest('#settingsMousePressure') : null;
    if (!el) return;
    try { localStorage.setItem(MSP_CHOICE_KEY, el.getAttribute('aria-pressed') === 'true' ? 'on' : 'off'); } catch { /* sessiz */ }
  });

  /* =========================================================
     5 dakikalık destek hatırlatması
     ---------------------------------------------------------
     Yalnızca web demosunda. Kapatılabilir; kapatılsa bile bir
     sonraki 5 dakikalık dilimde yeniden görünür.
     ========================================================= */
  function buildSupportNotice() {
    if (document.getElementById('webDemoSupport')) return;

    const box = document.createElement('div');
    box.id = 'webDemoSupport';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:66px', 'transform:translateX(-50%)',
      'z-index:2147483000', 'display:flex', 'flex-direction:column', 'gap:8px',
      'width:min(92vw, 420px)', 'padding:12px 14px',
      'border:1px solid rgba(255,255,255,.18)', 'border-radius:14px',
      'background:rgba(20,20,26,.96)', 'color:#e8e8ee',
      'font:13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif',
      'box-shadow:0 10px 30px rgba(0,0,0,.5)', 'backdrop-filter:blur(8px)',
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; gap:10px';
    const title = document.createElement('strong');
    title.textContent = 'Enjoying TailRef?';
    title.style.cssText = 'flex:1 1 auto; font-weight:600';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close this notice');
    close.style.cssText = 'flex:0 0 auto; width:24px; height:24px; border:0; border-radius:50%; ' +
      'background:rgba(255,255,255,.1); color:#e8e8ee; font:16px/1 system-ui, sans-serif; cursor:pointer';
    close.addEventListener('click', function () { box.remove(); });
    head.append(title, close);

    const body = document.createElement('div');
    body.textContent = 'Boards in this demo stay in this browser. Download the desktop app to save real .tail files — and support development if it saves you time.';
    body.style.cssText = 'color:#c9c9d4';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:14px; align-items:center';
    const mkLink = (href, label, strong) => {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label;
      a.style.cssText = 'color:' + (strong ? '#8cc8ff' : '#a9b4c4') + '; text-decoration:none; font-weight:' + (strong ? '600' : '400');
      return a;
    };
    actions.append(
      mkLink('https://roxsmb.itch.io/tailref', 'Download the app', true),
      mkLink('https://www.buymeacoffee.com/roxsmb', 'Support', false)
    );

    box.append(head, body, actions);
    document.body.appendChild(box);
  }

  function startSupportReminder() {
    setTimeout(function () {
      buildSupportNotice();
      setInterval(buildSupportNotice, 5 * 60 * 1000);
    }, 5 * 60 * 1000);
  }

  function buildBanner() {
    if (document.getElementById('webDemoBar')) return;
    const bar = document.createElement('div');
    bar.id = 'webDemoBar';
    bar.setAttribute('role', 'note');
    bar.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)',
      'z-index:2147483000', 'display:flex', 'align-items:center', 'gap:10px',
      'max-width:min(92vw, 640px)', 'padding:8px 10px 8px 14px',
      'border:1px solid rgba(255,255,255,.16)', 'border-radius:999px',
      'background:rgba(20,20,26,.94)', 'color:#e8e8ee',
      'font:13px/1.35 system-ui, -apple-system, Segoe UI, sans-serif',
      'box-shadow:0 8px 26px rgba(0,0,0,.45)', 'backdrop-filter:blur(8px)',
    ].join(';');

    const text = document.createElement('span');
    text.innerHTML = '<b style="font-weight:600">Web demo</b> — boards stay in this browser. ' +
      'Saving, backups and updates need the desktop app.';
    text.style.cssText = 'flex:1 1 auto; min-width:0';

    const link = document.createElement('a');
    link.href = 'https://roxsmb.itch.io/tailref';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Download';
    link.style.cssText = 'flex:0 0 auto; color:#8cc8ff; text-decoration:none; font-weight:600';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Hide demo notice');
    close.style.cssText = 'flex:0 0 auto; width:24px; height:24px; border:0; border-radius:50%; ' +
      'background:rgba(255,255,255,.1); color:#e8e8ee; font:16px/1 system-ui, sans-serif; cursor:pointer';
    close.addEventListener('click', function () {
      bar.remove();
      try { sessionStorage.setItem('tailref-web-demo-dismissed', '1'); } catch { /* sessiz */ }
    });

    bar.append(text, link, close);
    document.body.appendChild(bar);
  }

  function start() {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('tailref-web-demo-dismissed') === '1'; } catch { /* sessiz */ }
    if (!dismissed) buildBanner();
    applyMousePressureDefault();
    startSupportReminder();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
