/**
 * profile 的 pnpm 发布年龄策略，以及本插件在其中的那一行。
 *
 * ## 为什么插件要管这件事
 *
 * pnpm 11 的 minimumReleaseAge（默认 1440 分钟）校验的是**整份 lockfile**，不是只校验这次要装的那个包：
 * 一次安装会先打印 "Verifying lockfile against supply-chain policies (N entries)"，只要有一条「发布不足 24h」
 * 且没有被豁免，就整体失败（ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION）。DSH 的插件管理器走的正是这种
 * 冻结锁文件安装 —— 于是「本插件今天发了新版」会连坐**所有人**：别的插件装不动，DSH 自身也升不动。
 * 2026-11-19 本机实测：dsh-pighub@1.0.11 与 newmark2dsh@0.3.84 两条年轻条目让四个更新操作全部失败。
 *
 * 策略本身是用户的：本模块**从不写 minimumReleaseAge**，也不改等待期长短。
 *
 * ## 为什么豁免写成裸包名
 *
 * pnpm 自己能解析时会自动追加豁免，形式是 name@version（多个版本用 || 连起来）。这种清单**一发新版就过期**：
 * 本机原来那条正好停在 0.3.82/1.0.6，而装的是 0.3.84/1.0.11 —— 过期的豁免等于没有豁免。
 * 裸包名 dsh-pighub 覆盖所有版本（包括还没发布的），不会过期，且重复执行结果不变。
 *
 * ## 为什么只写自己这一个名字
 *
 * 豁免是**整个 profile 的权限**：写了谁，谁就跳过等待期。写别人的名字，等于替别人决定「它的新版本可以绕过
 * 用户设的策略」—— 那正是 2026-11-19 要禁掉的权限溢出。本模块只认 SELF_PACKAGE 一个名字，其它条目
 * **逐字保留、顺序不变**；范围靠对照实验证明：同一个 lockfile 里另一个刚发布的包必须**仍然被拒绝并点名**。
 *
 * ## 为什么在挂载时就修
 *
 * DSH 用冻结锁文件安装，pnpm 没有「解析阶段自动补豁免」的窗口；不修的话 profile 会一直坏到有人手动跑 pnpm。
 * 修复是幂等的（文件已正确就不重写）、原子的（临时文件 + rename）、并且无论改没改都回执。
 *
 * 模块拆成「纯文本函数（applySelfExemption）」与「一次文件操作（ensureSelfExemption）」，
 * 判定表可以离线测，不需要磁盘、不需要 profile、不需要宿主。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** 本模块唯一有权改动的键。文件里别的行一个字都不动。 */
export const RELEASE_AGE_KEY = 'minimumReleaseAgeExclude';

/** 本插件唯一有权豁免的包：它自己。 */
export const SELF_PACKAGE = 'dsh-pighub';

/** pnpm 读取这些设置的 workspace 清单。 */
export const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

/**
 * 从一个 spec 里取包名（去掉版本部分）。
 * 也要处理 scoped 形式（@scope/name@1.2.3 → @scope/name）：按第一个 @ 切会把所有 scoped 包读成空名字，
 * 进而把它们的条目当成自己的 —— 那是这个文件里唯一会「放宽豁免」的错误。
 */
export function packageNameOf(spec) {
  const text = String(spec ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (text === '') return '';
  const at = text.indexOf('@', text.startsWith('@') ? 1 : 0);
  return at === -1 ? text : text.slice(0, at);
}

/**
 * 应用本插件规则之后的豁免清单（纯数据）。
 *
 * 规则：恰好一条裸 dsh-pighub；别人的条目逐字保留、顺序不变；本插件按版本写死的条目删掉
 * （那是会过期的旧形态，留着会让文件同时说两件事）。已经存在裸条目时保持它原来的位置，
 * 所以跑两遍结果一样。
 */
export function planSelfExemption(specs) {
  const kept = [];
  const removed = [];
  let bareSeen = false;
  for (const spec of Array.isArray(specs) ? specs : []) {
    if (packageNameOf(spec) === SELF_PACKAGE) {
      if (spec === SELF_PACKAGE && !bareSeen) {
        bareSeen = true;
        kept.push(spec);
      } else {
        removed.push(spec);
      }
      continue;
    }
    kept.push(spec);
  }
  const added = bareSeen ? [] : [SELF_PACKAGE];
  const next = bareSeen ? kept : [...kept, SELF_PACKAGE];
  const changed = next.length !== specs.length || next.some((value, index) => value !== specs[index]);
  return { specs: next, added, removed, changed };
}

/** 把行内 flow 写法（[a, b]）拆成条目，不引 YAML 依赖。 */
function inlineItems(value) {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner === '') return [];
  return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter((item) => item !== '');
}

/**
 * 把 workspace 清单的文本加上本插件那一行。纯函数：文本进、文本出。
 * 只重写 minimumReleaseAgeExclude 这一块；packages、nodeLinker、别的设置、别人的豁免、注释
 * 一律逐字节照抄 —— 本模块对它们没有任何权限。
 */
export function applySelfExemption(text) {
  const source = String(text ?? '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const trailing = source === '' || /\r?\n$/.test(source);
  const body = trailing ? source.replace(/\r?\n$/, '') : source;
  const lines = body === '' ? [] : body.split(/\r?\n/);

  const keyAt = lines.findIndex((line) => new RegExp('^' + RELEASE_AGE_KEY + '\\s*:').test(line));
  const current = [];
  let end = keyAt;

  if (keyAt !== -1) {
    const after = lines[keyAt].slice(lines[keyAt].indexOf(':') + 1).trim();
    if (after !== '') {
      current.push(...inlineItems(after));
    } else {
      for (let at = keyAt + 1; at < lines.length; at += 1) {
        const item = /^\s*-\s+(.*)$/.exec(lines[at]);
        if (item === null) break;
        current.push(item[1].trim().replace(/^['"]|['"]$/g, ''));
        end = at;
      }
    }
  }

  // 规则总是以一条裸条目结尾，块因此永不为空；已存在的块一律原地重写。
  const plan = planSelfExemption(current);
  const block = [RELEASE_AGE_KEY + ':', ...plan.specs.map((spec) => '  - ' + spec)];

  const next = keyAt === -1
    ? [...lines, ...(lines.length > 0 && lines[lines.length - 1].trim() !== '' ? [''] : []), ...block]
    : [...lines.slice(0, keyAt), ...block, ...lines.slice(end + 1)];

  const changed = next.length !== lines.length || next.some((line, index) => line !== lines[index]);
  const output = next.join(eol) + (trailing && next.length > 0 ? eol : '');
  return { text: changed ? output : source, changed, added: plan.added, removed: plan.removed, specs: plan.specs };
}

/** profile 目录对应的 workspace 清单路径。路径是推导出来的，不写死。 */
export function workspaceManifestPath(profileDir) {
  return path.join(profileDir, WORKSPACE_MANIFEST);
}

/**
 * 从本包自己的位置反推它装进了哪个 profile。
 * <profile>/node_modules/dsh-pighub 才算 profile；源码检出/链接开发树没有 profile 可修，
 * 如实回 not_installed_under_node_modules，不去猜 ~/.dsh/profiles/* 里的某一个（修错 profile 没人要求）。
 */
export function locateProfileDir(packageDir) {
  const parent = path.dirname(String(packageDir ?? ''));
  if (path.basename(parent) !== 'node_modules') {
    return { ok: false, reason: 'not_installed_under_node_modules', packageDir: String(packageDir ?? '') };
  }
  return { ok: true, dir: path.dirname(parent), packageDir: String(packageDir ?? '') };
}

/**
 * 落盘。每种结局都有回执，永不抛。
 * no_workspace_file 刻意不修：凭空创建 workspace 清单等于断言一个本插件没选过的布局。
 * DSH 建出来的 profile 一定有这个文件。
 */
export async function ensureSelfExemption({ profileDir, now = () => new Date().toISOString() } = {}) {
  const at = now();
  if (typeof profileDir !== 'string' || profileDir.trim() === '') {
    return { ok: false, reason: 'profile_dir_missing', at };
  }
  const file = workspaceManifestPath(profileDir);
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'no_workspace_file' : 'unreadable';
    return { ok: false, reason: code, path: file, at, detail: String(error?.message ?? error) };
  }

  const plan = applySelfExemption(source);
  if (!plan.changed) {
    return { ok: true, changed: false, path: file, specs: plan.specs, at };
  }

  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, plan.text, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* 清临时文件是尽力而为 */ }
    return { ok: false, reason: 'write_failed', path: file, at, detail: String(error?.message ?? error) };
  }

  return { ok: true, changed: true, path: file, specs: plan.specs, added: plan.added, removed: plan.removed, at };
}
