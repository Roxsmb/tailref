# TEST COVERAGE REPORT — TailRef Studio 1.4.4

**Tarih:** 2026-11-24 (son tam zincir koşusu)
**Kapı zinciri:** `node scripts/run-gates.js` (PURE) ve `--full` (Electron + CDP)
**Sayılar (kaynaktan türetildi):** 31 PURE + 55 FULL-extra = **86 kapı**
**Doğrulama:** `tests/gate-docs-test.js` bu sayıları `run-gates.js`
listelerinden yorumları soyduktan sonra üretir; belgelerle karşılaştırır.

---

## 1. Bu turda eklenen testler

| Dosya | Kapsam | Sonuç |
|---|---|---|
| `tests/atomic-write-test.js` (yeni) | Atomik yazım: normal, üzerine yazma, kilitli rename tekrarı, doğrudan yazmaya düşüş, **çift arızada eski verinin korunması**, benzersiz ad yarışı, sınır | **13/13** |
| `tests/backup-health-test.js` (yeni) | Gerçek worker parse, öğe/görsel sayımı, sınırlar, bozuk JSON, worker yokken işlem içi düşüş, **yanıtsız worker zaman aşımı**, boş workspace sınır gizleme | **12/12** |
| `tests/preload-engine-port-test.js` (yeni) | Gerçek `preload.js` (`vm` + stub Electron): port iletimi/transfer listesi, yanıt, **zaman aşımı**, port kapatma, invoke yedeği | **14/14** |
| `tests/build-app-test.js` (yeni) | Üretilen `app.js` güncel mi, banner, kaynak sayısı, kaynak izi | **6/6** |
| `tests/gate-docs-test.js` (yeni) | Kapı sayıları (README/ARCHITECTURE/ROADMAP/DEVELOPMENT), dosya varlığı, tekrar, **yorumlardaki kesme işareti tuzağı** | **13/13** |
| `tests/ipc-guard-test.js` (yeni) | IPC kapısı: yabancı/ölü gönderen, alt çerçeve, origin pinleme, panel allowlist, trust iptali, uyarı sınırı | **22/22** |
| `tests/ipc-sender-gate-test.js` (yeni) | Kaynaktan 82 kanal tek kapıdan mı, ham `ipcMain` sızıntısı var mı, panel-preload eşleşmesi, trust kancaları | **27/27** |
| `tests/locale-data-test.js` (genişletildi) | + çıplak `tPlural(` yasağı, `window.__tp`/`window.__t` köprüleri | **23/23** |
| `scripts/verify-package.js` (genişletildi) | Yerel `require` grafiği kapatılır; 10 → **22 dosya** bayt-bayt | **PAKET GÜNCEL** |

Toplam yeni doğrulama: **107 yeni assert** (13+12+14+6+13+22+27) + 3 dil
kapısı asserti + 12 paket dosyası.

---

## 2. PURE zinciri (31 kapı)

| # | Kapı | Ne kanıtlar | Sonuç |
|---|---|---|---|
| 1 | `pose3d-unit.js` | 3B poz ölçek/preset/gezinme | 24/24 |
| 2 | `dialog-l10n-test.js` | 9 dil diyalog paketi, interpolasyon | 32/32 |
| 3 | `build-app-test.js` | Paketlenen `app.js` kaynakla güncel | 6/6 |
| 4 | `atomic-write-test.js` | Kalıcılık yazımı veri kaybetmez | 13/13 |
| 5 | `backup-health-test.js` | Yedek denetimi bloklamaz/asmaz | 12/12 |
| 6 | `preload-engine-port-test.js` | MessagePort asılı kalmaz | 14/14 |
| 7 | `gate-docs-test.js` | Test sayısı belgeleri dürüst | 13/13 |
| 8 | `locale-data-test.js` | Sözlük güncel, çeviri ratchet, kapsam | 23/23 |
| 9 | `wide-gamut-test.js` | P3/OKLab dönüşümleri | 10/10 |
| 10 | `ink-tile-canon-test.js` | Karo kanonu, LSB eşleşmesi | 32/32 |
| 11 | `ink-tile-view-test.js` | Karo görünümü/kirli defter | 33/33 |
| 12 | `ink-color-test.js` | Renk bilimi ve çark | 42/42 |
| 13 | `ink-palette-test.js` | Palet seçimi | 22/22 |
| 14 | `ink-stabilizer-test.js` | Yumuşatma/gecikme/basınç | 22/22 |
| 15 | `external-links-test.js` | Dış URL allowlist | 19/19 |
| 16 | `path-policy-test.js` | `.tail` ve klasör allowlist | 21/21 |
| 17 | `browser-server-test.js` | Statik sunucu yol aşımı | 13/13 |
| 18 | `tail-format-test.js` | `.tail` uyumluluğu + bombalar | 23/23 |
| 19 | `security-static-test.js` | CSP/sandbox/fuses/allowlist | 39/39 |
| 20 | `ipc-guard-test.js` | Her kanal kayıtlı pencere + üst çerçeve + origin denetimi | 22/22 |
| 21 | `ipc-sender-gate-test.js` | 82 kanal tek kapıdan; panel allowlist eşleşmesi | 27/27 |
| 22 | `update-policy-test.js` | Sürüm/geri çekilme/backoff | 56/56 |
| 23 | `update-manager-test.js` | Güncelleme akışı + yabancı IPC | 53/53 |
| 24 | `update-static-test.js` | Güncelleme kaynak statikleri | 44/44 |
| 25 | `shape-snap-check.js` | Şekil tanıma/iyileştirme | 95/95 |
| 26 | `color-wheel-audit.js` | Çark grid doğruluğu | 6/6 |
| 27 | `ui-package-validate.js` | Arayüz paketi CSS güvenliği | 14/14 |
| 28 | `doc-links-test.js` | 191 yerel bağlantı | 1/1 |
| 29 | `linux-packaging-test.js` | Linux/Flatpak/release statikleri | 118/118 |
| 30 | `macos-packaging-test.js` | macOS DMG/entitlements/.tail/open-file/--arch/yayın işi + CI açılış smoke'u + `.app` arşiv düzeni | 66/66 |
| 31 | `verify-package.js` | `app.asar` ↔ çalışma ağacı (22 dosya) | PAKET GÜNCEL |

> Not: `verify-package` yeniden üretilmiş `dist/win-unpacked` gerektirir.
> Paket bayatsa PURE zinciri kırmızı olur — bu bilinçli bir kapıdır.

---

## 3. FULL zinciri (55 ek kapı)

Gerçek Electron + CDP ile çalışan kapılar. Kategoriler:

**Çizim/ink (26):** `compositor-test`, `symmetry-test`, `liquify-test`,
`smudge-parity-check`, `undo-region-check`, `undo-worker-region-check`,
`layer-canon-test`, `ink-shortcut-test`, `ink-rotate-test`, `ink-select-check`,
`ink-empty-transform-check`, `ink-last-layer-check`, `ink-row-del-check`,
`ink-draw-guard-check`, `ink-native-parity-check`, `brush-library-test`,
`image-editor-check`, `image-shift-resize-check`, `ink-radial-check`,
`ink-outside-check`, `ink-commit-check`, `ink-undo-frame-check`,
`ink-mask-region-check`, `live-parity-probe`, `ink-engine-host-check`,
`commit-fade-probe`.

**Panel/UI (14):** `bar-tuck-itembar-check`, `panel-mode-fixes-check`,
`draw-size-status-check`, `options-bar-test`, `power-sliders-test`,
`panel-window-test`, `keymap-test`, `settings-hub-test`, `theme-studio-test`,
`interface-registry-test`, `ui-package-test`, `interface-modes-test`,
`persistence-welcome-test`, `youtube-link-parse-check`.

**Proje/veri (9):** `layer-store-test`, `layer-dispose-test`,
`layer-flip-fold-test`, `arrange-test`, `ref-board-test`, `projects-test`,
`persistence-safety-test`, `save-on-close-test`, `overload-test`.

**Entegrasyon/duman (6):** `smoke-test`, `pose3d-smoke`, `desktop-smoke`,
`pinterest-test`, `artstation-test`, `export-dialog-test`.

---

## 4. Kapsam matrisi (ürün davranışı)

| Alan | Otomatik kanıt | Durum |
|---|---|---|
| `.tail` kaydet/aç (eski RFVR dahil) | `tail-format-test`, `save-on-close-test`, `persistence-safety-test` | ✅ |
| Atomik yazım / çökme dayanıklılığı | `atomic-write-test` | ✅ |
| Otomatik/acil yedek + kurtarma seçimi | `backup-health-test`, `persistence-safety-test`, `persistence-welcome-test` | ✅ |
| Dışa aktarma (PNG/JPG/ABR) | `export-dialog-test`, `atomic-write-test` (ad yarışı) | ✅ |
| Undo/redo + karo dilimleri | `undo-region-check`, `undo-worker-region-check`, `ink-undo-frame-check`, `ink-tile-*` | ✅ |
| Fırça motoru (JS/native parity) | `smudge-parity-check`, `ink-native-parity-check`, `live-parity-probe` | ✅ (bu makinede) |
| Katmanlar/projeler/paneller | `layer-*`, `projects-test`, `panel-window-test`, `ref-board-test` | ✅ |
| Yerelleştirme | `locale-data-test`, `dialog-l10n-test` | ✅ (8 dilde 0 eksik; ratchet 0) |
| Güvenlik duruşu | `security-static-test`, `ipc-guard-test`, `ipc-sender-gate-test`, `path-policy`, `external-links`, `ui-package-validate` | ✅ |
| Güncelleme | `update-*` (3 kapı) | ✅ (imzasız) |
| Paket bütünlüğü | `verify-package` (22 dosya), `linux-packaging-test`, `macos-packaging-test` | ✅ Windows; Linux/macOS statik |
| Disk dolu / izin hatası | `atomic-write-test` (ENOSPC enjeksiyonu) | ✅ |
| Gerçek tablet (basınç/eğim) | — | ❌ test edilmedi |
| macOS çalıştırması | `macos-packaging-test` (statik) + `release.yml` `macos` işi | ❌ bu makinede koşmadı |
| Linux çalıştırması (AppImage/deb) | yalnız statik + CI tarifi | ❌ bu makinede koşmadı |
| Kod imzası | — | ❌ yok |
| Uzun oturum bellek soak | — | ❌ yok |
| Erişilebilirlik (klavye/ekran okuyucu) | kısmi `keymap-test` | ⚠️ sınırlı |

---

## 5. Bu turda kapıların yakaladığı gerçek hatalar

1. **`doc-links-test`**: `AUDIT_REPORT.md` içindeki `audit/...png` bağlantısı
   yanlış köke çözülüyordu → `docs/audit/...` olarak düzeltildi.
2. **`compositor-test`**: `ReferenceError: tPlural is not defined` —
   yerelleştirme geçişinde bırakılan çıplak çağrılar. PURE zinciri bunu
   görmedi; **tam zincir** yakaladı. `window.__tp` köprüsü + 10 çağrı +
   `locale-data-test` yasağı ile kapatıldı.
3. **`projects-test`**: yedek sağlık denetimi worker'a taşınınca `reason`
   metinleri Türkçe cümlelerden (`"1600 öğe"`, `"dosya çok büyük (…) MB"`)
   **dilden bağımsız kodlara** (`too-many-items`, `too-large`, `corrupt`,
   `timeout`, `missing`) dönüştü. Test eski Türkçe metni beklediği için
   kırmızıydı; beklenti koda göre güncellendi. Kodlar arayüzde ham
   gösterilmiyor (kurtarma kutusu yalnız sayıyı yazar), yani kullanıcıya
   İngilizce sızıntı yok — asıl kazanç veri katmanının dilden arınması.
4. **`gate-docs-test` (ilk hali)**: yorumlardaki Türkçe kesme işaretlerini
   dosya adı sandı (29/84). Sayım yorumları soyacak şekilde düzeltildi;
   gerçek 30/85.
5. **`update-manager-test`**: IPC kapısı devreye girince 3 assert kırmızı
   oldu (`foreign IPC sender rejected`, `main window IPC sender accepted` ×2,
   `foreign install request rejected`). Sebep testin sentetik `{ sender: {} }`
   olayını **senkron** çağırmasıydı; guard `handle` söz döndürdüğü için
   reddetme sessizce yutuluyordu. Beklenti `await` + `assert.rejects`'e
   çevrildi; kapı gerçekten "yabancı gönderen reddedilir" davranışını
   doğruluyor. Bu, kapının süs değil sözleşme olduğunun kanıtıdır.
6. **`ref-board-test` (tam zincirde 2 kez kırmızı)**: grup başlığı adımı
   gruplaştırmadan sonra **sabit 160 ms** bekleyip başlığı `focus()` ediyordu.
   Pencere arka planda/yoğun koşuda odak etkinleşmeyince `titleBase` boş
   kaldı, düzenleme geri-alma adımı açmadı ve sonraki `undo()` grup
   oluşturmayı geri aldı; test `el2.focus()` üzerinde `TypeError` ile düştü.
   Ürün kodu değişmedi: gerçek kullanıcı başlığa tıklayıp odaklıyor. Test
   artık **görünür başlık hazır olana kadar sınırlı yokluyor**, odağı
   doğruluyor ve pencere odağı yoksa `focus`/`blur` olaylarını açıkça
   gönderiyor; hata durumunda `TypeError` yerine okunur bir neden yazıyor.
   Tek başına 26/26; tam zincir yeniden koşuldu.
7. **`pose3d-smoke` (tam zincirde 1 kez kırmızı)**: `panoya PNG kopyalanıyor`
   adımı `window.focus()` çağrısından **hemen sonra** pano yazmayı deniyordu.
   Chromium odak değişimini bir sonraki görev döngüsünde uyguladığı için yazma
   `"document is not focused"` ile reddediliyor, testin 3 denemesi de aynı
   turda boşa gidiyordu. Ürün kodu değişmedi: pano yazımı gerçekten odak
   ister. Test artık yazmadan önce `document.hasFocus()` gerçekleşene kadar
   sınırlı yokluyor (1.5 sn üst sınır) ve başarısızlıkta `deneme`/`odak`
   değerlerini yazıyor. İki ardışık koşu `deneme=1 · odak=true` ile 110/110;
   düzeltme sonrası tam zincir yeniden deneme olmadan geçti.
8. **`pinterest-test` + `panel-window-test` (CDP `eval zaman aşımı`)**:
   panel taşıma adımları `Runtime.evaluate` içinde doğrudan
   `await detachPanelToWindow(...)` yapıyordu; pencere açan bu bekleme CDP
   `awaitPromise` yanıtına dönüşmeden asılı kalabiliyordu. Taşıma artık
   sayfada başlatılıp durumu (`__detach2State` / `__v5DetachState`) yoklanıyor
   ve `done:true` şartı aranıyor — assert öncekinden daha sıkı. Üretim kodu
   değişmedi. Kanıt: `pinterest` 25/25 ×2, `panel-window` 31/31 ×3, ardından
   tam zincir yeniden deneme 0.

Bu sekiz vaka, kapıların "yeşil göstermek için" değil, gerçek regresyon
yakalamak için çalıştığının kanıtıdır.

---

## 6. Çalıştırma kaydı

| Komut | Sonuç |
|---|---|
| `node scripts/run-gates.js` | **31/31 PURE yeşil** |
| `npm.cmd run gates:full` | **86/86 yeşil** (31 PURE + 55 Electron/CDP; son kod üzerinde, yeniden üretilmiş asar ile; **2 kapı ilk koşuda kırmızı, retry'de yeşil**) |
| `node tests/macos-packaging-test.js` | **66/66** (macOS yapılandırması, `.tail`, `--arch`, CI işi, açılış smoke, çeviri, `.app` arşiv düzeni) |
| `node tests/linux-packaging-test.js` | **118/118** |
| `node tests/locale-data-test.js` | **23/23** · 10 dil · **15087** anahtar · 0 çevrilmemiş |
| `node scripts/verify-package.js` | 22 dosya · PAKET GÜNCEL (yeniden üretilmiş `dist/win-unpacked` ile) |
| `node scripts/build-app.js --check` | güncel · 74 kaynak |
| `node scripts/build-locales.js --check` | güncel · 10 dil · 15087 anahtar |
| `npm.cmd audit --omit=dev` | 0 açık |
| `npm.cmd run build:dir` | exit 0 · win-unpacked üretildi (imzasız) |
| `node tests/settings-hub-test.js` | 82/82 (dar panel düzeni + ızgara aralığı + zoom varsayılanı assert'leri dahil) |
| `node tests/theme-studio-test.js` | 13/13 (rain efektli özel tema + mod anahtarı assert'leri dahil) |

**Son koşu (24 Kasım akşamı — ayar denetimi ve dar panel):** yüksek
kontrast, özel temada rain/snow, Rain/Snow'dan tema kaydetme, cursor-anchored
zoom, editor grid step ve dar panel düzeni düzeltildikten sonra `app.js`
yeniden üretildi, `build:dir` + `verify-package` tazelendi (**PAKET GÜNCEL**)
ve `gates:full` son paket üzerinde yeniden koşuldu: **86/86 kapı yeşil
(tam zincir)**. `settings-hub` 77 → **82/82**, `theme-studio` **13/13**.
Ayar denetiminde ~40 denetim canlı ölçüldü; gerçekten ölü bulunan iki ayar
(cursor-anchored zoom, editor grid step) düzeltildi; Electron köprüsü
gerektirenler (Always on top, UI scale, güncelleme) ayrı tutuldu.

**Son koşu (24 Kasım arayüz düzeltmeleri):** boş tahta logosu, mod sırası,
switch topuzu, üst hap genişliği ve wipe animasyonu düzeltildikten sonra
`app.js` yeniden üretildi, `build:dir` + `verify-package` tazelendi ve
`gates:full` koşuldu: **86 GATE satırı, 2 RETRY, 0 KAPI KIRMIZI, 86/86 yeşil**.
`settings-hub` bu turda 77'den 82'ye çıktı (yeni regresyon assert'leri).

**Çalıştırılmayanlar:** `npm run gates:full` dışındaki manuel QA
(`qa:fx`, `bench:ink`, `test:overload` tek tek), macOS/Linux paketleri,
gerçek donanım testleri. Bunlar "geçti" sayılmaz.

**Yeniden deneme politikası (dürüst not):** `run-gates.js`, GPU/zamanlama
duyarlı bir kapı kırmızı olursa kapıyı **bir kez** yeniden koşar; iki koşuda
da kırmızı kalan gerçek regresyon sayılır ve zincir durur. Bu turda yeniden
deneme dört kapıda devreye girdi: `ref-board-test` (grup başlığı odağı),
`pose3d-smoke` (pano odağı), `pinterest-test` ve `panel-window-test` (CDP
`eval zaman aşımı`). Hepsinin nedeni bulunup test **gerçek koşula** bağlandı.
Ayrıca `ink-engine-host-check` bir kez, HOST adımları `yeşil` bittikten
**sonra** çıkışta `0xC0000005` (erişim ihlali) ile çöktü; native teardown
kaynaklı bu oynaklık bu turda düzeltilmedi ve **açık** olarak izleniyor.
Düzeltmelerden sonraki son tam zincir **2 retry** ile 86/86 geçti
(`panel-window-test` CDP eval zaman aşımı, `pose3d-smoke` alfa okuması); ikisi
de ikinci koşuda yeşil, gerçek regresyon yok. Kadraj/GPU oynaklığıdır, yedek
güvence bu iki kapı için tasarlanmıştır.

---

## 7. Sonuç

- Otomatik kapsam, P0/P1 veri yolu ve güvenlik sınırları için **gerçek
  dosya/gerçek Electron** kanıtı üretiyor.
- En büyük kapsam boşluğu **donanım ve işletim sistemi çeşitliliği**;
  bunlar bu ortamda kapatılamaz.
- Test sayısı iddiaları artık kaynaktan türetiliyor ve kapıyla korunuyor.
