/* =========================================================
   build-native.js - inkcore yerel derleyici
   =========================================================
   native/inkcore altındaki N-API eklentisini Electron ABI'sine
   göre derler. Zorunlu değil: derleme başarısız olursa motor
   JS yoluna düşer (uygulama aynen koşar, yalnız hız kazancı yok).
   Çıktı: native/inkcore/build/Release/inkcore.node
   ========================================================= */

'use strict';
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CORE_DIR = path.join(ROOT, 'native', 'inkcore');
const OUT = path.join(CORE_DIR, 'build', 'Release', 'inkcore.node');

/* --- derleyici durumu: vswhere + standart yol sırası --- */
function hasToolchain() {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (fs.existsSync(vswhere)) {
    try {
      const out = execFileSync(vswhere, [
        '-latest', '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath',
      ], { encoding: 'utf8' }).trim();
      if (out) return true;
    } catch { /* asagi yoldaki taramaya dus */ }
  }
  /* vswhere örnek kaydını her zaman görmeyebilir (kurulu derleyici bile
     kayıt gecikmelidir). Standart dizin varsa derleyici vardir. */
  const msvcRoot = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022';
  if (fs.existsSync(msvcRoot)) {
    try {
      const variants = fs.readdirSync(msvcRoot);
      for (const variant of variants) {
        const msvc = path.join(msvcRoot, variant, 'VC', 'Tools', 'MSVC');
        if (fs.existsSync(msvc)) return true;
      }
    } catch { /* okuma hatası = yok say */ }
  }
  return false;
}

/* --- node-gyp: npm'in kendi paketi yeterli --- */
function findNodeGyp() {
  const cands = [];
  try {
    const raw = fs.realpathSync(
      execSync('npm root -g', { encoding: 'utf8' }).trim());
    cands.push(path.join(raw, 'npm', 'node_modules', 'node-gyp', 'bin',
      'node-gyp.js'));
    cands.push(path.join(raw, 'node-gyp', 'bin', 'node-gyp.js'));
  } catch { /* global dizin yoksa atla */ }
  const np = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
  cands.push(path.join(np, 'node_modules', 'npm', 'node_modules', 'node-gyp',
    'bin', 'node-gyp.js'));
  cands.push(path.join(np, 'node-gyp', 'bin', 'node-gyp.js'));
  cands.push('C:\\Program Files\\nodejs\\node_modules\\npm\\node_modules' +
    '\\node-gyp\\bin\\node-gyp.js');
  cands.push(path.join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'));
  for (const c of cands) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function main() {
  if (!hasToolchain()) {
    /* Yerel motor kokusu yok - yalnızca hız kazancı atlanır. */
    console.warn('[inkcore] derleyici bulunamadı - yerel motor atlandı (JS yolu)');
    process.exit(0);
  }
  const gyp = findNodeGyp();
  if (!gyp) {
    console.warn('[inkcore] node-gyp bulunamadı - yerel motor atlandı');
    process.exit(0);
  }
  /* Electron ABI: paketin kendi sürümüne göre derle. */
  const electron = require(path.join(ROOT, 'node_modules', 'electron',
    'package.json')).version;
  console.log(`[inkcore] derleme: electron ${electron}`);
  const args = [
    gyp, 'rebuild',
    `--runtime=electron`, `--target=${electron}`,
    '--dist-url=https://electronjs.org/headers',
    '--arch=x64',
  ];
  execFileSync(process.execPath, args, {
    cwd: CORE_DIR,
    stdio: 'inherit',
  });
  if (!fs.existsSync(OUT)) {
    console.warn('[inkcore] çıktı yok: ' + OUT);
    process.exit(3);
  }
  console.log('[inkcore] tamam: ' + OUT);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.warn('[inkcore] derleme hatası - JS yolu:', String(err));
  process.exit(4);
}
