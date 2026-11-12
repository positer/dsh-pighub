/**
 * ~/.PigHub 的存储层：**只管本地的、属于这个用户的数据**，不碰网络。
 *
 * 目录布局（一个文件一种职责，便于单独核对与手改）：
 *
 *   ~/.PigHub/
 *   ├── state.json     ← 用户拥有什么：猪猪清单、星级、时间、每日抽取记录、桌宠
 *   ├── catalog.json   ← 上游目录的本地缓存（PigHub 公开接口快照），按 TTL 刷新
 *   └── prefs.json     ← 界面偏好（排序方式），与「拥有什么」分开，坏了不影响数据
 *
 * 为什么目录缓存也放进 ~/.PigHub：需求要求数据统一记录在 ~/.PigHub，而每日抽取
 * 必须有一份可复现的候选清单——否则同一天两次启动可能抽到不同池子。
 *
 * 写盘一律走 `writeAtomic`：先写同目录临时文件再 rename，避免进程被杀时留下半截
 * JSON（半个文件比没有文件更难恢复：JSON.parse 会失败，而人看到的是「文件还在」）。
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** 数据根目录名。需求写的是 `user/.PigHub`，即用户主目录下的隐藏目录。 */
export const ROOT_DIR_NAME = '.PigHub';
export const STATE_FILE = 'state.json';
export const PREFS_FILE = 'prefs.json';
export const STATE_VERSION = 1;

/** 上游目录来源（只读公开接口，见 PigHub 项目的 probe.ps1）。 */

/** 稀有度：上游 PigHub 没有稀有度数据，故全部同档。字段保留是为了将来有数据时不用迁移。 */
export const RARITY_DEFAULT = 'common';
export const RARITY_LABEL = Object.freeze({ common: '普通' });

/**
 * 解析数据根目录。环境变量 `PIGHUB_HOME` 优先——测试靠它把数据写到临时目录，
 * 而不是写进真实用户的 ~/.PigHub。
 */
export function resolveRoot(env = process.env) {
  const override = env && typeof env.PIGHUB_HOME === 'string' && env.PIGHUB_HOME.trim();
  return override ? override.trim() : join(homedir(), ROOT_DIR_NAME);
}

/** 本地时区的 YYYY-MM-DD。每日一次按**用户本地日**判定，不按 UTC（否则 08:00 前算前一天）。 */
export function localDate(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function emptyState() {
  return {
    version: STATE_VERSION,
    lastDrawDate: '',
    todayPigId: '',
    draws: 0,
    pigs: {},
    pets: [],
    store: [],
    createdAt: '',
    updatedAt: '',
  };
}

function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

function readJson(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) return null;
  return JSON.parse(text);
}

/**
 * 读 state。**坏文件不抛错，退回空状态并把原文改名为 .corrupt-<ts>**：
 * 一个解析失败的状态文件不该让整个面板打不开，也不该被静默覆盖掉。
 */
export function readState(root) {
  const file = join(root, STATE_FILE);
  try {
    const raw = readJson(file);
    if (!raw || typeof raw !== 'object') return withTimestamps(emptyState());
    return withTimestamps(normaliseState(raw));
  } catch (error) {
    try {
      if (existsSync(file)) renameSync(file, file + '.corrupt-' + Date.now());
    } catch { /* 改名失败也不影响继续用空状态 */ }
    const state = withTimestamps(emptyState());
    state.note = error && error.message ? String(error.message) : 'state_unreadable';
    return state;
  }
}

function withTimestamps(state) {
  if (!state.createdAt) state.createdAt = new Date().toISOString();
  return state;
}

function normaliseState(raw) {
  const state = emptyState();
  state.version = Number(raw.version) || STATE_VERSION;
  state.lastDrawDate = typeof raw.lastDrawDate === 'string' ? raw.lastDrawDate : '';
  state.todayPigId = typeof raw.todayPigId === 'string' ? raw.todayPigId : '';
  state.draws = Number.isFinite(raw.draws) ? raw.draws : 0;
  state.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : '';
  state.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : '';
  state.pets = Array.isArray(raw.pets) ? raw.pets.filter((x) => typeof x === 'string') : [];
  state.store = Array.isArray(raw.store) ? raw.store.filter((x) => typeof x === 'string') : [];
  const pigs = raw.pigs && typeof raw.pigs === 'object' ? raw.pigs : {};
  for (const [id, value] of Object.entries(pigs)) {
    if (!value || typeof value !== 'object') continue;
    state.pigs[id] = {
      id: String(value.id || id),
      title: typeof value.title === 'string' ? value.title : '',
      filename: typeof value.filename === 'string' ? value.filename : '',
      imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : '',
      rarity: typeof value.rarity === 'string' && value.rarity ? value.rarity : RARITY_DEFAULT,
      kind: value.kind === 'dead' ? 'dead' : 'live',
      vector: value.vector === true,
      assetUrl: typeof value.assetUrl === 'string' ? value.assetUrl : '',
      stars: Math.max(1, Math.floor(Number(value.stars) || 1)),
      firstObtainedAt: typeof value.firstObtainedAt === 'string' ? value.firstObtainedAt : '',
      lastUpgradedAt: typeof value.lastUpgradedAt === 'string' ? value.lastUpgradedAt : '',
      drawDates: Array.isArray(value.drawDates) ? value.drawDates.filter((x) => typeof x === 'string') : [],
    };
  }
  return state;
}

export function writeState(root, state) {
  state.updatedAt = new Date().toISOString();
  writeAtomic(join(root, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  return state;
}

/* -------------------------------------------------------------- draw & sort */

/**
 * 抽一只。规则全在这一个函数里，因此可以脱离网络与 HTTP 单独验证：
 *
 *   - 一天一次：lastDrawDate === today 就拒绝，并回传今天已抽到的那只；
 *   - 随机：默认在整份目录上等概率（rng 可注入，测试用固定序列）；
 *   - 重复即升星：同一只猪再抽到 → stars + 1，lastUpgradedAt 更新；
 *     首次获得的 firstObtainedAt **永不改写**（需求明确要求分开记这两个时间）。
 *
 * 返回 { ok, error?, pig?, upgraded?, stars?, today }。不写盘，写盘由调用方决定。
 */
export function draw(state, catalog, { now = new Date(), rng = Math.random } = {}) {
  const today = localDate(now);
  const iso = new Date(now).toISOString();
  if (state.lastDrawDate === today) {
    return { ok: false, error: 'already_drawn', today: { date: today, pigId: state.todayPigId || '' } };
  }
  const images = catalog && Array.isArray(catalog.images) ? catalog.images : [];
  if (images.length === 0) return { ok: false, error: 'catalog_empty', today: { date: today, pigId: '' } };

  const index = Math.min(images.length - 1, Math.max(0, Math.floor(rng() * images.length)));
  const image = images[index];
  const existing = state.pigs[image.id];
  let record;
  let upgraded = false;

  if (existing) {
    upgraded = true;
    record = {
      ...existing,
      title: image.title || existing.title,
      filename: image.filename || existing.filename,
      imageUrl: image.imageUrl,
      stars: Math.max(1, Math.floor(existing.stars || 1)) + 1,
      lastUpgradedAt: iso,
      drawDates: [...(existing.drawDates || []), today].slice(-200),
    };
  } else {
    record = {
      id: image.id,
      title: image.title,
      filename: image.filename,
      imageUrl: image.imageUrl,
      // 行为类型跟着素材走：冻结库里判定为 dead 的猪永远不动。贴图是包内文件，不再做任何处理。
      kind: image.kind === 'dead' ? 'dead' : 'live',
      vector: image.vector === true,
      assetUrl: image.assetUrl || image.imageUrl || '',
      rarity: RARITY_DEFAULT,
      stars: 1,
      firstObtainedAt: iso,
      lastUpgradedAt: iso,
      drawDates: [today],
    };
  }

  state.pigs[image.id] = record;
  state.lastDrawDate = today;
  state.todayPigId = image.id;
  state.draws = (Number(state.draws) || 0) + 1;
  return { ok: true, pig: record, upgraded, stars: record.stars, today: { date: today, pigId: image.id } };
}

export const SORTS = Object.freeze(['time', 'stars', 'rarity']);

/**
 * 星级标签的显示方式（设置项）。三种取值：
 *   off     —— 完全不显示；
 *   hover   —— 鼠标划过那只猪才显示，5 秒后自己消失（默认）；
 *   always  —— 常驻在猪的上方。
 * 存在 `/.PigHub/prefs.json，与「拥有什么」分开：偏好坏了不该影响数据。
 */
export const STAR_DISPLAY = Object.freeze(['off', 'hover', 'always']);
export const STAR_DISPLAY_DEFAULT = 'hover';

/**
 * 列出拥有的猪猪。三种排序都**稳定可复现**：主键相同时一律退到 firstObtainedAt 倒序，
 * 所以同样的数据每次得到的顺序完全一致（面板不会因为排序抖动而跳）。
 */
export const PLACES = Object.freeze(['pen', 'pet', 'store']);

/**
 * 一只猪现在在哪：库存 → 桌宠 → 猪圈。库存优先——「收起来」是明确的用户动作，
 * 不该因为在宠物列表里残留而被拉回桌面。
 */
export function placeOf(state, pigId) {
  if ((state.store || []).indexOf(pigId) >= 0) return 'store';
  if ((state.pets || []).indexOf(pigId) >= 0) return 'pet';
  return 'pen';
}

/**
 * 把一只猪放到某个位置：三个列表互斥，写一个就清掉另外两个。
 * 返回 false 表示这只猪不属于用户（调用方据此回 unknown_pig）。
 */
export function place(state, pigId, to) {
  if (!pigId || !state.pigs[pigId]) return false;
  if (PLACES.indexOf(to) < 0) return false;
  state.pets = (state.pets || []).filter((id) => id !== pigId);
  state.store = (state.store || []).filter((id) => id !== pigId);
  if (to === 'pet') state.pets.push(pigId);
  if (to === 'store') state.store.push(pigId);
  return true;
}

export function listPigs(state, sort = 'time') {
  const rows = Object.values(state.pigs || {}).map((pig) => ({
    place: placeOf(state, pig.id),
    ...pig,
    rarityLabel: RARITY_LABEL[pig.rarity] || pig.rarity,
    drawCount: Array.isArray(pig.drawDates) ? pig.drawDates.length : 0,
  }));
  const byFirst = (a, b) => String(b.firstObtainedAt).localeCompare(String(a.firstObtainedAt)) || String(b.id).localeCompare(String(a.id));
  const chosen = SORTS.includes(sort) ? sort : 'time';
  if (chosen === 'stars') rows.sort((a, b) => (b.stars - a.stars) || byFirst(a, b));
  else if (chosen === 'rarity') rows.sort((a, b) => String(a.rarity).localeCompare(String(b.rarity)) || (b.stars - a.stars) || byFirst(a, b));
  else rows.sort(byFirst);
  return rows;
}

/* -------------------------------------------------------------------- prefs */

function normalisePrefs(raw) {
  const sort = raw && SORTS.includes(raw.sort) ? raw.sort : 'time';
  const starDisplay = raw && STAR_DISPLAY.includes(raw.starDisplay) ? raw.starDisplay : STAR_DISPLAY_DEFAULT;
  return { sort, starDisplay };
}

export function readPrefs(root) {
  try {
    return normalisePrefs(readJson(join(root, PREFS_FILE)));
  } catch {
    return normalisePrefs(null);
  }
}

export function writePrefs(root, prefs) {
  const patch = {};
  for (const [key, value] of Object.entries(prefs || {})) {
    if (value !== undefined) patch[key] = value;   // 显式 undefined 不是「清空」，是「没给」
  }
  const next = normalisePrefs(Object.assign({}, readPrefs(root), patch));
  writeAtomic(join(root, PREFS_FILE), JSON.stringify(next, null, 2) + '\n');
  return next;
}
