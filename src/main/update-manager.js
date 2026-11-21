'use strict';

/* TailRef — automatic update manager (Electron main process).
   ------------------------------------------------------------------
   Owns the complete update lifecycle:

     startup check → manual check → available → download → downloaded
                   → renderer save handshake → quitAndInstall

   Security rules:
   • The renderer never receives a raw ipcRenderer or updater object.
   • Only the main window may call update IPC channels.
   • Downloads are never started automatically; the user chooses.
   • Installation is only possible after a verified download completed,
     and only after the renderer confirms that user data was saved.
   • Publishing credentials never enter the application.

   The updater implementation is injected so the state machine can be
   tested with a fake in plain Node (tests/update-manager-test.js). */

const path = require('path');
const fs = require('fs');

const {
  backoffDelay,
  isNewerVersion,
  isValidVersion,
  mapUpdateError,
  normalizeUpdatePreferences,
  sanitizeReleaseNotes,
  sanitizeShortText,
} = require('./update-policy');

const PREFS_FILE = 'update-preferences.json';
const DOWNLOAD_PAGE = 'https://github.com/Roxsmb/tailref/releases/latest';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // periodic automatic checks
const STARTUP_DELAY_MS = 25 * 1000;           // do not block startup
const MANUAL_GAP_MS = 15 * 1000;              // debounce repeated clicks
const INSTALL_FALLBACK_MS = 60 * 1000;

function createUpdateManager(options) {
  const {
    app,
    ipcMain,
    autoUpdater,
    getMainWindow,
    isPortable = false,
    onInstallRequest = async () => true,
    openExternal = null,
    log = console,
    now = () => Date.now(),
    platform = process.platform,
    timers = {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    },
  } = options || {};

  if (!app || !ipcMain || !autoUpdater) {
    throw new Error('createUpdateManager requires app, ipcMain and autoUpdater');
  }

  const prefsPath = path.join(app.getPath('userData'), PREFS_FILE);
  let prefs = loadPreferences();

  const portable = typeof isPortable === 'function' ? !!isPortable() : !!isPortable;
  let reason = '';
  if (!app.isPackaged) reason = 'development';
  else if (portable) reason = 'portable';
  else if (platform !== 'win32') reason = 'platform';
  const supported = !reason;

  let checkInFlight = false;
  let checkIsManual = false;
  let downloadInFlight = false;
  let installInFlight = false;
  let downloadComplete = false;
  let lastErrorAt = 0;
  let lastErrorCode = '';
  let lastManualCheckAt = 0;
  let nextAutoCheckAt = 0;
  let startupTimer = null;
  let intervalTimer = null;
  let installFallbackTimer = null;

  const state = {
    supported,
    reason,
    status: supported ? 'idle' : 'disabled',
    currentVersion: safeVersion(app.getVersion()) || '0.0.0',
    version: '',
    releaseName: '',
    releaseNotes: '',
    releaseDate: '',
    progress: null,
    error: '',
    errorCode: '',
    autoCheck: prefs.autoCheck,
    channel: prefs.channel,
    lastCheckAt: prefs.lastCheckAt,
    canInstall: false,
    message: '',
  };

  function safeVersion(value) {
    return isValidVersion(value) ? String(value).replace(/^v/, '') : '';
  }

  function loadPreferences() {
    try {
      const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      return normalizeUpdatePreferences(raw);
    } catch {
      return normalizeUpdatePreferences(null);
    }
  }

  function savePreferences() {
    try {
      const data = JSON.stringify({
        autoCheck: prefs.autoCheck,
        channel: prefs.channel,
        skippedVersion: prefs.skippedVersion,
        lastCheckAt: prefs.lastCheckAt,
        errorCount: prefs.errorCount,
      });
      const tmp = `${prefsPath}.tmp`;
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, prefsPath);
    } catch (error) {
      log.warn('[updates] preferences could not be saved:', error && error.message);
    }
  }

  function snapshot() {
    return {
      ...state,
      progress: state.progress ? { ...state.progress } : null,
      canInstall: state.status === 'downloaded' && downloadComplete,
    };
  }

  function broadcast() {
    const win = getMainWindow && getMainWindow();
    if (!win || (win.isDestroyed && win.isDestroyed())) return;
    try {
      win.webContents.send('update:state', snapshot());
    } catch { /* window is closing */ }
  }

  function setState(patch) {
    Object.assign(state, patch);
    state.canInstall = state.status === 'downloaded' && downloadComplete;
    broadcast();
    return snapshot();
  }

  function resetBackoff() {
    prefs.errorCount = 0;
    nextAutoCheckAt = 0;
  }

  function handleError(error) {
    const friendly = mapUpdateError(error);
    /* electron-updater emits 'error' and rejects the same operation. Count
       one failure, not two, when both paths report within two seconds. */
    if (friendly.code === lastErrorCode && now() - lastErrorAt < 2000) {
      return snapshot();
    }
    lastErrorAt = now();
    lastErrorCode = friendly.code;
    prefs.errorCount = Math.min(10, (prefs.errorCount || 0) + 1);
    nextAutoCheckAt = now() + backoffDelay(prefs.errorCount);
    prefs.lastCheckAt = now();
    savePreferences();
    log.warn('[updates] failed:', friendly.code);
    if (downloadComplete) {
      /* A download finished earlier; keep the restart action available. */
      return setState({
        status: 'downloaded',
        error: friendly.message,
        errorCode: friendly.code,
        message: '',
      });
    }
    return setState({
      status: 'error',
      error: friendly.message,
      errorCode: friendly.code,
      message: '',
      progress: null,
      canInstall: false,
    });
  }

  function trusted(event) {
    const win = getMainWindow && getMainWindow();
    return !!(win && !(win.isDestroyed && win.isDestroyed()) &&
      event && event.sender === win.webContents);
  }

  function assertTrusted(event) {
    if (!trusted(event)) {
      throw new Error('Update controls are only available to the main TailRef window.');
    }
  }

  /* ---------------- updater wiring ---------------- */
  if (supported) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = prefs.channel === 'beta';
    autoUpdater.channel = 'latest';
    autoUpdater.logger = {
      info: (...args) => log.info('[updates]', ...args),
      warn: (...args) => log.warn('[updates]', ...args),
      error: (...args) => log.error('[updates]', ...args),
      debug: (...args) => log.debug && log.debug('[updates]', ...args),
    };
    /* app-update.yml is generated by electron-builder from the publish
       configuration. Setting the feed explicitly keeps the target pinned
       even if the packaged metadata is missing or altered. */
    try {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'Roxsmb',
        repo: 'tailref',
        releaseType: 'release',
      });
    } catch (error) {
      log.warn('[updates] feed configuration failed:', error && error.message);
    }

    autoUpdater.on('checking-for-update', () => {
      setState({ status: 'checking', error: '', errorCode: '', message: 'checking' });
    });

    autoUpdater.on('update-available', info => {
      const version = safeVersion(info && info.version);
      /* A version the user explicitly skipped is ignored by automatic
         checks; a manual check always reports it again. */
      if (!checkIsManual && version && version === prefs.skippedVersion) {
        setState({
          status: 'up-to-date',
          version: state.currentVersion,
          releaseName: '',
          releaseNotes: '',
          releaseDate: '',
          progress: null,
          error: '',
          errorCode: '',
          message: 'skipped',
          canInstall: false,
        });
        return;
      }
      downloadComplete = false;
      resetBackoff();
      setState({
        status: 'available',
        version,
        releaseName: sanitizeShortText(info && info.releaseName, 200),
        releaseNotes: sanitizeReleaseNotes(info && info.releaseNotes),
        releaseDate: sanitizeShortText(info && info.releaseDate, 40),
        progress: null,
        error: '',
        errorCode: '',
        message: '',
        canInstall: false,
      });
    });

    autoUpdater.on('update-not-available', info => {
      downloadComplete = false;
      resetBackoff();
      setState({
        status: 'up-to-date',
        version: safeVersion(info && info.version) || state.currentVersion,
        releaseName: '',
        releaseNotes: '',
        releaseDate: '',
        progress: null,
        error: '',
        errorCode: '',
        message: '',
        canInstall: false,
      });
    });

    autoUpdater.on('download-progress', progress => {
      const percent = Math.max(0, Math.min(100, Number(progress && progress.percent) || 0));
      setState({
        status: 'downloading',
        progress: {
          percent,
          transferred: Math.max(0, Number(progress && progress.transferred) || 0),
          total: Math.max(0, Number(progress && progress.total) || 0),
          bytesPerSecond: Math.max(0, Number(progress && progress.bytesPerSecond) || 0),
        },
        error: '',
        errorCode: '',
        message: '',
      });
    });

    autoUpdater.on('update-downloaded', info => {
      downloadComplete = true;
      resetBackoff();
      const version = safeVersion(info && info.version) || state.version;
      const total = state.progress && state.progress.total || 0;
      setState({
        status: 'downloaded',
        version,
        progress: { percent: 100, transferred: total, total, bytesPerSecond: 0 },
        error: '',
        errorCode: '',
        message: '',
        canInstall: true,
      });
    });

    autoUpdater.on('error', error => {
      handleError(error);
    });
  }

  /* ---------------- lifecycle ---------------- */
  async function checkForUpdates(opts) {
    const manual = !!(opts && opts.manual);
    if (!supported) return snapshot();
    if (checkInFlight) return snapshot();

    const at = now();
    if (manual) {
      if (at - lastManualCheckAt < MANUAL_GAP_MS) return snapshot();
      lastManualCheckAt = at;
    } else {
      if (!prefs.autoCheck) return snapshot();
      if (nextAutoCheckAt) {
        if (at < nextAutoCheckAt) return snapshot();
      } else if (prefs.lastCheckAt && at - prefs.lastCheckAt < CHECK_INTERVAL_MS) {
        return snapshot();
      }
    }

    checkInFlight = true;
    checkIsManual = manual;
    downloadComplete = false;
    setState({
      status: 'checking',
      error: '',
      errorCode: '',
      progress: null,
      message: manual ? 'checking' : '',
      canInstall: false,
    });

    try {
      const result = await autoUpdater.checkForUpdates();
      /* A fake updater (or an event-less implementation) may only return
         the result. Derive the state if no event has arrived yet. */
      if (result && result.updateInfo && state.status === 'checking') {
        const remote = safeVersion(result.updateInfo.version);
        if (remote && isNewerVersion(remote, state.currentVersion)) {
          if (!manual && remote === prefs.skippedVersion) {
            setState({
              status: 'up-to-date',
              version: state.currentVersion,
              message: 'skipped',
              canInstall: false,
            });
          } else {
            downloadComplete = false;
            setState({
              status: 'available',
              version: remote,
              releaseName: sanitizeShortText(result.updateInfo.releaseName, 200),
              releaseNotes: sanitizeReleaseNotes(result.updateInfo.releaseNotes),
              releaseDate: sanitizeShortText(result.updateInfo.releaseDate, 40),
              canInstall: false,
            });
          }
        } else {
          setState({
            status: 'up-to-date',
            version: remote || state.currentVersion,
            canInstall: false,
          });
        }
      }
    } catch (error) {
      handleError(error);
    } finally {
      checkInFlight = false;
      prefs.lastCheckAt = now();
      savePreferences();
    }
    return snapshot();
  }

  async function downloadUpdate() {
    if (!supported || state.status !== 'available' || downloadInFlight) return snapshot();
    downloadInFlight = true;
    downloadComplete = false;
    setState({
      status: 'downloading',
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      error: '',
      errorCode: '',
      message: '',
      canInstall: false,
    });
    try {
      await autoUpdater.downloadUpdate();
      if (state.status === 'downloading') {
        /* Event-less updater fallback. */
        downloadComplete = true;
        setState({
          status: 'downloaded',
          progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
          canInstall: true,
        });
      }
    } catch (error) {
      handleError(error);
    } finally {
      downloadInFlight = false;
    }
    return snapshot();
  }

  async function installUpdate() {
    if (!supported || state.status !== 'downloaded' || !downloadComplete || installInFlight) {
      return snapshot();
    }
    installInFlight = true;
    setState({
      status: 'installing',
      error: '',
      errorCode: '',
      message: 'preparing',
      canInstall: false,
    });

    let ready = false;
    try {
      ready = await onInstallRequest();
    } catch {
      ready = false;
    }
    if (!ready) {
      installInFlight = false;
      if (installFallbackTimer) {
        timers.clearTimeout(installFallbackTimer);
        installFallbackTimer = null;
      }
      return setState({
        status: 'downloaded',
        message: 'postponed',
        canInstall: true,
      });
    }

    setState({ status: 'installing', message: 'restarting', canInstall: false });
    /* Give the renderer one frame to paint the "restarting" state. */
    timers.setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        installInFlight = false;
        if (installFallbackTimer) {
          timers.clearTimeout(installFallbackTimer);
          installFallbackTimer = null;
        }
        handleError(error);
      }
    }, 250);
    /* If the installer never takes over (for example a blocked execution
       policy), do not leave the UI stuck on "installing" forever. */
    installFallbackTimer = timers.setTimeout(() => {
      installFallbackTimer = null;
      if (!installInFlight) return;
      installInFlight = false;
      setState({
        status: 'downloaded',
        message: 'install-failed',
        error: 'The installer could not start. Please try again or download the update from GitHub.',
        errorCode: 'install',
        canInstall: true,
      });
    }, INSTALL_FALLBACK_MS);
    return snapshot();
  }

  function setPreferences(patch) {
    const candidate = {
      ...prefs,
      autoCheck: patch && typeof patch.autoCheck === 'boolean' ? patch.autoCheck : prefs.autoCheck,
      channel: patch && (patch.channel === 'beta' || patch.channel === 'latest')
        ? patch.channel : prefs.channel,
      skippedVersion: patch && typeof patch.skippedVersion === 'string'
        ? patch.skippedVersion : prefs.skippedVersion,
    };
    prefs = normalizeUpdatePreferences(candidate);
    if (supported) {
      autoUpdater.allowPrerelease = prefs.channel === 'beta';
    }
    savePreferences();
    setState({ autoCheck: prefs.autoCheck, channel: prefs.channel });
    if (state.status === 'available' && prefs.skippedVersion &&
        prefs.skippedVersion === state.version) {
      return setState({
        status: 'up-to-date',
        version: state.currentVersion,
        releaseNotes: '',
        releaseName: '',
        releaseDate: '',
        message: 'skipped',
        canInstall: false,
      });
    }
    return snapshot();
  }

  function start() {
    if (!supported) {
      setState({ status: 'disabled', reason, canInstall: false });
      return;
    }
    setState({ status: 'idle', autoCheck: prefs.autoCheck, channel: prefs.channel });
    if (prefs.autoCheck) {
      startupTimer = timers.setTimeout(() => {
        startupTimer = null;
        checkForUpdates({ manual: false });
      }, STARTUP_DELAY_MS);
      if (startupTimer && typeof startupTimer.unref === 'function') startupTimer.unref();
    }
    intervalTimer = timers.setInterval(() => {
      if (prefs.autoCheck) checkForUpdates({ manual: false });
    }, CHECK_INTERVAL_MS);
    if (intervalTimer && typeof intervalTimer.unref === 'function') intervalTimer.unref();
  }

  function stop() {
    if (startupTimer) { timers.clearTimeout(startupTimer); startupTimer = null; }
    if (intervalTimer) { timers.clearInterval(intervalTimer); intervalTimer = null; }
    if (installFallbackTimer) {
      timers.clearTimeout(installFallbackTimer);
      installFallbackTimer = null;
    }
  }

  /* ---------------- IPC (explicit allowlist) ---------------- */
  ipcMain.handle('update:get-state', event => {
    assertTrusted(event);
    return snapshot();
  });
  ipcMain.handle('update:get-preferences', event => {
    assertTrusted(event);
    return {
      autoCheck: prefs.autoCheck,
      channel: prefs.channel,
      skippedVersion: prefs.skippedVersion,
    };
  });
  ipcMain.handle('update:set-preferences', (event, patch) => {
    assertTrusted(event);
    return setPreferences(patch);
  });
  ipcMain.handle('update:check', (event, manual) => {
    assertTrusted(event);
    return checkForUpdates({ manual: !!manual });
  });
  ipcMain.handle('update:download', event => {
    assertTrusted(event);
    return downloadUpdate();
  });
  ipcMain.handle('update:install', event => {
    assertTrusted(event);
    return installUpdate();
  });
  ipcMain.handle('update:open-download', async event => {
    assertTrusted(event);
    if (typeof openExternal !== 'function') return false;
    try {
      await openExternal(DOWNLOAD_PAGE);
      return true;
    } catch (error) {
      log.warn('[updates] download page could not be opened:', error && error.message);
      return false;
    }
  });

  return {
    start,
    stop,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    setPreferences,
    getSnapshot: snapshot,
    isSupported: () => supported,
    downloadPage: DOWNLOAD_PAGE,
  };
}

module.exports = { createUpdateManager };
