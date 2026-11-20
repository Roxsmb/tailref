'use strict';
/* 59 · TileGridView saf kapı testi (DOM'suz, fabrika stub'u ile).
   Koşma: node tests/ink-tile-view-test.js   (run-gates PURE listesinden) */

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('OK   ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  } else {
    failures++;
    console.log('FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  }
}

/* --- kaynak yüklemesi: vm ile yalıtılmış global alan ---
   Dosya saf global tarzda yazıldı (app.js birleştirme uyumlu);
   testte document yokluğu stub fabrika ile sakatlanır. */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'core', '59-ink-tile-view.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: '59-ink-tile-view.js' });

const { TileGridView, inkTileViewNormalizeSize } = sandbox;
check('modül dışa sunum', typeof TileGridView === 'function');

/* --- stub canvas fabrikası --- */
function makeFactory() {
  const made = [];
  return {
    made,
    factory() {
      const cv = {
        width: 0, height: 0,
        style: {},
        getContext() { return { __stub: true }; },
        remove() { cv.__removed = true; },
      };
      made.push(cv);
      return cv;
    },
  };
}

/* 1) boyut normalizasyonu */
check('boyut: 512 → 512', inkTileViewNormalizeSize(512) === 512);
check('boyut: 128 → 128', inkTileViewNormalizeSize(128) === 128);
check('boyut: 300 → 256 (izinli liste dışı)', inkTileViewNormalizeSize(300) === 256);
check('boyut: 64 → 256 (çirkin küçük)', inkTileViewNormalizeSize(64) === 256);
check('boyut: "abc" → 256', inkTileViewNormalizeSize('abc') === 256);

/* 2) sparse doğuş: karo yalnız istenince yaratılır */
{
  const f = makeFactory();
  const gv = new TileGridView({ canvasFactory: f.factory, dpr: 1, tileSize: 256 });
  gv.setSize(1000, 800);
  gv.open = true;
  check('başta karosuz (sparse)', gv.tiles.size === 0, gv.tiles.size);
  const t = gv.ensure(0, 0);
  check('tek karo doğdu', gv.tiles.get('0,0') === t && gv.tiles.size === 1);
  check('dev = tileSize · dpr', t.dev === 256 && t.canvas.width === 256);
  check('karo doğumunda kirli', gv.dirty.has('0,0'));
}

/* 3) markDirtyRect yalnız kesişen karoları işaretler */
{
  const f = makeFactory();
  const gv = new TileGridView({ canvasFactory: f.factory, dpr: 1, tileSize: 256 });
  gv.setSize(1000, 800);
  gv.open = true;
  const n = gv.markDirtyRect(0, 0, 300, 300);
  check('4 karo kesişti', n === 4 && gv.dirty.size === 4,
    { n, dirty: Array.from(gv.dirty).sort() });
  check('karo koordinatları doğru', gv.tiles.has('0,0') && gv.tiles.has('1,0') &&
    gv.tiles.has('0,1') && gv.tiles.has('1,1'));

  /* görüş alanı dışı → hiçbir karo işaretlenmez */
  const n2 = gv.markDirtyRect(2000, 2000, 100, 100);
  check('dışarıda işaret yok', n2 === 0 && gv.dirty.size === 4);
}

/* 4) drain: kirli karolar painter'dan akar, sonra temizlenir */
{
  const f = makeFactory();
  const seen = [];
  const gv = new TileGridView({
    canvasFactory: f.factory, dpr: 1, tileSize: 256,
    painter: (t) => { seen.push(t.tx + ',' + t.ty); return true; },
  });
  gv.setSize(1000, 800);
  gv.open = true;
  gv.markDirtyRect(300, 300, 600, 400);     // tx1..2 × ty1..1 + ... 
  const before = gv.dirty.size;
  const painted = gv.drain();
  check('painter hepsine gitti', painted === before && seen.length === painted,
    { painted, before });
  check('drain sonrası defter temiz', gv.dirty.size === 0);
  check('ikinci drain iş yapmadı', gv.drain() === 0);
}

/* 5) painter false döndürürse karo kirli kalır (ertelenir) */
{
  let call = 0;
  const gv = new TileGridView({
    canvasFactory: makeFactory().factory, dpr: 1, tileSize: 256,
    painter: () => { call++; return call >= 2; },
  });
  gv.setSize(1000, 800);
  gv.open = true;
  gv.markDirtyRect(0, 0, 256, 256);
  gv.drain();
  check('başarısız painter karoyu tutuyor', gv.dirty.size === 1, gv.dirty.size);
  gv.drain();
  check('ikinci denemede akar ve temizlenir', gv.dirty.size === 0, gv.dirty.size);
}

/* 6) pruneOffscreen: görüş küçülünce dışarıda kalan karolar bırakılır */
{
  const f = makeFactory();
  const gv = new TileGridView({ canvasFactory: f.factory, dpr: 1, tileSize: 256 });
  gv.setSize(1000, 800);
  gv.open = true;
  gv.markDirtyRect(0, 0, 1000, 800);
  check('16 karo (1000×800 / 256)', gv.tiles.size === 16, gv.tiles.size);
  gv.setSize(200, 200);                      // setSize otomatik prune içerir
  check('küçülince yalnız (0,0) kalır',
    gv.tiles.size === 1 && gv.tiles.has('0,0'), gv.tiles.size);
  check('bırakılan karolar remove edildi',
    f.made.filter(c => c.__removed).length === 15, f.made.length);
}

/* 7) setTileSize: defteri bırakır, yeni boyuta geçer */
{
  const f = makeFactory();
  const gv = new TileGridView({ canvasFactory: f.factory, dpr: 2, tileSize: 256 });
  gv.setSize(1000, 800);
  gv.open = true;
  gv.markDirtyRect(0, 0, 500, 500);
  const changed = gv.setTileSize(512);
  check('boyut değişti', changed === true && gv.tileSize === 512);
  check('defter boşaltıldı', gv.tiles.size === 0 && gv.dirty.size === 0);
  const n = gv.markDirtyRect(0, 0, 600, 600);
  check('yeni boyutta 4 karo', n === 4 && gv.tiles.size === 4,
    { n, tiles: gv.tiles.size });
  const t = gv.tiles.get('0,0');
  check('dev dpr ile 1024', t.dev === 1024, t.dev);
  check('aynı boyutta değişimsiz', gv.setTileSize(512) === false);
}

/* 8) culling: görüş dışındaki kirli karo drain'de ertelenir */
{
  const f = makeFactory();
  let calls = 0;
  const gv = new TileGridView({
    canvasFactory: f.factory, dpr: 1, tileSize: 256,
    painter: () => { calls++; return true; },
  });
  gv.setSize(1000, 800);
  gv.open = true;
  gv.markDirtyRect(0, 0, 600, 600);          // (0..2)·(0..2) = 9 karo
  gv.ensure(5, 5);                            // görüş dışında elle doğan karo
  const painted = gv.drain();
  check('yalnız görüş içi 9 karo boyandı',
    painted === 9 && calls === 9, { painted, calls });
  check('görüş dışı kirli kayıt ertelendi',
    gv.dirty.size === 1 && gv.dirty.has('5,5'), Array.from(gv.dirty));
  check('ikinci drain hâlâ dışarıyı işlemez', gv.drain() === 0 && gv.dirty.size === 1);
}

/* 9) stats: bellek yaklaşımı */
{
  const gv = new TileGridView({
    canvasFactory: makeFactory().factory, dpr: 1, tileSize: 256,
  });
  gv.setSize(1000, 800);
  gv.open = true;
  gv.markDirtyRect(0, 0, 256, 256);
  const s = gv.stats();
  check('stats: 1 karo ≈ 0.3 MB', s.tiles === 1 && Math.abs(s.mb - 0.3) < 0.05, s);
}

console.log(failures === 0
  ? '\nTÜM TESTLER GEÇTİ (ink-tile-view)'
  : `\n${failures} TEST BAŞARISIZ (ink-tile-view)`);
process.exit(failures === 0 ? 0 : 1);
