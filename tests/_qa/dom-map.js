'use strict';
const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
console.log('--- ID' + 'LER (' + ids.length + ') ---');
console.log(ids.join(' '));
const attrs = [...html.matchAll(/data-(action|tool|cmd|mode|cat|tab)="([^"]+)"/g)].map(x => x[1] + ':' + x[2]);
console.log('\n--- DATA NİTELİKLERİ ---');
console.log([...new Set(attrs)].join('  '));
