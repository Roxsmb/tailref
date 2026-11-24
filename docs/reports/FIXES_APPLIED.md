# FIXES APPLIED — TailRef Studio 1.4.4

**Tarih:** 2026-11-24
**Temel commit:** `c62c820` (tüm değişiklikler çalışma ağacında, commit edilmedi)
**Toplam değişen dosya:** 122 giriş — 95 izlenen dosya değişti, 27 yeni giriş
(26 dosya + 1 belge klasörü); silinen yok.

Bu belge yalnızca **gerçekten uygulanan** düzeltmeleri listeler. Her satırda
kanıt komutu vardır; "doğrulandı" ibaresi o komutun bu makinede koştuğu
anlamına gelir. Uygulanmayan öneriler `TECHNICAL_DEBT.md` içindedir.

---

## 1. P0 — Atomik yazım geri dönüşünde veri kaybı

**Dosyalar:** yeni `src/main/atomic-write.js`, `src/main/main.js`

**Önce** (`writeFileAtomic`, main.js):

```js
try { fs.renameSync(tmp, file); }
catch {
  try { fs.rmSync(file, { force: true }); fs.renameSync(tmp, file); }
  catch { fs.writeFileSync(file, data); }
}
```

Rename kilidi (Windows'ta AV/bulut senkronizasyonu) hedefi **silerek**
aşılmaya çalışılıyordu. İkinci rename de düşerse doğrudan yazma deneniyor;
ENOSPC/izin/tekrar kilit durumunda bu da düşer ve `finally` geçici dosyayı
siler. Sonuç: ne eski ne yeni içerik.

**Sonra:**

1. Geçici dosya `fsync` edilir (rename öncesi veri diskte).
2. Rename, hedefe dokunmadan N kez (varsayılan 4, 25 ms arayla) denenir.
3. Hâlâ olmuyorsa eski dosya **silinmez**, `.old-*` adına taşınır.
4. Yeni dosya yerleştirilir; olmazsa doğrudan yazılır.
5. Her şey düşerse eski dosya geri konur ve hata yükseltilir.

`main.js` içindeki yerel kopya kaldırıldı, tüm kalıcılık yolları (kaydetme,
tercihler, dışa aktarma, `.abr`, `.tail`, otomatik/acil yedek, arşiv,
kurtarma işaretçisi ve geçmişi) aynı choke-point'i kullanıyor.

**Kanıt:** `node tests/atomic-write-test.js` → 13/13, özellikle
"çift arıza hatayı yükseltir" + "çift arızada eski içerik korunur".

---

## 2. P1 — Dışa aktarmada üzerine yazma yarışı

**Dosya:** `src/main/main.js` (`export-image`, sessiz klasör yolu)

**Önce:** `while (fs.existsSync(hedef))` ile boş ad bulunup **sonra** yazma
yapılıyordu (TOCTOU). İki eşzamanlı aktarım aynı adı seçebilir; biri
diğerinin üzerine yazar.

**Sonra:** yeni `reserveUniqueFile(dir, base, ext)` adı `openSync(..., 'wx')`
ile atomik sahiplenir. Çakışan ikinci istek `" (1)"` varyantına kayar.
Yazma düşerse boş yer tutucu silinir.

**Kanıt:** `tests/atomic-write-test.js` — üç ardışık ad, içerikler korunur,
`limit` aşımı hata verir.

---

## 3. P1 — Büyük `.tail` dosyasının senkron okunması

**Dosya:** `src/main/main.js` (`readBoardFile`)

**Önce:** `fs.statSync` + `fs.readFileSync` (üst sınır `MAX_TAIL_FILE_BYTES`).
Ana süreç bloklandığı için tüm pencereler ve yanıt watchdog'u donuyordu.

**Sonra:** `fs.promises.stat` + `fs.promises.readFile`. Çözme (gzip/inflate)
zaten asenkron yol üzerinde. Hata ve boyut sınırı semantiği aynı kaldı;
`.tail` biçimi değişmedi (`src/main/tail-format.js` dokunulmadı).

**Kanıt:** `node tests/tail-format-test.js` → 23/23 (TAIL/RFVR, sürüm,
gzip bombası, 1 GB pano sınırı).

---

## 4. P1 — Yedek denetiminde senkron JSON parse

**Dosyalar:** yeni `src/main/backup-health.js`, `src/main/main.js`

**Önce:** `inspectBackup` 200 MB'a kadar dosyayı ana süreçte
`readFileSync` + `JSON.parse` ediyordu. `list-backups` her yedek için,
kurtarma taraması ilk 3 sağlıklı adaya kadar tekrar tekrar — tam da renderer
yanıt vermezken.

**Sonra:**

- Parse `worker_threads` içinde (`eval` kaynak: asar yolu sorunu yok).
- İstek başına 15 sn zaman aşımı; takılan worker bırakılır, yedek
  `timeout` ile sağlıksız sayılır — sonsuz bekleme yok.
- Worker kurulamazsa işlem içi yola güvenli düşüş.
- 256 kayıtlık sınırlı önbellek (`name:size:mtime`).
- `list-backups`, `read-backup`, `recovery-plan`, `recovery-offer`,
  açılış denetimi async; liste sıralı işlenir (eşzamanlı 200 MB parse yok).
- `reason` artık dil-bağımsız kod: `too-large`, `too-many-items`,
  `too-many-images`, `corrupt`, `timeout`, `missing`.
- Sayaç, `workspace.projects` ile legacy `state.items` arasından **büyüğünü**
  alır: aynı pano iki yolda tutulsa da çift saymaz, boş `workspace.projects`
  dizisi sınırı gizleyemez.

**Davranış korundu:** `healthy:false` olan yedek `pickLatestBackup`
tarafından asla otomatik seçilmez; kurtarma kutusu yalnız sayıyı gösterir.

**Kanıt:** `node tests/backup-health-test.js` → 12/12 (gerçek worker, bozuk
JSON, boyut/öğe sınırı, worker yok, yanıtsız worker 40 ms'de döner, boş
`workspace` sınırı gizleyemez).

---

## 5. P1 — MessagePort isteğinde zaman aşımı yok

**Dosyalar:** `src/preload/preload.js`, `src/main/ink-engine-host.js` (yorum)

**Önce:** `enginePortTilesImpl` yalnız `onmessage` ile çözülüyordu. Ana
süreçteki `core.tileSlice` takılır veya port ölürse Promise sonsuza asılı
kalıyor, çağıran undo zinciri kilitleniyordu.

**Sonra:**

- 8 sn `ENGINE_PORT_TIMEOUT_MS`.
- Zaman aşımında istek `{ok:false, timeout:true}` ile çözülür, port kapatılır,
  bekleyen tüm istekler temizlenir.
- `onmessageerror` da portu düşürür.
- Sonraki çağrılar `invoke` yedeğine gider (senkron JS dilimleme).

**Kanıt:** `node tests/preload-engine-port-test.js` → 14/14. Test **gerçek**
`src/preload/preload.js` kaynağını stub'lanmış Electron bağlamında `vm` ile
koşturur; yanıt, zaman aşımı ve yedek yolunu doğrular.

**Kalan sınır:** Ana süreçteki senkron C++ çağrısı iptal edilemez; bu
düzeltme renderer'ın kilitlenmesini engeller, ana sürecin o çağrıda
beklemesini değil (bkz. `TECHNICAL_DEBT.md`).

---

## 6. P2 — `verify-package` yerel `require` bağımlılıklarını atlıyordu

**Dosya:** `scripts/verify-package.js`

**Önce:** 10 sabit dosya karşılaştırılıyordu. `main.js` 15 yerel modül
`require` ediyor; pakete girmeyen bir yardımcı modül (ör. bu turda eklenen
`atomic-write.js`) doğrulamadan geçer, uygulama açılışta `Cannot find module`
ile çökerdi.

**Sonra:** `localRequires()` ile bağımlılık grafiği kapatılır; her hedef
arşivde bayt-bayt aynı olmak zorunda. Denetim 10 → 22 dosya.

**Kanıt:** `node scripts/verify-package.js` → 22 dosya OK, `PAKET GÜNCEL`
(`atomic-write.js`, `backup-health.js`, `tail-format.js`,
`panel-window-manager.js`, `dialog-l10n.js` dahil).

---

## 7. P2 — `build-app --check` belgede vardı, zincirde yoktu

**Dosyalar:** yeni `tests/build-app-test.js`, `scripts/run-gates.js`

`src/renderer/app.js` üretilmiş bir dosyadır. Kaynaklar değişip yeniden
üretim unutulursa paket eski kodla çıkar. Yeni kapı gerçek üreticiyi
`--check` modunda koşar, banner ve kaynak sayısını doğrular.

**Kanıt:** `node tests/build-app-test.js` → 6/6
(`app.js 74 kaynakla güncel`).

---

## 8. P2 — Test sayısı dokümantasyonu

**Dosyalar:** `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
`docs/DEVELOPMENT.md`, yeni `tests/gate-docs-test.js`

**Önce:** README 20/74, ARCHITECTURE 14/69, ROADMAP 69, DEVELOPMENT 20/74;
o günkü gerçek **28 pure / 83 toplam**.
**Sonra:** tüm belgeler gerçek sayıyı yazar. `gate-docs-test.js` sayıları
`run-gates.js` listelerinden **yorumları soyduktan sonra** türetir, her
girişin dosyasının var olduğunu ve tekrarlanmadığını doğrular. IPC kapıları
eklenince sayı **30 pure / 85 toplam** oldu ve belgeler aynı turda güncellendi
(gate-docs-test bunu zorunlu kılar). 1.4.4 turunda macOS kapısı eklenince
sayı **31 pure / 86 toplam** oldu.

> Not: İlk denemede sayım yorumlardaki Türkçe kesme işaretlerini
> ("Windows'ta") dosya adı sandı ve 29/84 üretti. Kapı bu tuzağı yakaladı;
> sayım düzeltildi. Bu, kapının gerçekten çalıştığının kanıtıdır.

**Kanıt:** `node tests/gate-docs-test.js` → 13/13.

---

## 9. P2 — Karışık Türkçe/İngilizce arayüz metinleri

**Dosyalar:** 20+ `src/renderer/core/*.js`, `locales/*.json`,
`src/renderer/pose3d/ui/PanelController.js`, `src/renderer/app.js` (üretildi)

- Yüzlerce hardcoded metin `__t` / `tPlural` anahtarlarına çevrildi.
- `tr.json` 1671 anahtar; `en.json` çoğul/override katmanı; varsayılan dil
  `'en'`; bu turda 8 dilde **eşit** 275 anahtar açığı kalmıştı (24 Kasım 2026'da
  kapatıldı — bkz. §9c).
- `48-shell.js`: `psBoardCount` / `psBoardSelection` Türkçe ek soyma hilesi
  kaldırıldı, `tPlural` kullanır.
- `04-persistence-view.js`: `itemLabel()` çoğul/tekil ("1 images" hatası).
- `52-native-brush-library.js`: `.abr` dışa aktarma uyarıları çevrildi.
- `20-settings-pomodoro-youtube.js`: yedek klasörü UX'i ve bozuk `\\n`
  değişmez dizgisi düzeltildi; sistem diline uyar.
- Tema/arayüz kayıt defteri ve paket doğrulama hataları İngilizce anahtar.
- `draw-v5.css` ve `main.js` içindeki mojibake yorumlar temizlendi.

**Kanıt (bu turda):** `node tests/locale-data-test.js` → 20/20
(`10 dil · 12878 anahtar · üretilen dosya güncel`, `de..zh-CN = 275 eksik`),
`node scripts/build-locales.js --check`.

**Dürüst sınır (bu turda):** 275 anahtar henüz çevrilmemişti;
`MAX_UNTRANSLATED = 275` olarak sabitlendi (ratchet). Bu bir düzeltme değil,
**ölçülen borçtu**; 24 Kasım 2026'da kapatıldı (§9c).

### 9c. Çeviri borcunun kapatılması — 275 anahtar × 8 dil

**Dosyalar:** `locales/{de,es,fr,ja,ko,pt-BR,ru,zh-CN}.json`,
`src/renderer/core/01c-locale-data.js` (üretildi), `tests/locale-data-test.js`

- 275 eksik anahtarın tamamı (tema stüdyosu, arayüz paketleri, güncelleme
  paneli, katman uyarıları, board/katman/geçmiş/fırça kütüphanesi metinleri)
  sekiz dile de gerçek çeviriyle eklendi; İngilizce literal kopyalanmadı.
- Her dilde 1671 anahtar; kaynak kümesiyle birebir aynı. Yer tutucular
  (`{v}`, `{p}`, `{name}`, `{n}`, `{path}`, `{error}`, `{slot}`, `{label}`,
  `{file}`, `{date}`, `{contents}`) korundu; boş değer ve U+FFFD yok.
- `MAX_UNTRANSLATED = 275` → **0**; kapsam eşitliği assert'i 8 dilde 0 eksik
  doğruluyor.
- Üretilen paket yenilendi: `10 dil · 15078 anahtar · 883.2 KB`.

**Kanıt:** `node tests/locale-data-test.js` → **23/23**; `build-locales --check`
güncel; `de..zh-CN = 0 eksik`.

### 9b. Bu turda bulunan ve kapatılan regresyon — `tPlural` kapsamı

Yerelleştirme geçişinde bazı dosyalar çıplak `tPlural('image', n)` çağırıyordu.
`tPlural` **01b-l10n.js IIFE'sinin içinde** tanımlı; dışarıya yalnız
`window.L10N` ve `window.__t` açılıyor. Sonuç: `ReferenceError: tPlural is
not defined` — uygulama açılışta öğe sayacı etiketini güncellerken çöküyordu.

- **Nasıl yakalandı:** PURE zinciri bunu görmedi (tarayıcı bağlamı yok).
  `npm run gates:full` → `compositor-test.js` gerçek Electron/CDP oturumunda
  hatayı iki kez üretti ve kapıyı kırmızıya düşürdü.
- **Düzeltme:** `01b-l10n.js` içine `window.__tp` köprüsü eklendi (try/catch
  ile anahtara düşer); 10 çağrı `__tp(...)` olarak değiştirildi
  (04, 06, 20, 44, 48, 52).
- **Regresyon kapısı:** `tests/locale-data-test.js` artık renderer
  kaynaklarında çıplak `tPlural(` arar ve `window.__tp`/`window.__t`
  köprülerinin varlığını doğrular (23/23).
- **Ders:** PURE kapıları tarayıcı kapsamını kanıtlamaz; tam zincir
  (Electron + CDP) bu sınıf hatalar için zorunludur.

### 9d. `undo-region-check` zamanlama yarışı (test tarafı)

**Dosya:** `tests/undo-region-check.js` — üretim kodu değişmedi.

Tam zincir iki kez koşulduğunda kapı kırmızıydı, ama **her seferinde farklı**
assert düştü ("durgunluk" bir koşuda, "bölge == referans" diğerinde). Kök neden:
bölgesel undo fallback'i yeniden birleşimi worker'a devrediyor; test sabit
160 ms bekleyip ölçtüğü için worker uygulaması bazen pencereye yetişiyor,
bazen yetişmiyordu.

- **Düzeltme:** test, `inkUndoRaster.stats` üzerinden yayınlanan worker
  işleri (`workerPosted - workerApplied - workerCancelled`) kapanana kadar
  bekliyor (20 ms aralık, 5 s kapı). Kapanmazsa kapı yine kırmızı kalır —
  bekleme süresi sınırsız değil.
- **Neden gevşetme değil:** assert'ler aynı kaldı; yalnızca ölçüm, asenkron
  iş bittikten sonraya taşındı. "Tembel üst-yazım yok" iddiası artık gerçekten
  ölçülüyor.
- **Kanıt:** üç ardışık tek başına koşu yeşil; `idle=true` (80/146/173 ms),
  `workerPosted=3 · workerApplied=3 · workerCancelled=0`.

### 9e. `ink-radial-check` kare donması ve port çakışması (test tarafı)

**Dosya:** `tests/ink-radial-check.js` — üretim kodu değişmedi.

Tam zincirde kapı iki farklı biçimde kırmızıya düştü: bir koşuda panel açıldı
ama çarkın CSS geçişi 240 ms'lik sabit örnekte hâlâ `opacity: 0`'dı; yeniden
denemede editör hiç açılmadı (3/42). Tek başına koşunca 42/42 geçiyordu.

Kök neden iki katmanlı:

1. **Kare donması.** `41-canvas-workspace.js` yeni tuvali açarken
   `await new Promise(requestAnimationFrame)` yapıyor; bu makinede belgelenmiş
   rAF donması yaşandığında bu bekleme dönmüyor. Aynı donma CSS geçişini de
   durduruyor. Test artık `Page.bringToFront` + odak taklidi ile pencereyi
   kare üretmeye uyandırıyor ve hover görünürlüğünü sabit süre yerine
   koşul gerçekleşene kadar (üst sınır 2 s) ölçüyor.
2. **Sabit port.** Kapı 5203/9340'ı kullanıyordu; `settings-hub-test` de
   5203'ü kullanıyor. Yeniden deneme, kapanmakta olan/başka bir örneğin
   hata ayıklama hedefine bağlanabiliyordu. Artık her koşu boş portları
   kendisi alıyor (`net` ile 0 → ayrılan port); yabancı örneğe bağlanma
   olanaksız.

- **Neden gevşetme değil:** assert'ler ve eşikler aynı; yalnızca ölçüm koşula
  bağlandı ve izolasyon sağlandı.
- **Kanıt:** beş ardışık tek başına koşu **5/5 yeşil** (42/42).

### 9f. `pinterest-test` ikinci panel taşımasında CDP beklemesi (test tarafı)

**Dosya:** `tests/pinterest-test.js` — üretim kodu değişmedi.

Panel geri takıldıktan sonra ikinci kez ayrı pencereye taşıma adımı, iki tam
zincir denemesinde de **aynı yerde** `TEST HATASI: eval zaman aşımı` ile
düştü (24/25). Tek başına da tekrarlandı.

- **Kök neden:** adım, `Runtime.evaluate` içinde doğrudan
  `await detachPanelToWindow(...)` yapıyordu. Pencere oluşturmayı kapsayan bu
  bekleme, CDP `awaitPromise` yanıtına dönüşmeden asılı kalıyordu.
- **Düzeltme:** taşıma sayfada başlatılıp sonucu `window.__detach2State`
  üzerinden yoklanıyor (`kick` → `done:true` / `err:...`). Assert aynı;
  üstelik `done:true` şartı eklendiği için öncekinden daha sıkı.
- **Neden gevşetme değil:** taşımanın gerçekten tamamlanması hâlâ zorunlu;
  yalnızca CDP'nin uzun ömürlü promise'i bekleme biçimi değişti.
- **Kanıt:** iki ardışık tek başına koşu **25/25**.

### 9g. `panel-window-test` v5 panel taşımasında CDP beklemesi (test tarafı)

**Dosya:** `tests/panel-window-test.js` — üretim kodu değişmedi.

Tam zincirde `panel-window-test` ilk koşuda **22/23**'te `TEST HATASI: eval zaman aşımı`
ile düştü; yeniden denemede 31/31 geçti. Düşüş, v5 panel döngüsünün ikinci
taşımasında (`v5LayersPanel`) oldu — §9f ile aynı kök neden.

- **Düzeltme:** dört v5 panelinin taşıması da `kick` → `__v5DetachState`
  yoklamasına çevrildi; `done:true` şartı korunuyor, sonrasında panel
  işaretleri ayrı bir değerlendirmeyle okunuyor.
- **Kanıt:** üç ardışık tek başına koşu **3/3 yeşil (31/31)**.

### 9h. `ink-engine-host-check` çıkışta native çökme (bilinen, açık)

Tam zincirde ilk koşu **exit 3221225477 (0xC0000005)** verdi; HOST adımları
`HOST SONUÇ: yeşil` yazdıktan **sonra**, süreç kapanırken çöktü. Yeniden
denemede geçti. Yerelleştirme çalışmasıyla ilgisi yok; C++ motor ana
sürecinin teardown'ında erişim ihlali. Bu turda üretim koduna dokunulmadı —
kayıt altına alındı, ayrı bir iş olarak ele alınmalı.

### 9i. Kullanıcı önizlemesinde bulunan arayüz kusurları

Kullanıcının canlı `localhost:5173` önizlemesinde işaret ettiği beş kusur
kapatıldı. Hepsi üretim kodunda, davranışı değiştirmeyen görsel düzeltme.

**(a) Boş tahta ipucunda logo + wordmark.** `index.html` içindeki
`#splashLogo` bloğu kaldırıldı; ipucu yalnız "Drag images here" ve
"or paste with Ctrl+V · double-click for text" satırlarını gösteriyor.
Artık kullanılmayan `#splashLogo` / `.splashBrandLockup` kuralları
`style.css`'ten silindi (kalıntı taraması: 0). Sol üstteki kalıcı `#brand`
markası korunuyor.

**(b) Mod sırası her panelde aynı.** DOM sırası artık
`3D Pose · Reference · Drawing`; moda göre `order` ile yeniden sıralayan
kurallar (`draw-proto.css`, `draw-v5.css`) kaldırıldı. Üç modda da ölçülen
görsel ve klavye odak sırası aynı.

**(c) Boş görünen toggle'lar (`#settingsPanelsHide`, `#settingsShapeTool`).**
Kök neden: genel `button[data-tooltip]::after` tooltip kuralı (özgüllük
0,1,2) switch topuzunu çizen `.settingToggleBtn::after` (0,1,1) kuralını
eziyordu; yalnız `data-tooltip` taşıyan iki switch topuzsuz kalıyordu.
Genel kural `:not(.settingToggleBtn)` ile daraltıldı, switch tooltip'i
`::before`'a taşındı, `overflow:hidden` → `visible` yapıldı. `ui-shell.css`
ve `ui-irix.css` eşellendi. `settings-hub-test`'e regresyon assert'i
eklendi (76 → **77/77**): topuz 15×15 ve `::after`'da tooltip metni yok.

**(d) Üst hap çizim modunda uzuyordu.** `#btnPanelsBar` için kimlik kuralı
yoktu: referansta `.modeBtn--icon` ile 28 px kalıyor, çizimde
`body.mode-draw #appModeBar .modeBtn{padding:0 14px!important}` onu 43 px'e
şişiriyordu. Merkezden hizalandığı için hap sola doğru 21 px uzuyordu
(441 → 462). İki ikon düğmesi (`#btnPanelsBar`, `#btnOverflow`) çift kimlik
seçicisiyle her modda **30 px**, dolgu 0, kenar boşluğu 2 px'e sabitlendi.
Ölçüm: referans ve çizimde de hap **337–782 (445 px)**.

**(e) Kapanma/açılma animasyonu donuyordu.** `setAppModeCollapsed` inline
`width` yazıyordu; `draw-proto.css` ve `ui-shell.css` içindeki
`width:auto!important` kuralları bunu ezdiği için genişlik 340 ms boyunca
445 px'te kalıp sınıf değişiminde 151 px'e atlıyordu ("bastığın an donuyor
sonra bir anda kapanıyor"). Wipe artık genişliği `!important` inline yazıyor,
bitince `removeProperty` ile temizliyor. Kare örnekleri: 151 → 445,
~320 ms, kesintisiz; iki modda da aynı. `scripts/build-app.js` yeniden
üretildi.

### 9j. Ayarlar denetimi: gerçekten çalışmayan ayarlar

Kullanıcı "kim bilir daha çalışmayan kaç ayar var" dedikten sonra Ayarlar
paneli uçtan uca tarandı: her denetimin yazdığı `localStorage` anahtarı /
`data-*` özniteliği ve bunu okuyan tüketici karşılaştırıldı; ayrıca canlı
önizlemede her denetim tek tek değiştirilip gözlemlenebilir etkisi ölçüldü.
Bulunan gerçek hatalar:

**(a) Yüksek kontrast hiç etkisizdi.** `html[data-hi-contrast="1"]`
(özgüllük 0,1,1) tema kuralı `:root[data-theme="..."]` (0,2,0) ve `<head>`e
sonradan eklenen özel tema kuralları tarafından eziliyordu; anahtar
`localStorage`a yazılıyor, `--dim`/`--border` değişmiyordu. Kural
`html[data-hi-contrast="1"][data-theme]` (0,2,1) ile güçlendirildi.
Ölçüm: `--dim` `#a7bacb` → `color-mix(...#eef7ff 86%...)`, etiket rengi
`rgb(167,186,203)` → `color(srgb 0.812 0.847 0.880)`.

**(b) Özel temada yağmur/kar görünmüyordu.** Tuval görünürlüğü yalnız
`[data-theme="rain"|"snow"]` ile kuruluyordu; efekt taşıyan özel temanın
kimliği `ct_...` olduğu için kural tutmuyor, animasyon çizilse bile canvas
`display:none` kalıyordu. `19-themes-effects.js` etkin efekt türünü
`html[data-ambient]`e yazıyor, CSS bu özniteliği de dinliyor. Ölçüm:
özel "Rain Koru" temasında `rainPix` 0 → 39, "Snow Koru"da `snowPix` 0 → 175.

**(c) Rain/Snow'dan kaydedilen tema efektini ve gradyanını kaybediyordu.**
Özel tema veri modeline `effect` + `backdropCss` eklendi (`02b-theme-registry.js`);
kaydetme/çoğaltma bu alanları taşıyor, üretilen kural kaynak gradyanı
yazıyor (yalnız `linear/radial/conic-gradient(...)`, `url()` ve `;{}`
reddedilir). Ayrıca galeri seçimi ve tema kaydı artık **aktif modun**
anahtarına yazılıyor (`tailref-theme-draw` / `-reference`); önceden çizimde
seçilen tema mod değişiminde eski anahtara dönüyordu ("bazen bozuluyor").
Ölçüm: kaydettikten sonra mod gidip gelince tema ve efekt korunuyor.

**(d) "Cursor-anchored zoom" ölü ayardı.** `tailref-zoom-cursor` anahtarını
hiçbir tüketici okumuyordu; görüntü editörü Ctrl+tekerlek zoom'u her zaman
imleç odaklıydı. `inkEditorWheel` anahtarı okuyor: kapalıyken zoom tuval
merkezine sabitleniyor. Varsayılan **açık** (eski davranış korunur, toggle
artık doğru durumu gösterir).

**(e) "Editor grid step" ölü ayardı.** `tailref-ce-grid-step` yalnız panele
geri okunuyordu; `#gridOverlay` CSS'te sabit `32px` idi ve panel 64
gösteriyordu. Artık seçim `#gridOverlay`in `background-size`ını sürüyor
(32/64/128/256; varsayılan 32). Ölçüm: 256 → `256px 256px`, 32 → `32px 32px`.

**(f) Ayarlar alt bilgisi kırpılıyordu.** `.settingsMail`/`.settingsCopyright`
`nowrap` + ellipsis yüzünden 800 px'te "…tailrefstud…" oluyordu. Alt bilgi
CSS grid'e alındı: sol sütunda e-posta (1. satır) ve telif (2. satır), sağ
sütunda Save / Reset all settings iki satır boyunca ortalanıyor. Kırpma yok;
`settings-hub-test` assert'i eklendi (77 → **79/79**).

**(g) Panel küçültülünce Ayarlar içeriği tek harfe çöküyordu.** Panel
yeniden boyutlandırılabilir (min 300 px). Sol nav 172 px sabit kaldığı ve
alt bilgi düğmeleri 169 px yer kapladığı için sağ sütunda metne ~0 px
kalıyor; e-posta "I / f / y / o / u …" diye dikey sarıyordu. `#settings`
`container-type:inline-size` yapıldı; **560 px altında** tek sütun düzeni
devreye giriyor: nav üstte yatay, kaydırılabilir çip şeridi (arama kutusu
tam genişlik), alt bilgi metni tam genişlik, Save/Reset düğmeleri alt
satırda. Ölçüm (400×520): nav 150 px yatay, e-posta 366 px kırpmasız,
düğmeler altta, destek bağlantısı görünür. `settings-hub-test`'e dar panel
assert'i eklendi (**81/81**).

Tarama özeti: ~40 denetim canlı ölçüldü. Gerçekten ölü bulunan iki ayar
(d, e) düzeltildi; kalan "durum değişmiyor" görünenler ya Electron köprüsü
gerektiriyor (Always on top, UI scale, güncelleme, dosya seçicileri) ya da
yalnız çizim modunda bellekte etkili (panelleri gizle, fare basıncı, teşhis
paneli) — hepsi çizim modunda ayrıca doğrulandı (paneller 4 → 0 → 4,
`mousePressure` true → false, teşhis `on` true → false).

---

## 10. Kullanıcı ekran görüntüsünün arşivlenmesi

`docs/audit/known-issues-2026-11-23.png` (25.9 KB) — kullanıcının ilettiği
"Şu anki hata ve eksik listesi" görüntüsü. `AUDIT_REPORT.md` §3 her maddeyi
kod kanıtıyla eşler.

---

## 11. P1 — IPC gönderen doğrulaması (82 kanalın tamamı)

**Dosyalar:** yeni `src/main/ipc-guard.js`; `src/main/main.js`,
`panel-window-manager.js`, `ink-engine-host.js`, `pinterest.js`,
`artstation.js`, `update-manager.js`; yeni `tests/ipc-guard-test.js`,
`tests/ipc-sender-gate-test.js`

**Önce:** 82 `ipcMain.handle/on` çağrısı vardı, yalnız 17'si
`event.sender`/`senderFrame` kontrol ediyordu. `pinterest` (5) ve
`artstation` (4) hiç kontrol etmiyordu. Konuk `<webview>` preload'unda
`window.tailref` köprüsü olmadığı için pratikte sömürülebilir bir zincir
gösterilmemişti; bulgu savunma derinliğiydi.

**Sonra:**

- `ipcGuard.handle(ipcMain, channel, fn)` / `ipcGuard.on(...)` tek kapı.
  Sıra: kayıtlı pencere → canlı `webContents` → üst düzey `senderFrame`
  (iframe reddi) → uygulama origin'i → panel kanalı allowlist'i.
- `handle` reddi `E_IPC_UNTRUSTED` sözüyle, `on` reddi mesajı düşürerek
  yapar; kanal başına en fazla 3 uyarı loglanır (log taşması yok).
- Ana pencere `trustMain`, ayrı paneller `trustPanel` ile kaydedilir,
  kapanışta `untrustMain`/`untrustPanel` ile geri alınır.
- Panel kanalları ayrı allowlist (`PANEL_CHANNELS`, 7 kanal); panel
  preload'unun kullandığı adlarla birebir eşleşir.
- Ham `ipcMain.handle/on` yalnız `ipc-guard.js` içinde kalır; kaynak kapısı
  bunu zorunlu tutar.

**Kanıt:** `node tests/ipc-guard-test.js` → 22/22 · yabancı/ölü gönderen,
alt çerçeve, yabancı origin, panel allowlist, trust iptali, uyarı sınırı.
`node tests/ipc-sender-gate-test.js` → 27/27 · kaynaktan 82 kanal, sızan ham
kayıt yok, panel-preload eşleşmesi, trust kancaları.
`update-manager-test` 53/53, `ink-engine-host-check` yeşil,
`panel-window-test` 31/31, `desktop-smoke` 20/20, tam zincir 86/86 (2 retry).

**Kalan risk:** Ana pencerenin kendi origin'i güvenilir kabul edilir. Ana
renderer'da kod çalıştırma zinciri kırılırsa o pencerenin kanalları açıktır;
CSP `script-src 'self'`, sandbox ve dar preload bu zinciri kapalı tutar. Bu
bilinçli bir tasarım sınırıdır, gizlenmiyor.

**Yakalanan gerçek regresyon:** Guard devreye girince `update-manager-test`
3 assert kırmızıya döndü; test sentetik göndereni **senkron** çağırıyordu ve
guard'ın döndürdüğü reddetme sözü yutuluyordu. Beklenti `await` +
`assert.rejects` olarak düzeltildi; artık gerçek reddi doğruluyor.

**Test altyapısı düzeltmesi:** Tam zincirde `ref-board-test` iki kez
`TypeError: ... reading 'focus'` ile düştü. Kök neden testin gruplaştırmadan
sonra **sabit 160 ms** beklemesiydi; pencere arka planda/yoğunken başlık odağı
etkinleşmedi, düzenleme geri-alma adımı açmadı ve sonraki `undo()` grup
oluşturmayı geri aldı. Test artık başlığın görünür olmasını sınırlı süreyle
bekliyor, odağı doğruluyor ve pencere odağı yoksa `focus`/`blur` olaylarını
açıkça gönderiyor. Ürün kodu değişmedi; davranış yine gerçek DOM
dinleyicileriyle sınanıyor ve hata artık okunur bir nedenle raporlanıyor.

**İkinci test altyapısı düzeltmesi:** `pose3d-smoke` bir kez
`panoya PNG kopyalanıyor` adımında kırmızı oldu. Test `window.focus()`
çağrısından **hemen sonra** pano yazıyordu; Chromium odağı bir sonraki görev
döngüsünde uyguladığı için yazma `"document is not focused"` ile reddedildi ve
üç deneme de aynı turda boşa gitti. Test artık `document.hasFocus()`
gerçekleşene kadar sınırlı (1.5 sn) yokluyor, sonra yazıyor; başarısızlıkta
`deneme`/`odak` değerlerini raporluyor. Ürün kodu değişmedi (pano yazımı
gerçekten odak ister). İki ardışık koşu 110/110, `deneme=1 · odak=true`.

---

## 12. Doküman — Kod imzalama politikası ve SignPath başvuru paketi

**Dosyalar:** yeni `docs/CODE_SIGNING.md`, yeni
`docs/SIGNPATH_APPLICATION.md`; `README.md` (SmartScreen + yol haritası)

- `docs/CODE_SIGNING.md`: SignPath Foundation'ın istediği **herkese açık
  imzalama politikası** — kapsam, roller (committer/reviewer/approver),
  imzalanan/ imzalanmayan artefaktlar, gizlilik, ağ erişimi, kaldırma ve
  imza doğrulama komutu.
- `docs/SIGNPATH_APPLICATION.md`: uygunluk tablosu (her şart → kanıt),
  form için proje bilgileri, **engelleyici ön koşullar** (yayınlanmış 1.4.4
  sürümü, maintainer e-postası/MFA, SignPath hesabı), onay sonrası CI
  değişkenleri ve iki aşamalı imzalama notu.
- README: "not code-signed" ifadesi "not code-signed yet" oldu, politika
  bağlantısı eklendi; yol haritasında kod imzalama "hazırlanıyor" olarak
  doğru konuma taşındı.

**Dürüst sınır:** Form **gönderilmedi** ve hiçbir sürüm imzalanmadı. Bu
dosyalar başvuruyu hızlandıran kanıt paketidir, imza değildir.

---

## macOS yapı hattı (1.4.4)

**Dosyalar:** `package.json` (`build.mac`, `dmg`), yeni
`build/entitlements.mac.plist`, `scripts/build-native.js`,
`src/main/main.js`, `.github/workflows/release.yml`,
`scripts/release-notes.js`, yeni `docs/MACOS.md`, yeni
`tests/macos-packaging-test.js`.

**Eklenenler:**

1. `build.mac`: `dmg` hedefi, `arm64` + `x64`, `category`
   `public.app-category.graphics-design`, `darkModeSupport`, ikon `build/icon.png`,
   `extraResources` ile aynı ikon.
2. `identity: "-"`: Apple Developer ID olmadan **ad-hoc imza**. `hardenedRuntime`
   açık, `gatekeeperAssess: false`; entitlement'lar
   `build/entitlements.mac.plist` (JIT, imzasız çalıştırılabilir bellek,
   `disable-library-validation` — `inkcore.node` için).
3. `scripts/build-native.js --arch=`: tek (arm64) runner'dan Intel native
   modülü çapraz derlemesi; `process.arch` varsayılan olarak korunur.
4. `src/main/main.js`: `app.on('open-file')` — Finder `.tail` dosyasını argv'ye
   koymadığı için belge olayı dinlenir; açık pencereye devredilir, soğuk
   açılışta bekletilir. İkon seçimi `win32 ? icon.ico : icon.png`.
5. `release.yml` → yeni `macos` işi (`macos-15`): iki mimari native derleme,
   iki DMG, `verify-package`, `lipo` ile Mach-O mimarisi, `PlistBuddy` ile
   `.tail` belge türü, `codesign --verify --deep --strict` + `Signature=adhoc`
   kontrolü, `hdiutil attach` ile imaj bağlama, artifact yükleme. `release` işi
   artık `macos`'u da bekliyor; `latest-mac.yml` ve `.zip` yükü reddediliyor.
6. `scripts/release-notes.js`: `## macOS` bölümü, iki DMG adı, notarize
   edilmediği için Gatekeeper adımı ve `xattr` komutu, uygulama içi
   güncelleyici olmadığı, `shasum -a 256` örneği, sorun giderme maddesi.
7. `docs/MACOS.md`: kurulum, Gatekeeper, yerel derleme, CI doğrulaması,
   Developer ID + notarization'a geçiş adımları, sınırlamalar.
8. `tests/macos-packaging-test.js`: 64 assert — yapılandırma, entitlement'lar,
   `--arch`, `open-file`, CI adımları, release notları, belge ve kapı sayıları.
9. `scripts/launch-smoke.js`: paketlenmiş uygulamayı geçici veri klasöründe ve
   izole portta başlatıp `appReady`, pencere ölçüsü ve tahta sahnesini
   doğrulayan gerçek açılış kontrolü. `macos` işi DMG'den çıkardığı `.app`'e
   karşı koşar; açılmayan paket yayına çıkmaz. Script Windows paketine karşı
   burada da denendi: **6/6**.
10. `62b-updates.js`: güncelleyici kapalıyken macOS'e özel cümle; 9 dile
    çevrildi (locale ratchet 0'da kaldı).

**Dürüst sınır:** macOS paketi bu Windows makinesinde **derlenmedi ve
çalıştırılmadı**; DMG'ler ilk kez CI'da (`macos-15`) üretilecek. Bunu telafi
etmek için iş akışı paketi gerçekten başlatıyor (`scripts/launch-smoke.js`),
ama bu script Mac'te değil, aynı mantıkla Windows paketine karşı burada
doğrulandı (6/6). Etkileşimli çizim, paneller ve Finder'dan `.tail` açma hâlâ
bir insan testi gerektiriyor. İmza ad-hoc olduğu için notarization yoktur: ilk
açılışta sağ tık → **Open** gerekir. Apple Developer ID ($99/yıl) olmadan bu
değişmez; geçiş adımları `docs/MACOS.md` içindedir. README, CHANGELOG (TR + EN),
flatpak tag/metainfo, ROADMAP, FEATURES, RELEASE_PROCESS, RELEASE_CHECKLIST,
INSTALLATION ve DEVELOPMENT belgeleri 1.4.4 ve macOS ile güncellendi.

---

## Doğrulama özeti

| Komut | Sonuç |
|---|---|
| `node tests/atomic-write-test.js` | 13/13 |
| `node tests/backup-health-test.js` | 12/12 |
| `node tests/preload-engine-port-test.js` | 14/14 |
| `node tests/build-app-test.js` | 6/6 |
| `node tests/gate-docs-test.js` | 13/13 |
| `node tests/ipc-guard-test.js` | 22/22 |
| `node tests/ipc-sender-gate-test.js` | 27/27 |
| `node tests/update-manager-test.js` | 53/53 |
| `node tests/panel-window-test.js` | 31/31 |
| `node tests/desktop-smoke.js` | 20/20 |
| `node tests/settings-hub-test.js` | 82/82 (toggle topuzu regresyon assert'i dahil) |
| `node tests/ref-board-test.js` | 26/26 |
| `node tests/pose3d-smoke.js` | 110/110 (`deneme=1 · odak=true`) |
| `node tests/tail-format-test.js` | 23/23 |
| `node scripts/verify-package.js` | 22 dosya · PAKET GÜNCEL |
| `node scripts/build-app.js --check` | güncel |
| `node scripts/build-locales.js --check` | güncel |
| `npm.cmd audit --omit=dev` | 0 güvenlik açığı |
| `node scripts/run-gates.js` | 31/31 PURE |
| `npm.cmd run gates:full` | **86/86** (31 PURE + 55 Electron/CDP) · 2 kapı ilk koşuda kırmızı, retry'de yeşil |
| `node tests/linux-packaging-test.js` | 118/118 |
| `node tests/macos-packaging-test.js` | 64/64 |
| `node tests/locale-data-test.js` | 23/23 · 10 dil · 15087 anahtar · 0 çevrilmemiş |
| `node tests/doc-links-test.js` | 183 yerel bağlantı temiz |
| `node scripts/launch-smoke.js --exe="dist/win-unpacked/TailRef Studio.exe"` | 6/6 (paket açılıyor, sahne çiziliyor) |
| `npm.cmd run build:dir` | exit 0 · imzasız `dist/win-unpacked` yeniden üretildi |
