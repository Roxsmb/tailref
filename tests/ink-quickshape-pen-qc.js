'use strict';

/* Şekil oturtma · GERÇEK KALEM QC (sentetik ama kalem profilli girdi).

   Fark: ink-quickshape-qc.js fare profilli olaylar kullanır (pointerType
   'mouse', tek örnek/olay, 83 Hz). Gerçekte kalem:
     · pointerType 'pen', pressure 0.3-0.7, tilt ≠ 0,
     · 60-90 Hz kare başına 2-4 BİRLEŞİK (coalesced) örnek,
     · yavaş kavisler sırasında zamanlayıcı sürekli yeniden kurulur.

   Kapsam:
   P1 · gerçekçi hızda çizilen daire, kalem BASILI bekletince dönüştürür
        (kind shape + canlı görüntü değişir) — "bırakmadan dönmüyor" kapanı.
   P2 · orta-vuruş duraksama: yay oturtur; kalem hareketi artık REVERT
        DEĞİL — Procreate tarzı CANLI AYAR (Tur 4). Şekil o haliyle
        commit edilir: parite birebir, raster boşluksuz.
   P14 · Shift-çizgi: kilit açılınca oturtur; sonraki hareket revert
         ETMEZ (Tur 4d F1). Commit shape/line, parite birebir.
   P15 · ayar ölü bölgesi: mikro kayma şekli ürkütmez, eşikte devreye
         girer ve donmadan sürer (Tur 4d F2).
   P16 · küçültmede pivot merkez: şekil yerinde küçülür, merkez sabit
         kalır (Tur 4d F3).
   P17 · smooth-on-null: tanınmayan dalga bekleyicide yerinde
         pürüzsüzleşir, zincir devamı boşluksuz (Tur 4e F4).
   P18 · yavaş sürünme: çizim ortasında dönüşüm YOK; duruşta köşeli iz
         kusursuz ÇOKGENE oturur (Tur 4f/4i/4k).
   P19 · Shift sallantı kilidi: aşağı-yukarı oynatma çizgiyi bükmez,
         dik gezinti eksen boyu uzatmaz (Tur 4h kalıcı eksen v3).
   P20 · bırakış-oturtması YOK (Tur 4i, Procreate modeli): beklemeden
         bırakış ham iz olarak commit edilir; bekletilen köşeli iz
         kusursuz ÇOKGENE oturur (Tur 4k).

   Kullanım: node tests/ink-quickshape-pen-qc.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9358;
const APP_PORT = 5234;
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
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
});

const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

async function waitForTarget(deadlineMs = 30000) {
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-pen-qc-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  const errors = [];
  let ws = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description || d.text || 'bilinmeyen hata');
      }
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    const res = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '1400';
      document.getElementById('newCanvasH').value = '1000';
      document.getElementById('newCanvasName').value = 'Pen QC';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      const canvas = document.getElementById('inkEditorCanvas');
      const fit = inkEditorUi.fit;
      const rect = canvas.getBoundingClientRect();
      const toClient = (nx, ny) => ({
        clientX: rect.left + fit.x + nx * fit.w,
        clientY: rect.top + fit.y + ny * fit.h,
      });

      inkSetTool('brush', { brushId: 'ink-hard' });
      const ink = inkState();
      ink.size = 48;
      ink.opacity = 1;
      ink.smoothing = 0.2;
      ink.color = '#ffffff';
      await wait(120);

      /* Kalem profilli olay: pointerType 'pen', basınç + eğim. Coalesced
         varsa gerçek tarayıcı gibi birleştirilmiş örnekler taşır. */
      let frameSeq = 0;
      const ev = (type, p, extra) => {
        const e = new PointerEvent(type, Object.assign({
          bubbles: true, composed: true, cancelable: true,
          pointerId: 11, pointerType: 'pen', isPrimary: true,
          clientX: p.clientX, clientY: p.clientY,
          button: 0, buttons: 1,
          pressure: p.pressure != null ? p.pressure : 0.45 + 0.1 * Math.sin(frameSeq),
          tiltX: 12, tiltY: -8,
        }, extra));
        if (p.coalesced && p.coalesced.length) {
          Object.defineProperty(e, 'getCoalescedEvents', { value: () => p.coalesced });
        }
        return e;
      };

      /* Bir kare: 2-3 birleşik örnek. Örnekler [fromPt..toPt] arasında
         eşit aralıklı; olayın kendisi SON örnektir (gerçek kalem gibi). */
      const frame = (fromPt, toPt, buttonBits) => {
        const n = 2 + (frameSeq % 2);
        const samples = [];
        for (let s = 1; s <= n; s += 1) {
          const t = s / n;
          samples.push({
            clientX: fromPt.clientX + (toPt.clientX - fromPt.clientX) * t,
            clientY: fromPt.clientY + (toPt.clientY - fromPt.clientY) * t,
            pressure: 0.4 + 0.15 * Math.abs(Math.sin(frameSeq * 3 + s)),
          });
        }
        frameSeq += 1;
        const last = samples[samples.length - 1];
        return ev('pointermove', {
          clientX: last.clientX, clientY: last.clientY,
          pressure: last.pressure, coalesced: samples,
        }, { buttons: buttonBits });
      };

      /* Gerçekçi daire: kare başına ~2 örnek, frameMs ≈ 16-24 ms.
         down anı: pointerdown (coalesced YOK), sonra kareler.
         startAng: vuruşun başlangıç açısı (varsayılan üst, -π/2) —
         tur 4 ayar testlerinde tutamak bölgesini seçmek için. */
      const drawCirclePen = async (nx, ny, rn, frames, frameMs, totalTurn, jseed, startAng) => {
        const a0 = startAng == null ? -Math.PI / 2 : startAng;
        let js = jseed;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.003;
        };
        let prev = toClient(nx + Math.cos(a0) * rn, ny + Math.sin(a0) * rn);
        canvas.dispatchEvent(ev('pointerdown', prev, { buttons: 1 }));
        await wait(frameMs);
        for (let i = 1; i <= frames; i += 1) {
          const t = i / frames;
          const ang = a0 + totalTurn * t;
          const r = rn * (1 + 0.04 * Math.sin(t * Math.PI * 3)) + jig() * rn;
          const cur = toClient(nx + Math.cos(ang) * r, ny + Math.sin(ang) * r);
          canvas.dispatchEvent(frame(prev, cur, 1));
          prev = cur;
          await wait(frameMs);
        }
      };
      const lift = async () => {
        const ui = inkEditorUi;
        inkEditorRebuildPreview(true);
        /* Parite kanıtı için canlı önizleme raster'ını sakla (commit
           SONRASI katman tuvaliyle karşılaştırılır). */
        lastPreviewData = ui.previewCanvas
          ? Array.from(new Uint8ClampedArray(ui.previewCanvas.getContext('2d').getImageData(0, 0, ui.previewCanvas.width, ui.previewCanvas.height).data))
          : null;
        canvas.dispatchEvent(ev('pointerup', {
          clientX: rect.left + fit.x + ui.stroke.points[ui.stroke.points.length - 1].x * fit.w,
          clientY: rect.top + fit.y + ui.stroke.points[ui.stroke.points.length - 1].y * fit.h,
          pressure: 0,
        }, { buttons: 0 }));
        await wait(600);
      };
      const lastStroke = () => {
        const layer = inkState().layers.find(l => l.id === inkEditorUi.layerId);
        const s = layer && layer.strokes.length ? layer.strokes[layer.strokes.length - 1] : null;
        return s ? { kind: s.kind, shape: s.shape, snapFree: s.snapFree || 0, points: s.points.length } : null;
      };
      const undoOnce = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(260);
      };
      const komposit = () => {
        try {
          const cp = document.createElement('canvas');
          cp.width = canvas.width;
          cp.height = canvas.height;
          const c2 = cp.getContext('2d');
          c2.setTransform(1, 0, 0, 1, 0, 0);
          c2.drawImage(canvas, 0, 0);
          return c2.getImageData(0, 0, cp.width, cp.height).data;
        } catch { return null; }
      };
      const diffPix = (a, b) => {
        if (!a || !b || a.length !== b.length) return -1;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - b[i]) > 12 || Math.abs(a[i + 1] - b[i + 1]) > 12 ||
              Math.abs(a[i + 2] - b[i + 2]) > 12 || Math.abs(a[i + 3] - b[i + 3]) > 12) n += 1;
        }
        return n;
      };

      /* ——— Tur 4 yardımcıları: canlı şekil ayarı testleri ——— */
      let lastPreviewData = null;
      const itWH = () => {
        const it = getItem(inkEditorUi.itemId);
        return { w: (it && it.w) || 1, h: (it && it.h) || 1 };
      };
      /* Vuruş bbox'ı DOKU px cinsinden (ayar iddiaları için). */
      const strokeBox = () => {
        const s = inkEditorUi.stroke;
        if (!s || !s.points || !s.points.length) return null;
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (const p of s.points) {
          mnx = Math.min(mnx, p.x); mny = Math.min(mny, p.y);
          mxx = Math.max(mxx, p.x); mxy = Math.max(mxy, p.y);
        }
        const k = itWH();
        return { w: (mxx - mnx) * k.w, h: (mxy - mny) * k.h, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 };
      };
      /* Kalem hareketi: fromPt→toPt arası steps adet coalesced kare. */
      const glide = async (fromPt, toPt, steps, ms) => {
        let prev = fromPt;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const cur = {
            clientX: fromPt.clientX + (toPt.clientX - fromPt.clientX) * t,
            clientY: fromPt.clientY + (toPt.clientY - fromPt.clientY) * t,
          };
          canvas.dispatchEvent(frame(prev, cur, 1));
          prev = cur;
          await wait(ms);
        }
      };
      /* Kalem profilli kare: köşeleri düz geçişle çiz (çokgen tanıma). */
      const drawSquarePen = async (nx, ny, rn, jseed) => {
        let js = jseed;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.002;
        };
        const corners = [
          [nx - rn, ny - rn], [nx + rn, ny - rn],
          [nx + rn, ny + rn], [nx - rn, ny + rn], [nx - rn, ny - rn + 0.002],
        ];
        let prev = toClient(corners[0][0], corners[0][1]);
        canvas.dispatchEvent(ev('pointerdown', prev, { buttons: 1 }));
        await wait(18);
        for (let c = 0; c < corners.length - 1; c += 1) {
          const ax = corners[c][0], ay = corners[c][1];
          const bx = corners[c + 1][0], by = corners[c + 1][1];
          for (let i = 1; i <= 14; i += 1) {
            const t = i / 14;
            const cur = toClient(ax + (bx - ax) * t + jig(), ay + (by - ay) * t + jig());
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(16);
          }
        }
      };
      /* Canlı önizleme == commit raster (piksel birebir). */
      const checkParity = () => {
        const lc = inkRuntime.itemCanvases.get(inkEditorUi.layerId);
        if (!lastPreviewData || !lc || lastPreviewData.length !== lc.width * lc.height * 4) return -1;
        const ld = Array.from(new Uint8ClampedArray(lc.getContext('2d').getImageData(0, 0, lc.width, lc.height).data));
        let m = 0;
        for (let i = 0; i < ld.length; i++) if (ld[i] !== lastPreviewData[i]) m++;
        return m;
      };
      /* BOŞLUK denetimi: commit edilmiş şeklin ardışık nokta çiftlerinin
         orta noktaları raster'da boyanmış olmalı (kapanış segmenti dahil).
         Kapanış noktası kaybolursa başlangıç dilimi boş kalır → yakalanır. */
      const strokeGapCheck = () => {
        const layer = inkState().layers.find(l => l.id === inkEditorUi.layerId);
        const lc = layer && inkRuntime.itemCanvases.get(layer.id);
        if (!layer || !layer.strokes.length || !lc) return null;
        const s = layer.strokes[layer.strokes.length - 1];
        const g = lc.getContext('2d');
        const k = itWH();
        const fails = [];
        for (let i = 1; i < s.points.length; i += 1) {
          const a = s.points[i - 1], b = s.points[i];
          const mx = Math.round((a.x + b.x) / 2 * k.w);
          const my = Math.round((a.y + b.y) / 2 * k.h);
          let alpha = 0;
          try {
            const img = g.getImageData(Math.max(0, mx - 1), Math.max(0, my - 1), 3, 3).data;
            for (let j = 3; j < img.length; j += 4) alpha = Math.max(alpha, img[j]);
          } catch { return { fails: ['imgerr'], n: s.points.length }; }
          if (alpha < 8) fails.push(i);
        }
        return { fails, n: s.points.length, shape: s.shape };
      };

      /* ——— P1 · gerçekçi hızda daire + BASILI bekletme ——— */
      await drawCirclePen(0.5, 0.45, 0.2, 70, 20, Math.PI * 2.06, 101); // ~1.4 sn çizim
      out.p1downKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
      const beforeHold = komposit();
      const beforeHoldImg = (() => {
        // Ana tuvalin ham ImageData'sı (canvasDiff karşılaştırması için)
        const g = canvas.getContext('2d');
        return g.getImageData(0, 0, canvas.width, canvas.height);
      })();
      await wait(950); // bekleme 550 ms + render payı — kalem HÂLÂ BASILI
      out.p1during = inkEditorUi.stroke
        ? inkEditorUi.stroke.kind + '/' + inkEditorUi.stroke.shape
        : null;
      out.p1liveDiff = diffPix(beforeHold, komposit());
      /* Teşhis: önizleme hattının o anki durumu */
      {
        const ui = inkEditorUi;
        const dumpScratch = c => {
          if (!c) return null;
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1;
          return n;
        };
        out.p1diag = {
          previewCanvas: !!ui.previewCanvas,
          scratch: !!ui.scratch,
          previewGl: !!ui.previewGl,
          sceneChip: ui.sceneChip ? { x: ui.sceneChip.x, y: ui.sceneChip.y, w: ui.sceneChip.w, h: ui.sceneChip.h } : null,
          previewDirty: !!ui.previewDirty,
          needsRender: !!ui.needsRender,
          previewCanvasPx: dumpScratch(ui.previewCanvas),
          scratchPx: dumpScratch(ui.scratch),
          tileViewOn: !!ui.tileViewOn,
          tvChipSeen: !!ui.tvChipSeen,
          tvLive: ui.tvLive ? ui.tvLive.size : null,
          tileDirty: ui.tileView && ui.tileView.dirty ? ui.tileView.dirty.size : null,
          tiles: ui.tileView && ui.tileView.tiles ? ui.tileView.tiles.size : null,
          brushTool: ui.stroke ? ui.stroke.tool : null,
          brushId: ui.stroke ? ui.stroke.brushId : null,
          pathEligible: ui.stroke && typeof inkStrokePathEligible === 'function'
            ? !!inkStrokePathEligible(ui.stroke, inkGetBrush(ui.stroke.brushId),
              Math.max(0.5, ui.stroke.size * (ui.layerCanvas ? ui.layerCanvas.width : 1))) : null,
          covRej: window.__covRej || null,
        };
        /* Ana tuvalin TEK BAŞINA diff'i (karolar hariç) */
        {
          const c2 = document.createElement('canvas');
          c2.width = canvas.width; c2.height = canvas.height;
          const g = c2.getContext('2d');
          g.drawImage(canvas, 0, 0);
          const dNow = g.getImageData(0, 0, c2.width, c2.height).data;
          const dBefore = (() => {
            const c3 = document.createElement('canvas');
            c3.width = canvas.width; c3.height = canvas.height;
            const g3 = c3.getContext('2d');
            g3.putImageData(beforeHoldImg, 0, 0);
            return g3.getImageData(0, 0, c3.width, c3.height).data;
          })();
          out.p1canvasDiff = diffPix(dBefore, dNow);
        }
      }
      await lift();
      out.p1committed = lastStroke();
      await undoOnce();
      await wait(200);

      /* ——— P2 · orta-vuruş duraksama → CANLI AYAR (Tur 4 sözleşmesi) ———
          200° çiz → duraksa: yay oturtur (shape/arc). Kalem hareketi
          artık revert DEĞİL: şekil canlı ayarlanır ve o haliyle
          commit edilir (parite birebir, raster boşluksuz). */
      {
        await drawCirclePen(0.3, 0.7, 0.16, 26, 18, Math.PI * (200 / 180), 201); // 200°
        await wait(950); // orta duraksama: yay oturtur
        out.p2midKind = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        // devam: 170° daha — hareket artık şekli AYARLAR (revert kalktı)
        let js = 202;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.002;
        };
        let prev = toClient(0.3 + Math.cos(Math.PI * (200 / 180) - Math.PI / 2) * 0.16,
          0.7 + Math.sin(Math.PI * (200 / 180) - Math.PI / 2) * 0.16);
        for (let i = 1; i <= 30; i += 1) {
          const t = i / 30;
          const ang = Math.PI * (200 / 180) + Math.PI * (170 / 180) * t - Math.PI / 2;
          const cur = toClient(0.3 + (Math.cos(ang) + jig()) * 0.16,
            0.7 + (Math.sin(ang) + jig()) * 0.16);
          canvas.dispatchEvent(frame(prev, cur, 1));
          prev = cur;
          await wait(18);
        }
        out.p2afterMove = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        out.p2afterShape = inkEditorUi.stroke ? (inkEditorUi.stroke.shape || '') : null;
        await wait(950); // ikinci duraksama: zaten oturtuldu, yeniden koşmaz
        out.p2endKind = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        await lift();
        out.p2committed = lastStroke();
        out.p2parity = checkParity();
        out.p2gap = strokeGapCheck();
        await undoOnce();
        await wait(200);
      }

      /* ——— P3 · daire CANLI BOYLAMA (ana özellik) ———
          Alttan başlayıp tam tur çiz → kalem alt kenar ortasında kalır
          → tutamak 'bottom'. AŞAĞI boyarken dikey eksen büyür, en
          SABİT kalır. Bırakınca şekil commit edilir: parite birebir,
          kapanış segmenti dahil raster boşluksuz. */
      {
        await drawCirclePen(0.55, 0.4, 0.14, 70, 20, Math.PI * 2.06, 301, Math.PI / 2);
        await wait(950); // oturtma: shape/circle
        out.p3snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const b0 = strokeBox();
        out.p3box0 = b0;
        // kalem bittiği yerden alt tutamağı aşağı boya (dikey eksen büyür)
        const penEnd = toClient(0.55 + Math.cos(Math.PI / 2 + Math.PI * 0.06) * 0.14,
          0.4 + Math.sin(Math.PI / 2 + Math.PI * 0.06) * 0.14);
        /* Eksen-saf hedef: hedef x = kalem-sonu x. Eski hedef (0.55, 0.66)
           ~26 item px yanal ofset taşıyordu; Tur 4d F2'nin küçük ölü
           bölgesi (0.03·r0) bu ofseti yakalayıp yatay ekseni de
           büyütüyordu. Hassasiyet istenen davranış — test hedefi düzeltildi. */
        await glide(penEnd, toClient(
          0.55 + Math.cos(Math.PI / 2 + Math.PI * 0.06) * 0.14, 0.4 + 0.26),
          22, 18);
        out.p3afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        out.p3afterShape = inkEditorUi.stroke ? (inkEditorUi.stroke.shape || '') : null;
        out.p3box1 = strokeBox();
        await lift();
        out.p3committed = lastStroke();
        out.p3parity = checkParity();
        out.p3gap = strokeGapCheck();
        await undoOnce();
        await wait(200);
      }

      /* ——— P4 · yatay boyama: en değişir, boy sabit ———
          Sağdan başlat → tutamak 'right'. SAĞA boyarken yatay eksen
          büyür, dikey eksen değişmez. */
      {
        await drawCirclePen(0.5, 0.75, 0.12, 70, 20, Math.PI * 2.06, 401, 0);
        await wait(950);
        out.p4snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const b0 = strokeBox();
        const penEnd = toClient(0.5 + Math.cos(Math.PI * 0.06) * 0.12,
          0.75 + Math.sin(Math.PI * 0.06) * 0.12);
        /* Eksen-saf hedef: hedef y = kalem-sonu y. Eski hedef (0.74, 0.75)
           ~22 item px dikey ofset taşıyordu; F2'nin küçük ölü bölgesi bu
           ofseti yakalayıp dikey ekseni de değiştiriyordu. */
        await glide(penEnd, toClient(0.5 + 0.24,
          0.75 + Math.sin(Math.PI * 0.06) * 0.12), 22, 18);
        out.p4afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        const b1 = strokeBox();
        out.p4box = { w0: b0.w, h0: b0.h, w1: b1.w, h1: b1.h };
        await lift();
        out.p4committed = lastStroke();
        await undoOnce();
        await wait(200);
      }

      /* ——— P5 · çizgi canlı uzatma: baş sabit, uç kalemi izler ——— */
      {
        const a = toClient(0.2, 0.82);
        canvas.dispatchEvent(ev('pointerdown', a, { buttons: 1 }));
        await wait(18);
        await glide(a, toClient(0.62, 0.8), 34, 16); // düz hat
        await wait(950); // oturtma: shape/line
        out.p5snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const s0 = inkEditorUi.stroke;
        out.p5first0 = s0 ? { x: s0.points[0].x, y: s0.points[0].y } : null;
        await glide(toClient(0.62, 0.8), toClient(0.78, 0.72), 20, 16); // uç kalemle
        const s1 = inkEditorUi.stroke;
        out.p5afterKind = s1 ? s1.kind : null;
        out.p5first = s1 ? { x: s1.points[0].x, y: s1.points[0].y } : null;
        out.p5last = s1
          ? { x: s1.points[s1.points.length - 1].x, y: s1.points[s1.points.length - 1].y }
          : null;
        await lift();
        out.p5committed = lastStroke();
        await undoOnce();
        await wait(200);
      }

      /* ——— P6 · kare (Tur 4k): köşeli kapalı iz kusursuz ÇOKGENE
          oturur (shape/poly, snapFree); köşeden dışa boyama merkezden
          tek-çapraz ölçekle sürer (her iki eksen eşit oranda büyür). ——— */
      {
        await drawSquarePen(0.28, 0.28, 0.09, 401);
        await wait(950); // bekletme: çokgene oturur
        out.p6snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const b0 = strokeBox();
        // kalem sol-üst köşede kaldı; köşeden DIŞARI doğru boya → büyür
        await glide(toClient(0.28 - 0.09, 0.28 - 0.09),
          toClient(0.28 - 0.17, 0.28 - 0.17), 18, 16);
        out.p6afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        const b1 = strokeBox();
        out.p6box = { w0: b0.w, h0: b0.h, w1: b1.w, h1: b1.h };
        await lift();
        out.p6committed = lastStroke();
        await undoOnce();
        await wait(200);
      }

      /* ——— P7 · mikro hareket (<8px) ayarı TETİKLEMEZ ———
          Oturtulan şekilde 8px altı kayma "titreşim" sayılır: şekil
          donuk kalır, bbox değişmez, kind korunur. */
      {
        await drawCirclePen(0.72, 0.3, 0.09, 60, 18, Math.PI * 2.03, 501);
        await wait(950);
        out.p7snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const b0 = strokeBox();
        // vuruşun bittiği yer: üst, hafif aşırı dönüş (≈ -π/2 + 0.03π)
        const penEnd = toClient(0.72 + Math.cos(-Math.PI / 2 + Math.PI * 0.03) * 0.09,
          0.3 + Math.sin(-Math.PI / 2 + Math.PI * 0.03) * 0.09);
        const tgt = { clientX: penEnd.clientX + 4, clientY: penEnd.clientY + 3 };
        await glide(penEnd, tgt, 6, 16); // toplam ~5px < 8px eşiği
        const b1 = strokeBox();
        out.p7box = { w0: b0.w, h0: b0.h, w1: b1.w, h1: b1.h };
        out.p7afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        await lift();
        out.p7committed = lastStroke();
        await undoOnce();
        await wait(200);
      }

      /* ——— P8 · iz/ghost temizliği (Tur 4b) ———
          Ayar sırasında şekil her karede yeniden üretilir; ÖNCEKİ
          karenin pikselleri scratch'te kalırsa kayan dairede bantlar
          görünür. Taban şeffaf olduğu için GÜNCEL şekil kutusu+padi
          dışındaki HER alfa pikseli ghost'tur. */
      {
        const ghostCount = () => {
          const ui = inkEditorUi;
          const s = ui.stroke;
          const sc = ui.scratch;
          if (!s || !sc) return null;
          const W = sc.width, H = sc.height;
          let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
          for (const p of s.points) {
            const x = p.x * W, y = p.y * H;
            if (x < mnx) mnx = x; if (y < mny) mny = y;
            if (x > mxx) mxx = x; if (y > mxy) mxy = y;
          }
          const sizePx = Math.max(0.5, s.size * W);
          const pad = sizePx * 1.8 + 6;
          const img = sc.getContext('2d').getImageData(0, 0, W, H).data;
          let ghost = 0;
          for (let y = 0; y < H; y += 2) {
            for (let x = 0; x < W; x += 2) {
              if (x >= mnx - pad && x <= mxx + pad &&
                  y >= mny - pad && y <= mxy + pad) continue;
              if (img[(y * W + x) * 4 + 3] > 0) ghost += 1;
            }
          }
          return ghost;
        };
        await drawCirclePen(0.35, 0.35, 0.12, 60, 18, Math.PI * 2.05, 701, Math.PI / 2);
        await wait(950);
        out.p8snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        // alt tutamak: önce AŞAĞI, sonra SAĞA — şekil bölge değiştirir
        const penEnd = toClient(0.35 + Math.cos(Math.PI / 2 + Math.PI * 0.05) * 0.12,
          0.35 + Math.sin(Math.PI / 2 + Math.PI * 0.05) * 0.12);
        const leg1 = toClient(0.36, 0.58);
        await glide(penEnd, leg1, 16, 16);
        await wait(140); // RAF: rebuild + ghost taraması
        out.p8ghostA = ghostCount();
        const leg2 = toClient(0.6, 0.58);
        await glide(leg1, leg2, 14, 16);
        await wait(140);
        out.p8ghostB = ghostCount();
        const leg3 = toClient(0.6, 0.34);
        await glide(leg2, leg3, 14, 16);
        await wait(140);
        out.p8ghostC = ghostCount();
        out.p8afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        await lift();
        out.p8committed = lastStroke();
        out.p8parity = checkParity();
        await undoOnce();
        await wait(200);
      }

      /* ——— P10 · eksen DEĞİŞİMİ (Tur 4b): aşağıdan sonra sağa ———
          Eski model tutamağı oturtma anında kilitliyordu: alt tutamakla
          sağa çekmek eni DEĞİŞTİREMEZDİ. Yeni modelde her eksen kendi
          çekmesiyle ayrı devreye girer. */
      {
        /* Başlangıç 0.3π: kalem sonu 0.35π'de biter — merkezin BELİRGİN
           sağında (off = +0.054 ≥ 3×off-latch eşiği 0.018) → sx=+1 ile
           büyüme kilitlenir. (startAng π/2 iken kalem sonu merkezin
           0.0188 SOLUNDA kalıyor; off-latch eşiği 0.0183'ü kıl payı
           aşıp sx=−1 kilitleniyor, 2. bacakta en minHalf'a çakılıyordu.) */
        await drawCirclePen(0.5, 0.45, 0.12, 60, 18, Math.PI * 2.05, 801,
          Math.PI * 0.3);
        await wait(950);
        out.p10snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const b0 = strokeBox();
        const penEnd = toClient(0.5 + Math.cos(Math.PI * 0.35) * 0.12,
          0.45 + Math.sin(Math.PI * 0.35) * 0.12);
        /* Eksen-saf hedefler: 1. bacak hedef x = kalem-sonu x, 2. bacak
           hedef y = 1. bacak sonu y. Eski hedeflerdeki küçük yanal
           ofsetler F2'nin küçük ölü bölgesinde çapraz ekseni
           kızıştırıyordu (leg1 +0.019 ofset → en büyüdü). */
        const leg1 = toClient(
          0.5 + Math.cos(Math.PI * 0.35) * 0.12, 0.45 + 0.28);
        await glide(penEnd, leg1, 18, 16); // 1) AŞAĞI
        const b1 = strokeBox();
        const leg2 = toClient(
          0.5 + Math.cos(Math.PI * 0.35) * 0.12 + 0.2,
          0.45 + 0.28);
        await glide(leg1, leg2, 18, 16); // 2) SAĞA
        const b2 = strokeBox();
        out.p10box = { w0: b0.w, h0: b0.h, w1: b1.w, h1: b1.h, w2: b2.w, h2: b2.h };
        out.p10afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        await lift();
        out.p10committed = lastStroke();
        out.p10parity = checkParity();
        await undoOnce();
        await wait(200);
      }

      /* ——— P11 · opaklık: şekil var olan vuruş opaklığıyla oluşur ——— */
      {
        ink.opacity = 0.5;
        await wait(80);
        await drawCirclePen(0.22, 0.5, 0.1, 56, 18, Math.PI * 2.05, 901, Math.PI / 2);
        await wait(950);
        out.p11snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        out.p11strokeOpacity = inkEditorUi.stroke ? inkEditorUi.stroke.opacity : null;
        // bandın tam dolu pikseli: ilk nokta halka üzerindedir; 3×3 pencerede
        // MAKS alfa örneklenir (kenar AA'sından kaçınmak için).
        const bandAlpha = c => {
          if (!c) return -1;
          const s = inkEditorUi.stroke;
          if (!s || !s.points.length) return -1;
          const W = c.width, H = c.height;
          const x = Math.round(s.points[0].x * W);
          const y = Math.round(s.points[0].y * H);
          const img = c.getContext('2d').getImageData(
            Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
          let a = 0;
          for (let j = 3; j < img.length; j += 4) a = Math.max(a, img[j]);
          return a;
        };
        out.p11liveAlpha = bandAlpha(inkEditorUi.previewCanvas || inkEditorUi.scratch);
        /* Commit sonrası ui.stroke temizlenir → prob konumunu ŞİMDİ sakla. */
        const s11 = inkEditorUi.stroke;
        const p11pt0 = s11 && s11.points.length
          ? { x: s11.points[0].x, y: s11.points[0].y } : null;
        await lift();
        out.p11committed = lastStroke();
        out.p11parity = checkParity();
        const layer = inkState().layers.find(l => l.id === inkEditorUi.layerId);
        const lc = layer && inkRuntime.itemCanvases.get(layer.id);
        out.p11commitAlpha = lc && p11pt0 ? (() => {
          const W = lc.width, H = lc.height;
          const x = Math.round(p11pt0.x * W), y = Math.round(p11pt0.y * H);
          const img = lc.getContext('2d').getImageData(
            Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
          let a = 0;
          for (let j = 3; j < img.length; j += 4) a = Math.max(a, img[j]);
          return a;
        })() : -1;
        await undoOnce();
        ink.opacity = 1;
        await wait(120);
      }

      /* ——— P12 · YUVARLAK köşeli kare: daire DEĞİL, kare tanınır ——— */
      {
        let js = 951;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.002;
        };
        const nx = 0.8, ny = 0.62, half = 0.085, cr = 0.014;
        const seg = async (ax, ay, bx, by) => {   // kenar ortası→kenar ortası
          for (let i = 1; i <= 10; i += 1) {
            const t = i / 10;
            const cur = toClient(ax + (bx - ax) * t + jig(), ay + (by - ay) * t + jig());
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(16);
          }
        };
        let prev = toClient(nx - half + cr, ny - half);
        canvas.dispatchEvent(ev('pointerdown', prev, { buttons: 1 }));
        await wait(18);
        // üst kenar (sol-üst köşe yayının sonundan sağ-üst yaya)
        await seg(nx - half + cr, ny - half, nx + half - cr, ny - half);
        // sağ-üst yay: 90°'lik çeyrek çember
        {
          const cx = nx + half - cr, cy = ny - half + cr;
          for (let i = 1; i <= 5; i += 1) {
            const t = i / 5;
            const ang = -Math.PI / 2 + Math.PI / 2 * t;
            const cur = toClient(cx + Math.cos(ang) * cr, cy + Math.sin(ang) * cr);
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(16);
          }
        }
        await seg(nx + half, ny - half + cr, nx + half, ny + half - cr);
        {
          const cx = nx + half - cr, cy = ny + half - cr;
          for (let i = 1; i <= 5; i += 1) {
            const t = i / 5;
            const ang = 0 + Math.PI / 2 * t;
            const cur = toClient(cx + Math.cos(ang) * cr, cy + Math.sin(ang) * cr);
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(16);
          }
        }
        await seg(nx + half - cr, ny + half, nx - half + cr, ny + half);
        {
          const cx = nx - half + cr, cy = ny + half - cr;
          for (let i = 1; i <= 5; i += 1) {
            const t = i / 5;
            const ang = Math.PI / 2 + Math.PI / 2 * t;
            const cur = toClient(cx + Math.cos(ang) * cr, cy + Math.sin(ang) * cr);
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(16);
          }
        }
        await seg(nx - half, ny + half - cr, nx - half, ny - half + cr);
        {
          const cx = nx - half + cr, cy = ny - half + cr;
          for (let i = 1; i <= 5; i += 1) {
            const t = i / 5;
            const ang = Math.PI + Math.PI / 2 * t;
            const cur = toClient(cx + Math.cos(ang) * cr, cy + Math.sin(ang) * cr);
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(16);
          }
        }
        /* Ham vuruşun kutusu + uç: oturtma 950 ms'yi beklemeden ÖNCE al. */
        out.p12rawBox = strokeBox();
        {
          const ptsNow = inkEditorUi.stroke ? inkEditorUi.stroke.points : [];
          out.p12rawN = ptsNow.length;
          const lp = ptsNow[ptsNow.length - 1];
          out.p12rawLast = lp ? { x: lp.x, y: lp.y } : null;
        }
        await wait(950);
        out.p12snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        out.p12n = inkEditorUi.stroke ? inkEditorUi.stroke.points.length : null;
        {
          const ptsNow = inkEditorUi.stroke ? inkEditorUi.stroke.points : [];
          const lp = ptsNow[ptsNow.length - 1];
          out.p12end = !!(lp && out.p12rawLast &&
            lp.x === out.p12rawLast.x && lp.y === out.p12rawLast.y);
        }
        const b = strokeBox();
        out.p12box = b ? { w: b.w, h: b.h } : null;
        await lift();
        out.p12committed = lastStroke();
        await undoOnce();
        await wait(200);
      }

      /* ——— P13 · çoklu fırça: yumuşak pastel fırçada da oturtma ——— */
      {
        inkSetTool('brush', { brushId: 'native-soft-pastel' });
        await wait(120);
        await drawCirclePen(0.65, 0.78, 0.09, 56, 18, Math.PI * 2.05, 1001, Math.PI / 2);
        await wait(950);
        out.p13snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const penEnd = toClient(0.65 + Math.cos(Math.PI / 2 + Math.PI * 0.05) * 0.09,
          0.78 + Math.sin(Math.PI / 2 + Math.PI * 0.05) * 0.09);
        await glide(penEnd, toClient(0.66, 0.94), 14, 16);
        out.p13afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        await lift();
        out.p13committed = lastStroke();
        out.p13parity = checkParity();
        out.p13gap = strokeGapCheck();
        await undoOnce();
        inkSetTool('brush', { brushId: 'ink-hard' });
        await wait(120);
      }

      /* ——— P9 · ayar + commit sonrası undo tam geri alır ——— */
      {
        const layer = inkState().layers.find(l => l.id === inkEditorUi.layerId);
        out.p9before = layer ? layer.strokes.length : -1;
        await drawCirclePen(0.5, 0.55, 0.1, 50, 18, Math.PI * 2.04, 601);
        await wait(950);
        const penEnd = toClient(0.5 + Math.cos(-Math.PI / 2 + Math.PI * 0.04) * 0.1,
          0.55 + Math.sin(-Math.PI / 2 + Math.PI * 0.04) * 0.1);
        await glide(penEnd, toClient(0.5, 0.3), 18, 16); // üst tutamağı yukarı boya
        out.p9afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        await lift();
        const layer2 = inkState().layers.find(l => l.id === inkEditorUi.layerId);
        out.p9mid = layer2 ? layer2.strokes.length : -1;
        await undoOnce();
        const layer3 = inkState().layers.find(l => l.id === inkEditorUi.layerId);
        out.p9after = layer3 ? layer3.strokes.length : -1;
      }

      /* ——— P14 · Shift-çizgi: oturtma + sonrası hareket revert ETMEZ
          (Tur 4d F1). Shift basılıyken bekleyici tamamen kapalı; kilit
          açılınca mikro devam hareketi bekleyiciyi kurar, duruş
          shape/line'a çevirir; sonraki hareket canlı ayar kalır. ——— */
      {
        const glideShift = async (fromPt, toPt, steps, ms, shift) => {
          let prev = fromPt;
          for (let i = 1; i <= steps; i += 1) {
            const t = i / steps;
            const cur = {
              clientX: fromPt.clientX + (toPt.clientX - fromPt.clientX) * t,
              clientY: fromPt.clientY + (toPt.clientY - fromPt.clientY) * t,
            };
            const nS = 2 + (frameSeq % 2);
            const samples = [];
            for (let s = 1; s <= nS; s += 1) {
              const u = s / nS;
              samples.push({
                clientX: prev.clientX + (cur.clientX - prev.clientX) * u,
                clientY: prev.clientY + (cur.clientY - prev.clientY) * u,
                pressure: 0.4 + 0.15 * Math.abs(Math.sin(frameSeq * 3 + s)),
              });
            }
            frameSeq += 1;
            const lastS = samples[samples.length - 1];
            canvas.dispatchEvent(ev('pointermove', {
              clientX: lastS.clientX, clientY: lastS.clientY,
              pressure: lastS.pressure, coalesced: samples,
            }, { buttons: 1, shiftKey: !!shift }));
            prev = cur;
            await wait(ms);
          }
        };
        window.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'Shift', bubbles: true, cancelable: true }));
        await wait(60);
        const a = toClient(0.5, 0.78), b = toClient(0.5, 0.30);
        canvas.dispatchEvent(ev('pointerdown', a, { shiftKey: true }));
        await wait(18);
        await glideShift(a, b, 24, 16, true);
        {
          const s = inkEditorUi.stroke;
          const x0 = s ? s.points[0].x : NaN;
          let dev = 0;
          if (s) for (const p of s.points) dev = Math.max(dev, Math.abs(p.x - x0));
          out.p14xDevItemPx = s ? +(dev * 1400).toFixed(2) : null;
        }
        window.dispatchEvent(new KeyboardEvent('keyup',
          { key: 'Shift', bubbles: true, cancelable: true }));
        await wait(60);
        /* Kilit açıldıktan sonra mikro devam: bekleyici yeniden kurulur. */
        await glideShift(b, toClient(0.5, 0.282), 6, 16, false);
        await wait(950);
        out.p14snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        /* Oturtma sonrası hareket: revert YOK — uç yukarı, canlı ayar. */
        await glide(toClient(0.5, 0.282), toClient(0.5, 0.16), 14, 16);
        out.p14afterKind = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
        await lift();
        out.p14committed = lastStroke();
        out.p14parity = checkParity();
        await undoOnce();
        await wait(200);
      }

      /* ——— P15 · ayar ölü bölgesi (Tur 4d F2): mikro kayma (3px adımlar)
          önce kutuyu oynatmaz (8px giriş kapısı + 0.03·r0 gürültü
          bandı); eşikte devreye girer ve SONRASINDA donmadan sürer. ——— */
      {
        await drawCirclePen(0.3, 0.5, 0.08, 44, 16, Math.PI * 2.03, 701);
        await wait(950);
        out.p15snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const b0 = strokeBox();
        const steps = [];
        let prev = toClient(0.3, 0.5);
        for (let i = 1; i <= 30; i += 1) {
          const cur = { clientX: prev.clientX + 3, clientY: prev.clientY };
          canvas.dispatchEvent(frame(prev, cur, 1));
          prev = cur;
          await wait(30);
          const b = strokeBox();
          steps.push(b ? +b.w.toFixed(2) : null);
        }
        let firstMove = -1, frozen = 0;
        for (let i = 0; i < steps.length; i += 1) {
          const w = steps[i], pw = i ? steps[i - 1] : (b0 ? b0.w : null);
          if (w != null && pw != null && Math.abs(w - pw) > 0.6 && firstMove < 0) {
            firstMove = i + 1;
          }
          if (firstMove >= 0 && w != null && pw != null &&
              Math.abs(w - pw) <= 0.6) frozen += 1;
        }
        await lift();
        await undoOnce();
        await wait(200);
        out.p15dz = { firstMove, frozen, w0: b0 ? +b0.w.toFixed(2) : null };
      }

      /* ——— P16 · küçültmede PİVOT MERKEZ (Tur 4d F3): tepe kenardan
          aşağı çekiş şekli YERİNDE küçültür — iki kenar da özgün
          merkeze simetrik çekilir, merkez sabit kalır; min eşiğe
          varmadan donma yok. ——— */
      {
        const cx0 = 0.62, cy0 = 0.38, rn = 0.07;
        await drawCirclePen(cx0, cy0, rn, 44, 16, Math.PI * 2.0, 801);
        await wait(950);
        out.p16snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        const cy0Item = cy0 * 1000;
        const boxOf = () => {
          const s = inkEditorUi.stroke;
          if (!s || !s.points || !s.points.length) return null;
          let mny = Infinity, mxy = -Infinity;
          for (const p of s.points) {
            mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y);
          }
          return { top: mny * 1000, h: (mxy - mny) * 1000,
            cy: (mny + mxy) / 2 * 1000 };
        };
        const b0 = boxOf();
        const fireY = rect.top + fit.y + (cy0 - rn * 0.98) * fit.h;
        const fireX = rect.left + fit.x + cx0 * fit.w;
        const steps = [];
        let prev = { clientX: fireX, clientY: fireY };
        let py = fireY;
        for (let i = 1; i <= 20; i += 1) {
          py += 4;
          const cur = { clientX: fireX, clientY: py };
          canvas.dispatchEvent(frame(prev, cur, 1));
          prev = cur;
          await wait(30);
          const b = boxOf();
          steps.push(b ? { top: +b.top.toFixed(1), cy: +b.cy.toFixed(1),
            h: +b.h.toFixed(1) } : null);
        }
        let minH = Infinity;
        for (const st of steps) if (st && st.h < minH) minH = st.h;
        let maxCyDrift = 0, shrinkSteps = 0, frozenAfterShrink = 0;
        let clampAt = -1, firstShrink = -1;
        for (let i = 0; i < steps.length; i += 1) {
          const st = steps[i], pr = i ? steps[i - 1] : b0;
          if (!st || !pr) continue;
          const dh = st.h - pr.h;
          if (Math.abs(st.cy - cy0Item) > maxCyDrift) {
            maxCyDrift = Math.abs(st.cy - cy0Item);
          }
          if (dh < -0.5) { shrinkSteps += 1; if (firstShrink < 0) firstShrink = i; }
          if (clampAt < 0 && i > 0 && st.h <= minH + 1.5) clampAt = i;
          /* Küçülme BAŞLADIKTAN sonra, min kenara varmadan donma = kusur.
             Giriş gecikmesi (8px sürükleme kapısı) sayılmaz. */
          if (firstShrink >= 0 && clampAt < 0 && i > firstShrink &&
              Math.abs(dh) <= 0.5) frozenAfterShrink += 1;
        }
        await lift();
        await undoOnce();
        await wait(200);
        out.p16shrink = { shrinkSteps, firstShrink, clampAt,
          frozenAfterShrink, maxCyDrift: +maxCyDrift.toFixed(2),
          h0: b0 ? +b0.h.toFixed(1) : null };
      }

      /* ——— P17 · smooth-on-null (Tur 4e): tanıyıcının hiçbir şekle
          dönüştürmediği dalga (2,5 periyot + 2. harmonik), bekleyicide
          YERİNDE pürüzsüzleşir; uçlar bit-birebir, hat yerinde kalır,
          zincir devamı boşluksuz. ——— */
      {
        ink.size = 24;
        await wait(120);
        const ax0 = 0.16, ay0 = 0.82, ax1 = 0.58, frames = 30;
        let prev = toClient(ax0, ay0);
        canvas.dispatchEvent(ev('pointerdown', prev, { buttons: 1 }));
        await wait(16);
        const jig = (seed => () => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return (seed / 0x7fffffff - 0.5) * 2;
        })(20260);
        for (let i = 1; i <= frames; i += 1) {
          const t = i / frames;
          const cur = toClient(
            ax0 + (ax1 - ax0) * t,
            ay0 + Math.sin(t * Math.PI * 5) * 0.03 +
              Math.sin(t * Math.PI * 10 + 1.3) * 0.012 + jig() * 0.004);
          canvas.dispatchEvent(frame(prev, cur, 1));
          prev = cur;
          await wait(16);
        }
        const before = inkEditorUi.stroke.points.map(p => ({ x: p.x, y: p.y }));
        const beforeLast = before[before.length - 1];
        await wait(950);
        const s1 = inkEditorUi.stroke;
        const after = s1.points.map(p => ({ x: p.x, y: p.y }));
        out.p17state = { kind: s1.kind, shape: s1.shape || '',
          snapped: inkEditorUi.snapped };
        /* Kıvrım (ikinci fark RMS, item px) önce/sonra */
        const curvRms = pts => {
          let sum = 0, cnt = 0;
          for (let i = 1; i < pts.length - 1; i += 1) {
            const d2 = Math.hypot(
              (pts[i + 1].x - 2 * pts[i].x + pts[i - 1].x) * 1400,
              (pts[i + 1].y - 2 * pts[i].y + pts[i - 1].y) * 1000);
            sum += d2 * d2; cnt += 1;
          }
          return cnt ? Math.sqrt(sum / cnt) : -1;
        };
        /* Şekil yerinde mi: yeni poliline'ı eski yay oranlarıyla karşılaştır */
        const cumOf = pts => {
          const c = [0];
          for (let i = 1; i < pts.length; i += 1) {
            c.push(c[i - 1] + Math.hypot((pts[i].x - pts[i - 1].x) * 1400,
              (pts[i].y - pts[i - 1].y) * 1000));
          }
          return c;
        };
        const cb = cumOf(before), ca = cumOf(after);
        const total = cb[cb.length - 1] || 1;
        let maxDev = 0;
        for (let i = 1; i < after.length - 1; i += 1) {
          const t = ca[i] / total;
          let j = 0;
          while (j < cb.length - 2 && cb[j + 1] / total < t) j += 1;
          const f = (cb[j + 1] - cb[j]) > 1e-9
            ? (t * total - cb[j]) / (cb[j + 1] - cb[j]) : 0;
          const ix = before[j].x + (before[j + 1].x - before[j].x) * f;
          const iy = before[j].y + (before[j + 1].y - before[j].y) * f;
          maxDev = Math.max(maxDev, Math.hypot((after[i].x - ix) * 1400,
            (after[i].y - iy) * 1000));
        }
        /* Zincir sürekliliği: 6 küçük hamleyle çizime devam (ham adım
           ≈ 9 client px; stabilizator lag'i nedeniyle sapma bantı geniş) */
        const lastBefore = after[after.length - 1];
        const stepItem = 9 / fit.w * 1400;
        const py0 = rect.top + fit.y + lastBefore.y * fit.h;
        let prevC = {
          clientX: rect.left + fit.x + lastBefore.x * fit.w, clientY: py0 };
        for (let i = 1; i <= 6; i += 1) {
          const cur = { clientX: prevC.clientX + 9, clientY: py0 };
          canvas.dispatchEvent(frame(prevC, cur, 1));
          prevC = cur;
          await wait(20);
        }
        const s2 = inkEditorUi.stroke;
        const cont = s2.points.map(p => ({ x: p.x, y: p.y }));
        const firstNew = cont[after.length];
        const gapItem = firstNew ? Math.hypot(
          (firstNew.x - lastBefore.x) * 1400,
          (firstNew.y - lastBefore.y) * 1000) : -1;
        await lift();
        out.p17 = {
          nBefore: before.length, nAfter: after.length,
          endpointsBitExact: !!(lastBefore.x === beforeLast.x &&
            lastBefore.y === beforeLast.y),
          curvRmsBefore: +curvRms(before).toFixed(2),
          curvRmsAfter: +curvRms(after).toFixed(2),
          curvRatio: +(curvRms(after) /
            Math.max(1e-6, curvRms(before))).toFixed(3),
          maxDevItemPx: +maxDev.toFixed(2),
          chainGapItemPx: +gapItem.toFixed(2),
          stepItemPx: +stepItem.toFixed(1),
          committed: lastStroke(),
        };
        await undoOnce();
        ink.size = 48;
        await wait(120);
      }

      /* ——— P18 · yavaş sürünme: çizim ortasında DÖNÜŞÜM YOK (Tur 4f
          v5.1 + Tur 4i). Salınımlı el titremesi + 60ms köşe
          duraksamalarıyla ~14 sn'de çizilen yuvarlatılmış dikdörtgen
          tüm vuruş boyunca 'stroke' kalır; duruşta (kalem basılı)
          bekletme köşeli izi kusursuz ÇOKGENE oturtur (Tur 4k).
          Eski koşul rawLen 28 item px'i aşınca vuruşu ortasında
          'line'a çeviriyordu. ——— */
      {
        ink.size = 24;
        ink.smoothing = 0.56;
        await wait(120);
        const rectPts = (cx, cy, hw, hh) => [
          [cx - hw, cy - hh], [cx + hw, cy - hh],
          [cx + hw, cy + hh], [cx - hw, cy + hh]];
        const roundedPoly = (pts, rad, per) => {
          const o = [];
          const nP = pts.length;
          for (let i = 0; i < nP; i += 1) {
            const p = pts[i], q = pts[(i + 1) % nP], w = pts[(i - 1 + nP) % nP];
            const d1 = Math.hypot(p[0] - w[0], p[1] - w[1]);
            const d2 = Math.hypot(q[0] - p[0], q[1] - p[1]);
            const r1 = Math.min(rad, d1 / 2), r2 = Math.min(rad, d2 / 2);
            const a = [p[0] + (w[0] - p[0]) / d1 * r1,
              p[1] + (w[1] - p[1]) / d1 * r1];
            const b = [p[0] + (q[0] - p[0]) / d2 * r2,
              p[1] + (q[1] - p[1]) / d2 * r2];
            for (let k = 0; k <= per; k += 1) {
              const t = k / per;
              o.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
          }
          return o;
        };
        /* Gerçekçi titreme: sınırlı salınım (rastgele yürüyüş DEĞİL). */
        const pts = roundedPoly(rectPts(0.5, 0.35, 0.09, 0.07), 0.02, 5);
        out.p18kinds = [];
        let prev = toClient(pts[0][0], pts[0][1]);
        canvas.dispatchEvent(ev('pointerdown', prev, { buttons: 1 }));
        await wait(18);
        out.p18kinds.push(inkEditorUi.stroke ? inkEditorUi.stroke.kind : 'yok');
        const nE = pts.length;
        for (let e = 0; e < nE; e += 1) {
          const ax = pts[e][0], ay = pts[e][1];
          const bx = pts[(e + 1) % nE][0], by = pts[(e + 1) % nE][1];
          for (let i = 1; i <= 22; i += 1) {
            const t = i / 22;
            const cur = toClient(
              ax + (bx - ax) * t + Math.sin((i + e * 13) * 0.85) * 0.0004,
              ay + (by - ay) * t + Math.cos((i + e * 7) * 1.1) * 0.0004);
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(24);
          }
          if (e < nE - 1) await wait(60);
          out.p18kinds.push(inkEditorUi.stroke ? inkEditorUi.stroke.kind : 'yok');
        }
        /* Ham uç + N: bekletme ÖNCE alınır (mükemmelleşme kıyaslaması). */
        {
          const ptsNow = inkEditorUi.stroke ? inkEditorUi.stroke.points : [];
          out.p18rawN = ptsNow.length;
          const lp = ptsNow[ptsNow.length - 1];
          out.p18rawLast = lp ? { x: lp.x, y: lp.y } : null;
        }
        await wait(950);
        out.p18snap = inkEditorUi.stroke
          ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
        out.p18n = inkEditorUi.stroke ? inkEditorUi.stroke.points.length : null;
        {
          const ptsNow = inkEditorUi.stroke ? inkEditorUi.stroke.points : [];
          const lp = ptsNow[ptsNow.length - 1];
          out.p18end = !!(lp && out.p18rawLast &&
            lp.x === out.p18rawLast.x && lp.y === out.p18rawLast.y);
        }
        await lift();
        out.p18committed = lastStroke();
        await undoOnce();
        ink.size = 48;
        ink.smoothing = 0.2;
        await wait(120);
      }

      /* ——— P19 · Shift sallantı kilidi (Tur 4h v3 — kalıcı eksen + NET
          eşik): sağa çizerken aşağı-yukarı oynatma çizgiyi BÜKMEZ;
          kilit donduktan sonra dik gezinti çizgiyi ne bükler ne eksen
          boyu uzatır (saf izdüşüm — dik bileşen tamamen atılır).
          Coalesced örnekler shiftKey taşır (gerçek tarayıcı
          davranışı; kilit örnek düzeyinde okur). ——— */
      {
        const drawTraceShift = async (pts, frameMs) => {
          const first = toClient(pts[0].x, pts[0].y);
          canvas.dispatchEvent(ev('pointerdown', first, { buttons: 1, shiftKey: true }));
          await wait(frameMs);
          let prev = first;
          for (let i = 1; i < pts.length; i += 1) {
            const cur = toClient(pts[i].x, pts[i].y);
            const n = 2 + (frameSeq % 2);
            const samples = [];
            for (let s = 1; s <= n; s += 1) {
              const u = s / n;
              samples.push({
                clientX: prev.clientX + (cur.clientX - prev.clientX) * u,
                clientY: prev.clientY + (cur.clientY - prev.clientY) * u,
                pressure: 0.4 + 0.15 * Math.abs(Math.sin(frameSeq * 3 + s)),
                /* Gerçek coalesced PointerEvent'ler üst olayın
                   modifiyelerini taşır — kilit örnek başına okur. */
                shiftKey: true,
              });
            }
            frameSeq += 1;
            const lastS = samples[samples.length - 1];
            canvas.dispatchEvent(ev('pointermove', {
              clientX: lastS.clientX, clientY: lastS.clientY,
              pressure: lastS.pressure, coalesced: samples,
            }, { buttons: 1, shiftKey: true }));
            prev = cur;
            await wait(frameMs);
          }
          return pts.map(p => ({ x: p.x, y: p.y }));
        };
        const shiftMeasure = (raw) => {
          const layer = inkState().layers.find(l => l.id === inkEditorUi.layerId);
          const st = layer && layer.strokes.length
            ? layer.strokes[layer.strokes.length - 1] : null;
          const m = {};
          if (st && st.kind === 'stroke' && st.points.length) {
            const y0 = st.points[0].y * 1000;
            const x0 = st.points[0].x * 1400;
            let maxDev = 0, tail = 0;
            for (const q of st.points) {
              const dev = Math.abs(q.y * 1000 - y0);
              maxDev = Math.max(maxDev, dev);
              if (q.x * 1400 > x0 + 250) tail = Math.max(tail, dev);
            }
            m.maxYDevItemPx = +maxDev.toFixed(2);
            m.tailDevItemPx = +tail.toFixed(2);
            m.axisDeg = st.shiftLock && st.shiftLock.axis != null
              ? Math.round(st.shiftLock.axis * 180 / Math.PI) : null;
            /* Dik gezinti: ham izede dx<1.2px koşularının net x kayması —
               kilit SAF İZDÜŞÜMDE dik hareket ilerleme ÜRETMEZ. */
            let blkStart = -1, blkBest = 0, blkSpan = 0;
            if (raw) {
              for (let i = 1; i < raw.length; i += 1) {
                const dx = Math.abs(raw[i].x - raw[i - 1].x) * 1400;
                if (dx < 1.2) {
                  if (blkStart < 0) blkStart = i - 1;
                  blkSpan = raw[i].x - raw[blkStart].x;
                  blkBest = Math.max(blkBest, Math.abs(blkSpan) * 1400);
                } else {
                  blkStart = -1; blkSpan = 0;
                }
              }
            }
            m.wanderXDriftItemPx = +blkBest.toFixed(2);
          }
          return m;
        };

        /* P19a · gerçekçi sallantı: ±12 item px, ilk 8 karede rampeli,
           ortada dik gezinti (x sabit) — kullanıcının el titremesi. */
        {
          window.dispatchEvent(new KeyboardEvent('keydown',
            { key: 'Shift', bubbles: true, cancelable: true }));
          await wait(80);
          const pts = [];
          for (let i = 0; i <= 44; i += 1) {
            const t = i / 44;
            const ramp = Math.min(1, i / 8);
            pts.push({ x: 0.25 + 0.45 * t, y: 0.40 + 0.012 * Math.sin(i * 0.9) * ramp });
          }
          const xHold = 0.25 + 0.45 * 0.5;
          for (let i = 1; i <= 10; i += 1) {
            pts.push({ x: xHold, y: 0.40 + 0.018 * Math.sin(i * 1.1) });
          }
          for (let i = 0; i <= 20; i += 1) {
            const t = i / 20;
            pts.push({ x: xHold + 0.225 * t, y: 0.40 + 0.012 * Math.sin(i * 0.8) });
          }
          const raw = await drawTraceShift(pts, 18);
          await lift();
          window.dispatchEvent(new KeyboardEvent('keyup',
            { key: 'Shift', bubbles: true, cancelable: true }));
          await wait(200);
          const m = shiftMeasure(raw);
          m.committed = lastStroke();
          out.p19a = m;
          await undoOnce();
          await wait(200);
        }

        /* P19b · stres: ±35 item px, rampsiz — sallantı çarpması baştan;
           NET ≥100px eşiği erken 45° donmasını engeller (eski davranışta
           tüm çizgi diyagonale sapıyordu). */
        {
          window.dispatchEvent(new KeyboardEvent('keydown',
            { key: 'Shift', bubbles: true, cancelable: true }));
          await wait(80);
          const pts = [];
          for (let i = 0; i <= 40; i += 1) {
            const t = i / 40;
            pts.push({ x: 0.25 + 0.45 * t, y: 0.40 + 0.035 * Math.sin(i * 0.9) });
          }
          const xHold = 0.25 + 0.45 * 0.5;
          for (let i = 1; i <= 10; i += 1) {
            pts.push({ x: xHold, y: 0.40 + 0.05 * Math.sin(i * 1.1) });
          }
          for (let i = 0; i <= 20; i += 1) {
            const t = i / 20;
            pts.push({ x: xHold + 0.225 * t, y: 0.40 + 0.03 * Math.sin(i * 0.8) });
          }
          const raw = await drawTraceShift(pts, 18);
          await lift();
          window.dispatchEvent(new KeyboardEvent('keyup',
            { key: 'Shift', bubbles: true, cancelable: true }));
          await wait(200);
          const m = shiftMeasure(raw);
          m.committed = lastStroke();
          out.p19b = m;
          await undoOnce();
          await wait(200);
        }
      }

      /* ——— P20 · bırakış-oturtması YOK (Tur 4i, Procreate modeli):
          kalemi BEKLEMEDEN bırakmak ASLA oturtmaz — boyama/karalama/
          çizgi bırakışları ham iz olarak commit edilir (kullanıcı:
          "boyamayı bitirip bırakıyorum yuvarlağa dönüşüyor"). Çizim
          boyunca VE commit'te 'stroke'; bekletilen aynı üçgen izi ise
          kusursuz ÇOKGENE oturur (Tur 4k). ——— */
      {
        /* Kullanıcı profili üçgen: domlu üst köşe + kapanma kancası. */
        const triangleTrace = () => {
          const pts = [];
          const jit = k => Math.sin(k * 12.9898) * 0.004;
          for (let i = 0; i <= 10; i += 1) {
            const t = i / 10;
            pts.push({ x: 0.34 - 0.05 * Math.sin(t * Math.PI) + t * 0.02 + jit(i) * 0.3,
                       y: 0.10 + 0.06 * (1 - Math.cos(t * Math.PI)) });
          }
          for (let i = 0; i <= 14; i += 1) {
            const t = i / 14;
            pts.push({ x: 0.36 - 0.16 * t + jit(i + 30) * 0.3,
                       y: 0.16 + 0.62 * t * t * 0.9 + 0.62 * t * 0.1 });
          }
          for (let i = 0; i <= 16; i += 1) {
            const t = i / 16;
            pts.push({ x: 0.20 + 0.60 * t + jit(i + 60) * 0.3, y: 0.78 + 0.14 * t * t });
          }
          for (let i = 0; i <= 14; i += 1) {
            const t = i / 14;
            pts.push({ x: 0.80 - 0.38 * t + jit(i + 90) * 0.3, y: 0.92 - 0.72 * t });
          }
          for (let i = 0; i <= 8; i += 1) {
            const t = i / 8;
            pts.push({ x: 0.42 + 0.07 * Math.sin(t * Math.PI * 0.9),
                       y: 0.20 + 0.06 * t + 0.03 * Math.sin(t * Math.PI) });
          }
          return pts;
        };
        /* Yuvarlatılmış köşeli dikdörtgen + kapanış kancası. */
        const roundedRectTrace = () => {
          const pts = [];
          const jit = k => Math.sin(k * 7.13) * 0.003;
          const r = 0.055;
          const x0 = 0.24, x1 = 0.74, y0 = 0.16, y1 = 0.78;
          for (let i = 0; i <= 12; i += 1) {
            const t = i / 12; const a = Math.PI + t * (Math.PI / 2);
            pts.push({ x: x0 + r + Math.cos(a) * -r, y: y0 + r + Math.sin(a) * -r });
          }
          for (let i = 0; i <= 12; i += 1) {
            const t = i / 12;
            pts.push({ x: x0 + r + (x1 - x0 - 2 * r) * t, y: y0 + jit(i) });
          }
          for (let i = 0; i <= 6; i += 1) {
            const t = i / 6; const a = -Math.PI / 2 + t * (Math.PI / 2);
            pts.push({ x: x1 - r + Math.cos(a) * r, y: y0 + r + Math.sin(a) * r });
          }
          for (let i = 0; i <= 12; i += 1) {
            const t = i / 12;
            pts.push({ x: x1 + jit(i + 20), y: y0 + r + (y1 - y0 - 2 * r) * t });
          }
          for (let i = 0; i <= 6; i += 1) {
            const t = i / 6; const a = 0 + t * (Math.PI / 2);
            pts.push({ x: x1 - r + Math.cos(a) * r, y: y1 - r + Math.sin(a) * r });
          }
          for (let i = 0; i <= 12; i += 1) {
            const t = i / 12;
            pts.push({ x: x1 - r - (x1 - x0 - 2 * r) * t, y: y1 + jit(i + 40) });
          }
          for (let i = 0; i <= 6; i += 1) {
            const t = i / 6; const a = Math.PI / 2 + t * (Math.PI / 2);
            pts.push({ x: x0 + r + Math.cos(a) * -r, y: y1 - r + Math.sin(a) * r });
          }
          for (let i = 0; i <= 12; i += 1) {
            const t = i / 12;
            pts.push({ x: x0 + jit(i + 60), y: y1 - r - (y1 - y0 - 2 * r) * t });
          }
          for (let i = 0; i <= 6; i += 1) {
            const t = i / 6;
            pts.push({ x: x0 + r + 0.03 * Math.sin(t * Math.PI),
                       y: y0 + r - 0.05 * t + 0.02 * Math.sin(t * Math.PI * 2) });
          }
          return pts;
        };
        /* Duraksamasız iz: 18ms kareler, ara bekleme yok — bekleyici
           ateşlemez; bırakış ham iz olarak commit edilir. */
        const drawTraceNoPause = async (pts, frameMs) => {
          const first = toClient(pts[0].x, pts[0].y);
          canvas.dispatchEvent(ev('pointerdown', first, { buttons: 1 }));
          await wait(frameMs);
          let prev = first;
          for (let i = 1; i < pts.length; i += 1) {
            const cur = toClient(pts[i].x, pts[i].y);
            canvas.dispatchEvent(frame(prev, cur, 1));
            prev = cur;
            await wait(frameMs);
          }
          return prev;
        };
        /* Hafif dalgalı düz çizgi (kullanıcının "normal çizgi"si). */
        const lineTrace = () => {
          const pts = [];
          for (let i = 0; i <= 30; i += 1) {
            const t = i / 30;
            pts.push({ x: 0.22 + 0.56 * t, y: 0.30 + 0.012 * Math.sin(i * 0.7) });
          }
          return pts;
        };
        const strokeOnly = (c) => !!c && c.kind === 'stroke' && c.snapFree !== 1;

        /* A) hızlı bırakılan ÇİZGİ → ham iz (yuvarlağa/çizgiye dönüşmez) */
        {
          await drawTraceNoPause(lineTrace(), 18);
          out.p20lineMid = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
          await lift();
          out.p20lineCommitted = lastStroke();
          await undoOnce();
          await wait(200);
        }
        /* B) hızlı bırakılan ÜÇGEN → ham iz */
        {
          await drawTraceNoPause(triangleTrace(), 18);
          out.p20triMid = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
          await lift();
          out.p20triCommitted = lastStroke();
          await undoOnce();
          await wait(200);
        }
        /* C) hızlı bırakılan DİKDÖRTGEN → ham iz; kutu birebir korunur
           (bırakış izi deforme etmez — blob/yuvarlaklaşma YOK). */
        {
          const rawPts = roundedRectTrace();
          await drawTraceNoPause(rawPts, 18);
          out.p20rectMid = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
          await lift();
          out.p20rectCommitted = lastStroke();
          let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
          for (const p of rawPts) {
            mnx = Math.min(mnx, p.x); mny = Math.min(mny, p.y);
            mxx = Math.max(mxx, p.x); mxy = Math.max(mxy, p.y);
          }
          out.p20rectRawBox = { w: (mxx - mnx) * 1400, h: (mxy - mny) * 1000 };
          const layer = inkState().layers.find(l => l.id === inkEditorUi.layerId);
          const st = layer && layer.strokes.length ? layer.strokes[layer.strokes.length - 1] : null;
          if (st) {
            let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
            for (const p of st.points) {
              a = Math.min(a, p.x); b = Math.min(b, p.y);
              c = Math.max(c, p.x); d = Math.max(d, p.y);
            }
            out.p20rectBox = { w: (c - a) * 1400, h: (d - b) * 1000 };
          }
          await undoOnce();
          await wait(200);
        }
        /* D) AYNI üçgen izi BEKLEMEDE (hold sözleşmesi): çizim bitince
           kalem 750 ms basılı durur → Tur 4j: şekle oturmaz, yerinde
           MÜKEMMELLEŞİR (kind 'stroke' kalır). */
        {
          await drawTraceNoPause(triangleTrace(), 18);
          out.p20triHoldMid = inkEditorUi.stroke ? inkEditorUi.stroke.kind : null;
          {
            const ptsNow = inkEditorUi.stroke ? inkEditorUi.stroke.points : [];
            out.p20triHoldRawN = ptsNow.length;
            const lp = ptsNow[ptsNow.length - 1];
            out.p20triHoldRawLast = lp ? { x: lp.x, y: lp.y } : null;
          }
          await wait(750);
          out.p20triHoldSnap = inkEditorUi.stroke
            ? inkEditorUi.stroke.kind + '/' + (inkEditorUi.stroke.shape || '') : null;
          out.p20triHoldN = inkEditorUi.stroke ? inkEditorUi.stroke.points.length : null;
          {
            const ptsNow = inkEditorUi.stroke ? inkEditorUi.stroke.points : [];
            const lp = ptsNow[ptsNow.length - 1];
            out.p20triHoldEnd = !!(lp && out.p20triHoldRawLast &&
              lp.x === out.p20triHoldRawLast.x && lp.y === out.p20triHoldRawLast.y);
          }
          await lift();
          out.p20triHoldCommitted = lastStroke();
          await undoOnce();
          await wait(200);
        }
      }

      return JSON.stringify(out);
    })()`));

    const o = res;
    check('çizim editörü açıldı', o.editorOpen === true, 'editör=' + o.editorOpen);
    if (!o.editorOpen) throw new Error('editör açılmadı');

    check('P1 kalem profilli girdiyle vuruş başladı', o.p1downKind === 'stroke', String(o.p1downKind));
    check('P1 kalem BASILI bekleyince shape oldu',
      String(o.p1during || '').startsWith('shape/'), o.p1during);
    check('P1 canlı görüntü değişti (kalem basılıyken)',
      (o.p1liveDiff | 0) > 300, 'diff=' + o.p1liveDiff);
    check('P1 commit circle + snapFree', o.p1committed &&
      o.p1committed.kind === 'shape' && o.p1committed.shape === 'circle' && o.p1committed.snapFree === 1,
      JSON.stringify(o.p1committed));
    console.log('P1 teşhis: ' + JSON.stringify(o.p1diag));

    /* Tur 4 sözleşmesi: revert kalktı — oturtma sonrası hareket şekli
       CANLI ayarlar; commit daima shape + snapFree, parite birebir,
       raster boşluksuz. */
    check('P2 orta duraksama shape oturdu',
      String(o.p2midKind || '').startsWith('shape/'), o.p2midKind);
    check('P2 hareketle canlı ayar (revert kalktı, shape kaldı)',
      o.p2afterMove === 'shape', o.p2afterMove + '/' + o.p2afterShape);
    check('P2 ikinci duraksama şekli bozmadı',
      String(o.p2endKind || '').startsWith('shape/'), o.p2endKind);
    check('P2 commit shape + snapFree', o.p2committed &&
      o.p2committed.kind === 'shape' && o.p2committed.snapFree === 1,
      JSON.stringify(o.p2committed));
    check('P2 parite birebir', o.p2parity === 0, 'mismatch=' + o.p2parity);
    check('P2 raster boşluksuz', !!o.p2gap && o.p2gap.fails.length === 0,
      JSON.stringify(o.p2gap));

    check('P3 daire oturdu', String(o.p3snap || '').startsWith('shape/'), o.p3snap);
    check('P3 boyama shape korundu', o.p3afterKind === 'shape',
      o.p3afterKind + '/' + o.p3afterShape);
    check('P3 dikey eksen büyüdü', !!o.p3box0 && !!o.p3box1 &&
      o.p3box1.h > o.p3box0.h * 1.15,
      'h ' + (o.p3box0 && o.p3box0.h) + '→' + (o.p3box1 && o.p3box1.h));
    check('P3 en sabit kaldı', !!o.p3box0 && !!o.p3box1 &&
      Math.abs(o.p3box1.w - o.p3box0.w) <= Math.max(8, o.p3box0.w * 0.1),
      'w ' + (o.p3box0 && o.p3box0.w) + '→' + (o.p3box1 && o.p3box1.w));
    check('P3 commit shape/circle + snapFree', o.p3committed &&
      o.p3committed.kind === 'shape' && o.p3committed.shape === 'circle' &&
      o.p3committed.snapFree === 1, JSON.stringify(o.p3committed));
    check('P3 parite birebir', o.p3parity === 0, 'mismatch=' + o.p3parity);
    check('P3 raster boşluksuz (kapanış segmenti dahil)',
      !!o.p3gap && o.p3gap.fails.length === 0, JSON.stringify(o.p3gap));

    check('P4 yatayda en büyüdü', !!o.p4box && o.p4box.w1 > o.p4box.w0 * 1.15,
      'w ' + (o.p4box && o.p4box.w0) + '→' + (o.p4box && o.p4box.w1));
    check('P4 dikey eksen sabit', !!o.p4box &&
      Math.abs(o.p4box.h1 - o.p4box.h0) <= Math.max(8, o.p4box.h0 * 0.1),
      'h ' + (o.p4box && o.p4box.h0) + '→' + (o.p4box && o.p4box.h1));
    check('P4 commit shape + snapFree', o.p4committed &&
      o.p4committed.kind === 'shape' && o.p4committed.snapFree === 1,
      JSON.stringify(o.p4committed));

    check('P5 çizgi oturdu', String(o.p5snap || '').startsWith('shape/line'),
      o.p5snap);
    check('P5 uç kalemi izledi', !!o.p5last &&
      Math.hypot(o.p5last.x - 0.78, o.p5last.y - 0.72) < 0.04,
      JSON.stringify(o.p5last));
    check('P5 baş nokta sabit', !!o.p5first0 && !!o.p5first &&
      Math.hypot(o.p5first.x - o.p5first0.x, o.p5first.y - o.p5first0.y) < 0.02,
      JSON.stringify({ a: o.p5first0, b: o.p5first }));
    check('P5 commit shape/line + snapFree', o.p5committed &&
      o.p5committed.kind === 'shape' && o.p5committed.shape === 'line' &&
      o.p5committed.snapFree === 1, JSON.stringify(o.p5committed));

    /* ——— P6 · kare (Tur 4k): köşeli kapalı iz kusursuz ÇOKGENE
        oturur (shape/poly, snapFree); köşeden dışa boyama merkezden
        tek-çapraz ölçekle sürer (her iki eksen eşit oranda büyür). ——— */
    check('P6 kare çokgene oturdu (shape/poly)',
      String(o.p6snap || '').startsWith('shape/poly'), o.p6snap);
    check('P6 dışa boyama büyüttü', !!o.p6box &&
      o.p6box.w1 > o.p6box.w0 * 1.2 && o.p6box.h1 > o.p6box.h0 * 1.2,
      JSON.stringify(o.p6box));
    check('P6 çapraz boyama iki ekseni eşit oranda büyüttü', !!o.p6box &&
      Math.abs((o.p6box.w1 / o.p6box.w0) / (o.p6box.h1 / o.p6box.h0) - 1) < 0.3,
      JSON.stringify(o.p6box));
    check('P6 commit shape/poly + snapFree', o.p6committed &&
      o.p6committed.kind === 'shape' && o.p6committed.shape === 'poly' &&
      o.p6committed.snapFree === 1,
      JSON.stringify(o.p6committed));

    check('P7 mikro hareket şekli değiştirmedi', !!o.p7box &&
      Math.abs(o.p7box.w1 - o.p7box.w0) < 4 && Math.abs(o.p7box.h1 - o.p7box.h0) < 4,
      JSON.stringify(o.p7box));
    check('P7 mikro harekette kind korundu', o.p7afterKind === 'shape',
      String(o.p7afterKind));

    check('P9 ayar+commit sonrası undo tam geri aldı',
      o.p9before === o.p9after && o.p9after >= 0 && o.p9mid === o.p9before + 1,
      o.p9before + '→' + o.p9mid + '→' + o.p9after);

    /* ——— P8 · iz/ghost ——— */
    check('P8 oturdu', String(o.p8snap || '').startsWith('shape/'), o.p8snap);
    check('P8 bölge değişiminde ghost YOK (1. bacak)', o.p8ghostA === 0,
      'ghost=' + o.p8ghostA);
    check('P8 bölge değişiminde ghost YOK (2. bacak)', o.p8ghostB === 0,
      'ghost=' + o.p8ghostB);
    check('P8 küçültmede ghost YOK (3. bacak)', o.p8ghostC === 0,
      'ghost=' + o.p8ghostC);
    check('P8 commit shape + snapFree + parite', o.p8committed &&
      o.p8committed.kind === 'shape' && o.p8committed.snapFree === 1 &&
      o.p8parity === 0, JSON.stringify({ s: o.p8committed, m: o.p8parity }));

    /* ——— P10 · eksen değişimi ——— */
    check('P10 oturdu', String(o.p10snap || '').startsWith('shape/'), o.p10snap);
    check('P10 1. bacak (AŞAĞI) boyu büyüttü', !!o.p10box &&
      o.p10box.h1 > o.p10box.h0 * 1.15, JSON.stringify(o.p10box));
    check('P10 1. bacak eni sabit tuttu', !!o.p10box &&
      Math.abs(o.p10box.w1 - o.p10box.w0) <= Math.max(8, o.p10box.w0 * 0.1),
      JSON.stringify(o.p10box));
    check('P10 2. bacak (SAĞA) ENİ büyüttü — eksen değişti', !!o.p10box &&
      o.p10box.w2 > o.p10box.w1 * 1.12, JSON.stringify(o.p10box));
    check('P10 2. bacak boyu sabit tuttu', !!o.p10box &&
      Math.abs(o.p10box.h2 - o.p10box.h1) <= Math.max(8, o.p10box.h1 * 0.08),
      JSON.stringify(o.p10box));
    check('P10 commit shape + snapFree + parite', o.p10committed &&
      o.p10committed.kind === 'shape' && o.p10committed.snapFree === 1 &&
      o.p10parity === 0, JSON.stringify({ s: o.p10committed, m: o.p10parity }));

    /* ——— P11 · opaklık ——— */
    check('P11 oturdu', String(o.p11snap || '').startsWith('shape/'), o.p11snap);
    check('P11 vuruş opaklığı fırça ayarından geldi (0.5)',
      o.p11strokeOpacity === 0.5, String(o.p11strokeOpacity));
    check('P11 canlı bant alfası ~%50 (127±24)', o.p11liveAlpha >= 103 &&
      o.p11liveAlpha <= 151, 'alpha=' + o.p11liveAlpha);
    check('P11 commit bant alfası canlı ile aynı', o.p11commitAlpha >= 0 &&
      Math.abs(o.p11commitAlpha - o.p11liveAlpha) <= 10,
      'live=' + o.p11liveAlpha + ' commit=' + o.p11commitAlpha);
    check('P11 canlı == commit (0.5 opaklıkta byte parite)', o.p11parity === 0,
      'mismatch=' + o.p11parity);

    /* ——— P12 · yuvarlak köşeli kare (Tur 4k) ———
        Köşeli kapalı iz kusursuz ÇOKGENE oturur (shape/poly, snapFree):
        köşe sayısı az, kapanış noktası yazılır, oran korunur. */
    check('P12 yuvarlak köşeli kare çokgene oturdu (shape/poly)',
      String(o.p12snap || '').startsWith('shape/poly'), o.p12snap);
    check('P12 çokgen köşe sayısı az (n ≤ 8)', !!o.p12n && o.p12n <= 8,
      'n=' + o.p12n);
    /* Not: "kare" fit-normalize uzayda çizildiği için item-px'de
       dikdörtgendir (1400×1000 en-boy). Doğru invariant: çokgen,
       ham vuruşun EN/BOY ORANINI korumalı (yapı kayması yasak). */
    check('P12 kare oranı korundu (ham vuruş oranına göre)', !!o.p12box &&
      !!o.p12rawBox && o.p12rawBox.h > 0 &&
      Math.abs(o.p12box.w / o.p12box.h - o.p12rawBox.w / o.p12rawBox.h) /
        Math.max(0.0001, o.p12rawBox.w / o.p12rawBox.h) < 0.12,
      'ham=' + JSON.stringify(o.p12rawBox) + ' commit=' + JSON.stringify(o.p12box));
    check('P12 commit shape/poly + snapFree', !!o.p12committed &&
      o.p12committed.kind === 'shape' && o.p12committed.shape === 'poly' &&
      o.p12committed.snapFree === 1,
      JSON.stringify(o.p12committed));

    /* ——— P13 · çoklu fırça ——— */
    check('P13 yumuşak fırçada oturdu', String(o.p13snap || '').startsWith('shape/'),
      o.p13snap);
    check('P13 yumuşak fırçada ayar + commit korundu', o.p13afterKind === 'shape' &&
      o.p13committed && o.p13committed.kind === 'shape' && o.p13committed.snapFree === 1,
      JSON.stringify({ a: o.p13afterKind, s: o.p13committed }));
    check('P13 yumuşak fırçada parite', o.p13parity === 0, 'mismatch=' + o.p13parity);
    check('P13 yumuşak fırçada raster boşluksuz', !!o.p13gap &&
      o.p13gap.fails.length === 0, JSON.stringify(o.p13gap));

    /* ——— P14 · Shift-çizgi: oturtma + sonrası hareket revert etmez ——— */
    check('P14 Shift kilitli segment x sapması ≤ 2 item px',
      o.p14xDevItemPx != null && o.p14xDevItemPx <= 2,
      'xDev=' + o.p14xDevItemPx);
    check('P14 kilit açılınca oturdu (shape/*)',
      String(o.p14snap || '').startsWith('shape/'), o.p14snap);
    check('P14 oturtma sonrası hareket revert ETMEDİ',
      o.p14afterKind === 'shape', o.p14afterKind);
    check('P14 commit shape/line + snapFree', o.p14committed &&
      o.p14committed.kind === 'shape' && o.p14committed.shape === 'line' &&
      o.p14committed.snapFree === 1 && o.p14committed.points <= 4,
      JSON.stringify(o.p14committed));
    check('P14 parite birebir', o.p14parity === 0, 'mismatch=' + o.p14parity);

    /* ——— P15 · ayar ölü bölgesi ——— */
    check('P15 daire oturdu', String(o.p15snap || '').startsWith('shape/'),
      o.p15snap);
    check('P15 ilk kutu tepkisi 3 adım içinde (ölü bölge + giriş kapısı)',
      !!o.p15dz && o.p15dz.firstMove >= 1 && o.p15dz.firstMove <= 3,
      JSON.stringify(o.p15dz));
    check('P15 ayar başladıktan sonra donma yok',
      !!o.p15dz && o.p15dz.frozen === 0, JSON.stringify(o.p15dz));

    /* ——— P16 · küçültmede pivot merkez ——— */
    check('P16 daire oturdu', String(o.p16snap || '').startsWith('shape/'),
      o.p16snap);
    check('P16 küçülme aktifti (≥6 adım)',
      !!o.p16shrink && o.p16shrink.shrinkSteps >= 6, JSON.stringify(o.p16shrink));
    check('P16 merkez sabit kaldı (drift ≤ 2.5 item px)', !!o.p16shrink &&
      o.p16shrink.maxCyDrift <= 2.5, 'drift=' + (o.p16shrink && o.p16shrink.maxCyDrift));
    check('P16 küçülme sırasında donma yok', !!o.p16shrink &&
      o.p16shrink.frozenAfterShrink === 0,
      'frozen=' + (o.p16shrink && o.p16shrink.frozenAfterShrink));

    /* ——— P17 · smooth-on-null ——— */
    check('P17 tanınmayan dalga stroke kaldı (shape SANILMADI)',
      !!o.p17state && o.p17state.kind === 'stroke' && !o.p17state.snapped,
      JSON.stringify(o.p17state));
    check('P17 yerinde pürüzsüzleşti (n değişti, uçlar bit-birebir)',
      !!o.p17 && o.p17.nAfter !== o.p17.nBefore && o.p17.endpointsBitExact,
      JSON.stringify({ nB: o.p17 && o.p17.nBefore, nA: o.p17 && o.p17.nAfter }));
    check('P17 kıvrım belirgin azaldı (ratio < 0.6)', !!o.p17 &&
      o.p17.curvRatio > 0 && o.p17.curvRatio < 0.6,
      'ratio=' + (o.p17 && o.p17.curvRatio));
    check('P17 hat yerinde kaldı (maxDev < 10 item px)', !!o.p17 &&
      o.p17.maxDevItemPx < 10, 'dev=' + (o.p17 && o.p17.maxDevItemPx));
    check('P17 zincir devamı boşluksuz (gap aralıkta)', !!o.p17 &&
      o.p17.chainGapItemPx >= 1 &&
      o.p17.chainGapItemPx <= o.p17.stepItemPx * 1.8,
      'gap=' + (o.p17 && o.p17.chainGapItemPx) +
        ' step=' + (o.p17 && o.p17.stepItemPx));
    check('P17 commit stroke kaldı', !!o.p17 && !!o.p17.committed &&
      o.p17.committed.kind === 'stroke', JSON.stringify(o.p17 && o.p17.committed));

    /* ——— P18 · yavaş sürünme: çizim ortasında dönüşüm yok (Tur 4f/4i);
         duruştan sonra köşeli iz ÇOKGENE oturur (Tur 4k) ——— */
    check('P18 çizim boyunca tüm anlar stroke (dönüşüm yok)',
      Array.isArray(o.p18kinds) && o.p18kinds.length >= 10 &&
      o.p18kinds.every(k => k === 'stroke'), JSON.stringify(o.p18kinds));
    check('P18 duruştan sonra çokgene oturdu (shape/poly)',
      String(o.p18snap || '').startsWith('shape/poly'), o.p18snap);
    check('P18 çokgen köşe sayısı az (n ≤ 8)', !!o.p18n && o.p18n <= 8,
      'n=' + o.p18n);
    check('P18 commit shape/poly + snapFree', !!o.p18committed &&
      o.p18committed.kind === 'shape' && o.p18committed.shape === 'poly' &&
      o.p18committed.snapFree === 1,
      JSON.stringify(o.p18committed));

    /* ——— P19 · Shift sallantı kilidi (Tur 4h v3) ——— */
    check('P19a kilit dondu (yatay eksen, 0°)',
      o.p19a && o.p19a.axisDeg === 0, JSON.stringify(o.p19a));
    check('P19a sallantı çizgiyi bükmedi (maxYDev ≤ 2 item px)',
      o.p19a && o.p19a.maxYDevItemPx <= 2, 'dev=' + (o.p19a && o.p19a.maxYDevItemPx));
    check('P19a kuyruk saf izdüşüm (tail ≤ 1 item px)',
      o.p19a && o.p19a.tailDevItemPx <= 1, 'tail=' + (o.p19a && o.p19a.tailDevItemPx));
    check('P19a dik gezinti ilerleme üretmedi (x kayması ≤ 2 item px)',
      o.p19a && o.p19a.wanderXDriftItemPx <= 2, 'drift=' + (o.p19a && o.p19a.wanderXDriftItemPx));
    check('P19a commit stroke (Shift çizgi şekle DÖNMEZ)',
      o.p19a && o.p19a.committed && o.p19a.committed.kind === 'stroke' &&
      o.p19a.committed.snapFree === 0, JSON.stringify(o.p19a && o.p19a.committed));
    check('P19b stres sallantıda eksen 0° dondu (45° sapması YOK)',
      o.p19b && o.p19b.axisDeg === 0, JSON.stringify(o.p19b));
    check('P19b giriş kırpışması dışında sapma yok (maxYDev ≤ 30 item px)',
      o.p19b && o.p19b.maxYDevItemPx <= 30, 'dev=' + (o.p19b && o.p19b.maxYDevItemPx));
    check('P19b kuyrukta saf izdüşüm (tail ≤ 2 item px)',
      o.p19b && o.p19b.tailDevItemPx <= 2, 'tail=' + (o.p19b && o.p19b.tailDevItemPx));
    check('P19b dik gezinti x kayması ≤ 2 item px',
      o.p19b && o.p19b.wanderXDriftItemPx <= 2, 'drift=' + (o.p19b && o.p19b.wanderXDriftItemPx));
    check('P19b commit stroke', o.p19b && o.p19b.committed &&
      o.p19b.committed.kind === 'stroke' && o.p19b.committed.snapFree === 0,
      JSON.stringify(o.p19b && o.p19b.committed));

    /* ——— P20 · bırakış-oturtması YOK (Tur 4i, Procreate modeli) ——— */
    check('P20 hızlı çizgi çizim boyunca stroke',
      o.p20lineMid === 'stroke', String(o.p20lineMid));
    check('P20 hızlı bırakılan ÇİZGİ ham iz olarak commit (dönüşüm YOK)',
      !!o.p20lineCommitted && o.p20lineCommitted.kind === 'stroke',
      JSON.stringify(o.p20lineCommitted));
    check('P20 hızlı üçgen çizim boyunca stroke',
      o.p20triMid === 'stroke', String(o.p20triMid));
    check('P20 hızlı bırakılan ÜÇGEN ham iz (poly YOK)',
      !!o.p20triCommitted && o.p20triCommitted.kind === 'stroke',
      JSON.stringify(o.p20triCommitted));
    check('P20 hızlı dikdörtgen çizim boyunca stroke',
      o.p20rectMid === 'stroke', String(o.p20rectMid));
    check('P20 hızlı bırakılan DİKDÖRTGEN ham iz (yuvarlaklaşma YOK)',
      !!o.p20rectCommitted && o.p20rectCommitted.kind === 'stroke',
      JSON.stringify(o.p20rectCommitted));
    check('P20 hızlı dikdörtgen kutusu birebir korundu (blob YOK)', !!o.p20rectBox && !!o.p20rectRawBox &&
      o.p20rectRawBox.w > 0 && o.p20rectRawBox.h > 0 &&
      Math.abs(o.p20rectBox.w - o.p20rectRawBox.w) / o.p20rectRawBox.w < 0.03 &&
      Math.abs(o.p20rectBox.h - o.p20rectRawBox.h) / o.p20rectRawBox.h < 0.03,
      'ham=' + JSON.stringify(o.p20rectRawBox) + ' commit=' + JSON.stringify(o.p20rectBox));
    check('P20 bekletilen üçgen ÇOKGENE oturdu (shape/poly — Tur 4k)',
      String(o.p20triHoldSnap || '').startsWith('shape/poly'), o.p20triHoldSnap);
    check('P20 bekletilen üçgen çokgen köşe sayısı az (n ≤ 6)',
      !!o.p20triHoldN && o.p20triHoldN <= 6,
      'n=' + o.p20triHoldN);
    check('P20 bekletilen üçgen commit shape/poly + snapFree',
      o.p20triHoldCommitted && o.p20triHoldCommitted.kind === 'shape' &&
      o.p20triHoldCommitted.shape === 'poly' &&
      o.p20triHoldCommitted.snapFree === 1,
      JSON.stringify(o.p20triHoldCommitted));

    check('Z sayfada çalışma zamanı hatası yok', errors.length === 0,
      errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++;
    console.log('HATA ' + (e && e.message));
  } finally {
    try { if (app && !app.killed) app.kill(); } catch { /* sessiz */ }
    try { if (ws) ws.close(); } catch { /* sessiz */ }
  }
  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
  process.exit(fail ? 1 : 0);
})();
