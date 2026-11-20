/* Kiremit (Tile) Motoru — Krita/Photoshop mimarisi, bağımsız çekirdek.
 *
 * Temel fikir: Tuval tek dev canvas DEĞİL; 256×256'lık bağımsız
 * offscreen karo'ların Map ile saklandığı bir grid'dir.
 *
 *   256×256×4 byte = 256 KB / karo (ARGB32).
 *   8000×8000 tuval 1024 ayrı karo alanıdır; hepsi dolu olsa bile
 *   karo YALNIZCA üzerine çizilince yaratıldığı için (sparse) gerçek
 *   bellek tüketimi kullanılmış yüzeyle orantılıdır.
 *
 * Dört yapı taşası:
 *   Tile          — tek karo (canvas + dirty bayrağı + snapshot)
 *   TileGrid      — sparse Map + koordinat matematiği + bbox kesişimi
 *   TiledDocument — boya işlemi (fırça damgasını karo'lara böler)
 *   Camera        — dünya ↔ ekran dönüşümü (pan/zoom)
 *   TileRenderer  — culling'li render: sadece görünür karo'lar basılır
 *   StrokeHistory — vuruş-başına undo/redo (yalnız DEĞİŞEN karo'lar)
 */

export const TILE = 256;

export function tileKey(tx, ty) { return tx + ',' + ty; }
export function parseTileKey(k) {
  const i = k.indexOf(',');
  return { tx: +k.slice(0, i), ty: +k.slice(i + 1) };
}

/* ---------- Koordinat matematiği ---------- */

/* Global tuval koordinatı → hangi karo (division, floor: negatifler dahil) */
export function globalToTile(gx, gy) {
  return { tx: Math.floor(gx / TILE), ty: Math.floor(gy / TILE) };
}

/* Global koordinat → karo-İÇİ lokal koordinat (0..TILE-1, negatif güvenli) */
export function globalToLocal(gx, gy) {
  return {
    lx: ((gx % TILE) + TILE) % TILE,
    ly: ((gy % TILE) + TILE) % TILE,
  };
}

/* Fırça sınır kutusu (global px) → kesişen karo koordinat aralığı.
   Fırça pek çok karo kapsayabilir; çizim bu LİSTEYE bölünür. */
export function brushTileRange(bx, by, bw, bh) {
  return {
    tx0: Math.floor(bx / TILE),
    ty0: Math.floor(by / TILE),
    tx1: Math.floor((bx + bw - 1) / TILE),
    ty1: Math.floor((by + bh - 1) / TILE),
  };
}

/* ---------- Tile ---------- */

export class Tile {
  constructor(tx, ty) {
    this.tx = tx;
    this.ty = ty;
    // OffscreenCanvas varsa kullan (ana thread rasterize bağımsız çalışır,
    // ileride worker'a taşınabilir). Yoksa klasik canvas'a düş.
    this.canvas = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(TILE, TILE)
      : Object.assign(document.createElement('canvas'),
          { width: TILE, height: TILE });
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.dirty = true;   // render loop bu karo'yu (yeni basılmalı) işaretler
    this.born = false;   // aktif vuruş SIRASINDA mı yaratıldı (undo'da silinebilir)
  }
  /* Undo altyapısı için karo'nun bugünkü piksel hali */
  snapshot() { return this.ctx.getImageData(0, 0, TILE, TILE); }
}

/* ---------- Sparse Grid ---------- */

export class TileGrid {
  constructor() {
    // Map{"tx,ty" -> Tile} — sparse: boş alan için karo YARATILMAZ.
    this.tiles = new Map();
  }
  get(tx, ty) { return this.tiles.get(tileKey(tx, ty)); }

  /* Kritik: karo YALNIZCA fırça o koordinata değdiğinde yaratılır. */
  ensure(tx, ty) {
    const k = tileKey(tx, ty);
    let t = this.tiles.get(k);
    if (!t) { t = new Tile(tx, ty); t.born = true; this.tiles.set(k, t); }
    return t;
  }

  /* Sınır kutusu (global px) → KESİŞEN karo'lar (gerekirse yaratır).
     Bu, "fırça çoklu karo'ya değerse" davranışının tek kapısıdır. */
  *intersecting(bx, by, bw, bh) {
    const r = brushTileRange(bx, by, bw, bh);
    for (let ty = r.ty0; ty <= r.ty1; ty++)
      for (let tx = r.tx0; tx <= r.tx1; tx++)
        yield this.ensure(tx, ty);
  }

  /* Aynı aralıkta ZATEN VAR olan karo'lar (render/clear/ölçüm için). */
  *existingIn(bx, by, bw, bh) {
    const r = brushTileRange(bx, by, bw, bh);
    for (let ty = r.ty0; ty <= r.ty1; ty++) {
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        const t = this.get(tx, ty);
        if (t) yield t;
      }
    }
  }
}

/* ---------- Belge: boya → karo'lara bölünmüş çizim ---------- */

export class TiledDocument {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.grid = new TileGrid();
  }

  /* Tek damga (stamp) global konumda basılır. Damga birden çok karo'ya
     taşarsa HER karo'ya kendi lokal offset'i ile ayrı drawImage:
        screenOffset = damgaMerkezi - karo kökeni
     drawImage karo dışı kısmı kendiliğinden kırpar — ekstra kırpma
     matematiği gerekmez; yalnız HANGİ karo'lara değdiğini bilmek yeter. */
  paintStamp(stamp, cx, cy, radius, history) {
    for (const t of this.grid.intersecting(cx - radius, cy - radius, radius * 2, radius * 2)) {
      if (history && history.active) history.touch(t);   // copy-on-write snapshot
      t.ctx.drawImage(stamp, cx - radius - t.tx * TILE, cy - radius - t.ty * TILE);
      t.dirty = true;
    }
  }

  /* Segment (x0,y0)→(x1,y1) üzerinde spacing adımlı damga serisi. */
  paintSegment(stamp, radius, spacing, x0, y0, x1, y1, history) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const n = Math.floor(len / spacing) + 1;
    for (let i = 1; i <= n; i++) {
      const t = Math.min(1, (i * spacing) / Math.max(len, spacing));
      const x = x0 + dx * t, y = y0 + dy * t;
      // son damga, segment sonuna tam oturması için bitiş noktasına basılır
      const px = (i === n) ? x1 : x;
      const py = (i === n) ? y1 : y;
      this.paintStamp(stamp, px, py, radius, history);
    }
  }

  /* (demo) tüm karo'ları kaldır — undo edilebilir şekilde History ile. */
  clearAll(history) {
    if (history) {
      history.begin();
      for (const t of this.grid.tiles.values()) history.touch(t);
      history.end();
    }
    this.grid.tiles.clear();   // Map sızıntı riski yok: canvas'lar GC'ye kalır
  }
}

/* ---------- Fırça damgası önbelleği ---------- */

/* Damga = yumuşak kenarlı dairesel gradyan. Boyut/renk/sertlik başına
   YALNIZ BİR kez üretilir, cache'lenir; her karo'ya ucuz drawImage gelir. */
const stampCache = new Map();

export function getBrushStamp(radius, color, hardness) {
  const key = radius + '|' + color + '|' + hardness;
  let c = stampCache.get(key);
  if (c) return c;

  const d = Math.ceil(radius * 2 + 2);
  const cv = document.createElement('canvas');
  cv.width = d;
  cv.height = d;
  const g = cv.getContext('2d');
  const m = d / 2;
  // sertlik 0..1: 1 → gevşek iç kenar yok (düz disk), 0 → çok yumuşak
  const inner = Math.max(0.01, radius * (0.15 + 0.82 * hardness));
  const grad = g.createRadialGradient(m, m, inner, m, m, radius);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color + '00');   // aynı hue, alpha 0
  g.fillStyle = grad;
  g.beginPath();
  g.arc(m, m, radius, 0, Math.PI * 2);
  g.fill();

  if (stampCache.size > 48) stampCache.clear();
  stampCache.set(key, cv);
  return cv;
}

/* ---------- Kamera ---------- */

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.scale = 1; }

  /* dünya → ekran: s = (w - cam) * scale */
  worldToScreen(wx, wy) {
    return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale };
  }
  screenToWorld(sx, sy) {
    return { x: sx / this.scale + this.x, y: sy / this.scale + this.y };
  }
}

/* ---------- Render (culling) ---------- */

/* Görünür dünya dikdörtgeni → SALT o aralıktaki karo'lar basılır.
   Ekran dışı karo'lar hiç drawImage edilmez. Karo kenarları tam-sayıya
   yuvarlanır: çift karolar arasında 1px yarım şerit (seam) oluşmaz. */
export class TileRenderer {
  constructor(viewport, doc, camera, dpr) {
    this.cv = viewport;
    this.ctx = viewport.getContext('2d');
    this.doc = doc;
    this.cam = camera;
    this.dpr = dpr || 1;
  }

  render() {
    const dpr = this.dpr, cam = this.cam, cv = this.cv;
    const VW = cv.width / dpr, VH = cv.height / dpr;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, VW, VH);

    // görünür dünya dikdörtgeni
    const a = cam.screenToWorld(0, 0);
    const b = cam.screenToWorld(VW, VH);

    // kağıt arka planı (belge sınırları içinde beyaz, dışı saydam)
    const p0 = cam.worldToScreen(0, 0);
    const p1 = cam.worldToScreen(this.doc.w, this.doc.h);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    this.ctx.strokeStyle = 'rgba(120,120,130,.55)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(p0.x + 0.5, p0.y + 0.5, p1.x - p0.x - 1, p1.y - p0.y - 1);

    // salt VISIBLE karo'lar
    this.ctx.imageSmoothingEnabled = cam.scale < 0.98;
    for (const t of this.doc.grid.existingIn(a.x, a.y, b.x - a.x, b.y - a.y)) {
      const sx = Math.round((t.tx * TILE - cam.x) * cam.scale);
      const sy = Math.round((t.ty * TILE - cam.y) * cam.scale);
      const ex = Math.round(((t.tx + 1) * TILE - cam.x) * cam.scale);
      const ey = Math.round(((t.ty + 1) * TILE - cam.y) * cam.scale);
      this.ctx.drawImage(t.canvas, sx, sy, ex - sx, ey - sy);
      t.dirty = false;
    }
  }
}

/* ---------- Undo/Redo (hafıza dostu) ---------- */
/*
 * Klasik yöntem (undo başına tüm tuvali getImageData) 8000×8000'de
 * ~256 MB / adım'dır — sistem kilitlenir. Bu motorda adım-başına:
 *
 *   • Yalnız vuruş SIRASINDA dokunulan karo'ların ImageData'ları tutulur
 *     (copy-on-write: vuruş o karo'ya İLK kez değdiği anda, boyamadan
 *     ÖNCE snapshot alınır).
 *   • Bir vuruş genelde 1-6 karo dokunur → adım başına ~0.25–1.5 MB.
 *   • 50 adımlık geçmiş bile bu şemayla kabul edilebilir boyuttadır.
 *
 * undo():  her dokunulan karo için  post ← bugünkü,  tuval ← pre
 * redo():  her dokunulan karo için  tuval ← post
 * (karo vuruşta YENİ doğduğunda pre şeffaf ImageData'dır; undo onu
 *  saydam yapar — görsel olarak "yok" ile aynı. İstenirse silinir.)
 */
export class StrokeHistory {
  constructor(doc, limit = 50) {
    this.doc = doc;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.active = false;
    this.current = null;
  }

  begin() {
    this.active = true;
    this.current = { pre: new Map(), post: new Map(), touched: new Set() };
  }

  /* Document boya yolundan çağrılır: karo'ya ilk temas anında snapshot. */
  touch(tile) {
    const k = tileKey(tile.tx, tile.ty);
    if (this.current.touched.has(k)) return;
    this.current.touched.add(k);
    this.current.pre.set(k, tile.snapshot());
  }

  end() {
    this.active = false;
    const e = this.current;
    this.current = null;
    if (!e || e.touched.size === 0) return;
    this.undoStack.push(e);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;   // yeni vuruş redo zincirini keser
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return 0;
    let n = 0;
    for (const k of e.touched) {
      const { tx, ty } = parseTileKey(k);
      const t = this.doc.grid.get(tx, ty);
      if (!t) continue;
      e.post.set(k, t.snapshot());       // redo için bugünkü hali sakla
      t.ctx.putImageData(e.pre.get(k), 0, 0);
      t.dirty = true;
      n++;
    }
    this.redoStack.push(e);
    return n;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return 0;
    let n = 0;
    for (const k of e.touched) {
      const { tx, ty } = parseTileKey(k);
      const t = this.doc.grid.ensure(tx, ty);   // undo'da "kalabilir" (saydam)
      const img = e.post.get(k);
      if (img) { t.ctx.putImageData(img, 0, 0); t.dirty = true; n++; }
    }
    this.undoStack.push(e);
    return n;
  }
}

/* Bellek ölçümü (yaklaşık): karo sayısı × sabit karo boyutu */
export function gridMemoryBytes(grid) {
  return grid.tiles.size * TILE * TILE * 4;
}
