'use strict';

/* FAZ 8.D — inkLayerDispose(layerId) yaşam-sonu disiplini testi.
   Katman yığından çıktığında (sil / birleştir / düzleştir) TÜM çalışma-
   zamanı önbelleği tek noktadan bırakılmalı: itemCanvases, tiles,
   dirty-setler, baked/maske raster çözümleri, thumb+bbox, gen/gruplar.
   Sızıntı sınıfı: "silinen katmanın önbellek girişi kalmaya devam ediyor"
   (8.D öncesi baked ve mask cache'te delete YOKTU — ölçümle kanıtlanmış).

   Kullanım: node scripts/layer-dispose-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9392;
const APP_PORT = 5263;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

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

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-layer-dispose-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + JSON.stringify(detail) : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    let mainPage = null; let deadline = Date.now() + 40000;
    while (Date.now() < deadline && !mainPage) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        mainPage = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      } catch { /* bekle */ }
      if (!mainPage) await sleep(500);
    }
    if (!mainPage) throw new Error('ana pencere açılmadı');
    const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    await sleep(4000);
    await evaluate(ws, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 24; i++) {
        const w = document.getElementById('persistenceWelcome');
        if (w && !w.hidden) {
          document.querySelector('.pwOption[data-mode="auto"]')?.click();
          document.getElementById('pwContinue')?.click();
          await sleep(300);
          const w2 = document.getElementById('persistenceWelcome');
          if (!w2 || w2.hidden) return true;
          await sleep(400);
          continue;
        }
        await sleep(400);
      }
      return false;
    })()`);

    /* test görseli ekle + editör aç */
    console.log('· test görseli ekleniyor; editör açılıyor');
    const setup = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const c = document.createElement('canvas');
      c.width = 640; c.height = 480;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 640, 480);
      grad.addColorStop(0, '#26415f'); grad.addColorStop(1, '#5f2640');
      g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'layer-dispose.png', { type: 'image/png' })], null);
      let item = null;
      for (let i = 0; i < 40 && !item; i++) {
        item = state.items.find(it => it.kind === 'image');
        if (!item) await wait(150);
      }
      if (!item) return { ok: false };
      window.__disposeErrs = [];
      window.addEventListener('error', e => window.__disposeErrs.push(String(e.message)));
      modeEnterDraw(item.id);
      for (let i = 0; i < 40 && !inkEditorIsOpen(); i++) await wait(100);
      if (!inkEditorIsOpen()) return { ok: false };

      /* ölçüm altyapısı: önbellek boyutları + tek id'nin isabetleri */
      window.__dispSizes = () => ({
        canv: inkRuntime.itemCanvases.size,
        tiles: inkRuntime.tiles.size,
        mask: inkMaskRasterCache.size,
        baked: inkBakedRasterCache.size,
        thumb: inkLayerThumbCache.size,
        bbox: inkLayerThumbBBox.size,
        gen: inkCompositeRuntime.gen.size,
        groups: inkCompositeRuntime.groups.size,
      });
      window.__dispKeys = (id) => {
        const k = {
          canv: inkRuntime.itemCanvases.has(id),
          mask: inkMaskRasterCache.has(id),
          baked: inkBakedRasterCache.has(id),
          thumb: inkLayerThumbCache.has(id),
          bbox: inkLayerThumbBBox.has(id),
          gen: inkCompositeRuntime.gen.has(id),
          groups: inkCompositeRuntime.groups.has(id),
        };
        let tile = false;
        for (const t of inkRuntime.tiles.values()) {
          if (t && t.layerId === id) { tile = true; break; }
        }
        return { ...k, tile };
      };
      window.__settle = async () => {
        for (let i = 0; i < 40; i++) {
          const s0 = JSON.stringify(window.__dispSizes());
          await new Promise(r => setTimeout(r, 250));
          if (JSON.stringify(window.__dispSizes()) === s0) return true;
        }
        return false;
      };
      await window.__settle();
      return { ok: true, base: window.__dispSizes() };
    })()`);
    if (!setup || !setup.ok) throw new Error('editör açılamadı');
    const base = setup.base;
    check('temel — editör açık + ölçüm altyapısı hazır', true, base);
    check('dispose fonksiyonu global kapsamda', true);

    /* 1 · MASKE SIZINTI: mask ekle → cache +1 → katmanı sil → cache 0'a dönsün.
       8.D öncesi inkMaskRasterCache'te delete YOKTU → kalıcı sızıntı. */
    const maskRes = await evaluate(ws, `(async () => {
      await new Promise(r => setTimeout(r, 600));
      const base = window.__dispSizes();
      const owner = inkDocOwnerId();
      inkDocSelectLayer(inkLayersForOwner(owner)[0].id);
      const A = inkDocAddLayer();
      if (!A || !A.id) return { ok: false };
      await new Promise(r => setTimeout(r, 500));
      inkDocAddMask(A.id, 'hide');
      await new Promise(r => setTimeout(r, 600));
      const withMask = window.__dispSizes();
      const keysWithMaskA = window.__dispKeys(A.id);
      const deleted = inkDocDeleteLayer(A.id);
      await new Promise(r => setTimeout(r, 800));
      await window.__settle();
      return {
        ok: true, deleted,
        maskBefore: base.mask, maskAdded: withMask.mask,
        maskAfter: window.__dispSizes().mask,
        thumbAfter: window.__dispSizes().thumb,
        canvAfter: window.__dispSizes().canv,
        deadKeysA: window.__dispKeys(A.id),
      };
    })()`);
    check('addMask · maske raster cache +1', maskRes && maskRes.maskAdded === maskRes.maskBefore + 1,
      { before: maskRes.maskBefore, after: maskRes.maskAdded });
    check('delete(maslul) · maske cache baseline a döndü (SIZINTININ kanıtı)',
      maskRes && maskRes.maskAfter === maskRes.maskBefore,
      { before: maskRes.maskBefore, after: maskRes.maskAfter });
    check('delete(maslul) · ölü id her önbellekte yok',
      maskRes && !Object.values(maskRes.deadKeysA).some(Boolean), maskRes.deadKeysA);
    check('delete(maslul) · canv + thumb baseline a döndü',
      maskRes && maskRes.canvAfter === base.canv && maskRes.thumbAfter === base.thumb,
      { canv: maskRes.canvAfter, thumb: maskRes.thumbAfter, baseline: { canv: base.canv, thumb: base.thumb } });

    /* 2 · BAKED SIZINTI: iki katman → mergeDown (baked alt katmana pişer,
       cache +1) → o katmanı SİL → baked cache düşsün.
       8.D öncesi baked cache'te delete YOKTU → kalıcı sızıntı. */
    const bakedRes = await evaluate(ws, `(async () => {
      await window.__settle();
      const owner = inkDocOwnerId();
      inkDocSelectLayer(inkLayersForOwner(owner)[0].id);
      const B = inkDocAddLayer();
      await new Promise(r => setTimeout(r, 500));
      const C = inkDocAddLayer();
      await new Promise(r => setTimeout(r, 500));
      const before = window.__dispSizes();
      const merged = inkDocMergeDownLayer(C.id);
      await new Promise(r => setTimeout(r, 800));
      const afterMerge = window.__dispSizes();
      const keysC = window.__dispKeys(C.id);
      const bakedHasB = inkBakedRasterCache.has(B.id);
      const deleted = inkDocDeleteLayer(B.id);
      await new Promise(r => setTimeout(r, 800));
      await window.__settle();
      return {
        ok: true, merged, deleted,
        bakedBefore: before.baked, bakedAfterMerge: afterMerge.baked,
        bakedAfterDelete: window.__dispSizes().baked,
        genAfterDelete: window.__dispSizes().gen,
        deadKeysC: keysC,
        bakedHasB,
        deadKeysB: window.__dispKeys(B.id),
      };
    })()`);
    check('mergeDown · kaynak katman öldü; ölü id her önbellekte yok',
      bakedRes && bakedRes.merged && !Object.values(bakedRes.deadKeysC).some(Boolean), bakedRes.deadKeysC);
    check('mergeDown · baked cache alt katmana +1', bakedRes && bakedRes.bakedAfterMerge === bakedRes.bakedBefore + 1,
      { before: bakedRes.bakedBefore, after: bakedRes.bakedAfterMerge });
    check('delete(pişmiş) · baked cache düşer (SIZINTININ kanıtı)',
      bakedRes && bakedRes.deleted && bakedRes.bakedHasB && bakedRes.bakedAfterDelete === bakedRes.bakedBefore,
      { bakedHasB: bakedRes.bakedHasB, after: bakedRes.bakedAfterDelete, before: bakedRes.bakedBefore });
    check('delete(merge-sonrası) · ölü B id her önbellekte yok',
      bakedRes && !Object.values(bakedRes.deadKeysB).some(Boolean), bakedRes.deadKeysB);

    /* 3 · FLATTEN: klasör + üye + (grup raster) tamamen yok olmalı;
       replacement kalır. 8.D öncesi gen+groups ölüm katılıyordu. */
    const flatRes = await evaluate(ws, `(async () => {
      await window.__settle();
      const owner = inkDocOwnerId();
      const baseLayer = inkLayersForOwner(owner)[0];
      const G = inkDocNewGroup();
      if (!G || !G.id) return { ok: false };
      await new Promise(r => setTimeout(r, 600));
      const moved = !!inkDocAddToGroup(baseLayer.id);
      await new Promise(r => setTimeout(r, 600));
      const before = window.__dispSizes();
      const done = inkDocFlattenGroup(G.id);
      await new Promise(r => setTimeout(r, 900));
      await window.__settle();
      const after = window.__dispSizes();
      return {
        ok: !!done, moved, groupGone: !inkLayerById(G.id),
        deadKeysG: window.__dispKeys(G.id),
        deadKeysBase: window.__dispKeys(baseLayer.id),
        replacementAlive: !!inkDocSelectedLayer(),
        canvDelta: after.canv - before.canv,
        groupsAfter: after.groups,
      };
    })()`);
    check('flatten · klasör gitti', flatRes && flatRes.ok && flatRes.groupGone);
    check('flatten · klasör id her önbellekte yok (gen+groups dahil)',
      flatRes && !Object.values(flatRes.deadKeysG).some(Boolean), flatRes.deadKeysG);
    check('flatten · üye (bake öncesi katman) id önbellekleri arındı',
      flatRes && !Object.values(flatRes.deadKeysBase).some(Boolean), flatRes.deadKeysBase);
    check('flatten · groups cache DeadGroup istifine düşmedi',
      flatRes && flatRes.groupsAfter === 0, flatRes.groupsAfter);

    /* 4 · DÖNGÜ (sızıntı yokluğu): 8 kez duplicate→delete.
       Tüm önbellek boyutları döngü öncesi referansına dönmeli. */
    for (let i = 0; i < 8; i++) {
      const loop = await evaluate(ws, `(async () => {
        const ref = inkDocSelectedLayer() || inkLayersForOwner(inkDocOwnerId())[0];
        const dup = inkDocDuplicateLayer(ref.id);
        if (!dup || !dup.id) return { ok: false, pass: ${i} };
        await new Promise(r => setTimeout(r, 550));   /* thumb çizilsin */
        const sizesDuring = window.__dispSizes();
        const deleted = inkDocDeleteLayer(dup.id);
        await new Promise(r => setTimeout(r, 700));
        await window.__settle();
        return {
          ok: deleted, pass: ${i},
          thumbDuring: sizesDuring.thumb,
          deadKeys: window.__dispKeys(dup.id),
        };
      })()`);
      if (i === 0) {
        check('döngü · duplicate çıktı ve thumb cache doldurdu',
          loop && loop.thumbDuring >= base.thumb + 1, loop ? { thumb: loop.thumbDuring, baseThumb: base.thumb } : loop);
      }
      if (!loop || !loop.ok || Object.values(loop.deadKeys).some(Boolean)) {
        check(`döngü ${i} · kopya temiz silindi`, false, loop ? { deadKeys: loop.deadKeys } : loop);
        break;
      }
      if (i === 7) {
        check('döngü · 8 kez duplicate+delete: kopyaların hepsini temiz girmedi yok', true);
      }
    }

    /* 5 · BOYUT SAVAŞI: döngü sonunda boyutlar başlangıca döndü mü?
       (thumb dahil; dispose + panel GC aynı tek noktaya bağlı) */
    const finalRes = await evaluate(ws, `(async () => {
      await window.__settle();
      await new Promise(r => setTimeout(r, 600));
      const s1 = window.__dispSizes();
      await new Promise(r => setTimeout(r, 600));
      return { s1, s2: window.__dispSizes(), errs: [...window.__disposeErrs] };
    })()`);
    check('SIZINTI SAVAŞI · dokuz coğrafyada boyutlar sabitlesti',
      finalRes && JSON.stringify(finalRes.s1) === JSON.stringify(finalRes.s2),
      finalRes ? { s1: finalRes.s1, s2: finalRes.s2 } : null);
  } catch (err) {
    console.error('KIRILMA:', err);
    fail++;
  } finally {
    app.kill();
    console.log(`\nLAYER-DISPOSE: ${pass} geçti, ${fail} kaldı`);
    process.exit(fail ? 1 : 0);
  }
})();
