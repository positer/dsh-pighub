/**
 * 离线采样：猪圈里的猪 vs 桌面桌宠，跑 300 秒虚拟时间，把两边的读数并排打出来。
 *
 * 为什么要有这个脚本（而不是只看单测）：
 *   单测只能证明「常量相等」，证明不了「跑起来之后分布也对」。旧的猪圈模型常量虽然写着
 *   1.65~3.0 身位，但 penStep 里有一层 0.55 的整体缩放，实际每步只有 0.74~1.34 身位——
 *   单测断言的是同一个常量，所以它一直是绿的。这个脚本量的是**发货代码跑出来的分布**。
 *
 * 采样的两条模型：
 *   A 猪圈（真实函数）：`lib/client.js` 通过 window.__ModuleLoader__ 载入，用它的
 *     penDecide / nextDecisionAt / PEN_BOX 跑 250ms 调度格 —— 与面板里那段 setInterval 同一套。
 *   B 桌宠（逐行复刻）：按 lib/native/pet-window.cs:227-252 重写一遍：33ms 一帧、1700ms 决策、
 *     每帧朝目标按 speed 逼近、到边界每帧夹取。桌宠是 C#，不能在这里跑，所以这一半是**复刻**，
 *     不是实测；它的常量全部从源码里正则读出来，不是在本文件里另抄一份。
 *
 * 第三条对照（C）：把猪圈放到 1920px（活动区随之放大到 ~13.6×10.4 身位，接近桌面的尺度），
 *   用来分开两件事——「模型不一致」和「猪圈太小导致被边界夹住」。模型若真的一致，C 与 B 应当吻合。
 *
 * 用法：node scripts/pen-motion-sample.mjs [--seconds=300] [--seed=1]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------- 桌宠侧的常量（从源码读） */
const CS_PATH = fileURLToPath(new URL('../lib/native/pet-window.cs', import.meta.url));
const cs = readFileSync(CS_PATH, 'utf8');
function fromCs(re, what) {
  const m = re.exec(cs);
  if (!m) throw new Error('pet-window.cs 里找不到「' + what + '」：桌宠侧改了，采样脚本必须跟着改');
  return m;
}
const csDecision = Number(fromCs(/pet\.NextDecision = now \+ (\d+);/, '决策间隔')[1]);
const csIdle = Number(fromCs(/if \(Unity < ([\d.]+)\)/, '发呆概率')[1]);
const csStep = fromCs(/pet\.Size \* \(([\d.]+)f \+ ([\d.]+)f \* \(float\)Unity\)/, '单步距离');
const csStepMin = Number(csStep[1]);
const csStepSpan = Number(csStep[2]);
const csSpeed = fromCs(/float speed = pet\.Size \* ([\d.]+)f \* \((\d+)f \/ (\d+)f\);/, '移动速度');
const csFrame = Number(fromCs(/timer\.Interval = (\d+);/, '帧间隔')[1]);
const csSpeedCoeff = Number(csSpeed[1]);            // 身位/秒
const csHop = Number(fromCs(/hop = pet\.Walking[^;]*pet\.Size \* ([\d.]+)f/, '走动起伏')[1]);
const csSettle = Number(fromCs(/dropped\.NextDecision = DateTime\.UtcNow\.Ticks \/ 10000 \+ (\d+);/, '松手站稳')[1]);

/* ------------------------------------------------------- 载入猪圈侧（发货代码） */
const loader = { definition: null };
globalThis.window = {
  __ModuleLoader__: { load(definition) { loader.definition = definition; } },
  matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  addEventListener() {}, removeEventListener() {},
};
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ dataset: {}, textContent: '', appendChild() {} }),
  querySelector: () => null,
  baseURI: 'http://127.0.0.1/',
};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' });
await import(new URL('../lib/client.js', import.meta.url).href);
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useRef: (init) => ({ current: init }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect() {},
  useCallback: (fn) => fn,
};
const requireStub = (id) => {
  if (id === 'react') return reactStub;
  throw new Error('采样脚本不认识这个依赖：' + id);
};
const pen = loader.definition.factory(requireStub).__test;

/* ------------------------------------------------------------------ 随机源 */
/** 定长种子的 mulberry32：两边用同一串随机数，读数才可复现。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ 模型 A：猪圈 */
function simulatePen(width, seconds, seed) {
  pen.setPenRect({ left: 0, top: 0, width, height: width });
  const rand = mulberry32(seed);
  const box = pen.PEN_BOX;
  const body = pen.penBodyPct(pen.PIG_PX);
  let pos = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  let due = 250;                                  // 与 client.js 的 250ms 调度格同一相位
  const out = { decisions: 0, idle: 0, walks: 0, walkMs: 0, path: 0, realized: [], sampled: [], clamped: 0, times: [], body };
  for (let now = 0; now < seconds * 1000; now += 250) {
    if (now < due) continue;
    const decision = pen.penDecide(pos, pen.PIG_PX, rand);
    out.decisions += 1;
    out.times.push(now);
    due = pen.nextDecisionAt(now, due);
    if (!decision.walk) { out.idle += 1; continue; }
    const walked = Math.hypot(decision.x - pos.x, decision.y - pos.y) / body;
    out.walks += 1;
    out.path += walked;
    out.walkMs += decision.walkMs;
    out.realized.push(walked);
    out.sampled.push(decision.stepBody);
    if (walked < decision.walkBody - 1e-9) out.clamped += 1;   // 目标被活动区夹住
    pos = { x: decision.x, y: decision.y };
  }
  return out;
}

/* ------------------------------------------------ 模型 B：桌宠（按 cs 复刻） */
function simulateDesktop({ width, height, seconds, seed }) {
  const rand = mulberry32(seed);
  const size = 96;                                // 与猪圈同尺寸（pet.Size = sizeRatio × dpiScale，这里取 1:1）
  const frame = csFrame;
  const speed = size * csSpeedCoeff * (frame / 1000);   // cs:244：每帧走 speed 像素
  let x = width / 2; let y = height / 2;
  let walking = false; let targetX = 0; let targetY = 0;
  let nextAt = 0;                                 // cs:188 → 装载后第一帧就决策
  let walk = null;                                // 当前这一段：{ from, traveled, clamped }
  const out = { decisions: 0, idle: 0, walks: 0, path: 0, walkingMs: 0, realized: [], sampled: [], clamped: 0, times: [], frames: 0 };
  /* 一段走完（到点或被下一次决策打断）才结算一次：桌宠**不会**完整走完被夹住的步长——
   * 它顶着墙继续走，直到 1700ms 后的下一次决策把它打断（cs:229-230）。所以「被打断」的
   * 那一段也要计入位移，否则样本只剩「走得完的那些」，读数会系统性偏乐观。
   * 记账口径与猪圈那边一致：realized 记**净位移**（起点到终点），path 记**走过的路程**。 */
  const settle = () => {
    if (!walk) return;
    out.realized.push(Math.hypot(x - walk.from.x, y - walk.from.y) / size);
    out.path += walk.traveled / size;
    if (walk.clamped) out.clamped += 1;
    walk = null;
  };
  const total = seconds * 1000;
  for (let t = 0; t <= total; t += frame) {
    out.frames += 1;
    if (t >= nextAt) {
      settle();                                   // 上一次决策的那一段到此为止
      nextAt = t + csDecision;                    // cs:230
      out.decisions += 1;
      out.times.push(t);
      if (rand() < csIdle) {                      // cs:232
        walking = false;
        out.idle += 1;
      } else {
        const angle = rand() * Math.PI * 2;       // cs:233
        const step = size * (csStepMin + csStepSpan * rand());   // cs:234
        targetX = x + Math.cos(angle) * step;
        targetY = y + Math.sin(angle) * step;
        walking = true;
        out.walks += 1;
        out.sampled.push(step / size);
        walk = { from: { x, y }, traveled: 0, clamped: false };
      }
    }
    if (!walking) continue;
    const dx = targetX - x;
    const dy = targetY - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= speed) {                      // cs:245：到点即停
      if (walk) walk.traveled += distance;
      x = targetX; y = targetY; walking = false;
      settle();
    } else {
      const before = { x, y };
      x += (dx / distance) * speed;
      y += (dy / distance) * speed;
      const nx = Math.min(width - size, Math.max(0, x));          // cs:249-251
      const ny = Math.min(height - size, Math.max(0, y));
      const clampedNow = Math.abs(nx - x) > 1e-9 || Math.abs(ny - y) > 1e-9;
      x = nx; y = ny;
      if (walk) {
        walk.traveled += Math.hypot(x - before.x, y - before.y);
        if (clampedNow) walk.clamped = true;
      }
    }
    out.walkingMs += frame;
  }
  settle();
  return out;
}

/* ------------------------------------------------------------------ 统计 */
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] : 0);
const f = (value, digits = 2) => value.toFixed(digits);
function summarize(run, seconds) {
  const realized = run.realized.slice().sort((a, b) => a - b);
  const sampled = run.sampled.slice().sort((a, b) => a - b);
  const decisionSpan = run.times.length > 1 ? (run.times[run.times.length - 1] - run.times[0]) / (run.times.length - 1) : 0;
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const walkingMs = run.walkingMs != null ? run.walkingMs : run.walkMs;
  return {
    decisions: run.decisions,
    idleRatio: run.decisions ? run.idle / run.decisions : 0,
    decisionGapMs: decisionSpan,
    walks: run.walks,
    sampledMean: mean(sampled), sampledMin: sampled[0] || 0, sampledMax: sampled[sampled.length - 1] || 0,
    realizedMean: mean(realized), realizedP50: pct(realized, 0.5), realizedP90: pct(realized, 0.9), realizedMax: realized[realized.length - 1] || 0,
    realizedMin: realized[0] || 0,
    clampRatio: run.walks ? run.clamped / run.walks : 0,
    walkingRatio: seconds ? walkingMs / (seconds * 1000) : 0,
    pathBodies: run.path,
    speed: seconds ? run.path / seconds : 0,
  };
}

/* ------------------------------------------------------------------ 跑 */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const SECONDS = arg('seconds', 300);
const SEED = arg('seed', 1);
const SEED_COUNT = arg('seeds', 20);

const runOne = (kind, seed) => (kind === 'pen451' ? summarize(simulatePen(451, SECONDS, seed), SECONDS)
  : kind === 'pen1920' ? summarize(simulatePen(1920, SECONDS, seed), SECONDS)
    : summarize(simulateDesktop({ width: 1920, height: 1040, seconds: SECONDS, seed }), SECONDS));

const runs = {
  pen451: runOne('pen451', SEED),
  pen1920: runOne('pen1920', SEED),
  desk: runOne('desk', SEED),
};

/* 300 秒里只有 ~42 次走动（发呆 72%），单个种子的分布统计太薄；所以判定与偏差表用
 * 「20 个种子 × 300s」的合并读数，首表仍给单种子（seed=1）便于逐位复现。 */
const aggregate = (kind) => {
  const keys = ['decisions', 'idleRatio', 'decisionGapMs', 'walks', 'sampledMean', 'sampledMin', 'sampledMax',
    'realizedMean', 'realizedP50', 'realizedP90', 'realizedMax', 'realizedMin', 'clampRatio', 'walkingRatio', 'speed'];
  const totals = {};
  for (let s = 1; s <= SEED_COUNT; s += 1) {
    const one = runOne(kind, 1000 + s * 7);
    for (const key of keys) totals[key] = (totals[key] || 0) + one[key];
  }
  for (const key of keys) totals[key] /= SEED_COUNT;
  totals.walks = Math.round(totals.walks * SEED_COUNT);   // 合并后的走动总次数（不是平均）
  totals.decisions = Math.round(totals.decisions * SEED_COUNT);
  return totals;
};
const agg = { pen451: aggregate('pen451'), pen1920: aggregate('pen1920'), desk: aggregate('desk') };

/* ------------------------------------------------------------------ 打印 */
const line = (cells) => '| ' + cells.join(' | ') + ' |';
const rows = [];
const push = (label, a, b, c) => rows.push(line([label, a, b, c]));

console.log('# 猪圈里的猪 vs 桌面桌宠：' + SECONDS + ' 秒虚拟时间离线采样（seed=' + SEED + '）\n');
console.log('桌宠侧常量：读自 lib/native/pet-window.cs（决策 ' + csDecision + 'ms / 发呆 ' + csIdle
  + ' / 步长 ' + csStepMin + '~' + (csStepMin + csStepSpan) + ' 身位 / 速度 ' + csSpeedCoeff
  + ' 身位每秒 / 帧 ' + csFrame + 'ms / 起伏 ' + csHop + ' 身位 / 松手站稳 ' + csSettle + 'ms）');
console.log('猪圈侧常量：读自 lib/client.js 的 __test 导出（发货代码本身）\n');

console.log(line(['读数', '桌宠（cs 复刻 1920×1040）', '猪圈 451px（本机）', '猪圈 1920px（对照）']));
console.log('|---|---|---|---|');
push('决策次数 / ' + SECONDS + 's', String(runs.desk.decisions), String(runs.pen451.decisions), String(runs.pen1920.decisions));
push('决策间隔（ms）', f(runs.desk.decisionGapMs, 0), f(runs.pen451.decisionGapMs, 0), f(runs.pen1920.decisionGapMs, 0));
push('发呆占比', f(runs.desk.idleRatio * 100, 1) + '%', f(runs.pen451.idleRatio * 100, 1) + '%', f(runs.pen1920.idleRatio * 100, 1) + '%');
push('走动次数', String(runs.desk.walks), String(runs.pen451.walks), String(runs.pen1920.walks));
push('采样步长 均值/最小/最大（身位）',
  f(runs.desk.sampledMean) + ' / ' + f(runs.desk.sampledMin) + ' / ' + f(runs.desk.sampledMax),
  f(runs.pen451.sampledMean) + ' / ' + f(runs.pen451.sampledMin) + ' / ' + f(runs.pen451.sampledMax),
  f(runs.pen1920.sampledMean) + ' / ' + f(runs.pen1920.sampledMin) + ' / ' + f(runs.pen1920.sampledMax));
push('每步实际位移 均值（身位）', f(runs.desk.realizedMean, 3), f(runs.pen451.realizedMean, 3), f(runs.pen1920.realizedMean, 3));
push('每步实际位移 P50 / P90 / 最大', f(runs.desk.realizedP50) + ' / ' + f(runs.desk.realizedP90) + ' / ' + f(runs.desk.realizedMax),
  f(runs.pen451.realizedP50) + ' / ' + f(runs.pen451.realizedP90) + ' / ' + f(runs.pen451.realizedMax),
  f(runs.pen1920.realizedP50) + ' / ' + f(runs.pen1920.realizedP90) + ' / ' + f(runs.pen1920.realizedMax));
push('被边界夹住的走路占比', f(runs.desk.clampRatio * 100, 1) + '%', f(runs.pen451.clampRatio * 100, 1) + '%', f(runs.pen1920.clampRatio * 100, 1) + '%');
push('走动时间占比', f(runs.desk.walkingRatio * 100, 1) + '%', f(runs.pen451.walkingRatio * 100, 1) + '%', f(runs.pen1920.walkingRatio * 100, 1) + '%');
push('平均速度（身位/秒，含发呆）', f(runs.desk.speed, 3), f(runs.pen451.speed, 3), f(runs.pen1920.speed, 3));
console.log(rows.join('\n'));

/* --------------------------------------------------------------- 对账 */
console.log('\n## 参数对账（猪圈侧每个常量 ↔ 桌宠源码里的那一行）\n');
console.log('| 项 | 桌宠侧（pet-window.cs） | 猪圈侧（lib/client.js） | 判定 |');
console.log('|---|---|---|---|');
const check = (label, a, b, tolerance) => {
  const ok = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= (tolerance == null ? 1e-9 : tolerance) : a === b;
  console.log('| ' + label + ' | ' + a + ' | ' + b + ' | ' + (ok ? '✓' : '✗ 不一致') + ' |');
  return ok;
};
let allOk = true;
allOk = check('决策间隔 ms（cs:230）', csDecision, pen.DECISION_MS) && allOk;
allOk = check('发呆概率（cs:232）', csIdle, pen.IDLE_CHANCE) && allOk;
allOk = check('单步下限 身位（cs:234）', csStepMin, pen.STEP_MIN_BODY) && allOk;
allOk = check('单步上限 身位（cs:234）', csStepMin + csStepSpan, pen.STEP_MAX_BODY) && allOk;
allOk = check('速度 身位/秒（cs:244）', csSpeedCoeff, pen.SPEED_BODY_PER_S) && allOk;
allOk = check('一次决策位移上限 身位（cs:230+244）', csSpeedCoeff * (csDecision / 1000), pen.STEP_CAP_BODY) && allOk;
allOk = check('帧间隔 ms（cs:101，只影响桌宠逐帧逼近；猪圈用恒速 transition 等价）', csFrame, 33) && allOk;
allOk = check('松手站稳 ms（cs:397）', csSettle, pen.SETTLE_MS) && allOk;
allOk = check('朝向规则（cs:248：dx > 0 才朝右，相等朝左）', 'right / left / left',
  [pen.facingFor(50, 51), pen.facingFor(50, 50), pen.facingFor(50, 49)].join(' / ')) && allOk;

/* --------------------------------------------- 多种子合并（把分布统计做稳） */
console.log('\n## 多种子合并（' + SEED_COUNT + ' × ' + SECONDS + 's，判定与偏差用这一组）\n');
const arows = [];
arows.push('| 读数 | 桌宠（cs 复刻） | 猪圈 451px | 猪圈 1920px |');
arows.push('|---|---|---|---|');
const arow = (label, key, digits, suffix) => arows.push('| ' + label + ' | ' + f(agg.desk[key], digits) + (suffix || '')
  + ' | ' + f(agg.pen451[key], digits) + (suffix || '') + ' | ' + f(agg.pen1920[key], digits) + (suffix || '') + ' |');
arow('走动总次数', 'walks', 0);
arow('发呆占比', 'idleRatio', 4);
arow('采样步长 均值（身位）', 'sampledMean', 3);
arow('每步实际位移 均值（身位）', 'realizedMean', 3);
arow('每步实际位移 P50（身位）', 'realizedP50', 3);
arow('被边界夹住占比', 'clampRatio', 4);
arow('平均速度（身位/秒）', 'speed', 4);
console.log(arows.join('\n'));

/* --------------------------------------------------- 读数偏差（模型 vs 模型） */
console.log('\n## 读数偏差\n');
const dev = (a, b) => (b === 0 ? 0 : Math.abs(a - b) / Math.abs(b)) * 100;
const rows2 = [];
rows2.push('| 读数 | 桌宠 | 猪圈 451px | 偏差 | 猪圈 1920px | 偏差 |');
rows2.push('|---|---|---|---|---|---|');
const drow = (label, key, digits) => rows2.push('| ' + label + ' | ' + f(agg.desk[key], digits) + ' | ' + f(agg.pen451[key], digits)
  + ' | ' + f(dev(agg.pen451[key], agg.desk[key]), 1) + '% | ' + f(agg.pen1920[key], digits)
  + ' | ' + f(dev(agg.pen1920[key], agg.desk[key]), 1) + '% |');
drow('发呆占比', 'idleRatio', 4);
drow('决策间隔 ms', 'decisionGapMs', 0);
drow('平均速度 身位/秒', 'speed', 4);
drow('每步实际位移 均值 身位', 'realizedMean', 3);
// 夹住占比的「偏差百分比」没有意义（它是被场地大小决定的比值，不是同一个量的两种测法），
// 所以这一行只列读数，不给偏差列。
rows2.push('| 被边界夹住占比（几何项，不给偏差） | ' + f(agg.desk.clampRatio, 4) + ' | ' + f(agg.pen451.clampRatio, 4)
  + ' | — | ' + f(agg.pen1920.clampRatio, 4) + ' | — |');
console.log(rows2.join('\n'));

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const verdicts = [];
verdicts.push(['发呆占比（±1%）', near(agg.pen1920.idleRatio, agg.desk.idleRatio, 0.01)]);
verdicts.push(['决策间隔（±30ms）', near(agg.pen1920.decisionGapMs, agg.desk.decisionGapMs, 30)]);
verdicts.push(['每步实际位移均值（±0.1 身位）', near(agg.pen1920.realizedMean, agg.desk.realizedMean, 0.1)]);
verdicts.push(['平均速度（±10%）', dev(agg.pen1920.speed, agg.desk.speed) <= 10]);
console.log('\n## 判定\n');
for (const [label, ok] of verdicts) console.log('- ' + (ok ? '✓' : '✗ 仍有偏差：') + ' ' + label);
console.log('- 猪圈 451px 与桌宠的读数差距来源：活动区只有 '
  + f((pen.PEN_BOX.x1 - pen.PEN_BOX.x0) / 100 * 451 / 96) + '×' + f((pen.PEN_BOX.y1 - pen.PEN_BOX.y0) / 100 * 451 / 96)
  + ' 个身位（桌面 1920×1040 是 ' + f((1920 - 96) / 96) + '×' + f((1040 - 96) / 96)
  + ' 个身位），所以 ' + f(agg.pen451.clampRatio * 100, 1) + '% 的走路被围栏夹住、均值被压到 '
  + f(agg.pen451.realizedMean, 3) + ' 身位；规则本身与桌宠一致（放大到 1920px 时偏差回到 '
  + f(dev(agg.pen1920.realizedMean, agg.desk.realizedMean), 1) + '%）。');
console.log('- 桌宠一窗的实际上限是 1.716 身位（1700ms / 33ms 帧 = 52 帧 × 0.033），猪圈按推导取 1.700；'
  + '这是帧量化的 0.9% 差，不是规则差。');
const bad = verdicts.filter(([, ok]) => !ok);
if (bad.length) { console.log('\n采样结论：仍有 ' + bad.length + ' 项偏差没对齐。'); process.exitCode = 1; }
else console.log('\n采样结论：规则一致；猪圈 451px 的差距只来自活动区尺寸（已单列）。');
if (!allOk) process.exitCode = 1;
