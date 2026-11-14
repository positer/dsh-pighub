
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
copyFileSync('lib/client.js', 'tmp/after-client.js');
let s = readFileSync('tmp/after-client.js', 'utf8');
function sub(a, b, label) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error('anchor ' + label + ' count=' + n);
  s = s.replace(a, b);
}
// ① 去掉 lastPosWritten 表（含我加的那段注释）
const block1 = readFileSync('tmp/after-client.js', 'utf8');
const startMark = '    /*\n     * 每只猪最后一次「由本客户端写入」的**坐标**（百分比）。时间戳那条路在真机上不成立：';
const i1 = s.indexOf(startMark);
if (i1 < 0) throw new Error('block1 start');
const i1end = s.indexOf('    const lastPosWritten = {};', i1);
if (i1end < 0) throw new Error('block1 end');
s = s.slice(0, i1) + s.slice(i1end + '    const lastPosWritten = {};\n'.length);
// ② savePosition 里的那行
sub('        lastPosWritten[pigId] = { x: Number(x), y: Number(y) };\n', '', 'savePosition line');
// ③ sameSpot 函数（含注释）
const mark3 = '    /**\n     * 两个落脚点是不是"同一个点"。';
const i3 = s.indexOf(mark3);
if (i3 < 0) throw new Error('sameSpot comment');
const i3end = s.indexOf('    }\n\n    function usePenActors', i3);
if (i3end < 0) throw new Error('sameSpot end');
s = s.slice(0, i3) + s.slice(i3end + '    }\n\n'.length);
// ④ 采纳条件回到旧版
const mark4 = "            /*\n             * 「宿主改了位置」必须同时满足三条（2026-11-14，依据 archive/drag-drop-origin.md）：";
const i4 = s.indexOf(mark4);
if (i4 < 0) throw new Error('block4');
const i4end = s.indexOf('              && (hostAt === 0 || hostAt > sentAt);', i4);
if (i4end < 0) throw new Error('block4 end');
s = s.slice(0, i4) + '            const hostMoved = remembered && (hostAt === 0 || hostAt > sentAt);' + s.slice(i4end + '              && (hostAt === 0 || hostAt > sentAt);'.length);
// ⑤ 落地那行的 walkMs: 0（连同我加的注释段）
const mark5 = '              //\n              // walkMs: 0 = **把在飞的位移过渡一起取消**';
const i5 = s.indexOf(mark5);
if (i5 < 0) throw new Error('block5');
const i5end = s.indexOf("{ x, y, mode: 'idle', fresh: false, walkMs: 0, holdUntil: Date.now() + SETTLE_MS }),", i5);
if (i5end < 0) throw new Error('block5 end');
s = s.slice(0, i5) + s.slice(i5end).replace("{ x, y, mode: 'idle', fresh: false, walkMs: 0, holdUntil: Date.now() + SETTLE_MS }),", "{ x, y, mode: 'idle', fresh: false, holdUntil: Date.now() + SETTLE_MS }),");
writeFileSync('tmp/before-client.js', s);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
for (const p of ['lib/client.js', 'tmp/after-client.js', 'tmp/before-client.js']) console.log(p, readFileSync(p).length, sha(p));
console.log('before has sameSpot?', s.indexOf('sameSpot') >= 0, 'lastPosWritten?', s.indexOf('lastPosWritten') >= 0, 'walkMs0?', s.indexOf('walkMs: 0') >= 0);
