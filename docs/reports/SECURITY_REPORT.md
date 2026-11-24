# SECURITY REPORT — TailRef Studio 1.4.4

**Tarih:** 2026-11-23 · **Son doğrulama:** 2026-11-24 (tam zincir 86/86)
**Kapsam:** Electron ana süreç, preload köprüsü, renderer CSP, webview
konukları, dosya yolu politikaları, güncelleme akışı, paketleme/fuses,
bağımlılıklar.
**Yöntem:** kaynak incelemesi + statik kapılar + `npm audit` + paket logu.
**Yapılmayanlar:** sızma testi, fuzzing, bağımlılık derin taraması (SCA),
kod imzası doğrulaması, macOS/Linux güvenlik testi.

---

## 1. Doğrulanan kontroller

| Kontrol | Durum | Kanıt |
|---|---|---|
| `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` | ✅ | `src/main/main.js`; `tests/security-static-test.js` (39/39) |
| Ana pencere CSP: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'none'` | ✅ | `src/renderer/index.html:7` |
| Panel ve splash CSP | ✅ | `panel.html`, `splash.html`; aynı kapı |
| `unsafe-eval` yok | ✅ | aynı kapı |
| Preload yalnız `contextBridge` kullanır, doğrudan Node modülü açmaz | ✅ | `src/preload/preload.js`; aynı kapı |
| Webview bağlanma kancası (`will-attach-webview`), konuk preload allowlist | ✅ | `src/main/guest-guards.js`; aynı kapı |
| Konuk panellerde `window.tailref` köprüsü yok | ✅ (kod incelemesi) | ayrı preload |
| `.tail` yolu: mutlak, yerel, `.tail` uzantısı; UNC/aygıt/göreli red | ✅ | `src/main/path-policy.js`; `tests/path-policy-test.js` (21/21) |
| Dışa aktarma klasörü allowlist'i | ✅ | `main.js` `isAllowedExportDir`; `security-static-test` |
| Dış bağlantı allowlist'i (https + YouTube/BuyMeACoffee) | ✅ | `src/main/external-links.js`; `tests/external-links-test.js` (19/19) |
| Yedek dosya adı yol aşımına kapalı (`path.basename` + `.json`) | ✅ | `main.js` `backupPath` |
| `.tail` çözücü sınırları: imza, sürüm, dosya boyutu, açılmış JSON (gzip bombası) | ✅ | `src/main/tail-format.js`; `tests/tail-format-test.js` (23/23) |
| Statik sunucu: kök dışına çıkma, gizli dosya, `node_modules`, null bayt | ✅ | `tests/browser-server-test.js` (13/13) |
| Arayüz paketi CSS doğrulayıcı (whitelist, `url(`, `@import`, kaçış) | ✅ | `tests/ui-package-validate.js` (14/14) |
| ASAR paketleme + fuses (runAsNode/NODE_OPTIONS/inspect kapalı, yalnız asar, çerez şifreleme) | ✅ | `security-static-test` |
| Güncelleme: feed GitHub'a sabit, `autoDownload` kapalı, downgrade kapalı, kurulum el sıkışması + gönderen denetimi | ✅ | `tests/update-manager-test.js` (53/53) |
| IPC gönderen doğrulaması: 82 kanal tek kapıdan, üst çerçeve + origin + panel allowlist | ✅ | `src/main/ipc-guard.js`; `tests/ipc-guard-test.js` (22/22), `tests/ipc-sender-gate-test.js` (27/27) |
| Üretim bağımlılıklarında bilinen açık | ✅ 0 | `npm audit --omit=dev` → `{low:0, moderate:0, high:0, critical:0}` |
| Telemetri/analytics | ✅ yok | `src/` içinde sentry/posthog/analytics/telemetry eşleşmesi yok |

---

## 2. Açık bulgular

### SEC-01 · P1 · IPC gönderen doğrulaması — **Kapatıldı**

- **Eski durum:** `src/main/*.js` içinde **82** `ipcMain.handle/on`; `event.sender`
  / `senderFrame` referansı **17**. Dağılım: `panel-window-manager` 11/11,
  `update-manager` 1/7, `ink-engine-host` 1/5, `main.js` 4/50,
  `pinterest` 0/5, `artstation` 0/4.
- **Düzeltme:** `src/main/ipc-guard.js` tüm kanalları tek doğrulama noktasından
  geçirir. Sırasıyla: kayıtlı pencere (ana veya panel), canlı `webContents`,
  üst düzey `senderFrame` (iframe reddi), uygulama origin'i ve panel kanalı
  allowlist'i. `handle` reddedilmiş söz döndürür (`E_IPC_UNTRUSTED`), `on`
  mesajı düşürür; kanal başına uyarı 3 ile sınırlıdır.
- **Kapsam:** 6 modüldeki 82 kanalın tamamı `ipcGuard.handle/on` üzerinden
  kaydedilir; ana pencere `trustMain`, ayrı paneller `trustPanel` ile
  kaydedilir ve kapanışta geri alınır. Konuk `<webview>` preload'ları yalnız
  `sendToHost` kullanır; doğrudan `ipcMain` erişimleri yoktur.
- **Kanıt:** `tests/ipc-guard-test.js` 22/22 (yabancı/ölü gönderen, alt
  çerçeve, yabancı origin, panel allowlist, trust iptali, uyarı sınırı);
  `tests/ipc-sender-gate-test.js` 27/27 (kaynaktan 82 kanal, panel-preload
  eşleşmesi, trust kancaları); `tests/panel-window-test.js` 31/31;
  `tests/desktop-smoke.js` 20/20; tam zincir 86/86 (2 retry).
- **Kalan risk:** Doğrulama, ana pencerenin kendi origin'ini güvenilir kabul
  eder. Ana renderer'da kod çalıştırma zinciri kırılırsa o pencereye ait
  kanallar açıktır. CSP `script-src 'self'`, sandbox ve dar preload bu zinciri
  kapalı tutar; bu bulgu savunma derinliğiydi ve kapatıldı.

### SEC-02 · P1 · Kod imzalama yok (başvuru hazır)

- **Kanıt:** paketleme logu — `no code signing certificate configured,
  signing is skipped`.
- **Etki:** SmartScreen uyarısı; ikili dosyanın yayıncıya aidiyeti işletim
  sistemi düzeyinde doğrulanmaz. `electron-updater` sha512 bütünlüğü sağlar,
  ancak indirilen kurulumun imzası yoktur. README checksum rehberi manuel
  doğrulama sunar.
- **Durum:** Açık (altyapı/dağıtım; kod düzeltmesi değil). Ücretli sertifika
  bütçe dışı; GPL-3.0-or-later uygunluğu nedeniyle **SignPath Foundation**
  ücretsiz programına başvuru paketi hazırlandı: `docs/CODE_SIGNING.md` ve
  `docs/SIGNPATH_APPLICATION.md`. Kalan ön koşullar: maintainer e-postası/MFA
  onayı ve SignPath hesabı (v1.4.4 yayınlandı, 2026-11-24).

### SEC-03 · P2 · Worker `eval` kaynağı

- `src/main/backup-health.js` worker'ı `eval: true` ile üretir. Kaynak
  uygulama kodundan gelir, dış girdi içermez; asar içinde ayrı dosya yolu
  sorununu önler. Yine de `eval` kullanımı statik analiz araçlarını
  zorlaştırır. Öneri: ayrı `backup-health-worker.js` dosyasına taşı ve
  `asarUnpack` gerekmiyorsa normal `Worker(filename)` kullan.

### SEC-04 · P2 · Güncelleme kanalı yalnız Windows

- `update-manager` Windows dışında devre dışı; Linux'ta güncelleme paket
  yöneticisine bırakılır. Bu bir güvenlik açığı değil, ancak Linux
  kullanıcıları otomatik güvenlik güncellemesi almaz. Belgelerde açık.

### SEC-05 · P3 · Yedek/worker hata kodları

- `reason` kodları (`corrupt`, `timeout`, `too-many-items`, …) dilden
  bağımsızdır ve **arayüzde ham metin olarak gösterilmez**; kurtarma kutusu
  yalnız öğe/görsel sayısını yazar. Kodlar IPC yükünde kalır. Herhangi bir
  dosya yolu veya ham hata mesajı renderer'a dönmez (worker hata kodu döndürür).
- `read-backup` hata durumunda `null` döner; istisna metni sızmaz.

---

## 3. Tehdit modeli (kısa)

| Varlık | Tehdit | Mevcut kontrol | Kalan risk |
|---|---|---|---|
| Ana pencere | Uzak içerik → kod çalıştırma | CSP, sandbox, IPC guard (kayıtlı pencere + origin) | Düşük |
| Preload köprüsü | Aşırı yetkili API | Dar, isimli fonksiyonlar | Düşük |
| Konuk paneller | Keyfi gezinme / IPC | Ayrı preload, navigasyon kancası, allowlist; `ipcMain` erişimi yok | Düşük |
| Dosya sistemi | Yol aşımı / keyfi yazma | `path-policy`, allowlist, `basename` | Düşük |
| `.tail` dosyası | Kötü niyetli dosya (bomba/bozuk) | İmza, sürüm, boyut, açılmış JSON sınırı | Düşük |
| Güncelleme | Sahte ikili | HTTPS + sha512 + GitHub feed | **Orta** (imza yok) |
| Tedarik zinciri | Kötü niyetli paket | `npm audit` 0, kilit dosyası | Orta (SCA yok) |

---

## 4. Öneriler (öncelik sırasıyla)

1. **Kod imzalama** (Windows Authenticode + installer) ve imzalı güncelleme:
   SignPath Foundation başvurusu hazır; yayın ve onay bekliyor.
2. CI'da `npm audit` / SCA ve bağımlılık güncelleme politikası.
3. Worker `eval`'ini dosyaya taşı.
4. Linux için paket deposu üzerinden güncelleme politikası belgele.
5. İmzalı ilk sürümde SmartScreen ve güncelleme akışını gerçek makinede doğrula.

---

## 5. Sonuç

- Uygulama **sandbox + contextIsolation + dar preload + CSP + allowlist +
  IPC gönderen doğrulaması** temelinde sağlam bir duruş sergiliyor; bilinen
  üretim bağımlılığı açığı yok.
- Ancak **kod imzalama yok**. SignPath Foundation başvuru paketi hazır olsa da
  imzalı ilk sürüm yayınlanmadan üretim için "güvenli" denemez.
- Bu raporda **sömürülebilir bir açık iddia edilmiyor**; yalnızca doğrulanan
  kontroller ve savunma derinliği boşlukları listelenmiştir.
