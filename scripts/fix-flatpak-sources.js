'use strict';
/* Normalizes flatpak/generated-sources.json to POSIX paths.
   flatpak-node-generator writes `dest` with the host separator, so running it
   on Windows produces "flatpak-node\cache\..." which flatpak-builder would
   create as a single literal directory name. Run this after regenerating:

     flatpak-node-generator npm package-lock.json -o flatpak/generated-sources.json --electron-node-headers
     node scripts/fix-flatpak-sources.js
*/
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'flatpak', 'generated-sources.json');
const sources = JSON.parse(fs.readFileSync(file, 'utf8'));

let fixed = 0;
for (const source of sources) {
  for (const key of ['dest', 'dest-filename', 'path']) {
    if (typeof source[key] === 'string' && source[key].includes('\\')) {
      source[key] = source[key].replace(/\\/g, '/');
      fixed++;
    }
  }
  /* Generated shell snippets also embed the host separator. */
  if (Array.isArray(source.commands)) {
    source.commands = source.commands.map((command) => {
      if (typeof command === 'string' && command.includes('\\')) {
        fixed++;
        return command.replace(/\\/g, '/');
      }
      return command;
    });
  }
}

fs.writeFileSync(file, JSON.stringify(sources, null, 4) + '\n');
console.log(`[flatpak] ${sources.length} kaynak, ${fixed} yol düzeltildi`);
