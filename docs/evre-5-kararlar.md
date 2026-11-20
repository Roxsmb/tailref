# Evre 5 karar belgeleri (2026-11-09)

## 5.4 — Canlı senkron yolunun C++'tan çıkışı: KAPALI (kanıtlandı)

**Karar:** Canlı çizim yolu (60 FPS damla emisyonu) senkron native çağrıya
bağlanmaz; JS'de kalır. Bu bir teslimi değil, ölçülmüş bir mimari karardır.

**Kanıt (tests/ink-tilespeed-check.js, dürüst uçtan uca sonda):**

| Kanal | 1280 KB | 225 KB | 80 KB |
|---|---|---|---|
| JS satır döngüsü (senkron) | **0.84 ms** | **0.15 ms** | **0.03 ms** |
| ipcRenderer.invoke (çift yapısal klon) | 27.8 ms | 1.5 ms | 0.53 ms |
| MessagePort + transferable (sıfır-kopya) | 58.6 ms | 1.3 ms | 0.53 ms |

Her iki kanal da bayt-parite ile ✅ doğru — sorun doğruluk değil, hız.
Sıfır-kopya bile geçemedi: asıl maliyet Electron'un asenkron
gidiş-dönüş olay zamanlama gideri (~0.5 ms taban). 1.3 MB'lık bir kopya
JS'de bellek-bant hızında 0.8 ms'de bitiyor; hiçbir IPC kanalı bunu yenemez.

**Ölçek kuralı:** 16.6 ms kare bütçesinde damla başına ~50-200 µs olan
fırça aritmetiği için RPC eşiği asla açılmaz; kanal eşiği yalnız
≥1 MB'lık toplu işlerle düşünülürdü ki o da yukarıdaki tablo
nedeniyle reddedildi.

**Buna rağmen kazanılan detay:** C++ çekirdekleri (noiseTip,
watercolorTip, dabList, tileSlice) toplu/işle yollarda yürürlükte:
- Uç üretimi + damla emisyonu: commit-başı toplu iş (~1.6× hız).
- tileSlice FAZ 4-6 ile işin niteliği tamamen değişti: senkron
  getImageData premultiplied dönüşümü (~14 ms) drawImage memcpy'sine
  inildi (FAZ 4-6 hold-kopya) — native kopya yolu gereksiz kaldı.

## 5.2 — Worker'a native yükleme: ENGELLİ (sandbox)

`canvas-editor-main.js` → `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`. Sandboxed renderer worker'ında `.node`
(require native) yükleme Electron tarafından yasaktır; seçenekler:

1. **Durum dolarak:** worker-native dışarıda; ana iş parçacığı JS yolları
   yeterince hızlandı (hold-kopya + toplu iş native'ler). ✅ yürürlükte
2. **sandbox gevşetme:** yalnız ink worker' için ayrı guest pencere
   (sandbox: false, yük hâlâ contextIsolation). Risk: saldırı yüzeyi;
   kullanıcı kararı gerekli.
3. **utilityProcess:** ana süreç tarafı worker (Node) — .node
   yükleyebilir; kanal için MessagePort aktarımı gerekir. Uzun vadede
   "doğru" yol ama maliyet ~1-2 gün mühendislik.

## 5.3 — Transferable undo bağlantısı: KODDA HAZIR, FLAG KAPALI

`nativeSlicing = false &&` (34-ink-undo.js, iki nokta). Kanal + çekirdek +
preload + glue; `enginePortTiles` süs yolu olarak duruyor. Açma koşulu:
worker-native (5.2/3) devreye alınırsa yeniden ölçümlü açma; aksi hâlde
FAZ 4-6 hold-kopya undo ihtiyacını tek başına karşıladı (commit-check
7/7, probe: vuruş >10ms 27→1/50, work p50 3.8 ms).

## 5.1 — Port kanalı: canlı (süs yolu)

`ink-engine:port-open` MessageChannelMain + preload `enginePortWire()`.
Sandıkta işlevsel (port parite ✓) ama hız katkısı 0 — FAZ 4-6'nın
hedefine ulaşması nedeniyle tileSlice port'a bağlı değil. İleride ≥1 MB
toplu iş gerektiren evre yeniden değerlendirilir.

## 5.6 — Smudge (adveksiyonel alan) C++ genişlemesi: GEREK YOK (ölçüldü)

**Mevcut durum:** Smudge zaten ana iş parçacığı dışında koşuyor:
- FAZ4-3'te worker'a taşınmış (ink-worker.js `drawSmudge`:
  advected alan + rezervuar, ana tarafa birebir kopya). Sonda
  (SMUDGE=1, probe koşusu): ana iş parçacığı işi p50 **3.6 ms**,
  >10 ms vuruş **2/50** — ana iş parçacığı smudge yükü düşük.
- Yalnız geniş bölgelerde (vuruş 2048² karo sınırını aşınca) commit
  ana iş parçacığına düşer: 2560×~75 bant başına senkron okuma ~5.8 ms
  (131 okuma / 50 vuruş, ~763 ms) — bırakış sonrası bütçeli dilimlere
  dağılıyor; senkron düğme işleyicisi p95 6.6 ms'de kalıyor.

**C++ neden yenmez:** çekirdek matematiği (9 örneklik lineer örnekleme
+ piksel-başı lineer karışım) gerçekten C++ adayı — ama kanal
(worker↔ana süreç) daha önce ölçüldü: sıfır-kopya transfer bile
gidiş-dönüş giderini telafi edemiyor. Smudge işi zaten ana parçacık
dışında ve kullanıcı algısı p50 3-4 ms; çekirdeğe taşımak yalnız
arka plan worker süresini kısaltır, kullanıcı algısını değil.

**Varsa tek gerçek aday (isteğe bağlı):** geniş smudge vuruşlarının
*commit* işinin de worker'a devri (bırakış sonundaki senkron tam boyama
yerine worker tamamlaması; undo "after" bandı worker cevabını bekler
ya da vektör yedek yola düşer). Orta ölçekli mimari işi — mevcut
bütçeli akış kullanıcıyı zaten mutlu ediyor; şikâyet olursa söz alır.lçekli mimari işi — mevcut bütçeli akış
zaten kabul edilebilir; ancak kullanıcı şikâyetı olursa sıra önerilir.

## 5.5 — Kanıt zinciri: YEŞİL

- tests/ink-commit-check.js → 7/7 (hold paritesi dahil)
- tests/ink-native-parity-check.js → tüm kapsam yeşil
- scripts/run-gates.js → 9/9 kapı yeşil (PURE)
- scripts/verify-package.js → PAKET GÜNCEL
- tests/ink-hotpath-probe.js → B/C/D/E/F/G izledikçeleri yürürlükte;
  G bölümü (drawImage sayaç) bu protezde eklendi.
