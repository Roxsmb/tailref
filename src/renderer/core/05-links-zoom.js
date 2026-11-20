/* TailRef app · connection arrows, zoom, fit, framing */
'use strict';

function linkExists(a, b) {
  return (Array.isArray(state.links) ? state.links : [])
    .some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

function scheduleLinks() {
  if (linkRaf) return;
  linkRaf = requestAnimationFrame(() => { linkRaf = 0; updateLinks(); });
}

/** Öğenin merkezinden (dx,dy) yönünde çıkınca dikdörtgen kenarına düşen dünya noktası */
function rectEdge(it, dx, dy) {
  const c = itemCenter(it);
  const rot = (it.rot || 0) * Math.PI / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  // yönü öğenin kendi eksenine çevir
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const hw = it.w / 2, hh = (it.h || 0) / 2;
  const tx = Math.abs(lx) > 1e-6 ? hw / Math.abs(lx) : Infinity;
  const ty = Math.abs(ly) > 1e-6 ? hh / Math.abs(ly) : Infinity;
  const t = Math.min(tx, ty);
  const px = lx * t, py = ly * t;
  return {
    x: c.x + px * cos - py * sin,
    y: c.y + px * sin + py * cos,
  };
}

function linkNode(id) {
  let n = linkNodes.get(id);
  if (n) return n;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'lk');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('class', 'lkLine');
  const head = document.createElementNS(SVG_NS, 'polygon');
  head.setAttribute('class', 'lkHead');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('class', 'lkDot');
  dot.setAttribute('r', '3');
  g.appendChild(line);
  g.appendChild(head);
  g.appendChild(dot);
  linkLayerEl.appendChild(g);
  n = { g, line, head, dot };
  linkNodes.set(id, n);
  return n;
}

function updateLinks() {
  if (!linkLayerEl) return;
  const sc = state.view.scale, ox = state.view.x, oy = state.view.y;
  const links = Array.isArray(state.links) ? state.links : [];
  const live = new Set();

  for (const l of links) {
    const a = getItem(l.from), b = getItem(l.to);
    if (!a || !b || a === b) continue;

    const ca = itemCenter(a), cb = itemCenter(b);
    let dx = cb.x - ca.x, dy = cb.y - ca.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) continue;
    dx /= d; dy /= d;

    const pa = rectEdge(a, dx, dy);
    const pb = rectEdge(b, -dx, -dy);
    let sx = pa.x * sc + ox, sy = pa.y * sc + oy;
    let ex = pb.x * sc + ox, ey = pb.y * sc + oy;

    let ux = ex - sx, uy = ey - sy;
    const dist = Math.hypot(ux, uy);
    if (dist < 3) continue;
    ux /= dist; uy /= dist;

    const pad = 3;
    sx += ux * pad; sy += uy * pad;
    ex -= ux * pad; ey -= uy * pad;

    const headLen = Math.min(13, Math.max(7, dist * 0.42));
    const headW = headLen * 0.60;
    const bx = ex - ux * headLen, by = ey - uy * headLen;
    const nx = -uy, ny = ux;

    live.add(l.id);
    const n = linkNode(l.id);
    n.line.setAttribute('x1', sx.toFixed(2));
    n.line.setAttribute('y1', sy.toFixed(2));
    n.line.setAttribute('x2', bx.toFixed(2));
    n.line.setAttribute('y2', by.toFixed(2));
    n.head.setAttribute('points', [
      `${ex.toFixed(2)},${ey.toFixed(2)}`,
      `${(bx + nx * headW).toFixed(2)},${(by + ny * headW).toFixed(2)}`,
      `${(bx - nx * headW).toFixed(2)},${(by - ny * headW).toFixed(2)}`,
    ].join(' '));
    n.dot.setAttribute('cx', sx.toFixed(2));
    n.dot.setAttribute('cy', sy.toFixed(2));
  }

  for (const [id, n] of [...linkNodes]) {
    if (!live.has(id)) { n.g.remove(); linkNodes.delete(id); }
  }
}

/** Seçimdeki öğeleri sırayla birbirine bağlar; bağlantı varsa kaldırır */
function toggleLink() {
  const ids = [...selection].filter(id => getItem(id));
  if (ids.length < 2) return;
  if (!Array.isArray(state.links)) state.links = [];
  pushUndo();
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i], b = ids[i + 1];
    const idx = state.links.findIndex(l =>
      (l.from === a && l.to === b) || (l.from === b && l.to === a));
    if (idx >= 0) state.links.splice(idx, 1);
    else state.links.push({ id: 'lk_' + newId(), from: a, to: b });
  }
  updateLinks();
  updateLinkButton();
  scheduleSave();
}

function updateLinkButton() {
  const btn = $('#btnLink');
  if (!btn) return;
  const ids = [...selection];
  const needsTwo = ids.length < 2;
  btn.disabled = needsTwo;
  // Devre dışıyken nedeni tooltip'te yazsın.
  btn.title = needsTwo
    ? __t('Select at least 2 items to link (L)')
    : __t('Link or unlink the selected images (L)');
  let on = ids.length >= 2;
  if (on) {
    for (let i = 0; i < ids.length - 1; i++) {
      if (!linkExists(ids[i], ids[i + 1])) { on = false; break; }
    }
  }
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  // Seçim özellikleri panelindeki Bağla düğmesi üsttekiyle aynı durumu izler.
  const itemBtn = $('#btnItemLink');
  if (itemBtn) {
    itemBtn.disabled = needsTwo;
    itemBtn.title = btn.title;
    itemBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/* Dil değişince Bağla düğmesi başlıkları tazelensin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { updateLinkButton(); } catch { /* sessiz */ } });
}

function zoomAt(screenPoint, factor) {
  const s0 = state.view.scale;
  const s1 = clamp(s0 * factor, MIN_SCALE, MAX_SCALE);
  if (s1 === s0) return;
  const wx = (screenPoint.x - state.view.x) / s0;
  const wy = (screenPoint.y - state.view.y) / s0;
  state.view.scale = s1;
  state.view.x = screenPoint.x - wx * s1;
  state.view.y = screenPoint.y - wy * s1;
  applyView();
  scheduleSave();
}

function fitAll(padding = 80) {
  if (!state.items.length) return;
  const b = boundsOf(state.items, 0);
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const s = clamp(
    Math.min((vw - padding * 2) / Math.max(b.w, 1), (vh - padding * 2) / Math.max(b.h, 1)),
    MIN_SCALE, MAX_SCALE
  );
  state.view.scale = s;
  state.view.x = vw / 2 - (b.x + b.w / 2) * s;
  state.view.y = vh / 2 - (b.y + b.h / 2) * s;
  applyView();
  scheduleSave();
}

function zoomTo100() {
  const p = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
  const w = screenToWorld(p);
  state.view.scale = 1;
  state.view.x = p.x - w.x;
  state.view.y = p.y - w.y;
  applyView();
  scheduleSave();
}

/** Seçili öğeleri (yoksa hepsini) görünür alana sığdır */
function frameSelection(pad = 56) {
  const items = selection.size
    ? state.items.filter(i => selection.has(i.id))
    : state.items;
  if (!items.length) return;
  const b = boundsOf(items, 0);
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const sx = (vw - pad * 2) / Math.max(b.w, 1);
  const sy = (vh - pad * 2) / Math.max(b.h, 1);
  const s = clamp(Math.min(sx, sy), MIN_SCALE, MAX_SCALE);
  state.view.scale = s;
  state.view.x = vw / 2 - (b.x + b.w / 2) * s;
  state.view.y = vh / 2 - (b.y + b.h / 2) * s;
  applyView();
  scheduleSave();
}
