# Çizim Mimarisi — Referans / Çizim Modları (v2.2)

> Sürüm 2.2 · 30.10.2026 · `tailref`
> İlgili dosyalar: `src/renderer/core/39-mode.js`, `41-canvas-workspace.js`,
> `36-ink-editor.js`, `31-ink-ui.js`, `30-ink-tools.js`, `28-ink-brush.js`,
> `29-ink-render.js`, `27-ink-core.js`, `35-ink-worker.js`
> Durum özeti: [INK_STATUS.md](INK_STATUS.md) · Performans: [INK_PERFORMANCE.md](INK_PERFORMANCE.md)

## 1. Neden modal?

Eski yaklaşım çizimi doğrudan sonsuz tahtanın üzerine ("inline") yapıyordu.
Bu, tek bir tuval üzerinde üç ayrı koordinat uzayını (dünya / görsel / ekran)
aynı anda yönetmeyi gerektiriyordu ve şu hataları üretti:

- Yeni katmanlar görselin **altında** kalabiliyor, karışım modları fotoğrafı
  değil yalnızca kendi katmanını etkiliyordu.
- Silgi `source-over` ile beyaz boyuyor, saydam katmanda leke bırakıyordu.
- `pointermove` kayıpları noktalı çizgi üretiyordu.
- Tahta pan/zoom'u ile fırça koordinatları arasında kayma oluyordu.

Modal model bunu ayırır: **tahta belgeyi tutar, modal yalnızca sunumu ve girdiyi
yönetir.** Belge modeli (`state.ink.layers`, vuruş vektörleri) değişmez.

## 2. Çalışma modları ve kullanıcı akışı

Uygulama tek pencerede iki tam ekran moddur (`src/renderer/core/39-mode.js`):

| Mod | Gövde sınıfı | Görünen arayüz |
|---|---|---|
| Referans | `body.mode-reference` | Tahta: proje sekmeleri, ana araç çubuğu, paneller, öğe çubuğu |
| Çizim | `body.mode-draw` | `#appModeBar` başlığı, `#inkEditorCanvas`, `#inkToolbox`, `.inkPanel`, `#inkScopeBar` |

Mod anahtarı (`#appModeBar`) hiçbir zaman kilitlenmez (`drawBtn.disabled = false`):

- Tek görsel seçiliyse **Çizim** → `modeEnterDraw(itemId)`.
- Seçim yoksa **Çizim** (veya **＋**) → `newCanvasOpen()`; pencere
  `#newCanvasModal` (z 3200). Boyut/ad/arka plan onaylanınca `newCanvasCreate()`
  tuvali PNG olarak üretir, `images` deposuna yazar, tahtaya görsel öğe ekler,
  **tam boy bağlı katman** açar ve `modeEnterDraw(it.id)` ile çizim moduna girer.
  İptal/`Esc`/dışarı tık yalnızca pencereyi kapatır; mod referansta kalır.

`modeEnterDraw(itemId)` / `modeExitDraw()` tek kapıdır. `body.mode-draw`
altındaki `#brand, #projectBar, #barDock, #status, #inspector, #itemBar,
#trashDock, #contextMenu …` seçicileri tahta kabuğunu `display:none!important`
ile kaldırır; iki arayüz asla üst üste binmez. Mod değişince tahta kısayolları
(`15/22/26`) ve çizim kısayolları (`30`) karşılıklı olarak kapanır.

```
görsel seç → sağ tık / öğe çubuğu → "Çizim Yap"   (veya üstteki "Çizim")
  → modeEnterDraw(id)                 (39-mode.js)
    → inkEnterImageScope(id)          (31-ink-ui.js)
      → hedef katman = en üstteki kilitsiz bağlı katman (yoksa oluştur)
      → inkFrameImageForDrawing(it)   (tahta görünümü, kapanışta dönmek için)
      → inkEditorOpen(it.id)          (36-ink-editor.js)
        → modeNotifyEditorOpened()    (gövde: mode-draw)
        → #inkEditor görünür, kirli-bayrak + RAF döngüsü başlar
"Referansa Dön" / Esc / "Bitir"
  → modeExitDraw() → inkExitImageScope() → inkEditorClose()
    → modeNotifyEditorClosed()        (gövde: mode-reference, tahta aracı geri)

seçim yok → "Çizim" / "＋"
  → newCanvasOpen()                   (41-canvas-workspace.js)
    → boyut doğrula (16–8192 px, ≤ 50 MP) + hazır boyut/⇄/ad/arka plan
    → "Oluştur ve Çiz" → newCanvasCreate()
      → canvas.toBlob → idbPut('images') → decodeImage
      → state.items.push({kind:'image', w, h}) + inkAddLayer({kind:'attached', pxW, pxH})
      → modeEnterDraw(it.id)          (yukarıdaki çizim zinciri)
```

`body.ink-editor-open` sınıfı araç kutusunu ve panelleri görünür kılar;
kapalıyken `body:not(.ink-editor-open) #inkToolbox{display:none!important}`
ile tamamen gizlenir. Yani **çizim araçları yalnızca çizim modunda vardır**.

Ayrı `Canvas Editor` penceresi (`canvas-editor.html`) artık "Çizim Yap"
tarafından otomatik açılmaz; tek çizim yolu bu tam ekran moddur. Ayrı pencere
yalnızca köprü elle çağrılırsa kullanılır.

## 3. DOM ve katman sırası (z-index)

| Öğe | z-index | Rol |
|---|---|---|
| `#appModeBar` | 980 / çizimde 3000 | Referans ↔ Çizim anahtarı; çizimde tam genişlik başlık |
| `#inkEditor` | 1100 | Çalışma alanı (tam ekran, opak arka plan) |
| `#inkEditorCanvas` | — | Görsel + bağlı katmanların birleşik kompozisyonu |
| `#inkEditorCursor` | — | Fırça halkası; `pointer-events:none`, örneklemeyi kirletmez |
| `#inkToolbox` | 1200 | Araç kutusu (çalışma alanı üstünde) |
| `.inkPanel` | 1205 | Fırça / katman panelleri |
| `#inkScopeBar` | 1213 | "Bitir" çubuğu (çizim modunda alt ortada) |
| `#appModeBar` (çizimde) | 3000 | Tam genişlik başlık; "Referansa Dön" + tuval adı |
| `#newCanvasModal` | 3200 | Yeni çizim tuvali penceresi (boyut/ad/arka plan) |

Çizim modunda tahta `display:none` ile kaldırılır ve tüm girdi
`#inkEditorCanvas` üzerinden gelir. Bu, "inline çizim kazası" olasılığını
yapısal olarak kaldırır.

## 4. Render hattı (`inkEditorRender`)

Çizim döngüsü **kirli-bayrak** ile çalışır (`inkEditorInvalidate` → `needsRender`;
`inkEditorLoop` yalnızca bayrak açıkken çizer). Görsel + dama deseni + gölge
`ui.baseCanvas` içinde önbelleklenir (`inkEditorDrawBase`, anahtar: DPR, tuval
boyutu, fit kutusu, öğe ve görsel kaynağı); pan/zoom yalnızca bu anahtarı
değiştirir. Kare maliyeti: bir `drawImage(base)` + N katman.

1. Tuval temizlenir, modal arka planı basılır (DPR ölçeğinde).
2. `inkEditorComputeFit()` görseli görünüm alanına sığdırır ve ortalar; alan
   `inkEditorViewport()` ile hesaplanır (üst 58 px başlık, alt 112 px durum
   çubuğu + fırça şeridi, sol araç kutusu/katman paneli, sağ fırça paneli).
   Pencere darsa paylar küçültülür (en az 160 px çizim alanı).
3. **Gölge geçişi:** görsel `shadowBlur` ile bir kez çizilir. Gölge görselin
   *alfa maskesinden* üretildiği için saydam PNG'lerde dikdörtgen leke oluşmaz.
4. Görsel kutusu dama deseniyle yeniden doldurulur → gölge geçişinin kutu içine
   düşen kısmı silinir, yarı saydam pikseller iki kez kompozitlenmez.
5. Görsel normal olarak basılır.
6. Bağlı katmanlar **alttan üste** sırayla çizilir:
   `globalAlpha = layer.opacity`, `globalCompositeOperation = layer.blend`.
   Vuruş sürerken hedef katmanın yerine `ui.scratch` (geçici kopya) kullanılır.
7. Görsel çerçevesi ve fırça halkası (`inkEditorDrawCursor`).

Aktif vuruş **doğrudan katman tuvaline** yazılmaz: `pointerup`'a kadar yalnızca
önizleme tamponunda birikir, sonra gerçek tuvale pişirilir. Böylece yarıda kalan
vuruş, geri alma veya yeniden çizim sırasında yarım piksel bırakmaz.

Önizleme v2.1'den beri **artımlıdır** (`40-ink-dab-gl.js`): GPU varsa katman bir
kez dokuya yüklenir ve her karede yalnızca yeni damlalar FBO'ya çizilir; yoksa
aynı mantık kalıcı 2B `scratch` üzerinde `previewSkip` ile çalışır. Kompozisyon
yine `ui.scratch`/`ui.previewCanvas` üzerinden okur. Ayrıntı:
[INK_PERFORMANCE.md](INK_PERFORMANCE.md) §3.10.

### 4.1 Görünüm: zoom ve kaydırma (`inkEditorUi.view`)

Görünüm durumu üç sayıdır: `{ zoom, panX, panY }`; modal her açılışta
`zoom = 1`, pan = 0 (ekrana sığdır) olarak sıfırlanır.

- **Fit.** `inkEditorComputeFit()` taban ölçeği `baseS = min(aw/iw, ah/ih)` ile
  bulur, `w = iw·baseS·zoom`, `h = ih·baseS·zoom` üretir ve merkezi
  `panX/panY` kadar kaydırır. Görselin en az 96 px'i ekranda kalacak şekilde
  kelepçelenir; böylece kaydırırken tuval tamamen kaybolmaz.
- **Sınır.** `INK_EDITOR_ZOOM_MIN = 0.05`, `INK_EDITOR_ZOOM_MAX = 16`.
- **Çapa.** `inkEditorSetZoom(z, {x, y})` önce çapanın eski fit içindeki göreli
  konumunu (lx, ly) hesaplar, zoom'u uygular, sonra `pan` düzeltmesiyle aynı
  ekran noktasını sabit tutar. `Ctrl`/`Cmd` + tekerlek bu yolu imleçle çağırır.
- **%100 (`inkEditorZoomActual`).** `zoom = 1 / baseS` → fit genişliği görselin
  piksel genişliğine eşit olur (1 görsel px = 1 CSS px).
- **Kısayollar.** `+`/`=` ×1.25, `−`/`_` ×0.8, `0` sığdır, `1` %100. Metin
  alanına odaklıyken ve vuruş sürerken (`ui.stroke`) zoom devre dışıdır.
- **Kaydırma.** `Space` + sol tık veya orta tuş → `inkEditorPanStart/Move/End`;
  pointer capture ile sürükleme `panX/panY`'ye eklenir, çizim başlatılmaz.
  Düz tekerlek dikey, `Shift` + tekerlek yatay kaydırır (tarayıcı kaydırması
  `preventDefault` ile engellenir); `Alt` + tekerlek fırça boyutudur.
- **Durum çubuğu (`inkEditorSyncStatus`).** `#inkScopeSize` belge boyutu,
  `#inkScopeCoords` imlecin görsel pikseli, `#inkScopeDpr` ekran/render DPR,
  `#inkScopeInfo` katman + araç + fırça boyutu, `#inkZoomValue` yüzde
  (`round(fit.w / it.w * 100)`, en az %1). Zoom düğmeleri: `−`, oran, `+`,
  `Sığdır` (`#inkScopeZoom`).

## 5. Girdi akışı

```
pointerdown  → inkEditorDown
  • Space + sol tık / orta tuş → inkEditorPanStart (vuruş açılmaz)
  • Alt basılıysa örnekle ve çık
  • görsel dışında başlangıç reddedilir (inkEditorLocal → null)
  • hedef katman kilitliyse uyarı, vuruş açılmaz
  • önizleme oturumu açılır, vuruş vektörü oluşturulur
pointermove  → inkEditorMove (window, capture)
  • getCoalescedEvents() varsa her alt örnek işlenir
  • Alt geçişi: inkEditorSetAlt(true/false)
  • inkEditorMoveSample: hız → basınç → Catmull-Rom ara noktaları
  • nokta 0..1 kutusuna kelepçelenir (sürükleme taşarsa kenara yapışır)
  • önizleme yalnızca yeni damlaları çizer (GPU FBO / 2B previewSkip)
pointerup    → inkEditorUp
  • vuruş vektörü layer.strokes'a eklenir (undo kaydı ile)
  • inkDrawStrokeOnContext ile katman tuvaline pişirilir
  • önizleme oturumu bırakılır, panel/DOM senkronu ve kayıt tetiklenir
```

**Noktalı çizgi düzeltmesi.** `pointermove` olayları arası mesafe 2 px'ten
büyükse, son iki ham nokta arasına Catmull-Rom ile ara noktalar eklenir
(`p0 = rawHistory[-2]`, `p1 = son`, `p2 = p3 = yeni nokta`). Eğri **son
noktadan başlar**, bu yüzden iz geri sıçramaz. Basınç, hız ve eğim ara
noktalara lineer olarak taşınır.

**Basınç.** `inkEventPressure` yalnızca `pointerType === 'pen'` için
`PointerEvent.pressure` okur (0.02–1); fare/touch 1 kabul edilir. Değer
`inkCurvePressure` ile kullanıcı eğrisinden geçer, `flow` ve damla boyutuna
yansır.

## 6. Alt = damlalık

- `keydown Alt` → `inkEditorSetAlt(true)`: mevcut araç `toolBeforeAlt`'a
  saklanır, damlalık imleci gösterilir.
- `pointerdown/move` bu sırada `inkEditorSample(x, y)` çağırır: birleşik
  kompozisyondan (katmanlar + görsel) piksel okunur, `state.ink.color` güncellenir.
- `keyup Alt` / `blur` → `inkEditorSetAlt(false)`: araç geri yüklenir.
- Metin alanına odaklıyken Alt yok sayılır (tarayıcı menüsüyle çakışmasın).

## 7. Silgi

Silgi ayrı bir kod yolu değildir: aynı fırça motoru `stroke.tool === 'eraser'`
iken `ctx.globalCompositeOperation = 'destination-out'` kullanır. Sonuç:

- piksel gerçekten saydamlaşır (beyaz boyama yok),
- alttaki fotoğraf ve diğer katmanlar doğru görünür,
- karışım modu ve opaklık silmeden sonra da tutarlıdır.

## 8. Katman yığını ve karışım

- `inkLayersForOwner(itemId)` katmanları **ekleme sırasına** göre döndürür;
  render ve dışa aktarma aynı sırayı kullanır → yeni katman daima en üstte.
- Modal açılışında hedef, bu listenin **son** kilitsiz elemanıdır.
  (`inkEditorTargetLayer`, `inkEnterImageScope`)
- Karışım modu `normal` dışındaysa doğrudan `globalCompositeOperation` olarak
  atanır; `normal` → `source-over`. Opaklık `globalAlpha` ile uygulanır.
- Katman tuvali görselin piksel kutusuyla birebir aynı boyuttadır; modal
  yalnızca `drawImage` ile ölçekler, bu yüzden karışım fotoğrafla aynı
  düzlemde hesaplanır.

## 9. Kalıcılık, geri alma, dışa aktarma

- Kaynak gerçeği: `layer.strokes` (vektör) + `state.ink` pano kaydı.
- Raster (`inkRuntime.itemCanvases`, global karolar) yalnızca önbellektir;
  kaybolursa vektörlerden yeniden üretilir.
- `pointerup` pişirmesi sayesinde vuruş, modal kapandıktan sonra tahtada ve
  PNG dışa aktarımında görünür.
- Geri alma vuruş bazlı delta kullanır (`34-ink-undo.js`); modal bunu
  değiştirmez, yalnızca aynı `inkPushUndoStroke` yolunu çağırır. Commit'te
  vuruşun kırpılmış raster bölgesi saklanır; Ctrl+Z bu bölgeyi `putImageData`
  ile geri yazar, katmanın tamamı yeniden rasterlenmez. Kayıt yoksa güvenli
  tam kurulum devreye girer.
- Ağır vuruşlarda worker raster (`35-ink-worker.js`) devreye girer; modal
  commit'i senkron yolu kullanır, worker motoru ayrıca test edilir.

## 10. Modül sorumlulukları

| Dosya | Sorumluluk |
|---|---|
| `36-ink-editor.js` | Modal yaşam döngüsü, fit/DPR, kompozisyon, pointer girdisi, Alt damlalık, önizleme + pişirme |
| `40-ink-dab-gl.js` | WebGL2 damla önizlemesi, FBO biriktirme, artımlı 2B yedek, `__inkGl` A/B köprüsü |
| `31-ink-ui.js` | Kapsam giriş/çıkışı, panel ve araç kutusu senkronu, katman paneli |
| `30-ink-tools.js` | Araç durumu, kısayollar, tahta girdisi, basınç/eğim yardımcıları, commit |
| `28-ink-brush.js` | Fırça motoru, Catmull-Rom damlalar, `.abr`, silgi kompoziti |
| `29-ink-render.js` | Bağlı katman tuvalleri, global karolar, gizmo, dışa aktarma |
| `27-ink-core.js` | Durum modeli, katman oluşturma/normalleştirme, uzay dönüşümleri |
| `35-ink-worker.js` + `ink-worker.js` | Ağır vuruş rasterı (OffscreenCanvas) |

## 11. Test kapsamı

`node scripts/ink-smoke.js` (142 test) modal davranışını şu başlıklarla doğrular:

- `çizim modu modal editörü açıyor` — `#inkEditor` görünür, araç kutusu açık.
- `çizim kapsamı görseli ekrana sığdırıyor` — fit dikdörtgeni viewport içinde.
- `görsel dışında başlayan vuruş engelleniyor` / `noktalar 0..1 içinde`.
- `modal editör vuruşu katmana pişiriyor` — vuruş vektörü + raster.
- `modal silgi destination-out ile siliyor` — merkez alfa ≈ 0.
- `modal vuruşu yeniden çizimde korunuyor` — raster yeniden üretimde kalır.
- `canlı önizleme artımlı çalışıyor` — GPU'da tekrar kare yeni damla çizmez;
  2B yedekte `previewSkip` artar.
- `GPU uç dokusu önbelleği sınırlı` — 20 yeni uç sonrası doku sayısı 12'yi aşmaz.
- `önizleme yönü pişen katmanla aynı` — satır bazlı alfa profili ters çevrilmiş
  profilden çok daha yakın.
- Alt damlalık: `damlalık görsel pikselini örnekliyor`, araç geri yükleme.
- Worker raster ve geri alma testleri modal kapalıyken motora doğrudan bakar.

## 12. Bilinen sınırlar / sıradaki işler

- Modal commit'i senkron raster kullanır; çok büyük görsellerde (>4K) worker
  yoluna bağlanması düşünülebilir.
- Görsel döndürülmüşse modal onu **düz** gösterir (çizim yerel uzayda yapılır);
  döndürülmüş görünümle düzenleme henüz yok.
- Modal girişinde çoklu dokunma (iki parmak zoom) desteklenmez; pan/zoom
  tahtada kalır.
- `.abr` içe aktarmada çift fırçanın ikinci ucu ayrıştırılmaz (aynı uç ölçeklenir).
- Editör render döngüsü süreklidir (her karede tam sahne). Çok büyük görsellerde
  boşta kare atlamak için kirli-bayrak (`dirty flag`) optimizasyonu eklenebilir.

## 13. Refactor planı (inline → modal) — durum

| # | Adım | Durum | Not |
|---|---|---|---|
| 1 | Belge modelini dondur: `state.ink.layers` + vuruş vektörleri tek kaynak | **Bitti** | `27-ink-core.js`; raster yalnızca önbellek |
| 2 | Katman sırasını tek yerden türet (`inkLayersForOwner`) | **Bitti** | Render + dışa aktarma aynı sırayı kullanır |
| 3 | Hedef katman çözümünü yığının en üstüne sabitle | **Bitti** | `inkEditorTargetLayer`, `inkEnterImageScope` |
| 4 | Modal DOM/CSS iskeleti (`#inkEditor`, `#inkEditorCanvas`, `#inkEditorCursor`) | **Bitti** | `index.html`, `style.css` (z-index 1100) |
| 5 | Araç kutusunu moda bağla (`body.ink-editor-open`) | **Bitti** | Kapalıyken `display:none!important` |
| 6 | Fit/DPR + kompozisyon hattı (`inkEditorRender`) | **Bitti** | Alfa tabanlı gölge + dama deseni |
| 7 | Girdi hattı: basınç, eğim, coalesced, Catmull-Rom, kenar kelepçesi | **Bitti** | `inkEditorDown/Move/Up`, `inkEditorLocal` |
| 8 | Scratch + `pointerup` pişirme | **Bitti** | `ui.scratch` → katman tuvali |
| 9 | Alt damlalık ve araç geri yükleme | **Bitti** | `inkEditorSetAlt`, `toolBeforeAlt` |
| 10 | Kapanışta tahta aracını geri yükleme | **Bitti** | `toolBeforeOpen` |
| 11 | Testleri modal-farkında yap | **Bitti** | `__inkPen` koordinat eşlemesi, 142/142 |
| 12 | Dokümantasyon | **Bitti** | Bu belge + README + `INK_STATUS.md` |
| 13 | Modal commit'i worker rasterına bağlama (>4K) | **Planlı** | Senkron yol şimdilik yeterli |
| 14 | Döndürülmüş görselde düzenleme | **Planlı** | Şu an yerel uzay düz gösteriliyor |

**Geri alma güvenliği.** Modal yeni bir belge yolu açmadığı için `undo()`,
pano değişimi, çöp kutusu ve PNG dışa aktarma kodunda değişiklik gerekmedi;
hepsi aynı `state.ink` ve aynı vuruş listesini görür. Modal yalnızca
`inkPushUndoStroke` + `inkPaintCommittedStroke` yolunu çağırır.
