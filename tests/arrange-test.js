'use strict';

/* "Diz" (arrange) testi — gerçek Electron penceresinde, gerçek DOM olaylarıyla.

   Kapsam:
   • Seçili görsellerin BOYUTLARI değişmemeli (w/h aynı kalmalı).
   • Aralarındaki boşluk "minik" ve eşit olmalı: satır içinde yatay, satırlar
     arasında dikey tam ARRANGE_GAP (14 dünya birimi).
   • Hiçbir öğe üst üste binmemeli.
   • Gruplar tek blok olarak taşınmalı (grup içi yerleşim bozulmamalı).
   • İşlem Ctrl+Z ile geri alınabilmeli.
   • Tek öğe seçiliyken düğme pasif olmalı.

   Kullanım: node scripts/arrange-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9341;
const APP_PORT = 5198;
const GAP = 14;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('electron bulunamadı (npm install)');
  return found;
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
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 15000);
});

async function waitForTarget(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

/* Sayfa içinde çalışan yardımcılar: birim kutuları, satırlar, boşluk ölçümü. */
const IN_PAGE_HELPERS = `
  function arBoxes(list) {
    return list.map(it => ({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h || 0 }));
  }
  /* Dizme mantığındaki birimler: grup = tek blok (14 px çerçeve payıyla). */
  function arUnits() {
    const imgs = state.items.filter(i => i.kind === 'image');
    const taken = new Set(), units = [];
    for (const it of imgs) {
      if (taken.has(it.id)) continue;
      const gid = outermostGroupOf(it);
      const members = gid ? groupItemsDeep(gid) : null;
      if (members && members.length > 1) {
        for (const m of members) taken.add(m.id);
        units.push(boundsOf(members, 14));
      } else {
        taken.add(it.id);
        units.push(boundsOf([it], 0));
      }
    }
    return units;
  }
  function arRows(units) {
    const rows = [];
    for (const b of units) {
      const cy = b.y + b.h / 2;
      let row = rows.find(r => Math.abs(r.cy - cy) < 0.6);
      if (!row) { row = { cy, items: [] }; rows.push(row); }
      row.items.push(b);
    }
    rows.sort((a, b) => a.cy - b.cy);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      r.top = Math.min(...r.items.map(b => b.y));
      r.bottom = Math.max(...r.items.map(b => b.y + b.h));
    }
    return rows;
  }
  function arReport() {
    const units = arUnits();
    const rows = arRows(units);
    const hGaps = [], vGaps = [], overlaps = [];
    for (const r of rows) {
      for (let i = 1; i < r.items.length; i++) {
        hGaps.push(r.items[i].x - (r.items[i - 1].x + r.items[i - 1].w));
      }
    }
    for (let i = 1; i < rows.length; i++) {
      vGaps.push(rows[i].top - rows[i - 1].bottom);
    }
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          overlaps.push([i, j]);
        }
      }
    }
    const bounds = boundsOf(state.items.filter(i => i.kind === 'image'), 0);
    return JSON.stringify({
      rows: rows.length, hGaps, vGaps, overlaps,
      aspect: Math.round((bounds.w / Math.max(bounds.h, 1)) * 100) / 100,
    });
  }
  function arSnapshot() {
    return JSON.stringify(state.items.filter(i => i.kind === 'image')
      .map(i => [i.id, Math.round(i.x * 100) / 100, Math.round(i.y * 100) / 100, i.w, i.h]));
  }
`;

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const fmt = arr => arr.map(v => Math.round(v * 10) / 10).join(', ') || 'yok';

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-arrange-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  let ws = null;
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);

    const ready = Date.now() + 25000;
    let isReady = false;
    while (Date.now() < ready) {
      try {
        isReady = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth");
        if (isReady) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!isReady) throw new Error('renderer hazır olmadı');
    await sleep(1200);

    // 5 farklı boyutta görsel ekle
    const added = await evaluate(ws, `(async () => {
      const sizes = [[320, 200], [150, 260], [240, 240], [120, 120], [420, 160]];
      const files = [];
      for (let i = 0; i < sizes.length; i++) {
        const [w, h] = sizes[i];
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'hsl(' + (i * 64) + ',70%,55%)');
        grad.addColorStop(1, 'hsl(' + (i * 64 + 40) + ',70%,45%)');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        files.push(new File([blob], 'diz-' + i + '.png', { type: 'image/png' }));
      }
      await addFiles(files, null);
      return state.items.filter(i => i.kind === 'image').length;
    })()`);
    await sleep(1400);
    check('5 görsel eklendi', added === 5, String(added));

    // Dağınık bir başlangıç: boyutlar aynı, konumlar kaotik
    await evaluate(ws, `(() => {
      const imgs = state.items.filter(i => i.kind === 'image');
      imgs.forEach((it, i) => {
        it.x = 140 + i * 260 + (i % 2) * 37;
        it.y = 120 + (i % 3) * 230 - i * 11;
        it.rot = 0;
      });
      selection = new Set(imgs.map(i => i.id));
      selectionOrder = imgs.map(i => i.id);
      syncAll(); syncSelection();
      return imgs.length;
    })()`);
    await sleep(400);

    const beforeArrange = JSON.parse(await evaluate(ws, `${IN_PAGE_HELPERS}; arSnapshot()`));

    // Tek seçimde düğme pasif olmalı
    await evaluate(ws, `(() => {
      const id = state.items.find(i => i.kind === 'image').id;
      selection = new Set([id]); syncSelection();
    })()`);
    await sleep(150);
    const singleBlocked = await evaluate(ws, "document.getElementById('btnArrange').disabled === true");
    check('tek öğede "Diz" pasif', singleBlocked === true, String(singleBlocked));

    // Tümünü seç ve düğmeye bas
    await evaluate(ws, `(() => {
      const imgs = state.items.filter(i => i.kind === 'image');
      selection = new Set(imgs.map(i => i.id));
      selectionOrder = imgs.map(i => i.id);
      syncSelection();
    })()`);
    await sleep(200);
    const multiEnabled = await evaluate(ws, "document.getElementById('btnArrange').disabled === false");
    check('çoklu seçimde "Diz" etkin', multiEnabled === true, String(multiEnabled));

    await evaluate(ws, "document.getElementById('btnArrange').click()");
    await sleep(700);

    const afterArrange = JSON.parse(await evaluate(ws, `${IN_PAGE_HELPERS}; arSnapshot()`));
    const report = JSON.parse(await evaluate(ws, `${IN_PAGE_HELPERS}; arReport()`));

    // 1) Boyutlar korunuyor
    const sizesKept = afterArrange.length === beforeArrange.length && afterArrange.every((row, i) =>
      row[3] === beforeArrange[i][3] && row[4] === beforeArrange[i][4]);
    check('boyutlar değişmedi', sizesKept, afterArrange.map(r => r[3] + '×' + r[4]).join(' '));

    // 2) Üst üste binme yok
    check('öğeler üst üste binmiyor', report.overlaps.length === 0, JSON.stringify(report.overlaps));

    // 3) Satır içi boşluklar tam 14
    const hBad = report.hGaps.filter(g => !near(g, GAP));
    check('satır içi boşluk eşit (' + GAP + ')', report.hGaps.length > 0 && hBad.length === 0, fmt(report.hGaps));

    // 4) Satır aralıkları tam 14 — tek satıra sığan dizimde dikey boşluk
    //    yoktur; bu meşru bir çıktıdır (ekran oranına dengeli dizim).
    const vBad = report.vGaps.filter(g => !near(g, GAP));
    check('satır aralığı eşit (' + GAP + ')', report.vGaps.length === 0 || vBad.length === 0,
      report.vGaps.length === 0 ? 'tek satır · satır=' + report.rows : fmt(report.vGaps));

    // 5) Blok ekranla makul biçimde dengeli (aşırı ince/uzun değil)
    check('blok biçimi dengeli', report.aspect > 0.5 && report.aspect < 3.2, String(report.aspect));

    // 6) Geri al konumları geri getiriyor
    await evaluate(ws, 'undo()');
    await sleep(500);
    const afterUndo = JSON.parse(await evaluate(ws, `${IN_PAGE_HELPERS}; arSnapshot()`));
    const undoOk = afterUndo.length === beforeArrange.length && afterUndo.every((row, i) =>
      near(row[1], beforeArrange[i][1], 0.5) && near(row[2], beforeArrange[i][2], 0.5));
    check('Ctrl+Z eski konumlara dönüyor', undoOk,
      undoOk ? '' : JSON.stringify(afterUndo.map((r, i) => [r[1], r[2], beforeArrange[i][1], beforeArrange[i][2]]).slice(0, 2)));

    /* ---- grup davranışı ---- */
    await evaluate(ws, `(() => {
      const imgs = state.items.filter(i => i.kind === 'image');
      selection = new Set([imgs[0].id, imgs[1].id]);
      selectionOrder = [imgs[0].id, imgs[1].id];
      groupSelection();
    })()`);
    await sleep(500);

    const relBefore = JSON.parse(await evaluate(ws, `(() => {
      const imgs = state.items.filter(i => i.kind === 'image');
      return JSON.stringify({ gid: imgs[0].groupId || null,
        dx: Math.round((imgs[1].x - imgs[0].x) * 100) / 100,
        dy: Math.round((imgs[1].y - imgs[0].y) * 100) / 100 });
    })()`));
    check('grup oluştu', !!relBefore.gid, String(relBefore.gid));

    await evaluate(ws, `(() => {
      const imgs = state.items.filter(i => i.kind === 'image');
      selection = new Set(imgs.map(i => i.id));
      selectionOrder = imgs.map(i => i.id);
      syncSelection();
      document.getElementById('btnArrange').click();
    })()`);
    await sleep(700);

    const groupAfter = JSON.parse(await evaluate(ws, `(() => {
      const imgs = state.items.filter(i => i.kind === 'image');
      return JSON.stringify({
        dx: Math.round((imgs[1].x - imgs[0].x) * 100) / 100,
        dy: Math.round((imgs[1].y - imgs[0].y) * 100) / 100,
        sameGroup: imgs[0].groupId === imgs[1].groupId && !!imgs[0].groupId,
      });
    })()`));
    const groupKept = groupAfter.sameGroup
      && near(groupAfter.dx, relBefore.dx, 0.5)
      && near(groupAfter.dy, relBefore.dy, 0.5);
    check('grup içi yerleşim korunuyor', groupKept,
      `önce ${relBefore.dx},${relBefore.dy} · sonra ${groupAfter.dx},${groupAfter.dy}`);

    const groupReport = JSON.parse(await evaluate(ws, `${IN_PAGE_HELPERS}; arReport()`));
    check('gruplu dizimde üst üste binme yok', groupReport.overlaps.length === 0,
      JSON.stringify(groupReport.overlaps));

    const gHBad = groupReport.hGaps.filter(g => !near(g, GAP));
    check('grup bloğu da 14 boşlukla diziliyor', groupReport.hGaps.length > 0 && gHBad.length === 0,
      fmt(groupReport.hGaps));
    const gVBad = groupReport.vGaps.filter(g => !near(g, GAP));
    check('grup satır aralığı 14', groupReport.vGaps.length === 0 || gVBad.length === 0,
      groupReport.vGaps.length === 0 ? 'tek satır · satır=' + groupReport.rows : fmt(groupReport.vGaps));

  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(600);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
  }

  console.log(`\n${pass} geçti · ${fail} başarısız`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error('TEST HATASI:', err && err.message ? err.message : err);
  process.exit(1);
});
