/**
 * 画布几何测试 —— 桌宠窗口「别的猪一起颤动」这条 bug 的回归闸门。
 *
 * 症状（用户 2026-11-15）：一只桌宠在桌面上走动时，其它没动的桌宠会一起颤动。
 * 成因：帧循环把画布贴死在「所有猪的包围盒 + margin」上 —— 猪每走 1px 包围盒就换一格，
 *       窗口就跟着搬一次；而搬家分两步（先搬窗口、里面还是上一帧的位图 → 整窗内容整体位移；
 *       再贴新位图）。画布越大，这两步之间的空档越长，位移就越容易被合成到屏幕上。
 * 实测（3 只猪铺满一屏 ≈1900×1100 画布，30fps 进程内渲染）：修之前窗口矩形 7.6 次/秒在变，
 *       静止猪所在区域的像素 55.9% 的采样跟着变；修完是 0.12 次/秒、0%。
 *
 * 这份测试守两件事：
 *   ① 源码契约：窗口的位置/尺寸只经 UpdateLayeredWindow 与位图一起提交，不再单独写 Bounds；
 *   ② 规则本身：把 lib/native/pet-window.cs **真的编译出来**，跑里面的 CanvasFit.Fit，
 *      对一段「猪在走」的帧序列数「画布搬了几次」，并断言画布始终装得下所有猪。
 *
 * 为什么编译真代码、而不是在 JS 里重写一遍同样的规则：重写一遍只能证明「我写的 JS 和我想的一样」，
 * 证明不了「发出去的那份 C# 是这样」。原生桌宠只在 Windows 上存在，所以非 win32 或没有 csc 时跳过。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const sourcePath = fileURLToPath(new URL('../lib/native/pet-window.cs', here));
const harnessPath = fileURLToPath(new URL('./native/canvas-harness.cs', here));
const source = readFileSync(sourcePath, 'utf8');

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };
const skip = (why) => { console.log('SKIP  ' + why); process.exit(0); };

/* ---- ① 源码契约 ---- */
check('画布搬家只经 UpdateLayeredWindow 一次提交：源码里不存在单独写 Bounds 的赋值', () => {
  assert.equal(/Bounds\s*=\s*(bounds|fitted|need|target|Rectangle\.)/.test(source), false, '又出现了「先搬窗口、再贴位图」的两步搬家');
  assert.ok(source.indexOf('CanvasFit.Fit(') > 0, '缺少画布裁定函数 CanvasFit.Fit');
  assert.ok(source.indexOf('Native.Present(hwnd, surface, new Native.Point(canvasRect.Left, canvasRect.Top))') > 0,
    'Present 必须同时带上画布位置（位置与尺寸只经它生效）');
});
check('客户区↔屏幕坐标换算全部读 canvasRect（不再读 Bounds）', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/Bounds\.(Left|Top|Right|Bottom)/.test(code), false, '还有 Bounds.Left/Top 用于坐标换算：画布搬家后它会和实际窗口脱节');
  assert.ok((code.match(/canvasRect\.(Left|Top)/g) || []).length >= 6, '读 canvasRect 的地方少于预期，可能有坐标换算漏改');
});

check('帧节拍：由合成节拍线程驱动，不再是 33ms 的 WinForms Timer（防回退）', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/timer\.Interval\s*=/.test(code), false, '又出现了 Timer.Interval：WM_TIMER 被量化到系统时钟，30 fps 就是天花板');
  assert.ok(/DwmFlush\(\)/.test(code), '没有 DwmFlush：帧上限就不是显示器刷新率了');
  assert.ok(/const int WM_FRAME/.test(code) && /PostMessage\(target, WM_FRAME/.test(code), 'pacer 必须只发消息、由 UI 线程画帧');
  assert.ok(/Interlocked\.CompareExchange\(ref framePending, 1, 0\)/.test(code), '缺「上一条帧消息没处理就不投下一条」的保护，UI 慢时会堆消息');
  assert.ok(/FrameCadence\.SleepFor\(true, ElapsedMs\(started\)\)/.test(code), 'DwmFlush 立即返回时没有兜底等待（会全速空转）');
});

check('每帧成本：常驻合成面 + 预缩放贴图（不再每帧 GetHbitmap / 重采样原图）', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/GetHbitmap/.test(code), false, '又回到每帧 GetHbitmap：那是每帧把整块画布复制一遍');
  assert.ok(/class Surface/.test(code) && /CreateDIBSection/.test(code), '缺少常驻合成面（DIB）');
  assert.ok(/PixelFormat\.Format32bppPArgb/.test(code), '合成面必须是预乘 alpha：ULW_ALPHA 按预乘解释 RGB');
  assert.ok(/DrawImageUnscaled\(sprite, x, y\)/.test(code), '没变形的帧要走 1:1 贴图（缩放绘制是 10 倍代价）');
  assert.ok(/private Bitmap SpriteFor\(Pet pet\)/.test(code), '缺少预缩放贴图缓存');
});

check('画面没变就不重画、不重贴：视觉签名相同就跳过 Render+Present', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/string signature = Signature\(nowMs, animating\);/.test(code), '没有计算视觉签名');
  assert.ok(/bool redraw = canvasFresh \|\| signature != lastSignature;/.test(code), '重画的判据不是签名比较');
  const block = code.slice(code.indexOf('if (redraw)'), code.indexOf('fastMode = animating;'));
  assert.ok(block.indexOf('Render()') >= 0 && block.indexOf('Native.Present(') >= 0, 'Render 与 Present 必须都在 if (redraw) 里');
  // 签名必须把参与渲染的状态都装进去：漏一项就是「状态变了、画面停在上一帧」
  const signatureFn = code.slice(code.indexOf('private string Signature('), code.indexOf('private void WriteStats('));
  for (const key of ['pet.Walking', 'pet.FacingRight', 'pet.Stars', 'bubbleVisible', 'starMode', 'canvasRect.Height']) {
    assert.ok(signatureFn.indexOf(key) >= 0, '签名里漏了 ' + key + '：它变了画面不会重画');
  }
});

check('拖回猪圈：判定区必须经 PenTarget 有效期（不在 PigHub 页面时不许回圈）', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/if \(PenTarget\.Usable\(penRect\.HasValue, penAtMs, UtcMs\(\)\)\)/.test(code),
    '松手判定没走 PenTarget：过期/来路不明的矩形也会被当成猪圈');
  assert.ok(/penAtMs = r\.TryGetValue\("at", out at\)/.test(code), '没有解析负载里的 at（那就永远判过期）');
  assert.ok(/internal const long TtlMs = \d+L;/.test(code), '缺少 TTL 常量');
});

check('走动速度按真实时间积分（帧率提高、速度不变）', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/float speed = pet\.Size \* WalkTempo\.SpeedBodiesPerSecond \* \(dtMs \/ 1000f\);/.test(code),
    '速度必须乘真实 dt（写死帧长会让 165 Hz 下的猪快 7 倍）');
  assert.ok(/Frame\(FrameCadence\.MoveStep\(dtMs\)\)/.test(code), 'dt 必须经 MoveStep 夹取（卡顿不许瞬移）');
});

check('点击弹性：松手判定写 SquishAtMs，渲染里按它算形变（防回退）', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/class PetSquish/.test(code), '缺少 PetSquish（点击弹性的曲线）');
  assert.ok(/if \(clicked\)/.test(code), '松手时没有「这是点击」的分支');
  assert.ok(/dropped\.Motion\) dropped\.SquishAtMs = nowUp/.test(code), '点击后没有记录弹性起点（或没有按 Motion 门控）');
  assert.ok(/PetSquish\.Scale\(/.test(code), '渲染时没有调用 PetSquish.Scale —— 记了时间但没画出来');
  assert.ok(/SquishAtMs = -1L/.test(code), 'SquishAtMs 的哨兵值必须是 long -1（float 存不下 epoch 毫秒）');
  // 点击必须提前 return：否则一只正压在猪圈矩形上的猪，点一下会被判成「拖回猪圈」
  const clickBlock = code.slice(code.indexOf('if (clicked)'), code.indexOf('if (penRect.HasValue)') > 0 ? code.indexOf('if (penRect.HasValue)') : code.length);
  assert.ok(/return;/.test(clickBlock), '点击分支里没有提前 return，会顺路触发拖回猪圈');
});

/* ---- ② 编译真代码，跑真规则 ---- */
if (process.platform !== 'win32') skip('非 win32：原生桌宠窗口只在 Windows 上存在');
if (!existsSync(harnessPath)) skip('缺少 test/native/canvas-harness.cs（发布包里不带它）');
const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!existsSync(compiler)) skip('没找到 csc.exe（.NET Framework 4.x）');

const root = mkdtempSync(join(tmpdir(), 'pighub-canvas-'));
try {
  // harness 复制到临时目录再编译：csc 的 /out 不想落在仓库里
  const localHarness = join(root, 'canvas-harness.cs');
  writeFileSync(localHarness, readFileSync(harnessPath, 'utf8'), 'utf8');
  const exe = join(root, 'canvas-probe.exe');
  execFileSync(compiler, [
    '/nologo', '/target:exe', '/platform:x64', '/main:Harness',
    '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
    '/out:' + exe, sourcePath, localHarness,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = execFileSync(exe, [], { encoding: 'utf8' });
  const rows = stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).map((line) => JSON.parse(line));
  const byName = Object.fromEntries(rows.map((row) => [row.case, row]));
  assert.equal(rows.length, 9, '九个场景都要跑出来（五个画布场景 + 帧节拍 + 游走常量 + 猪圈判定区 + 点击弹性）：' + stdout);

  check('猪走 600px：画布搬家次数 <= 8（旧策略每帧一次，约 188 次）', () => {
    assert.ok(byName.walkRight.changes <= 8, '搬家次数 ' + byName.walkRight.changes);
    assert.ok(byName.walkRight.oldChanges >= 150, '对照组旧策略搬家次数应很大，实际 ' + byName.walkRight.oldChanges);
    assert.equal(byName.walkRight.contained, true, '画布没装下猪（会切边）');
    assert.equal(byName.walkRight.gridOk, true, '搬家没有对齐到网格');
  });
  check('全静止：一次都不搬', () => assert.equal(byName.still.changes, 0));
  check('走出去再走回来：搬家 <= 16，且回来时画布能收回', () => {
    assert.ok(byName.walkBack.changes <= 16, '搬家次数 ' + byName.walkBack.changes);
    const startW = Number(byName.walkBack.start.split(',')[2]);
    const finalW = Number(byName.walkBack.final.split(',')[2]);
    assert.ok(finalW <= startW + 2 * 64 + 320, '画布只长不收：' + startW + ' → ' + finalW);
    assert.equal(byName.walkBack.contained, true);
  });
  check('贴屏幕边缘（need 被裁）：不因为裁剪而每帧重设画布', () => {
    assert.ok(byName.screenEdge.changes <= 2, '搬家次数 ' + byName.screenEdge.changes);
    assert.equal(byName.screenEdge.contained, true);
  });
  check('负坐标的第二块屏：向外取整不越界、画布始终装得下', () => {
    assert.equal(byName.negativeScreen.contained, true);
    assert.ok(byName.negativeScreen.changes <= 4, '搬家次数 ' + byName.negativeScreen.changes);
  });
  check('帧节拍规则（真编译出来的 FrameCadence）：空闲 10 Hz、有动画最多 250 Hz、位移步长有上限', () => {
    const row = byName.frameCadence;
    assert.ok(row, '没有 frameCadence 读数');
    assert.equal(row.sleepIdle, row.idleIntervalMs, '没动画时要按空闲间隔等');
    assert.equal(row.sleepBusyFresh, row.floorMs, '刚等完合成就要按最小间隔兜底（DwmFlush 立即返回时不空转）');
    assert.equal(row.sleepBusyHalf, Math.floor(row.floorMs / 2), '等了一半就只补剩下的');
    assert.equal(row.sleepBusySlow, 0, '已经超时就不再等');
    assert.equal(row.sleepBusyNegative, 0, '负值不许变成无限等');
    assert.ok(row.moveStepHuge <= row.moveStepMs + 0.001, '位移步长没有被夹住：' + row.moveStepHuge);
    assert.ok(row.moveStepNormal > 5.9 && row.moveStepNormal < 6.2, '正常帧（165 Hz）的 dt 应原样放行：' + row.moveStepNormal);
    assert.ok(row.moveStepZero > 1 && row.moveStepZero < 100, '首帧要给一个合理默认：' + row.moveStepZero);
    assert.ok(row.moveStepNan > 1 && row.moveStepNan < 100, 'NaN 不许传下去：' + row.moveStepNan);
  });
  check('猪圈判定区只在「PigHub 页面在眼前」时有效（真编译出来的 PenTarget）', () => {
    const row = byName.penTarget;
    assert.ok(row, '没有 penTarget 读数');
    assert.equal(row.fresh, true, '刚量到的矩形要有效');
    assert.equal(row.edge, true, '正好到期（= TTL）仍算有效，边界不许抖');
    assert.equal(row.expired, false, 'TTL 一过就作废：没有续期说明 PigHub 页面已经不在了');
    assert.equal(row.wayExpired, false, '十分钟前的矩形更不许算数');
    assert.equal(row.noRect, false, '没有矩形当然不能用');
    assert.equal(row.noAt, false, '没有时间戳的矩形当作来路不明（宁可不在页面，也不要凭旧数据回圈）');
    assert.equal(row.future, true, '时钟回拨/宿主给了未来时刻时不许把功能关掉');
    assert.ok(row.ttlMs >= 4000 && row.ttlMs <= 30000, 'TTL 要和「面板每 2 s 续期」同量级：' + row.ttlMs);
  });
  check('游走节奏常量：决策 1700ms、发呆 0.72、速度 0.704 身位/秒（与猪圈侧刻意不一致，见 client.js）', () => {
    const row = byName.walkTempo;
    assert.ok(row, '没有 walkTempo 读数');
    assert.equal(row.decisionMs, 1700);
    assert.ok(Math.abs(row.idleWeight - 0.72) < 1e-6, '发呆权重 ' + row.idleWeight);
    assert.ok(Math.abs(row.speedBodiesPerSecond - 0.704) < 0.001, '速度常量 ' + row.speedBodiesPerSecond);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

/* ---- ④ 点击弹性的读数（真编译出来的 PetSquish） ---- */
if (process.platform === 'win32' && existsSync(harnessPath) && existsSync(compiler)) {
  const root2 = mkdtempSync(join(tmpdir(), 'pighub-squish-'));
  try {
    const localHarness = join(root2, 'canvas-harness.cs');
    writeFileSync(localHarness, readFileSync(harnessPath, 'utf8'), 'utf8');
    const exe = join(root2, 'canvas-probe.exe');
    execFileSync(compiler, [
      '/nologo', '/target:exe', '/platform:x64', '/main:Harness',
      '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
      '/out:' + exe, sourcePath, localHarness,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const rows = execFileSync(exe, [], { encoding: 'utf8' })
      .split(/\r?\n/).filter((line) => line.trim().startsWith('{')).map((line) => JSON.parse(line));
    const squish = rows.find((row) => row.case === 'clickSquish');
    check('点击弹性曲线：先压扁再回弹，560ms 内收敛到原状', () => {
      assert.ok(squish, '没有 clickSquish 读数');
      // 峰值形变要「看得见」但不夸张：猪圈 CSS 是 0.18，原生取 0.12–0.20 之间
      assert.ok(squish.peakSquash >= 0.12 && squish.peakSquash <= 0.20, '压扁峰值 ' + squish.peakSquash);
      assert.ok(squish.peakAtMs >= 60 && squish.peakAtMs <= 140, '峰值时刻应在前 1/4 段，实际 ' + squish.peakAtMs + 'ms');
      assert.ok(squish.peakStretch <= -0.03, '没有反向回弹（只压一下就平了），peakStretch=' + squish.peakStretch);
      assert.ok(squish.crossings >= 1, '曲线没有过零（不是弹性，是单向过渡）');
      assert.equal(squish.waveAt0, 0, '按下瞬间不该有位移');
      assert.ok(squish.waveAtEnd <= 0.02, '到时长末尾还没收敛：' + squish.waveAtEnd);
      // 面积守恒：纵向取横向的倒数（与走动那套同口径），乘积应恒为 1
      const area = squish.scaleXAtPeak * squish.scaleYAtPeak;
      assert.ok(Math.abs(area - 1) <= 0.005, '压扁时面积不守恒：' + area);
      // 峰值必须是「看得见」的压扁：横向 >1.10、纵向 <0.92（猪圈 CSS 是 1.18 / 0.8）
      assert.ok(squish.scaleXAtPeak >= 1.10, '横向几乎没变化：' + squish.scaleXAtPeak);
      assert.ok(squish.scaleYAtPeak <= 0.92, '纵向几乎没变化：' + squish.scaleYAtPeak);
    });
    check('点击 vs 拖动/长按：只有「没挪过且很快松手」才算点击', () => {
      assert.equal(squish.clickSmall, true, '按住不动 120ms 松手应判为点击');
      assert.equal(squish.clickDragged, false, '挪了 10px 不该判成点击（那是拖动）');
      assert.equal(squish.clickHeld, false, '按住 1.2s 不该判成点击（那是长按）');
    });
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
}

console.log('\n' + passed + ' 项通过（画布几何）');
