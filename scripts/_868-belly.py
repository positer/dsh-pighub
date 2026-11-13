#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pighub-868 腹底收口（_ 前缀 = 一次性探针，不进管线；可由 archive/fix-868-belly.md 复跑）。

为什么要有这个脚本（两次失败的原因写在前面，避免第三次走老路）：
  v1「抹掉暗行」：只把 246/247 两行亮度插值回体色，alpha 轮廓仍是横贯 200px 的
     平切直边——直边是**形状**问题，不是亮度问题，所以必然看不见改善。
  v2「在平边上补一段正弦腹弧」：在已有直边下方按正弦填一条带子，带子与两腿之间
     的缝对不齐，于是腿间出现楔形色块，身体中部留下游离深色碎线。
  本脚本的做法（v3）：**先重定义剪影，再按剪影重画一圈描边**。剪影由一条底部曲线
  ybot(x) 给出（身体部分）+ 两腿各自的既有底边（腿部分）合成；描边/填色由这条剪影
  的「到边界距离」决定，所以不存在"补出来的带子"与"原有直边"两张皮。

口径（全部可复核）：
  * 体色取原图众数 (245,211,181)；
  * 描边取原图腹底那两行的实际像素 (81,70,60) / (163,140,120)，它们正是
    描边色 (53,32,26) 在体色上 85% / 45% 混合的结果，与侧边（x=27/28）同源；
  * 已经在暗处（亮度<100）的描边像素一律保留原色，所以两腿原有的黑描边不动。

用法：
  python scripts/_868-belly.py --dry-run              # 只出候选与读数，不写 assets/img
  python scripts/_868-belly.py --write                # 写 assets/img/pighub-868.png
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "assets", "img", "pighub-868.png")
ARCHIVE = "20261113-235843-fix-868-belly"   # 归档目录：汇报与复跑产物都落在它下面

FILL = (245, 211, 181)
OUT_DARK = (81, 70, 60)      # 边界最外 1px（原图腹底 247 行的实际像素）
OUT_MID = (163, 140, 120)    # 边界第 2px（原图腹底 246 行的实际像素）
EDGE_ALPHA = 240             # 原图剪影最外一圈的 alpha

# 身体底部曲线控制点 (x, ybot)。x=27..227 是身体在腹部的左右外沿；
# 两条腿占 x=71..119 与 141..189，腿区间内 ybot 无视觉作用（腿更长），只参与插值求光滑。
# 左右肩关于身体中心 x=127 镜像；腿间那段（x=120..140）关于腿缝中心 x=130 对称。
# 腿区间（71..119 / 141..189）里的 ybot 没有视觉作用（腿比它长得多），只参与插值求光滑。
BODY_CURVE = [
    (29, 240), (34, 246), (40, 249.5), (48, 252), (56, 253.5), (64, 254.3),
    (71, 254.8), (95, 255.2), (119, 254.9),
    (125, 251.2), (130, 249.0), (135, 251.2),
    (141, 254.9), (165, 255.2), (183, 254.8), (190, 254.3), (198, 253.5),
    (206, 252), (214, 249.5), (220, 246), (225, 240),
]
# x=29..225 是身体在腹部**实心**（alpha>128）的左右外沿；x=28/226 只是 alpha 34~124 的抗锯齿残影。
XL, XR = 29, 225
# 只改这一行及以下。落在这里的理由：236~239 行原图 x=28/226 还是 alpha>128 的实体边，
# 改到那里会让侧边出现 1px 台阶；240 行的 x=28 只有 alpha 34，抹掉看不见。
Y0 = 240
LEG_SPANS = [(71, 119), (141, 189)]


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def ybot_curve(xs):
    """单调保形三次 Hermite（Fritsch–Carlson 的 PCHIP）。本运行时没有 scipy，
    所以自己实现——它不会在控制点之间过冲，直边不会因为插值又被抹平或被拱起。"""
    cx = np.array([p[0] for p in BODY_CURVE], float)
    cy = np.array([p[1] for p in BODY_CURVE], float)
    n = len(cx)
    h = np.diff(cx)
    d = np.diff(cy) / h
    m = np.zeros(n)
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    x = xs.astype(float)
    k = np.clip(np.searchsorted(cx, x, side="right") - 1, 0, n - 2)
    t = (x - cx[k]) / h[k]
    t2, t3 = t * t, t * t * t
    h00 = 2 * t3 - 3 * t2 + 1
    h10 = t3 - 2 * t2 + t
    h01 = -2 * t3 + 3 * t2
    h11 = t3 - t2
    return h00 * cy[k] + h10 * h[k] * m[k] + h01 * cy[k + 1] + h11 * h[k] * m[k + 1]


def erode(m):
    """8 邻接腐蚀一格；边界外视为背景。"""
    out = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            s = np.zeros_like(m)
            ys = slice(max(0, dy), m.shape[0] + min(0, dy))
            xs = slice(max(0, dx), m.shape[1] + min(0, dx))
            yd = slice(max(0, -dy), m.shape[0] + min(0, -dy))
            xd = slice(max(0, -dx), m.shape[1] + min(0, -dx))
            s[ys, xs] = m[yd, xd]
            out &= s
    return out


def build_mask(shape):
    """剪影 = { (x,y) : y <= ybot_full(x) }，ybot_full = max(身体曲线, 该列腿的既有底边)。"""
    H, W = shape
    xs = np.arange(W)
    yb = np.full(W, -1e9)
    sel = (xs >= XL) & (xs <= XR)
    yb[sel] = ybot_curve(xs[sel])
    cur = load(SRC)
    al = cur[:, :, 3]
    for (a, b) in LEG_SPANS:
        for x in range(a, b + 1):
            ys = np.nonzero(al[248:, x] > 16)[0]
            if len(ys):
                yb[x] = max(yb[x], 248 + ys.max())
    return yb


def render(cur, yb):
    H, W = cur.shape[:2]
    out = cur.copy()
    yy = np.arange(H)[:, None]
    M = (yy <= yb[None, :])
    M[:Y0, :] = cur[:Y0, :, 3] > 16         # 上方保持原剪影
    M[:, :XL] = False
    M[:, XR + 1:] = False

    e1 = erode(M)
    e2 = erode(e1)
    band1 = M & ~e1
    band2 = e1 & ~e2
    inner = e2

    zone = (yy >= Y0)
    lum = 0.299 * cur[:, :, 0] + 0.587 * cur[:, :, 1] + 0.114 * cur[:, :, 2]

    def put(mask, rgb, alpha):
        m = mask & zone
        out[..., 0][m] = rgb[0]
        out[..., 1][m] = rgb[1]
        out[..., 2][m] = rgb[2]
        out[..., 3][m] = alpha

    # 1) 剪影外：清空
    clr = (~M) & zone
    out[clr] = 0
    # 2) 内部：一律体色（这一步把 246/247 的暗行、被埋进身体的腿描边全洗掉）
    put(inner, FILL, 255)
    # 3) 描边：原本已暗的像素保留原色（两腿的 1,1,1 黑描边因此不动）
    # 只保留**真的不透明**的暗像素（alpha>128）。原图 x=27/28 那种 alpha 4~124 的边缘残影
    # 亮度也是暗的，若一并保留，新描边会沿这几列出现一串残缺缺口。
    keep = (band1 | band2) & (lum < 100) & (cur[:, :, 3] > 128)
    for band, rgb, alpha in ((band1, OUT_DARK, EDGE_ALPHA), (band2, OUT_MID, 255)):
        m = band & zone & ~keep
        put(m, rgb, alpha)
    return out, M


def seam_step(arr, coord=247, win=8):
    """taste.md §H.3 / scripts/_verify-completion.py 的 profile_steps(axis='h') 原样口径：
    窗口内**每一行都不透明**的列才参与，逐行取中位亮度，报最大相邻台阶与接缝列台阶。"""
    a = arr.astype(np.float32)
    al = a[:, :, 3] > 200
    L = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    ys = range(max(0, coord - win), min(a.shape[0], coord + win + 1))
    cols = [x for x in range(a.shape[1]) if all(al[y, x] for y in ys)]
    if len(cols) < 8:
        return {"error": "too few fully-opaque cols", "cols": len(cols)}
    prof = [(y, float(np.median(L[y, cols]))) for y in ys]
    steps = [(abs(prof[i + 1][1] - prof[i][1]), prof[i + 1][0]) for i in range(len(prof) - 1)]
    mx, at = max(steps)
    return {"coord": coord, "cols": len(cols), "col_lo": cols[0], "col_hi": cols[-1],
            "max_step": round(mx, 2), "max_step_at": int(at),
            "step_at_seam": round([s for s, c in steps if c == coord][0], 2) if any(c == coord for _, c in steps) else None,
            "median_step": round(float(np.median([s for s, _ in steps])), 2)}


def bottom_profile(arr, x0, x1):
    """每一列最下面的不透明 y（剪影底缘）。"""
    al = arr[:, :, 3] > 16
    out = []
    for x in range(x0, x1 + 1):
        ys = np.nonzero(al[:, x])[0]
        out.append(int(ys.max()) if len(ys) else -1)
    return np.array(out)


def flat_run(bot):
    """底缘上最长的一段**完全水平**（同一 y 连续）的列数——「横贯的平切直边」的量化。"""
    best = cur = 1
    for i in range(1, len(bot)):
        cur = cur + 1 if bot[i] == bot[i - 1] else 1
        best = max(best, cur)
    return int(best)


def near_flat_run(bot):
    """最长的一段「看起来像一条直线」的列数：该段内底缘的极差 <= 1px。
    flat_run 是量化后的严格口径，这个是更接近肉眼的宽容口径，两个都报。"""
    n = len(bot)
    best = 1
    for i in range(n):
        for j in range(i + 1, n):
            if bot[j] >= 0 and bot[i:j + 1].max() - bot[i:j + 1].min() <= 1:
                best = max(best, j - i + 1)
            else:
                break
    return int(best)


def stray_dark(arr, M, zone_y0, near=4):
    """剪影内部、离边界 >near 的暗像素个数（游离碎线）。应当为 0。"""
    inner = M.copy()
    for _ in range(near):
        inner = erode(inner)
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    yy = np.arange(arr.shape[0])[:, None] * np.ones((1, arr.shape[1]), bool)
    return int((inner & (lum < 100) & (yy >= zone_y0)).sum())


def audit_of(arr, path_tmp):
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "audit_completeness", os.path.join(BASE, "scripts", "audit-completeness.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    Image.fromarray(arr, "RGBA").save(path_tmp)
    return mod.audit(path_tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--tag", default="cand")
    ap.add_argument("--baseline", default=os.path.join(BASE, "archive", "asset-backup", "pighub-868.before-bellyfix.png"),
                    help="「改之前」的对照图；复跑时用它给出可复现的前后读数")
    ap.add_argument("--out", default=os.path.join(BASE, "archive", ARCHIVE, "rerun"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    cur = load(SRC)
    pres = load(args.baseline) if os.path.exists(args.baseline) else cur
    yb = build_mask(cur.shape[:2])
    new, M = render(cur, yb)

    changed = int((cur != new).any(axis=2).sum())
    print("in :", os.path.relpath(SRC, BASE), " baseline:", os.path.relpath(args.baseline, BASE) if os.path.exists(args.baseline) else "(缺失=用当前图)")
    print("changed px (输入 -> 产物):", changed)
    print("seam step  baseline        :", json.dumps(seam_step(pres)))
    print("seam step  after           :", json.dumps(seam_step(new)))
    ref = os.path.join(BASE, "archive", "20261113-223028-complete-all-pigs", "after", "pighub-868.png")
    if os.path.exists(ref):
        print("seam step  reference(archive after):", json.dumps(seam_step(load(ref))))
    # 只看「身体」那几段（腿的圆底本来就有水平段，不算切边）
    body_cols = [x for x in range(XL, XR + 1) if not any(a <= x <= b for a, b in LEG_SPANS)]
    p0 = bottom_profile(pres, XL, XR)
    p1 = bottom_profile(new, XL, XR)
    idx = [x - XL for x in body_cols]
    print("belly(非腿列) 严格平段  before: %d cols   after: %d cols" % (
        flat_run(p0[idx]), flat_run(p1[idx])))
    print("belly(非腿列) 视近平直(极差<=1px)  before: %d cols   after: %d cols" % (
        near_flat_run(p0[idx]), near_flat_run(p1[idx])))
    print("belly(非腿列) bottom  before:", " ".join(str(v) for v in p0[idx][::4]))
    print("belly(非腿列) bottom  after :", " ".join(str(v) for v in p1[idx][::4]))
    print("bottom ybot range: %.1f .. %.1f" % (float(yb[XL:XR + 1].min()), float(yb[XL:XR + 1].max())))
    print("stray dark px (inside new silhouette, >4px from edge, y>=%d)  baseline: %d  after: %d" % (
        Y0, stray_dark(pres, M, Y0), stray_dark(new, M, Y0)))
    tmp = os.path.join(args.out, "_audit_tmp.png")
    print("audit baseline:", json.dumps(audit_of(pres, tmp)))
    print("audit after :", json.dumps(audit_of(new, tmp)))

    p = os.path.join(args.out, args.tag + ".png")
    Image.fromarray(new, "RGBA").save(p)
    # 目检图：2x 全图 + 腹底 3x
    def onbg(im, c=(236, 236, 236)):
        bg = Image.new("RGBA", im.size, c + (255,))
        bg.alpha_composite(im)
        return bg.convert("RGB")
    full = onbg(Image.fromarray(new, "RGBA"))
    full.resize((full.width * 2, full.height * 2), Image.NEAREST).save(os.path.join(args.out, args.tag + "2x.png"))
    band = full.crop((20, 225, 236, 273))
    band.resize((band.width * 3, band.height * 3), Image.NEAREST).save(os.path.join(args.out, args.tag + "-belly3x.png"))
    print("cand ->", p)
    if args.write:
        Image.fromarray(new, "RGBA").save(SRC)
        print("WRITTEN", SRC)


if __name__ == "__main__":
    main()
