'use strict';

/* TailRef — statik güvenlik regresyon testi (saf Node).
   ------------------------------------------------------------------
   Electron güvenlik duruşunun sessizce gevşetilmesini engeller:
   sandbox/contextIsolation, CSP, webview allowlist, dış bağlantı kapısı,
   dosya yolu politikası, paket fuses ve .gitignore sır hijyeni.

   Bu test davranışsal değil yapısal bir kapıdır; ilgili ayar bilinçli
   olarak değiştirilirse burada da güncellenmelidir. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

/* --- Renderer CSP --- */
const indexHtml = read('src/renderer/index.html');
ok('index.html CSP var', /http-equiv=["']Content-Security-Policy["']/i.test(indexHtml));
ok('index.html script-src self', /script-src 'self'/.test(indexHtml));
ok('index.html unsafe-eval yok', !/'unsafe-eval'/.test(indexHtml));
ok('index.html object-src none', /object-src 'none'/.test(indexHtml));
ok('index.html base-uri none', /base-uri 'none'/.test(indexHtml));

const panelHtml = read('src/renderer/panel.html');
ok('panel.html CSP var', /http-equiv=["']Content-Security-Policy["']/i.test(panelHtml));
ok('panel.html default-src self', /default-src 'self'/.test(panelHtml));
ok('panel.html script-src self', /script-src 'self'/.test(panelHtml));
ok('panel.html unsafe-eval yok', !/'unsafe-eval'/.test(panelHtml));

const splashHtml = read('src/renderer/splash.html');
ok('splash.html CSP var', /http-equiv=["']Content-Security-Policy["']/i.test(splashHtml));

/* --- Ana pencere webPreferences --- */
const mainJs = read('src/main/main.js');
ok('contextIsolation: true', /contextIsolation:\s*true/.test(mainJs));
ok('nodeIntegration: false', /nodeIntegration:\s*false/.test(mainJs));
ok('sandbox: true', /sandbox:\s*true/.test(mainJs));
ok('nodeIntegration: true yok', !/nodeIntegration:\s*true/.test(mainJs));
ok('webSecurity: true', /webSecurity:\s*true/.test(mainJs));
ok('allowRunningInsecureContent: false', /allowRunningInsecureContent:\s*false/.test(mainJs));

/* --- webview allowlist + pencere açma --- */
ok('will-attach-webview kancası', /will-attach-webview/.test(mainJs));
ok('GUEST_PRELOADS tanımlı', /GUEST_PRELOADS\s*=\s*\{/.test(mainJs));
ok('pinterest partition allowlist', /'persist:pinterest'/.test(mainJs));
ok('artstation partition allowlist', /'persist:artstation'/.test(mainJs));
ok('ana pencere yeni pencere reddi', /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/.test(mainJs));
ok('ana pencere gezinme koruması', /will-navigate/.test(mainJs) && /will-redirect/.test(mainJs));

/* --- Dosya yolu politikası kullanımı --- */
ok('path-policy bağlı', /require\('\.\/path-policy'\)/.test(mainJs));
ok('open-tail-path .tail kapısı', /isTailFilePath\(filePath\)/.test(mainJs));
ok('export-image allowlist kapısı', /isAllowedExportDir\(requestedDir,\s*loadExportDirs\(\)\)/.test(mainJs));

const panelManager = read('src/main/panel-window-manager.js');
ok('panel penceresi gezinme koruması',
  /will-navigate/.test(panelManager) && /will-redirect/.test(panelManager));

/* --- Preload yüzeyi --- */
const preload = read('src/preload/preload.js');
ok('preload contextBridge kullanır', /contextBridge\.exposeInMainWorld/.test(preload));
ok('preload doğrudan Node modülü açmaz',
  !/require\(['"](fs|child_process|path)['"]\)/.test(preload));

/* --- Dış bağlantı kapısı --- */
const external = read('src/main/external-links.js');
ok('open-external https zorunlu', /protocol\s*!==\s*'https:'/.test(external));
ok('open-external allowlist', /ALLOWED_EXTERNAL_HOSTS/.test(external));

/* --- Paketleme / fuses --- */
const pkg = JSON.parse(read('package.json'));
ok('asar paketleme açık', pkg.build && pkg.build.asar === true);
const fuses = (pkg.build && pkg.build.electronFuses) || {};
ok('fuses: runAsNode kapalı', fuses.runAsNode === false);
ok('fuses: NODE_OPTIONS kapalı', fuses.enableNodeOptionsEnvironmentVariable === false);
ok('fuses: CLI inspect kapalı', fuses.enableNodeCliInspectArguments === false);
ok('fuses: yalnız asar', fuses.onlyLoadAppFromAsar === true);
ok('fuses: çerez şifreleme açık', fuses.enableCookieEncryption === true);

/* --- Sır hijyeni --- */
const gitignore = read('.gitignore');
ok('.gitignore .env', /^\.env$/m.test(gitignore));
ok('.gitignore .env.*', /^\.env\.\*$/m.test(gitignore));
ok('.gitignore .env.example istisnası', /^!\.env\.example$/m.test(gitignore));

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
