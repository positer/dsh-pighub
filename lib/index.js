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
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { readAssetManifest, assetPool, assetSummary, assetUrlOf, IMAGE_DIR, ASSET_ROUTE } from './assets.js';
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

import { startDesktopPet, stopDesktopPet, syncDesktopPet, desktopPetState } from './desktop-pet.js';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = '0.9.56';
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
    // 图鉴用：池子里**全部**猪猪（含未获取），只要 id/名字/贴图地址。
    // URL 必须与 pigs[].assetUrl 走同一套 cache-buster：图鉴也是贴图，素材被补全后
    // 不能让浏览器继续放旧图（2026-11-13 实测：这里硬拼路径，256 条图鉴 URL 一条都没有 ?v=）。
    pool: (manifest.pigs || []).map((pig) => ({
      id: pig.id,
      title: pig.title,
      url: assetUrlOf(pig),
    })),
    // sizeRatio：这只猪的视觉体量归一化系数（CSS px 宽度，中位数 96），三层共用。
    pigs: listPigs(state, prefs.sort).map((pig) => {
      const asset = (manifest.pigs || []).find((item) => item.id === pig.id);
      const ratio = (asset && Number.isFinite(asset.sizeRatio) ? asset.sizeRatio : DESKTOP_PET_SIZE) * PIG_SCALE;
      // aspect = 高/宽：桌宠落点要把"中心"换算成"左上角"，需要它。
      const dims = (asset && asset.size) || {};
      const aspect = dims.width > 0 && dims.height > 0 ? dims.height / dims.width : 1;
      return Object.assign({}, pig, { sizeRatio: Math.round(ratio * 100) / 100, aspect: Math.round(aspect * 1000) / 1000 });
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
    prefs,
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

export function apply(ctx, config) {
  const root = (config && typeof config.root === 'string' && config.root.trim()) || resolveRoot();

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

  /** 把当前 state 同步给原生窗口；没有桌面猪就停掉进程（不留在后台）。 */
  const syncNativePet = () => {
    if (!nativePetEnabled) return { ok: true, disabled: true };
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

  // 启动时先同步一次（重启宿主后桌宠应自己回来），卸载时优雅停掉。
  ctx.effect(() => {
    syncNativePet();
    return () => { stopDesktopPet('plugin_unloaded'); };
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
            const body = await readBody(req);
            const action = typeof body.action === 'string' ? body.action : 'state';

            if (action === 'state') { sendJson(res, 200, snapshot(root)); return; }

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
  /* 贴图路由：每张素材一条 exact 路由（/pighub/asset/<file>）。
   * 不用前缀路由，是因为这台宿主只证实了 exact 这一种 kind；素材数量在清单里是已知的，
   * 逐条注册既简单又不依赖未验证的能力。文件名先过白名单正则，再拼成包内路径。 */
  const assetTypes = { '.png': 'image/png', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  if (webServer) {
    // 路由按**全部**素材注册：incomplete 的猪只是不进抽池，已拥有它的用户还要能看到它。
    for (const pig of fullPool.images) {
      const fileName = String(pig.filename || '');
      if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) continue;
      const type = assetTypes[extname(fileName).toLowerCase()];
      if (!type) continue;
      ctx.effect(
        () =>
          webServer.register({
            kind: 'exact',
            path: ASSET_ROUTE + '/' + fileName,
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
                try { sendJson(res, 500, { ok: false, error: message }); } catch { /* done */ }
              }
            },
          }),
        'pighub-asset-' + fileName,
      );
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
}
