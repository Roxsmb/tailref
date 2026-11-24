'use strict';

/* TailRef — automatic update manager tests (plain Node).
   Uses a fake autoUpdater, fake app, fake IPC and fake timers. No Electron
   process is started, so the state machine can be exercised deterministically. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createUpdateManager } = require('../src/main/update-manager');
const ipcGuard = require('../src/main/ipc-guard');

const TEST_ORIGIN_URL = 'http://127.0.0.1:5178/';
function ipcEvent(sender) {
  return { sender, senderFrame: { url: TEST_ORIGIN_URL, parent: null } };
}

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-update-'));
}

function fakeApp(userData, { packaged = true, version = '1.4.2' } = {}) {
  return {
    isPackaged: packaged,
    getVersion: () => version,
    getPath: name => (name === 'userData' ? userData : userData),
  };
}

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    this.allowPrerelease = false;
    this.allowDowngrade = true;
    this.channel = '';
    this.logger = null;
    this.feed = null;
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.quitCalls = [];
    this.checkImpl = null;
    this.downloadImpl = null;
  }
  setFeedURL(feed) { this.feed = feed; }
  async checkForUpdates() {
    this.checkCalls += 1;
    if (this.checkImpl) return this.checkImpl();
    return null;
  }
  async downloadUpdate() {
    this.downloadCalls += 1;
    if (this.downloadImpl) return this.downloadImpl();
    return [];
  }
  quitAndInstall(...args) { this.quitCalls.push(args); }
}

function fakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) { handlers.set(channel, fn); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout(fn, ms) {
      const id = ++seq;
      pending.set(id, { fn, ms, type: 'timeout' });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    setInterval(fn, ms) {
      const id = ++seq;
      pending.set(id, { fn, ms, type: 'interval' });
      return id;
    },
    clearInterval(id) { pending.delete(id); },
    async runNextTimeout() {
      const entries = [...pending.entries()]
        .filter(([, item]) => item.type === 'timeout')
        .sort((a, b) => a[1].ms - b[1].ms);
      if (!entries.length) return false;
      const [id, item] = entries[0];
      pending.delete(id);
      await item.fn();
      return true;
    },
    async runAllTimeouts() {
      let ran = false;
      while (await this.runNextTimeout()) ran = true;
      return ran;
    },
  };
}

function makeManager(opts = {}) {
  const userData = opts.userData || tempUserData();
  const app = opts.app || fakeApp(userData, opts.appOptions);
  const autoUpdater = opts.autoUpdater || new FakeUpdater();
  const ipcMain = opts.ipcMain || fakeIpc();
  const timers = opts.timers || fakeTimers();
  let nowValue = opts.now || 1_700_000_000_000;
  const win = opts.win || {
    isDestroyed: () => false,
    webContents: { send: () => {} },
  };
  ipcGuard.setAllowedOrigin(TEST_ORIGIN_URL);
  ipcGuard.trustMain(win.webContents);
  const manager = createUpdateManager({
    app,
    ipcMain,
    autoUpdater,
    getMainWindow: () => win,
    isPortable: !!opts.portable,
    onInstallRequest: opts.onInstallRequest || (async () => true),
    openExternal: opts.openExternal || null,
    now: () => nowValue,
    platform: 'win32',
    timers,
    log: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return {
    manager,
    app,
    autoUpdater,
    ipcMain,
    timers,
    userData,
    win,
    setNow: value => { nowValue = value; },
    advance: ms => { nowValue += ms; },
  };
}

(async () => {
  /* --- unsupported environments --- */
  {
    const { manager, autoUpdater } = makeManager({ appOptions: { packaged: false } });
    const state = manager.getSnapshot();
    ok('development build is disabled', state.supported === false && state.reason === 'development');
    await manager.checkForUpdates({ manual: true });
    ok('disabled build never calls updater', autoUpdater.checkCalls === 0);
    manager.start();
    ok('disabled start keeps disabled state', manager.getSnapshot().status === 'disabled');
  }
  {
    const { manager } = makeManager({ portable: true });
    const state = manager.getSnapshot();
    ok('portable build is disabled', state.supported === false && state.reason === 'portable');
  }

  /* --- updater configuration --- */
  {
    const { autoUpdater } = makeManager();
    ok('autoDownload disabled', autoUpdater.autoDownload === false);
    ok('autoInstallOnAppQuit disabled', autoUpdater.autoInstallOnAppQuit === false);
    ok('allowDowngrade disabled', autoUpdater.allowDowngrade === false);
    ok('prerelease disabled by default', autoUpdater.allowPrerelease === false);
    ok('GitHub feed pinned', autoUpdater.feed && autoUpdater.feed.provider === 'github' &&
      autoUpdater.feed.owner === 'Roxsmb' && autoUpdater.feed.repo === 'tailref');
  }

  /* --- startup check is delayed, not blocking --- */
  {
    const ctx = makeManager();
    ctx.autoUpdater.checkImpl = async () => {
      ctx.autoUpdater.emit('update-not-available', { version: '1.4.2' });
      return { updateInfo: { version: '1.4.2' } };
    };
    ctx.manager.start();
    ok('startup schedules check without calling immediately', ctx.autoUpdater.checkCalls === 0);
    ok('startup and interval timers exist', ctx.timers.pending.size === 2);
    await ctx.timers.runNextTimeout();
    ok('delayed startup check runs', ctx.autoUpdater.checkCalls === 1);
    ok('up-to-date state after startup', ctx.manager.getSnapshot().status === 'up-to-date');
    ctx.manager.stop();
  }

  /* --- available → downloading → downloaded → install --- */
  {
    let installRequested = 0;
    let allowInstall = false;
    const ctx = makeManager({
      onInstallRequest: async () => { installRequested += 1; return allowInstall; },
    });
    ctx.autoUpdater.checkImpl = async () => {
      ctx.autoUpdater.emit('checking-for-update');
      ctx.autoUpdater.emit('update-available', {
        version: '1.5.0',
        releaseName: '<b>Big</b> release',
        releaseNotes: '<script>alert(1)</script><p>New brush</p>',
        releaseDate: '2026-11-21',
      });
      return { updateInfo: { version: '1.5.0' } };
    };
    ctx.autoUpdater.downloadImpl = async () => {
      ctx.autoUpdater.emit('download-progress', {
        percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 100,
      });
      ctx.autoUpdater.emit('update-downloaded', { version: '1.5.0' });
      return ['installer.exe'];
    };

    await ctx.manager.checkForUpdates({ manual: true });
    let state = ctx.manager.getSnapshot();
    ok('update available', state.status === 'available' && state.version === '1.5.0');
    ok('release notes sanitized', state.releaseNotes === 'New brush');
    ok('release name sanitized', state.releaseName === 'Big release');
    ok('install not possible before download', state.canInstall === false);

    await ctx.manager.downloadUpdate();
    state = ctx.manager.getSnapshot();
    ok('download completes', state.status === 'downloaded' && state.canInstall === true);
    ok('download progress reached 100', state.progress && state.progress.percent === 100);

    const postponed = await ctx.manager.installUpdate();
    ok('install waits for save handshake', installRequested === 1 && ctx.autoUpdater.quitCalls.length === 0);
    ok('canceled handshake keeps downloaded state',
      postponed.status === 'downloaded' && postponed.message === 'postponed');

    allowInstall = true;
    await ctx.manager.installUpdate();
    ok('install moves to installing', ctx.manager.getSnapshot().status === 'installing');
    await ctx.timers.runNextTimeout();
    ok('quitAndInstall called once', ctx.autoUpdater.quitCalls.length === 1);
    ok('quitAndInstall flags', JSON.stringify(ctx.autoUpdater.quitCalls[0]) === '[true,true]');
    ctx.manager.stop();
  }

  /* --- error mapping, backoff and no tight retry loop --- */
  {
    const ctx = makeManager();
    ctx.autoUpdater.checkImpl = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' });
    };
    await ctx.manager.checkForUpdates({ manual: true });
    let state = ctx.manager.getSnapshot();
    ok('offline check reaches error state', state.status === 'error' && state.errorCode === 'offline');
    ok('friendly error text', state.error.includes('internet connection'));
    ok('raw host not exposed', !state.error.includes('github.com'));

    const callsAfterError = ctx.autoUpdater.checkCalls;
    await ctx.manager.checkForUpdates({ manual: false });
    ok('automatic check respects backoff', ctx.autoUpdater.checkCalls === callsAfterError);

    ctx.advance(30 * 60 * 1000);
    await ctx.manager.checkForUpdates({ manual: false });
    ok('automatic check resumes after backoff', ctx.autoUpdater.checkCalls === callsAfterError + 1);
  }

  /* --- manual check debounce and automatic throttle --- */
  {
    const ctx = makeManager();
    ctx.autoUpdater.checkImpl = async () => {
      ctx.autoUpdater.emit('update-not-available', { version: '1.4.2' });
      return { updateInfo: { version: '1.4.2' } };
    };
    await ctx.manager.checkForUpdates({ manual: true });
    await ctx.manager.checkForUpdates({ manual: true });
    ok('manual checks are debounced', ctx.autoUpdater.checkCalls === 1);
    await ctx.manager.checkForUpdates({ manual: false });
    ok('automatic check is throttled after success', ctx.autoUpdater.checkCalls === 1);
    ctx.advance(16 * 1000);
    await ctx.manager.checkForUpdates({ manual: true });
    ok('manual check works after debounce window', ctx.autoUpdater.checkCalls === 2);
  }

  /* --- preferences: validation, persistence, prototype safety --- */
  {
    const userData = tempUserData();
    const ctx = makeManager({ userData });
    const state = ctx.manager.setPreferences({
      autoCheck: false,
      channel: 'beta',
      skippedVersion: '1.5.0',
      unknown: 'drop',
      __proto__: { polluted: true },
    });
    ok('preference toggle applied', state.autoCheck === false && state.channel === 'beta');
    ok('beta enables prerelease', ctx.autoUpdater.allowPrerelease === true);
    ok('prototype not polluted', ({}).polluted === undefined);

    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'update-preferences.json'), 'utf8'));
    ok('unknown preference not saved', !Object.prototype.hasOwnProperty.call(saved, 'unknown'));
    ok('preference file has skipped version', saved.skippedVersion === '1.5.0');

    const second = makeManager({ userData });
    const loaded = second.manager.getSnapshot();
    ok('preferences reload', loaded.autoCheck === false && loaded.channel === 'beta');
    ok('beta reload keeps prerelease', second.autoUpdater.allowPrerelease === true);
  }

  /* --- autoCheck off suppresses automatic work --- */
  {
    const userData = tempUserData();
    fs.writeFileSync(path.join(userData, 'update-preferences.json'), JSON.stringify({ autoCheck: false }));
    const ctx = makeManager({ userData });
    ctx.manager.start();
    ok('no startup timer when autoCheck is off', ctx.timers.pending.size === 1);
    await ctx.timers.runAllTimeouts();
    await ctx.manager.checkForUpdates({ manual: false });
    ok('no automatic check when autoCheck is off', ctx.autoUpdater.checkCalls === 0);
    ctx.manager.stop();
  }

  /* --- IPC sender validation --- */
  {
    const ctx = makeManager();
    const getState = ctx.ipcMain.handlers.get('update:get-state');
    let rejected = false;
    try { await getState({ sender: {} }); } catch { rejected = true; }
    ok('foreign IPC sender rejected', rejected === true);
    const state = await getState(ipcEvent(ctx.win.webContents));
    ok('main window IPC sender accepted', state && state.currentVersion === '1.4.2');

    const install = ctx.ipcMain.handlers.get('update:install');
    let installRejected = false;
    try { await install({ sender: {} }); } catch { installRejected = true; }
    ok('foreign install request rejected', installRejected === true);
  }

  /* --- install is impossible before a verified download --- */
  {
    const ctx = makeManager();
    const before = await ctx.manager.installUpdate();
    ok('install before download is a no-op', before.status === 'idle' && ctx.autoUpdater.quitCalls.length === 0);
  }

  /* --- skipped versions --- */
  {
    const ctx = makeManager();
    ctx.autoUpdater.checkImpl = async () => {
      ctx.autoUpdater.emit('update-available', { version: '1.5.0' });
      return { updateInfo: { version: '1.5.0' } };
    };
    await ctx.manager.checkForUpdates({ manual: true });
    ok('manual check shows a new version', ctx.manager.getSnapshot().status === 'available');
    const skipped = ctx.manager.setPreferences({ skippedVersion: '1.5.0' });
    ok('skipping an available version hides it',
      skipped.status === 'up-to-date' && skipped.message === 'skipped');

    const ctx2 = makeManager();
    ctx2.manager.setPreferences({ skippedVersion: '1.5.0' });
    ctx2.autoUpdater.checkImpl = async () => {
      ctx2.autoUpdater.emit('update-available', { version: '1.5.0' });
      return { updateInfo: { version: '1.5.0' } };
    };
    await ctx2.manager.checkForUpdates({ manual: false });
    ok('automatic check ignores a skipped version',
      ctx2.manager.getSnapshot().status === 'up-to-date' &&
      ctx2.manager.getSnapshot().message === 'skipped');
    await ctx2.manager.checkForUpdates({ manual: true });
    ok('manual check reports a skipped version again',
      ctx2.manager.getSnapshot().status === 'available');
  }

  /* --- download page is opened by the main process only --- */
  {
    const opened = [];
    const ctx = makeManager({ openExternal: async url => { opened.push(url); } });
    const open = ctx.ipcMain.handlers.get('update:open-download');
    let rejected = false;
    try { await open({ sender: {} }); } catch { rejected = true; }
    ok('foreign download-page request rejected', rejected === true);
    const result = await open(ipcEvent(ctx.win.webContents));
    ok('download page opened for the main window', result === true &&
      opened.length === 1 && opened[0] === 'https://github.com/Roxsmb/tailref/releases/latest');
  }

  /* --- installer that never starts must not leave the UI stuck --- */
  {
    const ctx = makeManager();
    ctx.autoUpdater.checkImpl = async () => {
      ctx.autoUpdater.emit('update-available', { version: '1.5.0' });
      return { updateInfo: { version: '1.5.0' } };
    };
    ctx.autoUpdater.downloadImpl = async () => {
      ctx.autoUpdater.emit('update-downloaded', { version: '1.5.0' });
      return [];
    };
    await ctx.manager.checkForUpdates({ manual: true });
    await ctx.manager.downloadUpdate();
    await ctx.manager.installUpdate();
    ok('installer not started before the paint frame', ctx.autoUpdater.quitCalls.length === 0);
    await ctx.timers.runAllTimeouts();
    const state = ctx.manager.getSnapshot();
    ok('install fallback returns to downloaded',
      state.status === 'downloaded' && state.errorCode === 'install' && state.canInstall === true);
    ctx.manager.stop();
  }

  console.log(fail === 0
    ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
    : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(error => {
  console.error('TEST HATASI:', error);
  process.exit(1);
});
