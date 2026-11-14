
# -*- coding: utf-8 -*-
"""去掉「幕布」类布景：PigHub 素材里那块深紫/靛色的三角旗（带米白 + 号与圆点）。

为什么要单独一个脚本：这批布景是同一张 decal，颜色集中（约 80,72,104 ~ 96,80,136），
而且几乎都画在猪的后面（猪的轮廓压在它上面），所以色键 + 连通域就够，不用逐张手抠。

v1 失败记录（2026-11-14）：直接用 (b>g+10) 判靛色会把猪眼睛（近黑, b-g=6）一起吃掉 →
改为加下限 min(r,g,b)>55 且 b-g>=10。此外半透明的抗锯齿边（alpha 128）RGB 仍是靛色，
必须按「颜色接近 + alpha<250」单独清一遍，否则留下 1px 紫边。

用法:
  python remove-banner.py --ids a,b,c --out DIR [--write]     # 不给 --write 只出到 DIR
输出 JSON: 每张的 metrics（removed / opaque_before / opaque_after / holes / residual_navy / bbox）
"""
import os, sys, json, argparse
from collections import deque
import numpy as np
from PIL import Image

ROOT = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
IMG = os.path.join(ROOT, "assets", "img")

def label(mask):
    h, w = mask.shape
    lab = np.full((h, w), -1, np.int32)
    out = []
    cur = 0
    for y in range(h):
        row = mask[y]
        for x in range(w):
            if row[x] and lab[y, x] < 0:
                q = deque([(y, x)]); lab[y, x] = cur; n = 0
                y0 = y1 = y; x0 = x1 = x
                while q:
                    cy, cx = q.popleft(); n += 1
                    if cy < y0: y0 = cy
                    if cy > y1: y1 = cy
                    if cx < x0: x0 = cx
                    if cx > x1: x1 = cx
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = cy+dy, cx+dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and lab[ny, nx] < 0:
                            lab[ny, nx] = cur; q.append((ny, nx))
                out.append({"area": n, "bbox": [x0, y0, x1, y1], "id": cur})
                cur += 1
    return lab, out

def navy_core(r, g, b, al):
    return (al > 60) & (np.abs(r-86) < 30) & (np.abs(g-74) < 30) & (np.abs(b-116) < 46) \
           & (b > g + 10) & (b > r + 6) & (r > 55) & (g > 50) & (b > 70)

def navy_loose(r, g, b, al):
    # 抗锯齿边 / 与背景混合的半透明像素：色相同族、亮度更宽
    return (al > 8) & (al < 252) & (np.abs(r-88) < 55) & (np.abs(g-76) < 55) & (np.abs(b-118) < 70) \
           & (b >= g + 8) & (b >= r + 4) & (r > 40) & (g > 36) & (b > 56)

def process(name, outdir, write=False, verbose=True):
    p = os.path.join(IMG, name + ".png")
    im = Image.open(p).convert("RGBA")
    a = np.asarray(im).copy()
    r = a[:, :, 0].astype(np.int32); g = a[:, :, 1].astype(np.int32); b = a[:, :, 2].astype(np.int32)
    al = a[:, :, 3].astype(np.int32)
    before = {"size": [im.width, im.height], "opaque": int((al > 8).sum())}

    core = navy_core(r, g, b, al)
    lab, cl = label(core)
    cl = [c for c in cl if c["area"] > 400]
    if not cl:
        return None
    cl.sort(key=lambda c: -c["area"])
    # 只处理「大块且不规则」的布景：面积 > 800
    mask = np.zeros_like(core)
    keep = [c for c in cl if c["area"] > 800]
    x0 = min(c["bbox"][0] for c in keep); y0 = min(c["bbox"][1] for c in keep)
    x1 = max(c["bbox"][2] for c in keep); y1 = max(c["bbox"][3] for c in keep)
    for c in keep:
        mask |= (lab == c["id"])
    banner_bbox = [int(x0), int(y0), int(x1), int(y1)]

    # 1) 填 banner 内部的孔（米白 + 号与圆点）：面积小、且完全被 mask 包住
    sub = mask[y0:y1+1, x0:x1+1]
    comp_lab, comps = label(~sub)
    for c in comps:
        cx0, cy0, cx1, cy1 = c["bbox"]
        touches_edge = cx0 == 0 or cy0 == 0 or cx1 == sub.shape[1]-1 or cy1 == sub.shape[0]-1
        if not touches_edge and c["area"] < 900:
            m = np.zeros_like(sub); m[comp_lab == c["id"]] = True
            sub |= m
    mask[y0:y1+1, x0:x1+1] = sub

    # 2) 沿边缘吃掉半透明的紫边（最多 2 圈）
    loose = navy_loose(r, g, b, al)
    for _ in range(3):
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]; grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]; grown[:, :-1] |= mask[:, 1:]
        add = grown & ~mask & loose
        if not add.any():
            break
        mask |= add

    # 3) 收敛：擦掉之后再找「紧贴已擦区域的残留靛色像素」并补擦，直到不再变化。
    #    这一步是必须的：旗子最外圈的那道深边比色键窗口更暗，漏掉会在猪旁边留下紫色描边残片。
    a[mask] = [0, 0, 0, 0]
    for it in range(12):
        gone = (a[:, :, 3] <= 8)
        rim = np.zeros_like(gone)
        for _ in range(2):
            rim[1:, :] |= gone[:-1, :]; rim[:-1, :] |= gone[1:, :]
            rim[:, 1:] |= gone[:, :-1]; rim[:, :-1] |= gone[:, 1:]
        rr = a[:, :, 0].astype(np.int32); gg = a[:, :, 1].astype(np.int32); bb = a[:, :, 2].astype(np.int32)
        aa = a[:, :, 3].astype(np.int32)
        add = rim & (aa > 8) & (bb >= gg + 6) & (bb >= rr + 2) & (rr > 30) & (bb > 50)
        if not add.any():
            break
        mask |= add
        a[add] = [0, 0, 0, 0]

    removed = int(mask.sum())
    removed_opaque = int((mask & (al > 8)).sum())
    al2 = a[:, :, 3].astype(np.int32)

    # 4) 空洞检查：被不透明猪身完全包住的透明区（面积>5）
    holes = []
    lab2, cl2 = label(al2 <= 8)
    for c in cl2:
        cx0, cy0, cx1, cy1 = c["bbox"]
        if cx0 == 0 or cy0 == 0 or cx1 == im.width-1 or cy1 == im.height-1: continue
        if c["area"] > 5: holes.append(c["area"])

    # 4) 残留靛色检查（不透明）
    r2 = a[:, :, 0].astype(np.int32); g2 = a[:, :, 1].astype(np.int32); b2 = a[:, :, 2].astype(np.int32)
    residual = navy_core(r2, g2, b2, al2)

    # 5) 裁到内容（与库内其它贴图一致：贴图本来就是紧裁到 alpha 边界）
    ys, xs = np.nonzero(al2 > 8)
    if len(xs) == 0:
        return {"id": name, "error": "emptied"}
    bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    out = Image.fromarray(a, "RGBA").crop((bx0, by0, bx1 + 1, by1 + 1))

    dst = os.path.join(outdir, name + ".png")
    os.makedirs(outdir, exist_ok=True)
    out.save(dst)
    if write:
        out.save(p)
    m = {
        "id": name,
        "before": before,
        "after": {"size": [out.width, out.height], "opaque": int((np.asarray(out)[:, :, 3] > 8).sum())},
        "banner_bbox": banner_bbox,
        "removed_px": removed,
        "removed_opaque": removed_opaque,
        "holes": holes,
        "residual_navy_px": int(residual.sum()),
        "empty_margin_trim": [bx0, by0, im.width-1-bx1, im.height-1-by1],
    }
    return m

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    ids = [s.strip() for s in args.ids.split(",") if s.strip()]
    res = []
    for i in ids:
        try:
            m = process(i, args.out, args.write)
        except Exception as e:
            m = {"id": i, "error": repr(e)}
        res.append(m)
    print(json.dumps(res, indent=1, ensure_ascii=False))
