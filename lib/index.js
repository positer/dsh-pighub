/**
 * dsh-pighub — 猪猪库 PigHub 的 DeepSeek Harness 插件（Host 半）。
 *
 * 这一半只做三件事：
 *   1. 数据落盘：用户数据全在 `/.PigHub（见 lib/store.js）；
 *   2. 每日一次抽取：规则在 store.draw()，这里只判断「今天抽过没有」并写盘；
 *   3. 静态贴图：GET /pighub/asset/<file> 直接从包内 assets/img 读文件。
 *
 * **运行时不访问素材库**：素材在构建期就处理好并随包分发（scripts/build-assets.mjs），
 * 浏览器拿到的只是本地文件，不跨域、不需算力、不依赖上游可用性。
 *
 * 服务依赖只声明 tools（工具表身份）；webServer 按需查找——写进 inject 会让没有 Web 的
 * profile 整个启动失败（dsh: 1 entry did not activate），一个只少了面板的插件不该有那个权力。
 */
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAutoUpdate, makeFileLogger } from './auto-update.js';
import { THEME_ROUTE, CLASSIC_THEME_NAME, listThemes, readThemeDir, themeAssetPath } from './themes.js';
import { readZip, isSafeZipName } from './zip.js';
import { validateThemePack } from './themes.js';
import { extname } from 'node:path';
import { readAssetManifest, assetPool, assetSummary, assetUrlOf, IMAGE_DIR, ASSET_ROUTE, PEN_ROUTE, PEN_ART } from './assets.js';
import {
  resolveRoot,
  readState,
  writeState,
  draw,
  listPigs,
  place,
  placeOf,
  penCount,
  setMotion,
  setPosition,
  readPrefs,
  writePrefs,
  localDate,
  PEN_CAP,
} from './store.js';

export const name = 'dsh-pighub';
export const inject = ['tools'];

import { startDesktopPet, stopDesktopPet, syncDesktopPet, desktopPetState, sayOnDesktop, reclaimStaleSessions } from './desktop-pet.js';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = '0.9.67';
/** 桌面桌宠的精灵边长（CSS px 基准，= manifest 里 sizeRatio 的中位数）。 */
const DESKTOP_PET_SIZE = 96;
/** 全局尺寸系数（用户口径 2026-11-13：「整体猪猪缩小到 75% 大小」）。三层一起乘。 */
const PIG_SCALE = 0.75;
const ROUTE = '/pighub';

/** 冻结库读一次缓存一分钟：它在包内不会变，但换版本/热重载时又能及时反映。 */
let manifestCache = null;
let manifestCacheAt = 0;
function currentManifest() {
  const now = Date.now();
  if (manifestCache && now - manifestCacheAt < 60000) return manifestCache;
  manifestCache = readAssetManifest();
  manifestCacheAt = now;
  return manifestCache;
}

/**
 * 取 webServer：先走 cordis 的服务查询（ctx.get 不会因未注入而抛错），失败再退到属性。
 * 两道都兜住，返回 null 才是「这台宿主没有 Web 服务」。
 */
function lookupWebServer(ctx) {
  try {
    if (typeof ctx.get === 'function') {
      const service = ctx.get('webServer');
      if (service && typeof service.register === 'function') return service;
    }
  } catch { /* 服务表不可查询时走下面的兜底 */ }
  try {
    const service = ctx.webServer;
    if (service && typeof service.register === 'function') return service;
  } catch { /* 未注入时读属性可能抛错，忽略 */ }
  return null;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

/**
 * 把 state 里的 pets 列表翻译成"原生窗口要画什么"：每只给精灵文件路径、屏幕坐标、尺寸、运动开关。
 * 位置优先用 pig.desktopPos（桌面像素），没有就按右下角铺开。
 */
export function desktopPetsOf(state, manifest) {
  const byId = new Map(((manifest && manifest.pigs) || []).map((pig) => [pig.id, pig]));
  const ids = state.pets || [];
  const out = [];
  ids.forEach((id, index) => {
    const record = state.pigs[id];
    const asset = byId.get(id);
    if (!record || !asset) return;
    const file = String(asset.file || '').split('/').pop();
    if (!file) return;
    const pos = record.desktopPos;
    out.push({
      id,
      path: join(here, '..', 'assets', 'img', file),
      x: pos && Number.isFinite(pos.x) ? pos.x : 960 + index * 48,
      y: pos && Number.isFinite(pos.y) ? pos.y : 640 + index * 48,
      // 尺寸以 **CSS px** 下发（= sizeRatio）；原生窗口自己按所在显示器的 DPI 换成物理像素。
      size: Math.round((Number(asset.sizeRatio) || DESKTOP_PET_SIZE) * PIG_SCALE),
      motion: record.motion !== false,
      // 星级胶囊：与面板共用 starDisplay 档位
      stars: Math.max(1, Math.floor(Number(record.stars) || 1)),
    });
  });
  return out;
}

/**
 * 把桌面上的落点（物理像素）换算成猪圈内的百分比坐标。
 * 用户口径 2026-11-13：「猪圈进出要保持连续」——拖回猪圈应该落在松手处，而不是回到原位。
 */
export function penPercentFromScreen(x, y, rect) {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pctX = ((x - rect.left) / rect.width) * 100;
  const pctY = ((y - rect.top) / rect.height) * 100;
  return { x: Math.min(90, Math.max(10, pctX)), y: Math.min(88, Math.max(16, pctY)) };
}

/** 面板每次交互都读一次最新状态：写盘是唯一的真相来源。形状即浏览器半的渲染契约。 */
function snapshot(root, { sort, note } = {}) {
  const state = readState(root);
  const prefs = Object.assign(readPrefs(root), sort ? { sort } : {});
  const today = localDate(new Date());
  const todayPig = state.todayPigId ? state.pigs[state.todayPigId] || null : null;
  const manifest = currentManifest();
  return {
    ok: true,
    version: VERSION,
    root,
    today: {
      date: today,
      drawn: state.lastDrawDate === today,
      pigId: state.lastDrawDate === today ? state.todayPigId : '',
      pig: state.lastDrawDate === today ? todayPig : null,
    },
    // 图鉴用：池子里**全部**猪猪（含未获取），只要 id/名字/贴图地址/描述。
    // URL 必须与 pigs[].assetUrl 走同一套 cache-buster：图鉴也是贴图，素材被补全后
    // 不能让浏览器继续放旧图（2026-11-13 实测：这里硬拼路径，256 条图鉴 URL 一条都没有 ?v=）。
    // note（逐图判定理由）自 2026-11-14 起一并下发：抽卡演出要在卡片上显示「名字 + 描述」，
    // 而这串字原本只活在 assets.js:55 的 assetPool() 里，浏览器半拿不到（实测 pigs/pool/today 三处字段表都没有它）。
    // **只加在快照出口**，不动 normaliseState 的落盘字段集合。
    pool: (manifest.pigs || []).map((pig) => ({
      id: pig.id,
      title: pig.title,
      url: assetUrlOf(pig),
      note: pig.note || '',
    })),
    // sizeRatio：这只猪的视觉体量归一化系数（CSS px 宽度，中位数 96），三层共用。
    pigs: listPigs(state, prefs.sort).map((pig) => {
      const asset = (manifest.pigs || []).find((item) => item.id === pig.id);
      const ratio = (asset && Number.isFinite(asset.sizeRatio) ? asset.sizeRatio : DESKTOP_PET_SIZE) * PIG_SCALE;
      // aspect = 高/宽：桌宠落点要把"中心"换算成"左上角"，需要它。
      const dims = (asset && asset.size) || {};
      const aspect = dims.width > 0 && dims.height > 0 ? dims.height / dims.width : 1;
      // note 同上：快照出口拼上去，落盘结构不变（listPigs 的 pig 记录里没有这个字段）。
      return Object.assign({}, pig, {
        sizeRatio: Math.round(ratio * 100) / 100,
        aspect: Math.round(aspect * 1000) / 1000,
        note: (asset && typeof asset.note === 'string' ? asset.note : ''),
      });
    }),
    pets: state.pets.slice(),
    store: (state.store || []).slice(),
    // 猪圈容量（面板据此提示「满了自动进仓库」），以及现在的占用数。
    penCap: PEN_CAP,
    penCount: penCount(state),
    // 原生桌宠是否在跑：浏览器半据此决定要不要再画一遍页面级浮层（避免一只猪两个身子）；
    // supported=false 时浏览器半要明确告诉用户"这台系统只能用页面内桌宠"。
    desktopPet: { ...desktopPetState(), supported: process.platform === 'win32', platform: process.platform },
    // 当前下发给原生窗口的猪圈屏幕矩形（物理像素）；null 表示浏览器半还没报过。
    penRect: penRectOnScreen,
    sort: prefs.sort,
    // prefs.theme 缺省即 classic（用户口径：现有外观是默认主题）
    prefs: Object.assign({}, prefs, { theme: prefs.theme || CLASSIC_THEME_NAME }),
    // 设置面板要的主题列表：内置 classic 永远第一，然后是 ~/.PigHub/themes 下的目录
    themes: listThemes(join(here, '..', 'assets', 'themes'), join(root, 'themes')),
    /* 当前生效的主题**完整定义**（几何 + 布景文件名）：客户端据此注入 CSS 变量与图片 URL。
     * 主题缺失/损坏时 readThemeDir 会逐字段回落 classic，所以这里拿到的一定是可用值。 */
    activeTheme: readThemeDir(
      join(root, 'themes', prefs.theme || CLASSIC_THEME_NAME),
      prefs.theme || CLASSIC_THEME_NAME,
    ),
    draws: state.draws,
    assets: assetSummary(manifest),
    note: note || '',
  };
}

/**
 * @param {any} ctx 宿主 Cordis 上下文
 * @param {any} [config] 补丁层配置：{ root?: string }（测试与多实例用）
 */
/**
 * 宿主能力探测：能不能在宿主进程里拿到 Electron 的 BrowserWindow。
 * 桌面级桌宠（在整个桌面上走，而不是只在 DSH 页面里）只有两条路：
 *   ① 宿主进程能开透明置顶窗口（Electron）；
 *   ② 另起一个原生窗口进程（NewMate 那种 WinForms）。
 * 这个函数只回答①——不探测就写，等于拿用户的机器去试错。
 */
let runtimeProbe = null;
/** 浏览器半实测的猪圈屏幕矩形（物理像素，拖回猪圈的判定区）。不是持久状态，重启后由面板重新上报。 */
let penRectOnScreen = null;
/** 浏览器半上报的 devicePixelRatio：原生窗口画的是物理像素（CSS px × dpr）。 */
let screenDpr = 1;
async function probeRuntime() {
  if (runtimeProbe) return runtimeProbe;
  const result = {
    electron: false,
    browserWindow: false,
    processType: (process && process.type) || 'node',
    platform: process.platform,
    keys: [],
    error: '',
  };
  try {
    const electron = await import('electron');
    const mod = electron && electron.default ? electron.default : electron;
    result.electron = !!mod;
    result.browserWindow = !!(mod && typeof mod.BrowserWindow === 'function');
    // 只回前 24 个键名：足以判断这是不是 Electron 主进程的那张表，又不会把一个大对象吐进工具结果。
    result.keys = mod && typeof mod === 'object' ? Object.keys(mod).slice(0, 24) : [];
  } catch (error) {
    result.error = String((error && error.message) || error);
  }
  runtimeProbe = result;
  return result;
}

/* ---------------------------------------------------------------- pig-say 气泡 */

/** 气泡文本上限（用户口径：最长 200 字，超出截断并提示）。 */
export const SAY_TEXT_LIMIT = 200;

/**
 * 按**码点**截断，不是按 UTF-16 长度：emoji 与生僻字是代理对，按 length 切会切出半个字符。
 * 非字符串一律当空串 —— 拒绝，而不是把 "[object Object]" 说给用户听。
 */
export function clampSayText(input, limit = SAY_TEXT_LIMIT) {
  const raw = typeof input === 'string' ? input : '';
  const chars = Array.from(raw.replace(/\s+$/, ''));
  const truncated = chars.length > limit;
  return { text: truncated ? chars.slice(0, limit).join('') : chars.join(''), truncated, length: chars.length };
}

/** 从桌面上那一批猪里随机挑一只（rng 可注入，测试用固定序列）。空列表返回空串。 */
export function pickSayPet(ids, random = Math.random) {
  const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : [];
  if (list.length === 0) return '';
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)));
  return list[index];
}

export function apply(ctx, config) {
  const root = (config && typeof config.root === 'string' && config.root.trim()) || resolveRoot();

  /* ---------------- 主题包（用户口径 2026-11-14） ---------------- */
  /** 包内主题目录（classic 在这里）与用户主题目录（~/.PigHub/themes）。 */
  const themeRoot = join(here, '..', 'assets', 'themes');
  const userThemesDir = join(root, 'themes');
  const themeMime = (file) => {
    const ext = extname(String(file || '')).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.svg') return 'image/svg+xml';
    return 'application/octet-stream';
  };
  /** 扫出「主题名 → 该主题目录下的图片文件名」，用于逐张注册 exact 路由。 */
  const themeFileNames = () => {
    const out = [];
    const push = (name, dir) => {
      const files = [];
      try {
        for (const file of readdirSync(dir)) {
          if (/\.(png|jpg|jpeg|webp|svg)$/i.test(file)) files.push(file);
        }
      } catch { /* 目录不存在就当没有图 */ }
      if (files.length) out.push({ name, files });
    };
    push(CLASSIC_THEME_NAME, join(themeRoot, CLASSIC_THEME_NAME));
    // classic 也可以直接引用包内 assets/img 里的布景图（现有那张 pen-fence.png 就在那）
    out.push({ name: CLASSIC_THEME_NAME, files: PEN_ART.slice() });
    try {
      for (const entry of readdirSync(userThemesDir)) {
        if (entry === CLASSIC_THEME_NAME) continue;
        push(entry, join(userThemesDir, entry));
      }
    } catch { /* 没有用户主题 */ }
    // 去重（同一主题同一文件只注册一次，否则 exact 路由会重复）
    const seen = new Set();
    return out
      .flatMap((group) => group.files.map((file) => ({ name: group.name, file })))
      .filter(({ name, file }) => {
        const key = name + '/' + file;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .reduce((acc, { name, file }) => {
        const hit = acc.find((g) => g.name === name);
        if (hit) hit.files.push(file); else acc.push({ name, files: [file] });
        return acc;
      }, []);
  };

  // 原生桌宠开关：config.desktopPet === false 时完全不碰原生进程（离线测试/不想要桌宠的 profile 用）。
  const nativePetEnabled = !(config && config.desktopPet === false);
  const log = { warn: (message) => { try { ctx.logger?.warn?.(message); } catch { /* 日志失败不影响功能 */ } } };
  // 标了 incomplete 的猪不进抽池（2026-11-13 口径：不完整的一律补全或剔除；保留可渲染是为了不删掉
  // 用户已拥有的猪，比如 974）。
  const fullPool = assetPool(currentManifest());
  const pool = (() => {
    const bad = new Set((currentManifest().pigs || []).filter((p) => p.incomplete === true).map((p) => p.id));
    if (bad.size === 0) return fullPool;
    return Object.assign({}, fullPool, { images: fullPool.images.filter((pig) => !bad.has(pig.id)) });
  })();

  /* ---------------- 原生桌面桌宠：同一 profile 一个实例 ---------------- */
  let lastPositionWrite = 0;
  /** 本次 apply 的 unload 旗子：置位后启动链/同步路径一律不再拉起进程（模块实例会跨 enable/disable 复用）。 */
  let stopped = false;

  /* ---------------- 静默自动更新（用户口径 2026-11-14：不通知、不提供开关） ----------------
   * 延迟 15s 跑一次（避开启动抢资源），每次 enable 只跑一次；失败静默，只写 ~/.PigHub/logs/auto-update.log。
   * 不自动重启宿主：装好之后，下次宿主启动/插件重载自然生效。 */
  const autoUpdateDelayMs = 15000;
  let autoUpdateTimer = null;
  const scheduleAutoUpdate = () => {
    // 没有 profile 目录就无从安装；离线测试里 profileDir 为空时这一步直接跳过（只记日志）。
    const profileDir = (() => {
      try {
        const candidate = typeof config?.profileDir === 'string' ? config.profileDir : '';
        if (candidate) return candidate;
        // 从插件自身路径反推：<profile>/node_modules/dsh-pighub/lib/index.js → <profile>
        return join(here, '..', '..', '..');
      } catch { return ''; }
    })();
    autoUpdateTimer = setTimeout(() => {
      autoUpdateTimer = null;
      if (stopped) return;
      Promise.resolve()
        .then(() => runAutoUpdate({
          currentVersion: VERSION,
          profileDir,
          writeLog: makeFileLogger(root),
        }))
        .catch(() => { /* runAutoUpdate 自己不会抛；这里再兜一层 */ });
    }, autoUpdateDelayMs);
    if (autoUpdateTimer && typeof autoUpdateTimer.unref === 'function') autoUpdateTimer.unref();
  };
  ctx.effect(() => {
    scheduleAutoUpdate();
    return () => {
      if (autoUpdateTimer) { clearTimeout(autoUpdateTimer); autoUpdateTimer = null; }
    };
  }, 'pighub-auto-update');

  /** 把当前 state 同步给原生窗口；没有桌面猪就停掉进程（不留在后台）。 */
  const syncNativePet = () => {
    if (!nativePetEnabled) return { ok: true, disabled: true };
    // 已经卸载：路由/工具都收了，这里再写一次 pets.json 或拉起进程都只会在关停后留残留。
    if (stopped) return { ok: true, disposed: true };
    try {
      const state = readState(root);
      const list = desktopPetsOf(state, currentManifest());
      if (penRectOnScreen && list.length) for (const pet of list) pet.pen = penRectOnScreen;
      // 胶囊档位随负载下发（off / hover / always），原生窗口据此决定画不画。
      // prefs 是独立文件（不是 state 的一部分），必须用 readPrefs 读。
      const starMode = (readPrefs(root).starDisplay) || 'hover';
      for (const pet of list) pet.starMode = starMode;
      if (list.length === 0) { stopDesktopPet('no_pets'); return { ok: true, stopped: true }; }
      const pending = startDesktopPet(list, {
        onPositions(rows) {
          // 位置回写：>=2px 变化且距上次写盘超过 1.5s 才写，避免每 350ms 一次磁盘写。
          const now = Date.now();
          if (now - lastPositionWrite < 1500) return;
          const state2 = readState(root);
          let dirty = false;
          for (const row of rows) {
            const pig = state2.pigs[row.id];
            if (!pig) continue;
            const prev = pig.desktopPos || {};
            if (Math.abs((prev.x || 0) - row.x) > 2 || Math.abs((prev.y || 0) - row.y) > 2) {
              pig.desktopPos = { x: row.x, y: row.y };
              dirty = true;
            }
          }
          if (dirty) { writeState(root, state2); lastPositionWrite = now; }
        },
        onCommand(command) {
          // 双击 = 回猪圈；右键 = 切换这只猪的运动开关（原生窗口没有菜单，用开关代替）。
          try {
            const state3 = readState(root);
            if (command.cmd === 'return' && state3.pigs[command.id]) {
              // 落点连续：把猪在桌面上的位置换算成猪圈内的百分比，写回后再放回猪圈。
              const spot = penPercentFromScreen(command.x, command.y, penRectOnScreen);
              if (spot) state3.pigs[command.id].pos = spot;
              place(state3, command.id, 'pen');
              writeState(root, state3);
              syncNativePet();
            } else if (command.cmd === 'menu' && state3.pigs[command.id]) {
              setMotion(state3, command.id, state3.pigs[command.id].motion === false);
              writeState(root, state3);
              syncNativePet();
            }
          } catch { /* 命令处理失败不该影响桌宠窗口 */ }
        },
      });
      // 编译/拉起是异步的：失败只记日志，绝不让它变成未处理的 rejection。
      if (pending && typeof pending.catch === 'function') pending.catch((error) => log.warn('pighub: 桌面桌宠启动失败 ' + String((error && error.message) || error)));
      return pending;
    } catch (error) {
      log.warn('pighub: 桌面桌宠同步失败 ' + String((error && error.message) || error));
      return { ok: false, error: String((error && error.message) || error) };
    }
  };

  /*
   * 桌宠的全部生命周期都挂在这一个 effect 上（2026-11-14 按 Cordis 契约重写）：
   *
   *   - 起：先 `reclaimStaleSessions()` 清掉上一次残留（宿主被强杀时 disposer 根本不会跑，
   *     原生进程会变孤儿），再同步一次当前桌面猪。effect 体是 async 的，Cordis 接受
   *     `Promise<Disposable>`，并且卸载时会等它 resolve 完才开始收 disposer。
   *   - 停：**返回 Promise 的 disposer**。Cordis 的 `fiber._unload()` 对每个 disposer 都是
   *     `await runDisposable(dispose)`，所以这里返回 Promise 才能让"进程真的死透了"发生在
   *     卸载完成之前；而不 await 的写法只是"发了一条停止请求就走"，宿主关停/重载会在桌宠
   *     还活着的时候结束。`stopDesktopPet` 自己保证 2 s 内一定 settle，不会反过来卡住宿主。
   */
  ctx.effect(() => {
    // 起：先清理上一次的残留（宿主被强杀时 disposer 根本不会跑），再同步当前桌面猪。
    // 这条启动链是异步的，但 effect 体保持同步返回 disposer —— 卸载时不依赖"启动完成"。
    const starting = (async () => {
      if (nativePetEnabled) {
        try {
          const swept = await reclaimStaleSessions();
          if (swept && Array.isArray(swept.reclaimed) && swept.reclaimed.length) {
            log.warn('pighub: 清理了上一次残留的桌宠会话 ' + swept.reclaimed.map((row) => row.pid).join(','));
          }
        } catch (error) {
          log.warn('pighub: 残留桌宠清理失败 ' + String((error && error.message) || error));
        }
      }
      if (!stopped) syncNativePet();
    })().catch((error) => log.warn('pighub: 桌宠启动链失败 ' + String((error && error.message) || error)));
    void starting;
    return () => {
      // 先立旗子：启动链里任何还没跑到的阶段都不许再拉起进程。
      stopped = true;
      return stopDesktopPet('plugin_unloaded');
    };
  }, 'pighub-desktop-pet');

  const webServer = lookupWebServer(ctx);
  if (!webServer) log.warn('pighub: 这台宿主没有 webServer，浏览器半的数据路由未注册（工具照常可用）');

  if (webServer) ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method === 'GET') { sendJson(res, 200, snapshot(root)); return; }
            if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method_not_allowed' }); return; }
            /* 状态路由的 body 上限提到 24 MB：主题包导入是 base64（738 KB 的 zip → 约 1 MB 的报文），
             * 默认 64 KB 会把它判成 body_too_large。这是个只监听回环的本地服务，放宽是安全的。 */
            const body = await readBody(req, 24 * 1024 * 1024);
            const action = typeof body.action === 'string' ? body.action : 'state';

            /* 主题包导入走**状态路由上的 action**（用户口径 2026-11-14）。
             * 为什么不另开 /pighub/theme-import：宿主的 exact 路由按前缀先命中，二进制 zip 会被
             * 这条状态路由抢走当 JSON 解析（实测报 "Unexpected token 'P'"，P 就是 zip 魔数 PK）。
             * base64 多 33% 传输，换来路由一定命中。 */
            if (action === 'theme-import') {
              const b64 = typeof body.zipBase64 === 'string' ? body.zipBase64 : '';
              if (!b64) { sendJson(res, 200, { ok: false, error: 'empty_body' }); return; }
              let raw = null;
              try { raw = Buffer.from(b64, 'base64'); } catch { raw = null; }
              if (!raw || !raw.length) { sendJson(res, 200, { ok: false, error: 'bad_base64' }); return; }
              const parsed = readZip(raw);
              if (!parsed.ok) { sendJson(res, 200, { ok: false, error: parsed.reason }); return; }
              const jsonEntry = parsed.files.find((file) => /(^|\/)theme\.json$/i.test(file.name));
              if (!jsonEntry) { sendJson(res, 200, { ok: false, error: 'theme_json_missing' }); return; }
              const prefix = jsonEntry.name.replace(/theme\.json$/i, '');
              let meta;
              try { meta = JSON.parse(jsonEntry.data.toString('utf8')); } catch { sendJson(res, 200, { ok: false, error: 'theme_json_invalid' }); return; }
              // 准入闸门（用户口径 2026-11-14：不合法主题要拒绝）：非法就明确拒绝，不许静默回落当成功
              const verdict = validateThemePack(meta, parsed.files, prefix);
              if (!verdict.ok) { sendJson(res, 200, { ok: false, error: verdict.reason }); return; }
              const themeName = verdict.name;
              const targetDir = join(userThemesDir, themeName);
              const staging = join(userThemesDir, '.' + themeName + '.tmp-' + Date.now());
              try {
                rmSync(staging, { recursive: true, force: true });
                mkdirSync(staging, { recursive: true });
                for (const file of parsed.files) {
                  const rel = file.name.startsWith(prefix) ? file.name.slice(prefix.length) : file.name;
                  if (!rel || rel.endsWith('/')) continue;
                  if (!/\.(json|png|jpg|jpeg|webp|svg)$/i.test(rel)) continue;
                  if (!isSafeZipName(rel)) { sendJson(res, 200, { ok: false, error: 'unsafe_entry_name', name: file.name }); return; }
                  const target = join(staging, rel);
                  mkdirSync(dirname(target), { recursive: true });
                  writeFileSync(target, file.data);
                }
                rmSync(targetDir, { recursive: true, force: true });
                renameSync(staging, targetDir);
              } catch (error) {
                try { rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
                sendJson(res, 200, { ok: false, error: 'write_failed', detail: String((error && error.message) || error).slice(0, 120) });
                return;
              }
              /* **动态注册**这个主题的图片路由（用户口径 2026-11-14：「栏杆不再消失」）：
               * 启动时只扫过一次目录，导入进来的主题如果没有自己的路由，它的围栏图就会 404，
               * 客户端只能回落到 classic 围栏。这里把刚写下去的每张图当场注册成 exact 路由。 */
              if (webServer) {
                for (const file2 of parsed.files) {
                  const rel2 = file2.name.startsWith(prefix) ? file2.name.slice(prefix.length) : file2.name;
                  if (!rel2 || rel2.endsWith('/')) continue;
                  if (!/\.(png|jpg|jpeg|webp|svg)$/i.test(rel2)) continue;
                  const routePath = THEME_ROUTE + '/' + themeName + '/' + rel2;
                  ctx.effect(
                    () =>
                      webServer.register({
                        kind: 'exact',
                        path: routePath,
                        handler: async (req, res) => {
                          try {
                            if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method_not_allowed' }); return; }
                            const abs = themeAssetPath({ name: themeName, file: rel2, builtinDir: join(themeRoot, CLASSIC_THEME_NAME), userThemesDir });
                            if (!abs) { sendJson(res, 404, { ok: false, error: 'theme_asset_not_found' }); return; }
                            const bin = readFileSync(abs);
                            res.writeHead(200, {
                              'content-type': themeMime(rel2),
                              'content-length': String(bin.length),
                              'cache-control': 'private, no-cache, must-revalidate',
                              'x-content-type-options': 'nosniff',
                            });
                            res.end(bin);
                          } catch (error) {
                            const message = error && error.message ? String(error.message) : 'internal_error';
                            try { sendJson(res, 500, { ok: false, error: message }); } catch { /* 已结束 */ }
                          }
                        },
                      }),
                    'pighub-theme-' + themeName + '-' + rel2,
                  );
                }
              }
              const nextPrefs2 = writePrefs(root, { theme: themeName });
              sendJson(res, 200, { ...snapshot(root), ok: true, theme: themeName, prefs: nextPrefs2 });
              return;
            }

            /* 删除主题（classic 不可删；删的是当前主题就回落 classic）。 */
            if (action === 'theme-delete') {
              const wanted = String(body.name || '').trim();
              if (!/^[a-zA-Z0-9._-]{1,48}$/.test(wanted)) { sendJson(res, 200, { ok: false, error: 'theme_name_invalid' }); return; }
              if (wanted === CLASSIC_THEME_NAME) { sendJson(res, 200, { ok: false, error: 'classic_is_builtin' }); return; }
              const dir = join(userThemesDir, wanted);
              if (!existsSync(dir)) { sendJson(res, 200, { ok: false, error: 'theme_not_found', name: wanted }); return; }
              try { rmSync(dir, { recursive: true, force: true }); } catch (error) {
                sendJson(res, 200, { ok: false, error: 'delete_failed', detail: String((error && error.message) || error).slice(0, 120) });
                return;
              }
              const wasActive = (readPrefs(root).theme || CLASSIC_THEME_NAME) === wanted;
              const nextPrefs3 = wasActive ? writePrefs(root, { theme: CLASSIC_THEME_NAME }) : readPrefs(root);
              sendJson(res, 200, { ...snapshot(root), ok: true, deleted: wanted, prefs: nextPrefs3 });
              return;
            }

            if (action === 'state') { sendJson(res, 200, snapshot(root)); return; }

            /*
             * 便宜的一问一答：只回一个「渲染相关的状态变了没有」的令牌，不回快照。
             *
             * 为什么需要它：原生桌宠是**另一个进程 + 宿主**在改状态（双击回圈 / 右键切运动 / 拖回猪圈），
             * 浏览器半只能靠轮询知道；原来只有 10 s 一轮的整张快照（38 KB、256 条图鉴），
             * 实测「猪已经被叫回猪圈、面板里却空着」的空窗 8.36 s
             *（archive/20261114-135230-pet-return-continuity，同一动作 5 次 gap 0.16–8.36 s）。
             * 令牌变了客户端才拉整张快照，于是 250 ms 一轮只花几十字节。
             *
             * 令牌只列**面板画得出差别**、且变化不频繁的字段：位置三态、运动开关、星级、桌宠名单、
             * 今日抽取、偏好、素材版本、原生桌宠在不在跑。
             * **位置(pos)故意不进令牌**：猪圈里每只猪每 ~1.7 s 就写一次 pos，进令牌等于让客户端
             * 每 1.7 s 拉一张 38 KB 的快照；位置仍由客户端自己写、并由 10 s 的整张快照兜底对齐。
             */
            /* 切换主题：只落 prefs，不碰 state；客户端下一次对账（rev 变化）就会重新取几何与图片。 */
            if (action === 'theme') {
              const wanted = String(body.name || '').trim();
              const known = listThemes(join(here, '..', 'assets', 'themes'), join(root, 'themes'))
                .some((item) => item.name === wanted);
              if (!known) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: 'unknown_theme', name: wanted });
                return;
              }
              const nextPrefs = writePrefs(root, { theme: wanted });
              sendJson(res, 200, { ...snapshot(root), ok: true, theme: wanted, prefs: nextPrefs });
              return;
            }

            if (action === 'rev') {
              const state = readState(root);
              const prefs = readPrefs(root);
              const pigs = Object.keys(state.pigs || {}).map((id) => {
                const pig = state.pigs[id] || {};
                return [id, placeOf(state, id), pig.motion === false ? '0' : '1', pig.stars || 1].join(':');
              }).join(',');
              const today = localDate(new Date());
              sendJson(res, 200, {
                ok: true,
                rev: [
                  state.lastDrawDate === today ? today + '#' + state.todayPigId : today + '-',
                  state.draws || 0,
                  (state.pets || []).slice().sort().join(','),
                  (state.store || []).slice().sort().join(','),
                  pigs,
                  prefs.sort || '',
                  prefs.starDisplay || '',
                  prefs.theme || CLASSIC_THEME_NAME,
                  currentManifest().assetVersion || '',
                  desktopPetState().running ? 'run' : 'idle',
                ].join('|'),
              });
              return;
            }

            if (action === 'draw') {
              if (pool.images.length === 0) { sendJson(res, 200, { ...snapshot(root), ok: false, error: 'asset_library_missing' }); return; }
              const state = readState(root);
              const result = draw(state, pool);
              if (result.ok) { writeState(root, state); syncNativePet(); }
              sendJson(res, 200, {
                ...snapshot(root),
                ok: true,
                draw: result.ok
                  ? { ok: true, pigId: result.pig.id, upgraded: result.upgraded, stars: result.stars, date: result.today.date }
                  : { ok: false, error: result.error, date: result.today.date },
              });
              return;
            }

            if (action === 'sort') { sendJson(res, 200, snapshot(root, { sort: writePrefs(root, { sort: body.sort }).sort })); return; }

            if (action === 'prefs') {
              // 只把**真的给了**的字段写进去：undefined 传下去会覆盖掉已有偏好。
              const patch = {};
              if (typeof body.sort === 'string') patch.sort = body.sort;
              if (typeof body.starDisplay === 'string') patch.starDisplay = body.starDisplay;
              const prefs = writePrefs(root, patch);
              sendJson(res, 200, snapshot(root, { sort: prefs.sort }));
              return;
            }

            if (action === 'place') {
              const pigId = String(body.pigId || '');
              const to = String(body.to || '');
              const state = readState(root);
              const moved = place(state, pigId, to);
              if (!moved.ok) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: moved.error || 'unknown_pig' });
                return;
              }
              writeState(root, state);
              await syncNativePet();
              sendJson(res, 200, { ...snapshot(root), placement: { pigId, to: moved.to, capped: moved.capped, cap: moved.cap } });
              return;
            }

            // 兼容旧动作：body.pet true/false ⇔ 放到桌宠 / 放回猪圈
            if (action === 'pet') {
              const pigId = String(body.pigId || '');
              const state = readState(root);
              const moved = place(state, pigId, body.pet === false ? 'pen' : 'pet');
              if (!moved.ok) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: moved.error || 'unknown_pig' });
                return;
              }
              writeState(root, state);
              await syncNativePet();
              sendJson(res, 200, { ...snapshot(root), placement: { pigId, to: moved.to, capped: moved.capped, cap: moved.cap } });
              return;
            }

            // 桌宠在桌面上的落点（物理像素）：拖出猪圈时上报，宿主写进 pig.desktopPos 再下发。
            if (action === 'desktopPos') {
              const pigId = String(body.pigId || '');
              const x = Number(body.x);
              const y = Number(body.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) { sendJson(res, 200, { ok: false, error: 'bad_position' }); return; }
              const state = readState(root);
              const pig = state.pigs[pigId];
              if (!pig) { sendJson(res, 200, { ok: false, error: 'unknown_pig' }); return; }
              pig.desktopPos = { x: Math.round(x), y: Math.round(y) };
              writeState(root, state);
              await syncNativePet();
              sendJson(res, 200, { ok: true, desktopPos: pig.desktopPos });
              return;
            }

            // 浏览器半实测的猪圈矩形（屏幕坐标）：原生桌宠据此判断"拖回猪圈"。
            if (action === 'penRect') {
              const rect = body.rect || {};
              const nums = ['left', 'top', 'width', 'height'].map((key) => Number(rect[key]));
              if (nums.some((v) => !Number.isFinite(v)) || nums[2] <= 0 || nums[3] <= 0) {
                sendJson(res, 200, { ok: false, error: 'bad_rect' });
                return;
              }
              penRectOnScreen = { left: nums[0], top: nums[1], width: nums[2], height: nums[3] };
              const dpr = Number(body.dpr);
              if (Number.isFinite(dpr) && dpr > 0) screenDpr = dpr;
              await syncNativePet();
              sendJson(res, 200, { ok: true, penRect: penRectOnScreen });
              return;
            }

            // 记住落脚点：桌面/猪圈拖动、以及自己走动后都会上报，进 state.json 的 pig.pos。
            if (action === 'position') {
              const pigId = String(body.pigId || '');
              const state = readState(root);
              const moved = setPosition(state, pigId, body.x, body.y);
              if (!moved.ok) { sendJson(res, 200, { ok: false, error: moved.error }); return; }
              // 写入时间戳：客户端据此判断快照里的位置是不是比它自己的写入更新（防「游走回退」）。
              const at = Number(body.at);
              state.pigs[pigId].posAt = Number.isFinite(at) && at > 0 ? at : Date.now();
              writeState(root, state);
              sendJson(res, 200, { ok: true, pos: moved.pos });
              return;
            }

            // 行为开关：允许运动 / 保持静止（body.motion 为 null 表示回到素材默认）。
            if (action === 'motion') {
              const pigId = String(body.pigId || '');
              const motion = body.motion === null || body.motion === undefined ? null : body.motion === true;
              const state = readState(root);
              const changed = setMotion(state, pigId, motion);
              if (!changed.ok) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: changed.error || 'unknown_pig' });
                return;
              }
              writeState(root, state);
              await syncNativePet();
              sendJson(res, 200, snapshot(root));
              return;
            }

            sendJson(res, 400, { ok: false, error: 'unknown_action' });
          } catch (error) {
            // 路由处理器里抛出会结束进程，所以这里必须兜住。
            const message = error && error.message ? String(error.message) : 'internal_error';
            try { sendJson(res, 500, { ok: false, error: message }); } catch { /* 响应已经结束 */ }
          }
        },
      }),
    'pighub-state-route',
  );

  /*
   * 贴图路由：GET /pighub/asset/<file>。
   *
   * 只从包内 assets/img 读，且**只接受文件名**（不允许任何路径分隔符或 ..），
   * 类型按扩展名白名单返回——这是静态文件服务，不是通用文件读取接口。
   */
  /* 静态图路由：每张图一条 exact 路由（素材 /pighub/asset/<file>、猪圈布景 /pighub/pen/<file>）。
   * 不用前缀路由，是因为这台宿主只证实了 exact 这一种 kind；图的数量在清单/常量里是已知的，
   * 逐条注册既简单又不依赖未验证的能力。文件名先过白名单正则，再拼成包内路径。 */
  const assetTypes = { '.png': 'image/png', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  /** 一条 exact 静态图路由。文件名不合法或扩展名不在白名单里就什么都不注册（与旧行为一致）。 */
  function registerStaticImage(routePrefix, fileName, effectName) {
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) return;
    const type = assetTypes[extname(fileName).toLowerCase()];
    if (!type) return;
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: routePrefix + '/' + fileName,
          handler: async (req, res) => {
            try {
              if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method_not_allowed' }); return; }
              const file = new URL(fileName, IMAGE_DIR);
              if (!existsSync(file)) { sendJson(res, 404, { ok: false, error: 'asset_not_found' }); return; }
              const body = readFileSync(file);
              res.writeHead(200, {
                'content-type': type,
                'content-length': String(body.length),
                // 素材会被补全/替换，max-age=86400 会让界面上一直显示旧图（用户 2026-11-13 报的
                // 「斗鸡眼猪还是只有头」就是缓存：磁盘上早就是完整猪了）。改成必须回源校验。
                'cache-control': 'private, no-cache, must-revalidate',
                'x-content-type-options': 'nosniff',
              });
              res.end(body);
            } catch (error) {
              const message = error && error.message ? String(error.message) : 'internal_error';
              try { sendJson(res, 500, { ok: false, error: message }); } catch { /* 响应已经结束 */ }
            }
          },
        }),
      effectName,
    );
  }
  /* ---------------- 主题包导入（zip） ----------------
   * 客户端把用户选中的 .zip 原样 POST 到这个 exact 路由（不走 JSON/base64，省一次 33% 膨胀）。
   * 校验顺序：大小上限 → zip 结构 → theme.json 存在且可解析 → 文件名白名单 → 原子落盘。
   * 任何一步失败都返回可读原因，并且**不动现有主题**。 */
  if (webServer) {
    const THEME_IMPORT_MAX = 12 * 1024 * 1024;
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: ROUTE + '/theme-import',
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method_not_allowed' }); return; }
              const body = await readBody(req, THEME_IMPORT_MAX);
              if (!body || !body.length) { sendJson(res, 200, { ok: false, error: 'empty_body' }); return; }
              const parsed = readZip(body);
              if (!parsed.ok) { sendJson(res, 200, { ok: false, error: parsed.reason }); return; }
              // theme.json 可能在根上，也可能在一个顶层目录里（Windows 的 Compress-Archive 会包一层）
              const jsonEntry = parsed.files.find((file) => /(^|\/)theme\.json$/i.test(file.name));
              if (!jsonEntry) { sendJson(res, 200, { ok: false, error: 'theme_json_missing' }); return; }
              const prefix = jsonEntry.name.replace(/theme\.json$/i, '');
              let raw;
              try { raw = JSON.parse(jsonEntry.data.toString('utf8')); } catch { sendJson(res, 200, { ok: false, error: 'theme_json_invalid' }); return; }
              const themeName = String(raw && raw.name ? raw.name : prefix.replace(/\/$/, '')).trim() || 'imported';
              if (!/^[a-zA-Z0-9._-]{1,48}$/.test(themeName) || themeName === CLASSIC_THEME_NAME) {
                sendJson(res, 200, { ok: false, error: 'theme_name_invalid', name: themeName });
                return;
              }
              // 只落这个主题目录里的文件，且文件名必须安全
              const targetDir = join(userThemesDir, themeName);
              const staging = join(userThemesDir, '.' + themeName + '.tmp-' + Date.now());
              try {
                rmSync(staging, { recursive: true, force: true });
                mkdirSync(staging, { recursive: true });
                for (const file of parsed.files) {
                  const rel = file.name.startsWith(prefix) ? file.name.slice(prefix.length) : file.name;
                  if (!rel || rel.endsWith('/')) continue;
                  if (!/\.(json|png|jpg|jpeg|webp|svg)$/i.test(rel)) continue;
                  if (!isSafeZipName(rel)) { sendJson(res, 200, { ok: false, error: 'unsafe_entry_name', name: file.name }); return; }
                  const target = join(staging, rel);
                  mkdirSync(dirname(target), { recursive: true });
                  writeFileSync(target, file.data);
                }
                rmSync(targetDir, { recursive: true, force: true });
                renameSync(staging, targetDir);
              } catch (error) {
                try { rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
                sendJson(res, 200, { ok: false, error: 'write_failed', detail: String((error && error.message) || error).slice(0, 120) });
                return;
              }
              // 成功后自动切到新主题（用户口径：成功后自动切换并立即可见）
              const nextPrefs = writePrefs(root, { theme: themeName });
              sendJson(res, 200, { ...snapshot(root), ok: true, theme: themeName, prefs: nextPrefs });
            } catch (error) {
              const message = error && error.message ? String(error.message) : 'internal_error';
              try { sendJson(res, 500, { ok: false, error: message }); } catch { /* 已结束 */ }
            }
          },
        }),
      'pighub-theme-import',
    );
  }

  if (webServer) {
    // 路由按**全部**素材注册：incomplete 的猪只是不进抽池，已拥有它的用户还要能看到它。
    for (const pig of fullPool.images) {
      const fileName = String(pig.filename || '');
      registerStaticImage(ASSET_ROUTE, fileName, 'pighub-asset-' + fileName);
    }
    // 猪圈布景（木栅栏）：不是素材库的一部分，单独一条前缀，别让「每只猪一条路由」的断言变味。
    for (const artFile of PEN_ART) registerStaticImage(PEN_ROUTE, artFile, 'pighub-pen-art-' + artFile);
    /* 主题包的图片：**逐张注册 exact 路由**（宿主只证实了 exact 这一种 kind）。
     * 主题目录在启动时扫一遍；运行中新丢进来的主题要重载插件才认得——这一点写进 README。 */
    for (const themeName of themeFileNames()) {
      for (const file of themeName.files) {
        const id = 'pighub-theme-' + themeName.name + '-' + file;
        ctx.effect(
          () =>
            webServer.register({
              kind: 'exact',
              path: THEME_ROUTE + '/' + themeName.name + '/' + file,
              handler: async (req, res) => {
                try {
                  if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method_not_allowed' }); return; }
                  const file2 = themeAssetPath({
                    name: themeName.name,
                    file,
                    builtinDir: join(themeRoot, CLASSIC_THEME_NAME),
                    userThemesDir,
                  });
                  if (!file2) { sendJson(res, 404, { ok: false, error: 'theme_asset_not_found' }); return; }
                  const body = readFileSync(file2);
                  res.writeHead(200, {
                    'content-type': themeMime(file),
                    'content-length': String(body.length),
                    'cache-control': 'private, no-cache, must-revalidate',
                    'x-content-type-options': 'nosniff',
                  });
                  res.end(body);
                } catch (error) {
                  const message = error && error.message ? String(error.message) : 'internal_error';
                  try { sendJson(res, 500, { ok: false, error: message }); } catch { /* 已结束 */ }
                }
              },
            }),
          id,
        );
      }
    }
  }
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'pighub_about',
        description:
          '读取 dsh-pighub 的自述：版本 / 数据目录 / 今日是否已抽 / 收藏数量 / 随包素材库版本；不联网、无副作用。 Read what dsh-pighub is: version, data root, today status, owned count and the bundled asset version. No network, no side effects.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        // ToolDefinition 显式声明返回值形状。
        // 背景：有人在 0.2.2-rc.x 上遇到过 "must declare output" 导致整行不激活；
        // 那条报错**未在本机宿主上复现**（宿主源码在 asar 里，无法 grep 核对），
        // 因此这里按「防御性声明」处理：老宿主会忽略 output，新宿主则满足要求。
        // schema 只描述形状，真正的结构在 execute 里组装。
        output: {
          schema: { type: 'object' },
          render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async () => {
          const state = readState(root);
          const today = localDate(new Date());
          const manifest = currentManifest();
          // 桌面级桌宠需要宿主能不能开原生窗口——这个字段就是那条能力的实测回执。
          const runtime = await probeRuntime();
          return {
            ok: true,
            plugin: name,
            version: VERSION,
            stage: 'ui',
            root,
            dataFiles: ['state.json', 'prefs.json'],
            today: { date: today, drawn: state.lastDrawDate === today, pigId: state.todayPigId || '' },
            owned: Object.keys(state.pigs).length,
            draws: state.draws,
            pets: state.pets.slice(),
            store: (state.store || []).slice(),
            assets: assetSummary(manifest),
            pool: pool.images.map((pig) => ({ id: pig.id, title: pig.title, kind: pig.kind, vector: pig.vector, url: pig.assetUrl })),
            runtime,
            ui: { sidebarEntry: 'sidebar.panellist', panel: 'main', stateRoute: ROUTE, assetRoute: ASSET_ROUTE },
            dataPolicy: '素材在构建期处理好并随包分发；运行时不访问素材库、不做图像计算。',
          };
        },
      }),
    'pighub-about-tool',
  );

  /* ------------------------------------------------------------------ pig-say 工具 */
  /*
   * 让桌面上的**一只**桌宠猪用气泡说一句话。三件事按顺序决定，每一步都能单独说清为什么：
   *   ① 选谁：只从 state.pets（= 桌面上那批）里随机挑；挑不出来就**拒绝**（no_desktop_pet），
   *      不是抛异常——这只是"现在没人能说话"，不是插件坏了；
   *   ② 说什么：按码点截到 200 字，截过就在返回值里写明（用户口径：超出截断并提示）；
   *   ③ 怎么送：写一行 {"type":"say",...} 进 commands.jsonl（既有 IPC，不新开文件），
   *      原生窗口下一帧读到就画，until 到点自己消失。
   */
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'pig-say',
        description:
          '让桌面上的一只桌宠猪猪用气泡说一句纯文本（最多 200 字，超出截断并提示；气泡约 6 秒后自动消失，并跟着猪走）。'
          + '当前没有桌宠猪猪时返回 { ok:false, error:"no_desktop_pet" } —— 这是拒绝，不是异常。 '
          + 'Make one of the desktop pigs say a plain-text line in a speech bubble: at most 200 characters '
          + '(truncated beyond that), shown for about 6 seconds, and it follows the pig. Answers '
          + '{ ok:false, error:"no_desktop_pet" } when no pig is on the desktop.',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: '猪猪要说的那句话：纯文本，最多 200 字（超出按字截断）。 Plain text, up to 200 characters.',
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
        // 与 pighub_about 同一套防御性声明：宿主强制要求 output.{schema,render}。
        output: {
          schema: { type: 'object' },
          render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (args) => {
          const said = clampSayText(args && args.text);
          if (!said.text) {
            return { ok: false, error: 'empty_text', message: 'text 不能为空：给猪猪一句话（纯文本，200 字以内）' };
          }
          const state = readState(root);
          if (state.pets.length === 0) {
            return { ok: false, error: 'no_desktop_pet', message: '当前没有桌宠猪猪，先把猪猪放到桌宠' };
          }
          const onDesktop = desktopPetsOf(state, currentManifest());
          if (onDesktop.length === 0) {
            return {
              ok: false,
              error: 'desktop_pet_no_asset',
              message: '桌宠列表里的猪在素材库里找不到贴图，先把别的猪放到桌宠',
            };
          }
          const pigId = pickSayPet(onDesktop.map((pet) => pet.id));
          // 原生窗口没在跑就先拉起来（首次要编译 csc + 起进程，可能 1–3 秒）；还是起不来就是拒绝。
          if (!desktopPetState().running) await syncNativePet();
          const bubble = sayOnDesktop(pigId, said.text);
          if (!bubble.ok) {
            const code = bubble.code === 'not_running' ? 'desktop_pet_unavailable' : bubble.code;
            const message = bubble.code === 'not_running'
              ? '没有正在运行的桌面桌宠窗口（原生桌宠启动失败），先把猪猪放到桌宠再试'
              : bubble.code === 'pet_not_on_desktop'
                ? '选中的那只猪刚刚离开了桌面，稍后再试'
                : '气泡命令写入失败：' + String(bubble.error || bubble.code || 'unknown');
            return { ok: false, error: code, message };
          }
          const answer = { ok: true, pigId, text: bubble.text, truncated: said.truncated };
          if (said.truncated) answer.note = '文本超过 ' + SAY_TEXT_LIMIT + ' 字，已截断为前 ' + SAY_TEXT_LIMIT + ' 字';
          return answer;
        },
      }),
    'pighub-say-tool',
  );
}

