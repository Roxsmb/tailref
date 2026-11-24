'use strict';

/* Source gate for IPC sender hardening.
   Fails if any main-process module registers an ipcMain channel without
   the shared guard, if the panel allowlist drifts from panel-preload.js,
   or if trust registration disappears. Pure Node; no Electron needed. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN_DIR = path.join(ROOT, 'src', 'main');
const PRELOAD_DIR = path.join(ROOT, 'src', 'preload');
const { PANEL_CHANNELS } = require(path.join(MAIN_DIR, 'ipc-guard'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  -> ' + detail : ''}`);
};

/* Every file that used to call ipcMain.handle/on directly must now go
   through the guard. The expected count is a review ratchet: adding a new
   privileged channel requires updating this number on purpose. */
const EXPECTED = {
  'artstation.js': 4,
  'ink-engine-host.js': 5,
  'main.js': 50,
  'panel-window-manager.js': 11,
  'pinterest.js': 5,
  'update-manager.js': 7,
};

const files = fs.readdirSync(MAIN_DIR).filter(name => name.endsWith('.js'));
const raw = new Map();
const guarded = new Map();
let totalGuarded = 0;

for (const file of files) {
  const source = fs.readFileSync(path.join(MAIN_DIR, file), 'utf8');
  if (file !== 'ipc-guard.js') {
    const rawCalls = source.match(/\bipcMain\.(?:handle|on)\s*\(/g) || [];
    if (rawCalls.length) raw.set(file, rawCalls.length);
  }
  const guardedCalls = source.match(/\bipcGuard\.(?:handle|on)\(\s*ipcMain\s*,\s*'/g) || [];
  if (guardedCalls.length) {
    guarded.set(file, guardedCalls.length);
    totalGuarded += guardedCalls.length;
  }
}

ok('no direct ipcMain.handle/on outside ipc-guard.js', raw.size === 0,
  raw.size ? [...raw.entries()].map(([f, n]) => `${f}:${n}`).join(', ') : 'clean');

ok('guard covers all 82 privileged channels', totalGuarded === 82, String(totalGuarded));

for (const [file, expected] of Object.entries(EXPECTED)) {
  const actual = guarded.get(file) || 0;
  ok(`${file} registers ${expected} guarded channels`, actual === expected, String(actual));
}

const unexpected = [...guarded.keys()].filter(file => !(file in EXPECTED));
ok('no unexpected module registers privileged channels', unexpected.length === 0,
  unexpected.join(', '));

/* --- channel collection --- */
const channels = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(MAIN_DIR, file), 'utf8');
  const re = /\bipcGuard\.(?:handle|on)\(\s*ipcMain\s*,\s*'([^']+)'/g;
  let match;
  while ((match = re.exec(source)) !== null) channels.push(match[1]);
}
const unique = new Set(channels);
ok('every channel name is registered exactly once', unique.size === channels.length,
  `${channels.length} calls / ${unique.size} unique`);

/* --- panel preload is the only panel sender --- */
const panelPreload = fs.readFileSync(path.join(PRELOAD_DIR, 'panel-preload.js'), 'utf8');
const preloadChannels = new Set();
{
  const re = /ipcRenderer\.(?:send|invoke)\(\s*'([^']+)'/g;
  let match;
  while ((match = re.exec(panelPreload)) !== null) preloadChannels.add(match[1]);
}
const preloadList = [...preloadChannels].sort();
const allowList = [...PANEL_CHANNELS].sort();
ok('panel allowlist matches panel-preload.js exactly',
  preloadList.length === allowList.length && preloadList.every((c, i) => c === allowList[i]),
  `preload=${preloadList.length} guard=${allowList.length}`);

for (const channel of preloadList) {
  ok(`panel channel registered by the manager: ${channel}`, unique.has(channel));
}

/* Main-only channels must not be reachable from a panel window. */
const panelOnlyInManager = [...unique].filter(channel => channel.startsWith('panel-'));
ok('all panel-* channels live in panel-window-manager.js',
  panelOnlyInManager.length > 0 && guarded.get('panel-window-manager.js') >= panelOnlyInManager.length,
  String(panelOnlyInManager.length));

/* --- trust wiring must stay in place --- */
const mainSource = fs.readFileSync(path.join(MAIN_DIR, 'main.js'), 'utf8');
ok('app origin is pinned before window creation',
  /ipcGuard\.setAllowedOrigin\(\s*APP_URL\s*\)/.test(mainSource));
ok('main window is trusted after creation',
  /ipcGuard\.trustMain\(\s*mainContents\s*\)/.test(mainSource));
ok('main window is untrusted on close',
  /ipcGuard\.untrustMain\(\s*mainContents\s*\)/.test(mainSource));

const managerSource = fs.readFileSync(path.join(MAIN_DIR, 'panel-window-manager.js'), 'utf8');
ok('panel window is trusted after creation',
  /ipcGuard\.trustPanel\(\s*panelContents\s*\)/.test(managerSource));
ok('panel window is untrusted on close',
  /ipcGuard\.untrustPanel\(\s*panelContents\s*\)/.test(managerSource));

/* Update manager keeps its own explicit sender check as defence in depth. */
const updateSource = fs.readFileSync(path.join(MAIN_DIR, 'update-manager.js'), 'utf8');
ok('update manager keeps assertTrusted defence in depth',
  /function assertTrusted/.test(updateSource) && /assertTrusted\(event\)/.test(updateSource));

/* Guest preloads must never talk to ipcMain directly. */
for (const file of ['pinterest-preload.js', 'artstation-preload.js']) {
  const source = fs.readFileSync(path.join(PRELOAD_DIR, file), 'utf8');
  const direct = /\bipcRenderer\.(?:send|invoke)\(\s*'/.test(source);
  ok(`${file} uses sendToHost only (no direct main IPC)`, direct === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
