# TailRef Studio · Çekirdek Motor Kurtarma Planı

> **[TARİHSEL BELGE — 0.6 etiketi, 2026-11-06]** Bu dosya, kurtarma sürecinin
> **tarihsel teşhis planıdır**: "Sorun" anlatımları o günkü durumu betimler ve
> bu arada çözülen bölümler metin içinde `[DURUM: TAMAM]` etiketleriyle
> işaretlenmiştir. Güncel mimari için `README` + `CONTRIBUTING` +
> `docs/INK_EDITOR_ARCHITECTURE.md` gibi *mevcut durum* belgelerini kullanın.
> Yollar bugünkü ağaç yapısına (örn. `src/renderer/core/` → `src/renderer/core/`)
> göre güncellenmiştir; tarih anlatımı korunur.

> Kaynak: dört alt-analiz raporu (stroke pipeline, brush/GL, renk bilimi, layer/compositing).
> Kural (bugünkü ağaçla): **tüm düzenlemeler `src/renderer/core/NN-*.js` modüllerinde** yapılır; `app.js` yalnızca `node scripts/build-app.js` ile üretilir.
> Faz sonu kriteri her fazda aynı: `npm run gates` (PURE 8) **yeşil**; release öncesi `gates:full` (33).

---

## KORUNMASI ZORUNLU TASARIMLAR (yok demeyin!)

Bu yapılar endüstri standardında doğru; yıkılmaz, üzerine inşa edilir:

1. **Arc-length dab spacing + `continuousSpacing`** (28-ink-brush.js:367–385) — hız bağımsız dab yoğunluğu.
2. **`getCoalescedEvents()` tam tablet akışı** (30-ink-tools.js:847–859).
3. **FNV-1a deterministik dab RNG (`inkStrokeRandom`)** — worker ↔ main bit-özdeş çıktı.
4. **512 birim tile sistemi + dirty-rect ledger + rAF throttle** (33-ink-stamp.js:274–355).
5. **Worker'a ImageBitmap transfer + epoch/liveness guard** (35-ink-worker.js:340–365).
6. **Stroke-delta undo + 64MB snapshot LRU** (34-ink-undo.js).
7. **GL tarafında premultiplied alpha** (40-ink-dab-gl.js:587).

---

## FAZ 1 — OMURGA: Porter–Duff Compositor + Alpha Lock + Clipping Mask

> **DURUM (2026-11-03): FAZ 1 ÇEKİRDEĞİ TAMAMLANDI ✅ (madde 5 Gruplar dahil)**
> • `53-ink-compositor.js` yazıldı: plan (base+clip zinciri), grup raster önbelleği
>   (gen-sig), ekran senkronu (`inkCompositeSyncItem`), export planı
>   (`inkCompositePaintPlanToContext`), `inkBumpLayerGen`.
> • Alpha Lock hatta geçti: `stroke.lockAlpha → source-atop` vuruş, flood fill,
>   gradient, tile blit (referans tarzı, vuruş başına sablenir).
> • Köprü (38): `isAlphaLocked`, `clipped` gerçek katmandan okunur.
> • Katman paneli: alfa kilidi + kırpma düğmeleri (`icon-ink-alpha-lock`,
>   `icon-ink-clip` sembolleri index.html'de).
> • `inkRelayoutAttached` hayata döndürüldü: boyut değişimi sonunda
>   (`finishPointerDrag`) çağrılır; 2048 sert tavanı DPR-buyunçlu
>   1800-2800 aralığına çevrildi (100% zoom'da fiziksel piksel eşleşir).
> • Gen sayacı tüm boyama noktalarında: rebuild, merge-down, undo, fill,
>   kısmi yeniden çizim (33) ve worker bitmap uygulaması (35).
> • GRUPLAR (madde 5) hatta geçti: şema `kind:'group'` + `parentId`
>   (27-ink-core.js); karışık yığın `inkOwnerStackLayers`; yardımcılar
>   `inkCreateGroup` / `inkAddGroupMember` / `inkRemoveGroupMember` /
>   `inkGroupsForOwner`. Compositor gezgini klasör girişini toplar
>   (üyeler bitişik ve klasör başlığının ALTINDA; bitişiklik bozulursa
>   üyeler sıradan katman olarak serbest bırakılır), klasör rasterı
>   üyeleri tek düzlemde birleştirir (üyelerin kendi opaklık/blend'i
>   pişirilir; grup düzleminin opaklık/blend'i ekranda uygulanır),
>   ekran senkronu üye tuvallerini gizler, klasör sil/bağ kopar
>   üyeleri serbest bırakır. Panel: karışık satır listesi, grup rozeti,
>   'new-group' / 'Gruba ekle' / 'Gruptan çıkar' menü aksiyonları,
>   üyelerde kırpma düğmesi gizli, sürükle/tak operasyonları karışık
>   yığın üzerinde çalışır.
> • Test: `test:compositor` — 20/20; `npm test` yeşil;
>   `test:projects` 39/39; `ink-stabilizer-test.js` 22/22.
> **DURUM GÜNCELLEME (2026-11-04):** FAZ 1'in kalan parçası olan
> piksel-gerçek merge-down + klasör flatten (madde 5) tamamlandı:
> bake önbelleği (`29-ink-render.js` inkBakedRasterPrime),
> `inkCompositeMergeDownPixels` (53), `inkDocMergeDownLayer` /
> `inkDocFlattenGroup` (50) ve compositor testinin yeni M1/M2/M3
> blokları (kanonik vuruş senaryosu) yeşil.
> **Kalan (aşağıda koyu değil):** Layer Mask (madde 4) sonraki faza
> taşındı; kırpma zinciri modeli onun temelidir.
> **DURUM GÜNCELLEME (2026-11-04, FAZ 1B):** Ertelenen Layer Mask
> (madde 4) TAMAMLANDI — kırpma zinciri modeli üzerine inşa edildi.
> Şema: `layer.mask = { src, w, h }` (dataURL PNG, destination-in
> `a_o = a_d × a_mask`; yalnızca attached) — `inkNormalizeLayer` (27).
> Raster: maske dataURL önbelleği + tam/bölgesel uygulama
> `29-ink-render.js` (`inkMaskRasterSource/Prime`,
> `inkApplyMaskToItemContext`, `inkApplyMaskRectToItemContext`).
> Boyama sızıntısı kapatıldı: sync/worker bölge uygulaması `35`, partial
> redraw `33`. UI: ekle (reveal/hide) / sil / düzenleme modu
> `inkDocAddMask / inkDocRemoveMask / inkDocToggleMaskEdit` (50),
> vuruş yönlendirme maske tuvaline `30/36`, çoğaltma maskeli (50).
> Kayıt/undo/çoğaltma baked deseniyle ücretsiz (pushUndo tam JSON).
> Test: `test:compositor` **24/24** — K1 (maske ekle/sil alfa döngüsü),
> K2 (maske düzenleme erase/brush, katman defteri temiz), K3 (undo),
> K4 (maskeli katman ekran==export piksel birebir).
> `npm test` yeşil (pose3d 17 + smoke + Pinterest 25 + ArtStation 26);
> `test:projects` 39/39. **FAZ 1 artık tam** — kalan madde yok.

**Sorun (teşhis):** Ekran ve dışa aktarım iki farklı matematiği çalıştırıyor.
- Ekran: `canvas.style.mixBlendMode` (29-ink-render.js:178) → CSS, DOM sahnesinin tamamına karşı.
- Export: `ctx.globalCompositeOperation` (29-ink-render.js:466–469; 36-ink-editor.js:861–874) → yalnızca "o ana dek çizilenlere" karşı.
- Alpha lock / clipping mask / layer mask / grup **yok**; şema hazır (`38-canvas-editor-bridge.js:86,110` `isAlphaLocked:false` stub), motor yok.
- `merge-down` stroke concat düzeyinde (50-layer-stack.js:226) — piksel doğru değil.
- `inkRelayoutAttached` ölü kod (29:497–506); attached bitmap 2048×2048 sert tavanı (29:65–75).

**Yapılacaklar:**

1. `src/renderer/core/new: 55-ink-compositor.js` — izole, DOM'suz çekirdek:
   - `compositeStackToCanvas(stack, opts)` = **tek doğruluk kaynağı**. Screen önizleme da export da bunu çağırır; CSS `mix-blend-mode` yalnızca önizleme hızlandırıcısı olarak kalır (export ona bağlanamaz).
   - Premultiplied alpha uzayında Porter–Duff operatörleri:
     ```
     source-over: a_o = a_s + a_d(1−a_s);  C_o = C_s + C_d(1−a_s)
     source-atop: a_o = a_d;               C_o = C_s·a_d + C_d(1−a_s)
     destination-out (silgi): a_o = a_d(1−a_s)
     ```
   - Ayrışabilir blend denklemleri tablosu (multiply/screen/overlay/...): standart form
     `C_o = mixed·aS·aD + Cs·(1−aD) + Cd·(1−aS)` (premultiplied bitmiş form).
2. **Alpha Lock**: raster hattında `alphaLock ? 'source-atop' : 'source-over'` (vuruş pass'inde).
3. **Clipping Mask**: grup-flatten modeli — base rasterlenir, clip katmanları sırayla ATOP ile base buf'una bırakılır, grup tek düzlem olarak stack'e girer. Layer nesnesine `clippedTo/baseId` alanı.
4. **Layer Mask**: per-tile ikinci 8-bit alfa kanalı; composite'e `a_s × mask` çarpanı ile girer.
5. **Gruplar**: `inkMakeLayer` (27-ink-core.js:522–538) + `inkNormalizeLayer` (456–473) şemasına `parentId`, `kind:'group'` ekle; flatten + merge-down gerçek piksel birleşimi olmalı.
6. **attached tavanı**: 2048×2048 hard cap'i DPR'ye göre piksel-eşdeğerli çözünürlüğe bağla; `inkRelayoutAttached`'i yeniden boyutlandırmaya bağla (ölü koddan çıkar).
7. **37/38 bridge**: `isAlphaLocked`, `clipped`, `blendMode` gerçek layer nesnesinden okunsun.

**Testler:** yeni `scripts/compositor-test.js` — safoku (safekran) matematik testleri (atop/multiply/screen/destination-out altın vektörler) + screen==export piksel karşılaştırma testi (aynı stack, iki path, ≤%0.5 fark).

**Effort: ~3–4 gün. Bu faz tek başına "profesyonel" algısının omurgasıdır.**

---

## FAZ 2 — KALP: One-Euro Filter + Input Doğrulama

**Sorun:** Basınç ham sinyal — `inkSmoothPoints` (28:212–235) **ölü kod**, hiçbir yerden çağrılmıyor; konum-only EMA (30:934–944). Hız eğrisi DPI-kör sabit (28:938–942: `clamp((pxPerMs−0.15)/2.2)`). `INK_MAX_STROKE_POINTS=36000` dolunca `points.shift()` sessiz kayıp (30:977–993) → oynatma/raster tutarsız.

**Yapılacaklar:**

1. `One-Euro Filter` sınıfı (x, y, pressure üç bağımsız örnek):
   ```js
   const dt = (now - last)/1000;
   const cutoff = minCutoff + beta*|dx/dt|;
   const alpha = 1/(1 + (1/(2π·cutoff))/dt);
   out = prev + (sample − prev)·alpha;
   ```
   minCutoff≈1.0, beta≈0.007 başlangıç; arayüzde "Stabilizer: kapalı/1–10" kontrolleri bağlı.
2. **Fiziksel hız**: `(x−lx)·mmPerPx` (DPR'den türetilmiş) / dt → cm/s; dünya ölçeğiyle çarp.
3. **Coalesced zaman damgası**: hız, `sample.timeStamp` üzerinden (frame now'u değil).
4. **Mouse hız-basınç simülasyonu** seçeneği (pointerType='mouse' için).
5. ** Nokta sınırı**: shift yerine segment bölme; stroke başı asla yutulmaz.
6. `inkSmoothPoints` ya çağrıya bağlanır ya da silinir (ölü kod kalmaz).

**Testler:** smoke + yeni sabit-sentetik sinyal testi (dürtü gecikmesi <8 ms yüksek hızda, düşük hızda jitter bastırma sayısı).

**Effort: ~2-3 day. Bu faz tek başına "profesyonel" algısının omurgasıdır.**

---

## FAZ 2 — KALP: One-Euro Filter + Input Doğrulama

> **DURUM (2026-11-04): FAZ 2 TAMAMLANDI ✅**
> • `54-ink-stabilizer.js`: One-Euro filtresi — x/y/basınç üç bağımsız kanal,
>   türev hattı (f_d), hız-adaptif kesim (f_min + β·|dx'|), ilk örnek filtresiz
>   (gecikme 0). `smoothing` (0..0.95) → eğriyle parametre (0'da kapalı,
>   0.95'te 0.5 Hz).
> • 30/36 hatta geçti: freehand + editör vuruşu `inkStabilizerApply`
>   üzerinden; basınç da filtreli kanaldan (fare simülasyonu açıksa çifte
>   filtre yok). Coalesced örnekler `e.timeStamp` ile zamanlanır.
> • FAZ2-2 fiziksel ölçek: `INK_MM_PER_CSS_PX = 25.4/96`.
> • FAZ2-4 fare hız→basınç simülasyonu (`inkSimulatedPressure`,
>   `inkState().mouseSpeedPressure` tercihi).
> • FAZ2-5 nokta sınırı: `inkDecimateStrokePoints` — baş nokta + son 2
>   nokta asla silinmez, içeri seyreltme (oynatma/raster aynı listeyi okur).
> • FAZ2-6 `inkSmoothPoints` silindi (ölü kod kalmadı).
> • Arayüz: `inkSmoothing` range'i `bindRange` ile bağlı (% göstergeli).
> • Test: `scripts/ink-stabilizer-test.js` — 22/22 (parametre eğrisi,
>   dürtü gecikmesi, jitter bastırma, sabitlik, seyreltme altın örnekleri).

---

## FAZ 3 — RENK: Linear-light + OKLab Karışım Çekirdeği

> **DURUM (2026-11-04): FAZ 3 ÇEKİRDEĞİ TAMAMLANDI ✅**
> • `56-ink-color.js`: tek transfer çifti (linear sRGB ↔ ok, LUT'lu
>   piksel döngüsü hattı), Ottosson OKLab/OKLCH (CSS Color 4 matrisleri,
>   gamut borderline düzeltmeleri), saf source-over tek piksel birimi,
>   OKLab mix çekirdeği (L-chroma korumalı hue dönüşü dahil).
> • FAZ3-2 karışım noktaları lineer-light'a taşındı: smudge reservoir,
>   dab mixing, wet-edge (OKLCH kenar koyulaştırma), renk dinamikleri
>   (saturation→chroma, lightness→OKLCH l), dual-brush ucu.
> • FAZ3-3 renk çarkı + paletleyici OKLCH/OKLab'da (`09-palette-wheel.js`,
>   `31-ink-ui.js`); eski hsvToHex/hexToHsv silindi.
> • Testler: `scripts/ink-color-test.js` 42/42, `scripts/ink-palette-test.js`
>   22/22.

**Sorun:** Kod tabanında `linear/gamma/oklab/display-p3` **sıfır hit**. Tüm karışım gamma-kodlu 8-bit sRGB + HSL:
- smudge reservoir (28:590–591), dab pixel loop (28:624–626), wet-edge (28:1137–1139 `rgb.l*=0.48`), renk dinamikleri (HSL, 28:1107–1132), dual-brush (28:1196) — hepsi "muddy" üretir.

**Yapılacaklar:**

1. `src/renderer/core yeni: 56-ink-color.js` - **tek transfer çifti**:
   ```js
   const SRGB_TO_LIN = c => { c/=255; return c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
   const LIN_TO_SRGB = c => 255*(c<=0.0031308 ? 12.92*c : 1.055*c**(1/2.4)−0.055);
   ```
   + Ottosson OKLab (linear sRGB ↔ OKLab, ±0.015625 borderline düzeltmeleri dahil).
2. Karışım noktaları linear-light'a taşınır (sırayla):
   smudge reservoir → dab mixing → wet-edge → renk dinamikleri (HSL yerine OKLCH: hue dönüşü L-corundechroma korunarak) → dual-brush blend.
3. **Renk çarkı** (31-ink-ui.js + 09-palette-wheel.js): SV üçgeni OKLCH Lire; paletleyici OKLCH histogram + α-ağırlı k-means (k≈10) karışımı.
4. `getContext('2d', { colorSpace:'srgb' })` **explicit**; wide-gamut bu faza girmeden.

**Testler:** kırmızı+sarı örneği gibi altın-vektör karışım testleri; paletleyici çıktı çarkı regreasyon testi mevcut.

**Effort: ~3 gün.**

---

## FAZ 4 — KAS: Worker Tile Engine + Tile-diff Undo

> **DURUM (2026-11-04, FAZ4-1): TILE KANONU TAMAMLANDI ✅**
> • `57-ink-tile-canon.js` yazıldı — plan madde 1'in temel altyapısı:
>   256×256 px karo; depo RGBA8 (tuval/karonun kendisi), RAM aynası
>   **premul lineer Float32** (1 MB/karo; 8-bit sRGB ile aynı veri).
>   Çekirdek fonksiyonlar DOM'suzdur (`readVolume`/`writeImageData`
>   kapıları) — saf Node'da altın örneklerle test edilir.
> • API: `inkCanonMirrorTiles` (aynala), `inkCanonDiffTiles`
>   (changed tile listesi; commit→ayna tazeler, beforeLin korunur),
>   `inkCanonFlushTiles` (lin→sRGB ≤1 LSB), `inkCanonInvalidate/Clear`,
>   `inkCanonStats`. LRU havuz: `INK_CANON_MAX_TILES = 64` (≈64 MB
>   RAM kanonu, undo 64 MB LRU ile aynı politikada), Map ekleme
>   sırası = dokunuş sırası; aşım en eskisi düşer.
> • Test: `scripts/ink-tile-canon-test.js` — **26/26** (karo kaplaması,
>   premul lineer semantik, 640×384 aynala→akıt birebir, diff
>   algılama+tazeliği, LRU dokunuş/kapasite, katman ömrü).
> • Sıradaki parçalar (aşağıda maddeler 2–6): 34'te attached undo
>   tile-diff (madde 5); worker'a wetEdges/gürültü/colorDynamics/çift
>   fırça dinamik taşınıp gate risk profiline bağlanır (madde 2/6);
>   smudge advected field (madde 3); editor önizleme dirty-tile (madde 4).
>
> **DURUM GÜNCELLEME (2026-11-04, FAZ4-5):** attached vuruş undo'su
> tile-diff modeline taşındı (madde 5):
> • Capture tek bölge okuması kalır (tek getImageData); kayıt karo
>   sınırlarına dilimlenir (`inkUndoRegionTileSlices`) ve öncesi durum
>   kanon aynasına yedeklenir (`inkCanonPatchFromRegion` — karo aynası
>   yoksa tam karo tek kez okunur; bölge dışı içerik korunur).
> • Geri al `inkUndoApplyRaster` dilimleri putImageData ile yazar
>   (tek büyük blok yerine parça yazım); yinele sonrası ayna
>   `inkUndoReflectRedo` ile yeniye eşleşir.
> • Kanon'a bölge kapıları eklendi: `inkCanonRegionSlices`,
>   `inkCanonPatchFromRegion`, `inkCanonDiffFromRegion` (post-diff,
>   değişen dilim listesi). Test: `ink-tile-canon-test.js` **31/31**
>   (bölge dilimleme, patch/diff döngüsü, tam-karo yedek akıtma).
> • Ek onarım (FAZ 2 artığı): `36-ink-editor.js` mouseSim dalı `const
>   pressure` yeniden atıyordu ("Assignment to constant variable" —
>   editor yolunda tween her pointer move crash'i) ve `ink.pressureCurve`
>   tanımsızdı → `let pressure` + `inkState().pressureCurve`.
>   `ink-commit-check` 5/7 → **7/7**.
> • Test: `test:compositor` **24/24**, `smoke-test` ✅,
>   `test:projects` **39/39**, `npm test` zinciri yeşil.
>
> **DURUM GÜNCELLEME (2026-11-04, FAZ4-2/6 BÖLÜM 1):** kalıcı 3 kırmızı,
> kök nedeni ölçümle kesinleşmiş, ikisi kapanmış:
> • **Kök neden 1 — dabRound paritesi:** worker damlayı tam daire
>   çizerken senkron motor basınçla yassılaştırıyordu
>   (`minRound = 0.05 + (1-0.05)·p`); `px ≈ tam_disk·dabRound`
>   ölçümü tanımlayıcıydı (h90·p0.2: sync 64px / worker 284px).
>   `ink-worker.js` dab döngüsüne birebir `dabRound` matematiği
>   (channel 10 strokeRandom dahil) eklendi; `drawTiltedStamp` artık
>   `dabRound` alıyor. Tek damla A/B kalıntı farkı %1-2.
> • **Kök neden 2 — stabilizer bırakma kesilmesi:** sentetik/çok hızlı
>   olay dizilerinde (dt≈0) One-Euro hedefe yetişemiyor; pişen iz ham
>   bırakma noktasının gerisinde kesiliyordu (soft span 191/480,
>   eraser 0.28→0.38). Flush'un **yalnızca finalize kolunda** yapılması şart:
>   commit, `inkEditorRebuildPreview(true)`'ın döndürdüğü rasterı
>   katmana kopyalıyor — flush'u pointerup'a koymak yakalama ile bit
>   paritesini bozuyordu (commit-check 0 farklı kanal şartı). Nihai
>   tasarım: tahta yolu `inkCatchUpFreehand` (pointerup,
>   `30-ink-tools.js`) ve editör yolu `inkEditorCatchUpStroke`
>   (yalnızca `finalize=true` dalı, `inkEditorRebuildPreview` içindeki
>   `inkEditorCatchUpStroke()`; idempotent — ilk yakalama + commit aynı
>   flush'u görür, `ui.lastRaw/lastPressure/lastTilt` state'ten okur).
>   Hareket kuyruğu çıkarımını önlemek için `inkEditorFeedSegment`
>   yardımcısı `inkEditorMoveSample` kuyruğundan çıkarıldı.
> • Test: `ink-smoke` **228 → 231/231** (üçü de) — worker raster
>   taper paritesi, yumuşak span, modal silgi merkez-alfa 0;
>   `ink-commit-check` **7/7** (bit parite), `smoke-test` ✅,
>   `compositor` **24/24**, `projects` **39/39**, tile-kanon **31/31**.
> • **Kalan FAZ4-2/6 işi:** worker'a wetEdges/noise/colorDynamics/smudge
>   taşınması ve `brushUnsupportedDynamics` (35 ~176-197) listesinin
>   risk profili geçişine dönüşmesi; smudge advected field (madde 3);
>   editor dirty-tile önizleme (madde 4).
>
> **DURUM GÜNCELLEME (2026-11-04, FAZ4-2/6 BÖLÜM 2 — dinamik taşıma
> TAMAMLANDI ✅):** worker `drawStroke` senkron `inkDrawStrokeOnContext`
> ile birebir yeniden yazıldı; gate risk profiline dönüştü.
> • **Worker native uç renk bug'ı kapandı:** native/prosedürel uclar
>   beyaz maske; worker `tintedTip()` (source-in fill + 64 LRU)
>   ile damla rengine boyar — diag merkez RGB worker `[255,255,255]`
>   → `[51,204,255]` (sync `[50,204,255]`, ≤1 LSB).
> • **OKLCH hattı worker'a porte edildi** (`ink-worker.js`, 56
>   birebir): sRGB↔lineer LUT'lar, gamut sıkıştırma, hex↔OKLab/OKLCH,
>   `inkOkLchToBytes` (ikinci/etkin tanım). Renk dinamikleri
>   (`prepareStrokeColor`/`dabStrokeColor`, kanal 32-35) ve wetEdges
>   (`wetEdge`, L*0.48, a·strength·0.55, ellipse stroke) per-damla
>   aynı rengi üretiyor.
> • **Dab döngüsü kanal şeması sync'ileştirildi:** randomIndex =
>   dabIndex·16 + stampIndex; `dyn.src 'random'` ch8, sizeJitter ch9,
>   dabRound ch10 (önceden düzeltilmişti), scatterCount(+Jitter) ch11,
>   flowJitter ch2, opacityJitter/opacitySrc ch12, texture grain ch13
>   (randomIndex'te — önceki davada dabIndex'ti), scatterX/Y ch0/1
>   (alan-uniform + eşit eksen halka dalı), scatterJitter ch14,
>   airbrush ×0.14, brush.noise
>   `textureNoise(x·0.73+ri, y·0.73−ri)`, textureEachTip 0-override
>   (grain x/y'ye 0), damga önbelleği anahtarı renk bazlı
>   (variant|bucket|color).
> • **Dual birebir:** `dual.blend` composite op (multiply default),
>   `dual.spacing` >1 every-N (% ri) / <1 prevMapped interpolasyon
>   (ri·16+step), `dual.angle` offset; `dual.brushId` job'a taşınır
>   (native uç worker'da üretilir — makeNativeTip + tintedTip; abr
>   dual gate'te kalır). Dual uç ölçek yolu sync'le aynı: kova
>   normalizasyonu yok, uç doğrudan 2·dr'e çizilir.
> • **Gate yeniden yazıldı** (`35-ink-worker.js`): worker artık
>   tüm fırça dinamiklerini (noise/wetEdges/airbrush/scatterX-Y-Count-Jitter/
>   dyn.src random, sizeJitter, roundnessJitter/Min,
>   opacityJitter/src, renk dinamikleri, dual blend/spacing/angle/brushId)
>   üretiyor → gate yalnızca `.abr` (bitmap doku), angleFollow ve
>   `dual.brushId → .abr` kombinasyonunu senkron yolda tutuyor.
>   `buildUp === false` gate'ten çıkarıldı (sync raster'a etkisiz).
> • **Test:** `ink-smoke` yeni kontrol "worker dinamik fırça rasterı
>   senkronla bayt birebir eşleşiyor" — dinamik yüklü test fırçası
>   (noise+wetEdges+airbrush+eksenli saçılma+scatterCount+OKLCH renk
>   dinamikleri+random boyut/yuvarlaklık/opaklık+tipVariants/çevirme/
>   dönme+native dual multiply) worker↔sync PNG hash **birebir**.
>   `ink-smoke` **232/232**, `ink-commit-check` **7/7**, `compositor`
>   **24/24**, `smoke-test` ✅, `projects` **39/39**, tile-kanon
>   **31/31** — tam zincir yeşil.
> • **Kalan FAZ4-2/6 işi:** smudge advected field (madde 3, worker'a
>   taşınacak son büyük blok); editor dirty-tile önizleme (madde 4).

> **DURUM GÜNCELLEME (2026-11-04, FAZ4-3): SMUDGE ADVECTED FIELD
> WORKER'A TAŞINDI ✅** (madde 3 tamam)
> • Worker `drawSmudge(x0..y1 bölge-local)` porte edildi:
>   kutu matematiği (`floor/ceil` + `radiusMax + 2` pad + clamp),
>   1024 çözünürlüklü radialMask (`edge·edge·(3−2·edge)`), 9-örneklik
>   LINEER pickup (`offsets [-0.5,0,0.5]²`, `radius·0.22`,
>   konum `previous + (c−previous)·0.25`), reservoir mix
>   `clamp(0.08 + flow·0.12, 0.08, 0.2)`, `dabStrength =
>   strength·pressure·(1 − strokeRandom(s,dabIndex,2)·flowJitter)·k`
>   ve `inkDabOverChannel` lineer karışım — ana thread
>   `inkDrawSmudgeOnContext` (28:492–625) birebir.
> • Bölge == senkron smudge kutusu şartı: 35'te smudge için
>   `scatter = 0` zorlandı → plan pad `sizePx/2·(1+0)+2` =
>   `radiusMax + 2` = senkron kutu. Böylece region-local koordinatlar
>   senkron box-relative değerlerle tam eş; kenar clamp'leri aynı
>   konumlara düşer. `inkSplitRasterPlans` smudge'da `null` döner
>   (advected alan reservoir'i chunk'lar arası taşınamaz); aşırı
>   büyük bölge → `workerCapable` sınır değerlerinde senkron yola düşer.
> • Worker `forEachDab`'e `continuousSpacing` dalı porte edildi:
>   `spacingRemainder`/`lastContinuousPoint` izleme, br-reset,
>   final last-point (k ≤ taper(totalLength)) — smudge aralığı artık
>   yol boyunca sürekli takip eder (ana thread `inkForEachDab`
>   28:265–388 birebir; pa/pb/ta/tb tanımı continuous dalından önce).
> • `inkLinData` (kesirli giriş bitişik LUT lerp) + worker
>   `inkDabOverChannel` + paylaşılan `dabRadius` (28 `inkDabRadius`
>   998 birebir; sync `inkBrushDynamics` normalizasyonu dahil)
>   worker'a eklendi.
> • 35'te smudge alanı: `useWorker` kapısı smudge'e açıldı,
>   msg'e `brushHardness = (brush && brush.hardness) || 0.72`
>   (28 sömantüği: sertlik 0 da 0.72'e düşer) eklendi, `plan.strokeKind`
>   saklandı.
> • **Test:** `ink-smoke` yeni kontrol "worker smudge advected alanı
>   senkronla bayt birebir eşleşiyor" — üç bloklu renk zemini
>   (+%50 alfa bandı) üzerine sabit smudge vuruşu
>   (size 0.08 · hardness 0.4 · spacing 0.2 · flow 0.5) worker↔sync
>   PNG hash **birebir** (375862px ↔ 375862px, hash 398159756). `ink-smoke` **233/233**, `compositor`
>   **24/24**, `ink-commit-check` **7/7**, `smoke-test` ✅,
>   `projects` **39/39**, tile-kanon **31/31** — tam zincir yeşil.
> • **Kalan FAZ4 işi:** editor dirty-tile önizleme (madde 4, FAZ4-4).

> **DURUM GÜNCELLEME (2026-11-04, FAZ4-4): EDITOR ÖNİZLEME KİRLİ KUTU
> BİRLEŞİMİ ✅** (madde 4 tamam — FAZ 4 tamamlanmıştır)
> • Eski yol: tam raster kolu (finalize + smudge/gradyan/kova/şekil,
>   36 `inkEditorRebuildPreview`) **her karede** `clearRect(tüm) +
>   drawImage(katman tümden)` yapıyordu (O(katman) · kare) — 4K tuvalde
>   ~33 MB/kare kopya. Yeni yol: `inkEditorFullRasterRect` yalnızca
>   vuruşun dokunduğu bölgede `clearRect + drawImage(kaynak rect →
>   hedef rect)` yapar; kutu dışı scratch içeriği `inkEditorEnsureScratch`'in
>   başlangıç katman kopyasıdır (vuruş boyunca kalıcı katman değişmez)
>   → kutu dışı = katman, bit birebir korunur; finalize'da `layer ←
>   clearRect(tüm) + drawImage(finalPreview)` zinciri olduğu gibi
>   kopyaladığından ekran==commit paritesi bozulmaz.
> • Kutu üst sınırı damla erişimiyle eşleşir: smudge kendi kutusu
>   (`sizePx/2 + 2`, 28:508–511 ile özdeş — bölge==kutu FAZ4-3 şartı),
>   damla yolu `(sizePx/2)·(1 + max(stroke.scatter, brush.scatterX/Y))
>   + 2` (+ dual kickoff `(sizePx/2)·(2+dual.scatter)·clamp(scale,
>   0.1,4)`, 28:1147–1190 erişimi), şekil `sizePx·1.5 + 12`
>   (highlight lineWidth 2.2·sizePx, ok başı lw·4.2), kova/gradyan tam
>   tuval (flood taraması ve createLinearGradient fillRect tüm
>   tuvali kaplar). sizePx `Math.max(1, sizePx||1)` ile 28 dahili
>   normalize sömantiği eşleşir.
> • **Test:** mevcut parite koruması yeşil — "canlı önizleme
>   bırakılan rasterla piksel piksel aynı → 0 farklı kanal"
>   (finalize kolonu, damla yolu), "editörde parmak gerçek pikselleri
>   sürüklüyor ve önizleme commit ile aynı" (smudge kolonu),
>   "editörde gradyan önizlemesi commit ile aynı" (gradyan tam-kutu
>   kolonu), kova dolgu testi. `ink-smoke` **233/233**, smoke-test ✅,
>   compositor **24/24**, `ink-commit-check` **7/7**, `projects`
>   **39/39**, tile-kanon **31/31** — tam zincir yeşil.

**Sorun:** Offload gate `dabs>=2400` (35:20); su-boya/wetEdges/noise/scatter/dual-blend/colorDynamics fırçaları gate'i tersine **sync path'e geri düşüyor** (35:173–199) → ana thread'de 1000+ CPU dab/frame = donma. Smudge stroke-bbox tek `getImageData` (≤8MP, 28:415) = 32 MB tek blok GC bezdirisi; editor önizleme `fullRaster` her karede (36:2336–2340).

**Yapılacaklar:**

1. **Tile kanonu**: 256×256 px, RGBA8 görüntüde / premul-linear Float32 ram'de; tile eviction LRU.
2. **Her fırça tipi worker-capable**: gate dabs sayısına değil risk profiline bakar; su-boya diffusion **per-tile worker pass**.
3. **Smudge = advected vector field**: bilinear pickup (önceki konum × flow yönü), linear-light reservoir; per-stroke tile-diff.
4. **Editor önizleme**: `fullRaster` yerine dirty-tile-only yeniden birleştirme.
5. **Undo RAM kanunu**: normal vuruş = **tile-diff** (değişen 64KB tileler, dışa thread'de WebP/brotli sıkıştırma); snapshot yalnızca ağır işlemler (kanvas resize, grup flatten). RAM üst sınırı, aşımında IndexedDB disk yedekleme.
6. Worker'da su-boya kerneli: mevcut davranışın tile-paralel yeniden yazımı (davranış eşliği golden-image testiyle).

**Testler:** `35-ink-worker` mevcut testleri + yeni uzun-vuruş donma yokluğu ölçümü (sentetik 5000-dab su-boya atışı, main-thread block <16 ms hedef).

**Effort: ~5–7 gün. En büyük faz.**

---

## FAZ 5 — UI: Options Bar + Tool Manifest

**Sorun:** Araçları inceltتن options setleri dağınık (31-ink-ui).

**Yapılacaklar:**

1. `TOOL_DEFS` manifesti (id/group/icon/shortcut/tooltip) + `OPTIONS_SCHEMAS` (declarative widget seti: size/range/toggle/select/brushTipPicker).
2. Üst çubuğun altına 28–32 px **contextual options bar** — seçili aracın şeması render edilir.
3. 7 flyout araç kümesi: Seçim / Dönüşüm / Boyama / Dokunuş / Silme / Şekil / Asistan.
4. Daralma kırılımları (mevcut shell kırılım tablosuyla aynı prensip): 1400+ → 5 grup; 800– → `⋯` overflow.
5. Mevcut `48-shell.js` kırılım tablosuna uyumlu davranış.

**Testler:** mevcut `_dock-resize-probe.js` kalıbıyla options-bar daralma testi.

**Effort: ~3–4 gün.**

> **DURUM GÜNCELLEME (2026-11-04, FAZ5): OPTIONS BAR + TOOL MANIFEST ✅**
> (madde 1–3 tamam — kalan assist flyoutu, aşağıda)
> • **Manifest:** `src/renderer/core/58-ink-tool-manifest.js` (build-app otomatik
>   keşif, 53. kaynak). `INK_TOOL_GROUPS` (7 küme: select/transform/
>   paint/touch/erase/shape/assist) + `INK_TOOL_DEFS` (id/group/icon/
>   label/shortcut/tip; çubukta doğrudan duran araçlar `data-tool`
>   düğmeleridir — `#v5Toolbar` innerHTML FAZ5'te yalnız caret + shape
>   genişletmesiyle büyüdü, mevcut [data-tool] seçicileri birebir
>   korundu) + `INK_OPTIONS_SCHEMAS` (range/toggle/select/
>   brushTip/color widget türleri; değerler doğrudan `inkState()` alanına
>   bağlanır — pct alanlar 0–100 input × 0.01, `fillTolerance` 0–255 raw).
>   API: `inkToolGroupOf` / `inkToolOptionsSchema` / `inkToolLabel`.
> • **Options bar:** `draw-v5.js` içi `#v5OptionsBar` modülü — araç
>   çubuğunun altına kenetlenen 44 px hap (`syncOptionsBarPosition`:
>   `buildToolbar`/`bindToolbarDrag` move/`applyToolbarPosition`/
>   `avoidModeBarOverlap` sonlarından beslenir). Widget'lar panele
>   paralel yazma davranışıyla `inkState`'e yazar (31-ink-ui `bindRange`
>   semantiği: fırça-üstüne-yazma + `inkPreviewBrush`/`inkUpdateHud`/
>   `scheduleSave`). Panel→bar ters senkron: 31-ink-ui `bindRange` input
>   handler'ına ve `inkSyncUI` sonuna `window.__v5OptSync()` kancası
>   (draw-v5 yüklenmemişse guard'la noop).
> • **Taşma deseni:** 18-toolbar-layout ölçüm döngüsü (`scrollWidth >
>   clientWidth+1`), sığmayan son widget'tan geriye `.is-overflowed`
>   → `⋯` `.v5-opt-more` menüsüne taşınır; menü kapanınca widget'lar
>   `insertBefore(more)` ile çubuğa geri döner ve ölçüm yeniden koşar
>   (dar ekranda tekrar taşınması beklenen davranış). `syncOptionsBar`
>   her senkronda yeniden ölçer → resize kırılımları anında düzelir.
> • **Escape yakalama notu:** app.js'in document yakalayıcıları
>   keydown'ı yutuyordu; `optMenuKeys` window yakalama evresinde
>   dinleniyor (window, document-yakalayıcılarından önce koşar).
> • **Kırılım:** body.v5-w-compact (700–) etiket/değer/tool-adı gizli,
>   range 72 px; v5-w-narrow (·) satırlar 32 px. Probe:
>   `scripts/options-bar-test.js` (CDP, `_dock-resize-probe` kalıbı) —
>   **20/20 ✓** (mod geçişi, şema değişimi brush→smudge→gradient,
>   range→inkState yazımı=77, smudge flow 0.32 korunumu, kalem caret
>   menüsü, toggle boolean yazımı, şekil düğmesi+select, taşma/geri
>   dönüş, geniş ekranda temizlenme).
> • **Kapı zinciri:** build-app (53 kaynak) ✓ · compositor 24/24 ·
>   ink-commit 7/7 · smoke-test ✅ · ink-smoke 233/233 · projects 39/39 ·
>   tile-canon 31/31.
> • **FAZ5-küçük-işler TAMAMlandı (aynı gün):** fırça grubuna Boyama
>   caret'ı (Fırça/Kalem menüsü, `openPaintMenu` — kalem artık v5
>   çubuktan seçilebilir); çubuğa `data-tool="shape"` düğmesi (kendi
>   `is-active` eşlemesi; fırça düğmesi artık yalnız brush+pencil
>   için yanar); PATHS'e `pencil` ve `shape` ikonları eklendi.
>   Toggle widget'ına ilk müşteri: `mouseSpeedPressure` (fırça ve
>   kalem şemaları) — probe'ta boolean yazımı doğrulandı.
>   Probe 20/20; kapı zinciri (24/24 · 7/7 · ✅ · 233/233 · 39/39 ·
>   31/31) yeniden yeşil.
> • **Kalan:** assist kümesi (text/eyedropper) için ayrı flyout —
>   düşük öncelik; ikisi de seçenek şeması boş araçlar.

---

## FAZ 6 — UX: Endüstri Benchmark Ayarı (endüstri benchmarkları)

> **Kaynak:** 2026-11-04 UI/UX mimarlık denetimi (plan dışı
> ek faz). Denetimde doğrulanan temel: PS-uyumlu kas hafızası kısayolları
> (`[`/`]`, Alt+tekerlek boyut, Alt geçici damlalık) zaten motor
> tarafında (30-ink-tools.js:1635–1683); FAZ 5 options bar taşma/daralma
> desenleri mevcut. FAZ 6 bu arayüzü son aşamaya taşır.

### TASARIM SÖZLEŞMESİ (FAZ 6'daki her değişikliğe uygulanır)

> İlham: referans uygulama sadeliği + HIG deference — her şey el altında,
> hiçbir şey göze batmayacak kadar kalabalık değil; görünüm referans uygulama'nın
> tanıdık dark charcoal dilinde kalır.

1. **SINIRLAR (bounds):** Hiçbir menü/popover pencere geometrisinin
   dışına taşamaz. Sabit kural: açılış konumu `clamp` ile pencereye
   hapsedilir (ortak `keepInViewport` yardımcısı, A8); her yeni panel
   için ekran görüntülü taşma testi zorunlu (probe kanalı: D-17).
2. **Net durum gösterimi (affordance):** Her düğme `is-active` +
   `aria-pressed`/`aria-checked` ile mutlak net olur; araç başına
   yalnız BİR ışık yanar. Aktif: accent çerçeve + %18 dolgu; 
   hover: `--v5-hover`; basılı: hover'ın koyusu (`:active`);
   disabled: %40 sönük. (A7 üçlü durum standardı; A6 tek-ışık.)
3. **Ergonomi:** Çekirdek eylemler (boyut, opaklık, renk, geri al)
   minimum el hareketiyle erişilir; gereksiz tıklama/alt menü yok.
   Araç geçişi tek tık; sık toggle'lar (alfa kilidi, simetri,
   seçim modları) üst çubukta.
4. **Defere + aşamalı açılım (HIG):** Arayüz tuvale yenik
   düşer — üst çubuk minimal ve zarif kalır; gelişmiş ikincil
   ayarlar istenene kadar render edilmez (options bar taşması `⋯`
   progressive disclosure olarak kullanılır).
5. **Tanıdıklık (familiarity):** Standart modern dark charcoal
   (koyu mod sadeliği + referans uygulama profesyonel dili);
   sıra dışı/egzotik tema YOK. Yeni her kontrol mevcut `--v5-*`
   token'larıyla (`--v5-panel/border/accent/r-pill/shadow`) yapılır.
6. **Telif / temiz-oda (2026-11-05, kullanıcı yönergesi):** Üçüncü
   taraf uygulamalar (benzer masaüstü çizim uygulamaları vb.) yalnızca DAVRANIŞ
   referansıdır — nasıl davrandığı gözlemlenir, o davranış kendi
   mimarimizle ÖZGÜN yazılır. Kod kopyala-yapıştır YASAK;
   identifier/const/formül düzeyinde çeviri yapılmaz. Dahili
   `docs/reference/*.js` dosyaları (ör. Björn Ottosson OKLab
   dönüşümleri, MIT) yalnızca DOĞRULAMA referansıdır ve derleme
   zincirine ASLA dahil edilmez. Kullanıcıya görünen hiçbir UI
   metni/metaveri üçüncü taraf adı TASMAYAR (uygulama içi adlar
   nötr adlandırılır; geliştirici yorumlarında referans notu
   serbesttir). Her referans kaynaklı madde için regresyon
   kanalı (*-test.js) bu maddenin kanıtıdır.

### A. Hızlı kazanımlar (motor hazır; yalnızca UI bağlanır) 

*Effort: her madde ~0.5–1 gün; kapı zinciriyle aynı turda gezilir.*

1. **Alfa kilidi üst çubuk düğmesi** — Motor hazır (`stroke.lockAlpha`
   29/28/tile/worker dahil); düğme yalnızca katman paneli satırında
   (31-ink-ui.js:1642). Toolbar + options bar'a toggle ekle:
   `currentLayer().alphaLock` ters çevir + `syncToolbar` +
   `scheduleSave` + katman defteri tazeleme.
2. **Renk geçmişi üst çubukta** — `v5Recents` renk panelinin
   içinde; küçük swatch şeridi olarak options bar'a taşı (tıkla→renk).
3. **v5 kısayol kapısı** — B/P/E/I/L/M/U/V/T `30-ink-tools.js:1647`
   haritada var ama `inkInlineModeActive()` v5 modunda kapalı
   kalabilir; v5 modunda doğrula, kapalıysa `bindShortcuts`'a bağla.
4. **Boş options şemalarını doldur** — `transform/marquee/lasso`
   `[]`: transform'a gizmo değer bilgi satırı; marquee/lasso'ya
   "Seçimi bırak" düğmesi. text/eyedropper boş kalabilir.
5. **Maske düzenleme rozeti** — `inkDocToggleMaskEdit` açıkken
   options bar'da "MASKE" rozeti, hedef belirsizliğini kapatır.

**A+ · Denetim ilavesi (2026-11-04 ikinci tur; aynı tura katılır):**

A6. **Tek-ışık düzeltmesi** — `syncToolbar`: `const brush =
    tool === 'brush'` (kalem yalnız caret vurgusu + paintGroup
    `is-active`), options bar "Kalem" etiketiyle birleştirin.
A7. **Durum sistemi CSS'i** — `.v5-tool/.v5-icon-btn` üçlüsüne
    standart `:hover` (`--v5-hover`), `:active` (hover'ın koyusu),
    `.is-active` (accent çerçeve + %18 dolgu), `:disabled`
    (%40 sönük); QSS `:checked/:hover/:pressed/:disabled` mutabakatı.
A8. **Popover hapsi yardımcısı** — ortak `keepInViewport(panel,
    anchor)` (clamp'li); `openMenu`/`openOptionsOverflow` buna
    taşınır, yeni paneller bunu kullanır (sözleşme madde 1).
A9. **Kompakt bağlamsal hap** — options bar pencerenin tamamını
    dolduran şerit değil: `max-width: min(100vw-32, 860px)` tavanı;
    manifest öncelik sırası (Uç-Boyut-Opaklık-Alfa kilidi) taşmada
    önce görünür kalanlar, gerisi `⋯` aşamalı açılımında.

> **DURUM — A kümesi ilk tur uygulandı (2026-11-04):** A1 + A6 +
>   A7 + A8 bitti; kapı zinciri yeşil (compositor 24/24 · commit 7/7 ·
>   smoke ✓ · ink-smoke 233/233 · projects 39/39 · tile-canon 31/31 ·
>   options-bar probe 23/23).
>   • A1: toolbar `data-action="alpha-lock"` düğmesi + options bar
>     `alphaLock` widget fabrikası (`buildOptionAlphaLock`, katman
>     alanına yazar) + manifest şeması 6 araca (brush/pencil/eraser/
>     fill/smudge/gradient) eklendi.
>   • A6: `syncToolbar` tek-ışık (`brushBtnOn = tool==='brush'` +
>     `paintGroup` grup vurgusu).
>   • A7: `:hover/:active/.is-accent-çerçeve/[disabled]` standardı
>     `draw-v5.css` toolbar bloğuna işlendi (grup çocuğuna çerçeve
>     basılmaz).
>   • A8: `keepInViewport(panel, anchor, {alignRight,left,top})`
>     helper; `openMenu` + `openOptionsOverflow` buna taşındı.
>     Ek: pencere/emülasyon boyut değişiminde `ResizeObserver`
>     (`documentElement`, rAF debounceli) options bar ölçümünü
>     tazeler — resize olayı son düzeni kaçırdığında hiçbir widget
>     `⋯` durumunda takılı kalmaz.
>   • Probe bulgusu: 1500px'te 8 kontrollü fırça şeması gerçekten
>     sığmaz; bar son widget'ı `⋯`'ye devreder (sözleşme 4 progressive
>     disclosure). Geniş-kontrol testi 1700px'te koşulur + "kırpılan
>     içerik yok" (`scrollWidth==clientWidth`) güvencesi eklendi.
>   • Sözleşmeye HIG ilavesi: ergonomi (3), deference + aşamalı
>     açılım (4), dark charcoal tanıdıklığı (5).
>   • **A9 eklendi + uygulandı:** kullanıcı denetiminde çubuk
>     pencereyi dolduruyordu; `max-width: min(100vw-32, 860px)`
>     tavanı + manifest öncelik sırası (brush/pencil'de alfa kilidi
>     sık kontroller arasına öne alındı). Probe 24/24: bar 763px,
>     sağda 544px nefes payı, kırpılan içerik yok, kapı zinciri
>     (compositor/commit/smoke/ink/projects/tile) tamamı yeşil.
>   • **A2 eklendi + uygulandı:** renk geçmişi şeridi options bar'a
>     ayrı eleman olarak taşındı (`#v5OptRecents`, `.v5-opt-recents`);
>     panel kopyasıyla ortak kaynağı `fillRecents(host, limit)`.
>     Şerit taşma `⋯`'ye KATILMAZ (fazla widget değildir) ve
>     `body.v5-w-narrow` altında gizlenir. Probe 26/26 (9. ve 10.
>     kontroller: şerit var + swatch tıklaması renk uygular/is-current
>     kayar). Kapı zinciri yeşil.
>   • **A10 eklendi + uygulandı (2026-11-04):** renk çarkı doğruluğu —
>     artist arkadaşın canlı regresyonundan iki bulgu:
>     (a) "her rengin doğru olmadığı" — kök: kanal-klamp koyu doygun
>     mavi/magenta'da hue'yi 19–20° mora sürer (Ottosson "gamut
>     clipping" vakası; K–P ışını koyu mavi yönünde sRGB'den taşar)
>     + K–P kenarında v==s ±1 ULP sapan örneklerin eski v<s dala
>     düşmesi (hue-yanlış fallback). (b) "katman ayarlarıyla yapılan
>     üçgen-dışı rengin göstergesinin panel dışında yer göstermesi" —
>     kök: hex→state üçgen-dışı (v<s / s>1) durum üretiyor +
>     biseksiyon hücre-sınırında sabitleyemeyip hex-kuantalama
>     gürültüsüyle ±1° "hue yürüyüşü" yapıyor (57.4999 ↔ 56.5000;
>     60.5 → 61.5 → … zinciri).
>     Çözüm zinciri (Ottosson referansı `docs/reference/
>     ok-color-conversion.js` uyarlandı; public-domain yardımcılar):
>     `inkWheelMaxSaturation` + `inkWheelCusp` → üçgen cusp pusulası
>     (köşe klasik HSV saf tonunda KALIR — halka kimliği/PS-uyumu);
>     `inkWheelOkLchInGamut` (±0.002 tolerans: 8-bit kararlı karar,
>     jilet-örneklerde ±1e-6 bayt-arası sallanıyordu) +
>     `inkWheelStateToHex` bisect chroma tavanı (hue/L korunur) +
>     `v + 1e-9 ≥ s` eşitlik payı; `inkHexToWheelState` 3-adım
>     OKLCH-L-corunumlu kenar-projeksiyon (s→[0,1] → K–P → W–P);
>     `inkWheelHueFromOkHue` biseksiyon yerine 360-köşe argmin
>     lattice (sabit nokta garantisi); `inkWheelClampStateStable`
>     31-ink-ui.js 3 state-yazma noktasına (inkSyncColorWheel /
>     inkOpenColorWheel / inkWheelApplyHex) bağlandı. Sonuç: tutamaç
>     asla üçgen dışına çıkamaz; gösterilen = seçilen.
>     Kanıt: `scripts/color-wheel-audit.js` 6/6 (21840-örnek grid;
>     kaçış=0; ikinci-geçiş sabit max kayma 0.0175 ≤ 0.02; üçgen-içi
>     max Δ 0.0050 ≤ 0.012; cusp gap −0.0017 tolerans-üstü yok),
>     `scripts/ink-color-test.js` 42/42, kapı zinciri tam yeşil
>     (compositor 24/24 · commit 7/7 · smoke ✓ · ink-smoke 233/233 ·
>     projects 39/39 · tile-canon 31/31 · options-bar probe 26/26 ·
>     build-app 53 kaynak clean).
>   • **A3 uygulandı (2026-11-04):** v5 kısayol kapısı markasında
>     DOĞRULANDI — kod değişikliği GEREKMEMEDİ. Kök: `modeEnterDraw`
>     tek noktadan `inkEditorOpen`'a bağlı (39:173-175); editör açık
>     → `inkInlineModeActive()` v5 modunda true → 30-ink-tools.js
>     araç haritası (b/p/e/i/l/m/u/v/t) + `[`/`]` oranlı boyut adımı
>     + U şekil döngüsü aynen çalışır. `44-ink-workspace-controls`
>     yakalayıcısı motor-defaultları bırakır (42:158 INK_WS_ENGINE_
>     DEFAULTS eşleşmesinde return) — çakışma yok. Referans moduna
>     kısayolların tahtaya etmemesi de aynı kanıtlada doğrulandı.
>     Kanıt: `scripts/ink-shortcut-test.js` 14/14 (gerçek Electron
>     penceresinde: 10 araç-anahtar + U döngüsü + [ ] adım +
>     referans-modu izolasyonu). Not: `[`/`]` adımı oranlıdır
>     (%12, >=20px'te max 2) — 40→45→35 beklenirdir; probe
>     eşitlik-varsayımı düzeltildi (tasarım davranışı).
>   • **A5 uygulandı (2026-11-04):** maske düzenleme rozeti — options
>     bar, `inkState.maskEditId` açıkken sağda "MASKE · <katman-adı>"
>     rozeti yakan; tıkla → `inkDocToggleMaskEdit` ile düzenlemeyi
>     bırak. Sözleşme 2 uyumu: durum ışığı tek (rozet), aria-pressed,
>     `display:inline-flex` `[hidden]` çakışması ayrıca `:hidden`
>     kuralıyla çözüldü (rozet gizliyken bar genişliğini 36px
>     şişiriyordu — A9 tavanı 890px'te ihlal etti; 854'e döndü).
>     Bağlı senkron zarfları: `inkDocAddMask` ve `inkDocRemoveMask`
>     artık `inkSyncUI()` çağırır (rozet menü yollarından anında
>     yanar/söner; maskAndAfterChange yolu UI sync koşmaz).
>     Rozet `──` taşmasına KATILMAZ (durum belirticisi, widget değil)
>     ve compact genişlikte yalnız ikon+MASKE etiketidir. Kanıt:
>     options-bar probe 29/29 (rozet: başlangıç gizli · maskEditId
>     açıkken yanar + hedefi adlandırır · tıkla-çık); kapı zinciri
>     yeşil (compositor 24/24 · commit 7/7 · smoke ✓ · ink 233/233 ·
>     projects 39/39 → tekrar koşuda yeşil, ilk koşum tek zamanlama
>     titremesi · tile-canon 31/31).
>   • **A4 uygulandı (2026-11-04):** boş options şemaları dolduruldu —
>     transform → `info` türü "Seçim" satırı: gizmo değerleri
>     (X, Y · W × H px, boşta "yok"); marquee/lasso → `action` türü
>     "Seçimi bırak" düğmesi (seçim yokken gizli). Widget fabrikaları
>     `buildOptionInfo` / `buildOptionAction` (draw-v5.js); manifest
>     veri safı kaldı (kind/id/label — draw-v5 haritalar). Motor
>     tek yol: `inkClearSelection()` (30) — Escape de artık onu
>     kullanır; `inkUpdateGizmo` (29) hem görünür hem gizli dalını
>     tamamlarken `window.__v5OptSync({ measure: false })` çağırır:
>     use değerleri ve düğme görünürlüğü sürükleme karelerinde günceller,
>     overflow ölçümü (layout tekrar) atlanır. CSS:
>     `.v5-opt[hidden]` display kuralı (UA [hidden] ezilmesi —
>     A5 rozetinde düzeltilen vakanın satır hâli) + action/info
>     stilleri. text/eyedropper şemasız "Bu araç için ek seçenek
>     yok" boş-hâl durumuyla kalır (plan gereği).
>     Kanıt: options-bar probe 32/32 (3 yeni kontrol: info boşta
>     "yok" · action seçim-yokken gizli seçim-varken yanar · tıkla→
>     inkClearSelection motor tek yol temizler ve söner), kapı
>     zinciri yeşil (compositor 24/24 · commit 7/7 · smoke ✓ ·
>     ink 233/233 · projects 39/39 · tile-canon 31/31 ·
>     ink-shortcut 14/14).

### B. Orta ölçek (motor işi ister)

*Effort: 1–3 gün/madde.*

6. **Seçim modları (Yeni/Ekle/Çıkar/Kesişim)** — motor yok (grep
   boş döndü): `inkState.selection` birleştirme semantiği + şema
   `select` widget + PS tarzı Shift/Ctrl basılı tutma.

      **DURUM B6 (2026-11-04, tamamlandı): seçim modları + widget +
      41/41 probe kanalı.**
      - Motor (30-ink-tools): `inkSelectModeOfKey` (Shift=Ekle,
        Alt/Ctrl=Çıkar, Shift+Alt|Shift+Ctrl=Kesişim),
        `inkSelectEffectiveMode` (geçici üstünlük yoksa kalıcı
        `ink.selectionMode`), `inkSelectionMerge` (tek birleştirme
        yolu: new=değiştir, add=birleşim eski sıra korunur, sub=boş
        parça seçimi korur, intersect=boş parça seçimi boşaltır).
        `inkFinishLasso`/`inkFinishMarquee`/`inkBeginTransformClick`
        merge'e bağlandı; `inkPointer.selMode` drag başında
        sabitlenir.
      - MASAÜSTÜ TUZAĞI (temsili): `inkOnPointerDown` Alt+drag'u
        pencere-taşımaya bırakan erken çıkış + Alt "geçici damlalık"
        kısayolu → Alt-bazlı tahta modları erişilemezdi. Çözüm:
        Ctrl=Çıkar, Shift+Ctrl=Kesişim takma adları (tahta + editör
        ortak harita). Probe modifiers 2 (Ctrl) ve 10 (Shift+Ctrl)
        ile koşar.
      - Editör (36): marquee/lasso Begin'de `ui.selMode` +
        `ui.marquee.mode`; Finish/iptal'de null'lanır; transform
        tıklama dalı mod duyarlı, boşluğa tıklama yalnız 'new'de
        temizler (PS kalıbı).
      - State (27): default `selectionMode:'new'` +
        sanitize (bilinmeyen → 'new'; literal mod listesi —
        eval sırası riski bilinçli).
      - Widget (58 + draw-v5 + css): marquee/lasso şemalarında
        `selmode` segmenti (Yeni/Ekle/Çıkar/Kesişim), A7 standardı
        (aria-pressed, tek `is-active` ışık), tıklama yazar
        selectionMode + `scheduleSave`.
      - Öğreti (probe): Alt-modda test "geçer" gibi görünüyordu ama
        marquee hiç başlamıyordu (sahte-yeşil) — CDP modifiers
        bitmask (Shift=8, Alt=1, Ctrl=2) + görülen selection.length
        ile doğrudan seçim sayısı assertlenmelidir.
      - Öğreti (araç zinciri): PowerShell `Set-Content -Encoding utf8`
        ANSI okuma yanlış yapar → manifest etiketleri çift kodlanır
        ('FÄ±rÃ§a'); label uyuşmazlığı + taşma genişliğine yayılan 2
        probe kırmızısının tek kökü. Ters kodlama scriptiyle onarıldı;
        manifest düzenlemeleri bundan sonra Node/`edit` ile yapılır.
      - Kanal: options-bar 41/41 (B6 bölümü 9 kontrol) + kapı zinciri
        rotate 35/35 · compositor 24/24 · tile-canon 31/31 · commit
        7/7 · smoke · projects · shortcut (bu iş turunun koşumunda
        yeşil). app.js 1320.4 KB.

7. **Transform HUD** — X/Y/W/H/R sayısal girdi, gizmo (inkGizmoBox)
   ile çift yönlü senkron.
7b. **A11 · R tuval döndürme (PS Rotate View, kullanıcı eklemesi
   2026-11-04; sıfırlama tamamlayıcısı: kullanıcı 2026-11-04 ikinci
   istek)** — R geçici mod: basılıyken sürükle döndürür, bırakınca
   araca döner. DEĞİŞİM PROTOKOLÜ:
   (1) HATIR veri dönüşümü YOK — katman/karo/undo uzayları
       (dünya koordinatları) dönüşümsüz kalır; export == ekran
       birebir kalmalıdır (compositor 24/24 pusuladır).
   (2) KAPSAM yalnızca 36 modal editörün kendi `ui.view` düzlemine
       kilitli; referans tahtası `state.view` (20+ tüketici) ROT
       ALANINA ALINMAZ. Kapı kanalı (`scripts/ink-rotate-test.js`)
       yazılıp yeşile yaslanmadan uygulama başlamaz.
   (3) Tek kapı vektör matematiği: pointer↔canvas dönüşümleri tek
       `ui.view` kapı fonksiyonuna yığılır; her ekran-katlı kanal
       (stroke/gizmo/eyedropper) bu kapıdan geçer.
   (4) Perf: görüntü dönüşümü compositor'da (CSS transform, tek
       kapı elementinde); raster re-repaint yok — vuruş yanıt
       kare başına sabit kalır.
   (5) Rot altında Alt+tekerlek zoom, Space+pan, `[`/`]`, seçim
       gizmo davranışları sınamalı (ink-rotate-probe: gidiş-dönüş
       ±0.5px, anchor stabil, 45° sürükleme 60fps).
   (6) SIFIRLAMA ÜÇ YOL (kullanıcı talebi: "eski haline getirmek
       zor olmasın"; PS kalıbı View > Rotate View > Reset View):
       a) R modunda tek tık (dokunuş) → 0°'ye döner (sürükleme
          başlamamışsa),
       b) options bar "Görünüm <açı°>" bilgi satırı + "Görünümü
          sıfırla" düğmesi — ≠0° iken yanar, 0° iken gizli
          (A4 info/action deseni, tek ışık kuralı),
       c) döndürme zoom/pan'den BAĞIMSIZDIR: sıfırlama yalnız
          açıyı temizler, zoom/pan'a dokunmaz; payda ayrı
          `ui.view.rot` alanıdır.

      **DURUM (2026-11-04, tamamlandı):** Uygulama + probe 30/30 YEŞİL.
      Motor (36): `ui.view.rot` (+`inkEditorRotNorm`), `inkEditorApplyRot`
      (CSS transform merkez-origin + `.ink-rotated` root sınıfı +
      `__v5OptSync({measure:false})`), `inkEditorRotate` (mutlak;
      vuruş/pan sırasında yok sayılır), `inkEditorResetRot` (yalnız açı),
      `inkEditorGatePoint` (tek kapı; LocalRaw/Sample/SyncCoords tüketicisi),
      `inkEditorRotHud` (imleç dibi canlı derece çipi), Shift=15° snap
      (tam 45/90 sürükleyerek yakalanır), close'ta rot temizliği.
      Probe kök düzeltmesi: denek harness `syncAll()` çağırmıyordu —
      tahta `.media img` yoktu, `inkEditorRender` erken çıkıyor,
      vuruş piksel testi yutuyordu (vuruş flake'i de aynı kök).
      syncAll sonrası vuruş `rgb=253,6,6` hedefe iner, strokes 0→1.
      Widget KULLANICI KARARI: ±90° düğmeleri kaldırıldı — options bar
      kompakt çip: derece "45°" (title: Tuval görünüm açısı) + sıfırla
      "⟲" ikonu (≠0° iken görünür). Çip .v5-opt DEĞİL → taşma döngüsüne
      katılmaz (recents şeridi A2 kuralı): dar çubukta derece her zaman
      görünür; bedeli en yumuşak satırın ⋯'e kaçması (options-bar probe
      öncelik kontrolü 32/32 korunur). Satırsonu DOM sıralaması:
      widget satırların sonuna (⋯ 'in önüne) eklenir; measureOptionsOverflow
      tüm widgetlara kalıcı optIndex basar (⋯ menüsü kapanınca sıra
      sarpassa restore doğru dizilir — probe regresyonundan öğreti).
      Rot ≠ 0 iken köşe açıklarında tasarlanmış desk fonu (`#23262e`,
      `ink-rotated` sınıfı) — kullanıcı "siyah iz" şikayetinin çözümü.
      KAPI ZİNCİRİ (tam koşum): compositor 24/24 · commit 7/7 · smoke ✓ ·
      ink-smoke 233/233 · projects 39/39 · tile-canon 31/31 ·
      options-bar probe 32/32 · ink-shortcut probe 14/14 ·
      ink-rotate probe 30/30. Perf sürükleme ~125 fps (≥30 eşik).
      Kanıtlar: `scripts/_shot-rot-{baseline,20,45,reset}.png`; geçici
      teşhis scriptleri tmp-rot-{diag,raf}.js silindi.

      **DURUM v2 (2026-11-04, tamamlandı): R tuval döndürme — RENDER-IÇI
      içerik rotasyonu + 5 kullanıcı kusur raporu çözüldü. Probe 35/35.**
      Kullanıcı raporları ve kökleri:
      (1) "pan'de tuval kayboluyor, çizim ayrı duruyor" → pan/tekerlek
      ekran-uzayına alındı (`inkEditorRotFilterDelta` −rot gömme:
      Space+pan, wheel, zoom-anchor); probe glued-pan kanıtı: commit
      vuruş piksel-scan'i kâğıt ile BİREBİR aynı ekran vektörüyle taşınır.
      (2) "yaklaşınca kare kanvas dikdörtgen oluyor, yandan kesiliyor" →
      zoom-anchor kökü: render pivotu canvas-merkezi; kullanıcının
      imleç-altı İÇERİK noktasının fit karşılığı a = C + R(−θ)(A − C);
      hedef fit-origin a − c·s2; pan DOĞRUDAN hedefe kurulur
      (inkEditorComputeFit'in parça-koruma clamp'i linear pan-uzayına
      taşmalı — += düzeltme clamp'te sürüklenirdi). Eski centrik probe
      anchor'ı bu hatayı görmüyordu (kerteriz = C iken hata sıfır).
      (3) "tut-bırak-tut-bırak kafasına göre" → çoklu R-basılı çevrim
      probe'a eklendi (2. çevrim +30° birikim) YEŞİL; commit noktaları:
      pointerup(moved)/pointercancel/R-keyup.
      (4) "masa griye dönüyor" → `.ink-rotated` arka plan override'ları
      (style.css + draw-v5.css `#23262e !important`) KALDIRILDI; masa
      fonu rot'ta değişmez (probe: bg renk rot0==rot30).
      (5) A11 v2 mimarisi: bitmap DIK kalır; içerik render'da pivot=
      canvas-merkezi etrafında döner (`inkEditorApplyRot` commit +
      `inkEditorRotFastFrame` sürükleme karesi + inkSyncCanvasFrame
      rot-koruma + `#inkCanvasFrame` gizleme; katman wrap dpr-space).
      Probe kanıt kanalları: bitmap baked-rotasyon piksel kanıtı (rot0
      opak→rot15 saydam köşe), off-center zoom karo-scan, screen-straight pan
      (40,25), 2×tut-çevir-bırak, masa-fonu const. KAPI ZİNCİRİ:
      compositor 24/24 · commit 7/7 · smoke ✓ · ink 233/233 ·
      projects 39/39 · tile-canon 31/31 · options-bar 32/32 ·
      ink-shortcut 14/14 · ink-rotate 35/35 · drag ~123 fps.

      **DURUM v3 (2026-11-04, tamamlandı): pivot KÂĞIT MERKEZİ —
      "döndürürken kâğıt pencere ortası etrafında salıncağa binip ekranda
      sağa-sola geziniyor" kusurunun kök çözümü. Probe 35/35.**
      - Pivot taşıma: `inkEditorGatePoint`, `inkEditorRotFastFrame` (CSS
        hız-kare origin), zoom-anchor (`inkEditorSetZoom` v3), render
        (device + CSS px iki sarmalayıcı) ve sürükleme açı merkezi
        (pointerdown/move) TÜMÜ fit merkezine bağlandı — kâğıt
        ekranda SABİT dururken yerinde döner (referans uygulama deseni).
      - Pan-uyumu kökü: `inkEditorRotFilterDelta` −rot gömme ESKİ
        pencere-merkez pivotuna aitti; yeni pivot altında fit-pan
        deltası ekran deltasına birebir eşittir (pivot C pan ile δ
        kayar: s'−s=δ) — filtre kaldırıldı, aksi hâlde kâğıt yamukken
        yukarı sürüklemede sağa-sola çapraz gidiyordu (dab Δ=R(−θ)drag
        kanıt: düzeltme sonrası dab Δ=(40,25)==sürükleme birebir).
      - Probe pivot uyumu: `screenPointOf` ve sürükleme ark'ları artık
        fit merkezinde; fit değişen testler (shift-snap/perf) ark
        merkezini GÜNCEL fit'ten kurar.
      KAPI ZİNCİRİ (v3 sonrası tam koşum): rotate 35/35 · options-bar
      32/32 · compositor 24/24 · tile-canon 31/31 · commit 7/7 ·
      smoke ✓ · projects 39/39 · shortcut 14/14. Perf ~141 fps.

      **DURUM v4 (2026-11-04, tamamlandı): rot≠0'da base kırpma —
      "rotate'li kanvasa yakınlaşınca kâğıt kesiliyor" (bug 2) ve
      "1. den sonraki rotateler bozuluyor" (bug 1) raporlarının ortak
      kök çözümü.**
      - Kök: `inkEditorDrawBase` base bitmap'i VIEWPORT boyutunda
        üretiyordu; rot≠0 iken dönmemiş koordinat uzayında kâğıdın
        viewport dışındaki bölgesi base'e hiç çizilmiyordu. Döndürünce
        bu "delik" ekrana girip diyagonal kesik çiziyordu (ölçülen kesik
        hattı x+y ≈ 1844 = fit alt kenarının y=940 dönmüşü). Zoom+pan'li
        oturumda R-sürükleme bu kesik şeridi CSS hız yoluyla ekranda
        gezdiriyordu → "kağıt kafasına göre dönüyor" izlenimi (bug 1).
      - Fix: |rot| > 0.01 iken viewport'u pivot etrafında −rot ile geri
        döndürüp SARICI KUTU çıkar; base'i o (bx,by,bw,bh) OB boyutla
        üret (DPR QUANT 128 + PAD 2px). baseKey'e bx/by/bw/bh + rot
        eklendi; çizim transformu `setTransform(dpr,0,0,dpr,-bx,-by)`,
        kompozit `drawImage(base, off.x, off.y)`.
      - Doğrulama 1 (matris): rot {0,−45,−122} × zoom {1→5.06} —
        4 kenarda gerçek-normal örneklemesi ile 0 kesik (yalnız köşe
        uçlarında 1-AA pikselleri, önceden mevcut).
      - Doğrulama 2 (ardışık çevrim): zoom 1.5 + pan sonrası
        +40°/−60°/+25°/+170° çevrimlerinde kâğıt-içi koyu işaretçi
        kütle-merkezi tüm adımlarda ≤0.7px sabit (pivot kâğıt merkezi,
        içerik gezinmesi YOK). Beyaz-kütle ölçüsünün commit-sonrası
        kayması sahteydi: çevrilmiş köşelerin viewport'tan kesilmesi
        beyaz kesiti asimetrik yapıyordu; işaretçi etkilenmiyor.
      - Probe'lar (tmp-rot3-edge vb.) zayıf nişan yüzünden iki sim
        tuzağına düştü: CDP tıklaması UI panel elemanlarına (blend
        <select>, opaklık <input range>) çarpıyordu; #inkLayerBlend
        focus'u R'yi yutuyordu (typing filtresi). App bug'ı değil —
        elementFromPoint tabanlı nişan + blur() ile çözüldü.
      KAPI ZİNCİRİ (v4 sonrası koşum): rotate 35/35 · options-bar 32/32 ·
      compositor 24/24 · tile-canon 31/31 · commit 7/7 · smoke 233/233 ·
      projects 39/39 · shortcut 14/14 · kenar-matrisi tam yeşil.

      **DURUM v5 (2026-11-04, tamamlandı): CSS hız-karesi KALDIRILDI —
      "zoom'luyken döndürürken yanlar kesiliyor + rastgele gezinme"
      (kullanıcı videosu 17-57-11: sürükleme ortası kesik üçgenler
      k11/k26/k29, bırakınca temiz k18/k32).**
      - Kök 2: `inkEditorRotFastFrame` sürükleme karesini canvas
        elementine CSS rotate ile yapıyordu; bitmap yalnız viewport
        kadardı. Kâğıt viewport'tan taşınca (zoom + pan) dönünce
        ekrana GİREN kâğıt bölgeleri karede hiç yoktu → kesik üçgen ve
        saydam hayalet şeritler ekranda geziniyordu ("kafasına göre
        dönüyor": raporlarda bug 1'in ikinci yüzü). İlk döndürmenin
        temiz olması şaşırtıcı değildi: kâğıt fit'te viewport İÇİNDE,
        kesilecek bölge yok.
      - Fix: sürükleme kareleri ARTIK tam render hattından geçer
        (referans uygulama tek-doğruluk-kaynağı deseni: tek dönüşüm hattı, CSS
        yolu yok). `ui.baseWide` R-press anında geniş base kurar:
        kapsama = fit ∩ box(pivot ± rmax) (rmax = pivotun viewport
        köşelerine uzaklığı; dönüş mesafe korur → sürüklemenin BÜTÜN
        açı aralığını tek kurulum karşılar; kutu kâğıtla sınırlı,
        (cw+ch)²'yi aşmaz). baseKey geniş modda rot'i içermez; içerik
        rot-bağımsız olduğundan kare başına base yeniden kurulmaz.
      - Doğrulama: zoom 2.25 → R-drag −45/−120° sıra-ORTASI tarama
        0 kesik (v4'te −57°'de 8 kesik vardı). rot=0 ve rot=−72'de
        rest vs wide base bitmap birebir (0 diff). Zincir: rotate
        35/35 (sürükleme perf 71 fps ≥ 30 hedef) · options-bar 32/32 ·
        compositor 24/24 · tile-canon 31/31 · commit 7/7 · smoke
        233/233 · projects 39/39 · shortcut 14/14.
      - Not: R modunda <4px tek tık = açıyı 0'a sıfırlama (PS Reset
        View) tasarımın parçasıdır; kullanıcı bunu yamuk kâğıdı
        düzeltmede pratik keşfetti — bilinçli davranış, bug değil.

      **DURUM v6 (2026-11-04, tamamlandı): "İlk döndürüşte hayalet
      iz/şerit" — tek görünür kök (DOM çerçevesi); canvas şüphesi
      yanlış alarm olarak kapandı.**
      - Kök 1 (DOM çerçevesi — GÖRÜNÜR hayalet): `#inkCanvasFrame`
        (dik kenar + gölge kutusu) yalnız COMMIT'te gizleniyordu. İlk
        R-sürüklemesinde rot henüz 0 olduğundan rot≠0 dalı
        tetiklenmiyor; `inkEditorSyncStatus` override'ı çerçeveyi her
        sync'te geri açıyordu → sürükleme boyunca dönmüş kâğıdın
        üstünde dik çerçeve "hayalet bant" olarak duruyordu.
        Fix: (a) `36-ink-editor.js` pointerdown rotMode bloğu sürükleme
        başında `frame.hidden = true` yazar; (b) `31-ink-ui.js`
        `inkSyncCanvasFrame`'e `ui.rotDrag` guard'ı eklendi (drag
        aktifken girsin yok; bırakışta `inkEditorApplyRot` rot'a göre
        karar verir). DO NOT REMOVE: ikisi birlikte gereklidir — yalnız
        (a) yeterli değil, sync override'ı geri açıyordu.
      - Kök 2 İNCELENDİ ve BULUNAMADI (yanlış iz): commit sonrası
        ekran-kırpması şüphesi 13 denek zinciriyle tarandı (rot24-base
        diff → rot25 piksel karşılık → rot26 poligon tarama → rot32 zaman testi →
        rot34 iyileştirme). Sonuç: ana canvas bitmap'i poligon dışında
        0 lit hücre; base canvas temiz (halka = ~50px siyah drop
        gölge, sahte pozitif tmp-rot24); "stale texture" teorisi
        tmp-rot35 PNG-decode kenar analiziyle ÇÜRÜTÜLDÜ — gösterilen
        kâğıt kenarı gerçek kenarla 0-2 px örtüşüyor. (80,80,82)
        okumaları = dock panel bg rgba(22,22,24,.75)'in beyaz kâğıt
        üzerinden okunması; (18,18,20) = kâğıt-dışı gölge alanı.
        width-flip / display-toggle iyileştirmesi gereksizdir (canvas
        sağlam). Denek tuzakları: (80,80,82), beyaz kâğıt altında
        dock panel bg'sinin beklenen görünümüdür (kâğıt 255 üzerinden
        0.75 koyu bileşim); screenshot bölgesi seçerken item
        mini-önizleme (ekran rect 35,377,250,250) ve v5-dock-resize
        kenarları (x=300) kontaminasyon yaratır.
      - Doğrulama: tmp-rot13 İLK drag ortası {frameHidden:true,
        band left 0 lit} · bırakış {frameHidden:true} · 2. drag ortası
        temiz. Kapı zinciri: rotate 35/35 · options-bar 32/32 ·
        compositor 24/24 · tile-canon 31/31 · commit 7/7 · smoke
        233/233 · projects 39/39 · shortcut 14/14. app.js 1315.4 KB
        yeniden derlendi, portable exe (114,346,900 B) Desktop'a
        kopyalandı (zaman damgası eş).

8. **Boyut HUD'ı** — `[`/`]`/Alt+tekerlek değişiminde referans uygulama
   tarzı noktada mini görüntü (inkUpdateHud güçlendirme).
9. **Options bar ile pill taşınabilirliği** — beraber taşıma /
   ayrı sabitleme (PS desenli).
10. **Kenar şeritleri (Power Sliders)** - referans uygulama tuval kenarı
    sürüklenebilir Boyut/Opaklık. Options bar tamamlayıcısı.

      **DURUM B10 (2026-11-04, tamamlandı): tuval kenarı Power
      Sliders + 18/18 probe kanalı.**
      - Yerleşim: `#inkPowerSliders` tuval kromudur — `#inkEditor`
        kökünde, sol kenarda kolon (üst şerit Boyut, alt şerit
        Opaklık), `inkEditorViewport()` tek kapısıyla konumlanır
        (dock/options bar/scope bar ile örtüşmez; altta 58px durum
        çubuğu payı). Rot/zoom/pan'e bağımsızdır (kâğıt değil pencere
        kromu) — sözleşme 1.
      - Değer kanalı TEK: buildOptionRange birebir aynalanır —
        `inkState()[key]` + fırça-üstüne-yazma (eraser hariç) +
        `inkSaveBrushOverride` + `inkPreviewBrush` + `inkUpdateHud` +
        `scheduleSave` + `window.__v5OptSync` (options bar widget'ları
        aynı karede tazelenir). Ayrı state YOK.
      - Görünürlük şemadan: `inkToolOptionsSchema` içinde range
        size/opacity araması — brush/pencil/eraser/shape/smudge
        boyut, fill/gradient opaklık; ikisi yoksa kök gizli
        (text/eyedropper). Progressive disclosure sözleşmesi 4.
      - Etkileşim: pointerdown şeritte değer atlar + pointer capture
        sürükleme; t = (bottom−clientY)/h, clamp'li (üst/alt taşma
        uçlara kenetlenir); adım kuantası state birimi×scale.
        Klavye: role=slider + aria-valuemin/max/now, ArrowUp/Down ±1
        adım, PageUp/Down ×10, Home/End uçlar; balon (inkPSBubble)
        rotHud deseni 1.1s görünür.
      - Dış yazım takibi: `inkPreviewBrush` 36 fabricasında sarmalanır
        (`inkPowerSlidersInstall`) — options bar/panel her değer
        yazımında şeritler tazelenir; sync tüm yazımları tek kapıdan
        geçer (resize + open/close/resize/syncStatus kanalları).
      - CSS A7 standardı: hover açılma, :active sıkı, focus-visible
        accent çerçeve; mad tokens (`--bg/--border/--accent`); knob
        + dolgu `--v5-ps-p` custom prop ile; `touch-action:none`.
      - Yardım: Ayarlar → Yardım'a "Tuval kenarı şeritleri" grubu
        eklendi (index.html settingsHelp).
      - KANAL: power-sliders 21/21 (varlık/yerleşim/örtüşmezlik,
        knob↔state, iki uç sürükleme + options bar senkronu, klavye,
        şema görünürlüğü gradient/smudge/eyedropper, ayar kutusu
        aç/kapat). Kapı zinciri
        (options-bar 52/52 · ink-rotate 35/35 · ink-smoke 233/233 ·
        smoke · projects 39/39 · ink-shortcut 17/17 · compositor
        24/24 · tile-canon 31/31 · commit-check 7/7) tamamı yeşil.
        app.js 1340.6 KB.

      **DURUM B10-TAŞIMA (2026-11-04): ana konum Ayarlar'dan Çizim
      Ayarları menüsüne taşındı.**
      - Kullanıcı kararı: "Tuval kenarı şeritleri" anahtarı Ayarlar
        diyaloğundan (#settingsPowerSliders checkbox + 20-settings
        kablosu) KALDIRILDI; çizim modu araç çubuğunun en solundaki
        dişlinin (draw-v5 `.v5-grip`) menüsüne girdi olarak eklendi.
      - Menünün adı artık "Çizim Ayarları" (grip title/aria + menü
        aria-label): ileride bulunması için tek referans ad.
        openPanelsMenu → menü 'Çizim Ayarları' ; satır
        "Tuval kenarı şeritleri" (check + Açık/Kapalı state),
        her menü açılışında inkPowerSlidersEnabled()'dan senkron.
      - API: window.inkPowerSlidersSet (36 top-level fn, klassik
        scriptte otomatik global) draw-v5 action'dan çağrılır; eski
        Ayarlar kablosu window.inkPowerSlidersSet'i asla bulamadığı
        için sessiz kırıktı — bu taşıma onu da düzeltir.
      - KANAL: power-sliders 21/21 ✓ (ayar kutusu yerine gerçek UI
        yolu: grip'te PointerEvent down/up (hareketsiz) → menü açılır
        → 'Tuval kenarı şeritleri' satırı click → stateBefore
        Kapalı/Açık doğrulaması ile aç/kapat). Buradan itibaren B10
        satırı 21 hane sayar.

### C. Büyük projeler (ayrı faz değeri, kendi planı)

11. **Simetri motoru** — dab pipeline tek noktada (28), simetri =
    nokta dönüşüm + tile bölgesi çift hesabı; N-yol/dikey/yatay.
12. **Büyü (magic wand) aracı** — `inkFloodFillContext` (28:392)
    seed benzeri selection üretimi.
13. **Liquify/warp** — tile canon (57) zemin; kendi alt-faz.
14. **Wide-gamut (Display-P3)** — bellek modeli ×2; OKLab renk
    çekirdeği zaten gam-bağımsız, tile aynası Float32 lin hazır;

### D. Temizlik

15. Geçici `scripts/tmp-*` / `_shot-*.png` ayıklama; kalıcı probe'ları
    `*-test.js` kalıbına çevir ve kapı zincirine bağla.
16. Kök `app.baseline.js` / `app.new.js` artıkları (paket lenmez ama
    repo kirliliği).
17. Kapı zinciri FAZ 6 işlerinde de korunur: build-app → compositor →
    ink-commit → smoke → ink-smoke (233) → projects → tile-canon;
    yeni UI için probe (`options-bar-test.js` kalıbı). Her yeni
    A-kümesi düğmesi probe'a ayrıca taşıma kontrolü (bounds) olarak
    düşer — sözleşme madde 1'in test kanalı budur.

      **DURUM D-temizlik (2026-11-04, tamamlandı):**
      - Silinen geçici artefaktlar (18 dosya · ~2,75 MB):
        `scripts/tmp-b6-diag.js · tmp-b6-fix58.js · tmp-b6-read.js ·
        tmp-b7-diag.js · tmp-b8-diag.js · tmp-b9-icons.js ·
        .tmp-extract.js · .tmp-helper.js · .tmp-matrix-*.json`,
        eski ekran görüntüleri (`scripts/_shot-draw · _shot-notice ·
        _shot-options-bar · _shot-reference · _shot-rot-20 ·
        _shot-rot-reset.png`), kök `app.baseline.js` · `app.new.js`
        (madde 16). Silme öncesi src/renderer/core + scripts + docs + kök
        referans taraması SOL — hiçbir dosya paket/format zincirine
        bağlı değildi (package.json `build.files` ad-ad_liste;
        baseline/new zaten paketlenmıyordu).
      - Korunan: `scripts/_shot-ps-sliders.png` (B10 kanıt görseli,
        DURUM-B10 notuna referans) ve `_`-önekli kalıcı görsel/probe
        yardımcıları.
      - Madde 15 ikinci yarısı — kalıcı probe'lar `*-test.js` kalıbına
        çevrildi: `options-bar-test.js · ink-rotate-test.js ·
        ink-shortcut-test.js · power-sliders-test.js` (yeni ad
        konvansiyonu; kapı zinciri emri değişmedi: build-app →
        compositor → commit → smoke/ink-smoke/projects/tile-canon →
        options-bar → ink-shortcut → ink-rotate → power-sliders).
        Dokümanlardaki 4 referans güncellendi (kod içi referans 0).
      - Doğrulama: power-sliders 20/20 ✓ · ink-shortcut 17/17 ✓ ·
        commit-check 7/7 ✓.

**Önerilen sıra:** 1→2→3→5 (tek tur) → 6 → 8 → 4 → B tamamlama →
C (istekle).

      **DURUM C-ARA VERME (2026-11-04): madde 11 Simetri motoru —
      kullanıcı isteğiyle DURAKLATILDI.**
      Kod değişikliği YAPILMADI; yalnızca keşif/haritalama. Zincir
      son yeşil haliyle duruyor (B10 + D temizlik + portable build
      güncel: Desktop\TailRef_Studio.exe · 109,1 MB · 22:24).
      Kaldığı yerden devam için haritalama kaydı:
      - Dab pipeline TEK NOKTA: `inkDrawStrokeOnContext`
        (28-ink-brush.js, ~26.000 offset). Çağrı yerleri: 29
        (rebuild + global karo), 30 (canlı 2D + commit), 31
        (önizleme), 33 (damga), 35 (worker), 36 (GL + 2D önizleme +
        commit yedek), 40 (GL sink `inkDabGlApply`), 50 (etkiler),
        51 (ışınsal), 52 (fırça önizleme).
      - Artımlı önizleme sözleşmesi: `opts.skipDabs` skaler.
        Kanal kopyası dab indeks uzayı birebir bijeksiyon olduğundan
        aynı skipDabs skalerin BÜTÜN kanallara ortak geçmesi DOĞRU.
      - Vuruş üretim noktaları: 36:82275 (editör) + 30:18071 (tahta).
        Görsel tasarım: render-zamanı kanal açılımı ve tek damga
        (`stroke.sym`) — böylece undo tek vuruş kaldırır ve
        yeniden render simetrik疋 kalmaya devam eder.
      - Bağlı katman nokta uzayı 0..1 normalize; merkez (0.5, 0.5).
        Radial rotasyon pixel-uzayında (opts.pointScale her
        editör yolunda mevcut). Global karo slicing
        `inkStrokeTileRange` (29) union-range isteyeceği için
        V2 işi; v1 kapsamı = editör/bağlı katman.
      - fill/gradient/shape simetri: nokta dönüşümüyle serbest.
      - Durum alanı: tek alan `symMode` ('off', 'mirrorX',
        'mirrorY', 'mirrorXY', 'radialN') — inkNormalizeState
        whitelist + inkCreateState varsayılan 'off'. Options bar
        select widget (`buildOptionSelect` doğrudan
        `inkState()[w.key]` yazar); schema eklemeleri brush /
        pencil / eraser / shape.
      - Probe: scripts/symmetry-test.js (yeni ad konvansiyonu).
      Kapsam v1: editör bağlı katmanları; global/tahta vuruşlarına
      simetri v2 (merkez tanımı ayrı iş).

      **DURUM ITEM 11 CLOSED — 16/16 (2026-11-05).**

      Root cause of the last flaky failure ("undo klonu da söker"):
      in `inkUndoStrokeRegion` (src/renderer/core/34-ink-undo.js) the union
      loop assigned to `x`/`y` which had been declared with `const`
      ("Assignment to constant variable" thrown inside the silent
      try/catch → union never widened the capture region). Declared
      them with `let`; region now unions mirror clone boxes
      (verified: diag unionLog shows two clone unions, undo restores
      both sides). Also applied this session:
      - Test-formula fixes (mirror angle a=π−0.3, radial4 first
        clone θ=0.2+π/2) in scripts/symmetry-test.js.
      - symMode select added to brush/pencil/eraser/shape schemas in
        src/renderer/core/58-ink-tool-manifest.js (renders via buildOptionSelect
        → data-opt="symMode"; verified 6 options + state write).
      - Radial pixel test switched to fit-fraction screen coords
        (fixed -40px offset bug).
      - TEMP instrumentation left in 34-ink-undo.js +
        scripts/symmetry-test.js (window.__symUnionDiag /
        __undoPushLog / COMMIT-DEBUG console) — REMOVE before the
        finalize build; it is dormant unless window.__symUnionDiag
        is set.
      Next steps for items 12 (magic wand) → 13 (liquify) →
      14 (wide-gamut) → finalize build per the C-CONTINUE POINT
      plan below.

      **DURUM: referans panosu Alt damlalık + büyüteç (2026-11-05,
      user request "soldaki referans panosundan da renk seçmek
      istiyorum" + "büyüteç orda da çıkmalı" + "dış yuvarlağı
      seçilen renkte parlamıyor").**

      Implemented in draw-v5.js bindTailRef block (+ style.css
      #stage.v5-ref-eye / #v5RefLoupe rules):
      - Alt+click on the live reference mini-board samples the
        pixel under the cursor and writes it to inkState().color
        + inkSyncUI() (same channel as the canvas Alt eyedropper).
        Alt+drag = live sampling.
      - Loupe: 68px circular loupe near cursor, zoom x6 from the
        sampled source, ring stroked in the picked color with
        shadow glow, hex label pill below. Shows on Alt hover,
        hides on Alt release / leaving the board / editor stroke.
      - Sampling geometry: items are moved with translate3d+rotate
        (06-render) — plain img-AABB mapping broke on rotated
        items (returned '—'). v5ItemSamplePoint solves screen→item
        space via the rotated AABB center + scale from the AABB
        half-width and item.rot; then canvas layers + img are
        sampled proportionally in item space (alpha >= 8).
        Verified live with a rot=30° gradient item: loupe shows
        the correct color (#3CB24A), zoom content drawn, click
        applies the color.
      - elementsFromPoint does not return the photo img
        (pointer-events:none) → items are located through
        containers (.item.is-image closest) and their surfaces
        (canvases first, then .media img).
      Files: draw-v5.js (~1567-1800), style.css (FAZ 6 tail).
      Verification: live tabs r=26..28 (probe item, console clean).
      Test artifacts cleaned from the board. NOT in the exe yet —
      include in the upcoming finalize build.

      **DURUM ITEM 12 MAGIC WAND — SKIPPED (2026-11-05, user
      choice "13 ve 14'e geç").** Can be revisited later;
      scripts/magic-wand-test.js was NOT written.

      **DURUM ITEM 13 LIQUIFY CLOSED — 14/14 (2026-11-05,
      `node scripts/liquify-test.js` green on the fresh build).**

      Architecture (smudge pattern, tile-canon base):
      - `inkDrawLiquifyOnContext` (src/renderer/core/28-ink-brush.js, after
        inkDrawSmudgeOnContext): the stroke region is read with ONE
        getImageData and written back with one putImageData; dabs via
        `inkForEachDab`; hardness → radialMask (smoothstep edge).
        CONTENT DISPLACEMENT instead of color mixing:
        g = d̂ · dispMax · radialMask, where
        dispMax = min(dragLength, radius×1.15) × power(opacity) ×
        pressure; src = dest − g·dir (content flows forward under the
        dab). Dabs processed SEQUENTIALLY (dab n builds on n−1) →
        liquid feel, deterministic → rebuild (29-ink-render)
        reproduces the exact same result (t=diff=0).
      - In-place write safety: per dab, the dab box ±dispMax margin is
        copied to a reusable snapshot buffer; all reads sample the
        snapshot. Bilinear 4-neighbor sampling in LINEAR premul space
        via inkCanonSRGBToLin01/Lin01ToSRGB (57).
      - Direction source: previous mapped dab (`prev` closure), not a
        helper; dLen < 0.75 px → skipped.
      - Live preview: ghost dab via inkDrawLiveDab (same as smudge);
        the real warp happens once at commit through
        inkDrawStrokeOnContext. Worker path OFF:
        inkSplitRasterPlans returns null for 'liquify'; useWorker list
        excludes it (35-ink-worker.js) → sync commit.
      Integration:
      - 28: dispatch in inkDrawStrokeOnContext (kind==='liquify');
        scatter=0; inkSplitRasterPlans null.
      - 27: inkNormalizeStroke kind/tool whitelists include
        'liquify'.
      - 30: INK_TOOL_CURSORS (crosshair),
        INK_TOOL_SETTING_DEFAULTS {hardness:.35, opacity:.5,
        spacing:.12, smoothing:.3}, allowed list, kind/tool map,
        scope-out guard list, first-dab exclusion.
      - 36: paintTool list, beginPaint list, attached-only guard
        ("liquify works on image-attached layers only" notice, like
        smudge), kind/tool map.
      - 58: touch group ['smudge','liquify']; INK_TOOL_DEFS.liquify
        (bar:true, icon 'ink-liquify'); schema size/opacity=Güç/
        hardness/smoothing/spacing. index.html: #icon-ink-smudge +
        #icon-ink-liquify symbols added after icon-ink-eraser.
      - Symmetry: clones are generated BEFORE dispatch (item 11
        engine) → mirror side receives the identical warp (verified
        mirrorX test: both sides displaced).
      - Undo: inkUndoStrokeRegion region works as-is (pad ≥ brush);
        probe F covers it.
      Files: 28/27/30/35/36/58-ink-*.js, index.html,
      scripts/liquify-test.js. app.js rebuilt (36360 lines).
      NOT in the exe yet — include in the upcoming finalize build.

      **DURUM ITEM 14 WIDE-GAMUT (DISPLAY-P3) CLOSED — 10/10
      (2026-11-05, `node scripts/wide-gamut-test.js` green).**

      This item verified/completed the wide-gamut READY state of the
      color pipeline (per plan: OKLab core gam-independent, tile
      mirror Float32 lin already prepared). Probe is pure Node
      (56-ink-color.js + 57-ink-tile-canon.js in one vm sandbox):
      - A · Source audit: EVERY getContext('2d') across draw-v5.js +
        src/renderer/core/*.js declares an explicit `colorSpace` — zero missing
        after this session (one real gap found and fixed:
        52-native-brush-library.js inkNativeCreatorTestRender had two
        bare getContext('2d') calls → now {colorSpace:'srgb'}).
        Precondition for opting any surface into 'display-p3' later.
      - B · OKLab core (CSS Color 4 / Ottosson): golden vectors for
        white/red/green/blue exact (1.5e-3 eps); lin↔OKLab roundtrip
        over an OUT-OF-GAMUT linear range [-0.3 .. 1.6] (P3 coords
        live there) is bounded by 2.5e-7, NaN-free.
      - C · Tile canon Float32 premul-linear mirror: a sweep of
        wide-gamut values (+1.35 → −0.25) stored via inkCanonSetTile
        comes back bit-exact (maxDiff=0); diff contract validated
        (mirror built from an RGBA8 patch like production: 1-LSB
        patch change → 1 changed tile, identical patch → 0);
        flush compresses ONLY at the 8-bit backend boundary
        (lin>1 → 255, lin<0 → 0) — the mirror itself holds the full
        gam range for future P3 sources.
      - D · P3 simulation: linear Display-P3 → linear sRGB matrices
        (D65) applied in-probe; P3 red maps to sRGB-lin
        (1.2247, −0.0421, −0.0196) — negative/exceeding channel
        proves out-of-gamut arithmetic survives; OKLab on those
        coords is finite; P3-red chroma vs sRGB-red chroma differ by
        0.0418 (>0.02, gamut difference perceptible in OKLCH);
        P3-green 8-bit seed ↔ canon mirror roundtrip ≤1 LSB.
      No architecture change needed: the pipeline's design (explicit
      colorSpace canvases + Float32 linear tile mirror + OKLab core)
      already fulfills the item; the audit locks it in.
      Files: scripts/wide-gamut-test.js (new channel),
      src/renderer/core/52-native-brush-library.js (colorSpace fix). app.js
      rebuilt (36360 lines). NOT in the exe yet — include in the
      upcoming finalize build.

      **DURUM C-CONTINUE POINT (2026-11-05, session-end record —
      resume here tomorrow; written in EN to avoid mojibake):**

      DONE THIS SESSION:
      1. Top-bar collapse animation reached its final clean
         form (verified live):
         - Content folds UP (translateY(-6px) scale(.985)) — one
           direction for everything; shell 48→14px
           .42s cubic-bezier(.34,1.34,.4,1).
         - clip-path inset(-40px -600px -26px -600px): added
           -600px horizontal escapes — fixes the bug where the
           arrow got squeezed to a 2px sliver (#bar collapses to
           2px wide when empty; the old inset clipped
           horizontally too; user report: "click elsewhere and
           the arrow turns into something weird").
         - Arrow pill (#barCollapseBtn) 32×16, solid surface
           rgba(46,48,58,.92) + 12px white chevron (old .6
           alpha surface was nearly invisible: "the arrow
           disappears"). When collapsed:
           #bar.bar-collapsed #barCollapseBtn{top:-26px
           !important} → pill sits at the SAME level as the
           Cizim|Referans mode pill (appModeBar center Y=38,
           pill 30..46); it glides there via transition
           top .42s with the same spring curve.
         - #projectBar collapsed transform is now
           translateX(-50%) translateY(-14px); scale(.9) was
           REMOVED — #projectBar is a left:50% centered pill,
           overriding its transform dropped the translateX(-50%)
           part which made the strip fly to the upper-right
           (user report; fixed).
         - Overflow dots (#btnOverflow) sized via JS inline
           width/height/flex '0 0 18px' (16-toolbar-icons.js) —
           inline beats the CSS cascade war (15px flex-basis
           conflicts); app.js rebuilt.
         - Verified: collapse 48→14 monotonic, expand 14→48,
           collapsed pill clickable (elementFromPoint hits it) ✓,
           aligned (pill center 39 ≈ mode center 38) ✓.
           Live tab tab_23aadddf (r=24).
      2. Portable build #3 COMPLETED (sh_1a8c01f6):
         dist_studio\TailRef_Studio.exe is up to date with all
         the UI fixes above. Desktop copy ALSO refreshed
         (<Desktop>\TailRef_Studio.exe,
         ~114 MB, 2026-11-05 01:50).
      3. Symmetry test channel (item 11) still 11/16; root causes
         of its 4 failures are now CLEAR (analysis done today,
         fixes NOT applied yet):
         a. mirrorX angle test: CODE IS CORRECT (clone a =
            π−0.3 = 2.8416); the test formula was written wrong —
            expect `Math.abs(api.mirrorA - (Math.PI - 0.3))`.
         b. radial4 theta test: CODE IS CORRECT (clone a =
            p.a + 2π/n; seed a=0.2 → 0.2+π/2 = 1.77 ✓ measured);
            test must expect
            `Math.abs(api.radialTheta - (0.2 + Math.PI/2))`.
         c. undo test: `inkUndoTopicLength` throws ReferenceError
            (bare identifier) which aborts the try block. Use
            typeof guards:
            `(typeof inkUndoTopicLength === 'function') ? … :
            ((typeof inkHistoryLength === 'function') ? … : null)`.
            Real undo path: global `undo()` + DOM #btnInkHistoryUndo
            (44-ink-workspace-controls.js 413-417 handler calls
            `undo()`) ✓.
         d. `[data-opt="symMode"]` absent from DOM — root cause:
            NO tool schema in INK_OPTIONS_SCHEMAS
            (58-ink-tool-manifest.js) contains a symMode select.
            Add `{ kind:'select', key:'symMode', label:'Simetri',
            options:[... INK_SYM_MODES ...] }` to brush (+pencil)
            schema; verify during testing how the options renderer
            (buildOptionSelect / v5OptSync in draw-v5) tags
            widgets with data-opt.

      TOMORROW'S PLAN (in order):
        (A) Fix symmetry-test.js a+b+c + add symMode select to
            58-ink-tool-manifest.js → node scripts\build-app.js →
            node scripts\symmetry-test.js → target 16/16 → write
            item 11 DURUM line into the plan.
        (B) Item 12 Magic wand: inkFloodFillContext seed-based
            selection; scripts/magic-wand-test.js; DURUM.
        (C) Item 13 Liquify: taper grid on the tile-canon base;
            test channel; DURUM.
        (D) Item 14 Wide-gamut: memory ×2 + Float32 linear tiles;
            test channel; DURUM.
        (E) FINALIZE:
            node scripts\build-canvas-editor.js ;
            node scripts\build-app.js ;
            node node_modules/electron-builder/cli.js --win portable
            (background) → compare exe timestamps → refresh
            Desktop TailRef_Studio.exe. DELETE temporary
            scripts/_ps-scan.js and scripts/_serve.js (FIRMA
            cleanup rule) → close the C block in the plan with a
            single DURUM blob.
        Live: localhost:8642 (sh_1a89feeb, no-cache) running;
        last live tab tab_23aadddf (r=24). For cache-busting open
        a new tab with ?r=25.

      **DURUM C-FINALIZE CLOSED (2026-11-05) — items 13+14 green,
      portable build #4 shipped, C block complete.**

      Item order executed: (12 skipped per user choice) → 13 Liquify
      14/14 → 14 Wide-gamut 10/10 (probes above; channels persist as
      scripts/liquify-test.js and scripts/wide-gamut-test.js).
      FINALIZE steps completed:
      - TEMP instrumentation REMOVED: draw-v5.js v5DiagPush/
        __v5PickDiag (definition + call) and 34-ink-undo.js
        __symUnionDiag blocks (5 sites) deleted. After removal,
        symmetry-test re-run on the fresh bundle: 16/16 still green;
        liquify re-run: 14/14 green.
      - Temporary scripts DELETED (FIRMA cleanup rule):
        scripts/_serve.js, scripts/_ps-scan.js.
      - Builds: node scripts/build-canvas-editor.js (114.3 KB) +
        node scripts/build-app.js → app.js 53 sources, 36334
        lines, 1375.2 KB.
      - BUILDER BLOCKER (documented, worked around): restart of
        electron-builder --win portable failed with EBUSY unlink on
        the OLD dist_studio\win-unpacked\resources\app.asar. handle
        (Sysinternals, downloaded to %TEMP%\syshandle for diagnosis)
        identified WorkBuddyAI.exe pid 5264 holding the handle;
        handle -c close attempt rejected ("descriptor invalid") and
        after the handle disappeared the file stayed undeletable
        (kernel-held / delete-pending-like handle NOT visible to
        handle.exe; same-directory write proven OK, only the file is
        untouchable). WORKAROUND: built to a fresh output directory
        via --config.directories.output=dist_studio2 (note: bare
        -c.output= / --config.output= variants fail in
        electron-builder 26.18.0; the key nests under "directories").
        The locked leftover dist_studio\win-unpacked tree will be
        removable after the next reboot; harmless once the new exe
        ships (old dist_studio\TailRef_Studio.exe is stale).
      - Portable build #4: dist_studio2\TailRef_Studio.exe
        114,372,962 bytes, 2026-11-05 14:38:46. Desktop copy
        refreshed (<Desktop>\TailRef_Studio.exe, identical
        size/timestamp) — includes
        ALL of this session's work: ref-board Alt dropper + loupe +
        ring glow, '—' null root-cause fix, Alt-held text gate, top
        bar collapse polish, symmetry motor (16/16), liquify
        (14/14), wide-gamut audit (10/10).
      C block COMPLETE; next phase per plan: FAZ 7 layer panel
      items (K1–K4 regression channel only if reopened) or new
      user requests.

      **DURUM ITEM 15 TEMIZLIK CLOSED (2026-11-05).**

      - scripts/_* evictions: 30 files deleted (session probes
        _contrast-audit/_dom-probe/_draw-shots/_flicker-probe/
        _gear-scan/_gl-draw-limit/_inspect-*/_panel-shot/
        _preview-align/_rule-probe/_shot-panel/_smoke-capture/
        _sym-gl/_sym-stroke/_verify-shell-fixes/_dock-resize-probe,
        7x _theme-*, shots _shot-options-bar/_shot-ps-sliders/
        _shot-rot-20/_shot-rot-reset.png, _ps-probe-run.txt) +
        repo-root _diag-sync/_diag-worker.png (ink-parity-diag
        artifacts) + 4 scratch probes deleted:
        ink-parity-diag.js / ink-zoom-diagnose.js / probe-bake.js /
        ui-probe.js (all self-describe as "geçici"; zero external
        references verified by grep before deletion).
      - Conversion check (item's second half): no remaining probe
        needs the *-test.js conversion — permanent regression
        channels either already use the naming convention
        (*-test.js) or are the four vetted FAZ 5 gates that KEEP
        their historical filenames for plan-traceability:
        ink-commit-check.js, ink-outside-check.js, ink-radial-check.js,
        ink-select-check.js (+ color-wheel-audit.js, FAZ 6 A10 gate,
        and ink-bench.js as an explicit measurement tool).
      - GATE CHAIN wired: new scripts/run-gates.js sequential runner
        (first red gate → exit 1). PURE chain (default, pure Node):
        pose3d-unit, wide-gamut-test, ink-tile-canon-test,
        ink-color-test, ink-palette-test, ink-stabilizer-test,
        color-wheel-audit, verify-package (shipped .exe ↔ local
        sources byte-check: dist_studio2 first-choice, dist_studio
        fallback). Verified: **GATES: 8/8 green (PURE)** with
        intermediate counts (17/17, 10/10, 31/31, 42/42, 22/22,
        22/22, 6✓, PAKET GÜNCEL 12/12).
        `--full` adds the Electron/CDP channels (compositor,
        symmetry, liquify, layer-canon, UI/regression pack,
        smoke). package.json: "gates" + "gates:full" scripts.
      - KEPT deliberately (not tmp): scripts/_vid (58 f-frames +
        4 sheets, source material for the shipped
        assets/splash-frames/splash-f1..f5; unreferenced by code —
        decision needed if ever removed) [DURUM: TAMAM — 2026-11-06:
        splash-frames/f gif/splash_logo AI kaynaklı çıktı; artık
        el-yazımı inline SVG splash kullanılıyor, bkz.
        THIRD_PARTY_NOTICES §2], ink-smoke.js (master
        harness), build/py toolchain, verify-package.js.
      - Left-over for NEXT BOOT ONLY: locked
        dist_studio\win-unpacked\resources\app.asar (WorkBuddyAI
        pid-held, documented in C-FINALIZE above); the whole
        win-unpacked tree is deletable after a reboot.

## FAZ 7 - KATMAN YIĞINI: Katman Panel Sözleşmesi

Referans: referans uygulama `kis_node.h` (düğüm ağacı), `kis_layer.h` (nitelikler),
`kis_layer_box.cpp` (panel davranışı). Bu faz tailref'un kendi
katman motorunu (50-layer-stack.js + 31-ink-ui.js paneli +
53-ink-compositor.js) referans uygulama panel sözleşmesine oturtur. Özgün
uygulama; birebir çeviri değil.

### K. Katman panel maddeleri (sıra ile işlenecek)

| # | Madde | Mevcut durum | Not |
|---|-------|--------------|-----|
| K1 | Katman satırı HTML5 sürükle-bırak: `dragstart/dragover/drop` → `inkDocMoveLayer/ReorderLayer`; grup içine taşima ve kırpma/maske kısılları | Satır `draggable=true` ama handler YOK | İçleme kısıtları: maske ebeveynine bağlı; grup çıplak değil |
| K2 | "İçeriği Temizle" ≠ "Düğümü Sil": seçili boyama katmanını RGBA(0,0,0,0)'a döoldir (strokes listesi + tuval), undo'lu; Komut düğüm silme mevcut `inkDocDeleteLayer` | Komut YOK | Sağ tık menüsü + kısayol |
| K3 | "Katman Özellikleri" diyaloğu: ad + opaklık + karışım + kilit + alfa kilidi + kırpma TEK pencerede; satır içi ayrı butonlar kalır | Satır içi butonlar var; diyalog YOK | referans uygulama KisLayerPropertiesDialog desen |
| K4 | Etik tinta: etkin katman satırı Yüksek kontrast + ikon katmanı yeterli boğaz | Kısmi (`aria-selected`, `on`) | A7 standart (hover/focus-visible) |
| K5 | Panel + motor regresyon kanalı: `tests/layer-canon-test.js` (yeni ad konvansiyonu) — DnD taşimundo, temizle vs sil undo, özellik diyalogu, etkin satır | — | FIRMA kuralı: her K Maddesí kendi noksasıyla kapanır |
| K6 | Anlaşılırlık paketi (kullanıcı raporu 2026-11-05): thumbnail boya-sınırı kırpma + boş-raster yarışı, satır maske rozeti + "maske ✎", grup satırı üye çipi + üye girintisi/ray, footer düğmelerine metin etiketleri, maske ipucu şeridi, durum dolguları | Kısmi (grup ▣/└ metin ön-ekleri, thumbnail tam-tuval sığdırma) | Panel katmanı; motor değişmez |

### K araştırımda notlar

- Panel düzgün: eye (`inkDocSetVisible`), canlı 24×24 thumbnail
  (`inkLayerThumb` kuyruğu), grup rozetleri, kilit, alfa kilidi,
  kırpma (`layer.clip`, `inkCanToggleClip`), maske (FAZ 1B), merge
  down/duplicate/flatten, `inkDocNewGroup/RenameLayer/Opacity/Blend`
  mevcut — K1–K4 sadece eksikleri kapatır, çizime DOKUNMAZ.
- Kompozitör (53-ink-compositor.js) FAZ 1'de yeşil: alpha lock +
  clipping mask + grup raster birebir; bu faz sadece ARAYÜZ
  kollarını tamamlar, motor değişimi öngörülmez.
- Undo: katman düğümleri pushUndo zincirindedir; K2 temizle
  komutu da pushUndo ile sarılmalı (`inkDocAfterChange` hen)
  kullanır).

      **DURUM FAZ 7 (2026-11-04): K1–K5 TAMAMLANDI — zincir komple
      yeşil.**
      - K1 · DnD: `inkLayerBindList` (50-layer-stack.js) paneline
        `dragstart/dragover/drop/dragleave/dragend` bağlandı; üst/alt
        gösterge `.is-drop-above/.is-drop-below`, sürüklenen satır
        `.is-dragging` (draw-v5.css). Hedef `inkDocReorderLayer`.
        Satırda zaten `draggable=true`; çift tık rename (`dpLayerRename`)
        ve sağ tık menü bağlantıları aynı bağda yürür. K4 kontrast
        tepe noktası: active zemin `color-mix(accent 17% + selected)`
        + 3px sol bar + `:focus-visible` çerçevesi.
      - K2 · İçeriği Temizle: `inkDocClearLayer(layerId)` (50-layer-stack.js)
        — pushUndo → `strokes=[]` → `inkBumpPaintEpoch('mutation')` →
        `inkDocAfterChange`. "Sil"den KESİNLİKLE ayrı düğüm: katman adı/
        karışım/opaklık/kilit ve maske düzlemi korunur. Menü girdisi
        `clear-content` kilitli katmanda ve boş katmanda devre dışı.
        undo vuruşları geri getiriyor (kanıt: layer-canon-test).
      - K3 · Özellikler diyaloğu: `#inkLayerPropsDialog` (index.html,
        newCanvasModal kalıbı): ad/opaklık/karışım(optgroup aynalı)/
        alfa kilidi/kilit/kırpma (`inkCanToggleClip` kapısı). Tek
        Uygula = tek pushUndo; kırpma değişirse `inkCompositeInvalidate`
        takviyesi. Menü girdisi `props`. Bariyer: `inkEditorKeyDown`
        (36-ink-editor.js) diyalog açıkken erken döner — aksi halde
        pencere-capture Esc kısayolu diyaloğu öten (testte yakalandı).
      - K5 · Kanal: `tests/layer-canon-test.js` — 15/15 ✓ (programatik
        DataTransfer DnD, CDP fare çizim → temizle/undo/ayrım, diyalog,
        etkin satır kontrastı). Chromium color-mix çıktısı
        `color(srgb … / a)` formatı ayrıştırıldı.
      - Kapı zinciri (FAZ 7 sonrası): compositor 24/24 ✓ · commit 7/7 ✓ ·
        smoke ✓ · ink-smoke 233/233 ✓ · projects 39/39 ✓ · tile-canon
        31/31 ✓ · options-bar 52/52 ✓ · ink-shortcut 17/17 ✓ ·
        ink-rotate 35/35 ✓ · power-sliders 20/20 ✓ · layer-canon 15/15 ✓.
        app.js 1348.4 KB (53 kaynak).

      **DURUM FAZ 7 RE-DOĞRULAMA (2026-11-05): build #4 üzerinde
      komple yeniden yandırıldı — kanallar yeşil.**
      - `node tests/layer-canon-test.js` → 15/15 ✓ (bugün; K1 DnD,
        K2 temizle-vs-sil ayrımı + undo, K3 diyalog/undo/Escape,
        K4 etkin satır kontrastı — özellikler güncel kaynaklarda
        yerinde: 50-layer-stack.js dragstart:1168/clearLayer:518,
        index.html #inkLayerPropsDialog:272, 36-ink-editor.js:1564).
      - `run-gates --full` FULL zinciri: pose3d 17/17, wide-gamut
        10/10, tile-canon 31/31, color 42/42, palette 22/22,
        stabilizer 22/22, color-wheel 6✓, compositor 24/24,
        symmetry 16/16, liquify 14/14, layer-canon 15/15,
        shortcut 17/17… ilk kırmızı ink-rotate 33/35'e kadar yeşil.
        - ink-rotate 2 kırmızısı APP bug değil, TEST widget-okuma
          bugıydı: ⟲ sıfırla düğmesi kasıtlı `hidden` DEĞİL
          `style.visibility` ile söner (draw-v5 FAZ 6 A11 layout
          rezervasyonu: hidden çubuğu yeniden genişleterek
          Yumuşatma'yı ⋯'e itiyordu). Test artık computed
          `getComputedStyle(btn).visibility` okur → **35/35 ✓**.
      - Telif temiz-oda denetimi (TASARIM SÖZLEŞMESİ md.6) FAZ 7
        kapsamında yapıldı: kodda referans uygulama identifier/kopya yok (tam
        repo taraması); index.html kullanıcıya görünen 1705
        "referans tarzı varyasyon" → "çoklu varyant" nötrleştirildi
        (build #5 ile shipped); satır 269 geliştirici yorumu
        (deseni not eder) dahilide kalır.
      - ink-outside-check yeniden canlanması (11/11 ✓): eski boot
        "modal.hidden=true" hack'i bayat — boş tahtada modeDrawBtn
        artık YENİ TUVAL modalını açıyor ve uygulama gizlemeyi
        ezerek modalı yeniden görünür yapıyordu (0/11 cascade).
        Düzeltme-1: layer-canon-test deseni boot (click → modal
        açıldıysa 1200×800 doldur + submit). Düzeltme-2: çapraz
        (içeriden→dışarı→içeri) vuruş bölümünde ham/aralık olaylara
        30-60 ms ritim — sıfır-aralıklı senkron dizi One-Euro
        stabilizatörü lagde bırakıp kenar-kırpması (Liang–Barsky
        at(seg.t0/br=1)) mafsal noktası üretmiyordu
        (crossReachedEdge=false); ritimle kenara-ulaştı=true.
      - BUILD #5 (2026-11-05 14:55): electron-builder portable →
        dist_studio2\TailRef_Studio.exe 114,373,000 byte
        (nötrleştirilmiş index.html dahil). Desktop kopyası
        birebir. verify-package → PAKET GÜNCEL 12/12 ✓. Kaynak
        delta build #4'e karşı: yalnızca index.html UI string
        (app.js 1375.2 KB değişmedi, 53 kaynak).

      **DURUM FAZ 7 · K6 · Clarity packaging (2026-11-05): two user
      reports closed — "group hierarchy unreadable" + "layer
      thumbnails empty". Panel layer only; ink engine UNTOUCHED.**
      - ROOT · Thumbnail emptiness (two-stage evidence):
        Temporary diagnostic channel `_probe-k6.js` (CDP mouse,
        layer-canon-test K2 pattern) evidence: stroke commit OK,
        layer canvas nz=11433, but thumbnail nz=9 and still 9
        after inkSyncLayersPanel.
        Stage 1 (race): the signature (stroke count + paint epoch)
        changes immediately at commit, while the layer raster
        (itemCanvases.get(layer.id)) is baked asynchronously; the
        90ms paint timer painted from an empty source and locked
        paintedSig → the thumbnail never repainted.
        Fix: `inkThumbRetryIfEmpty` (31-ink-ui.js) — after painting,
        count non-alpha pixels of the 32px canvas (≤1024 px, cheap);
        if empty while the layer has ink, leave paintedSig open and
        requeue up to 3 times; quota resets when nz>0 and on each
        newer signature (inkFlushLayerThumbs).
        Stage 2 (scale): nz=9 was ALSO fidelity, not emptiness —
        the thumb fit the WHOLE canvas; a stroke covering <1% of the
        canvas collapsed to 1-2 pixels in the 26px frame.
        Fix: crop-to-ink — `inkThumbCropBox`: stroke points are in
        local 0..1 space, mapping 1:1 to layer.pxW/pxH canvas px;
        min/max bbox + reach pad; drawImage with source crop; the
        crop window is clamped to at least 12% of the canvas short
        side (context survives). BBox cached in `inkLayerThumbBBox`
        (keyed by count + pxW/pxH; gradient/fill covers the whole
        layer → null → full-fit). Probe: thumbnail nz 9 → 269,
        crop window 167×140 hugging the paint. User requirement
        "the drawn things must be visible" ✓.
      - ROOT · Group hierarchy: the old panel used only '▣ '/'└ '
        text prefixes; no visual nesting (no collapse engine — a
        separate FAZ 1 follow-up). Fix (style-only, style.css
        body.mode-draw block + draw-v5.css K6 block near the K4
        block): group row gets a light accent tint; member rows get
        a 30px indent plus a 2px left RAIL line (stacked members
        read as one continuous tree edge); the text prefix is
        hidden in draw mode; group rows carry an
        `.inkLayerGroupCount` chip ("N üye"). Original wording.
      - Panel additions (same package):
        - Footer buttons get `inkActionLabel` text labels
          (Görsel/Katman/Yukarı/Aşağı/Sil/Seçimi bırak) —
          index.html actions group; style.css body.mode-draw +
          draw-v5.css label/spacing rules.
        - Mask hint strip `#inkLayerMaskHint` in the layers panel:
          while mask editing is active it names the target layer
          ("X maskesi düzenleniyor"), states the black-hides /
          white-reveals rule, and offers a "Maskeyi bırak" exit
          button. Sync in inkSyncLayersPanel reads
          inkState().maskEditId; exit → inkDocToggleMaskEdit.
        - Row mask chip `.inkLayerMaskTag` ("maske" / "maske ✎"
          when editing) beside the layer name.
        - State fills: .on toggles (eye/mask/clip/alpha) get a 16%
          accent fill; .inkLayerLock.is-locked a danger-tinted fill.
        - Bug fixed en route: the mask chip branch read
          `maskEditing` before its declaration inside inkLayerRow
          (TDZ ReferenceError crashed inkSyncLayersPanel via
          inkDocAddMask); the computation moved to the top of the
          builder and is shared with the mask button block.
      - Test channels:
        - layer-canon-test.js 15 → 18/18 ✓ (K6 block: thumbnail
          carries paint (nz>20) · footer 'Sil' label readable
          (≤24 chars) · hint strip hidden while idle).
        - options-bar-test.js → 53/53 ✓ after three stale waits
          were re-anchored to shipped reality:
          (1) recents: #v5OptRecents was REMOVED earlier (FAZ 6
          A2, draw-v5.js renderRecents) — the test now verifies
          the panel strip #v5Recents plus the regression guard
          that the bar stays clean;
          (2) shape: the toolbar [data-tool="shape"] button was
          REMOVED (single path = the Çizim Ayarları gear menu) —
          the test presses+releases the toolbar grip without
          moving, opens openPanelsMenu, picks the 'Şekil aracı'
          row, then verifies #v5opt_shape (arrow → rect);
          (3) alpha lock: the options widget was intentionally
          removed (FAZ 6 A9, user request) — section 3c now
          asserts the toolbar button exists AND the v5opt widget
          does NOT (A9 contract) and that the toolbar toggle
          keeps layer field + aria + light in sync; the priority
          assertion narrowed to the honest core (Boyut+Opaklık
          visible, never overflowed — Yumuşatma may overflow at
          the compact cap).
      - Clean-room: `_probe-k6.js` deleted after verification.
        Build #6 package taken to dist_studio2 → Desktop copy;
        verify-package 12/12 ✓ against the new asar.

      **DURUM K8 · Clarity badges + icon legibility (2026-11-05,
      three PS-screenshot reports)**
      - Clip badge: rows that are clip members get
        `.is-clip-member` + a bent-arrow SVG badge
        (`.inkLayerClipArrow`, title "Bu katman altındaki katmana
        kırpılmış", click toggles clip via the row clip button).
        Target rule honored: `inkCanToggleClip` requires a base
        layer BELOW (stack index > 0); tests pick the topmost
        eligible row, not the freshly added bottom-layer dummy.
      - Mask pair: masked rows get `.inkLayerMaskPair` — chain
        SVG + `.inkLayerMaskThumb` 32px alpha→gray raster
        (`inkPaintMaskThumb`, cache `inkMaskRasterCache`, blank
        mask renders white). Click → `inkDocToggleMaskEdit`;
        editing row shows the accent state.
      - Icon legibility: passive `.inkLayerBtn` (lock/clip/alpha/
        mask) dim (opacity .38, hover-chain to 1); `.on` burns
        full accent, `.is-locked` full danger — "lit = active".
        style.css base block + draw-v5.css scoped overrides.
      - API added: `inkDocAddMask(layerId, 'reveal'|'hide')`,
        `inkDocRemoveMask`, `inkDocToggleMaskEdit`.
      - Channel: layer-canon-test.js 22/22 ✓ (clip badge appears
        + clears on toggle; mask pair appears + clears on remove).
      - Canvas editor bridge ("Çizim Yap"): when the bridge is
        present the button opens the separate Canvas Editor
        window (`openCanvasEditorForItem`); without it (browser
        host) it falls back to in-board draw mode. canvas-editor
        test 56/56 ✓ (the earlier 0px race was non-repeating).

      **DURUM K9 · Live slider balloon (2026-11-05, user report:
      "while dragging size/opacity I never see the real size or
      real opacity — open a small panel right below them")**
      - Implementation: draw-v5.js (no bundling — packaged
        directly). `v5BrushLiveEnsure/Paint/Show/Hide/
        ScheduleHide` + `LIVE_KEYS = {size, opacity, hardness,
        flow}`; `buildOptionRange`'s input listener calls
        `v5BrushLiveShow(input)` for live keys.
      - Real drawing: the balloon samples a horizontal stroke via
        the OFFICIAL engine `inkDrawStrokeOnContext(ctx, preview,
        { mapPoint, sizePx })` (same pattern as inkPreviewBrush,
        points in "size:1" space, px passed separately) — so tip,
        hardness, flow and opacity behave exactly like the real
        brush at the real ink.opacity.
      - Scale honesty: `scale = min(1, 300/real, 140/real)` — up
        to ~140px the stroke is 1:1; larger brushes are scaled to
        fit and the label appends "×0.NN" as a scale note. Label:
        `N px · %M[ · ×s]` (#v5LivePreviewVal).
      - Behavior: balloon opens under the dragged slider, hides
        ~850ms after release (pointerup), reopen on drag. CSS in
        draw-v5.css (`#v5LivePreview`, glass panel, checker
        visible through the canvas, z-index 860, pointer-events
        none, `[hidden]{display:none}`).
      - Channel: options-bar-test.js 53 → 57/57 ✓ (balloon opens
        on v5opt_size input · label contains real "N px · %M" ·
        auto-hides ~850ms · reopen on opacity drag). NB: hide
        assertion uses a 1.6s test wait — the Electron window is
        background during tests, so the page clamps its timers to
        ~1s; 850 still holds in a focused window.
      - Packaging: build #7 packaged the K8 sources; the K9
        balloon landed after v1 packing, so build #8 (same nav)
        is the asar with the balloon. dev-server.js added for
        browser-host testing at http://localhost:8787.

      **DURUM K10 · Field bugs from user screenshots (2026-11-05
      later reports)**
      - Layer context menu at far-left of screen: root cause —
        inkLayerMenuOpen anchored left = row.right - width, clamped
        to x=8, so a wide window flung the menu across the board.
        Fix: contextmenu handler passes pointer coords; the menu
        opens at the cursor (+2px) and is clamped on ALL sides
        (left = min(max(l,8), innerWidth-width-8), bottom flip
        keeps pointer reference, final both-axes clamp). The
        anchor path (footer buttons) still exists as fallback.
        Channel: layer-canon-test.js → 23/23 ✓ (K10: dispatches a
        contextmenu with clientX/Y, asserts the menu is fully in
        viewport and hugs the pointer band — clamped overlap at
        the right edge is accepted honestly, "flung to x=8" is
        the failure).
      - Space-pan dead after touching the size slider: two
        causes. (1) inkEditorKeyDown marked ANY focused INPUT as
        "typing" and ignored Space — range/checkbox matched even
        though 15-menu-export excludes them; the exception list
        is now identical in both handlers. (2) Focus was left on
        the range; draw-v5 buildOptionRange now blurs on
        pointerup ({once:true}) so keyboard-arrow users are
        unaffected.
      - Right-click menu flip tested green; the one-off 0/1 run
        was a window-creation flake, rerun immediately green.

      **DURUM K11 · Layer-row visual sweep (2026-11-05, user
      report "worst UI", "hangi ikon açık hangi kapalı")**
      - Removed the "maske ✎" pill from the name line
        (builder + both stylesheets): the K8 chain+mask-thumb
        pair already carries the same info; the pill inflated
        the row. Clean-room: .inkLayerMaskTag rules deleted.
      - Group member count: bordered pill "N üye" → plain dim
        number with title "N üye katman"; row name line is a
        single flex line (b + trailing count) — style.css base
        switched from column to row honoring draw-v5 blocks.
      - State icons single-glance rule ("lit = active"): active
        eye/mask/clip/alpha toggles get a SOLID accent fill with
        dark glyph + 2.2 stroke (was a 16% wash — invisible at
        18px); locked lock gets solid danger red; passive icons
        stay dim (.34) and warm to (.6) on row hover. Edit
        space: draw-v5.css K11 block (replaces state-fill block).

      **DURUM K9b · Balloon in the wild (2026-11-05, user report
      "balon çıkmıyor")**
      - Root cause: the balloon CSS z-index (860) sat under the
        floating panels/toolbar — visible in CDP tests, covered
        in the real layout. Fixed: z-index 3000 (above the layer
        menu at 2600).
      - Shape per user request history: S-wave artistic form was
        built (proven brush-library formula), then explicitly
        REJECTED by the user in two steps ("400px blob" complaint
        + "nokta görüntüsüne tekrar geç / iptal et"). FINAL
        SHAPE: single dab stamp at full pressure — the balloon
        shows ONE dot of the real brush, real hardness/opacity,
        centered. Rejection history retained below for honesty:
        S-wave (built, then outvoted) ← single-S wave ← user's
        first request was a line, then "sanatsal", then dot.
      - Real-size rule ("gerçek px görüntüsü, direkt neyse o"):
        scale = min(1, 340/real) — stamp is EXACT real size up to
        340px, label bare "N px · %M"; beyond that a single ×
        note. Canvas = draw + 24 (pad), square.
      - Never-overflow rule ("son boyutta panelden çıkmasın"): at
        draw ≥ 150 the balloon switches to COLUMN layout
        (`is-big` class): label on top, dot centered below —
        label squeeze can no longer crop the stamp; panel width
        bound draws only from the canvas.
      - Channels: options-bar-test.js 57/57 ✓; visual proofs via
        temporary CDP probe scripts/balloon-shot.js
        (tmp-balloon-shot.png) — the balloon at 52 px shows the
        full-size wave stamp and the bare label. The probe is
        kept (harness-class shot tool) with "balloon-shot" as the
        single entry point.

      **DURUM K12 · Type-in values (2026-11-05, user report:
      "2 kez tıklayıp kendim sayı girmek istiyorum")**
      - The widget OUTPUT ("3 px" label) now accepts a dblclick:
        it swaps to a text editor (decimal inputMode, value
        seeded from state divided by scale). Enter commits,
        Escape cancels (dataset.cancel), blur commits. The typed
        value clamps to the widget min/max and goes through the
        SAME write path as the slider (ink[w.key] = v*scale + the
        brush-override dance + syncs + live balloon for LIVE_KEYS).
        Keyboard events stopPropagation — no Space-pan leak from
        the editor.
      - Channel: options-bar-test.js → 59/59 ✓ (K12: dblclick opens
        editor, "64" + Enter writes inkState.size=64 and the output
        repaints as "64 px"; auto-hide flake resolved on rerun —
        background-timer clamp, not a regression).

      **DURUM K13 · Options-bar clean-up: remove hardness/flow,
      move mouse-pressure & symmetry to menu (2026-11-06, user:
      "bu sertlik kısmını kim koy" / "bunu da kaldır burdan" /
      "bu iki ayarı çizim ayarları kısmına taşı")**
      - Toolbar simplification: hardness + flow widgets REMOVED from
        the options bar for every tool schema (brush/pencil/eraser/
        fill/smudge/liquify/gradient/shape). 58-ink-tool-manifest.js
        no longer declares them as options-bar widgets; the values
        live on in panels and engine defaults.
      - Mouse-pressure toggle and Symmetry moved INTO the drawing
        settings menu: openPanelsMenu gained a "Fare basıncı" row
        (K11 piston visual) and a "Simetri ▸" submenu
        (openSymMenu: Off / X-mirror / Y-mirror / X+Y / Radial 4 /
        Radial 8 → inkState().symMode + inkSyncUI + scheduleSave).
      - Double-duty brush button: when ALREADY on brush, clicking
        the brush tool button opens the brush library (prevTool is
        captured before setTool's switch). Single click selects;
        second click customizes.
      - Typed-editor protection (root cause of "typing deletes the
        editor"): sync() no longer repaints an output while an input
        editor is inside it (`out.querySelector('input')` guard);
        sliders skip textContent repaints while editing. Overflow
        ceiling raised 900→1220 px; rotate chip moved AFTER the "⋯"
        chip (rightmost). Workspace shortcuts are suspended while
        typing in INPUT/TEXTAREA/SELECT/contenteditable.
      - Channel: options-bar-test.js → 59/59 ✓ (widget schema per
        tool, menu moves, double-duty brush, typed editor, ceiling);
        symmetry-test.js → 16/16 ✓ (menu-row symmetry control).

      **DURUM K14 · Industrial opacity/size accuracy (2026-11-06,
      user: "opaklığı 8'e getirdim ama hâlâ aşırı görünüyor" / "endüstri
      standartı değil gibi")**
      - Root cause: dab alpha was a flat multiply, so overlapping
        dabs compounded — 8% opacity filled to ~56% inside a stroke;
        the hard-path branch compounded a `1-(1-α)³` cube gain
        (8% read ~22%).
      - Fix (PS rule: "opacity does not accumulate within one
        stroke"): dab alpha is n-root-diluted,
        αdab = 1-(1-αsat)^(1/overlapN), with overlapN =
        ceil(2×radius / real dab pitch) taken from the RECORDED
        dab-to-dab distance (prevDab), NOT from spacingPx — dense
        input segments emit one dab per segment, so the real pitch
        is the segment length. 33-ink-stamp.js path branch is now
        LINEAR (single pass, no accumulation). Live preview shares
        the same formula (gap from inkLastLive); eraser stays
        accumulating inside a stroke (PS behavior). Worker + GPU
        (40-ink-dab-glsink shim) share the same dab loop → parity
        is automatic.
      - Channel: scripts/opacity-size-probe.js (NEW, permanent)
        → 5/5 ✓: OPKLK-1 8% inner fill ≈ 8%, OPKLK-2 1% < 6%,
        OPKLK-3 100% saturates, BOYUT-1/2 75px brush thickness
        exact ±3px, deterministic. Regression: canvas-editor-test
        exit 0 ✓, symmetry 16/16 ✓, layer-canon exit 0 ✓.
      - Package: bundle rebuilt, portable #13 → dist_studio/
        TailRef_Studio.exe, verify-package 12/12 OK, Desktop copy
        refreshed.

## FAZ 8 - KATMAN MİMARİSİ: Observer Store + Diff Panel (v1, bu depoya özgü)

Köken: kullanıcı bir dış şablon promptu ("layers.ts / constants.ts /
panel.html · State-Driven Event-Based dönüşümü") getirdi; o şablonun
dosyaları bu depoda YOK (proje TS'siz, `build-app.js` birleştime) ve
"hiçbir sessiz try bırakma" kuralı render sıcak yoluyla çelişiyordu.
SEÇİM (kullanıcı 2026-11-05): şablon TERK edildi; bu liste şablonun
ruhudan damıtılmış v1. Sessiz try kuralı: yalnız bootstrap/kurulum
fonksiyonlarında log; render içi sessiz try'lar bilinçli 60fps
tercihi olarak kalır.

### K. FAZ 8 maddeleri (sıra ile işlenecek)

| # | Madde | Mevcut durum | Not |
|---|-------|--------------|-----|
| 8.A | `50-layer-stack.js` inkDoc* mutasyon anchor'larına ~50 satır pub/sub (emit: add/remove/reorder/rename/property/mask) | **TAMAM (2026-11-06) ✅** `inkLayerStore` (On/Off/Emit, sessiz-try YOK) + 20 anchor; `layer-store-test.js` **23/23** | "sync çağrısı unutma" hatasını kökten kuran vakı |
| 8.B | `31-ink-ui.js` `inkSyncLayersPanel` abonelikle beslenir; onlarca elle çağrı kaldırılır | **KISMİ TAMAM (06.11) ✅** abonelik kurulu; 50-layer-stack'de elle call 9→1; regression: layer-canon + options-bar | 30/34/36/12-13'teki stash/undo/trash yolları ayrı event tasarımı gerektirir — 8.C ile değerlendirilecek |
| 8.C | Satır-düzeyi diff (`replaceChildren`): liste komple yeniden kurulmaz, değişen satır güncellenir | **TAMAM (06.11) ✅** `inkLayerRowSig` imza diff'i + duplicate-guard; `layer-store-test` 28/28 (kept/fresh/structural) | Bonus: FAZ 1'den kalma `inkAddGroupMember` çoğaltma bugı ölçümle yakalandı ve düzeltildi (K3 çift-undo aynı turda) |
| 8.D | `dispose(layerId)`: canvas + thumb + bbox cache tek noktadan silinir | **TAMAM (06.11) ✅** `inkLayerDispose` (50-layer-stack) tek nokta; `layer-dispose-test` 17/17 (maske/baked sızıntı kanıtı + 8×döngü boyut stabilitesi) | Bonus: `inkAddGroupMember` üye-taşıma dize sıçraması ölçümle yakalandı, plan `members:[]` + flatten reddi kökten düzeltildi |
| 8.E | Afordans artığı: DnD tamamlanırken FLIP kayma animasyonu ("tak" yerine kayma) | **TAMAM (06.11) ✅** `inkLayerRowsFirst/FlipPlay` (31-ink-ui) WAAPI; `layer-flip-fold-test` 14/14 | WAAPI `anim.finished.catch` (Animation thenable değil); reduced-motion kısayolu |
| 8.F | Grup klasör katlanma oku (chevron): klasör satırına açılır-kapanır ok + üye satırları katlanınca gizlenir (`folded` bayrağı panel-düzeyinde; motor dokunulmaz) | **TAMAM (06.11) ✅** `inkLayerFold` + `inkFolderFoldedIds` (31-ink-ui); aynı kanal 14/14 | Panel-düzeyi: 0 store olayı, motoru sıfır — ölçümle kanıtlandı |
| 8.B öte | stash/undo/trash elle panel çağrıları | **TAMAM (06.11) ✅** prune 'remove(reason:prune)' (0.B.5); undo/redo restore diff'i 'add/remove/reorder/rename/property + restore' olaylarına bağlandı (0.B.6): bütün-durum `inkLayerStoreEmitRestoreDiff` (50-layer-stack), vuruş-delta TEK `property(raster)` (34-ink-undo); elle panel sync çağrıları 0 | Undo noktası yok olan işlemler pushUndo'ya bağlandı (0.B.7): add layer/duplicate/newGroup/addToGroup — Ctrl+Z yalnız bu işlemi geri alır, TEK `remove(reason:restore)` olayı duyurulur. Zincir turu ek iyileştirme (0.B.8): options-bar K12 elle-giriş commit'i artık blur'a güvenmez — pencere odaksızken yazım kayıyordu |

Kullanıcı rapor eşlemesi (2026-11-05 beş madde analizi): affine
eksikken K4/K6 ile kapandı ("border-left" → aktif satır bar'ı ve zemin
dolgu testli), "ayna UI" birkaç pencere kullanılmamaktaydı (Observer
ruhu = 8.A/8.B), "kırpma maskesi yok" teşhisi yanlıştı (kompozitörden
K3 diyaloğuna çizgi dahil tam zincir zincirde compositor 24/24 +
layer-canon 18/18 artık). Gerçek açıklar yalnız 8.B, 8.C, 8.D, 8.E ve
tooltip: üç PS-görsel raporu (klip oku, maske kanca+çift, grup oku)
2026-11-05'te vukiyi katman K8 öncesi çalışıldı (aşağıda).

Kanal kuralı (FIRMA): her madde kendi test kanalı ile kapanır.
8.A/8.B/8.C/8.D için `scripts/layer-store-test.js` (yeni), 8.E/8.F için
`layer-canon-test.js` uzatma. Sessiz try kural bu fazda: sadece
bootstrap.

### 8-PRE KIVILCIM (Canvas Editor) — "Çizim Yap" kararı

Kullanıcı kararı (2026-11-05): görsel seçiliyken "Çizim Yap" = ayrı
Canvas Editor penceresi (köprü varken). bununla ilgili; tarayıcı host
(bridge yok) tahta-içi moda düşer. Önceki aksamda kanal belirlendi:
`btnDrawImage` handler mod release modeToggleDrawForSelection'dı
(31-ink-ui.js:2040-2052), `openCanvasEditorForItem` (38-köprü) yazılmış
ama hiçbir yerden çağrılmıyordu. FEARS: layer-canon-test yeni Canvas
girişi kullanmiyor (newCanvasModal yolu) → düğme taşınıyor—

---

## UYGULAMA SIRASI (executive)

| # | Faz | Effort | Kazanç |
|---|-----|--------|--------|
| 1 | Compositor + alpha lock + clipping | 3–4 g | Ekran==export; mask/lock/gup motoru |
| 2 | One-Euro input | 2 g | Çizgi kalitesi 10× his |
| 3 | Linear/OKLab renk | 3 g | "Muddy" biter |
| 4 | Tile worker + tile-diff undo | 5–7 g | Su-boya donmaz; RAM dümen |
| 5 | Options Bar manifest | 3–4 g | Pro UX |
| 6 | UX quick wins (A kümesi) | 2–3 g | referans uygulama parite; parity + Kısayol |

Toplam ≈ 16–20 iş günü efor. Fazlar ARA kritik noktalarda `npm test` regreasyonuna tabii; her faz bitişinde build + full suite yeşil kapatılır.

Faz 2 ve 3 bağımsız olduğundan istenirse paralelde yürütülebilir; Faz 4, Faz 1'in tile altyapısını ister (bu nedenle sıra 1 → 2/3 → 4 → 5).
