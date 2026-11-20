# Canvas Editor — Mimari

TailRef Studio'nun donanım hızlandırmalı çok katmanlı tuval editörü.
referans çizim uygulamalarının davranışını hedefler: vuruş izolasyonu, quadratic
Bezier yumuşatma, %15 damga aralığı, alpha kilidi, kement seçimi,
taşıma, boya kovası, 30 adımlı bellek güvenli geri alma ve Windows
uyumlu Liquid Glass arayüz.

```
src/canvas-editor/
  types.ts       arayüzler + sabitler + createSurface (OffscreenCanvas)
  camera.ts      pan/zoom; ctx.setTransform (CSS scale YOK)
  brush.ts       quadratic Bezier + spacing damga motoru
  layers.ts      backing (doc px) + canvasRef (viewport px) katmanları
  history.ts     30 adımlı undo/redo, ImageData ↔ PNG adaptif
  editor.ts      DOM, pointer girdisi, UI, drag & drop, commit
  bootstrap.ts   preload köprüsünden payload alıp editörü başlatır
  tsconfig.json  tsc --outFile → ../../canvas-editor.js
```

Derleme: `node scripts/build-canvas-editor.js` (tek global betik üretir).
Test: `node scripts/canvas-editor-test.js` (53 doğrulama).

## 1. Pencere ve süreç ayrımı

| Katman | Dosya | Görev |
|---|---|---|
| Ana süreç | `canvas-editor-main.js` | Ayrı `BrowserWindow`, IPC handler'ları, payload/commit yaşam döngüsü |
| Preload | `preload.js` → `tailref.canvasEditor` | `ipcRenderer.invoke` sarmalayıcıları |
| Tahta (renderer) | `src/renderer/core/38-canvas-editor-bridge.js` | Payload üretimi, sonucu `addFiles` ile panoya ekleme |
| Editör (renderer) | `canvas-editor.html` + `canvas-editor.js` | Çizim, katmanlar, UI |

Editör penceresi: `frame: false`, `transparent: true`,
`backgroundColor: '#00000000'`. `titleBarStyle`/`trafficLightPosition`
yalnızca macOS'ta uygulanır; Windows'ta özel başlık çubuğu kullanılır.

IPC yüzeyi:

```
canvas-editor:open      (tahta → main)   payload ile pencere açar
canvas-editor:payload   (editör → main)  payload'ı döndürür
canvas-editor:save      (editör → main)  PNG kaydetme diyaloğu
canvas-editor:commit    (editör → main)  sonucu tahtaya gönderir, pencereyi kapatır
canvas-editor:cancel    (editör → main)  vazgeç
canvas-editor:minimize  (editör → main)  simge durumu
canvas-editor:maximize  (editör → main)  büyüt/geri yükle; yeni durumu döndürür
canvas-editor:state     (main → editör)  OS kaynaklı maximize/unmaximize senkronu
canvas-editor:result    (main → tahta)   CommitResult | null
```

`open` yalnızca ana pencereden, diğerleri yalnızca editörün
`webContents`'inden kabul edilir. PNG verisi data URL'den çözülür ve
PNG imzası doğrulanır.

## 2. Çoklu kanvas katmanları

DOM sırası (alttan üste):

1. `canvas#grid-background` — dama deseni + ızgara; yalnızca kamera
   değişince yeniden çizilir.
2. `canvas#layer-[id]` — her katman için viewport boyutlu fiziksel
   canvas; `mix-blend-mode` ve CSS `opacity` ile harmanlanır.
3. `canvas#active-stroke` — yalnızca sürüyen vuruş.
4. `canvas#ui-cursor` — fırça ucu; `pointer-events: none`.

Her katmanın **iki** yüzeyi vardır:

* `backing` — doküman çözünürlüğünde offscreen bitmap (kalıcı veri,
  undo, dışa aktarma).
* `canvasRef` — viewport boyutlu DOM canvas; her karede
  `camera.apply(ctx, dpr)` ile çizilir.

`Layer.canvasRef` spesifikasyondaki `HTMLCanvasElement | OffscreenCanvas`
birleşiminin DOM tarafıdır (z-index'li fiziksel katman gerektiği için
HTMLCanvasElement'e daraltılmıştır). OffscreenCanvas, fırça ucu
maskelerinde ve yardımcı yüzeylerde (`createSurface`) kullanılır.

Display tuvali `LayerManager.create()` içinde **hemen** viewport
ölçüsüne getirilir (`sizeDisplay`). Aksi halde sonradan eklenen katman
varsayılan 300×150 tuvalde kalır ve vuruşlar backing'e işlense bile
ekranda görünmez (bu davranış `canvas-editor-test.js` içinde iki ayrı
doğrulamayla korunur).

## 3. Fırça motoru

* `lineTo` yok. Noktalar midpoint şemasıyla quadratic Bezier'e çevrilir:
  `start = curveEnd`, `control = p1`, `end = midpoint(p1, p2)`.
* Eğri, ~1.25 px adımlarla örneklenir; her örnekte `Math.hypot` ile
  birikimli mesafe ölçülür ve fırça çapının **%15**'i aşıldığında damga
  basılır (`residual -= spacing`, artık mesafe korunur).
* Basınç: kalem/tablette `e.pressure`, farede sabit `0.5`.
  Yarıçap = `size/2 * (0.25 + 0.75 * pressure)`.
* Damga uçları 128×128 radyal gradyan maskesi olarak önbelleğe alınır
  (en fazla 64 uç; LRU benzeri tahliye).
* Vuruş opaklığı damga başına değil, kompozit sırasında bir kez
  uygulanır; üst üste binen damgalar kararmaz.
* Damgalar **her zaman** `source-over` ile `strokeBuffer`'a biriktirilir.
  Tampon boş bir tuval olduğu için `destination-out` ile damga basmak iz
  bırakmaz; silme (`destination-out`) ve alpha kilidi (`source-atop`)
  yalnızca katmana kompozit sırasında uygulanır.

## 4. Vuruş izolasyonu ve pişirme (baking)

```
pointerdown → strokeBuffer temizlenir, before snapshot alınır
pointermove → strokeBuffer'a damga
pointerup   → strokeBuffer, hedef katman backing'ine kompozit edilir
              → after snapshot alınır → History.push(Command)
              → strokeBuffer temizlenir
```

Kompozit modu:

| Durum | globalCompositeOperation |
|---|---|
| Normal | `source-over` |
| Silgi | `destination-out` |
| Alpha Lock | `source-atop` |

Silgi ve alpha lock sırasında hedef katmanın DOM canvas'ı gizlenir;
`active-stroke` üzerinde `preview = backing kopyası + vuruş` canlı
olarak gösterilir. Böylece kullanıcı silmenin/kilitli çizimin gerçek
sonucunu anında görür.

## 5. Kamera

CSS `transform: scale()` kullanılmaz (pikselleşme). Her render'da:

```js
ctx.setTransform(scale * dpr, 0, 0, scale * dpr, panX * dpr, panY * dpr);
```

`Camera.zoomAt(factor, viewX, viewY)` verilen görüntü noktasını sabit
tutar. Editör `Ctrl` + tekerlek girdisinde **tuval merkezini**
(`viewW / 2`, `viewH / 2`) sabitler; böylece imleç nerede olursa olsun
odak kaymaz. Alt durum çubuğundaki `#ce-zoom` yüzdesi her kamera
değişiminde güncellenir. Kısayollar:

| Girdi | Eylem |
|---|---|
| `Space` + sürükle | pan (`grab` / `grabbing` imleci) |
| `Cmd/Ctrl` + tekerlek | tuval merkezli zoom |
| `V` / `L` | taşıma / kement |
| `B` / `E` | fırça / silgi |
| `I` / `G` | damlalık / boya kovası |
| `[` / `]` | fırça boyutu ±%15 |
| `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` | undo / redo |
| `Cmd/Ctrl+S` | PNG kaydet |
| `0` / `1` | sığdır / %100 |
| `Alt` + tık | damlalık |
| `Esc` | seçimi temizle / taşımayı iptal et |

## 6. Geri alma (memory-safe)

`History` en fazla **30** komut tutar. Her `pointerup` yalnızca işlem
gören katmanın `before` ve `after` anlık görüntüsünü saklar.

* ≤ 4 megapiksel: `ImageData` (hızlı, sıkıştırmasız).
* > 4 megapiksel: PNG `dataURL` (ham bitmap'in ~1/8'i).

Ek olarak 192 MB toplam bütçe vardır; aşılırsa en eski komutlar
düşürülür. Katman silinirse o katmana ait komutlar `dropLayer` ile
temizlenir. Redo yığını yeni vuruşta geçersizleşir.

## 7. Katman yönetimi

`LayerManager` dizisi **alt → üst** sıradadır; DOM sırası da aynıdır
(`#active-stroke` çapası öncesine eklenir). Sürükle-bırak, görüntü
sırasını (üst → alt) dizi sırasına çevirir:

```
targetDisplay = n - 1 - targetArray
insertDisplay = targetDisplay + (after ? 1 : 0)
insert        = n - insertDisplay
if (from < insert) insert -= 1
```

Katman satırı: görünürlük, 34px küçük resim, ad (çift tıkla
yeniden adlandır), alpha kilit göstergesi. Sağ panelde karışım modu,
doluluk ve alpha kilidi bulunur.

## 8. Arayüz (Windows uyumlu Liquid Glass)

* Paneller tam **240px**; `background-color: rgba(28,28,30,0.7)` +
  `backdrop-filter: blur(20px)` +
  `1px solid rgba(255,255,255,0.08)` + `border-radius: 8px`.
  Aynı tokenlar araç rayı, üst bar ve açılır panellerde kullanılır.
* Taban font **11px** sistem fontu; blok başlıkları 9px büyük harf.
* Slider'lar 2px ray; thumb varsayılan olarak gizli, hover/focus'ta
  7px beyaz nokta.
* Tüm arayüzde `user-select: none`.
* Başlık çubuğu solda gerçek TailRef işareti
  (`assets/tailref_logo_white_transparent.png`) + `TailRef` yazısıyla
  başlar; macOS trafik ışıkları kullanılmaz.
* Frameless pencere için sağ üstte Windows düzeni (`#ce-minimize`,
  `#ce-maximize`, `#ce-close`): tek renk çizgi simgeler, cam zemin,
  hover'da nötr dolgu. Kırmızı yalnızca kapatma hover'ında görünür.
  Başlık çubuğu `-webkit-app-region: drag`, düğmeler `no-drag`.
* Başlık çubuğu düğmeleri: ızgara çizgileri (`is-off`), sol/sağ panel
  (`.ce-panel.is-hidden`) ve fırça şeridi daraltma.

## 9. Fırça uçları, önizleme şeridi ve pencere kontrolleri

`types.ts` içindeki `BRUSH_PRESETS` üç uç tanımlar (Mürekkep, Doku
Fırçası, Yumuşak Fırça). `editor.ts` bunları `#ce-presets` içine
düğme olarak basar; tıklama boyut/opaklık/sertlik/aralık değerlerini
birlikte uygular. Slider'lar geçerli değerlerle birebir eşleştiğinde
ilgili çip `is-active` olur (`markActivePreset`), aksi halde hiçbiri
seçili görünmez.

`#ce-brush-preview` şeridi 200×34 CSS px'lik bir tuvaldir. Önizleme
**ayrı bir `BrushEngine`** örneğiyle çizilir (canlı vuruşa dokunmaz):
basınç rampalı bir sinüs eğrisi, geçerli sertlik/aralık/renk ile
üretilir, ardından opaklık kompozit sırasında uygulanır. Çizim
`requestAnimationFrame` ile birleştirilir; `#ce-preview-toggle`
şeridi daraltır (`.ce-preview.is-collapsed`).

Pencere kontrolleri:

| Öğe | Eylem |
|---|---|
| `#ce-toggle-grid` | ızgara çizgileri (dama deseni ve sınır kalır) |
| `#ce-toggle-left/right` | paneli gizle/göster, 240px genişliği korur |
| `#ce-preview-toggle` | fırça şeridini daralt/genişlet |
| `#ce-maximize` | `canvas-editor:maximize` IPC → büyüt/geri al |

Araç rayındaki altı düğme `setTool` üzerinden çalışır ve rayda el/zoom
aracı **yoktur**:

| Düğme | Araç | Kısayol | Davranış |
|---|---|---|---|
| `#ce-tool-move` | Taşıma | `V` | Tüm katmanı veya seçili pikselleri kaydırır |
| `#ce-tool-lasso` | Kement | `L` | Kapalı poligon seçimi; marching-ants kaplaması |
| `#ce-tool-brush` | Fırça | `B` | Quadratic Bezier vuruş motoru |
| `#ce-tool-eraser` | Silgi | `E` | `destination-out` kompoziti |
| `#ce-tool-eyedropper` | Damlalık | `I` | Katman rengini örnekler (`Alt`+tık her araçtan) |
| `#ce-tool-bucket` | Boya Kovası | `G` | Taranmış çizgi (scanline) flood fill |

Pan yalnızca `Space` + sürükleme ile yapılır; imleç `grab`/`grabbing`
olarak değişir. Damlalık seçiliyken fırça ucu halkası çizilmez; imleç
CSS ile değişir (`is-move`, `is-lasso`, `is-bucket`, `is-eyedropper`).

### 8.1 Seçim, taşıma ve boya kovası

* Kement seçimi doküman koordinatında kapalı bir poligondur. Seçim
  varken fırça, silgi ve boya kovası `clip()` ile seçime kırpılır;
  seçim dışına piksel yazılmaz.
* Taşıma aracı seçim yokken tüm aktif katmanı, seçim varken yalnızca
  seçili pikselleri taşır. Taşıma piksel hizasına yuvarlanır; sonuçta
  tek bir undo komutu üretilir ve seçim poligonu da aynı vektörle
  ötelenir.
* Boya kovası toleransı **32**'dir; alpha kilidi ve seçim maskesine
  saygı duyar, sonucu tek undo komutu olarak kaydeder.
* `Esc` sürüyen taşımayı iptal eder veya seçimi temizler.

## 10. Tahta entegrasyonu

`canvasEditorBuildPayload(item)`:

1. `ensureImageCached` ile görseli yükler.
2. Kırpma/filtre ayarlarını uygulayarak doküman bitmap'ini üretir
   (en uzun kenar 4096 px'e kelepçelenir).
3. Alt katman = görsel; üzerine tahtadaki her ink katmanı ayrı katman
   olarak eklenir.

`canvasEditorApplyResult(result)` data URL'yi `atob` ile çözer
(CSP `connect-src 'self'` `fetch(data:)`'i engellediği için) ve
`addFiles([file], null)` ile tahtaya yeni görsel olarak ekler.
Orijinal görsel korunur.

## 11. Temizlik

`CanvasEditor.dispose()`:

* tüm `addEventListener` kayıtlarını `removeEventListener` ile kaldırır,
* `requestAnimationFrame` (render + şerit önizlemesi) ve `setTimeout` iptal eder,
* `ResizeObserver.disconnect()`,
* `canvas-editor:state` aboneliğini kaldırır,
* seçim maskesini ve taşıma yüzeylerini serbest bırakır,
* fırça uç önbelleğini, önizleme motorunu, geçmişi ve katman
  tuvallerini serbest bırakır (`width = height = 0`).

`beforeunload` olayında otomatik çağrılır; editör penceresi kapanınca
ana süreç `canvas-editor:result` ile `null` yayınlar ve bekleyen tahta
işlemi askıda kalmaz.
