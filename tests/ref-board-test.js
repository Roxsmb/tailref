'use strict';

/* Referans tahtası davranış testi — gerçek Electron penceresinde, gerçek
   DOM olaylarıyla. Kapsam (12 Kasım bug avı regresyonları):

   - Metin düzenlemesi tek Ctrl+Z ile geri alınır; önceki işlem kaybolmaz.
   - Tutamaç/çerçeve tıklaması boş geri-alma adımı bırakmaz; gerçek
     boyutlandırma tek adım üretir.
   - Kilitli görsel çoklu sürüklemede, ok tuşunda ve grup ölçeklemesinde
     yerinde kalır.
   - Ok tuşuyla kaydırma tek geri-alma adımında toplanır.
   - Kopyala/yapıştır ve Ctrl+A sonrası "arkaya gönder" seçimin tamamına
     uygulanır.
   - Grup başlığı düzenlemesi geri alınabilir ve grubu çözmez.
   - Çöpten geri gelen bağlantı oku yeniden çizilir.

   Kullanım: node tests/ref-board-test.js
   Kapı zinciri: scripts/run-gates.js (PURE). */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9366;
const APP_PORT = 5226;
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
  const timer = setTimeout(() => reject(new Error('eval zaman aşımı')), 30000);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

async function waitForTarget(deadlineMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz değil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

/* Sayfa içinde kullanılan ortak hazırlık/olay yardımcıları. */
const PRELUDE = `
  window.__refQa = {
    reset() {
      state.items = []; state.links = []; state.trash = [];
      state.groupParents = {}; state.groupTitles = {}; state.groupImportant = {};
      selection = new Set(); selectionOrder = [];
      undoStack.length = 0; redoStack.length = 0;
      editingId = null;
      state.view = { x: 0, y: 0, scale: 1 };
      applyView(); syncAll();
      return true;
    },
    text(text, x, y) {
      addText(screenToWorld({ x, y }));
      const it = state.items[state.items.length - 1];
      const t = elMap.get(it.id).querySelector('.text');
      t.textContent = text;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      return it.id;
    },
    async image(color, x, y) {
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color || '#3a7'; ctx.fillRect(0, 0, 240, 160);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], 'ref-board-test.png', { type: 'image/png' });
      await addFiles([file], screenToWorld({ x, y }));
      return state.items[state.items.length - 1].id;
    },
    select(ids) { selection = new Set(ids); selectionOrder = ids.slice(); syncSelection(); },
    fire(target, type, x, y, pointerId) {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: pointerId || 3, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      }));
      return true;
    },
    dragHandle(handle, dx, dy) {
      const r = handle.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      this.fire(handle, 'pointerdown', x, y, 4);
      this.fire(window, 'pointermove', x + dx, y + dy, 4);
      this.fire(window, 'pointerup', x + dx, y + dy, 4);
      return true;
    },
    dragItem(id, dx, dy) {
      const el = elMap.get(id);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      this.fire(el, 'pointerdown', x, y, 5);
      this.fire(window, 'pointermove', x + dx, y + dy, 5);
      this.fire(window, 'pointerup', x + dx, y + dy, 5);
      return true;
    },
    key(target, key, extra) {
      target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra || {})));
      return true;
    },
    typed(el, text) {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
  };
  true;
`;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-refboard-'));
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

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth");
        if (ready) break;
      } catch { /* henüz değil */ }
      await sleep(400);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    /* Kayıt modu karşılama katmanı varsa geç. */
    for (let i = 0; i < 40; i++) {
      const done = await evaluate(ws, `(() => {
        const w = document.getElementById('persistenceWelcome');
        if (!w || w.hidden) return true;
        if (!document.querySelector('.pwOption.is-selected')) document.querySelector('.pwOption[data-mode="auto"]')?.click();
        const b = document.getElementById('pwContinue');
        if (b && !b.disabled) b.click();
        return !!w.hidden;
      })()`);
      if (done) break;
      await sleep(300);
    }
    await sleep(600);
    await evaluate(ws, PRELUDE);

    /* 1 · Metin düzenlemesi tek adımda geri alınır; sonraki işlem korunur. */
    const textUndo = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = __refQa.text('ORIGINAL', 300, 320);
      const b = __refQa.text('SECOND', 300, 520);
      startEdit(getItem(a));
      __refQa.typed(elMap.get(a).querySelector('.text'), 'CHANGED');
      commitEdit();
      const undo1 = undoStack.length;
      undo();
      return JSON.stringify({
        undo1,
        text: getItem(a) ? getItem(a).text : null,
        secondAlive: !!getItem(b),
      });
    })()`));
    check('metin düzenlemesi geri alınıyor', textUndo.text === 'ORIGINAL',
      `metin=${JSON.stringify(textUndo.text)}`);
    check('metin geri alırken önceki işlem korunuyor', textUndo.secondAlive,
      textUndo.secondAlive ? 'ikinci yazı duruyor' : 'ikinci yazı kayboldu');

    /* 2 · Tutamaç tıklaması boş adım bırakmaz; gerçek boyutlandırma tek adım. */
    const handle = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const id = await __refQa.image('#4a8', 360, 360);
      __refQa.select([id]);
      const before = undoStack.length;
      __refQa.dragHandle(elMap.get(id).querySelector('.handle.se'), 0, 0);
      __refQa.dragHandle(elMap.get(id).querySelector('.handle.rot'), 0, 0);
      const afterClicks = undoStack.length;
      const w0 = getItem(id).w;
      __refQa.dragHandle(elMap.get(id).querySelector('.handle.se'), 56, 28);
      const afterResize = undoStack.length;
      const w1 = getItem(id).w;
      undo();
      return JSON.stringify({ before, afterClicks, afterResize, w0, w1, wAfterUndo: getItem(id).w });
    })()`));
    check('tutamaç tıklaması boş geri-alma adımı bırakmıyor',
      handle.afterClicks === handle.before, `${handle.before} → ${handle.afterClicks}`);
    check('boyutlandırma tek adım üretiyor ve geri alınıyor',
      handle.afterResize === handle.afterClicks + 1 && Math.abs(handle.wAfterUndo - handle.w0) < 0.5,
      `adım=${handle.afterResize} · w=${Math.round(handle.w1)} → ${Math.round(handle.wAfterUndo)}`);

    /* 3 · Kilitli görsel çoklu sürüklemede yerinde kalır. */
    const lockedDrag = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = await __refQa.image('#c33', 320, 340);
      const b = await __refQa.image('#33c', 640, 340);
      __refQa.select([a]);
      document.getElementById('btnLock').click();
      __refQa.select([a, b]);
      const ax0 = getItem(a).x, bx0 = getItem(b).x;
      __refQa.dragItem(b, 90, 40);
      await new Promise(r => setTimeout(r, 120));
      return JSON.stringify({
        locked: !!getItem(a).locked,
        aMoved: Math.round(getItem(a).x - ax0),
        bMoved: Math.round(getItem(b).x - bx0),
      });
    })()`));
    check('kilitli görsel çoklu sürüklemede oynamıyor',
      lockedDrag.locked && lockedDrag.aMoved === 0 && lockedDrag.bMoved !== 0,
      `kilitli=${lockedDrag.aMoved}px · serbest=${lockedDrag.bMoved}px`);

    /* 4 · Ok tuşu kilidi delmez ve tek adımda geri alınır. */
    const nudge = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = await __refQa.image('#c44', 320, 340);
      const b = await __refQa.image('#44c', 640, 340);
      __refQa.select([a]);
      document.getElementById('btnLock').click();
      __refQa.select([a, b]);
      const ax0 = getItem(a).x, bx0 = getItem(b).x;
      const undo0 = undoStack.length;
      for (let i = 0; i < 10; i++) __refQa.key(stage, 'ArrowRight');
      const undo1 = undoStack.length;
      const aDx = getItem(a).x - ax0, bDx = getItem(b).x - bx0;
      undo();
      return JSON.stringify({
        undo0, undo1, aDx, bDx,
        aAfter: Math.round(getItem(a).x - ax0),
        bAfter: Math.round(getItem(b).x - bx0),
      });
    })()`));
    check('ok tuşu kilitli görseli oynatmıyor', nudge.aDx === 0 && nudge.bDx > 0,
      `kilitli=${nudge.aDx}px · serbest=${nudge.bDx}px`);
    check('ok tuşu kaydırması tek adım ve geri alınabilir',
      nudge.undo1 === nudge.undo0 + 1 && nudge.aAfter === 0 && nudge.bAfter === 0,
      `adım ${nudge.undo0} → ${nudge.undo1} · undo sonrası ${nudge.bAfter}px`);

    /* 5 · Kopyadan sonra "arkaya gönder" eski seçim sırasına takılmaz. */
    const sendBack = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = __refQa.text('A', 300, 320);
      const b = __refQa.text('B', 300, 460);
      const c = __refQa.text('C', 300, 600);
      __refQa.select([a]);
      duplicateSelection();
      const copyId = [...selection][0];
      const z0 = getItem(copyId).z;
      sendToBack();
      return JSON.stringify({ copyId: !!copyId, z0, z1: getItem(copyId).z, others: [a, b, c].length });
    })()`));
    check('kopyadan sonra arkaya gönder çalışıyor', sendBack.z1 < sendBack.z0,
      `z ${sendBack.z0} → ${sendBack.z1}`);

    /* 6 · Ctrl+A sonrası arkaya gönder tüm seçimi gönderir. */
    const sendBackAll = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = __refQa.text('A', 300, 320);
      const b = __refQa.text('B', 300, 460);
      const c = __refQa.text('C', 300, 600);
      __refQa.select([a]);
      selection = new Set([a, b, c]);
      syncSelection();
      const before = Object.fromEntries([a, b, c].map(id => [id, getItem(id).z]));
      sendToBack();
      const after = Object.fromEntries([a, b, c].map(id => [id, getItem(id).z]));
      return JSON.stringify({ allBelow: [a, b, c].every(id => after[id] < before[id]) });
    })()`));
    check('Ctrl+A sonrası arkaya gönder tüm seçimi kapsıyor', sendBackAll.allBelow);

    /* 7 · Grup başlığı düzenlemesi geri alınır, grup çözülmez; Escape
       yazılanı iptal eder ve boş bir geri-alma adımı bırakmaz. */
    const titleUndo = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = __refQa.text('A', 300, 320);
      const b = __refQa.text('B', 520, 320);
      __refQa.select([a, b]);
      groupSelection();
      await new Promise(r => setTimeout(r, 160));
      const gid = state.items.find(i => i.groupId)?.groupId;
      const el = document.querySelector('.gt[data-gid="' + gid + '"] .gtText');
      el.focus();
      el.textContent = 'MY GROUP';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.blur();
      const undo1 = undoStack.length;
      undo();
      const titleAfterUndo = groupTitleOf(gid);

      const el2 = document.querySelector('.gt[data-gid="' + gid + '"] .gtText');
      /* Geri almadan sonra seçim temizlendiği için grup başlığı gizlidir;
         gerçek kullanıcı gibi önce grubu yeniden seç. */
      __refQa.select(state.items.filter(i => i.groupId === gid).map(i => i.id));
      await new Promise(r => setTimeout(r, 80));
      el2.focus();
      el2.textContent = 'TEMP NAME';
      el2.dispatchEvent(new Event('input', { bubbles: true }));
      const undoBeforeEsc = undoStack.length;
      el2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return JSON.stringify({
        undo1, title: titleAfterUndo,
        groupAlive: !!state.items.find(i => i.groupId === gid),
        frame: !!document.querySelector('.gframe[data-gid="' + gid + '"]'),
        titleAfterEsc: groupTitleOf(gid),
        undoBeforeEsc, undoAfterEsc: undoStack.length,
      });
    })()`));
    check('grup başlığı geri alınıyor ve grup korunuyor',
      titleUndo.title === '' && titleUndo.groupAlive && titleUndo.frame,
      `başlık=${JSON.stringify(titleUndo.title)} · grup=${titleUndo.groupAlive}`);
    check('grup başlığında Escape iptal ediyor, boş adım bırakmıyor',
      titleUndo.titleAfterEsc === '' && titleUndo.undoAfterEsc === titleUndo.undoBeforeEsc,
      `başlık=${JSON.stringify(titleUndo.titleAfterEsc)} · adım ${titleUndo.undoBeforeEsc} → ${titleUndo.undoAfterEsc}`);

    /* 8 · Gruptaki kilitli görsel ölçeklenmez; serbest üye ölçeklenir. */
    const groupLock = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = await __refQa.image('#2a2', 300, 340);
      const b = await __refQa.image('#a22', 640, 340);
      __refQa.select([a]);
      document.getElementById('btnLock').click();
      __refQa.select([a, b]);
      groupSelection();
      await new Promise(r => setTimeout(r, 180));
      const aw0 = getItem(a).w, bw0 = getItem(b).w;
      __refQa.dragHandle(document.querySelector('.gframe .ghandle.se'), 80, 50);
      await new Promise(r => setTimeout(r, 120));
      return JSON.stringify({
        lockedChanged: Math.round(getItem(a).w - aw0),
        unlockedChanged: Math.round(getItem(b).w - bw0),
      });
    })()`));
    check('gruptaki kilitli görsel ölçeklenmiyor',
      groupLock.lockedChanged === 0 && groupLock.unlockedChanged > 0,
      `kilitli=${groupLock.lockedChanged}px · serbest=${groupLock.unlockedChanged}px`);

    /* 9 · Silinen bağlantı, çöpten geri gelince yeniden çizilir. */
    const linkRestore = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = await __refQa.image('#483', 320, 340);
      const b = await __refQa.image('#348', 640, 340);
      __refQa.select([a, b]);
      toggleLink();
      const linked = state.links.length;
      deleteSelection();
      const afterDelete = state.links.length;
      await restoreAllTrash();
      await new Promise(r => setTimeout(r, 160));
      return JSON.stringify({
        linked, afterDelete,
        afterRestore: state.links.length,
        svgLines: document.querySelectorAll('#linkLayer .lkLine').length,
      });
    })()`));
    check('çöpten dönen öğenin bağlantısı geri çiziliyor',
      linkRestore.linked === 1 && linkRestore.afterDelete === 0 &&
      linkRestore.afterRestore === 1 && linkRestore.svgLines === 1,
      `bağlantı=${linkRestore.afterRestore} · çizgi=${linkRestore.svgLines}`);

    /* 10 · Kaydırıcıya sadece dokunmak boş geri-alma adımı bırakmaz;
       gerçek değişiklik tek adım üretir ve geri alınır. */
    const slider = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const id = await __refQa.image('#777', 360, 340);
      __refQa.select([id]);
      const el = document.getElementById('itemAlpha');
      const before = undoStack.length;
      const r = el.getBoundingClientRect();
      const x = r.left + 6, y = r.top + r.height / 2;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 21, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 21, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const afterTouch = undoStack.length;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 22, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = '30';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const afterInputs = undoStack.length;
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 22, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 }));
      const alpha = getItem(id).alpha;
      undo();
      return JSON.stringify({ before, afterTouch, afterInputs, alpha, alphaAfterUndo: getItem(id).alpha });
    })()`));
    check('kaydırıcıya dokunmak boş geri-alma adımı bırakmıyor',
      slider.afterTouch === slider.before, `${slider.before} → ${slider.afterTouch}`);
    check('kaydırıcı sürüklemesi tek adım ve geri alınıyor',
      slider.afterInputs === slider.afterTouch + 1 && slider.alpha === 0.3 &&
      (slider.alphaAfterUndo === undefined || slider.alphaAfterUndo === 1),
      `adım=${slider.afterInputs} · alfa=${slider.alpha} → ${slider.alphaAfterUndo}`);

    /* 11 · Geçersiz seçimle grupla çağrısı redo geçmişini silmez. */
    const groupRedo = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = __refQa.text('A', 300, 320);
      __refQa.select([a]);
      sendToBack();
      undo();
      const redoBefore = redoStack.length;
      selection = new Set([a, 'it_ghost_missing']);
      groupSelection();
      return JSON.stringify({ redoBefore, redoAfter: redoStack.length });
    })()`));
    check('geçersiz grupla denemesi redo geçmişini silmiyor',
      groupRedo.redoBefore > 0 && groupRedo.redoAfter === groupRedo.redoBefore,
      `redo ${groupRedo.redoBefore} → ${groupRedo.redoAfter}`);

    /* 12 · Metin görünüm düğmeleri (kalın vb.) tek adımda geri alınır. */
    const textStyle = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = __refQa.text('A', 300, 320);
      __refQa.select([a]);
      const undo0 = undoStack.length;
      document.getElementById('btnBold').click();
      const bold1 = !!getItem(a).bold;
      const undo1 = undoStack.length;
      document.getElementById('btnBold').click();
      const bold2 = !!getItem(a).bold;
      undo();
      const boldAfterUndo = !!getItem(a).bold;
      undo();
      return JSON.stringify({ undo0, undo1, bold1, bold2, boldAfterUndo, boldAfterTwo: !!getItem(a).bold });
    })()`));
    check('metin kalınlaştırma geri alınabilir',
      textStyle.bold1 === true && textStyle.bold2 === false &&
      textStyle.undo1 === textStyle.undo0 + 1 &&
      textStyle.boldAfterUndo === true && textStyle.boldAfterTwo === false,
      `adım=${textStyle.undo1} · ${textStyle.bold1}→${textStyle.bold2} · geri:${textStyle.boldAfterUndo}`);

    /* 13 · Geri alma görünümü (zoom/kaydırma) sıfırlamaz. */
    const keepView = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = await __refQa.image('#5a5', 320, 340);
      __refQa.select([a]);
      const x0 = getItem(a).x;
      __refQa.dragItem(a, 70, 0);
      const movedX = getItem(a).x;
      zoomAt({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, 2);
      const scale1 = state.view.scale;
      undo();
      return JSON.stringify({
        x0: Math.round(x0), movedX: Math.round(movedX),
        afterX: Math.round(getItem(a).x),
        scale1: Math.round(scale1 * 100) / 100,
        scaleAfterUndo: Math.round(state.view.scale * 100) / 100,
      });
    })()`));
    check('geri alma görünüm ölçeğini koruyor',
      keepView.scale1 === 2 && keepView.scaleAfterUndo === keepView.scale1 &&
      keepView.afterX === keepView.x0,
      `ölçek ${keepView.scale1} → ${keepView.scaleAfterUndo} · x ${keepView.movedX} → ${keepView.afterX}`);

    /* 14 · Kilitli görsel silinemez; serbest görsel silinir. */
    const lockedDelete = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = await __refQa.image('#c33', 320, 340);
      const b = await __refQa.image('#3c3', 700, 340);
      __refQa.select([a]);
      toggleLockSelection();
      __refQa.select([a, b]);
      const undo0 = undoStack.length;
      deleteSelection();
      const mixed = { aAlive: !!getItem(a), bGone: !getItem(b) };
      __refQa.select([a]);
      const undo1 = undoStack.length;
      deleteSelection();
      const solo = { aAlive: !!getItem(a), steps: undoStack.length - undo1, trash: state.trash.length };
      return JSON.stringify({ mixed, solo, undoGrew: undoStack.length > undo0 });
    })()`));
    check('kilitli görsel silinmiyor, serbest görsel siliniyor',
      lockedDelete.mixed.aAlive === true && lockedDelete.mixed.bGone === true,
      JSON.stringify(lockedDelete.mixed));
    check('yalnız kilitli seçiliyken silme boş geri-alma adımı bırakmıyor',
      lockedDelete.solo.aAlive === true && lockedDelete.solo.steps === 0,
      JSON.stringify(lockedDelete.solo));

    /* 15 · Çok satırlı metin modelde korunuyor (Chromium <br>/<div>). */
    const multiline = JSON.parse(await evaluate(ws, `(async () => {
      __refQa.reset();
      const a = __refQa.text('HELLO', 320, 340);
      startEdit(getItem(a));
      const t = elMap.get(a).querySelector('.text');
      t.focus();
      t.innerHTML = 'HELLO<br>WORLD';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      const brText = getItem(a).text;
      startEdit(getItem(a));
      const t2 = elMap.get(a).querySelector('.text');
      t2.focus();
      t2.innerHTML = '<div>ONE</div><div>TWO</div>';
      t2.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      const divText = getItem(a).text;
      /* yeniden çizim satırları koruyor mu? */
      updateItemEl(getItem(a), elMap.get(a));
      const domText = elMap.get(a).querySelector('.text').textContent;
      /* geri al sonrası düzenleme güncel modele yazmalı (DOM yeniden
         kullanılıyor; eski kapanış nesnesine yazmak metni kaybettiriyordu) */
      __refQa.select([a]);
      document.getElementById('btnBold').click();
      undo();
      startEdit(getItem(a));
      const t3 = elMap.get(a).querySelector('.text');
      t3.focus();
      t3.textContent = 'AFTER-UNDO';
      t3.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      const afterUndoEdit = getItem(a).text;
      /* boş satırlar çoğalmadan korunmalı (blok sınırı + <br> çift sayılıyordu) */
      startEdit(getItem(a));
      const t4 = elMap.get(a).querySelector('.text');
      t4.focus();
      t4.innerHTML = 'A<div><br></div><div>B</div>';
      t4.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      const blankText = getItem(a).text;
      updateItemEl(getItem(a), elMap.get(a));
      const blankDom = elMap.get(a).querySelector('.text').textContent;
      startEdit(getItem(a));
      const t5 = elMap.get(a).querySelector('.text');
      t5.focus();
      t5.innerHTML = '<div><br></div><div>X</div>';
      t5.dispatchEvent(new Event('input', { bubbles: true }));
      commitEdit();
      const leadText = getItem(a).text;
      return JSON.stringify({ brText, divText, domText, afterUndoEdit, blankText, blankDom, leadText });
    })()`));
    check('çok satırlı metin <br> ve blok div ile korunuyor',
      multiline.brText === 'HELLO\nWORLD' && multiline.divText === 'ONE\nTWO' &&
      multiline.domText === 'ONE\nTWO',
      JSON.stringify(multiline));
    check('geri al sonrası metin düzenlemesi modele yazılıyor',
      multiline.afterUndoEdit === 'AFTER-UNDO', String(multiline.afterUndoEdit));
    check('boş satırlar çoğalmadan korunuyor',
      multiline.blankText === 'A\n\nB' && multiline.blankDom === 'A\n\nB',
      JSON.stringify({ model: multiline.blankText, dom: multiline.blankDom }));
    check('baştaki boş satır korunuyor',
      multiline.leadText === '\nX', JSON.stringify(multiline.leadText));

    /* 16 · Esc açık çöp panelini kapatıyor (uygulama geneli Esc kuralı). */
    const trashEsc = JSON.parse(await evaluate(ws, `(async () => {
      openTrashPanel();
      await new Promise(r => setTimeout(r, 320));
      const opened = !document.getElementById('trashPanel').hidden;
      (document.activeElement || document.body)
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 320));
      return JSON.stringify({ opened, closed: document.getElementById('trashPanel').hidden });
    })()`));
    check('Esc açık çöp panelini kapatıyor',
      trashEsc.opened === true && trashEsc.closed === true, JSON.stringify(trashEsc));

    /* 17 · Konsol/sayfa hatası yok. */
    const errs = await evaluate(ws, 'JSON.stringify(window.__errs || [])');
    check('konsol/sayfa hatası yok', errs === '[]' || errs === 'undefined', errs);
  } catch (e) {
    console.error('TEST HATASI', e && e.stack || e);
    fail++;
  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(600);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
  }

  console.log(fail === 0 ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})` : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
