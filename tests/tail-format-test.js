'use strict';

/* .tail kapsayıcı biçimi kapısı (saf Node, Electron yok).
   ------------------------------------------------------------------
   Neden: `readBoardFile` içinde JSON.parse try/catch dışındaydı; sıkıştırma
   açılıp gövde JSON değilse kullanıcı ham "Unexpected token …" metniyle
   karşılaşıyordu. Ayrıca üst düzey değer nesne değilse (null/sayı/dizi)
   renderer `payload.workspace` erişiminde çökerdi. Biçim mantığı artık
   src/main/tail-format.js'te ve burada uçtan uca doğrulanıyor:

     • TAIL yaz → TAIL oku (round-trip)
     • eski RFVR imzası okunur
     • yanlış imza / kısa dosya / bozuk gzip reddedilir
     • geçerli gzip + geçersiz JSON reddedilir
     • null / sayı / dizi üst düzey değer reddedilir
     • sürüm uyuşmazlığı ayrı raporlanır (yerelleştirilmiş mesaj için)
     • dosya ve açılmış JSON sınırları aşılınca reddedilir (gzip bombası)

   Kullanım: node tests/tail-format-test.js */

const zlib = require('zlib');
const {
  MAGIC,
  LEGACY_MAGIC,
  VERSION,
  HEADER_BYTES,
  encodeBoard,
  decodeBoard,
} = require('../src/main/tail-format');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass += 1; else fail += 1;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

const build = (magic, version, body) => Buffer.concat([
  Buffer.from(magic, 'ascii'),
  Buffer.from([version]),
  zlib.deflateSync(Buffer.from(body, 'utf8')),
]);
const gzip = text => zlib.deflateSync(Buffer.from(text, 'utf8'));
const withHeader = (magic, version, gz) => Buffer.concat([
  Buffer.from(magic, 'ascii'),
  Buffer.from([version]),
  gz,
]);

(async () => {
  /* --- sabitler --- */
  ok('imza TAIL', MAGIC === 'TAIL', MAGIC);
  ok('eski imza RFVR', LEGACY_MAGIC === 'RFVR', LEGACY_MAGIC);
  ok('sürüm 1', VERSION === 1, String(VERSION));
  ok('başlık 5 bayt', HEADER_BYTES === 5, String(HEADER_BYTES));

  /* --- round-trip --- */
  const payload = { version: 2, state: { items: [{ id: 'a', kind: 'text', text: 'x' }] }, images: [] };
  const encoded = await encodeBoard(JSON.stringify(payload));
  ok('encode: TAIL imzası', encoded.subarray(0, 4).toString('ascii') === 'TAIL');
  ok('encode: sürüm baytı', encoded[4] === 1, String(encoded[4]));
  const round = await decodeBoard(encoded);
  ok('round-trip: kabul edildi', round.ok === true);
  ok('round-trip: içerik korundu',
    JSON.stringify(round.payload) === JSON.stringify(payload));

  /* --- eski RFVR imzası --- */
  const legacy = await decodeBoard(build('RFVR', 1, JSON.stringify(payload)));
  ok('eski RFVR dosyası okunur', legacy.ok === true);

  /* --- reddedilmesi gerekenler --- */
  const wrongMagic = await decodeBoard(build('NOPE', 1, JSON.stringify(payload)));
  ok('yanlış imza reddedilir', wrongMagic.ok === false && wrongMagic.reason === 'invalid');

  const short = await decodeBoard(Buffer.from('TAIL', 'ascii'));
  ok('kısa dosya reddedilir', short.ok === false && short.reason === 'invalid');

  const corrupt = await decodeBoard(Buffer.concat([
    Buffer.from('TAIL', 'ascii'), Buffer.from([1]), Buffer.from('bozuk-gzip'),
  ]));
  ok('bozuk gzip reddedilir', corrupt.ok === false && corrupt.reason === 'invalid');

  const notJson = await decodeBoard(withHeader('TAIL', 1, gzip('bu JSON değil')));
  ok('geçerli gzip + geçersiz JSON reddedilir',
    notJson.ok === false && notJson.reason === 'invalid');

  for (const [label, text] of [
    ['null', 'null'],
    ['sayı', '42'],
    ['dizi', '[]'],
    ['metin', '"pano"'],
  ]) {
    const result = await decodeBoard(withHeader('TAIL', 1, gzip(text)));
    ok(`üst düzey ${label} reddedilir`, result.ok === false && result.reason === 'invalid');
  }

  /* --- sürüm uyuşmazlığı ayrı raporlanır --- */
  const future = await decodeBoard(build('TAIL', 9, JSON.stringify(payload)));
  ok('bilinmeyen sürüm ayrı raporlanır',
    future.ok === false && future.reason === 'version' && future.version === 9,
    JSON.stringify(future));

  /* --- sınırlar --- */
  const bigFile = await decodeBoard(encoded, { maxFileBytes: encoded.length - 1 });
  ok('dosya boyutu sınırı uygulanır', bigFile.ok === false && bigFile.reason === 'invalid');

  const bomb = await decodeBoard(withHeader('TAIL', 1, gzip(JSON.stringify({ pad: 'x'.repeat(4096) }))),
    { maxInflatedBytes: 64 });
  ok('açılmış JSON sınırı uygulanır (gzip bombası)', bomb.ok === false && bomb.reason === 'invalid');

  /* --- geçersiz girdi tipleri --- */
  ok('Buffer olmayan girdi reddedilir', (await decodeBoard('TAIL')).ok === false);
  ok('null girdi reddedilir', (await decodeBoard(null)).ok === false);

  /* --- encode sınırı --- */
  let tooLarge = null;
  try {
    await encodeBoard('x'.repeat(128), { maxInflatedBytes: 64 });
  } catch (error) {
    tooLarge = error;
  }
  ok('aşırı büyük pano code=too-large ile reddedilir',
    !!tooLarge && tooLarge.code === 'too-large');

  console.log(fail === 0
    ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
    : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(error => {
  console.error('TEST HATASI:', error && error.stack || error);
  process.exit(1);
});
