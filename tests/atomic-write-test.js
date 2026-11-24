'use strict';
/* ======================================================================
   TailRef kapısı — atomik yazım ve benzersiz dosya adı (saf Node)
   ======================================================================
   Kapsam:
   1) writeFileAtomic normal yazar ve eskisini değiştirir.
   2) Windows'ta rename kilitlenirse (EPERM) yeniden dener ve başarır.
   3) Rename kalıcı düşse de eski dosya SİLİNMEZ; doğrudan yazma başarılıysa
      yeni içerik yerleşir, artık .tmp/.old dosyası kalmaz.
   4) Rename ve doğrudan yazma ikisi de düşerse eski içerik AYNEN kalır ve
      hata yükselir (P0 veri kaybı regresyonu).
   5) reserveUniqueFile aynı ada ikinci kez izin vermez (yarış kilidi).
   ====================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAtomicWriter, reserveUniqueFile } = require('../src/main/atomic-write');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-atomic-'));
}

function clean(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* kilitli */ }
}

function leftovers(dir) {
  return fs.readdirSync(dir).filter(n => n.startsWith('.tmp-') || n.startsWith('.old-'));
}

/* Gerçek fs'in üzerine hata enjekte eden sarmalayıcı. */
function faultyFs(overrides) {
  const impl = Object.assign({}, fs, overrides);
  return impl;
}

(async () => {
  const dir = tmpDir();
  try {
    /* --- 1) Normal yazma + üzerine yazma ----------------------------- */
    {
      const write = createAtomicWriter({ retryDelayMs: 1 });
      const file = path.join(dir, 'normal.json');
      write(file, '{"a":1}');
      check('atomik: dosya oluşturulur', fs.readFileSync(file, 'utf8') === '{"a":1}');
      write(file, '{"a":2}');
      check('atomik: mevcut dosya değiştirilir', fs.readFileSync(file, 'utf8') === '{"a":2}');
      check('atomik: geçici dosya kalmaz', leftovers(dir).length === 0);
    }

    /* --- 2) Rename iki kez kilitli, sonra açılır --------------------- */
    {
      let attempts = 0;
      const flaky = faultyFs({
        renameSync(from, to) {
          attempts += 1;
          if (attempts <= 2) {
            const error = new Error('EPERM: operation not permitted');
            error.code = 'EPERM';
            throw error;
          }
          return fs.renameSync(from, to);
        },
      });
      const write = createAtomicWriter({ fs: flaky, retries: 4, retryDelayMs: 1 });
      const file = path.join(dir, 'flaky.json');
      write(file, 'flaky-ok');
      check('atomik: kilitli rename yeniden denenir', attempts === 3 && fs.readFileSync(file, 'utf8') === 'flaky-ok',
        `deneme=${attempts}`);
    }

    /* --- 3) Rename kalıcı düşer, doğrudan yazma çalışır --------------- */
    {
      const lockedFs = faultyFs({
        renameSync() {
          const error = new Error('EBUSY: resource busy or locked');
          error.code = 'EBUSY';
          throw error;
        },
      });
      const write = createAtomicWriter({ fs: lockedFs, retries: 1, retryDelayMs: 1 });
      const file = path.join(dir, 'locked.json');
      fs.writeFileSync(file, 'old-content');
      write(file, 'new-content');
      check('atomik: kilitte doğrudan yazmaya düşer', fs.readFileSync(file, 'utf8') === 'new-content');
      check('atomik: kilit yolunda artık dosya kalmaz', leftovers(dir).length === 0,
        leftovers(dir).join(','));
    }

    /* --- 4) Rename + doğrudan yazma düşer: eski veri korunur --------- */
    {
      const brokenFs = faultyFs({
        renameSync(from, to) {
          const error = new Error('EPERM');
          error.code = 'EPERM';
          throw error;
        },
        writeFileSync(target, data) {
          /* Yalnız hedef dosyaya doğrudan yazımı düşür; geçici dosya yazımı
             (fd ile) çalışmaya devam etsin. */
          if (typeof target === 'string' && path.basename(target) === 'precious.json') {
            const error = new Error('ENOSPC: no space left on device');
            error.code = 'ENOSPC';
            throw error;
          }
          return fs.writeFileSync(target, data);
        },
      });
      const write = createAtomicWriter({ fs: brokenFs, retries: 1, retryDelayMs: 1 });
      const file = path.join(dir, 'precious.json');
      fs.writeFileSync(file, 'precious-old');
      let threw = false;
      try { write(file, 'precious-new'); } catch { threw = true; }
      check('atomik: çift arıza hatayı yükseltir', threw === true);
      check('atomik: çift arızada eski içerik korunur', fs.readFileSync(file, 'utf8') === 'precious-old');
    }

    /* --- 5) reserveUniqueFile yarış kilidi --------------------------- */
    {
      const exportDir = path.join(dir, 'exports');
      fs.mkdirSync(exportDir);
      const first = reserveUniqueFile(exportDir, 'pano', 'png');
      fs.writeFileSync(first, 'one');
      const second = reserveUniqueFile(exportDir, 'pano', 'png');
      fs.writeFileSync(second, 'two');
      const third = reserveUniqueFile(exportDir, 'pano', 'png');
      check('benzersiz ad: ilk ad temiz', path.basename(first) === 'pano.png');
      check('benzersiz ad: ikinci ad (1) alır', path.basename(second) === 'pano (1).png');
      check('benzersiz ad: üçüncü ad (2) alır', path.basename(third) === 'pano (2).png');
      check('benzersiz ad: içerikler birbirini ezmez',
        fs.readFileSync(first, 'utf8') === 'one' && fs.readFileSync(second, 'utf8') === 'two');
      let bounded = false;
      try { reserveUniqueFile(exportDir, 'pano', 'png', { limit: 3 }); }
      catch { bounded = true; }
      check('benzersiz ad: arama sınırı aşılırsa hata', bounded === true);
    }
  } catch (e) {
    console.error('TEST HATASI:', e.stack || e.message);
    fail += 1;
  } finally {
    clean(dir);
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
