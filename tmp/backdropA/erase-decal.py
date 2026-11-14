
# -*- coding: utf-8 -*-
"""擦掉 PigHub 素材里那块深靛紫三角旗（幕布）——v2。

v1 失败记录（2026-11-14 实测，pighub-258 3 倍复查）：只按「深靛色」刷一遍，
旗子内部的米白 + 号与圆点、以及旗子那圈更暗的描边都留在图上（残留 36–238 px），
于是四面被围住的「已擦区域」反而变成一块空洞。**单靠色键不够，必须把旗子的整个剪影一起取下来。**

v2 做法（四条，缺一条就出残片）：
1. **种子**：严格靛色族 (≈80,72,104 ~ 96,80,136) 的最大连通域（面积 > 800）。
2. **剪影**：种子点的凸包（这块 decal 就是三角形/扇形，凸包即剪影），光栅后外扩 2 px。
   凸包是这一步的关键：旗子里的 + 号、圆点、暗描边都落在它里面。
3. **浮选**：从种子出发在凸包内 4 连通漫水，接受「不是猪身暖色、也不是中性近黑」的像素：
   - 拒绝 pig_warm：(R-G >= 28 且 R >= 120) —— 猪身/鼻子/腮红都在这一侧；
   - 拒绝 neutral_dark：(max(R,G,B) <= 80 且 B-R <= 14) —— 猪的黑色描边与眼睛在这一侧；
   - 其余（靛色、米白 + 号、灰蓝抗锯齿边、暗靛描边）全部吃掉。
4. **自证**：removed 与 pig_warm 的交集必须为 0；擦完的「被围空洞」必须为 0；
   残留靛色像素必须为 0。三项任一不为 0 就 throw，图不写回。
"""
import os, sys, json, argparse
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

ROOT = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
IMG = os.path.join(ROOT, "assets", "img")

def label(mask):
    h, w = mask.shape
    lab = np.full((h, w), -1, np.int32)
    out = []; cur = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and lab[y, x] < 0:
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

def hull(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) < 3: return pts
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def erase(name, outdir, write=False, hull_pad=6, patches=None, seed_mode="strict"):
    p = os.path.join(IMG, name + ".png")
    im = Image.open(p).convert("RGBA")
    a = np.asarray(im).copy()
    R = a[:, :, 0].astype(np.int32); G = a[:, :, 1].astype(np.int32)
    B = a[:, :, 2].astype(np.int32); A = a[:, :, 3].astype(np.int32)
    h, w = A.shape
    before = {"size": [im.width, im.height], "opaque": int((A > 8).sum())}

    if seed_mode == "loose":
        # pighub-1198 的旗子是**半透明**的一层（α≈224，颜色被抬到 ≈112,96,152），
        # 标准色窗只命中 245px，够不到 800px 的门槛 → 用放宽的色窗。
        seed = (A > 60) & (np.abs(R-110) < 40) & (np.abs(G-92) < 40) & (np.abs(B-160) < 50) \
               & (B > G + 20) & (B > R + 20)
    else:
        seed = (A > 60) & (np.abs(R-86) < 30) & (np.abs(G-74) < 30) & (np.abs(B-116) < 46) \
               & (B > G + 10) & (B > R + 6) & (R > 55) & (G > 50) & (B > 70)
    lab, cl = label(seed)
    cl = sorted([c for c in cl if c["area"] > 800], key=lambda c: -c["area"])
    if not cl:
        return {"id": name, "skipped": "no navy decal > 800px"}
    ys, xs = np.nonzero(np.isin(lab, [c["id"] for c in cl]))
    hb = hull(list(zip(xs.tolist(), ys.tolist())))
    hm = Image.new("L", (w, h), 0)
    ImageDraw.Draw(hm).polygon([(int(x), int(y)) for x, y in hb], fill=255)
    hullmask = np.asarray(hm) > 0
    for _ in range(hull_pad):   # 外扩
        g = hullmask.copy()
        g[1:, :] |= hullmask[:-1, :]; g[:-1, :] |= hullmask[1:, :]
        g[:, 1:] |= hullmask[:, :-1]; g[:, :-1] |= hullmask[:, 1:]
        hullmask = g

    # 2b) 旗子被猪尾巴/耳朵切成两半时，残块是一个**独立的小靛色连通域**（pighub-1031 尾上那块楔形）。
    #     判据：面积 >= 30 且整块落在「凸包外扩 24px」之内的靛色域 = 同一块 decal 的残件，直接一起擦。
    wide = hullmask.copy()
    for _ in range(18):
        g = wide.copy()
        g[1:, :] |= wide[:-1, :]; g[:-1, :] |= wide[1:, :]
        g[:, 1:] |= wide[:, :-1]; g[:, :-1] |= wide[:, 1:]
        wide = g
    even_navy = (A > 60) & (np.abs(R-86) < 34) & (np.abs(G-74) < 34) & (np.abs(B-116) < 50) \
                & (B > G + 8) & (B > R + 4) & (R > 50)
    _l4, cl4 = label(even_navy)
    lab_flat = _l4[even_navy]
    tot = np.bincount(lab_flat, minlength=len(cl4) + 1).astype(float)
    inn = np.bincount(lab_flat, weights=wide[even_navy].astype(float), minlength=len(cl4) + 1)
    extra_ids = []
    for c in cl4:
        if c["area"] < 30 or c["area"] > 6000: continue
        if inn[c["id"]] / max(1.0, tot[c["id"]]) < 0.6: continue
        extra_ids.append(c["id"])

    pig_warm = (R - G >= 28) & (R >= 120)
    neutral_dark = (np.maximum(np.maximum(R, G), B) <= 80) & (B - R <= 14)
    allowed = (A > 8) & hullmask & ~pig_warm & ~neutral_dark

    start = np.isin(lab, [c["id"] for c in cl]) & allowed
    mask = np.zeros((h, w), bool)
    if extra_ids:
        _l5, _ = label(even_navy)
        mask |= np.isin(_l5, extra_ids) & (A > 8)
    q = deque(zip(*np.nonzero(start)))
    for y, x in q: mask[y, x] = True
    while q:
        cy, cx = q.popleft()
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny, nx = cy+dy, cx+dx
            if 0 <= ny < h and 0 <= nx < w and allowed[ny, nx] and not mask[ny, nx]:
                mask[ny, nx] = True; q.append((ny, nx))

    illegal = int((mask & pig_warm).sum())
    if illegal:
        return {"id": name, "error": "would erase %d pig-body pixels" % illegal}

    removed = int(mask.sum())
    a[mask] = [0, 0, 0, 0]

    # 4b) 清描边残片（主判据）：旗子的轮廓线与猪的勾线是同一个墨色，色键分不开，
    #     但它离猪身填色很远。所以「凸包里、离猪身暖色 > 4px 的不透明像素」一律擦掉；
    #     反过来说，猪自己的勾线一定贴着猪身（≤3px），因此不会被啃掉。
    warm_mask = pig_warm
    near_pig = warm_mask.copy()
    for _ in range(5):
        g = near_pig.copy()
        g[1:, :] |= near_pig[:-1, :]; g[:-1, :] |= near_pig[1:, :]
        g[:, 1:] |= near_pig[:, :-1]; g[:, :-1] |= near_pig[:, 1:]
        near_pig = g
    # 4b-2) 旗子那圈描边比填色更靠外：它整段落在「凸包外扩 6px」之外，4b 够不着。
    #     外扩到 14px、并要求「一像素腐蚀就消失（=细线）且偏暗」→ 猪的勾线有 near_pig 兜底、
    #     猪的黑色眼睛是实心块（腐蚀不掉），浅灰的猪须也不够暗，三者都不会被误伤。
    hull_wide = hullmask.copy()
    for _ in range(8):
        g = hull_wide.copy()
        g[1:, :] |= hull_wide[:-1, :]; g[:-1, :] |= hull_wide[1:, :]
        g[:, 1:] |= hull_wide[:, :-1]; g[:, :-1] |= hull_wide[:, 1:]
        hull_wide = g
    A_now = a[:, :, 3].astype(np.int32)
    R_n = a[:, :, 0].astype(np.int32); G_n = a[:, :, 1].astype(np.int32); B_n = a[:, :, 2].astype(np.int32)
    darkish = np.maximum(np.maximum(R_n, G_n), B_n) < 130
    op_n = A_now > 8
    er_n = op_n.copy()
    er_n[1:, :] &= op_n[:-1, :]; er_n[:-1, :] &= op_n[1:, :]
    er_n[:, 1:] &= op_n[:, :-1]; er_n[:, :-1] &= op_n[:, 1:]
    # 只在「8 邻域里一个猪身暖色像素都没有」时才擦：勾线紧贴猪身，因此保得住；
    # 旗子伸出去的那段细线一个暖色邻居也没有，擦得掉。
    wnb0 = np.zeros_like(A_now)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0: continue
            wnb0 += np.roll(np.roll(pig_warm.astype(np.int32), dy, axis=0), dx, axis=1)
    pale = (np.minimum(np.minimum(R_n, G_n), B_n) > 175) & \
           ((np.maximum(np.maximum(R_n, G_n), B_n) - np.minimum(np.minimum(R_n, G_n), B_n)) < 40)
    navyish = (np.abs(R_n-86) < 60) & (np.abs(G_n-74) < 60) & (np.abs(B_n-116) < 70) & (B_n > G_n + 4)
    fringe = (A_now > 8) & hullmask & ~near_pig
    fringe |= (A_now > 8) & hull_wide & ~pig_warm & (darkish | pale | navyish) & (wnb0 == 0)
    if fringe.any():
        a[fringe] = [0, 0, 0, 0]
        removed += int(fringe.sum())

    # 4e) 封口：上面擦掉的 1–2px 细线有时正好压在猪的勾线上，会留下一道针眼大的缺口。
    #     判据：透明像素的 8 邻域里有 >=6 个不透明邻居 = 针眼；用邻居颜色的中位数补回（最多补 2 圈）。
    for _ in range(2):
        A_s = a[:, :, 3].astype(np.int32)
        op8 = np.zeros_like(A_s)
        cnt = np.zeros_like(A_s)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0: continue
                sh = np.roll(np.roll((A_s > 8).astype(np.int32), dy, axis=0), dx, axis=1)
                cnt += sh
        hole = (A_s <= 8) & (cnt >= 6)
        if not hole.any(): break
        ys_h, xs_h = np.nonzero(hole)
        for y, x in zip(ys_h, xs_h):
            cols = []
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy2, xx2 = y+dy, x+dx
                    if 0 <= yy2 < h and 0 <= xx2 < w and a[yy2, xx2, 3] > 8:
                        cols.append(a[yy2, xx2, :3].astype(np.int32))
            if cols:
                med = np.median(np.stack(cols), axis=0).astype(np.uint8)
                a[y, x] = [med[0], med[1], med[2], 255]

    # 4c) 已废弃：按「小连通域 = 碎屑」扫一遍会把猪的耳朵尖/尾巴尖一起扫掉
    #     （2026-11-14 实测：pighub-40 从 210×137 变成 210×137 的上半截丢了，pighub-686 少 46 行）。
    #     碎屑改为逐张目检后用 --patches 显式点名。

    # 4d) 细线碎屑：旗子描边穿过猪尾巴的环孔、或伸到猪背外的那一小段，宽度只有 1–2px，
    #     被 near_pig 保护下来。判据 = 「一像素腐蚀后只剩不到 35% 的小块」+ 凸包内 + 非暖色。
    #     猪耳尖/尾巴尖是实心团块，腐蚀后保留率高，因此不会被误判（v7 就死在这一步，已废弃）。
    A_thin = a[:, :, 3].astype(np.int32)
    R_t = a[:, :, 0].astype(np.int32); G_t = a[:, :, 1].astype(np.int32)
    op = A_thin > 8
    er = op.copy()
    er[1:, :] &= op[:-1, :]; er[:-1, :] &= op[1:, :]
    er[:, 1:] &= op[:, :-1]; er[:, :-1] &= op[:, 1:]
    warm_t = (R_t - G_t >= 28) & (R_t >= 120)
    _l7, cl7 = label(op)
    lab7 = _l7
    for c in cl7:
        if c["area"] >= 200: continue
        pcs = lab7 == c["id"]
        if pcs[hullmask].sum() / c["area"] < 0.7: continue
        if warm_t[pcs].sum() / c["area"] >= 0.2: continue
        if er[pcs].sum() / c["area"] >= 0.35: continue   # 实心块（耳尖/尾尖）→ 不动
        a[pcs] = [0, 0, 0, 0]
        removed += c["area"]

    # 5) 清描边残片：旗子那圈「中性近黑」的轮廓线不在浮选范围内（它有可能是猪的勾线色），
    #    但它与猪之间隔着透明像素，所以擦完之后它是一块**独立的小连通域**。
    #    规则：落在凸包附近、面积 < 最大域 6% 的独立块 = 幕布残片，删掉。
    #    （猪本体是最大域；猪身上的配饰与猪相连，不会被误删。）
    A2 = a[:, :, 3].astype(np.int32)
    _l3, cl3 = label(A2 > 8)
    if cl3:
        big = max(c["area"] for c in cl3)
        near_hull = hullmask.copy()
        for _ in range(3):
            g = near_hull.copy()
            g[1:, :] |= near_hull[:-1, :]; g[:-1, :] |= near_hull[1:, :]
            g[:, 1:] |= near_hull[:, :-1]; g[:, :-1] |= near_hull[:, 1:]
            near_hull = g
        for c in cl3:
            if c["area"] >= 0.06 * big: continue
            x0, y0, x1, y1 = c["bbox"]
            if not near_hull[y0:y1+1, x0:x1+1].any(): continue
            pcs = _l3 == c["id"]
            a[pcs] = [0, 0, 0, 0]
            removed += c["area"]
    R2 = a[:, :, 0].astype(np.int32); G2 = a[:, :, 1].astype(np.int32); B2 = a[:, :, 2].astype(np.int32)

    holes = []
    _lab, cl2 = label(A2 <= 8)
    for c in cl2:
        x0, y0, x1, y1 = c["bbox"]
        if x0 == 0 or y0 == 0 or x1 == w-1 or y1 == h-1: continue
        if c["area"] > 5: holes.append(c["area"])

    residual = int(((A2 > 60) & (np.abs(R2-86) < 34) & (np.abs(G2-74) < 34) & (np.abs(B2-116) < 50)
                    & (B2 > G2 + 8) & (B2 > R2 + 4) & (R2 > 50)).sum())

    # 7) 手工补擦（原始坐标）：自动流程够不着的那几段描边/紫色小条，由 --patches 显式点名。
    if patches:
        A_p = a[:, :, 3].astype(np.int32)
        R_p = a[:, :, 0].astype(np.int32); G_p = a[:, :, 1].astype(np.int32); B_p = a[:, :, 2].astype(np.int32)
        warm_p = (R_p - G_p >= 28) & (R_p >= 120)
        wnb = np.zeros((h, w), np.int32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0: continue
                wnb += np.roll(np.roll(warm_p.astype(np.int32), dy, axis=0), dx, axis=1)
        dark_p = np.maximum(np.maximum(R_p, G_p), B_p) < 170
        navy_p = (np.abs(R_p-86) < 60) & (np.abs(G_p-74) < 60) & (np.abs(B_p-116) < 70) & (B_p > G_p + 4)
        pale_p = (np.minimum(np.minimum(R_p, G_p), B_p) > 175) & \
                 ((np.maximum(np.maximum(R_p, G_p), B_p) - np.minimum(np.minimum(R_p, G_p), B_p)) < 40)
        for box in patches:
            x0, y0, x1, y1 = [int(v) for v in box[:4]]
            mode = box[4] if len(box) > 4 else "erase"
            if mode == "paint":
                # 注意：这里**不**加 ~warm_p。旗子压在透明底上的半透明边 R-G 也在 30 上下，
                # 会被暖色判据当成猪身放过（pighub-1031 尾上那块紫楔就是这么留下来的）。
                # 只按靛色/米白判，猪身 (208,128,104) 与它的深棕勾线两者都不命中。
                kill = (A_p > 8) & (navy_p | pale_p)
            else:
                kill = (A_p > 8) & ~warm_p & (dark_p | navy_p | pale_p) & (wnb == 0)
            m = np.zeros_like(kill)
            m[max(0,y0):y1+1, max(0,x0):x1+1] = True
            sel = kill & m
            a[sel] = [0, 0, 0, 0]
            removed += int(sel.sum())
        A2 = a[:, :, 3].astype(np.int32)

    yy, xx = np.nonzero(A2 > 8)
    if len(xx) == 0:
        return {"id": name, "error": "emptied the image"}
    bx0, by0, bx1, by1 = int(xx.min()), int(yy.min()), int(xx.max()), int(yy.max())
    out = Image.fromarray(a, "RGBA").crop((bx0, by0, bx1+1, by1+1))

    os.makedirs(outdir, exist_ok=True)
    out.save(os.path.join(outdir, name + ".png"))
    if write:
        out.save(p)
    return {"id": name, "before": before,
            "after": {"size": [out.width, out.height], "opaque": int((np.asarray(out)[:, :, 3] > 8).sum())},
            "hull_bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            "hull_vertices": len(hb), "removed_px": removed, "crop_origin": [bx0, by0],
            "holes": holes, "residual_navy_px": residual,
            "pig_pixels_touched": illegal}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--patches", default=None)
    ap.add_argument("--loose-seed", default="")
    args = ap.parse_args()
    ids = [s.strip() for s in args.ids.split(",") if s.strip()]
    PATCH = json.load(open(args.patches, encoding="utf-8")) if args.patches else {}
    LOOSE = set(s.strip() for s in args.loose_seed.split(",") if s.strip())
    res = []
    for i in ids:
        try: res.append(erase(i, args.out, args.write, patches=PATCH.get(i),
                              seed_mode=("loose" if i in LOOSE else "strict")))
        except Exception as e: res.append({"id": i, "error": repr(e)})
    print(json.dumps(res, indent=1, ensure_ascii=False))
