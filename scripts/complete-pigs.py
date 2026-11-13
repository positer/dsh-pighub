"""
残缺猪补全（构建期工具，需要 Pillow）。

做法（v5，2026-11-13）：
  1. 量切口：取最后 15 行的真实宽度/中心（不是 bbox 宽度）；
  2. 腹部：从切口宽度平滑收到「腿总宽」，高度 0.16×切口宽；
  3. 腿：按标准猪腿的占比（腿宽 0.15、腿高 0.22、间距 0.10）× 切口宽，圆底小柱；
  4. 抹掉原图最后两行（被切出来的硬边，带抗锯齿暗边），再合成，避免接缝横线；
  5. 新增区域统一填「切口上方 20px 的中位体色」。

用法：
  python scripts/complete-pigs.py            # 只出预览
  python scripts/complete-pigs.py --write    # 写回 assets/img 并打印新指纹
"""
import hashlib
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(BASE, "assets", "manifest.json")
PREVIEW = os.path.join(BASE, "..", "archive", "20261113-completion")
LEGS_N = 3


def load(pid):
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    pig = next(x for x in manifest["pigs"] if x["id"] == pid)
    path = os.path.join(BASE, pig["file"])
    im = Image.open(path)
    im.seek(0)
    return im.convert("RGBA")


def bbox(arr):
    ys, xs = np.where(arr > 16)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def complete_bottom(pid):
    im = load(pid)
    arr = np.array(im)
    a = arr[:, :, 3] > 16
    x0, y0, x1, y1 = bbox(arr[:, :, 3])
    widths, centres = [], []
    for y in range(max(y0, y1 - 14), y1 + 1):
        xs = np.where(a[y])[0]
        if len(xs):
            widths.append(len(xs))
            centres.append((xs.min() + xs.max()) / 2.0)
    w_cut = float(np.median(widths))
    cx = float(np.median(centres))
    band = arr[max(y0, y1 - 20):y1, :, :3][arr[max(y0, y1 - 20):y1, :, 3] > 200]
    col = tuple(int(np.median(band[:, i])) for i in range(3)) if len(band) else (255, 210, 177)

    belly_h = max(4, int(w_cut * 0.16))
    leg_w = max(4, int(w_cut * 0.15))
    leg_h = max(4, int(w_cut * 0.22))
    leg_gap = max(2, int(w_cut * 0.10))
    total_w = LEGS_N * leg_w + (LEGS_N - 1) * leg_gap
    height = im.height + belly_h + leg_h + 4

    mask = Image.new("L", (im.width, height), 0)
    mask.paste(Image.fromarray((a.astype(np.uint8) * 255), "L"), (0, 0))
    d = ImageDraw.Draw(mask)
    for k in range(belly_h):
        t = (k + 1) / belly_h
        w = w_cut + (total_w - w_cut) * t
        d.line([(cx - w / 2, y1 + k + 1), (cx + w / 2, y1 + k + 1)], fill=255)
    base_y = y1 + belly_h
    left = cx - total_w / 2
    for i in range(LEGS_N):
        lx = left + i * (leg_w + leg_gap)
        d.rounded_rectangle([lx, base_y - 2, lx + leg_w, base_y + leg_h], radius=leg_w * 0.45, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))
    mask = mask.point(lambda v: 255 if v > 110 else v)

    base = im.copy()
    ba = np.array(base)
    ba[y1 - 1:y1 + 1, :, 3] = 0
    base = Image.fromarray(ba)

    out = Image.new("RGBA", (im.width, height), (0, 0, 0, 0))
    fill = Image.new("RGBA", out.size, col + (255,))
    out.paste(fill, (0, 0), mask)
    canvas = Image.new("RGBA", out.size, (0, 0, 0, 0))
    canvas.paste(base, (0, 0))
    return im, Image.alpha_composite(out, canvas), col


TARGETS = ["pighub-868", "pighub-379", "pighub-255", "pighub-1099"]

if __name__ == "__main__":
    write = "--write" in sys.argv
    results = []
    for pid in TARGETS:
        before, after, col = complete_bottom(pid)
        os.makedirs(PREVIEW, exist_ok=True)
        sheet = Image.new("RGB", (before.width + after.width + 20, max(before.height, after.height)), (28, 30, 36))
        sheet.paste(before, (0, 0), before)
        sheet.paste(after, (before.width + 20, 0), after)
        sheet.save(os.path.join(PREVIEW, pid + "-final.png"))
        if write:
            manifest = json.load(open(MANIFEST, encoding="utf-8"))
            pig = next(x for x in manifest["pigs"] if x["id"] == pid)
            path = os.path.join(BASE, pig["file"])
            after.save(path)
            data = open(path, "rb").read()
            pig["bytes"] = len(data)
            pig["sha256"] = hashlib.sha256(data).hexdigest()
            pig["size"] = {"width": after.width, "height": after.height}
            pig["completion"] = {
                "mode": "bottom-legs",
                "at": "2026-11-13",
                "reference": "standard-pig",
                "fillColour": list(col),
                "note": "半身像被直线切断：抹掉切边后向下补腹部收口 + 三只圆底腿，统一填切口上方的中位体色。",
            }
            json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            open(MANIFEST, "a", encoding="utf-8").write("\n")
            results.append({"id": pid, "size": pig["size"], "sha256": pig["sha256"][:12], "colour": list(col)})
        print(pid, "ok", after.size)
    print(json.dumps(results, ensure_ascii=False))
