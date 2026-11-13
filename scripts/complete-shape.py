"""
残缺猪补全 v2：轮廓闭合（contour-closure），构建期一次性工具，需要 Pillow + numpy + scipy。

为什么再写一个（与 extrude-complete.py / complete-pigs*.py 的分工）：
  老办法是「沿切口那一条边向内取一列/一行，往外复制 N 像素」。它在三类图上必然留痕
  （2026-11-13 实测，见 OVERVIEW §6.8/§6.9 与 archive/pool-batch-B）：
    1. 切口上带装饰（星芒、深蓝三角、FOOLS DAY 帽子）时，复制会把装饰拉成竖条/楔形；
    2. 复制段与原图之间是一条**直**接缝，新段又没有描边 → 接缝两侧中位亮度台阶 26-89；
    3. 底边挤出等于「平板 + 矩形腿」，与猪自己的圆腿不同形（255/379/868 的现行版本就是这样）。
  本工具换一个前提：**切口之外的形状是未知，不是可复制**。所以不复制像素，而是
    ① 量切口跨度（贴边那一行/列的连续不透明段，判据复用 audit-completeness.py）；
    ② 用**椭圆端帽**把跨度闭合：端点处切线平行于原有轮廓，接得上；
    ③ 端帽内部取「原图最近的一个纯填色像素」的颜色平涂（同色 → 内部接缝台阶 0）；
    ④ 沿新轮廓画一圈描边，颜色取自猪自己的勾线、粗细取自猪自己的勾线宽度；
    ⑤ 原有像素一律不删不挪；被替换的只有切口最外 2px —— 那 2px 是裁切产生的硬边，本来就不是画出来的。

验收口径沿用 taste.md §H.3 / §M.8：接缝两侧逐列/行中位亮度剖面的最大相邻台阶要落进噪声（0-1）。
本工具自带 seam_step() 量它，读数写进报告，不靠肉眼下结论。

用法：
  python scripts/complete-shape.py --src assets/cards/img/pighub-379.png --inspect
  python scripts/complete-shape.py --src ... --edges bottom --depth 30 --out <预览>
  python scripts/complete-shape.py --src ... --edges right --depth 46 --write assets/img/x.png --backup <目录>

约束（与 taste.md 对齐）：
  * 判据复用 scripts/audit-completeness.py 的 audit()，不复制算法（§H.5）。
  * 只写 assets/img/*.png，不碰 manifest（清单由调用方按 bytes/sha256/size 更新，§J）。
  * 写回前必须给 --backup（§G：没有备份不许写回图片）。
"""
import argparse, json, os, shutil, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_erosion, binary_dilation, distance_transform_edt, median_filter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import importlib.util

def _load_audit():
    spec = importlib.util.spec_from_file_location("audit_completeness", os.path.join(BASE, "scripts", "audit-completeness.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

AUDIT = _load_audit()
EDGES = ("left", "right", "top", "bottom")


# ------------------------------------------------------------------ 量

def edge_runs(mask, edge):
    line = {"top": mask[0, :], "bottom": mask[-1, :], "left": mask[:, 0], "right": mask[:, -1]}[edge]
    runs, cur = [], None
    for i, v in enumerate(line):
        if v and cur is None:
            cur = i
        elif not v and cur is not None:
            runs.append((cur, i - 1, i - cur)); cur = None
    if cur is not None:
        runs.append((cur, len(line) - 1, len(line) - cur))
    return runs

def cut_span(mask, edge, frac=0.45):
    """切口跨度：贴边上最长的连续段，长度 >= frac * 边长（装饰物是窄段，切边是长段）。"""
    runs = edge_runs(mask, edge)
    if not runs:
        return None
    s, e, n = max(runs, key=lambda r: r[2])
    if n < frac * mask.shape[0 if edge in ("left", "right") else 1]:
        return None
    return (s, e)

def confirmed_cuts(rgba):
    """只承认 audit-completeness.py 五条判据全部命中的边（不自己发明判据）。"""
    a = rgba[:, :, 3] > 16
    ys, xs = np.where(a)
    if len(xs) == 0:
        return {}
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    sub = a[y0:y1 + 1, x0:x1 + 1]
    h, w = sub.shape
    out = {}
    for edge in EDGES:
        line = {"top": sub[0, :], "bottom": sub[h - 1, :], "left": sub[:, 0], "right": sub[:, w - 1]}[edge]
        ratio = float(line.mean())
        run, mid = AUDIT.longest_run(line)
        span = run / float(len(line))
        if not (ratio >= 0.55 and span >= 0.45 and 0.25 <= mid <= 0.75):
            continue
        if edge in ("left", "right"):
            ci = 0 if edge == "left" else w - 1
            rm = int(round(mid * (h - 1)))
            depth, x = 0, ci
            step = 1 if edge == "left" else -1
            while 0 <= x < w and sub[rm, x]:
                depth += 1; x += step
            thick = depth / float(w)
        else:
            ri = 0 if edge == "top" else h - 1
            cm = int(round(mid * (w - 1)))
            depth, y = 0, ri
            step = 1 if edge == "top" else -1
            while 0 <= y < h and sub[y, cm]:
                depth += 1; y += step
            thick = depth / float(h)
        if thick >= 0.30:
            sp = cut_span(a, edge, frac=0.45)
            if sp:
                out[edge] = sp
    return out


# ------------------------------------------------------------------ 画

def cap_extent(n, depth, p=1.0):
    """跨度每一行的外扩量：椭圆弧 depth*sqrt(1-t^2)。端点处切线平行于原轮廓 → 接得上。"""
    t = np.linspace(-1.0, 1.0, n)
    return depth * np.power(np.clip(1.0 - t ** 2, 0.0, 1.0), 0.5 * p)

def restrict_to_body(rgba, edge, span, dom, tol=45.0, band=5):
    """把跨度收窄到「猪身真的碰到切口」的那一段/列。
    依据：切口常常同时切过猪身与布景（1087 顶边一段是深蓝三角），把布景也算进端帽会把
    布景的填色当成猪身延伸出去（实测：端帽被染成深蓝）。判据用「切口内侧 band 像素的中位色
    与全图主填色的距离 <= tol」。"""
    lum = 0.299 * rgba[:, :, 0] + 0.587 * rgba[:, :, 1] + 0.114 * rgba[:, :, 2]
    opaque = rgba[:, :, 3] > 16
    dark = lum <= np.percentile(lum[opaque], 8) if opaque.sum() else 0
    body = opaque & ~dark
    d = np.array(dom, dtype=float)
    keep = []
    for s in range(span[0], span[1] + 1):
        if edge in ("bottom", "top"):
            ys = [y for k in range(band) for y in [(rgba.shape[0] - 1 - k if edge == "bottom" else k)]]
            xs = [s]
        else:
            xs = [(rgba.shape[1] - 1 - k if edge == "right" else k) for k in range(band)]
            ys = [s]
        pix = [rgba[y, x, :3].astype(float) for y, x in zip(ys, xs) if 0 <= y < rgba.shape[0] and 0 <= x < rgba.shape[1] and body[y, x]]
        if not pix:
            keep.append(False); continue
        c = np.median(np.stack(pix), axis=0)
        keep.append(bool(np.abs(c - d).max() <= tol))
    # 最长连续段
    best = (0, -1); cur = None
    for i, v in enumerate(keep + [False]):
        if v and cur is None:
            cur = i
        elif not v and cur is not None:
            if i - cur > best[1] - best[0] + 1:
                best = (cur, i - 1)
            cur = None
    if best[1] < best[0]:
        return span
    return (span[0] + best[0], span[0] + best[1])

def cap_mask(shape, edge, span, depth, inner_pos, p=1.0):
    """端帽区域。inner_pos = 画布内侧起点（含）；bottom/right 向索引增大方向长，top/left 向减小方向长。"""
    h, w = shape
    m = np.zeros((h, w), bool)
    n = span[1] - span[0] + 1
    ext = cap_extent(n, depth, p)
    for i in range(n):
        s = span[0] + i
        e = int(np.ceil(ext[i]))
        if e <= 0:
            continue
        if edge == "bottom":
            m[inner_pos:min(h, inner_pos + e), s] = True
        elif edge == "top":
            m[max(0, inner_pos - e + 1):inner_pos + 1, s] = True
        elif edge == "right":
            m[s, inner_pos:min(w, inner_pos + e)] = True
        else:
            m[s, max(0, inner_pos - e + 1):inner_pos + 1] = True
    return m

def _flat_base(rgba, opaque, size=15, tol=12):
    """「平涂区」像素 = 与邻域中位色相差 <= tol 的像素。
    为什么不用「暗/亮」筛：端帽取色要排掉的是**细节**（眼睛、洋红 U 勾线、腮红、布景），
    暗只是细节的一种；659 的右后方端帽第一版就被洋红 U 染出一条粉带（实测），因为洋红不暗。"""
    rgb = rgba[:, :, :3].astype(np.int16)
    med = np.stack([median_filter(rgb[:, :, c], size=size, mode="nearest") for c in range(3)], axis=-1)
    return opaque & (np.abs(rgb - med).max(axis=2) <= tol)

def fill_color_near(rgba, edge, span, band=30, opaque=None):
    """端帽的填色 = 切口内侧 band 内、跨度范围内的**平涂像素众数**。
    为什么不用「最近像素取色」：最近像素会把切口旁边的细节一起搬出去——659 的洋红 U 勾线
    第一版就被拉成一条横贯右后方的粉带（实测，见归档），1087 的深蓝布景被搬成一块蓝板。"""
    opaque = rgba[:, :, 3] > 16 if opaque is None else opaque
    flat = _flat_base(rgba, opaque)
    h, w = rgba.shape[:2]
    if edge in ("left", "right"):
        xs = [x for x in (range(w - band, w) if edge == "right" else range(0, band))]
        pix = [rgba[y, x, :3] for y in range(span[0], span[1] + 1) for x in xs if 0 <= x < w and flat[y, x]]
    else:
        ys = [y for y in (range(h - band, h) if edge == "bottom" else range(0, band))]
        pix = [rgba[y, x, :3] for x in range(span[0], span[1] + 1) for y in ys if 0 <= y < h and flat[y, x]]
    if len(pix) < 30:
        return _dominant_fill(rgba, opaque)
    P = np.stack(pix).astype(np.int32)
    q = P // 8
    key = q[:, 0] * 10000 + q[:, 1] * 100 + q[:, 2]
    vals, counts = np.unique(key, return_counts=True)
    win = vals[np.argmax(counts)]
    sel = key == win
    return tuple(int(v) for v in np.median(P[sel], axis=0))

def fill_from_nearest(rgba, add_mask, opaque, inner_only=True):
    """把 add_mask 里每个像素染成「原图最近的一个纯填色像素」的颜色（不取描边色）。"""
    lum = 0.299 * rgba[:, :, 0] + 0.587 * rgba[:, :, 1] + 0.114 * rgba[:, :, 2]
    base = _flat_base(rgba, opaque) if inner_only else opaque.copy()
    if inner_only:
        # 腐蚀要足够深：裁切/去底会在切口内侧留 4-8px 的边缘压暗，取到那里就会给端帽染上一条更深
        # 的色带，接缝处于是出现一条「台阶线」（341 第一版就是这么失败）。用图幅的 3.5% 当腐蚀深度。
        n_er = max(4, int(round(min(rgba.shape[:2]) * 0.035)))
        er = binary_erosion(opaque, iterations=n_er)
        if er.sum() > 50:
            base = er
        if opaque.sum():
            dark = lum <= np.percentile(lum[opaque], 8)
            base = base & ~dark
        if base.sum() < 20:
            base = opaque
    idx = distance_transform_edt(~base, return_distances=False, return_indices=True)
    ys, xs = np.where(add_mask)
    out = rgba.copy()
    out[ys, xs, :3] = rgba[idx[0][ys, xs], idx[1][ys, xs], :3]
    out[ys, xs, 3] = 255
    return out

def outline_rgb(rgba, opaque, q=4.0):
    """描边颜色：全图最暗 4% 中位色（猪自己的勾线）。"""
    lum = 0.299 * rgba[:, :, 0] + 0.587 * rgba[:, :, 1] + 0.114 * rgba[:, :, 2]
    if opaque.sum() == 0:
        return (60, 40, 40)
    cut = np.percentile(lum[opaque], q)
    sel = opaque & (lum <= cut)
    if sel.sum() < 20:
        return (60, 40, 40)
    return tuple(int(v) for v in np.median(rgba[sel][:, :3], axis=0))

def outline_width(rgba, opaque):
    """描边宽度：从 alpha 边界向内、亮度低于轮廓色的连续像素数，取中位数。"""
    lum = 0.299 * rgba[:, :, 0] + 0.587 * rgba[:, :, 1] + 0.114 * rgba[:, :, 2]
    if opaque.sum() == 0:
        return 3.0
    thr = np.percentile(lum[opaque], 12)
    widths = []
    h, w = opaque.shape
    for x in range(2, w - 2, 7):
        col = np.where(opaque[:, x])[0]
        if len(col) == 0:
            continue
        for y, step in ((col.min(), 1), (col.max(), -1)):
            k, yy = 0, y
            while 0 <= yy < h and opaque[yy, x] and lum[yy, x] <= thr and k < 12:
                k += 1; yy += step
            if k:
                widths.append(k)
    return float(np.median(widths)) if widths else 3.0

def _edge_band(shape, edge, span, inner_pos, width=2):
    """贴边的一条带（腹线用）：在 span 范围内、从 inner_pos 起宽 width 像素。"""
    h, w = shape
    m = np.zeros((h, w), bool)
    a0, a1 = span
    if edge == "bottom":
        m[max(0, inner_pos - width + 1):inner_pos + 1, a0:a1 + 1] = True
    elif edge == "top":
        m[max(0, inner_pos - width + 1):inner_pos + 1, a0:a1 + 1] = True
    elif edge == "right":
        m[a0:a1 + 1, max(0, inner_pos - width + 1):inner_pos + 1] = True
    else:
        m[a0:a1 + 1, max(0, inner_pos - width + 1):inner_pos + 1] = True
    return m

def absorb_zone(rgba, shape, edge, span, fc, P, h, w, max_ext=26, tol=8):
    """切口内侧「与平涂色差 > tol」的那几列/行也一起刷成平涂色。
    它们是裁切/去底留下的边缘压暗，留着就会在端帽旁边排成一条竖线/横线（341 第一版）。"""
    m = np.zeros(shape, bool)
    fc = np.array(fc, dtype=int)
    if edge in ("left", "right"):
        x_edge = (w - 1) if edge == "right" else 0
        step = -1 if edge == "right" else 1
        for y in range(span[0], span[1] + 1):
            close_run = 0
            for k in range(max_ext):
                x = x_edge + step * k
                if not (0 <= x < w):
                    break
                if not (rgba[y, x, 3] > 16):
                    continue
                if np.abs(rgba[y, x, :3].astype(int) - fc).max() <= tol:
                    close_run += 1
                    if close_run >= 2:      # 连续 2 行已经回到平涂色才停：单行的深色描边残段要一起吃掉（1099 实测）
                        break
                    continue
                close_run = 0
                m[y + P, x + P] = True
    else:
        y_edge = (h - 1) if edge == "bottom" else 0
        step = -1 if edge == "bottom" else 1
        for x in range(span[0], span[1] + 1):
            close_run = 0
            for k in range(max_ext):
                y = y_edge + step * k
                if not (0 <= y < h):
                    break
                if not (rgba[y, x, 3] > 16):
                    continue
                if np.abs(rgba[y, x, :3].astype(int) - fc).max() <= tol:
                    close_run += 1
                    if close_run >= 2:
                        break
                    continue
                close_run = 0
                m[y + P, x + P] = True
    return m


def despeckle_band(out, edge, span, fc, P, h, w, band=26, tol=30, gap=2):
    """切口带内做一次 1D「去线」：只吃掉「两侧 gap 像素都等于平涂色」的孤立异色行/列。
    为什么需要：裁切留下的描边残段有时只剩 1 行（1099 底边 y=469 实测），
    吸收带按「连续 2 行平涂色就停」的规则走不到它，留下一条 1px 深线（3 倍放大看得见）。"""
    fc = np.array(fc, dtype=int)
    a = out.astype(int)
    if edge in ("left", "right"):
        x_edge = (P + w - 1) if edge == "right" else P
        step = -1 if edge == "right" else 1
        for y in range(span[0] + P, span[1] + P + 1):
            for k in range(1, band):
                x = x_edge + step * k
                x1 = x + step * gap
                x2 = x - step * gap
                if not (0 <= x1 < out.shape[1] and 0 <= x2 < out.shape[1] and 0 <= x < out.shape[1]):
                    break
                if a[y, x, 3] < 200:
                    continue
                nb = a[y, max(0, x - 4):x + 5, :3]
                if np.abs(a[y, x, :3] - fc).max() > tol and len(nb) >= 3 and                    np.abs(np.median(nb, axis=0) - fc).max() <= tol:
                    out[y, x, 0] = fc[0]; out[y, x, 1] = fc[1]; out[y, x, 2] = fc[2]
    else:
        y_edge = (P + h - 1) if edge == "bottom" else P
        step = -1 if edge == "bottom" else 1
        for x in range(span[0] + P, span[1] + P + 1):
            for k in range(1, band):
                y = y_edge + step * k
                y1 = y + step * gap
                y2 = y - step * gap
                if not (0 <= y1 < out.shape[0] and 0 <= y2 < out.shape[0] and 0 <= y < out.shape[0]):
                    break
                if a[y, x, 3] < 200:
                    continue
                nb = a[max(0, y - 4):y + 5, x, :3]
                if np.abs(a[y, x, :3] - fc).max() > tol and len(nb) >= 3 and                    np.abs(np.median(nb, axis=0) - fc).max() <= tol:
                    out[y, x, 0] = fc[0]; out[y, x, 1] = fc[1]; out[y, x, 2] = fc[2]
    return out

def composite(rgba, cuts, depths, stroke_w=None, inset=2, p=1.0, legs=None, leg_depth=46, belly_w=2):
    """在四周加 pad 后合成端帽/腿，再裁回内容框。返回 (新图, 信息)。
    量跨度 -> 只留猪身那一段 -> 建端帽与腿 -> 平涂（每个切口一个色）-> 描新轮廓 -> 保原勾线 -> 羽化 -> 裁框。"""
    h, w = rgba.shape[:2]
    P = int(np.ceil(max(list(depths) + ([leg_depth] if legs else [0])))) + 8
    opaque0 = rgba[:, :, 3] > 16
    dom = _dominant_fill(rgba, opaque0)
    spans = {}
    for edge in cuts:
        sp = cut_span(opaque0, edge, frac=0.45)
        if sp is not None:
            spans[edge] = restrict_to_body(rgba, edge, sp, dom)
    big = np.zeros((h + 2 * P, w + 2 * P, 4), np.uint8)
    big[P:P + h, P:P + w] = rgba
    opaque = big[:, :, 3] > 16
    Z = big.shape[:2]
    inner_of = {"bottom": lambda: P + h - 1 - inset, "top": lambda: P + inset,
                "right": lambda: P + w - 1 - inset, "left": lambda: P + inset}
    add = np.zeros(Z, bool)
    zones = []                     # [(mask, color)]，后写的盖前面的
    for edge, d in zip(cuts, depths):
        if edge not in spans:
            continue
        fc = fill_color_near(rgba, edge, spans[edge])
        span = (spans[edge][0] + P, spans[edge][1] + P)
        zone = absorb_zone(rgba, Z, edge, spans[edge], fc, P, h, w)
        if d > 0:
            zone |= cap_mask(Z, edge, span, d, inner_of[edge](), p=p)
        add |= zone
        zones.append((zone, fc))
        if legs and edge in ("bottom", "top"):
            for (a0, a1) in legs:
                lg = cap_mask(Z, edge, (a0 + P, a1 + P), leg_depth, inner_of[edge](), p=0.25)
                add |= lg
                zones.append((lg, fc))
    # 相邻两条切口共用一个角时（右+顶、左+底…），两个椭圆弧在角上接不起来，会留下一个方角缺口。
    # 在共用顶点补一块四分之一圆，把角磨圆（27/1087/255 实测都是这个形状）。
    cmb = {"right": "r", "left": "l", "top": "t", "bottom": "b"}
    for e1 in spans:
        for e2 in spans:
            if not (cmb[e1] in "rl" and cmb[e2] in "tb"):
                continue
            d1, d2 = dict(zip(cuts, depths)).get(e1, 0), dict(zip(cuts, depths)).get(e2, 0)
            r = min(d1, d2) * 0.92
            if r < 3:
                continue
            cx = (P + w - 1) if cmb[e1] == "r" else P
            cy = P if cmb[e2] == "t" else (P + h - 1)
            yy, xx = np.mgrid[max(0, int(cy - r)):min(Z[0], int(cy + r) + 1),
                              max(0, int(cx - r)):min(Z[1], int(cx + r) + 1)]
            disc = ((xx - cx) ** 2 + (yy - cy) ** 2) <= r * r
            m = np.zeros(Z, bool)
            m[max(0, int(cy - r)):min(Z[0], int(cy + r) + 1),
              max(0, int(cx - r)):min(Z[1], int(cx + r) + 1)] = disc
            add |= m
            zones.append((m, fill_color_near(rgba, e1, spans[e1])))
    belly = np.zeros(Z, bool)
    if legs and belly_w > 0 and depths and max(depths) <= 3:
        for edge in spans:
            if edge in ("bottom", "top"):
                # 腹线要画在**原图切口那条线**上（那里本来就有裁切留下的描边），而不是内缩 inset 的位置：
                # 位置差 6px 就会变成「多出来的一条黑线」（868 实测：新线在 238、原线在 245）。
                belly |= _edge_band(Z, edge, (spans[edge][0] + P, spans[edge][1] + P),
                                    inner_pos=(P + h - 1) if edge == "bottom" else P, width=belly_w)
    if add.any():
        out = big.copy()
        for m, fc in zones:
            out[m, 0] = fc[0]; out[m, 1] = fc[1]; out[m, 2] = fc[2]; out[m, 3] = 255
        sw = outline_width(big, opaque) if stroke_w is None else float(stroke_w)
        sw = max(1.0, min(6.0, sw))
        oc = outline_rgb(big, opaque)
        near_orig = binary_dilation(opaque, iterations=2)
        ring = add & ~binary_erosion(add, iterations=max(1, int(round(sw))))
        # 与原有内容相邻的那一圈不当轮廓（否则沿切口画出一条直线）；有腿时「腿间腹线」例外
        ring = ring & ~(near_orig & ~belly) if belly.any() else ring & ~near_orig
        out[ring, 0] = oc[0]; out[ring, 1] = oc[1]; out[ring, 2] = oc[2]; out[ring, 3] = 255
        if belly.any():
            bc = contour_color(big, opaque)   # 腹线用轮廓色：868 的最暗 4% 是黑手臂，直接用会把腹线画成纯黑
            out[belly, 0] = bc[0]; out[belly, 1] = bc[1]; out[belly, 2] = bc[2]; out[belly, 3] = 255
        # 保住猪自己的勾线（端帽会盖住切口最外几列上的侧边描边），但切口最外 3px 的暗线是裁切边，要吃掉
        lum_big = 0.299 * big[:, :, 0] + 0.587 * big[:, :, 1] + 0.114 * big[:, :, 2]
        near_cut = np.zeros(Z, bool)
        for edge in spans:
            near_cut |= _edge_band(Z, edge, (spans[edge][0] + P, spans[edge][1] + P),
                                   inner_pos={"bottom": P + h - 1, "top": P,
                                              "right": P + w - 1, "left": P}[edge], width=3)
        keep = opaque & (lum_big <= np.percentile(lum_big[opaque], 12)) & add & ~near_cut
        out[keep] = big[keep]
        # 去线必须在 keep 之后：keep 会把原图切口内侧的深色描边残段还原回来（1099 的 y=469 就是被它盖回去的）
        for edge in spans:
            out = despeckle_band(out, edge, spans[edge], fill_color_near(rgba, edge, spans[edge]), P, h, w)
        outer = add & ~binary_erosion(add, iterations=1)
        a = out[:, :, 3].astype(np.float32)
        a[outer] = np.minimum(a[outer], 240.0)
        out[:, :, 3] = np.clip(a, 0, 255).astype(np.uint8)
    else:
        out = big
        sw, oc = 0.0, (0, 0, 0)
    res = Image.fromarray(out, "RGBA")
    bbox = res.split()[3].getbbox()
    if bbox:
        res = res.crop(bbox)
    info = {"added": int(add.sum()), "spans": spans, "stroke": round(sw, 2), "outline": oc,
            "pad": P, "trim": bbox,
            "origin": [(P - (bbox[0] if bbox else 0)), (P - (bbox[1] if bbox else 0))]}
    return res, info


# ------------------------------------------------------------------ 接身法（胸像 → 整猪）

def _dominant_fill(rgba, opaque, dark_pct=8):
    """猪身主色：不透明像素里去掉最暗 dark_pct% 之后的中位色（勾线/眼睛不算）。"""
    lum = 0.299 * rgba[:, :, 0] + 0.587 * rgba[:, :, 1] + 0.114 * rgba[:, :, 2]
    if opaque.sum() == 0:
        return (250, 210, 180)
    thr = np.percentile(lum[opaque], dark_pct)
    sel = opaque & (lum > thr)
    if sel.sum() < 50:
        sel = opaque
    return tuple(int(v) for v in np.median(rgba[sel][:, :3].reshape(-1, 3), axis=0))

def contour_color(rgba, opaque, band=2):
    """头像**轮廓**的颜色：离 alpha 边界 band px 以内的不透明像素中位色。
    接身法要用它而不是「最暗 4%」——104/481 的头顶是黑毛线帽，取最暗会把身体描成黑线，
    而它们的轮廓其实是淡粉色（实测）。"""
    edge = opaque & ~binary_erosion(opaque, iterations=band)
    if edge.sum() < 30:
        return outline_rgb(rgba, opaque)
    return tuple(int(v) for v in np.median(rgba[edge][:, :3], axis=0))

def body_graft(rgba, torso_w=0.86, torso_h=0.52, leg_n=2, leg_w=0.16, leg_h=0.20,
               stroke_w=None, oc=None, fill=None, dx=0.0, top_frac=0.10):
    """给「只有头」的胸像接一个身体：躯干椭圆 + 若干圆底腿。
    关键：**头原样压在躯干之上**，躯干比头窄，接缝被头自己的轮廓盖住 → 结构上不存在接缝。
    torso_w/torso_h/leg_w/leg_h 都是相对「头宽」的比例；leg_h 相对头高。
    返回 (新图, 信息)。"""
    h, w = rgba.shape[:2]
    opaque = rgba[:, :, 3] > 16
    if opaque.sum() == 0:
        return Image.fromarray(rgba, "RGBA"), {}
    ys, xs = np.where(opaque)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    head_w = x1 - x0 + 1
    head_h = y1 - y0 + 1
    fill = fill or _dominant_fill(rgba, opaque)
    oc = oc or contour_color(rgba, opaque)
    sw = outline_width(rgba, opaque) if stroke_w is None else float(stroke_w)
    sw = max(1.0, min(6.0, sw))
    tw = torso_w * head_w
    th = torso_h * head_w
    # 躯干中心：水平取头下半部的重心，垂直自「头底 + top_frac*th」起
    lower = opaque[int(y0 + 0.72 * head_h):y1 + 1, :]
    cx = float(np.mean(np.where(lower)[1])) if lower.any() else (x0 + x1) / 2.0
    cx += dx * head_w
    cy = y1 + th / 2.0 - top_frac * th
    P = int(np.ceil(max(8.0, tw / 2.0 - head_w / 2.0))) + 8
    OY = P
    bottom = cy + th / 2.0 + leg_h * head_h + 14
    W2 = w + 2 * P
    H2 = OY + int(np.ceil(max(h, bottom))) + 14
    S = 4
    canvas = Image.new("L", (W2 * S, H2 * S), 0)
    d = ImageDraw.Draw(canvas)
    def sc(v):
        return int(round(v * S))
    # 躯干
    d.ellipse([sc(cx - tw / 2 + P), sc(cy - th / 2 + OY), sc(cx + tw / 2 + P), sc(cy + th / 2 + OY)], fill=255)
    leg_top = cy + th / 2 - 0.10 * th
    leg_bot = cy + th / 2 + leg_h * head_h
    lw = leg_w * head_w
    xs_legs = []
    if leg_n == 2:
        offs = [-0.22, 0.22]
    elif leg_n == 4:
        offs = [-0.33, -0.13, 0.13, 0.33]
    else:
        offs = [0.0]
    for o in offs:
        lx = cx + o * tw
        xs_legs.append((lx - lw / 2, lx + lw / 2))
        d.rounded_rectangle([sc(lx - lw / 2 + P), sc(leg_top + OY), sc(lx + lw / 2 + P), sc(leg_bot + OY)],
                            radius=sc(lw * 0.45), fill=255)
    body_mask = np.asarray(canvas.resize((W2, H2), Image.BOX), dtype=np.float32) / 255.0
    # 描边：body 的内边界
    bm = body_mask > 0.5
    ring = bm & ~binary_erosion(bm, iterations=max(1, int(round(sw))))
    out = np.zeros((H2, W2, 4), np.uint8)
    a = (body_mask * 255).astype(np.uint8)
    out[:, :, 0] = fill[0]; out[:, :, 1] = fill[1]; out[:, :, 2] = fill[2]; out[:, :, 3] = a
    out[ring & (body_mask > 0.5), 0] = oc[0]
    out[ring & (body_mask > 0.5), 1] = oc[1]
    out[ring & (body_mask > 0.5), 2] = oc[2]
    # 头压在身体上（原样搬运，alpha 合成）
    ha = rgba[:, :, 3].astype(np.float32) / 255.0
    hy, hx = P, OY
    region = out[hy:hy + h, hx:hx + w].astype(np.float32)
    for c in range(3):
        region[:, :, c] = region[:, :, c] * (1 - ha) + rgba[:, :, c] * ha
    region[:, :, 3] = np.clip(region[:, :, 3] * (1 - ha) + 255 * ha, 0, 255)
    out[hy:hy + h, hx:hx + w] = region.astype(np.uint8)
    res = Image.fromarray(out, "RGBA")
    bbox = res.split()[3].getbbox()
    if bbox:
        res = res.crop(bbox)
    info = {"origin": [P - (bbox[0] if bbox else 0), OY - (bbox[1] if bbox else 0)],
            "head_w": int(head_w), "head_h": int(head_h), "torso": [round(tw, 1), round(th, 1)],
            "torso_center": [round(cx, 1), round(cy, 1)], "legs": [[round(a_, 1), round(b_, 1)] for a_, b_ in xs_legs],
            "leg_y": [round(leg_top, 1), round(leg_bot, 1)], "fill": list(fill), "outline": list(oc),
            "stroke": round(sw, 2), "bra": "接身法：躯干椭圆 + 圆底腿，头原样压在上面"}
    return res, info


# ------------------------------------------------------------------ 验

def seam_step(img, axis, coord, win=8):
    """taste.md §H.3 口径：接缝两侧 ±win 的中位亮度剖面里，最大与次大相邻台阶。"""
    a = np.array(img, dtype=np.float32)
    al = a[:, :, 3] > 200
    lum = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    prof = []
    if axis == "v":
        for x in range(max(0, coord - win), min(a.shape[1], coord + win + 1)):
            col = lum[:, x][al[:, x]]
            prof.append((x, float(np.median(col)) if len(col) else np.nan))
    else:
        for y in range(max(0, coord - win), min(a.shape[0], coord + win + 1)):
            row = lum[y, :][al[y, :]]
            prof.append((y, float(np.median(row)) if len(row) else np.nan))
    steps = []
    for i in range(1, len(prof)):
        a0, v0 = prof[i - 1]; a1, v1 = prof[i]
        if np.isnan(v0) or np.isnan(v1):
            continue
        steps.append((abs(v1 - v0), a1))
    if not steps:
        return (0.0, None, 0.0)
    steps.sort(reverse=True)
    return (round(steps[0][0], 2), steps[0][1], round(steps[1][0], 2) if len(steps) > 1 else 0.0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--edges", default="")
    ap.add_argument("--depth", default="")
    ap.add_argument("--stroke", type=float, default=None)
    ap.add_argument("--inset", type=int, default=2)
    ap.add_argument("--legs", default="", help="底/顶切口长腿：跨度内的列区间，如 41:75,95:131,151:185")
    ap.add_argument("--legh", type=float, default=46.0)
    ap.add_argument("--belly", type=int, default=2, help="腹线宽度（px），0 = 不画")
    ap.add_argument("--out")
    ap.add_argument("--write")
    ap.add_argument("--backup")
    ap.add_argument("--inspect", action="store_true")
    args = ap.parse_args()
    im = Image.open(args.src); im.seek(0); rgba = np.array(im.convert("RGBA"))
    h, w = rgba.shape[:2]
    print("src %s  %dx%d" % (os.path.basename(args.src), w, h))
    cuts = confirmed_cuts(rgba)
    print("confirmed cuts:", cuts)
    if args.inspect or not args.edges:
        for e in EDGES:
            print("  %-6s span=%s confirmed=%s" % (e, cut_span(rgba[:, :, 3] > 16, e), e in cuts))
        sys.exit(0)
    edges = [e for e in args.edges.split(",") if e]
    depths = [float(d) for d in args.depth.split(",")] if args.depth else [20.0] * len(edges)
    legs = [tuple(int(v) for v in p.split(":")) for p in args.legs.split(",") if p]
    res, info = composite(rgba, edges, depths, stroke_w=args.stroke, inset=args.inset,
                          legs=legs or None, leg_depth=args.legh, belly_w=args.belly)
    print("composite: added=%d stroke=%.2f outline=%s trim=%s spans=%s" % (
        info["added"], info["stroke"], info["outline"], info["trim"], info["spans"]))
    for edge in edges:
        span = info["spans"].get(edge)
        if not span:
            continue
        t = info["trim"]
        if edge in ("left", "right"):
            coord = (w - 1 - args.inset) - (t[0] if t else 0)
            print("  seam v @x=%d -> %s" % (coord, seam_step(res, "v", coord)))
        else:
            coord = (h - 1 - args.inset) - (t[1] if t else 0)
            print("  seam h @y=%d -> %s" % (coord, seam_step(res, "h", coord)))
    print("out size %dx%d" % res.size)
    if args.out:
        res.save(args.out); print("->", args.out)
    if args.write:
        if args.backup and os.path.exists(args.write):
            os.makedirs(args.backup, exist_ok=True)
            shutil.copy2(args.write, os.path.join(args.backup, os.path.basename(args.write)))
        res.save(args.write); print("wrote", args.write)
