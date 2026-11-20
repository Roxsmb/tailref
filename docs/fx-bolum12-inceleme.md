# TailRef · FX Motoru Bölüm 12 — Kod Tabanı İnceleme Raporu
(kayıt: 2026-11-18 · master spec `docs/fx-motoru-spec.md` Bölüm 12 gereği · kod yazmadan ÖNCE okunacak)

> Kaynak doğrulama: üç paralel inceleme (layer/compositor, render/GPU, serialization/panel) + mimari
> dokümanlar. Satır referansları `src/renderer/core/` içindir; `app.js` build üretimidir (BAYAT —
> 01:06 üretim, kaynaklar 01:11'de daha yeni; ilk değişiklik sonrası `node scripts/build-app.js` zorunlu).

---

## 1. Mevcut Layers sistemi nasıl çalışıyor

**İki düzlem var: tahta (items) + mürekkep katmanları (ink.layers).**

### 1a. Item modeli (`10-items.js:44-50`)
- Tahta öğesi: `{ id:'it_…', kind:'image', imageId, x, y, w, h, rot, z }` — katman **yok**; konum/ölçek item'a aittir.
- Her görsel item'ın içine bir **attached ink katmanı** kanvası eklenir: `inkEnsureItemCanvas()` (`29-ink-render.js:83-130`, class `inkLayerCanvas`). Bitmap boyu `inkPickAttachedBitmapSize()` (`29:65-81`) — **tavan 2800px**, `dpr≤2`, `willReadFrequently:true` (`:114`).
- **Global katmanlar**: sonsuz tuval, dünya uzayı **512'lik karolar** (`INK_TILE_SIZE=512`, `27-ink-core.js:18`), `inkEnsureTile()` (`29:679-697`) `#inkWorld`'e absolute ekler.

### 1b. Katman nesnesi (`27-ink-core.js:640-663` `inkMakeLayer()`)
```
{ id:'ly_…', name, kind:'attached'|'group'|'global', ownerId, parentId,
  visible, locked, alphaLock, clip, opacity(0-1), blend, plane, pxW, pxH, strokes[] }
```
- Yükleme/sanitizasyon: `inkNormalizeLayer()` (`27:533-579`) — alanları kelepçeler, `baked`/`mask` dataURL'lerini doğrular, vuruşları `inkNormalizeStroke()` (`27:581-638`) ile normalize eder. **FX verisi bu noktada korunmalı** (bkz. §4-C).
- Sıralama API'si: `inkDocReorderLayer` (`50:998`), `inkDocMoveLayer` (`50:969`), `inkDocApplyOrder` (`50:1020`), opaklık `inkDocResetOpacity` (`50:1249`), görünürlük `inkDocSetVisible` (`50:1216`). Hepsi `pushUndo` → alan yazımı → `inkDocAfterChange` (`50:456-466`) → `inkLayerStoreEmit(...)` (`50:1329-1339` abonelik) → `inkSyncLayersPanel` (`31-ink-ui.js:2150`).
- **Sanitize kaldırma durumu**: TAMAMLANDI — `inkDocSanitizeGroups` kaynakta yok/çağrılmıyor; doc-comment'ler (`50:967,988,1012`) çözümün kompozitör planında `bound` ile yapıldığını belgeliyor (53:69-103/258 ile doğrulandı). Bundle güncel, tam batarya yeşil; sıra/üyelik regresyonu `layer-flip-fold` 17/17 ile korunuyor.

### 1c. Panel (`31-ink-ui.js` + `index.html:574-640`)
- `#inkLayersPanel > #inkLayerList (role=list)`; satır üretimi `inkLayerRow()` (`31:1830+`); 32px minyatür önbelleği `inkLayerThumbCache`/`inkPaintLayerThumb` (`31:1468-1749`); özellik diyaloğu `#inkLayerPropsDialog` + `inkLayerPropsApply` (`50:1588-1664`).
- Aksiyon düğmeleri: `#btnInkAddLayer/#btnInkAddAttached/#btnInkDeleteLayer/#btnInkLayerUp/#btnInkLayerDown` (index.html:631+). FX "Efekt Ekle" karosu bu düğme sırasına eklenir.

---

## 2. Canvas nasıl render ediliyor

### 2a. DOM + görüntüleme
- `index.html:113-126`: `#stage → #world → [.item …, #inkWorld, #linkLayer]`. **Zoom/pan tamamen CSS transform** (`applyView()`, `04-persistence-view.js:405-428`): `translate + scale`; kanvas çözünürlüğü asla değişmez. `MIN_SCALE=0.02 / MAX_SCALE=40`.
- Attached katman kanvası item'ın çocuğu → taşıma **bedava** (transform ile, `06-render.js:113-128` `translate3d`, layout tetiklenmez).

### 2b. Composite (grup/klip) görüntüleme — FX'in oturacağı yer
- `inkCompositeSyncItem(it, el)` (`53-ink-compositor.js:287-379`): kompozit gerekiyorsa her plan girişi için `.inkGroupCanvas[data-ink-base]` kanvası item elementine basar; `zIndex=2+idx`, `style.opacity`, `style.mixBlendMode` DOM üzerinden uygulanır. Üye katman kanvasları `display:none` yapılır.

### 2c. Performans altyapısı (FX önbellek deseninin kaynağı)
- **Gen sayacı**: `inkCompositeRuntime.gen` (layerId→piksel sürümü; `inkBumpLayerGen`/`inkLayerGen` `53:36-44`).
- **Grup raster imzası**: `inkGroupCacheSig` (`53:142-157`) = `[w,h,kind, her üye: layerId+gen+opacity*1000+blend+clip+visible]`.
- **Vuruş taban önbelleği**: `inkStrokeBase` (`29:277`, LRU 4, ≤96MP; imza = boy+bakedKey+vuruş hash toplamı), **damga önbelleği** `inkStrokeStamp` (`29:483`), baked/mask raster önbellekleri (`29:139,188`).
- **Kirli bölge**: `inkDirty` defteri + rAF (`33-ink-stamp.js:306-398`) — `inkMarkLayerDirty(layer,rect,full)` / `inkFlushDirtyLayers()`.
- **Sayaçlar**: `32-ink-perf.js` (`inkPerfCount/Span/Snapshot`, Alt+P HUD) — FX fazlarında ölçüm bununla yapılır.

### 2d. GPU / worker durumu (master spec Bölüm 7 gerçekleri)
- **WebGL2 VAR ama yalnız canlı vuruş önizlemesi** (`40-ink-dab-gl.js:60-169`, FBO + doku LRU 12, ≤2^26 px). Kalıcılık/undo/export her zaman 2D CPU yolu (`40:8-12` başlık notu) — **CPU fallback her zaman parite referansı**.
- **`ctx.filter` sadece dışa aktarımda** kullanılıyor (`15-menu-export.js:656,1416`). Chromium'da GPU hızlandırmalı; FX'te kullanılabilir ama determinizm testi gerekir.
- **Worker + OffscreenCanvas VAR** (`35-ink-worker.js:38-45`, eşik 2400 damga/2048²; `workers/ink-worker.js`). `workers/ink-region-worker.js` **ölü kod** (0 referans) — FX worker ihtiyacında desen olarak `35-ink-worker.js` alınmalı.
- Dışa aktarım ayrı compose yolu: `renderExportCore()` (`15:557-699`) DOM'a dokunmadan sıfır kanvastan çizer; `inkDrawAttachedForExport` (`15:669`) + `inkCompositePaintPlanToContext` (`53:461-470`). **Ekran=export tek kaynak ilkesi FX'te de korunmalı: FX zinciri iki yola da aynı fonksiyonla bağlanır.**

---

## 3. Effects Layer mimarisi NEREYE entegre olacak

**Karar: FX zinciri, kompozitör plan girişlerinin ÜSTÜNE aşamalardır.**

```
inkAttachedDisplayPlan(ownerId)  →  [giriş1, giriş2, …]   (53:60-97)
        ↓ her giriş raster: inkCompositeGroupRaster (53:188-239)
        ↓ FX AŞAMALARI: plan girişi kanvası → FX1 → FX2 → … (inkFxApply)
        ↓ item DOM'una tek `.inkFxCanvas` (mevcut inkGroupCanvas deseninin yanyavaşı)
```

Somut bağlantı noktaları:
| Nokta | Dosya | İş |
|---|---|---|
| Plan üretimi | `53-ink-compositor.js:60-97` | FX katmanları ayrı layer kind veya `item.fx.stack`? → **karar: `layer.kind='fx'` DEĞİL; `item.fx.stack` plan girişi sonrası aşama** (ilk fazda yalnız attached; bkz. §5-C global karo kısıtı) |
| Ekran senkronu | `53-ink-compositor.js:287-379` `inkCompositeSyncItem` | FX çıktısı tek `inkFxCanvas` overlay; katman kanvasları zaten gizleniyor |
| Geçersizleme | `53:36-44` gen + `53:142-157` sig | FX aşama imzası: `sig = prevSig + type + JSON(params) + seed + size` — yalnız o aşama + ALTTAKİLER düşer |
| Export | `15-menu-export.js:557-699` | `inkDrawAttachedForExport` planı FX aşamalarıyla aynı fonksiyondan geçirir |
| Panel | `31-ink-ui.js` + `index.html:574-640` | `#inkLayerList` satırlarına FX katmanı + "Efekt Ekle" karosu (`#btnPanelsBar`/`overflowTile` deseni BÖLÜM 4 tarayıcısı için) |
| Undo | `04-persistence-view.js:280-302` `pushUndo` | `createStateSnapshot()` JSON.stringify **tüm item alanlarını otomatik kapsar** → `item.fx` ekstra iş gerektirmez |
| Kayıt | `27-ink-core.js:533-579` `inkNormalizeLayer` + `.tail` | FX params `ink.layers` JSON'unda; normalize'a fx doğrulaması eklenir; `.tail` formatı (magic `TAIL`, version 1, `main.js:1198-1293`) değişmeden taşır |
| Presetler | `52-native-brush-library.js` deseni | IndexedDB `meta`, sabit anahtar (`ink:fx-presets`), `version` alanlı object, tek persist kapı, merge-on-load (`52:2863-2927`) |

**Modül numarası düzeltmesi:** plan `56-ink-fx.js` diyordu ama **56 alınmış** (`56-ink-color.js`). Yeni modül: `src/renderer/core/64-ink-fx.js` (en yüksek numara 63-theme-studio.js).

---

## 4. Yeniden kullanılabilir bileşenler

- **A. Önbellek imza deseni** — `inkGroupCacheSig` + gen sayacı, FX aşama önbelleğine birebir taşınır (Bölüm 6/7 spec şartı zaten bu desende kanıtlanmış).
- **B. Kirli bölge + rAF defteri** — `inkMarkLayerDirty/inkFlushDirtyLayers` (`33`); FX parametre sürüklerken düşük-çöz önizleme + tam çöz debounce buna bağlanır.
- **C. Persist**: `item.fx` undo'ya otomatik girer (snapshot JSON); `.tail` zlib JSON — FX alanı ekstra şema değişikliği gerektirmez; `inkNormalizeLayer`'a fx default/kelepçe eklemesi yeter.
- **D. Preset deposu**: `ink:library` deseni (`52:2863-2927`) — versiyonlu + merge-on-load + tek yazma kapısı. Kullanıcı presetleri proje bağımsız (spec Bölüm 5 ✓).
- **E. Panel/UI desenleri**: `overflowTile` karosu (`index.html:1354-1362` + `17-floating-panels.js:709-731` trigger haritası), Ayarlar hub'ı (`60-settings-hub.js` nav/page deseni), range-fill (`syncRangeFill`), `57-ink-color-picker.js` (statik DOM + id haritası + bind + L10N) — FX Properties inspector bu kalıplarla kurulur.
- **F. Tema tokenları**: `draw-v5.css:8-42` (`--v5-*`, `color-mix()` türetme) — yeni FX paneli otomatik temalı olur.
- **G. Ölçüm**: `32-ink-perf.js` sayaçları + Alt+P HUD — FX cache hit/miss metrikleri eklenir.
- **H. Worker/OffscreenCanvas altyapısı**: `35-ink-worker.js` (staleness kontrolü, parça limitleri) — ağır efektler (Stippling, Oil Paint) için faz 3'te değerlendirilir.

---

## 5. Teknik kısıtlar (uygulamayı etkileyen)

- **A. `willReadFrequently:true`** attached katman kanvaslarında (`29:114`) → bu kanvaslar **CPU-backed**. FX aşama kanvasları YENİ kanvas olmalı (flag'siz, GPU composite için) — mevcut item kanvasını FX'e girdi olarak okurken `drawImage` (GPU blit) kullan, `getImageData`'yı yalnız gerçek piksel-algoritmalar (Stippling, Dithering, Contour) zorunlu kıldığında yap.
- **B. Attached bitmap tavanı 2800px** (`29:65-81`); global katman **512'lik karolar** halinde DOM'da. **Global katmanlara FX, faz 1-2'de KAPSAM DIŞI**: efekt karo sınırlarını aşar (halftone açısı karolar arası kopar). Karo dikişsizliği için bileşik tuval gerekir → faz 3 kararı, raporlanmalı. Spec Bölüm 11 "yüksek çözünürlük" şartı attached yoluyla sağlanır.
- **C. `renderExportCore` DOM'dan bağımsız** — FX ekranı DOM overlay'e, exportu düz kanvas çizimine bağlar; **tek kaynak fonksiyon** (`inkFxApply(ctxIn,ctxOut,params,size,seed)`) şart, aksi halde ekran≠export sapması spec ihlali.
- **D. `ctx.filter` determinizmi**: Chromium GPU blur deterministic kabul edilemez düzeyde olabilir → test bataryası (`tests/fx-pipeline-test.js`) "aynı seed → aynı pikseller" doğrulamasında CPU parite yolu (40-ink-dab-gl.js başlık notundaki ilke) referans alınmalı; filtre kullanan efektlerde tolerans/parametre sabitleme gerekir.
- **E. Undo bütçesi**: raster snapshot 32MB/adım, 128MB havuz (`34-ink-undo.js:30-59`). FX katmanı piksel üretmez (parametrik) → undo maliyeti küçük; ancak "FX raster'ı baked'e çevir/flatten" eylemi eklenirse vuruş delta yolu (`inkPushUndoStroke`) devre dışı kalır, tam snapshot yolu kullanılır.
- **F. Build/bundle disiplini**: `app.js` üretilmiş pakettir; kaynak `core/*.js` değişince `node scripts/build-app.js` ZORUNLU (npm.cmd; npm.ps1 engelli). Mevcut bundle bayat — ilk iş build+test (durum logu m.3-4).
- **G. Karışım modeli**: bugün blend/opacity DOM'da (`mixBlendMode`/`style.opacity`) uygulanıyor; FX sonrası çıkış tek kanvas olduğundan **FX katmanının blend/opacity'si pişirilmeli** (plan zaten böyle) — DOM mixBlendMode ile FX piksel çıktısı karıştırılmamalı, aksi halde export sapar.
- **H. Ölü kod**: `workers/ink-region-worker.js` hiçbir yerden spawn edilmiyor — FX worker'ı için kafa karışıklığı yaratmasın; ya silinmeli ya da `35-ink-worker.js` referans alınmalı (öneri: bu işlemler sırasında silme KONUSU olarak işaretle, bu işin dışında dokunma).
- **I. `.tail` geriye dönük uyum**: payload version 2 sabit; fx alanı yokluğu = efekt yok (`inkNormalizeLayer` default) → eski dosyalar bozulmaz (master spec Bölüm 8 ✓).

---

## 6. Faz 1 uygulama haritası (raporun sonucu)

1. `64-ink-fx.js` YENİ modül: veri modeli (`item.fx.stack`), `inkFxApply` tek kaynak fonksiyonu, mulberry32 PRNG, aşama sig/önbellek, geçersizleme kancaları (`inkBumpLayerGen` çağıran her yer FX alt-geçersizlemesini tetikler — `53`'te gen zaten vuruş commit'lerinde bump ediliyor).
2. `53-ink-compositor.js`: `inkCompositeSyncItem`'e FX dalı (en az 1 görünür FX → `inkFxCanvas`).
3. `15-menu-export.js`: `inkDrawAttachedForExport` FX dalı (aynı `inkFxApply`).
4. `31-ink-ui.js` + `index.html`: FX katman satırı + inspector panel iskeleti (karo/panel desenleri §4-E/F).
5. `27-ink-core.js`: `inkNormalizeLayer` fx doğrulaması.
6. Testler: `tests/fx-pipeline-test.js` YENİ + mevcut batarya (layer-store-test 42/43 hedefi kırmızı kapanacak — FX'ten ÖNCE koşulur).

**Ölçüm hedefleri (Faz 1 kabulü)**: 1 efekt × 2800px item'da slider sürükleme ≤16ms/kare (düşük çöz), cache hit oranı ≥%90 statik sahnede, Alt+P HUD'ta fx aşama süresi görünür.
