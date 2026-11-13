/**
 * 桌面桌宠（原生窗口）宿主。
 *
 * 为什么需要这一层：插件的浏览器半只能活在 DSH 页面里（shell.overlay 是页面级浮层）。
 * 要"在整个 Windows 桌面上走"，必须有一个**不属于任何应用窗口的顶层 HWND**——也就是这里拉起的原生进程。
 * 研读结论与取舍见 docs/DESKTOP-PET-NATIVE.md：NewMate 用的是同一套（WinForms + 分层窗口 + 文件 IPC）。
 *
 * 这一层的职责只有四件：
 *   1. 编译：把 lib/native/pet-window.cs 用系统自带的 csc.exe 编成 exe，按源码哈希缓存；
 *   2. 拉起/停止：一个 profile 只跑一个实例，stop 用文件信号，1.5s 后才强杀；
 *   3. 同步：把"哪些猪在桌面上、在哪儿、多大、动不动"写成 pets.json；
 *   4. 回读：读 positions.json 落盘位置、读 commands.jsonl 处理双击回圈/右键切运动。
 *
 * 平台限制：只支持 win32；其余平台返回 { ok:false, code:'unsupported_platform' }，调用方回退到页面级浮层。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

let session = null;

/** 现在有没有在跑；给工具/测试读。 */
export function desktopPetState() {
  if (!session) return { running: false };
  return { running: true, pid: session.child.pid, directory: session.directory, pets: session.count };
}

/**
 * 启动（或复用）原生桌宠。pets 为空时直接停掉。
 * onPositions(list) / onCommand(cmd) 是宿主回调；出错一律吞掉，桌面桌宠不该拖垮插件。
 */
export async function startDesktopPet(pets, handlers = {}) {
  if (process.platform !== 'win32') return { ok: false, code: 'unsupported_platform' };
  if (!pets || pets.length === 0) { await stopDesktopPet('no_pets'); return { ok: true, stopped: true }; }
  const binary = await ensurePetBinary();
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
    timer: setInterval(() => pollSession(), 350),
    startedAt: Date.now(),
  };
  child.once('exit', () => { if (session && session.child === child) cleanupSession(); });
  return { ok: true, started: true, ...desktopPetState() };
}

/** 宠物列表变化时重写 pets.json（窗口靠 mtime 感知）。 */
export function syncDesktopPet(pets) {
  if (!session) return { ok: false, code: 'not_running' };
  if (!pets || pets.length === 0) { stopDesktopPet('no_pets'); return { ok: true, stopped: true }; }
  session.count = pets.length;
  try { writeFileSync(join(session.directory, 'pets.json'), JSON.stringify(petsPayload(pets)), 'utf8'); }
  catch (error) { return { ok: false, code: 'write_failed', error: String((error && error.message) || error) }; }
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
          if (typeof current.handlers.onCommand === 'function') current.handlers.onCommand(command);
        } catch { /* 坏行跳过 */ }
      }
    }
  } catch { /* 还没有命令文件 */ }
}

function cleanupSession() {
  if (!session) return;
  const current = session;
  session = null;
  clearInterval(current.timer);
  try { rmSync(current.directory, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** 优雅停：写 stop 文件，进程读到就退；1.5 秒还没死才强杀。 */
export async function stopDesktopPet(reason = 'stopped') {
  if (!session) return { ok: true, already_stopped: true };
  const current = session;
  try { writeFileSync(join(current.directory, 'stop'), reason); } catch { try { current.child.kill(); } catch { /* ignore */ } }
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && current.child.exitCode === null) await new Promise((r) => setTimeout(r, 50));
  if (current.child.exitCode === null) { try { current.child.kill(); } catch { /* ignore */ } }
  cleanupSession();
  return { ok: true, stopped: true, reason };
}
