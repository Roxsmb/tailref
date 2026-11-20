'use strict';
/*_region işi için worker'ın tam paylaştırılmış ressamı (FAZ 7.U parite
   kaynağı): worker kendi kopya drawStroke'ünü DEĞİL, ana ressamin
   inkDrawStrokeOnContext'ini kullanır. 28-ink-brush.js worker-uyumlu
   yazılmıştır (document yoksa OffscreenCanvas + havuz dalları). */
'use strict';
import 'ink-brush-core.js?inkDrawStrokeOnContext';

self.onmessage = async function (ev) {
  const job = ev.data || {};
  try {
    const width = Math.max(1, Math.round(job.width || 1));
    const height = Math.max(1, Math.round(job.height || 1));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    for (const f of job.batch) {
      // Ana ressam — bölge hesabıyla birebir aynı seçenekler
      inkDrawStrokeOnContext(ctx, f.stroke, {
        mapPoint: p => ({ x: p.x * job.canvasW - job.regionX, y: p.y * job.canvasH - job.regionY }),
        sizePx: Math.max(0.5, f.stroke.size * job.canvasW),
        pointScale: { x: job.canvasW, y: job.canvasH },
      });
    }
    f.tip?.close?.(); f.dualTip?.close?.(); job.baked?.close?.();
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id: job.id, bitmap }, [bitmap]);
  } catch (err) {
    try { f.tip?.close?.(); f.dualTip?.close?.(); } catch { }
    self.postMessage({ id: job.id, error: String((err && err.message) || err) });
  }
};
