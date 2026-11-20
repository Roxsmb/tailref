/* TailRef app · toolbar icons, range fill */
'use strict';

/* =========================================================
   bar butonları
   ========================================================= */
const toolbarIcons = {
  btnAdd: 'image', btnText: 'type', btnFit: 'fit',
  btnZoomIn: 'plus', btnZoomOut: 'minus',
  btnGroup: 'group', btnLink: 'link', btnTop: 'pin', btnExport: 'export',
  btnSettings: 'settings', btnPomodoro: 'clock', btnYoutubeMusic: 'music',
  btnPose3d: 'cube', btnPinterest: 'pinterest', btnArtStation: 'artstation', btnGrid: 'grid', btnHelp: 'help', btnInspector: 'inspector',
  btnItemDup: 'copy', btnItemDel: 'trash', btnClose: 'close',
  btnOverflow: 'wrench', btnPanelsBar: 'panels',
  btnMin: 'minus', btnMax: 'square',
  btnPose3dExpand: 'fullscreen', btnPose3dFullscreen: 'maximize',
  btnSettingsClose: 'close', btnPomodoroClose: 'close',
  btnYoutubeMusicClose: 'close', btnPose3dClose: 'close',
  btnPinterestClose: 'close', btnPinterestReload: 'reset',
  btnArtStationClose: 'close', btnArtStationReload: 'reset',
  btnPinterestFullscreen: 'maximize', btnArtStationFullscreen: 'maximize',
  btnDrawMin: 'minus', btnDrawMax: 'square', btnDrawClose: 'close',
  btnImageEditorClose: 'close', btnHelpClose: 'close',
  btnTrashClose: 'close',
  btnEditImage: 'edit', btnImportant: 'star', btnPalette: 'palette', btnArrange: 'arrange',
  btnLock: 'lock', btnBold: 'bold', btnTextBg: 'fill',
  btnExportImage: 'export',
  btnResetFilter: 'reset',
  btnDrawImage: 'ink-brush', btnItemGroup: 'group', btnItemLink: 'link',
};
for (const [id, icon] of Object.entries(toolbarIcons)) {
  enhanceIconButton(document.getElementById(id), icon);
}
// ••• düğmesindeki metin, ikon eklendikten sonra kaldırılır; böylece
// ikon düğmenin tam merkezinde kalır.
{
  const overflowToggle = document.getElementById('btnOverflow');
  if (overflowToggle) {
    for (const node of [...overflowToggle.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    }
    /* Noktalar büyük ve net (kullanıcı: "hiç anlaşılmıyor"). CSS cascade
       savaşlarına rağmen boyut INLINE garanti edilir — inline, yazar
       CSS'inin tümünü geçer (15px ezici kurallar burada biter). */
    const obSvg = overflowToggle.querySelector('svg.toolIcon');
    if (obSvg) { obSvg.style.width = '18px'; obSvg.style.height = '18px'; obSvg.style.flex = '0 0 18px'; }
  }
}

/* İnce kaydırıcılar: rayın dolu kısmını --fill ile göster */
function syncRangeFill(input) {
  if (!input) return;
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const clamped = Math.max(0, Math.min(100, pct));
  input.style.setProperty('--fill', `${clamped.toFixed(2)}%`);
  // 0..1 oranı: dolgu gradyanı ve thumb'ı takip eden etiket bunu kullanır.
  input.style.setProperty('--p', (clamped / 100).toFixed(4));
  const box = input.closest ? input.closest('.opbox') : null;
  if (box) box.style.setProperty('--p', (clamped / 100).toFixed(4));
}
for (const input of document.querySelectorAll('input[type="range"]')) syncRangeFill(input);
document.addEventListener('input', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === 'range') syncRangeFill(target);
}, true);

for (const button of document.querySelectorAll('button[title]')) {
  button.dataset.tooltip = button.title;
  if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', button.title);
  button.removeAttribute('title');
}

$('#btnAdd').onclick    = () => fileInput.click();
$('#btnText').onclick   = () => addText(screenToWorld({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }));
$('#btnFit').onclick    = () => { if (selection.size) frameSelection(); else fitAll(); };
$('#btnGroup').onclick  = () => groupSelection();
$('#btnLink').onclick   = () => toggleLink();
/* Üst panelden kaldırılan Grup/Bağla, seçim özellikleri panelinde de çalışır. */
if ($('#btnItemGroup')) $('#btnItemGroup').onclick = () => groupSelection();
if ($('#btnItemLink'))  $('#btnItemLink').onclick  = () => toggleLink();
$('#btn100').onclick    = () => zoomTo100();
$('#btnExport').onclick = () => openExportDialog();