'use strict';
const fs = require('fs');
const files = fs.readdirSync('src/renderer/core').filter(f => f.endsWith('.js'));
for (const f of files) {
  const lines = fs.readFileSync('src/renderer/core/' + f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (/it\.(x|y|w|h|text|rot|opacity|locked|z)\s*=/.test(l)) {
      // find enclosing addEventListener within previous 25 lines
      let ctx = '';
      for (let k = i; k >= Math.max(0, i - 25); k--) {
        if (/addEventListener\(/.test(lines[k])) { ctx = lines[k].trim().slice(0, 110); break; }
      }
      if (ctx) console.log(f + ':' + (i + 1) + '  [' + ctx + ']  ' + l.trim().slice(0, 100));
    }
  });
}
