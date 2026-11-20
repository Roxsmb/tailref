'use strict';
const fs = require('fs');
const src = fs.readFileSync('src/renderer/app.js', 'utf8');
const names = [...src.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
const uniq = [...new Set(names)].sort();
const groups = {
  ref: /^(add|del|dup|group|ungroup|bring|send|lock|unlock|hide|show|select|clear|fit|zoom|apply|sync|render|draw|update|start|commit|cancel|create|move|resize|rotate|flip|crop|trash|restore|purge|link|unlink|toggle|set|get|open|close|save|load|export|import|undo|redo|push|make|ensure|resolve|clamp|world|screen|item|board|project|text|image|filter|arrange|snap|marquee|inspector|palette|wheel|key|mode|shell|panel|dock|float|pin)/i,
};
console.log('TOPLAM', uniq.length);
console.log(uniq.join('\n'));
