# 素材署名与许可

本目录下的 `img/` 是**构建期处理后的贴图**，随包分发。运行时不会访问任何素材库。

## 来源

| 素材 | 来源 | 源图 URL | 源图指纹 |
|---|---|---|---|
| 挂科猪（pig-1354） | pighub | https://pighub.top/images/%E6%8C%82%E7%A7%91%E7%8C%AA.jpg | `926d216a988acf8b…` |
| 怪猪（pig-1355） | pighub | https://pighub.top/images/%E6%80%AA%E7%8C%AA.jpg | `0b15fc66ff0fb622…` |
| 乱停猪（pig-1357） | pighub | https://pighub.top/images/%E4%B9%B1%E5%81%9C%E7%8C%AA.jpg | `c6ea79a460b2f2ee…` |
| 萝卜猪（pig-1358） | pighub | https://pighub.top/images/%E8%90%9D%E5%8D%9C%E7%8C%AA.jpg | `40f31fac7d709a5e…` |
| 你已笨哭（pig-1360） | pighub | https://pighub.top/images/%E4%BD%A0%E5%B7%B2%E7%AC%A8%E5%93%AD_1.jpg | `425c8084e4caa13c…` |
| 你知道吗（pig-1361） | pighub | https://pighub.top/images/%E4%BD%A0%E7%9F%A5%E9%81%93%E5%90%97.jpg | `c61c93ea5608c54f…` |

## 角色卡收编（2026-11-12，冻结库 14 → 31）

`assets/cards/` 是同一来源、同一套逐图处理（去底 / 裁到猪身 / 去角色名 / 风格闸门）产出的角色卡样例集，
产出批次与指纹记在 `assets/cards/index.json`；`assets/cards/selection.json` 记录哪 17 张通过可爱闸门、
哪 2 张被拒（恐怖猪、双面幽灵猪，理由逐条写在文件里）。

收编后的清单条目带 `adopted: true` 与 `source: { group: 'pighub-online', via: 'cards', file, sha256 }`。

> ✅ **缺口已关闭（2026-11-13）**：卡片管线现在把每张卡的**上游源图 URL** 写进 `assets/cards/index.json`，
> 收编时一并落到清单的 `source.url`；历史 50 条也按同一 API 回填。当前冻结库 **118 只全部带 url**（118/118），
> 可用 `node -e "const m=require('./assets/manifest.json'); ..."` 复核。

## 唯一可信源（assets/libraries.json）

**PigHub（pighub.top 猪猪表情包库）是唯一可信源**——用户 2026-11-12 的决定。全部素材只从该库采集；其余仓库只登记事实，**一律不采集**。

下表保留其它仓库的许可实测，是为了说明「为什么不去用它们」，而不是候选：

逐仓库查了 GitHub API 的 `license.spdx_id`（权威字段，不是 README 自述），并按「能不能把图打进包里再分发」判定：

| 库 | 许可（实测） | 图 | 判定 |
|---|---|---|---|
| pighub.top | 无数据许可声明 | 1,361 | inherited-risk（用户已知悉） |
| PigHub-DB | `null` | 1,303 | reference-only |
| PigPicPot | `null` | 327 | reference-only |
| rollpig-resources | `NOASSERTION`（禁止再托管） | 267 | reference-only |
| TodayPig | `null` | 1,303 | reference-only |
| rollpig / rollpig-plus | MIT | 0（只有文字资料） | bundle（无图可打包） |
| pig_catcher | MIT 代码 + user-provided-local-use 数据 | 0 | reference-only |

许可原文摘录（前 160 字）也已抓进 `assets/libraries.json` 的 `licenseExcerpt` 字段：MIT 的三家给出真实版权行，rollpig-resources 的原文明确写着「并非单一协议覆盖全部内容」，其余四家则是**仓库根目录没有 LICENSE 文件**。

``2026-11-12 更新：用户明确判定 PigHub 猪猪表情包库可信（`verdict: trusted`，判定人与日期记录在 libraries.json），该库据此按可信来源处理；其余 reference-only 结论不变。``

**结论：按「能再分发」严格筛，没有任何图片库通过。** 三个真图库都没有数据许可；唯一写清数据条款的 `rollpig-resources` 明文禁止再托管；MIT 的仓库里只有猪名/描述这类文字资料，没有猪图。

所以本包内的图片仍全部来自 pighub.top，按 `inherited-risk` 记录——这是用户已知悉的取舍，不是「可信开源」。若权利人提出异议，删图 + 移除判定 + 重建 + 发新版即可。

## 许可

- **上游图库（PigHub / 其开源镜像）未声明数据许可**。按「保留全部权利」理解：版权归原权利人，
  本仓库对这些图只做了**逐图判定与裁切**（去白底、裁到猪身、部分描摹成 SVG），未主张任何权利。
- **本仓库代码**：MIT（见 [LICENSE](../LICENSE)）。MIT 只覆盖代码，不覆盖任何素材。
- 若权利人要求下架某张图，删除对应的 `img/<id>.*`、在 `judgements.json` 移除判定、重跑
  `npm run assets:build`，再发一个新版本即可；素材按版本冻结，老版本不会自动更新。

## 为什么不链接素材库

运行时不请求上游：贴图是包内文件，离线可用、不受上游可用性影响，也不把用户的访问行为交给第三方。
署名与出处保留在此文件与 `manifest.json` 的 `source` 字段里——引用与依赖是两件事。
