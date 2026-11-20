# FX görsel QA sayfaları

`npm.cmd run qa:fx` (veya `node tests/fx-visual-qa.js`) 20 efektin **varsayılan**
ve tüm **built-in preset** çıktısını gerçek motorla (`def.apply`) render edip
kategori başına bir kontakt sayfası üretir:

- `fx-printmaking.png` — Baskı (7 efekt)
- `fx-traditional.png` — Geleneksel Medya (6 efekt)
- `fx-experimental.png` — Deneysel İllüstrasyon (7 efekt)

Her hücre 192×144 örnek raster üzerinde çalıştırılır. Script ayrıca:

- boş çıktı (alfa 0) var mı,
- preset varsayılanla birebir aynı mı,
- aynı girdi iki kez render edildiğinde piksel birebir mi (determinizm)

kontrol eder ve hata varsa çıkış kodu 1 döner.

Sayfalar 20 efektin görsel olarak birbirinden ve presetlerin kendi
varsayılanlarından ayrıştığını gözle doğrulamak içindir; otomatik piksel
testleri `tests/fx-pipeline-test.js` içindedir.
