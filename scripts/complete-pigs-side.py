"""
侧面补全（构建期工具，需要 Pillow）——右侧/左侧被直线切断的猪，向切口外侧接一段躯干 + 两条圆底腿。

要点（2026-11-13 实测定下来的三条）：
  1. 用**切口那一列的真实高度/中心**，不要用 bbox；
  2. 写回前**先把原图备份**到 archive/asset-backup/（上次把 1099 写坏是没备份，靠打好的 tgz 才还原）；
  3. 末端做半圆封口、四周留边距，否则躯干会贴到画布边变成一条硬直线。

用法：python scripts/complete-pigs-side.py [--write]
"""
import os, sys, json, hashlib, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BASE = r"C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub"
MP = os.path.join(BASE, "assets", "manifest.json")
PREVIEW = os.path.join(os.path.dirname(BASE), "archive", "20261113-completion")
BACKUP = os.path.join(os.path.dirname(BASE), "archive", "asset-backup")

def load(pid):
    m = json.load(open(MP, encoding="utf-8"))
    p = next(x for x in m["pigs"] if x["id"] == pid)
    im = Image.open(os.path.join(BASE, p["file"])); im.seek(0)
    return im.convert("RGBA")

def bbox(a):
    ys, xs = np.where(a > 16)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())

def complete_side(pid, side="right", legs=True):
    """侧面被切断：向切口外侧接一段躯干（高度从切口剖面平滑收到臀高），可选补腿。"""
    im = load(pid)
    arr = np.array(im); a = arr[:, :, 3] > 16
    x0, y0, x1, y1 = bbox(arr[:, :, 3])
    col = x1 if side == "right" else x0
    ys = np.where(a[:, col])[0]
    h_cut = float(ys.max() - ys.min() + 1)
    cy = (ys.min() + ys.max()) / 2.0
    # 体色：切口内侧 20 列的中位色
    inner = arr[:, max(0, col - 20):col + 1 if side == "right" else col + 20, :3]
    inner_a = arr[:, max(0, col - 20):col + 1 if side == "right" else col + 20, 3] > 200
    px = inner[inner_a]
    colour = tuple(int(np.median(px[:, i])) for i in range(3)) if len(px) else (255, 210, 177)

    depth = int(h_cut * 0.55)          # 接出去多长
    end_h = h_cut * 0.72               # 末端高度
    W = im.width + depth + 4
    H = im.height + (int(h_cut * 0.30) if legs else 0) + 4
    mask = Image.new("L", (W, H), 0)
    mask.paste(Image.fromarray((a.astype(np.uint8) * 255), "L"), (0, 0))
    d = ImageDraw.Draw(mask)
    for k in range(depth):
        t = (k + 1) / depth
        h = h_cut + (end_h - h_cut) * (1 - (1 - t) ** 2)     # 平滑收到臀高
        # 臀部略微下垂一点，更像身体
        cyy = cy + h_cut * 0.04 * t
        cx = (col + k + 1) if side == "right" else (col - k - 1)
        d.line([(cx, cyy - h / 2), (cx, cyy + h / 2)], fill=255)
    # 末端做半圆封口，别留一条竖的硬边
    end_cx = (col + depth) if side == "right" else (col - depth)
    d.ellipse([end_cx - end_h / 2, cy - end_h / 2, end_cx + end_h / 2, cy + end_h / 2], fill=255)
    if legs:
        leg_w = max(4, int(h_cut * 0.16)); leg_h = max(4, int(h_cut * 0.24)); gap = max(2, int(h_cut * 0.10))
        total = 2 * leg_w + gap
        # 腿接在**延伸段底部**（不是整图底部）
        base_y = cy + (h_cut + (end_h - h_cut)) / 2 - leg_h * 0.25
        left = (col + depth * 0.55) - total / 2 if side == "right" else (col - depth * 0.55) - total / 2
        for i in range(2):
            lx = left + i * (leg_w + gap)
            d.rounded_rectangle([lx, base_y, lx + leg_w, base_y + leg_h], radius=leg_w * 0.45, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.6)).point(lambda v: 255 if v > 110 else v)

    b = np.array(im); b[:, max(0, col - 1):col + 1 if side == "right" else col + 2, 3] = 0
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fill = Image.new("RGBA", out.size, colour + (255,))
    out.paste(fill, (0, 0), mask)
    canvas = Image.new("RGBA", out.size, (0, 0, 0, 0))
    canvas.paste(Image.fromarray(b), (0, 0))
    return im, Image.alpha_composite(out, canvas), colour

def backup(pid):
    """写回前先把原图备份到 archive/asset-backup/ —— 上次把 1099 写坏就是没备份。"""
    m = json.load(open(MP, encoding="utf-8"))
    p = next(x for x in m["pigs"] if x["id"] == pid)
    src_path = os.path.join(BASE, p["file"])
    os.makedirs(BACKUP, exist_ok=True)
    dst = os.path.join(BACKUP, pid + ".png")
    if not os.path.exists(dst):
        shutil.copyfile(src_path, dst)
    return dst

if __name__ == "__main__":
    write = "--write" in sys.argv
    targets = [("pighub-341", "right", True), ("pighub-974", "right", True), ("pighub-865", "right", True),
               ("pighub-659", "right", True), ("pighub-426", "left", True), ("pighub-255", "left", False)]
    for pid, side, legs in targets:
        if write:
            backup(pid)
        before, after, colour = complete_side(pid, side, legs)
        sheet = Image.new("RGB", (before.width + after.width + 20, max(before.height, after.height)), (28, 30, 36))
        sheet.paste(before, (0, 0), before); sheet.paste(after, (before.width + 20, 0), after)
        p = os.path.join(PREVIEW, pid + "-side.png")
        os.makedirs(PREVIEW, exist_ok=True)
        sheet.save(p)
        print(pid, side, "colour", colour, "->", sheet.size)
