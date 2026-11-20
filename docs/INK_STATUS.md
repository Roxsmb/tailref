# Çizim Sistemi - Durum Özeti (Nerede Kaldık)

> Sürüm 2.8 · 06.11.2026 · `tailref`
> **K20/K20b Tamam (0.A) · FAZ 8.A Observer Store Tamam (0.B) · FAZ 8.B panel
> aboneliği Tamam (0.B.1) · FAZ 8.C satır-diff Tamam (0.B.2) · FAZ 8.D
> dispose disiplini Tamam (0.B.3) · FAZ 8.E satır FLIP + FAZ 8.F klasör
> chevron katlanma Tamam (0.B.4) · prune remove-olayı (0.B.5) · undo/
> yinele restore'u store olaylarına bağlandı (0.B.6) · undo noktası
> yokluğu kapatıldı (0.B.7: add layer/duplicate/newGroup/addToGroup) ·
> K12 elle-giriş commit blur'a bağlılıktan kurtarıldı (0.B.8) —
> FAZ 8 (A-F) + 8.B ötelemesi TAMAM · sweep 103/103 IoU=1.0 ·
> zincir 33/33 (33 kapı, 06.11 ikinci onay) · options-bar 59/59 ·
> layer-store 43/43.**
> 06.11.2026 sonrası performans turları tamamlandı: Tur 1 (prewarm
> erteleme + undo after kırpması KEEP=10 + commit kuyruğu kanıtı),
> Tur 2 madde 5 (commit'te kirli-bölge: `frameChip` + bake bölgesi) ve
> küçültme önbelleği sikliği (kapasite katman sayısına uyarlandı) —
> canlı kare p50 6 ms/p95 7,6 ms, vuruş içi iş ort 49→11 ms, undo okuma
> vuruş başına tek dilim; zincir 44/44 yeşil (09.11, taze asar) ve
> masaüstü portable + NSIS exe güncel (16:31). Ayrıntı ve ölçümler:
> `docs/PERF-PLAN.md`.
> 09.11.2026 yumuşatma tercihi: fırça seçimi yumuşatmayı daima %5'e
> getirir (öncesi kütüphane ön ayarı %20-62). Doğrulama:
> `tests/smoothing-default-check.js` TÜM FIRÇALAR %5; zincir 44/44
> yeniden yeşil (09.11 ikinci sevk), masaüstü exe'ler güncel (19:06).
> 09.11.2026 Shift düz-çizgi kilidi (Photoshop tarzı): boyama sırasında
> Shift basılıyken ham nokta vuruşun İLK noktasına göre en yakın 45°
> yönüne kenetlenir (`inkStraightLockPoint`, 27-ink-core; editör yolu
> 36-ink-editor + tahta yolu 30-ink-tools iki taramada; seyreltme ilk
> noktayı koruduğu için kenetleme uzun vuruşta da bozulmaz). Doğrulama:
> `tests/ink-shift-lock-check.js` 4/4 (Shift'siz serbest kanıt + %0,00
> sapma + ekranda görünür). Zincir 44/44 (09.11 üçüncü sevk), masaüstü
> exe'ler güncel (19:24).
> 09.11.2026 UX yama topluluğu (dördüncü sevk): (1) sağ tık renk çarkı
> çift yönlü titremesi — `inkRadialWheelState` hex'ten her karede OKLCH
> geri türetimi yapmıyordu artık; çark öz-durum önbelleği (`wheelSt`/
> `wheelStHex`, 51-ink-radial) hex eşleştiği sürece aynı (h,s,v)
> döner, dış değişimde tek kez türetilir. (2) Kâğıt dışı tutuşta imleç
> halkası donması — beklemede vuruş dalı artık `ui.lastClient` yazıp
> imleç karesini ister (36-ink-editor ~3206); ışınlanma yok. (3)
> Delete/Backspace: seçim yokken aktif katmanı siler, son çizim
> katmanıysa içeriğini temizler (`inkDocDeleteOrClearLayer`, tek kapı,
> `pushUndo`'lu → Ctrl+Z geri alır); katman panelinde odak varsa panel
> işleyicisi sahiplenir (çifte silme yok), kilitli katmanda uyarı.
> (4) Tuval çevresi beyaz parlaması — bölgesel yollar (chip/frameChip)
> artık çerçeveyi YALNIZ kendi bölge dilimi içinde basar; ana çerçeve
> bloğu yalnız tam-yol karesinde çizilir (`fullPainted` bayrağı, 36-ink-
> editor) → alfa birikimi yok. (5) Aşırı hızlı vuruş kasması — karo
> zamanlayıcıdaki gerçek hata: `ui.tvRegion` HİÇ atanmıyordu; şimdi
> `inkEditorTileFrame` kirli bölgeyi (device px) atar, yaşayan karolar
> tam kutu yerine bölge kesişimi boyar. (6) Bırakış kasması — commit
> yakınsaması bütçeli oldu: kare başına ~8 karo (`tvBakeLeft` ile kareler
> arası devam, yapısal resetlerde bayrak sıfır), tam yakınsamada otomatik
> karo boyut kararı. (7) "Su üstünde çizgi" — bölgesel karosuz karanlık
> kaynaklarından biri davranışal bayatlıktı; `tvRegion` etkinleşince
> karo boyaması çip bölgesiyle 1:1 hizalandı — parite kanıtı:
> framechip-parity farkPiksel=0.
> Yeni kalıcı sonda: `tests/ink-ux-batch-check.js` (9 kontrol: kenar
> RGB sabitlik ×4 vuruş, bırakış uzun kare sayısı, hızlı vuruş p95 —
> boş taban karşılaştırmalı, Delete/Geri-Al imza çevrimi, katman
> silme/geri alma, çark önbellek kimliği). `ink-commit-check.js`
> ölçümü görünür kompozite (ana tuval + `[data-ink-tile-view]` örtü
> karoları) çevrildi — çip/karo yolu ana tuvali bayat bıraktığından ana
> tuval-tek-başına örnekleme yanlış kırmızı veriyordu (kapı 09.11
> zincirinde buna düştü; düzeltme sonrası 44/44). Zincir 44/44
> (09.11 dördüncü sevk, taze asar).
> **09.11 · C++ çizim motoru geçişi başladı (evre 1)**:
> mimari = Photoshop ayrımı (ağır raster çekirdeği C++ / arayüz
> Electron), 3D + referans katmanlarına dokunma yok. Ana süreçte
> N-API eklenti (`native/inkcore`): `inkNativeNoise` bit-biti port
> (Math.imul → uint32 çarpma, deterministik) + gürültü/sulu-boya
> uç üretimi (`noiseTipRgba`, `watercolorTipRgba`); N-API sarıcısı
> 3 işlev dışa açıyor (noise32/noiseTip/watercolorTip). Ana süreç
> ev sahibi `src/main/ink-engine-host.js` (kanallar
> `ink-engine:tip` / `ink-engine:status`) + preload köprüsü
> (`window.tailref.engineTip`) + 52'de asenkron warmed cache
> yapıştırıcısı (`inkEngineTipRequest`, vuruş ortasında canvas
> değişimi yok). Derleme `node scripts/build-native.js` (MSVC
> v143 + Windows 11 SDK 10.0 22000) → `inkcore.node` asar dışı
> yüklenir (asarUnpack `native/**`). Parite kapısı:
> `tests/ink-native-parity-check.js` (electron-alt betik deseni,
> FULL_EXTRA'ya eklendi). Profil kanıt: `createNoiseTip` 138 ms +
> GC 120 ms - bu çekirdek C++'a taşınınca JS omurgadan kalkar.
> SONUÇLAR (09.11, akşam): derleme yeşil (MSVC v143 + Windows
> 11 SDK 10.0.22000; node-gyp Electron 45 ABI karşı derleme).
> Parite: noise32 bit-biti; noiseTip kanal farkı ≤1 (toFixed kuantam
> payı); convertTip (suluboya) BIT-BITI (maxDiff=0, 32 dizi).
> Hız ölçümü (512px, ana süreç): gürültü uç kat=1,2 (V8 JIT saf
> tamsayı döngüde güçlü - dürüst bulgu), suluboya uç kat=2,1
> (sin/atan2 ağırlıklı; 26,5→12,6 ms). Önbellek sıkığından
> çıkarma: inkNativeTipCache 80→204, tint 48→110, stamp 96→160
> (varyant×kova alanı 105 kalem; aşanlar vuruş ortasında ucu
> yeniden üretimini zorluyordu). Hot-path probesu sonrası:
> createNoiseTip profil listesinden düşmüş; work ort 12 ms -
> kalan sıcaklık getImageData 667 (undo tutması+minyatürler; evre 4
> hedefi) ve drawImage 513 (Skia native). Entegrasyon kapısı:
> tests/ink-engine-host-check.js (kanal denetimleri + aralık
> doğrulamaları) yeşil; ux-batch 9/9, commit 7/7, radial 37/37
> (C++ uçları etkin, JS fallback dokunulmadan yedekte). TAM ZİNCİR:
> 47/47 kapı yeşil (09.11 akşam, taze asar; iki yeni kapı dahil -
> `ink-native-parity-check` + `ink-engine-host-check`).
> Aşağıdaki v2.1/v2.2/v2.3 içerik geçmiş olarak korunur; K16→K22 planı §0.2'de.

## PERF TURU · 09.11.2026 · kirli-bölge commit + önbellek sikliği (TAMAM)

`docs/PERF-PLAN.md`'in Tur 1-3 kanıtları sonucu:

| İş | Önce → Sonra | Kanıt |
|---|---|---|
| Commit bake tam clear+copy | vuruş başına 2 tam tuval işi → `inkEditorFullRasterRect` dilimi | framechip-parity: bölge içi/dışı EŞİT (3 koşum) |
| Sahne commit karesi tam yol | ~44 tam-tuval drawImage → bölgesel `inkEditorFrameChipPaint` | drawimage-attrib: vuruş bölümünde tam-yol ~0 |
| Küçültme önbelleği (LRU 16<20 katman sikliyor) | vuruş başına ~15-16 mini yeniden kurulum → 1 | drawimage-attrib + renaissance p95 177→7,6 ms |
| Hotpath B: vuruş içi iş | ort 49-52 ms → 11 ms · p50 16 · p95 27,6 | hotpath-final |
| Undo okuma | tek dilim (düzeltme Tur 0'dan); undo 33-47 ms gürültü bandı | ink-undo-verify TÜM KONTROLLER TAMAM |
| Kararlar | GC havuzu şartlı ertelendi (670 örnek, ikinci kademe); worker pişirme kazancı bölgesel bake sonrası küçüldü; WASM yapılmaz (sıcak nokta yok) | örnekleyici profili |

Yeni kalıcı sondalar: `tests/ink-drawimage-attrib.js` (drawImage atıf),
`tests/ink-framechip-parity.js` (bölge parite). Kapı zinciri 44/44
(09.11.2026, taze asar), masaüstü exe'ler güncel.

## 0.A · K20/K20b · canlı=commit + sönme fixi (06.11.2026 — TAMAM)

**Köko nedenler (ölçümle kesinleşti):**
1. *Modal canlı boş*: artımlı önizleme daima `inkDabSink2d` sarmalayıcısına
   yazıyordu; sarmalayıcı `getTransform` taşımadığından K15 çift-tampon yolu
   canlıda ASLA devreye girmiyordu → akış/doku fırçalarında (su/aerografi/
   kömür) alfa ≈ 0.02'ye seyrelip GÖRÜNMEZ oluyordu; bırakınca dual tam
   raster binip "başka şekil" beliriordu. Kullanıcının ekran kaydındaki
   imza birebir yeniden üretildi (`2 videodaki imza`).
2. *Sönme (K20 ilk bake hedefi)*: bake `scratch(=katman kopyası) ×
   stroke.opacity` çarptığından önceki çizimler her commit'te sönüyordu.

**Yama mimarisi (referans modeli):**
- `28-ink-brush.js` — `dualDirect`: artımlı çağrı dablarını dual ağırlıkla
  (n-root seyreltme yok) çağıranın düzenlediği BİRİKİMİ raster'a yazar;
  `opts.__dualDirect` geri-bildirim kanalı ekli; birleşim bloğu dualDirect'ten
  muaf (`if (dctx && !dualDirect)`).
- `36-ink-editor.js` — K20b ağırlık kanalı: `inkEditorEnsureDual`
  (şeffaf birikim tuvali `dualWts`, taban katmanına DOKUNULMAZ) +
  `inkEditorDualComposite` (görüntü/bake = taban ⊕ (ağırlık × opaklık),
  taban her çağrıda canlı layerCanvas'tan tazelenir). Canlı görüntü ve
  finalize bake AYNI kompozit formülünü kullanır → kullanıcının gördüğü
  birebir commit; taban orijinal alfasını korur, sönme yapısal olarak
  imkansız.
3. *(06.11.2026 üçüncü kök, düzeltildi)* — *Bayat taban baskısı*: ilk K20b
   taslağı kompozit tabanını önbelleğe alıyordu; sonraki undo/commit
   döngülerinde bayat kopya, commit'in tam katman baskısı
   (`clearRect` + `drawImage`) ile birleşince "önceki çizgiler yavaş
   yavaş yok oluyor" şampiyonunu yeniden üretiyordu. Önbellek kaldırıldı
   (`EnsureDualPreview`/`dualBase` ölü kod olarak silindi; `EnsureDualWts`
   `EnsureDual` ile birleşti) — kompozit tabanı her rebuild'de canlı
   katmandan tazeleniyor.
- Vuruş başlangıç/commit/maske/iptal/undo temizlikleri (dualWts/dualComp).

**Ölçümler (06.11.2026 K20b bitiş turları):**
| Kanal | Sonuç |
|---|---|
| `live-parity-probe.js` (5 fırça: stüdyo/suluboya/aerografi/kömür/kreitel) | canlı görünür, canlı/commit 0.92–0.95 · **final/commit 1.00** · chalk-hard 2.55 anomalisi #3 (bayat taban) düzeltmesiyle kayboldu |
| `ink-commit-check.js` | **7/7** · canlı önizleme == commit raster, 0 farklı kanal |
| `ink-smoke.js` | **233/233** TÜM GEÇTİ |
| `canvas-editor-test.js` | **60/60** (not: 56→60 büyüdü; test akışı ÖNCE `build-canvas-editor.js` istiyor — bayat bundle 14 sahte FAIL üretti) |
| `stroke-vanish-probe.js` | KAYBOLMA: yok · dönüşüm zinciri tek tur · worker apply 0 discard 0 |
| `commit-fade-probe.js` (4 vuruş düşük opaklık) | her commit alfa toplamı artıyor — **sönme yok** |
| `brush-parity-sweep.js` | **103/103 TÜM FIRÇALAR PARİTEDE** (IoU=1.0; eski 59 başarısız → 0) |


## 0.B · FAZ 8.A · Observer Store (inkLayerStore) (06.11.2026 — TAMAM)

`50-layer-stack.js` mutasyon fonksiyonlarına pub/sub çekirdeği eklendi:
`inkLayerStore` (subs: Map) + `inkLayerStoreOn/Off/Emit`. Amaç: panel ve
gelecek aboneler "sync çağrısı unutuldu" sınıfı hataların kökünü kapatmak
— mutasyon artık OLAY yayıyor, elle `inkSyncLayersPanel` çağrısı
(8.B'de kaldırılacak) tekel olmaktan çıkıyor.

- **Olay türleri:** `add · remove · reorder · rename · property · mask · select`
  ({layerId, ownerId, …} payload; örn. mergeDown = remove+property,
  flatten = remove(entry)+add(replacement), addMask/removeMask/toggleEdit
  = mask, inkDocSelectLayer = select).
- **Sessiz try YOK** (kural gereği): abone hatası duyulmazsa yutan
  try/catch konulmadı; emit sıralı, subscribe sırasıyla koşar.
- **no-op = 0 olay:** aynı isim/aynı görünürlük/aynı opaklık atamaları
  ve zaten temiz katmanda clear → hiç olay yayılmaz (abone boşa koşmaz).
- **Reddedilen mutasyon = 0 olay:** örn. "karışık komşulukta flatten"
  reddi olay üretmez — olay yalnızca gerçekleşen değişim içindir.
- **20 anchor** — 15 mutasyon fonksiyonunun tamamı kaplı.
- **Sweep paritesi ucunun takvimi:** 0.B ölçümünden bağımsız —
  K20b sweep'i 103/103 IoU=1.0 (TÜM fırçalar; canlı==commit piksel
  sayışı birebir; eski 59 → 0). Ölçüm eşiği calıbı: alfa>8 + tam-yol
  yakalama (`brush-parity-sweep.js`).

**Kanal:** `scripts/layer-store-test.js` (yeni; Elektron+CDP,
port 9399/5261) — **23/23 yeşil**; `run-gates.js --full` zincirine
kalıcı kapı olarak eklendi (commit-fade-probe'dan sonra).

**Sıradaki FAZ 8 madde:** 8.B — `inkSyncLayersPanel` abonelikle
beslenir, onlarca elle sync çağrısı kaldırılır (regression:
layer-canon + options-bar kanalları).

### 0.B.1 · FAZ 8.B (kısmi — 06.11.2026, 50-layer-stack core endi)

- `inkLayerPanelStoreSubscribe()` (50-layer-stack.js, bir kez bağlanır):
  7 olay türü → `inkSyncLayersPanel()`; `inkLayerPanelEnhance`
  bootstrap'ında kurulur.
- Elle panel çağrıları kaldırıldı: `inkDocSelectLayer`,
  `inkDocAfterChange` (çağıranı olay yaydığından panel'siz), maske
  funnel + `inkDocToggleMaskEdit`, rename/setVisible/hideAll/
  resetOpacity. Satır sayısı: 50-layer-stack.js'de panel call 9 → 1
  (yalnız Escape curtain'ı).
- `inkMaskCommitStrokeFor` mask funnel'e bağlandı (duplicated
  dirty/rerender/gen bloğu silindi; 'mask' olayı artık maske vuruşunu
  da kapsıyor).
- `inkLayerPropsApply` artık mutasyon: eski alanlar yakalanır,
  `property` (changed: opacity/blend/clip/alphaLock/locked) + ad
  değiştiyse ek 'rename' yayınlar.
- **Kanal:** `layer-store-test.js` **25/25** (panel abonelik denetimi
  eklendi: add sonrası satır sayısı == yığın; rename sonrası satır
  metni olayla güncellendi).

### 0.B.2 · FAZ 8.B düzeltmesi + FAZ 8.C satır-düzeyi diff (06.11.2026 — TAMAM)

**Ölçümle yakalanan iki regresyon ve kökleri:**
1. **K3 çift undo kaydı** (layer-canon 22/23): `inkLayerPropsApply`
   içinde mutasyon bloğu + `pushUndo` İKİ kez duruyordu (8.B edit'i
   gündüz koşusunda çift blok bırakmıştı). İkinci kayıt zaten
   uygulanmış durumu snapshots → `undo()` pop edip aynı hali geri
   koyuyor ("geri alınmadı" görüntüsü). Düzeltme: tek `pushUndo`,
   mutasyondan ÖNCE; `old` yakalama da öncesine alındı → **23/23**.
2. **inkAddGroupMember stack çoğaltma** (FAZ 1'den kalma GİZLİ bug;
   store testinin 8.C senaryoları denetimine yakaladı): mevcut katman
   gruba eklenirken eski konumundan ÇIKARILMADAN tekrar splice
   ediliyordu → aynı katman `ink.layers` içinde 2-3 referans
   (iz: panel satırlarında birebir aynı layerId). Düzeltme
   (`27-ink-core.js`): mevcut katman önce `indexOf+splice` ile
   çıkarılır, sonra klasörün hemen altına tek referansla oturur.
   Ölçüm: 14 adımlık op dizisinde her adımda `n == uniqN`
   (önceden 2 katman çoğalıyordu); compositor **24/24** ile klasör
   piksel yolları bozulmadığı teyit edildi.

**FAZ 8.C — satır-düzeyi diff v1 (`31-ink-ui.js inkSyncLayersPanel`):**
- `inkLayerRowSig(layer, active)` satır imzası: active/visible/locked/
  kind/parentId/clip/alphaLock/mask/editing/name/opacity/thumbSig/members.
- diffable koşulu: liste çocuklarıyla birebir id eşleşmesi
  (id tekrarı dahil korunur — tekrar varsa tam kurulum).
  Eşleşiyorsa: imzası değişen satır `replaceWith(fresh)`, DOĞRU sıra
  `appendChild` ile; imza aynı satırlar DOM düğümü olarak korunur
  (seçim geçişi artık tüm listeyi yeniden kurmuyor).
- yapısı değişim (add/remove) → tam kurulum; is-new flash yalnız
  rebuild yolunda; empty-state yalnız rebuild; thumb cache GC her
  iki yolda.

**Kanal:** `layer-store-test.js` **28/28** — 8.C senaryoları:
- imza-same passthrough: mark'lı 5 satırın HEPSİ korunur (kept=5/5).
- select op: yalnız 2 satır taze (önce aktif + yeni aktif), kept=3.
- newGroup: yapısal → tam kurulum, marks cleared.
`layer-canon-test.js` **23/23** (K3 çift-undo düzeltmesi dahil).

### 0.B.3 · FAZ 8.D — dispose(layerId) yaşam-sonu disiplini (06.11.2026 — TAMAM)

**Kök ölçüm (8.D öncesi sızıntı sınıfı):** `inkMaskRasterCache` (29-ink-render:180)
ve `inkBakedRasterCache` (29-ink-render:131) **hiçbir yerde delete almıyordu** —
silinen/birleştirilen/düzleştirilen katmanın katman-id'li raster çözümü bellekte
kalıyordu; `inkCompositeRuntime.gen` ölü id için bile yeniden yazılabiliyordu.

**Tek nokta:** `inkLayerDispose(layerId)` (`50-layer-stack`, emit zarfının
yanında): `itemCanvases` (canvas.remove dahil) + `tiles` + `dirtyLayers` /
`dirty.layers` + `inkMaskRasterCache` + `inkBakedRasterCache` +
`inkLayerThumbRelease` (thumb+bbox) + `inkWorkerReleaseLayer` +
`inkCompositeRuntime.gen/groups` + `inkDirty.layers` — hepsi typeof-guard'lı,
sessiz try YOK.

**Bağlı kaldırma noktaları:**
- `inkDocDropLayerDom` → dispose'a devredildi (mergeDown kaynak + flatten
  üye/grup zaten bu yardımcıyı kullanıyordu).
- `inkDocDeleteLayer` → splice öncesi `inkLayerDispose(target.id)`.
- `27-ink-core inkHandleItemsRemoved` + `inkApplyRestoreDiff` → inline loop'lar
  dispose'a devredildi (undo geri dönüşümü aynı disiplinle temizler).
- `35-ink-worker` zincir finişinde katman yığından çıkmışsa dispose (+
  `inkWorkerReleaseLayer` durum_setleri).
- flatten ölü-id gen girişi yaratan `inkBumpLayerGen(group.id)` (splice
  sonrası) kaldırıldı — dispose grup önbelleğini zaten bırakır.

**Ölçümle yakalanan ÜÇÜNCÜ bug (üye-taşıma dize sıçraması):**
`inkAddGroupMember`'un MEVCUT katman taşima yolu: çıkarma sonrası stack
yeniden hesaplanınca `gi=0` düşüyor, katman dizede grubun ÜSTÜNE giriyordu
(`[GRUP, üye]`) → `inkAttachedDisplayPlan` grup girişi `members:[]` kalıyor,
`inkDocFlattenGroup` "karışık" red veriyordu. Düzeltme: insert noktası
grubun dize dizini (üye bloğu tamamı grubu izler). Kanıt: plan
`[{base:GRUP, members:[üye]}]` + flatten `done:true`.

**Kanal:** `layer-dispose-test.js` (port 9392/5263) **17/17** — maske
sızıntı kanıtı (addMask +1 → delete → 0), baked sızıntı kanıtı (mergeDown
+1 → delete → 0), flatten ölü-id süpürme (gen+groups dahil), 8×
duplicate+delete döngüsünde dokuz coğrafyada boyut sabitliği, sayfa hatası
sıfır. Regresyon: store **28/28**, layer-canon **23/23**, compositor **24/24**.

### 0.B.4 · FAZ 8.E satır FLIP + FAZ 8.F klasör chevron katlanma (06.11.2026 — TAMAM)

**FAZ 8.E — DnD/sıra FLIP ("tak" → kayma):**
- `inkLayerRowsFirst` (DOM güncellemesi ÖNCESİ her satırın top'u) +
  `inkLayerRowsFlipPlay` (SONRASI `Invert`→`Play`) — `inkSyncLayersPanel`
  sırasında imza-diff (8.C) ile tam uyum: appendChild taşımalarında
  satırlar 170ms `cubic-bezier(.2,.7,.3,1)` ile kayar.
- Yapısal değişimde (satır sayısı değişti) animasyon **yok** — sıçrama
  yalnız sıra değişiminde kaymaya döner.
- WAAPI `el.animate` → `anim.finished.catch` (Animation thenable YOK;
  ilk koşum bunu yakaladı). `prefers-reduced-motion` kısayolu: anim
  kapalı. Kaldırılan satırda AbortError beklenen, öbür hata duyulur.

**FAZ 8.F — klasör chevron katlanma:**
- `inkLayerFold` düğmesi (klasör satırında, ≥1 üye varsa): ARIA
  `aria-expanded` + is-folded sınıfı; chevron CSS rotasyonu (draw-v5.css).
- `inkFolderFoldedIds` Set — **panel-düzeyi**: motor/normalizeState
  dokunulmaz, store OLAY AKIŞI dokunulmaz (ölçüm: katlanırken 0 olay);
  katlanınca üye satırları `inkSyncLayersPanel` filtresiyle listeden
  düşer, açınca döner; klasör silinince ölü id GC.
- Katlanırken eklenen yeni üye de gizli kalır; açınca görünür.

**Kanal:** `layer-flip-fold-test.js` (port 9393/5264) **14/14** —
reorder'da ≥2 satır WAAPI-animli + tek `reorder` olayı, bitişte kalıntı
transform yok, add'de anim yok (is-new CSS flash'ı sayıcıdan ayıklanır);
katlanma: üyeler gizlenir/aria, motor dizisi + olay akışı sabit, katlanır
üye-ekleme gizli kalır, aç-üç-üye, katlanmış-klasör-sil; sayfa hatası
sıfır. Regresyon: store **28/28**, layer-canon **23/23**, dispose **17/17**,
compositor **24/24**.

### 0.B.5 · FAZ 8 ötelemesi: prune remove-olayı (06.11.2026 — TAMAM)

**8.B'den kalan öteleme çözüldü:** `inkPruneOrphanLayers` (27-ink-core)
öksüz katmanları **olaysız** siliyordu — çöp temizliği (12/13-tras)
katmanı motor gözünden sönük kaldırıyordu. Yeni akış: kaldırılan her
öksüz `inkLayerDispose` ile önbelleklerinden bırakılır ve TEK 'remove'
olayıyla duyulur (`reason:'prune'`); abone paneli olayla tazeler —
`12-trash-images` + `13-trash-panel` içindeki elle
`inkSyncLayersPanel` çağrıları kaldırıldı.

**Kalan kayıt:** `34-ink-undo` restore sonrası panele hâlâ elle sync
koyuyor — undo diff'i 'restore' olay tipi tasarımı gerektirir (thumb/
vuruş değişiminin imza-diff'ine bağlanmalı); sonraki faz adayı olarak
dokümante edildi. LINlerdeki select/gizmo görsel sync'leri katman Liste
etkinliği değildir — ayrı kalmaları bilinçlidir.

**Regresyon kanıtı:** projects **39/39** (çöp GC yolu), store **28/28**,
flip-fold **14/14**, dispose **17/17**.

### 0.B.6 · FAZ 8.B ötelemesi: undo/yinele restore'u store olaylarına bağlandı (06.11.2026 — TAMAM)

**Elle panel sync'in son kaydı kalktı.** Undo'nun iki yolu artık olay
yayar, elle `inkSyncLayersPanel` çağrısı yok:

1. **Bütün-durum undo** (04-persistence `undo/redo` → `inkAfterRestore`):
   yeni `inkLayerStoreEmitRestoreDiff(prev, next)` (50-layer-stack)
   önceki/sonraki `state.ink` anlık görüntülerini satır görünüm
   alanında karşılaştırır ve SADECE değişen şeye olay yazar:
   `inkRestoreRowParts` üç parça döner — `pos` (üstten-ilk konum),
   `name`, `body` (görünürlük/opaklık/maske/klip/kilit/parentId/kind +
   vuruş sayısı + üye sayısı). Yok olan → `remove(reason:'restore')`,
   yeni → `add`, isim → `rename`, konum → `reorder` (yalnız konum),
   gövde → `property(field:'restore')`, aktif değiştiyse TEK `select`.
   Artımlı yol `inkApplyRestoreDiff` sonunda, tam-yol (önbellek
   kayıp) `inkRebuildAll` sonrası yayılır.
2. **Vuruş-delta undo** (`34-ink-undo inkApplyStrokeEntry`): TEK
   `property(field:'raster')` — vuruş sayısı + boyama epoch'u değiştiği
   için 8.C imza-diff satırı taze kurar, minyatür güncellenir.
   Sonraki satırda kalan elle panel çağrısı silindi.

**Ölçümle bulunan iki gerçek:** (1) `inkDocAddLayer` +
`inkDocNewGroup` pushUndo noktası ÜRETMEZ — Ctrl+Z bu işlemlerden
sonra daha eski kayda iner; restore-diff bunu
`remove(reason:'restore')` + satır reorder'larıyla DÜRÜST bildirir
(hata diff'te değil; undo noktası politikasının rafı — sonraki iş:
daha fazla işleme kayıt noktası eklemek). (2) Emit sırası:
remove'lar → add/rename/property/reorder → select.

**Yeni kanal ölçümleri (layer-store-test 28→35):** görünürlük
undo → `["property"]`, redo → `["property"]`; isim undo →
`["rename"]` + panel satır metni abonelikten döner; konum undo →
`["reorder","reorder"]` (hareketlenen + komşu; property YOK);
vuruş-delta undo → `["property"]` tek olay. Değişmeyen satır 0
olay (pozisyon-gövde ayrımı: yalnız konum değişimi ayrıca property
üretmez).

**Regresyon kanıtı:** store **35/35**, layer-canon **23/23**, symmetry
**16/16**, select **11/11**, outside **11/11**, shortcut **17/17**,
flip-fold **14/14**, dispose **17/17**.

### 0.B.7 · FAZ 8.B ötelemesi: undo noktası yokluğu kapatıldı (06.11.2026 — TAMAM)

**0.B.6 ölçümünde bulunan gerçek #1 çözüldü:** dört mutasyon undo
noktası ÜRETMEYİYORDU — Ctrl+Z işlemi değil, ondan ÖNCEKİ kayda
inip beklenmedik sessiz geri alımlar yapıyordu:

1. `inkDocAddLayer` (global + attached iki dalde, mutasyon öncesi
   pushUndo eklendi)
2. `inkDocDuplicateLayer`
3. `inkDocNewGroup` (push `inkCreateGroup` çağrısından ÖNCE
   NewGroup'a — `inkCreateGroup` saf kaldı, diğer çağırıcı yok)
4. `inkDocAddToGroup` (üye taşıma)

Undo noktası üretilmeyen diğer adaylar bilinçli bırakıldı:
`inkDocToggleMaskEdit` (veri değil düzenleme modu; addMask/removeMask
zaten push'lu), `inkDocDropLayerDom`/`inkDocApplyOrder` (sıralama
yolları `inkDocMoveLayer`/`inkDocReorderLayer` üzerinden push'luydu).

**Yeni kanal ölçümleri (layer-store-test 35→43):** katman ekle →
Ctrl+Z = TEK `remove(reason:'restore')` + panel satırı abonelikten
düşer (rows=6/6) + redo `add` ile döner (remove yok); klasör
oluşturma/geri al ve çoğaltma/geri al = aynı TEK remove sözleşmesi.
Not: `redo` olay sırasında `reorder`'ler `add`'den önce gelebilir
— emit dizisi restore-dizinin array sırasını izler (alt katmanların
splice kayması); panel için her durumda doğru sonuç, sözleşme
"add mevcut + remove yok" olarak ölçülür.

**Regresyon kanıtı:** store **43/43**, layer-canon **23/23** (menü Yeni
katman undo noktası ile), symmetry **16/16**, select **11/11**,
compositor **24/24**.

### 0.B.8 · zincir turu: K12 elle giriş commit'i blur'dan kurtarıldı (06.11.2026 — TAMAM)

Zincir options-bar kapısı kırmızıydı: K12 "elle girilen değer
çıktıya yansır" out="". Ölçüm (kayıt probe: textContent setter +
MutationObserver + node kimliği) fail imzasını ayırt etti:
`state:64` yanılıyordu (K9 artığı), **blur olayı hiç gelmiyordu** —
pencere OS odağını kaybettiğinde (`pageFocused:false`),
Chromium odak üst-adımlarını ertelediğinden `editor.blur()`
etkinlik üretmiyor, tek commit yolu (blur dinleyicisi) çalışmıyor,
input `out`'ta kalıyordu. Zincir artefaktı DEĞİL: gerçek kullanıcı
yolunda da (alt-tab, ikinci pencere odağı) yazım sessizce
kaybolabiliyordu.

**Düzeltme:** `draw-v5.js openTypeEditor` — Enter/Esc artık doğrudan
tek çıkar fonksiyonu `finalize(cancelled)`'ı çağırır (blur'a
güvenmez); `finalized` guard ile idempotent; blur yine destek yolu
(dataset.cancel sözleşmesi korunur).

**Kanıt:** güç-altı koşum — düzeltme ÖNCE 8 koşumda 2 fail (fail
imzası zincirle birebir), SONRA 5/5 yeşil; 1/3/5. koşumlarda
`pageFocused:false` koşulunda da `finalize` stack'iyle commit
(`edGone:true`, out="64 px"). options-bar **59/59**, power-sliders
**21/21**; geçici probe dosyaları söküldü.


## 0. K15 · Çift-Tampon Vuruş Bileşimi (05.11.2026 — TAMAM)

PS kuralı: "opaklık bir vuruşta birikmez" — damlalar vuruş-scratch'e **tam boyut
ağırlığıyla** (opacity HARİÇ) birikir ve scratch hedefe **tek geçişte**
`stroke.opacity` ile kompositlenir. n-root seyreltme (K14 geçici çözümü)
commit/canlı/worker hattından kaldırıldı (ölü kod kalmaz).

| Bileşen | Durum | Konum |
|---|---|---|
| K15.1-3 · commit çift-tampon | ✓ | `28-ink-brush.js inkDrawStrokeOnContext` (bbox+dualPad scratch, dctx damla yolları, tek-geçiş kompozit; lockAlpha → source-atop) |
| K15.4 · canlı overlay paritesi | ✓ | `30-ink-tools.js inkDrawLiveDab` (tam ağırlık damla; element style.opacity=stroke.opacity) + `inkClearLive` opacity reseti |
| K15.5 · worker paritesi | ✓ | `ink-worker.js drawStroke` (OffscreenCanvas scratch + tek kompozit) — worker önceden seyreltmesiz birikimliydi (ek sapma), kapatıldı |
| K15.6 · GPU sink | ⏳ | `40-ink-dab-gl.js` FBO içinde base gömülü → kökten yeniden tasarım (ayrı commit) |
| K15.7 · silgi dokunulmadı | ✓ | birikimli destination-out (PS uyumlu); artımlı önizleme (skipDabs>0) ve sahte sink'ler (inkDabSink2d/GL) eski yolda |
| K15.8 · yedek düşüş | ✓ | scratch kurulamazsa eski yola otomatik dönüş |

Ölçüm: `opacity-size-probe.js` 5/5 — iç dolgu **11.8% → 8.2%** (hedef %8±2).
`ink-commit-check.js`: canlı önizleme == bırak-anı raster, **0 farklı kanal**.

## 0.1 · K15 sırasında tespit edilen ek hatalar (düzeltildi)

- **Liquify sertlik widget'ı eksik**: motor `stroke.hardness` okuyordu, vuruş
  `ink.hardness` taşıyordu ama şemada widget yok → `58-ink-tool-manifest.js`
  liquify listesine **Sertlik** eklendi (`liquify-test.js` 14/14).
- **desktop-smoke karşılama diyaloğu çakışması**: boş profilde `init()` sonrası
  açılan `#persistenceWelcome` (z 3400, tam ekran) CDP mouse hit-test'lerini
  kaçırıyordu → smoke artık diyalogu bekleyip güvenli varsayılanla (auto)
  kapatıyor (`scripts/desktop-smoke.js` 20/20).

## 0.2 · Sıradaki bloklar

K16 yay-uzunluğu damla emisyonu · K17 centripetal spline · K18 sigmoid basınç ·
K19 damla düzeyi doğrusal karışım (+ worker lockAlpha boşluğu) ·
~~K20 PS-parite test geliştirmeleri~~ (**0.A — tamam**) ·
K20-candidate tek-damla kanalı testi `opacity-size-probe.js` (sweep'in eували
yakalamasıyla kıyas) · K22 fırça kütüphanesi UI'larına motor paritesi aksiyonu
(31/52 önizlemeleri K15 ile otomatik pariteye geçti; kullanıcı-talepli özel
doğrulama sonrası).

### K16.1 durum (05.11.2026)
- Tek `inkForEachDab` yay-uzunluğu modeli uygulandı (28 + worker birebir),
  `continuousSpacing` dalı silindi; smudge/liquify aynı modele geçti.
- **K16.d tap muafiyeti** eklendi (28/worker birebir): dejenere vuruşlarda
  (tüm segmentler < 1px) taper bölgeleri sıfırlanır — PS'te tek tıklama tam
  boyut damga bırakır; smoke'ın "eğim damgayı yassılaştırdı" kontrolü bunu
  bekliyordu. Muafiyet dizinin kendisine bakar: commit ve canlı önizleme
  aynı karar (K15 canlı==commit paritesi korunur).
- **Tilt 2×2 + board hattı (06.11.2026) TAMAM**: K16.d'in kök nedeni
  `tapLike = points.length <= 1` başlangıcıydı — tek tıklama p0≈p1 İKİ nokta
  üretiyor, başlangıç yanlış kalıp muafiyet devre dışı kalınca taper k=0 →
  yarıçap 0.35 px board hattında 2×2 piksel. Başlangıç `tapLike = true`
  (segment ≥1px görülünce kesilir) → board hattı 138×86 (painted 9372),
  tilt probe A/B/C üç koşum yeşil.
- **Geçici enstrumentasyon temizlendi** (06.11.2026): `__inkForEachDabTapLog`
  (28 + worker birebir) ve main dab loop `__debug` hook'u kaldırıldı
  ("ölü kod kalmaz"); `tilt-probe.js` aynı opt-in yüzeyi kullanmaya devam
  eder (hook yokken alanlar boş döner, probe çalışır).

### 0.2c · run-gates --full TAM YEŞİL (06.11.2026)
28/28 kapı yeşil (exit=0). Zincir-bazlı flaky kökleri: (1) verify-package
asar önceliği dist_studio2→dist_studio çevrildi (config uild.directories.output
= dist_studio); (2) welcome diyaloğu yarışı — layer-canon/shortcut testlerine
24×400ms görünürlük bekleyen döngü + boot unknown için 3 denemeli
modeDrawBtn retrisi; (3) arrange-test tek-satır toleransı — geniş ekranda
tüm öğeler tek satıra sığıyor, vGaps boş MEŞRU (Gaps.length===0 || vBad.length===0
guard, detayda satır sayısı). Zincir tam yeşil + verify-package PAKET GÜNCEL.

### 0.2b · Smoke zinciri sağlığı (06.11.2026)
`scripts/ink-smoke.js` 233/233 tam yeşil (exit 0). Dört bağımsız kök neden
bulundu ve düzeltildi:
1. **Bulk doküman birim hatası (ana kilit kökü)**: restore P1 testindeki
   3000 vuruş `size: 5` doküman birimi → `sizePx = 4000 px` damga;
   tek vuruş ~120 ms × 3000 ≈ 6 dakika senkron rebuild → renderer %100 CPU
   + RAM 1.65 GB + "yanıt vermiyor" ve eval timeout'ları. Ölçümle kanıtlandı
   (restoreD1t tek-vuruş ölçümü), sonra temizlendi. Düzeltme: `size: 0.00625`
   (doküman birimi, ≈5 px niyeti korunur).
2. **Eski örnek Portu tuzağı**: sabit CDP port (9334); önceki timeout'lu
   koşumun electron'u yaşıyorsa yeni spawn sessizce o eski renderer'a
   bağlanıyor → farklı koşumlarda aynı katman id'leri, tutarsız fail'ler.
   `killStaleSmokeApp()` başlangıçta portu denetleyip eski örnekleri öldürür.
3. **Alt damlalık (eyedropper) kontrolü**: eval kendi çizdiği rengi
   örneklendiği için `colorChanged` yapısal olarak yanlıştı; örneklemeden
   önce farklı renk (`#7c4dff`) ayarlanır.
4. **5f dönüştürme araç tıklaması** (ara sıra değil, tutarlı kırmızı çıktı):
   eval öğe merkezine tıkliyordu; üst düzlem katmanına önceki bölümün
   vuruşu oradaydı → `inkStrokeHit` ink-vuruş seçimini yiyor (davranış
   doğru mu? Ama doğru davranış: transform aracında aktif katman vuruşu
   altında tık = ink seçimi; boş noktada tahta seçimi). Eval artık öğe
   içinde ink-vuruşun bulunmadığı nokta tıklatıyor.
- Ayrıca restore bölümü eval'leri yarıçıkışlara bölündü (prep/arama/A2/A3/
  B/C/D1/D1r/D2/D3): bir adım kilitlenirse yerine gelir; 120 sn gerçek
  deadline kullanılıyor (evaluate üçüncü parametresi artık işliyor).

### 0.3 · Canvas editör (`src/canvas-editor`) denetim pası — yapılacaklar
Öteki model denetimi kodla doğrulandı; işe yarayan kalemler uygulandı
(05.11.2026 · build ✓ · `canvas-editor-test` 56/56 ✓ üç koşum):
- [x] `layers.ts cssBlend()`: bilinmeyen blend modunda `console.warn`
  (kalem 4) — TAMAM.
- [x] `layers.ts remove()/dispose()`: display canvas bitmap'ı da sıfırlanır
  (`canvasRef.width/height = 0`; backing zaten sıfırlanıyordu). `ctx`
  null'a çekilmedi: TS tip sözleşmesi; katman nesnesi dizi dışında
  kimsede referanssız, GC topluyor (kalem 2) — TAMAM.
- [x] `layers.ts load()`: katmanlar oluşturulma sırasında (z-sırası),
  görseller `Promise.all` ile paralel boyanır (ilk 2. tur) — TAMAM.
- [x] `editor.ts scheduleResize()`: ResizeObserver + window resize rAF
  ile karede tek resize (ilk 2. tur "debounce") — TAMAM.
- [x] `layers.ts flatten()`: çıkış bağlamı `colorSpace: 'srgb'` sabit
  (ilk 2. tur "renk uzayı") — TAMAM.
- [x] 3. tur · DPR dalgalanması: `editor.ts resize()` erken çıkışı artık
  ham dpr değişimini de ölçer (`rawDpr`), `matchMedia('(resolution:Ndppx)')`
  dinleyici monitör değişiminde `scheduleResize` planlar; `dispose()`
  dinleyiciyi temizler — TAMAM (build ✓, 56/56 ✓).
- [ ] Ölçüm şartı: `renderAll` "dirty layer" önerisi kamera değişiminde
  geometrik olarak sağlanamıyor (her katman yeniden çizilir, "CSS scale
  yoktur" tasarım kararı); `hidden` atlaması zaten var. Ölçüm
  (`overload-test` tarzı) olmadan dokunma (kalem 1) → ölçüm kalemi ayrıca:
  [ ] 20+ katman × 4k backing pan/zoom kare süresini ölç.
- **Reddedildi** (eylem yok): remove'da "bellek sızıntısı" iddiası
  (backingCtx null — TS tip sözleşmesi + referanssız obje GC);
  "LayerUIController" SRP ayrımı (`renderList` zaten UI'sız stub,
  liste editor.ts'te — churn > kazanım); "kamera fırça boyutunu
  bozuyor" (brush.ts doc-uzayına boyar, `camera.scale` yalnız
  imleç önizlemede — doğru davranış); "render döngüsü rAF dışında"
  (`requestRender` zaten rAF'i var, editor.ts:361).

### 0.4 · 3. tur "profesyonel araç" önerileri — yapılacaklar (doğrulanmadı)
Öteki modelin üç büyük önerisi; kodla doğrulanmadan uygulanmaz:
- [ ] **Undo tile-based region snapshot** (bellek): Sistem ZATEN var
  (`history.ts takeSnapshot` — boyuta göre ImageData/PNG seçimi, byte
  bütçeli `History` yığını) ve vuruşlar zaten stroke başına kaydediliyor
  (editor.ts:682/870 — "her darbe bir adım" endişesi yersiz). Gerçek
  kalem yalnızca: snapshot'ın tüm katman yerine **değişen bölgeyi**
  (dirty rect/tile) kaydetmesi — büyük 4k katmanlarda undo belleğini
  düşürür. Önce ölçüm: `snapshotBytes` güncel ortalama ne, yığın
  byte bütçesi ne tutuyor; sonra uygula.
- [ ] **Non-destructive ayar katmanları** (`effects: Filter[]`):
  opacity/blendMode zaten yıkıcı değil (render'da uygulanıyor); öneri
  bunu blur/brightness/saturation filtre zincirine genişletmek. İş
  kalemi: `Layer` tipine alan, `flatten`/`render` zincirine çizim
  öncesi-dönüşümü, undo etkileşimi (filtre değişimi ayrı mı adım mı),
  kalıcılık (payload'da effects seri hâli). Parite kaygısı: tahta
  tarafındaki ink motoru filtre desteklemiyor — iki motor arasında
  görüntü farkı doğar; karar: canvas-editor'a özel mi, yoksa
  K19/K20'de ortak mı taşınır?
- [ ] **Fırça izi yumuşatma + hız-uyarlamalı boşluk kapatma**: tahta
  motorunda ZATEN planlı (K17 centripetal spline, K18 sigmoid basınç;
  K16 spacing zaten yay-uzunluklu — yüksek hız fikri bir kere
  gerekmiyor). Canvas-editor TS fırçası için aynı iki kalem
  parite hedefiyle işlenecek (K17/K18 sıraya girince TS tarafına
  da uygulanmasına bakılır); ayrıca bağımsız kalem:
  [ ] canvas-editor brush.ts point-rate doğrulaması (düşük hızda
  damla boşluğu ölç).

### 0.5 · Kalıcılık (main.js save-tail / auto-backup) denetim bulguları
Öteki model denetimine göre; kodda doğrulanmış etiketlerle:
- [x] **Atomik yazım** (geçerli, öncelik 1 — 06.11.2026 TAMAM): Tek
  choke-point `writeFileAtomic()` main.js üst bölümüne eklendi (aynı
  dizinde `.tmp-*` geçici dosya → tek `renameSync`; Windows kilit
  durumunda bir kez hedefi bırakıp yeniden dener, düşerse eski doğrudan
  yazıma cansıkı düşer). Üç nokta bağlı: `save-tail`, `auto-backup`,
  `boundsFile()`/saveWindowState. `node --check` ✓, desktop-smoke 20/20 ✓,
  repack + verify-package PAKET GÜNCEL.
- [ ] **JSON.stringify/zincir bellek zirvesi** (kısmen geçerli, ölçüm
  ilk): payload zaten IPC üzerinden tam dizge olarak geliyor (zirve
  main.js'ten önce oluşur); `deflateSync` çıktısını da tamponlar.
  Gerçek iyileştirme: deflate + dosya yazmayı akışa çevirmek
  (`zlib.createDeflate` → dosya akışı), zirve belleği çıktı boyutu
  kadar düşürür. Boyut kanıtı olmadan limit koymak yok — önce
  tipik/en büyük tahta JSON boyutunu loglayıp ölç.
  [ ] tipik/en büyük tahta kayıt boyutı ölçümü.
- [ ] **inspectBackup senkron okuma** (geçerli ama sınırlı, öncelik 2):
  yedek zirvesi `JSON.parse(readFileSync(…))` — 200 MB'a kadar
  (MAX_HEALTHY_BYTES:1110) main iş parçacığında senkron: dosya okuma
  süresince UI tamamen blok. `healthCache` tekrar yoklar, boyut
  keçesi aşırı dosyayı eler — ciddiyet sınırlı. Düzeltme:
  `fs.promises` / akış + `await` (healthCache sözleşmesini koru).
- **Reddedildi** (bugün eylem yok): "TAIL_VERSION=1 sürüm yönetimi
  zayıf" — header'da sürüm baytı zaten var ve open-tail (main.js:986)
  bilinmeyen sürümü açık mesajla reddediyor; sürüm yükseltirken
  okuyucuya sürüm-başına dallanma eklenmesi gelecek işi (biçim
  değiştiğinde YAPILACAK olarak 0.2 v2.2 planına bağlandı),
  bugün hata yok.

### 0.6 · "Endüstri standartı" mimari önerileri — uzun vadeli kayıt
Öteki modelin üç "devrim" önerisi; kısa gerçeklik kararıyla birlikte
kuyruğa alındı (bugün eylem yok, ölçüm/karar kalemi olarak):
- [ ] **Tiling belge sistemi** (bellek devrimi): "tüm tuval bellekte"
  iddiası koda uymuyor — katman backing'i doc çözünürlüğünde ve kameraya
  duyarsız (CSS scale yok); tahta saının öğe-bazlı backing'i zaten var
  ve ink motorunda karo kanonu mecvut (57-ink-tile-canon.js). Uzun
  vadeli hedef: sınırsız belge boyutu. Ölçüm kalemine bağlandı:
  0.3'teki "20+ katman × 4k backing pan/zoom kare süresi" ölçümü
  bu kararın girdisidir.
- [ ] **Node-based / data-driven pipeline** (iş akışı): soyut —
  ölçülebilir yazılım kazancı tanımsız; rejected SRP ailesiyle aynı
  kapsamda. 0.4'teki `effects: Filter[]` karar kalesiyle birleştirildi:
  filtre zinciri uygulanırsa pipeline etrafında konuşulur.
- [ ] **Plug-in / yazılım API** (ekosistem): `.abr` import ZATEN var
  (v1.7 ".abr dinamikleri ve çift fırça") + native fırça kütüphanesinde
  özel fırça/kategori/favori düzeni (K22 parite kapısı geçer). Gerçek
  kalem: *script/plugin API* — Electron sandbox güvenlik kapsamı
  + K22 sonrası; kullanıcı-talebi olmadan geliştirmeyin.




## 1. Son doğrulama (05.11.2026)

| Komut | Sonuç |
|---|---|
| `node scripts/run-gates.js --full` | **28/28 kapı yeşil** |
| `node scripts/opacity-size-probe.js` | 5/5 ✓ · OPKLK-1 = 8.2% |
| `node scripts/options-bar-test.js` | 59/59 ✓ |
| `node scripts/symmetry-test.js` | 16/16 ✓ |
| `node scripts/ink-commit-check.js` | 7/7 ✓ |
| Paket | `dist_studio2` yenilendi · verify PAKET GÜNCEL ✓ · masaüstü exe güncel |

---
# Çizim Sistemi — Durum Özeti (Nerede Kaldık)

> Sürüm 2.1 · 30.10.2026 · `tailref`
> Kaynak: `src/renderer/core/27-ink-core.js` … `src/renderer/core/40-ink-dab-gl.js`, `ink-worker.js`
> Ayrıntılı performans notları: [INK_PERFORMANCE.md](INK_PERFORMANCE.md)
> Mod mimarisi: [INK_EDITOR_ARCHITECTURE.md](INK_EDITOR_ARCHITECTURE.md)

Bu belge, acil UX listesinin (1–5) ve çizim motoru hedeflerinin (1–8) hangi
kısmının tamamlandığını, kodda nerede durduğunu ve sıradaki işleri kaydeder.
Amaç: yeni bir oturumda "nerede kalmıştık" sorusunu tahmine bırakmamak.

## 1. Son doğrulama

| Komut | Sonuç |
|---|---|
| `node scripts/build-app.js` | 39 kaynak → `app.js` · 16.972 satır |
| `node scripts/ink-smoke.js` | **142/142 geçti** (çizim, UX, Referans↔Çizim mod geçişi, modal editör, Alt damlalık, gerçek silgi, geri al, kilit, .abr, dinamikler, çift fırça, eğim, panel ölçeği, HSV çarkı, kısmi tazeleme, artımlı tam geri alma, worker raster, bölge parçalama, damlalık önbelleği, büyük damga, basınç eğrisi, hız incelmesi, flow/doku, gerçek çift uç, **GPU önizleme + yön paritesi + doku LRU**, **gerçek .abr v6.2 biçimi**) |
| `node scripts/smoke-test.js` | Tümü geçti (sunucu / yol güvenliği) |
| `node scripts/ink-bench.js` | Eşikler sağlandı (yazılım raster; 1k/4k/10k) |
| `node scripts/ink-bench.js --gpu` | Eşikler sağlandı; GPU önizleme karesi **0.24 ms** (eski tam kare 0.7–1.2 ms) |

## 2. Acil UX listesi (1–5) — tamamlandı

| # | Davranış | Uygulama | Test |
|---|---|---|---|
| 1 | Sol araç çubuğu fırça/katman düğmeleri | `31-ink-ui.js` `inkTogglePanel` (213), `inkBindBrushPanel` (270), `inkBindLayersPanel` (568); `index.html` `#inkToolbox` (115); `aria-expanded`, karşılıklı dışlama, `Esc` | `araç çubuğu fırça paneli açılıyor`, `… katman paneli açılıyor`, `Esc açık paneli kapatıyor` |
| 2 | Renk çarkı (HSV halka + üçgen) | `31-ink-ui.js` `inkWheelRing` (428), `inkWheelTriangle` (490), `inkWheelDraw` (551), `inkOpenColorWheel` (632), `inkWheelApply` (686), `inkBindColorWheel` (729); halka tonu, üçgen doygunluk/parlaklığı seçer; HEX + RGB girişleri; dışarı tık / `Esc` kapatır | `renk çarkı açılıyor / rengi değiştiriyor / kapanıyor`, `halka tıklaması tonu seçiyor`, `üçgen tıklaması doygunluk/parlaklık veriyor`, `üçgen sürüklemesi doygunluğu düşürüyor`, `HEX girişi rengi uyguluyor`, `RGB girişi rengi uyguluyor`, `RGB girişi HEX alanını eşitliyor` |
| 3 | Sağ tık → "Çizim Yap" | `15-menu-export.js` (97, 100): yalnızca görsel üzerinde etkin; boş alanda devre dışı. Kapsam açıkken etiket "Çizimi Bitir" olur. Eylem `modeEnterDraw` → `inkEnterImageScope` → **tam ekran Çizim modu** (tahta kabuğu gizlenir) | `sağ tık görselde "Çizim Yap" etkin`, `boş alanda devre dışı`, `sağ tık "Çizim Yap" tam ekran çizim modunu açıyor`, `çizim modunda referans tahtası arayüzü tamamen gizli`, `çizim modundan çıkınca referans tahtası geri geliyor` |
| 4 | Otomatik odak | `31-ink-ui.js` `inkEnterImageScope` → `inkFrameImageForDrawing` + `36-ink-editor.js` `inkEditorOpen`; modal açılır, görsel ekrana sığdırılır/ortalanır, fırça seçilir, fırça paneli açılır | `çizim kapsamı görseli ekrana sığdırıyor`, `… fırçayı seçiyor` |
| 5 | Görsel sınırı (kilitleme) | `30-ink-tools.js` `inkClampScopeLocal` (177), `inkResolveDrawLayer` (191), canlı önizleme kırpması `inkClipLiveToLayer` (67); modalda `inkEditorLocal(event, true)` sürüklemeyi kenara kelepçeler | `görsel dışında başlayan vuruş engelleniyor`, `noktalar 0..1 içinde`, `döndürülmüş görselde…`, `silgi de sınırına kelepçeleniyor` |

Kelepçeleme yalnızca `inkRuntime.imageScopeId` etkinken ve katman o görsele
bağlıyken uygulanır; serbest (global) çizimde davranış değişmez.

## 3. Çizim motoru hedefleri (1–8)

| # | Hedef | Durum | Nerede |
|---|---|---|---|
| 1 | Bağlamsal kilitleme / maske | **Tamam** | Bağlı katman tuvali görselin kendi boyutundadır; taşan noktalar `0..1` yerel kutusuna kelepçelenir. Canlı önizleme görsel poligonuna kırpılır. |
| 2 | referans uygulama tarzı araç çubuğu + flyout | **Tamam** | `31-ink-ui.js` `inkToggleFlyout` (220), `INK_FLYOUTS`; `title`/`aria-label` ipuçları `index.html` (116–163); aktif durum `aria-pressed`. Flyout araç kutusunun sağında, kırpılmadan açılır. |
| 3 | Basınç + eğim + yumuşak interpolasyon | **Tamam** | `inkEventPressure` (290), `inkEventTilt` (303) → `{t,a}`, `28-ink-brush.js` `inkForEachDab` Catmull-Rom; `getCoalescedEvents()` (615); avuç reddi `inkIsPalm` (322). Eğim damgayı döndürüp `1 − 0.55·t` oranında yassılaştırır. `v1.7`: `.abr` basınç boyutu, açı/saçılma jitter'ı ve yuvarlaklık dinamiği de uygulanır (`inkBrushDynamics`, `INK_DEFAULT_DYNAMICS`). `v1.9`: kullanıcı ayarlı basınç eğrisi (`pressureCurve`) ve hız incelmesi (`speedSize`) girdi noktalarına uygulanır. |
| 4 | Kalıcı vuruş durumu | **Tamam** | `inkCommitFreehand` (708): vuruş vektör olarak `layer.strokes`'a yazılır **ve** aynı anda bağlı tuvale / global karolara pişirilir. React benzeri yeniden çizimlerde kaybolmaz; `state.ink` pano kaydına dahildir (`02-state-db.js` 94). |
| 5 | .abr ayrıştırıcı | **Tamam (kapsam sınırlı)** | `28-ink-brush.js` `inkParseAbr` (387): v6+ `8BIM`/`samp`, v1/v2 eski biçim, ham + PackBits RLE, 8/16-bit. `v1.7`: `desc`/`cbsh` blokları okunur; `samp` içermeyen **computed** fırçalar uç olmadan içe aktarılır (boyut, sertlik, aralık, saçılma, boyut/açı/saçılma dinamiği, çift fırça). Uçlar PNG data URL olarak `Image`'a yüklenir, damga atlasında renklendirilir, IndexedDB'de saklanır (`ink:brushes`). Sınırlar: 64 uç, 512 px'e küçültme; çift fırçanın ikinci ucu ayrıştırılmaz (aynı uç ölçeklenir). |
| 6 | Bağlı / global katman mimarisi | **Tamam** | `27-ink-core.js` `inkNormalizeState` (92), `inkMakeLayer` (196), `inkEnsureAttachedLayer` (263). Bağlı katman görselle taşınır/döner/ölçeklenir ve **görselin/önceki katmanların üstünde** çizilir (ekleme sırası = yığın sırası). Global katman 512 birimlik karolarda yaşar. Panelden görünürlük, kilit, opaklık, karışım, düzlem. `v2.0`: modal açılışında hedef, yığının **en üstündeki** kilitsiz bağlı katmandır (`inkEditorTargetLayer`). |
| 7 | Fırça, silgi, damlalık, `[` `]` | **Tamam** | Silgi aynı motoru `eraser` olarak kullanır ve `destination-out` ile **gerçekten siler** (beyaz boyamaz). Damlalık `inkSampleColor` (1001) katman → görsel → alt katman sırasıyla örnekler; `v2.0`: modalda `Alt` basılı tutunca geçici damlalık (`inkEditorSetAlt`), bırakınca önceki araç geri gelir. Boyut `[`/`]` (1143) ve `Alt`+tekerlek (1174). |
| 8 | Performans + geri al | **Tamam** | 512'lik karolar + `inkCullTiles` (29:391), kirli dikdörtgen + rAF birleştirme (`33-ink-stamp.js` 232/246), vuruş bazlı delta geri al (`34-ink-undo.js`), ağır vuruşlar için worker raster (`35-ink-worker.js` + `ink-worker.js`), `Alt+P` HUD ve bench kapısı. |

### v2.0 — modal görsel düzenleme (Çizim Yap)

Çizim artık tahtanın üzerine "inline" yapılmıyor. `Çizim Yap` yalnızca seçili
görsele odaklanan bir **modal çalışma alanı** açıyor (`#inkEditor`); tahta arkada
izole kalıyor, araç kutusu ve paneller yalnızca bu modda görünüyor.

- **Kompozisyon (`36-ink-editor.js` `inkEditorRender`).** Görsel ekrana sığdırılıp
  ortalanır; gölge görselin **alfa maskesinden** üretilir (eski opak siyah dolgu
  saydam PNG'lerde dama desenini örtüyordu). Bağlı katmanlar alttan üste
  `globalAlpha` + `globalCompositeOperation` ile çizilir; `Multiply` gibi modlar
  fotoğraf ve alttaki çizimlerle doğru birleşir.
- **Girdi.** Vuruş sırasında hedef katmanın `scratch` kopyası kullanılır,
  `pointerup`'ta gerçek katman tuvaline pişirilir. `pointermove` boşlukları
  Catmull-Rom ile doldurulur (son noktadan başlar, geri sıçrama yok); noktalı
  çizgi hatası giderildi. Basınç `PointerEvent.pressure`'dan, eğim
  `tiltX/tiltY`'den okunur.
- **Alt damlalık.** `Alt` basılıyken araç damlalığa döner, birleşik
  kompozisyondan piksel örneklenir, bırakılınca önceki araç geri gelir.
- **Kapanış.** `Bitir` veya `Esc` modalı kapatır ve tahtanın **önceki aracını**
  geri yükler; böylece kapanıştan sonra yanlışlıkla tahtaya boyanmaz.
- **Testler.** `modal editör vuruşu katmana pişiriyor`,
  `modal silgi destination-out ile siliyor`,
  `modal vuruşu yeniden çizimde korunuyor`, `çizim modu modal editörü açıyor`.
  Mimari ayrıntı: [INK_EDITOR_ARCHITECTURE.md](INK_EDITOR_ARCHITECTURE.md).

### v2.1 — WebGL2 damla önizleme motoru

**Sorun.** v2.0 modalı her karede katmanı `scratch`'e kopyalayıp vuruşun
tamamını yeniden çiziyordu; uzun vuruşta sürükleme yavaşlıyordu.

**Çözüm.** `src/renderer/core/40-ink-dab-gl.js` önizlemeyi **artımlı** yapar: kare başına
yalnızca o karede eklenen damlalar işlenir.

- **GPU (WebGL2).** Katman bir kez dokuya yüklenir; damlalar FBO üzerinde
  biriktirilir. `inkDrawStrokeOnContext` aynen çalışır ama `ctx` yerine bir
  **sink** alır: `drawImage` çağrıları GL dörtgenlerine dönüşür, `index < drawn`
  damlalar atlanır. Sunumda UV dikey çevrilir (FBO satırı alt, kanvas satırı üst)
  — "önizleme ters" hatası buradan düzeldi.
- **Ekran çözünürlüğü.** Tampon katman boyutunda değil, görselin ekrana
  sığdırılmış kutusu × DPR (1–3). 4K katmanda tam boy kopya yapılmaz.
- **2B yedek.** WebGL2 yoksa/bağlam kaybolursa aynı artımlı mantık kalıcı
  `scratch` tuvalinde (`inkDabSink2d`, `previewSkip`) çalışır; eski tam yeniden
  çizime dönülmez.
- **Pişirme değişmedi.** `pointerup` hâlâ 2B raster yolunu kullanır; belge
  modeli, geri alma, worker, dışa aktarma ve kayıt formatı aynı.

**Ölçüm (1800×1286 katman, 476 damla, 96 adım).** Eski tam kare koşular arasında
**0.7–1.2 ms**, GPU karesi sabit **0.24 ms** (≈3–5×); tekrar karede yeni damla
**0** (0.30 ms). Bu boyutta artımlı 2B yedek de hızlı (0.14 ms) — GPU'nun asıl
kazancı büyük katman/DPR'de tam kopyayı kaldırması ve ekran çözünürlüğünde
tampon tutmasıdır. SwiftShader'da GPU yolu 3.91 ms; yazılım emülasyonu olduğu
için hız kanıtı değil, yalnızca regresyon/doğruluk koşusu. Ayrıntı:
[INK_PERFORMANCE.md](INK_PERFORMANCE.md) §2 "v2.1 ölçümü" ve §3.10.

**Sayaçlar / HUD.** `glPreview` (ms) + `glDabs` (yeni damla); HUD satırı
`önizleme 0.2 ms  gpu damla 476  doku 1`. A/B: `window.__inkGl.disable()` →
2B yedek, `enable()` → yeniden dene, `stats()` → doku/damla/kare/tepe,
`release()` → oturumu kapat.

**Testler.** `canlı önizleme artımlı çalışıyor` (GPU · 1 kare · 170 damla ·
1 doku · tekrar=true), `GPU uç dokusu önbelleği sınırlı` (20 yeni uç → 12 doku),
`önizleme yönü pişen katmanla aynı` (satır bazlı alfa profili önizleme ile pişen
katman arasında eşleşiyor).

**`.abr` v6.2 içe aktarma (düzeltildi).** Gerçek .abr fırça dosyaları
(`01.ABR`, 73.4 MB) "Uç bulunamadı" veriyordu. Üç neden vardı:

- **Hizalama.** `samp` girişleri 4 bayt hizalıdır. Hizalama atlanınca ikinci
  girişin uzunluğu `0` okunuyor ve dosya tek uçta kesiliyordu.
  `inkParseAbrSamp` artık hizasız konum geçerli bir sonraki uzunluk vermiyorsa
  hizalı konumu dener (eski biçimleri bozmadan).
- **RLE biçimi.** Gerçek `.abr` dosyalarında satır uzunluğu tablosu **yoktur**;
  bitmap verisi tek bir PackBits akışıdır. Ayrıştırıcı önce satır tablosunu
  dener, başarısız olursa düz akışı çözer (`inkAbrDecodePixels`).
- **Blok sırası.** Dosyada `samp` bloğu `desc`'ten **önce** geliyor (yalnızca
  örneklenmiş fırça kümesi). `desc` işlenirken bekleyen uçlar sıfırlanıyordu;
  artık `desc` sahipsiz uçları önce listeye bırakır.

Sonuç: `01.ABR` → **2 uç** (370×336 ve 1264×995) 33 ms'de ayrıştırılıyor,
içe aktarma 130 ms'de `added: 2` dönüyor ve iki uç da yükleniyor.
Regresyon testleri: `.abr v6.2 hizalı girişler + tek PackBits akışı`,
`.abr samp→desc sırasında uçlar korunuyor`.

### v1.7 — panel ölçeği, `.abr` dinamikleri ve çift fırça

**Fırça paneli ölçek hatası (düzeltildi).** `31-ink-ui.js` `inkBindBrushPanel`
kaydırıcı değerini ham haliyle (`0–100`) `state.ink.opacity/hardness/spacing/
smoothing` alanlarına yazıyordu; motor bu alanları `0..1` beklediği ve
kelepçelediği için **opaklık, sertlik, aralık ve yumuşatma pratikte etkisizdi**
(etiketler de `6000%` gibi yanlış görünüyordu). Artık `bindRange` bir `scale`
parametresi alır (`0.01`); eski panolardaki ham değerler `inkNormalizeState`
içinde `1` (spacing'te `2`) üstü için 100'e bölünerek onarılır.

**Önizleme.** `inkPreviewBrush` artık `ink.size` değerini kullanır: `1..300`
dünya birimi karekök ölçekle önizleme yüksekliğine eşlenir. Renk, opaklık,
sertlik, aralık, fırça ucu ve `.abr` dinamiği/çift fırça da aynı yoldan
görünür. Yumuşatma bir **girdi** ayarıdır (çizgi gecikmesi), bu yüzden statik
önizlemeyi değiştirmez.

**`.abr` dinamikleri.** `desc`/`cbsh` blokları okunur; `samp` içermeyen
computed fırçalar uç olmadan içe aktarılır. Basınç boyutu, açı/saçılma
jitter'ı, yuvarlaklık ve çift fırça ana iş parçacığında ve worker'da aynı
şekilde uygulanır.

**Çift fırça.** İkinci uç ana damlanın altına saçılmış doku ekler. Saçılma
yarıçapı `sqrt(random)` ile alan-uniform seçilir; düz `random` daireyi merkeze
yığıyor ve ikinci uç görünmüyordu. Akış `0.72`. Ölçüm: tek renk toplamı
9468k → çift 10565k, **15.730 px** değişen piksel, sınır kutusu `428×97 →
449×142`. Test: `çift fırça doku katıyor`.

### v1.8 — HSV halka + üçgen renk seçici

**Bileşen.** `#inkColorWheel` artık tek bir `<canvas id="inkWheelCanvas">`
(228×228 css) ve altında HEX + RGB girişleri içerir. Dış halka tonu
(0–360°), iç üçgen doygunluk (yatay) ve parlaklığı (dikey) temsil eder.
Üçgen köşeleri: sol üst **beyaz** (`s=0, v=1`), sol alt **siyah**
(`s=0, v=0`), sağ uç **saf ton** (`s=1, v=1`). Barycentric ağırlıklar
`s = wC`, `v = wC + wA` eşlemesini verir.

**Etkileşim.** Pointer Events + pointer capture: halkada ve üçgende
basılı tutup sürüklemek rengi canlı günceller, `pointerup`'ta kaydeder.
Halka ve üçgen ayrı offscreen tuvalde önbelleklenir; halka yalnızca boyut,
üçgen yalnızca ton değişince yeniden üretilir. Halka piksel bazlı çizilir
(0.1° ton tablosu) — yay parçalarının bıraktığı dikişler yok.

**Cam panel.** Panel cam koyu temasına geçti:
`--glass-bg-strong`, `--glass-blur`, `--glass-shadow`, 20 px köşe.
HEX alanı `#RRGGBB` / 3 haneli kısaltmayı kabul eder; RGB alanları
0–255 aralığında çalışır ve HEX alanını eşitler. Dışarı tıklama ve `Esc`
paneli kapatır; içeri tıklamalar kapatmaz.

**Testler.** `halka tıklaması tonu seçiyor`, `üçgen tıklaması
doygunluk/parlaklık veriyor`, `üçgen sürüklemesi doygunluğu düşürüyor`,
`HEX girişi rengi uyguluyor`, `RGB girişi rengi uyguluyor`,
`RGB girişi HEX alanını eşitliyor`.

### v1.9 — basınç eğrisi, hız dinamiği ve gerçek çift uç

**Basınç eğrisi (P3).** Fırça panelinde `Basınç eğrisi` (0.20×–3.00×,
varsayılan 1.00×) ve `Hız incelmesi` (0–80%, varsayılan 0%) kaydırıcıları
vardır. Girdi basıncı `inkCurvePressure` ile `p^eğri` olarak yeniden
eğilir: 1 altı yumuşak, 1 üstü sert başlangıç verir. Değer `stroke` ve
`state.ink` içinde saklanır; kayıt/geri al turunda aynı kalır.

**Hız dinamiği (P3).** `pointermove` başına ekran px/ms sürati
`inkSpeedInfluence` ile 0..1'e eşlenir (0.15 px/ms yavaş, 2.35 px/ms tam
hızlı) ve üstel ortalamayla (`0.6 eski + 0.4 yeni`) yumuşatılır. Değer her
noktaya `s` olarak yazılır; böylece `.abr` `velocity` dinamiği ve hız
incelmesi geri oynatmada da aynı kalır. `inkDabRadius` hız miktarını
`1 − speedSize·s` ile uygular (en az %20 kalınlık).

**Yol çizimi koruması.** `speedSize > 0`, `velocity` dinamiği, özel
`sizeMin/sizeMax`, `flow < 1`, `flowJitter`, `texture` veya çift fırça
varken `inkStrokePathEligible` false döner. Tek quadratic yol bu
değişkenleri temsil edemediği için vuruş damla yoluna düşer ve incelme
kaybolmaz.

**Akış ve doku (P2).** `flow` her damlanın alfasını çarpar;
`flowJitter` damla başına küçük rastgele azalma ekler. `texture` açıkken
konuma bağlı deterministik değer gürültüsü (`inkTextureGrain`) alfa
çarpanı üretir; `textureDepth` ve `textureScale` `.abr` `Txtr`/descriptor
alanlarından gelir. Aynı hesap worker'da birebir kopyalanır.

**Gerçek çift uç (P2).** `.abr` `samp` bloğu artık computed fırçaya
bağlanır: ilk uç ana uç, ikinci uç `Dual` bloğunun gerçek ikinci ucudur.
Blok sırası `cbsh → samp` veya `samp → cbsh` olabilir; iki durum da
eşleştirilir. Uçlar `importedTips`'e kaydedilir, IndexedDB'ye ana + çift
`dataUrl` olarak yazılır ve worker'a `dualTip` bitmap'i olarak taşınır.
Eşleşme yoksa eski davranış (aynı ucun ölçeklenmesi) korunur.

**Worker paritesi.** `ink-worker.js` artık `speedSize`, `flow`,
`flowJitter`, `texture*` ve gerçek `dualTip` alanlarını alır. Kritik
düzeltme: worker'ın `forEachDab`'ı Catmull-Rom noktalarına `s` alanını
yazmıyordu; tüm damlalar `s = 1` (tam hız) sayılıp worker rasterı
senkrondan kalın çıkıyordu. `s` ve basınç birlikte interpolasyonla
taşınıyor.

**Testler.** `fırça paneli basınç eğrisi ve hız ayarını bağlıyor`,
`basınç eğrisi vuruş basıncını yeniden eğiyor`, `hız incelmesi hızlı
vuruşu inceltiyor`, `akış (flow) damla opaklığını düşürüyor`,
`doku (texture) vuruşa grain katıyor`, `hız alanı kayıt turunda
korunuyor`, `hız/dinamik varken yol çizimi kullanılmıyor`,
`worker hız/akış/doku rasterı senkronla eşleşiyor`,
`gerçek çift fırça ucu .abr içinden ayrıştırılıyor`,
`gerçek çift fırça ucu içe aktarılıyor ve yükleniyor`.

## 4. Veri akışı (kısa)

```
[modal] pointerdown → inkEditorDown (hedef = üstteki kilitsiz bağlı katman)
         pointermove → inkEditorMoveSample (Catmull-Rom ara noktalar + basınç/hız)
                       └─ önizleme: GPU FBO'ya yalnızca YENİ damlalar
                          (yoksa kalıcı 2B scratch + previewSkip)
         pointerup   → inkEditorUp → vuruş scratch'ten gerçek katman tuvaline pişirilir
[tahta] pointerdown → inkResolveDrawLayer (kapsam / aktif katman / otomatik bağlama)
        pointermove → canlı tuval (yalnızca son segment) + Catmull-Rom damlaları
        pointerup   → inkCommitFreehand
                      ├─ layer.strokes.push(stroke)        // kaynak gerçek (JSON)
                      ├─ inkPushUndoStroke(layer, stroke)  // yalnızca delta kayıt
                      └─ inkPaintCommittedStroke()
                           ├─ hafif / yol vuruşu → ana iş parçacığında raster
                           └─ ağır damla vuruşu  → worker (bölge bitmap'i → ImageBitmap)
```

Modal açıkken tahta girdisi devre dışıdır; çizim yalnızca `#inkEditorCanvas`
üzerinden gelir ve aynı vektör kaydını/geri alma yolunu kullanır.

- **Kaynak gerçek** her zaman vektör vuruş listesidir; tuval/karolar
  yeniden üretilebilir önbellektir.
- **Bağlı katman** tuvali görselin piksel kutusuna, **global katman** karoları
  dünya uzayına kırpılır.
- Geri al/yinele vuruşta bağlı katman için vuruşun kırpılmış raster bölgesi
  `putImageData` ile birebir geri yazılır (`inkUndoRaster`); kayıt yoksa
  güvenli tam kurulum yapılır. Tam anlık görüntü geri alması ve vuruş taşıma
  yalnızca değişen dünya dikdörtgenini tazeler (`inkMarkLayerDirty`).
- Worker sonucu gelene kadar canlı önizleme ekranda kalır (`inkLiveHolds`);
  bekleyen iş `inkPaintIdle()` ile beklenebilir.

### Tam anlık görüntü geri alması (v1.5)

`undo()` / `redo()` tam kayıt yolunda geri yüklemeden önceki `state.ink`
referansını `inkAfterRestore(prevInk)` ile geçirir. `inkApplyRestoreDiff` iki
durumu katman katman karşılaştırır:

- Vuruş listesi aynı → raster yok; yalnızca stil, culling ve gizmo senkronu.
- Vuruş eklendi/kaldırıldı/taşındı → **eski ve yeni** dünya sınırlarının
  birleşimi kirli dikdörtgen olarak işaretlenir.
- Katman yeni veya boyutu değişmiş → yalnızca o katman tam rasterlenir.
- Ortak vuruşların sırası değişmiş → katman bütün çizilir (z-sırası korunur).

Vuruş imzası `inkHashStroke`: nokta koordinatları 1/4096 çözünürlükte, basınç,
eğim ve stil alanlarıyla birlikte iki adet 32-bit akümülatöre işlenir. DOM
önbelleği eksikse (pano değişimi / sıfırlama) güvenli tam yola düşülür.
Sayaçlar: `incrementalRestores`, `fullRestores`, `restoreTouchedLayers` ve
`restoreDiff` süresi; `Alt+P` HUD'ında "geri yükleme" satırı olarak görünür.

### Worker raster kuralları (`35-ink-worker.js`)

- Yalnızca **damla yoluna** düşen vuruşlar taşınır; sert/yol vuruşları ve
  şekiller ana iş parçacığında çizilir.
- Eşik: tahmini damla ≥ **2400**. Bölge 2048² px'i aşarsa **karo hizalı
  parçalara** bölünür (`inkSplitRasterPlans`, en fazla 48 parça) ve parçalar
  aynı zincirde sırayla uygulanır. Parçaların dikimi `copy` ile yalnızca kendi
  dikdörtgenine kırpılır; karonun geri kalanı korunur. Parçalanamayacak kadar
  büyük bölge (48'den fazla) ve 2048² altı bölgeler eskisi gibi tek iş gider.
- Aynı katmanda zincir varsa yeni vuruş sırayı bozmamak için o da kuyruğa girer.
- Yakalama, iş kuyruğa girmeden **önce** yapılır; geri al / dönüştürme /
  silme / katman yeniden kurulumu *epoch* ve *mutation* sayaçlarını artırır.
  Geç gelen bitmap atılır; vuruş hâlâ katmandaysa yalnızca kendi bölgesi
  kaynaktan tazelenir.
- Worker yoksa, `OffscreenCanvas`/`createImageBitmap` desteklenmiyorsa veya
  bölge çok büyükse davranış eskisiyle birebir aynıdır (senkron raster).

## 5. Kalan işler (öncelik sırası)

| Öncelik | İş | Neden / kabul ölçütü |
|---|---|---|
| P0 | **Modal görsel düzenleme** | **Tamamlandı (v2.0).** Çizim artık tahtaya inline yapılmıyor: `Çizim Yap` → `inkEnterImageScope` → `inkEditorOpen` ile `#inkEditor` modalı açılır, görsel sığdırılıp ortalanır, araç kutusu yalnızca bu modda görünür. Vuruş `scratch` kopyada canlı çizilir ve `pointerup`'ta katman tuvaline pişirilir; `pointermove` boşlukları Catmull-Rom ile doldurulur. Alt geçici damlalık, silgi `destination-out`, katmanlar ekleme sırasıyla daima görselin üstünde. `Bitir`/`Esc` tahta aracını geri yükler. Testler: `çizim modu modal editörü açıyor`, `modal editör vuruşu katmana pişiriyor`, `modal silgi destination-out ile siliyor`, `modal vuruşu yeniden çizimde korunuyor`. |
| P0 | **Canlı önizleme hızı** | **Tamamlandı (v2.1).** `40-ink-dab-gl.js` WebGL2 artımlı önizleme + artımlı 2B yedek. Donanımda eski tam kare 0.7–1.2 ms → **0.24 ms**, tekrar karede 0 yeni damla. HUD `glPreview` / `glDabs`; A/B `window.__inkGl.disable()/enable()/stats()`; uç dokuları LRU(12) ile sınırlı. Testler: `canlı önizleme artımlı çalışıyor`, `GPU uç dokusu önbelleği sınırlı`, `önizleme yönü pişen katmanla aynı`. |
| — | **C++ raster çekirdeği (WASM / N-API)** | **Karar bekliyor.** GPU önizleme sonuçları alındı; commit yolu hâlâ JS 2B ve eşikleri sağlıyor. Kullanıcı onayı olmadan başlanmıyor. |
| P1 | **Worker raster** | **Tamamlandı (v1.4).** `ink-worker.js` + `35-ink-worker.js`: ağır damla vuruşu bölge bitmap'i üzerinde çizilir, `ImageBitmap` ile geri döner ve `copy` ile katmana/karolara yazılır. Ana iş parçacığı commit süresi 10k noktalı yumuşak vuruşta **2.3 ms** (senkron yolda ~11 ms), damlama worker'da ~106 ms sürer. Testler: `ağır vuruş worker kuyruğuna giriyor`, `worker rasterı senkron rasterla eşleşiyor`, `worker dönerken geri al geç sonucu atıyor`. |
| P1 | **Tam anlık görüntü geri almalarında kısmi tazeleme** | **Tamamlandı (v1.5).** `27-ink-core.js` `inkLayerStrokeDiff` + `inkApplyRestoreDiff` + `inkAfterRestore(prevInk)`: geri yüklemeden önceki `state.ink` ile yeni durum vuruş imzasıyla karşılaştırılır; yalnızca değişen katmanın değişen bölgesi tazelenir. Öğe taşıma/silmede raster maliyeti **0**, vuruş taşımada yalnızca eski+yeni sınır. **3000 vuruşlu katmanda undo 10–12 ms** (hedef < 20 ms). Testler: `öğe taşıma geri alması katmanı yeniden rasterlemiyor`, `… tuvali ve pikselleri koruyor`, `vuruş taşıma geri alması yalnızca değişen bölgeyi tazeliyor`, `… komşu vuruşu koruyor`, `silinen katman geri gelince yalnızca o katman kuruluyor`, `3000 vuruşta öğe taşıma geri alması < 20 ms`. |
| P2 | **Worker bölge sınırı** | **Tamamlandı (v1.6).** `inkSplitRasterPlans` + `INK_WORKER_CHUNK` (2048): 2048² üstü bölgeler karo hizalı parçalara bölünür (en fazla 48), parçalar aynı katman zincirinde sırayla uygulanır. Dikim `copy` ile parça dikdörtgenine kırpılır. Testler: `2048² üstü bölge worker parçalarına bölünüyor` (6 parça), `parçalı worker rasterı dikiliyor ve mevcut karoyu koruyor` (senkron rasterla eşleşir, komşu piksel silinmez). |
| P2 | **Damlalık örnekleme önbelleği** | **Tamamlandı (v1.6).** Görsel başına küçültülmüş örnek tuvali (`inkSampleImageFor`, en uzun kenar 1536 px) LRU(4) ile tutulur; anahtar `imageId\|WxH`. Sayaçlar `sampleCacheHits/Misses`. Testler: `damlalık görsel pikselini örnekliyor` (tam boy referansla ±8 renk), `damlalık örnekleme tuvali önbelleğe alınıyor` (ikinci örnekleme hit). |
| P2 | **128 px üstü damga kalitesi** | **Tamamlandı (v1.6).** Prosedürel uç artık hedef çözünürlükte üretilir (`inkTipRes`, 128→1024) ve damga kovaları 512/1024 eklendi. Böylece 128 px kaynak uç büyütülmüyor; 700 px fırçada damga **1024²** tuvalde üretilip 1:1 çizilir. Atlas hem adet (96) hem **32 MB** bayt bütçesiyle LRU tahliye edilir. Worker aynı kovaları ve uç çözünürlüğünü kullanır (senkron/worker paritesi korunur). Testler: `büyük fırçada uç hedef çözünürlükte üretiliyor`, `büyük damga kenarı yuvarlak ve geçişli` (72 açıda yarıçap sapması 0.6 px), `700 px damga doğru çapta çiziliyor`, `damga atlası bayt bütçesini aşmıyor`. |
| P2 | **.abr dinamikleri** | **Tamamlandı (v1.7).** `desc`/`cbsh`: `Dmtr`, `Hrdn`, `Spcn`, `SzVr`, `AnVr`, `ScVr`, `Inpt`, `Dual` okunur; computed fırça uç olmadan içe aktarılır. Testler: `.abr desc + cbsh blokları ayrıştırıldı`, `.abr dinamiği ve çift fırçası okunuyor`, `basınç dinamiği damla boyutunu değiştiriyor`, `yuvarlaklık ve açı damgayı yassılaştırıyor`, `çift fırça doku katıyor`, `computed .abr fırçası uç olmadan içe aktarılıyor`. `v1.9`: flow/texture alanları da motorda ve worker'da uygulanır. |
| P2 | **Gerçek dual tip + flow / texture** | **Tamamlandı (v1.9).** `samp` bloğundaki ikinci uç `Dual` fırçasına bağlanır, IndexedDB'ye yazılır ve worker'a taşınır. `flow`, `flowJitter`, `texture`, `textureDepth`, `textureScale` ana iş parçacığı ve worker'da aynı sonucu verir. Testler: `gerçek çift fırça ucu .abr içinden ayrıştırılıyor`, `gerçek çift fırça ucu içe aktarılıyor ve yükleniyor`, `akış (flow) damla opaklığını düşürüyor`, `doku (texture) vuruşa grain katıyor`, `worker hız/akış/doku rasterı senkronla eşleşiyor`. |
| P3 | **Basınç eğrisi + hız dinamiği** | **Tamamlandı (v1.9).** Panelde eğri (0.20×–3.00×) ve hız incelmesi (0–80%) kaydırıcıları; nokta başına `s`; `velocity` dinamiği ve geri oynatma korunur. Testler: `fırça paneli basınç eğrisi ve hız ayarını bağlıyor`, `basınç eğrisi vuruş basıncını yeniden eğiyor`, `hız incelmesi hızlı vuruşu inceltiyor`, `hız alanı kayıt turunda korunuyor`, `hız/dinamik varken yol çizimi kullanılmıyor`. |

## 6. Hızlı doğrulama

```powershell
node scripts/build-app.js        # app.js'i üret (elle düzenlemeyin)
node scripts/ink-smoke.js        # 142 çizim + UX + modal editör + panel + HSV çarkı + artımlı geri alma + worker + damga + basınç/hız + flow/doku + GPU önizleme + .abr v6.2 + çift uç kontrolü
node scripts/ink-bench.js --quick
node scripts/ink-bench.js --gpu  # GPU önizleme ölçümü + eşik kapısı
```


---

## 7. MİMARİ GEÇİŞ (önceki sürümün klasörü → tailref)

> Bu bölüm tamamlanan taşımanın mimari kaydıdır. Ağaç ekleme sonrasında artık
> TailRef yanlızca `tailref/` klasöründe yaşar; eski repo arşivliğinde kaldırılmıştır.

### 7.1 Ağaç eşlemesi

| Eski (`önceki sürümün klasörü`) | Yeni (`tailref`) |
| --- | --- |
| `main.js` | `src/main/main.js` |
| `preload.js`, `pinterest-preload.js`, `artstation-preload.js`, `panel-preload.js` | `src/preload/…` |
| `src/app/*.js` (45 modül) | `src/renderer/core/*.js` |
| `draw-v5.js`, `draw-v5.css`, `index.html`, `panel.html`, `panel-window.js` | `src/renderer/…` |
| `src/pose3d/**` | `src/renderer/pose3d/**` |
| `assets/*` | `src/renderer/assets/*` (isimler `önceki adlar-*` → `tailref-*`) |
| `ScaleReferenceDummy.fbx` | kaldırıldı (2026-11-06): yerini kod içi `src/renderer/pose3d/dummy/DummyRig.js` aldı; kullanıcı modeli yolu `SceneGraph.load` aynen duruyor |
| `tests/`, `scripts/*-test.js` | `tests/*-test.js` (`run-gates.js` `gatePath()` ile dağıtar) |
| `%APPDATA%\önceki sürüm` | `%APPDATA%\TailRef` (göç köprüleri aşağıda) |

### 7.2 Tek seferlik veri köprüleri (`src/renderer/core/01-bootstrap.js`, `02-state-db.js`)

Eski kopya adlarına&#8203;n kaynakkodda çıplak yazılmamasının kararı alınmıştır; bridge'ler
eski adı base64 açarak kullanır (`atob`). Üç köprü:

1. **localStorage anahtar köprüsü** (`01-bootstrap.js`): tüm `önceki adlar-*`/`önceki sürüm*` anahtarı
   `tailref-*` özdeş ad lokalizasyonuna yeniden yazılır (değer aynı kalarak taşınır),
   eski anahtar remove edilir. İkinci koşumda okuma guard'ı boşluk — idempotenttir.
2. **IndexedDB göçü** (`02-state-db.js` `migrateLegacyDb()`): eski DB adı → `tailref`.
   `getAllKeys` → her kayıtta ayrı transaction get/put (cursor'lı tek transaction'ta
   `await` konursa IndexedDB otomatik commit eder ve göç YARIM kalır — bu cara'da düzeltildi).
   Tamamlanınca **eski DB silinir**; sonraki açılışlar legacy yok storeda doğal koşum.

### 7.3 Test disiplin çağırma

```powershell
npm.cmd run gates:full        # 33 kapı, tam zincir
node scripts/verify-package.js  # asar ⬌ disk uzam raftabın  (PAKET GÜNCEL beklenir)
```

Taşımada tespit edilen kırılmalar: `pinterest-test.js` eski kök require'ı;
`favicon-dark/light.png` + 3 logo PNG `utf8 readFileSync` bozulması
(`_binary-recopy.js` fix tekrar; hex imza kayıtları: `89 50 4E 47` PNG / `47 49 46 38` GIF / `4B 61 79 64` FBX);
`pose3d/bootstrap.js` model yolu; tüm testlerden **33/33** kapı geç оказались.

### 7.4 Sürüm ve GitHub

- `tailref/` klasörü ayrı repo root; `main` branch. `.github/workflows/ci.yml`
  `npm run gates:full` çalıştırıyor; `release.yml` tag'lenen sürümün portable + NSIS çıktısını yazıyor.
- `docs/INK_STATUS.md` bu bölümü ilk GitHub push'u ile birlikte görünür linkte bulunur.


