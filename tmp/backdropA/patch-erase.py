
# -*- coding: utf-8 -*-
"""按方框手工补擦「幕布残片」（自动流程够不着的那几段直线/紫色小条）。

为什么需要它：旗子的填色与 + 号由 erase-decal.py 自动取走，但旗子的**描边**在猪背/尾环处
与猪的勾线同色，且被「离猪身 5px」的保护圈挡住 —— 自动流程留 10–20px 的细线。
这里按方框定位（方框由 3–6 倍放大目检确定），并遵守一条硬规则：
**只要该像素 8 邻域里有猪身暖色，就不擦**（勾线紧贴猪身，因此不会被啃出缺口）。

用法: python patch-erase.py --plan plan.json   # {id: [[x0,y0,x1,y1], ...]}
"""
import os, sys, json, argparse
import numpy as np
from PIL import Image

BASE = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA"

def patch(path, boxes, outpath):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    R = a[:, :, 0].astype(np.int32); G = a[:, :, 1].astype(np.int32)
    B = a[:, :, 2].astype(np.int32); A = a[:, :, 3].astype(np.int32)
    h, w = A.shape
    warm = (R - G >= 28) & (R >= 120)
    wnb = np.zeros((h, w), np.int32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0: continue
            wnb += np.roll(np.roll(warm.astype(np.int32), dy, axis=0), dx, axis=1)
    dark = np.maximum(np.maximum(R, G), B) < 170
    navy = (np.abs(R-86) < 60) & (np.abs(G-74) < 60) & (np.abs(B-116) < 70) & (B > G + 4)
    # 米白/灰白：旗子填色被擦掉后，它的高光与抗锯齿边会留下浅色小块（3 倍放大可见）
    pale = (np.minimum(np.minimum(R, G), B) > 175) & ((np.maximum(np.maximum(R, G), B) - np.minimum(np.minimum(R, G), B)) < 40)
    kill = (A > 8) & ~warm & (dark | navy | pale) & (wnb == 0)
    total = 0
    for (x0, y0, x1, y1) in boxes:
        m = np.zeros_like(kill)
        m[max(0,y0):y1+1, max(0,x0):x1+1] = True
        sel = kill & m
        total += int(sel.sum())
        a[sel] = [0, 0, 0, 0]
    ys, xs = np.nonzero(a[:, :, 3] > 8)
    out = Image.fromarray(a, "RGBA").crop((int(xs.min()), int(ys.min()), int(xs.max())+1, int(ys.max())+1))
    out.save(outpath)
    return total, out.size

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--src", default=os.path.join(BASE, "after10"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    plan = json.load(open(args.plan, encoding="utf-8"))
    os.makedirs(args.out, exist_ok=True)
    for name, boxes in plan.items():
        n, size = patch(os.path.join(args.src, name + ".png"), boxes, os.path.join(args.out, name + ".png"))
        print(name, "erased", n, "->", size)
