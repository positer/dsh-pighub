# -*- coding: utf-8 -*-
"""
一次性探针：把「猪圈木栅栏」这一轮要用的所有坐标量出来。不改任何文件，只打印读数。

两个输入（都是用户给的原图，1254×1254）：
  RAW     原始 PNG        —— 干净的栅栏（随包分发的那一份，assets/img/pen-fence.png）
  ANNOT   标注版 WEBP     —— 用户在同一张图上画了**红色方框**，草坪只能铺在框内
两个文件都在 DSH 附件库里（路径见常量），不进仓库。

量的四组数：
  1. 用户红框（标注版里 alpha=255、颜色≈(213,74,50) 的粗线，stroke 宽 21–22px）
  2. 栅栏内圈 = 原图里最大的「不含任何可见像素」(alpha>8) 的矩形
  3. 可见内容的 bbox
  4. 侧栏/横梁的轮廓（供「分割线为什么取中点」复核）
"""
import sys
import collections
import numpy as np
from PIL import Image

RAW = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
ANNOT = r"C:\Users\12252\.dsh\attachments\v1\objects\c5\c537076c3a927f8232bccf48b4defc1bd0db8d64a887a2dc73eff7e6f68fe812"
SIDE = 1254.0


def pct(v):
    return round(v / SIDE * 100, 2)


def largest_empty_rect(empty):
    h, w = empty.shape
    best = (0, 0, 0, 0, 0)
    heights = np.zeros(w, np.int32)
    for y in range(h):
        heights = np.where(empty[y], heights + 1, 0)
        stack = []
        for x in range(w + 1):
            cur = int(heights[x]) if x < w else 0
            start = x
            while stack and stack[-1][1] > cur:
                sx, hh = stack.pop()
                area = hh * (x - sx)
                if area > best[0]:
                    best = (area, sx, x - 1, y - hh + 1, y)
                start = sx
            stack.append((start, cur))
    return best


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    # ---------------- 1. 用户红框（标注版） ----------------
    a = np.array(Image.open(ANNOT).convert("RGBA")).astype(np.int32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    ann = (al > 200) & (r > 150) & (g < 120) & (b < 120) & (r - g > 90)
    mid = a.shape[0] // 2
    row = np.where(ann[mid])[0]
    col = np.where(ann[:, mid])[0]

    def segs(idx):
        out = []
        for i in idx:
            if out and i == out[-1][1] + 1:
                out[-1][1] = int(i)
            else:
                out.append([int(i), int(i)])
        return out

    rs, cs = segs(row), segs(col)
    print("== 用户红框（标注版 WEBP，中线读数）==")
    print("  颜色众数:", collections.Counter([tuple(v) for v in a[ann][:4000]]).most_common(2))
    print("  标注像素:", int(ann.sum()))
    print("  行 y=%d 的红线段:" % mid, rs)
    print("  列 x=%d 的红线段:" % mid, cs)
    outer = {"x0": rs[0][0], "x1": rs[-1][1], "y0": cs[0][0], "y1": cs[-1][1]}
    inner = {"x0": rs[0][1] + 1, "x1": rs[-1][0] - 1, "y0": cs[0][1] + 1, "y1": cs[-1][0] - 1}
    print("  外沿 px:", outer, "-> 百分比", {k: pct(v) for k, v in outer.items()})
    print("  内沿 px:", inner, "-> 百分比", {k: pct(v) for k, v in inner.items()})
    print("  stroke 宽 px: 左 %d 右 %d 上 %d 下 %d" % (
        rs[0][1] - rs[0][0] + 1, rs[-1][1] - rs[-1][0] + 1,
        cs[0][1] - cs[0][0] + 1, cs[-1][1] - cs[-1][0] + 1))

    # ---------------- 2/3/4. 原图几何 ----------------
    raw = np.array(Image.open(RAW).convert("RGBA"))
    empty = raw[..., 3] <= 8
    area, x0, x1, y0, y1 = largest_empty_rect(empty)
    print("\n== 栅栏内圈（原图，最大不含可见像素的矩形）==")
    print("  px x %d..%d  y %d..%d  (%d x %d)" % (x0, x1, y0, y1, x1 - x0 + 1, y1 - y0 + 1))
    print("  百分比 x %.2f..%.2f  y %.2f..%.2f" % (pct(x0), pct(x1 + 1), pct(y0), pct(y1 + 1)))
    ys, xs = np.where(~empty)
    print("\n== 可见内容 bbox ==")
    print("  px x %d..%d y %d..%d -> 百分比 x %.2f..%.2f y %.2f..%.2f" % (
        xs.min(), xs.max(), ys.min(), ys.max(),
        pct(xs.min()), pct(xs.max() + 1), pct(ys.min()), pct(ys.max() + 1)))
    print("\n== 内圈四边的实际轮廓（供复核）==")
    print("  远栏下沿（护栏底面）: y = 219..221；竖向立柱探到 y = 234")
    print("  近栏上沿（护栏顶面）: y = 1065；竖向立柱探到 y = 1028")
    print("  左栏内侧面: x = 150；螺栓探到 x = 166")
    print("  右栏内侧面: x = 1104；螺栓探到 x = 1087")
    print("  分割线取内圈竖直中点: (%d + %d) / 2 = %d -> %.3f%%" % (y0, y1, (y0 + y1) // 2, pct((y0 + y1) / 2)))


if __name__ == "__main__":
    main()
