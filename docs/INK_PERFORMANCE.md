# Çizim Motoru Performansı

> Sürüm: 2.2 · 11.11.2026
> Kaynak: `src/renderer/core/27-ink-core.js` … `src/renderer/core/40-ink-dab-gl.js`, `ink-worker.js`, `scripts/ink-bench.js`
> Kapsam: Faz 0 (ölçüm), Faz 2 (raster çekirdeği), P1 (worker raster), v1.7 (panel ölçeği, `.abr` dinamiği, çift fırça), v1.8 (HSV çarkı önbelleği), v1.9 (basınç eğrisi, hız incelmesi, flow/doku, gerçek çift uç — worker eşliği dahil), v2.1 (WebGL2 damla önizleme motoru), v2.2 (canlı-final ölçümü, worker raster sayaçları, hardpath satırı)

Bu belge, çizim motorundaki performans çalışmalarının nasıl ölçüldüğünü,
hangi eşiklerin regresyon kapısı olduğunu ve raster çekirdeğinin nasıl
çalıştığını anlatır. Amaç, yeni bir değişiklikten sonra "daha hızlı oldu"
demek yerine sayıyla gösterebilmektir.

## 1. Ölçüm altyapısı

`src/renderer/core/32-ink-perf.js` üç katman sağlar:

| Katman | API | Not |
|---|---|---|
| Sayaç | `inkPerfCount(name, n)` | Düz sayı artırımı; damla döngüsünde `performance.now()` çağrılmaz. |
| Süre | `inkPerfSpan(name, ms)` | `nameCount`, `nameMs`, `nameMaxMs` alanlarını günceller. |
| Anlık görüntü | `inkPerfSnapshot()` | Sayaçlar + ortalama süreler + bellek + karo/vuruş/nokta sayıları. |

Ölçülen olaylar:

- `commit` — vuruşun katmana işlenmesi (`pushUndo` anlık görüntüsü **hariç**).
- `undoSnap` — geri al için JSON anlık görüntüsü; ayrı ölçülür çünkü maliyeti
  Faz 3'ün (geçmiş/ kalıcılık) konusudur.
- `rebuild` — bir katmanın tamamen yeniden raster edilmesi.
- `dirty` — yalnızca kirli dikdörtgenin yeniden birleştirilmesi.
- `dabs` / `pathStrokes` / `liveDabs` — damla, yol ve canlı önizleme sayıları.
- `glPreview` — GPU önizleme karesinde yeni damlaları FBO'ya işleme süresi
  (`glPreviewCount`, `glPreviewMs`, `glPreviewMaxMs`). Kare başına yalnızca
  yeni damlalar çizildiği için değer damla sayısıyla değil, o karede eklenen
  damla sayısıyla ölçeklenir.
- `glDabs` — GPU'da biriktirilen toplam yeni damla sayısı. Tekrar karede
  artmıyorsa önizleme gerçekten artımlıdır.
- `restoreDiff` — tam anlık görüntü geri almasında artımlı tazeleme süresi;
  `incrementalRestores` / `fullRestores` hangi yolun seçildiğini,
  `restoreTouchedLayers` kaç katmanın tazelendiğini gösterir.
- `stampHits` / `stampMisses` — damga atlası isabet oranı.
- `tintHits` / `tintMisses` — renklendirilmiş uç önbelleği.
- `tileCreates`, `dirtyFlushes`, `dirtyRedraws`, `stagedStrokes` — karo ve
  birleştirme davranışı.

### HUD

`Alt+P` (`window.__inkPerf.toggle()`) sağ altta HUD açar:

```
ink perf · Alt+P
fps 60.0  heap 74 MB
commit 5.6 ms  (max 12.1)  ×3
dab 6877  yol 0  canlı 0
önizleme 0.2 ms  gpu damla 476  doku 1
damga %100  (6877/6877)  atlas 6
rebuild 4.2 ms  (max 9.8)  ×2
kirli 1.8 ms  ×4  bekleyen 0
undo snap 2.3 ms  512 KB
geri yükleme 3.1 ms  artımlı 7 / tam 0
tint %100  (12/12)
katman 3  vuruş 5  nokta 8421  karo 6
```

`önizleme` satırı GPU oturumu yoksa `0.0 ms  gpu damla 0  doku 0` gösterir;
2B yedekte ilerleme `canlı` sayacından okunur.

HUD yalnızca açıkken rAF döngüsü çalıştırır; kapalıyken maliyeti yoktur.
`window.__inkPerf.snapshot()` testler ve bench için aynı veriyi döndürür.

## 2. Bench

```
npm run bench:ink                    # 1k / 4k / 10k, sert + yumuşak
node scripts/ink-bench.js --gpu      # donanım hızlandırma; GPU önizleme ölçümü
node scripts/ink-bench.js --quick   # yalnızca 1k / 4k
node scripts/ink-bench.js --json    # makine okunur çıktı
```

Bench, uygulamayı izole bir `TailRef_USER_DATA` profiliyle Electron'da
başlatır (varsayılan `--disable-gpu`, yazılım raster), sayfada sentetik vuruşlar
üretir ve gerçek `inkCommitFreehand()` yolunu ölçer. `--gpu` gerçek donanım
hızlandırmasını açar; **GPU önizleme yolu yalnızca bu modda anlamlı ölçülür**
(SwiftShader'da WebGL2 çalışır ama kare süresi yazılım emülasyonudur).
Raporlanan sütunlar:

| Sütun | Anlam |
|---|---|
| `commit(cold/warm)` | İlk ve tekrarlanan commit süresi — **ana iş parçacığı** (ms) |
| `paint` | Worker'a giden vuruşta rasterın uygulanma beklemesi (ms); senkron satırlarda `0` |
| `canvas` | Aynı vuruşun 1024×1024 tuvalde raster süresi (ms) |
| `live/frame` | Sürükleme sırasında `pointermove` başına maliyet (ms) |
| `dab` / `path` | Damla sayısı / yol ile çizilen vuruş sayısı |
| `atlas` | Damga atlası isabet oranı (worker'da çizilen satırlarda `—`) |
| `heap` | JS heap (MB) |

`commit`, vuruşun katmana işlenmesiyle dönen süredir. Worker yolunda bu süre
bölge yakalama + `postMessage` kadardır; gerçek damlama `paint` sütununda
görünen süre boyunca arka planda sürer.

### Canlı önizleme ölçümü

Bench, commit tablosundan ayrı olarak **çizim modu önizlemesini** ölçer
(`previewBench`): 1400×1000 görsel açar, 96 `pointermove` üretir ve her adımda
`inkEditorRender()`'i **senkron** çalıştırır (araya rAF girmez). Aynı vuruş üç
yoldan geçirilir:

| Satır | Anlam |
|---|---|
| `eski kare (kopya+vuruş)` | v2.0 davranışı: her karede tam katman kopyası + vuruşun tamamının yeniden çizimi |
| `gpu kare` | WebGL2: yalnızca yeni damlalar FBO'ya; ilk kare doku yüklemesini içerir, ortalama dışında tutulur, tepe değeri gösterilir |
| `gpu tekrar kare` | yeni damla yokken kare maliyeti; `+0 damla` artımlılığın kanıtı |
| `2B yedek kare` | WebGL2 yokken aynı artımlı mantık kalıcı 2B tuvalde |
| `2B yedek tekrar kare` | atlanan damla sayısı (`atlanan N`) ve yeni damla (0 olmalı) |

GPU yolu desteklenmiyorsa GPU satırları atlanır; 2B yedek her koşuda ölçülür.

### Eşikler (regresyon kapısı)

| Ölçüm | Eşik |
|---|---|
| Commit dağıtımı (plan+dispatch+undo snap; canlı final hariç) | < 8 ms |
| Canlı final yeniden çizimi (commit içinde) | < 24 ms |
| Sürükleme kare başına | ≤ 8 ms |
| Damga atlası isabeti (ana iş parçacığında çizilen satırlar) | ≥ %50 |
| Sert fırça yol çizimi (`hardpath` satırı, senkron) | `pathStrokes > 0` |
| Damla vuruşları worker'a taşınmalı (`hard` + `soft`) | `workerJobs ≥ 1`, `workerApplied ≥ 1`, `workerDabs > 0` |
| Worker raster beklemesi | < 500 ms |
| 2B yedek önizleme artımlı | `fallbackSkip > 0` ve tekrar karede yeni damla `0` |
| 2B yedek önizleme karesi | ≤ 8 ms |
| GPU önizleme karesi | ≤ 8 ms |
| GPU tekrar karede yeni damla | `0` |
| GPU önizleme, eski tam kare'den hızlı (`--gpu`, katman ≥ 1200 px) | `glFrameMs < oldFrameMs` |

**Commit bileşenleri (v2.2):** commit süresi artık iki ayrı maliyet içerir ve
bench ikisini ayrı sütunlarda raporlar:

- **Dağıtım (`dispatchMs` = commit − emit):** plan çıkarma, worker iş kuyruğu
  ve undo vuruş anlık görüntüsü. Sürekli çalışan ana iş parçacığı maliyeti;
  eşik 8 ms.
- **Canlı final (`liveFinalMs`, `emit` sütunu):** commit'te canlı tuval
  temizlenip vuruşun TAMAMI damlalanır (artımlı pencere emisyonu aralık
  sürekliliği ve `taperEnd` kesinliği sağlamaz); worker bitmap'i uygulanana
  kadar ekranda bu kopya kalır. ~6k damla → 10-17 ms; eşik 24 ms.

Ölçümler asenkron olduğu için bench her satırı `inkPaintIdle()` ile bekler;
`commit` değeri bekleme **öncesi**, `paint` değeri bekleme **sırasında** ölçülür.
Sıcak değer **3 turun en iyisidir**; her turdan önce vuruşun önceki kopyası
katmandan çıkarılır, böylece kirli dikdörtgen yeniden çizimi şişmez. Tek bir
OS/GC sapması eşiği yanlışlıkla düşürmez; gerçek bir yavaşlama üç turun hepsini
yükseltir. Worker ilk kez `soft` turuna geçerken ısıtılır; böylece iş parçacığı
başlatma maliyeti ne sert satırlara ne de ölçülen soft satırlara karışır.

Eşik aşılırsa çıkış kodu `1` olur. Bench ayrıca `Alt+P` HUD'ının açıldığını ve
kirli dikdörtgen doğrulamasını çalıştırır (bkz. §4).

### Son tam ölçüm

Yazılım raster (`--disable-gpu`), Windows (v2.2, 11.11.2026):

| kind | n | commit (cold/warm) | emit | paint | canvas | live/frame | dab | path | atlas | heap |
|---|---|---|---|---|---|---|---|---|---|---|
| hard | 1000 | 21.7 / 12.8 ms | 12.1 ms | 45.1 ms | 64.3 ms | 0.01 ms | 6264 | 0 | %100 | 13 MB |
| hard | 4000 | 19.3 / 14.4 ms | 13.3 ms | 43.2 ms | 63.4 ms | 0 ms | 6264 | 0 | %100 | 15 MB |
| hard | 10000 | 17.3 / 15.5 ms | 13.9 ms | 47.1 ms | 71.3 ms | 0 ms | 6264 | 0 | %100 | 17 MB |
| soft | 1000 | 14.2 / 11.0 ms | 10.5 ms | 39.1 ms | 58.6 ms | 0 ms | 4872 | 0 | %100 | 19 MB |
| soft | 4000 | 11.7 / 11.4 ms | 10.5 ms | 37.1 ms | 59.4 ms | 0 ms | 4872 | 0 | %100 | 14 MB |
| soft | 10000 | 17.0 / 12.4 ms | 9.8 ms | 41.8 ms | 72.5 ms | 0.01 ms | 4872 | 0 | %100 | 17 MB |
| hardpath | 4000 | 41.7 / 18.3 ms | 13.8 ms | 0 ms | 1.3 ms | 0 ms | ~6264 | 1 | %100 | 19 MB |

**Mimari (v2.2 itibarıyla):** `hard` ve `soft` satırları damla yolunda çizilir ve
worker'a taşınır (`workerDabs` sütunu artık worker'dan gelen GERÇEK damla
sayısıdır — tahmini `~` yalnızca `hardpath`'te). Yol (path) çizimi `hardpath`
satırıyla ölçülür: bench, hız incelmesi kapalı path-uygun `bench-hard-path`
fırçasını senkron ana yolda çizer (`pathStrokes` ana iş parçacığı sayacıdır).
Dağıtım süreleri 1-3 ms'dir; commit'in geri kalanı canlı final yeniden
çizimidir (yukarıdaki bileşen açıklaması). Soğuk commit, ilk karo/atlas
oluşturma ve worker başlatma maliyetini içerir; kapı dağıtım + canlı final
sıcak değerlerini kullanır. Donanım hızlandırmalı gerçek oturumda süreler
daha düşüktür.

> **v2.2 mimari notu:** `ink-hard` (native-studio-pen) fırçasında `speedSize:
> 0.04` olduğu için yol çizimi belgeli olarak devre dışıdır (v1.9 notu) ve
> vuruş worker'da damla yoluyla çizilir. Eski "hard = sync path" taban
> çizgisi (hard 4000 warm 6.6 ms) bu mimari değişiklikten önceydi; eşikler
> v2.2'de yeni mimariye göre yeniden kalibre edildi.
>
> **v1.9 notu:** Hız incelmesi, flow, doku veya özel boyut dinamiği açık bir
> fırçada yol devre dışı kalır ve vuruş damla yoluna düşer; bu durumda
> `path` sütunu `0`, `dab` sütunu gerçek damla sayısını gösterir.

### v2.1 ölçümü — GPU önizleme (30.10.2026)

Aynı makinede iki koşu. Commit tablosu (yazılım raster, `--disable-gpu`):

| kind | n | commit (cold/warm) | paint | canvas | live/frame | dab | path | heap |
|---|---|---|---|---|---|---|---|---|
| hard | 1000 | 11.5 / 5.1 ms | 0 ms | 0.9 ms | 0.18 ms | ~6263 | 1 | 64 MB |
| hard | 4000 | 8.5 / 5.7 ms | 0 ms | 1.0 ms | 0.18 ms | ~6264 | 1 | 77 MB |
| hard | 10000 | 10.9 / 9.1 ms | 0 ms | 1.6 ms | 0.16 ms | ~6264 | 1 | 66 MB |
| soft | 1000 | 0.4 / 0.4 ms | 61.1 ms | 25.6 ms | 0.13 ms | ~4872 | 0 | 42 MB |
| soft | 4000 | 1.2 / 1.1 ms | 75.4 ms | 33.4 ms | 0.10 ms | ~4872 | 0 | 43 MB |
| soft | 10000 | 2.8 / 2.4 ms | 95.1 ms | 42.2 ms | 0.10 ms | ~4872 | 0 | 60 MB |

Donanım hızlandırma (`--gpu`):

| kind | n | commit (cold/warm) | paint | canvas | live/frame | heap |
|---|---|---|---|---|---|---|
| hard | 1000 | 3.0 / 1.2 ms | 0 ms | 0.4 ms | 0.20 ms | 53 MB |
| hard | 4000 | 3.4 / 1.5 ms | 0 ms | 0.5 ms | 0.18 ms | 67 MB |
| hard | 10000 | 4.3 / 3.0 ms | 0 ms | 0.6 ms | 0.15 ms | 85 MB |
| soft | 1000 | 0.4 / 0.4 ms | 13.3 ms | 19.7 ms | 0.09 ms | 44 MB |
| soft | 4000 | 1.1 / 1.1 ms | 18.0 ms | 26.2 ms | 0.09 ms | 57 MB |
| soft | 10000 | 2.8 / 2.5 ms | 25.3 ms | 33.4 ms | 0.09 ms | 46 MB |

Önizleme (çizim modu, katman **1800×1286**, 476 damla, 96 adım):

| Kare | Donanım (`--gpu`) | Yazılım (SwiftShader) |
|---|---|---|
| Eski kare (tam kopya + tam vuruş) | 1.20 ms (kopya 0.10 + vuruş 1.10) | 2.30 ms (kopya 1.60 + vuruş 0.70) |
| **GPU kare (ortalama)** | **0.24 ms** (tepe 12.1) | 3.91 ms (tepe 21.8) |
| GPU tekrar kare | 0.30 ms · +0 damla | 4.10 ms · +0 damla |
| 2B yedek kare | 0.15 ms (tepe 0.8) | 0.14 ms (tepe 6.1) |
| 2B yedek tekrar kare | 0.10 ms · 476 damla atlandı | 0.20 ms · 476 damla atlandı |

> Aynı koşunun tekrarı: eski kare **0.70 ms** (kopya 0.10 + vuruş 0.60),
> GPU kare yine **0.24 ms** (tepe 11.0). Commit satırlarında da ±1 ms sapma
> normaldir.

**Okuma.** Donanımda GPU önizleme eski tam kareye göre belirgin hızlı: eski kare
koşular arasında **0.7–1.2 ms**, GPU karesi ise sabit **0.24 ms** (≈3–5×).
Tekrar karede yeni damla çizilmediği için maliyet sabit kalır. Tepe değer
(11–12 ms) oturumun **ilk** karesidir: katman dokusunun yüklenmesi + FBO
kurulumu. Ortalamadan dışlanır; tepe değer sayaçta `glPreviewMaxMs` olarak
durur.
SwiftShader'da WebGL2 çağrıları CPU'da emüle edildiği için GPU satırı 2B
yedekten yavaştır; bu koşu yalnızca **doğruluk/regresyon** içindir, hız kanıtı
değildir. Bu katman boyutunda artımlı 2B yedek de GPU'dan hızlıdır (0.15 ms):
fark, 2B yedeğin katman çözünürlüğünde bir `scratch` tutması, GPU'nun ise yalnızca
ekran çözünürlüğünde tampon kullanmasıdır. GPU'nun kazancı tam katman kopyasının
pahalılaştığı büyük katman + yüksek DPR durumlarında artar; bu tablo
1800×1286 içindir ve 4K ölçümü henüz yapılmadı.

Commit tablosu değişmedi: GPU motoru yalnızca **sunumu** hızlandırır, pişirme
(`pointerup`) hâlâ 2B raster yolunu kullanır. Yazılım koşusunda 4000 nokta sert
commit 5.7 ms (v1.9: 6.6 ms), 10000 nokta 9.1 ms (v1.9: 10.7 ms); tüm eşikler
sağlandı.

## 3. Raster çekirdeği (Faz 2)

### 3.1 Damga atlası

`inkStampFor(brush, color, hardness, sizePx, erase)` damlayı
`(fırça, renk, sertlik, boyut kovası)` anahtarıyla önbelleğe alır.

- Boyut kovaları: **16 / 32 / 64 / 128 / 256 / 512 / 1024 px** (yukarı yuvarlanır).
- Anahtar: `b|brushId|color|hardness*100|bucket` (silgi için `e|…`).
- LRU sınırı: **96** giriş **ve 32 MB** toplam bayt; aşınca en eski anahtar atılır.
- Uç, damga kovası çözünürlüğünde üretilir (`inkTipRes`: 128 → 256 → … → 1024).
  Böylece 128 px üstü fırçalarda küçük uç büyütülmez; 700 px fırçada damga
  1024² tuvalde 1:1 çizilir. Worker aynı kovaları/çözünürlükleri kullanır.
- `.abr` uçları dosyadaki doğal çözünürlükte kalır (ayrıştırıcı 512 px'e kadar).
- Sayaçlar: `stampHits` / `stampMisses` / `tipBuilds`; `inkStampCacheInfo()`
  `hitRate`, `bytes`, `mb` döndürür.

Damla döngüsünde artık her seferinde uç ölçeklenmez; yalnızca `drawImage`
kalır. Renk/sertlik kombinasyonu çok değişirse atlas LRU ile sınırlı kalır.

### 3.2 Yol (path) çizimi

Sert ve sabit basınçlı vuruşlar tek bir quadratic zincirle çizilir
(`inkDrawStrokeAsPath`). Koşullar (`inkStrokePathEligible`):

- `kind === 'stroke'`, boyut ≥ 2 px
- `scatter === 0`
- prosedürel fırça (`.abr` uçları hariç)
- sertlik ≥ **0.85**
- basınç yayılımı ≤ **0.12**

Basınç değişiyorsa incelme kaybolmasın diye damla yoluna düşülür. Yol
modunda opaklık, üst üste binen damlaların görünümüne yaklaştırılır:
`baseAlpha >= 0.999 ? 1 : 1 - (1 - baseAlpha)^3`.

Eğimli kalemde (`t > 0.02`) yol modu kullanılmaz: tek quadratic zincir
damganın yassılaşmasını ifade edemez.

### 3.2.1 Basınç, eğim ve interpolasyon

- `inkForEachDab()` Catmull-Rom eğrisi üzerinde sabit aralıklı damla
  üretir ve her damlaya **basıncı (`p`)** ve varsa **eğimi (`t`, `a`)**
  yazar.
- `inkEventTilt(e)` pointer olayının `tiltX/tiltY` değerini (derece)
  0..1 büyüklük + radyan yöne çevirir; dik kalemde ve farede `null`
  döner, yani eğimsiz çizim eskisiyle birebir aynıdır.
- `inkDrawTiltedStamp()` eğim varsa damgayı eğim yönünde döndürüp eğime
  dik eksende `1 - 0.55·t` oranında yassılaştırır (referans uygulamanın
  açı/yuvarlaklık dinamiği).
- Nokta şeması `{ x, y, p, t?, a? }`. Eğim alanları yalnızca gerektiğinde
  yazılır; `inkNormalizeStroke()` bunları korur (geri al, pano yükleme,
  proje kaydı).

> **Düzeltilen hata (v1.4):** interpolasyon noktaları yalnızca `x/y`
> taşıyordu; damla yarıçapı `NaN` oluyor ve `drawImage` hiçbir şey
> çizmiyordu. Sonuç: yumuşak fırça vuruşunda **yalnızca ilk damla**
> görünüyordu (720 px'lik vuruş 51 px boyanıyordu). Artık basınç her
> damlaya taşınıyor; aynı vuruş 1109 px boyanıyor. Regresyon testi:
> `yumuşak fırça vuruş boyunca boyanıyor`.

### 3.3 Global katman rasterleştirme

`29-ink-render.js`, 2–16 karo ve ≤ 4.194.304 px (2048²) aralığındaki
vuruşları yeniden kullanılabilir bir sahne tuvalinde (`inkGlobalStage`) bir
kez çizip karolara `drawImage` ile dağıtır. Daha büyük aralıklarda ve silgide
karo başına çizime dönülür. Sayaç: `stagedStrokes`.

### 3.4 Kirli dikdörtgen (dirty rect)

- `inkMarkLayerDirty(layer, rect, full?)` etkilenen dünya dikdörtgenini
  birleştirir ve rAF ile bir kez işler.
- `inkFlushDirtyLayers()` bekleyeni hemen uygular (test/ölçüm için).
- `inkRedrawAttachedRect()` bağlı katmanda piksel kutusunu kırpar. Piksel
  kutusu artık `item.w/h` yerine **tuvalin gerçek çözünürlüğü** ile
  hesaplanır (bağlı tuval görselden daha yüksek çözünürlüklü olabilir).
- `inkRedrawGlobalRect()` yalnızca kesişen karoları temizleyip yeniden çizer.
  Kirli dikdörtgen karonun tamamını kaplamıyorsa yalnızca kesişim temizlenir;
  komşu vuruşların pikselleri korunur. Vuruş artık bir karoyu kesmiyorsa ve
  karonun tamamı kirliyse o karo DOM'dan kaldırılır.
- `inkDirtyReset()` geri al / pano değişimi / DOM sıfırlamada bekleyeni iptal
  eder.

Kısmi yeniden çizim **dönüştürme sürüklemesi**, **dönüştürme bitişi**,
**seçim silme**, **vuruş geri al** ve **vuruş yinele** yollarında bağlıdır.
Yalnızca tam pano anlık görüntüsü tabanlı geri alma (öğe taşıma, silme, katman
ayarı) tam yeniden kurulum yapar.

### 3.5 Girdi ve canlı önizleme

- `pointermove` işleyicisi `getCoalescedEvents()` varsa tüm örnekleri işler;
  yüksek örneklemeli kalemde ara noktalar kaybolmaz.
- Canlı önizleme tuvali (`inkEnsureLiveCanvas`) damlaları atlas üzerinden
  çizer; commit'te vektör vuruş kalıcı katmana işlenir.
- Çizim modundaki modal önizleme artımlıdır (GPU veya 2B); ayrıntı §3.10.

### 3.6 Worker raster (P1)

Ağır damla vuruşlarını ana iş parçacığından çıkaran yol iki dosyadan oluşur:

- `ink-worker.js` — gerçek raster. Same-origin bir dosyadır; CSP
  `script-src 'self'` blob worker'a izin vermediği için ayrı dosya gerekir.
- `src/renderer/core/35-ink-worker.js` — köprü: plan, kuyruk, dönüş uygulama, istatistik.

#### Ne taşınır?

`inkBuildRasterPlan(layer, stroke)` vuruşun dünya dikdörtgenini, hedef
tuvali/karoları ve tahmini damla sayısını hesaplar. Vuruş şu koşullarda
worker'a gider:

| Koşul | Değer |
|---|---|
| Yol (path) uygunluğu | `false` — sert vuruşlar tek `stroke()` ile zaten ucuz |
| Tür | `stroke` (şekiller ana iş parçacığında) |
| Tahmini damla | ≥ `INK_WORKER_MIN_DABS` = **2400** |
| Parça boyu | ≤ `INK_WORKER_CHUNK` = **2048 px**; bölge bundan büyükse karo hizalı parçalara bölünür |
| Parça sayısı | ≤ `INK_WORKER_MAX_CHUNKS` = **48** (aşarsa senkron) |
| Altyapı | `Worker` + `OffscreenCanvas` + `createImageBitmap` |
| Katman | Aynı katmanda bekleyen iş yoksa **veya** sıra korunacaksa |

Bölge 2048²'den büyükse `inkSplitRasterPlans` onu en fazla 48 parçaya ayırır;
parçalar aynı katman zincirinde **sırayla** uygulanır (`copy` her parçanın
dikdörtgenine kırpılır). Böylece 2048² üstü fırça darbeleri de arka planda
rasterlenir; bir parça başarısız olursa vuruşun tamamı kaynaktan bir kez
tazelenir (yarım boyanmış vuruş kalmaz).

`inkWorkerForce(true)` eşiği atlar (test ve ölçüm için). Aynı katmanda zincir
(`inkWorkerState.chains`) varsa yeni vuruş da kuyruğa girer; senkron çizilirse
sıra bozulup eski bitmap yeni vuruşun üzerine yazabilirdi.

#### Mesaj sözleşmesi

```
ana iş parçacığı                          ink-worker.js
─────────────────                         ─────────────
epoch/mutation oku
inkCaptureRegion(layer, plan)
  → ImageBitmap (bölgenin mevcut pikselleri)
postMessage({ id, stroke, width, height,
              mode, canvasW/H, regionX/Y,
              sizePx, pathEligible, erase,
              existing[, tip] }, [transfer])
                                           OffscreenCanvas aç
                                           vuruşu bitmap üzerine çiz
                                           (aynı Catmull-Rom + damga
                                            matematiği, kova damgaları)
                        ImageBitmap  ←  transferToImageBitmap()
inkWorkerOnMessage:
  katman hâlâ var mı? vuruş listede mi?
  mutation / epoch aynı mı?
  → inkApplyRegionBitmap(layer, plan, bitmap)
  bitmap.close()
```

Uygulama `globalCompositeOperation = 'copy'` ve klip ile yapılır: bölge
dışına hiç dokunulmaz, bölge içinde alfa birebir worker çıktısıdır. Bu yüzden
worker rasterı ile senkron raster (`inkDrawStrokeOnContext`) aynı piksel
sayısını verir; bunu `worker rasterı senkron rasterla eşleşiyor` testi
doğrular (örnek: 18022 px / 17843 px, %1 tolerans).

#### Eskiyen sonuçların reddi

Üç ayrı koruma vardır:

1. **Vuruş kimliği** — katman silinmiş veya vuruş listeden çıkmışsa bitmap
   atılır (`stats.discarded`).
2. **`mutation` sayacı** — geri al, silme, dönüştürme ve katman yeniden
   kurulumu sayacı artırır. Bitmap eski durumu taşıdığı için atılır; vuruş
   hâlâ katmandaysa yalnızca **kendi dünya dikdörtgeni** kaynaktan tazelenir
   (`inkRepaintStrokeRegion`). Tüm katmanı yeniden çizmek gerekmez.
3. **`epoch` sayacı** — tam yeniden kurulumda vuruş zaten kaynaktan çizildiği
   için sonuç sessizce atılır.

Epoch ve mutation değerleri bölge yakalanmadan **önce** okunur. Aksi hâlde
yakalama sürerken gelen bir geri al gözden kaçar ve eski piksel geri dönerdi.

#### Canlı önizleme ve bekleme

- `inkLiveHolds` sayacı worker işi boyunca canlı tuvali temizlenmekten korur
  (`inkClearLive()` bekleyen iş varken döner). Böylece çizgi, bitmap uygulanana
  kadar ekranda kalır ve "yanıp sönme" olmaz.
- `inkPaintIdle()` tüm zincirler boşalana kadar bekler; testler ve bench
  senkron varsayımı bozmadan ölçüm yapabilir.
- `inkWorkerStats()` `jobs / applied / discarded / fallbacks / errors /
  pending / totalMs` döndürür; `Alt+P` HUD'ı ve testler bunu kullanır.

#### Geri çekilme (fallback)

Worker yoksa, desteklenen API eksikse, bölge sınırı aşılırsa, bölge yakalama
başarısız olursa veya `postMessage` hata verirse vuruş **senkron** yolla
çizilir. Bu durumda davranış worker öncesiyle birebir aynıdır; bitmap'ler her
yolda kapatılır. `inkWorkerEnable(false)` worker'ı tamamen devre dışı bırakır.

### 3.7 Damlalık örnekleme önbelleği (P2)

`inkSampleColor` görsel pikselini okurken her seferinde görselin tam boy
kopyasını çiziyordu; 4000 px'lik bir referansta bu her tıklamada ~64 MB'lık
bir tuval demekti. Artık:

- `inkSampleImageFor(it)` görsel başına **küçültülmüş** tuval üretir (en uzun
  kenar **1536 px**; daha küçük görseller birebir kopyalanır).
- Önbellek anahtarı `imageId|WxH`, LRU sınırı **4** görsel.
- Örnek koordinatı normalize (`0..1`) olduğundan ölçek küçültme rengi
  değiştirmez; test bunu tam boy referansla ±8 kanal toleransında doğrular.
- Sayaçlar: `sampleCacheHits` / `sampleCacheMisses`; `inkSampleCacheInfo()`.

### 3.8 HSV çarkı önbelleği (v1.8)

Renk çarkı her karede yeniden çizilmez:

- Dış halka **piksel bazlı** bir offscreen tuvale bir kez üretilir. 0.1°
  çözünürlüklü (3600 giriş) ton tablosu kullanılır; piksel başına string
  dönüşümü yoktur. Yalnızca tuval boyutu (DPR dahil) değişince yenilenir.
- İç üçgen de offscreen tuvalde tutulur ve yalnızca **ton** değişince
  yeniden üretilir; sürükleme sırasında sadece iki tutamaç çizilir.
- Panel gizliyken çizim tamamen atlanır (`inkSyncColorWheel` erken döner),
  böylece kapalı çark her renk değişiminde maliyet üretmez.
- 228×228 css / DPR 2'de halka üretimi ~10–20 ms, sonrası kare başına
  yalnızca iki `drawImage` + tutamaç çizimi.

### 3.9 Basınç eğrisi, hız, flow/doku ve gerçek çift uç (v1.9)

Girdi noktasına yazılan dinamikler damla üretiminde **tek yerde** uygulanır
(`28-ink-brush.js` `inkForEachDab`); böylece ana iş parçacığı, canlı önizleme ve
worker aynı sonucu verir.

- **Basınç eğrisi** — `inkCurvePressure(p, c) = pow(p, c)`, `0.20 ≤ c ≤ 3.00`
  (varsayılan `1`, yani eski davranış). Fırça panelindeki kaydırıcı
  `pressureCurve` alanını yazar; `c < 1` basıncı yumuşatır, `c > 1` sertleştirir.
- **Hız incelmesi** — `inkSpeedInfluence(px, dtMs)` noktalar arası hızı
  **0.15–2.35 px/ms** aralığında `0..1`'e eşler. `speedSize` (0–80%) bu değeri
  damla boyutundan düşer. Hız her noktada `s` alanına yazılır
  (`{ x, y, p, s, t?, a? }`) ve kayıt/geri al/yükleme turunda korunur.
- **Flow** — `flow` (0..1) damla opaklığını çarpar, `flowJitter` damla başına
  küçük rastgele sapma ekler. `.abr` `flow`/`flowJitter` alanlarından gelir.
- **Doku** — `texture` açıkken damga grain maskesiyle çarpılır
  (`textureDepth`, `textureScale`); doku deseni deterministiktir, aynı vuruş
  yeniden çizildiğinde aynı desen çıkar.
- **Gerçek çift uç** — `.abr` içindeki iki `samp` ucu eşleştirilir: ilk uç ana
  uç, ikincisi `Dual` ucu olur (`cbsh→samp` ve `samp→cbsh` sıralarının ikisi de
  desteklenir). İkinci uç `inkTintedTip` ile renklendirilip `dual.scale`
  oranında ana damganın üstüne basılır.

Bu dinamiklerden herhangi biri etkinken **yol (path) çizimi kullanılmaz**:
`inkStrokePathEligible` hız, flow, doku ve özel boyut dinamiği varsa `false`
döner. Tek quadratic zincir damla başına boyut/opaklık/doku değişimini ifade
edemeyeceği için incelme ve grain kaybolurdu. Test:
`hız/dinamik varken yol çizimi kullanılmıyor`.

### 3.9.1 Worker eşliği

`35-ink-worker.js` mesaja artık `flow`, `flowJitter`, `texture`,
`textureDepth`, `textureScale`, `speedSize` ve `dual` alanlarını ekler; gerçek
çift uç bitmap'i `dualTip` olarak **transfer** edilir (uç yoksa hiç
gönderilmez, `postMessage` hatasında `existing`/`tip`/`dualTip` birlikte
kapatılır). `ink-worker.js` aynı Catmull-Rom + damga matematiğini kullanır.

> **Düzeltilen hata (v1.9):** worker'daki `forEachDab` noktaların `s` (hız)
> alanını interpolasyona katmıyordu. Sonuç: aynı vuruş worker'da senkron yola
> göre yaklaşık **2× daha kalın** çiziliyordu (hız incelmesi kayboluyordu).
> Artık `q.s` ana iş parçacığındaki gibi taşınıyor; `worker hız/akış/doku
> rasterı senkronla eşleşiyor` testi örnekte 23639 px / 23383 px (%1 tolerans)
> ve alfa toplamında 4601760 / 4534187 veriyor.

### 3.10 GPU damla önizleme motoru (v2.1)

**Neden.** v2.0 modal editörü her karede hedef katmanı `scratch`'e kopyalayıp
vuruşun **tamamını** yeniden çiziyordu. Maliyet vuruş uzunluğuyla büyüdüğü için
uzun vuruşlarda sürükleme gecikiyordu. v2.1 önizlemeyi **artımlı** yapar: kare
başına yalnızca o karede eklenen damlalar işlenir.

**İki arka uç.** `36-ink-editor.js` `inkEditorRenderPreview()` önce GPU'yu
dener, olmazsa 2B'ye düşer:

| Arka uç | Modül | Durum |
|---|---|---|
| WebGL2 | `src/renderer/core/40-ink-dab-gl.js` | `inkDabGlBegin` → `inkDabGlApply` → `inkDabGlPresent` |
| 2B yedek | aynı dosya, `inkDabSink2d` | kalıcı `scratch` tuvali + `previewSkip` |

**Ekran çözünürlüğü.** Önizleme tuvali katman boyutunda değil, görselin ekrana
sığdırılmış kutusu × DPR kadardır (`Math.max(1, Math.min(3, dpr))`,
`MAX_TEXTURE_SIZE` sınırı). Böylece 4K bir katmanda her karede tam boy kopya
yapılmaz; GPU yalnızca görünen kutuyu işler. `view` (x/y/w/h) değişirse oturum
yeniden kurulur (`inkDabGlMatches`), aksi halde biriktirme devam eder.

**GPU akışı.**

1. `inkDabGlBegin(layerCanvas, fit, dpr)` katmanı bir kez `baseTex`'e yükler,
   `accTex` + FBO'yu katman kopyasıyla doldurur, `drawn = 0`.
2. Her karede `inkDabGlApply(stroke, opts)` çağrılır. Vuruş yine
   `inkDrawStrokeOnContext` ile üretilir; ancak `ctx` yerine **sink** geçilir.
   Sink Canvas2D API'sinin kullanılan yüzeyini (`save/restore/translate/
   rotate/scale/globalAlpha/globalCompositeOperation/drawImage`) taklit eder ve
   `drawImage` çağrılarını GL dörtgenlerine çevirir.
3. Sink, `index < drawn` damlaları **atlar**; yalnızca yeni damlalar FBO'ya
   birikir → maliyet O(yeni damla), O(vuruş uzunluğu) değil.
4. `inkDabGlPresent()` birikimi kanvasa basar. FBO dokusunun 0. satırı GL'de
   altta, kanvasta üstte olduğu için UV'ler dikey çevrilir; bu, "önizleme ters"
   hatasının düzeltmesidir. Test: `önizleme yönü pişen katmanla aynı`.

**Karışım.** Fırça `ONE / ONE_MINUS_SRC_ALPHA` (premultiplied source-over),
silgi `ZERO / ONE_MINUS_SRC_ALPHA` (`destination-out`) kullanır. Damla çizimi
yalnızca bu iki modu ürettiği için sink diğer `globalCompositeOperation`
değerlerini `source-over` sayar. Katman karışım modları (Multiply vb.) bu
motorun değil, kompozisyonun işidir.

**Doku önbelleği.** Damga uçları ve katman tuvalleri `Map` ile GL dokusuna
eşlenir (`inkDabGlTextureFor`); aynı uç kare başına yeniden yüklenmez.
Önbellek **LRU(12)** ile sınırlıdır: sınır aşılınca en eski uç dokusu
`deleteTexture` ile gerçekten silinir (önceki `WeakMap` sürümü anahtarı GC'ye
bırakıyor ama GL dokusunu hiç silmiyordu — vuruş başına GPU sızıntısı).
`disable()` tüm uç dokularını temizler; `release()` yalnızca oturum
tamponlarını (base/acc/FBO) bırakır, uç önbelleği sonraki vuruş için kalır.
`UNPACK_PREMULTIPLY_ALPHA_WEBGL` açıktır, böylece alfa karışımı Canvas2D ile
aynı sonucu verir.

**2B yedek.** WebGL2 yoksa, bağlam kaybolursa veya `inkDabGlApply` hata verirse
`scratch` tuvale `inkDabSink2d(ctx, previewSkip)` ile yalnızca yeni damlalar
çizilir; `previewSkip = sink.count` her karede güncellenir. Yedek de artımlıdır,
yani "GPU yok" durumu eski tam yeniden çizime dönmez.

**Yol (path) vuruşları.** `shape` veya `inkStrokePathEligible` true olan
vuruşlarda damla yoktur; bu yollar eskisi gibi tam 2B yeniden çizilir ve GPU
oturumu kapatılır.

**Yaşam döngüsü.** `inkEditorCommitStroke`, `inkEditorDropStroke` ve modal
kapanışı `inkDabGlRelease()` çağırır (dokular + FBO silinir, `drawn` sıfırlanır).
`webglcontextlost` olayında oturum `ok = false` olur; sonraki kare 2B yedeğe
düşer. Pişirme her zaman 2B yolu kullanır: belge modeli, geri alma, dışa aktarma
ve kayıt formatı **değişmez**.

**Sayaçlar ve HUD.** `inkPerfSpan('glPreview', ms)` + `inkPerfCount('glDabs', n)`
her `inkDabGlApply` çağrısında yazılır. HUD'daki satır:

```
önizleme 0.2 ms  gpu damla 476  doku 1
```

`window.__inkPerf.snapshot().avg.glMs` aynı ortalamayı verir.

**A/B anahtarları.** Konsoldan:

```js
window.__inkGl.stats()      // {supported, disabled, textures, dabs, frames, lastMs, width, height, maxTex}
window.__inkGl.disable()    // GPU'yu kapat → 2B yedek yolu (aynı vuruş, aynı sonuç)
window.__inkGl.enable()     // yeniden dene (bağlam kaybından sonra da)
window.__inkGl.supported()  // WebGL2 kurulabiliyor mu
window.__inkGl.release()    // oturum tamponlarını bırak (uç dokuları önbellekte kalır)
```

`disable()`/`enable()` ölçüm içindir: bench aynı vuruşu iki arka uçtan geçirip
kare sürelerini karşılaştırır. Testler: `canlı önizleme artımlı çalışıyor`
(örnekte `GPU · 1 kare · 170 damla · 1 doku · tekrar=true`),
`GPU uç dokusu önbelleği sınırlı` (20 yeni uç → `doku 12 ≤ 12`) ve
`önizleme yönü pişen katmanla aynı`.

**Sınırlar.**

- Önizleme ekran çözünürlüğündedir; yakınlaştırınca `view` değişir ve oturum
  yeniden kurulur (doku yeniden yüklenir). Bu, 4K tamponu kopyalamaktan ucuzdur
  ama zoom sırasında ilk kare daha pahalıdır.
- GPU motoru yalnızca damla vuruşlarını hızlandırır; commit, worker raster,
  geri alma ve dışa aktarma değişmedi.
- WebGL2 bağlamı kaybolursa oturum otomatik yeniden kurulmaz; o vuruş 2B
  yedekle tamamlanır.

## 4. Doğruluk kontrolü

Bench'in `dirtyRect()` kontrolü bir vuruşu 700 px kaydırır, eski karonun
boşaldığını ve yeni karonun dolduğunu alfa toplamıyla doğrular. Bu kontrol
"hızlı ama yanlış" kısmi çizim regresyonlarını yakalar:

```
before > 0 && after === 0 && moved > 0
```

## 5. Testler

```
node scripts/build-app.js      # src/renderer/core/*.js -> app.js (elle düzenlemeyin)
node scripts/ink-smoke.js      # 142 çizim + UX + panel + HSV çarkı + artımlı geri alma + worker + damga + basınç eğrisi/hız + flow/doku + GPU önizleme + .abr v6.2 + gerçek çift uç kontrolü
node scripts/smoke-test.js     # sunucu/kritik dosya kontrolleri
node scripts/projects-test.js  # 40 pano kontrolü
node scripts/ink-bench.js      # performans kapısı
```

## 5.1 Acil UX davranışları (1–5)

`ink-smoke.js` bölüm 8 bu davranışları gerçek DOM olaylarıyla doğrular:

| # | Davranış | Garanti |
|---|---|---|
| 1 | Sol araç çubuğu düğmeleri | Fırça ve katman düğmeleri paneli açar/kapatır, `aria-expanded` güncellenir, iki panel aynı anda açık kalmaz. Flyout araç kutusunun sağında açılır, kırpılmaz, tekrar tıklamada kapanır. |
| 2 | Renk çarkı | Renk kutusu HSV halka + üçgen panelini açar; halka tonu, üçgen doygunluk/parlaklığı seçer, sürükleme canlı günceller; HEX ve RGB girişleri aynı durumu yazar; dışarı tıklama ve `Esc` kapatır. |
| 3 | Sağ tık → "Çizim Yap" | Yalnızca sağ tık **görselin üzerinde** açıldıysa etkindir; boş alanda devre dışıdır. |
| 4 | Otomatik odak | Kapsam açılınca görsel ekrana sığdırılır (`x/y` negatif değil, sağ/alt taşmıyor) ve fırça seçilir. |
| 5 | Görsel sınırı | Görsel dışında başlayan vuruş kaydedilmez; taşan noktalar `0..1` yerel kutusuna kelepçelenir (döndürülmüş görselde ve silgide de); canlı önizleme görsel poligonuna kırpılır. |

Kelepçeleme `inkClampScopeLocal()` ile yalnızca `inkRuntime.imageScopeId` etkinken ve
katman o görsele bağlıyken uygulanır; serbest (global) çizimde davranış değişmez.

## 6. Kalan işler

| Konu | Durum |
|---|---|
| GPU damla önizlemesi | **Tamamlandı (v2.1).** `40-ink-dab-gl.js` WebGL2 arka ucu + artımlı 2B yedek; ayrıntı §3.10, ölçüm §2 "v2.1 ölçümü". Donanımda kare 0.7–1.2 → **0.24 ms**; commit yolu değişmedi. Testler: `canlı önizleme artımlı çalışıyor`, `GPU uç dokusu önbelleği sınırlı`, `önizleme yönü pişen katmanla aynı`. |
| C++ raster çekirdeği (WASM / N-API) | **Karar bekliyor.** GPU önizleme sonuçları alındı; commit yolu hâlâ JS 2B. Kullanıcı onayı olmadan başlanmıyor. |
| OffscreenCanvas + worker raster | **Tamamlandı (v1.4, P1).** `ink-worker.js` + `35-ink-worker.js`; ayrıntı §3.6. 10k noktalı yumuşak vuruşta ana iş parçacığı commit'i **2.3 ms**; damlama worker'da ~106 ms sürer. Testler: `eşik altı vuruş worker'a gitmiyor`, `ağır vuruş worker kuyruğuna giriyor`, `worker bitmap'i katmana uygulandı`, `worker rasterı senkron rasterla eşleşiyor`, `worker sonrası geri al pikselleri kaldırıyor`, `worker silgi pikselleri siliyor`, `worker dönerken geri al geç sonucu atıyor`, `global katman karoları worker ile birleşiyor`. |
| Worker bölge sınırı | **Tamamlandı (v1.6, P2).** `inkSplitRasterPlans` bölgeyi 2048 px'lik karo hizalı parçalara böler (en fazla 48); parçalar aynı zincirde sırayla uygulanır, `copy` her parçanın dikdörtgenine kırpılır. Ayrıntı §3.6. Testler: `2048² üstü bölge worker parçalarına bölünüyor` (6 parça), `parçalı worker rasterı dikiliyor ve mevcut karoyu koruyor`. |
| Geçmiş/kalıcılık (delta undo) | **Tamamlandı (v1.4).** `34-ink-undo.js` her vuruş için yalnızca `__inkStroke` kaydını yazar; tam anlık görüntülerle aynı yığında karışık çalışır. Test: `delta kayıt tam anlık görüntüden küçük` (2 KB / 67 KB), `delta geri al/yinele`. |
| Hızlı geri al (kırpılmış raster) | **Tamamlandı (v2.0, P0).** Commit'te vuruşun dünya sınırı tuval pikseline çevrilir, fırça çapı kadar pay eklenir ve **yalnızca o dikdörtgenin eski pikselleri** `getImageData` ile saklanır (`inkUndoRaster`, token ile bellek içi). Ctrl+Z `putImageData` ile bölgeyi birebir geri yazar; tüm katman rasterlenmez. Yineleme tek vuruşu yeniden boyar. Bellek: anlık görüntü başına 8 MB, toplam 64 MB, 60 kayıt; sınır aşılırsa en eski kayıt düşer ve güvenli tam kurulum devreye girer. Testler: `vuruş undo kaydı kırpılmış raster bölgesi taşıyor`, `geri al yalnızca kırpılmış bölgeyi yazıyor (tam raster yok)`, `yinele de kırpılmış bölgeyi yazıyor`, `saçılmalı fırça Ctrl+Z sonrası katman rasterını aynen geri yüklüyor`. |
| Eğim (tiltX / tiltY) | **Tamamlandı (v1.4).** `inkEventTilt` → `{t,a}`, `inkDrawTiltedStamp` damgayı döndürüp yassılaştırır; eğim vuruşla birlikte saklanır. Testler: `eğim noktaya yazıldı`, `eğim damgayı yassılaştırdı`, `eğim geri al/yükleme turunda korunuyor`. |
| 128 px üstü damga kalitesi | **Tamamlandı (v1.6, P2).** Prosedürel uç hedef çözünürlükte (`inkTipRes`, 128→1024) üretilir; kovalara 512/1024 eklendi, atlas 32 MB bayt bütçesiyle LRU. 700 px fırça 1024² damga ile 1:1 çizilir; 72 açıda kenar sapması 0.6 px. Testler: `büyük fırçada uç hedef çözünürlükte üretiliyor`, `büyük damga kenarı yuvarlak ve geçişli`, `700 px damga doğru çapta çiziliyor`, `damga atlası bayt bütçesini aşmıyor`. |
| Tam anlık görüntü geri alma | **Tamamlandı (v1.5, P1).** `27-ink-core.js` `inkLayerStrokeDiff` / `inkApplyRestoreDiff`: önceki ve yeni `state.ink` katman katman karşılaştırılır; yalnızca değişen katmanın eski+yeni sınırı tazelenir. Öğe taşıma/silmede raster **0**, 3000 vuruşlu katmanda undo **10–12 ms**. Testler: `öğe taşıma geri alması katmanı yeniden rasterlemiyor`, `... tuvali ve pikselleri koruyor`, `vuruş taşıma geri alması yalnızca değişen bölgeyi tazeliyor`, `... komşu vuruşu koruyor`, `silinen katman geri gelince yalnızca o katman kuruluyor`, `3000 vuruşta öğe taşıma geri alması < 20 ms`. |
| Kısmi çizim kapsamı | **Tamamlandı (v1.4).** Tam anlık görüntü geri alması (`inkApplyRestoreDiff`) ve vuruş taşıma yalnızca değişen dünya dikdörtgenini tazeler (`inkMarkLayerDirty`); bağlı katmanda tuval çözünürlüğü, global katmanda karo kesişimi kullanılır. Vuruş delta geri alması v2.0'da kırpılmış raster anlık görüntüsüne geçti (üstteki satır). Testler: `kısmi geri al komşu bağlı vuruşu koruyor`, `global kısmi geri al komşu vuruşu koruyor`. |
| Damlalık örnekleme maliyeti | **Tamamlandı (v1.6, P2).** Görsel başına küçültülmüş örnek tuvali (`inkSampleImageFor`, en uzun kenar 1536 px) LRU(4); anahtar `imageId\|WxH`. Sayaçlar `sampleCacheHits/Misses`. Testler: `damlalık görsel pikselini örnekliyor`, `damlalık örnekleme tuvali önbelleğe alınıyor`. |
| Basınç eğrisi + hız incelmesi (P3) | **Tamamlandı (v1.9).** `pressureCurve` (0.20–3.00, varsayılan 1) ve `speedSize` (0–80%) fırça panelinden ayarlanır; `inkCurvePressure` / `inkSpeedInfluence` nokta `p` ve `s` alanlarına uygulanır. Ayrıntı §3.9. Testler: `fırça paneli basınç eğrisi ve hız ayarını bağlıyor`, `basınç eğrisi vuruş basıncını yeniden eğiyor`, `hız incelmesi hızlı vuruşu inceltiyor`, `hız alanı kayıt turunda korunuyor`, `hız/dinamik varken yol çizimi kullanılmıyor`. |
| Flow + doku (P2) | **Tamamlandı (v1.9).** `flow`, `flowJitter`, `texture`, `textureDepth`, `textureScale` damla opaklığına ve grain maskesine uygulanır; `.abr` alanlarından okunur, kayıtla birlikte saklanır. Testler: `akış (flow) damla opaklığını düşürüyor`, `doku (texture) vuruşa grain katıyor`. |
| Gerçek çift uç (P2) | **Tamamlandı (v1.9).** `.abr` içindeki iki `samp` ucu eşleştirilir (ilk ana, ikinci `Dual`); `cbsh→samp` ve `samp→cbsh` sıraları desteklenir; içe aktarma/yükleme uç bitmap'lerini korur. Testler: `gerçek çift fırça ucu .abr içinden ayrıştırılıyor`, `gerçek çift fırça ucu içe aktarılıyor ve yükleniyor`, `computed .abr fırçası uç olmadan içe aktarılıyor`. |
| Worker dinamik eşliği | **Tamamlandı (v1.9).** Mesaj `flow`/`flowJitter`/`texture*`/`speedSize`/`dual` taşır, `dualTip` transfer edilir; `ink-worker.js` nokta `s` alanını da interpole eder (önceki sürümde vuruş ~2× kalın çıkıyordu). Test: `worker hız/akış/doku rasterı senkronla eşleşiyor` (23639 px / 23383 px, alfa 4601760 / 4534187). |
