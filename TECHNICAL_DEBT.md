# TECHNICAL DEBT — TailRef Studio 1.4.3

**Tarih:** 2026-11-23
**Kural:** Bu dosya yalnızca **bilinen ve kapatılmamış** borçları listeler.
Her satırda neden kapatılmadığı ve kapatma ölçütü vardır. Kapatılanlar
`FIXES_APPLIED.md` içindedir.

---

## P1 — Üretim öncesi kapatılmalı

> Not: **TD-01** (IPC gönderen doğrulaması) bu turda kapatıldı; ayrıntı ve
> kanıt `FIXES_APPLIED.md` §11. Numaralar tarihsel izi korumak için
> yeniden kullanılmadı.

### TD-02 · Kod imzalama ve imzalı güncelleme yok

- **Durum:** Paketleme logu `no code signing certificate configured`.
- **Neden kapatılmadı:** ücretli sertifika bütçe dışı; GPL-3.0-or-later için
  SignPath Foundation ücretsiz yolu seçildi. Başvuru paketi hazır
  (`docs/CODE_SIGNING.md`, `docs/SIGNPATH_APPLICATION.md`); yayınlanmış sürüm,
  maintainer hesabı/MFA ve foundation onayı bekliyor.
- **Kapatma ölçütü:** Authenticode imzalı `.exe`/kurulum + `electron-updater`
  imza doğrulaması; SmartScreen uyarısının kalktığının doğrulanması ve
  `Get-AuthenticodeSignature` ile `SignPath Foundation` imzasının görülmesi.

### TD-03 · Gerçek tablet donanımı ve macOS/Linux test edilmedi

- **Durum:** Bu makinede Wacom/Windows Ink, macOS ve Linux çalıştırılmadı.
  Yalnız Windows x64 paketi üretildi ve statik Linux kapıları koştu.
- **Neden kapatılmadı:** donanım/işletim sistemi erişimi yok.
- **Kapatma ölçütü:** en az bir gerçek tablette basınç/eğim/gecikme turu;
  Linux AppImage + deb kurulumunda açılış/`.tail` ilişkilendirme duman testi.

### TD-04 · 8 dilde çevrilmemiş anahtarlar — kapandı

- **Durum:** 24 Kasım 2026'da kalan 275 anahtar sekiz dile de gerçek çeviriyle
  eklendi; her dilde 1671 anahtar, `MAX_UNTRANSLATED = 0`.
- **Kapatma kanıtı:** `locale-data-test` 23/23 — 8 dilde 0 eksik, 0 boş değer,
  0 yer tutucu uyuşmazlığı, 0 orphan; `build-locales --check` güncel.
- **Sürdürme:** ratchet sıfırda kilitli; yeni metin çevrilmeden eklenirse kapı
  kırmızı olur.

---

## P2 — Sonraki sürüm

### TD-05 · Magic Wand uygulanmamış

- Kodda araç yok; UI vaat etmiyor. `docs/ROADMAP.md` "Next" altında.
- **Kapatma ölçütü:** bitişik/toleranslı seçim + undo entegrasyonu +
  en az 10 vaka testi (anti-aliased kenar, şeffaf katman, tüm tuval).

### TD-06 · Photoshop `.abr` dinamik eşlemesi eksik

- İçe/dışa aktarma çalışıyor; tüm dinamikler (scatter, dual brush, transfer
  eğrileri) TailRef modeline eşlenmiyor. Sessizce yutulan parametreler
  kullanıcıya tam raporlanmıyor.
- **Kapatma ölçütü:** parametre→özellik eşleme tablosu + yutulanlar için
  rapor + gerçek `.abr` örnekleriyle round-trip testi.

### TD-07 · Ink-engine K16–K22 parity

- `docs/INK_STATUS.md` kalan maddeleri listeler; native/JS çift yol var.
- **Kapatma ölçütü:** her K maddesi için sayısal eşleşme testi ve
  `nativeSlicing`'in güvenle açılması.

### TD-08 · Senkron native `tileSlice`

- `ink-engine-host` ana süreçte senkron C++ çağrısı yapar. Preload zaman
  aşımı renderer'ı kurtarır; ana süreç yine de o çağrı boyunca meşguldür.
- **Kapatma ölçütü:** çağrıyı iş parçacığına/async'e taşı; iptal edilebilir
  istek; 8 sn zaman aşımı testinin ana süreç tarafında da geçmesi.

### TD-09 · `nativeSlicing = false`

- `34-ink-undo.js` içinde sabit `false`; MessagePort yolu üretimde
  tetiklenmiyor. Ölü kod değil ama ölçülmemiş.
- **Kapatma ölçütü:** doğruluk (≤1 LSB) + performans ölçümü + hata
  durumunda JS yedeğine dönüş testi; sonra aç.

### TD-10 · Performans tabanı ve soak testi yok

- FPS, ilk açılış, bellek eğrisi için eşikli otomatik ölçüm yok; saatler
  süren oturum testi yok. `bench:ink` sayı üretiyor ama eşik koymuyor.
- **Kapatma ölçütü:** CI'da eşikli bench + 2 saatlik bellek soak'u +
  regresyon bütçesi.

### TD-11 · Worker `eval` kaynağı

- `backup-health.js` worker'ı `eval:true` ile üretir (asar yolu sorununu
  önlemek için). Dış girdi yok; yine de statik analiz dostu değil.
- **Kapatma ölçütü:** ayrı worker dosyası + `asarUnpack` doğrulaması.

### TD-12 · Paket doğrulaması yalnız dosya hash'i

- `verify-package` artık yerel `require` grafiğini kapatıyor (22 dosya),
  ancak `node_modules` bağımlılıklarını veya `files` dışında kalan varlıkları
  (ör. `build/`, `locales/`) denetlemiyor.
- **Kapatma ölçütü:** `package.json build.files` ile arşiv içeriğinin
  küme karşılaştırması + eksik varlıkta kırmızı.

---

## P3 — İyileştirme

### TD-13 · Üretilen `app.js` devasa tek dosya

- 3.1 MB / 73.7k satır; kaynak 74 dosya. Hata ayıklama ve ilk yükleme
  maliyeti için modülleştirme düşünülebilir. Kapı güncelliği koruyor.
- **Kapatma ölçütü (opsiyonel):** parçalı yükleme veya kaynak haritası.

### TD-14 · `PROJECT_AUDIT.md` tarihsel sayılar

- Eski denetim kayıtları (69 kapı, 164 test dosyası) tarihsel belge olarak
  bırakıldı; güncel sayılar README/ARCHITECTURE/ROADMAP/DEVELOPMENT'ta ve
  `gate-docs-test` ile korunuyor.
- **Karar:** tarihsel kayıt değiştirilmez; yeni denetimler bu dosyaya
  eklenir.

### TD-15 · Yedek listesi sıralı denetim

- `list-backups` yedekleri sırayla worker'a gönderir; 200 yedekte toplam
  süre uzar. Önbellek (256) tekrarı önler.
- **Kapatma ölçütü:** ilk N için hızlı boyut/yaş filtresi; geri kalanı
  tembel denetim.

---

## Bilinçli olarak yapılmayanlar

| Konu | Neden |
|---|---|
| `.tail` biçim değişikliği | Geriye dönük uyumluluk sözleşmesi; gerek yok |
| Yeni özellik (Magic Wand, ABR dinamikleri) | Denetim kapsamı dışı; ayrı sürüm işi |
| Uydurma çeviri | Kaliteyi düşürür; ratchet dürüst borcu korur |
| `ipcMain` toplu yeniden yazımı | Bu turda yapıldı (TD-01 kapandı); ham kayıt yalnız `ipc-guard.js` içinde |
| Otomatik kod imzalama | Ücretli sertifika bütçe dışı; SignPath Foundation başvurusu onay bekliyor |
