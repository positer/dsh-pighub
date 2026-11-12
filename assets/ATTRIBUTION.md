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

## 许可

- **上游图库（PigHub / 其开源镜像）未声明数据许可**。按「保留全部权利」理解：版权归原权利人，
  本仓库对这些图只做了**逐图判定与裁切**（去白底、裁到猪身、部分描摹成 SVG），未主张任何权利。
- **本仓库代码**：MIT（见 [LICENSE](../LICENSE)）。MIT 只覆盖代码，不覆盖任何素材。
- 若权利人要求下架某张图，删除对应的 `img/<id>.*`、在 `judgements.json` 移除判定、重跑
  `npm run assets:build`，再发一个新版本即可；素材按版本冻结，老版本不会自动更新。

## 为什么不链接素材库

运行时不请求上游：贴图是包内文件，离线可用、不受上游可用性影响，也不把用户的访问行为交给第三方。
署名与出处保留在此文件与 `manifest.json` 的 `source` 字段里——引用与依赖是两件事。
