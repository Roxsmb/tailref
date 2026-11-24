'use strict';
/* ======================================================================
   TailRef kapısı — yedek sağlık denetimi (saf Node, gerçek worker)
   ======================================================================
   Kapsam:
   1) Gerçek JSON yedeği worker'da parse edilir; öğe/görsel sayıları doğru.
   2) Öğe sınırı aşılırsa sağlıksız + too-many-items.
   3) Bozuk JSON sağlıksız + corrupt (çökme yok).
   4) Boyut sınırı aşılırsa dosya hiç okunmadan too-large.
   5) Worker kapalıysa işlem içi yola düşer ve sayaç yine doğru.
   6) Worker yanıt vermezse zaman aşımına düşer, asla asılı kalmaz.
   7) workspace + legacy `state` aynı panoyu tutsa da çift sayılmaz; boş
      workspace sınırı gizleyemez.
   ====================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { BackupInspector, countBackupContent } = require('../src/main/backup-health');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-health-'));
function writeJson(name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

(async () => {
  const inspectors = [];
  try {
    /* --- 1) Gerçek parse + sayaç ------------------------------------- */
    {
      const file = writeJson('workspace.json', {
        version: 2,
        images: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        workspace: {
          projects: [
            { state: { items: [{ id: 1 }, { id: 2 }] } },
            { snapshot: { items: [{ id: 3 }] } },
            { state: { items: [] } },
          ],
        },
      });
      const inspector = new BackupInspector({ timeoutMs: 8000 });
      inspectors.push(inspector);
      const info = await inspector.inspect(file, { size: fs.statSync(file).size });
      check('sağlık: worker gerçek dosyayı parse eder', info.ok === true && info.reason === '');
      check('sağlık: öğe sayısı doğru', info.items === 3, String(info.items));
      check('sağlık: görsel sayısı doğru', info.images === 3, String(info.images));
    }

    /* --- 2) Öğe sınırı ----------------------------------------------- */
    {
      const file = writeJson('many-items.json', {
        state: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        images: [],
      });
      const inspector = new BackupInspector({ timeoutMs: 8000, maxItems: 2 });
      inspectors.push(inspector);
      const info = await inspector.inspect(file, { size: fs.statSync(file).size });
      check('sağlık: öğe sınırı sağlıksız işaretler', info.ok === false && info.reason === 'too-many-items');
    }

    /* --- 3) Bozuk JSON ------------------------------------------------ */
    {
      const file = path.join(dir, 'broken.json');
      fs.writeFileSync(file, '{"state": {');
      const inspector = new BackupInspector({ timeoutMs: 8000 });
      inspectors.push(inspector);
      const info = await inspector.inspect(file, { size: fs.statSync(file).size });
      check('sağlık: bozuk JSON corrupt döner', info.ok === false && info.reason === 'corrupt');
    }

    /* --- 4) Boyut sınırı: okumadan ele --------------------------------- */
    {
      const file = writeJson('big.json', { state: { items: [] } });
      const inspector = new BackupInspector({ maxBytes: 4 });
      inspectors.push(inspector);
      const info = await inspector.inspect(file, { size: fs.statSync(file).size });
      check('sağlık: boyut sınırı too-large', info.ok === false && info.reason === 'too-large');
    }

    /* --- 5) Worker yok: işlem içi güvenli düşüş ----------------------- */
    {
      const file = writeJson('fallback.json', {
        state: { items: [{ id: 1 }] }, images: [{ id: 'x' }],
      });
      const inspector = new BackupInspector({ useWorker: false });
      inspectors.push(inspector);
      const info = await inspector.inspect(file, { size: fs.statSync(file).size });
      check('sağlık: worker yokken işlem içi sayaç doğru',
        info.ok === true && info.items === 1 && info.images === 1);
    }

    /* --- 6) Cevap vermeyen worker: zaman aşımı ------------------------ */
    {
      class HangingWorker extends EventEmitter {
        unref() { /* yok */ }
        postMessage() { /* hiç yanıt yok */ }
        terminate() { this.terminated = true; }
      }
      const file = writeJson('hang.json', { state: { items: [] } });
      const inspector = new BackupInspector({
        Worker: HangingWorker,
        timeoutMs: 40,
        useWorker: true,
      });
      inspectors.push(inspector);
      const started = Date.now();
      const info = await inspector.inspect(file, { size: fs.statSync(file).size });
      const elapsed = Date.now() - started;
      check('sağlık: yanıtsız worker zaman aşımına düşer', info.ok === false && info.reason === 'timeout');
      check('sağlık: zaman aşımı makul sürede döner', elapsed < 2000, `${elapsed} ms`);
    }

    /* --- Sayaç fonksiyonu tek kaynak --------------------------------- */
    {
      const counts = countBackupContent({
        workspace: { projects: [{ state: { items: [1, 2] } }] },
        images: [1],
      });
      check('sağlık: sayaç fonksiyonu workspace yolunu sayar', counts.items === 2 && counts.images === 1);
    }

    /* --- Aynı panoyu iki yolda tutmak çift saymaz --------------------- */
    {
      const counts = countBackupContent({
        workspace: { projects: [{ state: { items: [1, 2] } }] },
        state: { items: [1, 2] },
      });
      check('sağlık: iki yol toplanmaz (çift sayım yok)', counts.items === 2, String(counts.items));
    }

    /* --- Boş workspace, sınırı gizleyemez ----------------------------- */
    {
      const file = writeJson('empty-workspace.json', {
        workspace: { projects: [] },
        state: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        images: [],
      });
      const inspector = new BackupInspector({ timeoutMs: 8000, maxItems: 2 });
      inspectors.push(inspector);
      const info = await inspector.inspect(file, { size: fs.statSync(file).size });
      check('sağlık: boş workspace sınırı gizleyemez',
        info.ok === false && info.reason === 'too-many-items' && info.items === 3,
        `${info.items} öğe · ${info.reason}`);
    }
  } catch (e) {
    console.error('TEST HATASI:', e.stack || e.message);
    fail += 1;
  } finally {
    for (const inspector of inspectors) { try { inspector.dispose(); } catch { /* sessiz */ } }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* kilitli */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
