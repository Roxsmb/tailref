'use strict';
/* TailRef · Tur T Faz 4 — canvas editor skin köprüsü.
   Ana penceredeki 02c-interface-registry.js ile aynı anahtarı okur
   (tailref-interface); irix seçiliyse kendi skin linkini açar ve
   documentElement.dataset.interface'i yazar. JS davranışı YOK —
   yalnızca CSS enable + dataset. classic → attribute yok + link kapalı. */
(function () {
  var KEY = 'tailref-interface';
  var id = 'classic';
  try { id = localStorage.getItem(KEY) || 'classic'; } catch (e) { id = 'classic'; }
  var link = document.querySelector('link[data-ui-skin="irix"]');
  if (id === 'irix' && link) {
    link.disabled = false;
    document.documentElement.dataset.interface = 'irix';
  } else {
    if (link) link.disabled = true;
    delete document.documentElement.dataset.interface;
  }
  /* Ana pencere arayüz değiştirirse haber al (aynı profil localStorage). */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !link) return;
    var v;
    try { v = e.newValue || 'classic'; } catch (err) { v = 'classic'; }
    if (v === 'irix') {
      link.disabled = false;
      document.documentElement.dataset.interface = 'irix';
    } else {
      link.disabled = true;
      delete document.documentElement.dataset.interface;
    }
  });

  /* Faz 7: odak dışı pencere — editor başlık çubuğu grileşir (gerçek
     odak; classic'te sınıf zararsızdır). */
  window.addEventListener('blur', function () {
    document.documentElement.classList.add('irix-window-inactive');
  });
  window.addEventListener('focus', function () {
    document.documentElement.classList.remove('irix-window-inactive');
  });
})();
