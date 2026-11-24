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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
