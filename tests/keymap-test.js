'use strict';

/* KALICI KAPI · tests/keymap-test.js — Tur 4b.7 (TODO-4b-keymap.md).
   run-gates.js --full zincirinde koşar. Kapsam:
   • window.tailrefKeymap var + 60 eylem tablosu (16 ink delege adayı
     + 21 tahta + 2 editör + 13 pose3d + 3 shell + 3 layers — FAZ 3a).
   • get/set/reset/conflicts + kalıcılık (localStorage 'tailref-keymap').
   • sabit tuş reddi + bilinmeyen eylem reddi + force çakışması.
   • signatureFromEvent (KeyboardEvent) + isTyping.
   • 4b.2: tahta eylem yeniden ataması gerçek keydown ateşler.
   • 4b.3: metin girişi odaklıyken tek tuş eylemi ateşlemez.
   • 4b.4: Ayarlar > Shortcuts keymap grupları (render/yakalama/çakışma/
     Escape iptal/tekil+toplu sıfırlama).
   • 4b.5: tuş rehberi (#inkKeyHelp) kbd'leri keymap'ten üretilir.
   • 4b.6: tercih yedeği export/import round-trip + kötü veri filtresi.
   • konsol/sayfa hatası yok. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9342;
const APP_PORT = 5208;
const SHOT_DIR = path.join(os.tmpdir(), 'tailref-keymap-shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const found = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(found)) throw new Error('electron bulunamadı');
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
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 15000);
});

const send = (ws, method, params) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => reject(new Error(method + ' zaman aşımı')), 15000);
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-kmtest-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  let ws = null;
  let pass = 0, fail = 0;
  const errors = [];
  const check = (name, ok, detail) => {
    if (ok) { pass++; console.log(`OK   ${name}  → ${detail || ''}`); }
    else { fail++; errors.push(name); console.log(`FAIL ${name}  → ${detail || ''}`); }
  };

  try {
    const target = await waitForTarget();
    ws = await connect(target.webSocketDebuggerUrl);
    await send(ws, 'Runtime.enable', {});
    await send(ws, 'Page.enable', {});

    /* keymap hazır olana dek bekle (boot yarışı). */
    let kmReady = false;
    for (let i = 0; i < 40 && !kmReady; i++) {
      try { kmReady = (await evaluate(ws, `typeof window.tailrefKeymap`)) === 'object'; } catch { /* retry */ }
      if (!kmReady) await sleep(400);
    }
    check('keymap: modül yüklü', kmReady, `tip=${kmReady ? 'object' : 'yok'}`);
    await sleep(800);

    const core = JSON.parse(await evaluate(ws, `(() => {
      const km = window.tailrefKeymap;
      if (!km) return JSON.stringify({ missing: true });
      const all = km.all();
      const groups = {};
      for (const a of all) groups[a.group] = (groups[a.group] || 0) + 1;
      return JSON.stringify({
        missing: false,
        n: all.length,
        groups,
        api: ['get','set','reset','resetAll','conflicts','all','registerDelegate','signatureFromEvent','isTyping','isFixedKey'].filter(k => typeof km[k] !== 'function'),
        brushDefault: km.get('toolBrush'),
        boardFitDefault: km.get('board.fit'),
        rotDefault: km.get('editor.rotateView'),
        poseDetach: km.get('pose3d.detach'),
        poseMove: km.get('pose3d.move'),
        poseRotate: km.get('pose3d.rotate'),
        poseGrow: km.get('pose3d.grow'),
        poseAxis: [km.get('pose3d.axisX'), km.get('pose3d.axisY'), km.get('pose3d.axisZ'), km.get('pose3d.axisAll')],
        poseFocus: km.get('pose3d.focus'),
        poseCam: km.get('pose3d.cameraMode'),
        poseFrame: km.get('pose3d.frameAll'),
        poseUndo: km.get('pose3d.undo'),
        poseRedo: km.get('pose3d.redo'),
        /* FAZ 3a yeni gruplar */
        shellDraw: km.get('shell.drawMode'),
        shellRef: km.get('shell.referenceMode'),
        shellPose: km.get('shell.poseMode'),
        layersDup: km.get('layers.duplicate'),
        layersUp: km.get('layers.moveUp'),
        layersDown: km.get('layers.moveDown'),
        boardUndo: km.get('board.undo'),
        boardExport: km.get('board.export'),
        editorFree: km.get('editor.freeTransform'),
      });
    })()`));
    check('keymap: modül + 60 eylem + API tam (pose3d 13 + shell 3 + layers 3 varsayılan)',
      core && !core.missing && core.n === 60 && Array.isArray(core.api) && core.api.length === 0 &&
        core.brushDefault === 'b' && core.boardFitDefault === 'f' && core.rotDefault === 'r' &&
        core.groups.pose3d === 13 && core.groups.board === 21 && core.groups.editor === 2 &&
        core.groups.shell === 3 && core.groups.layers === 3 &&
        core.poseDetach === 'q' && core.poseMove === 'w' && core.poseRotate === 'e' && core.poseGrow === 'r' &&
        core.poseAxis.join(',') === 'x,y,z,a' && core.poseFocus === 'f' &&
        core.poseCam === '5' && core.poseFrame === '0' &&
        core.poseUndo === 'ctrl+z' && core.poseRedo === 'ctrl+y' &&
        core.shellDraw === 'ctrl+1' && core.shellRef === 'ctrl+2' && core.shellPose === 'ctrl+3' &&
        core.layersDup === 'ctrl+j' && core.layersUp === 'ctrl+]' && core.layersDown === 'ctrl+[' &&
        core.boardUndo === 'ctrl+z' && core.boardExport === 'ctrl+e' && core.editorFree === 'ctrl+t',
      `n=${core.n} grup=${JSON.stringify(core.groups)} eksik=${Array.isArray(core.api) ? core.api.join(',') : 'API?'} brush=${core.brushDefault}`);

    const setRes = JSON.parse(await evaluate(ws, `(() => {
      const km = window.tailrefKeymap;
      const before = km.get('board.group');
      const s1 = km.set('board.group', 'j');
      const after = km.get('board.group');
      const store = localStorage.getItem('tailref-keymap');
      const r1 = km.reset('board.group');
      const back = km.get('board.group');
      return JSON.stringify({ before, s1: s1.ok, after, stored: !!store && JSON.parse(store).actions['board.group'] === 'j', reset: r1.ok, back });
    })()`));
    check('keymap: set → kalıcılık → reset',
      setRes.before === 'g' && setRes.s1 && setRes.after === 'j' && setRes.stored && setRes.reset && setRes.back === 'g',
      `g→${setRes.after}→${setRes.back} kayıt=${setRes.stored}`);

    const fixed = JSON.parse(await evaluate(ws, `(() => {
      const km = window.tailrefKeymap;
      return JSON.stringify({
        escape: km.set('board.group', 'escape').ok,
        unknown: km.set('yok.eylem', 'z').ok,
        alt: km.signatureFromEvent({ key: 'b', altKey: true, ctrlKey: false, shiftKey: false }),
        ctrl: km.signatureFromEvent({ key: 'b', altKey: false, ctrlKey: true, shiftKey: false }),
        shiftOnly: km.signatureFromEvent({ key: 'b', altKey: false, ctrlKey: false, shiftKey: true }),
        plain: km.signatureFromEvent({ key: 'B', altKey: false, ctrlKey: false, shiftKey: false }),
      });
    })()`));
    check('keymap: sabit tuş/bilinmeyen eylem reddi + imza kuralları',
      fixed.escape === false && fixed.unknown === false && fixed.alt === '' &&
        fixed.shiftOnly === '' && fixed.ctrl === 'ctrl+b' && fixed.plain === 'b',
      `esc=${fixed.escape} bilinmeyen=${fixed.unknown} alt="${fixed.alt}" ctrl="${fixed.ctrl}" plain="${fixed.plain}"`);

    const conflictsRes = JSON.parse(await evaluate(ws, `(() => {
      const km = window.tailrefKeymap;
      const c1 = km.conflicts('b'); // toolBrush (ink) + board.bringFront (board)
      const s = km.set('board.group', 'b'); // çakışma: blok
      const sForce = km.set('board.group', 'b', { force: true }); // force: uygular
      const after = km.get('board.group');
      km.reset('board.group');
      return JSON.stringify({
        c1: c1.map(c => c.id),
        blocked: !s.ok, conflictId: s.conflict && s.conflict.id,
        forced: sForce.ok, forcedConflict: sForce.conflict && sForce.conflict.id, after,
      });
    })()`));
    check('keymap: çakışma tespiti (blok + force)',
      conflictsRes.c1.includes('toolBrush') && conflictsRes.c1.includes('board.bringFront') &&
        conflictsRes.blocked && conflictsRes.conflictId === 'toolBrush' &&
        conflictsRes.forced && conflictsRes.after === 'b',
      `çakışan=${conflictsRes.c1.join(',')} blok=${conflictsRes.blocked} force=${conflictsRes.forced}`);

    const typing = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const ta = document.createElement('textarea');
      document.body.appendChild(ta);
      ta.focus();
      const inText = km.isTyping();
      const range = document.createElement('input');
      range.type = 'range';
      document.body.appendChild(range);
      range.focus();
      const inRange = km.isTyping();
      ta.blur();
      const inNone = km.isTyping();
      ta.remove(); range.remove();
      return JSON.stringify({ inText, inRange, inNone });
    })()`));
    check('keymap: isTyping kuralı (textarea=evet, range=hayır, odak yok=hayır)',
      typing.inText === true && typing.inRange === false && typing.inNone === false,
      `metin=${typing.inText} range=${typing.inRange} boş=${typing.inNone}`);

    /* 4b.2: actionFor + gerçek keydown bağlanması — board.addText'i 'k'ya
       taşı; 'k' metin yaratır, 't' yaratmaz. Sonra varsayılana dön. */
    const wiring = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      if (!km || typeof km.actionFor !== 'function') return JSON.stringify({ noActionFor: true });
      const countText = () => document.querySelectorAll('#stage .item').length;
      const before = countText();
      km.set('board.addText', 'k');
      const resolveSet = km.actionFor('k', 'board') === 'board.addText';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const afterK = countText();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const afterT = countText();
      /* Yeni metin düzenleme modunda kaldı: Escape ile commit et,
         aksi halde sonraki testler yazma korumasına takılır. */
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      km.reset('board.addText');
      return JSON.stringify({ before, afterK, afterT, resolveSet, resolveK: resolveSet && km.actionFor('k', 'board') === '' });
    })()`));
    check('4b.2: board.addText yeniden atandı — keydown gerçekten ateşliyor',
      wiring.resolveSet && wiring.resolveK && wiring.afterK === wiring.before + 1 && wiring.afterT === wiring.afterK,
      `öğe ${wiring.before}→k:${wiring.afterK}→t:${wiring.afterT} çözüm=${wiring.resolveSet}`);

    /* 4b.3: metin girişi odaklıyken tek tuş eylemi ateşlemez. */
    const guard = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      km.set('board.addText', 'k');
      /* Başlangıçta düzenleme modunda kalıntı varsa kapat. */
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const ta = document.createElement('textarea');
      document.body.appendChild(ta);
      const stage = document.getElementById('stage');
      const count = () => stage.querySelectorAll('.item').length;
      ta.focus();
      await new Promise(r => setTimeout(r, 300));
      const countFocused = count();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const countAfterFocused = count();
      ta.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const countAfterBlur = count();
      /* Yeni metin düzenleme modunda kaldı: temizle. */
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      ta.remove();
      km.reset('board.addText');
      return JSON.stringify({ countFocused, countAfterFocused, countAfterBlur });
    })()`));
    check('4b.3: metin yazarken tek tuş ATEŞLEMEZ (odak + blur karşılaştırması)',
      guard.countAfterFocused === guard.countFocused &&
        guard.countAfterBlur === guard.countFocused + 1,
      `odakta ${guard.countFocused}→${guard.countAfterFocused} (değişmedi), blur sonrası →${guard.countAfterBlur} (+1)`);

    /* ---- 4b.4: Ayarlar > Shortcuts keymap grupları ---- */
    /* Karşılama diyaloğu: güvenli kapat (desktop-smoke kalıbı). */
    for (let i = 0; i < 20; i++) {
      const seen = JSON.parse(await evaluate(ws, `(function () {
        const el = document.getElementById('persistenceWelcome');
        return !!(el && !el.hidden);
      })()`));
      if (seen) {
        await evaluate(ws, `(function () {
          if (typeof setPersistenceMode === 'function') setPersistenceMode('auto');
          else localStorage.setItem('tailref-persistence', 'auto');
          const el = document.getElementById('persistenceWelcome');
          if (el) el.hidden = true;
          return 'ok';
        })()`);
        break;
      }
      await sleep(400);
    }
    await evaluate(ws, `(() => { try { if (window.L10N) window.L10N.setLang('tr'); } catch { } return true; })()`);
    await sleep(300);
    await evaluate(ws, `document.getElementById('btnOverflow').click()`);
    await sleep(600);
    await evaluate(ws, `document.querySelector('#settingsNav .settingsNavItem[data-cat="shortcuts"]').click()`);
    await sleep(400);
    const kmUi = JSON.parse(await evaluate(ws, `(() => {
      const board = document.getElementById('settingsKeymapBoard');
      const editor = document.getElementById('settingsKeymapEditor');
      const pose = document.getElementById('settingsKeymapPose3d');
      const shell = document.getElementById('settingsKeymapShell');
      const layers = document.getElementById('settingsKeymapLayers');
      const head = Array.from(document.querySelectorAll('[data-page="shortcuts"] .settingsGroupHead b'))
        .find(b => b.getAttribute('data-l10n') === 'Board shortcuts');
      const poseHead = Array.from(document.querySelectorAll('[data-page="shortcuts"] .settingsGroupHead b'))
        .find(b => b.getAttribute('data-l10n') === '3D pose shortcuts');
      const shellHead = Array.from(document.querySelectorAll('[data-page="shortcuts"] .settingsGroupHead b'))
        .find(b => b.getAttribute('data-l10n') === 'Workspace mode shortcuts');
      const layersHead = Array.from(document.querySelectorAll('[data-page="shortcuts"] .settingsGroupHead b'))
        .find(b => b.getAttribute('data-l10n') === 'Layer shortcuts');
      const rows = box => box ? box.querySelectorAll('.inkWsShortcutRow').length : -1;
      const firstLabel = board ? (board.querySelector('.inkWsShortcutRow span') || {}).textContent : '';
      return JSON.stringify({
        boardRows: rows(board), editorRows: rows(editor), poseRows: rows(pose),
        shellRows: rows(shell), layersRows: rows(layers),
        headText: head ? head.textContent : '',
        poseHeadText: poseHead ? poseHead.textContent : '',
        shellHeadText: shellHead ? shellHead.textContent : '',
        layersHeadText: layersHead ? layersHead.textContent : '',
        firstLabel,
        resetAll: !!document.getElementById('settingsKeymapReset'),
        conflictEl: !!document.getElementById('settingsKeymapConflict'),
      });
    })()`));
    check('4b.4: keymap grupları render (21 tahta + 2 editör + 13 pose3d + 3 shell + 3 layers) + TR başlık',
      kmUi.boardRows === 21 && kmUi.editorRows === 2 && kmUi.poseRows === 13 &&
        kmUi.shellRows === 3 && kmUi.layersRows === 3 &&
        kmUi.headText === 'Tahta kısayolları' && kmUi.poseHeadText === '3D poz kısayolları' &&
        kmUi.shellHeadText === 'Çalışma modu kısayolları' && kmUi.layersHeadText === 'Katman kısayolları' &&
        kmUi.firstLabel === 'Seçimi ya da tümünü sığdır' &&
        kmUi.resetAll && kmUi.conflictEl,
      `tahta=${kmUi.boardRows} editör=${kmUi.editorRows} pose3d=${kmUi.poseRows} shell=${kmUi.shellRows} layers=${kmUi.layersRows} başlık="${kmUi.headText}" poseBaşlık="${kmUi.poseHeadText}" shellBaşlık="${kmUi.shellHeadText}" layersBaşlık="${kmUi.layersHeadText}" ilk="${kmUi.firstLabel}"`);

    /* Yakalama: board.group satırına tıkla → 'j' bas → atanır.
       Render düğmeleri yeniden üretir → tıklamadan SONRA sorgula. */
    const capture1 = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const board = document.getElementById('settingsKeymapBoard');
      board.querySelector('[data-km-shortcut="board.group"]').click();
      await new Promise(r => setTimeout(r, 120));
      const waiting = board.querySelector('[data-km-shortcut="board.group"]').textContent;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const now = km.get('board.group');
      const shown = board.querySelector('[data-km-shortcut="board.group"]').textContent;
      return JSON.stringify({ waiting, now, shown });
    })()`));
    check('4b.4: tuş yakalama gerçek çalışıyor (board.group → j)',
      capture1.waiting === 'Tuş bekleniyor…' && capture1.now === 'j',
      `bekleme="${capture1.waiting}" atanan=${capture1.now} etiket="${capture1.shown}"`);

    /* Çakışma: board.fit → 'j' (artık board.group'ın tuşu) → blok + not. */
    const capture2 = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const board = document.getElementById('settingsKeymapBoard');
      board.querySelector('[data-km-shortcut="board.fit"]').click();
      await new Promise(r => setTimeout(r, 120));
      const waiting = board.querySelector('[data-km-shortcut="board.fit"]').textContent;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const note = document.getElementById('settingsKeymapConflict');
      return JSON.stringify({
        waiting,
        fit: km.get('board.fit'),
        noteVisible: note && !note.hidden,
        noteText: note ? note.textContent : '',
      });
    })()`));
    check('4b.4: çakışma BLOK + uyarı görünür (j meşgul)',
      capture2.waiting === 'Tuş bekleniyor…' && capture2.fit === 'f' && capture2.noteVisible &&
        capture2.noteText.includes('Group selection') === false && capture2.noteText.length > 4,
      `bekleme="${capture2.waiting}" fit=${capture2.fit} not="${capture2.noteText.slice(0, 60)}"`);

    /* Escape yakalamayı iptal eder (atanmaz). */
    const capture3 = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const board = document.getElementById('settingsKeymapBoard');
      const btn = Array.from(board.querySelectorAll('[data-km-shortcut]'))
        .find(b => b.dataset.kmShortcut === 'board.fit');
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const note = document.getElementById('settingsKeymapConflict');
      return JSON.stringify({ fit: km.get('board.fit'), capturingEnded: !btn.classList.contains('is-capturing'),
        noteHidden: note && note.hidden });
    })()`));
    check('4b.4: Escape yakalamayı iptal eder',
      capture3.fit === 'f' && capture3.capturingEnded && capture3.noteHidden,
      `fit=${capture3.fit} iptal=${capture3.capturingEnded}`);

    /* Tekil sıfırlama: özelleştirilmiş satırda ↺ görünür; tıkla → varsayılan. */
    const resetRow = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const board = document.getElementById('settingsKeymapBoard');
      const row = Array.from(board.querySelectorAll('.inkWsShortcutRow'))
        .find(r => r.querySelector('[data-km-shortcut="board.group"]'));
      const hasReset = !!row.querySelector('[data-km-reset="board.group"]');
      const rst = row.querySelector('[data-km-reset]');
      if (rst) rst.click();
      await new Promise(r => setTimeout(r, 150));
      const back = km.get('board.group');
      const gone = !Array.from(board.querySelectorAll('[data-km-reset]'))
        .some(b => b.dataset.kmReset === 'board.group');
      return JSON.stringify({ hasReset, back, gone });
    })()`));
    check('4b.4: tekil varsayılana dönüş (↺ düğmesi)',
      resetRow.hasReset && resetRow.back === 'g' && resetRow.gone,
      `dönüş=${resetRow.back} düğme kayboldu=${resetRow.gone}`);

    /* Toplu sıfırlama: iki eylemi özelleştir → Restore all → hepsi varsayılan. */
    const resetAll = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      km.set('board.group', 'j');
      km.set('board.fit', 'u');
      document.getElementById('settingsKeymapReset').click();
      await new Promise(r => setTimeout(r, 200));
      const rows = document.getElementById('settingsKeymapBoard');
      return JSON.stringify({
        group: km.get('board.group'), fit: km.get('board.fit'),
        resetsLeft: rows.querySelectorAll('[data-km-reset]').length,
      });
    })()`));
    check('4b.4: toplu varsayılana dönüş (Restore all)',
      resetAll.group === 'g' && resetAll.fit === 'f' && resetAll.resetsLeft === 0,
      `group=${resetAll.group} fit=${resetAll.fit} kalan↺=${resetAll.resetsLeft}`);

    /* FAZ 2: pose3d grubu yakalama — pose3d.move → 'k' atanır;
       actionFor('k','pose3d') çözer, ↺ görünür, reset varsayılana döner. */
    const poseCapture = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const pose = document.getElementById('settingsKeymapPose3d');
      pose.querySelector('[data-km-shortcut="pose3d.move"]').click();
      await new Promise(r => setTimeout(r, 120));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const now = km.get('pose3d.move');
      const resolved = km.actionFor('k', 'pose3d') === 'pose3d.move';
      const resetBtn = !!pose.querySelector('[data-km-reset="pose3d.move"]');
      km.reset('pose3d.move');
      const back = km.get('pose3d.move');
      return JSON.stringify({ now, resolved, resetBtn, back });
    })()`));
    check("FAZ 2: pose3d yakalama + actionFor (pose3d.move → k → reset → w)",
      poseCapture.now === 'k' && poseCapture.resolved && poseCapture.resetBtn && poseCapture.back === 'w',
      `atanan=${poseCapture.now} çözüm=${poseCapture.resolved} ↺=${poseCapture.resetBtn} dönüş=${poseCapture.back}`);

    /* FAZ 3a: yeni gruplar — rebind + actionFor çözümleme + eski tuş ölümü +
       çapraz grup çakışması (blok + force) + reset. UI yakalama yerine tablo
       düzeyinde; bağlama noktalarının canlı kanıtı tmp tur testinde. */
    const faz3a = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      /* shell: ctrl+1 → ctrl+9 rebind; eski ctrl+1 artık shell'de çözülmez. */
      const s1 = km.set('shell.drawMode', 'ctrl+9');
      const shellNew = km.actionFor('ctrl+9', 'shell') === 'shell.drawMode';
      const shellOldDead = km.actionFor('ctrl+1', 'shell') === '';
      km.reset('shell.drawMode');
      const shellBack = km.get('shell.drawMode') === 'ctrl+1' &&
        km.actionFor('ctrl+1', 'shell') === 'shell.drawMode';
      /* layers: ctrl+j → ctrl+u; çapraz grup default çakışması görünmez. */
      const l1 = km.set('layers.duplicate', 'ctrl+u');
      const layersNew = km.actionFor('ctrl+u', 'layers') === 'layers.duplicate';
      const boardUndef = km.actionFor('ctrl+u', 'board') === '';
      km.reset('layers.duplicate');
      const layersBack = km.get('layers.duplicate') === 'ctrl+j';
      /* çapraz grup çakışması: layers.duplicate → ctrl+z (pose3d.undo +
         board.undo + ink.undo'nin default'u) → BLOK; force ile geçer. */
      const cRes = km.set('layers.duplicate', 'ctrl+z');
      const conflictHits = km.conflicts('ctrl+z', 'layers.duplicate').map(h => h.id);
      const fRes = km.set('layers.duplicate', 'ctrl+z', { force: true });
      const forced = km.actionFor('ctrl+z', 'layers') === 'layers.duplicate';
      km.reset('layers.duplicate');
      const layersClean = km.get('layers.duplicate') === 'ctrl+j';
      /* imza kuralları yeni gruplarda da geçerli: shift'li imza reddedilir. */
      /* imza motoru ctrl+X'te shift'i yutar ('ctrl+n') — shift'e karşı
         koruma bağlama noktalarında yapılır (shell !shiftKey, layers
         !shiftKey, board.save shift'te erken dönüş). */
      const shiftSig = km.signatureFromEvent({ key: 'n', altKey: false, ctrlKey: true, shiftKey: true });
      const editorOk = km.set('editor.freeTransform', 'ctrl+g').ok &&
        km.actionFor('ctrl+g', 'editor') === 'editor.freeTransform' &&
        km.actionFor('ctrl+t', 'editor') === '';
      km.reset('editor.freeTransform');
      return JSON.stringify({
        s1: s1.ok, shellNew, shellOldDead, shellBack,
        l1: l1.ok, layersNew, boardUndef, layersBack,
        cBlocked: !cRes.ok && !!cRes.conflict, conflictHits, fOk: fRes.ok, forced, layersClean,
        shiftSig, editorOk,
      });
    })()`));
    check('FAZ 3a: shell/layers/editor rebind + actionFor + çapraz grup çakışma',
      faz3a.s1 && faz3a.shellNew && faz3a.shellOldDead && faz3a.shellBack &&
        faz3a.l1 && faz3a.layersNew && faz3a.boardUndef && faz3a.layersBack &&
        faz3a.cBlocked && faz3a.conflictHits.length >= 2 && faz3a.fOk && faz3a.forced &&
        faz3a.layersClean && faz3a.shiftSig === 'ctrl+n' && faz3a.editorOk,
      `shell=${faz3a.shellNew}/${faz3a.shellOldDead} layers=${faz3a.layersNew} çakışan=${faz3a.conflictHits.join(',')} blok=${faz3a.cBlocked} force=${faz3a.forced} shift="${faz3a.shiftSig}" editor=${faz3a.editorOk}`);

    /* Ayarlar panelini kapat (sonraki testler temiz durumda). */
    await evaluate(ws, `document.getElementById('btnSettingsClose').click()`);
    await sleep(300);

    /* 4b.5: tuş rehberi (#inkKeyHelp) kbd'leri keymap'ten güncellenir.
       board.group 'j'ye taşındığında rehberin toolLasso satırı L'den
       değişmemeli ama board'a bağlı satır yok; ink grubundan doğrudan
       kanıt: toolBrush 'k'ye taşındığında rehber B→K olur. ('z' artık
       pose3d.axisZ'nin varsayılanı — çakışma bloğu testi bozardı.) */
    const helpSync = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      /* Kartı bir kez aç → install + keymap senkronu koşar (install
         kapandığında da dinleyici kayıtlı kalır). */
      try { window.inkV5Settings.keyHelp(); } catch { /* sessiz */ }
      await new Promise(r => setTimeout(r, 200));
      const kbd = document.querySelector('#inkKeyHelp [data-km-help="toolBrush"]');
      const before = kbd ? kbd.textContent : '';
      km.set('toolBrush', 'k');
      await new Promise(r => setTimeout(r, 150));
      const afterEvent = document.querySelector('#inkKeyHelp [data-km-help="toolBrush"]').textContent;
      km.reset('toolBrush');
      await new Promise(r => setTimeout(r, 150));
      const afterReset = document.querySelector('#inkKeyHelp [data-km-help="toolBrush"]').textContent;
      return JSON.stringify({ before, afterEvent, afterReset, present: !!kbd });
    })()`));
    check("4b.5: tuş rehberi keymap'ten üretiliyor (B→K→B canlı)",
      helpSync.present && helpSync.before === 'B' && helpSync.afterEvent === 'K' && helpSync.afterReset === 'B',
      `before=${helpSync.before} değişim=${helpSync.afterEvent} reset=${helpSync.afterReset}`);

    /* ---- 4b.6: tercih yedeği (export/import) keymap bölümü ---- */
    const prefs6 = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      /* Round-trip: özelleştir → export → reset → import → geri gelir. */
      km.set('board.group', 'j');
      const payload = settingsPrefsBuild();
      const hasSection = payload.keymap && payload.keymap.version === 1 &&
        typeof payload.keymap.actions === 'object';
      const dataHas = typeof payload.data['tailref-keymap'] === 'string' &&
        payload.data['tailref-keymap'].includes('board.group');
      km.reset('board.group');
      const afterReset = km.get('board.group');
      /* İçe aktar: yalnız keymap verisini taşı (diğer anahtarlar zarar
         vermesin diye data'yı süzüp kötü anahtarları at). */
      const filtered = {};
      for (const [k, v] of Object.entries(payload.data)) {
        if (k === 'workspace' || k === 'tailref:workspace' ||
          k.indexOf('tailref-ink-workspace') === 0) continue;
        filtered[k] = v;
      }
      const applied = settingsPrefsApply({ kind: 'tailref-preferences', version: 1, data: filtered });
      const restored = km.get('board.group');
      km.reset('board.group');
      return JSON.stringify({ hasSection, dataHas, afterReset, appliedOk: applied.ok, restored });
    })()`));
    check('4b.6: export payload.keymap bölümü + round-trip (j→reset→import→j)',
      prefs6.hasSection && prefs6.dataHas && prefs6.afterReset === 'g' &&
        prefs6.appliedOk && prefs6.restored === 'j',
      `bölüm=${prefs6.hasSection} veri=${prefs6.dataHas} reset=${prefs6.afterReset} import=${prefs6.restored}`);

    /* Kötü içe aktarma: bilinmeyen eylem + bozuk imza + sabit tuş
       sessizce atılır; geçerli olan uygulanır. */
    const prefsBad = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const raw = JSON.stringify({ version: 1, actions: {
        'board.group': 'j',              /* geçerli */
        'board.hayalUrun': 'q',          /* bilinmeyen eylem → atılır */
        'board.fit': 'shift+q',          /* bozuk imza → atılır */
        'board.addText': 'escape',       /* sabit tuş → atılır */
      }});
      const res = settingsPrefsApply({ kind: 'tailref-preferences', version: 1,
        data: { 'tailref-keymap': raw } });
      const store = JSON.parse(localStorage.getItem('tailref-keymap') || '{}');
      const actions = store.actions || {};
      const group = km.get('board.group');
      km.reset('board.group');
      return JSON.stringify({
        ok: res.ok,
        group,
        unknownWritten: 'board.hayalUrun' in actions,
        fitTouched: 'board.fit' in actions,
        addTextTouched: 'board.addText' in actions,
      });
    })()`));
    check('4b.6: kötü içe aktarma filtrelenir (geçerli uygulanır, çöp atılır)',
      prefsBad.ok && prefsBad.group === 'j' && !prefsBad.unknownWritten &&
        !prefsBad.fitTouched && !prefsBad.addTextTouched,
      `ok=${prefsBad.ok} group=${prefsBad.group} bilinmeyen=${prefsBad.unknownWritten} bozuk=${prefsBad.fitTouched} sabit=${prefsBad.addTextTouched}`);

    /* Ham yazım yolu kapalı: data['tailref-keymap'] artık asla
       doğrudan localStorage.setItem ile yazılmaz — yukarıdaki test
       store içeriğini kanıtlar. */
    const pageErrors = await evaluate(ws, `JSON.stringify(window.__tailrefTestErrors || [])`);
    check('konsol/sayfa hatası yok', pageErrors === '[]', pageErrors);

    /* Kanıt karesi: Ayarlar > Shortcuts keymap grupları. */
    try { fs.mkdirSync(SHOT_DIR, { recursive: true }); } catch { /* var */ }
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'keymap-final.png'), Buffer.from(shot.data, 'base64'));
    console.log(`\nEkran görüntüsü: ${path.join(SHOT_DIR, 'keymap-final.png')}`);
    console.log(`${fail ? 'BAŞARISIZ' : 'TÜM TESTLER GEÇTİ'} (${pass}/${pass + fail})`);
  } catch (e) {
    fail++;
    errors.push('test akışı: ' + e.message);
    console.log('HATA ' + e.message);
  } finally {
    try { if (ws) ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
  }

  process.exit(fail ? 1 : 0);
})();
