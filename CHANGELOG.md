# CHANGELOG

Format bu repo için sadeleştirilmiş Keep a Changelog'dur; sürümler
[SemVer] mantığıyla (MAJOR.MINOR.PATCH) ilerler.

## [1.4.1] — 2026-11-20

Çizim hissini/akıcılığını koruyarak performans turu (parite sözleşmesi
korundu: canlı önizleme == tahtada bırakılan raster).

### Added — marka, telif ve depo düzeni

- **Lisans:** MIT yerine **PolyForm Noncommercial 1.0.0** (değiştirilmemiş
  resmî metin + `Required Notice`). Paket `license` alanı, README, NOTICE ve
  üçüncü taraf bildirimleri buna göre güncellendi. Üçüncü taraf bileşenler
  kendi lisanslarını korur.
- **Marka kimliği:** Ürün **TailRef**, yayın markası **TailRef Studio**,
  geliştirici **Emre Melik Nameli**. About'a Credits bölümü, Ayarlar alt
  şeridine telif satırı eklendi.
- **Telif satırı:** `© 2026 TailRef Studio. All rights reserved.` —
  geliştirici atfı `Developed by Emre Melik Nameli`.
- **Yeni belgeler:** `NOTICE`, `LICENSE-FAQ.md`, `TRADEMARK.md`,
  `docs/CLA.md`, `docs/ARCHITECTURE.md`, `docs/FEATURES.md`,
  `docs/INSTALLATION.md`, `docs/DEVELOPMENT.md`, `docs/ROADMAP.md`,
  `docs/RELEASE.md`, `docs/PROJECT_AUDIT.md`, `docs/licenses/*`.
- **Depo düzeni:** `.gitattributes`, `.editorconfig`, GitHub issue şablonları,
  pull request şablonu, `FUNDING.yml`, `docs/README.md` belge dizini,
  yeniden yazılmış CI ve **elle** çalışan derleme iş akışı.
- **Font lisansları:** Inter ve Nunito Sans için OFL 1.1 metinleri eklendi;
  fflate sürümü (0.8.2) ve three.js telif yılı düzeltildi.
- **SimplexNoise lisansı doğrulandı:** dosya three.js r170
  `examples/jsm/math/SimplexNoise.js` ile birebir aynı (yerel SPDX başlığı ve
  export satırı dışında) → three.js MIT kapsamında.
- **Ekran görüntüleri:** README artık uygulamadan alınmış altı gerçek ekran
  görüntüsünü (`docs/screenshots/`) gösteriyor; galeri ve çekim kuralları
  güncellendi.

### Fixed — fırça kütüphanesi

- **Kategoriye taşıma kalıcı oldu:** Sağ tık → "kategoriye taşı" işleminden
  sonra proje kaydı tazelenmiyordu; yeniden açılışta fırça eski kategorisine
  dönüyordu. `scheduleSave()` eklendi.
- **Favori yıldızı listeyi başa sarmıyor:** Aynı kategoride kaydırma konumu
  korunuyor; kategori değişiminde liste (doğru şekilde) başa dönüyor.
- **Kategori silme onayı:** Yarım kalan cümle ("… ve 3 — bu fırçayı kaldır?")
  yerine sayıya göre tekil/çoğul düzgün metin.
- **İçe aktarılan `.abr` fırçaları** artık `custom` kategorisiyle kaydediliyor;
  eski kayıtlar açılışta onarılıyor.
- **Favori/kategori işlemleri** tüm fırça + uç kayıtlarını yeniden yazmıyor
  (`inkNativePersistLibraryAll({ brushes: false })`).
- **Katman seçimi** tam kare kompozit tetiklemiyor (`invalidateEditor: false`).

### Fixed — testler ve altyapı

- `overload-test` ve `pinterest-test` üretim portu **5194**'ü kullanıyordu;
  5411/5412'ye taşındı (uygulama açıkken `listen EACCES` alınıyordu).
- `compositor-test`, `fx-pipeline-test` ve `fx-visual-qa` geçici dizin olarak
  kullanıcıya özel `C:\Users\namel\...` yolunu sabitliyordu; `os.tmpdir()`
  kullanıyor (CI ve başka makinelerde de çalışır). QA probe'larındaki sabit
  yollar da temizlendi.
- Kapı zincirindeki çift `ink-native-parity-check` kaydı kaldırıldı.
- `verify-package` kapısı, `dist/win-unpacked` yokken yalancı kırmızı vermek
  yerine açıkça atlanıyor (temiz klon ve CI).
- Pencere açılışını bekleyen beş UI kapısında bekleme süresi 30 → 60 sn
  (yüklü makinede `persistence-welcome-test` "pencere açılmadı" diye flake
  veriyordu; iddia değil, yalnızca bekleme).
- Kapı zinciri kırmızı bir kapıyı **bir kez** yeniden koşuyor; gerçek
  regresyon iki koşuda da kırmızı kalıyor, tek seferlik GPU/zamanlama
  sapması zinciri durdurmuyor.
- `.gitignore` içindeki `app.js` deseni `src/renderer/app.js`'i de yok
  sayıyordu; kök dosyaya sabitlendi.
- CI, var olmayan `build-canvas-editor.js` betiğine bağlıydı; gerçek derleme
  adımlarına çevrildi.
- Kullanılmayan `typescript` geliştirme bağımlılığı kaldırıldı.

### Changed + Fixed (panel pencereleri — 18 Kasım 2026)

Ayrı panel pencereleri tek bir yöneticiye taşındı; kopya + senkron modeli
güvenilir hâle getirildi. Dock'taki panel davranışı, kayıtlı panel
konumları ve mevcut test sözleşmeleri korundu.

- **Tek yetkili yönetici:** Pencere yaşam döngüsü, dock sezgisi, tam ekran
  ve IPC kanalları `src/main/panel-window-manager.js` içinde toplandı;
  `main.js` içindeki dağınık blok ve ikinci `panelWindows` haritası
  kaldırıldı. Aynı panel için ikinci pencere açılmaz (tek örnek).
- **Başlıkta "dışarı çıkar" düğmesi:** Taşınabilen her panel başlığına
  iki pencere simgesi eklendi (başlığı olmayan metin denetçisinde ince
  çubuğun sağ üstünde). Ayrı pencerede aynı düğme "geri tak" olur.
- **Eksik senkron giderildi:** Inline style (pomodoro ilerlemesi), aria-*
  ve data-* durumları, panel kökü sınıfı ve kaydırma konumları taşınır.
  Yapısal değişimlerde (Ayarlar'da sayfa değişimi gibi) panelin temiz bir
  HTML kopyası gönderilip kopya yeniden kurulur; odak ve kaydırma korunur.
  Sık yeniden üretilen listeler aynı HTML'i ürettiğinde kopya boşuna
  yeniden kurulmaz (odak/kaydırma ve kaydırma köprüsü kararlı kalır).
- **Kaydırma geri takılınca korunur:** Ayrı pencerede kaydırılan Ayarlar
  sayfası, panel uygulamaya döndüğünde aynı konumda açılır; gizli ana
  kopyaya yazılamayan konum panel kapanmadan önce saklanır.
- **Dosya girişleri:** Ayrı penceredeki `<input type=file>` seçimleri
  32 MB sınırıyla ana pencereye `File` olarak aktarılır; daha büyük
  dosyalarda panelin geri takılması gerektiği söylenir.
- **Klavye:** Enter/Escape yerine tüm tuşlar ve değiştiriciler iletilir;
  Ayarlar'daki kısayol yakalama ayrı pencereden çalışır (global kısayol
  tetiklenmez).
- **YouTube:** Panel artık ayrı pencereye taşınabilir; oynatıcı ayrı
  pencerede tek oynatıcı olur, ana penceredeki oynatıcı çalmaz. Ses
  kaydırıcısı ve bağlantı yükleme köprülenir.
- **Dayanıklılık:** Taşıma başarısız olursa panel uygulama içine geri
  alınır; ana pencere yenilenir/çökerse öksüz ayrı pencereler kapatılır;
  çift taşıma isteği tek pencere açar. Ayrı pencereden gelen eylemler
  tür/alan/boyut doğrulamasından geçer.
- **Test:** `tests/panel-window-test.js` eklendi (17 kontrol) ve
  `run-gates --full` zincirine girdi.

### Added (çizim panelleri — 19 Kasım 2026)

Çizim modundaki dört v5 paneli (Referans Panosu, Renk Çarkı, Katmanlar,
Fırça Kütüphanesi) de ana uygulama panelleri gibi ayrı pencerede açılabilir.

- **Dört panelde "dışarı çıkar" düğmesi:** Panel başlığındaki pencere simgesi
  paneli ayrı pencereye taşır; ayrı pencerede aynı düğme "geri tak" olur ve
  × paneli kapatır. Çizim modundan çıkınca açık v5 pencereleri kapatılır;
  paneller dock'taki son görünürlük durumlarına döner.
- **Canlı kopya:** Panel DOM'u `#v5DrawUI` sarmalayıcısıyla taşınır. Renk
  çarkı ve fırça önizlemeleri gibi canvas pikselleri ile referans panosunun
  canlı tahta görüntüsü raster olarak senkronlanır; pencere açılırken
  kaybolan güncellemeler ilk turlarda yeniden gönderilir.
- **Etkileşim köprüsü:** Ayrı pencereden renk çarkı sürükleme, katman
  ekleme/seçme, fırça kartı seçimi, referans panosunda sürükle-gezin ve
  tekerlek-yakınlaştır ana panele işler. Çark ve panolar gerçek panel
  geometrisiyle çalışır; gizli panel ekran dışında, görünmez biçimde
  yerleştirilip ölçülür.
- **Pencereyi tutma ve boyutlandırma:** Düğmeyle açılan pencere uygulamanın
  üstünde doğduğu için ilk küçük harekette geri takılıyordu; artık pencere en
  az bir kez uygulamanın dışına çıkmadan geri takılmaz. Panel kenarındaki
  tutamaklarla ayrı pencere gerçekten büyütülüp küçültülür; yeni ölçü ana
  panele bildirilir, çark ve referans görüntüsü o çözünürlükte tazelenir.
- **Sürükleyerek dışarı çıkarma:** Dört v5 paneli de başlığından pencere
  dışına sürüklenerek ayrı pencereye taşınır (ana panellerle aynı 60 px
  eşiği); düğme artık tek yol değil.
- **Test:** `tests/panel-window-test.js` dört v5 panelini, raster aktarımını,
  pencere boyutlandırmayı, renk çarkı/katman/fırça/referans etkileşimlerini
  ve geri takmayı kapsayacak şekilde genişletildi (31 kontrol).

### Changed + Fixed (FX performans turu — 18 Kasım 2026, tur 6)

FX zinciri aynı pikselleri üretmeye devam ediyor; yalnız hesaplama yolu
hızlandı. Kanıt: `fx-hash-probe` 20/20 piksel parmak izi tam (10 efekt ×
1600×1200 ve 3840×2160); `fx-pipeline-test` 53/53 — önizleme tam
çözünürlük, bırakınca piksel farkı 0.

- **Watercolor + Ink Bleed bulanıklığı:** dört kanal tek taramada
  döndürülüyor (eskiden kanal başına ayrı H+V turu vardı: 4× döngü ve
  indeks yükü). Toplama sırası ve aritmetik birebir korunduğu için çıktı
  değişmiyor. `noise.at(x,y)` yerine önceden hesaplanmış indeks tabloları.
- **Efekt içi geçici dizi havuzu:** 4K karede çağrı başına ~300 MB typed
  array ayırıp GC fırtınası yaratan efektler artık `(w,h)` kuşağına bağlı,
  LRU tahliyeli (768 MB üst sınır) havuzdan besleniyor; alınan tampon yeni
  dizi gibi sıfır doludur (parite şartı). Kapsam: Watercolor, Ink Bleed,
  CMYK, Charcoal, Contour, Posterization, Color Halation.
- **Posterization sıcak döngüsü:** piksel başına `q()` çağrısı ve
  `Math.min/max` kaldırıldı (satır içi kelepçe), Bayer satırı döngü dışına
  alındı. Aritmetik aynı → piksel aynı.
- **Tam kare kopya kaldırıldı:** `inkFxPutImageData` artık
  `new ImageData(data, w, h)` ile doğrudan yazıyor (4K'da efekt başına
  ~33 MB'lık `createImageData` + `set` kopyası yok).
- **Aşama/girdi tuvalleri geri dönüştürülüyor:** imza değişince aynı
  boyuttaki tuval `clearRect` + bağlam durumu sıfırlanarak yeniden
  kullanılıyor (4K'da aşama başına ~66 MB ayırma/GC yok).
- **Önizleme aralığı uyarlanabilir:** sabit 80 ms yerine son ölçülen
  zincir süresi × 1.1 (80–400 ms arası). Ağır zincirde istek birikmiyor,
  sürükleme kilitlenmiyor; ara kareler atlanır, son değer gecikmeli
  boyanır. Tam çözünürlük ve parite korunur.
- **Yanlış "yanıt vermiyor" kurtarma kutusu:** 4K FX zinciri tek karede
  1.5 sn'yi aşabildiği için gözcü yanlış pozitif üretiyordu. Renderer ağır
  iş sırasında ana sürece `renderer-busy` bildiriyor; ayrıca eşik 4 → 6
  ardışık yoklamaya (~18 s) ve yavaş yanıt eşiği 2500 ms'ye çıkarıldı.
  Sentetik yük koşuları (bench/profil/parmak izi) `TailRef_NO_RECOVERY=1`
  ile gözcüyü kapatır. Sağlıklı yedek yokken açılan kutuda varsayılan ve
  Escape artık **"Bekle"** (önce "Temiz başlat" seçiliydi; yanlış alarmda
  Enter'a basmak veriyi arşivleyebiliyordu).

Ölçüm (`fx-bench-probe.js`, en iyi 3, varsayılan tuval; süre ms):

| Efekt | 1600×1200 | 3840×2160 |
|---|---|---|
| Watercolor | 372 → **303** | 1671 → **1424** |
| Ink Bleed | 349 → **189** | 1668 → **986** |
| Charcoal | 216 → **140** | 677 → **654** |
| Paper Grain | 117 → **101** | 488 → 466 |
| Oil Paint | 176 → 184 | 794 → 782 |
| Contour | 89 → 97 | 407 → 419 |
| Posterization | 99 → 127* | 433 → 495* |

\* Koşular arasında 4K ölçümlerinde ±%8, Posterization'da ±%20 salınım
görülüyor (ikinci turda 1600×1200 için 108 ms ölçüldü); kod yolu hızlandı,
kalan fark ölçüm gürültüsü. Heap sıçraması 4K'da Ink Bleed +127 MB →
+33 MB, Watercolor +102 MB → +82 MB.

### Fixed (kullanıcı hata turu — 15 Kasım 2026 denetimi, canlı kanıtlı)

Kullanıcının bildirdiği arızalar tek tek canlı instance (CDP 9399/8787)
üzerinden kanıtlandı; her düzeltme SS + DOM ölçümüyle doğrulandı:

- **FX slider önizlemesi artık birebir (18 Kasım 2026, tur 5):** sürükleme
  sırasında zincir 0.35 ölçekte (en fazla 720 px) hesaplanıp ekrana geriliyordu;
  efektlerin piksel tabanlı parametreleri (`blockSize`, bleed, ofsetler, gürültü
  karoları) ve piksel başına tüketilen deterministik RNG ölçekle değiştiği için
  \"sürüklerken görünen\" ile \"bırakınca oluşan\" bambaşka oluyordu (gökkuşağı /
  blok artefaktları). Artık önizleme de TAM çözünürlükte hesaplanır; yalnız kare
  sıklığı 80 ms ile sınırlanır (ara değerler atlanır, son değer gecikmeli
  boyanır; aşama önbelleği sayesinde yalnız değişen efekt yeniden hesaplanır).
  Kanıt: `fx-pipeline-test` 53/53 — önizleme aşaması `fx_prev@320x240`, bırakınca
  piksel farkı **0**.
- **Fırça oluşturucu test alanı: çizerken görünen iz = bırakınca çıkan iz:**
  canlı katman her karede n-kök alfa seyreltmesiyle (ve ilk karede `baseAlpha`
  ile) boyanıyordu; bırakınca tek geçişli `stroke.opacity` kompoziti devreye
  girdiği için iz belirgin şekilde koyulaşıyordu. Artık damlalar şeffaf bir
  ağırlık tamponuna TAM ağırlıkla birikir (`dualDirect` + `skipDabs`,
  `stableOnly` ile uç ertelenir) ve canlı katman bu tamponun `stroke.opacity` ile
  tek geçişli kompozitidir; geometri CSS px yerine cihaz pikselinde hesaplanır
  (DPR'de kırpılma/kayma yok). Kanıt: `ink-smoke` 235/235 — canlı/commit ortalama
  alfa 174/178, model paritesi piksel farkı ≤ 3.
- **Ayarlar > Kısayollar \"Hangi tuş ne yapıyor?\" kartı açılmıyordu:** kart
  açılır açılmaz gövdeye eklenen ilgisiz bir sınıf (`studio-panel-open`)
  `mode-draw` yok diye onu kapatıyordu. Artık yalnız GERÇEK mod değişiminde
  kapanır; ayrıca Ayarlar paneli açıkken kart onun soluna (yer yoksa sağına, dar
  ekranda ortaya) yerleşir ve `z-index` 2160 ile panelin önünde kalır. Kanıt:
  `settings-hub-test` 72/72 — kart 120,116 · ayarlar 562,116 (çakışma yok),
  kapat/yeniden aç çalışıyor.
- **FX paneli (insan QA turu 3, 18 Kasım 2026):** koşullu parametre satırları
  `hidden` olsa da görünüyordu (satırın `display:grid` kuralı UA'nın
  `[hidden]` talimatını eziyordu) → artık gerçekten gizli; açılır liste
  değişikliği modele uygulanıyor; preset etiketi elle değişiklik, Reset ve
  Ctrl+Z sonrası parametrelerle doğrulanıp temizleniyor; FX satırları
  klavyeyle seçilip silinebiliyor (Enter, `:focus-visible`, aria etiketleri)
  ve işlem/silme sonrası odak korunuyor; çift tıklama artık iki efekti
  silmiyor (ikinci tık `detail > 1` ile yok sayılır).
- **FX paneli eski görselin efektlerini gösteriyordu:** A görseline efekt
  ekleyip çıkıp B görselinde \"Çizim yap\" denince FX sekmesi açık kalıyor ve
  A'nın yığını B'de listeleniyordu (kontroller tepkisiz) → görsel kapsamına
  girildiğinde panel tazelenir (`modeEnterDraw`). Ayrıca kapatılan parametre
  grubu panel yeniden kurulunca açılıyordu → grup durumu korunur.
- **FX satır seçimi aç/kapa:** seçili efekt satırına ikinci kez tıklamak
  hiçbir şey yapmıyordu; parametre panelinden çıkmak için başka efekt
  seçmek gerekiyordu → aynı satıra ikinci tıklama (veya Enter) seçimi
  kaldırır, inspector "Select an effect row…" ipucuna döner.
- **FX paneli ince kusurları (tur 4):** efekt tarayıcısında çift tıklama
  efekti iki kez ekliyordu (her ekleme 4K'da ~1 s bloklar) → ikinci tık yok
  sayılır; sıra uçlarındaki ↑/↓ etkin görünüp hiçbir şey yapmıyordu → devre
  dışı; paneldeki tek Türkçe metin ("Şeffaf") → "Transparent"; preset adı
  alanına ve efekt arama alanına `aria-label`, liste satırlarına
  `role=listitem`; "Delete" yalnız kullanıcı preseti seçiliyken etkin.
- **FX aşama tuvali sızıntısı:** son efekt silindiğinde zincir hesabı hiç
  koşmadığı için temizlik atlanıyor, silinen efektin aşama tuvali
  (2800 px'te ~17 MB) öğe kapanana kadar bellekte kalıyordu →
  `inkFxPruneStages` her yapısal değişiklikte çalışır; kalan efektlerin
  önbelleği korunur.
- **Hakkında / açılış ekranı metni:** açılış ekranındaki "FOR ARTISTS"
  etiketi "Made by an artist, for artists." oldu; Ayarlar → About sayfasına
  uygulama tanıtımı, sanatçı notu ve "AI should be a tool in an artist's
  hands, never a replacement for the artist." inancı eklendi.
- **FX bellek sızıntısı:** öğe silinince tam çözünürlüklü FX girdi/aşama
  tuvalleri `inkFxRuntime` Map'lerinde kalıyordu (4K FX öğesi başına
  ~100 MB, oturum boyunca birikiyordu) → `inkFxDisposeItem` +
  `inkHandleItemsRemoved` kancası; undo ile geri gelen öğe FX zincirini
  yeniden hesaplıyor.

- **Fırça imleci ayarı gerçekten ölüydü** (gerçek hata): `tailref-brush-cursor`
  localStorage'a yazılıyor ama okuyan kod yoktu. `36-ink-editor.js`'e tek
  okuma kapısı `inkEditorBrushCursorMode()` eklendi ('ring'/'cross'/'hidden';
  bilinmeyen/eksik anahtar → 'ring' parite): ring → halka canvas'a çizilir +
  CSS cursor 'none'; cross → 'crosshair' + halka yok; hidden → 'none' + hiç
  çizim. Seçim değişince açık editörde anında yenilenir
  (`60-settings-hub.js`). Canlı kanıt: 4/4 (varsayılan halka 3354 px,
  cross/hidden 0 px).
- **Inspector başlığındaki bozuk karakter (mojibake)**: `style.css:3297`
  `content:"â ¿"` çift kodlanmıştı → `"⠿"` (U+283F sürükleme noktası)
  düzeltildi; ayrıca `52-native-brush-library.js:1509` `' Â« '` → `' « '`.
  Kaynakta kalan tek mojibake yok (tarama: core/canvas/pose3d/main/preload
  + statik html/css). Canlı SS: inspector "⠿ TEXT" düzgün.
- **Tooltip kırpması**: düğmelerde native `title` yasaklandı (pencere
  kenarında tek satır kırpılan kutu; özel pill ile üst üste binme).
  `01b-l10n.js` düğmelerde `data-l10n-title`'ı `data-tooltip` +
  `aria-label`'a yazar, `title`'ı siler; `#settings button[data-tooltip]::after`
  sağ çapraz (`tooltip-pop-left`). Canlı kanıt: title yok, pill 1060..1305
  panel 562..1322 içinde.
- **Ayarlar paneli pencere dışına taşabiliyordu**: `17-floating-panels.js`
  bırakınca `constrainFloatingPanel()` + bozuk kayıt savunması (`#settings`
  için `saved.left < 24` → kayıt temizlenir, CSS varsayılanı). Canlı kanıt:
  left=5 bozuk kayıtla panel 562px'te sağ üstte açıldı.
- **`tests/layer-store-test.js` CDP portu 9399 → 9373**: canlı kullanıcı
  instance'ının hata ayıklama portuyla çakışıyor, kapı hatalı kırmızıydı
  ("ana pencere açılmadı"); kod regresyonu değil, port çakışmasıydı.
- **Native `title` artık hiçbir ayar düğmesinde yok (tam kapsam)**:
  `index.html`'deki 183 statik `data-l10n-title`/`title` çifti silindi
  (boot zaten title'ı silip data-tooltip'a yazıyordu — davranış aynı);
  dinamik üretimi satırlar da kanala taşındı: vurgu renk kutuları
  (`62-settings-extended.js`), kısayol düğmeleri ve sıfırlama topuzu
  (`60-settings-hub.js` + `43-ink-workspace-menu.js`). Canlı kanıt:
  120/120 düğmede title=0, 82 data-tooltip pill dolu. Not: `build-native`
  canlı instance `inkcore.node`'u kilitleyince atlandı (native kod
  değişmedi); electron-builder doğrudan koşuldu.

### Added + Fixed (3D gezinme şemaları ve iletişim adresi - 18 Kasım 2026)

- **3D gezinme şeması seçimi** (Ayarlar → 3D Pose → "3D navigation"): endüstri
  standardı (Alt + sol = orbit, Alt + orta = pan, Alt + sağ = dolly) ile
  Blender (orta = orbit, Shift + orta = pan, Ctrl + orta = dolly) arasında
  geçiş. Seçim `tailref-pose3d-nav` anahtarında kalıcıdır; panel açıkken
  anında uygulanır, kapalıyken kamera motoru açılışta okur. Tekerlek her iki
  şemada da zoom yapar; düz sol/sağ basış seçim ve gizmo için serbest kalır.
- **Blender'da Shift + orta ters çalışıyordu:** OrbitControls, ROTATE
  eyleminde Shift/Ctrl gördüğünde kendisi PAN'a geçiyor; biz de Shift'i PAN'a
  eşleyince kombinasyon tekrar ROTATE'e dönüyordu. Shift yerleşik davranışa
  bırakıldı, yalnız Ctrl + orta DOLLY'ye alındı. Canlı kanıt: pan sırasında
  kamera–hedef ofseti birebir sabit ([1.752, 1.164, 3.342]), orbit'te yön
  değişiyor, Ctrl + ortada mesafe 3.949 → 4.072.
- **"Maya" etiketi kaldırıldı:** seçenek artık "Industry standard"; yardım
  metinleri, 3D rehberi ve toast da aynı dili kullanıyor. 10 dilin tamamı
  güncellendi (tr "Endüstri standardı", de "Industriestandart", ja "業界標準",
  zh-CN "行业标准" …).
- **İletişim adresi:** tüm arayüz ve dil dosyalarında
  `tailref@gmail.com` → `tailrefstudio@gmail.com`.
- **Yerelleştirme kaynağı eşitlendi:** `locales/*.json` dosyaları, 18:09
  paketindeki hasarsız sözlükten geri kuruldu; böylece sonradan silinmiş
  görünen 19 anahtarın (Lock / unlock, Send to back, Idle fade …) çevirileri
  geri geldi ve `.tail` kalıntıları temizlendi. `01c-locale-data.js` yeniden
  üretildi (10 dil · 12.246 anahtar).

### Fixed (kayıt sistemi denetimi - 18 Kasım 2026)

Otomatik ve manuel kayıt yolları uçtan uca incelendi; bulunan veri kaybı
riskleri kapatıldı ve her düzeltme regresyon testiyle sabitlendi
(`tests/persistence-safety-test.js`, 17 kontrol).

- **"Temiz başlat" özel fırça kütüphanesini siliyordu:** `archiveAndWipeBoards`
  tüm `meta` anahtarlarını siliyordu; arşive de girmeyen `ink:brushes`,
  `ink:fx-presets` ve `nbprev|*` fırça önizlemeleri kalıcı olarak yok
  oluyordu. Artık yalnızca pano verisi (`state`, `workspace`, `project:*`)
  ve görseller silinir.
- **`.tail` ve otomatik yedek şişiyordu:** payload, IndexedDB'de kalmış
  sahipsiz görselleri de gömüyordu (manuel modda `gcImages` çalışmadığı için
  her kayıtta büyüyordu). Artık yalnızca panolarda referanslanan görseller
  yazılır.
- **Dosya açma kaydedilmemiş işi siliyordu:** `.tail`/yedek açılırken mevcut
  panolar uyarısız değiştiriliyordu. Açmadan önce otomatik modda `flushSave`,
  manuel modda canlı tahtayı içeren acil kopya alınır.
- **İçe aktarma sonrası yeniden yükleme yarışı:** `importBackupPayload` sonrası
  `location.reload()` sırasında `pagehide` flush'ı canlı (eski) tahtayı import
  edilen kaydın üstüne yazabiliyordu. Import + reload arasında kayıt askıya
  alınır; import başarısız olursa otomatik kayıt geri açılır.
- **Manuel modda gereksiz "kaydet?" sorusu:** kullanılmakta olan
  `rfvrSavedOnce` bayrağı hiç okunmuyordu; kaydedip hemen kapatınca bile soru
  çıkıyordu. Yerine gerçek durum imzası (`manualStateSignature`) geldi:
  tahta panoları + kamera/poz karşılaştırılır, değişiklik yoksa soru sorulmaz.
  Bir değişiklik yolu kayıt çağırmayı unutsa bile imza değiştiği için veri
  kaybı riski yoktur.
- **Sessiz kayıt hatası:** IndexedDB yazımı veya disk yedeği başarısız
  olduğunda kullanıcı "otomatik modda her şey kaydediliyor" sanıyordu; artık
  oturumda bir kez uyarı gösterilir.
- **Adlandırma:** iç adlandırmadaki `rfvr` kaldırıldı (`save-tail` /
  `open-tail` IPC, `saveTail` / `openTail`, `buildTailPayload`, `saveAsTail`,
  `openTailFile`). Dosya imzası `TAIL` oldu; eski Refeverr sürümlerinin
  `RFVR` imzası okuma tarafında kabul edilir (`.tail` uzantısı değişmedi).
  Format belgesi `docs/TAIL_FORMAT.md`.

### Fixed (kayıt sistemi sertleştirme — 18 Kasım 2026, tur 2)

İkinci denetimde kalan veri kaybı, donma ve disk şişmesi riskleri kapatıldı;
regresyon testi 33 kontrole çıkarıldı (`tests/persistence-safety-test.js`).

- **Acil kopya ve arşiv yarım yazılabiliyordu:** `save-emergency` /
  `save-archive` düz `writeFileSync` kullanıyordu; artık `writeFileAtomic`
  (tmp + rename). Veri kaybı anında güvenilen son çare bozuk kalmıyor.
- **Büyük panoda ana süreç donuyordu:** `.tail` sıkıştırma/açma senkron
  `zlib` ile yapılıyordu; async `deflate`/`inflate`'a geçildi.
- **Bozuk/kötü niyetli `.tail` belleği tüketebiliyordu:** disk dosyası
  1 GB, açılmış JSON 1,5 GB ile sınırlandı (`maxOutputLength`); bozuk
  gövde çökme yerine "geçerli bir .tail değil" hatasıyla reddediliyor.
- **Boşta otomatik yedek diski yoruyordu:** son yedekten beri yeni kayıt
  yoksa zamanlayıcı yazmıyor; yazım başarısızsa sayaç sıfırlanıp sonraki
  turda yeniden deneniyor. Sağlık kontrolü dosyayı yeniden okuyup
  `JSON.parse` etmek yerine renderer'dan gelen öğe/görsel sayılarıyla
  yapılıyor.
- **Ctrl+S geri bildirimsizdi (otomatik mod):** kayıt sonrası "Saved to
  this device." bildirimi; üst üste basışta ikinci kayıt kutusu açılmıyor
  (tek uçuş).
- **Daha yeni sürüm dosyası veriyi bozabilirdi:** payload `version` > 2
  ise içe aktarma reddediliyor; dosya hiçbir kayda dokunmuyor.
- **Görsel GC yarışı:** blob yazılıp öğeye bağlanana kadar GC bekletilir
  (`beginImageWrite`/`endImageWrite`). Başarılı `.tail` kaydından sonra
  `pruneUnusedImagesNow` sahipsiz görselleri temizler; IDB'de kayıtlı
  (oturumda yüklü olmayan) panoların görselleri korunur. Manuel modda
  biriken orphan görseller böylece temizleniyor.
- **"Temiz başla" açıkken açılan dosya silinebiliyordu:** aynı oturumda
  açıkça yüklenen `.tail`/yedek `tailref-opened-file-once` bayrağıyla
  yeniden yüklemede korunuyor.
- **Görsel listesi eksiksizliği:** `imagesComplete` bayrağı eklendi; bir
  görsel kodlanamazsa dosya "eksiksiz" işaretlenmiyor. Dosya eksiksiz
  olduğunu söylediği hâlde panonun görseli ne dosyada ne cihazda varsa
  açılışta uyarı gösteriliyor; görsel yazılamazsa da tek seferlik uyarı
  çıkıyor.
- **Test kapsamı:** `.tail` yaz/oku turu, bozuk dosya reddi, yeni sürüm
  reddi, boşta yedek atlama, görsel GC koruması ve açılan dosyanın
  korunması regresyonlara eklendi. Ayrıca `tests/portable-save-test.js`
  paketlenmiş `TailRef Studio.exe`'de otomatik kayıt → kapat → yeniden aç
  turunu, Ctrl+S bildirimini, acil kopya/yedeği ve `.tail` açmayı doğrular
  (14 kontrol, izole `TailRef_E2E=1` profili).
- l10n: "Saved to this device." (10 dil · 12.255 anahtar).

### Added (kullanıcı istekleri — footer Kaydet/Sıfırla, UI ölçeği küçük adımlar, 15 Kasım 2026)

- **Footer Kaydet/Sıfırla** (Ayarlar paneli sağ alt): "Save" diyalogsuz
  sessiz yazma (`save-preferences-auto` IPC; userData + exe yanı 2 kopya),
  "Reset all settings" mevcut sıfırla akışıyla aynı (confirm + clear +
  reload). Boot'ta localStorage `tailref-*` anahtarı yoksa dosyadan
  otomatik geri yükleme (`tailref-prefs-restored` işareti, sonsuz döngü
  koruması). Canlı kanıt: `fileOk=true`, dosyalar yazıldı.
- **UI scale %85/90/95** (`settingsUiScaleSelect`): gerçek `webFrame`
  zoomFactor. Canlı kanıt: 0.9/0.95/0.85 → zoom 0.9/0.95/0.85, 100'e dönüş 1.
- l10n: "Reset all settings", "Preferences saved", "Preferences could not
  be saved", "Your preferences were restored from the saved file." (tr +
  EN fallback; build-locales 10 dil · 11963 anahtar).

### Adaylar 6-9 (aynı gün, önceki tur): zoom odağı, metin varsayılanları, ortam efektleri, ızgara/snap — kanıtlandı
- Tekerlek invert (tekerlek yönü) KULLANICIDA ÇALIŞIYOR: canlı kanıt
  (kapalı 1→0.64 uzaklaştı / açık 1→1.57 yaklaştı). Metin varsayılanları
  kaynakta sağlıklı (19px Georgia canlı SS'le kanıtlı). Kullanıcının
  gördüğü eski davranış büyük olasılıkla eski portable exe'den geliyordu;
  masaüstüne taze portable (SHA256 eşleşmeli kopya) bırakıldı.

### Added (adaylar 6-9 — zoom odağı, metin varsayılanları, ortam efektleri, ızgara/snap, 15 Kasım 2026)

Dört küçük ayar tek turda (hepsi parite: anahtar yoksa/bozuksa mevcut
davranış bit bit korunur):

- **Aday 6 — "Cursor-anchored zoom"** (Ayarlar → Çizim; localStorage
  `tailref-zoom-cursor`): görüntü editöründe Ctrl+tekerlek '1' → imlecin
  altındaki nokta yerinde kalır; varsayılan mevcut merkez-sabit zoom.
  `src/canvas-editor/editor.ts` `onWheel` (gerçek kaynak; üretilen
  `canvas-editor.js` build-canvas-editor ile yenilendi).
- **Aday 7 — "New text defaults"** (Ayarlar → General; anahtarlar
  `tailref-text-default-size` / `tailref-text-default-family`): tahtaya
  yeni eklenen yazı öğesinin punto (8-400) ve ailesi. `01-bootstrap.js`
  `tailrefTextDefaults()` + aile whitelist'i; `10-items.js addText`
  okur; `06-render.js` stil + textSig'e aile eklendi; `15-menu-export.js`
  `drawTextItem` dışa aktarım fontu aileyi kullanır. Boş = uygulama
  varsayılanı (34 px + Inter yığını).
- **Aday 8 — "Ambient effects"** (Ayarlar → Görünüm; localStorage
  `tailref-ambient-effects`): yağmur/karı tema animasyonları "Hareketi
  azalt"tan bağımsız aç/kapa. `19-themes-effects.js` `ambientEffectsOn/
  Stop` + `window.tailrefAmbientEffectsSet` — '0' iken tema yeniden
  uygulansa bile koşmaz; tekrar açınca canlı devam eder. Varsayılan On.
- **Aday 9 — "Editor grid step" + "Snap on board"**: görüntü editörü
  ızgara aralığı 32/64/128/256 px (anahtar `tailref-ce-grid-step`,
  varsayılan 64, büyük ızgara 8 katı; `editor.ts drawGrid`) ve tahtada
  sürükleme yapışması (anahtar `tailref-board-snap`; `03-geometry-snap.js
  boardSnapOn()` + `14-interaction.js` — Alt geçici kapatma davranışı
  korunur). İlkisi Ayarlar → Çizim, snap Ayarlar → General.
- `index.html`: 4 sayfada 6 yeni ayar satırı; `60-settings-hub.js`: sync
  + bind'ler. l10n: 14 yeni anahtar × 9 dil = 126 girdi (build-locales
  11959).

**Kanıt:** canlı kanıt testi `tests/tmp-ade6-9-live.js` **18/18 yeşil**
(aday 7 parite/gerçek yazım/DOM/bozuk-fallback; aday 8 yağmur tuvali
piksel kanıtı — kapalıyken tema yeniden uygulansa bile koşmaz; aday 9
snap gap=0 yapışma / kapalıyken gap=8 serbest + ızgara kolon taraması
base 9 / 256px 3 / 32px 17; aday 6 merkez-sabit vs imleç-sabit
`screenToDoc` kanıtı); settings-hub-test +4 kalıcı check → **63/63**;
`run-gates --full` → **59/59 kapı yeşil**.

### Added (ayar adayı 5 — tablet basınç profili, 15 Kasım 2026)

Ayarlar → Giriş & Tablet → **"Pressure curve"** seçicisi eklendi
(localStorage `tailref-pressure-profile`; Soft / Linear / Hard).

- **Anahtar yoksa veya bozuksa:** mevcut davranış — doğrusal eşleme
  bit bit korunur (parite; `inkPressureProfileExp = 1`).
- **Değer gerçek davranış:** `28-ink-brush.js` `inkCurvePressure`
  profili eğriyle ÇARPAN olarak uygular: soft → exponent 0.55
  (hafif vuruşlar daha dolgun), hard → 1.8 (daha ince). Options
  bar'daki fırça eğrisi ayrı kalır; ikisi birlikte etkiler.
- **Anında etki:** `window.tailrefPressureProfileSet` köprüsü —
  seçici değişince restart yok; sonraki vuruş yeni profille çizilir.
- `60-settings-hub.js`: sync kayıt yokken 'linear'; onchange gerçek
  yazım + setter.
- l10n: "Pressure curve / Soft / Linear / Hard" 9 dilde mevcut
  (build-locales 11833; yeni girdi gerekmedi).

**Kanıt:** canlı kanıt testi `tests/tmp-ade5-live.js` **7/7 yeşil**
(linear bit bit kimlik; soft 0.4 → 0.6041, hard 0.4 → 0.1922; seçici
kalıcılığı + anında etki; GERÇEK vuruş: hard'da 0.25 → ilk nokta
p=0.0825 ≈ 0.25^1.8; sync kayıt yokken 'linear'); settings-hub-test
yeni "Tablet basınç profili" check'i → **59/59**.

### Added (ayar adayı 4 — yedek saklama politikası, 15 Kasım 2026)

Ayarlar → Kayıt & Yedek → Backup grubuna **"Keep automatic
backups"** seçicisi eklendi (localStorage `tailref-backup-limit`;
5 / 10 / 20 / 50).

- **Anahtar yoksa veya bozuksa:** mevcut davranış — otomatik yedek
  klasöründe son **20** yedek tutulur (parite; fallback 20).
- **Değer gerçek davranış:** main tarafında `autoBackupKeepCount(limit)`
  1–200 aralığına sıkıştırır; silme `files.slice(keep)` ile en yenileri
  saklar. `good\` klasörü (GOOD_BACKUPS_KEPT=3) ve `emergency-*.json`
  rotasyonu sınırdan bağımsızdır — bunlara hiç dokunulmaz.
- Renderer `tailref-backup-limit` değerini `window.tailref.autoBackup(
  payload, limit)` 2. argümanıyla gönderir; anahtar yoksa/bozuksa
  gönderilmez → main fallback 20. (IPC gerçek: contextBridge stub
  yazılamaz, canlı kanıt gidiş-dönüşüyle doğrulandı.)
- Manuel kayıt modunda backupInterval ile birlikte seçici
  soluklaşır/devre dışı kalır; otomatik modda tekrar açılır.
  Ayarlar merkezindeki özet senkronu da değeri okur (kayıt yoksa 20).
- l10n: 2 yeni anahtar × 9 dil = 18 girdi.

**Kanıt:** canlı kanıt testi `tests/tmp-ade4-live.js` **8/8 yeşil**
(limit yok → 22 yedekten 20 kalır + healthy=true; limit=5 → 5 kalır;
'abc' → fallback 20; limit=3 → kökte 3; `good\` sabit 3;
`#backupLimit` kalıcılığı 10→20; `settingsHubSync()` kayıt yokken 20);
settings-hub-test yeni "Yedek saklama sınırı" check'i → **58/58**.

### Fixed (derin dil denetimi — dinamik UI çevirileri, 15 Kasım 2026)

Kullanıcı şüphesi üzerine her dil tek tek tarandı (sözlük çapraz
kontrol + tam DOM sweep). Sözlük ve `__t()` kusursuzdu; sorun
**dinamik yazarlardaydı**: dil değişince yeniden çevrilmeyen sert
string'ler + eksik sözlük anahtarları. Düzeltmeler:

- `01b-l10n.js` `applyElement`: `data-l10n-title` artık `data-tooltip`
  kanalını da günceller (16-toolbar init'inde title→data-tooltip
  taşındığı için tooltip'ler eski dilde kalıyordu).
- Dil değişiminde yeniden koşma kayıtları (`L10N.onChange`) eklendi:
  durum çubuğu (`48-shell.js`: Infinite board/Canvas/Active color/
  Reset zoom/Drawing/Reference/Hide-Show panels), sayaç etiketi
  (`04-persistence-view.js`: 0 items/N image/N text), yoğunluk notu
  (`42/43-ink-workspace*`), mod çubuğu (`39-mode.js`), yeni pano
  düğmesi + limit bildirimi (`26-projects.js`), çöp rozetleri
  (`12-trash-images.js`), katman paneli (`31-ink-ui.js`), bağla
  düğmesi (`05-links-zoom.js`), seçim çubuğu tooltip'leri
  (`06-render.js`), tam ekran düğmesi (`22-init.js`).
- Sert İngilizce/Türkçe yazan yerler `__t()`'ye sarıldı: bağlam
  menüsü 7 etiket (`15-menu-export.js`), katman özellikleri
  (`50-layer-stack.js`: 'Select a drawing layer',
  'Layer Properties — {name}'), çizim meta sayacı
  (`49-draw-proto.js`), ayarlar özeti (`60-settings-hub.js`:
  'Auto → '/'Currently: Tile {tile} · 3D {q3}' parametreli anahtar).
- **32 yeni anahtar × 9 dil** ekildi → her dil **1310 anahtar**
  (toplam 11824; en.json identity dokunulmadı).

**Kanıt:** `tests/tmp-dil-canli.js` **31/31 yeşil** — her dil için
(tr, de, fr, es, ja, ko, zh-CN, pt-BR, ru): sözlük 10 blok,
9 dil ≥1000 anahtar, seçicide 10 seçenek, 15 örnek anahtar sözlükle
birebir, tam DOM sweep temiz (ham İngilizce kimlik kalmadı),
kalıcılık.

### Fixed (büyüt/geri yükle yarışı, 15 Kasım 2026)

`canvas-editor:maximize` ve `window-toggle-max` IPC'leri
`maximize()` sonrası hemen `isMaximized()` okuyordu; OS asenkron
yanıt verdiğinde eski değer dönüyordu (kapı testinde yakalandı:
editör büyüt düğmesi ikon/durum senkronu kaybediyordu). Hedef durum
önce hesaplanıp uygulanıyor; gerçek durum maximize/unmaximize
olaylarıyla yine senkronlanıyor. **Kanıt:** canvas-editor-test
**60/60**.

### Added (ayar adayı 2 — webview veri temizleme, 15 Kasım 2026)

Ayarlar → Kayıt & Yedek → **Web panelleri** grubuna
**"Reset Pinterest and ArtStation sessions"** eylem düğmesi eklendi.

- Gerçek davranış: main'deki hazır `pinterest-clear` /
  `artstation-clear` kanalları üzerinden `persist:pinterest` ve
  `persist:artstation` partition'larının çerezleri, depolaması ve
  önbelleği temizlenir; uygulamanın kendi oturumuna dokunulmaz.
  (Sıfır yeni IPC; köprü contextBridge olduğu için renderer stub'ı
  mümkün değil — çağrılar gerçek ana sürece gider.)
- Native confirm (2 parça, `__t()` ile çevrilir); onay verilirse
  açık bağlı panel sayfaları giriş sayfasına yönlendirilir ve
  toast çıkar; onay verilmezse hiçbir şey temizlenmez.
- l10n: 9 yeni anahtar × 9 dil = 81 girdi → her dil **1275 anahtar**.

**Kanıt:** canlı kanıt testi **6/6 yeşil** (confirm false → koşmaz;
confirm true → gerçek kanallar ok döndürür + toast; gerçek
`pinterest-clear` gidiş-dönüş ok=true; tr dilinde etiket + confirm
metni çevrilmiş); settings-hub-test is-danger düğme check'i →
**56/56**.

### Added (ayar adayı 3 — açılış oturumu, 15 Kasım 2026)

Ayarlar → General → **Startup** grubuna **"Restore boards at
startup"** anahtarı eklendi (localStorage `tailref-restore-boards`).

- **Açık / anahtar yoksa-bozuksa:** mevcut davranış — son oturumun
  panoları açılışta geri yüklenir.
- **Kapalı (0):** açılışta temiz başlat — önceki oturumun panoları
  arşive yazılır (`Archive/<damga>/workspace.json`, kurtarma
  akışının `archiveAndWipeBoards` emniyet ilkesiyle aynı; veri
  sessizce kaybolmaz), IndexedDB boşaltılır, tek boş pano açılır ve
  arşiv yolu bildirimde gösterilir.
- **Kurtarma yedeğiyle uyum:** açılışta kurtarma yedeği uygulandıysa
  ("son kayda dön") temiz başlatma yapılmaz — kullanıcının açıkça
  geri dönüşü korunur (22-init.js `_recoveryRestoredThisBoot`).
- l10n: 3 yeni anahtar × 9 dil = 27 girdi → her dil **1278 anahtar**.

**Kanıt:** canlı kanıt testi **5/5 yeşil** (anahtar yok → 2 pano
geri gelir; `0` → tek boş pano + eski kayıtlar silindi + arşiv iki
panoyu içeriyor + bildirim; anahtar geri açılınca boş başlangıç;
`0` + kurtarma yedeği → yedek kazanır); settings-hub-test toggle
check'i → **57/57**.

### Added (ayar adayı 1 — pano kapatma onayı, 15 Kasım 2026)

Ayarlar → Kayıt & Yedek'e **"Ask before closing boards"** anahtarı
eklendi (localStorage `tailref-close-confirm`).

- **Kapalı (0):** dolu panolar da onaysız hemen kapanır; silme yine
  kalıcıdır, kullanıcı bunu bilinçli seçer.
- **Açık / anahtar yoksa-bozuksa:** mevcut davranış — dolu panolar
  (öğe sayısı > 0) kapanırken native onay sorar; boş panolar her
  koşulda onaysız kapanır (parite).
- Onay metni ve sekme düğmesi başlıkları (`"… " — close board`,
  `Close board`, `Double-click to rename`) ilk kez `__t()`'e bağlandı:
  6 yeni anahtar × 9 dil = 54 girdi; her dil **1266 anahtar**.
- Ayar satırı Ayarlar hub senkronuna (settingsHubSync + bindToggle)
  ve tercih yedeği whitelist'ine (`tailref-*` otomatik) dahil.

**Kanıt:** canlı kanıt testi **7/7 yeşil** (dolu pano + anahtar yok →
onay çıkar; `0` → onay yok + pano diskten silinir; boş pano → onay
yok; tr dilinde onay metni çevrilmiş); settings-hub-test kalıcı kapıya
yeni check eklendi → **55/55**; zincir **59/59 kapı yeşil**;
build-locales **11428 anahtar**; build-app 61 kaynak · 60390 satır.

**Ortak paket (aday 1 + 2 + 3 tek tur):** masaüstü kopya SHA
`71112EE255E69EB7BB590E085225854C55FFEA270A4BE9D19A3663B8280FEE04`
(115.074.181 bayt; dist ile birebir aynı) — zincir **59/59 kapı
yeşil**, build-locales **11536 anahtar**, build-app 61 kaynak ·
60583 satır.

### Fixed + Localization (dil denetimi turu, 15 Kasım 2026)

9 dilde (tr, de, es, fr, ja, ko, pt-BR, ru, zh-CN) eksiksiz çeviri
denetimi; l10n kuralı: anahtar = İngilizce metin (EN identity).

- **Ölü anahtar temizliği:** 14 anahtar 9 dilde silindi (tr'den 14, 8
  dilde 4'er, en'den 2) + en.json'dan "close" (ikon adı, l10n değil).
- **52 yeni anahtar × 9 dil eklendi** (51 planlı + "Bring this item
  back to the board"); mevcut çeviriler asla ezilmedi.
- **866 anahtar × 8 dil çevrildi** (de, es, fr, ja, ko, pt-BR, ru,
  zh-CN); her dil 1260 anahtar, tr 1256→1260 (4 geride kalan:
  Gradient tool, Move or transform, Smudge tool, History States
  açıklaması). Pas listesi (çevrilmez): `' + def.title + '`,
  `Canvas Editor`, `Layer `, `Layer 1`, `Redo (`, `Undo (`, `100%`,
  `110%`, `125%` — varsayılan katman adları, pencere başlığı ve
  sayısal değerler bilinçli olarak İngilizce kalır.
- **10 ham EN dize kodda `__t()`'e bağlandı** (5 planlı + 5 ek, aynı
  sınıf): 31-ink-ui.js Hide/Show + Hide/Show layer + Alpha lock
  on/off başlıkları; 39-mode.js "Double-click to rename" (3 kopya);
  12-trash-images.js Restore + "Bring this item back to the board";
  draw-v5.js "Other tool options" + item.state; 60-settings-hub.js ve
  62-settings-extended.js On/Off.
- **Terim tutarlılığı:** dil başına mevcut sözlükten (de=Tafel,
  es=tablero, fr=tableau, ja=ボード, ko=보드, pt-BR=quadro, ru=доска,
  zh-CN=画板).

**Kanıt:** denetim taraması canlı=1259/evren=1260, 9 dil eksik=0;
build-locales 4028 → **11374 anahtar**; zincir **59/59 kapı yeşil**
(keymap-test 20/20 dahil).

### Added (Keymap faz 3a — kombinasyon özelleştirme, 15 Kasım 2026)

Kısayol özelleştirme motorunun sınırı içinde (tek karakter / Ctrl+X)
kalan 14 kombinasyon artık Ayarlar → Kısayollar'da kişiselleştirilebilir;
keymap tablosu 41 → **55 eylem**. Yeni gruplar ve varsayılanlar:

- **Workspace mode shortcuts** (3): Ctrl+1 çizim modu, Ctrl+2 referans
  modu, Ctrl+3 3D poz paneli (48-shell.js bağlaması).
- **Tahta kombinasyonları** (7): Ctrl+Z undo, Ctrl+Y redo, Ctrl+A tümünü
  seç, Ctrl+D seçimi çoğalt, Ctrl+S kaydet, Ctrl+E dışa aktar, Ctrl+O
  aç (15-menu-export.js bağlaması).
- **Layer shortcuts** (3): Ctrl+J katman çoğalt, Ctrl+] yukarı taşı,
  Ctrl+[ aşağı taşı (50-layer-stack.js bağlaması).
- **Image editor**: Ctrl+T serbest dönüştürme (36-ink-editor.js).

**Bilinçli sabitler:** Shift'li kombinasyonlar (Ctrl+Shift+N/S/H/Z
hizmetleri) imza motorunun shift'i yutma kuralı gereği sabittir;
Ctrl+Shift+Z paritesi bağlama noktasında özel işlenir (shift'li
basış redo yapar). Ctrl+0 zoom sıfırlama ve Tab dock sabit.

**Parite sözleşmesi:** keymap anahtarı yoksa/bozuksa eski hardcoded
davranış geçerli (her bağlama noktasında legacy fallback korundu);
sahte/dekoratif kontrol yok.

**Kanıt:** kalıcı kapı keymap-test.js **20/20** (55 eylem tablosu +
grup sayımları + shell/layers/editor rebind + çapraz grup çakışma
bloğu/force + shift imzası 'ctrl+n' davranışı); canlı kanal
tmp-faz3a-live.js **20/20** — dört bağlama noktasının gerçek keydown
kanıtı: Delete→Ctrl+Z→Ctrl+Y→Ctrl+Shift+Z undo/redo zinciri (casus
kanıtlı), shell.poseMode ctrl+9 rebind (eski ctrl+3 ölü), katman
çoğaltma ctrl+9 rebind canlı, editor.freeTransform ctrl+7 rebind
(CDP girdiyle çizilen vuruşta araç değişimi), board.export ctrl+6
rebind (pencere aç/kapa). Zincir: **59/59 kapı yeşil** (pose3d-smoke
dahil). **l10n:** 13 yeni anahtar × 9 dil (+117; Undo/Redo/Select
all/Duplicate layer mevcut çevirilerle yeniden kullanıldı);
build-locales: 3911 → **4028**. Ayarlar sayfası 5 grup kutusu +
Tümünü sıfırla kapsamı genişletildi.

### Added (Keymap faz 2 — 3D pose kısayolları özelleştirme, 15 Kasım 2026)

3D pose panelinin tek tuşları keymap tablosuna bağlandı: Ayarlar →
Kısayollar'da yeni "3D pose shortcuts" grubu (13 eylem; tahta 11 +
editör 1'in yanında). Varsayılanlar mevcut tuşlar (parite): Q gizmo
bırak, W/E taşı/döndür, R kontrolcü büyüt, X/Y/Z eksen kilidi, A tüm
eksenler, F odak, 5 kamera modu, 0 tüm pozları sığdır, Ctrl+Z/Y
geri al/yinele.

**Bilinçli sabitler:** Numpad görünüm presetleri (1/3/7/5/0/×) keymap
imza motorunun (tek karakter/ctrl+X) temsil sınırı dışında motor tuşu
olarak kalır; Esc ve Shift+F (tam ekran) da sabit. Ctrl+Shift+Z
paritesi: imza motoru shift'i ctrl+X imzasında yuttuğundan panelde
özel ele alınır — ctrl+z'e bağlı undo Shift'li basışta redo yapar
(eski davranış).

**Kanıt:** kalıcı kapı keymap-test.js 19/19 (tablo 41 eylem,
pose3d yakalama + actionFor, ayarlar sayfasında 13 satır render);
canlı kanal pose3d-smoke.js 108/108 — pose3d.cameraMode 'k'ye
taşınıyor (gerçek keydown 'k' modu değiştirir, '5' sönüyor) ve
Ctrl+Z undo / Ctrl+Shift+Z redo paritesi ölçek aksiyonuyla kanıtlı.
Kanal run-gates --full zincirine eklendi (58 → 59 kapı; ilk zincir
koşumu 59/59 yeşil; panel görünürlüğü tuş testlerinden önce
garantili açılarak numpad gözlemi deterministik hale getirildi).
**l10n:** 13 yeni anahtar × 9 dil (+117; "Move gizmo" 9 dilde zaten
vardı); "Rotate gizmo" mevcut çeviriyle yeniden kullanıldı.
build-locales: 3794 → 3911.

### Added (Sektör standardı ayarlar — 15 Kasım 2026)

Üç gerçek ayar; hiçbiri dekoratif değil, her biri mevcut davranışı
korumak üzere varsayılanlı (parite: anahtar yoksa/bozuksa eski
davranış geçerli):

1. **Tekerlek davranışı** (Ayarlar → General · "Mouse wheel"):
   - "Zoom with scroll wheel" — varsayılan açık (mevcut davranış);
     kapalıyken tekerlek tahta görünümünü kaydırır (Krita/CSP pan),
     Ctrl+tekerlek her durumda zoom.
   - "Natural scroll direction" — tekerlek yönünü tersine çevirir;
     ana tahta + çizim modundaki minitahta uygular. Editörde zaten
     Ctrl=zoom / düz=kaydır olduğundan dokunulmadı.
2. **Geri alma adım sınırı** (Ayarlar → Performans · "Undo step
   limit", 5–200): Photoshop "History States" karşılığı. Boş →
   her yığın kendi mevcut sınırını korur (editör 30, tahta 60);
   değer girilirse dört yığına birden uygulanır (editör History,
   tahta öğe undo'su, çizim vuruş undo'su, mürekkep editörü).
   Bellek bütçeleri (editör 192 MB History budget + tahta
   raster-drop) adım sınırından bağımsız her zaman devrede —
   büyük tuvallerde bellek şişmez. Undo düğmesi başlığı gerçek
   sınırı gösterir (eskisi "…/30" sabit yazılıydı).
3. **Fırça imleci** (Ayarlar → Çizim · "Brush cursor"): çizim
   editöründe fırça/silgiyle boyarken imleç stili — Fırça boyutu
   halkası (varsayılan, mevcut), Yalnız çarpı (halka çizilmez),
   Gizli (halka yok + tuval üzerinde işaretçi tamamen gizli;
   tuvalden çıkınca ya da araç değişince geri gelir).

**l10n:** 12 yeni anahtar × 9 dil (+108; EN identity); "On"/"Off"
mevcut çeviriler yeniden kullanıldı. build-locales: 3686 → 3794.

**Kanıt:** canlı test tests/tmp-sector-live.js 17/17 — yardımcı
clamp'leri (7/999→200/2→5/abc), GERÇEK CDP tekerleğiyle tahta
zoom→pan→invert (hesaplanan state.view ile), editörde
tailref-undo-steps=5 + 7 vuruş → yığın 5 (gerçek eviction) +
undo başlığı "/5", fırça imleci 4 mod geçişi (halka pikselleri,
cross piksel=0, hidden cursor=none, dönüş). Kalıcı kapı
settings-hub-test.js +5 kontrol (UI etkileşimiyle kalıcılık +
clamp + yeniden açılış senkronu) → 54/54.
Ders yine doğrulandı: kapı diyalogu (persistenceWelcome)
üstteyken gerçek tekerlek girdisi yutuluyor — önce diyalog
kapatılmalı; ilk koşumda 4 tekerlek kontrolü bu yüzden kırmızıydı,
düzeltme sonrası 17/17.

### Fixed (Ayarlar sol nav sayfa geçişi + sessiz bildirimler — 15 Kasım 2026)

Kullanıcı bildirimi: sol nav'da Görünüm/Çizim/Gelişmiş/3D Poz'a
tıklayınca sağdaki sayfa değişmiyordu; seçim vurgusu ve üst açıklama
değişiyor, içerik General'de takılı kalıyordu.

**Kök neden:** `style.css`'te `.settingsPage{display:flex…}` kuralı,
`hidden` özniteliğinin UA kuralını (`[hidden]{display:none}`)
görsel olarak eziyordu — dosyada bilinen tuzak deseni (4614 notu)
aynen burada da vardı. `settingsNavSelect` `page.hidden` yazıyordu
ama görüntü değişmiyordu: 12 sayfa üst üste görünür duruyor, en
üstteki (General) her zaman görünüyordu. Kapı testleri `hidden`
özniteliğini okuduğu için bu körlüğü yakalayamadı.

**Düzeltme:** `.settingsPage[hidden]{display:none}` (tek satır,
style.css).

**Kanıt:** gerçek fare girdisiyle (CDP Input) 12 kategori canlı
testi — her tıklamada yalnız tıklanan sayfa görünür (hesaplanmış
display ile ölçüldü; 25/25). Kalıcı kapı `tests/settings-hub-test.js`
nav/sayfa ölçümleri `hidden` özniteliğinden hesaplanmış `display`'e
geçirildi (aynı körlük tekrarlanamaz) → 49/49.

### Fixed (toast() bildirim kanalı — 15 Kasım 2026)

4b.8 bulgusu: `toast()` hiçbir yerde tanımlı değildi; `typeof
toast === 'function'` guard'ları "Otomatikte geri al", "Yeniden
ölç", 3D sıfırlama vb. Ayarlar bildirimlerini sessizce atlıyordu
(eylemler çalışıyordu, mesajlar yoktu).

**Düzeltme:** `core/26-projects.js` global `window.toast()` tanımı —
var olan `showProjectNotice` kanalını (ekran altı pill, role=status,
aria-live=polite) yeniden kullanır; ileti gösterim anında `__t`
ile geçerli dile çözülür (bilinmeyen/dinamik anahtarlar aynen geçer
— canvas-editor.toast ile aynı kural).

**l10n:** 9 bildirim anahtarı ilk kez sözlüklere girdi — 9 dile
(tr/de/es/fr/ja/ko/pt-BR/ru/zh-CN; EN identity) +81 anahtar;
Türkçe karşılıklar locales/_chunks çalışma notlarından alındı.
build-locales: 3605 → 3686 anahtar.

**Kanıt:** canlı test — window.toast fonksiyon, EN identity metin
görünür, dil tr'ye geçince Türkçe metin, süre dolunca kaybolur
(4/4). Tam zincir run-gates --full yeşil (tek flake
ink-select-check tek koşumda 11/11 doğrulandı).

### Added (Tahta + editör kısayolları özelleştirme — Tur 4b,
###    15 Kasım 2026)

**Merkezi keymap çekirdeği (`src/renderer/core/23-keymap.js`, 4b.1):**
28 eylem tek tabloda (16 ink delege + 11 tahta + 1 editör); imza biçimi
ink-workspace ile aynı (`'b'`, `'ctrl+z'`); API get/set/reset/resetAll/
conflicts/all/actionFor/registerDelegate/signatureFromEvent/isTyping/
isFixedKey. Kalıcılık `tailref-keymap` (`{version:1, actions:{}}`); hot
path önbellekli (keydown başına JSON.parse yok). Sabit tuş kümesi
(Escape/Space/Delete/oklar…) bağlanamaz; çakışmada BLOK (yer değiştirme
sonraki tura).

**Bağlama (4b.2):** çizim grubu tek kaynak olarak ink-workspace'te
kalır (`registerDelegate('inkws', …)`; keymap ikinci kopya tutmaz);
`15-menu-export.js` tahta switch'i eylem id'lerine çevrildi (Ctrl+G gibi
çok tuşlu akışlar parite korundu); `36-ink-editor.js` geçici döndürme
(`R`) keymap'ten.

**Kurallar (4b.3):** odak metin girişindeyken yeniden atanmış tuş
ateşlemez (isTyping koruması; test kanıtı: odakta 0→0 blok, blur'da
+1).

**Ayarlar UI (4b.4):** Shortcuts sayfasına "Tahta kısayolları" +
"Görüntü editörü kısayolları" grupları (`#settingsKeymapBoard` /
`#settingsKeymapEditor`), toplu "Restore all defaults" ve çakışma notu
("J zaten Seçimi grupla tarafından kullanılıyor"); tuş yakalama
window-capture'da yutar, Escape iptal, tekil ↺ yalnız özelleştirilmiş
satırda. l10n: 23 yeni anahtar × 10 dil (3605 anahtar).

**Tuş rehberi (4b.5):** "Which key does what?" kartındaki kbd harfleri
`data-km-help` ile keymap'ten üretilir; yeniden atamada açık kart da
canlı tazelenir (B→Z→B kanıtı).

**Tercih yedeği entegrasyonu (4b.6):** export payload'ına okunabilir
`keymap` bölümü; import'ta `tailref-keymap` özel doğrulama —
bilinmeyen eylem, bozuk imza (tek karakter veya ctrl+x dışı) ve sabit
tuş sessizce atılır, geçerliler km.set ile uygulanır (round-trip kanıtı
j→reset→import→j; kötü veri filtresi kanıtı).

**Kalıcı kapı (4b.7):** `tests/keymap-test.js` (18/18) run-gates
--full'a girdi → zincir 58/58 kapı yeşil. Parite kapıları da yeşil:
ink-shortcut 17/17, ink-rotate 35/35, canvas-editor 60/60,
settings-hub 49/49.

Bilinen açık iş (bu tur bağlanmadı): 3D pose tuşları (faz 2) ve
pose3d-smoke "numpad 5 mod değiştiriyor" koşulu; keymap'e bağlanırken
keysActive kuralıyla birleştirilecek.

**Kapanış doğrulaması (4b.8, kullanıcı istemi):** Ayarlar'daki TÜM
kontroller canlı uygulamada tek tek değiştirilip doğrulandı → 40/40
GEÇTİ: 11 kategori, 16 çizim + 12 tahta/editör kısayol satırının
her biri ayrı ayrı yeniden atandı ve geri döndü; dil değişimi, always
on top (IPC), onay diyaloğu, accent, yoğunluk, UI ölçeği, temalar,
fare basıncı, karo/3D kalite/auto-back/remeasure, panel görünürlükleri,
simetri, şekil aracı, çöp saklama, 3D rehber/sıfırlamalar, erişilebilirlik
dataset'leri, kalıcılık segmenti, yedek aralığı, teşhis paneli, arama ve
kapatma kanıtlı. Native dosya/klasör diyalogu açan 6 düğme (Export,
Import, Kayıt yükle, Yedek seç, Geri al, Kurtar, Arşiv) canlı tıklama
yerine bağlama+IPC düzeyinde doğrulandı. İşaretli bulgu: `toast()`
işlevi kodda tanımlı değil — bazı düğmelerin kullanıcı mesajları sessiz
kalıyor; eylemlerin kendisi çalışıyor (sonraki turda bildirim kanalı
bağlanacak).

**Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
3152724C6C5A0E7F4147DBFDEA1EBFE1DE39DEE2FA40C77E0983D80F7F8A6200,
115.006.607 bayt.

### Added (Tercih yedeği: içe/dışa aktarma + güvenli sıfırlama —
###    Faz 6, 14 Kasım 2026)

Ayarlar > Genel'e **Tercih yedeği** grubu: Export file / Choose file /
Reset. Whitelist `tailref-` / `tailref:` önekli localStorage
anahtarlarıdır; tahta verisi (IndexedDB) ile kullanıcı veri anahtarları
(`workspace` proje dizini, `ink:library` fırça kütüphanesi) önek
filtresine düşmediği için **asla** dışa aktarılmaz/silinmez.

- **Export** — versiyonlu payload (`kind: tailref-preferences`,
  `version: 1`, `exportedAt`, anahtar sayısı + değerler). Masaüstünde
  yeni `save-preferences-json` IPC'siyle native kaydet penceresi
  (main.js + preload `savePreferencesJson`); tarayıcı/înce istemcide
  anchor indirmesi yedeği.
- **Import** — gizli file input + JSON doğrulama (kind/version/data);
  bozuk dosyada güvenli hata; onay diyalogu ("n tercih uygulancak;
  panolar etkilenmez") → `settingsPrefsApply` (whitelist savunması:
  dosyadaki yabancı anahtar yazılmaz) → `location.reload()`.
- **Reset** — onaylı ("n tercih varsayılana döner; panoların ve
  kayıtların etkilenmez") → whitelist anahtarları silinir → reload.
- **Kanıt (görsel test 46/46):** whitelist 13 gerçek anahtar saydı,
  `workspace`/`ink:library`/`evil-key` dışladı; round-trip
  build→apply(tema)→doğrulama reddi (kötü kind/version reddedildi,
  evil anahtar yazılmadı)→clear→geri yükleme (13/13) reload'suz.
- l10n: 9 yeni anahtar × 10 dil + main diyalog `Save preferences`
  (9 dil paketi; packsCheck uyumlu). l10n 3377 anahtar.

**Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
03491490B8776FB4C0139A360BB05A1225E7BEF6B4D5449F488F6F3F8C19A87D,
114.960.539 bayt.

### Added (Ayarlar hub kalıcı kapı — Faz 8 / Faz 9, 14 Kasım 2026)

`tests/settings-hub-test.js` zincire girdi (run-gates --full: 57/57):
`tmp-settings-visual.js`'in kalıcılaştırılmış kopyası — kategori
taraması (12/12 açılıyor), kontrol kanalları, kısayol özelleştirme
(Faz 4b.1), ayar araması (Faz 5), tercih yedeği round-trip (Faz 6),
pencere boyutu emülasyonları (1000×700 ve 720×520: panel sığıyor,
yatay taşma 0, nav görünür). Ekran görüntüleri temp klasöre gider;
geliştirme tmp testte sürer, kapıya aynalanır. Son masaüstü kopyası
SHA-256 B356D297A777447B1102A1B635433B99938BC851A56F22B088003EEFA6D193BF,
114.962.008 bayt.

### Added (Ayarlar > Shortcuts gerçek özelleştirme + Ayar arama —
###    Faz 4b.1 / Faz 5, 14 Kasım 2026)

**Faz 4b.1 — çizim kısayolu özelleştirmesi Ayarlar'da:** Kod taramasında
hazır bir kısayol sistemi çıktı (42-44 dosyaları; 16 eylem, yakalama
kanalı, çakışma algısı, `tailref-ink-workspace-v1` kalıcılığı) ama
yalnızca çizim modu menüsündeydi. Tek kaynak köprüsü kuruldu:

- `43-ink-workspace-menu.js`: `inkWorkspaceRenderShortcuts` hem çizim
  menüsüne hem `#settingsInkShortcuts`'a basar; çakışma notu iki
  kapsayıcıya yansır; yakalama tıklaması document düzeyinde delege
  (her iki yerde de çalışır).
- `index.html` Shortcuts sayfası + `style.css`: `--ink-*` değişkenleri
  Ayarlar kapsamında tema değişkenlerinden eşlenir (sabit HEX yok).
- Panel her açılışta listeden tazelenir, yarım yakalama iptal edilir.
- Kanıt (görsel test, gerçek klavye olayı): B düğmesi → `k` →
  state=k, localStorage=k, etiket=K; geri dönüş b=b.

**Faz 5 — Ayar arama:** nav üstünde `#settingsSearch` kutusu + sonuç
açılır listesi. Dizin panel her açılışta kurulur: kategori adları +
tüm satır etiket/açıklama/select seçenekleri (çevrilmiş hâlleriyle;
runtime'da `data-help` çevrildiği için EN ham metin aranmaz). Sonuç
tıklandığında kategoriye gidilir, satır `scrollIntoView` +
`settingsSearchHit` vurgusu. `settingsSearchReset` `settingsHubSync`'e
bağlı; Escape temizler. l10n: `Search settings`, `No matching
settings` (10 dil). Kanıt (görsel test 43/43): sorgu → 2 sonuç
(kategori + satır), tıklamada kategori geçişi + satır vurgusu, boş
sonuç notu, Escape temizliği.

**Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
813410859EC7B1EAEE0B7B18CAE30EA103A6DE91FFB984EBFAD5AE6C986E3080,
114.964.284 bayt (eski masaüstü: BA31F6C1…, 114.801.213 bayt — o
paket Faz 4b.1/5'i içermiyordu).

### Changed (Wordmark bitmap'ine geçiş — marka görseli, 14 Kasım 2026)

Görünür UI'daki "TailRef Studio" metinleri, kullanıcının sağladığı
wordmark PNG'siyle (beyaz, şeffaf zemin) değiştirildi:

- Varlık: `src/renderer/assets/tailref_studio_wordmark_white.png`
  (kaynak 7176×3508 → şeffaf kenar kırpma + HighQualityBicubic →
  686×240, 43 KB). Dört nokta: splash (sincap altı), sol üst `#brand`,
  boş tahta ipucu `#splashLogo` ("buraya görselleri sürükle"),
  kayıt modu karşılama diyaloğu `.pwBrand`.
- Yatay varyant: `tailref_studio_wordmark_white_wide.png` (2193×240).
  Kaynaktan "TailRef" + "STUDIO" satırları ayrı kırıp yan yana
  bileştirildi (STUDIO oranı 0.38 → 0.55, taban hizalı). Sol üst çipte
  stacked PNG'nin STUDIO'su okunmuyordu; çip artık tek satır kilidi
  kullanır (17px). Smoke-test kritik listesine iki varlık da eklendi.
- Sistem metinleri bilinçli olarak metin kaldı: pencere başlığı, hata
  diyalogları, l10n dizeleri, exe adı (`TailRef_Studio.exe`) ve PNG
  tEXt metadata'sı ("TailRef Studio | tarih | boyut").
- Paper (açık) temasında beyaz PNG okunmaz; üç nokta için de
  `filter:invert(1)` kuralı eklendi (mevcut `.brandMark` yaklaşımıyla
  aynı desen). Kısa pencerede (≤420px yükseklik) wordmark gizlenme
  kuralı korunur; ≤420px genişlikte img boyutu 13px'e iner.

### Fixed (Maskeli commit bölgesel kurulumu — Tur 5p-A, 14 Kasım 2026)

Maskeli katmanda vuruş bırakma anındaki bölgesel kurulum, kesişen
vuruşları her seferinde yeniden damgalıyordu; artık vuruş-başı damga
önbelleği var:

- Ölçüm (önce → sonra, AB-probe solo): bölgesel kurulum 27.1 → 16.5
  ms/3 vuruş, tepe 12.4 → 6.1 ms; maskeli commit tamamı 34.7 → 25.3 ms,
  tepe 14.1 → 10.1 ms. Tekrar-bölge kurulumu 19.1 → 6.4 ms ort.
  Undo piramit kazancı (Tur 5p-B) korundu: pyrFull=0, pyrSync 0–0.2 ms.
- Kök: `inkRebuildItemLayerRegion` (29-ink-render.js) bölgeyi temizleyip
  baked dilimi + KESİŞEN TÜM vuruşları sıfırdan damgalıyordu
  (rcStamp ailesi, FAZ 7.U ölçümünde maliyetin %97'si). Maskeli
  commit'te artımlı yama maskeyi iki kez çarptığı için bu kurulum
  atlanamaz — o yüzden kurulumun kendisi hızlandırıldı.
- Düzeltme: vuruş-başı damga önbelleği. K15 dual-buffer her vuruşu
  izole scratch'te üretip tek geçişte `stroke.opacity` ile kompozitler
  → vuruş raster'ı hedef içerikten bağımsız; source-over
  birleşmeliği gereği izole ön-render + tek blit == doğrudan damga.
  Taşınamayanlar önbellek dışı: smudge (hedefi okur), erase
  (destination-out), lockAlpha (source-atop), fill/gradient/liquify.
  Geçersizlik: `inkHashStroke` künyesi + tuval boyutu + sym; LRU +
  alan limiti (emsal `inkStrokeBase`); evicted tuvaller havuzdan
  yeniden kullanılır; editör kapanışında havuz boşalır.
- Kritik yol koruması: commit'in YENİ vuruşu bölge kurulumunda
  doğrudan damgalanır (taze tuval tahsisi saf kayıp) ve girişi
  `requestIdleCallback` ile boşta kurulur (aktif çizim varsa
  ertelenir) — commit anı hiçbir önbellek tahsisini ödemez.
- Kanıt: ink-mask-region-check 11 OK (bölgesel == tam kursetlik,
  0 px; kurulum 11.3 → 6.1 ms), ink-commit-check 7/7 (canlı önizleme
  == bırakılan raster, 0 kanal), undo-region / undo-worker-region /
  ink-undo-frame (13 OK) hepsi 0 px.

### Fixed (Undo/redo piramit tam kursetliği — Tur 5p, 14 Kasım 2026)

Her undo/redo adımında gereksiz TAM piramit kursetliği kalktı:

- Ölçüm (önce): her adımda `pyrFull=1` — pyrSync 17–22 ms (4K), tepe
  145–165 ms; scaledBuild tepesi 160–184 ms. Sonra: `pyrFull=0`,
  pyrSync 0–0.2 ms (yalnız bölge yaması), tepeler yok oldu.
- Kök 1: `inkApplyStrokeEntry` (34-ink-undo.js) erken epoch bump'ını
  rect'siz atıyordu → piramitte "bekleyen full" talebi açılıyordu.
  Raster kaydı yoksa (ağır/geniş vuruş, `maxSnapBytes` 4 MB aşımı)
  hiç bölge yoktu. Düzeltme: erken bump bölgesini raster anlık
  görüntüsünün rect'inden, kayıt yoksa `inkUndoStrokeRegion`'dan
  alır; aynı bölgeyi taşıyan ikinci bump `bolgeliErken` ile atlanır.
- Kök 2: `inkBumpPaintEpoch` (35-ink-worker.js) `baseEpoch`'u
  `next − 1`'e atlıyordu: uygulama-zamanı piramit senkronu rAF
  yarışında koşmazsa, tüketilmemiş ama dizide duran rect'ler
  kurban ediliyor → `inkPaintEpochDirtySince` null döner → güvenli
  tam kursetlik. Düzeltme: baseEpoch = dizideki en eski rect'in
  epoch'su − 1 (Tur 4l birikim sözleşmesiyle tutarlı).
- Kanıt: AB-probe (undo×3 + redo×3 → pyrFull=0, pyrSync 0–0.2 ms,
  adım başına 1–2 yama); iz probe'unda 4 undo adımının tamamı
  `dirty[rects]` ile yama; parite kapıları yeşil: undo-region ✓,
  undo-worker-region ✓ (FAZ 7.U), ink-undo-frame ✓ (13 OK),
  ink-mask-region ✓ (11 OK), ink-commit ✓ (7/7).

### Fixed (YouTube durum mesajı yerelleştirmesi — 14 Kasım 2026)

YouTube/Yükle durum satırı her dilde doğru metni gösterir:

- `loadYoutubeMusic` içindeki üç durum mesajı ("YouTube playing",
  "Playlist playing", "Enter a valid YouTube link") İngilizce sabit
  yazılmıştı; `__t()` ile sarıldı (kod + `app.js` yeniden üretildi).
- `#youtubeStatus`'taki statik `data-l10n` ipucu anahtarı, dinamik
  durum yazıldığında kaldırılır: aksi halde açılışın `load+1500 ms`
  `applyDom` son perdesi (EN dışı dillerde) ve dil değişimi, yazılan
  "YouTube oynatılıyor" durumunu ipucu metnine geri eziyordu.
- `youtube-link-parse-check` artık dil-bağımsız doğrular (durum ==
  çevrilmiş anahtar) ve FAIL'de `exit 1` döndürür — kapı zincirinin
  (`run-gates`) görünmez yeşil tuzağı kapatıldı.
- Üç anahtarın TR çevirisi (`locales/_chunks`) `tr.json`'a birleştirildi;
  `build-locales` + `build-app` yeniden koşuldu.

### Fixed (Marka görünürlüğü · PW karşılama + çizim modu — Tur 4n,
###    14 Kasım 2026)

Marka (`#brand.brandLockup`) artık her durumda sol üstte görünür:
karşılama diyaloğu açıkken, referans/çizim/3D-pose modlarında.

- **Kök neden 1 — karşılama diyaloğu:** açılıştaki kalıcılık karşılama
  diyaloğunun (`#persistenceWelcome`) bulanık tam-ekran zemini
  z-index 3400 > marka 1001 olduğundan markayı örtüyordu
  (canlı probe: `elementFromPoint` = persistenceWelcome).
- **Kök neden 2 — çizim modu kanvası:** v5 çizim kabuğu
  (`body.mode-draw #inkEditor`) tam-ekran opak `--v5-bg` zeminiyle
  z-index 1100'de; marka 1001'de tamamen kanvas altında kalıyordu.
  3D pose modunda zaten `body.mode-3d #brand{z-index:9500}` kuralı
  vardı (9000 tam-ekran 3D paneli nedeniyle); çizim ve PW için aynı
  tavan uygulanmadıydı.
- **Düzeltme:** `style.css` →
  `body:has(#persistenceWelcome:not([hidden])) #brand{z-index:9500}`
  (diyalog kapanınca otomatik 1001'e döner); `draw-v5.css` →
  `body.mode-draw #brand{z-index:9500}` (moddan çıkınca düşer).
- **Kanıt (canlı probe, 5 adım — hepsi elementFromPoint = marka):**
  PW açık (z 9500) → PW kapat → reference (z 1001) → çizim moduna
  gerçek geçiş (ilk geçişteki "yeni kanvas" kurulum modalı
  onaylandı, `mode-draw` kuruldu, z 9500) → 3D pose (z 9500) →
  referansa dönüş (z 1001).
- **Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
  AA8D2EDEFFFE32F1B8AFF8CC160CEC147B534EA46CEC33C582281ED102AD0B16,
  114.799.540 bayt (eski masaüstü: BA31F6C1…, 114.801.213 bayt).

### Added (Çok dilli yerelleştirme · Tur 4l — 14 Kasım 2026)

- **10 dil desteği:** İngilizce (ana), Türkçe, Almanca, Fransızca,
  İspanyolca, Japonca, Korece, Çince (Basitleştirilmiş), Portekizce
  (Brezilya), Rusça. Ayarlar → Genel → Dil'den seçim; seçim
  `localStorage 'tailref-lang'` ile kalıcıdır (eski
  'tailref-language' anahtarından göçürülür) ve yeniden başlatmada
  korunur. Uygulama her zaman İngilizce kaynak metinle yazıldı
  (gettext-tarzı EN-literal anahtarlar, EN = kimlik).
- **Çekirdek:** `01b-l10n.js` — `window.L10N` + `window.__t(key,
  params)` (`{ad}` interpolasyonu, `tPlural` Intl.PluralRules ile
  çoğul), `[data-l10n]` ve `data-l10n-title/-aria/-placeholder/-help`
  DOM kanalları, `applyDom()` üç aşamalı açılış uygulaması (hemen +
  DOMContentLoaded + load + load+1500 ms), `L10N.onChange` anlık
  geçiş; dil seçicide dil adları her zaman ana dilleriyle yazılır.
  Sözlükler `locales/*.json` → `scripts/build-locales.js` →
  `01c-locale-data.js` (10 dil · 1810 anahtar). EN'de olmayan
  anahtarlar otomatik İngilizce'ye düşer; ham anahtar asla görünmez.
- **Kapsam:** tüm app penceresi (statik HTML, araç çubuğu, seçenek
  çubuğu, menüler, ayarlar merkezi, diyagram/performans araçları),
  draw-v5 proto, çizim editörü penceresi
  (`canvas-editor-l10n.js`), tablolar/pano adları ("Layer 1",
  "Board 2" varsayılan adları anlık dile göre üretilir).
  Yerelleştirilmeyenler: dosya uzantıları, kısayollar, marka adları,
  kullanıcı içeriği, teknik tanımlayıcılar.
- **Terminoloji:** Photoshop/Krita standardı (ör. TR Smudge=Parmak,
  DE Eraser=Radiergummi, FR Multiply=Produit, ES Screen=Trama,
  ZH-CN Multiply=正片叠底/Screen=滤色, PT-BR Screen=Divisão,
  RU Smudge=Палец, JA Smudge=指先).
- **Konuk seçim düğmeleri:** Pinterest/ArtStation webview konuklarının
  "＋ Tahtaya ekle" düğmeleri de yerelleştirildi — ana uygulama
  güncel dile göre etiketleri üretip `*-labels` kanalıyla preload'a
  yollar (bağlı webview.send, ayrı pencere panel köprüsü);
  `L10N.onChange` ile dil değişiminde anında yenilenir; 6 yeni
  anahtar 9 dilde sözlüklere eklendi (Add to board, Adding, Added,
  Could not add + Pinterest/ArtStation aria satırları).
- **Test güncellemesi:** dil-ag-nostik beklentiler — layer-canon,
  ink-empty-transform, ink-radial, options-bar, projects, pinterest,
  artstation, canvas-editor, export-dialog testleri TR/EN ikisini de
  kabul eder.
- **Kanıt:** canlı probe 9 adım (EN açılış, anlık TR geçişi, yardım
  niteliği, seçici değeri, reload kalıcılığı, EN dönüşü, v5 çubuk
  title, de/ja/zh-CN/ru çubuk çevirisi) 9/9 OK · glossary kapsamı
  109/109 × 9 dil · syntcheck 63 JS OK · gates --full TAM YEŞİL ·
  verify-package yeşil.
- **Paket:** SHA-256
  A46B68C0C05AA94AB4F34F96755DF3E5F3B383073D6B21785535CBFEBA6CE4EC,
  114.040.167 bayt; masaüstü kopyası aynı karma.

### Added (Yerelleştirme devamı · Tur 4l2 — 14 Kasım 2026)

Gözden kaçan kullanıcı-görünür Türkçe dizelerin EN-base'e dönüşümü.

- **`data-l10n-label` kanalı:** `01b-l10n.js` ATTRS listesine optgroup/
  option grup etiketi kanalı eklendi (`<optgroup label data-l10n-label>`).
- **Katman karışım modu listeleri:** index.html'deki iki blend select'inin
  TR optgroup başlıkları (Karartma/Aydınlatma/Kontrast/Karşılaştırma/Renk
  Bileşenleri) EN-base + `data-l10n-label`'a çevrildi; option'lardaki
  iç içe `<span data-l10n>` codemod artıkları temizlendi (992 bayt).
- **Fırça adları EN-base normalize:** 52-native-brush-library'de 24 ad +
  badge'ler ('Grafit'→Graphite, 'Konsept'→Concept, 'Kaligrafi'→Calligraphy,
  'Duman'→Smoke) + 1 description EN'e çevrildi; ürün-adı politikası
  gereği badge'ler TR modunda da EN kalır. 42-ink-workspace 'Sakin'→'Calm',
  30-ink-tools katman adları 'Notes/Sketch', draw-v5 'Sketch' fallback.
- **pose3d yerelleştirmesi:** PanelController (63 dize), CaptureModal (11),
  CapturePresets (6), bootstrap (3) çalışma-anı metinleri `__t` sarmı;
  Rig etiketleri EN-base (Head/Waist/Knee L/R + parmak adları,
  Girl/Boy), görüntüleme yerinde `__t` ile çözülür. Poz dışa aktarma
  dosya adı 'tailref-pozlar-' → 'tailref-poses-'.
- **canvas-editor penceresi:** canvas-editor.html statik metinleri
  EN-base + `data-l10n`'a dönüştürüldü; editor.ts 'tuval' fallback →
  'canvas', toast ham anahtar.
- **Ascii-Türkçe düzeltmeler:** 'yapistirilan.png'→'pasted.png',
  pinterest/artstation durum `{n} adding…` `__t`, 39-mode tab title
  `__t`, 48-shell 'Sert'→`__t('Hard')`, draw-v5 aynalama/karo ipuçları +
  'Simetri modu' EN, panel-window tam ekran başlığı EN, pose3d rehber
  görsel `alt` metinleri EN, fırça yaratıcı varsayılan 'New Brush'.
- **Sözlük:** 2186 → 3208 anahtar (10 dil); pose3d + blend optgroup +
  editör + ascii-alt anahtarlarının tamamı 9 dile eklendi; eksik
  anahtar taraması (`__t`/`data-l10n` literalleri vs. sözlük) boş.

### Added (Inter Variable yazı tipi · Tur 4l3 — 14 Kasım 2026)

Uygulama yazı tipi şartnamesi: logo/marka = Inter Italic ExtraBold 800 ·
arayüz gövdesi = Regular 400 · panel başlıkları = Semibold 600 · araç
adları = Medium 500. Inter SIL OFL 1.1 lisanslıdır (Nunito Sans gibi
gömülebilir); kaynak rsms/inter v4.1 `web/InterVariable*.woff2`.

- **@font-face:** `font-weight:100 900` değişken aralık +
  `format('woff2-variations')`; normal (352 KB) + italic (388 KB) iki
  dosya, `assets/fonts/` ve `src/renderer/assets/fonts/`'a kopyalı.
  Eski Nunito woff2'ler diskte bırakıldı (revert-dostu), yalnız CSS
  referansları kaldırıldı.
- **@font-face yerleşimi:** style.css, splash.html, canvas-editor.css.
- **Font yığınları Inter-öncelikli:** style.css (~40 satır; gövde,
  L1424 `html,body` ezici kuralı dahil), ui-shell.css, draw-proto.css,
  draw-v5.css, panel.html, canvas-editor.css gövde; preload
  artstation/pinterest konuk stilleri; 22-init.js enjekte stil;
  15-menu-export.js + 48-shell.js ctx.font.
- **Marka italik 800:** .logo (Arial Black/Segoe UI Black yığınından
  çıkarıldı), .startupWordmark, .brandWordmark, splash .brand,
  pwBrand, canvas-editor .ce-brand-name.
- **Panel başlığı w900 düzeltmesi:** modern Chromium UA kuralı
  `b{font-weight:bolder}` ebeveyn 600'den 900 hesaplıyordu;
  `.floatingPanelHead b{font-weight:600}` açık kuralıyla şartnameye
  bağlandı (canlı probe: w900 → w600 doğrulandı).
- **Kanıt:** canlı font probe — gövde Inter w400, markaWordmark italic
  w800, panelBaslik w600, aracAdi w500;
  `document.fonts.check` 400/500/600/800-italic hepsi true. Tests:
  canvas-editor 60/60, pose3d-unit 17/17, gates --full 55/55 yeşil
  (verify-package dahil).
- **Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
  E39BC76D4962925DDF600D9C9EC1EDA9AD8E767D42E2C4266E8836857196E73C,
  114.763.625 bayt.

### Added (Ana-süreç diyalog i18n · Tur 4l4 — 14 Kasım 2026)

Electron ana sürecinin yerel diyaloğu ~50 dizesi kullanıcı dilinde:

- **`src/main/dialog-l10n.js`:** ana-süreç i18n modülü — 50 anahtar ×
  10 dil (EN = kimlik anahtar, 9 dil paketi; renderer terminolojisiyle
  hizalı: de Tafel, fr tableau, es tablero, ja ボード, ko 보드,
  zh 画板, pt-BR quadro, ru доска). `t(key, params)` `{ad}`
  interpolasyonu + EN düşüşü; `localeTag()` tarih/saat biçimi için
  (tr-TR/ja-JP/…). Çoğul ekleme arabirimli dizelerle bilinçli
  kaçınıldı ("Backups tried: {n}" kalıpları).
- **Dil senkronu:** renderer `01b-l10n.js` açılışta + her setLang
  değişiminde `window.tailref.sendAppLanguage(code)` → main
  `'app-language'` kanalı → `dialogL10n.setLanguage`. Renderer
  donduğunda (kurtarma yolu) en son bilinen dil kullanılır.
  Test/otomasyon için `'app-language-get'` okuma kanalı.
- **Kapsam:** kapatma uyarısı (kaydet/vazgeç), kaydet/aç diyalogları
  (görüntü, fotoğraf, .abr fırça, .tail tahta, klasör seçimi),
  filter/buttonLabel adları, fallback dosya adları (photo/brush/
  board/canvas), .tail hata mesajları, kurtarma kutuları (sağlıklı
  yedek yok / yedekli iki yol; tarih `toLocaleString(localeTag)`),
  port-dolu/sunucu hatası kutuları, canvas-editor PNG kaydetme
  diyaloğu. Bilinçli bırakılanlar: marka başlıklar ('TailRef
  Studio'), 'PNG'/'JPEG' format adları, iç güvenlik iletisi
  ('unauthorized request'), console*/yorum satırları.
- **Test:** `tests/dialog-l10n-test.js` (32 kontrol: paket bütünlüğü,
  interpolasyon, EN düşüşü, localeTag) — gates PURE zincirine eklendi
  (gates 55 → 56).
- **Kanıt:** canlı probe 9/9 YEŞİL — boot EN → main 'en', setLang('tr')
  anlık main 'tr', setLang('de') 'de', reload (localStorage 'ja')
  sonrası main 'ja'. canvas-editor 60/60, pose3d-unit 17/17,
  gates --full 56/56 yeşil (verify-package dahil).
- **Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
  9D307B26A7D3A854D041BD27DA4DB01EAC3299565CD5947083EAF2714D8A5AF1,
  114.795.729 bayt.

### Fixed (Kırılma turu · Tur 4m — ekran-taşan çip sıkıştırması,
###    14 Kasım 2026)

- **Kök neden — hedef kırpımı kaynak dilimle eşleşmiyordu:** zoom'lu
  (tam çözünürlüğe yakın) görünümde kanvas kenarına/köşesine doğru
  çizilen vuruşun raster bölgesi (bakeRect/sceneChip) kanvasın
  DIŞINA taşar. `inkEditorFrameChipPaint` (commit karesi) ve karosuz
  `sceneChip` yolu hedef dikdörtgeni ±2 CSS px genişletip kanvas
  sınırlarına KIRPAR, ama kaynak dilimi çip oranından aynen alırdı —
  kırpılan kısım kaynak penceresinden DÜŞMEZDİ. Sonuç: ekran-dışı
  kaynak içerik görünür hedefe SIKIŞTIRILIRDI (vuruş-1 ölçümü: 335
  katman-px kaynak 172 CSS-px hedefe ~2× sıkıştı); vuruş kuyruğu
  ekrana geri katlanıp yerinde hayalet mürekkep bırakıyordu —
  "rastgele yerlerde kırılma/kırık köşe, sanki altında bozuk bir
  kare var". Karo ızgarası canlı mürekkebin değmediği kolonlarda karo
  üretmediğinden hayalet ÇIPLAK görünür ve kalıcıydı; zoom tam
  boyama yaptığından düzeliyor, sonraki kenar vuruşu yeniden
  üretiyordu (kullanıcı belirtisi birebir).
- **Düzeltme:** her iki yolda kaynak penceresi artık hedef
  penceresiyle AYNI doğrusal haritadan türetiliyor —
  `sx = chip.x·rw + (cw0 − (fit.x + chip.x·scale))·(rw/scale)` (y
  ekseninde simetrik). ±2 pad + kanvas kırpımı tek haritada
  çözülür; çip kenarlarında eski 1-2 px kayma/gerilme de aynı
  hatadan doğuyordu, o da gitti. Undo/kare-çip birleşik çipler aynı
  fonksiyondan geçtiği için onlar da kapsanır.
- **Kanıt (tmp-serial-parity zoomin, seri 12 vuruş + 120 ms nefes):**
  düzeltme öncesi vuruş 1'de doğan `[1280,864,160,48]` kutusunda
  kalıcı hayalet (1219 fark-px, karoKapsa=%0, 3 vuruş boyunca
  değişmeden sürdü; analitik hesap hayalet mürekkep y 862..910 —
  ölçümle birebir) → düzeltme sonrası zoomin × tiles ON/OFF × dpr
  1/1.25/1.5'te 0 kirli kayıt, 0 kalıcı fark. Karosuz çip kayma
  şeritleri (`[384,400]` kayma ort 13.2) de yok oldu.
- **Karo-kalıcı görsel testler yeşil:** tiles ON × dpr 1/1.25/1.5
  mini-fit seri çizim 0 fark; undo/oturtma (Tur 4k) senaryoları
  0 fark; referans panosu minyatüründeki kesik çizgiler (öğe kartı
  CSS downscale aliasing) ayrı, ikincil konu olarak belgelendi.
- **QC:** gates 55/55 kapı yeşil (tam zincir, desktop-smoke dahil);
  ink-smoke 233/233; tile-stale-check dpr 1/1.25/1.5 koştu (debug
  portu 9347 Electron bind erişim engeli yediği için kanal portu
  9371'e taşındı — Hyper-V dinamik rezervi).
- **Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
  BA636EFD884EBEC45164868CA4002C9A5B2980EB0695224644F91C1182BA34D6,
  113.982.960 bayt.

### Added (Şekil oturtma)

- **Kalemi bekletince şekle oturtma:** serbest elle şekil çizerken kalemi
  basılı tutup ~2 sn hareketsiz beklenirse vuruş kusursuz geometriye
  dönüşür (`30b-ink-shape-snap.js` — resample 64 + RDP + Kasa daire
  uydurması; vuruş commit'inde tek geçiş, pointermove hattında yalnızca
  çapa/ekran-px karşılaştırması → FPS etkisi yok). Tanınanlar: çizgi,
  yay, daire, üçgen, kare, dikdörtgen, çokgen; köşeli açık vuruşlar
  (L/V/S) yay uydurma kalıntısı ayırt edicisiyle ASLA yaya dönmez —
  dokunulmaz. Kalem kaldırılırsa ya da çizim sürüyorsa (çapa > 3 px)
  dönüştürme tetiklenmez. Oturtma sonrası çizim devam ederse noktalar
  şekil poliline'ına eklenir (canlı == commit birebir). Ayar: Çizim
  Ayarları ▸ Gelişmiş ▸ "Kalemi bekletince şekle oturt" (varsayılan
  açık, `ink.shapeSnap` kalıcı). Kapılar: `tests/shape-snap-check.js`
  (33 iddia) + paketli QC (kare döner, L dokunulmaz, normalize beyaz
  liste). Yeni shape türleri renderer'da: `line`, `arc`, `circle`,
  `poly` (köşeli çokgenler; şekil aracı menüsünde görünmez).
  **Canvas Editor penceresi de kapsandı** (`src/canvas-editor/`):
  raster fırça motorunda oturtma = vuruş tamponu temizlenip kusursuz
  şekil aynı fırça dokusuyla yeniden damgalanır (`shape-snap.ts` TS
  portu; doc-px uzayında, ölçek normalizasyonu gerekmez). Undo tek
  adım kalır; dirty-rect ham iz + şekil birleşimidir (silinen eski iz
  geri alımın dışında kalmaz). Ayar: fırça panelinde "Şekle Oturt"
  düğmesi (varsayılan açık, `canvasEditor.shapeSnap` kalıcı). Kapı:
  `tests/canvas-shape-snap-check.js` (28 iddia, gates PURE listesinde).

### Added (Şekil oturtma · halka mimarisi + canlı gösterim)

- **Halka tanıma "toplam işaretli dönüş" sinyali:** yarıçap düzgünlüğü
  (CV) yalnız söyleyici oldu; asıl karar TOPLAM DÖNÜŞ üzerinden. Yeni
  eşik `TURN_CIRCLE = 5.5` rad (~315°): toplam dönüş bu kadarsa vuruş
  halkadır. Böylece NASIL çizildiğinin önemi kalmadı: geçmeli tur
  (~1,15×), boşluklu kapanış (325°/340°), kanca girişli başlangıç,
  çift tur (~1,75×), basık oval, kuyruklu "6", içe spiral (2,5 tur) —
  hepsi daireye döner (her iki portta 10 yeni iddia ile test edildi:
  30b 43/43, canvas 38/38). Köşeli şekiller korunur: üçgen/kare/
  dikdörtgen/çokgen köşelilik kontrolü ÖNCE gelir; sınıflanamayan
  köşeli vuruş (kanca girişi) halka kararıya düşer, L/V/S'nin toplam
  dönüşü ~π olduğundan eşeği asla aşamaz (dokunulmaz kalır). Açık
  daldaki erken maxTurn reddi kaldırıldı (bileşim bileği tanımayı
  öldürüyordu); yay adayı köşe koruması halka kararından sonra.
- **Canlı gösterim (kalem basılıyken şekil görünür):** ink editöründe
  oturtma vuruşu `kind:'shape'` olunca tam-raster yoluna geçiyordu ama
  oturtma öncesi karelerin dirty-kutu kompoziti (`sceneChip`) bayat
  halde kalıyor, sahne yalnız eski kutuyu yeniden birleştiriyordu —
  şekil kalem bırakılınca commit tam kare çizince görünüyordu. Fix:
  non-dual rebuild yolu + `inkEditorSnapFire` bayat çipi düşürür
  (`sceneChip = null`), sahne tam yolu kullanır. Canvas editor'da
  `snapFire`'daki fazladan `brush.end()` kaldırıldı (ctx boşaltıp
  oturtma sonrası devam eden çizimi kesiyordu; kuyruk damgası
  `finishStroke`'dan gelir).

### Changed (Şekil oturtma · etkileşim turu 3)

- **Basılı tutarken CANLI dönüşüm (karo bayatlığı kök nedeni):** kalem
  profilli yeni QC (`tests/ink-quickshape-pen-qc.js`, pointerType 'pen' +
  basınç/tilt/coalesced örnekler + 60 Hz kare) hatayı yakaladı: oturtma
  anında vuruş state'te `shape/circle` oluyor ama ekranda diff=0 —
  karo (tile) defteri şekil oturtmanın tam-yol karesini "benign"
  sanıp bayat karo bitlerini gösteriyordu; şekil ancak kalemi
  bırakınca commit'te belirmiyordu. `36-ink-editor.js` `benignFull`
  koşuluna `stroke.kind !== 'shape'` eklendi: oturtma karesinde
  defter boşaltılıp karolar yeni (şekilli) içerikten yeniden boyanır.
- **Yarım-oturtma boşluk koruması:** kısmi izde tanıyıcı yanılabiliyor
  (ör. yarım çember → kapanışı uydurulmuş şekil), ham izin kalan
  kısmı commit'te silinip BOŞLUK bırakıyordu. Dönüşüm öncesi kapsama
  denetimi: ham izin her noktası kusursuz poliline'a kapsamıyorsa
  dönüşüm reddedilir, ham iz kalır. Tolerans `max(2, fırça×0.6,
  izUzunluğu×0.15)` — hafif basık/elips halkalar (en/boy oranı
  kaynaklı ~%10 sapma) geçer, gerçek yarım-oturtma (%30+ sapma)
  reddedilir. `30b-ink-shape-snap.js` + `canvas-editor/editor.ts`
  `snapFire` portuna aynı koruma.
- **Kapılar:** `ink-quickshape-pen-qc` 9/9 (P1: basılı tutarken
  shape/circle + diff>0 canlı; P2: yarım-oturtma reddi), `ink-quickshape-qc`
  17/17, `shape-snap-check` 50/50, `canvas-shape-snap-check` 38/38,
  `ink-commit-check` 7/7, `canvas-editor-test` 60/60, gates:full yeşil,
  paket doğrulandı.

### Changed (Şekil oturtma · etkileşim turu 4 · canlı şekil ayarı)

- **Revert kalktı → Procreate tarzı CANLI şekil ayarı:** oturtulan şekil
  kalem basılıyken ≥8 px hareketle ham izine dönmek yerine canlı
  ayarlanır: daire → en yakın kenar tutamağı (üst/alt dikey eksen,
  sol/sağ yatay eksen; karşı kenar sabit), çizgi → baş sabit, uç
  kalemi izler, kare/çokgen/yay → merkezden tek-çapraz orantılı
  ölçek. Parametreler her karede oturtma anındaki orijinalden
  türetilir (birikimsiz kayma yok). Ayar durumu kurulamazsa savunmacı
  çıkış olarak eski revert yolu korunur. İki port da kapsandı
  (`36-ink-editor.js` + `canvas-editor/editor.ts`).
- **Shift çizgi kilidi oturtmayla yarışmaz:** Shift basılıyken bekleme
  zamanlayıcısı tamamen kapalı (`snapTrack`/`snapFire`/pointermove
  kapısı, her iki port). Duraksayan Shift çizgisinde oturt→revert
  ping-pongu ("sapıtma") bitti.
- **Kapanış noktası:** serbest-el damga yolu AÇIK poliline çizdiği
  için daire/çokgen artık son noktayı ilkine eşit yazar — daire
  başındaki segment boşluğu kapandı (`shape-snap-check` iddiaları
  güncellendi: 65 nokta, son == ilk; "örtüşmez" beklentisi kalktı).
- **Commit boş-dokunuş koruması kapalı şekilleri düşürüyordu:**
  commit'teki `hypot(ilk, son) < 1` degenerate kontrolü kapanış
  noktası yüzünden daireyi sessizce DÜŞÜRÜYORDU (commit null);
  snapFree kapalı şekiller istisna yapıldı (`36-ink-editor.js` +
  `30-ink-tools.js`).
- **Kapsamlı QC:** kalem QC'si 33/33'a büyütüldü — P2 canlı ayar +
  parite + boşluk; P3 dikey boylama (en sabit); P4 yatay boyama (boy
  sabit); P5 çizgi uç uzatma (baş sabit); P6 kare orantılı ölçek;
  P7 mikro-hareket (<8 px) kilidi; P9 undo tam geri alır.
  Mouse QC C3/C4 yeni sözleşmeye göre güncellendi. Sonuçlar:
  pen 33/33, mouse 17/17, shape-snap 51/51, canvas-shape-snap 38/38,
  ink-commit 7/7.
- **Ana tahta portu (Tur 4):** `30-ink-tools.js` serbest-el yoluna aynı
  sözleşme taşındı — Shift kilidi, canlı oturtma, canlı şekil ayarı
  (`inkFreehandSnapAdjInit` + `inkFreehandShapeAdjust`), oturtma
  çapası, oturtulmuş vuruşta bırakmada catch-up noktası eklenmez
  (`inkCatchUpFreehand` artık kind 'shape'/'fill' vuruşlara dokunmaz;
  editör `inkEditorCatchUpStroke` ile aynı koruma).
- **Ana tahta QC:** yeni `tests/ink-board-quickshape-qc.js` 24/24 —
  görsele bağlı katmanda (0..1 uzay) B1 daire canlı oturtma+boylama+
  commit+parite+undo, B2 mikro hareket donukluğu, B3 Shift kilidi,
  B4 kare orantılı ölçek; global (dünya-px) katmanda B5 serbest-el
  çökme regresyonu ve B6 daire oturtma+ayar+commit.
- **Tahta not katmanı çökmesi düzeltildi:** global katmanların nokta
  uzayı dünya pikselidir; `inkEmitFreehandPoint` koşulsuz
  `clamp(0,1)` uygulayıp tüm orta noktaları (1,1)'e yuvarlıyordu
  (tahtada not çizimi bozuktu). Kenetleme artık yalnızca 0..1 uzaylı
  bağlı katmanlara uygulanır.
- **Ayar çapası lag düzeltmesi (iki port):** snapFire çapası hold'un
  "son ≥8px-aarm" konumu değildi; son <8px adımlar çapayı geride
  bırakıp kullanıcının mikro titremesini 8px eşiğinin üstüne
  çıkarıyordu. Çapa artık ateş anındaki gerçek kalem konumu
  (`lastClient`); mikro hareket (<8 px) şekli asla oynatmaz
  (`36-ink-editor.js` + `30-ink-tools.js`).
- **Paket:** 1.4.0 portable yeniden inşa edildi, `verify-package`
  PAKET GÜNCEL, Desktop kopyası SHA-256 doğrulandı. Gates 11/11.

### Changed (Şekil oturtma · etkileşim turu 4b/4c)

- **Canlı ayar hayaleti/iz artığı bitti:** oturtulan şekil canlı
  ayarlanırken eski kare önizlemesi ekranda "hayalet iz" olarak
  kalıyordu (`36-ink-editor.js` preview hattı + `30-ink-tools.js`
  tahta portu); ayar karesi artık önce tam temizlenip şekil
  yeniden damgalanıyor — tek iz, çift kontur yok.
- **Kenar takibi eksen bazına döndü:** daire ayarı tek-çapraz
  orantı yerine her eksende ayrı izler: kalemin o anki konumu
  hangi kenara yakınsa o kenar kalemi izler, karşı kenar sabit
  kalır (üst/alt dikey, sol/sağ yatay bağımsız). Eşikler göreli
  (başlangıç boyutu ×r0) — küçük şekillerde mikro titreşim
  yine ayarı tetiklemez.
- **Tanıyıcı "her şey daire oluyor" kök nedeni giderildi (köşe
  koruması):** RDP eps'i el-karesinin yumuşak köşelerini yutup
  vuruşu daire sanıyordu. Dönüş enerjisi kümelemesi (W=3 pencere,
  ≥0.6 rad) köşe bölgelerini yakalar; baskınlık kararı yeni
  "küme-dışı medyan dönüş" metriğiyle verilir: gerçek çokgende
  köşeler ARASINDAKİ kenarlar düzdür (medyan ~0.03–0.05 rad),
  dalgalı/oval halkalarda dönüş tüm çizime dağılır (medyan
  ≥0.2 rad). Eşik 0.12 rad; prob ölçümüyle ayrışma geniş
  marginli (yumuşak kare r40 → square, dalgalı CV~0.15 halka →
  circle; `shape-snap-check` 51/51).
- **Opaklık "şekilde azalıyor" kök nedeni giderildi (çift-tampon
  kapısı):** PS kuralı "opaklık vuruş içinde birikmez" için
  K15/K20 çift-tampon yolu yalnızca kind 'stroke' vuruşları
  açıyordu; oturtulan şekil (kind 'shape' + snapFree) eski
  n-root seyreltmeli yola düşüyor, aynı fırçayla çizilen serbest
  elin ~yarısı saydamda kalıyordu. Kapı `strokeLikeKind`
  ile genişletildi (`28-ink-brush.js` dualDirect + dualCandidate):
  şekil artık kullanıcının gördüğü fırça opaklığında bant
  bırakır (QC: canlı=128, commit=128, serbest-el ref=128).
- **Damga yolu uygunluğu genişletildi:** `33-ink-stamp.js`
  `inkStrokePathEligible` kind kapısı snapFree şekilleri de
  alıyor (sıfır-taper uçlarda tek quadratic yol); taper'lı
  uçlar damla yolunda kalır (bilinçli). Worker paritesi:
  `35-ink-worker.js` pathEligible kapısı aynı genişlikte
  (fiili etki yok — worker yalnız 'stroke'/'smudge' boyar).
- **Araç şekilleri opaklığı:** şekil aracıyla (snapFree'siz)
  basılan daire/çokgen `inkDrawShape` ince kontur yolunda
  vuruş opaklığını uygular — 0.22× kalınlık korunur, opaklık
  fırça ayarından gelir.
- **Kapsamlı QC büyütüldü:** tahta QC (`ink-board-quickshape-qc`)
  24→47: B10 opaklık paritesi simülasyon-commit probe'u ile
  kanıtlandı (ref serbest-el vs oturtulan şekil ±24); kalem QC
  (`ink-quickshape-pen-qc`) 33→57: P11 opaklık (canlı==commit
  byte-parite), P12 yuvarlak-köşeli kare → poly (daire sanılmaz,
  ham izin en/boy oranı korunur), P13 yumuşak pastel fırçada
  oturtma. Sonuçlar: board 47/47, pen 57/57, quickshape 17/17,
  shape-snap 51/51, canvas-shape-snap 38/38, ink-commit 7/7,
  ink-smoke 233/233, gates 11/11.
- **Test portu EACCES:** bu makinede 5197 portu sistemce bağlanamıyor
  (listen EACCES — "uygulama takılı kaldı" görünümünün nedeni; test
  örnekleri diyalogta bloklanıyordu). Smoke ailesi portları 5199'a
  taşındı (`ink-smoke`, `pose3d-smoke`, `projects-test`,
  `save-on-close-test`, `export-dialog-test`); uygulamanın gerçek
  portu 5178 bağlanıyor, etkilenmedi.
- **Paket:** 1.4.0 portable yeniden inşa edildi (inkcore native dahil,
  Electron ABI 45), `verify-package` PAKET GÜNCEL, masaüstü kopyası
  SHA-256 doğrulandı.

### Changed (Şekil oturtma · etkileşim turu 4d/4e/4f/4g)

- **Canlı ayar "takıla takıla" bitti (F2):** eksen devreye girme eşiği
  0.22·r0 → 0.03·r0, bırakma 0.12·r0 → 0.015·r0 — kalem ~2 px yol
  alınca ayar tepki verir; mikro titreşim yine kilitli (8 px giriş
  kapısı ayrı kalır). QC P15: ilk tepki 2. adımda, sonrasında donma 0.
- **Küçültme PİVOT MERKEZ (F3):** daire ayarında kalem merkeze doğru
  çekince iki kenar özgün merkeze simetrik çekilir — şekil YERİNDE
  küçülür, tutulan kenar kalemi birebir izler. Büyüme kenar-takip
  kalır; min yarı-yükseklik r0·0.2 (fırça boyutundan bağımsız).
  QC P16: merkez drift 0.5 px, küçülme monoton, donma 0.
- **Shift kilidi sonrası oturtma (F1):** Shift bırakılınca bekleme
  zamanlayıcı yeniden kurulur; oturtma sonrası hareket ham izine
  DÖNMEZ (Tur 4 canlı ayar sözleşmesi). `inkEditorSnapAdjInit`
  dejenere 'line' bbox kenetlemesi düzeltildi. QC P14: kilitli
  segment x sapması 0, oturtma shape/line, sonraki hareket canlı
  ayar, commit parite 0.
- **Tanınmayan dalga pürüzsüzleşir (Tur 4e F4):** hiçbir şekle
  oturmayan dalga bekleyicide YERİNDE pürüzsüzleştirilir
  (`inkEditorSmoothFreehandStroke`: yeniden örnekleme + k=4 binomial
  iç geçiş, uçlar bit-birebir sabit; previewSkip/dualWts/dualComp
  dokunulmaz — sıfırlamak canlı çizimi bozuyordu). QC P17: kıvrım
  RMS 0.151×, hat sapması 3.2 px, zincir devamı boşluksuz.
- **Çizim-ortası dönüşüm yok (Tur 4f fireCheck v5.1):** yavaş sürünmede
  vuruş rawLen 28 px'i aşınca ÇİZİM ORTASINDA 'line'a dönüşüyordu
  (revert kalktığı için kalıcı zarar). fireCheck v4'ün (prod+net)
  skip'i canlı ölçümde hiç çalışmıyordu (sürünme net(640) 2.8–3.0 px,
  prod 1.1–1.4 — her iki v4 eşiği aşıyordu). v5.1: `skip ⇔
  age < 220ms && (wnet/wpath ≥ 0.3 || wnet ≥ 1.7px)` — yaş (son iz
  girişi) + düznlük oranı + yürüyüş net tabanı; atlanırsa 220 ms
  yeniden kurulur (iz korunur). Canlı kanıt: salınımlı sürünme 12/12
  skip + duruştan ~286 ms'de ateş; düşman yürüyüşü 17/17 skip;
  titreme ve temiz duruş doğru ateşler. QC P18: 25/25 anlık 'stroke',
  duruşta poly n=5.
- **Tanıyıcı çokgen/daire ayrımı (Tur 4g):** kapalı dalda ÇİFT kanıt
  (RDP + dönüş-enerjisi kümelemesi × döndürülmüş/ham kopyalar) → aday
  çokgenler ortalama dik-uzaklık kalıntısıyla yarıştırılır, EN DÜŞÜK
  kazanır; halka dalına köşe-baskınlık kapısı. Kapalı aday yolu "en
  düz" örnekten başlatılır (`rotateFlat`) — başlangıç köşesi artık
  kümeleme penceresine takılmaz. Yuvarlatılmış köşeli kare/üçgen
  artık poly (n=5), el daireleri circle. QC: şamfra varyantlarının
  tamamı poly, hand_circle → circle.
- **Dikiş körlemesi (Tur 4g):** döndürülmüş kopyada yol-sonu→yol-başı
  BOŞLUĞU iç segment gibi diziliyor; son örnek aralığı tam boy
  gelince dikiş ~180° sahte kelepire köşe üretip köşe kapısını
  açıyordu — 70 karelik el-daireleri 'poly n=8/9' oluyordu (56–60
  karelikler örnek-izgara şansıyla sağ çıkıyordu). Dikişin iki
  yanındaki dönüşler tarama dışı; gerçek köşeler (≥3) etkilenmez.
  QC: 7/7 kalem profili circle (maxNarrow 3.12 → 0.19 rad).
- **Kapsamlı QC 57→79:** P14 Shift-line (F1), P15 ölü bölge (F2),
  P16 merkez-pivot (F3), P17 smooth-on-null (Tur 4e), P18 yavaş
  sürünme (Tur 4f). Eski P1/P3/P4/P10 vakalarının glide hedefleri
  eksen-saf yapıldı (F2'nin küçük ölü bölgesi eski hedeflerdeki
  ~22–26 px yanal ofsetleri yakalıyordu — hassasiyet istenen davranış).
  Sonuçlar: pen 79/79, board 47/47, quickshape 17/17, shape-snap
  51/51, canvas-shape-snap 38/38, ink-commit 7/7, ink-smoke 233/233.
- **Paket:** 1.4.0 portable yeniden inşa edildi (inkcore native dahil),
  `verify-package` PAKET GÜNCEL, masaüstü kopyası SHA-256 doğrulandı,
  gates 11/11.

### Added (Şekil oturtma · etkileşim turu 3 — Tur 4h, 13 Kasım 2026)

- **Shift sallantı kilidi v3 (27-ink-core):** Shift ile sağa çizerken
  aşağı-yukarı oynatma çizgiyi kıvrılıyordu; stres sallantısında
  (±35 px) geçici eksen 45°'e erken donup TÜM çizgi diyagonale
  sapıyordu (ölçüm: maxYDev 294 px). Geçici eksen artık ortalı NET
  yönden seçilir ve donma koşulu NET eşik taşır:
  `don ⇔ (yol ≥ 40 px VE kararlı ≥ 5 örnek VE net ≥ 100 px) VEYA
  net ≥ 300 px VEYA yol ≥ 500 px`. Donduktan sonra saf izdüşüm: dik
  bileşen tamamen atılır — sallantı çizgiyi ne bükür ne eksen boyu
  uzatır. QC pen P19a/P19b (eksen 0°, kuyruk sapması ~0).
- **Kalkış oturtması (QuickShape bırakış davranışı):** hızlı çizip
  hemen bırakan kullanıcının üçgeni/dikdörtgeni ham iz olarak
  commit edilip domlu köşe + kapanma kancasıyla "garip blob" görünüyordu
  — bekleyici yalnız hareketsizlikte ateşlediği için hiç denemiyordu.
  Kalem kaldırıldığında tanıma BİR kez daha denenir: çizim editörü
  `inkEditorSnapFire(true)` (hold disarm'dan sonra), tahta portu
  `inkFreehandSnapFire(true)`, TS editör aynası finishStroke'ta
  `!snapSnapped && shapeSnapEnabled() && !shiftHeld` kapısıyla
  snapFire. Başarısızsa ham iz aynen commit (dokunulmaz). QC pen P20:
  üçgen poly n=4, dikdörtgen poly n=6 + oran-koruma (ham 708×627 →
  commit 690×587); canvas-shape-snap 38/38.
- **Zoom-out kalite raporu doğrulaması:** kullanıcı yakınken sorunsuz,
  uzaklaşınca bozulma bildirdi — GPU ve yazılım çizimi × dpr 1/1.25 ×
  zoom 1.0→0.06 × vuruş sırası/sonrası kombine doğrulamada yeniden
  ÜRETİLEMEDİ (render hatası sıfır, karo dikiş taraması 0 boşluk).
  Uzak zoom'da kalın çizgilerin AA ile doğal incelmesi kaydedildi
  (merkez kanal R: 18→240); kod değişikliği gerekçeli değil.
- **Kapsamlı QC 79→96:** P19 Shift sallantı kilidi (gerçekçi + stres,
  örnek düzeyi shiftKey) ve P20 kalkış oturtması (duraksamasız
  bırakış). Tahta QC B5 sözleşmesi dünya-px kutu invariantına
  daraldı (kalkış oturtması düz izi dürüstçe line'a çevirir);
  ink-commit-check'te şekil oturtma kapatılır (testin amacı commit
  hattı). Sonuçlar: pen 96/96, board 47/47, quickshape 17/17,
  shape-snap 51/51, canvas-shape-snap 38/38, ink-commit 7/7,
  ink-smoke 233/233, gates 11/11.
- **Paket:** 1.4.0 portable yeniden inşa edildi, `verify-package` PAKET
  GÜNCEL, masaüstü kopyası SHA-256
  70DB97E3C531319AD9A96793D0B0657C47303211360E1F91656E76724A7FDDF1,
  gates 11/11.

### Added (Şekil oturtma · etkileşim turu 4 — Tur 4i, 13 Kasım 2026)

- **Bırakış ASLA oturtmaz — kalkış oturtması kaldırıldı:** kullanıcının
  sözleşmesi netti ("çizimi bitirdikten sonra beklersem o zaman
  düzelsin; beklemeden bırakıyorum, o da düzeltiyor" + "boyamayı
  bitirip bırakıyorum yuvarlağa dönüşüyor" + "basılı tutarken bu
  olmamalı"). Tur 4h'de eklenen bırakış-anı tanıma denemesi üç
  porttan da silindi (`inkEditorSnapFire(true)` / `inkFreehandSnapFire(true)`
  / editor.ts snapFire). Oturtma artık YALNIZ bilinçli beklemede
  (~550 ms hareketsizlik) ateşler; beklemeden bırakılan her vuruş ham
  iz olarak commit edilir. 30b başlığı tetikleme sözleşmesini
  belgeliyor. P20 bekletilen-üçgen (n=4) olarak yeniden yazıldı.
- **İlk açılış yumuşatması %50 → %5:** kapalı çizim penceresinde ilk
  dokunuş yumuşatma tohumu 0.5 ile başlıyordu; `inkCreateState()`
  tohumu 0.05'e çekildi — ilk çizgi neredeyse ham izle başlar.
- **El çizimi kare "blob" tanıması (30b):** n=4 izde dikdörtgen
  uydurması IsRectangle(15°) geçmezse QUAD çokgen düşüşü (dönüş
  ≥ 0.55, kenar ≥ rawLen·0.05, konvekslik); kazanan aday havuzu
  `resid ≤ birincil·1.6+0.01` içinden ham bbox oranına en yakın
  adayla seçilir. LSQ köşe rafinerisi denendi ve gerekçeli geri
  alındı (sağlam RDP köşelerini bozuyordu). Probe A–L: kare 1.04,
  dörtlüler 1.20, üçgen/çokgen/daire hepsi doğru; shape-snap 51/51.
- **Seri çizimde karo dikiş kırıkları düzeltildi (36):** hızlı seri
  çizimde vuruşlar arası yakınsama karesi düşmez, önceki vuruşun
  canlı önizleme bitleri karo defterinde donar; yeni vuruşun çip
  karesi yalnız bölge boyadığından bölge dışı bayat bitler karo
  sınırında farklı durumlarla çakışıp çizgide dikdörtgen kırık
  üretiyordu (zoom, defteri sıfırlayıp tümünü yeniden boyadığı için
  kırıkları siliyordu). İki onarım: (1) `inkEditorTileFrame` markDirty
  öncesi kirli karolar `bakeDirty` çakısıyla tam kutu boyanır;
  (2) vuruşun İLK karo karesinde bekleyen tüm canlı/kirli karolar
  KALICI kaynaklardan tam kutu yakılır (`bakePerm` — commit
  yakınsamasıyla birebir içerik). Ölçüm: görünür dikiş kırığı
  172–177 px/serit → 0; uyumsuz piksel 5185→1142 (seri ortası),
  9212→1403 (seri sonu); artan fark yalnız çizilmekte olan vuruşun
  kuyruğunda (≤1 kare geçici). tile-parity 0 bozuk, screen-parity
  farkN=0, framechip-parity 0, ink-tile-view TÜM GEÇTİ.
- **Zoom'da çizgi kaybolması raporu doğrulaması:** 9-nokta
  örneklemeli 20 ctrl+wheel olayında (zoom 0.08→16) vuruş alfa
  her örneklemde 255 — yeniden ÜRETİLEMEDİ; "zoom'da kaybolan"
  şeyin dikiş kırıklarının silinmesi olduğu değerlendirildi.
- **Kapsamlı QC:** pen 99/99 (P20 yeniden yazıldı) · board 47/47 ·
  shape-snap 51/51 · canvas-shape-snap 38/38 · commit 7/7 · smoke
  TÜM GEÇTİ · gates 11/11 (PURE).
- **Paket:** 1.4.0 portable yeniden inşa edildi (app 46186 satır,
  canvas-editor 168.1 KB, inkcore.node), `verify-package` PAKET
  GÜNCEL, masaüstü kopyası SHA-256
  BE1D8214439F5F65E017BFE41A5C3329269B2E8A2EA53ACD03EC8631325694AE,
  113,973,466 bayt.

### Changed (Şekil oturtma · etkileşim turu 4j — kare/üçgen tanıma
###    kaldırıldı + bekletmede mükemmelleştirme)

- **Yalnız çizgi + yay + daire tanınır; kare/üçgen/dikdörtgen/çokgen
  tanıma TAMAMEN kalktı:** kullanıcının sözleşmesi ("yuvarlak dışında
  başka hiçbir şekli kare üçgen falan tanımlama düzeltme yapmıyoruz").
  30b'de tüm poly/quad/rect/triangle/çokgen makinesi silindi; tanıma
  birliği `line | arc | circle`'a indirildi; `cornered` çift-kanıt
  köşe koruması geri geldi (köşeli açık izler yaya dönüşemez).
  Kapı değerleri kalibre edildi: `INK_SNAP_CIRCLE_RES = 0.215`,
  `INK_SNAP_CIRCLE_DRIFT = 0.22` (ölçüm: kalp 0.226–0.230 reddiyet;
  kuyruklu-6 0.201–0.209 kabul; kanca 0.193–0.196 kabul; içe spiral
  drift 0.243–0.245 reddiyet; dışa spiral res 0.271/drift 0.570
  reddiyet — spiral asla daire olmaz).
- **Bekletmede mükemmelleştirme (yerinde, geri alınamaz):** hiçbir
  şekle oturmayan vuruşta ~550 ms duruş izi yerinde mükemmelleştirir
  (`inkShapeSnapFairPath` — 30b'de adil yol çekirdeği). Köşe koruma
  hattı: yeniden örnekleme → köşe saptama (0.72 rad, çift kanıt) →
  rijit bloklar → durak-çıkışı → yer-değiştirme tavanı
  (clamp(toplam×0.02, 1, 6) px) → Taubin λ/μ akıtması (λ=0.5,
  μ=0.62; karalamada μ=0.56). Keskin köşeler SİVRİ kalır (Z asla S
  olmaz), yumuşak izler yumuşar, uçlar bit-birebir korunur, girdi
  dizisi mutasyona uğramaz, mükemmelleşme GERİ ALINMAZ. Açık izde
  köşeler arası serbest bölüm kendi akorduna düzlenir (zikzak/L/Z
  bacakları); KAPALI izde düzleme yok (el karesi mükemmel çokgene
  dönüşmez) — yapı korunur: yarım yuvarlak yarım YAY kalır (asla
  tam daire), spiral dönüş sayısı korunur. Tekrarlı bekletme
  kademeli rafine eder (hiç kötüleşmez).
- **Taşıma katmanları:** editör portu `inkEditorSmoothFreehandStroke`
  (36) ve tahta portu `inkSmoothFreehandStrokeInPlace` (30) artık
  çekirdeği çağırır; kind hep 'stroke' kalır, snapped işareti
  konmaz. TS aynası `shape-snap.ts` baştan yazıldı + parite düzeltmesi
  (bayat 0.30/0.18 → 0.215/0.22; `Float64Array<ArrayBufferLike>`
  generics). editor.ts snapFire boş-dönüşte mükemmelleştirme
  düşer (revert yok).
- **Kapsamlı QC:** shape-snap 76/76 · canvas-shape-snap 74/74 (ölçüm
  disiplini: eş-aralıklı resampleN tabanı, dalgalı bacaklar kavis
  5 px, bacak sapması kendi yerel akorduna, gövde pürüzlülüğü köşe
  çevreleri hariç) · pen 99/99 (P6/P12/P18/P20 Tur 4j'ye yazıldı:
  kare/yuvarlak-kare/yavaş-sürünme/bekletilen-üçgen şekle DÖNÜŞMEZ,
  bekletmede n değişir uçlar bit-birebir) · board 48/48 (B4/B9
  gerçek kalem sarsıntısı ±2 px ile: bekletmede n 121→168 ve
  134→300, kare oranı korunur, kind 'stroke').
- **Paket:** portable yeniden inşa edildi, `verify-package` PAKET
  GÜNCEL (app.js 1811.5 KB, canvas-editor.js 185.7 KB), masaüstü
  kopyası SHA-256
  3C7A3300E0A25F7C7D438C3CA23213B12A8F7D3EBBF0C5EB318717DF2B2B9B3B
  (eski BE1D8214…), 113,986,309 bayt.

### Changed (Şekil oturtma · etkileşim turu 4k — "bekletilen her şey
###    düzelsin")

- **Köşeli kapalı iz kusursuz ÇOKGENE oturur (kullanıcı onayı ile geri
  geldi):** kare/üçgen/dikdörtgen/çokgen bekletmede `{ type:'poly',
  closed:true }` olur (`stroke.shape='poly'`, snapFree); V/Z/L köşeli
  açık izler AÇIK çokgene (closed=false); basık ovaller OVAL kalır
  (`circle` + `oval:1, rx, ry` — en-boy korunur); 290°/300° boşluklu
  halka YAY kuralıyla halka sayılır; karalama/spiral dokunulmaz.
  KAPALI çokgen adayı ÇİFT kanıt (döndürülmüş + ham) köşe kümeleri,
  baskınlık eşiği `max(0.6, maxTurn×0.45)`; açgözlü köşe seçimi +
  `snapRefineCorners` (yutulan köşe zirveden geri gelir).
- **Span sınıfı düzeltmesi — uygulama uzayı kanıtı (kritik):** gerçek
  uygulamada One-Euro stabilizer + centripetal Catmull-Rom köşe
  dönüşünü bacaklara taşar; işaretli dönüş 0.35 eşiğini aşıyordu
  (0.83–1.26 rad) ama iz akorda yakındı (dev/len 0.04–0.07). Yeni
  düzlük kanıtı: `dev/len ≤ %10` VE span içindeki iç zirve
  `MAX_TURN (0.75)` altı. Zirve koruması şart: uzun zigzag span'lerde
  dev/len küçülür (2 köşeli ~750px W parçası 0.096!) ve net dönüş
  iptal olur (|turn| 0.09) — korumasız W'nin 2 köşesi yutuluyordu.
  Gerçek yay aralıkları 0.2+ sapar → boşluklu halkanın küme-arası
  yayları asla düz sınıflanmaz. Her iki çekirdekte (30b +
  shape-snap.ts).
- **RobustCircle NaN hatası:** `snapDist(p, f)` f'nin cx/cy'sini
  x/y'ye taşımıyordu → tüm hatalar NaN, aykırı-kırpışlı yol ölü kod.
  `snapDist(p, {x:f.cx, y:f.cy})` oldu. **Kalp koruması:** robust
  daire kapısına tam-iz kalıntısı eklendi (`≤ 0.215`): kalp 0.241 →
  null, kanca 0.193–0.196, kuyruklu-6 0.201–0.209 geçer.
- **Kopukluk (br) onarımı ölçüm düzeltmesi:** healCap/boşluk sX/sY İLE
  ölçülür — normalize nokta + dw/dh çağıranlarda healCap her zaman
  24-normalize (≈7200px) oluyordu; büyük-kopma yolu uygulamada asla
  tetiklenmezdi.
- **Dikiş temizliği:** recognize girişinde bitişik ikiz noktalar
  (<1e-6) düşürülür — kapalı vuruşun birebir dikişi küme enerjisini
  boğuyordu.
- **Fırça (28-ink-brush) closePath:** `poly && closed` ya da circle
  için kapanış segmenti damgalanır — çokgen başlangıç dilimi boş
  kalmaz.
- **Açık-poly baskınlık kanıtı:** `openPoly` köşe-BASKINLIĞI
  (küme-dışı medyan < 0.12 — kapalı yoldakiyle aynı) eklendi;
  2,5-periyot dalga artık null → yerinde mükemmelleşir.
- **Fair çapa-yok structure koruması:** köşe çapası bulunamayan
  izde tüm iz TEK serbest span'dır; span uydurma onu akorda
  çekiyordu (dalga düz çizgiye iniyor, curv oranı 0). Çapasız
  izde düz-oturtma atlanır (yalnız Taubin); çapalı span'ler
  (gerçek bacaklar) akord tavanıyla düzelir.
- **Kapanış kenarı muafiyeti + değnek reddi:** kapalı çokgen
  adayında kapanış span'i sınıf denetiminden muaf (kapanış kenarı
  köşe kord'undan sentezlenir; tepe kubbesi/kapanış kancası
  aşırı-sallanması orada yaşar). Dengeleyici kurallar: aday TÜM
  baskın köşeleri kapsamalı + değnek reddi (çevrimsel köşe
  aralığı `max(3, n×0.07)` altı reddedilir). Domlu tepeli +
  kapanma kancalı kullanıcı üçgeni artık kusursuz çokgene oturur.
- **Bilinçli boşluklu halka yay kapısı (B2):** tarama ~280°+ ama
  boşluk TURN_GAP (46°) üstüyse iz bilinçli AÇIK halkadır (300°
  halka, C/D kıvrımı) — yay kalır, boşluk KORUNUR (daireye
  kapatmak kasıtlı boşluğu siler). En-boy oranlı tuvalde çizilen
  boşluklu halka düz-elips olur (cv ~0.11); dar ARC_CV (0.09) onu
  döküyordu → null. Geniş taramada cv tavanı CIRCLE_CV (0.18);
  spiral (cv 0.3+) hâlâ dışarıda. ink-quickshape-qc B2 bekleyişi
  4k sözleşmesine yazıldı (arc). Her iki çekirdekte.
- **QC:** shape-snap 95/95 · canvas-shape-snap 97/97 · pen 99/99 ·
  board 48/48 .
- **Paket:** portable yeniden inşa edildi, masaüstü kopyası SHA-256
  74940AC169B26258B30D9AFCDECE6145A8A0E437115368B8333EC57912E0AB53,
  113,997,512 bayt. Gates 55/55 kapı yeşil (tam zincir).

### Changed (Şekil oturtma · etkileşim turu 2)

- **Bekleme 550 ms / hareket eşiği 8 px:** referans etkileşim ~0,5 sn;
  eski 2000 ms/3 px ikilisinde kalem-basılı el titremesi zamanlayıcıyı
  sürekli yeniden kurup oturtmayı hiç tetiklemiyordu ("kalemi bırakmak
  gerekiyor" hissinin kök nedeni). Kalem basılıyken dönüşüm artık canlı
  görünür; oturtma sonrası kalem ≥8 px hareket ederse vuruş ham izine
  döner (`inkEditorSnapRevert` / `snapRevert`) ve çizim aynı karede
  normal yolla sürer — mikro titreşim (<8 px) şekle dokunmaz.
- **Halka eşikleri gevşetti:** `TURN_CIRCLE` 5.5→4.9 rad (~280°),
  `CIRCLE_CV` 0.12→0.18, `MAX_GAP` 1.75→2.2 rad — boşluklu/samuraya
  yakın her yuvarlak artık daireye oturur. `CLOSED_RATIO` 0.12'de
  bilinçli kaldı: 0.16'ya gevşetmek kanca girişli/kuyruklu halkaları
  köşe sınıflandırıcıya düşürüp polygon sanıyordu (regresyon kanıtlandı,
  geri alındı); 280°+ boşluklar açık daldaki halka kararıyla yakalanır.
- **Kalınlık paritesi:** oturtulmuş vuruşlar artık `snapFree` işaretiyle
  NORMAL fırça damgalarıyla yazılır (`28-ink-brush.js` dispatch) — şekil
  aracının 0.22× ince kontur yolu sızmaz; basınç medyan örnekten alınır
  (ilk örnek değme anına ait ve hafiftir). Canlı önizleme == commit
  birebir korunur (QC: ref=48 / circle=49 px yatay kesit).
- **Revert yolu düzeltildi:** `36-ink-editor.js`'te kind='shape' erken
  dönüşü oturtulmuş fırça vuruşunu yakalayıp revert dalını ölü kod
  yapıyordu; dal `!ui.snapped` ile korundu. Canvas editor portunda aynı
  akış zaten doğrudu. Revert, scratch'i katman kopyasına sıfırlar
  (oturtma dönemindeki şekil raster artığı temizlenir).
- **Kapılar:** `tests/shape-snap-check.js` 50/50 (yeni: gevşek halka
  sınırları + snapFree/medyan basınç), `tests/canvas-shape-snap-check.js`
  38/38, `tests/ink-quickshape-qc.js` 17/17 (YENİ e2e QC: canlı görünürlük
  canlı==commit parite, kalınlık, 6 kapsam varyantı, karalama koruması,
  duraksama→oturtma→hareketle-revert), `ink-commit-check` 7/7,
  `canvas-editor-test` 60/60.

### Changed (Performans)

- **M7 · kiremit aşama 2 dilim 3 — karo ızgarası ÜRETİMDE AÇIK:**
  `36-ink-editor.js`: ızgara kurulumda açılır (`inkTilesEnabled`),
  `localStorage 'tailref-ink-tiles'='0'` kaçış hatch'i ile 1.4.0
  davranışına dönülür. "Çizim Ayarları" menüsüne "Karo boyutu ▸"
  alt menüsü (Otomatik/128/256/512 — Simetri kalıbının birebir kopyası):
  boyut değişimi yalnız vuruşlar arasında uygulanır (vuruşun ilk karesi
  öncesi). Otomatik profil: ilk vuruş(lar)ın kare-süresi örneklerinden
  tek karar (medyan > 25 ms ya da slowFrames ≥ 4 → 512, değilse 256);
  karar vuruş bırakma sonrası yazılır, SONRAKİ vuruşun başında
  uygulanır (taze yakınsanmış defter bozulmaz). Benign tam-yol karesi
  düzeltmesi: vuruş sırasında chip'i tükenmiş "boş" kareler defteri
  siliyordu; `tvChipSeen` iziyle benign kareler defteri korur, silme
  yalnız yapısal tam yolda (GPU/sym/şekil/rot/anahtar değişimi) —
  düşük donanım ölçümü düzeldi (×4: 15→64 fps). Parite zinciri yeniden
  yeşil: `_tiles-view-parity` A/B/C diff=0 (karo 4/6/6), `_midstroke-parity`
  sym-off + mirrorX diff=0, ×8 parite biti diff=0; ekran düzgünlüğü
  `_tiles-view-visual` (kiremit-orta/kiremit-bitmiş/karosuz-orta 3 PNG)
  elle incelendi — karo dikişi, ikili çizim, çizik yok. Kiremit AÇIK ×1:
  89.9 fps, ×4: 64.5 fps (bölge-blit kazancı: doğan karo re-birth
  yerine bölge bliti), ×8: 15 fps + parite biti diff=0 (M7 çizgisi
  korunur).
- **M7 · kiremit aşama 2 — karo görüntü ızgarası (kapalı bayrak):**
  `59-ink-tile-view.js` TileGridView (sparse karo defteri, kirli-karo
  culling, boyut 128/256/512) + `36-ink-editor.js` karo painter'ı:
  vuruş karelerinde sahne kompoziti kirli karolara cihaz-px hizlı 1:1
  akıtılır; yeni doğan karo tam kutu kompozitiyle (Krita/PS kalıbı)
  kâğıdıyla birlikte doğar. Üretimde kapalı (`ui.tileViewOn` yalnız
  prob/ölçüm/ayar), davranış değişmez; ayar bağlantısı sonraki dilim.
  Parite: `_tiles-view-parity` üç faz (vuruş-ortası 1 · vuruş-ortası 2
  bölge-blit · commit sonrası kalıcı kaynak yakınsaması) **diff=0**;
  saf kapı `ink-tile-view-test` yeşil; kapalıyken vuruş performansı aynen
  (kiremit-AÇIK ×1: 88 fps, ×4: 35 fps — doğan karo tam komposit maliyeti;
  düşük donanım profili karolar kapalı kalır).
- **M7 · sahne kirli-kutu kompoziti (kiremit aşama 1):** vuruş sırasında
  ekran sahnesi artık tüm tuvali temizleyip tüm yüzeyi yeniden
  rasterize etmez; yalnızca değişen önizleme kutusu (`ui.sceneChip`)
  ekran karşılığında komposit edilir. Sym/şekil/smudge/yol-fırçası/GPU
  yolları eski tam render'da kalır (görünür değişiklik yok). Ölçü
  (CDP CPU kısma + yazılım raster): ×4 kısımda 22.4→63.5 fps,
  ×8'de 8.3→17.7 fps; ×1'de 84.6 fps. Parite: vuruş-ortası byte-parite
  diff=0 (`docs/BUGS.md` B5).
- **M6 · uyarlanabilir sahne render kısınlama:** vuruş sırasında kare
  süresi 25 ms'yi iki kez aşarsa (düşük donanım/yazılım raster) sahne
  render'ı alternatif karede bir atlanır; imleç halkası tam hızda kalır,
  dab birikimi artımlı (atlanan karede ertelenir, israf yok). Hızlı
  makinelerde devreye girmez. Ölçü (CDP CPU kısma + yazılım raster):
  ×4 kısımda 11.8→22.4 fps, ×8'de 2.7→8.3 fps; ×1'de değişiklik yok.
- **Fırça damga yoğunluğu:** studio-pen `spacing` 0.028→0.085,
  fine-liner 0.022→0.07, dry-ink 0.055→0.085 — vuruş başına basılan
  damla sayısı ~3× azaldı; görüntü kalibrasyonu tam-parite profillerle
  doğrulandı.
- **Catmull adım kapısı** 24→8 (`36-ink-editor.js`) — tekrar örnekleme
  eşiği daraltıldı.
- **Dual kompozit dirty-rect:** canlı vuruş kompoziti her çağrıda tüm
  katman yerine yalnızca vuruşın dokunduğu bölgeyi yeniden birleştirir
  (`inkEditorDualCompositeRect` + `inkEditorDeltaRectFromPoints`).
  Simetri açıkken tam kutu kullanılır (`M2`, `M2b`).
- **UI kısınlamaları:** tahta minyatürü vuruş sırasında ~60/sn → **5 sn'de
  bir**; koordinat X/Y yazımı ~**10 Hz**; vuruş süresince resample
  kalitesi `medium` (commit baskısı aynen — parite korunur).

### Added (3D viewport)

- **Taban model kullanıcı üretimi:** 3D viewport taban modeli programatik
  referans iskeletten uygulama üretimi karaktere geçti —
  `assets/models/female-base.fbx` (Mixamo-rig'li, 65 kemik · 66 kontrol)
  ve statik yedek `assets/models/female-base.obj` (ZBrush sculpt, 15.3k
  üçgen). Yükleme zinciri: FBX (kemikli) → OBJ (statik) → programatik
  iskelet (portatif paket dayanıklılığı; `SceneGraph.install`
  normalizasyonu üç yolda da aynen). `static-server` MIME tablosuna
  `.obj` eklendi.
- **Rig adı köprüsü (`Rig.ALIASES`):** eski dummy-era poza kayıtları
  (thigh/shin yazımları) Mixamo adlarıyla (upleg/leg) eşlenir;
  `findBone`/`resolveBone` genişletilmiş eşleşme tam ad → ALIASES →
  alt-dizi sırası ile `mixamorig:*` kemiklerine tutunur. Kanıt:
  `_pose3d-base-probe` — durum "65 kemik · 66 kontrol", doğrudan dirsek
  döndürme (z 1.1 rad, şotta görünür), eski ad `LeftThigh` ile
  `applyPose` `ok:true matched:1 changed:true` (bacak kaldırma şotta
  görünür). Şotlar: `pose3d-base/bend/pose.png`.

### Fixed

- **Simetrik vuruşta çift ağırlık birikimi:** canlı önizlemede ağırlık
  tuvaline her karede tüm klonlar yeniden basıldığı için çizgi
  koyulaşıyordu → sim yolu tek-geçişe alındı (`M5`). Kanıt:
  `docs/BUGS.md` B1.
- **Dirty-rect cephe kayması:** `stableOnly` dab cephesinin delta bölgenin
  gerisinde kalması → vuruş-ortası byte-parite ihlali; 3 noktalı geri
  pencereyle çözüldü (`M2b`). Kanıt: `docs/BUGS.md` B2.
- **3D taban model sipsiyah render:** Mixamo FBX ihracatı normal
  attribute yazmamış olabilir; normal yokken toon malzeme ışığı sıfır
  çarpım yapar → düz siyah silüet. FBX yolu normal eksikse geometriden
  hesaplar. Kanıt: `docs/BUGS.md` B7 (`_pose3d-diag-probe`).
- **3D poz uygulaması eklem konumlarını ezdi:** farklı rig'den gelen
  pozun eklem konumları (p) bu rig'in kemik bağlarına uymaz → uzuvlar
  gövdeye çakılıyordu ("patlamış rig"). Artık dönüşler her zaman, eklem
  konumları yalnız rig imzası aynıysa uygulanır; T-poz reseti konumları
  da toparlar. Kanıt: `docs/BUGS.md` B7.
- **Toon gölgeleme çokgen görünümlüydü (facet):** 4 kademeli toon rampa
  yüz malzemesinde sert bantlar üretiyordu → 8 kademeli
  `lutGradient([110,142,172,198,220,236,246,255])` ile bantlar inceldi.
  Kanıt: `_pose3d-diag-probe` `gradientSteps` 8 değer döner.
- **Lineart silüette bloklu kara dilimler:** `OutlineEffect` silüet
  adımını vec4 (z dahil) normalize ediyordu; perspektif w farkı
  yönlüyü bozup taşan black chunk çiziyordu. Formül NDC'ye taşındı
  (2D adım + NaN koruması); `weldVertexNormals` ile FBX/OBJ
  normalleri konum-weld yumuşatıldı. Kanıt: `docs/BUGS.md` B8,
  `_pose3d-lineart-probe` ON/OFF şotları.
- **3D panel arayüzü karması:** 5 akordeon bölüm → **3 sekme** (Kamera ·
  Poz · Görüntü; sekme seçimi hatırlanır) + sık kullanılanlar sağ panel
  yerine **solda hızlı poz şeridine** taşındı: kontrol/gizmo/lineart
  boyutları (canlı değerli), ⟲ poz sıfırlama, kontroller göster/gizle
  anahtarı, kaydet, kayıtlı pozlar listesi, **Araçlar** (W/E/R + Odak +
  Yakala) ve **arkaplan ayarları** (mod · HDRI yükle/kaldır ·
  dönüş/bulanıklık/güç · zemin ızgarası). Şerit ve ayar popup'ı aynı
  yüzey/typo ailesine geçti (vp-glass + cam blur + aynı etiket tipi);
  popup içeriğine göre esneyip tavalardan büyür. Kanıt:
  `_pose3d-diag-probe` ACILIS/STRIP/TAB satırları.
- **3Dilk-rehber ("? Nasıl kullanılır"):** şeridin tepesinde soru
  işareti → resimli 4 adımlık poz rehberi (kontrolleri aç · E ile eklem
  çevir · ⟲ Sıfırla güvenliği · ◉ Yakala → Önizle → Tahtaya). Hiç 3D
  poz vermemiş ilk kullanıcıya panel ilk açıldığında **bir kez**
  otomatik gösterilir (`localStorage` bayrağı). Adım fotoğrafları
  `_pose3d-lineart-probe` ile üretildi
  (`assets/pose3d-guide/adim1-3.png`). Kanvas düğmesi (yazışır Yakala)
  kaldırıldı.

## [1.4.0] — 2026-11-06

İlk kamu açık kaynak sürümüne hazırlık sürümü. Odak: yasal temizlik
(üçüncü taraf/AI varlık kökleri), güvenlik/sağlamlık ve UX iyileştirmeleri.

### Changed

- **3D referans modeli:** üçüncü taraf kökenli `ScaleReferenceDummy.fbx`
  depo ve paketten tamamen çıkarıldı. Yerine bu depoda kod içinde üretilen,
  MIT kapsamındaki **`pose3d/dummy/DummyRig.js`** (18 kemik referans iskelet)
  geçti. Kullanıcı model yolu (`SceneGraph.load`) aynen korunmuştur — FBX/GLTF
  yüklemeye devam edebilirsiniz.
- **Splash:** AI üretimli açılış animasyonu varlıkları (`splash-frames/*`,
  `splash.gif`, `tailref_splash_logo.png`) kaldırıldı. Splash artık `splash.html`
  içinde **el-yazımı inline SVG animasyonu**dur (bitmap yok, üçüncü taraf yok).
- **README/çevrimiçi belgeler:** yayın hijyeni (gerçek test zinciri bilgisi,
  Windows x64 kapsamı, imzasız dağıtım/SmartScreen notu, gerçek ekran
  görüntüleri).
- **Lisans/trademark:** `LICENSE` içine trademark kısıtı, `README`'ye marka
  notu eklendi (fork'lar adı ve markayı değiştirmelidir).

### Added

- **OSS kümesi:** `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`.
- `THIRD_PARTY_NOTICES.md` genişletildi: kaldırılan FBX/AI varlıkların köken
  kayıtları ve marka yenileme blocker'ı belgelenir.
- `scripts/verify-package.js` sonrası **PAKET GÜNCEL** doğrulaması release
  akışına bağlandı.

### Fixed

- **Hayalet sürükleme:** çoklu öğe sürüklemede askıda kalan DOM metin seçimi
  Chromium'un native drag akışını tetikleyip pointer olay zincirini
  öldürüyordu; pointerdown'da seçim temizliği + `dragstart` guard ile kökten
  çözüldü.
- **Beyaz dış çerçeve:** pencere odağında `html:focus/body:focus` outline'ı
  kaldırıldı.
- Panel/düz yeni ikonlar (çizim fırçası, grup, bağlantı) eksik rengi
  tamamladı.

### Security

- Güvenlik modeli belgelendi (`SECURITY.md`) ve korunur:
  `contextIsolation`/sandbox/CSP/openExternal whitelist/path traversal
  koruması. Bu sürümde model zayıflatılmadı.

### Known limitations (1.4.1 öncesi)

- `tests/pose3d-smoke.js` içindeki iki uzun süreli başarısızlık
  (HUD navigasyon fade + büyütülmüş panel ayar chip erişimi) **orijinal FBX ile
  de** aynıydı — önceden bulunmuş; bu sürümle gelen bir regresyon değildir.
- **Magic wand** (sihirli değnek) seçim aracı uygulanmadan bir sonraki
  sürüme bırakıldı (test zincirinde SKIPPED).
- Ink **K16–K22** polish/parite kalemleri açık (`docs/INK_STATUS.md`).
- **WASM/N-API** hız çekirdeği ertelendi — yalnızca açık onayla çalışılır.

## [1.3.x ve öncesi]

Bu depo ilk açık kaynak sürümünden önceki geçmişini ayrı ChangeLog'ta değil,
`docs/` içindeki mühendislik dokümanlarında tarihçesiyle taşır.
