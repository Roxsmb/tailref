'use strict';
/* TailRef · Tur T Faz 4 — IRIX kabuk köprüsü.
   MENÜ ÇUBUĞU KALDIRILDI (kullanıcı kararı + otantiklik): 4Dwm'de global
   menü çubuğu yoktur; menüler pencere içindedir. Görev çubuğu da daha
   önce kaldırıldı. Kalan: odak dışı pencere durumu (başlık grileşmesi).
   Skin yalnızca documentElement[data-interface="irix"] iken CSS'te
   etkilidir; classic'te sınıf zararsızdır. */
(function () {
  window.addEventListener('blur', function () {
    document.documentElement.classList.add('irix-window-inactive');
  });
  window.addEventListener('focus', function () {
    document.documentElement.classList.remove('irix-window-inactive');
  });
})();
