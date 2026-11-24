'use strict';

/* IPC guard unit tests (plain Node, no Electron).
   Exercises the exact validation path used by every ipcMain channel:
   trusted main/panel senders, top-frame + origin checks, panel
   allowlist, and fail-closed behaviour. */

const guard = require('../src/main/ipc-guard');

const APP_URL = 'http://127.0.0.1:5178/';
const APP_ORIGIN = 'http://127.0.0.1:5178';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  -> ' + detail : ''}`);
};

function fakeIpc() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle(channel, fn) {
      if (handlers.has(channel)) throw new Error('duplicate handler ' + channel);
      handlers.set(channel, fn);
    },
    on(channel, fn) {
      if (listeners.has(channel)) throw new Error('duplicate listener ' + channel);
      listeners.set(channel, fn);
    },
  };
}

function contents(id) {
  return { id, isDestroyed: () => false };
}

function frame(url = APP_URL, parent = null) {
  return { url, parent };
}

function event(sender, senderFrame = frame()) {
  return { sender, senderFrame };
}

function reset() {
  guard.resetForTests();
  guard.setAllowedOrigin(APP_URL);
  guard.setLogger(() => {});
}

(async () => {
  /* --- origin configuration --- */
  {
    guard.resetForTests();
    ok('origin is empty before configuration', guard.getAllowedOrigin() === '');
    const origin = guard.setAllowedOrigin(APP_URL);
    ok('origin is normalized to scheme + host + port', origin === APP_ORIGIN, origin);
  }

  /* --- trusted main sender --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    guard.trustMain(main);
    guard.handle(ipc, 'main-channel', (_event, a, b) => a + b);
    const result = await ipc.handlers.get('main-channel')(event(main), 2, 3);
    ok('trusted main sender reaches the handler with all args', result === 5, String(result));
  }

  /* --- unknown sender --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    const stranger = contents(2);
    guard.trustMain(main);
    guard.handle(ipc, 'main-channel', () => 'leaked');
    let error = null;
    try {
      await ipc.handlers.get('main-channel')(event(stranger));
    } catch (caught) {
      error = caught;
    }
    ok('unknown webContents is rejected', !!error && error.code === guard.DENIED_CODE,
      error && error.reason);
    ok('rejection carries the stable reason code',
      !!error && error.reason === 'untrusted-sender', error && error.reason);
  }

  /* --- `on` drops untrusted messages without running the handler --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    guard.trustMain(main);
    let calls = 0;
    guard.on(ipc, 'main-channel', () => { calls++; });
    ipc.listeners.get('main-channel')(event(contents(9)));
    ok('untrusted fire-and-forget message is dropped', calls === 0, String(calls));
    ipc.listeners.get('main-channel')(event(main));
    ok('trusted fire-and-forget message runs once', calls === 1, String(calls));
  }

  /* --- top-level frame only --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    guard.trustMain(main);
    guard.handle(ipc, 'main-channel', () => 'leaked');
    let subframeError = null;
    try {
      await ipc.handlers.get('main-channel')(event(main, frame(APP_URL, { url: APP_URL })));
    } catch (caught) {
      subframeError = caught;
    }
    ok('iframe/subframe sender is rejected', !!subframeError && subframeError.reason === 'subframe',
      subframeError && subframeError.reason);

    let missingFrameError = null;
    try {
      await ipc.handlers.get('main-channel')({ sender: main });
    } catch (caught) {
      missingFrameError = caught;
    }
    ok('missing senderFrame is rejected (fail-closed)',
      !!missingFrameError && missingFrameError.reason === 'missing-frame',
      missingFrameError && missingFrameError.reason);
  }

  /* --- origin pinning --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    guard.trustMain(main);
    guard.handle(ipc, 'main-channel', () => 'leaked');
    let foreign = null;
    try {
      await ipc.handlers.get('main-channel')(event(main, frame('http://127.0.0.1:6000/')));
    } catch (caught) {
      foreign = caught;
    }
    ok('foreign origin is rejected even from a trusted sender',
      !!foreign && foreign.reason === 'foreign-origin', foreign && foreign.reason);

    guard.resetForTests();
    guard.trustMain(main);
    let unconfigured = null;
    try {
      await ipc.handlers.get('main-channel')(event(main));
    } catch (caught) {
      unconfigured = caught;
    }
    ok('unconfigured origin is rejected (fail-closed)',
      !!unconfigured && unconfigured.reason === 'origin-not-configured',
      unconfigured && unconfigured.reason);
  }

  /* --- destroyed sender --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    guard.trustMain(main);
    guard.handle(ipc, 'main-channel', () => 'leaked');
    const dead = { id: 1, isDestroyed: () => true };
    guard.trustMain(dead);
    let error = null;
    try {
      await ipc.handlers.get('main-channel')(event(dead));
    } catch (caught) {
      error = caught;
    }
    ok('destroyed webContents is rejected', !!error && error.reason === 'dead-sender',
      error && error.reason);
  }

  /* --- panel allowlist --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    const panel = contents(2);
    guard.trustMain(main);
    guard.trustPanel(panel);
    guard.handle(ipc, 'main-channel', () => 'main');
    guard.handle(ipc, 'panel-window-dock', () => 'panel');

    const panelAllowed = await ipc.handlers.get('panel-window-dock')(event(panel));
    ok('panel channel accepts a registered panel window', panelAllowed === 'panel', panelAllowed);

    const mainAllowed = await ipc.handlers.get('panel-window-dock')(event(main));
    ok('panel channel still accepts the main window', mainAllowed === 'panel', mainAllowed);

    let panelDenied = null;
    try {
      await ipc.handlers.get('main-channel')(event(panel));
    } catch (caught) {
      panelDenied = caught;
    }
    ok('main-only channel rejects a panel window',
      !!panelDenied && panelDenied.reason === 'main-window-only',
      panelDenied && panelDenied.reason);
  }

  /* --- unregistering trust --- */
  {
    reset();
    const ipc = fakeIpc();
    const main = contents(1);
    const panel = contents(2);
    guard.trustMain(main);
    guard.trustPanel(panel);
    guard.handle(ipc, 'main-channel', () => 'main');
    guard.handle(ipc, 'panel-window-close', () => 'panel');

    guard.untrustPanel(panel);
    guard.untrustMain(main);

    let mainError = null, panelError = null;
    try {
      await ipc.handlers.get('main-channel')(event(main));
    } catch (caught) { mainError = caught; }
    try {
      await ipc.handlers.get('panel-window-close')(event(panel));
    } catch (caught) { panelError = caught; }
    ok('untrustMain revokes the main window', !!mainError && mainError.reason === 'untrusted-sender',
      mainError && mainError.reason);
    ok('untrustPanel revokes the panel window', !!panelError && panelError.reason === 'untrusted-sender',
      panelError && panelError.reason);
  }

  /* --- warning rate limit --- */
  {
    reset();
    const ipc = fakeIpc();
    const stranger = contents(7);
    const logs = [];
    guard.setLogger((...args) => logs.push(args.join(' ')));
    guard.handle(ipc, 'spam-channel', () => 'leaked');
    for (let i = 0; i < 6; i++) {
      try {
        await ipc.handlers.get('spam-channel')(event(stranger));
      } catch { /* expected */ }
    }
    ok('blocked-sender warnings are rate limited (3 per channel)', logs.length === 3, String(logs.length));
    ok('rate-limited warning names the channel',
      logs.every(line => line.includes('spam-channel')), logs[0]);
  }

  /* --- API misuse is loud --- */
  {
    let badHandle = false, badOn = false;
    try { guard.handle({}, 'x', () => {}); } catch { badHandle = true; }
    try { guard.on({}, 'x', () => {}); } catch { badOn = true; }
    ok('handle rejects a missing ipcMain', badHandle);
    ok('on rejects a missing ipcMain', badOn);
    ok('panel allowlist is frozen', Object.isFrozen(guard.PANEL_CHANNELS));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(error => {
  console.error('TEST CRASH:', error && error.stack || error);
  process.exit(1);
});
