'use strict';

/* FAZ 8.E — DnD FLIP kayma animasyonu + FAZ 8.F — klasör chevron katlanma.
   8.E: sıra değişiminde satırlar "tak" yerine KAYAR (WAAPI FLIP:
   First-Invert-Play); yapısal değişimde animasyon yoktur.
   8.F: klasör satırındaki chevron üyeleri katlar/açar — salt görünüm:
   motor katman dizisi ve store OLAY AKIŞI dokunulmaz.

   Kullanım: node scripts/layer-flip-fold-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9393;
const APP_PORT = 5264;
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-flip-fold-'));
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
      await addFiles([new File([blob], 'flip-fold.png', { type: 'image/png' })], null);
      let item = null;
      for (let i = 0; i < 40 && !item; i++) {
        item = state.items.find(it => it.kind === 'image');
        if (!item) await wait(150);
      }
      if (!item) return { ok: false };
      modeEnterDraw(item.id);
      for (let i = 0; i < 40 && !inkEditorIsOpen(); i++) await wait(100);
      if (!inkEditorIsOpen()) return { ok: false };

      window.__ffErrs = [];
      window.addEventListener('error', e => window.__ffErrs.push(String(e.message)));
      window.__ffEvents = [];
      for (const t of ['add','remove','reorder','rename','property','mask','select']) {
        inkLayerStoreOn(t, (type) => window.__ffEvents.push(type));
      }
      window.__rowIds = () =>
        [...document.querySelectorAll('#inkLayerList .inkLayerRow')]
          .map(el => el.dataset.layerId);
      window.__rowAnimations = () =>
        [...document.querySelectorAll('#inkLayerList .inkLayerRow')]
          .filter(el => el.getAnimations().some(a =>
            !(typeof CSSAnimation === 'function' && a instanceof CSSAnimation))).length;
      window.__rowsWithTransform = () =>
        [...document.querySelectorAll('#inkLayerList .inkLayerRow')]
          .filter(el => {
            const t = getComputedStyle(el).transform;
            return t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
          }).length;
      await new Promise(r => setTimeout(r, 800));
      return { ok: true, rows0: window.__rowIds().length };
    })()`);
    if (!setup || !setup.ok) throw new Error('editör açılamadı');
    check('temel — editör açık + ölçüm altyapısı hazır', true, { rows: setup.rows0 });

    /* ---------- FAZ 8.E · FLIP ---------- */
    const flip = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const owner = inkDocOwnerId();
      const firstRow = inkLayersForOwner(owner)[0].id;
      for (let i = 0; i < 4; i++) {
        inkDocSelectLayer(inkLayersForOwner(owner)[0].id);
        inkDocAddLayer();
        await wait(420);
      }
      const ids = window.__rowIds();
      if (ids.length !== ${setup.rows0} + 4) return { ok: false, ids };
      window.__ffEvents.length = 0;
      const movedBefore = window.__rowIds();
      const bottomId = movedBefore[movedBefore.length - 1];
      // alttan → üste: son satırı EN ÜSTE taşı (slot 0, top-first yığına göre)
      const okMove = inkDocReorderLayer(bottomId, 0);
      await wait(30);   // animasyon aynı senkron turda başladı
      return {
        ok: okMove, movedId: bottomId,
        animRows: window.__rowAnimations(),
        orderAfter: window.__rowIds(),
        events: [...window.__ffEvents],
      };
    })()`);
    check('FLIP · reorder bırakıldı ve tek reorder olayı yayıldı',
      flip && flip.ok && JSON.stringify(flip.events) === '["reorder"]', flip ? flip.events : flip);
    check('FLIP · sıra değişiminde KAYMA animasyonu devrede (≥2 satır animlu)',
      flip && flip.animRows >= 2, flip ? { animRows: flip.animRows } : flip);
    check('FLIP · sürüklenen satır en üste inmişse sıra güncel',
      flip && flip.orderAfter[0] === flip.movedId,
      flip ? { top: flip.orderAfter[0], movedId: flip.movedId } : flip);

    const flipSettle = await evaluate(ws, `(async () => {
      await new Promise(r => setTimeout(r, 420));
      return { anims: window.__rowAnimations(), tf: window.__rowsWithTransform() };
    })()`);
    check('FLIP · animasyon bitiminde kalıntı transform yok',
      flipSettle && flipSettle.anims === 0 && flipSettle.tf === 0,
      flipSettle);

    const struct = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__ffEvents.length = 0;
      inkDocSelectLayer(inkLayersForOwner(inkDocOwnerId())[0].id);
      inkDocAddLayer();
      await wait(30);
      const addAnim = window.__rowAnimations();
      await wait(500);
      return { addAnim, rowCount: window.__rowIds().length,
        events: [...window.__ffEvents] };
    })()`);
    check('FLIP · yapısal değişimde (add) animasyon YOK',
      struct && struct.addAnim === 0, struct ? { anims: struct.addAnim } : struct);

    /* ---------- FAZ 8.F · klasör katlanma ---------- */
    const foldSeed = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const owner = inkDocOwnerId();
      // dizeye iki temiz üye ekle
      const m1 = (() => { inkDocSelectLayer(inkLayersForOwner(owner)[0].id); return inkDocAddLayer(); })();
      await wait(400);
      const m2 = (() => { inkDocSelectLayer(inkLayersForOwner(owner)[0].id); return inkDocAddLayer(); })();
      await wait(400);
      const G = inkDocNewGroup();
      if (!G || !G.id) return { ok: false };
      await wait(500);
      const a1 = !!inkDocAddToGroup(m1.id);
      await wait(400);
      const a2 = !!inkDocAddToGroup(m2.id);
      await wait(400);
      const rows = window.__rowIds();
      const foldBtn = document.querySelector('#inkLayerList .inkLayerFold');
      return {
        ok: a1 && a2, gid: G.id, rows,
        added: rows.filter(id => id === m1.id || id === m2.id).length,
        foldBtn: !!foldBtn,
        ariaExpanded: foldBtn ? foldBtn.getAttribute('aria-expanded') : null,
        m1: m1.id, m2: m2.id, m3count: null,
      };
    })()`);
    check('katlanma · klasör + iki üye kuruldu, chevron butonu var',
      foldSeed && foldSeed.ok && foldSeed.added === 2 && foldSeed.foldBtn === true &&
      foldSeed.ariaExpanded === 'true', foldSeed ? { added: foldSeed.added, btn: foldSeed.foldBtn, aria: foldSeed.ariaExpanded } : foldSeed);

    const foldToggle = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const layersArr = () => inkState().layers.length;
      const beforeLayers = layersArr();
      window.__ffEvents.length = 0;
      const btn = document.querySelector('#inkLayerList .inkLayerFold');
      btn.click();
      await wait(120);
      const foldRows = window.__rowIds();
      const foldBtnAria = document.querySelector('#inkLayerList .inkLayerFold')?.getAttribute('aria-expanded');
      const motorUnchanged = layersArr() === beforeLayers;
      const foldEvents = [...window.__ffEvents];
      // katlanırken grup yeniden TIM: üyeler DOM'da yok
      const memberGone = !foldRows.includes(${JSON.stringify(foldSeed ? foldSeed.m1 : '')}) &&
                         !foldRows.includes(${JSON.stringify(foldSeed ? foldSeed.m2 : '')});
      // katlanmış durumda YENİ ÜYE gizlenerek eklenir
      const m3New = (() => {
        inkDocSelectLayer(inkLayersForOwner(inkDocOwnerId())[0].id);
        return inkDocAddLayer();
      })();
      await wait(420);
      const addedHidden = !!inkDocAddToGroup(m3New.id);
      await wait(400);
      const stillHidden = !window.__rowIds().includes(m3New.id);
      // aç
      const btn2 = document.querySelector('#inkLayerList .inkLayerFold');
      btn2.click();
      await wait(150);
      const unfoldRows = window.__rowIds();
      return {
        memberGone, foldBtnAria, motorUnchanged, foldEvents,
        foldRowsLen: foldRows.length,
        stillHidden, addedHidden, m3: m3New.id,
        m3Shown: unfoldRows.includes(m3New.id),
        unfoldCount: unfoldRows.length,
        layerCountLabel: document.querySelector('#inkLayerCount, .inkLayerCount')
          ? document.querySelector('#inkLayerCount, .inkLayerCount').textContent : null,
      };
    })()`);
    check('katlanma · chevron tık → üye satırları gizlenir (DOM yansız)',
      foldToggle && foldToggle.memberGone, foldToggle ? { memberGone: foldToggle.memberGone, rows: foldToggle.foldRowsLen } : foldToggle);
    check('katlanma · aria-expanded=false döndü',
      foldToggle && foldToggle.foldBtnAria === 'false', foldToggle ? { aria: foldToggle.foldBtnAria } : foldToggle);
    check('katlanma · MOTOR DOKUNULMAZ: katman dizisi boyu aynı + 0 store olay',
      foldToggle && foldToggle.motorUnchanged && foldToggle.foldEvents.length === 0,
      foldToggle ? { layers: foldToggle.motorUnchanged, events: foldToggle.foldEvents } : foldToggle);
    check('katlanma · katlanırken eklenen yeni üye de gizli kalır',
      foldToggle && foldToggle.addedHidden && foldToggle.stillHidden,
      foldToggle ? { added: foldToggle.addedHidden, hidden: foldToggle.stillHidden } : foldToggle);
    check('katlanma · açınca üç üye de yeniden görünür',
      foldToggle && foldToggle.m3Shown && foldToggle.unfoldCount >= 3,
      foldToggle ? { m3: foldToggle.m3Shown, rows: foldToggle.unfoldCount } : foldToggle);

    /* ---------- bağlı üye (bound) · sıra bozulsa da üyelik korunur ---------- */
    const boundPlan = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const owner = inkDocOwnerId();
      const groupRow = document.querySelector('#inkLayerList .inkLayerRow.is-group');
      const gid = groupRow ? groupRow.dataset.layerId : null;
      const memberId = ${JSON.stringify(foldSeed ? foldSeed.m1 : '')};
      const member = inkLayerById(memberId);
      if (!gid || !member) return { ok: false, gid, memberId };
      const parentBefore = member.parentId;
      const groupBefore = member.parentId === gid;
      const moved = inkDocReorderLayer(memberId, 0);
      await wait(450);
      const parentAfter = inkLayerById(memberId).parentId;
      const plan = inkAttachedDisplayPlan(owner);
      const entry = plan.find(e => e.base && e.base.id === memberId);
      const visibleBefore = entry ? inkPlanEntryVisible(entry) : null;
      const rowTop = window.__rowIds()[0] === memberId;
      inkDocSetVisible(gid, false);
      await wait(220);
      const entry2 = inkAttachedDisplayPlan(owner)
        .find(e => e.base && e.base.id === memberId);
      const hiddenWithGroup = entry2 ? inkPlanEntryVisible(entry2) : null;
      inkDocSetVisible(gid, true);
      await wait(220);
      const entry3 = inkAttachedDisplayPlan(owner)
        .find(e => e.base && e.base.id === memberId);
      return {
        ok: true, gid, memberId, groupBefore, moved, rowTop,
        parentBefore, parentAfter,
        bound: entry ? entry.bound : null,
        visibleBefore, hiddenWithGroup,
        visibleBack: entry3 ? inkPlanEntryVisible(entry3) : null,
      };
    })()`);
    check('bağlı üye · klasörden koparılıp en üste taşınsa da parentId sabit',
      boundPlan && boundPlan.ok && boundPlan.groupBefore && boundPlan.moved
      && boundPlan.rowTop && boundPlan.parentAfter === boundPlan.parentBefore,
      boundPlan ? { parentBefore: boundPlan.parentBefore, parentAfter: boundPlan.parentAfter, top: boundPlan.rowTop } : boundPlan);
    check('bağlı üye · plan girişi bound ile klasöre bağlanır (kompozitör çözer)',
      boundPlan && boundPlan.ok && boundPlan.bound === boundPlan.gid,
      boundPlan ? { bound: boundPlan.bound, gid: boundPlan.gid } : boundPlan);
    check('bağlı üye · klasör görünürlüğü üyeye yansır (gizle → gizli, aç → görünür)',
      boundPlan && boundPlan.ok && boundPlan.visibleBefore === true
      && boundPlan.hiddenWithGroup === false && boundPlan.visibleBack === true,
      boundPlan ? { before: boundPlan.visibleBefore, hidden: boundPlan.hiddenWithGroup, back: boundPlan.visibleBack } : boundPlan);

    const foldDelete = await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const owner = inkDocOwnerId();
      const groupRow = document.querySelector('#inkLayerList .inkLayerRow.is-group');
      const gid = groupRow ? groupRow.dataset.layerId : null;
      if (!gid) return { ok: false, gid: null };
      // katla
      document.querySelector('#inkLayerList .inkLayerFold').click();
      await wait(120);
      // sil
      const target = inkLayerById(gid);
      const targetOwner = target ? target.ownerId : null;
      const deleted = inkDocDeleteLayer(gid);
      await wait(150);
      const errCount = window.__ffErrs.length;
      // üye satırları geri gelmeli (klasör yok — üyeler sıradan katman)
      await wait(500);
      const rows = window.__rowIds();
      return {
        ok: deleted, errCount, rows, rowsLen: rows.length,
        gid, targetOwner, nowOwner: inkDocOwnerId(),
        targetInStack: !!inkLayerById(gid),
        attachedCount: inkLayersForOwner(inkDocOwnerId()).length,
      };
    })()`);
    check('katlanma · katlanmış klasör silinir; üyeler sıradan katman olarak döner',
      foldDelete && foldDelete.ok && foldDelete.rowsLen >= 3,
      foldDelete ? { rows: foldDelete.rowsLen, errs: foldDelete.errCount, target: foldDelete.targetInStack } : foldDelete);
    check('çalışma sayfası hatası YOK (E+F)',
      await evaluate(ws, `window.__ffErrs.length === 0`), null);

  } catch (err) {
    console.error('KIRILMA:', err);
    fail++;
  } finally {
    app.kill();
    console.log(`\nLAYER-FLIP-FOLD: ${pass} geçti, ${fail} kaldı`);
    process.exit(fail ? 1 : 0);
  }
})();
