/**
 * 桌面桌宠（原生窗口）宿主。
 *
 * 为什么需要这一层：插件的浏览器半只能活在 DSH 页面里（shell.overlay 是页面级浮层）。
 * 要"在整个 Windows 桌面上走"，必须有一个**不属于任何应用窗口的顶层 HWND**——也就是这里拉起的原生进程。
 * 研读结论与取舍见 docs/DESKTOP-PET-NATIVE.md：NewMate 用的是同一套（WinForms + 分层窗口 + 文件 IPC）。
 *
 * 这一层的职责只有四件：
 *   1. 编译：把 lib/native/pet-window.cs 用系统自带的 csc.exe 编成 exe，按源码哈希缓存；
 *   2. 拉起/停止：一个 profile 只跑一个实例，stop 用文件信号，1.2s 后才强杀；
 *   3. 同步：把"哪些猪在桌面上、在哪儿、多大、动不动"写成 pets.json；
 *   4. 回读：读 positions.json 落盘位置、读 commands.jsonl 处理双击回圈/右键切运动。
 *
 * **停止是 Cordis 契约的一部分**（2026-11-14 补）：
 *   - `stopDesktopPet()` 返回 Promise，**硬上限 2 s 一定 settle**——Cordis 卸载 fiber 时会 await
 *     每个 disposer（`fiber._unload()` 里 `await runDisposable(dispose)`），一个不 settle 的
 *     disposer 会卡住宿主关停，一个"调用后立刻返回"的 disposer 则留下没人等的子进程。
 *   - 幂等：重复调用共用同一次停止（`stopping`），没有会话时直接回 `already_stopped`。
 *   - 孙进程：Windows 上 `child.kill()` 只杀那一个进程；这里用 `taskkill /PID <pid> /T /F` 杀整棵树
 *     （当前原生死进程不派生子进程，`/T` 是为将来与未知包装层留的保险，实测读数见
 *     `archive/cordis-stop-compat.md`）。
 *   - 宿主被强杀（disposer 根本没跑）时进程会变孤儿：拉起时写 `<session>/pid`（含宿主 pid），
 *     下次 `apply` 先 `reclaimStaleSessions()` 按它清理上一次的残留。
 *
 * 平台限制：只支持 win32；其余平台返回 { ok:false, code:'unsupported_platform' }，调用方回退到页面级浮层。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, 'native', 'pet-window.cs');
const cacheRoot = join(tmpdir(), 'dsh-pighub-pet');

/** 编译产物路径：按源码内容哈希缓存，改一行就是新目录（不会跑到旧二进制）。 */
export function petBinaryPlan() {
  const hash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex').slice(0, 20);
  const directory = join(cacheRoot, 'bin', hash);
  return {
    hash,
    directory,
    exe: join(directory, 'pighub-pet.exe'),
    compiler: join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    source: sourcePath,
  };
}

/** 编译参数（纯函数，测试可以直接断言形状，不必真的编译）。 */
export function petCompileArgs(plan) {
  return [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
    // JavaScriptSerializer 在 System.Web.Extensions.dll 里（.NET Framework 自带，不用装 SDK）
    '/r:System.Web.Extensions.dll',
    '/out:' + plan.exe,
    plan.source,
  ];
}

function run(file, args, timeoutMs = 60000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new Error('compile_timeout')); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolvePromise(output) : reject(new Error(output || ('csc_exit_' + code))); });
  });
}

/** 已编译就直接用；否则编译一次。返回 { ok, exe } 或 { ok:false, code }。 */
export async function ensurePetBinary() {
  if (process.platform !== 'win32') return { ok: false, code: 'unsupported_platform' };
  const plan = petBinaryPlan();
  try {
    if (existsSync(plan.exe)) return { ok: true, exe: plan.exe, cached: true, plan };
    mkdirSync(plan.directory, { recursive: true });
    if (!existsSync(plan.compiler)) return { ok: false, code: 'compiler_missing', plan };
    const temp = plan.exe + '.' + process.pid + '.tmp.exe';
    await run(plan.compiler, petCompileArgs({ ...plan, exe: temp }));
    try { copyFileSync(temp, plan.exe); } catch { /* 并发编译时别人先到 */ }
    if (!existsSync(plan.exe)) return { ok: false, code: 'compile_failed', plan };
    return { ok: true, exe: plan.exe, cached: false, plan };
  } catch (error) {
    return { ok: false, code: 'compile_failed', error: String((error && error.message) || error), plan };
  } finally {
    try { rmSync(plan.exe + '.' + process.pid + '.tmp.exe', { force: true }); } catch { /* ignore */ }
  }
}

/**
 * 给原生窗口的负载：每只桌面猪一条。
 * 位置用屏幕像素（窗口自己走动后会把新位置写回来）。
 */
export function petsPayload(pets, { defaultX = 900, defaultY = 700 } = {}) {
  // pen：浏览器半实测的猪圈屏幕矩形；原生窗口在"拖到猪圈里松手"时用它判定回圈。
  const pen = pets.map((pet) => pet.pen).find((rect) => rect && Number.isFinite(rect.width) && rect.width > 0) || null;
  const starMode = pets.map((pet) => pet.starMode).find((mode) => typeof mode === 'string') || 'hover';
  return {
    starMode,
    ...(pen ? { pen: { left: Math.round(pen.left), top: Math.round(pen.top), width: Math.round(pen.width), height: Math.round(pen.height) } } : {}),
    pets: pets.map((pet, index) => ({
      id: pet.id,
      path: pet.path,
      x: Number.isFinite(pet.x) ? Math.round(pet.x) : defaultX + index * 40,
      y: Number.isFinite(pet.y) ? Math.round(pet.y) : defaultY + index * 40,
      size: pet.size || 96,
      motion: pet.motion !== false,
      // 星级胶囊：原生窗口按 starMode 决定画不画，这里必须带过去（之前漏了，胶囊一直不出现）。
      stars: Math.max(1, Math.floor(Number(pet.stars) || 1)),
    })),
  };
}

/* ------------------------------------------------------------------ 气泡（pig-say） */

/** 气泡停留时长（毫秒）。原生侧只认命令里的 until，两边没有第二个真相。 */
export const SAY_DURATION_MS = 6000;

/**
 * 拼一条 say 命令。**格式即契约**（原生 pet-window.cs 的 LoadSay 按它解析）：
 *   {"type":"say","id":"<猪>","text":"…","until":<Unix 毫秒>}
 * id 是必需的：多只桌宠时"随机选一只"这个结果必须落到具体那只猪身上，
 * 否则宿主返回的 pigId 与真正开口的猪会不是同一只。
 */
export function sayCommandLine(petId, text, until) {
  return JSON.stringify({ type: 'say', id: String(petId), text: String(text), until: Number(until) }) + '\n';
}

/**
 * 往 commands.jsonl 追加一条 say（既有命令通道，方向是宿主 → 原生；不新开文件）。
 * 为什么和原生的用户命令写在同一个文件里还是安全的：原生只**追加**，读侧按 mtime 全量重读、
 * 取最后一条 say 行，所以两边谁先写都不影响解析；宿主的 poll 会把 type=say 的行跳过（不是用户命令）。
 */
export function writeSayCommand(directory, petId, text, until) {
  if (!directory) return { ok: false, code: 'no_directory' };
  try {
    appendFileSync(join(directory, 'commands.jsonl'), sayCommandLine(petId, text, until), 'utf8');
  } catch (error) {
    return { ok: false, code: 'write_failed', error: String((error && error.message) || error) };
  }
  return { ok: true, petId, text, until };
}

/** 让桌面上的某只猪说一句话。没有在跑的桌宠窗口就是拒绝，不是异常。 */
export function sayOnDesktop(petId, text, { now = Date.now(), durationMs = SAY_DURATION_MS } = {}) {
  // 正在停：目录可能马上被删掉，往里面追加命令只会得到一条没人读的行，按"没在跑"拒绝。
  if (busy()) return { ok: false, code: 'not_running' };
  const listed = session.payload && Array.isArray(session.payload.pets) ? session.payload.pets : null;
  if (!listed || !listed.some((pet) => pet.id === petId)) return { ok: false, code: 'pet_not_on_desktop' };
  const until = Number(now) + Math.max(1000, Number(durationMs) || SAY_DURATION_MS);
  const written = writeSayCommand(session.directory, petId, text, until);
  if (!written.ok) return written;
  return { ok: true, petId, text, until };
}

let session = null;
/**
 * 停止世代：每开始一次停止就 +1。在途的 `startDesktopPet` 在 `await ensurePetBinary()`
 * 之后拿它比自己出发时记下的值——不相等说明"等编译的这两秒里插件已经被停掉了"，
 * 这时再 spawn 出来的进程会立刻没人管，所以直接放弃拉起。
 */
let stopEpoch = 0;
/** 正在进行的停止。重复停止共用同一次，既幂等也不会重复 kill。 */
let stopping = null;
/** 进程退出/停止期间，`sayOnDesktop` 必须当成"没在跑"，不许往正在被删的目录里写命令。 */
function busy() { return !session || stopping !== null; }

/** 现在有没有在跑；给工具/测试读。 */
export function desktopPetState() {
  if (!session) return { running: false, stopping: stopping !== null };
  return { running: true, pid: session.child.pid, directory: session.directory, pets: session.count, stopping: stopping !== null };
}

/* ------------------------------------------------- 停的三种手段（都在 win32 上实测过） */

/** 等进程自己退出：每 25 ms 看一次 `exitCode`，到点返回 false（不抛）。 */
async function waitForExit(child, budgetMs) {
  const deadline = Date.now() + Math.max(0, budgetMs);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return child.exitCode !== null;
}

/**
 * 强杀**整棵进程树**。Windows 上 `child.kill()` 只对那一个 pid 调 TerminateProcess，
 * 它派生的孙进程会活下来；`taskkill /T /F` 才是"这一棵树都死"。
 * 这是一个**尽力**调用：taskkill 找不到进程会以 128 退出，这里一律吞掉。
 */
function taskkillTree(pid) {
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolvePromise(); } };
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', finish);
      killer.once('exit', finish);
      // taskkill 自己卡住也不能拖住宿主关停。
      setTimeout(finish, 1500).unref?.();
    } catch { finish(); }
  });
}

/** 当前系统里所有 pighub-pet.exe 的 pid（一次 tasklist，自愈时用）。 */
function runningPetPids() {
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolvePromise(value); } };
    try {
      const child = spawn('tasklist', ['/FI', 'IMAGENAME eq pighub-pet.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.once('error', () => finish([]));
      child.once('exit', () => {
        const pids = [];
        for (const line of String(text).split(/\r?\n/)) {
          const cells = line.split('","');
          if (cells.length < 2) continue;
          const pid = Number(cells[1].replace(/"/g, ''));
          if (Number.isFinite(pid) && pid > 0) pids.push(pid);
        }
        finish(pids);
      });
      setTimeout(() => finish([]), 4000).unref?.();
    } catch { finish([]); }
  });
}

/** 这个 pid 还活着吗（只回答"存在/不存在"，不判断是不是我们的进程）。 */
function pidAlive(pid) {
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolvePromise(value); } };
    try {
      const child = spawn('tasklist', ['/FI', 'PID eq ' + Number(pid), '/FO', 'CSV', '/NH'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.once('error', () => finish(false));
      child.once('exit', () => finish(new RegExp('"' + Number(pid) + '"').test(text)));
      setTimeout(() => finish(false), 4000).unref?.();
    } catch { finish(false); }
  });
}

/**
 * 宿主被强杀后留下的孤儿桌宠：**下次启动时自愈**。
 *
 * 判据只有两条，都不猜：
 *   1. 会话目录里有 `pid`（拉起时写的），并且那个 pid 现在**确实是 pighub-pet.exe**——不是的话
 *      不碰（pid 可能已经被系统复用给别的程序）；
 *   2. 那个会话的**宿主进程**已经不在了（`pid.hostPid` 查 tasklist）。宿主还活着说明是**另一个
 *      DSH 实例**的桌宠（tmpdir 是共享的），必须留着。
 * 没有 `pid` 文件的老目录只在**超过 24 小时**没被写过时才删（不可能有活着的使用者）。
 *
 * @param {{ root?: string }} [options] root 默认 cacheRoot；测试用它指到一个假目录。
 */
export async function reclaimStaleSessions(options = {}) {
  const base = (options && typeof options.root === 'string' && options.root) || cacheRoot;
  if (process.platform !== 'win32') return { ok: false, code: 'unsupported_platform' };
  let names = [];
  try { names = readdirSync(base).filter((name) => name.startsWith('session-')); }
  catch { return { ok: true, scanned: 0, reclaimed: [], kept: [], removed: [] }; }

  const live = new Set(await runningPetPids());
  const reclaimed = [];
  const kept = [];
  const removed = [];
  for (const name of names) {
    const directory = join(base, name);
    let info = null;
    try { info = JSON.parse(readFileSync(join(directory, 'pid'), 'utf8')); } catch { info = null; }
    if (!info || !Number.isFinite(Number(info.pid))) {
      // 老目录（没有 pid 记录）：只在明显过期时删，宁可留一条垃圾也不误删别人的活会话。
      let age = Infinity;
      try { age = Date.now() - statSync(directory).mtimeMs; } catch { age = Infinity; }
      if (age > 24 * 3600 * 1000) {
        try { rmSync(directory, { recursive: true, force: true }); removed.push({ directory, why: 'no_pid_and_stale' }); } catch { /* 忽略 */ }
      } else {
        kept.push({ directory, why: 'no_pid' });
      }
      continue;
    }
    const petPid = Number(info.pid);
    const hostPid = Number(info.hostPid);
    // 本次进程自己的上一次：模块里的 session 已为空，那这个 pid 不可能还是有效会话。
    const ownerIsUs = hostPid === process.pid;
    const ownerAlive = ownerIsUs ? false : await pidAlive(hostPid);
    if (ownerAlive) { kept.push({ directory, pid: petPid, why: 'owner_alive' }); continue; }
    let killed = false;
    if (live.has(petPid)) {
      await taskkillTree(petPid);
      killed = true;
    }
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* 目录被占用就留到下次 */ }
    reclaimed.push({ directory, pid: petPid, hostPid, killed, why: ownerIsUs ? 'leftover_of_this_host' : 'owner_gone' });
  }
  return { ok: true, scanned: names.length, reclaimed, kept, removed };
}

/** 拉起时写 pid 记录：这是"下次自愈"唯一的真相来源（位置、宿主 pid、可执行文件）。 */
function writePidRecord(directory, child, exe) {
  try {
    writeFileSync(join(directory, 'pid'), JSON.stringify({
      pid: child.pid, hostPid: process.pid, exe, startedAt: Date.now(),
    }) + '\n', 'utf8');
  } catch { /* 自愈信息缺失不该阻止桌宠起来 */ }
}

/**
 * 启动（或复用）原生桌宠。pets 为空时直接停掉。
 * onPositions(list) / onCommand(cmd) 是宿主回调；出错一律吞掉，桌面桌宠不该拖垮插件。
 */
export async function startDesktopPet(pets, handlers = {}) {
  if (process.platform !== 'win32') return { ok: false, code: 'unsupported_platform' };
  if (!pets || pets.length === 0) { await stopDesktopPet('no_pets'); return { ok: true, stopped: true }; }
  const epoch = stopEpoch;
  const binary = await ensurePetBinary();
  // 编译/拉起是异步的（首次要跑 csc，1–3 s）。这期间插件可能已经被 disable/unload：
  // 那两秒里没人会再调 stop，此时 spawn 出来的就是**立即没人管的孤儿**，所以直接放弃。
  if (epoch !== stopEpoch) return { ok: false, code: 'stopped_during_start' };
  if (!binary.ok) return binary;
  if (session && session.child.exitCode === null) {
    syncDesktopPet(pets);
    return { ok: true, reused: true, ...desktopPetState() };
  }
  const directory = mkdtempSync(join(cacheRoot, 'session-'));
  const payload = petsPayload(pets);
  writeFileSync(join(directory, 'pets.json'), JSON.stringify(payload), 'utf8');
  const child = spawn(binary.exe, [directory], { windowsHide: true, stdio: 'ignore' });
  session = {
    child, directory, count: pets.length, handlers,
    // payload 留一份：气泡要按"正在显示的那批猪"校验 id（不重新算一遍 payload，避免与文件里那份不一致）。
    payload,
    timer: setInterval(() => pollSession(), 350),
    startedAt: Date.now(),
  };
  // 先写 pid 记录，再挂退出处理：宿主被强杀时，这条记录是下次启动自愈的唯一依据。
  writePidRecord(directory, child, binary.exe);
  child.once('exit', () => { if (session && session.child === child) cleanupSession(); });
  // spawn 失败（exe 被删/权限）时 exit 不会来，必须同样收摊，否则 session 会永远"在跑"。
  child.once('error', () => { if (session && session.child === child) cleanupSession(); });
  return { ok: true, started: true, ...desktopPetState() };
}

/** 宠物列表变化时重写 pets.json（窗口靠 mtime 感知）。 */
export function syncDesktopPet(pets) {
  if (!session) return { ok: false, code: 'not_running' };
  // 空列表 = 不该有桌宠在跑。停止是异步的，这里不能 await（调用方是同步的路由处理器），
  // 但必须把 rejection 收掉，否则会变成未处理的 Promise。
  if (!pets || pets.length === 0) { void stopDesktopPet('no_pets').catch(() => {}); return { ok: true, stopped: true }; }
  session.count = pets.length;
  const payload = petsPayload(pets);
  try { writeFileSync(join(session.directory, 'pets.json'), JSON.stringify(payload), 'utf8'); }
  catch (error) { return { ok: false, code: 'write_failed', error: String((error && error.message) || error) }; }
  session.payload = payload;
  return { ok: true, pets: pets.length };
}

function pollSession() {
  if (!session) return;
  const current = session;
  try {
    const positions = JSON.parse(readFileSync(join(current.directory, 'positions.json'), 'utf8'));
    if (positions && Array.isArray(positions.pets) && typeof current.handlers.onPositions === 'function') {
      current.handlers.onPositions(positions.pets);
    }
  } catch { /* 文件还没写或正在替换 */ }
  try {
    const text = readFileSync(join(current.directory, 'commands.jsonl'), 'utf8');
    if (text && text !== current.seenCommands) {
      const lines = text.split('\n').filter(Boolean);
      const seen = current.commandCount || 0;
      current.seenCommands = text;
      current.commandCount = lines.length;
      for (let i = seen; i < lines.length; i += 1) {
        try {
          const command = JSON.parse(lines[i]);
          // type=say 是宿主自己写进去的（气泡），不是用户操作，别当命令回灌一遍。
          if (command && command.type === 'say') continue;
          if (typeof current.handlers.onCommand === 'function') current.handlers.onCommand(command);
        } catch { /* 坏行跳过 */ }
      }
    }
  } catch { /* 还没有命令文件 */ }
}

function cleanupSession(target) {
  const current = target || session;
  if (!current) return;
  if (session === current) session = null;
  clearInterval(current.timer);
  try { rmSync(current.directory, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * 停：写 stop 文件 → 最多等 1.2 s 让它自己退 → `taskkill /T /F` 强杀整棵树 → 最多再等 0.6 s。
 * **硬上限 2 s 一定 settle**：Cordis 卸载 fiber 时会 await 每个 disposer，宿主关停不能被它卡住。
 *
 * 幂等：没有会话时回 `already_stopped`；并发的第二次调用共用同一次 `stopping`，
 * 所以「连点两次 disable」既不会报错，也不会对同一个 pid 杀两次。
 */
export async function stopDesktopPet(reason = 'stopped') {
  if (stopping) return stopping;
  // 世代无条件推进：即使此刻没有会话，也要让"正在编译/拉起"的那条路径在 await 之后看到
  // "这期间已经要求停了"，否则它会拉起一个没人管的进程。
  stopEpoch += 1;
  if (!session) return { ok: true, already_stopped: true };
  const current = session;
  const run = (async () => {
    const startedAt = Date.now();
    const hardDeadline = startedAt + 2000;
    let graceful = false;
    let forced = false;
    try { writeFileSync(join(current.directory, 'stop'), String(reason)); }
    catch { /* 目录已经不在了：直接走强杀 */ }
    graceful = await waitForExit(current.child, Math.min(1200, hardDeadline - Date.now()));
    // 文件信号没人理（卡死/还没读到）→ 杀整棵树。child.kill() 只杀一个 pid，孙进程会活下来。
    if (!graceful && current.child.exitCode === null && Number.isFinite(current.child.pid)) {
      forced = true;
      await taskkillTree(current.child.pid);
      graceful = await waitForExit(current.child, Math.max(0, Math.min(600, hardDeadline - Date.now())));
    }
    if (!graceful && current.child.exitCode === null) {
      try { current.child.kill(); } catch { /* 已经退出 */ }
      await waitForExit(current.child, Math.max(0, Math.min(150, hardDeadline - Date.now())));
    }
    const exitCode = current.child.exitCode;
    cleanupSession(current);
    return {
      ok: exitCode !== null, stopped: true, reason,
      graceful, forced, exitCode, pid: current.child.pid, ms: Date.now() - startedAt,
    };
  })().catch((error) => {
    // 停不下来也不许把异常抛给宿主：Cordis 会把 disposer 的 rejection 记进日志后继续关停，
    // 但这里已经尽力（写了 stop、杀过树），如实回报比抛出去更有用。
    try { cleanupSession(current); } catch { /* ignore */ }
    return { ok: false, stopped: false, reason, error: String((error && error.message) || error) };
  }).finally(() => { stopping = null; });
  stopping = run;
  return run;
}
