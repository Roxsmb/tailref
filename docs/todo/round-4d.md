# Tur 4d · Düzeltme listesi (kullanıcı raporları — SİRAYLA)

> Kaynak: kullanıcı geri bildirimi, 13 Kasım 2026. Her madde düzelince
> işaretle + kanıt (test/ölçüm) yaz. Tümü bitince: QC ekle → tam
> regresyon → CHANGELOG → portable exe → masaüstü SHA-256.

## Marka turu · Wordmark bitmap'e geçiş (14 Kasım — TAMAMLANDI)

Kullanıcının wordmark PNG'si (beyaz, şeffaf zemin) görünür UI
metinlerinin yerine kondu:

- Varlık: `src/renderer/assets/tailref_studio_wordmark_white.png`
  (686×240, 43 KB; kaynak 7176×3508'den kırpma+bicubic küçültme).
- Dört nokta: splash (sincap altı), `#brand` (sol üst), `#splashLogo`
  (boş tahta ipucu), `.pwBrand` (kayıt modu diyaloğu).
- Paper teması: üç nokta için `filter:invert(1)` kuralı eklendi.
- Metin kalan yerler: pencere başlığı, hata diyalogları, l10n, exe adı.
- Kanıt: tarayıcı önizleme ekran görüntüleri (splash + index: diyalog,
  boş tahta, sol üst çip) — wordmark 4 noktada da yüklü ve boyutlu;
  smoke-test 55/55, desktop-smoke 20/20 (karşılama diyaloğu dahil).
- Kalan: build:portable → verify-package → masaüstü kopya + SHA-256.

## Tur 5p · Performans turu (çizim darboğazları — 14 Kasım)

## Durum: ✔ A + B TAMAMLANDI

- B (undo/redo piramit) — TAMAMLANDI:
  - Ölçüm (önce): her undo/redo adımında `pyrFull=1` — pyrSync 17–22 ms
    (4K), tepe 145–165 ms; scaledBuild tepesi 160–184 ms. Sonra:
    `pyrFull=0`, pyrSync 0–0.2 ms (yalnız bölge yaması), tepeler yok.
  - Kök 1 (34-ink-undo.js): erken epoch bump rect'sizdi → piramitte
    "bekleyen full". Raster kaydı yoksa (maxSnapBytes 4 MB aşımı —
    ağır/geniş vuruş) hiç bölge yoktu. Düzeltme: erken bump bölgesini
    raster snapshot rect'inden, kayıt yoksa `inkUndoStrokeRegion`'dan
    alır; aynı rect'i taşıyan ikinci bump `bolgeliErken` ile atlanır.
  - Kök 2 (35-ink-worker.js): `baseEpoch = max(carry, next−1)` —
    uygulama-zamanı piramit senkronu rAF yarışında koşmazsa tüketil-
    memiş ama dizide duran rect'ler kurban ediliyor → `dirtySince`
    null → gereksiz tam kursetlik. Düzeltme: baseEpoch = dizideki en
    eski rect'in epoch'su − 1.
  - Kanıt: iz probe 4 undo adımı `dirty[rects]` ile yama; AB-probe
    B1/B2 temiz. Parite: undo-region ✓, undo-worker-region ✓,
    ink-undo-frame ✓ (13 OK), ink-mask-region ✓ (11 OK),
    ink-commit ✓ (7/7).
- A (maskeli commit bölgesel kurulumu) — TAMAMLANDI:
  - Ölçüm (önce, dekompozisyon): commitEd 34.7 ms/3× (mx 14.1),
    bunun ~9–12 ms'si `inkRebuildItemLayerRegion`'ın kesişen
    vuruşları sıfırdan damgalaması (rcStamp payı, FAZ 7.U ölçümüyle
    aynı); maske bölge blit ~0 ms, undo snap ~1 ms.
  - Düzeltme: vuruş-başı damga önbelleği (29-ink-render.js).
    K15 izole scratch + source-over birleşmeliği → izole ön-render +
    tek blit == doğrudan damga. smudge/erase/lockAlpha/fill/gradient/
    liquify önbellek dışı; `inkHashStroke` + tuval boyutu + sym ile
    geçerlilik; LRU + alan limiti + tuval havuzu.
  - Kritik yol: commit'in yeni vuruşu doğrudan damgalanır (skip),
    girişi requestIdleCallback ile idle'da kurulur (aktif çizimde
    ertelenir) — commit anı tahsis ödemez.
  - Ölçüm (sonra): bölgesel kurulum 27.1 → 16.5 ms/3× (tepe
    12.4 → 6.1), commitEd 34.7 → 25.3 ms (tepe 14.1 → 10.1),
    tekrar-bölge 19.1 → 6.4 ms ort; heap aynı bant (12–17 MB).
  - Parite: ink-mask-region 11 OK (bölgesel == tam, 0 px, kurulum
    11.3 → 6.1 ms), ink-commit 7/7, undo-region / undo-worker-region
    / ink-undo-frame 13 OK — hepsi 0 px.

## Tur 4n · Marka görünürlüğü (PW karşılama + çizim modu — 14 Kasım)

## Durum: ✅ TAMAMLANDI — marka her durumda sol üstte (PW + 3 mod kanıtlı)

- Kullanıcı belirtisi: çizim modunda (ve açılış karşılama diyaloğunda)
  sol üstteki TailRef markası görünmüyordu; yalnız 3D pose modunda
  görünüyordu (o kural zaten 4öncesinde `body.mode-3d #brand{9500}`
  ile çözülmüştü).
- Kök neden 1: `#persistenceWelcome` bulanık zemini z 3400 > marka
  1001 → açılış diyaloğu markayı örtüyordu. Kök neden 2:
  `body.mode-draw #inkEditor` tam-ekran opak kanvas z 1100 > 1001 →
  çizim modunda marka kanvas altında.
- Düzeltme: `style.css` PW-açık kuralı
  (`body:has(#persistenceWelcome:not([hidden])) #brand{z-index:9500}`)
  + `draw-v5.css` çizim kuralı (`body.mode-draw #brand{z-index:9500}`).
  İkisi de geçici: diyalog/mod kapanınca marka otomatik 1001'e döner.
- Kanıt: canlı probe 5 adım (PW açık → kapat → reference → çizim modu
  [yeni-kanvas modalı onaylı gerçek geçiş] → 3D → reference-geri);
  beşinde de `elementFromPoint` = marka.
- Ek deneme: marka "T" harfine f-aynası alt kuyruk (CSS mask) —
  kullanıcı vazgeçti, tamamen geri alındı (iz yok).
- Paket: SHA-256
  AA8D2EDEFFFE32F1B8AFF8CC160CEC147B534EA46CEC33C582281ED102AD0B16,
  114.799.540 bayt; masaüstü kopyası aynı karma
  (eski: BA31F6C1…, 114.801.213 bayt).

## Tur 4l · Çok dilli yerelleştirme (10 dil)

## Durum: ✅ TAMAMLANDI — çekirdek, 9 dil sözlüğü, regresyon, paket, masaüstü

- Kapsam: app penceresi + draw-v5 proto + 49-draw-proto menüsü +
  çizim editörü penceresi (canvas-editor-l10n.js) + statik HTML;
  Ayarlar → Genel → Dil seçici; ilk açılış İngilizce, seçim
  'tailref-lang' ile kalıcı (eski anahtar göçürülür).
- Çekirdek: `01b-l10n.js` (`L10N`, `__t`, `tPlural`, `applyDom` üç
  aşamalı açılış, `onChange`, `[data-l10n*]` kanalları); sözlükler
  `locales/*.json` → build-locales → `01c-locale-data.js`
  (10 dil · 1810 anahtar; EN fallback, ham anahtar asla görünmez).
- Sözlük: tr.json 918→938 anahtar (20 çekirdek ekleme: Fill, Smudge,
  Export as PNG, Alpha lock, Tolerance, Mode, New, Paste, Rename,
  Hide, New layer, Italic, Gray, Orange, Purple, Turquoise, Brush
  Library, Paint tools, Text note, Paint bucket + Opacity/Hardness/
  Size/Spacing/Smoothing/Normal/Delete/Copy/Blue/Black/White/Cancel);
  yeni de/fr/es/ja/ko/zh-CN/pt-BR/ru.json (109 çekirdek anahtar × 8).
- Terminoloji: PS/Krita standardı (ja Smudge=指先, ru Smudge=Палец,
  de Eraser=Radiergummi, fr Multiply=Produit, es Screen=Trama,
  zh Multiply=正片叠底/Screen=滤色, pt-BR Screen=Divisão).
- Test güncellemesi (dil-ag-nostik): layer-canon (Sil/Delete),
  ink-empty-transform (uyarı metni), ink-radial (sürgü etiketleri),
  options-bar (araç/menü/modal metinleri), projects (Pano/Board),
  pinterest + artstation (durum metinleri), canvas-editor
  (Çizim Yap/Start Drawing, Geri yükle/Restore), export-dialog
  (ipucu/bilgi metinleri).
- Kanıt: probe 9/9 OK (EN açılış, anlık TR, yardım niteliği, seçici,
  reload kalıcılığı, EN dönüşü, v5 çubuk + title, de/ja/zh-CN/ru);
  glossary 109/109 × 9 dil; syntcheck 63 JS OK; gates --full TAM
  YEŞİL (verify-package dahil).
- Paket: SHA-256
  A46B68C0C05AA94AB4F34F96755DF3E5F3B383073D6B21785535CBFEBA6CE4EC,
  114.040.167 bayt; masaüstü kopyası aynı karma.
- Bilinen eksik (ayrı tur adayı): konuk seçim düğmeleri
  (pinterest/artstation preload) hâlâ Türkçe sabit
  ("＋ Tahtaya ekle"); bu betikler iframe/pencere konuğu olduğundan
  ayrı L10N yükleme gerektirir.

## Tur 4l2 · Yerelleştirme devamı (gözden kaçanlar — 14 Kasım)

## Durum: ✅ TAMAMLANDI — taranan kalan tüm TR dizeler EN-base + __t

- Tarama: tüm kaynak korpusunda TR-karakter + ASCII-Türkçe
  kelime-tabanlı tarama (yorum/konsol satırları bilinçli bırakıldı);
  kalan gerçekler pose3d + küçük renderer dizeleri çıktı, tümü
  düzeltildi. Kalan 4 sözlük-eksik raporu sahte pozitif
  (`' + def.title + '` birleştirme artığı; `&quot;` HTML kaçışlı
  anahtarların gerçek tırnaklı hâlleri sözlükte mevcut).
- `data-l10n-label` kanalı (01b-l10n.js) — optgroup/option grup
  etiketi çevirisi.
- Katman blend listeleri (inkPropsBlend + inkLayerBlend): optgroup
  başlıkları EN + data-l10n-label (Darkening/Lightening/Contrast/
  Comparative/Color components × 5 anahtar × 9 dil); nested
  `<span data-l10n>` çöplüğü temizlendi.
- Fırça adları EN-base: 52-native-brush-library 24 ad + badge
  ('Grafit'→Graphite, 'Konsept'→Concept, 'Kaligrafi'→Calligraphy,
  'Duman'→Smoke) + 1 description; badge'ler ürün-adı politikasıyla
  TR modunda EN kalır.
- pose3d: PanelController 63 + CaptureModal 11 + CapturePresets 6 +
  bootstrap 3 dize `__t`; Rig etiketleri EN-base (Head/Waist/Knee L/R,
  parmak adları, Girl/Boy); 'tailref-pozlar-' → 'tailref-poses-'.
- canvas-editor.html statik metinler EN-base + data-l10n; editor.ts
  'canvas' fallback + toast ham anahtar.
- Ascii-alt düzeltmeler: 'yapistirilan.png'→'pasted.png',
  `{n} adding…` __t, 39-mode tab title, 48-shell 'Sert'→__t('Hard'),
  draw-v5 aynalama/karo ipuçları + 'Symmetry mode', panel-window
  tam ekran başlığı, pose3d rehber alt metinleri, 'New Brush'
  varsayılanı.
- Sözlük: 2186 → 3208 anahtar; tüm yeni anahtarlar 9 dilde;
  __t/data-l10n literalleri vs. sözlük eksik taraması boş.
- Kanıt: canvas-editor-test 60/60, pose3d-unit 17/17,
  build-locales (3208 anahtar) + build-app EXIT=0,
  build:portable EXIT=0, gates --full YEŞİL (verify-package dahil),
  canlı editör probe: EN TR-taraması temiz, TR modunda 50 çeviri,
  EN dönüşü doğrulandı.

## Tur 4l3 · Inter Variable yazı tipi (14 Kasım)

## Durum: ✅ TAMAMLANDI — şartname uygulandı, probe doğrulandı, paket + masaüstü

- Şartname: logo/marka = Inter Italic ExtraBold 800 · gövde =
  Regular 400 · panel başlıkları = Semibold 600 · araç adları =
  Medium 500. Inter SIL OFL 1.1 (rsms/inter v4.1 web woff2).
- @font-face (100-900 değişken, normal+italic): style.css,
  splash.html, canvas-editor.css; dosyalar assets/fonts/ +
  src/renderer/assets/fonts/. Eski Nunito woff2 diskte (revert-dostu).
- Yığınlar Inter-öncelikli: style.css ~40 satır (L1424 html,body
  ezici dahil), ui-shell.css, draw-proto.css, draw-v5.css,
  panel.html, preload artstation/pinterest, 22-init.js enjekte stil,
  15-menu-export.js + 48-shell.js ctx.font.
- Marka italik 800: .logo, .startupWordmark, .brandWordmark,
  splash .brand, pwBrand, .ce-brand-name.
- Panel başlığı w900 → 600: Chromium UA `b{font-weight:bolder}`
  ebeveyn 600'den 900 hesaplıyordu; `.floatingPanelHead b
  {font-weight:600}` açık kuralı (probe: w600 doğrulandı).
- Kanıt: canlı font probe (gövde w400, marka italic w800, panel
  w600, araç w500; fonts.check 400/500/600/800i true);
  canvas-editor 60/60, pose3d-unit 17/17, gates --full 55/55.
- Paket: portable yeniden inşa edildi, masaüstü kopyası SHA-256
  E39BC76D4962925DDF600D9C9EC1EDA9AD8E767D42E2C4266E8836857196E73C,
  114.763.625 bayt.
- Bekleyen (ayrı tur): main.js ana-süreç diyalog i18n (~50 TR dize;
  ana-süreç i18n altyapısı + dil senkron IPC gerektirir).

## Tur 4l4 · Ana-süreç diyalog i18n (14 Kasım)

## Durum: ✅ TAMAMLANDI — 50 dize × 10 dil, dil senkronu canlı doğrulandı

- `src/main/dialog-l10n.js`: ana-süreç i18n — 50 anahtar × 10 dil
  (EN = kimlik; 9 paket renderer terminolojisiyle hizalı).
  t(key, params) interpolasyon + EN düşüşü; localeTag() tarih biçimi.
- Dil senkronu: 01b-l10n.js → sendAppLanguage (açılış + setLang)
  → main 'app-language'; donma yolu için en son bilinen dil saklanır;
  test için 'app-language-get'.
- Kapsam: kapatma uyarısı, kaydet/aç diyaloğu başlık+filter+
  buttonLabel'ları, fallback dosya adları, .tail hataları, kurtarma
  kutuları (tarih localeTag), port-dolu/sunucu hatası kutuları,
  canvas-editor PNG kaydetme. Bilinçli EN kalanlar: marka başlıkları,
  'PNG'/'JPEG' format adları, 'unauthorized request', console/yorum.
- Test: tests/dialog-l10n-test.js (32 kontrol) → gates PURE
  (55 → 56 kapı).
- Kanıt: canlı probe 9/9 (EN boot → TR anlık → DE anlık → reload ja
  kalıcılığı); canvas-editor 60/60, pose3d-unit 17/17,
  gates --full 56/56 YEŞİL (verify-package dahil).
- Paket: portable yeniden inşa edildi, masaüstü kopyası SHA-256
  9D307B26A7D3A854D041BD27DA4DB01EAC3299565CD5947083EAF2714D8A5AF1,
  114.795.729 bayt.

## Tur 4m · "kırılma/kırık köşe" bozulması (kullanıcı raporu 14 Kas)

## Durum: ✅ TAMAMLANDI — kök neden, düzeltme, kanıt, paket, masaüstü

- Belirti: çizim sırasında tuvalde rastgele yerlerde çentik/basamak/
  kırık köşe bozulması ("sanki altında bir kare var da o panel
  bozuluyor gibi"); editör VE pano zoom'u düzeltiyor; fırça farkı yok.
- Kök neden: `inkEditorFrameChipPaint` + karosuz `sceneChip` yolu
  hedef dikdörtgeni ±2 CSS px genişletip kanvasa kırpıyor, kaynak
  dilimi çip oranından aynen alıyordu → çip kanvas DIŞINA taştığında
  (kenara/köşeye doğru vuruş) ekran-dışı kaynak içerik görünür
  hedefe ~2× sıkışıyordu; vuruş kuyruğu ekrana geri katlanıp kalıcı
  hayalet mürekkep bırakıyordu. Karosuz kolonlarda çıplak görünüyordu
  (ölçüm: kutu [1280,864,160,48], 1219 fark-px, karoKapsa=%0).
- Düzeltme: kaynak penceresi hedef haritasından türetildi
  (`sx = chip.x·rw + (cw0 − (fit.x + chip.x·scale))·(rw/scale)`; y
  simetrik) — pad + kırpım tek haritada; çip içi 1-2 px kayma/gerilme
  de aynı kökten gitti.
- Kanıt: tmp-serial-parity zoomin (12 vuruş seri, 120 ms nefes) —
  öncesi kalıcı hayalet vuruş 1'den sürüyordu → sonrası tiles ON/OFF ×
  dpr 1/1.25/1.5 hepsinde 0 kirli kayıt; tiles-ON mini/undo/oturtma
  0 fark; tmp-chip-shift OFF kayma şeritleri (ort 13.2) yok oldu.
- QC: gates 55/55 (tam zincir) · ink-smoke 233/233 · tile-stale
  dpr 1/1.25/1.5 (kanal portu 9371; 9347 Electron bind erişim engeli —
  Hyper-V dinamik rezervi).
- Paket: SHA-256 BA636EFD884EBEC45164868CA4002C9A5B2980EB0695224644F91C1182BA34D6,
  113.982.960 bayt.
- Bilinen ikincil konu (ayrı tur adayı): referans panosu minyatüründe
  %10-15 zoom'da öğe kartı çizgilerinde CSS downscale aliasing'i
  (düzensiz kesik görünüm; tahta zoom'u düzeltir). Ana tuvalle ilgisi
  yok; mip-benzeri örnekleme gerektirir.

## Durum: ✅ TAMAMLANDI — kod, test, regresyon, paket, masaüstü

## fireCheck v5.1 (Tur 4f · FİNAL — canlı doğrulandı)
- v5 tasarımından fark: QUIET_MS 160 → **220** ve skip koşuluna OR
  kanalı: `skip ⇔ age < 220 && (wnet/wpath ≥ 0.3 || wnet ≥ 1.7)`.
  Gerekçe: canlı ölçümde salınımlı sürünme net(640) 2.77–2.96 px;
  yalnız oran kanalı yürüyüş gürültüsünde iki yönde de boğulabiliyor —
  net tabanı (1.7 px) yürüyüş kanalını ekler. RESKED 220 ms.
- 30b sabitleri: HOLD_MS=550, MOVE_PX=8, QUIET_MS=220, RATIO=0.3,
  NET_PX=1.7, RESKED_MS=220.
- Canlı kanıt (tmp-diag-hold, silindi): S1 salınımlı sürünme 12/12
  skip, duruştan ~286 ms sonra ateş; S4 düşman yürüyüşü 17/17 skip;
  S2 titreme ateşler (net 0.39); S3 temiz duruş ateşler. Ateşler
  3299/10015/11884/14333 ms hep doğru. Pen-QC P18: 25/25 anlık
  'stroke', duruşta poly n=5.
- Pen-up bekleyiciyi silahsızlandırır (up handler disarm) — dönüşüm
  çizim-sonrası beklemesinde olur; tasarım gereği.

## Tur 4g · dikiş körlemesi düzeltmesi (son regresyon bulgusu)
- Belirti: pen-QC 70 karelik el-daireleri (P1/P3/P4) 'poly n=8/9'a
  dönüşüyordu; 56–60 karelikler kazayla sağ çıkıyordu.
- Kök neden (canlı iz probu): rotateFlat kopyasında (rsr) yol-sonu→
  yol-başı BOŞLUĞU (endD) iç segment gibi diziliyor; son örnek
  aralığı tam boy gelince dikiş ~180° (3.12 rad) sahte kelepire
  köşe üretip maxNarrow ≥ 0.6 köşe kapısını açıyor → RDP çokgen
  adayı kazanıyor (daire aday listesine hiç girmediği için).
- Çözüm (30b, maxNarrow taraması): dikiş örneği tespiti (rsr'de
  rs[0]'a denk gelen index) + dikişin iki yanındaki dönüşler
  (i == seamIdx || i == seamIdx − 1) tarama dışı. Yalnız kapı
  etkilenir; gerçek köşeler (≥3) hâlâ aday üretir.
- Kanıt: 7/7 profil → circle (P1 0.186 / P3 0.187 / P4 0.167 rad;
  P8/P10/P11/P13 0.194–0.201 değişmedi); shape-snap-check 51/51
  (dikdörtgen/üçgen/kare sentetikleri bozulmadı).

## Pen-QC eski glideler → eksen-saf (kod değişikliği DEĞİL)
- P3/P4/P10 eski glide hedeflerinde ~22–26 item px yanal ofset vardı;
  F2'nin küçük ölü bölgesi (0.03·r0) bu ofseti yakalayıp çapraz
  ekseni de büyütüyordu. Test hedefleri eksen-saf yapıldı (hedef
  x = kalem-sonu x vb.). F2 hassasiyeti istenen davranış.
- P10 ayrıca: çizim başlangıcı π/2 → **0.3π** — kalem-sonu 0.35π'de
  merkezin belirgin sağında (off = 3× eşik) → off-latch sx=+1.
  (π/2 iken kalem-sonu 0.0188 solunda; off-latch eşiği 0.0183'ü kıl
  payı aşıp sx=−1 kilitleniyor, 2. bacakta en minHalf'a çakılıyordu.)
- Bilinen kenar (ürün tarafı, gerekirse ayrı tur): kalem-sonu merkez-x
  eşiğe çok yakın + sağa çekme = off-latch kararı eşik kenarında
  keskin değişir (0.15·r0). Eksen-saf testler bunu bilinçli kaçınıyor.

## Tamamlananlar (kanıtla)

## 1. ✅ Dikdörtgen/üçgen/kare tanıma zayıf → **Tur 4g düzeltildi**
- **Kök neden (çift kanıtlı teşhis):** (a) yuvarlatılmış köşeli çokgende
  başlangıç/bitiş aynı kenara düşünce gapRatio 0.159 > 0.12 → AÇIK dala
  girip ~2π taramayla köşe kanıtı OLMADAN 'circle' dönüyordu; (b) küme
  taraması ilk/son W=3 örneği atlıyor → köşeden başlayan şekillerde o
  köşe hiç kümelemiyordu (teşhis: yalnız 2 küme); (c) döndürme RDP
  bölmelerini oynatıyor (test dikdörtgeninde sağ-alt köşe yutuldu).
- **Çözüm (30b):** halka dalına köşe-baskınlık kapısı (döndürülmüş yolda
  ≥3 baskın küme → kapalı sınıflandırmaya düş); kapalı dal ÇİFT kanıt
  (RDP×{döndürülmüş,ham} + küme×{döndürülmüş,ham}) → inkShapeSnapPolyClass
  adayları → inkShapeSnapPolyResidual (ortalama dik uzaklık) EN DÜŞÜK
  aday kazanır. Daire kapıları `cornered` (çift kanıt) ile kapatılır.
- **Kanıt:** shape-snap-check 51/51 (dikdörtgen dahil); tüm şamfra
  varyantları poly n=5; round18_per4 → poly n=5; closed_cornerstart_rect/
  tri → poly; closed_midstart_rect → poly; hand_circle → circle. D3
  canlı: rect_sharp/round18/wobbly, tri_sharp/round, sq_small,
  rect_slow_sharp, rect_slow_rot30, tri_slow, sq_tiny → hepsi poly ✓.

## 2. ✅ Shift+düz çizgi → F1 düzeltildi
- inkEditorSnapAdjInit 'line' dejenere bbox kenetlemesi; Shift vuruşu ham
  kalır (oturtma yarışmaz). Kanıt: probe D1 PASS (kind 'stroke',
  xDevItemPx=0). Tahta portu dahil. Pen-QC P14 (kilit açılınca oturtur,
  sonraki hareket revert etmez, parite 0).

## 3. ✅ Canlı ayar takılma → F2 düzeltildi
- ENG 0.03·r0 / REL 0.015·r0. Kanıt: probe D4 PASS (firstMoveStep=2,
  frozenAfterMove=0). İki port. Pen-QC P15 (ilk tepki 2. adımda, donma 0).

## 4. ✅ Küçültme pivotu merkez → F3 düzeltildi
- Daire dalında dx<0 → eksen başına merkez-simetrik küçülme; büyüme
  kenar-takip kalır. Kanıt: probe D4b PASS (firstShrink=2, clampAt=9,
  frozenAfterShrink=0, maxCyDrift=0.8px, h 160.6→27.5 monoton). İki port.
  Pen-QC P16 (drift 0.5 px, donma 0; clamp r0 bazlı, fırça-boyutundan
  bağımsız — size 24/48 ikisi de OK).

## 5. ✅ Hiçbir şekle benzemiyorsa pürüzsüzleştir → F4 (Tur 4e)
- inkEditorSmoothFreehandStroke: yeniden örnekleme + k=4 binomial iç
  geçiş, uçlar sabit. D5'in 'channelsReset' kriteri YANLIŞ tasarimdı →
  kriterden çıkarıldı (bilgi alanı olarak kaldı): smooth-on-null
  previewSkip/dualWts/dualComp'i SIFIRLAMAMALI (normal serbest çizim
  durumu; sıfırlamak canlı çizimi bozar). Kanıt: D5 smoothing ✓
  (curvRms 2.68→0.26, curvRatio 0.096, uçlar bit-birebir, zincir gap
  4.87px, committed 'stroke'). Pen-QC P17 (ratio 0.151, dev 3.2, gap 4.71).

## 6. ✅ Yavaş çizimde çizim-ortası dönüşüm → **Tur 4f fireCheck v5.1**
- v4 (prod+net) canlı probe'da başarısız — skip hiç çalışmıyor (ölçüm:
  sürünme net(640) 2.77–2.96 px, prod 1.07–1.4; her iki v4 eşiği
  aşıyordu). Final v5.1 yukarıda ayrı bölümde.

## 7. ✅ Tur 4g dikiş körlemesi — yukarıda ayrı bölüm.

## 8. ✅ Pen QC P14–P18 + eksen-saf glideler → 79/79
- P14 Shift-line (F1), P15 ölü bölge (F2), P16 merkez-pivot (F3),
  P17 smooth-on-null (Tur 4e), P18 yavaş sürünme (Tur 4f) — hepsi ilk
  canlı koşuda yeşil. P1/P3/P4/P10 eski vakalar seam düzeltmesi +
  eksen-saf glidelerle 79/79. tmp probe'ları (5 dosya) silindi.

## Regresyon (13 Kasım 2026, Tur 4h sonrası — tamamen yeşil)
- pen 96/96 (P19 Shift sallantı kilidi + P20 kalkış oturtması eklendi) ·
  board 47/47 · quickshape-qc 17/17 · shape-snap 51/51 ·
  canvas-shape-snap 38/38 (TS aynası kalkış oturtması sonrası) ·
  commit 7/7 · ink-smoke 233/233 · run-gates 11/11 (verify-package
  repack sonrası yeşil).
- Sözleşme güncellemeleri (uygulama gerilemesi DEĞİL, Tur 4h davranışı):
  B5 tahta QC artık oturtulmuş düz izi kabul eder (asıl sözleşme
  dünya-px kutusunun korunması; kalkış oturtması düz izi dürüstçe
  line'a çeviriyor); ink-commit-check şekil oturtmayı kapatır
  (commit hattını test eder, oturtmayı değil — kalkış oturtması düz
  izi line'a çevirince eski parite iddiası bozuluyordu); P20 dikdörtgen
  köşe sayısı 4–7 aralığı + oran-koruma kanıtı (hızlı izin kapanış
  kancası dürüst ek köşe üretir: test n=6, probe n=7, P18 yavaş iz n=5).
- B1 tahta QC ilk koşuda bir kez tüm-null döndü (ısınma yarışı; b1err
  artık check mesajında görünür), ikinci koşuda geçti ve tekrarlanmadı.

## Tur 4h (13 Kasım 2026 · kullanıcının 4 yeni raporu)

### 1. ✅ Shift sallantı kilidi — çizgi sallanınca kıvrılıyordu (27-ink-core v3)
- Kullanıcı: "sağa götürdüysem sadece sağa sola gidebilmeli; aşağı
  yukarı yaparsam sağa sola gidilmemeli." Eski v2'de ±35 px sallanan
  stres izinde eksen 45°'e erken donuyordu (yol+örnek eşiği sallantının
  ilk koşusunda doluyordu; probe A2: maxYDev 294 px, axisDeg=45).
- v3: geçici eksen NET yönden (ortalanmış) seçilir; donma koşuluna
  NET eşik eklendi: `don ⇔ (değişimden beri yol ≥ 40 px VE
  kararlı ≥ 5 örnek VE net ≥ 100 px) VEYA net ≥ 300 px VEYA
  yol ≥ 500 px`. Donduktan sonra SAF İZDÜŞÜM: dik bileşen tamamen
  atılır — sallantı çizgiyi ne bükür ne eksen boyu uzatır.
- Kanıt: probe A1 gerçekçi sallantı maxYDev 5.7e-14 px; A2 stres
  maxYDev 12–18 px yalnız giriş kırpışması, kuyruk ~0.0002 px,
  axisDeg=0. GPU/yazılım × dpr 1/1.25 varyantlarında kararlı.
- QC: pen P19a (gerçekçi: sapma 0, kuyruk 0, dik gezinti kayması 0,
  eksen 0°) + P19b (stres: giriş kırpışması ≤30 px, kuyruk ≤2 px,
  45° sapması yok). Coalesced örnekler shiftKey taşır (kilit örnek
  düzeyinde okur).

### 2. ✅ Üçgen/dikdörtgen "garip blob" — kalkış oturtması (36 + 30 + editor.ts)
- Kullanıcı: "kare dikdörtgen falan yapıyorum garip şekiller çıkıyor",
  "üçgen yapıyorum böyle yapıyor." Kök neden: hızlı çizip hemen
  bırakan kullanıcıda bekleyici (550 ms hareketsizlik) ASLA
  ateşlemez → ham iz commit edilir → domlu köşe + kapanma kancası
  blob görünümü.
- Düzeltme: kalem kaldırıldığında tanıma BİR kez daha denenir
  (`inkEditorSnapFire(true)` — 36 pointerUp, hold disarm'dan sonra;
  `inkFreehandSnapFire(true)` — 30 tahta portu). Başarılıysa şekil
  olarak commit; başarısızsa ham iz aynen (dokunulmaz). TS aynası:
  editor.ts finishStroke'ta `!snapSnapped && shapeSnapEnabled() &&
  !shiftHeld` kapısıyla snapFire (canvas-editor.js 168.5 KB yeniden
  derlendi).
- Kanıt: probe B/C/D/E — üçgen ve dikdörtgen duraksamasız bırakış VE
  bekletişte kind='shape' poly snapFree=1; oranı korunmuş
  (dikdörtgen ham 708×627 → commit 690×587). QC: pen P20
  (üçgen poly n=4, dikdörtgen poly n=6 + oran-koruma), tahta
  kalkış-oturtması B süitlerinde yeşil, canvas-shape-snap 38/38.

### 3. ✅ Zoom-out'ta çizim bozulması — yeniden ÜRETİLEMEDİ (kayıt)
- Kullanıcı: yakınken sorun yok, uzaklaşınca bozuluyor (foto 1→2).
- Doğrulama: GPU (PROBE_GPU=1) ve yazılım çizimi × dpr 1 ve 1.25
  (PROBE_DSF=1.25) × zoom 1.0→0.06 × vuruş sırasında ve sonrasında —
  hepsi sağlıklı; render hatası sıfır; karo (tile) modunda vuruş
  sırası dikiş taraması midGaps=0 endGaps=0.
- Tek gözlenen etki: kalın çizginin merkez-kanal R değerinde doğal
  AA incelmesi (z1:18 → z0.5:32 → z0.3:81 → z0.18:202 → z0.06:240) —
  basınçla ölçeklenen ~12 px etkin kalınlıkta beklenen görünüm,
  hata değil. Kod değişikliği GEREKÇELİ DEĞİL.
- Not: probe sırasında `canvas.toDataURL()` karo katmanlarını
  kaçırmaz (compositeCanvas gerekir) ve toClient/lift `inkEditorUi.fit`
  CANLI okumalı — ikisi de probe yanlılığıydı, uygulama hatası değil.

### 4. ✅ Paket
- build-native OK → electron-builder portable OK → verify-package
  PAKET GÜNCEL → masaüstü kopyası SHA-256
  70DB97E3C531319AD9A96793D0B0657C47303211360E1F91656E76724A7FDDF1
  (eski 82D03932… farklı), 113,972,313 bayt. Gates 11/11 (PURE).

## Tur 4i (13 Kasım 2026 · kullanıcının 5 raporu: yumuşatma, blob,
##    bırakış-oturtma, karo kırıkları, zoom kaybolma)

### 1. ✅ İlk açılış yumuşatması %50 idi → %5 (27-ink-core)
- Kullanıcı: "ilk girişte %50 gibi yumuşatıyor, %5 olması lazım."
- `inkCreateState()` smoothing tohumu 0.5 → **0.05** (~152 satırı);
  kapalı çizim penceresinde ilk dokunuş artık neredeyse ham izle
  başlar.

### 2. ✅ Bırakış ASLA oturtmaz — Tur 4h kalkış-oturtması KALDIRILDI
   (36 pointerUp + 30 tahta portu + editor.ts)
- Kullanıcı sözleşmesi: "çizimi bitirdikten sonra beklersem düzelsin.
  Normal çizgi çekiyorum, beklemeden bırakıyorum — o da düzeltiyor"
  + "boyamayı bitirip bırakıyorum, yuvarlağa dönüşüyor" + "basılı
  tutup çizerken bu olmamalı."
- Düzeltme: bırakış-anı `inkEditorSnapFire(true)` / `inkFreehandSnapFire(true)`
  / editor.ts snapFire çağrıları ÜÇ porttan da silindi. Oturtma YALNIZ
  bilinçli beklemede (~550 ms hareketsizlik) ateşler; ham bırakış her
  zaman ham iz olarak commit edilir. 30b başlığı tetikleme sözleşmesini
  belgeliyor. P20 bekletilen-üçgen (n=4) olarak yeniden yazıldı.

### 3. ✅ El çizimi kare/dikdörtgen "blob" — dörtlü düşüş + oran-eşleşme
   (30b-ink-shape-snap.js)
- `inkShapeSnapPolyClass`: n=4 rect adayı IsRectangle(15°) geçmezse
  QUAD çokgen fallback (dönüş ≥ 0.55, kenar ≥ rawLen·0.05, konvekslik);
  kazanan seçimi aday havuzu `resid ≤ birincil·1.6+0.01` + ham bbox
  oranına en yakın aday (`|candBboxRatio − rawRsBboxRatio|` min).
  LSQ köşe rafinerisi DENENDİ ve GERİ ALINDI (hasarsız RDP köşelerini
  bozuyordu: B 1.19→1.27, NW 44 px kayma) — gerekçe polyClass
  yorumunda duruyor.
- Kanıt (probe A–L): A dikdörtgen 1.19, B quad 1.20 (öncesi 1.32),
  C kare 1.04, D 0.97, E poly7 2.17, F daire, G 1.03, H 1.02,
  I-süpürmeler 1.18–1.19, L quad 1.20 — %8–30 boşluklu süpürmeler
  hep rect. shape-snap 51/51.

### 4. ✅ Seri çizimde karo dikiş kırıkları — kullanıcının fotoğrafı
   (36-ink-editor.js; "zoom atınca kayboluyorlar")
- Kök neden: hızlı seride vuruşlar arası yakınsama karesi DÜŞMEZ →
  önceki vuruşun canlı önizleme bitleri `tvLive` defterinde donar;
  yeni vuruşun çip karesi yalnız BÖLGE boyadığından bölge dışı bayat
  bitler ekranda kalır → karo sınırında farklı durumlar çakışır →
  çizgide dikdörtgen kırık. Zoom, fit-anahtarını değiştirip defteri
  sıfırlayıp TÜMÜNÜ yeniden boyadığı için kırıkları siliyordu.
- Fix 1 (doğrulama sertleştirme): `inkEditorTileFrame` markDirty
  ÖNCESİ kirli seti `bakeDirty` olarak çakılıyor; bu karolar çip
  bölgesine SIKIŞTIRILMADAN tam kutu boyanıyor (önceki vuruşun
  yakınsama-artığı karolarının bölge-dışı bayat bitleri artık ekranda
  kalamaz). Seri senaryosunda tetiklenmiyordu; korundu.
- Fix 2 (asıl onarım): vuruşun İLK karo karesinde (`!ui.tvChipSeen`)
  bekleyen tüm canlı/kirli karolar (`tvLive ∪ dirty`) KALICI
  kaynaklardan tam kutu yakılır — painter'a `bakePerm` modu eklendi
  (previewing=false → commit yakınsamasıyla birebir içerik; deftere
  yazılmaz, dirty'den düşer). Defter temizlenir; çip bölgeleri tutarlı
  tabana biner; dikişlerde tek durum kalır.
- Kanıt (tmp-probe-tiles-4i · 10 hızlı vuruş · geçerli asenkron
  tam-kare referansı + refProbe vuruş rengi 206/47/89):
  GÖRÜNÜR dikiş kırığı (seamBreak24, karo içeriğinde dikiş-üstü
  sıçrama ∧ referansta sürekli) satır-1 seritlerinde 172–177 px →
  **0/0**; uyumsuz piksel px8 5185→1142 (seri ortası, −78%),
  9212→1403 (seri sonu, −85%); artan fark yalnız o an çizilen
  vuruşun kuyruk bbox'ında (yumuşatıcı kuyruğu — bırakış sonrası
  ≤1 kare geçici, dikişler tutarlı). postBurst 0 (karolar imha,
  tam commit karesi) — iyileşme zoom'a muhtaç değil. tile-stale tanı
  S1-coklu12: fix öncesi 7386+3422 → sonrası 434+1019 (−90%);
  S3-S6 imzaları iki koşumda eş büyüklükte (önceden varolan tanı
  gürültüsü, `ui.stroke` olmayan yollarda flush çalışmaz).
- Kapılar: tile-parity 0 bozuk · screen-parity farkN=0/maxD=0 ·
  framechip-parity farkPiksel=0 · ink-tile-view TÜM GEÇTİ ·
  tilespeed EXIT=0.

### 5. ✅ Zoom'da çizgi kaybolması — ÜRETİLEMEDİ (kayıt)
- 9-nokta sınır-içi örneklemeli 20 ctrl+wheel olayı (zoom 0.08→16):
  her örneklemde vuruş alfa 255; zoomVanish=0, zoomUnmeasured=0;
  kod incelemesinde `!img.complete` temizleme penceresi dışında
  kaybolma mekanizması bulunamadı. Kullanıcının gördüğü "zoom'da
  kaybolan" şeyin kırıkların silinmesi olduğu (madde 4) değerlendirildi.

### 6. ✅ Paket
- build-app 46186 satır/1813.8 KB → build-canvas-editor 168.1 KB →
  build-native (inkcore.node) → electron-builder portable →
  verify-package PAKET GÜNCEL → masaüstü kopyası SHA-256
  BE1D8214439F5F65E017BFE41A5C3329269B2E8A2EA53ACD03EC8631325694AE
  (eski 70DB97E3…), 113,973,466 bayt.
- Kapılar: pen 99/99 · board 47/47 (ilk koşuda 3 turuncu = CDP
  düzensizliği; ardışık iki tam koşum 47/47+47/47) · shape-snap
  51/51 · canvas-shape-snap 38/38 · commit 7/7 · smoke TÜM GEÇTİ.

## Tur 4j (13 Kasım 2026 · "yuvarlak dışında hiçbir şekli tanımlama;
##    bekletmede mükemmelleştirme")

### 1. ✅ Sözleşme: yalnız line + arc + circle otomatik dönüşür
- Kullanıcı: "yuvarlak dışında başka hiçbir şekli kare üçgen falan
  tanımlama düzeltme yapmıyoruz."
- 30b: poly/quad/rect/triangle/çokgen makinesi (inkShapeSnapPolyClass,
  QUAD fallback, IsRectangle vb.) TAMAMEN silindi; ShapeSnapResult
  birliği `line | arc | circle`; `cornered` çift-kanıt köşe koruması
  geri geldi (köşeli açık iz yaya dönüşemez). Kare/dikdörtgen/üçgen/
  beşgen/yuvarlak-köşeli-kare → null: bekletmede YERİNDE
  mükemmelleşir, kind 'stroke' kalır.

### 2. ✅ Daire kapıları kalibre edildi (30b + TS aynası)
- `INK_SNAP_CIRCLE_RES = 0.215`, `INK_SNAP_CIRCLE_DRIFT = 0.22`.
  Tohum taramasıyla ölçüm (kararlı): kalp res 0.226–0.230 (reddet),
  kuyruklu-6 res 0.201–0.209 (kabul), kanca res 0.193–0.196 /
  drift 0.195–0.211 (kabul), içe spiral drift 0.243–0.245 (reddet),
  dışa spiral res 0.271 / drift 0.570 (reddet).
- TS aynası bayat 0.30/0.18 ile paritesizdi → 0.215/0.22 güncellendi
  (kalibrasyon yorumuyla). `Float64Array<ArrayBufferLike>` generics
  (TS 5.7). canvas-editor.js yeniden derlendi (185.7 KB).

### 3. ✅ Mükemmelleştirme çekirdeği: inkShapeSnapFairPath (30b)
- Bekletmede şekle oturmayan vuruş yerinde mükemmelleşir: resample →
  köşe saptama (0.72 rad çift kanıt) → rijit bloklar → durak-çıkışı →
  yer-değiştirme tavanı clamp(toplam×0.02, 1, 6) px → Taubin λ/μ
  (λ=0.5, μ=0.62; karalama μ=0.56). Uçlar bit-birebir (zincir
  sürekliliği), girdi mutasyona uğramaz, GERİ ALMA YOK.
- Keskin köşeler sivri kalır (Z asla S olmaz); açık izde köşeler
  arası serbest bölüm kendi akorduna düzlenir (zikzak/L/Z bacakları);
  KAPALI izde düzleme yok — el karesi/üçgeni yapı olarak korunur.
  Yarım yuvarlak → yarım YAY (asla tam daire); spiral dönüş sayısı
  korunur (asla circle). Tekrarlı bekletme kademeli rafine eder
  (hiç kötüleşmez; yer-değiştirme tavanı geçiş başına).
- Portlar: 36 `inkEditorSmoothFreehandStroke` ve 30
  `inkSmoothFreehandStrokeInPlace` çekirdeği çağırır (kind 'stroke',
  snapped işareti konmaz); editor.ts snapFire boş-dönüşte
  mükemmelleştirme düşer.

### 4. ✅ Testler Tur 4j'ye yazıldı + koşuldu
- shape-snap-check 76/76 (30b çekirdeği) · canvas-shape-snap-check
  74/74 (TS aynası, doc-px).
- Ölçüm disiplini (debugging'den): pürüzlülük ikinci-fark h²'ye bağlı
  — çapraz-aralık kıyası geçersiz; `resampleN` eş-aralıklı taban.
  Zikzak bacakları jitter-only değil KAVİSLİ (bowedLeg kavis 5 px;
  ≥7 px tavanla çatışıyor). Bacak sapması kendi YEREL akorduna
  (selfChordDev: bant d>20, t∈[0.12,0.88]; komşu diyagonalin köşe-
  yakını örnekleri bantla karışmasın) — test-akordu tilti ölçüme
  karışıyordu. Gövde pürüzlülüğü köşe çevreleri hariç (roughAway,
  30 px; rijit köşeler ölçümü domine etmesin). Kanca geometrisi
  300-uzay testiyle orantılı: merkez ofset (0.22r, 0.89r), kanca
  r = 0.5r — 6 tohumda da circle.
- pen-QC 99/99: P6/P12/P18/P20 Tur 4j'ye yazıldı (kare/yuvarlak-
  kare/yavaş sürünme/bekletilen üçgen şekle DÖNÜŞMEZ; bekletmede
  n değişir, uçlar bit-birebir, commit stroke).
- board-QC 48/48: B4/B9 üreteçlerine gerçek kalem sarsıntısı ±2 px +
  yoğun örnekleme → bekletmede mükemmelleşme GERÇEKTEN ateşleniyor
  (B4 n 121→168, B9 n 134→300), kare oranı korunur, kind 'stroke'.

### 5. ✅ Paket
- electron-builder portable OK → verify-package PAKET GÜNCEL →
  masaüstü kopyası SHA-256
  3C7A3300E0A25F7C7D438C3CA23213B12A8F7D3EBBF0C5EB318717DF2B2B9B3B
  (eski BE1D8214…), 113,986,309 bayt. Gates PURE: 11/11 (tur
  4j kapıları dahil) — tam zincir (--full) ayrı koşuldu.

## Kalan
- ✅ CHANGELOG.md Tur 4d/4e/4f/4g bölümü.
- ✅ Paket: `node scripts/build-native.js`; `cmd /c
  "node_modules\.bin\electron-builder.cmd --win portable"`;
  `node scripts/verify-package.js` → PAKET GÜNCEL;
  dist\TailRef_Studio.exe → <Desktop> +
  SHA-256 eşleşti (82D03932…E142, 108.7 MB). Gates 11/11.
- NOT: kullanıcı yanlış-oturtmada ham iz dönüşü (revert) istemiyor —
  Tur 4'te kalktı; hareket = canlı şekil ayarı. Bu yüzden fireCheck
  doğruluğu hayati (yanlış ateşleme kalıcı zarar verir).

# Tur 4k — "bekletilen her şey düzelsin" (kullanıcı onayı, 13 Kasım 2026)

> Kullanıcı sözleşmesi: bekletilen köşeli iz (kare/üçgen/dikdörtgen/
> çokgen) ASLA daireye dönmesin; köşeli şekiller kusursuz ÇOKGENE,
> basık ovaller OVAL kalsın (en-boy korunur). Open-poly (V/Z/L) kapalı
> DEĞİL. Karalama/spiral yine dokunulmaz.

## 1. ✅ Tanıyıcı (30b çekirdeği + shape-snap.ts aynası)
- Yeni sonuç türü: `{ type:'poly', closed:bool, pts:[{x,y}…] }`
  (POLY_MIN 3 / POLY_MAX 12). `stroke.shape='poly'`, `closed` bayrağı
  adayın kanıtından; 27-ink-core/36-ink-editor şekil listesine 'poly'
  eklendi; 28-ink-brush closePath yalnız circle ya da `poly && closed`.
- KAPALI çokgen adayı: ÇİFT kanıt (rsr döndürülmüş + rs ham) köşe
  kümeleri; baskınlık eşiği max(0.6, maxTurn×0.45) (DOM_MIN/DOM_FRAC);
  küme-dışı medyan dönüş < 0.12. Açgözlü köşe seçimi: en güçlü köşeden
  başla, tüm span'ler 'straight' sınıflanabilince dur; snapRefineCorners
  yutulmuş köşeleri geri getirir (tek geçiş, iki yarı da sınıflanabilir).
- AÇIK çokgen (V/Z/L): maxTurn > 0.75 → snapOpenPoly, closed=false;
  kapalı sınıflandırmaya ASLA düşmez.
- Birleşik yuvarlak karar (snapRoundDecision): 1) düz Kasa daire,
  2) robust (2 tur aykırı-kırpışlı) daire + inlier elips,
  3) robust eksen-hizalı elips. Spiral koruması: |sweep| ≥ 2π'de
  yarıçap-yay Pearson korelasyonu ≥ 0.6 → reddet.
- BOŞLUK kuralı: |sweep| ≥ 280° ve boşluk ≤ 46° (TURN_GAP 0.8) → halka;
  aksi açık-dal (köşeli → açık çokgen; köşesiz tutarlı eğri → yay).
- Basık oval: OVAL KALIR — `circle` + `oval:1, rx, ry` (r = büyük eksen).
  snapEllipseAxes (A·u²+B·v²=1 doğrusal LSQ), merkezden ya da robust
  budamayla; ELLIPSE_RATIO 1.18, ELLIPSE_SWEEP 1.25, ELLIPSE_BETTER.
- RobustCircle NaN hatası düzeltildi: `snapDist(p, f)` f={cx,cy,r} x/y
  taşımıyordu → tüm hatalar NaN, yol 2 ölü koddu. Her iki çekirdekte
  `snapDist(p, {x:f.cx, y:f.cy})` oldu.
- Kalp koruması: robust daire kapısı TÜM izin kalıntısına bakan tam-iz
  eklendi (`snapCircleResidual(rs, rob.*) ≤ 0.215`); kalp 0.241 → null,
  kanca 0.193–0.196 → geçer, kuyruklu-6 0.201–0.209 → geçer.
- Bitişik ikiz nokta temizliği (recognize girişi, <1e-6): kapalı vuruşun
  birebir dikişi küme enerjisini boğuyordu.
- Span sınıf eşikleri: SPAN_STRAIGHT 0.35, SPAN_WAVES 2,
  SPAN_WAVE_DEV 0.35→0.12 (0.35 boşluklu halkayı yutuyordu),
  SPAN_ARC_MAX 1.75×2π. Span-yay uydurma (fair v2): pinli uçlar
  (r0/r1 lerp + kendi θ), ARC_FIT_RES 0.09 / ARC_FIT_DISP 0.06.
- **Uygulama-uzayı span düzeltmesi (kritik):** gerçek uygulamada
  One-Euro + Catmull-Rom köşe dönüşünü bacaklara taşar; işaretli
  dönüş 0.35'i aşıyor (0.83–1.26 rad) ama dev/len 0.04–0.07. Yeni
  düzlük kanıtı: `dev/len ≤ %10 (SPAN_STRAIGHT_DEV)` VE iç zirve
  `≤ MAX_TURN 0.75 (SPAN_STRAIGHT_PEAK)`. Zirve koruması şart:
  uzun zigzag span'lerde dev/len küçülür (2 köşeli ~750px W parçası
  0.096) ve net dönüş iptal olur (|turn| 0.09) — korumasız W'nin
  2 köşesi yutuluyor, kısmi 4-noktalı yanlış yapı çıkıyordu. Gerçek
  yay aralıkları 0.2+ sapar → boşluklu halkanın küme-arası yayları
  asla düz sınıflanmaz. Zikzak (W) artık DOĞRU 6-noktalı açık
  çokgene oturur (önceki null + smooth yolu yerine); JS süiti W
  iddiası 4k sözleşmesine yazıldı.
- **Açık-poly baskınlık kanıtı:** `inkShapeSnapOpenPoly` köşe
  BASKINLIĞI (outMedian < 0.12) kontrol etmiyordu — 2,5-periyot dalga
  (outMedian 0.231) kısmi 4-noktalı yanlış poly'ye oturuyordu. Kapalı
  yoldakiyle aynı kanıt eklendi; dalga artık null → smooth-on-null
  (kind 'stroke/', n 142→155).
- **Fair çapa-yok structure koruması (P17):** köşe çapası
  bulunamayan izde tüm iz TEK serbest span'dır; span uydurma onu
  akorda çekiyordu → 2,5-periyot dalga düz çizgiye iniyor (dev 62
  item px, curv oranı 0). Çapasız izde düz-oturtma ATLANIR (yalnız
  Taubin; 4j davranışı) — curvRatio 0.205 (< 0.6), maxDev 0.41 px.
  Çapalı span'ler (gerçek bacaklar) akord tavanıyla düzelir.
- **Kapanış kenarı muafiyeti + değnek reddi (P20):** kapalı çokgen
  adayında SON span (kapanış) sınıf denetiminden muaf — kapanış
  kenarı köşe kord'undan SENTEZLENİR; tepe kubbesi/kapanış kancası
  gibi aşırı-sallanma uçları orada yaşar. Dengeleyici kurallar:
  (a) aday TÜM baskın köşeleri kapsamalı (eksik köşe kapanış
  arkasına saklanamaz — beşgen/dikdörtgen k=3 erken geçişi önlendi),
  (b) değnek reddi: çevrimsel köşe aralığı `max(3, n×0.07)` altı
  aday reddedilir (iğne üçgen). Kullanıcı profili üçgen (domlu tepe +
  kapanma kancası) artık poly n=4 closed=true.
- **Bilinçli boşluklu halka yay kapısı:** açık dalda geniş tarama
  (≥ 280°) + boşluk > 46° izin cv tavanı ARC_CV (0.09) yerine
  CIRCLE_CV (0.18) — en-boy oranlı tuvalde çizilen 300° boşluklu
  halka düz-elips (cv ~0.11) olduğundan dar kapıya takılıyordu
  (B2 teşhisi). Yay kalır, boşluk korunur; spiral (cv 0.3+)
  dışarıda. ink-quickshape-qc B2 bekleyişi 4k'ya yazıldı (arc) →
  17/17; ink-smoke 233/233.

## 2. ✅ Mükemmelleştirme fair v2 (30b + TS aynası)
- Kopukluk (br) onarımı: parçalar arası boşluk max(24px, yol×%6) altı →
  TEK BÜTÜN köprülenip düzeltilir (uçlar DEĞER olarak bit-birebir);
  üstü → parçalar AYRI düzeltilir, uç nesneleri + br bayrakları
  birebir korunur. BR bayrağı parçanın İLK noktasındadır.
- Ölçüm düzeltmesi: healCap/boşluk artık sX/sY İLE ölçülür (normalize
  nokta + dw/dh çağıranlarda healCap her zaman 24-normalize = 7200px
  oluyordu → büyük-kopma yolu uygulamada asla tetiklenmezdi).
- fair v2 span uydurma: açık VE kapalı izde rijit bloklar ARASINDAKİ
  serbest span'ler yapısal sınıflarına oturtulur; akord ucu blokların
  İLK rijit örneklerine pinli (a→i; sona pinlemek köşeyi aşıyordu).
  Yer-değiştirme: yay span ARC_FIT_DISP, düz span FAIR_SPAN_DISP 0.08
  tavanı; yapısal uydurma yoksa genel Taubin tavanı.
- TS aynası (shape-snap.ts) tam: tüm 4k sabitleri SHAPE_SNAP_*/SHAPE_FAIR_*
  adlarıyla, fair sarmalayıcı + snapFairCore, derleniyor (221.4 KB).

## 3. ✅ Testler
- shape-snap-check (30b): 4k sözleşmesine yazıldı → 95/95
  (+6 br-onarım testi: küçük kopukluk değer-uçlar + köprü sürekliliği,
  büyük kopukluk kimlik-uçlar + br korunur).
- canvas-shape-snap-check (TS aynası): 4k'ya yazıldı → 97/97
  (kare/dikdörtgen/üçgen/beşgen → kapalı poly + köşe hedefleri;
  L/V → açık poly; basık oval → oval:1 rx/ry; perfect poly/oval
  dalları; br onarım; Z → arc/circle değil).
- Pen QC: 99/99 — P6 (kare → shape/poly + merkez-ölçek boyama), P12 (yuvarlak
  köşeli kare → poly, n≤8, oran korunur), P17 (tanınmayan dalga → null,
  smooth-on-null: curvRatio 0.205, maxDev 0.41 px), P18 (yavaş sürünme: çizim
  boyunca stroke, duruştan sonra poly), P20-D (bekletilen üçgen →
  shape/poly n=4 + snapFree) 4k'ya yazıldı. Bırakış-oturtması YOK kuralı
  (P20 A/B/C ham iz) değişmedi.
- Board QC: 48/48 — B4 (kare → shape/poly, merkez-ölçek boyama) ve B9 (yuvarlak
  köşeli kare → poly, daire değil, oran korunur) 4k'ya yazıldı.
- tmp-replica.js (12 hedef, tohum 2026): dikişsiz kare dahil hepsi hedef
  türünde. Not: ±1px jitter'da dikişsiz 204'lük karede başlangıç köşesi
  baskınlığı kıl payı kaçabiliyor (üçgen adayı) — test üreticileri dikişi
  1px kaydırarak kapatıyor (JS süitindeki squarePx kuralı).

## 4. ✅ Paket + dokümantasyon
- build-canvas-editor OK (226.8 KB); build-app → run-gates --full (55/55
  kapı yeşil, tam zincir) → electron-builder portable → verify-package
  PAKET GÜNCEL → masaüstü kopyası SHA-256
  74940AC169B26258B30D9AFCDECE6145A8A0E437115368B8333EC57912E0AB53,
  113,997,512 bayt (eski: 3C7A3300…, 113,986,309 bayt).
- CHANGELOG.md Tur 4k bölümü + 28-ink-brush closePath/rendering notu.
- Geçici dosyalar silindi (tmp-diag-*, tmp-probe-ts, tmp-replica,
  *-out.txt, tests/tmp-ss-diag.js, mkdiag).
