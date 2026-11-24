'use strict';

/* =========================================================
   ipc-guard.js - IPC sender validation (main process)
   =========================================================
   Every privileged TailRef operation (file writes, exports,
   updates, panel windows) is reached over ipcMain. This module
   funnels all channels through one validation point:

     1. Is the sender a registered window? (the main window or a
        detached panel window created by the manager)
     2. Is the message from the top-level frame? (iframe
        subframes are rejected)
     3. Does the frame origin match the app's own origin?
        (guest <webview> pages are never trusted)
     4. Only the panel channel allowlist may come from a panel
        window; every other channel is main-window only.

   When validation fails, `handle` returns a rejected promise and
   `on` drops the message. Reason codes are stable for tests and
   logs; they are never rendered raw in the UI.

   Design note: this module does not depend on Electron APIs so
   pure Node tests can exercise the exact same code path.
   ========================================================= */

/* The only channels the panel window's own preload may send.
   Must stay in sync with panel-preload.js; the source gate
   (tests/ipc-sender-gate-test.js) verifies both directions. */
const PANEL_CHANNELS = Object.freeze(new Set([
  'panel-action-from-window',
  'panel-guest-message',
  'panel-window-close',
  'panel-window-dock',
  'panel-window-is-fullscreen',
  'panel-window-set-bounds',
  'panel-window-toggle-fullscreen',
]));

const DENIED_CODE = 'E_IPC_UNTRUSTED';

let allowedOrigin = '';
let mainContents = null;
const panelContents = new Set();
const warnCounts = new Map();
let logger = (...args) => console.warn(...args);

function originOf(url) {
  try {
    return new URL(String(url || '')).origin;
  } catch {
    return '';
  }
}

function isAlive(contents) {
  if (!contents) return false;
  if (typeof contents.isDestroyed === 'function') {
    try {
      if (contents.isDestroyed()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/* The app's real origin (a random port in test mode). Set once
   before any window exists; when empty every request is denied
   (fail-closed). */
function setAllowedOrigin(appUrl) {
  allowedOrigin = originOf(appUrl);
  return allowedOrigin;
}

function getAllowedOrigin() {
  return allowedOrigin;
}

function trustMain(contents) {
  if (isAlive(contents)) mainContents = contents;
}

function untrustMain(contents) {
  if (!contents || mainContents === contents) mainContents = null;
}

function trustPanel(contents) {
  if (isAlive(contents)) panelContents.add(contents);
}

function untrustPanel(contents) {
  if (contents) panelContents.delete(contents);
}

function clearTrust() {
  mainContents = null;
  panelContents.clear();
}

/* Tests only: silence or replace the warning sink. */
function setLogger(next) {
  logger = typeof next === 'function' ? next : () => {};
}

function resetForTests() {
  clearTrust();
  allowedOrigin = '';
  warnCounts.clear();
  logger = (...args) => console.warn(...args);
}

function inspect(event, channel) {
  const sender = event && event.sender;
  if (!sender) return { ok: false, reason: 'missing-sender' };
  if (!isAlive(sender)) return { ok: false, reason: 'dead-sender' };

  const isMain = mainContents !== null && sender === mainContents;
  const isPanel = panelContents.has(sender);
  if (!isMain && !isPanel) return { ok: false, reason: 'untrusted-sender' };
  if (isPanel && !isMain && !PANEL_CHANNELS.has(channel)) {
    return { ok: false, reason: 'main-window-only' };
  }

  /* Top-level frame only: an iframe/subframe can never reach a
     privileged channel. */
  const frame = event.senderFrame;
  if (!frame) return { ok: false, reason: 'missing-frame' };
  if (frame.parent) return { ok: false, reason: 'subframe' };

  if (!allowedOrigin) return { ok: false, reason: 'origin-not-configured' };
  if (originOf(frame.url) !== allowedOrigin) {
    return { ok: false, reason: 'foreign-origin' };
  }
  return { ok: true, panel: isPanel && !isMain };
}

function warnBlocked(channel, verdict) {
  /* At most three warnings per channel: a guest page spamming the
     bridge must not flood the log, while a real wiring mistake
     stays visible. */
  const count = (warnCounts.get(channel) || 0) + 1;
  warnCounts.set(channel, count);
  if (count > 3) return;
  logger('[ipc-guard] blocked', channel, verdict && verdict.reason);
}

function deny(channel, verdict) {
  warnBlocked(channel, verdict);
  const error = new Error(`IPC request blocked (${DENIED_CODE}): ${verdict && verdict.reason}`);
  error.code = DENIED_CODE;
  error.reason = verdict && verdict.reason;
  error.channel = channel;
  return error;
}

function handle(ipcMain, channel, handler) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('ipc-guard.handle requires ipcMain');
  }
  if (typeof handler !== 'function') {
    throw new TypeError(`ipc-guard.handle(${channel}) requires a handler`);
  }
  ipcMain.handle(channel, async (event, ...args) => {
    const verdict = inspect(event, channel);
    if (!verdict.ok) throw deny(channel, verdict);
    return handler(event, ...args);
  });
}

function on(ipcMain, channel, handler) {
  if (!ipcMain || typeof ipcMain.on !== 'function') {
    throw new TypeError('ipc-guard.on requires ipcMain');
  }
  if (typeof handler !== 'function') {
    throw new TypeError(`ipc-guard.on(${channel}) requires a handler`);
  }
  ipcMain.on(channel, (event, ...args) => {
    const verdict = inspect(event, channel);
    if (!verdict.ok) {
      warnBlocked(channel, verdict);
      return;
    }
    return handler(event, ...args);
  });
}

module.exports = {
  PANEL_CHANNELS,
  DENIED_CODE,
  setAllowedOrigin,
  getAllowedOrigin,
  trustMain,
  untrustMain,
  trustPanel,
  untrustPanel,
  clearTrust,
  setLogger,
  resetForTests,
  inspect,
  handle,
  on,
};
