'use strict';

/* Şekil oturtma · ANA TAHTA QC (30-ink-tools yolu — editör PENCERESİ değil).

   İki gerçek tahta yüzeyini kapsar:
   · Görsele BAĞLI katman (0..1 yerel uzay; "Çizim Yap" akışı — kullanıcının
     ana çizim yüzeyi)  → B1..B4, B7..B11
   · GLOBAL (dünya-px uzay; tahta not katmanları) → B5, B6
     (0..1 clamp çökmesi regresyonu: orta noktalar (1,1)'e yuvarlanamaz)

   B1 · daire: basılı bekleyince CANLI oturtma + kalemle canlı BOYLAMA
        (alt tutamak aşağı → dikey eksen büyür, en sabit) + commit
        (shape/circle/snapFree, kapanış noktası: son == ilk) + canlı/commit
        parite + undo
   B2 · mikro hareket (<8px) şekli değiştirmez (bbox bit-bit aynı)
   B3 · Shift çizgi kilidi: oturtma hiç tetiklenmez (kind 'stroke' kalır)
   B4 · kare (Tur 4k): kusursuz ÇOKGENE oturur (shape/poly, snapFree);
         kind 'stroke' yerine shape/poly + snapFree; boyama merkez-ölçekle sürer + commit
   B5 · global katman serbest el: noktalar dünya-px kalır (clamp çökmesi YOK)
   B6 · global katman daire: oturtma + canlı ayar + commit
   B7 · EKSEN DEĞİŞİMİ (Tur 4b): alt tutamakla aşağı, sonra SAĞA — en de
        büyür (eski model tutamağı kilitliydi, en değişmezdi)
   B8 · ÇAPRAZ üst-sol: iki eksen birden, köken sola+yukarı gider
   B9 · YUVARLAK köşeli kare (Tur 4k): daire SANILMAZ — kusursuz
         ÇOKGENE oturur, kare oranı korunur
   B10· OPAKLIK: şekil var olan vuruş opaklığıyla oluşur (0.5 → ~127 alfa)
   B11· ÇOKLU FIRÇA: yumuşak pastel fırçada oturtma + ayar + commit

   Kullanım: node tests/ink-board-quickshape-qc.js
   ========================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9362;
const APP_PORT = 5241;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-board-qc-'));
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
      try {
        ready = await evaluate(ws, "typeof state !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      } catch { ready = false; }
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    /* Kalıcılık karşılama diyaloğu girdiyi yakalar; kapat. */
    await evaluate(ws, `(() => {
      const el = document.getElementById('persistenceWelcome');
      if (!el || el.hidden) return true;
      if (typeof closePersistenceWelcome === 'function') closePersistenceWelcome('auto');
      return !!el.hidden;
    })()`);
    await sleep(600);

    const res = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};

      /* Eski tahta-içi çizim yolu yalnızca test kapısıyla açılır. */
      window.__TailRef_INK_LEGACY_TEST__ = true;

      /* Karşılama diyaloğu boot'ta geç açılabilir: evaluate başında
         zorla kapat (ClosePersistenceWelcome modu auto yapar). */
      try {
        if (typeof closePersistenceWelcome === 'function') closePersistenceWelcome('auto');
      } catch { /* sessiz */ }
      const pwEl2 = document.getElementById('persistenceWelcome');
      if (pwEl2) pwEl2.hidden = true;
      out.pwHidden = pwEl2 ? pwEl2.hidden === true : 'yok';

      const ink = inkState();
      ink.tool = 'brush';
      ink.size = 24;
      ink.opacity = 1;
      ink.color = '#ffffff';
      ink.hardness = 1;
      ink.smoothing = 0;   // deterministik nokta akışı
      ink.shapeSnap = true; // ayar: Çizim Ayarları → Gelişmiş
      if (typeof inkSyncUI === 'function') inkSyncUI();

      /* ---- Görsele bağlı katman kur (kullanıcının "Çizim Yap" yüzeyi) ---- */
      const surface = document.createElement('canvas');
      surface.width = 800; surface.height = 600;
      const sctx = surface.getContext('2d');
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, 800, 600);
      const blob = await new Promise(r => surface.toBlob(r, 'image/png'));
      const imageId = 'img_board_qc';
      await idbPut('images', imageId, { blob, name: 'board-qc.png' });
      const entry = await decodeImage(blob);
      setImgCache(imageId, { img: entry.img, url: entry.url, name: 'board-qc.png' });
      const it = {
        id: 'it_board_qc', kind: 'image', imageId, title: 'board-qc',
        x: 150, y: 60, w: 800, h: 600, rot: 0, z: nextZ(),
      };
      state.items.push(it);
      const attLayer = inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Katman 1', pxW: 800, pxH: 600 });
      ink.activeLayerId = attLayer.id;
      const globalLayer = inkAddLayer({ kind: 'global', plane: 'above', name: 'Notlar' });
      ink.activeLayerId = attLayer.id; // inkAddLayer aktif katmanı değiştirebilir; geri koy
      out.setup = { att: attLayer && attLayer.id, glob: globalLayer && globalLayer.id, active: ink.activeLayerId };
      await wait(250);

      /* Dünya → ekran (görünüm ne olursa olsun doğru haritalanır). */
      const S = w => worldToScreen(w);
      const ev = (type, scr, extra) => new PointerEvent(type, Object.assign({
        bubbles: true, composed: true, cancelable: true,
        pointerId: 71, pointerType: 'pen', isPrimary: true,
        clientX: scr.x, clientY: scr.y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pressure: 0.5, tiltX: 10, tiltY: -6,
      }, extra || {}));

      /* DİKKAT: tahtanın kendi stage handler'ı pointermove/up'ı yutar;
         ink-smoke PEN_HELPER kalıbında hareketler window yüzeyine gider. */
      const down = (scr, extra) => {
        const t = document.elementFromPoint(scr.x, scr.y) || stage;
        t.dispatchEvent(ev('pointerdown', scr, extra));
      };
      const move = (scr, extra) => { window.dispatchEvent(ev('pointermove', scr, extra)); };
      const up = scr => { window.dispatchEvent(ev('pointerup', scr)); };

      /* Daire: down + kareler, pointerup YOK — test lift() ile kaldırır. */
      const drawCircle = async (cw, R, frames, frameMs, totalTurn, jseed, startAng, extra) => {
        const a0 = startAng == null ? -Math.PI / 2 : startAng;
        let js = jseed;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.004 * R;
        };
        let prev = null;
        for (let i = 0; i <= frames; i += 1) {
          const t = i / frames;
          const ang = a0 + totalTurn * t;
          const rr = R * (1 + 0.03 * Math.sin(t * Math.PI * 3));
          const w = { x: cw.x + Math.cos(ang) * rr + jig(), y: cw.y + Math.sin(ang) * rr + jig() };
          const scr = S(w);
          if (i === 0) { down(scr, extra); out.dbgAfterDown = live(); }
          else move(scr, extra);
          prev = scr;
          await wait(frameMs);
        }
        return prev;
      };

      const glide = async (fromScr, toScr, steps, ms, extra) => {
        let prev = fromScr;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          move({
            x: fromScr.x + (toScr.x - fromScr.x) * t,
            y: fromScr.y + (toScr.y - fromScr.y) * t,
          }, extra);
          prev = { x: fromScr.x + (toScr.x - fromScr.x) * t, y: fromScr.y + (toScr.y - fromScr.y) * t };
          await wait(ms);
        }
        return prev;
      };

      const lift = async (scr, ms) => { up(scr); await wait(ms); };

      /* Canlı vuruş durumu (ana tahta: inkPointer). */
      const live = () => {
        const p = (typeof inkPointer !== 'undefined') ? inkPointer : null;
        if (!p || !p.stroke) return null;
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (const q of p.stroke.points) {
          mnx = Math.min(mnx, q.x); mny = Math.min(mny, q.y);
          mxx = Math.max(mxx, q.x); mxy = Math.max(mxy, q.y);
        }
        return {
          kind: p.stroke.kind, shape: p.stroke.shape || '', snapped: !!p.snapped,
          shiftHeld: !!p.shiftHeld, n: p.stroke.points.length,
          layerId: p.layer ? p.layer.id : null,
          layerKind: p.layer ? p.layer.kind : null,
          fp: p.snapFirePt ? { x: Math.round(p.snapFirePt.x), y: Math.round(p.snapFirePt.y) } : null,
          adj: p.snapAdj ? { type: p.snapAdj.type, handle: p.snapAdj.handle,
            eng: p.snapAdj.eng ? { x: !!p.snapAdj.eng.x, y: !!p.snapAdj.eng.y } : null,
            sx: p.snapAdj.sx || 0, sy: p.snapAdj.sy || 0 } : null,
          box: { w: mxx - mnx, h: mxy - mny },
          x0: mnx, y0: mny,
          last: p.stroke.points.length
            ? { x: p.stroke.points[p.stroke.points.length - 1].x, y: p.stroke.points[p.stroke.points.length - 1].y }
            : null,
        };
      };

      const lastStrokeOf = layerId => {
        const layer = (inkState().layers || []).find(l => l.id === layerId);
        const s = layer && layer.strokes.length ? layer.strokes[layer.strokes.length - 1] : null;
        if (!s) return null;
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (const q of s.points) {
          mnx = Math.min(mnx, q.x); mny = Math.min(mny, q.y);
          mxx = Math.max(mxx, q.x); mxy = Math.max(mxy, q.y);
        }
        return {
          kind: s.kind, shape: s.shape || '', snapFree: s.snapFree || 0,
          n: s.points.length,
          box: { w: mxx - mnx, h: mxy - mny },
          first: { x: s.points[0].x, y: s.points[0].y },
          last: { x: s.points[s.points.length - 1].x, y: s.points[s.points.length - 1].y },
        };
      };

      const undoOnce = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(300);
      };
      const strokeCountOf = layerId => {
        const layer = (inkState().layers || []).find(l => l.id === layerId);
        return layer ? layer.strokes.length : -1;
      };

      const CC = { x: 150 + 400, y: 60 + 300 }; // görsel merkezi (dünya-px)

      /* ——— B1 · BAĞLI katman: canlı oturtma + canlı boylama + commit ——— */
      {
        try {
        const R = 70;
        const firstScr = S({ x: CC.x + Math.cos(Math.PI / 2) * 70, y: CC.y + Math.sin(Math.PI / 2) * 70 });
        out.b1firstScr = firstScr;
        out.b1hitAtFirst = (() => {
          const el = document.elementFromPoint(firstScr.x, firstScr.y);
          return el ? (el.id || el.className || el.tagName).toString().slice(0, 40) : null;
        })();
        const penEnd = await drawCircle(CC, R, 60, 18, Math.PI * 2.06, 11, Math.PI / 2); // alttan başla
        out.b1afterDownOnly = live();
        out.b1penEnd = penEnd;
        out.b1live = live();
        await wait(950); // BASILI bekle: oturtma canlı tetiklenmeli
        out.b1snapped = live();
        // alt tutamağı AŞAĞI boya: dikey eksen büyür, en sabit kalır
        const after = await glide(penEnd, { x: penEnd.x, y: penEnd.y + R * 2.5 }, 26, 18);
        out.b1after = live();
        out.b1layerId = (out.b1snapped || {}).layerId || null;
        await lift(after, 700);
        out.b1committed = out.b1layerId ? lastStrokeOf(out.b1layerId) : null;
        out.b1countAfterCommit = out.b1layerId ? strokeCountOf(out.b1layerId) : -1;
        await undoOnce();
        out.b1countAfterUndo = out.b1layerId ? strokeCountOf(out.b1layerId) : -1;
        } catch (e1) { out.b1err = (e1 && (e1.message || e1)) + ''; }
      }

      /* ——— B2 · mikro hareket (<8px) şekli değiştirmez ——— */
      {
        const R = 52;
        const penEnd = await drawCircle(CC, R, 56, 18, Math.PI * 2.03, 21);
        await wait(950);
        out.b2snap = live();
        const after = await glide(penEnd, { x: penEnd.x + 4, y: penEnd.y + 3 }, 6, 16); // ~5px < 8px
        out.b2after = live();
        out.b2layerId = (out.b2snap || {}).layerId || null;
        await lift(after, 700);
        out.b2committed = out.b2layerId ? lastStrokeOf(out.b2layerId) : null;
        await undoOnce();
      }

      /* ——— B3 · Shift çizgi kilidi: oturtma tetiklenmez ——— */
      {
        const shiftExtra = { shiftKey: true };
        const R = 60;
        const penEnd = await drawCircle(CC, R, 60, 18, Math.PI * 2.05, 31,
          -Math.PI / 2, shiftExtra);
        out.b3live = live();
        await wait(1100); // Shift ile uzun bekleme: snap ASLA gelmemeli
        out.b3afterHold = live();
        const after = await glide(penEnd, { x: penEnd.x + R * 1.2, y: penEnd.y }, 16, 18, shiftExtra);
        out.b3afterMove = live();
        out.b3layerId = (out.b3afterHold || {}).layerId || null;
        await lift(after, 700);
        out.b3committed = out.b3layerId ? lastStrokeOf(out.b3layerId) : null;
        await undoOnce();
      }

      /* ——— B4 · kare (Tur 4k): kusursuz ÇOKGENE oturur; merkezden
          orantılı ölçek + commit ——— */
      {
        const HS = 80; // yarım kenar (dünya-px)
        let js = 41;
        const jig = () => {
          js = (js * 1103515245 + 12345) & 0x7fffffff;
          return (js / 0x7fffffff - 0.5) * 0.05 * HS; // ±2 px: gerçek kalem sarsıntısı
        };
        const corners = [
          { x: CC.x - HS, y: CC.y - HS }, { x: CC.x + HS, y: CC.y - HS },
          { x: CC.x + HS, y: CC.y + HS }, { x: CC.x - HS, y: CC.y + HS },
          { x: CC.x - HS, y: CC.y - HS + 0.002 * HS },
        ];
        let prev = null;
        for (let seg = 0; seg < corners.length; seg += 1) {
          const scr = S(corners[seg]);
          if (seg === 0) { down(scr); prev = scr; await wait(18); continue; }
          const from = prev;
          for (let i = 1; i <= 30; i += 1) {
            const t = i / 30;
            move({
              x: from.x + (scr.x - from.x) * t + jig(),
              y: from.y + (scr.y - from.y) * t + jig(),
            });
            prev = { x: from.x + (scr.x - from.x) * t, y: from.y + (scr.y - from.y) * t };
            await wait(16);
          }
        }
        /* Ham durum: bekletme ÖNCE alınır (çokgen kıyaslaması). */
        out.b4raw = live();
        await wait(950);
        out.b4snap = live();
        // kalem sol-üst köşede; köşeden DIŞARI boya → merkezden büyür
        const after = await glide(
          { x: S(corners[0]).x, y: S(corners[0]).y },
          { x: S(corners[0]).x - HS * 0.7, y: S(corners[0]).y - HS * 0.7 }, 18, 16);
        out.b4after = live();
        out.b4layerId = (out.b4snap || {}).layerId || null;
        await lift(after, 700);
        out.b4committed = out.b4layerId ? lastStrokeOf(out.b4layerId) : null;
        await undoOnce();
      }

      /* ——— B5 · GLOBAL katman serbest el: clamp çökmesi YOK ——— */
      {
        ink.activeLayerId = globalLayer.id;
        await wait(80);
        const y0 = CC.y - 200;
        down(S({ x: CC.x - 140, y: y0 }));
        let prev = null;
        for (let i = 1; i <= 30; i += 1) {
          prev = S({ x: CC.x - 140 + i * 9, y: y0 + Math.sin(i / 4) * 14 });
          move(prev);
          await wait(12); // hızlı: oturtma beklemesine takılmasın
        }
        await lift(prev, 600);
        out.b5layerId = globalLayer.id;
        out.b5stroke = lastStrokeOf(globalLayer.id);
        // dünya-px uzayında kalmalı: çökme (1,1) ya da 0..1 kümesi yasak
        out.b5collapsed = out.b5stroke
          ? out.b5stroke.n < 10 || (out.b5stroke.box.w < 50 && out.b5stroke.box.h < 50)
          : true;
        await undoOnce();
      }

      /* ——— B6 · GLOBAL katman daire: oturtma + canlı ayar + commit ——— */
      {
        try {
        ink.activeLayerId = globalLayer.id;
        await wait(80);
        out.b6active = ink.activeLayerId === globalLayer.id;
        const R = 60;
        const gc = { x: CC.x, y: CC.y - 180 };
        const firstScr = S({ x: gc.x + Math.cos(Math.PI / 2) * R, y: gc.y + Math.sin(Math.PI / 2) * R });
        out.b6firstScr = firstScr;
        const hitEl6 = document.elementFromPoint(firstScr.x, firstScr.y);
        out.b6hit = hitEl6 ? (hitEl6.id || hitEl6.className || hitEl6.tagName).toString().slice(0, 40) : null;
        const penEnd = await drawCircle(gc, R, 56, 18, Math.PI * 2.05, 51, Math.PI / 2);
        out.b6afterDown = out.dbgAfterDown;
        await wait(950);
        out.b6snap = live();
        const after = await glide(penEnd, { x: penEnd.x, y: penEnd.y + R * 2.5 }, 24, 18);
        out.b6after = live();
        out.b6layerId = (out.b6snap || {}).layerId || null;
        await lift(after, 700);
        out.b6committed = out.b6layerId ? lastStrokeOf(out.b6layerId) : null;
        await undoOnce();
        } catch (e6) { out.b6err = (e6 && (e6.message || e6)) + ''; }
      }

      /* ——— B7 · EKSEN DEĞİŞİMİ (Tur 4b): aşağı çek sonra sağa çek ———
          Eski model tutamağı oturtma anında kilitlerdi; alt tutamakla
          sağa çekmek eni DEĞİŞTİREMEZDİ. Yeni modelde her eksen kendi
          belirgin çekmesiyle (≥0.22·r0) ayrı devreye girer. */
      {
        try {
        ink.activeLayerId = attLayer.id;
        await wait(80);
        const R = 64;
        const c7 = { x: CC.x - 320, y: CC.y };
        const penEnd = await drawCircle(c7, R, 56, 18, Math.PI * 2.05, 61, Math.PI / 2);
        await wait(950);
        out.b7snap = live();
        const afterDown = await glide(penEnd, { x: penEnd.x, y: penEnd.y + R * 2.2 }, 20, 16);
        out.b7afterDown = live();
        const afterRight = await glide(afterDown, { x: afterDown.x + R * 1.8, y: afterDown.y }, 20, 16);
        out.b7afterRight = live();
        out.b7layerId = (out.b7snap || {}).layerId || null;
        await lift(afterRight, 700);
        out.b7committed = out.b7layerId ? lastStrokeOf(out.b7layerId) : null;
        await undoOnce();
        } catch (e7) { out.b7err = (e7 && (e7.message || e7)) + ''; }
      }

      /* ——— B8 · ÇAPRAZ üst-sol büyütme: iki eksen birden ———
          Üstten tut, çapraz yukarı-sola çek: üst kenar yukarı, sol kenar
          sola izler → şekil üst-sola doğru büyür. */
      {
        try {
        ink.activeLayerId = attLayer.id;
        await wait(80);
        const R = 60;
        const c8 = { x: CC.x + 330, y: CC.y };
        const penEnd = await drawCircle(c8, R, 56, 18, Math.PI * 2.05, 71, -Math.PI / 2);
        await wait(950);
        out.b8snap = live();
        const after = await glide(penEnd, { x: penEnd.x - R * 1.7, y: penEnd.y - R * 1.7 }, 24, 16);
        out.b8after = live();
        out.b8layerId = (out.b8snap || {}).layerId || null;
        await lift(after, 700);
        out.b8committed = out.b8layerId ? lastStrokeOf(out.b8layerId) : null;
        await undoOnce();
        } catch (e8) { out.b8err = (e8 && (e8.message || e8)) + ''; }
      }

      /* ——— B9 · YUVARLAK köşeli kare: daire SANILMAMALI ———
          Kullanıcı raporu: "her şekli yuvarlağa dönüştürüyor". Köşeleri
          yumuşak kare, dönüş-enerjisi kümelemesiyle kare/çokgen çıkar. */
      {
        try {
        ink.activeLayerId = attLayer.id;
        await wait(80);
        const HS = 70, CR = 12; // yarım kenar + köşe yarıçapı (dünya-px)
        const c9 = { x: CC.x - 320, y: CC.y - 200 };
        const boxPts = [
          { x: c9.x - HS + CR, y: c9.y - HS }, { x: c9.x + HS - CR, y: c9.y - HS },
          { x: c9.x + HS, y: c9.y - HS + CR }, { x: c9.x + HS, y: c9.y + HS - CR },
          { x: c9.x + HS - CR, y: c9.y + HS }, { x: c9.x - HS + CR, y: c9.y + HS },
          { x: c9.x - HS, y: c9.y + HS - CR }, { x: c9.x - HS, y: c9.y - HS + CR },
        ];
        const arc = (cx, cy, a0, a1) => {
          const steps = 5;
          const seq = [];
          for (let i = 1; i <= steps; i += 1) {
            const t = i / steps;
            const ang = a0 + (a1 - a0) * t;
            seq.push({ x: cx + Math.cos(ang) * CR, y: cy + Math.sin(ang) * CR });
          }
          return seq;
        };
        const path = [
          ...boxPts.slice(0, 1), ...arc(boxPts[1].x, boxPts[1].y + CR, -Math.PI / 2, 0),
          ...boxPts.slice(2, 3), ...arc(boxPts[3].x - CR, boxPts[3].y, 0, Math.PI / 2),
          ...boxPts.slice(4, 5), ...arc(boxPts[5].x, boxPts[5].y - CR, Math.PI / 2, Math.PI),
          ...boxPts.slice(6, 7), ...arc(boxPts[7].x + CR, boxPts[7].y, Math.PI, Math.PI * 1.5),
          { x: c9.x - HS + CR, y: c9.y - HS },
        ];
        let prev9 = null;
        let js9 = 97;
        const jig9 = () => {
          js9 = (js9 * 1103515245 + 12345) & 0x7fffffff;
          return (js9 / 0x7fffffff - 0.5) * 4; // ±2 px: gerçek kalem sarsıntısı
        };
        for (let i = 0; i < path.length; i += 1) {
          const scr = S(path[i]);
          if (i === 0) { down(scr); prev9 = scr; await wait(18); continue; }
          const from = prev9;
          for (let k = 1; k <= 6; k += 1) {
            const t = k / 6;
            move({
              x: from.x + (scr.x - from.x) * t + jig9(),
              y: from.y + (scr.y - from.y) * t + jig9(),
            });
            prev9 = { x: from.x + (scr.x - from.x) * t, y: from.y + (scr.y - from.y) * t };
            await wait(14);
          }
        }
        /* Ham durum: bekletme ÖNCE alınır (mükemmelleşme kıyaslaması). */
        out.b9raw = live();
        await wait(950);
        out.b9snap = live();
        out.b9layerId = (out.b9snap || {}).layerId || null;
        await lift(prev9, 700);
        out.b9committed = out.b9layerId ? lastStrokeOf(out.b9layerId) : null;
        await undoOnce();
        } catch (e9) { out.b9err = (e9 && (e9.message || e9)) + ''; }
      }

      /* ——— B10 · OPAKLIK: şekil var olan vuruş opaklığıyla oluşur ———
          Bu ekranda katman tuvali item elementine bağlanmadığı için
          commit pikselleri okunamaz (inkAttachedRasterPlan null → sessiz
          atlama; bkz. b10dbg). Bu yüzden üç gerçek invariant test edilir:
          1) canlı overlay bandı mürekkep VAR ve %100'e zorlanmamış,
          2) commit VERİSİNDEN app'in kendi commit-render fonksiyonuyla
             (inkDrawStrokeOnContext — inkPaintStrokeSync'in birebir
             çağrısı) simüle bake bandı canlı ile aynı,
          3) aynı fırça+opaklık+basınçla Shift'le çizilen SERBEST EL
             dairenin canlı bandı şekil bandı ile aynı (model-bağımsız
             "var olan opaklık" kanıtı). */
      {
        try {
        ink.activeLayerId = attLayer.id;
        ink.opacity = 0.5;
        await wait(80);
        const probeAlpha = (c, cx, cy, half) => {
          if (!c) return -1;
          const W = c.width, H = c.height;
          const x = Math.max(0, Math.round(cx) - half), y = Math.max(0, Math.round(cy) - half);
          const w = Math.min(half * 2 + 1, W - x), h = Math.min(half * 2 + 1, H - y);
          if (w <= 0 || h <= 0) return -1;
          const img = c.getContext('2d').getImageData(x, y, w, h).data;
          let a = 0;
          for (let j = 3; j < img.length; j += 4) a = Math.max(a, img[j]);
          return a;
        };
        const liveCanvas = (typeof inkLive !== 'undefined' && inkLive && inkLive.ctx)
          ? inkLive.ctx.canvas : null;

        /* 1) Referans: Shift'li serbest-el daire — oturtma hiç tetiklenmez
              (Tur 4 sözleşmesi). Canlı önizleme board'da yaklaşık
              biriktirmelidir (kare sınırlarında çift damga) → kıyas
              COMMIT VERİSİ üzerinden yapılır: vuruş commit edilir,
              app'in commit-render fonksiyonuyla simüle bake edilir ve
              şeklin simüle bake bandıyla kıyaslanır (birebir aynı yol). */
        const R = 55;
        const c10 = { x: CC.x + 330, y: CC.y - 200 };
        const shiftExtra = { shiftKey: true };
        const refEnd = await drawCircle(c10, R, 56, 18, Math.PI * 2.05, 81,
          Math.PI / 2, shiftExtra);
        out.b10refKind = (live() || {}).kind || null;
        out.b10refLayerId = (live() || {}).layerId || null;
        await lift(refEnd, 700);
        await wait(150);
        const refLayer = out.b10refLayerId
          ? (inkState().layers || []).find(l => l.id === out.b10refLayerId) : null;
        const refStroke = refLayer && refLayer.strokes.length
          ? refLayer.strokes[refLayer.strokes.length - 1] : null;
        let b10refCommit = -1;
        if (refStroke && typeof inkDrawStrokeOnContext === 'function') {
          const sim = document.createElement('canvas');
          sim.width = 800; sim.height = 600;
          inkDrawStrokeOnContext(sim.getContext('2d', { colorSpace: 'srgb' }), refStroke, {
            mapPoint: pt => ({ x: pt.x * sim.width, y: pt.y * sim.height }),
            sizePx: Math.max(0.5, refStroke.size * sim.width),
            pointScale: { x: sim.width, y: sim.height },
          });
          /* 2.05 tur → 2. tur, 1. turun ilk ~18px'ini İKİNCİ KEZ boyar
             (çift damga birikimi: bant ~2× satAlpha). Polarsal açısı
             başlangıçtan ≥0.65 rad uzak noktalar örneklenir → bu, iki
             vuruşun da TEK KAPLAMA genel bandıdır. */
          const TAU = Math.PI * 2;
          let rcx = 0, rcy = 0;
          for (const p of refStroke.points) { rcx += p.x; rcy += p.y; }
          rcx /= refStroke.points.length; rcy /= refStroke.points.length;
          const a0 = Math.atan2(refStroke.points[0].y - rcy,
            refStroke.points[0].x - rcx);
          b10refCommit = 0;
          for (let i = 1; i + 1 < refStroke.points.length; i++) {
            const p = refStroke.points[i];
            const ang = Math.atan2(p.y - rcy, p.x - rcx);
            const dA = ((ang - a0) % TAU + TAU) % TAU;
            if (dA < 0.65) continue;
            const a = probeAlpha(sim, p.x * sim.width, p.y * sim.height, 4);
            if (a > b10refCommit) b10refCommit = a;
          }
        }
        out.b10refCommitAlpha = b10refCommit;
        await undoOnce();
        await wait(150);

        /* 2) Oturtulan daire + canlı ayar + canlı bandı. */
        const penEnd = await drawCircle(c10, R, 56, 18, Math.PI * 2.05, 81, Math.PI / 2);
        await wait(950);
        out.b10snap = live();
        const after = await glide(penEnd, { x: penEnd.x, y: penEnd.y + R * 1.6 }, 16, 16);
        out.b10after = live();
        out.b10layerId = (out.b10snap || {}).layerId || null;
        /* Canlı overlay EKRAN uzayında çizilir: inkLocalToScreen CSS px,
           tuval ×dpr. points[0] halka üzerindedir; dar + geniş pencere. */
        const lp = (typeof inkLocalToScreen === 'function' && inkPointer &&
          inkPointer.layer && inkPointer.stroke && inkPointer.stroke.points.length)
          ? inkLocalToScreen(inkPointer.layer, inkPointer.stroke.points[0]) : null;
        out.b10liveAlpha = liveCanvas && lp
          ? probeAlpha(liveCanvas, lp.x * inkLive.dpr, lp.y * inkLive.dpr, 4) : -1;
        out.b10liveWide = liveCanvas && lp
          ? probeAlpha(liveCanvas, lp.x * inkLive.dpr, lp.y * inkLive.dpr, 20) : -1;

        /* 3) Commit verisi + simüle bake: app'in commit yolu
              (inkPaintStrokeSync) aynı fonksiyonu aynı parametreyle
              çağırır → bu bant, gerçek commit'in boyayacağı banttır. */
        await lift(after, 700);
        await wait(150);
        out.b10committed = out.b10layerId ? lastStrokeOf(out.b10layerId) : null;
        const cLayer = (inkState().layers || []).find(l => l.id === out.b10layerId);
        const cStroke = cLayer && cLayer.strokes.length
          ? cLayer.strokes[cLayer.strokes.length - 1] : null;
        out.b10strokeOpacity = cStroke ? cStroke.opacity : null;
        let b10commit = -1;
        let b10band = -1;
        if (cStroke && typeof inkDrawStrokeOnContext === 'function') {
          const sim = document.createElement('canvas');
          sim.width = 800; sim.height = 600;
          inkDrawStrokeOnContext(sim.getContext('2d', { colorSpace: 'srgb' }), cStroke, {
            mapPoint: pt => ({ x: pt.x * sim.width, y: pt.y * sim.height }),
            sizePx: Math.max(0.5, cStroke.size * sim.width),
            pointScale: { x: sim.width, y: sim.height },
          });
          b10commit = probeAlpha(sim, cStroke.points[0].x * sim.width,
            cStroke.points[0].y * sim.height, 4);
          /* Şeklin genel bandı: kapalı halkanın dikişi (ilk==son) dışında
             kalan orta indekslerin maksimumu — referansla kıyaslanan bu. */
          b10band = 0;
          const sn = cStroke.points.length;
          for (let i = 8; i + 8 < sn; i++) {
            const p = cStroke.points[i];
            const a = probeAlpha(sim, p.x * sim.width, p.y * sim.height, 4);
            if (a > b10band) b10band = a;
          }
        }
        out.b10commitAlpha = b10commit;
        out.b10shapeBand = b10band;
        const pickFields = s => !s ? null : {
          kind: s.kind, snapFree: s.snapFree || 0, shape: s.shape || '',
          taperStart: s.taperStart, taperEnd: s.taperEnd, scatter: s.scatter,
          flow: s.flow, flowJitter: s.flowJitter, spacing: s.spacing,
          size: s.size, opacity: s.opacity, hardness: s.hardness,
          brushId: s.brushId, n: s.points.length,
          p0: s.points[0] ? s.points[0].p : null,
          eligible: typeof inkStrokePathEligible === 'function'
            ? inkStrokePathEligible(s, inkGetBrush(s.brushId),
              Math.max(0.5, s.size * 800)) : null,
        };
        out.b10fields = { ref: pickFields(refStroke), shape: pickFields(cStroke) };
        out.b10dbg = {
          dpr: (typeof inkLive !== 'undefined' && inkLive) ? inkLive.dpr : null,
          liveW: liveCanvas ? liveCanvas.width : null,
          liveH: liveCanvas ? liveCanvas.height : null,
          cssPt: lp ? { x: Math.round(lp.x), y: Math.round(lp.y) } : null,
          elMapItem: (typeof elMap !== 'undefined' && elMap) ? (() => {
            const e = elMap.get('it_board_qc');
            return e ? (e.isConnected ? 'bağlı' : 'kopuk') : 'elMap-boş';
          })() : 'elMap-yok',
          layerCount: document.querySelectorAll('canvas[data-ink-layer]').length,
        };
        await undoOnce();
        ink.opacity = 1;
        await wait(120);
        } catch (e10) { out.b10err = (e10 && (e10.message || e10)) + ''; }
      }

      /* ——— B11 · ÇOKLU FIRÇA: yumuşak pastelde oturtma + ayar ——— */
      {
        try {
        ink.activeLayerId = attLayer.id;
        ink.brushId = 'native-soft-pastel';
        await wait(120);
        const R = 52;
        const c11 = { x: CC.x - 320, y: CC.y + 170 };
        const penEnd = await drawCircle(c11, R, 56, 18, Math.PI * 2.05, 91, Math.PI / 2);
        await wait(950);
        out.b11snap = live();
        const after = await glide(penEnd, { x: penEnd.x, y: penEnd.y + R * 1.6 }, 16, 16);
        out.b11after = live();
        out.b11layerId = (out.b11snap || {}).layerId || null;
        await lift(after, 700);
        out.b11committed = out.b11layerId ? lastStrokeOf(out.b11layerId) : null;
        await undoOnce();
        ink.brushId = 'native-studio-pen';
        await wait(120);
        } catch (e11) { out.b11err = (e11 && (e11.message || e11)) + ''; }
      }

      return JSON.stringify(out);
    })()`));

    const o = res;

    /* ——— B1 ——— */
    check('B1 basılı bekleyince CANLI oturdu (kind=shape, snapped)',
      !!o.b1snapped && o.b1snapped.snapped === true &&
      o.b1snapped.kind === 'shape' && o.b1snapped.shape === 'circle',
      JSON.stringify(o.b1snapped) + (o.b1err ? ' | hata: ' + o.b1err : ''));
    check('B1 kalem hareketiyle canlı boyandı (shape korundu)',
      !!o.b1after && o.b1after.kind === 'shape' && o.b1after.shape === 'circle',
      JSON.stringify(o.b1after));
    check('B1 dikey eksen büyüdü', !!o.b1snapped && !!o.b1after &&
      o.b1after.box.h > o.b1snapped.box.h * 1.3,
      'h ' + (o.b1snapped && o.b1snapped.box.h) + '→' + (o.b1after && o.b1after.box.h));
    check('B1 en sabit kaldı', !!o.b1snapped && !!o.b1after &&
      Math.abs(o.b1after.box.w - o.b1snapped.box.w) <= Math.max(0.01, o.b1snapped.box.w * 0.08),
      'w ' + (o.b1snapped && o.b1snapped.box.w) + '→' + (o.b1after && o.b1after.box.w));
    check('B1 noktalar yeniden üretildi (65 nokta; ekleme yok)',
      !!o.b1after && o.b1after.n === 65, 'n=' + (o.b1after && o.b1after.n));
    check('B1 commit shape/circle + snapFree', !!o.b1committed &&
      o.b1committed.kind === 'shape' && o.b1committed.shape === 'circle' &&
      o.b1committed.snapFree === 1, JSON.stringify(o.b1committed));
    check('B1 commit kapanış noktası (son == ilk — boşluk yok)', !!o.b1committed &&
      Math.hypot(o.b1committed.first.x - o.b1committed.last.x,
                 o.b1committed.first.y - o.b1committed.last.y) < 1e-9,
      JSON.stringify(o.b1committed && [o.b1committed.first, o.b1committed.last]));
    check('B1 canlı == commit boyut paritesi', !!o.b1after && !!o.b1committed &&
      Math.abs(o.b1committed.box.w - o.b1after.box.w) <= o.b1after.box.w * 0.05 &&
      Math.abs(o.b1committed.box.h - o.b1after.box.h) <= o.b1after.box.h * 0.05,
      JSON.stringify({ canli: o.b1after && o.b1after.box, commit: o.b1committed && o.b1committed.box }));
    check('B1 undo vuruşu kaldırdı', o.b1countAfterCommit === o.b1countAfterUndo + 1,
      o.b1countAfterCommit + '→' + o.b1countAfterUndo);

    /* ——— B2 ——— */
    check('B2 oturdu', !!o.b2snap && o.b2snap.snapped === true &&
      o.b2snap.kind === 'shape', JSON.stringify(o.b2snap));
    check('B2 mikro hareket bbox değiştirmedi', !!o.b2snap && !!o.b2after &&
      Math.abs(o.b2after.box.w - o.b2snap.box.w) < 1e-6 &&
      Math.abs(o.b2after.box.h - o.b2snap.box.h) < 1e-6,
      JSON.stringify({ a: o.b2snap && o.b2snap.box, b: o.b2after && o.b2after.box }));
    check('B2 commit shape + snapFree', !!o.b2committed &&
      o.b2committed.kind === 'shape' && o.b2committed.snapFree === 1,
      JSON.stringify(o.b2committed));

    /* ——— B3 ——— */
    check('B3 Shift basılıyken oturtma tetiklenmedi (kind=stroke)',
      !!o.b3afterHold && o.b3afterHold.kind === 'stroke' && o.b3afterHold.snapped === false,
      JSON.stringify(o.b3afterHold));
    check('B3 Shift durumu izlendi', !!o.b3live && o.b3live.shiftHeld === true,
      String(o.b3live && o.b3live.shiftHeld));
    check('B3 commit ham vuruş olarak kaldı', !!o.b3committed &&
      o.b3committed.kind === 'stroke', JSON.stringify(o.b3committed));

    /* ——— B4 · kare (Tur 4k): köşeli kapalı iz kusursuz ÇOKGENE
        oturur (shape/poly, snapFree); kalem basılıyken boyama merkezden
        tek-çapraz ölçekle sürer (her iki eksen orantılı büyür). ——— */
    check('B4 kare çokgene oturdu (shape/poly)',
      !!o.b4snap && o.b4snap.snapped === true &&
      o.b4snap.kind === 'shape' && o.b4snap.shape === 'poly',
      JSON.stringify(o.b4snap));
    check('B4 çokgen köşe sayısı az (n ≤ 8)',
      !!o.b4snap && o.b4snap.n <= 8,
      'n ' + (o.b4raw && o.b4raw.n) + '→' + (o.b4snap && o.b4snap.n));
    check('B4 dışa boyama her iki ekseni büyüttü (merkez-ölçek sürdü)',
      !!o.b4snap && !!o.b4after &&
      o.b4after.box.w > o.b4snap.box.w * 1.15 &&
      o.b4after.box.h > o.b4snap.box.h * 1.15,
      JSON.stringify({ a: o.b4snap && o.b4snap.box, b: o.b4after && o.b4after.box }));
    check('B4 commit shape/poly + snapFree', !!o.b4committed &&
      o.b4committed.kind === 'shape' && o.b4committed.shape === 'poly' &&
      o.b4committed.snapFree === 1,
      JSON.stringify(o.b4committed));

    /* ——— B5 ——— */
    /* Tur 4h: kalkış oturtması düz izi dürüstçe line'a oturtabilir;
       vakanın ASIL sözleşmesi dünya-px uzayının korunmasıdır (0..1
       çökmesi yasak) — kind'a bakılmaksızın kutu dünya-px kalmalı. */
    check('B5 global serbest el commit edildi (serbest el ya da oturtulmuş)',
      !!o.b5stroke && (o.b5stroke.kind === 'shape' || o.b5stroke.n >= 10),
      JSON.stringify(o.b5stroke));
    check('B5 global noktalar dünya-px kaldı (0..1 çökmesi yok)',
      o.b5stroke && !(o.b5stroke.box.w < 50 && o.b5stroke.box.h < 50) &&
      (o.b5stroke.kind === 'shape' || o.b5stroke.n >= 10),
      JSON.stringify(o.b5stroke));

    /* ——— B6 ——— */
    check('B6 global daire oturdu', !!o.b6snap && o.b6snap.snapped === true &&
      o.b6snap.kind === 'shape' && o.b6snap.shape === 'circle', JSON.stringify(o.b6snap));
    check('B6 global canlı boylama büyüttü', !!o.b6snap && !!o.b6after &&
      o.b6after.box.h > o.b6snap.box.h * 1.3 &&
      Math.abs(o.b6after.box.w - o.b6snap.box.w) <= Math.max(2, o.b6snap.box.w * 0.08),
      'h ' + (o.b6snap && o.b6snap.box.h) + '→' + (o.b6after && o.b6after.box.h) +
      ' w ' + (o.b6snap && o.b6snap.box.w) + '→' + (o.b6after && o.b6after.box.w));
    check('B6 commit shape + snapFree', !!o.b6committed &&
      o.b6committed.kind === 'shape' && o.b6committed.snapFree === 1,
      JSON.stringify(o.b6committed));

    /* ——— B7 · eksen değişimi ——— */
    check('B7 oturdu', !!o.b7snap && o.b7snap.snapped === true &&
      o.b7snap.kind === 'shape' && o.b7snap.shape === 'circle', JSON.stringify(o.b7snap));
    check('B7 1. bacak (AŞAĞI) boyu büyüttü', !!o.b7snap && !!o.b7afterDown &&
      o.b7afterDown.box.h > o.b7snap.box.h * 1.15, JSON.stringify(o.b7snap && o.b7afterDown && {
        a: o.b7snap.box, b: o.b7afterDown.box }));
    check('B7 1. bacak eni sabit tuttu', !!o.b7snap && !!o.b7afterDown &&
      Math.abs(o.b7afterDown.box.w - o.b7snap.box.w) <= Math.max(0.01, o.b7snap.box.w * 0.08),
      'w ' + (o.b7snap && o.b7snap.box.w) + '→' + (o.b7afterDown && o.b7afterDown.box.w));
    check('B7 2. bacak (SAĞA) ENİ büyüttü — eksen değişti', !!o.b7afterDown && !!o.b7afterRight &&
      o.b7afterRight.box.w > o.b7afterDown.box.w * 1.12, JSON.stringify(o.b7afterDown && o.b7afterRight && {
        a: o.b7afterDown.box, b: o.b7afterRight.box }));
    check('B7 2. bacak boyu sabit tuttu', !!o.b7afterDown && !!o.b7afterRight &&
      Math.abs(o.b7afterRight.box.h - o.b7afterDown.box.h) <= Math.max(0.01, o.b7afterDown.box.h * 0.08),
      'h ' + (o.b7afterDown && o.b7afterDown.box.h) + '→' + (o.b7afterRight && o.b7afterRight.box.h));
    check('B7 commit shape/circle + snapFree', !!o.b7committed &&
      o.b7committed.kind === 'shape' && o.b7committed.shape === 'circle' &&
      o.b7committed.snapFree === 1, JSON.stringify(o.b7committed));

    /* ——— B8 · çapraz üst-sol ——— */
    check('B8 oturdu', !!o.b8snap && o.b8snap.snapped === true &&
      o.b8snap.kind === 'shape' && o.b8snap.shape === 'circle', JSON.stringify(o.b8snap));
    check('B8 çapraz çekme ENİ büyüttü', !!o.b8snap && !!o.b8after &&
      o.b8after.box.w > o.b8snap.box.w * 1.12, JSON.stringify(o.b8snap && o.b8after && {
        a: o.b8snap.box, b: o.b8after.box }));
    check('B8 çapraz çekme BOYU büyüttü', !!o.b8snap && !!o.b8after &&
      o.b8after.box.h > o.b8snap.box.h * 1.12, JSON.stringify(o.b8snap && o.b8after && {
        a: o.b8snap.box, b: o.b8after.box }));
    check('B8 büyüme ÜST-SOLA doğru (köken sola+yukarı gitti)', !!o.b8snap && !!o.b8after &&
      o.b8after.x0 < o.b8snap.x0 - 0.01 && o.b8after.y0 < o.b8snap.y0 - 0.01,
      JSON.stringify({ a: [o.b8snap.x0, o.b8snap.y0], b: [o.b8after.x0, o.b8after.y0] }));
    check('B8 commit shape + snapFree', !!o.b8committed &&
      o.b8committed.kind === 'shape' && o.b8committed.snapFree === 1,
      JSON.stringify(o.b8committed));

    /* ——— B9 · yuvarlak köşeli kare (Tur 4k): daire SANILMAZ —
        dönüş-enerjisi kümelemesi köşeleri yakalar; iz kusursuz ÇOKGENE
        oturur, kare yapısı (en-boy oranı) korunur. ——— */
    check('B9 yuvarlak köşeli kare çokgene oturdu (shape/poly, daire değil)',
      !!o.b9snap && o.b9snap.snapped === true &&
      o.b9snap.kind === 'shape' && o.b9snap.shape === 'poly',
      JSON.stringify(o.b9snap));
    check('B9 çokgen köşe sayısı az (n ≤ 8)',
      !!o.b9snap && o.b9snap.n <= 8,
      'n ' + (o.b9raw && o.b9raw.n) + '→' + (o.b9snap && o.b9snap.n));
    check('B9 kare oranı korundu (dünya-px: 800×600 öğe)', !!o.b9committed &&
      Math.abs((o.b9committed.box.w * 800) / (o.b9committed.box.h * 600) - 1) < 0.1,
      JSON.stringify(o.b9committed && o.b9committed.box));
    check('B9 commit shape/poly + snapFree', !!o.b9committed &&
      o.b9committed.kind === 'shape' && o.b9committed.shape === 'poly' &&
      o.b9committed.snapFree === 1,
      JSON.stringify(o.b9committed));

    /* ——— B10 · opaklık ——— */
    check('B10 oturdu', !!o.b10snap && o.b10snap.snapped === true &&
      o.b10snap.kind === 'shape', JSON.stringify(o.b10snap));
    check('B10 vuruş opaklığı fırça ayarından geldi (0.5)',
      o.b10strokeOpacity === 0.5, String(o.b10strokeOpacity));
    check('B10 canlı bant: mürekkep var, opaklık %100\'e zorlanmadı',
      o.b10liveAlpha >= 20 && o.b10liveAlpha <= 210,
      'live=' + o.b10liveAlpha + ' geniş=' + o.b10liveWide +
      ' tanı=' + JSON.stringify(o.b10dbg));
    check('B10 simüle-commit bandı canlı ile aynı (±12)', o.b10commitAlpha >= 0 &&
      Math.abs(o.b10commitAlpha - o.b10liveAlpha) <= 12,
      'live=' + o.b10liveAlpha + ' sim-commit=' + o.b10commitAlpha);
    check('B10 şekil genel bandı serbest-el genel bandıyla aynı opaklıkta (±24)',
      o.b10shapeBand >= 20 && o.b10refCommitAlpha >= 20 &&
      Math.abs(o.b10shapeBand - o.b10refCommitAlpha) <= 24,
      'şekil=' + o.b10shapeBand + ' dikiş=' + o.b10commitAlpha +
      ' serbest-el=' + o.b10refCommitAlpha +
      ' refKind=' + o.b10refKind + ' saha=' + JSON.stringify(o.b10fields));

    /* ——— B11 · çoklu fırça ——— */
    check('B11 yumuşak fırçada oturdu', !!o.b11snap && o.b11snap.snapped === true &&
      o.b11snap.kind === 'shape' && o.b11snap.shape === 'circle', JSON.stringify(o.b11snap));
    check('B11 yumuşak fırçada ayar büyüttü', !!o.b11snap && !!o.b11after &&
      o.b11after.box.h > o.b11snap.box.h * 1.15, JSON.stringify(o.b11snap && o.b11after && {
        a: o.b11snap.box, b: o.b11after.box }));
    check('B11 commit shape + snapFree', !!o.b11committed &&
      o.b11committed.kind === 'shape' && o.b11committed.snapFree === 1,
      JSON.stringify(o.b11committed));

    check('Z tahtada çalışma zamanı hatası yok', errors.length === 0,
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
