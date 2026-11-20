'use strict';
/* ======================================================================
   TailRef kapısı — kayıt sistemi güvenliği (izole Electron profili)
   ======================================================================
   Kapsam (her biri gerçek IndexedDB üzerinde):
   1) "Temiz başlat" yalnızca PANO anahtarlarını siler; özel fırça
      kütüphanesi / FX presetleri / native önizlemeler korunur.
   2) .tail ve otomatik yedek yalnızca panolarda referanslanan görselleri
      gömer; IDB'de kalmış sahipsiz görseller dosyayı şişirmez.
   3) Dosya açma + reload sırasında pagehide flush'ı import edilen kaydı
      canlı (eski) tahtayla ezmez.
   4) Manuel modda dosya açmadan önce alınan acil kopya CANLI tahtayı içerir.
   5) Manuel mod "kaydedilmemiş değişiklik" imzası: değişiklikte farklılaşır,
      geri alınınca yeniden eşleşir.
   6) Manuel → otomatik geçişte eski pano kayıtları temizlenir, açık pano
      kaydı korunur.
   7) .tail gövdesi "görseller eksiksiz" işaretlenir; yalnızca geri al
      yığınında kalan görsel dosyaya girmez.
   8) Daha yeni sürümün dosyası reddedilir (veri bozulmadan).
   9) Boşta duran uygulamada otomatik yedek aynı panoyu tekrar yazmaz.
  10) .tail yaz/oku turu (async deflate/inflate) ve bozuk dosya reddi.
  11) "Açılışta temiz başla" ayarı kapalıyken bu oturumda açılan dosya,
      yeniden yüklemede arşivlenip silinmez.
  12) .tail kaydı sonrası sahipsiz görseller silinir; diskteki panoların
      görselleri korunur.
   ====================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const APP_PORT = 5201;
const DEBUG_PORT = 9337;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 30000);
});

async function waitForTarget(deadlineMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(300);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-persist-'));
  let app = null;
  let ws = null;
  try {
    app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      ['.', `--remote-debugging-port=${DEBUG_PORT}`, '--no-sandbox', '--disable-gpu'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          TailRef_USER_DATA: userDataDir,
          TailRef_PORT: String(APP_PORT),
          TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
        },
        stdio: 'ignore',
      });
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);
    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(ws,
          "typeof appReady !== 'undefined' && appReady === true && typeof idbPut === 'function'");
        if (ready) break;
      } catch { /* henüz değil */ }
      await sleep(300);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    /* --- 1) Temiz başlat yalnızca pano verisini siler ------------------ */
    const wipe = await evaluate(ws, `(async () => {
      const put = (k, v) => idbPut('meta', k, v);
      await put('ink:brushes', { list: [{ name: 'probe-brush' }] });
      await put('ink:fx-presets', { presets: [{ name: 'probe-fx' }] });
      await put('nbprev|probe', { png: 'probe' });
      await put('project:probe-board', { id: 'probe-board', name: 'Probe', state: { items: [] } });
      await put('workspace', { schema: 1, activeId: 'probe-board', projects: [{ id: 'probe-board', name: 'Probe' }] });
      await put('state', JSON.stringify({ marker: 'probe-state', items: [] }));
      await idbPut('images', 'probe-wipe-img', { blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), name: 'w.png' });
      await archiveAndWipeBoards();
      const keys = (await idbEntries('meta')).map(([k]) => String(k));
      return {
        brush: keys.includes('ink:brushes'),
        fx: keys.includes('ink:fx-presets'),
        preview: keys.includes('nbprev|probe'),
        boardRecord: keys.includes('project:probe-board'),
        index: keys.includes('workspace'),
        legacyState: keys.includes('state'),
        images: (await idbEntries('images')).length,
      };
    })()`);
    check('temiz başlat: fırça kütüphanesi korunur', wipe.brush === true);
    check('temiz başlat: FX presetleri korunur', wipe.fx === true);
    check('temiz başlat: native fırça önizlemesi korunur', wipe.preview === true);
    check('temiz başlat: pano kaydı silinir', wipe.boardRecord === false);
    check('temiz başlat: pano indeksi silinir', wipe.index === false);
    check('temiz başlat: eski state kaydı silinir', wipe.legacyState === false);
    check('temiz başlat: pano görselleri silinir', wipe.images === 0);

    /* --- 2) Sahipsiz görsel yedeğe girmemeli -------------------------- */
    const img = await evaluate(ws, `(async () => {
      const refId = 'probe-ref-img';
      const orphanId = 'probe-orphan-img';
      const blob = new Blob([new Uint8Array([2, 3, 4])], { type: 'image/png' });
      await idbPut('images', refId, { blob, name: 'ref.png' });
      await idbPut('images', orphanId, { blob, name: 'orphan.png' });
      const item = { id: 'probe-ref-item', kind: 'image', imageId: refId, x: 10, y: 10, w: 40, h: 40, z: 9999 };
      state.items.push(item);
      const payload = await buildTailPayload();
      const ids = payload.images.map(image => image.id);
      const result = {
        ref: ids.includes(refId),
        orphan: ids.includes(orphanId),
        itemRestored: payload.state.items.some(it => it.id === item.id),
      };
      state.items = state.items.filter(it => it.id !== item.id);
      await idbDel('images', refId);
      await idbDel('images', orphanId);
      return result;
    })()`);
    check('yedek: panodaki görsel dosyaya girer', img.ref === true);
    check('yedek: sahipsiz görsel dosyaya girmez', img.orphan === false);
    check('yedek: canlı tahta anlık görüntüsü dosyada', img.itemRestored === true);

    /* --- 3) Import sonrası reload flush'ı import'u ezmemeli ----------- */
    const race = await evaluate(ws, `(async () => {
      const before = getPersistenceMode();
      if (before !== 'auto') { setPersistenceMode('auto'); await new Promise(r => setTimeout(r, 200)); }
      await idbPut('meta', 'state', JSON.stringify({ marker: 'imported-probe', items: [] }));
      suspendPersistenceForReload();
      await flushSave();
      await new Promise(r => setTimeout(r, 200));
      const kept = JSON.parse(await idbGet('meta', 'state')).marker === 'imported-probe';
      resumePersistenceAfterFailedImport();
      await saveNow();
      await new Promise(r => setTimeout(r, 200));
      const live = JSON.parse(await idbGet('meta', 'state'));
      return { kept, liveItems: Array.isArray(live.items) ? live.items.length : -1, mode: getPersistenceMode() };
    })()`);
    check('import yarışı: reload flush import kaydını ezmez', race.kept === true);
    check('import yarışı: bayrak kalkınca otomatik kayıt devam eder', race.liveItems >= 0 && race.mode === 'auto');

    /* --- 4) Manuel mod: açma öncesi acil kopya canlı tahtayı içerir ---- */
    const emergency = await evaluate(ws, `(async () => {
      const mode = getPersistenceMode();
      setPersistenceMode('manual');
      const probe = { id: 'probe-emg-item', kind: 'text', text: 'emg-live-probe', x: 5, y: 5, w: 60, h: 20, z: 9999 };
      state.items.push(probe);
      const file = await saveEmergencyCopy(true);
      state.items = state.items.filter(it => it.id !== probe.id);
      if (mode === 'auto') setPersistenceMode('auto');
      if (!file) return { file: null, found: false };
      const raw = await window.tailref.readBackupFile(file);
      let found = false;
      try { found = (JSON.parse(raw).state.items || []).some(it => it.text === 'emg-live-probe'); } catch { found = false; }
      return { file, found };
    })()`);
    check('manuel mod: açma öncesi acil kopya yazılır', !!emergency.file, emergency.file || '');
    check('manuel mod: acil kopya canlı tahtayı içerir', emergency.found === true);

    /* --- 5) Kirli durum imzası --------------------------------------- */
    const dirty = await evaluate(ws, `(async () => {
      const mode = getPersistenceMode();
      setPersistenceMode('manual');
      const bg0 = state.bg;
      markManualClean();
      const h0 = manualSavedHash;
      const cleanAtStart = manualStateSignature() === h0;
      state.bg = bg0 === 1 ? 0.5 : 1;
      const detects = manualStateSignature() !== h0;
      state.bg = bg0;
      const restored = manualStateSignature() === h0;
      if (mode === 'auto') { setPersistenceMode('auto'); scheduleSave(); }
      return { cleanAtStart, detects, restored };
    })()`);
    check('manuel imza: temiz durumda eşleşir', dirty.cleanAtStart === true);
    check('manuel imza: değişikliği yakalar', dirty.detects === true);
    check('manuel imza: geri alınca yine temiz', dirty.restored === true);

    /* --- 6) Mod geçişi: canlı panolar korunur, eski kayıtlar temizlenir - */
    const prune = await evaluate(ws, `(async () => {
      if (getPersistenceMode() !== 'auto') { setPersistenceMode('auto'); await new Promise(r => setTimeout(r, 250)); }
      await idbPut('meta', 'project:probe-stale-board', { id: 'probe-stale-board', name: 'Stale', state: { items: [] } });
      const activeKey = 'project:' + workspaceManager.activeId;
      const removed = await pruneStaleStoredBoards();
      await new Promise(r => setTimeout(r, 150));
      const keys = (await idbEntries('meta')).map(([k]) => String(k));
      return {
        removed,
        staleGone: !keys.includes('project:probe-stale-board'),
        activeKept: keys.includes(activeKey),
        brushesUntouched: true,
      };
    })()`);
    check('mod geçişi: eski pano kaydı temizlenir', prune.staleGone === true && prune.removed >= 1, 'silinen=' + prune.removed);
    check('mod geçişi: açık panonun kaydı korunur', prune.activeKept === true);

    /* --- 7) Payload: eksiksizlik bayrağı + sadece-geri-al görseli ------ */
    const undoOnly = await evaluate(ws, `(async () => {
      if (getPersistenceMode() !== 'manual') setPersistenceMode('manual');
      const id = 'probe-undo-only-img';
      await idbPut('images', id, {
        blob: new Blob([new Uint8Array([9])], { type: 'image/png' }),
        name: 'undo-only.png', savedAt: Date.now(),
      });
      undoStack.push(JSON.stringify({
        items: [{ id: 'probe-undo-only-item', kind: 'image', imageId: id }],
      }));
      const payload = await buildTailPayload();
      const ids = payload.images.map(image => image.id);
      undoStack.pop();
      await idbDel('images', id);
      if (getPersistenceMode() !== 'auto') setPersistenceMode('auto');
      return {
        complete: payload.imagesComplete === true,
        undoOnly: ids.includes(id),
        version: payload.version,
      };
    })()`);
    check('.tail: görsel listesi eksiksiz işaretlenir', undoOnly.complete === true);
    check('.tail: yalnızca geri al yığınındaki görsel dosyaya girmez', undoOnly.undoOnly === false);
    check('.tail: payload sürümü 2', undoOnly.version === 2);

    /* --- 8) Gelecek sürüm dosyası reddedilmeli (yazma yok) ------------ */
    const newer = await evaluate(ws, `(async () => {
      const before = (await idbEntries('meta')).length;
      let rejected = false;
      try {
        await importBackupPayload({ version: 99, state: { items: [] } });
      } catch { rejected = true; }
      const after = (await idbEntries('meta')).length;
      return { rejected, untouched: before === after };
    })()`);
    check('dosya: yeni sürüm reddedilir', newer.rejected === true);
    check('dosya: reddedilen içe aktarma veriye dokunmaz', newer.untouched === true);

    /* --- 9) Boşta otomatik yedek tekrar yazmaz ------------------------ */
    const idleBackup = await evaluate(ws, `(async () => {
      if (getPersistenceMode() !== 'auto') { setPersistenceMode('auto'); await new Promise(r => setTimeout(r, 400)); }
      const count = async () => (await window.tailref.listBackups())
        .filter(entry => /^tailref-/.test(entry.name)).length;
      state.bg = state.bg === 1 ? 0.42 : 1;
      scheduleSave();
      await new Promise(r => setTimeout(r, 800));
      const before = await count();
      await autoBackup();
      const afterFirst = await count();
      await autoBackup();
      await new Promise(r => setTimeout(r, 300));
      const afterSecond = await count();
      return { before, afterFirst, afterSecond };
    })()`);
    check('otomatik yedek: değişiklikten sonra yazılır',
      idleBackup.afterFirst > idleBackup.before, `${idleBackup.before}→${idleBackup.afterFirst}`);
    check('otomatik yedek: boşta aynı pano tekrar yazılmaz',
      idleBackup.afterSecond === idleBackup.afterFirst, `${idleBackup.afterFirst}→${idleBackup.afterSecond}`);

    /* --- 10) .tail yaz/oku turu + bozuk dosya ------------------------- */
    const roundTrip = await evaluate(ws, `(async () => {
      const payload = {
        version: 2, imagesComplete: true,
        state: { items: [{ id: 'probe-roundtrip', kind: 'text', text: 'rt' }] },
        workspace: null, images: [],
      };
      const file = ${JSON.stringify(path.join(userDataDir, 'probe-roundtrip.tail'))};
      // Node tarafında yazılan dosyayı renderer IPC'siyle oku.
      return { file, payload };
    })()`);
    const tailBuf = Buffer.concat([
      Buffer.from('TAIL', 'ascii'),
      Buffer.from([1]),
      zlib.deflateSync(Buffer.from(JSON.stringify(roundTrip.payload), 'utf8')),
    ]);
    fs.writeFileSync(roundTrip.file, tailBuf);
    const readBack = await evaluate(ws, `(async () => {
      const res = await window.tailref.openBoardFileAtPath(${JSON.stringify(roundTrip.file)});
      return {
        ok: res && res.ok === true,
        marker: !!(res && res.payload && res.payload.state &&
          (res.payload.state.items || []).some(it => it.id === 'probe-roundtrip')),
      };
    })()`);
    check('.tail tur: geçerli dosya okunur', readBack.ok === true);
    check('.tail tur: içerik eksiksiz geri gelir', readBack.marker === true);

    const corruptPath = path.join(userDataDir, 'probe-corrupt.tail');
    fs.writeFileSync(corruptPath, Buffer.concat([
      Buffer.from('TAIL', 'ascii'), Buffer.from([1]), Buffer.from('bozuk-json'),
    ]));
    const corrupt = await evaluate(ws, `(async () => {
      const res = await window.tailref.openBoardFileAtPath(${JSON.stringify(corruptPath)});
      return { ok: res && res.ok === true, error: !!(res && res.error) };
    })()`);
    check('bozuk .tail: çökmeden reddedilir', corrupt.ok === false && corrupt.error === true);

    /* --- 11) Açılan dosya, "temiz başla" ayarına rağmen silinmez ------ */
    const openedKeep = await evaluate(ws, `(async () => {
      const payload = {
        version: 2, imagesComplete: true, images: [],
        state: { items: [] },
        workspace: {
          schema: 1, activeId: 'prj-opened-probe',
          projects: [{
            id: 'prj-opened-probe', name: 'OpenedProbe', createdAt: Date.now(),
            updatedAt: Date.now(),
            state: { items: [{ id: 'probe-opened-item', kind: 'text', text: 'kept' }] },
          }],
        },
      };
      await importBackupPayload(payload);
      localStorage.setItem('tailref-restore-boards', '0');
      const flag = sessionStorage.getItem('tailref-opened-file-once') === '1';
      workspaceManager.projects.clear();
      workspaceManager.order = [];
      workspaceManager.activeId = null;
      await workspaceManager._load();
      const project = workspaceManager.projects.get('prj-opened-probe');
      const kept = !!(project && project.name === 'OpenedProbe' &&
        (project.snapshot.items || []).some(it => it.id === 'probe-opened-item'));
      localStorage.removeItem('tailref-restore-boards');
      return { flag, kept };
    })()`);
    check('açılan dosya: oturum bayrağı işaretlenir', openedKeep.flag === true);
    check('açılan dosya: temiz başla ayarı dosyayı silmez', openedKeep.kept === true);

    /* --- 12) Manuel .tail sonrası görsel temizliği --------------------- */
    const pruneImages = await evaluate(ws, `(async () => {
      if (getPersistenceMode() !== 'manual') setPersistenceMode('manual');
      const blob = () => new Blob([new Uint8Array([7])], { type: 'image/png' });
      const orphan = 'probe-orphan-img';
      const stored = 'probe-stored-img';
      await idbPut('images', orphan, { blob: blob(), name: 'orphan.png', savedAt: Date.now() });
      await idbPut('images', stored, { blob: blob(), name: 'stored.png', savedAt: Date.now() });
      await idbPut('meta', 'project:probe-stored-board', {
        schema: 1, id: 'probe-stored-board', name: 'Stored', updatedAt: Date.now(),
        state: { items: [{ id: 'p-stored-item', kind: 'image', imageId: stored }] },
      });
      const removed = await pruneUnusedImagesNow();
      const orphanGone = !(await idbGet('images', orphan));
      const storedKept = !!(await idbGet('images', stored));
      await idbDel('images', stored);
      await idbDel('meta', 'project:probe-stored-board');
      if (getPersistenceMode() !== 'auto') setPersistenceMode('auto');
      return { orphanGone, storedKept, removed };
    })()`);
    check('manuel kayıt sonrası sahipsiz görsel silinir',
      pruneImages.orphanGone === true && pruneImages.removed >= 1, 'silinen=' + pruneImages.removed);
    check('diskteki panonun görseli korunur', pruneImages.storedKept === true);
  } catch (e) {
    console.error('TEST HATASI:', e.message);
    fail++;
  } finally {
    if (ws) { try { ws.close(); } catch { /* sessiz */ } }
    if (app && app.exitCode === null) {
      try { app.kill(); } catch { /* sessiz */ }
      await sleep(500);
    }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
