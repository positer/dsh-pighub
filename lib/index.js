/**
 * dsh-pighub — 猪猪库 PigHub 的 DeepSeek Harness 插件（Host 半）。
 *
 * 这一半只做三件事：
 *
 *   1. **数据落盘**：所有属于这个用户的数据都在 `/.PigHub（见 lib/store.js）；
 *   2. **每日一次抽取**：规则在 store.draw()，这里只负责「今天抽过没有」与写盘；
 *   3. **给浏览器半一条窄 HTTP 面**：POST /pighub，动作白名单 state/draw/sort/pet/refresh。
 *
 * 它**不下载图片**：目录里只有 id/title/filename 与拼好的上游 URL，浏览器直接把
 * <img> 指向上游站点。这样插件本身不含任何上游素材，许可风险留在「访问」而非「再分发」。
 *
 * 资源注册一律包在 ctx.effect 里（工具、路由），热重载/卸载时靠它回收；路由处理器
 * 自己吞掉全部异常并回 500 —— 一个抛出的处理器不会变成失败的请求，它会结束 Host 进程。
 */
import { readAssetManifest, assetPool, assetSummary } from './assets.js';
import {
  resolveRoot,
  readState,
  writeState,
  draw,
  listPigs,
  readPrefs,
  writePrefs,
  readCatalog,
  writeCatalog,
  catalogIsStale,
  normaliseCatalog,
  mergeCatalogs,
  localDate,
  CATALOG_SOURCE,
} from './store.js';

/** 与 package.json 的 name 必须一致；test/smoke.mjs 断言两者相同。 */
export const name = 'dsh-pighub';

/**
 * 只声明 tools。
 *
 * webServer **不**声明，这是实测换来的决定：DSH 的 boot 在「某个 entry 停在等待服务」
 * 时是**硬失败**（dsh: 1 entry did not activate → 整个 profile 起不来）。而 `/pighub`
 * 这条路由只在带 Web 应用的环境里有意义；把 webServer 写进 inject，会让任何一个
 * 基于 base profile 的装配（例如只用 headless 的 profile）连启动都失败——一个只少了
 * 面板的插件不该有这个权力。所以这里按需查找、拿不到就只禁用路由，其余照常工作。
 */
export const inject = ['tools'];

const VERSION = '0.2.0';
const ROUTE = '/pighub';
const IMAGE_ROUTE = ROUTE + '/image';
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const IMAGE_TIMEOUT_MS = 15000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * 开源镜像：PigHub 的公开镜像仓库（BadFish-HSrui/PigHub-DB）。
 * 它没有 API，只有按文件名组织的图片目录，所以用 GitHub 的目录列表当索引；
 * 图片地址用 raw.githubusercontent.com（CDN，浏览器能直连）。
 * 主接口不可用时它就是兜底；主接口可用时它补上主接口还没收录的那几只。
 */
const MIRROR_DIR = 'https://api.github.com/repos/BadFish-HSrui/PigHub-DB/contents/data';

/**
 * 图片代理的白名单。**这是安全边界，不是便利**：没有它，这条路由就是一个
 * 可以替任何人去访问任意内网地址的开放代理（SSRF）。只放行素材来源主机。
 */
const IMAGE_HOSTS = new Set(['pighub.top', 'raw.githubusercontent.com', 'githubusercontent.com', 'gitee.com']);

/**
 * 目录的「取或拉」。
 *
 * 一次请求内只发一次网络请求：并发调用共享同一个 Promise（in-flight 去重），
 * 否则五只猪的面板会同时把上游打五次。失败时**不抛错**，退回旧缓存并带上原因，
 * 因为「上游暂时不可用」和「插件坏了」是两件事，面板要能分别显示。
 */
function createCatalogLoader(root, log) {
  let inflight = null;
  let lastError = '';

  async function fetchJson(url, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: headers || { accept: 'application/json' } });
      if (!response.ok) throw new Error('http_' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchPrimary() {
    const payload = await fetchJson(CATALOG_SOURCE);
    const catalog = normaliseCatalog(payload);
    if (catalog.count === 0) throw new Error('upstream_empty');
    return Object.assign({ id: 'pighub' }, catalog);
  }

  /** GitHub 目录列表 → 与主接口同形的条目：标题取文件名去扩展名，图片走 raw CDN。 */
  async function fetchMirror() {
    const listing = await fetchJson(MIRROR_DIR, { accept: 'application/vnd.github+json', 'user-agent': 'dsh-pighub' });
    if (!Array.isArray(listing)) throw new Error('mirror_bad_shape');
    const images = [];
    for (const entry of listing) {
      if (!entry || entry.type !== 'file' || typeof entry.name !== 'string') continue;
      if (!/\.(jpe?g|png|gif|webp)$/i.test(entry.name)) continue;
      images.push({
        id: 'db:' + entry.name,
        title: entry.name.replace(/\.[^.]+$/, ''),
        filename: entry.name,
        imageUrl: entry.download_url || 'https://raw.githubusercontent.com/BadFish-HSrui/PigHub-DB/master/data/' + encodeURIComponent(entry.name),
      });
    }
    if (images.length === 0) throw new Error('mirror_empty');
    return { id: 'pighub-db', images };
  }

  /**
   * 实时同步：主接口与开源镜像**并行**取，任一失败都只是少一个来源，不整体失败。
   * 合并顺序 = 优先级：主接口在前（有标题与站内数据），镜像在后（补缺、兜底）。
   */
  async function fetchUpstream() {
    const [primary, mirror] = await Promise.allSettled([fetchPrimary(), fetchMirror()]);
    const parts = [];
    if (primary.status === 'fulfilled') parts.push(primary.value);
    else parts.push({ id: 'pighub', images: [], error: String(primary.reason && primary.reason.message || primary.reason) });
    if (mirror.status === 'fulfilled') parts.push(mirror.value);
    else parts.push({ id: 'pighub-db', images: [], error: String(mirror.reason && mirror.reason.message || mirror.reason) });

    const catalog = mergeCatalogs(parts);
    if (catalog.count === 0) {
      lastError = parts.map((p) => p.id + ':' + (p.error || 'empty')).join(' ');
      throw new Error('catalog_unavailable');
    }
    // 部分成功也记一条告警：面板要能说清「这只猪来自哪个来源、哪个来源现在不可用」。
    lastError = parts.filter((p) => p.error).map((p) => p.id + ':' + p.error).join(' ');
    writeCatalog(root, catalog);
    return catalog;
  }

  return {
    /** 读缓存；过期或缺失才拉。force 用于面板上的「刷新目录」。 */
    async ensure({ force = false } = {}) {
      const cached = readCatalog(root);
      if (!force && cached && !catalogIsStale(cached, Date.now(), CATALOG_TTL_MS)) return { catalog: cached, error: '' };
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const catalog = await fetchUpstream();
          return { catalog, error: '' };
        } catch (error) {
          lastError = error && error.message ? String(error.message) : 'catalog_unavailable';
          log.warn('pighub catalog fetch failed: ' + lastError);
          return { catalog: cached, error: lastError };
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    lastError: () => lastError,
  };
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

/**
 * 冻结库读一次就缓存一分钟：它在包内不会变，但改版本/热重载时又能及时反映。
 * 这样 snapshot() 不必依赖 apply 作用域里的局部变量。
 */
let manifestCache = null;
let manifestCacheAt = 0;
function currentManifest() {
  const now = Date.now();
  if (manifestCache && now - manifestCacheAt < 60000) return manifestCache;
  manifestCache = readAssetManifest();
  manifestCacheAt = now;
  return manifestCache;
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
 * 面板每次交互都读一次最新状态：不缓存「拥有什么」，因为写盘是唯一的真相来源。
 * 快照的形状就是浏览器半的渲染契约，字段名两边一致（见 lib/client.js）。
 */
function snapshot(root, { sort, catalogInfo, note } = {}) {
  const state = readState(root);
  // 偏好从盘上读全量，调用方若显式给了排序就覆盖排序——不能因为「只想改排序」
  // 就把其他偏好（星级显示）从快照里丢掉。
  const prefs = Object.assign(readPrefs(root), sort ? { sort } : {});
  const today = localDate(new Date());
  const catalog = catalogInfo && catalogInfo.catalog ? catalogInfo.catalog : readCatalog(root);
  const todayPig = state.todayPigId ? state.pigs[state.todayPigId] || null : null;
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
    sort: prefs.sort,
    prefs,
    draws: state.draws,
    assets: assetSummary(currentManifest()),
    catalog: catalog
      ? {
          count: catalog.count,
          fetchedAt: catalog.fetchedAt,
          source: catalog.source || CATALOG_SOURCE,
          sources: Array.isArray(catalog.sources) ? catalog.sources : [],
          stale: catalogIsStale(catalog, Date.now(), CATALOG_TTL_MS),
          error: (catalogInfo && catalogInfo.error) || '',
        }
      : { count: 0, fetchedAt: '', source: CATALOG_SOURCE, sources: [], stale: true, error: (catalogInfo && catalogInfo.error) || 'catalog_missing' },
    note: note || '',
  };
}

/**
 * @param {any} ctx 宿主 Cordis 上下文：需要 ctx.tools.register、ctx.webServer.register、ctx.effect
 * @param {any} [config] 补丁层里的 config：{ root?: string }（测试与多实例用得上）
 */
export function apply(ctx, config) {
  const root = (config && typeof config.root === 'string' && config.root.trim()) || resolveRoot();
  const log = { warn: (m) => { try { ctx.logger?.warn?.(m); } catch { /* 日志失败不影响功能 */ } } };
  const catalogLoader = createCatalogLoader(root, log);
  /*
   * 抽猪池 = **冻结素材库**（assets/manifest.json），不是实时目录。
   * 实时目录只作为「下一版候选池」出现在设置面板里。
   * 清单缺失时不阻断插件启动：抽猪会明确报 asset_library_missing。
   */
  const manifest = currentManifest();
  const pool = assetPool(manifest);

  // 启动就预热一次缓存：面板打开时通常已经有目录可抽，首次使用不必等网络。
  void catalogLoader.ensure().catch(() => {});

  const webServer = lookupWebServer(ctx);
  if (!webServer) {
    log.warn('pighub: 这台宿主没有 webServer，浏览器半的数据路由未注册（工具照常可用）');
  }

  if (webServer) ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method === 'GET') {
              const info = await catalogLoader.ensure();
              sendJson(res, 200, snapshot(root, { catalogInfo: info }));
              return;
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
              return;
            }
            const body = await readBody(req);
            const action = typeof body.action === 'string' ? body.action : 'state';

            if (action === 'state') {
              const info = await catalogLoader.ensure();
              sendJson(res, 200, snapshot(root, { catalogInfo: info }));
              return;
            }

            if (action === 'draw') {
              if (pool.images.length === 0) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: 'asset_library_missing' });
                return;
              }
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

            if (action === 'sort') {
              const prefs = writePrefs(root, { sort: body.sort });
              sendJson(res, 200, snapshot(root, { sort: prefs.sort }));
              return;
            }

            if (action === 'pet') {
              const pigId = String(body.pigId || '');
              const state = readState(root);
              if (!pigId || !state.pigs[pigId]) {
                sendJson(res, 200, { ...snapshot(root), ok: false, error: 'unknown_pig' });
                return;
              }
              const wanted = body.pet !== false;
              const set = new Set(state.pets);
              if (wanted) set.add(pigId);
              else set.delete(pigId);
              state.pets = [...set];
              writeState(root, state);
              sendJson(res, 200, snapshot(root));
              return;
            }

            if (action === 'prefs') {
              // 只把**真的给了**的字段写进去：undefined 传下去会覆盖掉已有偏好。
              const patch = {};
              if (typeof body.sort === 'string') patch.sort = body.sort;
              if (typeof body.starDisplay === 'string') patch.starDisplay = body.starDisplay;
              const prefs = writePrefs(root, patch);
              sendJson(res, 200, snapshot(root, { sort: prefs.sort }));
              return;
            }

            if (action === 'refresh') {
              const info = await catalogLoader.ensure({ force: true });
              sendJson(res, 200, snapshot(root, { catalogInfo: info }));
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
   * 图片代理：GET /pighub/image?src=<上游图片地址>。
   *
   * 为什么需要它：上游图片**不带 CORS 头**（实测：无 Access-Control-Allow-Origin），
   * 所以浏览器一旦读取像素就会把 canvas 标成 tainted，去白底就无从谈起。
   * 走同源代理后，canvas 是干净的，前端才能真的把白底抠成透明。
   *
   * 三条纪律：
   *   1. 白名单主机（IMAGE_HOSTS）——否则这就是个 SSRF 跳板；
   *   2. 不落盘——只是把字节转给同一个用户的浏览器，不构成再分发；
   *   3. 限大小 + 超时——一个坏上游不该拖住整个面板。
   */
  if (webServer) ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: IMAGE_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method_not_allowed' }); return; }
            const source = new URL(String(req.url || ''), 'http://pighub.invalid').searchParams.get('src') || '';
            let target;
            try { target = new URL(source); } catch { sendJson(res, 400, { ok: false, error: 'bad_src' }); return; }
            if (target.protocol !== 'https:') { sendJson(res, 400, { ok: false, error: 'https_only' }); return; }
            if (!IMAGE_HOSTS.has(target.hostname)) { sendJson(res, 403, { ok: false, error: 'host_not_allowed', host: target.hostname }); return; }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
            try {
              const upstream = await fetch(target.href, { signal: controller.signal, headers: { accept: 'image/*' } });
              if (!upstream.ok) { sendJson(res, 502, { ok: false, error: 'upstream_http_' + upstream.status }); return; }
              const declared = Number(upstream.headers.get('content-length') || 0);
              if (declared > MAX_IMAGE_BYTES) { sendJson(res, 413, { ok: false, error: 'too_large' }); return; }
              const chunks = [];
              let size = 0;
              for await (const chunk of upstream.body) {
                size += chunk.length;
                if (size > MAX_IMAGE_BYTES) { sendJson(res, 413, { ok: false, error: 'too_large' }); return; }
                chunks.push(chunk);
              }
              const type = upstream.headers.get('content-type') || 'application/octet-stream';
              if (!/^image\//i.test(type)) { sendJson(res, 415, { ok: false, error: 'not_an_image', type }); return; }
              res.writeHead(200, {
                'content-type': type,
                'content-length': String(size),
                'cache-control': 'private, max-age=86400',
                'x-content-type-options': 'nosniff',
              });
              res.end(Buffer.concat(chunks));
            } finally {
              clearTimeout(timer);
            }
          } catch (error) {
            const message = error && error.message ? String(error.message) : 'internal_error';
            try { sendJson(res, 500, { ok: false, error: message }); } catch { /* 响应已结束 */ }
          }
        },
      }),
    'pighub-image-route',
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'pighub_about',
        description:
          '读取 dsh-pighub 的自述：版本 / 数据目录 / 今日是否已抽 / 收藏数量 / 目录缓存状态；不联网拉图片、无副作用。 Read what dsh-pighub is: version, data root, whether today is drawn, how many pigs are owned, and the catalog cache state.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          const state = readState(root);
          const catalog = readCatalog(root);
          const today = localDate(new Date());
          return {
            ok: true,
            plugin: name,
            version: VERSION,
            stage: 'ui',
            root,
            dataFiles: ['state.json', 'catalog.json', 'prefs.json'],
            today: { date: today, drawn: state.lastDrawDate === today, pigId: state.todayPigId || '' },
            owned: Object.keys(state.pigs).length,
            draws: state.draws,
            pets: state.pets.slice(),
            assets: assetSummary(currentManifest()),
            pool: pool.images.map((pig) => ({ id: pig.id, title: pig.title, kind: pig.kind })),
            catalog: catalog ? { count: catalog.count, fetchedAt: catalog.fetchedAt, source: catalog.source } : null,
            ui: { sidebarEntry: 'sidebar.panellist', panel: 'main', route: ROUTE },
            dataPolicy: '索引仅缓存元数据（id/title/filename），图片由浏览器直接向上游取，不在本包内、不再分发。',
          };
        },
      }),
    'pighub-about-tool',
  );
}
