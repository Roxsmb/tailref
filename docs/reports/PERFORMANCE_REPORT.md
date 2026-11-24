# PERFORMANCE REPORT — TailRef Studio 1.4.4

**Tarih:** 2026-11-23 · **Son doğrulama:** 2026-11-24
**Ortam:** Windows 10.0.26300 x64 · Electron 45.4.1 · Node 26.8.2 · SSD
**Yöntem:** kaynak analizi + bu makinede koşulan ölçümler. Profiler
(RenderDoc/NSight/Chrome tracing) **koşulmadı**; aşağıda "ölçüldü" ve
"yapısal" ayrımı korunur.

---

## 1. Bu turda değişen performans davranışları

| Alan | Önce | Sonra | Tür |
|---|---|---|---|
| Yedek sağlık denetimi (`inspectBackup`) | Ana süreçte `readFileSync` + `JSON.parse`, yedek başına | `worker_threads`'te parse; 15 sn üst sınır; sonuç önbelleği | Yapısal + ölçüldü |
| `list-backups` / `read-backup` | Senkron handler; 1 GB'a kadar `readFileSync` | Async handler + `fs.promises.readFile`; sıralı denetim | Yapısal |
| `.tail` açma (`readBoardFile`) | `statSync` + `readFileSync` (ana süreç) | `fs.promises.stat/readFile` | Yapısal |
| Dışa aktarma adı | `existsSync` döngüsü + yazma | `openSync('wx')` atomik sahiplenme | Yapısal (O(1) deneme) |
| Kalıcılık yazımı | rename + gerekirse sil/yaz | geçici dosya + `fsync` + rename + yedek yan kopya | Yapısal (küçük sabit maliyet) |

---

## 2. Ölçülen: yedek denetimi (18.6 MB, 1500 öğe)

Komut: `node %TEMP%\opencode\bench-backup.js` (geçici ölçüm betiği, depoda
değil; `BackupInspector` gerçek modülü kullanır).

| Yol | Süre |
|---|---|
| Senkron `readFileSync` + `JSON.parse` (3 koşu) | 33 ms · 27 ms · 36 ms |
| Worker, ilk istek (worker açılışı dahil) | 47 ms |
| Worker, sıcak ikinci istek | 27 ms |

**Yorum (dürüst):**

- Bu makinede 18.6 MB dosya zaten hızlı parse ediliyor; **"saniyelerce
  donma" iddiası bu boyut için doğru değil.** Kazanç toplam sürede değil,
  **ana iş parçacığının bloklanmamasında**: worker parse ederken IPC, pencere
  olayları ve yanıt watchdog'u çalışmaya devam eder.
- Worker'ın sabit ek maliyeti ~15–20 ms (ilk istek). Tek dosya için bu
  kabul edilebilir; önbellek tekrar denetimleri bedava yapar.
- 200 MB üst sınırına yakın dosyalarda parse süresi bu ölçümün ~10 katı
  olabilir (ölçülmedi). 15 sn zaman aşımı, yavaş disk/bozuk dosya
  durumunda kuyruğun kilitlenmesini engeller.

---

## 3. Yapısal analiz (ölçülmedi, kod kanıtı)

### 3.1 Ana süreçte kalan senkron işler

`src/main/main.js` içinde hâlâ senkron olan başlıca yollar:

- `fs.mkdirSync`, `fs.copyFileSync`, `fs.readdirSync` — küçük dizin
  işlemleri (yedek rotasyonu, arşiv kopyası). Dosya boyutuyla ölçeklenmez;
  kabul edilebilir.
- `json` tercih dosyaları (kilobayt) — kabul edilebilir.
- `native/inkcore` `tileSlice` çağrısı **senkron**; MessagePort isteği
  zaman aşımına düşse bile ana süreç o çağrı bitene kadar meşguldür. Bu,
  renderer kilidini çözer ama ana süreç donmasını çözmez (P3 borç).

### 3.2 Renderer tarafı

- `src/renderer/core/34-ink-undo.js` içinde `nativeSlicing = false`; karo
  dilimleme şu anda JS yolunda. MessagePort yolu ölü kod değil (API açık)
  ama üretimde tetiklenmiyor. Bu, performans açısından **bilinçli bir
  güvenli mod**; açılmadan önce ölçüm gerekir.
- `src/renderer/app.js` 3.3 MB / 73.7k satır (74 kaynak birleşimi). Yükleme
  süresi bu turda ölçülmedi; kapı yalnız güncelliği doğrular.

### 3.3 Paket boyutu

- `win-unpacked` yeniden üretildi; `app.asar` içindeki `app.js` 3303.8 KB
  (74 kaynak · 73.728 satır).
- `verify-package` 22 dosyayı doğruluyor (önce 10).

---

## 4. Regresyon riski ve öneriler

1. **Ölçüm tabanı yok:** brush/canvas FPS, ilk açılış süresi, bellek
   kullanımı için otomatik eşikli bir bench yok. `npm run bench:ink` var ama
   eşik/rapor üretmiyor. Öneri: CI'da eşikli `bench:ink` + `--json` çıktı.
2. **Uzun oturum soak testi yok:** karo önbelleği, undo yığını ve yedek
   listesi saatler boyunca izlenmedi.
3. **Worker maliyeti:** çok sayıda küçük yedekte worker round-trip'i
   senkron parse'tan yavaş olabilir. Önbellek (256) bunu hafifletir; yine de
   `list-backups` sıralı çalıştığı için 200 yedekte toplam süre artar.
   Öneri: ilk N yedek için hızlı boyut/yaş filtresi, geri kalanı tembel.
4. **Senkron native çağrı:** uzun vadede `tileSlice` async/iş parçacığına
   taşınmalı (K16–K22 parity ile birlikte).

---

## 5. Sonuç

- P1 sınıfı **ana süreç bloklama** yolları (200 MB JSON, 1 GB yedek okuma,
  büyük `.tail`) kaldırıldı veya worker'a taşındı.
- Bu turda **yeni FPS/bellek iddiası üretilmedi**; ölçülen tek sayısal veri
  §2'dedir ve sınırlarıyla birlikte verilmiştir.
- Performans açısından sürüm **CONDITIONALLY READY**: yapısal donma riski
  azaldı, ancak ölçüm tabanı ve soak testi yok.
