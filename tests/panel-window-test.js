'use strict';

/* Ayrı panel pencereleri uçtan uca testi.

   Doğrular:
   • Panel ayrı pencereye taşınıyor, DOM kopyası ve durum senkronu çalışıyor.
   • Pomodoro: sayaç + ilerleme çubuğu (inline style) ayrı pencerede güncel.
   • Ayarlar: kategori/aria-selected, kaydırma ve dosya girişi köprüsü.
   • Kısayol yakalama (keymap) ayrı pencereden çalışıyor.
   • YouTube paneli kendi oynatıcısıyla ayrı pencereye taşınabiliyor.
   • Panel başlığındaki "dışarı çıkar" düğmesi çift tıklamada tek pencere açar.
   • × kapatınca panel geri takılmaz; dock'ta kaydırma korunur.

   Uygulama izole veri klasöründe ve ayrı portta çalışır. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 5197;
const DEBUG_PORT = 9337;
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
    if (msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 30000);
});

async function waitFor(fn, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw new Error(`${label} zaman aşımı${lastError ? ' (' + lastError.message + ')' : ''}`);
}

async function targets() {
  return (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json());
}

async function findTarget(port, predicate) {
  return (await targets()).find(t => t.url.includes(`:${port}`) && (!predicate || predicate(t))) || null;
}

function panelTargets() {
  return targets().then(list => list.filter(t => t.url.includes(`:${APP_PORT}/panel.html`)));
}

function launch(userDataDir) {
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
    TailRef_NO_RECOVERY: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electronPath(), ['.', `--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-panel-window-'));
  const app = launch(userDataDir);
  let mainWs = null;
  let detWs = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const mainTarget = await waitFor(() => findTarget(APP_PORT, t => t.type === 'page'), 'ana pencere');
    mainWs = await connect(mainTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(mainWs,
      "typeof state !== 'undefined' && typeof appReady !== 'undefined' && appReady === true"), 'renderer hazır');

    /* ---------- 1 · yardım paneli: taşı / kopyala / × ---------- */
    await evaluate(mainWs, "openStudioPanel(document.getElementById('help'))");
    await sleep(350);
    const helpDocked = await evaluate(mainWs, "!document.getElementById('help').hidden");
    check('yardım paneli uygulama içinde açılıyor', helpDocked === true);

    const helpDetached = JSON.parse(await evaluate(mainWs, `(async () => {
      const panel = document.getElementById('help');
      const ok = await detachPanelToWindow(panel);
      return JSON.stringify({ ok, flag: panel.dataset.detached || '', hidden: panel.hidden });
    })()`));
    const helpTarget = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')), 'yardım panel penceresi');
    detWs = await connect(helpTarget.webSocketDebuggerUrl);
    const helpClone = await waitFor(async () => evaluate(detWs, `(() => {
      const el = document.querySelector('#help');
      if (!el) return '';
      return el.textContent.includes('Ctrl + E') ? 'ok' : '';
    })()`), 'yardım kopyası');
    /* Ana penceredeki asıl panel 200 ms'lik çıkış animasyonundan sonra
       gizlenir; bu yüzden gizlenme ayrıca beklenir. */
    const helpHidden = await waitFor(async () => evaluate(mainWs,
      "document.getElementById('help').hidden === true"), 'yardım panelinin gizlenmesi');
    check('yardım paneli ayrı pencereye taşındı',
      helpDetached.ok === true && helpDetached.flag === '1' && helpHidden === true,
      JSON.stringify({ ok: helpDetached.ok, flag: helpDetached.flag, hidden: helpHidden }));
    check('ayrı penceredeki kopya panel içeriğini taşıyor', helpClone === 'ok');

    await evaluate(detWs, "document.getElementById('btnHelpClose').click()");
    await waitFor(async () => evaluate(mainWs,
      "document.getElementById('help').hidden && document.getElementById('help').dataset.detached !== '1'"),
    'yardım panelinin × ile kapanması');
    const helpWindowsAfterClose = (await panelTargets()).length;
    check('ayrı penceredeki × paneli kapatıyor (geri takmıyor)', helpWindowsAfterClose === 0,
      `${helpWindowsAfterClose} pencere`);

    /* ---------- 2 · pomodoro: sayaç + inline style ---------- */
    await evaluate(mainWs, "openStudioPanel(document.getElementById('pomodoroPanel'))");
    await sleep(350);
    await evaluate(mainWs, `(async () => {
      await detachPanelToWindow(document.getElementById('pomodoroPanel'));
      return true;
    })()`);
    const pomoTarget = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')), 'pomodoro panel penceresi');
    detWs = await connect(pomoTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(detWs, "!!document.getElementById('pomodoroStart')"), 'pomodoro kopyası');
    await evaluate(detWs, "document.getElementById('pomodoroStart').click()");
    const pomoTick = await waitFor(async () => {
      const mainTime = await evaluate(mainWs, "document.getElementById('pomodoroTime').textContent");
      const detTime = await evaluate(detWs, "document.getElementById('pomodoroTime').textContent");
      if (mainTime === '25:00' || detTime === '25:00') return '';
      return JSON.stringify({ mainTime, detTime });
    }, 'pomodoro sayacının ilerlemesi');
    const pomo = JSON.parse(pomoTick);
    check('pomodoro sayacı ayrı pencerede de ilerliyor',
      pomo.mainTime !== '25:00' && pomo.mainTime === pomo.detTime, pomoTick);

    /* İlerleme çubuğu genişliği inline style ile gelir; snapshot style
       taşımıyorsa ayrı pencerede 0 kalır. */
    const progress = JSON.parse(await waitFor(async () => {
      const mainStyle = await evaluate(mainWs, "document.getElementById('pomodoroProgressBar').getAttribute('style') || ''");
      const detStyle = await evaluate(detWs, "document.getElementById('pomodoroProgressBar').getAttribute('style') || ''");
      if (!mainStyle.includes('width')) return '';
      return JSON.stringify({ mainStyle, detStyle });
    }, 'pomodoro ilerleme çubuğu'));
    check('pomodoro ilerleme çubuğu (inline style) ayrı pencereye yansıyor',
      progress.mainStyle === progress.detStyle && progress.detStyle.includes('width'), progress.detStyle);

    await evaluate(mainWs, "window.tailref.closePanelWindow('pomodoroPanel', true)");
    await waitFor(async () => evaluate(mainWs,
      "!document.getElementById('pomodoroPanel').hidden && document.getElementById('pomodoroPanel').dataset.detached !== '1'"),
    'pomodoro panelinin geri takılması');
    const pomoDockedTime = await evaluate(mainWs, "document.getElementById('pomodoroTime').textContent");
    check('geri takılan pomodoro paneli sayacı koruyor', pomoDockedTime !== '25:00', pomoDockedTime);
    await evaluate(mainWs, "document.getElementById('pomodoroReset').click()");

    /* ---------- 3 · ayarlar: aria / kaydırma / dosya / keymap ---------- */
    /* Gerçek giriş noktası: kategori navigasyonunu (nav dinleyicileri) de
       başlatan tek kapı. */
    await evaluate(mainWs, "window.settingsHubToggle()");
    await sleep(450);
    await evaluate(mainWs, `(async () => {
      await detachPanelToWindow(document.getElementById('settings'));
      return true;
    })()`);
    const settingsTarget = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')), 'ayarlar panel penceresi');
    detWs = await connect(settingsTarget.webSocketDebuggerUrl);
    await waitFor(async () => evaluate(detWs, "!!document.querySelector('#settingsNav')"), 'ayarlar kopyası');

    await evaluate(detWs, `document.querySelector('#settingsNav [data-cat="appearance"]').click()`);
    const navSync = await waitFor(async () => {
      const mainSel = await evaluate(mainWs, `document.querySelector('#settingsNav [data-cat="appearance"]').getAttribute('aria-selected')`);
      const detSel = await evaluate(detWs, `document.querySelector('#settingsNav [data-cat="appearance"]').getAttribute('aria-selected')`);
      return mainSel === 'true' && detSel === 'true' ? 'ok' : '';
    }, 'ayarlar kategori senkronu');
    check('ayarlar kategorisi ayrı pencereden seçilebiliyor (aria senkronu)', navSync === 'ok');

    /* Ayrı pencerede kaydırma: ana kopya gizli olduğu için kaydırma orada
       tutulamaz; konum ayrı pencerede korunmalı ve geri takılınca ana
       panele uygulanmalı. */
    await evaluate(detWs, "document.getElementById('settingsPages').scrollTop = 420");
    const scrollKept = await waitFor(async () => {
      const top = await evaluate(detWs, "document.getElementById('settingsPages').scrollTop");
      return Number(top) >= 400 ? String(top) : '';
    }, 'ayarlar kaydırması');
    await sleep(700);
    const scrollStable = await evaluate(detWs, "document.getElementById('settingsPages').scrollTop");
    check('ayarlar kaydırması ayrı pencerede korunuyor (ana kopya sıfırlamıyor)',
      Number(scrollKept) >= 400 && Number(scrollStable) >= 400,
      `ilk=${scrollKept} sonra=${scrollStable}`);

    /* Dosya köprüsü: ayrı pencerede seçilen dosya ana penceredeki gerçek
       <input type=file> üzerine File olarak yerleşmeli. */
    await evaluate(mainWs, `(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = '__panelFileProbe';
      input.hidden = true;
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        window.__panelFileProbe = file ? { name: file.name, size: file.size } : null;
      });
      document.getElementById('settings').appendChild(input);
      return true;
    })()`);
    await evaluate(detWs, `(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = '__panelFileProbe';
      input.hidden = true;
      document.getElementById('settings').appendChild(input);
      const transfer = new DataTransfer();
      transfer.items.add(new File(['panel-file-bridge'], 'probe.txt', { type: 'text/plain' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const fileBridge = await waitFor(async () => {
      const raw = await evaluate(mainWs, 'JSON.stringify(window.__panelFileProbe || null)');
      if (!raw || raw === 'null') return '';
      return raw;
    }, 'dosya köprüsü');
    const fileInfo = JSON.parse(fileBridge);
    check('ayrı pencereden seçilen dosya ana panele File olarak ulaşıyor',
      fileInfo.name === 'probe.txt' && fileInfo.size === 17, fileBridge);
    await evaluate(mainWs, "document.getElementById('__panelFileProbe')?.remove()");
    await evaluate(detWs, "document.getElementById('__panelFileProbe')?.remove()");

    /* Kısayol yakalama: ayrı pencerede basılan tuş keymap'e yazılmalı. */
    const kmInfo = JSON.parse(await evaluate(mainWs, `(() => {
      const all = window.tailrefKeymap.all();
      const used = new Set(all.map(a => a.key));
      const letter = ['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l'].find(k => !used.has(k));
      const action = all.find(a => a.group === 'board') || all[0];
      return JSON.stringify({ id: action.id, original: action.key, key: letter || '9', ctrl: !letter });
    })()`));
    await evaluate(detWs, `document.querySelector('[data-km-shortcut="${kmInfo.id}"]').click()`);
    await waitFor(async () => evaluate(mainWs, 'window.tailrefSettingsKeyCaptureActive() === true'), 'kısayol yakalama modu');
    await evaluate(detWs, `(() => {
      const target = document.getElementById('settings');
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: ${JSON.stringify(kmInfo.key)},
        code: ${JSON.stringify(kmInfo.ctrl ? 'Digit9' : 'Key' + kmInfo.key.toUpperCase())},
        ctrlKey: ${kmInfo.ctrl ? 'true' : 'false'},
        bubbles: true,
        cancelable: true,
      }));
      return true;
    })()`);
    const keyChanged = await waitFor(async () => {
      const now = await evaluate(mainWs, `(() => {
        const a = window.tailrefKeymap.all().find(x => x.id === ${JSON.stringify(kmInfo.id)});
        return a ? a.key : '';
      })()`);
      const expected = kmInfo.ctrl ? 'ctrl+9' : kmInfo.key;
      return now === expected ? now : '';
    }, 'kısayolun yazılması');
    check('ayrı pencereden kısayol yakalama çalışıyor', keyChanged === (kmInfo.ctrl ? 'ctrl+9' : kmInfo.key), keyChanged);
    await evaluate(mainWs, `window.tailrefKeymap.set(${JSON.stringify(kmInfo.id)}, ${JSON.stringify(kmInfo.original)})`);

    await evaluate(mainWs, "window.tailref.closePanelWindow('settings', true)");
    await waitFor(async () => evaluate(mainWs,
      "!document.getElementById('settings').hidden && document.getElementById('settings').dataset.detached !== '1'"),
    'ayarlar panelinin geri takılması');
    const dockedScroll = await waitFor(async () => {
      const top = await evaluate(mainWs, "document.getElementById('settingsPages').scrollTop");
      return Number(top) >= 400 ? String(top) : '';
    }, 'geri takılan kaydırma');
    check('ayarlar paneli geri takıldı ve kaydırma korundu', Number(dockedScroll) >= 400, dockedScroll);

    /* ---------- 4 · YouTube: ayrı pencerede kendi oynatıcısı ---------- */
    await evaluate(mainWs, "openStudioPanel(document.getElementById('youtubeMusicPanel'))");
    await sleep(350);
    const youtube = JSON.parse(await evaluate(mainWs, `(async () => {
      const panel = document.getElementById('youtubeMusicPanel');
      const ok = await detachPanelToWindow(panel);
      return JSON.stringify({ ok, flag: panel.dataset.detached || '' });
    })()`));
    const ytTarget = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')), 'youtube panel penceresi');
    detWs = await connect(ytTarget.webSocketDebuggerUrl);
    const ytClone = await waitFor(async () => evaluate(detWs,
      "!!document.getElementById('youtubePlayer') && !!document.getElementById('youtubeVolume')"), 'youtube kopyası');
    check('YouTube paneli ayrı pencereye taşınabiliyor (kendi oynatıcısıyla)',
      youtube.ok === true && youtube.flag === '1' && ytClone === true, JSON.stringify(youtube));
    /* Ayrı penceredeki düğme "geri tak" olur ve requestDock köprüsünü kullanır. */
    const ytDockButton = await evaluate(detWs, "!!document.querySelector('[data-panel-popout]')");
    await evaluate(detWs, "document.querySelector('[data-panel-popout]').click()");
    const ytDocked = await waitFor(async () => evaluate(mainWs,
      "!document.getElementById('youtubeMusicPanel').hidden && document.getElementById('youtubeMusicPanel').dataset.detached !== '1'"),
    'youtube panelinin geri takılması');
    check('YouTube paneli ayrı penceredeki düğmeyle geri takıldı', ytDockButton === true && ytDocked === true);
    await evaluate(mainWs, "closeStudioPanel(document.getElementById('youtubeMusicPanel'))");

    /* ---------- 5 · çift taşıma tek pencere (başlıktaki düğmeyle) ---------- */
    await evaluate(mainWs, "openStudioPanel(document.getElementById('help'))");
    await sleep(300);
    const popoutReady = await evaluate(mainWs, "!!document.querySelector('#help [data-panel-popout]')");
    check('taşınabilir panel başlığında "dışarı çıkar" düğmesi var', popoutReady === true);
    const inspectorPopout = await evaluate(mainWs, `(() => {
      const button = document.querySelector('#inspector [data-panel-popout]');
      return !!(button && button.querySelector('svg use'));
    })()`);
    check('başlıksız metin denetçisi de "dışarı çıkar" düğmesi taşıyor', inspectorPopout === true);
    await evaluate(mainWs, `(() => {
      const btn = document.querySelector('#help [data-panel-popout]');
      btn.click();
      btn.click();
      return true;
    })()`);
    await waitFor(async () => (await panelTargets()).length >= 1, 'tek panel penceresi');
    await sleep(900);
    const single = (await panelTargets()).length;
    check('başlık düğmesiyle çift taşıma tek pencere açıyor', single === 1, `${single} pencere`);
    await evaluate(mainWs, "window.tailref.closePanelWindow('help', true)");
    await sleep(700);

    /* ---------- 6 · çizim modu v5 panelleri ---------- */
    const v5Seed = JSON.parse(await evaluate(mainWs, `(async () => {
      const c = document.createElement('canvas');
      c.width = 140; c.height = 100;
      const g = c.getContext('2d');
      g.fillStyle = '#3b82f6'; g.fillRect(0, 0, 140, 100);
      g.fillStyle = '#f59e0b'; g.fillRect(20, 20, 60, 40);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'v5-panel-test.png', { type: 'image/png' })], null);
      await new Promise(r => setTimeout(r, 800));
      const it = state.items[state.items.length - 1];
      selection.clear(); selection.add(it.id);
      modeEnterDraw(it.id);
      await new Promise(r => setTimeout(r, 900));
      return JSON.stringify({
        id: it.id,
        draw: document.body.classList.contains('mode-draw'),
      });
    })()`));
    await waitFor(async () => evaluate(mainWs, `(() => {
      const ids = ['v5ReferencePanel', 'v5ColorPanel', 'v5LayersPanel', 'v5BrushPanel'];
      return ids.every(id => {
        const panel = document.getElementById(id);
        return panel && panel.querySelector('[data-panel-popout]');
      });
    })()`), 'v5 panelleri ve dışarı çıkar düğmeleri');
    check('dört çizim paneli de ayrı pencere düğmesi taşıyor',
      v5Seed.draw === true, JSON.stringify(v5Seed));

    const v5PanelIds = ['v5ColorPanel', 'v5LayersPanel', 'v5BrushPanel', 'v5ReferencePanel'];
    for (const id of v5PanelIds) {
      const before = await waitFor(async () => {
        const list = await panelTargets();
        return list.length === 0 ? 'ok' : '';
      }, `${id} öncesi temiz pencere`);
      /* Taşıma sayfada başlatılıp sonucu yoklanıyor: pencere açan bu bekleme
         Runtime.evaluate içinde await edilirse CDP yanıtı asılı kalabiliyor. */
      await evaluate(mainWs, `(() => {
        window.__v5DetachState = 'kick';
        Promise.resolve()
          .then(() => detachPanelToWindow(document.getElementById(${JSON.stringify(id)})))
          .then(r => { window.__v5DetachState = 'done:' + r; })
          .catch(e => { window.__v5DetachState = 'err:' + (e && e.message); });
        return true;
      })()`);
      const detachState = await waitFor(async () => {
        const s = await evaluate(mainWs, 'window.__v5DetachState');
        return s && s !== 'kick' ? s : '';
      }, `${id} taşıma sonucu`);
      if (detachState !== 'done:true') throw new Error(`${id} taşıma başarısız: ` + detachState);
      const detached = JSON.parse(await evaluate(mainWs, `(() => {
        const panel = document.getElementById(${JSON.stringify(id)});
        return JSON.stringify({
          ok: true,
          flag: panel.dataset.detached || '',
          display: getComputedStyle(panel).display,
          probe: panel.classList.contains('v5-detached-probe'),
          left: Math.round(panel.getBoundingClientRect().left),
        });
      })()`));
      const v5Target = await waitFor(() => findTarget(APP_PORT, t => t.url.includes('/panel.html')), `${id} penceresi`);
      if (!detWs || detWs.readyState !== WebSocket.OPEN) detWs = await connect(v5Target.webSocketDebuggerUrl);
      else {
        try { detWs.close(); } catch { /* sessiz */ }
        detWs = await connect(v5Target.webSocketDebuggerUrl);
      }
      const copyOk = await waitFor(async () => evaluate(detWs, `(() => {
        const panel = document.querySelector('#v5DrawUI #${id}');
        if (!panel) return '';
        const rect = panel.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 120) return '';
        return JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) });
      })()`), `${id} kopyası`);
      check(`${id} ayrı pencerede çiziliyor`,
        detached.ok === true && detached.flag === '1'
          && (detached.display === 'none'
            || (detached.probe === true && detached.left < -10000))
          && !!copyOk,
        JSON.stringify({ ...detached, copy: copyOk }));

      if (id === 'v5ColorPanel') {
        const wheelPainted = await waitFor(async () => evaluate(detWs, `(() => {
          for (const canvas of document.querySelectorAll('#v5ColorPanel canvas')) {
            if (!canvas.width || !canvas.height) continue;
            try {
              const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
              for (let i = 3; i < data.length; i += 4 * 89) if (data[i]) return 'ok';
            } catch { /* sessiz */ }
          }
          return '';
        })()`), 'renk çarkı rasterı');
        check('renk çarkı tuvali ayrı pencereye raster olarak taşınıyor', wheelPainted === 'ok');

        /* Pencere kenarından boyutlandırma: ayrı pencere büyümeli ve
           ana panelin gizli yerleşimi aynı ölçüye gelmeli. */
        const sizeBefore = JSON.parse(await evaluate(detWs, `(() => {
          const rect = document.querySelector('#v5ColorPanel').getBoundingClientRect();
          return JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) });
        })()`));
        await evaluate(detWs, `(async () => {
          const panel = document.querySelector('#v5ColorPanel');
          const handle = panel.querySelector('.v5-resize-se');
          if (!handle) return 'no-handle';
          const rect = panel.getBoundingClientRect();
          const sx = Math.round(window.screenX + rect.right - 2);
          const sy = Math.round(window.screenY + rect.bottom - 2);
          const init = { bubbles: true, cancelable: true, button: 0, pointerId: 77,
            pointerType: 'mouse', isPrimary: true };
          const fire = (type, x, y, target) => (target || window).dispatchEvent(new PointerEvent(type, {
            ...init, clientX: x, clientY: y, screenX: x, screenY: y,
            buttons: type === 'pointerup' ? 0 : 1,
          }));
          fire('pointerdown', sx, sy, handle);
          await new Promise(r => setTimeout(r, 60));
          fire('pointermove', sx + 70, sy + 50);
          await new Promise(r => setTimeout(r, 180));
          fire('pointerup', sx + 70, sy + 50);
          return 'ok';
        })()`);
        const sizeAfter = await waitFor(async () => {
          const now = JSON.parse(await evaluate(detWs, `(() => {
            const rect = document.querySelector('#v5ColorPanel').getBoundingClientRect();
            return JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) });
          })()`));
          return now.w >= sizeBefore.w + 40 && now.h >= sizeBefore.h + 20 ? now : null;
        }, 'ayrı pencere boyutlandırma');
        const probeAfter = await waitFor(async () => {
          const w = Number(await evaluate(mainWs,
            "parseFloat(getComputedStyle(document.getElementById('v5ColorPanel')).width)"));
          return w >= sizeBefore.w + 30 ? Math.round(w) : 0;
        }, 'gizli panel ölçüsü');
        check('ayrı penceredeki renk paneli kenardan büyütülüyor',
          !!sizeAfter && probeAfter > 0,
          JSON.stringify({ before: sizeBefore, after: sizeAfter, probe: probeAfter }));

        /* Çark halkasını ayrı pencerede sürükle: ana penceredeki renk
           değişmeli (işaretçi köprüsünün uçtan uca sınavı). */
        const colorBefore = await evaluate(mainWs, "inkState().color");
        await evaluate(detWs, `(async () => {
          const canvas = document.querySelector('#v5ColorPanel #inkWheelCanvas');
          const rect = canvas.getBoundingClientRect();
          const css = Math.max(72, canvas.clientWidth || 228);
          const outer = css / 2 - 4;
          const inner = outer * 0.775;
          const cx = rect.left + css / 2;
          const cy = rect.top + css / 2;
          const rr = (outer + inner) / 2;
          const fire = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true,
            clientX: x, clientY: y, button: 0, buttons,
            pointerId: 41, pointerType: 'mouse', isPrimary: true,
          }));
          fire('pointerdown', cx + rr, cy, 1);
          await new Promise(r => setTimeout(r, 120));
          fire('pointermove', cx, cy + rr, 1);
          await new Promise(r => setTimeout(r, 260));
          fire('pointerup', cx, cy + rr, 0);
          return 'ok';
        })()`);
        const colorAfter = await waitFor(async () => {
          const now = await evaluate(mainWs, "inkState().color");
          return now && now !== colorBefore ? now : '';
        }, 'renk çarkı sürüklemesi');
        check('ayrı penceredeki renk çarkı sürüklemesi ana renge işliyor',
          !!colorAfter && colorAfter !== colorBefore,
          JSON.stringify({ before: colorBefore, after: colorAfter }));
      }

      if (id === 'v5LayersPanel') {
        const initialRows = await evaluate(mainWs, "document.querySelectorAll('#inkLayerList .inkLayerRow').length");
        const copyRows = await waitFor(async () => {
          const rows = await evaluate(detWs, "document.querySelectorAll('#inkLayerList .inkLayerRow').length");
          return Number(rows) === Number(initialRows) ? String(rows) : '';
        }, 'katman satırlarının kopyası');
        await evaluate(detWs, "document.querySelector('#v5LayersPanel .v5-head-btn[aria-label=\"New layer\"]').click()");
        const grew = await waitFor(async () => {
          const mainRows = await evaluate(mainWs, "document.querySelectorAll('#inkLayerList .inkLayerRow').length");
          return mainRows > initialRows ? String(mainRows) : '';
        }, 'katman ekleme köprüsü');
        check('katman panelindeki düğme ayrı pencereden ana panele işliyor',
          Number(copyRows) === Number(initialRows) && Number(grew) > Number(initialRows),
          JSON.stringify({ initialRows, copyRows, grew }));
      }

      if (id === 'v5BrushPanel') {
        const brushCards = await waitFor(async () => {
          const count = await evaluate(detWs, "document.querySelectorAll('#v5BrushPanel .v5-brush-card').length");
          return Number(count) > 0 ? String(count) : '';
        }, 'fırça kartlarının kopyası');
        check('fırça kütüphanesi kartları ayrı pencerede', Number(brushCards) > 0, `${brushCards} kart`);

        /* Kart seçimi tıklama köprüsüyle ana panele işlemeli. */
        const picked = await evaluate(detWs, `(() => {
          const cards = [...document.querySelectorAll('#v5BrushPanel .v5-brush-card')];
          const card = cards.find(c => c.getAttribute('aria-selected') !== 'true') || cards[0];
          if (!card) return '';
          const id = card.dataset.brushId || '';
          card.click();
          return id;
        })()`);
        const brushSynced = await waitFor(async () => {
          const now = await evaluate(mainWs, "inkState().brushId || ''");
          return now && now === picked ? now : '';
        }, 'fırça seçimi köprüsü');
        check('ayrı pencereden seçilen fırça ana panele işliyor',
          !!picked && brushSynced === picked,
          JSON.stringify({ picked, brushSynced }));
      }

      if (id === 'v5ReferencePanel') {
        const refImage = await waitFor(async () => evaluate(detWs, `(() => {
          const img = document.querySelector('#v5RefStage img.v5-ref-window');
          if (!img) return '';
          const src = img.getAttribute('src') || '';
          return src.startsWith('data:image/') && src.length > 500 ? 'ok' : '';
        })()`), 'canlı referans görüntüsü');
        check('referans panosunun canlı görüntüsü ayrı pencereye akıyor', refImage === 'ok');

        /* Mini tahtada sürükle = gezin; ana pencerenin görünümü kaymalı.
           Kopya bir yapı güncellemesiyle yeniden kurulabilir; gerçek
           işaretçi her zaman o anki öğeye gider, bu yüzden test de her
           olayda güncel sahneyi seçer (eski düğüm kopmuş olabilir). */
        const viewBefore = JSON.parse(await evaluate(mainWs,
          "JSON.stringify({ x: state.view.x, y: state.view.y, s: state.view.scale })"));
        await evaluate(detWs, `(async () => {
          const live = () => document.querySelector('#v5ReferencePanel #v5RefStage');
          const rect = live().getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const fire = (type, px, py, buttons) => {
            const stage = live();
            if (!stage) return;
            stage.dispatchEvent(new PointerEvent(type, {
              bubbles: true, cancelable: true, composed: true,
              clientX: px, clientY: py, button: 0, buttons,
              pointerId: 42, pointerType: 'mouse', isPrimary: true,
            }));
          };
          fire('pointerdown', x, y, 1);
          await new Promise(r => setTimeout(r, 80));
          fire('pointermove', x + 45, y + 30, 1);
          await new Promise(r => setTimeout(r, 120));
          fire('pointerup', x + 45, y + 30, 0);
          return 'ok';
        })()`);
        const panned = await waitFor(async () => {
          const now = JSON.parse(await evaluate(mainWs,
            "JSON.stringify({ x: state.view.x, y: state.view.y })"));
          const dx = now.x - viewBefore.x;
          const dy = now.y - viewBefore.y;
          return Math.abs(dx) > 10 && Math.abs(dy) > 5
            ? JSON.stringify({ dx: Math.round(dx), dy: Math.round(dy) }) : '';
        }, 'referans pan köprüsü');
        check('ayrı penceredeki referans panosu sürüklemesi panoyu geziyor',
          !!panned, panned);

        /* Tekerlek = yakınlaştır; ana penceredeki ölçek büyümeli. */
        await evaluate(detWs, `(() => {
          const stage = document.querySelector('#v5ReferencePanel #v5RefStage');
          const rect = stage.getBoundingClientRect();
          stage.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, composed: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            deltaY: -160, deltaMode: 0,
          }));
          return 'ok';
        })()`);
        const zoomed = await waitFor(async () => {
          const now = Number(await evaluate(mainWs, "state.view.scale"));
          return now > viewBefore.s * 1.02 ? String(now) : '';
        }, 'referans zoom köprüsü');
        check('ayrı penceredeki referans tekerleği panoyu yakınlaştırıyor',
          !!zoomed, `ölçek ${viewBefore.s} → ${zoomed}`);
      }

      if (id === 'v5ColorPanel') {
        /* Kullanıcı yolu: ayrı penceredeki "geri tak" düğmesi. */
        await evaluate(detWs, "document.querySelector('#v5ColorPanel [data-panel-popout]').click()");
      } else {
        await evaluate(mainWs, `window.tailref.closePanelWindow(${JSON.stringify(id)}, true)`);
      }
      await waitFor(async () => evaluate(mainWs, `(() => {
        const panel = document.getElementById(${JSON.stringify(id)});
        return panel && panel.dataset.detached !== '1'
          && getComputedStyle(panel).display !== 'none';
      })()`), `${id} geri takılması`);
      await waitFor(async () => (await panelTargets()).length === 0, `${id} penceresinin kapanması`);
      try { if (detWs) detWs.close(); } catch { /* sessiz */ }
      detWs = null;
      await sleep(250);
    }

    await evaluate(mainWs, "if (document.body.classList.contains('mode-draw')) modeExitDraw()");
    await sleep(600);

  } catch (error) {
    console.error('TEST HATASI:', error.message);
    fail++;
  } finally {
    try { if (mainWs) mainWs.close(); } catch { /* sessiz */ }
    try { if (detWs) detWs.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(500);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
    console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
    process.exit(fail ? 1 : 0);
  }
})();
