/**
 * 旧存档迁移（2026-11-14）。
 *
 * 背景：素材库做过三轮变更性改动，**卡片 id 会消失**：
 *   1. 视觉去重：10 簇 / 32 张里删了 20 张（同底图重复）；
 *   2. 用户手调：删掉 219 / 27 / 417 / 751，新增 27-1 / 27-2；
 *   3. 矢量化不改变 id。
 *
 * 老用户的 `~/.PigHub/state.json` 里会留着这些 id：直接读会变成「拥有不存在的猪」——
 * 面板里出现空白格、抽卡池对不上、桌宠找不到贴图。
 *
 * 处理原则：
 *   - **能映射就映射**：同一张底图被合并时，把旧 id 换成留下的那张（用户拥有的猪不会凭空消失）；
 *   - **不能映射就丢弃**：明确删除且无替代的，从 state 里移除，但**记一条迁移日志**（不静默）。
 */

/** 旧 id → 新 id。可安全重复执行（幂等）。 */
export const PIG_ID_REMAP = {
  // 去重：同簇合并到保留的那张
  'pighub-1124': 'pighub-1114',
  'pighub-249': 'pighub-1114',
  'pighub-266': 'pighub-1114',
  'pighub-680': 'pighub-1114',
  'pighub-829': 'pighub-1114',
  'pighub-830': 'pighub-1114',
  'pighub-836': 'pighub-1114',
  'pighub-981': 'pighub-1114',
  'pighub-192': 'pighub-1063',
  'pighub-300': 'pighub-1063',
  'pighub-1095': 'pighub-1093',
  'pighub-993': 'pighub-1093',
  'pighub-1199': 'pighub-1135',
  'pighub-1181': 'pighub-1172',
  'pighub-1183': 'pighub-1172',
  'pighub-1305': 'pighub-1226',
  'pighub-40': 'pighub-376',
  'pighub-814': 'pighub-479',
  'pighub-975': 'pighub-804',
  'pighub-201': 'pighub-38',
  // 用户手调：27 拆成 27-1 / 27-2，旧 id 映射到第一张
  'pighub-27': 'pighub-27-1',
};

/** 明确删除且**没有替代**的 id（迁移时直接丢弃并记日志）。 */
export const PIG_ID_DROPPED = ['pighub-219', 'pighub-417', 'pighub-751'];

const REMAP = PIG_ID_REMAP;
const DROPPED = new Set(PIG_ID_DROPPED);

/** 把一个旧 id 迁成新 id；原样保留返回 null 表示无需迁移。 */
export function remapPigId(id) {
  if (typeof id !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(REMAP, id) ? REMAP[id] : null;
}

/**
 * 迁移一份 state。**原地不修改**，返回 { state, changes }。
 * changes: [{ from, to }] 或 [{ from, to: null }]（被丢弃）。
 */
export function migrateState(state) {
  if (!state || typeof state !== 'object') return { state, changes: [] };
  const changes = [];
  const out = JSON.parse(JSON.stringify(state));

  const moveKey = (holder, from, to) => {
    if (!holder || !Object.prototype.hasOwnProperty.call(holder, from)) return;
    const value = holder[from];
    delete holder[from];
    if (to && !Object.prototype.hasOwnProperty.call(holder, to)) holder[to] = value;
  };

  // 1) 拥有的猪
  if (out.pigs && typeof out.pigs === 'object') {
    for (const id of Object.keys(out.pigs)) {
      const to = remapPigId(id);
      if (to) { moveKey(out.pigs, id, to); changes.push({ from: id, to }); }
      else if (DROPPED.has(id)) { delete out.pigs[id]; changes.push({ from: id, to: null }); }
    }
  }

  // 2) 列表型字段
  for (const key of ['store', 'pets']) {
    const list = out[key];
    if (!Array.isArray(list)) continue;
    const next = [];
    for (const id of list) {
      const to = remapPigId(id);
      if (to) { if (next.indexOf(to) < 0) next.push(to); changes.push({ from: id, to }); }
      else if (DROPPED.has(id)) changes.push({ from: id, to: null });
      else if (next.indexOf(id) < 0) next.push(id);
    }
    out[key] = next;
  }

  // 3) 今日猪猪
  if (typeof out.todayPigId === 'string') {
    const to = remapPigId(out.todayPigId);
    if (to) { changes.push({ from: out.todayPigId, to }); out.todayPigId = to; }
    else if (DROPPED.has(out.todayPigId)) { changes.push({ from: out.todayPigId, to: null }); delete out.todayPigId; delete out.lastDrawDate; }
  }

  return { state: out, changes };
}