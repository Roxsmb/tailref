'use strict';
/* ======================================================================
   atomic-write.js — kalıcılık dosyaları için güvenli yazım
   ======================================================================
   writeFileAtomic: aynı klasörde geçici dosyaya yazar, fsync eder, sonra
   tek renameSync ile yerleştirir (aynı klasör = aynı disk, rename atomik).
   Süreç yazım ortasında çökerse ya eski dosya ya tam yenisi okunur —
   bozuk/truncate JSON hiçbir zaman yok.

   Windows notu: hedef bir okuyucu (AV, yedekleme) tarafından kilitliyse
   rename EPERM/EBUSY verebilir. Eski uygulama hedefi SİLİP yeniden
   deniyordu; ikinci rename de düşerse elde ne eski ne yeni dosya kalıyordu
   (P0 veri kaybı). Yeni sıra:
     1) rename'i kısa aralıklarla birkaç kez dene (hedefe dokunmadan),
     2) hâlâ olmuyorsa eski dosyayı .old-* yanına TAŞI (silme),
     3) yeni dosyayı yerleştir; olmazsa doğrudan yaz,
     4) her şey düşerse eski dosyayı geri koy ve hatayı yükselt.
   Böylece eski içerik hiçbir adımda geri dönüşsüz kaybolmaz.

   reserveUniqueFile: "var mı?" kontrolü ile yazma arasındaki yarışı
   kapatır; adı O_EXCL (wx) ile atomik olarak sahiplenir. Aynı anda iki
   dışa aktarma aynı ada yazamaz; ikincisi " (1)" varyantına kayar.
   ====================================================================== */

const fsDefault = require('fs');
const pathDefault = require('path');

/** Senkron kısa bekleme; yalnız nadir hata yolunda (rename kilidi) kullanılır. */
function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    const shared = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(shared, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* son çare: kısa meşgul bekleme */ }
  }
}

function createAtomicWriter(options = {}) {
  const fs = options.fs || fsDefault;
  const path = options.path || pathDefault;
  const retries = Number.isInteger(options.retries) ? Math.max(0, options.retries) : 4;
  const retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 25;
  const nonce = () => `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function writeFileAtomic(file, data) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.tmp-${nonce()}`);
    const aside = path.join(dir, `.old-${nonce()}`);
    let placed = false;
    let asideMoved = false;
    try {
      /* Önce geçici dosya: fsync ile veri diske inmeden rename edilmez. */
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeFileSync(fd, data);
        try { fs.fsyncSync(fd); } catch { /* bazı dosya sistemleri desteklemez */ }
      } finally {
        fs.closeSync(fd);
      }
      /* 1) Hedefe dokunmadan rename denemeleri. */
      for (let attempt = 0; !placed && attempt <= retries; attempt += 1) {
        try {
          fs.renameSync(tmp, file);
          placed = true;
        } catch (error) {
          if (attempt === retries) break;
          sleepSync(retryDelayMs);
        }
      }
      if (placed) return;
      /* 2) Eski dosyayı yana al (silme!): kilit yüzünden rename düşse de
         içerik diskte kalır. */
      try {
        fs.renameSync(file, aside);
        asideMoved = true;
      } catch {
        try { fs.copyFileSync(file, aside); asideMoved = true; } catch { asideMoved = false; }
      }
      /* 3) Yeni dosyayı yerleştir. */
      try {
        fs.renameSync(tmp, file);
        placed = true;
      } catch {
        /* 4) Son çare doğrudan yaz. Başarısızsa eski dosyayı geri koy. */
        try {
          fs.writeFileSync(file, data);
          placed = true;
        } catch (writeError) {
          if (asideMoved) {
            try { fs.renameSync(aside, file); asideMoved = false; } catch { /* yan kopya duruyor */ }
          }
          throw writeError;
        }
      }
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* sessiz */ }
      if (placed) {
        /* Yerleştirme başarılı: yan kopyaya artık gerek yok. */
        try { fs.rmSync(aside, { force: true }); } catch { /* sessiz */ }
      }
    }
  }

  return writeFileAtomic;
}

/** Aynı klasörde çakışmayan, atomik olarak sahiplenilmiş bir dosya adı üretir.
    Dönüş: tam yol. Çağıran yazmayı tamamlayamazsa dosyayı silmelidir. */
function reserveUniqueFile(dir, base, ext, options = {}) {
  const fs = options.fs || fsDefault;
  const path = options.path || pathDefault;
  const limit = Number.isInteger(options.limit) ? options.limit : 1000;
  for (let i = 0; i < limit; i += 1) {
    const name = i === 0 ? `${base}.${ext}` : `${base} (${i}).${ext}`;
    const full = path.join(dir, name);
    try {
      const fd = fs.openSync(full, 'wx');
      fs.closeSync(fd);
      return full;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error(`No free file name for "${base}.${ext}" in ${dir}`);
}

const writeFileAtomic = createAtomicWriter();

module.exports = {
  createAtomicWriter,
  writeFileAtomic,
  reserveUniqueFile,
  sleepSync,
};
