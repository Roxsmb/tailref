'use strict';
/* TailRef · FAZ 6 madde 15 · kapı zinciri çalıştırıcısı.
   ------------------------------------------------------------------
   Probe kanallarını sırayla çalıştırır; ilk kırmızıda durur (exit 1).
   Tüm kanallar `node scripts/<kanal>` ile bağımsız koşar; buradaki
   liste tek üretim kalıbının sırasıdır:

     • PURE (saf Node, saniyeler):
         pose3d-unit, wide-gamut-test, ink-tile-canon-test,
         ink-color-test, ink-palette-test, ink-stabilizer-test,
         color-wheel-audit · build-app --check
     • FULL (--full; Electron + CDP kanalları, kâneli):
         + compositör, simetri, liquify, layer-canon ve diğer
           Uİ kanalları (pose3d-smoke ve desktop-smoke dahil).

   Kullanım:
     node scripts/run-gates.js          (PURE zincir)
     node scripts/run-gates.js --full   (tam zincir)
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

/* Gate dosyaları tests/ altında; verify-package.js scripts/ altında kalır. */
function gatePath(file) {
  const inScripts = path.join(__dirname, file);
  if (fs.existsSync(inScripts)) return inScripts;
  return path.join(ROOT, 'tests', file);
}

const PURE = [
  'pose3d-unit.js',
  'dialog-l10n-test.js',
  'wide-gamut-test.js',
  'ink-tile-canon-test.js',
  'ink-tile-view-test.js',
  'ink-color-test.js',
  'ink-palette-test.js',
  'ink-stabilizer-test.js',
  /* Dış bağlantı kapısı: destek sayfası izinli, keyfi/taklit URL red. */
  'external-links-test.js',
  'shape-snap-check.js',
  'color-wheel-audit.js',
  /* Tur T Faz 6: arayüz paket formatı + güvenlik doğrulayıcı (saf) */
  'ui-package-validate.js',
  /* Belgeler: README/docs içindeki yerel bağlantılar gerçekten var mı? */
  'doc-links-test.js',
  'verify-package.js',
];
const FULL_EXTRA = [
  'compositor-test.js',
  'symmetry-test.js',
  'liquify-test.js',
  'smudge-parity-check.js',
  'undo-region-check.js',
  'undo-worker-region-check.js',
  'layer-canon-test.js',
  'ink-shortcut-test.js',
  'ink-rotate-test.js',
  'ink-select-check.js',
  'ink-empty-transform-check.js',
  'ink-last-layer-check.js',
  'ink-row-del-check.js',
  /* Çizim koruma regresyonları: canlı vuruşta Escape/araç tuşu/Ctrl+J,
     kilitli-gizli katman, damlalık karo okuması. */
  'ink-draw-guard-check.js',
  'ink-native-parity-check.js',
  /* Fırça kütüphanesi: özel fırça/kategori kalıcılığı + .abr turu
     (dışa aktar → içe aktar → uygulamayı kapat/aç). */
  'brush-library-test.js',
  'image-editor-check.js',
  'image-shift-resize-check.js',
  'bar-tuck-itembar-check.js',
  'panel-mode-fixes-check.js',
  'draw-size-status-check.js',
  'youtube-link-parse-check.js',
  'ink-radial-check.js',
  'ink-outside-check.js',
  'ink-commit-check.js',
  'ink-undo-frame-check.js',
  'ink-mask-region-check.js',
  'live-parity-probe.js',
  'ink-engine-host-check.js',
  'commit-fade-probe.js',
  'layer-store-test.js',
  'layer-dispose-test.js',
  'layer-flip-fold-test.js',
  'options-bar-test.js',
  'power-sliders-test.js',
  'save-on-close-test.js',
  'overload-test.js',
  'arrange-test.js',
  /* Referans tahtası etkileşim regresyonları: metin/başlık geri alma,
     kilitli öğe, ok tuşu, arkaya gönder, çöpten dönen bağlantı. */
  'ref-board-test.js',
  'projects-test.js',
  'pinterest-test.js',
  'artstation-test.js',
  /* Panel pencere mimarisi: taşıma, senkron, dosya/kısayol köprüsü, dock */
  'panel-window-test.js',
  'smoke-test.js',
  'keymap-test.js',
  'export-dialog-test.js',
  'settings-hub-test.js',
  /* Tur T Faz 3: tema stüdyosu + kayıt defteri kanıtı */
  'theme-studio-test.js',
  /* Tur T Faz 5: arayüz kategorisi + tema↔arayüz bağımsızlığı kanıtı */
  'interface-registry-test.js',
  /* Tur T Faz 6: paket mimarisi kanıtı (import/apply/reload/reject/remove) */
  'ui-package-test.js',
  /* Tur T Faz 7: mod × arayüz matrisi + odak grisi + reload kalıcılık */
  'interface-modes-test.js',
  /* Tur T: kaydetme modu karşılama diyaloğu — auto/manual/Escape uçtan uca */
  'persistence-welcome-test.js',
  /* Kayıt sistemi güvenliği: temiz başlat kapsamı, yedek görsel filtresi,
     import/reload yarışı, manuel acil kopya + kirli durum imzası */
  'persistence-safety-test.js',
  'pose3d-smoke.js',
  'desktop-smoke.js',
];

function run(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath,
      [gatePath(file)], { stdio: 'inherit' });
    child.on('exit', code => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

(async () => {
  const full = process.argv.includes('--full');
  /* 9 Kasım flake bulgusu: birincil monitördeki Electron penceresi bazen
     hiç kare üretmiyor (WAAPI/rAF donuyor) ve kapılar buna kırmızıya
     düşüyor. Test penceleri zaten TailRef_TEST_SCREEN ile ekran 3'e
     açılıyor; zincirde tanımlı değilse buradan bağla (kullanıcının iş
     monitörünü de kaplamaz). */
  if (!process.env.TailRef_TEST_SCREEN) process.env.TailRef_TEST_SCREEN = '3';
  const chain = full ? PURE.concat(FULL_EXTRA) : PURE;
  /* Paket kapısı derlenmiş bir app.asar ister. Temiz bir klonda (ve CI'da)
     dist/ yoktur; bu durumda kapıyı yalancı kırmızıya düşürmek yerine
     açıkça atla. Yerelde paket varsa her zaman koşar. */
  const PACKAGE_ASAR = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
  let pass = 0;
  let skipped = 0;
  for (const gate of chain) {
    if (gate === 'verify-package.js' && !fs.existsSync(PACKAGE_ASAR)) {
      console.log('ATLANDI ' + gate + ' (dist/win-unpacked/resources/app.asar yok)');
      skipped++;
      continue;
    }
    console.log('GATE ' + gate);
    let code = await run(gate);
    if (code !== 0) {
      /* Bazı kapılar GPU/zamanlama duyarlı: alfa okuması, pencere açılışı ve
         rAF kareleri yüklü makinede tek koşuda sapabiliyor (gözlenen iki
         flake: persistence-welcome "pencere açılmadı", pose3d-smoke alfa
         okuması). Aynı kapıyı bir kez daha koş; gerçek regresyon iki koşuda
         da kırmızı kalır, yalancı kırmızı zinciri durdurmaz. */
      console.log('RETRY ' + gate + ' (ilk koşu exit ' + code + ')');
      code = await run(gate);
    }
    if (code !== 0) {
      console.error('\nKAPI KIRMIZI: ' + gate + ' → exit ' + code +
        (full ? '' : ' (not: --full ile tüm zincir koşulur)'));
      process.exit(1);
    }
    pass++;
  }
  console.log('\nGATES: ' + pass + '/' + (chain.length - skipped) +
    ' kapı yeşil' + (full ? ' (tam zincir)' : ' (PURE)') +
    (skipped ? ' · ' + skipped + ' atlandı' : ''));
})().catch(e => { console.error('gates hata:', e); process.exit(1); });
