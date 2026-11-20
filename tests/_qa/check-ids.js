'use strict';
const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const app = fs.readFileSync('src/renderer/app.js', 'utf8');
const ids = [
  'appModeBar','mode3dBtn','modeRefBtn','pose3dPanel','overflowMenu','btnPanelsBar',
  'trashCount','btnTrashDock','trashPanel','trashList','btnTrashRestoreAll','btnTrashClose',
  'btnSettings','settings','settingsSearch','settingsSearchResults','settingsNav-about',
  'settingsPage-about','btnSettingsClose','themeSelect','btnExport','exportModal','exportForm',
  'exportTitle','btnHelp','help','btnHelpClose','bgOpacity','bgOpacityVal'
];
for (const id of ids) {
  console.log((html.includes('id="' + id + '"') ? 'OK  ' : 'YOK ') + id);
}
console.log('\ntema listesi:');
const m = app.match(/const THEMES\s*=\s*\[([\s\S]{0,800}?)\]/);
console.log(m ? m[1].slice(0, 600) : 'bulunamadı');
console.log('\nzoomAt var mı:', /function zoomAt\b/.test(app));
console.log('settingsSearchResult sınıfı:', /settingsSearchResult/.test(app));
