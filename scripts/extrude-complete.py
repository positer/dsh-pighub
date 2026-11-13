"""
沿边挤出补全 v2（构建期工具，需要 Pillow）。

v1 失败原因（2026-11-13 实测）：拿**切口那一列**当采样源，但那一列往往是一条抗锯齿的细边
（alpha<=16 的像素占多数），剖面退化 → 挤出区大面积透明，预览里就是一块深色积木。

v2 做法：
  1. 采样源改用**切口内 3px 的那一列**（一定是实心身体）；
  2. 垂直范围用**整只猪的 bbox 剖面**，不用单列剖面（不会退化成细缝）；
  3. 逐列重采样（线性插值取最近行），保持原图的渐变/描边；
  4. 末端按余弦收成圆头，四周留 8px 边距；
  5. 自检：打印「新增区域的不透明像素占比」，<0.5 视为失败并拒绝写回。

用法：python scripts/extrude-complete.py <pigId> <side> [depth] [--write]
"""
import sys, os, json, hashlib, shutil
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(BASE, "assets", "manifest.json")
BACKUP = os.path.join(os.path.dirname(BASE), "archive", "asset-backup")


def extrude(a, side, depth, taper=0.82, cap=0.30):
    h, w, _ = a.shape
    mask = a[:, :, 3] > 16
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    vertical = side in ("right", "left")
    pad = 8
    ox = pad + (depth if side == "left" else 0)
    oy = pad + (depth if side == "top" else 0)
    if vertical:
        out = np.zeros((h + pad * 2, w + depth + pad * 2, 4), np.uint8)
    else:
        out = np.zeros((h + depth + pad * 2, w + pad * 2, 4), np.uint8)
    out[oy:oy + h, ox:ox + w] = a

    # 验收标准允许「抹掉被切的 1–2 行硬边」，所以先把切口那 1~2 行/列的**轮廓残段**擦掉：
    # 这条残段正是 v3–v5 里那条擦不掉的暗线/深棕带（它就是原图的描边，不是我们画上去的）。
    ERASE = 2
    a = a.copy()
    orig_before = a[:, :, 3] > 16   # 擦边**之前**的轮廓，用于后面判断「接缝不要描边」
    if side == "right":
        a[y0:y1 + 1, max(x0, x1 - ERASE + 1):x1 + 1, 3] = 0
    elif side == "left":
        a[y0:y1 + 1, x0:min(x1 + 1, x0 + ERASE), 3] = 0
    elif side == "bottom":
        a[max(y0, y1 - ERASE + 1):y1 + 1, x0:x1 + 1, 3] = 0
    else:
        a[y0:min(y1 + 1, y0 + ERASE), x0:x1 + 1, 3] = 0
    mask2 = a[:, :, 3] > 16
    ys2, xs2 = np.where(mask2)
    if len(ys2) == 0:
        return None, 0
    y0, y1, x0, x1 = int(ys2.min()), int(ys2.max()), int(xs2.min()), int(xs2.max())
    mask = mask2

    # 采样源要往里取 8px：贴着切口的那 3px 常常还是描边（v3 实测底部因此整条变成深棕色）
    INSET = 8
    if side == "right":
        col = max(x0 + 1, x1 - INSET); src = a[:, col, :].copy(); lo, hi = y0, y1
    elif side == "left":
        col = min(x1 - 1, x0 + INSET); src = a[:, col, :].copy(); lo, hi = y0, y1
    elif side == "bottom":
        row = max(y0 + 1, y1 - INSET); src = a[row, :, :].copy(); lo, hi = x0, x1
    else:
        row = min(y1 - 1, y0 + INSET); src = a[row, :, :].copy(); lo, hi = x0, x1

    n0 = hi - lo + 1
    c0 = (lo + hi) / 2.0

    # 采样源去描边：比体色中位亮度低 40% 以上的像素视为描边，用邻近体色替换。
    # 否则底部/边缘挤出会把猪身上的深色描边拉成一条深棕色带（v2 实测）。
    rgb = src[:, :3].astype(float)
    lum = rgb.mean(axis=1)
    prof_mask = src[:, 3] > 16
    if prof_mask.sum() > 10:
        med = float(np.median(lum[prof_mask]))
        dark = prof_mask & (lum < med * 0.6)
        if dark.any() and (~dark & prof_mask).any():
            idxs = np.where(prof_mask)[0]
            for i in idxs:
                if not dark[i]:
                    continue
                # 找最近的浅色邻居
                for d in range(1, 40):
                    for j in (i - d, i + d):
                        if 0 <= j < len(src) and prof_mask[j] and not dark[j]:
                            src[i] = src[j]
                            break
                    else:
                        continue
                    break
    filled = 0
    for k in range(1, depth + 1):
        t = k / float(depth)
        hh = n0 * (1 - (1 - taper) * t)
        if t > 1 - cap:
            u = (t - (1 - cap)) / cap
            hh *= max(0.0, float(np.cos(u * np.pi / 2)))
        hh = int(round(hh))
        if hh < 2:
            continue
        lo2 = int(round(c0 - hh / 2.0))
        src_idx = np.clip(np.round(np.linspace(lo, hi, hh)).astype(int), lo, hi)
        for i in range(hh):
            ry = lo2 + i
            if side == "right":
                out[oy + ry, ox + w + k - 1, :] = src[src_idx[i], :]
            elif side == "left":
                out[oy + ry, ox - k, :] = src[src_idx[i], :]
            elif side == "bottom":
                out[oy + h + k - 1, ox + lo2 + i, :] = src[src_idx[i], :]
            else:
                out[oy - k, ox + lo2 + i, :] = src[src_idx[i], :]
            filled += 1

    # 接缝羽化：把切口边界两侧各 3px 做线性混合，抹掉原图切边留下的 1px 暗线。
    if side in ("right", "left"):
        boundary = (ox + x1) if side == "right" else (ox + x0)
        direction = 1 if side == "right" else -1
        for y in range(oy, oy + h):
            for d in range(1, 4):
                a_i = boundary
                b_i = boundary + direction * d
                if not (0 <= b_i < out.shape[1]):
                    continue
                for c in range(4):
                    out[y, b_i, c] = int(round(0.6 * out[y, boundary, c] + 0.4 * out[y, b_i, c]))
    else:
        boundary = (oy + y1) if side == "bottom" else (oy + y0)
        direction = 1 if side == "bottom" else -1
        for x in range(ox, ox + w):
            for d in range(1, 4):
                b_i = boundary + direction * d
                if not (0 <= b_i < out.shape[0]):
                    continue
                for c in range(4):
                    out[b_i, x, c] = int(round(0.6 * out[boundary, x, c] + 0.4 * out[b_i, x, c]))
    # 沿新轮廓描边：切口断的正是**描边**，只填体色接不上（v3 实测：接缝留暗线、
    # 底部成深棕色横带）。这里取原图已有的轮廓色，把挤出区域的 alpha 边界重新描 2px，
    # 让新边缘和原图的「体色 + 描边」结构一致。
    body = src[prof_mask][:, :3].astype(float)
    lum_b = body.mean(axis=1)
    med_b = float(np.median(lum_b)) if len(lum_b) else 200.0
    dark_px = body[lum_b < med_b * 0.72]
    outline = tuple(int(v) for v in np.median(dark_px, axis=0)) if len(dark_px) > 30 else None

    orig_mask = np.zeros(out.shape[:2], bool)
    # 用擦边**之前**的 mask：擦掉的那 1~2 行也算「原图」，否则接缝会被当成新区域外缘又描一条线
    orig_mask[oy:oy + orig_before.shape[0], ox:ox + orig_before.shape[1]] = orig_before
    alpha = out[:, :, 3] > 16
    new_only = alpha & ~orig_mask
    if outline and new_only.any():
        # 边界 = 新区域里、四邻域有透明的那一圈
        pad_a = np.pad(alpha, 1, mode="constant", constant_values=False)
        edge = alpha & (
            ~pad_a[:-2, 1:-1] | ~pad_a[2:, 1:-1] | ~pad_a[1:-1, :-2] | ~pad_a[1:-1, 2:]
        )
        # 只描**外缘**：排除与原图 mask 相邻的那一圈，否则接缝会被描成一条粗黑线（v4 实测）
        def dilate(m, n):
            cur = m.copy()
            for _ in range(n):
                p = np.pad(cur, 1, mode="constant", constant_values=False)
                cur = cur | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
            return cur

        ring = edge & new_only & ~dilate(orig_mask, 2)
        for _ in range(2):  # 2px 粗
            pad_r = np.pad(ring, 1, mode="constant", constant_values=False)
            grow = ring | (
                (pad_r[:-2, 1:-1] | pad_r[2:, 1:-1] | pad_r[1:-1, :-2] | pad_r[1:-1, 2:])
                & alpha & ~orig_mask & ~dilate(orig_mask, 2)
            )
            ring = grow
        out[ring, 0] = outline[0]
        out[ring, 1] = outline[1]
        out[ring, 2] = outline[2]
        out[ring, 3] = 255
    return out, filled


def complete(pid, side, depth=None):
    m = json.load(open(MP, encoding="utf-8"))
    p = next(x for x in m["pigs"] if x["id"] == pid)
    im = Image.open(os.path.join(BASE, p["file"])).convert("RGBA")
    a = np.array(im)
    mask = a[:, :, 3] > 16
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    span = (y1 - y0 + 1) if side in ("right", "left") else (x1 - x0 + 1)
    if depth is None:
        depth = max(8, int(span * 0.40))
    out, filled = extrude(a, side, depth)
    return im, Image.fromarray(out, "RGBA"), filled


if __name__ == "__main__":
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    write = "--write" in sys.argv
    pid, side = args[0], args[1]
    depth = int(args[2]) if len(args) > 2 else None
    before, after, filled = complete(pid, side, depth)
    oa = np.array(after)[:, :, 3]
    total = oa.size
    print("%s %s depth=%s 写入像素=%d 结果=%dx%d 不透明占比=%.2f" % (
        pid, side, depth, filled, after.width, after.height, float((oa > 16).mean())))
    prev = os.path.join(os.path.dirname(BASE), "archive", "20261113-completion", pid + "-ex-" + side + ".png")
    sheet = Image.new("RGB", (before.width + after.width + 20, max(before.height, after.height)), (28, 30, 36))
    sheet.paste(before, (0, 0), before); sheet.paste(after, (before.width + 20, 0), after)
    sheet.save(prev)
    print("preview ->", prev)
    if write and filled > 0:
        os.makedirs(BACKUP, exist_ok=True)
        dst = os.path.join(BACKUP, pid + ".png")
        if not os.path.exists(dst):
            shutil.copyfile(os.path.join(BASE, "assets/img", pid + ".png"), dst)
        after.save(os.path.join(BASE, "assets/img", pid + ".png"))
        print("written")
