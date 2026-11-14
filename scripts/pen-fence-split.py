# -*- coding: utf-8 -*-
"""
猪圈木栅栏图：去白底 + 按景深切成远/近两层（**同一份像素，不重画**）。

输入（只读）：assets/img/pen-fence.png —— 与用户给的原图逐字节相同（sha256 见报告）。
输出（构建期草稿，不进包）：assets/work/pen-fence/
    fence-alpha.png   去白底后的整张图（客户端实际用这一份的像素）
    back.png          上半部（远侧围栏：顶横梁 + 上角立柱/草石 + 侧栏上半）
    front.png         下半部（近侧围栏：底横梁 + 下角立柱/草石 + 侧栏下半）
    report.json       所有读数

为什么去白底这一步在这张图上**一个像素都不改**：原图已经是 RGBA，画布边缘的 alpha 就是 0
（背景压根不是白的，是透明；红/黄残色只出现在 alpha≤6 的不可见像素上）。规则本身与
scripts/gif-alpha.py 的 border_white 逐条相同（THR=225、min(RGB)>=225 且 alpha>0、从四条边漫填），
所以它在这里的「收获」为 0 —— 这不是跳过，是规则跑完之后的读数，报告里逐项给出。

切分线：一条水平线 S。上半部整行归 back、下半部整行归 front，**每行只属于一层**，
所以把两层叠回去与原图逐像素相等（不是「接近」，是 0 差异）。S 取内圈的竖直中点，
依据见 report 里的 split 段。
"""
import os
import sys
import json
import hashlib
from collections import deque
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "assets", "img", "pen-fence.png")
OUT = os.path.join(BASE, "assets", "work", "pen-fence")
THR = 225                     # 与 scripts/gif-alpha.py 同一个阈值
SPLIT_PX = 636                # 分割线所在行（0 起）：这一行起归 front；内圈 y 247..1024 的中点 635.5 取上行
INNER = {"x0": 168, "x1": 1086, "y0": 247, "y1": 1025}   # 最大全透明内接矩形（右/下为开区间）


def border_white(rgba):
    """从四条边向内漫填「近白且不透明」的像素：只删背景，不碰栅栏身上的白（gif-alpha.py 同规则）。"""
    rgb = rgba[:, :, :3].astype(np.int16)
    near = (rgb.min(axis=2) >= THR) & (rgba[:, :, 3] > 0)
    h, w = near.shape
    seen = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    return seen


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")   # Windows 控制台默认 GBK，会把中文 JSON 打成乱码
    except Exception:
        pass
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(SRC)
    raw = np.array(im.convert("RGBA"))
    h, w = raw.shape[:2]

    # ---- 1. 去白底 ------------------------------------------------------
    hit = border_white(raw)
    alpha_done = raw.copy()
    alpha_done[hit, 3] = 0
    changed = int(hit.sum())
    # 「栅栏本身的像素逐字节一致」：不在删除集里的像素，逐字节比
    keep = ~hit
    same_bytes = bool(np.array_equal(raw[keep], alpha_done[keep]))
    visible_before = int((raw[:, :, 3] > 8).sum())
    visible_after = int((alpha_done[:, :, 3] > 8).sum())
    # 近白不透明像素在整张图里有多少、是否与边缘连通（报告用）
    rgb = raw[:, :, :3].astype(np.int16)
    near_white_opaque = int(((rgb.min(axis=2) >= THR) & (raw[:, :, 3] > 0)).sum())
    fringe = int(((raw[:, :, 3] > 0) & (raw[:, :, 3] <= 8)).sum())

    Image.fromarray(alpha_done).save(os.path.join(OUT, "fence-alpha.png"))

    # ---- 2. 同一条水平线切两层 ------------------------------------------
    s = SPLIT_PX
    back = alpha_done.copy()
    back[s:, :, :] = 0
    front = alpha_done.copy()
    front[:s, :, :] = 0
    Image.fromarray(back).save(os.path.join(OUT, "back.png"))
    Image.fromarray(front).save(os.path.join(OUT, "front.png"))

    # ---- 3. 叠回去（front 盖在 back 上）+ 逐像素 diff --------------------
    # 自己算 source-over（float64、预乘）：PIL 的 alpha_composite 会把半透明像素的
    # 反预乘做成整数四舍五入，凭空造出 2262 px / 最大 7 的差异（那是 PIL 的误差，不是切分的）。
    # 两层按行互斥，所以正确结果的每个像素只有一个来源，叠回去必须与去白底后的原图逐字节相同。
    b = back.astype(np.float64) / 255.0
    f = front.astype(np.float64) / 255.0
    ab, af = b[:, :, 3:4], f[:, :, 3:4]
    out_a = ab + af * (1.0 - ab)
    out_p = f[:, :, :3] * af + (b[:, :, :3] * ab) * (1.0 - af)
    out_rgb = np.where(out_a > 0, out_p / np.maximum(out_a, 1e-12), 0.0)
    # 判据放在**显示空间**（预乘）：alpha=0 的像素 unpremultiply 之后 RGB 是任意的，
    # 原图里就有 2262 个 alpha=0 但 RGB=1 的像素（对屏幕的贡献是 0）。
    src_f = alpha_done.astype(np.float64) / 255.0
    src_p = src_f[:, :, :3] * src_f[:, :, 3:4]
    out_p_cmp = np.rint(out_p * 255.0).astype(np.int32)
    src_p_cmp = np.rint(src_p * 255.0).astype(np.int32)
    d_p = np.abs(out_p_cmp - src_p_cmp)
    n_diff = int((d_p.max(axis=2) > 0).sum())
    max_ch = int(d_p.max())
    # 顺带把「直通 RGB」的差异单独记一笔（只是为了把话说全，不是判据）
    stacked = np.rint(np.concatenate([np.where(out_a > 0, out_p / np.maximum(out_a, 1e-12), 0.0), out_a], axis=2) * 255.0).astype(np.int32)
    d_rgb = np.abs(stacked[..., :3] - alpha_done[..., :3].astype(np.int32))
    d_a = np.abs(stacked[..., 3] - alpha_done[..., 3].astype(np.int32))
    raw_diff_px = int(((d_rgb.max(axis=2) > 0) | (d_a > 0)).sum())
    raw_max_ch = int(max(d_rgb.max(), d_a.max()))
    alpha0_raw = int(((alpha_done[..., 3] == 0) & (d_rgb.max(axis=2) > 0)).sum())
    # 逐行归属自检：每行只能被一层画到
    row_both = int(((( back[:, :, 3] > 0) & (front[:, :, 3] > 0)).any(axis=1)).sum())
    row_none = int((((back[:, :, 3] == 0) & (front[:, :, 3] == 0) & (alpha_done[:, :, 3] > 0)).any(axis=1)).sum())

    report = {
        "source": {
            "path": "assets/img/pen-fence.png",
            "sha256": sha256_file(SRC),
            "bytes": os.path.getsize(SRC),
            "size": [w, h],
            "mode": im.mode,
        },
        "whiteKey": {
            "rule": "scripts/gif-alpha.py border_white：min(RGB)>=225 且 alpha>0，从四条边漫填，命中者 alpha=0",
            "threshold": THR,
            "outsideNearWhiteOpaque": near_white_opaque,
            "removedPixels": changed,
            "fencePixelsByteIdentical": same_bytes,
            "visiblePixelsBefore": visible_before,
            "visiblePixelsAfter": visible_after,
            "invisibleFringePixels": fringe,
            "note": "原图背景本来就是 alpha=0（不是白），所以这条规则命中 0 像素；栅栏身上的 255 近白（高光）不与边缘连通，未被碰。",
        },
        "split": {
            "row": s,
            "percent": round(s / h * 100, 3),
            "basis": "内圈（最大全透明内接矩形 y %d..%d）的竖直中点：(%d+%d)/2 = %d"
                      % (INNER["y0"], INNER["y1"] - 1, INNER["y0"], INNER["y1"] - 1, s),
            "backRows": [0, s - 1],
            "frontRows": [s, h - 1],
        },
        "innerRect": {
            "px": INNER,
            "percent": {k: round(v / w * 100, 2) for k, v in INNER.items()},
            "note": "1254×1254 原图里最大的、不含任何可见栅栏像素（alpha>8）的矩形，见 scripts/_pen-fence-probe.py",
        },
        "stack": {
            "diffPixelsPremultiplied": n_diff,
            "maxChannelDiffPremultiplied": max_ch,
            "rawStraightRgbDiffPixels": raw_diff_px,
            "rawStraightRgbMaxChannelDiff": raw_max_ch,
            "rawDiffPixelsThatAreFullyTransparent": alpha0_raw,
            "rowsPaintedByBothLayers": row_both,
            "rowsWithContentButNoLayer": row_none,
            "note": "两层的行集合互斥（每行只属于一层），所以叠回去每个像素只有一个来源。"
                    "显示空间（预乘 RGBA）逐像素差 0；直通 RGB 上另有 %d 个像素有差（最大 %d/255），"
                    "全部是 alpha=0 的不可见像素（对屏幕贡献为 0），是 unpremultiply 的定义域噪声，不是切分误差。"
                    % (alpha0_raw, raw_max_ch),
        },
        "files": {
            "fence-alpha.png": {"sha256": sha256_file(os.path.join(OUT, "fence-alpha.png"))},
            "back.png": {"sha256": sha256_file(os.path.join(OUT, "back.png"))},
            "front.png": {"sha256": sha256_file(os.path.join(OUT, "front.png"))},
        },
    }
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    if n_diff or max_ch:
        raise SystemExit("叠回 diff 不为 0：%d px / max %d" % (n_diff, max_ch))
    if not same_bytes:
        raise SystemExit("去白底改到了不该改的像素")
    if row_both or row_none:
        raise SystemExit("每行归属有重叠或空洞：both=%d none=%d" % (row_both, row_none))


if __name__ == "__main__":
    main()
