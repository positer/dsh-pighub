"""
临时探针（不进管线）：素材批次 B 的切边放大 + 逐边独立挤出预览 + 接缝量化。

为什么单独写而不是改 extrude-complete.py：
  1. 官方脚本一次只做一条边、且直接读写 assets/img；判断「这条边该不该补」需要先把每条边
     **从原图独立**预览一次（链式预览会把前一条边的结果带进来，混淆判断）。
  2. 官方脚本的预览是 1:1 的 before|after 拼版；判断接缝要 3 倍放大。
  本探针**只调用** extrude-complete.py 里已有的 extrude()，不复制算法、不改 manifest。

用法：
  python scripts/_pool-batch-b.py zoom-before   # 原图切边 3 倍放大（判「切掉的是什么」）
  python scripts/_pool-batch-b.py edges         # 切边材质量化（体色 / 装饰物）
  python scripts/_pool-batch-b.py preview       # 每条边从原图独立挤出，出 3 倍接缝图 + 全图
  python scripts/_pool-batch-b.py chain <id> <side> [<side>...]   # 多方向链式预览（不落盘）
"""
import importlib.util, json, os, sys
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(BASE, "assets", "manifest.json")
OUT = os.path.join(BASE, "archive", "pool-batch-B")
SCALE = 3
BAND = 80

spec = importlib.util.spec_from_file_location("ex", os.path.join(BASE, "scripts", "extrude-complete.py"))
ex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ex)

PLAN = [
    ("pighub-1087", ["top", "right"]),
    ("pighub-242", ["left"]),
    ("pighub-27", ["top", "right"]),
    ("pighub-376", ["right"]),
    ("pighub-40", ["right"]),
    ("pighub-751", ["bottom", "right"]),
]


def load(pid):
    m = json.load(open(MP, encoding="utf-8"))
    p = next(x for x in m["pigs"] if x["id"] == pid)
    return Image.open(os.path.join(BASE, p["file"])).convert("RGBA")


def edge_crop(im, side, band=BAND):
    w, h = im.size
    if side == "right":
        return im.crop((max(0, w - band), 0, w, h))
    if side == "left":
        return im.crop((0, 0, min(band, w), h))
    if side == "top":
        return im.crop((0, 0, w, min(band, h)))
    return im.crop((0, max(0, h - band), w, h))


def zoom(im, k=SCALE):
    return im.resize((im.width * k, im.height * k), Image.LANCZOS)


def sheet(panels, gap=16, bg=(28, 30, 36)):
    W = sum(p.width for p in panels) + gap * (len(panels) - 1)
    H = max(p.height for p in panels)
    out = Image.new("RGB", (W, H), bg)
    x = 0
    for p in panels:
        out.paste(p, (x, (H - p.height) // 2), p)
        x += p.width + gap
    return out


def bbox(a):
    ys, xs = np.where(a[:, :, 3] > 16)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def auto_depth(a, side):
    """与 extrude-complete.py 的 complete() 完全同一公式。"""
    x0, y0, x1, y1 = bbox(a)
    span = (y1 - y0 + 1) if side in ("right", "left") else (x1 - x0 + 1)
    return max(8, int(span * 0.40))


def seam_pos(a, side):
    """原图（切口）在**当前图**里的位置：before 图就是 bbox 的那条边。"""
    x0, y0, x1, y1 = bbox(a)
    return {"right": x1, "left": x0, "bottom": y1, "top": y0}[side]


PAD = 8


def after_seam(before_a, side, depth):
    """切口在**挤出后**的图里的坐标。

    extrude() 的布局：out[oy:oy+h, ox:ox+w] = 原图，其中 ox = PAD (+depth 当 side=left)，
    oy = PAD (+depth 当 side=top)；挤出段贴在原图的切口那一侧之外。
    所以接缝位置 = PAD + 原图切口坐标（left/top 还要加 depth 的偏移）。
    """
    x0, y0, x1, y1 = bbox(before_a)
    if side == "right":
        return PAD + x1
    if side == "left":
        return PAD + depth + x0
    if side == "bottom":
        return PAD + y1
    return PAD + depth + y0


def seam_band(im, pos, side, band=BAND):
    if side in ("right", "left"):
        return im.crop((max(0, pos - band // 2), 0, min(im.width, pos + band // 2), im.height))
    return im.crop((0, max(0, pos - band // 2), im.width, min(im.height, pos + band // 2)))


def seam_metrics(before_im, after_im, side, depth):
    """跨接缝的亮度剖面（数值证据；判定仍以肉眼为准）。

    取「接缝两侧 8px 全部不透明」的行/列，算逐列中位亮度剖面 prof，
    再看相邻列的最大台阶 max_step 落在哪里：
      - 接缝不可见：max_step 落在哪都行，且与体内自有渐变的台阶同量级；
      - 有接缝：max_step 就落在接缝那一列（offset 0），且明显大于体内台阶。
    """
    aa = np.array(after_im).astype(float)
    a = np.array(before_im)
    s = after_seam(a, side, depth)
    al = aa[:, :, 3]
    if side in ("right", "left"):
        xs = range(s - 8, s + 9)
        rows = [y for y in range(al.shape[0]) if all(al[y, x] > 200 for x in xs)]
        if len(rows) < 8:
            return {"error": "too few fully-opaque rows", "seam_pos": int(s), "rows": len(rows)}
        prof = [float(np.median(aa[rows, x, :3].mean(axis=1))) for x in xs]
    else:
        ys = range(s - 8, s + 9)
        cols = [x for x in range(al.shape[1]) if all(al[y, x] > 200 for y in ys)]
        if len(cols) < 8:
            return {"error": "too few fully-opaque cols", "seam_pos": int(s), "cols": len(cols)}
        prof = [float(np.median(aa[y, cols, :3].mean(axis=1))) for y in ys]
    steps = [abs(prof[i + 1] - prof[i]) for i in range(len(prof) - 1)]
    mx = max(steps)
    at = steps.index(mx)  # 0 表示接缝前一步，即 s-8 -> s-7 ... 用 offset 表示
    return {
        "seam_pos": int(s),
        "profile_L": [round(v, 1) for v in prof],
        "max_step": round(mx, 2),
        "max_step_col_offset": int(at - 8),   # 0 = 正好跨接缝（s-1 -> s）
        "median_step": round(float(np.median(steps)), 2),
        "seam_step": round(abs(prof[8] - prof[7]), 2),
        "seam_col_opaque": int((al[:, s] > 16).sum()),
    }


def cmd_gap():
    """量「只让 ERASE 生效、不动挤出起点」会不会留下发丝缝。

    extrude() 的 ERASE 目前落在 a 的副本上，没落到 out（见 root）；这里直接把它落到 out 上，
    看接缝两侧的 alpha 分布：若 s-1/s 两列变全透明、而 s-2 与 s+1 不透明，就是一条 2px 竖缝。
    """
    for pid, side in [("pighub-27", "right"), ("pighub-1087", "right")]:
        a = np.array(load(pid))
        depth = auto_depth(a, side)
        out, _ = ex.extrude(a, side, depth)
        x0, y0, x1, y1 = bbox(a)
        s = after_seam(a, side, depth)
        rows = list(range(PAD + y0, PAD + y1 + 1))
        cols = [s - 3, s - 2, s - 1, s, s + 1, s + 2]
        before = [int((out[rows, c, 3] > 16).sum()) for c in cols]
        o2 = out.copy()
        o2[PAD + y0:PAD + y1 + 1, s - 1:s + 1, 3] = 0   # ERASE=2 -> 恰好 s-1、s 两列
        after = [int((o2[rows, c, 3] > 16).sum()) for c in cols]
        print("%-12s %-6s 列            %s" % (pid, side, cols))
        print("           现状不透明数   %s" % before)
        print("           只让 ERASE 生效 %s  <- s-1/s 全透明 = 发丝缝" % after)


def cmd_fixtest():
    """诊断实验：把接缝那 1 列换成旁边挤出段的体色，看暗线是不是唯一障碍。

    不写 assets/img、不改共享脚本；用来给下一轮的修法定量。
    """
    for pid, side in [("pighub-1087", "right"), ("pighub-27", "right")]:
        a = np.array(load(pid))
        depth = auto_depth(a, side)
        out, _ = ex.extrude(a, side, depth)
        s = after_seam(a, side, depth)
        aa = np.array(Image.fromarray(out, "RGBA")).astype(np.uint8)
        src_px = aa[:, s + 2:s + 6, :].reshape(-1, 4)
        src_px = src_px[src_px[:, 3] > 200]
        if not len(src_px):
            print(pid, side, "no opaque source pixels")
            continue
        col = np.median(src_px[:, :3], axis=0).astype(np.uint8)
        fixed = aa.copy()
        m = fixed[:, s, 3] > 16
        fixed[m, s, :3] = col

        def prof(img):
            al = img[:, :, 3]
            xs = range(s - 8, s + 9)
            rows = [y for y in range(al.shape[0]) if all(al[y, x] > 200 for x in xs)]
            return [float(np.median(img[rows, x, :3].astype(float).mean(axis=1))) for x in xs]

        p0, p1 = prof(aa), prof(fixed)
        st0 = max(abs(p0[i + 1] - p0[i]) for i in range(len(p0) - 1))
        st1 = max(abs(p1[i + 1] - p1[i]) for i in range(len(p1) - 1))
        print("%-12s %-6s 换色=%s" % (pid, side, [int(v) for v in col]))
        print("   原 :", [round(v, 1) for v in p0])
        print("   换后:", [round(v, 1) for v in p1])
        print("   最大相邻台阶 原=%.2f 换后=%.2f" % (st0, st1))
        im = Image.fromarray(fixed, "RGBA")
        sheet([zoom(seam_band(Image.fromarray(aa, "RGBA"), s, side)),
               zoom(seam_band(im, s, side))]).save(
            os.path.join(OUT, "%s-%s-seam3x-recoloured.png" % (pid, side)))
        print("   ->", os.path.relpath(os.path.join(OUT, "%s-%s-seam3x-recoloured.png" % (pid, side)), BASE))


def cmd_root():
    """根因核对：接缝那一列的像素是不是**原图自己的切口列**（说明 ERASE 没落到 out 上）。"""
    for pid, sides in PLAN:
        a = np.array(load(pid))
        for side in sides:
            depth = auto_depth(a, side)
            out, _ = ex.extrude(a, side, depth)
            s = after_seam(a, side, depth)
            x0, y0, x1, y1 = bbox(a)
            if side in ("right", "left"):
                orig_col = a[y0:y1 + 1, x1 if side == "right" else x0, :]
                seam_col = out[PAD + y0:PAD + y1 + 1, s, :]
            else:
                orig_col = a[y1 if side == "bottom" else y0, x0:x1 + 1, :]
                seam_col = out[s, PAD + x0:PAD + x1 + 1, :]
            same = bool(np.array_equal(orig_col, seam_col))
            print("%-12s %-6s seam@%-4d 与原图切口列逐像素相同=%s  orig_med=%s seam_med=%s" % (
                pid, side, s, same,
                [int(v) for v in np.median(orig_col[:, :3], axis=0)],
                [int(v) for v in np.median(seam_col[:, :3], axis=0)]))


def cmd_peach():
    """切边上到底有没有「猪身色」像素 —— 判「这条边切的是猪还是布景」的决定性量。

    猪身色 = 暖亮桃粉：alpha>16 且 R>=180、G>=120、B>=90、R-B>=20、R-G<=60。
    排除：白/浅蓝枕头（B>=R）、深蓝横幅（R<180）、棕色床架（R<180）、品红腮红（G<120）、
          红玫瑰（G<120）、绿茎叶（R<180）。
    输出：每条边「猪身色像素占该边像素的比例」+ 该边不透明像素里猪身色的占比。
    """
    rows = []
    for pid, sides in PLAN:
        a = np.array(load(pid))
        al = a[:, :, 3] > 16
        ys, xs = np.where(al)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
        peach = al & (r >= 180) & (g >= 120) & (b >= 90) & ((r - b) >= 20) & ((r - g) <= 60)
        for side in sides:
            # 取边缘**内缩 2px** 的那一条：最外一列永远是描边（实测 edge_rgb 全为深色），
            # 问「切掉的是什么」必须问描边里面那一层。
            ins = 2
            if side == "right":
                c = x1 - ins
                e_al, e_pc = al[y0:y1 + 1, c], peach[y0:y1 + 1, c]
            elif side == "left":
                c = x0 + ins
                e_al, e_pc = al[y0:y1 + 1, c], peach[y0:y1 + 1, c]
            elif side == "top":
                c = y0 + ins
                e_al, e_pc = al[c, x0:x1 + 1], peach[c, x0:x1 + 1]
            else:
                c = y1 - ins
                e_al, e_pc = al[c, x0:x1 + 1], peach[c, x0:x1 + 1]
            n_op = int(e_al.sum())
            n_pc = int(e_pc.sum())
            frac_edge = n_pc / float(len(e_al))
            frac_op = n_pc / float(n_op) if n_op else 0.0
            verdict = "PIG cut" if frac_edge >= 0.30 else "NOT pig (decoration)"
            rows.append({"id": pid, "side": side, "edge_px": int(len(e_al)),
                         "opaque_on_edge": n_op, "pigbody_on_edge": n_pc,
                         "pigbody_frac_of_edge": round(frac_edge, 3),
                         "pigbody_frac_of_opaque": round(frac_op, 3),
                         "verdict": verdict})
            print("%-12s %-6s opaque=%3d pigbody=%3d  frac_edge=%.3f frac_opaque=%.3f  => %s" % (
                pid, side, n_op, n_pc, frac_edge, frac_op, verdict))
    json.dump(rows, open(os.path.join(OUT, "peach-report.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("->", os.path.relpath(os.path.join(OUT, "peach-report.json"), BASE))


def cmd_zoom_before():
    os.makedirs(OUT, exist_ok=True)
    for pid, sides in PLAN:
        im = load(pid)
        for side in sides:
            c = zoom(edge_crop(im, side))
            p = os.path.join(OUT, "%s-%s-cut3x.png" % (pid, side))
            c.convert("RGB").save(p)
            print("%-12s %-6s -> %s (%dx%d)" % (pid, side, os.path.relpath(p, BASE), c.width, c.height))


def _runs(flags):
    best = (0, 0, 0)
    cur = 0
    start = 0
    for i, v in enumerate(flags):
        if v:
            if cur == 0:
                start = i
            cur += 1
            if cur > best[0]:
                best = (cur, start, i)
        else:
            cur = 0
    return best


def edge_report(pid, side):
    """量「这条边被切掉的是什么」：边线颜色、沿线波动、向内 1~4px 的材质。

    判据（本探针自己立的）：
      - inner_rgb 是体色（暖亮，R>G>B 且 R>200）= 猪身被切；
      - inner_rgb 是深蓝（B>R，暗）= 背景装饰横幅被切；
      - along_std 大 = 该边是斜边/花纹，不是直线切口。
    """
    im = load(pid)
    a = np.array(im)
    al = a[:, :, 3] > 16
    ys, xs = np.where(al)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    sub = al[y0:y1 + 1, x0:x1 + 1]
    h, w = sub.shape
    line = {"top": sub[0, :], "bottom": sub[h - 1, :], "left": sub[:, 0], "right": sub[:, w - 1]}[side]
    n, s, e = _runs(line)
    mid0 = s + (e - s) // 3
    mid1 = e - (e - s) // 3
    inner = []
    if side in ("left", "right"):
        col = x0 if side == "left" else x0 + w - 1
        px = a[y0 + mid0:y0 + mid1 + 1, col, :3]
        for d in range(1, 5):
            cc = col + d if side == "left" else col - d
            inner.append(a[y0 + mid0:y0 + mid1 + 1, cc, :3])
    else:
        row = y0 if side == "top" else y0 + h - 1
        px = a[row, x0 + mid0:x0 + mid1 + 1, :3]
        for d in range(1, 5):
            rr = row + d if side == "top" else row - d
            inner.append(a[rr, x0 + mid0:x0 + mid1 + 1, :3])
    inner = np.stack(inner)
    ir = [int(v) for v in np.median(inner.reshape(-1, 3), axis=0)]
    if ir[0] > 200 and ir[0] > ir[2]:
        what = "pig-body"
    elif ir[2] > ir[0]:
        what = "decoration(navy)"
    else:
        what = "other"
    return {
        "run_len": int(n), "run_frac": round(n / len(line), 3),
        "edge_rgb": [int(v) for v in np.median(px, axis=0)],
        "along_std": round(float(np.mean(np.std(px.astype(float), axis=0))), 1),
        "inner_rgb": ir, "cut_material": what,
    }


def cmd_edges():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for pid, sides in PLAN:
        for side in sides:
            d = edge_report(pid, side)
            d.update({"id": pid, "side": side})
            rows.append(d)
            print("%-12s %-6s run=%3d(%.2f) along_std=%5.1f inner_rgb=%-16s => %s" % (
                pid, side, d["run_len"], d["run_frac"], d["along_std"], str(d["inner_rgb"]), d["cut_material"]))
    json.dump(rows, open(os.path.join(OUT, "edge-report.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("->", os.path.relpath(os.path.join(OUT, "edge-report.json"), BASE))


def preview_one(pid, side, src_im=None):
    """把一条边从原图独立挤出（不落盘到 assets/img），出 3 倍接缝图 + 2 倍全图 + 数值。"""
    os.makedirs(OUT, exist_ok=True)
    before_im = src_im if src_im is not None else load(pid)
    a = np.array(before_im)
    depth = auto_depth(a, side)
    out, filled = ex.extrude(a, side, depth)
    if out is None:
        print("%s %s: extrude returned None" % (pid, side))
        return None
    after_im = Image.fromarray(out, "RGBA")
    sb = seam_pos(a, side)
    sa = after_seam(a, side, depth)
    p = os.path.join(OUT, "%s-%s-seam3x.png" % (pid, side))
    sheet([zoom(seam_band(before_im, sb, side)), zoom(seam_band(after_im, sa, side))]).save(p)
    pf = os.path.join(OUT, "%s-%s-full2x.png" % (pid, side))
    sheet([zoom(before_im, 2), zoom(after_im, 2)]).save(pf)
    met = seam_metrics(before_im, after_im, side, depth)
    print("%-12s %-6s depth=%-3d filled=%-6d %s -> %s  %s" % (
        pid, side, depth, filled, before_im.size, after_im.size, json.dumps(met)))
    return {"id": pid, "side": side, "depth": depth, "filled": filled,
            "before_size": list(before_im.size), "after_size": list(after_im.size),
            "seam_before": int(sb), "seam_after": int(sa),
            "seam3x": os.path.relpath(p, BASE), "full2x": os.path.relpath(pf, BASE), "metrics": met}


def cmd_preview():
    meta = []
    for pid, sides in PLAN:
        for side in sides:
            r = preview_one(pid, side)
            if r:
                meta.append(r)
    json.dump(meta, open(os.path.join(OUT, "preview-meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("meta ->", os.path.relpath(os.path.join(OUT, "preview-meta.json"), BASE))


def cmd_chain():
    pid = sys.argv[2]
    sides = sys.argv[3:]
    cur = load(pid)
    for side in sides:
        a = np.array(cur)
        depth = auto_depth(a, side)
        out, filled = ex.extrude(a, side, depth)
        after = Image.fromarray(out, "RGBA")
        sb = seam_pos(a, side)
        sa = after_seam(a, side, depth)
        p = os.path.join(OUT, "%s-chain-%s-seam3x.png" % (pid, side))
        sheet([zoom(seam_band(cur, sb, side)), zoom(seam_band(after, sa, side))]).save(p)
        print("%-12s %-6s depth=%-3d filled=%-6d -> %s  接缝@%d" % (pid, side, depth, filled, after.size, sa))
        cur = after
    fp = os.path.join(OUT, "%s-chain-final.png" % pid)
    sheet([zoom(load(pid), 2), zoom(cur, 2)]).save(fp)
    cur.save(os.path.join(OUT, "%s-chained.png" % pid))
    print("chained ->", os.path.relpath(os.path.join(OUT, "%s-chained.png" % pid), BASE))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "zoom-before"
    {"zoom-before": cmd_zoom_before, "preview": cmd_preview,
     "edges": cmd_edges, "chain": cmd_chain, "peach": cmd_peach, "root": cmd_root,
     "fixtest": cmd_fixtest, "gap": cmd_gap}[cmd]()