
import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('lib/client.js', 'utf8');
function cut(start, end) {
  const i = s.indexOf(start);
  if (i < 0) throw new Error('start missing: ' + start.slice(0, 50));
  const j = s.indexOf(end, i);
  if (j < 0) throw new Error('end missing: ' + end.slice(0, 50));
  s = s.slice(0, i) + s.slice(j + end.length);
}
// ① lastPosWritten 声明（注释块 + const）
cut('    /*\n     * 每只猪最后一次「由本客户端写入」的**坐标**', '    const lastPosWritten = {};\n');
// ② savePosition 的那一行
cut('        lastPosWritten[pigId] = { x: Number(x), y: Number(y) };\n', '');
// ③ sameSpot 函数
cut('    /**\n     * 两个落脚点是不是"同一个点"。', '    }\n\n');
// ④ 采纳判据回到旧版
cut('            /*\n             * 「宿主改了位置」必须同时满足三条', "              && (hostAt === 0 || hostAt > sentAt);");
s = s.replace("            if (remembered) seenPos.current[pig.id] = { x: remembered.x, y: remembered.y };",
  "            const hostMoved = remembered && (hostAt === 0 || hostAt > sentAt);\n            if (remembered) seenPos.current[pig.id] = { x: remembered.x, y: remembered.y };");
// ⑤ 落地 walkMs: 0（连同注释段）
cut('              //\n              // walkMs: 0 = **把在飞的位移过渡一起取消**', '');
s = s.replace("{ x, y, mode: 'idle', fresh: false, walkMs: 0, holdUntil: Date.now() + SETTLE_MS }),",
  "{ x, y, mode: 'idle', fresh: false, holdUntil: Date.now() + SETTLE_MS }),");
writeFileSync('tmp/attrib2/lib/client.js', s);
console.log('nofix bundle', s.length, 'sameSpot?' , s.includes('sameSpot'), 'lastPosWritten?', s.includes('lastPosWritten'), 'walkMs0?', s.includes('walkMs: 0'));
