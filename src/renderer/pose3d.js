import { boot } from './pose3d/bootstrap.js';

/* =========================================================
   3D GECİKTİRLİ BAŞLATMA (kullanıcı 8 Kasım perf testi)
   Eski hâli: modül yüklenir yüklenmez boot() → THREE motoru +
   FBX karakteri her açılışta yüklenir ve Viewport sonsuz 60Hz
   rAF döngüsüne girer; 3D hiç kullanılmasa da FPS gölgede kalır,
   açılış da uzar.
   Yeni hâli: motor, #pose3dPanel gerçekten açıldığında bir kere
   başlar (bütün açılış kapıları Panel gizlliğini kaldırır:
   mode3dBtn, btnPose3d, Ctrl+Shift+S yakasındaki kilidi metodlar).
   ========================================================= */

let bootStarted = false;
let bootPromise = null;
let pendingCapture = null; /* motor hazır olmadan gelen yakalama kısayolu */

function startBoot() {
  if (bootStarted) return bootPromise;
  bootStarted = true;
  bootPromise = boot().then(async () => {
    /* Mod zaten 3D'ye geçmişse (boot sırasında sekme açıldıysa)
       tam ekran durumu senkronla; eski motorun ilk anlarda bu
       çağrıyı kaçırmaması için optional-chaining ile geliyordu. */
    if (document.body.classList.contains('mode-3d')) {
      window.pose3dFullscreenSet?.(true);
    }
    /* Panel açılış anında Ctrl+Shift+S gelmişse (motor yüklenirken)
       isteği motorun kendi dinleyicilerine tekrar götür. */
    if (pendingCapture) {
      const payload = pendingCapture;
      pendingCapture = null;
      setTimeout(() => {
        try { window.dispatchEvent(new CustomEvent('pose-capture-request', { detail: payload })); } catch { /* sessiz */ }
      }, 80);
    }
    return 1;
  }).catch(error => {
    console.error('3D viewport başlatılamadı', error);
    throw error;
  });
  return bootPromise;
}

/* Bütün kapılar tek baytaza akıyor: panel gizliliği kalkınca motor başlar.
   MutationObserver yerine attribute izleme — başka kodu sarmak gerekmez. */
const panel = document.querySelector('#pose3dPanel');
if (panel) {
  if (!panel.hidden) startBoot();
  else {
    new MutationObserver(() => {
      if (!panel.hidden) { startBoot(); }
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }
} else {
  /* Panel DOM'da yoksunsa (beklenmedik) eski davranışa dön; bozmasın. */
  startBoot();
}

/* Motor yüklenirken/kapalıyken Ctrl+Shift+S isteği düşmesin. */
window.addEventListener('pose-capture-request', ev => {
  if (bootStarted && bootPromise) return; /* motorun kendi dinleyicisi yakalar */
  pendingCapture = (ev && ev.detail) ? ev.detail : { quick: false };
}, true);
