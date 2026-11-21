'use strict';

/* TailRef — dosya yolu politikası birim testi (saf Node).
   ------------------------------------------------------------------
   src/main/path-policy.js kararlarını doğrular:
   • .tail açma kapısı yalnız yerel/mutlak/.tail dosyalarını kabul eder.
   • UNC ve aygıt yolları (SMB kimlik sızdırma / aygıt erişimi) reddedilir.
   • Dışa aktarma klasörü yalnız allowlist'teki klasörlere sessiz yazılır;
     Windows'ta karşılaştırma büyük/küçük harf duyarsızdır. */

const {
  isAbsoluteLocalPath,
  normalizeExportDir,
  normalizeDirKey,
  isAllowedExportDir,
  isTailFilePath,
} = require('../src/main/path-policy');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

const win = process.platform === 'win32';

if (win) {
  ok('yerel .tail yolu kabul', isTailFilePath('C:\\Boards\\demo.tail') === true);
  ok('ileri eğik çizgili .tail kabul', isTailFilePath('C:/Boards/demo.TAIL') === true);
  ok('.tail olmayan uzantı red', isTailFilePath('C:\\Boards\\demo.txt') === false);
  ok('sürücü-göreli yol red', isTailFilePath('C:demo.tail') === false);
  ok('UNC yol red', isTailFilePath('\\\\server\\share\\demo.tail') === false);
  ok('ileri eğik çizgili UNC red', isTailFilePath('//server/share/demo.tail') === false);
  ok('aygıt yolu (\\\\?\\) red', isTailFilePath('\\\\?\\C:\\Boards\\demo.tail') === false);
  ok('aygıt yolu (\\\\.\\) red', isTailFilePath('\\\\.\\C:\\Boards\\demo.tail') === false);
  ok('göreli yol red', isTailFilePath('relative\\demo.tail') === false);
  ok('boş/null/undefined red',
    isTailFilePath('') === false && isTailFilePath(null) === false && isTailFilePath(undefined) === false);
  ok('kontrol karakteri red', isTailFilePath('C:\\Boards\\demo.tail\u0000.txt') === false);

  ok('mutlak klasör normalize edilir', normalizeExportDir('C:\\Exports\\Art') === 'C:\\Exports\\Art');
  ok('allowlist büyük/küçük harf duyarsız',
    isAllowedExportDir('C:\\Exports\\Art', ['c:\\exports\\art']) === true);
  ok('sondaki ayırıcı normalize edilir',
    isAllowedExportDir('C:\\Exports\\Art\\', ['C:\\Exports\\Art']) === true);
  ok('allowlist dışı klasör red', isAllowedExportDir('C:\\Other', ['C:\\Exports\\Art']) === false);
  ok('UNC klasör allowlist\'e giremez',
    isAllowedExportDir('\\\\server\\share', ['\\\\server\\share']) === false);
  ok('göreli klasör normalize edilemez', normalizeExportDir('relative') === null);
  ok('Set allowlist çalışır',
    isAllowedExportDir('C:\\Exports\\Art', new Set(['C:\\Exports\\Art'])) === true);
  ok('boş allowlist red', isAllowedExportDir('C:\\Exports\\Art', []) === false);
  ok('anahtar büyük/küçük harf duyarsız', normalizeDirKey('C:\\Exports') === 'c:\\exports');
} else {
  ok('yerel .tail yolu kabul', isTailFilePath('/tmp/boards/demo.tail') === true);
  ok('.tail olmayan uzantı red', isTailFilePath('/tmp/boards/demo.txt') === false);
  ok('UNC benzeri çift eğik çizgi red', isTailFilePath('//server/share/demo.tail') === false);
  ok('göreli yol red', isTailFilePath('relative/demo.tail') === false);
  ok('kontrol karakteri red', isTailFilePath('/tmp/demo.tail\u0000.txt') === false);
  ok('mutlak klasör normalize edilir', normalizeExportDir('/tmp/exports') === '/tmp/exports');
  ok('allowlist eşleşmesi', isAllowedExportDir('/tmp/exports', ['/tmp/exports']) === true);
  ok('allowlist dışı red', isAllowedExportDir('/tmp/other', ['/tmp/exports']) === false);
}

ok('mutlak olmayan yol red', isAbsoluteLocalPath('C:relative') === false);

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
