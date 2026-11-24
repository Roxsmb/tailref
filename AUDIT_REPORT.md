# AUDIT REPORT — TailRef Studio 1.4.3

**Tarih:** 2026-11-23 · **Son doğrulama:** 2026-11-24 (tam zincir 85/85, yeniden deneme 0)
**Kapsam:** Tüm depo (main, preload, renderer, native köprü, build/paketleme, test altyapısı)
**Temel commit:** `c62c820` (inceleme sırasında çalışma ağacı değişiklikleriyle birlikte)
**Ortam:** Windows 10.0.26300 x64 · Electron 45.4.1 · Node 26.8.2 · electron-builder 26.18.0 · node-gyp 12.4.0 · VS 2022 BuildTools · Python 3.14.5

> Bu rapor yalnızca bu ortamda gerçekten doğrulananları "doğrulandı" sayar.
> Wacom/Windows Ink donanımı, macOS ve Linux çalıştırması bu makinede
> **test edilmedi**; ilgili maddeler açıkça öyle işaretlidir.

---

## 0. Yönetici özeti

| Soru | Yanıt |
|---|---|
| Doğrulanmış hata (bulundu) | **18** (2'si bu denetim sırasında üretilip kapatıldı: TR-U06, TR-U07) |
| Düzeltilen | **13** — P0: 1 · P1: 9 · P2: 3 |
| Açık kalan hata | **4** — 2'si eksik özellik (Magic Wand, `.abr` dinamikleri), 1'i kod imzalama/dağıtım, 1'i sınırlı P3 |
| Güvenlik sorunu | IPC gönderen doğrulaması kapatıldı (82/82 kanal) · 1 kabul edilen risk: kod imzalama bütçe nedeniyle beklemede; GPL OSS için SignPath Foundation başvuru paketi hazır · üretim bağımlılığı açığı 0 |
| Performans sorunu | 3 kapatıldı (senkron `.tail`, 200 MB yedek parse'ı, 1 GB yedek okuma) · 2 açık (senkron native `tileSlice`, ölçüm tabanı yok) |
| Eklenen test | 7 yeni kapı dosyası + 2 genişletme; **107 yeni assert**; zincir 85 kapı (30 PURE + 55 FULL) |
| Test sonucu | PURE **30/30** · FULL **85/85** · başarısız 0 (ayrıntı: `TEST_COVERAGE_REPORT.md`) |
| Kalan kritik sorun | P0 yok. P1: kod imzalama (SignPath onayı), gerçek tablet + macOS/Linux doğrulaması |
| Sonraki kilometre taşı | 1.4.3 sürümünü yayınla + SignPath başvurusunu gönder + ilk imzalı Windows build + gerçek tablet regresyon turu |
| Karar | **CONDITIONALLY READY** (Windows beta için) |

---


## 1. Yöntem

1. Depo haritası: giriş noktaları (`src/main/main.js`, `src/preload/preload.js`,
   `src/renderer/index.html`), 74 renderer kaynağı, `src/main/*` yardımcı
   modülleri, `scripts/*` üretim/paketleme, `tests/*` kapıları.
2. Kritik akışlar uçtan uca okundu: kaydetme/açma (`.tail`), otomatik yedek,
   kurtarma, dışa aktarma (görsel/ABR), IPC yüzeyi, webview panelleri,
   güncelleme, tema/arayüz paketleri, çizim motoru geri al/yinele, dil katmanı.
3. Bulgular kaynak konumu + kod kanıtı ile kaydedildi; mümkün olan her düzeltme
   için regresyon testi yazıldı ve koşuldu.
4. Yeni testler dahil `node scripts/run-gates.js` (PURE zinciri) ve paket
   doğrulaması koşuldu. Sonuçlar `TEST_COVERAGE_REPORT.md` içinde.

**İncelenmeyen / doğrulanamayan alanlar:** gerçek tablet donanımı, macOS/Linux
çalıştırması, kod imzalama, gerçek zamanlı GPU profiler (RenderDoc/NSight),
uzun süreli (saatler) bellek soak testi, gerçek kullanıcı projeleri.

---

## 2. Özet bulgu tablosu

| ID | Önem | Konu | Durum |
|---|---|---|---|
| TR-A01 | **P0** | `writeFileAtomic` geri dönüşü, rename ikinci kez düşünce hedef dosyayı silip veri kaybedebiliyordu | **Düzeltildi** |
| TR-B01 | P1 | MessagePort isteğinde zaman aşımı yok; yanıt gelmezse çağrı sonsuza asılı kalıyordu | **Düzeltildi** |
| TR-B02 | P1 | Sessiz klasöre dışa aktarmada "var mı?" kontrolü → yazma yarışı (üzerine yazma) | **Düzeltildi** |
| TR-B03 | P1 | Büyük `.tail` dosyası ana süreçte senkron okunuyordu (UI donması) | **Düzeltildi** |
| TR-B04 | P1 | Yedek sağlık denetimi ana süreçte senkron `JSON.parse` (kurtarma kutusu donması) | **Düzeltildi** |
| TR-B05 | P1 | `read-backup` 1 GB'a kadar dosyayı senkron okuyordu | **Düzeltildi** |
| TR-B06 | P1 | `itemLabel` çoğul/tekil hatası (İngilizce "1 images") | **Düzeltildi** (önceki tur) |
| TR-B07 | P1 | `psBoardCount` Türkçe ek soyma hilesi, diğer dillerde yanlış sayı | **Düzeltildi** (önceki tur) |
| TR-S01 | P1 | 82 IPC kanalının çoğunda `event.sender` doğrulaması yok (savunma derinliği) | **Düzeltildi** |
| TR-S02 | P1 | Kod imzalama yok; SmartScreen/indirme bütünlüğü kullanıcıya bırakılıyor | **Açık** (SignPath başvurusu hazır) |
| TR-U01 | P2 | Arayüzde karışık Türkçe/İngilizce metinler | **Kapandı** — 8 dilde 275 anahtar çevrildi, `MAX_UNTRANSLATED = 0` |
| TR-U02 | P2 | Test sayısı belgeleri gerçekle uyuşmuyordu (14/20/69/74 vs o günkü gerçek 28/83; bugün 30/85) | **Düzeltildi + kapı** |
| TR-U03 | P2 | `build-app --check` belgede kapı zincirinde görünüyordu ama koşmuyordu | **Düzeltildi + kapı** |
| TR-U04 | P2 | Magic Wand uygulanmamış | **Açık** (özellik) |
| TR-U05 | P2 | Photoshop `.abr` dinamik eşlemesi eksik | **Açık** (özellik) |
| TR-U06 | P2 | `verify-package` yalnız 10 dosyayı denetliyordu; yerel `require` bağımlılıkları (ör. yeni `atomic-write.js`) pakete girmezse denetimden geçip açılışta çökerdi | **Düzeltildi + kapı** |
| TR-U07 | P1 | Yerelleştirme geçişinde bırakılan çıplak `tPlural(...)` çağrıları IIFE kapsamı dışında `ReferenceError` üretiyordu | **Düzeltildi + kapı** |
| TR-P01 | P3 | Yedek sağlık worker'ı kurulamazsa işlem içi parse'a düşer (senkron) | **Açık, sınırlı** |

Ayrıntılar aşağıda; uygulanan değişikliklerin tam listesi `FIXES_APPLIED.md`.

---

## 3. Kullanıcının ilettiği "şu anki hata ve eksik listesi"

Ekran görüntüsü: [`docs/audit/known-issues-2026-11-23.png`](docs/audit/known-issues-2026-11-23.png).
Sekiz maddenin her biri kodda arandı; sonuç:

| # | Kullanıcı maddesi | Bulgu | Yapılan |
|---|---|---|---|
| 1 | Atomik kayıt fallback'i (P0) | **Doğrulandı:** `rename` düşünce `rmSync(file)` çağrılıyor, ikinci `rename` de düşerse `writeFileSync` de düşebilir → dosya tamamen yok. | Yeni `src/main/atomic-write.js`: rename tekrarı, eski dosyayı `.old-*` yanına alma, son çare yazma, hata halinde geri koyma. 13 test. |
| 2 | MessagePort zaman aşımı (P1) | **Doğrulandı:** `preload.js` `enginePortTilesImpl` süresiz Promise; `ink-engine-host.js` yorumu "istek zaman aşımı yok" diyordu. | 8 sn zaman aşımı, portu kapatma, bekleyenleri çözme, sonraki çağrıda invoke yedeği. 14 test (vm ile gerçek preload). |
| 3 | Dışa aktarmada üzerine yazma yarışı (P1) | **Doğrulandı:** `existsSync` döngüsü + ayrı yazma (TOCTOU). Aynı adı seçen iki aktarım birbirini ezer. | `reserveUniqueFile` (O_EXCL `wx`) + hata halinde yer tutucuyu silme. 13 test. |
| 4 | Büyük `.tail` senkron okuma (P1) | **Doğrulandı:** `readBoardFile` içinde `statSync` + `readFileSync` (üst sınır onlarca MB). | `fs.promises.stat/readFile`; decode zaten async. |
| 5 | Yedek incelemede senkron JSON parse (P1) | **Doğrulandı:** `inspectBackup` 200 MB'a kadar `readFileSync`+`JSON.parse`; liste/kurtarma taraması bunu N kez yapıyor. | `src/main/backup-health.js`: `worker_threads` (eval) ile parse, 15 sn zaman aşımı, sınırlı önbellek, async IPC. 12 test. |
| 6 | Photoshop fırça dinamikleri (P2) | **Doğrulandı (eksik):** `.abr` içe/dışa aktarma var, tüm dinamikler eşlenmiyor. | Kapsam dışı özellik; `ROADMAP.md` + `TECHNICAL_DEBT.md`'de açık. |
| 7 | Magic Wand (P2) | **Doğrulandı (eksik):** kodda araç yok, UI'da vaat edilmiyor. | Kapsam dışı özellik; `ROADMAP.md`'de açık. |
| 8 | Test sayısı dokümantasyonu (P2) | **Doğrulandı:** README 20/74, ARCHITECTURE 14/69, ROADMAP 69 diyordu; gerçek 30/85. | Belgeler düzeltildi + `tests/gate-docs-test.js` sayıları kaynak listesinden doğruluyor. |

---

## 4. Ayrıntılı bulgular

### TR-A01 · P0 · Atomik yazım geri dönüşünde veri kaybı

- **Konum:** eski `src/main/main.js` `writeFileAtomic` (satır ~59–86).
- **Kök neden:** `renameSync(tmp, file)` düşünce hedef `rmSync(file, {force:true})`
  ile **siliniyor**, sonra tekrar rename deneniyor; o da düşerse
  `writeFileSync(file, data)` deneniyor. Diskte yer yoksa (ENOSPC), izin
  yoksa veya AV hedefi yine kilitlediyse bu da düşer → `finally` geçici dosyayı
  siler → **eski içerik de yeni içerik de yok**.
- **Etki:** Kaydetme/otomatik yedek/acil kopya/işaret dosyaları dahil tüm
  kalıcılık yazımları. Antivirüs veya bulut senkronizasyonunun dosyayı kısa
  süre kilitlemesi Windows'ta olağandır.
- **Düzeltme:** `atomic-write.js` — rename N kez denenir; olmazsa eski dosya
  silinmez, `.old-*` adına **taşınır**; yeni dosya yerleştirilemezse doğrudan
  yazılır; o da düşerse eski dosya geri konur ve hata yükseltilir. Ayrıca
  geçici dosya `fsync` edilir (rename öncesi veri diskte).
- **Kanıt:** `tests/atomic-write-test.js` — 13/13. Özellikle "çift arıza"
  senaryosu eski içeriğin korunduğunu doğrular.
- **Durum:** Düzeltildi.

### TR-B01 · P1 · MessagePort zaman aşımı yok

- **Konum:** `src/preload/preload.js` `enginePortTilesImpl`; `src/main/ink-engine-host.js` yorumu.
- **Kök neden:** Promise yalnız `onmessage` ile çözülüyordu. Ana süreçteki
  `core.tileSlice` takılır veya port ölürse istek sonsuza asılı kalır.
- **Etki:** `inkEngineTileSliceRequest` çağıranı (undo karo doldurma) hiç
  sonuçlanmaz; çağrı zinciri kilitlenir, "yedeğe düş" yolu çalışmaz.
- **Düzeltme:** 8 sn `ENGINE_PORT_TIMEOUT_MS`; zaman aşımında istek
  `{ok:false,timeout:true}` ile çözülür, port kapatılır, bekleyenler temizlenir,
  sonraki çağrılar invoke yedeğine gider. `onmessageerror` da portu düşürür.
- **Kanıt:** `tests/preload-engine-port-test.js` — gerçek `preload.js` vm'de
  koşar; yanıt, zaman aşımı ve yedek yolu 14/14.
- **Kalan sınır:** Ana süreçteki **senkron** C++ çağrısı hâlâ iptal edilemez;
  bu düzeltme renderer'ın kilitlenmesini engeller, ana sürecin o çağrıda
  beklemesini değil. `TECHNICAL_DEBT.md`'de açık.
- **Durum:** Düzeltildi.

### TR-B02 · P1 · Dışa aktarmada üzerine yazma yarışı

- **Konum:** `src/main/main.js` `export-image` sessiz klasör yolu.
- **Kök neden:** `while (fs.existsSync(hedef))` ile ad seçilip sonra yazma
  yapılıyordu. İki eşzamanlı aktarım aynı adı seçebilir; ikincisi birincinin
  üzerine yazar.
- **Düzeltme:** `reserveUniqueFile` adı `openSync(...,'wx')` ile atomik
  sahiplenir; çakışan ikinci istek " (1)" varyantına kayar. Yazma düşerse yer
  tutucu silinir.
- **Kanıt:** `tests/atomic-write-test.js` — üç ardışık ad, içerikler korunur,
  sınır aşımı hata verir.
- **Durum:** Düzeltildi.

### TR-B03 / TR-B05 · P1 · Senkron dosya okuma

- **Konum:** `readBoardFile` (`open-tail`, `open-tail-path`), `read-backup`.
- **Kök neden:** `statSync` + `readFileSync`. `.tail` üst sınırı büyük
  olduğundan ana süreç (dolayısıyla tüm pencereler ve watchdog) okuma boyunca
  donuyordu. `read-backup` 1 GB'a kadar okuyordu.
- **Düzeltme:** `fs.promises.stat/readFile`.
- **Kanıt:** `tests/tail-format-test.js` (23/23) ve
  `tests/persistence-safety-test.js` (FULL zincir) aynı kapıyı kullanır; PURE
  zincirde `tail-format-test` yeşil.
- **Durum:** Düzeltildi.

### TR-B04 · P1 · Yedek sağlık denetiminde senkron JSON parse

- **Konum:** `inspectBackup` + `list-backups` + `pickRecoveryBackup` + `recovery-plan`.
- **Kök neden:** 200 MB'a kadar dosya `readFileSync` + `JSON.parse` ile ana
  süreçte işleniyordu; liste en yeni→eski taranırken bu N kez tekrarlanıyor.
  Kurtarma kutusu tam da renderer yanıt vermiyorken açıldığı için donma üstüne
  donma ekliyordu.
- **Düzeltme:** `backup-health.js`:
  - parse `worker_threads` içinde (`eval` kaynak — asar yolu sorunu yok),
  - 15 sn istek zaman aşımı; takılan worker bırakılır, yedek "sağlıksız" olur,
  - sınırlı önbellek (256 kayıt),
  - tüm IPC handler'ları async, sıralı denetim (bellek şişmesi yok),
  - `reason` artık dil-bağımsız kod (`too-large`, `too-many-items`, `corrupt`,
    `timeout`, `missing`), Türkçe metin üretmiyor; sayaç `workspace` ile
    legacy `state` arasından büyüğünü alır, boş `workspace` sınırı gizleyemez.
- **Kanıt:** `tests/backup-health-test.js` 12/12 (gerçek worker, bozuk JSON,
  sınırlar, zaman aşımı). PURE zincirde `verify-package` + `persistence` yolu
  etkilenmedi.
- **Durum:** Düzeltildi.

### TR-B06 / TR-B07 · P1 · Çoklu dil kaynaklı sayı/etiket hataları

- **Konum:** `core/04-persistence-view.js` `itemLabel`, `core/48-shell.js`
  `psBoardCount` / `psBoardSelection`.
- **Kök neden:** Türkçe ek soyma (`"3 öğe"` → `öğe`) ve tekil/çoğul ayrımının
  yok sayılması; diğer dillerde yanlış etiket.
- **Düzeltme:** `tPlural('item'|'image'|'text'|'brush'|'step', n)`;
  `String(state.items.length)`.
- **Kanıt:** `tests/locale-data-test.js` çoğul anahtarlarını doğrular (20/20);
  UI metinleri kaynak taramasında doğrulandı.
- **Durum:** Düzeltildi (önceki tur).

### TR-S01 · P1 · IPC gönderen doğrulaması (savunma derinliği)

- **Eski durum:** `src/main/*.js` — 82 `ipcMain.handle/on`, 17 `event.sender` kontrolü.
- **Düzeltme:** `src/main/ipc-guard.js`; tüm kanallar kayıtlı pencere + canlı
  `webContents` + üst düzey `senderFrame` + uygulama origin'i + panel allowlist
  doğrulamasından geçer. `handle` `E_IPC_UNTRUSTED` ile reddeder, `on` düşürür.
  Ana pencere/panel kaydı oluşturma ve kapanışta yapılır.
- **Kanıt:** `tests/ipc-guard-test.js` 22/22; `tests/ipc-sender-gate-test.js`
  27/27 (kaynaktan 82 kanal ve panel-preload eşleşmesi);
  `tests/panel-window-test.js` 31/31; `tests/desktop-smoke.js` 20/20;
  tam zincir 85/85.
- **Kalan risk:** Ana pencerenin kendi origin'i güvenilirdir; ana renderer'da
  kod çalıştırma zinciri kırılırsa o pencerenin kanalları açıktır. CSP +
  sandbox + dar preload bu zinciri kapalı tutar.
- **Durum:** Düzeltildi.

### TR-S02 · P1 · Kod imzalama yok

- Paketleme logu: `no code signing certificate configured, signing is skipped`.
- Etki: SmartScreen uyarısı, güncelleme indirmelerinde işletim sistemi düzeyinde
  yayıncı doğrulaması yok (electron-updater sha512 kullanır, ancak ikili imzası
  yok). README'de checksum rehberi var.
- **SignPath:** GPL-3.0-or-later uygunluğu nedeniyle ücretsiz foundation yolu
  seçildi; `docs/CODE_SIGNING.md` (politika, roller, gizlilik) ve
  `docs/SIGNPATH_APPLICATION.md` (uygunluk tablosu, form yanıtları, kalan
  adımlar) hazır. Kalan: yayınlanmış 1.4.3, maintainer e-postası/MFA ve
  SignPath hesabı.
- **Durum:** Açık (dağıtım/altyapı; kod düzeltmesi değil).

### TR-U01 · P2 · Karışık dil

- Yapılan: yüzlerce hardcoded metin `__t`/`tPlural` ile sarıldı, `tr.json`
  1671 anahtar, İngilizce varsayılan.
- 24 Kasım 2026: kalan 275 anahtar (tema stüdyosu, arayüz paketleri, güncelleme
  paneli, katman uyarıları, board/katman/geçmiş/fırça kütüphanesi metinleri)
  sekiz dile de gerçek çeviriyle eklendi. Her dilde 1671 anahtar; yer tutucular
  kaynakla birebir, boş değer ve U+FFFD yok.
- `locale-data-test` ratchet'i `MAX_UNTRANSLATED = 0`'a indirildi; kapsam
  eşitliği assert'i 8 dilde 0 eksik doğruluyor.
- **Durum:** Kapandı.

### TR-U02 / TR-U03 · P2 · Dokümantasyon tutarsızlığı

- README 20/74, ARCHITECTURE 14/69, ROADMAP 69; gerçek 30/85.
- `scripts/run-gates.js` başlığı `build-app --check` diyordu ama zincirde yoktu.
- Düzeltme: sayılar güncellendi; `tests/gate-docs-test.js` sayıları
  `run-gates.js` listelerinden türetip belgelerle karşılaştırıyor;
  `tests/build-app-test.js` gerçek `build-app --check`'i koşuyor.
- **Durum:** Düzeltildi.

---

### TR-U06 · P2 · Paket doğrulaması yerel bağımlılıkları atlıyordu

- **Konum:** `scripts/verify-package.js` `FILES` listesi.
- **Kök neden:** Yalnız 10 sabit dosya karşılaştırılıyordu. `src/main/main.js`
  ise 15'ten fazla yerel modül `require` ediyordu. Pakete girmeyen bir yardımcı modül
  (ör. bu turda eklenen `atomic-write.js`) doğrulamadan geçerdi; uygulama
  açılışta `Cannot find module` ile çökerdi. Bu, "PAKET GÜNCEL" raporuna
  güvenmeyi riskli kılan gerçek bir boşluktu.
- **Düzeltme:** `localRequires()` ile `require('./x')` grafiği kapatılır; her
  hedef arşivde bayt-bayt aynı olmak zorunda. Doğrulama 10 → 22 dosya.
- **Kanıt:** `node scripts/verify-package.js` — 22 dosya OK, `PAKET GÜNCEL`.
- **Durum:** Düzeltildi.

### TR-U07 · P1 · `tPlural` IIFE kapsamı regresyonu (bu turda bulundu ve kapatıldı)

- **Kaynak:** yerelleştirme geçişinde 04/06/20/44/48/52 dosyalarında çıplak
  `tPlural(...)` çağrıları bırakıldı.
- **Etki:** `tPlural` 01b-l10n.js IIFE'sinin içinde; dışarıdan erişilemez.
  Uygulama açılışta `setItemCountLabel()` çağırınca
  `ReferenceError: tPlural is not defined` — öğe sayacı/ilk render çökerdi.
- **Nasıl yakalandı:** `compositor-test.js` (gerçek Electron + CDP) iki kez
  kırmızı; PURE zinciri bunu göremez.
- **Düzeltme:** `window.__tp` köprüsü + 10 çağrı; `locale-data-test` artık
  çıplak `tPlural(` çağrısını yasaklıyor.
- **Durum:** Düzeltildi; regresyon kapısı eklendi.

---

## 5. Doğrulanan güvenlik duruşu (özet)

| Kontrol | Durum | Kanıt |
|---|---|---|
| `nodeIntegration` kapalı, `contextIsolation` açık, `sandbox` açık | ✅ | `main.js` BrowserWindow; `security-static-test.js` |
| CSP (`default-src 'self'`, `object-src 'none'`, `script-src 'self'`) | ✅ | `src/renderer/index.html` |
| `.tail` yolu: mutlak/yerel/uzantı kontrolü, UNC/aygıt reddi | ✅ | `path-policy.js`, `tests/path-policy-test.js` |
| Dışa aktarma klasörü allowlist'i | ✅ | `main.js` `isAllowedExportDir`, `tests/export-dialog-test.js` |
| Konuk panel navigasyon/pencere engelleri | ✅ | `guest-guards.js`, `security-static-test.js` |
| Arayüz paketi CSS doğrulayıcı (whitelist, `url(`/`@import` reddi) | ✅ | `02d-ui-package-format.js`, `tests/ui-package-validate.js` |
| Güncelleme: imzasız ikili (kabul edilen risk — bütçe) | ⚠️ | Paketleme logu; `SHA256SUMS.txt` + `update-*` kapıları; SignPath başvuru paketi |
| IPC gönderen doğrulaması (tüm kanallar) | ✅ | `src/main/ipc-guard.js`; 82/82 kanal; `ipc-guard-test` 22/22 + `ipc-sender-gate-test` 27/27 |

---

## 6. Performans (özet)

- Bu turda **yeni profiler koşulmadı**; brush/canvas için sayısal iddia
  üretilmedi. Yapılanlar: ana süreçteki senkron I/O ve parse'ın kaldırılması;
  bunlar UI donmasını doğrudan hedefleyen yapısal düzeltmeler.
- Ayrıntı ve ölçüm planı: `PERFORMANCE_REPORT.md`.

---

## 7. Nihai karar

**CONDITIONALLY READY (Windows için beta).**

Gerekçe:

- P0 veri kaybı yolu kapatıldı ve regresyon testiyle sabitlendi.
- P1 asenkron/yarış/zaman aşımı sınıfı hatalar düzeltildi; IPC gönderen
  doğrulaması 82/82 kanalda kapandı; PURE kapı zinciri ve paket doğrulaması
  yeşil.
- Ancak: kod imzalama yok (SignPath başvurusu hazır), tablet donanımı ve
  macOS/Linux bu ortamda test edilmedi, Magic Wand ve `.abr` dinamikleri eksik.

**Üretim (production) için koşullar:** SignPath onayı + imzalı güncelleme,
gerçek tablet donanımında regresyon turu, Linux paketlerinin gerçek dağıtımda
duman testi. (Çeviri açığı 24 Kasım 2026'da kapandı.)
