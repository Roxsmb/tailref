'use strict';

/* TailRef — automatic update security/static checks (plain Node).
   Guards the properties that must not regress when the updater changes:
   • the renderer never gets Node or raw ipcRenderer,
   • only the main window may drive update IPC,
   • downloads are opt-in and installation waits for a save handshake,
   • the release feed is pinned to Roxsmb/tailref,
   • no publishing credentials live in the source tree. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

const pkg = JSON.parse(read('package.json'));
const main = read('src/main/main.js');
const manager = read('src/main/update-manager.js');
const policy = read('src/main/update-policy.js');
const preload = read('src/preload/preload.js');
const renderer = read('src/renderer/core/62b-updates.js');
const html = read('src/renderer/index.html');
const css = read('src/renderer/style.css');

/* --- version / publisher agreement --- */
ok('version is 1.4.4', pkg.version === '1.4.4', pkg.version);
ok('GitHub publisher configured',
  Array.isArray(pkg.build.publish) && pkg.build.publish.length === 1 &&
  pkg.build.publish[0].provider === 'github');
ok('publisher owner is Roxsmb', pkg.build.publish[0].owner === 'Roxsmb');
ok('publisher repo is tailref', pkg.build.publish[0].repo === 'tailref');
ok('stable release type', pkg.build.publish[0].releaseType === 'release');
ok('NSIS target kept', pkg.build.win.target.some(t => t.target === 'nsis'));
ok('portable target kept', pkg.build.win.target.some(t => t.target === 'portable'));
ok('electron-updater is a runtime dependency',
  !!pkg.dependencies && !!pkg.dependencies['electron-updater']);
ok('no credentials in package.json',
  !/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(JSON.stringify(pkg)));

/* --- main process ownership --- */
ok('main requires the update manager', /require\('\.\/update-manager'\)/.test(main));
ok('main requires the portable policy', /require\('\.\/update-policy'\)/.test(main));
ok('manager is created after the window', /createWindow\(\)[\s\S]{0,800}createUpdateManager\(/.test(main));
ok('manager startup is guarded', /try\s*\{[\s\S]{0,400}updateManager\.start\(\)/.test(main));
ok('before-quit stops the manager', /before-quit[\s\S]{0,300}updateManager\.stop\(\)/.test(main));
ok('portable detection uses PORTABLE_EXECUTABLE env',
  /isPortableEnv\(process\.env\)/.test(main) && /PORTABLE_EXECUTABLE_DIR/.test(policy));
ok('install handshake exists', /update-install-ready/.test(main) && /update-install-postpone/.test(main));
ok('install handshake checks sender', /event\.sender !== win\.webContents/.test(main));
ok('install choice dialog exists', /window-install-choice/.test(main));

/* --- updater policy --- */
ok('autoDownload is disabled', /autoUpdater\.autoDownload\s*=\s*false/.test(manager));
ok('autoInstallOnAppQuit is disabled', /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/.test(manager));
ok('downgrade is disabled', /autoUpdater\.allowDowngrade\s*=\s*false/.test(manager));
ok('prerelease is gated by the channel', /allowPrerelease\s*=\s*prefs\.channel === 'beta'/.test(manager));
ok('feed is pinned to GitHub', /provider:\s*'github'[\s\S]{0,120}owner:\s*'Roxsmb'[\s\S]{0,120}repo:\s*'tailref'/.test(manager));
ok('install requires a completed download',
  /state\.status !== 'downloaded' \|\| !downloadComplete/.test(manager));
ok('IPC checks the sender', /function assertTrusted/.test(manager) && /assertTrusted\(event\)/.test(manager));
ok('release notes are sanitised', /sanitizeReleaseNotes/.test(manager) && /sanitizeReleaseNotes/.test(policy));
ok('portable/development are unsupported', /reason = 'development'/.test(manager) && /reason = 'portable'/.test(manager));
ok('download page is a constant GitHub URL',
  /DOWNLOAD_PAGE = 'https:\/\/github\.com\/Roxsmb\/tailref\/releases\/latest'/.test(manager));

/* --- preload bridge is minimal --- */
const exposed = preload.slice(preload.indexOf('contextBridge.exposeInMainWorld'));
ok('preload uses contextBridge', /contextBridge\.exposeInMainWorld\('tailref'/.test(preload));
ok('preload exposes update state', /updateGetState:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('update:get-state'\)/.test(preload));
ok('preload exposes update check', /updateCheck:\s*\(manual\)\s*=>\s*ipcRenderer\.invoke\('update:check'/.test(preload));
ok('preload exposes install handshake', /updateInstallReady:/.test(preload) && /updateInstallPostpone:/.test(preload));
ok('preload never exposes ipcRenderer itself', !/ipcRenderer\s*[,}]/.test(exposed.replace(/ipcRenderer\.(invoke|send|on)/g, '')));
ok('preload never exposes require', !/\brequire\s*[,}]/.test(exposed));

/* --- renderer --- */
ok('update UI ids exist', ['settingsUpdatePanel', 'settingsUpdateStatus', 'settingsUpdateCheck',
  'settingsUpdateDownload', 'settingsUpdateInstall', 'updateChip'].every(id => html.includes(`id="${id}"`)));
ok('update section is inside About', /data-page="about"[\s\S]{0,4000}settingsUpdatePanel/.test(html));
ok('renderer does not use innerHTML for update text', !/innerHTML/.test(renderer));
ok('renderer uses textContent', /textContent/.test(renderer));
ok('renderer forwards explicit actions', /api\.updateCheck\(true\)/.test(renderer) &&
  /api\.updateDownload\(\)/.test(renderer) && /api\.updateInstall\(\)/.test(renderer));
ok('renderer handles the save handshake', /onUpdateInstallRequested/.test(renderer));
ok('manual mode asks before install', /isPersistenceAuto\(\)/.test(renderer) && /saveAsTail\(\)/.test(renderer));
ok('auto mode flushes before install', /flushSave\(\)/.test(renderer));
ok('update CSS is present', /\.updatePanel\{/.test(css) && /\.updateChip\{/.test(css));

/* --- no secrets anywhere in tracked sources --- */
const secretPattern = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const files = ['src/main/main.js', 'src/main/update-manager.js', 'src/main/update-policy.js',
  'src/preload/preload.js', 'src/renderer/core/62b-updates.js'];
ok('no credentials in update sources', files.every(f => !secretPattern.test(read(f))));

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
