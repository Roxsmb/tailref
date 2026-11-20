/* TailRef app · "Arrange" — seçili görselleri yerleştirme */
'use strict';

/* Seçili görselleri BOYUTLARINA DOKUNMADAN, aralarında küçük ve eşit
   boşluklar olacak şekilde satırlara dizer.

   Düzen:
   • Öğeler önce mevcut okuma sırasına (üstten alta, soldan sağa) göre sıralanır;
     böylece tahta yeniden düzenlenirken kullanıcının kurduğu sıra korunur.
   • Satır genişliği, bloğun ekranın en-boy oranına yakın kalması için birkaç
     aday arasından seçilir; her satır kendi içinde ortalanır.
   • Gruplar tek blok olarak taşınır (grup içi yerleşim bozulmaz); grup
     çerçevesinin 14 px'lik payı boşluk hesabına dahildir.
   • İşlem geri alınabilir (Ctrl+Z). */

const ARRANGE_GAP = 14;      // dünya birimi: "minik" ama nefes alan boşluk
const GROUP_FRAME_PAD = 14;  // gframe çerçevesinin öğe sınırına eklediği pay

/** Seçimi kapsayan grupları bütünler; her grup/tek öğe bir "birim" olur. */
function collectArrangeUnits() {
  const expanded = new Set();
  for (const id of selection) {
    const it = getItem(id);
    if (!it) continue;
    expanded.add(id);
    const gid = outermostGroupOf(it);
    if (gid) for (const m of groupItemsDeep(gid)) expanded.add(m.id);
  }

  const units = [];
  const taken = new Set();
  for (const id of expanded) {
    if (taken.has(id)) continue;
    const it = getItem(id);
    if (!it) continue;
    const gid = outermostGroupOf(it);
    const members = gid ? groupItemsDeep(gid) : null;
    if (members && members.length > 1) {
      for (const m of members) taken.add(m.id);
      units.push({ items: members, b: boundsOf(members, GROUP_FRAME_PAD) });
    } else {
      taken.add(id);
      units.push({ items: [it], b: boundsOf([it], 0) });
    }
  }
  return { units, expanded };
}

/** Sabit satır genişliğinde raf (shelf) yerleştirmesi — öğe boyutları değişmez. */
function packArrangeShelves(units, targetWidth) {
  const rows = [];
  let row = null;
  for (const unit of units) {
    if (row && row.w + ARRANGE_GAP + unit.b.w > targetWidth) {
      rows.push(row);
      row = null;
    }
    if (!row) row = { units: [], w: 0, h: 0 };
    row.w += (row.units.length ? ARRANGE_GAP : 0) + unit.b.w;
    row.h = Math.max(row.h, unit.b.h);
    row.units.push(unit);
  }
  if (row) rows.push(row);

  const w = rows.reduce((max, r) => Math.max(max, r.w), 0);
  const h = rows.reduce((sum, r) => sum + r.h, 0)
    + ARRANGE_GAP * Math.max(0, rows.length - 1);
  return { rows, w, h };
}

/* Satır genişliği için adaylar: bloğun biçimi ekranın biçimine ne kadar
   yakınsa o kadar dengeli görünür. Çok dar adaylar her şeyi tek sütuna
   yığacağı için alt sınır var. */
function chooseArrangeLayout(units, maxWidth) {
  const desiredAspect = clamp(
    stage.clientWidth / Math.max(stage.clientHeight, 1), 0.75, 2.4
  );
  const widest = units.reduce((max, u) => Math.max(max, u.b.w), 0);
  const minWidth = Math.min(maxWidth, Math.max(280, Math.min(widest, maxWidth)));
  let best = null;

  for (let i = 0; i < 24; i++) {
    const width = minWidth + (maxWidth - minWidth) * (i / 23);
    const packed = packArrangeShelves(units, width);
    const aspect = packed.w / Math.max(packed.h, 1);
    // Biçim uyumu + (hafif) geniş alan tercihi
    const score = Math.abs(Math.log(aspect / desiredAspect))
      + 0.02 * (1 - packed.w / Math.max(maxWidth, 1));
    if (!best || score < best.score) best = { score, packed };
  }
  return best.packed;
}

/**
 * Seçili öğeleri dizer. En az iki öğe gerekir; yapıldıysa true döner.
 */
function arrangeSelection() {
  if (selection.size < 2) return false;

  const { units, expanded } = collectArrangeUnits();
  if (units.length < 2) return false;

  // Mevcut okuma sırası: üstten alta, eşit yüksekliklerde soldan sağa.
  units.sort((a, b) => (a.b.y - b.b.y) || (a.b.x - b.b.x));

  const all = [...expanded].map(getItem).filter(Boolean);
  if (all.length < 2) return false;

  const before = boundsOf(all, 0);
  const centerX = before.x + before.w / 2;
  const centerY = before.y + before.h / 2;

  /* Hedef genişlik görünür alandan gelir. Zoom %100'ün üzerindeyken ekran
     görüntüsü küçülmesin diye ölçek 1 kabul edilir; %100'ün altında ise
     ekranda görünen dünya genişliği kullanılır. */
  const maxWidth = clamp(
    (stage.clientWidth * 0.9) / Math.max(0.05, Math.min(state.view.scale, 1)),
    420, 12000
  );
  const packed = chooseArrangeLayout(units, maxWidth);

  pushUndo();

  let top = centerY - packed.h / 2;
  for (const row of packed.rows) {
    let x = centerX - row.w / 2;
    for (const unit of row.units) {
      const dx = x - unit.b.x;
      const dy = top + (row.h - unit.b.h) / 2 - unit.b.y;
      for (const it of unit.items) {
        it.x += dx;
        it.y += dy;
      }
      x += unit.b.w + ARRANGE_GAP;
    }
    top += row.h + ARRANGE_GAP;
  }

  // Taşınan her öğe seçili kalsın (grup bütünlemesi görünür olsun).
  selection = new Set(expanded);
  selectionOrder = selectionOrder.filter(id => selection.has(id));
  syncAll();
  syncSelection();
  scheduleSave();
  fitItemsIfNeeded(all, 64);
  return true;
}

if (btnArrange) {
  btnArrange.onclick = () => { arrangeSelection(); };
}
