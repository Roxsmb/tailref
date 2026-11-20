'use strict';
/* =========================================================
   mask-snap-soak.js — büyük mask src tokenleştirme yıpranması
   ---------------------------------------------------------
   02-state-db.js maskSnap: büyük (>=8 KB) layer.mask.src dataURL'leri
   undo snapshot'larına her seferinde gömülmez; yan tabloda bir kez
   tutulup snapshot'a srcRef tokeni yazar, sayaçlı bırakılır.
   Bu soak: (A) çoklu büyük mask üretimi + pushUndo fırtınası,
   (B) undo/redo döngüleri, (C) mask-parite (restore sonrası mask
   kayboldu mu), (D) yığın düşüşünde sayaç bütçesi (sızma denetimi),
   (E) undoSnap hız ölçümü (inkPerf undoSnap/undoSnapBytes).
   Kullanım: node tests/mask-snap-soak.js   (kapı DEĞİL)
   NOT: sentetik olaylar — süreler SÖZDE-SÜRETTİR.
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9349;
const APP_PORT = 5217;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const electronPath = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

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
    const v = msg.result.result.value;
    resolve(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz değil */ }
    await sleep(400);
  }
  throw new Error('debug portu açılmadı (9349)');
}
function connect(page) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}
async function hazirla(ws) {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  const dk = Date.now() + 60000;
  let ready = false;
  while (Date.now() < dk) {
    ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('renderer hazır olmadı');
  let kapandi = false;
  for (let i = 0; i < 60 && !kapandi; i += 1) {
    kapandi = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (!w || w.hidden) return true;
      if (!document.querySelector('.pwOption.is-selected')) {
        const opt = document.querySelector('.pwOption[data-mode="auto"]');
        if (opt) opt.click();
      }
      const btn = document.getElementById('pwContinue');
      if (btn && !btn.disabled) btn.click();
      return !!w.hidden;
    })()`);
    if (!kapandi) await sleep(500);
  }
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-mss-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', '--remote-debugging-port=' + PORT, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const page = await waitForTarget();
    const ws = await connect(page);
    await hazirla(ws);

    /* ==== A: editörü aç + 3 büyük mask kur ==== */
    const genel = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '2600';
      document.getElementById('newCanvasH').value = '1700';
      document.getElementById('newCanvasName').value = 'MSS';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 200 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      /* 3 BENZERSİZ büyük gürültü maskesi üret (900×700 PNG dataURL) */
      const uc = document.createElement('canvas');
      uc.width = 900; uc.height = 700;
      const ux = uc.getContext('2d');
      const katmanlar = inkState().layers;
      const maskeBedel = [];
      for (let m = 0; m < 3 && m < katmanlar.length; m += 1) {
        const g = ux.getImageData(0, 0, 900, 700);
        for (let i = 0; i < g.data.length; i += 4) {
          g.data[i] = (i * 7 + m * 101) & 255;
          g.data[i + 1] = (i * 13 + m * 53) & 255;
          g.data[i + 2] = (i * 29 + m * 17) & 255;
          g.data[i + 3] = 255;
        }
        ux.putImageData(g, 0, 0);
        const src = uc.toDataURL('image/png');
        const hangi = katmanlar[m];
        hangi.mask = { src, w: 900, h: 700 };
        maskeBedel.push([hangi.id, src.length]);
      }
      return { acik: inkEditorIsOpen(), maskeBedel,
        maskSnapErisir: (typeof maskSnap !== 'undefined'),
        undoFonk: (typeof pushUndo === 'function' && typeof undo === 'function' && typeof redo === 'function') };
    })()`));
    console.log('A kurulum: ' + JSON.stringify(genel));
    if (!genel.undoFonk) { throw new Error('undo API erişilemedi'); }

    /* tabloların başlangıç görüntüsü */
    const tablolar0 = JSON.parse(await evaluate(ws, `(() => {
      const m = maskSnap;
      let refTop = 0;
      for (const v of m.refs.values()) refTop += v;
      return { benzersiz: m.of.size, token: m.seq, refTop,
        stack: undoStack.length, redo: redoStack.length };
    })()`));
    console.log('A tablolar başlangıç: ' + JSON.stringify(tablolar0));

    /* maskesi KAYITLIYMIŞ kopya (C parite için) */
    const maskeIzi = JSON.parse(await evaluate(ws, `(() => {
      const katmanlar = inkState().layers;
      return katmanlar.slice(0, 3).map(l => ({ id: l.id,
        var: !!(l.mask && l.mask.src), boy: (l.mask && l.mask.src || '').length }));
    })()`));
    console.log('A mask izi: ' + JSON.stringify(maskeIzi));

    /* ==== B: pushUndo fırtınası (90 push; her 6 push'ta mask DEĞİŞİR) ==== */
    const firtina = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const t0 = performance.now();
      let sayi = 0;
      for (let i = 0; i < 90; i += 1) {
        if (i % 6 === 0) {
          /* maskenin bir tanesini değiştir (yeni uzun src) */
          const katmanlar = inkState().layers;
          const target = katmanlar[i % katmanlar.length];
          const c = document.createElement('canvas');
          c.width = 900; c.height = 700;
          const x = c.getContext('2d');
          const g = x.getImageData(0, 0, 900, 700);
          for (let k = 0; k < g.data.length; k += 4) {
            g.data[k] = (k * 3 + i * 37) & 255;
            g.data[k + 1] = (k * 11 + i * 91) & 255;
            g.data[k + 3] = 255;
          }
          x.putImageData(g, 0, 0);
          target.mask = { src: c.toDataURL('image/png'), w: 900, h: 700 };
          await wait(5);
        }
        pushUndo();
        sayi++;
        await wait(2);
      }
      return { ms: Math.round(performance.now() - t0), sayi };
    })()`));
    console.log('B pushUndo fırtınası: ' + JSON.stringify(firtina));

    const tablolar1 = JSON.parse(await evaluate(ws, `(() => {
      const m = maskSnap;
      let refTop = 0;
      for (const v of m.refs.values()) refTop += v;
      const s = (typeof inkPerfSnapshot === 'function') ? inkPerfSnapshot() : null;
      const c = s ? s.counters : {};
      return { benzersiz: m.of.size, token: m.seq, refTop,
        stack: undoStack.length, redo: redoStack.length,
        snapOrt: c.undoSnapCount ? Math.round(c.undoSnapMs / c.undoSnapCount * 100) / 100 : null,
        snapMax: Math.round((c.undoSnapMaxMs || 0) * 100) / 100,
        bytesOrt: c.undoSnapCount ? Math.round((c.undoSnapBytes || 0) / c.undoSnapCount) : null };
    })()`));
    console.log('B tablolar fırtına sonrası: ' + JSON.stringify(tablolar1));

    /* ==== C: undo/redo döngüleri + mask parite denetimi ==== */
    const dongu = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const t0 = performance.now();
      let maskKayip = 0, maskDegisti = 0, maskBulundu = 0;
      const iz = id => {
        const l = inkState().layers.find(q => q.id === id);
        return l && l.mask ? l.mask.src.length : 0;
      };
      const dogumIz = ${JSON.stringify(maskeIzi.map(m => m.boy))};
      /* başlangıç izlerini sakla */
      const basIz = ${JSON.stringify(maskeIzi.map(m => m.id))}.map(id => iz(id));
      for (let i = 0; i < 30; i += 1) { undo(); await wait(8); }
      const undoSonIz = basIz.map((_, k) => iz(${JSON.stringify(maskeIzi.map(m => m.id))}[k]));
      for (let i = 0; i < 20; i += 1) { redo(); await wait(8); }
      const redoSonIz = basIz.map((_, k) => iz(${JSON.stringify(maskeIzi.map(m => m.id))}[k]));
      for (let k = 0; k < redoSonIz.length; k += 1) {
        if (redoSonIz[k] === 0 && dogumIz[k] > 0) maskKayip++;
        else if (redoSonIz[k] !== dogumIz[k] && redoSonIz[k] !== 0) maskDegisti++;
        else maskBulundu++;
      }
      return { ms: Math.round(performance.now() - t0), basIz, undoSonIz, redoSonIz,
        maskKayip, maskDegisti, maskBulundu };
    })()`));
    console.log('C undo/redo döngü + parite: ' + JSON.stringify(dongu));

    const tablolar2 = JSON.parse(await evaluate(ws, `(() => {
      const m = maskSnap;
      let refTop = 0;
      for (const v of m.refs.values()) refTop += v;
      return { benzersiz: m.of.size, token: m.seq, refTop,
        stack: undoStack.length, redo: redoStack.length };
    })()`));
    console.log('C tablolar döngü sonrası: ' + JSON.stringify(tablolar2));

    /* ==== D: yığın düşüşü (sızıntı denetimi): undo × hepatitten
       (undoStack'i 1'e düşür) sonra tablo küçülürü mü? ==== */
    const dusus = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const t0 = performance.now();
      let n = 0;
      while (undoStack.length > 1 && n < 200) { undo(); n++; await wait(4); }
      const m = maskSnap;
      let refTop = 0;
      for (const v of m.refs.values()) refTop += v;
      return { ms: Math.round(performance.now() - t0), n,
        benzersiz: m.of.size, token: m.seq, refTop,
        stack: undoStack.length, redo: redoStack.length };
    })()`));
    console.log('D tablolar yığın-düşüşünde: ' + JSON.stringify(dusus));

    /* ==== D2: tsunami push — redo temizliği + yığın taşması
       (maskSnapReleaseStack + shift-release devreye girer) ==== */
    const tsunami = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const t0 = performance.now();
      for (let i = 0; i < 70; i += 1) { pushUndo(); await wait(2); }
      const m = maskSnap;
      let refTop = 0;
      for (const v of m.refs.values()) refTop += v;
      return { ms: Math.round(performance.now() - t0),
        benzersiz: m.of.size, token: m.seq, refTop,
        stack: undoStack.length, redo: redoStack.length };
    })()`));
    console.log('D2 tablolar tsunami sonrası: ' + JSON.stringify(tsunami));

    /* ==== E: heap bandı ==== */
    const heap = JSON.parse(await evaluate(ws, `(() => {
      const h = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
      const k = inkState().layers.filter(l => l.mask).length;
      return { heap: h, maskliKatman: k };
    })()`));
    console.log('E heap: ' + JSON.stringify(heap));

    /* özet hüküm */
    const temiz = temizMi(dongu, tablolar2, dusus, tsunami, genel);
    console.log(temiz);
  } catch (e) {
    console.error('MSS HATASI: ' + (e && e.message ? e.message.slice(0, 400) : String(e)));
    process.exitCode = 1;
  } finally {
    try { app.kill(); } catch { /* */ }
    await sleep(300);
  }

  function temizMi(dongu, tab2, dusus, tsunami, genel) {
    /* parite ölçütü yalnız KAYIP: geçmiş tasaması çağırma sırasında
       maskenin o tarihte başka src olması legal (değişim=sızmasız bilgi) */
    const pariteEtiket = dongu.maskKayip === 0 ? 'TEMIZ' : 'BOZUK';
    /* bütçe ölçütleri: unik ≤ token ve ref ≤ taşan yığın toplamı */
    const butce = tsunami.benzersiz <= tsunami.token &&
      tsunami.refTop <= tsunami.stack + tsunami.redo;
    return 'HÜKM: mask-parite=' + (pariteEtiket +
      ' (kayıp=' + dongu.maskKayip + ', geçmiş-değişim=' + dongu.maskDegisti + ')') +
      ' · bütçe=' + (butce ? 'TEMIZ' : 'SIZMA![' + tsunami.benzersiz + '/' + tsunami.token +
        ' unik, ' + tsunami.refTop + ' ref / yığın ' + (tsunami.stack + tsunami.redo) + ']') +
      ' · düşüş[' + dusus.benzersiz + ' unik / ' + dusus.refTop + ' ref]' +
      (genel.maskSnapErisir ? '' : ' · maskSnap globale erişilemedi');
  }
})();
