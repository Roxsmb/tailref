# Çizim Motoru Performans Planı · 2026-11-09 turu → devam listesi

> Durum: 2026-11-09 (Pazartesi) itibarıyla 44/44 kapı yeşil, masaüstü exe güncel.
> Bu dosya bir sonraki turun **yapılacaklar listesidir**; iş bitince
> `docs/INK_STATUS.md`'e özet işlenir.

## Bugün tamamlananlar (kayıt için)

V8 örnekleme profileri + `getImageData` enstrümantasyonu ile üç darboğaz
kanıtlandı ve giderildi:

| Darboğaz | Düzeltme | Önce → Sonra |
|---|---|---|
| Undo çekimi karo fırtınası | `34-ink-undo.js` hibrit okuma (anlık görüntüden dilim) + `57-ink-tile-canon.js` soğuk-karo aynalaması kaldırıldı | vuruş başına 20-78 okuma → 1 |
| `getImageData` çağrı senkronu | item kanvaları + minyatürler `willReadFrequently`; boşluk taraması boyama sırasında atlanıyor | 43.742 → 3.337 örnek |
| Fırça geçişi çifte senkron | `inkSetTool` `deferUi` + kart önizleme bake önbelleği + `inkSyncUI` ölçümsüz optSync | 254 ms → 16 ms |
| Yinele (redo) piksel kayması | undo anında "after" anlık görüntüsü yakalanıyor, redo birebir koyuyor | vektör repaint ~%0.4 kayma → birebir |

Kıyaslama: vuruş içi iş ort 150→42 ms · 774 vuruşluk Renaissance boyama
kare p50 6 ms, FPS≈167 · undo 28-41 ms · kapı zinciri 44/44 yeşil

## 09.11 akşam turu · C++ çekirdek evre 1 (canlı)

- **Profil tabanlı geçiş:** `inkWorkspaceHistoryKind` (JSON.parse sıcak
  yolda, 299 örnek) → ilk-15-karakter parmak izi (44-ink-workspace-
  controls). `createNoiseTip` (138) + GC (120): uç/damga/tint
  önbellek kapasitelerini aşan kayıtların sıkığından - varyant×kova
  alanı 105 kalem, eski sınırlardan (80/48/96) büyüktü. Çözüm:
  tip 204 / tint 110 / stamp 160.
- **C++ çekirdek (inkcore):** `noiseTip` + `watercolorTip` N-API;
  derleme MSVC v143 + Electron 45 ABI. Parite: suluboya bit-biti
  (maxDiff=0), gürültü ≤1. Hız: suluboya 2,1×; gürültü 1,2× (JIT
  saf tamsayı döngüde güçlü - evre 2/4'te kazanç GC'siz bellek
  planından gelir).
- **Sonraki turlar:** evre 2 = `inkForEachDab` +
  `inkCatmull` C++ port (damla aritmetiği), evre 4 = undo tutması
  satır kırpması (getImageData 667 örnek - undo "after" kırpması
  KEEP=10 zaten sürüyor, zone bant kırpma eklenecek).

(`ink-tile-canon-test.js` yeni semantiğe taşındı: "soğuk karo aynalanmaz").

## YARIN YAPILACAKLAR (sıralı)

### Tur 0 · Açılış iyileştirmesi (BİTTİ — 2026-11-09)

Zayıf laptop raporu: "çizim artık akıcı, ama açılış çok uzun."
Kalıcı açılış damgaları eklendi (`__bootMark`, perf-diag panelde
"Açılış damgaları" satırında görünür) ve sonda (`tests/startup-probe.js`)
İle ölçüldü. Açık bulgular:

| Aşama | Önce (ms) | Sonra (ms) |
|---|---|---|
| js başlangıç → veritabanı açık | ~400 | ~420 |
| tahta geri yükleme (boş) | ~60 | ~30 |
| `inkInitUI` · hızlı şerit önizlemeleri (40 kart × ~35 ms senkron boyama) | **1.348** | 2 (boş-zamana eritildi) |
| `inkInitNativeBrushLibrary` · gizli kütüphane panel kurulumu | **473** | 0 (boş-zamana eritildi) |
| `inkRebuildAll` | ~0 (boş tahtada) | ~0 |
| **etkileşime hazır** | **~2.370** | **~610** |

Düzeltme mantığı: paneller açılışta GİZLİ (araç kutusu "Çizim Yap" modunda
açılır). `52-native-brush-library.js`'e `inkNativeWhenIdle` boş-zaman kuyruğu
eklendi: kart DOM'u senkron, kanva boyamaları boş-zamanda. Kullanıcı
kütüphaneyi açarsa `inkOpenNativeBrushLibrary` senkron yeniden kurar.
İlk açılışın kalan yavaşlığı (%TEMP'e taşınabilir exe ayıklaması + AV taraması)
install edilebilir NSIS sürümüyle düzeltilir (aşağıya not düştü).

### Tur 1 · Küçük borçlar (ÖNCE BUNLAR; her biri yarım saatin altında)

- [x] **0. Fırça önizlemeleri diske kalıcı olsun — BİTTİ (2026-11-09).**
      `52-native-brush-library.js`: `inkPreviewBakeKey` (tek kaynak
      anahtar üretici), `inkPreviewDisk*` katmanı (IndexedDB 'meta',
      'nbprev|' öneki), `inkPaintPreviewAsync` (bellek → disk-decode
      → regen sıralı boya), prewarm artık diske-aware. Anahtar =
      fırça özellik özeti + piksel boyutu + tema rengi (tema/fırça/
      boyut değişince yalnız ilgili resim yenilenir). 400+ kayıt
      birikmede en eski %25 temizlenir. DB anahtarları öneklidir,
      bellek anahtarları ham — bu uyum `ham()` helper ile sağlanır
      (regen sayacı 117 → 2 kanıtlandı). Sonda
      (`tests/startup-probe.js`) artık `TailRef_PROBE_DIR`
      değişkeniyle kalıcı dizide iki koşumu kıyaslayabilir.
      Doğrulama: 2. koşumda `yeniden-boyama-sayisi=2` (117 idi);
      `inkNativeRenderAll` artık `inkOpenNativeBrushLibrary`'de
      senkron yeniden kurar, açılıştaki kurulumu boş-zamana
      ertelendi (önceki maddeyle birleşik).


- [x] **1. Prewarm açılışa taşinsın.** `inkNativePrewarmStrokePreviews`
      şu an ilk fırça değişiminde tetikleniyor. Uygulama açıldıktan
      ~2 sn sonra (ilk setActiveBrush gerekmeden) bir kez çağrılan
      başlatma noktası ekle (`52-native-brush-library.js`). Böylece
      ilk fırça geçişi de ~16 ms olur. Doğrulama: hotpath sondasında
      A bölümü ilk `totSetActiveBrush` < 30 ms.

- [x] **2. Undo bellek bütçesini dengele.** "After" anlık görüntüsü
      belge belleğini ~2 katına çıkardı. `34-ink-undo.js`:
      yalnızca SON 10 kayıtta after sakla; daha eskiler redoda
      vektör repaint yoluna düşsün (o yol çalışıyor). Doğrulama:
      `tests/ink-undo-verify.js` tüm kontroller OK; hotpath undo ms
      stabil.
      **SONUÇ (2026-11-09): `inkUndoTrimAfterScopes()` eklendi**
      (KEEP=10; yeni after yakalanınca eskilerin after'ı bırakılır,
      bytes altındaki entry.bytes düşülür). Doğrulama:
      ink-undo-verify'e "Kırpma (KEEP=10)" bölümü eklendi — 11/11 OK
      (afterFn≤10; 13 vuruş → 13 undo → 13 redo birebir; 6+6 kısa
      yuvarlak-trip ~eş; derin undo boş uç). Not: 13 hız ardışık
      vuruş, undo'da ~5-6 birleşik kayda toplanıyor (tarayıcı
      `_byDesign`); yuvarlak-trip kararlılığı bundan bağımsız geçti.

- [x] **3. Commit kuyruğunu garantiye al.** Kullanıcı vuruşu bıraktığında
      bekleyen commit kuyruğu hemen boşaltılsın (şu an rAF'ta tembel;
      vuruşlar LAĞLAĞ değil ama erken okumada geriden gelir).
      `36-ink-editor.js` inkPushUndoStroke/commit bölgesi.
      Doğrulama: hotpath sondasında doc sayım dizisi düzgün artar
      (0→1→2… plateau'suz) VE vanishing=0 kalır.
      **SONUÇ (2026-11-09): Kod değişikliği GEREKMEDİ.**
      `tests/ink-commit-queue-debug.js` kanıt: vuruş pointerdown'da
      başlar (`ui.stroke` anında kurulur), `layer.strokes.push`
      pointerup'ta SENKRON çalışır (:4055), kayıp vuruş 0/5
      (`upAninda=1,2,3,4,5`), rAF/16 ms/136 ms okumaları hep aynı —
      kuyruğa kalacak iş yok. Önceki "vuruşlar düşmüyor" bulgusu
      sondanın koordinat hatasıydı: koordinatlar fit-dikdörtgeni
      (kâğıt ekran rect'i) yerine pencere rect'ine göre verilmişti;
      kâğıt 2560×1400 pencereye %28,6 sığdırıldığından nokta kâğıt
      dışına düşüyordu (bekletme/pending yolu). Sonda artık
      `inkEditorUi.fit` bazlı koordinat kullanır.

- [x] **4. (Opsiyon) Geniş vuruşlarda undo çekimi — KARAR: YAPILMADI
      (ölçümle gerekçelendi).** Undo okuma maliyeti çoktan tek dilime
      indi: ink-undo-verify/hotpath ölçümlerinde `inkUndoCaptureBefore`
      vuruş başına TEK okuma (2560×~124 dilim), `inkApplyStrokeEntry`
      vuruş başına 3 küçük dilim (~2,5 MB / ~5 ms). Undo ms'sinin
      (33-47 ms) yükü getImageData değil, sahnenin tam-yol yeniden
      boyaması (karo reseti + tam kare) — bu da bilinçli korundu
      (madde 5 kararı). Satır-satır okuma bu profilde ~0 kazanç
      getirirdi; karmaşıklık riskine girmeye değer değil.

### Tur 2 · Kirli-bölge birleştirme (EN KAZANÇLI ADIM)

- [x] **5. Katman birleştirmeyi kirli bölgeye indirme — BİTTİ (2026-11-09).**
      Bulgu: canlı kareler ZATEN bölgesel çalışıyordu (karo ızgarası
      varsayılan açık; 2D artımlı dual yol "chip" kirli kutusunu karo
      defterine akıtıyor). Kalan maliyet commit anındaydı: (a) katmana
      tam clear+copy bake (2560×1400'de vuruş başına 2 tam tuval işi),
      (b) sahne commit karesinin tam yolu (~20+ tam-tuval drawImage +
      küçültme önbelleği yeniden kurulumları). `36-ink-editor.js`
      değişiklikleri: commit artık `inkEditorFullRasterRect` bölgesiyle
      yazılır (bölge dışı preview içeriği katman kopyası olduğundan
      bit-parite) ve bake bölgesini `ui.frameChip` olarak saklar;
      `inkEditorRender` tam yoluna bölgesel dal eklendi
      (`inkEditorFrameChipPaint` — ancak karo defteri o karede
      sıfırlanmadıysa (tvZapped guard), rot=0, GL yok, fit/katman
      anahtarları sabitken). Undo/redo tam yol kareleri ilke olarak
      korundu (karo-zap eşleştirmesi bozulmasın; undo kullanıcı
      başlatmalı olduğundan maliyet önemsiz). Önce→sonra
      (`ink-drawimage-attrib.js`): toplam drawImage 88.263 → 70.238;
      vuruş başına tam-kare sahne boyası 44 çağrı → bölgesel dilimler
      (vuruş bölümünde tam-yol ~0; kalanlar yapısal kareler).
      Doğrulama: brush-parity-sweep TÜM FIRÇALAR PARİTEDE;
      ink-framechip-parity (yeni sonda) bölge içi + dışı EŞİT;
      ink-undo-verify TÜM KONTROLLER TAMAM; renaissance canlı kare
      p50=6 ms (sabit); commit-check piksel-parite OK.
      Kalanı: küçültme önbelleği sikliği bu turun devam adımında
      giderildi (aşağıda Tur 3 ara adımı). Fırça damga motoru
      (anlık drawImage'ın ~%70'i) kirli-bölge kapsamına girmez —
      ayrı iş.

### Tur 3 · Orta vade (ölçüm görünürse) — KARAR GÜNÜ (2026-11-09)

- [x] **ARA ADIM · YAPILDI: küçültme önbelleği sikliği giderildi.**
      Madde 5 ölçümünün devam bulgusu: `scaledCache` kapasitesi sabit
      16 < 20 katman → her tam karede ~4-5 mini sürekli yeniden
      kuruluyordu (silme, erişim sırasına bakmadan en eskiyi
      atıyordu). Kapasite katman sayısına uyarlandı (katman sayısı
      + 4; 16-64 aralığında) ve önbellek vuruşunda (hit) girişin
      önceliği tazelendi. Önce→sonra (`ink-drawimage-attrib.js`):
      vuruş başına mini yeniden kurulum ~15-16 → 1 (yalnız boya
      dönemi yükselen katman); Renaissance canlı kare p95 177 ms →
      7,6 ms (p50 6 ms sabit kaldı).
- [ ] **6. GC baskısı için damga havuzu (pool) — KARAR: ŞARTLI
      ERTENİR.** Ölçüm: örnekleyicide GC örnekleri ~670 (bir önceki
      ölçümde ~730 idi); sıralamada ikinci kademede (ilk kademede
      getImageData 3922 ve toBlob 2074 örnek var). Baskı gerçek ama
      ilk sırada değil; damga yürüyüşüne havuz cerrahisi yüksek
      geri dönüş riski taşıyor. Sonraki turda GC örneği en tepedeki
      kalemlere gelirse yeniden değerlendirilir.
- [ ] **7. Worker'a pişirme taşıma (OffscreenCanvas) — KARAR: kazanç
      küçüldü, ölçümle şartlı.** Madde 5 bake'i bölgesel kısaltınca
      ana iş parçacığındaki commit senkron yükü zaten azaldı; worker
      taşımanın beklenen kazanç önerilenin çok altında kaldı. Hotpath
      B bölümünde vuruş içi iş ort 52 ms (dün 49 ms — gürültü
      bandında, dağılım aynı) görünümüyle yeniden ölçüm gerekir; katı
      commit çanı çıkarsa yeniden değerlendirilir.
- [ ] **8. (Uç senaryo ise) hedefli WASM mikro-çekirdek — KARAR:
      YAPILMAZ.** Son örneklemelerde sıcak kalıcı JS işlevi kalmadı:
      fırça damga (inkDrawTiltedStamp) saf boyama işidir (dab
      matematiği), ölçülemeyen tuval-ici motor çalışır; geri kalan
      sıcak örnekler senkron tuval işlemleridir (getImageData,
      toBlob, drawImage) — bunların örnekleyicide JS işlevi yoktur;
      WASM bu tuval işlemlerine erişemeden araya girer. Tam Rust
      geçişi de hayır: ölçümle gerekçe, sıcak yolda kalıcı darboğaz yok.


### Bulunmazsa dokunma (bilinçli karar listesi)

- Tam Rust geçişi → hayır (ölçümle gerekçe: sıcak yolda kalıcı JS
  darboğazı kalmadı).
- Her şeyi önbelleğe koymak → hayır (bellek şişer, koruma maliyeti artar).

## Yarın turunun çalıştırma sırası (hatırlatma)

1. `node scripts/build-app.js`  (her kaynak değişimi SONRASI zorunlu;
   `src/renderer/app.js` elle düzenlenmez)
2. `node tests/ink-hotpath-probe.js`  → A/B/C/D bölümlerini oku
3. `node tests/ink-undo-verify.js`    → TÜM KONTROLLER TAMAM beklenir
4. `node tests/ink-renaissance-probe.js` → canlı kare p50 (6 ms bandı)
5. `node tests/ink-framechip-parity.js`  → bölge içi/dışı EŞİT beklenir
6. `node tests/ink-drawimage-attrib.js`  → tam-yol çağrı sayısı karşılaştır
7. `node tests/smoothing-default-check.js` → TÜM FIRÇALAR %5 beklenir
8. `node scripts/run-gates.js --full` → 44/44
9. `npx.cmd electron-builder --win dir` (taze asar; gates ÖNCESİ) ve son
   adım `--win portable` + NSIS; exe'ler Desktop'a kopyalanır.

## Bilinen küçük notlar

- Sondalar (`ink-hotpath-probe`, `ink-renaissance-probe`,
  `ink-undo-verify`, `ink-doc-debug`, `ink-commit-queue-debug`,
  `ink-drawimage-attrib`, `ink-framechip-parity`,
  `smoothing-default-check`)
  `run-gates.js` zincirine KAYITLI DEĞİL; ayrı koşulur.
- Yumuşatma tercihi (09.11.2026): fırça seçimi artık yumuşatmayı daima
  %5'e getirir (`setActiveBrush`, `52-native-brush-library.js` ~1804;
  kütüphane ön ayarlarındaki %20-62 değerleri uygulanmaz). Gerekçe:
  yumuşatma One-Euro gecikme parametresidir; %50+ çizgiyi belirgin
  geciktirip el hissini yorucu kılıyordu, %5 anlık takip verir.
  Aracı kendine özgü değerleri korunur (silgi %35, parmak/erit %30,
  `30-ink-tools.js` — kullanıcı "her fırça" deyince fırça kütüphanesi
  kastedildi; süreç araçları davranışsal olarak farklıdır). Kullanıcının
  sürgüyle girdiği değer yine önceliklidir (diskte saklanır); yalnızca
  yeni fırça seçimi %5'e döndürür. Doğrulama:
  `tests/smoothing-default-check.js` (8 fırça → %5, sürgü "5").
- Kapı flake bulgusu (9-10 Kasım): uzun zincir ortamlarında
  `ink-commit-check.js` "basılı tutarken vuruş görünür" adımı tek
  örneklemeyle (350 ms) kareleme yarışına düşüyordu. Bisect: yalnız
  zincirde yeniden üretilir, tek koşumda yeşil. Kapı sağlamlaştırıldı:
  rAF başına yeniden ölçer (≤60 kare + 3 sn duvar-saati üst sınırı);
  kare gelmeden kırmızı
  yazmaz. Uygulamadaki gerçeğe dokunulmadı (commit zaten senkron).
- Prewarm kuyruğu 2,5 sn kısıtlamalı (throttle); ardışık fırça değişim
  testlerinde ikinci geçiş soğuk görünebilir — ölçüm yorumlarken dikkat.
- İlk açılışta "Kayıt modunu seç" penceresi sondalarda
  (localStorage `tailref-persistence`='auto' + `#pwContinue`) çözülür.
