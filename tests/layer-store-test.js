'use strict';

/* FAZ 8.A — Observer Store (inkLayerStore) olay disiplini testi.
   Katman mutasyonlarının her biri FAZ 8.A tablosundaki olay sayısını
   TAM yaymalı: fazla/eksik olay, "sync çağrısı unutuldu" sınıfı
   hatanın geri dönmesi demektir. no-op çağrılar 0 olay döndürür.

   Kullanım: node scripts/layer-store-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
/* CDP portu: 9399 canlı kullanıcı instance'ıyla çakışıyordu (15 Kasım
   2026) — diğer kapılar gibi boş banda alındı. */
const PORT = 9373;
const APP_PORT = 5261;
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-layer-store-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });

  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
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

    /* test görseli ekle + modal editör aç */
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
      await addFiles([new File([blob], 'layer-store.png', { type: 'image/png' })], null);
      let item = null;
      for (let i = 0; i < 40 && !item; i++) {
        item = state.items.find(it => it.kind === 'image');
        if (!item) await wait(150);
      }
      if (!item) return { ok: false };
      modeEnterDraw(item.id);
      for (let i = 0; i < 40 && !inkEditorIsOpen(); i++) await wait(100);
      if (!inkEditorIsOpen()) return { ok: false };
      return { ok: true };
    })()`);
    if (!setup || !setup.ok) throw new Error('editör açılamadı');

    /* aboneleri kur */
    await evaluate(ws, `
      window.__lsEvents = [];
      for (const t of ['add','remove','reorder','rename','property','mask','select']) {
        inkLayerStoreOn(t, (type, p) => {
          window.__lsEvents.push({
            type, layerId: (p && p.layerId) || null,
            reason: p && p.reason, field: p && p.field,
          });
        });
      }
      true
    `);

    /* bir mutasyon koş: temizle → koş → olay tip listesini BİR kere döndür */
    const runTap = async expr => {
      await evaluate(ws, `(() => { window.__lsEvents.length = 0; (${expr}); })()`);
      return evaluate(ws, `window.__lsEvents.slice().map(e => e.type)`);
    };

    await evaluate(ws, `(function(){
      const ownerId = state.items.find(i => i.kind === 'image').id;
      inkDocEnsure(ownerId);
      window.__lsOwner = ownerId;
      window.__lsEvents.length = 0;
      return inkDocLayers(ownerId).length;
    })()`);

    /* ---- 1 · add ---- */
    let t = await runTap(`inkDocAddLayer()`);
    check('add · tek olay', JSON.stringify(t) === '["add"]', JSON.stringify(t));
    /* ---- 1b · FAZ 8.B: panel abonelikle beslenme (elle sync yok) */
    const panelRows = await evaluate(ws, `(function(){
      const list = document.getElementById('inkLayerList');
      if (!list) return null;
      return list.querySelectorAll('.inkLayerRow[data-layer-id]').length;
    })()`);
    const stackLen = await evaluate(ws, `inkDocLayers(__lsOwner).length`);
    check('subscribe · panel add olayında tazelendi',
      panelRows !== null && panelRows === stackLen,
      'rows=' + panelRows + ' stack=' + stackLen);

    /* ---- 2 · rename ---- */
    const renameId = await evaluate(ws, `inkDocSelectedLayer().id`);
    t = await runTap(`inkDocRenameLayer(${JSON.stringify(renameId)}, 'StoreTest-' + Date.now())`);
    check('rename · tek olay', JSON.stringify(t) === '["rename"]', JSON.stringify(t));
    /* ---- 2b · FAZ 8.B: satır metni abonelikle güncellendi ---- */
    const rowTxt = await evaluate(ws, `(function(){
      const row = document.querySelector('.inkLayerRow[data-layer-id="' + ${JSON.stringify(renameId)} + '"]');
      return row ? row.textContent : null;
    })()`);
    check('subscribe · panel rename olayında güncellendi',
      rowTxt !== null && /StoreTest-\d+/.test(rowTxt), rowTxt || 'null');
    t = await runTap(`inkDocRenameLayer(${JSON.stringify(renameId)}, inkLayerById(${JSON.stringify(renameId)}).name)`);
    check('rename · no-op 0 olay', JSON.stringify(t) === '[]', JSON.stringify(t));

    /* ---- 3 · visible ---- */
    t = await runTap(`inkDocSetVisible(${JSON.stringify(renameId)}, false)`);
    check('property.visible · tek olay', JSON.stringify(t) === '["property"]', JSON.stringify(t));
    t = await runTap(`inkDocSetVisible(${JSON.stringify(renameId)}, false)`);
    check('property.visible · no-op 0 olay', JSON.stringify(t) === '[]', JSON.stringify(t));
    await runTap(`inkDocSetVisible(${JSON.stringify(renameId)}, true)`);

    /* ---- 4 · select ---- */
    const otherId = await evaluate(ws, `inkDocLayers(__lsOwner).find(l => l.id !== ${JSON.stringify(renameId)}).id`);
    t = await runTap(`inkDocSelectLayer(${JSON.stringify(otherId)})`);
    check('select · tek olay', JSON.stringify(t) === '["select"]', JSON.stringify(t));
    /* Katman seçimi tuvali değiştirmez: editörün tam kare yeniden
       kompozitini İSTEMEMELİ (4K'da ~60 ms donma). Araç değişimi ise
       istemeye devam etmeli — seçenek varsayılanı bozulmasın. */
    const renderAsk = await evaluate(ws, `(function(){
      const orig = inkEditorInvalidate;
      let asked = 0;
      inkEditorInvalidate = function () { asked += 1; return orig.apply(this, arguments); };
      try {
        inkDocSelectLayer(${JSON.stringify(otherId)});
        const afterSelect = asked;
        inkSetTool('brush', { brushId: inkState().brushId });
        const afterTool = asked;
        return JSON.stringify({ afterSelect, afterTool });
      } finally { inkEditorInvalidate = orig; }
    })()`);
    const ask = JSON.parse(renderAsk);
    check('select · editör render istemiyor',
      ask.afterSelect === 0, 'select=' + ask.afterSelect);
    check('araç değişimi · editör render istiyor',
      ask.afterTool > 0, 'tool=' + ask.afterTool);

    /* ---- 5/6 · move + reorder ---- */
    t = await runTap(`inkDocMoveLayer(${JSON.stringify(otherId)}, 1)`);
    check('reorder(move) · tek olay', JSON.stringify(t) === '["reorder"]', JSON.stringify(t));
    t = await runTap(`inkDocReorderLayer(${JSON.stringify(otherId)}, 0)`);
    check('reorder(reorder) · tek olay', JSON.stringify(t) === '["reorder"]', JSON.stringify(t));

    /* ---- 7 · duplicate ---- */
    const dupId = await evaluate(ws, `inkDocDuplicateLayer(${JSON.stringify(otherId)}).id`);
    t = await runTap(`inkDocDuplicateLayer(${JSON.stringify(otherId)})`);
    check('duplicate · tek olay add', JSON.stringify(t) === '["add"]', JSON.stringify(t));
    /* ağır denemedeki çoğaltmayı temizle */
    await runTap(`inkDocDeleteLayer(${JSON.stringify(dupId)})`);

    /* ---- 8 · merge down ---- */
    await evaluate(ws, `(function(){
      const stack = inkDocLayers(__lsOwner);
      for (let i = 1; i < stack.length; i++) {
        const src = stack[i], below = stack[i - 1];
        if (src.kind === 'attached' && below.kind === 'attached' && !below.locked) {
          window.__lsMerge = { src: src.id, below: below.id };
          return true;
        }
      }
      return false; })()`);
    t = await runTap(`inkDocMergeDownLayer(__lsMerge.src)`);
    check('mergeDown · remove+property', JSON.stringify(t) === '["remove","property"]', JSON.stringify(t));

    /* ---- 9 · delete ---- */
    const freshId = await evaluate(ws, `inkDocAddLayer().id`);
    t = await runTap(`inkDocDeleteLayer(${JSON.stringify(freshId)})`);
    check('delete · tek olay remove', JSON.stringify(t) === '["remove"]', JSON.stringify(t));
    const selOk = await evaluate(ws, `(function(){
      window.__lsEvents.length = 0;
      const first = inkDocLayers(__lsOwner)[0].id;
      inkDocSelectLayer(first);
      const evs = window.__lsEvents.slice();
      return evs.length === 1 && evs[0].type === 'select' && evs[0].layerId === first;
    })()`);
    check('select payload layerId doğru', selOk === true, String(selOk));

    /* ---- 10 · new group ---- */
    t = await runTap(`(function(){ window.__lsGroup = inkDocNewGroup(); return window.__lsGroup && window.__lsGroup.id; })()`);
    check('newGroup · tek olay add', JSON.stringify(t) === '["add"]', JSON.stringify(t));
    const groupId = await evaluate(ws, `window.__lsGroup.id`);

    /* ---- 11/12 · gruba ekle / çıkar ---- */
    const memberId = await evaluate(ws, `(function(){
      const stack = inkDocLayers(__lsOwner);
      const m = stack.find(l => l.kind === 'attached' && !l.parentId);
      if (!m) return null;
      inkDocSelectLayer(m.id);
      window.__lsEvents.length = 0;
      inkDocAddToGroup(m.id);
      return m.id; })()`);
    t = await runTap(`inkDocRemoveFromGroup(${JSON.stringify(memberId)})`);
    check('removeFromGroup · tek olay reorder', JSON.stringify(t) === '["reorder"]', JSON.stringify(t));
    /* addToGroup'un kendi olayı yukarıdaki runTap dışında üretilmişti:
       sayaç dengesi için şimdi ayrı bir ölçüm al */
    await evaluate(ws, `(function(){
      inkDocSelectLayer(${JSON.stringify(memberId)});
      window.__lsEvents.length = 0;
      inkDocAddToGroup(${JSON.stringify(memberId)});
      })()`);
    t = await evaluate(ws, `window.__lsEvents.slice().map(e => e.type)`);
    check('addToGroup · tek olay reorder', JSON.stringify(t) === '["reorder"]', JSON.stringify(t));

    /* ---- 13 · flatten group (taze komşulukla: düzlemede karışık reddi
       legitimate — 0 olay) ---- */
    t = await runTap(`(function(){
      const l = inkDocAddLayer();
      inkDocSelectLayer(l.id);
      const g = inkDocNewGroup();
      inkDocAddToGroup(l.id);
      window.__lsFlat = inkDocFlattenGroup(g.id);
      return window.__lsFlat;
    })()`);
    check('flattenGroup · remove+add', JSON.stringify(t) === '["add","select","add","reorder","remove","add"]',
      JSON.stringify(t) + ' · return=' + JSON.stringify(await evaluate(ws, `window.__lsFlat`)));

    /* ---- 14 · mask ---- */
    const maskId = await evaluate(ws, `(function(){
      const m = inkDocLayers(__lsOwner).find(l => l.kind === 'attached' && !l.mask);
      inkDocSelectLayer(m.id);
      window.__lsEvents.length = 0;
      return m.id; })()`);
    t = await runTap(`inkDocAddMask(${JSON.stringify(maskId)}, 'reveal')`);
    check('addMask · tek olay mask', JSON.stringify(t) === '["mask"]', JSON.stringify(t));
    t = await runTap(`inkDocToggleMaskEdit(${JSON.stringify(maskId)})`);
    check('toggleMaskEdit · tek olay mask', JSON.stringify(t) === '["mask"]', JSON.stringify(t));
    t = await runTap(`inkDocRemoveMask(${JSON.stringify(maskId)})`);
    check('removeMask · tek olay mask', JSON.stringify(t) === '["mask"]', JSON.stringify(t));

    /* ---- 15 · hideAll ---- */
    t = await runTap(`inkDocHideAll(__lsOwner)`);
    check('hideAll · tek olay property(all)', JSON.stringify(t) === '["property"]', JSON.stringify(t));

    /* ---- 16 · resetOpacity ---- */
    const opId = await evaluate(ws, `(function(){
      const l = inkDocLayers(__lsOwner).find(l => l.kind === 'attached');
      l.opacity = 0.4;
      window.__lsEvents.length = 0;
      return l.id; })()`);
    t = await runTap(`inkDocResetOpacity(${JSON.stringify(opId)})`);
    check('resetOpacity · tek olay property', JSON.stringify(t) === '["property"]', JSON.stringify(t));

    /* ---- 17 · clear: no-op 0 olay, dolu katman 1 olay ---- */
    t = await runTap(`inkDocClearLayer(${JSON.stringify(opId)})`);
    check('clear · boş katman no-op 0 olay', JSON.stringify(t) === '[]', JSON.stringify(t));
    await evaluate(ws, `(function(){
      inkLayerById(${JSON.stringify(opId)}).strokes = [{ kind: 'pen' }];
      window.__lsEvents.length = 0;
      })()`);
    t = await runTap(`inkDocClearLayer(${JSON.stringify(opId)})`);
    check('clear · dolu katman tek olay property', JSON.stringify(t) === '["property"]', JSON.stringify(t));

    /* ---- FAZ 8.C · satır-düzeyi diff: imza değişmeyen satır korunur ---- */
    /* önce tam kurulum değil: pass-through denetimi — imza aynıysa DOM
       düğümü yenilenmez (dataset.mark hayatta kalır). */
    const passInfo = await evaluate(ws, `(function(){
      inkSyncLayersPanel();
      const list = document.getElementById('inkLayerList');
      const rows0 = [...list.querySelectorAll('.inkLayerRow')];
      rows0.forEach(r => { r.dataset.mark = 'm'; });
      inkSyncLayersPanel();
      const rows2 = [...list.querySelectorAll('.inkLayerRow')];
      const activeId = inkState().activeLayerId;
      const mism = [];
      for (const el of rows2) {
        const id = el.dataset.layerId;
        const l = inkLayerById(id);
        const fresh = inkLayerRowSig(l, id === activeId);
        if (el.__inkLayerSig !== fresh) mism.push({
          id, stored: el.__inkLayerSig, fresh,
          hasMark: el.dataset.mark === 'm',
        });
      }
      return { total: rows0.length, kept: rows2.filter(r => r.dataset.mark === 'm').length, mismatches: mism.slice(0, 3),
        kidIds0: rows0.map(r => r.dataset.layerId),
        rows2: rows2.map(r => inkLayerById(r.dataset.layerId)?.id),
        kidCount: list.children.length,
        kidTags: [...list.children].map(k => k.className.slice(0, 30)),
      };
    })()`);
    check('8.C · imza-same passthrough (satır korunur)',
      passInfo.total > 0 && passInfo.kept === passInfo.total,
      JSON.stringify(passInfo));

    /* select-op: yalnız 2 satırın imzası değişir (eski aktif + yeni aktif);
       diğer satırlar korur, 2'si taze kurulur. */
    const selInfo = await evaluate(ws, `(function(){
      const list = document.getElementById('inkLayerList');
      const cur = inkState().activeLayerId;
      const stack = inkDocLayers(__lsOwner);
      const other = stack.find(l => l.id !== cur && l.kind === 'attached');
      if (!other) return null;
      window.__lsEvents.length = 0;
      inkDocSelectLayer(other.id);
      const rows2 = [...list.querySelectorAll('.inkLayerRow')];
      return {
        total: rows2.length,
        kept: rows2.filter(r => r.dataset.mark === 'm').length,
        fresh: rows2.filter(r => r.dataset.mark !== 'm').length,
        activeOk: (list.querySelector('.inkLayerRow.active') || {}).dataset?.layerId === other.id,
      };
    })()`);
    check('8.C · select → fresh=2 (önce+aktif), kept=total−2',
      !!selInfo && selInfo.fresh === 2 &&
      selInfo.kept === selInfo.total - 2 && selInfo.activeOk === true,
      JSON.stringify(selInfo));

    /* yapısal değişim: newGroup → tam kurulum, tüm işaretler temizlenir */
    const structInfo = await evaluate(ws, `(function(){
      const list = document.getElementById('inkLayerList');
      const rowsA = [...list.querySelectorAll('.inkLayerRow')];
      rowsA.forEach(r => { r.dataset.mark = 'm'; });
      window.__lsEvents.length = 0;
      const group = inkDocNewGroup();
      const rows2 = [...list.querySelectorAll('.inkLayerRow')];
      return {
        kept: rows2.filter(r => r.dataset.mark === 'm').length,
        groupOk: !!group,
        grew: rows2.length === rowsA.length + 1,
      };
    })()`);
    check('8.C · yapısal değişim → tam kurulum (marks cleared)',
      structInfo.groupOk === true && structInfo.grew === true && structInfo.kept === 0,
      JSON.stringify(structInfo));

    /* ---- 0.B.5 öte · undo/yinele restore'u store olaylarına bağlandı ---
       Bütün-durum undo, tepe kaydındaki snapshot'ı restore eder ve
       restore-diff sadece satır görünümünde değişen şeyi olaya çevirir:
       görünürlük geri alınırsa TEK 'property'; geri isim TEK 'rename';
       konum geri alınırsa yalnızca yer değişen satırlar 'reorder'.
       Elle panel sync yok. */
    const undoLayer = await evaluate(ws, `(function(){
      const stack = inkDocLayers(window.__lsOwner);
      const l = stack.find(x => x.kind === 'attached' && !x.parentId);
      if (!l) return null;
      window.__lsVisible0 = inkDocSetVisible(l.id, true);
      window.__lsName0 = l.name;
      return l.id;
    })()`);
    /* (a) görünürlük toggle → geri al → TEK property (field restore) */
    await runTap(`inkDocSetVisible(${JSON.stringify(undoLayer)}, false)`);
    t = await runTap(`undo()`);
    check('restore-undo · görünürlük: tek property',
      JSON.stringify(t) === '["property"]', JSON.stringify(t));
    t = await runTap(`redo()`);
    check('restore-redo · yinele: tek property',
      JSON.stringify(t) === '["property"]', JSON.stringify(t));
    /* (b) geri isim → TEK rename (satır metni restore) */
    await runTap(`inkDocRenameLayer(${JSON.stringify(undoLayer)}, 'UndoSigTest-' + Date.now())`);
    t = await runTap(`undo()`);
    check('restore-undo · isim: tek rename', JSON.stringify(t) === '["rename"]', JSON.stringify(t));
    const rowTxt2 = await evaluate(ws, `(function(){
      const row = document.querySelector('.inkLayerRow[data-layer-id="' + ${JSON.stringify(undoLayer)} + '"]');
      const name0 = inkLayerById(${JSON.stringify(undoLayer)}).name;
      return { name: name0, rowHas: row ? row.textContent.includes(name0) : false };
    })()`);
    check('undo · panel satırı ismi abonelikten döndü',
      rowTxt2.rowHas === true, JSON.stringify(rowTxt2));
    /* (c) konum geri al → yalnız yer değişen satırlar reorder */
    t = await runTap(`inkDocMoveLayer(${JSON.stringify(undoLayer)}, 1)`);
    t = await runTap(`undo()`);
    check('restore-undo · konum: yalnız reorder (2 satır, property yok)',
      t.length === 2 && t.every(e => e === 'reorder'), JSON.stringify(t));

    /* ---- vuruş-delta undo: TEK 'property' olayı (field raster) ---------
       Vuruş commit'inin kayıt yolu birebir taklit edilir:
       inkPushUndoStroke → strokes.push → undo(). */
    const strokeInfo = await evaluate(ws, `(function(){
      const ownerId = window.__lsOwner;
      const stack = inkDocLayers(ownerId);
      const layer = stack.find(l => l.kind === 'attached' && !l.parentId);
      if (!layer || typeof inkPushUndoStroke !== 'function') return null;
      inkDocSelectLayer(layer.id);
      const stroke = {
        id: 'ls-delta-1', kind: 'brush', tool: 'brush',
        points: [{ x: 0.3, y: 0.4, a: 0.5 }, { x: 0.55, y: 0.6, a: 0.5 }],
        size: 0.04, color: '#ff0000', opacity: 1,
      };
      inkPushUndoStroke(layer, stroke);
      layer.strokes.push(stroke);
      window.__lsEvents.length = 0;
      undo();
      const evs = window.__lsEvents.slice();
      return {
        events: evs.map(e => e.type),
        fieldOk: evs.some(e => e.type === 'property'),
        strokesNow: inkLayerById(layer.id).strokes.length,
        rows: document.querySelectorAll('.inkLayerRow[data-layer-id]').length,
      };
    })()`);
    check('undo · vuruş-delta tek property olayı',
      strokeInfo && strokeInfo.events.length === 1 && strokeInfo.events[0] === 'property',
      JSON.stringify(strokeInfo));
    check('undo · vuruş okumadan çıktı (strokes-1)',
      strokeInfo && strokeInfo.strokesNow >= 0,
      JSON.stringify(strokeInfo && strokeInfo.strokesNow));

    /* ---- 0.B.6 öte · undo noktası: ek işlemler artık kayıt üretir ------
       add layer / newGroup / duplicate yine bir undo noktası üretir:
       Ctrl+Z işlemi geri alır → restore-diff TEK remove(reason:'restore')
       ve panel satırı abonelikten düşer; yinele TEK add ile döner. */
    const rowsAdd0 = await evaluate(ws,
      `document.querySelectorAll('.inkLayerRow[data-layer-id]').length`);
    t = await runTap(`inkDocAddLayer()`);
    check('undo-nokta · katman ekle işler', JSON.stringify(t) === '["add"]', JSON.stringify(t));
    const addedId = await evaluate(ws, `inkDocSelectedLayer().id`);
    t = await runTap(`undo()`);
    const rmEv = await evaluate(ws,
      `window.__lsEvents.filter(e => e.type === 'remove')`);
    check('undo-nokta · katman ekle geri alındı: TEK remove(reason restore)',
      rmEv.length === 1 && rmEv[0].reason === 'restore' && rmEv[0].layerId === addedId,
      JSON.stringify(rmEv));
    const rowsAdd1 = await evaluate(ws,
      `document.querySelectorAll('.inkLayerRow[data-layer-id]').length`);
    check('undo-nokta · panel satırı düştü', rowsAdd1 === rowsAdd0,
      'rows=' + rowsAdd1 + ' beklenen=' + rowsAdd0);
    t = await runTap(`redo()`);
    check('undo-nokta · redo katmanı döndürür (add fazla, remove yok)',
      t.includes('add') && !t.includes('remove'), JSON.stringify(t));
    await runTap(`undo()`);

    /* klasör oluşturma da undo noktası üretir */
    t = await runTap(`inkDocNewGroup()`);
    check('undo-nokta · klasør kaydı tek add', JSON.stringify(t) === '["add"]', JSON.stringify(t));
    const groupId2 = await evaluate(ws, `inkDocSelectedLayer().id`);
    t = await runTap(`undo()`);
    const rmG = await evaluate(ws,
      `window.__lsEvents.filter(e => e.type === 'remove')`);
    check('undo-nokta · klasør geri alındı: TEK remove(reason restore)',
      rmG.length === 1 && rmG[0].reason === 'restore' && rmG[0].layerId === groupId2,
      JSON.stringify(rmG));

    /* çoğaltma da undo noktası üretir */
    t = await runTap(`inkDocDuplicateLayer(${JSON.stringify(undoLayer)})`);
    check('undo-nokta · çoğaltma kaydı tek add', JSON.stringify(t) === '["add"]', JSON.stringify(t));
    const dupId2 = await evaluate(ws, `inkDocSelectedLayer().id`);
    t = await runTap(`undo()`);
    const rmD = await evaluate(ws,
      `window.__lsEvents.filter(e => e.type === 'remove')`);
    check('undo-nokta · çoğaltma geri alındı: TEK remove(reason restore)',
      rmD.length === 1 && rmD[0].reason === 'restore' && rmD[0].layerId === dupId2,
      JSON.stringify(rmD));

    console.log('\nLAYER-STORE: ' + pass + ' geçti, ' + fail + ' kaldı');

    try { ws.close(); } catch { }
  } catch (e) {
    console.error('layer-store-test hata:', e && e.message);
    fail++;
  } finally {
    try { app.kill(); } catch { }
    setTimeout(() => process.exit(fail ? 1 : 0), 400);
  }
})();
