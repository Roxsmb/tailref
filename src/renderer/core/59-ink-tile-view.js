'use strict';
/* =========================================================
   59 · Ink Tile View — görüntü tarafı karo ızgarası (aşama 2, dilim 1)

   Amaç: ink editörünün EKRAN katmanını tek dev canvas'tan
   "görünürlük-hizalı karo tuvalleri"ne taşımak (Krita/PS kalıbı).
   Boya motoru ve parite sözleşmesi TANIMLANMAZ — bu modül yalnız
   karo yaşam-döngüsünü ve kirli-karo defterini tutar; komposit
   işi çağıranın verdiği painter'a aittir (36-ink-editor.js M7 kolon
   kodu burada tek noktada yerini alacak).

   Dilim 1 durumu: KAPALI bayrak — henüz inkEditorRender'a
   bağlanmadı; saf test + probe zinciriyle kanıtlanacak.

   Boyut parametrisi (adaptif profil — ayarlardan değiştirilebilir):
     128 / 256 / 512 CSS-px; her biri dpr ile cihaz px'e taşınır.
   Karo YALNIZ kirli içerik dokunduğunda doğar (sparse görüntü);
   boş alan elle yapılacak arka plan katmanına (kağıt) bırakılır.

   Güvenceler (aşama 1'i kopyalar):
     • Boyut değişimi yalnız vuruşlar arası çağrılmalı (sözleşme).
     • painter her karo için cihaz-px hizalı dikdörtgen alır;
       karolar arası çakışma yok → seam yok.
   ========================================================= */

/* İzinli karo boyutları (CSS px). Ayarlar paneli tek doğrulama
   kaynağı olarak bu listeyi kullanır; dışı varsayılana düşer. */
const INK_TILE_VIEW_SIZES = [128, 256, 512];
const INK_TILE_VIEW_DEFAULT = 256;

function inkTileViewNormalizeSize(n) {
  const v = Math.round(Number(n) || 0);
  return INK_TILE_VIEW_SIZES.includes(v) ? v : INK_TILE_VIEW_DEFAULT;
}

function inkTileViewKey(tx, ty) { return tx + ',' + ty; }

/* Varsayılan karo fabrikası: gerçek DOM. Testler canvasFactory
   verilerak saf Node'ta koşar. */
const inkTileViewDefaultFactory = () => {
  const cv = document.createElement('canvas');
  cv.style.position = 'absolute';
  cv.style.left = '0';
  cv.style.top = '0';
  cv.style.willChange = 'contents';
  return cv;
};

class TileGridView {
  constructor(opts) {
    const o = opts || {};
    this.container = o.container || null;      // DOM üstü (mutlak konumlar)
    this.dpr = Math.max(0.5, Number(o.dpr) || 1);
    this.tileSize = inkTileViewNormalizeSize(o.tileSize);
    this.painter = o.painter || null;           // fn(tile) — komposit çağrısı
    this.factory = o.canvasFactory || inkTileViewDefaultFactory;
    /* karo defteri: "tx,ty" → karoluk {canvas, ctx, tx, ty, dev} */
    this.tiles = new Map();
    this.dirty = new Set();                     // kirli karo anahtarları
    /* görünür alan (CSS px) — resize ile güncellenir */
    this.viewW = 0;
    this.viewH = 0;
    this.open = false;                          // KAPALI bayrak (dilim 1)
  }

  /* Sahne penceresi değişti (resize / dock). Karoların sayısı
     görünür aralıktan çıkarılır; içerik yeniden komposit edilmez —
     çağıran gerekirse markDirty ile ister. */
  setSize(w, h) {
    this.viewW = Math.max(0, Math.round(w));
    this.viewH = Math.max(0, Math.round(h));
    this.pruneOffscreen();
  }

  /* Boyut değişimi: vuruşlar ARASI çağrılmalı. Eski karolar
     tasfiye edilir; yeni boyutta karo YENIDEN DOĞANCAYA dek boş
     kalır (sparse). Dönen değer değişim oldu mu. */
  setTileSize(n) {
    const t = inkTileViewNormalizeSize(n);
    if (t === this.tileSize && this.tiles.size === 0) return false;
    if (t === this.tileSize) return false;
    this.disposeAll();
    this.tileSize = t;
    return true;
  }

  /* Görünür aralıktaki karo koordinat aralığı */
  viewRange() {
    const ts = this.tileSize;
    return {
      tx0: Math.floor(0 / ts), ty0: Math.floor(0 / ts),
      tx1: Math.floor(Math.max(0, this.viewW - 1) / ts),
      ty1: Math.floor(Math.max(0, this.viewH - 1) / ts),
    };
  }

  /* Karo yarat/get — sparse: YALNIZ isteyen doğurur */
  ensure(tx, ty) {
    const k = inkTileViewKey(tx, ty);
    let t = this.tiles.get(k);
    if (t) return t;
    const ts = this.tileSize;
    const dev = Math.round(ts * this.dpr);      // karo üstü cihaz px
    const canvas = this.factory();
    canvas.width = dev;
    canvas.height = dev;
    canvas.style.left = (tx * ts) + 'px';
    canvas.style.top = (ty * ts) + 'px';
    canvas.style.width = ts + 'px';
    canvas.style.height = ts + 'px';
    if (this.container) this.container.appendChild(canvas);
    const ctx = canvas.getContext ? canvas.getContext('2d', { alpha: true }) : null;
    t = { canvas, ctx, tx, ty, dev, cssX: tx * ts, cssY: ty * ts };
    this.tiles.set(k, t);
    this.dirty.add(k);                          // yeni karo elbet boş → kirli doğar
    return t;
  }

  /* Kirli işaretle: CSS-px dikdörtgen (görüş uzayında). Görüş dışı
     kısım işaretlenmez — culling defteri burada uygulanır. */
  markDirtyRect(cssX, cssY, cssW, cssH) {
    if (!this.open) return 0;
    const ts = this.tileSize;
    const x0 = Math.max(0, Math.floor(cssX)), y0 = Math.max(0, Math.floor(cssY));
    const x1 = Math.min(this.viewW, Math.ceil(cssX + cssW));
    const y1 = Math.min(this.viewH, Math.ceil(cssY + cssH));
    if (x1 <= x0 || y1 <= y0) return 0;
    const tx0 = Math.floor(x0 / ts), tx1 = Math.floor((x1 - 1) / ts);
    const ty0 = Math.floor(y0 / ts), ty1 = Math.floor((y1 - 1) / ts);
    let n = 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        this.ensure(tx, ty);
        this.dirty.add(inkTileViewKey(tx, ty));
        n++;
      }
    }
    return n;
  }

  /* Kirli karoların taşınması: her kirli karo painter'a verilir;
     painter true döndürünce karo temiz sayılır (false → kirli kalır,
     ertelenen karede yeniden denenir). */
  drain() {
    if (!this.open || !this.painter) return 0;
    const r = this.viewRange();
    let painted = 0;
    for (const k of Array.from(this.dirty)) {
      const t = this.tiles.get(k);
      if (!t) { this.dirty.delete(k); continue; }               // ölü karo kaydı
      if (t.tx < r.tx0 || t.tx > r.tx1 || t.ty < r.ty0 || t.ty > r.ty1) {
        continue;                                               // dışarıda → ertesi kare
      }
      if (this.painter(t)) {
        this.dirty.delete(k);
        painted++;
      }
    }
    return painted;
  }

  /* Görünür alanı terk eden karoların defterden çıkarılması.
     Canvas DOM'dan alınır ve GC'ye bırakılır (RAM dostu). */
  pruneOffscreen() {
    const r = this.viewRange();
    for (const [k, t] of Array.from(this.tiles)) {
      if (t.tx < r.tx0 || t.tx > r.tx1 || t.ty < r.ty0 || t.ty > r.ty1) {
        if (t.canvas && t.canvas.remove) t.canvas.remove();
        this.tiles.delete(k);
        this.dirty.delete(k);
      }
    }
  }

  disposeAll() {
    for (const t of this.tiles.values()) {
      if (t.canvas && t.canvas.remove) t.canvas.remove();
    }
    this.tiles.clear();
    this.dirty.clear();
  }

  /* Tanı paneli: karo sayısı + yaklaşık GPU backing (MB) */
  stats() {
    const px = Math.round(this.tileSize * this.dpr);
    const bytes = this.tiles.size * px * px * 4;
    return {
      tiles: this.tiles.size,
      dirty: this.dirty.size,
      tileSize: this.tileSize,
      dpr: this.dpr,
      mb: +(bytes / (1024 * 1024)).toFixed(1),
    };
  }
}

/* Dışa sunum: açık globalThis bağlantısı — class bildirimleri vm
   yalıtımında global nesneye bağlanmaz; test + ayarlar erişimi
   bunu şart koşar (app.js birleştirmede zararsızdır). */
globalThis.TileGridView = TileGridView;
globalThis.inkTileViewNormalizeSize = inkTileViewNormalizeSize;
globalThis.INK_TILE_VIEW_SIZES = INK_TILE_VIEW_SIZES;
globalThis.INK_TILE_VIEW_DEFAULT = INK_TILE_VIEW_DEFAULT;
