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
  readPrefs,
  writePrefs,
  localDate,
} from './store.js';

export const name = 'dsh-pighub';
export const inject = ['tools'];

const VERSION = '0.5.5';
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
    pigs: listPigs(state, prefs.sort),
    pets: state.pets.slice(),
    store: (state.store || []).slice(),
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
export function apply(ctx, config) {
  const root = (config && typeof config.root === 'string' && config.root.trim()) || resolveRoot();
  const log = { warn: (message) => { try { ctx.logger?.warn?.(message); } catch { /* 日志失败不影响功能 */ } } };
  const pool = assetPool(currentManifest());

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
              if (result.ok) writeState(root, state);
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
              if (!place(state, pigId, to)) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: 'unknown_pig' });
                return;
              }
              writeState(root, state);
              sendJson(res, 200, snapshot(root));
              return;
            }

            // 兼容旧动作：body.pet true/false ⇔ 放到桌宠 / 放回猪圈
            if (action === 'pet') {
              const pigId = String(body.pigId || '');
              const state = readState(root);
              if (!place(state, pigId, body.pet === false ? 'pen' : 'pet')) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: 'unknown_pig' });
                return;
              }
              writeState(root, state);
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
    for (const pig of pool.images) {
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
                  'cache-control': 'private, max-age=86400',
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
        execute: async () => {
          const state = readState(root);
          const today = localDate(new Date());
          const manifest = currentManifest();
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
            ui: { sidebarEntry: 'sidebar.panellist', panel: 'main', stateRoute: ROUTE, assetRoute: ASSET_ROUTE },
            dataPolicy: '素材在构建期处理好并随包分发；运行时不访问素材库、不做图像计算。',
          };
        },
      }),
    'pighub-about-tool',
  );
}
