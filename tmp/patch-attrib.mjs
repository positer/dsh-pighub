
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'tmp/attrib/lib/client.js';
let s = readFileSync(f, 'utf8');
function sub(a, b) {
  if (s.split(a).length - 1 !== 1) throw new Error('anchor not unique: ' + a.slice(0, 60));
  s = s.replace(a, b);
}
// ① lastPosWritten 表
sub("    /** 每只猪最后一次「由本客户端写入」位置的时间戳（毫秒）。用来判断快照里的位置是不是更新。 */\n    const lastPosSent = {};",
    "    /** 每只猪最后一次「由本客户端写入」位置的时间戳（毫秒）。用来判断快照里的位置是不是更新。 */\n    const lastPosSent = {};\n    const lastPosWritten = {};");
// ② savePosition 记坐标
sub("      async function savePosition(pigId, x, y) {\n        const at = Date.now();\n        lastPosSent[pigId] = at;",
    "      async function savePosition(pigId, x, y) {\n        const at = Date.now();\n        lastPosSent[pigId] = at;\n        lastPosWritten[pigId] = { x: Number(x), y: Number(y) };");
// ③ sameSpot + 采纳条件
sub("    function usePenActors(pigs, disabled, draggingId, returnedIds) {",
    "    function sameSpot(a, b) {\n      return !!a && !!b && Number.isFinite(a.x) && Number.isFinite(b.x)\n        && Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;\n    }\n\n    function usePenActors(pigs, disabled, draggingId, returnedIds) {");
sub("            const hostMoved = remembered && (hostAt === 0 || hostAt > sentAt);",
    "            const hostMoved = remembered\n              && !sameSpot(seen, remembered)\n              && !sameSpot(lastPosWritten[pig.id], remembered)\n              && (hostAt === 0 || hostAt > sentAt);");
// ④ 落地清掉在飞的过渡
sub("              { x, y, mode: 'idle', fresh: false, holdUntil: Date.now() + SETTLE_MS }),",
    "              { x, y, mode: 'idle', fresh: false, walkMs: 0, holdUntil: Date.now() + SETTLE_MS }),");
writeFileSync(f, s);
console.log('patched HEAD client.js', s.length);

// test/client.test.mjs：HEAD 原文 + 我的两条改动（新用例 + 把那条 async check 改成 await acheck）
const tf = 'tmp/attrib/test/client.test.mjs';
let t = readFileSync(tf, 'utf8');
const anchor = "check('拖动中的猪隐藏本体";
const idx = t.indexOf(anchor);
if (idx < 0) throw new Error('test anchor missing');
const mine = readFileSync('tmp/my-new-test.txt', 'utf8');
t = t.slice(0, idx) + mine + '\n' + t.slice(idx);
const oldCheck = "check('拖动落点在猪圈内 = 换位置（不是取消）', async () => {";
if (t.split(oldCheck).length - 1 !== 1) throw new Error('check anchor not unique');
t = t.replace(oldCheck, "await acheck('拖动落点在猪圈内 = 换位置（不是取消）', async () => {");
writeFileSync(tf, t);
console.log('patched HEAD client.test.mjs', t.length);
