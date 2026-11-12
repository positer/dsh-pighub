# DSH 插件公开形式调研（2026-11-12）

> 目的：在写 `dsh-pighub` 之前，先确认「DSH 插件在公开世界长什么样、靠什么被装、靠什么被发现」。**本文只记录实际读到的内容**；官方仓库原文没有取到（见 §1.3），所以每条结论都标了来源与等级。

## 0. 一句话结论

DSH 插件对外只有**一条主链**：**一个 npm 包 + 一张补丁层 + 一个 ESM 入口**。包靠 `package.json` 的 `dsh.bundle.patch` 自证是 bundle；能力靠入口导出的 `apply(ctx)` 调 `ctx.tools.register(...)` 提供。README、关键词、前端半（`dsh.client`）都是可选外壳，不影响「能不能装、能不能用」。

## 1. 方法与证据等级

### 1.1 一手：本机运行中的宿主（实测）

| 事实 | 值 | 取得方式 |
|---|---|---|
| DSH CLI 版本 | `0.1.1-rc.2` | `dsh --version` |
| 桌面宿主版本 | `0.2.2-rc.1` | ``/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json` |
| 宿主运行时 | node `24.21.0` / pnpm `11.28.5` | 同上 |
| 插件子命令语义 | 「forwarding the remaining arguments to pnpm in the profile directory」 | `dsh --help` |
| 装配单元 | profile 的 `package.json` → `dsh.profile.bundles: [...]` | ``/.dsh/profiles/desktop/package.json` |

### 1.2 一手：两个真实在跑的插件（读清单 + 读代码）

- `newmark2dsh@0.3.82`（``/.dsh/profiles/desktop/node_modules/newmark2dsh`）：本机生产插件，与本次同一个 npm 账号发布。
- `dsh-super-injector@0.3.3`（``/.dsh/plugins/dsh-super-injector-0.3.3`）：第三方生产插件。

### 1.3 一手：npm registry 实测

- `npm view dsh-pet@0.4.8 --json`：一个已发布、持续迭代（0.1.0 → 0.4.8，2026-08-14 起）的插件包的完整清单。
- `npm search --json --searchlimit=250 keywords:dsh-plugin`：返回 **250 条**（等于查询上限，故只能断言「至少 250 个」）。
- `npm view dsh-pighub` → **404**：包名当时无人占用。
- `https://dshplugin.dev` → 200：社区插件目录，见 §6。
- `https://unpkg.com/dsh-pet@0.4.8/cordis.patch.yml` → 200，975 字节：一个**已发布**插件的补丁层原文，里面写着两条上架硬约束（见 §2.1）。这样不必下载它 78 MB 的 tarball 就能读到装配层原文。

### 1.4 二手：社区文档（非官方，只作交叉印证）

- `anweat/dsh-plugin-dev-guide`：`docs/publishing.md`（10,341 字节）、`docs/plugin-development.md`（17,827 字节）。
- `GDWhisper/dsh-ntr`：`docs/dsh-plugin-development-guide.md`（14,116 字节）。

> **未能取得**：我尝试的两个官方仓库 raw 路径（`deepseek-ai/deepseek-harness`、`deepseek-harness/deepseek-harness` 的 `docs/user/develop/basic/publish.md`）都返回 404。因此本文**不引用任何我未读过的官方条款**；官方语义一律由「运行中的宿主 + registry 上的真实包」反证，并标注为实测而非官方承诺。

## 2. 公共形式：五个要素

| # | 要素 | 具体形态 | 证据 |
|---|---|---|---|
| 1 | **ESM 入口** | `type: "module"`，`main` 指向构建产物，导出 `name` / `inject` / `apply(ctx[, config])` | `newmark2dsh` 的 `index.js`：`export const name`(:160) / `export const inject = ['webServer']`(:193) / `export function apply`(:250) |
| 2 | **bundle 声明** | `package.json` → `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` | `newmark2dsh`、`dsh-super-injector`、`dsh-pet@0.4.8` 三者一致 |
| 3 | **补丁层** | 顶层 YAML 数组，最常见是 `- insert: [{ id, name }]`，`name` 写**包名**（Node 解析），不是源码路径 | 两个已装插件的 `cordis.patch.yml`；`dsh-pet` 同样以包名插入 |
| 4 | **exports** | 至少 `.`；补丁文件需显式导出 `./cordis.patch.yml`（`dsh-pet` 与社区指南都这么做） | `dsh-pet@0.4.8` 的 `exports` 含 `"./cordis.patch.yml"` |
| 5 | **能力注册** | `ctx.tools.register({ name, description, parameters, output?, execute })`，`parameters` 是 JSON Schema；返回一个 disposer | `newmark2dsh` 源码中 16 处 `ctx.tools.register(` 调用 |

### 2.1 插件行的两条硬约束（来自一个**已发布**插件的补丁层原文）

`dsh-pet@0.4.8` 的 `cordis.patch.yml` 把这两条写在文件头注释里（原文抓取：`https://unpkg.com/dsh-pet@0.4.8/cordis.patch.yml`）：

1. **`id` 必须全局唯一，且与包名一致**。原文：「id 必须全局唯一且与包名一致：DSH STORE 上架契约按它比对 entryIds，裸名（如 pet）会与其它插件的行标识冲突，候选会被判为缺少 entry ID」。
2. **`id:` 那一行绝不能写行尾注释**。原文：「商城预检（`check-plugin-submission.mjs`）用正则抓该行的值并要求其后直接换行，行尾注释会让它抓不到 entry ID，整份提交被判 `SUBMISSION_ENTRY_MISSING`」。

它自己的实际写法（原样）：

```yaml
- insert:
    - id: dsh-pet
      name: 'dsh-pet'             # 模块名：解析到 lib/index.js
```

注意：行尾注释写在 `name` 行是允许的，被禁止的是 `id` 行。

### 2.2 补充：装进去之后，模型看到的是什么

`ctx.tools.register` 的 `definition` 被宿主收进工具表，模型侧看到的是 `name` + `description` + `parameters`（本会话的工具清单就是这个表）。所以**工具描述直接进首轮 prefill**，社区插件普遍把详细说明留在工具结果里而不是 schema 里（`dsh-super-injector` README 的「规范铁律」第 7 条，属社区经验）。

## 3. 装配链：从 `dsh plugin add` 到 `apply(ctx)`

```text
dsh plugin --profile <p> add <pkg>
   │  转发给 profile 目录里的 pnpm（实测：dsh --help）
   ▼
<profile>/package.json  dependencies += <pkg>
                        dsh.profile.bundles += [<pkg>]      ← 顺序即装配顺序
   ▼
启动：按 bundles 顺序读每个包的  dsh.bundle.patch  →  合并成补丁层
   ▼
补丁行的  insert[].name  ──交给 Node 解析──▶  import  该包
   ▼
入口的  apply(ctx, config)  执行 →  ctx.tools.register(...)  →  模型可见
```

两个容易踩的点，都有实测依据：

1. **`name` 必须是包名**，写相对路径的补丁行在 npm 包里不成立（`dsh-pet` 与两个已装插件写的都是包名）。
2. **`config` 是整值替换不是深合并**（社区文档 `plugin-development.md` §1.4 明确警告；本机 profile 的补丁层里每条 `config:` 都是写全的，与此一致）。

## 4. 分发通道：三条，取舍不同

| 通道 | 用户执行 | 发布者要准备 | 实测/依据 |
|---|---|---|---|
| **npm registry（推荐）** | `dsh plugin --profile web add dsh-pighub` | `npm publish`（一次） | `newmark2dsh`、`dsh-pet` 都走这条路；本机 `npm whoami` = 已登录 |
| GitHub 仓库 | `dsh plugin ... add github:<user>/<repo>` | 仓库 + 自包含 `prepare` 构建脚本 | 社区文档 §4（pnpm ≥10 需 `allowBuilds` 白名单） |
| tarball / 本地目录 | `add ./<pkg>-<ver>.tgz` 或 `add ./<目录>` | 构建产物 `lib/` | `dsh --help` 的 plugin 子命令（转发 pnpm，故本地路径可用） |

包名被占用时的唯一正解是 **scoped 包**（`@positer/dsh-pighub`）：npm 无 scope 名无法申诉，而 scoped 命名空间归账号所有。本次 `dsh-pighub` 未占用（404 实测），故不需要退让到 scope。

## 5. 可选外壳

### 5.1 前端半（`dsh.client`）

```jsonc
"dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime"] } }
```

声明后需**单独构建**浏览器产物（`lib/client.js`，closure-factory 形式，由宿主 `window.__ModuleLoader__.load(...)` 注册），并在 `exports` 里暴露 `./client`。`newmark2dsh`、`dsh-super-injector`、`dsh-pet` 都带这一半。**占位版不带**：没有 UI 需求，多一个构建链只增加失败面。

### 5.2 兼容性声明（`dsh.compatibility.dshReleases`）

`dsh-pet@0.4.8` 用 `dsh.compatibility.dshReleases = {"0.2.1-rc.3": "compatible", ...}` 逐版本标注。这是**发布者可选项**，不是 install 的必需要素；本机两个生产插件都没写。

### 5.3 peerDependencies 的两种流派（未统一）

| 写法 | 出处 | 备注 |
|---|---|---|
| `cordis: ">=4.0.0-rc <5"` + `@deepseek-ai/dsh-tools: ">=0.0.1-rc <2"` | `dsh-super-injector@0.3.3` | registry 上 `cordis@4.0.0-rc.12` 与 `@deepseek-ai/cordis@4.1.0` **都存在** |
| 只认 scoped `@deepseek-ai/cordis`，警告别装无 scope 的社区 `cordis` | 社区文档 `dsh-ntr` §1.2 | 属社区主张，未在本机验证 |

**本包的处置**：零 import，因此**不声明 peerDependencies**。理由是可验证的——没有任何被解析的依赖，加一个可能不准的版本区间只会让 `pnpm add` 报 peer 冲突。等真实代码第一次 `import` 时再补，并届时用本机宿主版本实测。

## 6. 发现层：关键词与目录

- **npm 关键词**：`dsh-plugin` 是生态事实标准。`npm search keywords:dsh-plugin` 返回 250 条（**查询上限**，只能断言「至少 250」）；抽查 `dsh-pet`、`dsh-windows-mcp`、`dsh-whale-widget`、`dshmarket` 的 `keywords` 都含 `dsh-plugin`。
- **社区目录** [dshplugin.dev](https://dshplugin.dev)：页面自述「Live index 1135 repositories · Crawled daily from GitHub」。**它索引的是 GitHub 仓库，不是 npm 包**（1035→1135 那个数字是仓库数）。推论：想让目录收录，光发 npm 不够，得要一个公开仓库；想让用户装，光有仓库不够，得发 npm。两件事分开做。
- **商城（DSH STORE）有机械契约**：`dsh-pet` 的补丁层注释提到「DSH STORE 上架契约按它比对 entryIds」与预检脚本 `check-plugin-submission.mjs`（见 §2.1 两条硬约束）。我没有拿到 STORE 的提交文档，只确认了**这两条约束是从一个真实上架插件的原文里读出来的**；本占位包的 `id` 行与包名一致且无行尾注释，符合这两条。

## 7. 本占位包逐项对照

| 字段/文件 | 依据 | `dsh-pighub@0.0.1` 的取值 |
|---|---|---|
| `name` | §2 #2 主链 | `dsh-pighub`（实测 404，可占用） |
| `type` / `main` / `exports` | §2 #1 #4 | ESM；`./lib/index.js`；导出 `.` / `./cordis.patch.yml` / `./package.json` |
| `dsh.bundle.patch` | §2 #2 | `./cordis.patch.yml` |
| `cordis.patch.yml` | §2 #3 | 一行 `insert: [{ id: dsh-pighub, name: dsh-pighub }]` |
| 入口导出 | §2 #1 | `name` / `inject = ['tools']` / `apply(ctx)` |
| 工具注册 | §2 #5 | `ctx.effect(() => ctx.tools.register(...))`，工具名 `pighub_about` |
| `keywords` | §6 | 含 `dsh-plugin` / `deepseek-harness` |
| `dsh.client` | §5.1 | **不声明**（无 UI） |
| `peerDependencies` | §5.3 | **不声明**（零 import） |
| `publishConfig` | §4 | `access: public` |

## 8. 存疑与未验证（明确边界）

1. **官方原文未读**：官方 `docs/user/develop/basic/publish.md` 两个候选 URL 均 404。本文所有「官方语义」实为**运行中的宿主行为反证**。
2. **`defineTool` 未验证**：社区指南用 `import { defineTool } from '@deepseek-ai/dsh-tools'`；本机 profile 里没有该包（由宿主提供），我**没有**验证它的导出面。所以占位包用宿主实测接受的普通对象形态注册。
3. **`ctx.effect` 是纪律不是契约**：它出现在两个生产插件里，用于回收注册；我按它写，但没有做「不包 effect 会残留」的对照实验。
4. **npm 关键词总量是下界**：250 是查询上限，真实数量未知。
5. **目录收录规则未核**：只读到 dshplugin.dev 自述「每日爬 GitHub」，未核其筛选条件。

## 9. 复现命令

```powershell
dsh --version                                   # 0.1.1-rc.2
Get-Content "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json"
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json"      # dsh.profile.bundles
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\newmark2dsh\package.json"
npm view dsh-pet@0.4.8 --json | Select-String '"dsh"' -Context 0,12
npm search --json --searchlimit=250 keywords:dsh-plugin
npm view dsh-pighub                            # 发布前应为 404
# 已发布插件的补丁层原文（不必下载 78 MB 的 tarball）
curl.exe -s https://unpkg.com/dsh-pet@0.4.8/cordis.patch.yml
```
