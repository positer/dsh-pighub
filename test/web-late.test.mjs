#!/usr/bin/env node
/**
 * 「webServer 晚就绪」的回归测试（1.0.11，对应 2026-11-18 的事故）。
 *
 * 事故：apply 时探一次 webServer，探空就跳过全部路由注册、永不重试 →
 * 插件 fiberPhase=active、工具能调，但 GET/POST /pighub 全 404，面板整片空白。
 *
 * 这里用假 ctx 精确复现那一次开机的时序：apply 时服务还没到，稍后才到。
 * 四条断言分别钉住：当场就绪不回归 / 晚到能补录 / 卸载后不许补录 / 老宿主没有 inject 时只 warn 不抛。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const plugin = await import(new URL('../lib/index.js', import.meta.url).href);

function makeHarness({ withWebServer = false, withInject = true } = {}) {
  const exact = new Map();
  const prefixes = new Map();
  const disposers = [];
  const warns = [];
  const webServer = {
    register(route) {
      const table = route.kind === 'prefix' ? prefixes : exact;
      table.set(route.path, route);
      return () => table.delete(route.path);
    },
  };
  const ctx = {
    effect(fn) { const disposer = fn(); if (typeof disposer === 'function') disposers.push(disposer); return disposer; },
    tools: { register() { return () => {}; } },
    logger: { warn(message) { warns.push(String(message)); } },
  };
  if (withWebServer) ctx.webServer = webServer;
  const state = { pending: null };
  if (withInject) {
    ctx.inject = (deps, callback) => {
      state.pending = { deps, callback };
      return () => { state.pending = null; };
    };
  }
  return { ctx, exact, prefixes, disposers, warns, state, webServer };
}

/** 让服务「晚一步」报到：等价于宿主把 webServer 服务建好后回调注入。 */
function arrive(harness) {
  assert.ok(harness.state.pending, '应当向宿主登记了 webServer 的等待回调');
  assert.deepEqual(harness.state.pending.deps, ['webServer']);
  harness.state.pending.callback({ webServer: harness.webServer });
}

const root = () => mkdtempSync(join(tmpdir(), 'pighub-late-'));

let pass = 0;
let fail = 0;
const check = (label, fn) => {
  try { fn(); pass += 1; console.log('PASS  ' + label); }
  catch (error) { fail += 1; console.log('FAIL  ' + label + ' :: ' + (error && error.message)); }
};

// ① 当场就绪：老行为不许回归
check('webServer 当场就绪：四条路由直接注册，且不登记等待', () => {
  const h = makeHarness({ withWebServer: true });
  plugin.apply(h.ctx, { root: root(), desktopPet: false });
  assert.ok(h.exact.has('/pighub'), '状态路由应在');
  assert.ok(h.exact.has('/pighub/theme-import'), '主题导入路由应在');
  assert.deepEqual([...h.prefixes.keys()].sort(), ['/pighub/asset', '/pighub/pen', '/pighub/theme']);
  assert.equal(h.state.pending, null, '当场就绪就不该去等');
});

// ② 晚就绪（事故复现）：apply 时 0 条，服务到了补录
check('webServer 晚就绪：apply 时先排队，服务报到后补齐全部路由', () => {
  const h = makeHarness({ withWebServer: false });
  plugin.apply(h.ctx, { root: root(), desktopPet: false });
  assert.equal(h.exact.size, 0, '服务没到之前不许注册（旧版就是在这里永久放弃）');
  assert.equal(h.prefixes.size, 0);
  assert.ok(h.warns.length === 0, '等就绪不是错误，不该 warn：' + JSON.stringify(h.warns));
  arrive(h);
  assert.ok(h.exact.has('/pighub'), '补录后状态路由应在');
  assert.ok(h.exact.has('/pighub/theme-import'), '补录后主题导入路由应在');
  assert.deepEqual([...h.prefixes.keys()].sort(), ['/pighub/asset', '/pighub/pen', '/pighub/theme']);
});

// ③ 还没报到就被卸载：不许在卸载之后往宿主表里塞路由
check('等不到服务就被卸载：服务后来到了也不许补录', () => {
  const h = makeHarness({ withWebServer: false });
  plugin.apply(h.ctx, { root: root(), desktopPet: false });
  const pendingCallback = h.state.pending.callback;
  for (const dispose of h.disposers) dispose();
  pendingCallback({ webServer: h.webServer });
  assert.equal(h.exact.size, 0, '卸载后补录会留下一条谁也收不走的僵尸路由');
  assert.equal(h.prefixes.size, 0);
});

// ④ 老宿主：没有 inject、也没有 webServer —— 只 warn，不抛
check('老宿主既没 webServer 也没 inject：只记一条 warn，不抛', () => {
  const h = makeHarness({ withWebServer: false, withInject: false });
  plugin.apply(h.ctx, { root: root(), desktopPet: false });
  assert.equal(h.exact.size, 0);
  assert.ok(h.warns.some((line) => line.indexOf('webServer') >= 0), '要留下可排查的 warn');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  —  web server late binding');
process.exit(fail === 0 ? 0 : 1);
