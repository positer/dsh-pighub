"""
PNG vs SVG 对照：把同一只猪的位图与矢量图**并排渲染在同一张洋红底上**，截一张图，
再逐像素算三个数（不靠肉眼）。

为什么要渲染而不是比文件：SVG 的体积/路径数与「看起来一不一样」没有关系（vtracer 的
filter_speckle=8 会吃掉细节，spline 会在轮廓上外扩 1–2px）。只有把两者都交给浏览器
在同一块底上渲染出来，才有可比的对象。

为什么底是洋红 #FF00FF：素材都是透明的，透明区在截图上必须有一个确定的颜色，
洋红在猪的调色（米色/粉/棕/黑）里不会出现，所以「不是洋红」就等于「画了东西」。
判据因此可以写成像素谓词，而不是「我觉得差不多」。

三个读数（每个 id 一条）：
  IoU       —— SVG 画到的像素 与 PNG alpha>16 的像素 的交并比（形状对不对）
  meanDiff  —— 两张渲染图在并集区域上的平均通道差（颜色对不对）
  bigPct    —— 通道差 > 32 的像素占并集的比例（有没有肉眼可见的坏块）

用法：
  RUNTIME_PY scripts/_vector-compare.py --svg=.tmp-vectorize/svg --out=.tmp-vectorize/sheets
  RUNTIME_PY scripts/_vector-compare.py --svg=... --ids=pighub-751,pighub-873
"""
import argparse
import json
import os
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
MAGENTA = (255, 0, 255)
GAP = 24          # 同一只猪 PNG 与 SVG 之间
PAD = 20          # 单元格之间
LABEL_H = 22
BG = "#FF00FF"


_SHOT_SEQ = [0]


def edge_shot(html_path, out_png, width, height, udir_root):
    """每次用**独立的 user-data-dir**。

    实测（2026-11-15）：同一个 profile 目录连着用，第二次起 Edge 会把请求交给仍然活着的
    那个实例、自己立刻退出，--screenshot 于是根本不落盘（进程 rc=0 但文件没有）。
    独立目录之后连续 3 次都是 0.1–0.3 s 出图。代价是每张多一个 profile 目录，收尾一起删。
    """
    _SHOT_SEQ[0] += 1
    udir = os.path.join(udir_root, "p%03d" % _SHOT_SEQ[0])
    if os.path.exists(out_png):
        os.remove(out_png)
    cmd = [
        EDGE, "--headless=new", "--disable-gpu", "--force-device-scale-factor=1",
        "--user-data-dir=" + udir, "--window-size=%d,%d" % (width, height),
        "--screenshot=" + out_png, "file:///" + html_path.replace("\\", "/"),
    ]
    subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    for _ in range(100):
        if os.path.exists(out_png) and os.path.getsize(out_png) > 0:
            return True
        time.sleep(0.1)
    return False


def layout(cards):
    """两列网格；每格 = PNG | SVG 并排，行高取该行最大。返回绝对坐标。"""
    cells = []
    x0 = PAD
    row_y = PAD
    for r in range(0, len(cards), 2):
        row = cards[r:r + 2]
        row_h = max(c["h"] for c in row)
        x = x0
        for c in row:
            c = dict(c)
            c["px"] = x
            c["py"] = row_y + LABEL_H
            c["sx"] = x + c["w"] + GAP
            c["sy"] = row_y + LABEL_H
            cells.append(c)
            x += 2 * c["w"] + GAP + PAD
        row_y += LABEL_H + row_h + PAD
    width = max((c["px"] + 2 * c["w"] + GAP) for c in cells) + PAD
    height = row_y
    return cells, int(width), int(height)


def build_html(cells, width, height):
    parts = [
        "<!doctype html><html><head><meta charset='utf-8'><style>",
        "html,body{margin:0;padding:0;background:%s;overflow:hidden}" % BG,
        "img{position:absolute;display:block}",
        "div{position:absolute;font:12px/1.2 Consolas,monospace;color:#000}",
        "</style></head><body>",
    ]
    for c in cells:
        parts.append("<div style='left:%dpx;top:%dpx'>%s &nbsp; png %dx%d / svg %dx%d</div>"
                     % (c["px"], c["py"] - LABEL_H + 4, c["id"], c["w"], c["h"], c["w"], c["h"]))
        parts.append("<img style='left:%dpx;top:%dpx;width:%dpx;height:%dpx' src='file:///%s'>"
                     % (c["px"], c["py"], c["w"], c["h"], c["png"].replace("\\", "/")))
        parts.append("<img style='left:%dpx;top:%dpx;width:%dpx;height:%dpx' src='file:///%s'>"
                     % (c["sx"], c["sy"], c["w"], c["h"], c["svg"].replace("\\", "/")))
    parts.append("</body></html>")
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--svg", default=os.path.join(BASE, ".tmp-vectorize", "svg"))
    ap.add_argument("--out", default=os.path.join(BASE, ".tmp-vectorize", "sheets"))
    ap.add_argument("--batch", type=int, default=6)
    ap.add_argument("--ids", default=None, help="逗号分隔；不给就取报告里的全部成功项")
    ap.add_argument("--report", default=os.path.join(BASE, ".tmp-vectorize", "vectorize-report.json"))
    ap.add_argument("--metrics", default=os.path.join(BASE, ".tmp-vectorize", "compare-metrics.json"))
    # 读数取哪个尺寸：native = 原始像素尺寸（保守上界，会把显示时看不见的差别放大）；
    # display = 清单 sizeRatio 的 CSS px（猪在猪圈里真正被画出来的宽度）。审计用 display。
    ap.add_argument("--scale", choices=("native", "display"), default="native")
    args = ap.parse_args()
    # 一律转绝对路径：file:/// 只认绝对路径，相对的 --out 会让截图 URL 变成
    # file:///tmp-vectorize/...（少一个盘符），Edge 直接截一张空图或干脆不落盘。
    for name in ("svg", "out", "metrics", "report"):
        value = getattr(args, name)
        if value and not os.path.isabs(value):
            setattr(args, name, os.path.join(BASE, value))

    import numpy as np
    from PIL import Image

    manifest = json.load(open(os.path.join(BASE, "assets", "manifest.json"), encoding="utf-8"))
    by = {p["id"]: p for p in manifest["pigs"]}
    if args.ids:
        ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    else:
        rep = json.load(open(args.report, encoding="utf-8"))
        ids = [r["id"] for r in rep["items"] if r.get("ok")]

    os.makedirs(args.out, exist_ok=True)
    udir = os.path.join(os.path.dirname(args.out), "ud")
    os.makedirs(udir, exist_ok=True)

    cards = []
    for pid in ids:
        # 写回之后清单的 file 已经指向 SVG，位图在 raster 里（方案 A：PNG 保留不删）。
        png = os.path.join(BASE, by[pid].get("raster") or by[pid]["file"])
        svg = os.path.join(args.svg, pid + ".svg")
        if not (os.path.exists(png) and os.path.exists(svg)):
            continue
        with Image.open(png) as im:
            w, h = im.size
        if args.scale == "display":
            ratio = float(by[pid].get("sizeRatio") or 96.0)
            w, h = int(round(ratio)), int(round(ratio * h / float(w)))
        cards.append({"id": pid, "png": png, "svg": svg, "w": w, "h": h})

    metrics, sheets = [], []
    mag = np.array(MAGENTA, dtype=np.int16)
    for b in range(0, len(cards), args.batch):
        batch = cards[b:b + args.batch]
        cells, width, height = layout(batch)
        html = os.path.join(args.out, "batch-%02d.html" % (b // args.batch))
        open(html, "w", encoding="utf-8").write(build_html(cells, width, height))
        shot = os.path.join(args.out, "batch-%02d.png" % (b // args.batch))
        if not edge_shot(html, shot, width, height, udir):
            print("截图失败: " + shot)
            continue
        img = Image.open(shot).convert("RGB")
        arr = np.array(img).astype(np.int16)
        sheets.append(shot)
        for c in cells:
            w, h = c["w"], c["h"]
            left = arr[c["py"]:c["py"] + h, c["px"]:c["px"] + w]
            right = arr[c["sy"]:c["sy"] + h, c["sx"]:c["sx"] + w]
            if left.shape != (h, w, 3) or right.shape != (h, w, 3):
                print("裁剪越界: %s" % c["id"])
                continue
            drawn_l = np.abs(left - mag).sum(axis=2) > 12
            drawn_r = np.abs(right - mag).sum(axis=2) > 12
            with Image.open(c["png"]) as im:
                a_img = im.convert("RGBA")
                if (a_img.width, a_img.height) != (w, h):
                    # display 口径：把 alpha 一并缩到同一尺寸再比，否则两个掩膜不同形。
                    a_img = a_img.resize((w, h), Image.LANCZOS)
                alpha = np.array(a_img)[:, :, 3] > 16
            inter = int((drawn_r & alpha).sum())
            union = int((drawn_r | alpha).sum())
            diff = np.abs(right - left).max(axis=2)
            both = drawn_l | drawn_r
            metrics.append({
                "id": c["id"],
                "canvas": [w, h],
                "pngRect": [c["px"], c["py"], w, h],
                "svgRect": [c["sx"], c["sy"], w, h],
                "iou": round(inter / union, 4) if union else 1.0,
                "drawn_png": round(float(drawn_l.mean()), 4),
                "drawn_svg": round(float(drawn_r.mean()), 4),
                "svg_on_transparent_px": int((drawn_r & ~alpha).sum()),
                "png_but_empty_px": int((alpha & ~drawn_r).sum()),
                "meanDiff": round(float(diff[both].mean()), 2) if both.any() else 0.0,
                "bigPct": round(float((diff[both] > 32).mean()) * 100, 2) if both.any() else 0.0,
            })
        print("batch %02d: %d 张 -> %s" % (b // args.batch, len(cells), shot), flush=True)

    out = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "sheets": sheets,
           "count": len(metrics), "metrics": metrics}
    os.makedirs(os.path.dirname(args.metrics), exist_ok=True)
    json.dump(out, open(args.metrics, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(args.metrics, "a", encoding="utf-8").write("\n")

    if metrics:
        ious = sorted(m["iou"] for m in metrics)
        diffs = sorted(m["meanDiff"] for m in metrics)
        bigs = sorted(m["bigPct"] for m in metrics)
        print()
        print("对比 %d 张：IoU 中位 %.4f（最小 %.4f）  平均差 中位 %.2f（最大 %.2f）  >32 占比 中位 %.2f%%（最大 %.2f%%）"
              % (len(metrics), ious[len(ious) // 2], ious[0], diffs[len(diffs) // 2], diffs[-1],
                 bigs[len(bigs) // 2], bigs[-1]))
        worst = sorted(metrics, key=lambda m: m["iou"])[:6]
        print("IoU 最低的 6 张: " + ", ".join("%s(%.3f)" % (m["id"], m["iou"]) for m in worst))
        noisy = sorted(metrics, key=lambda m: -m["bigPct"])[:6]
        print(">32 占比最高的 6 张: " + ", ".join("%s(%.1f%%)" % (m["id"], m["bigPct"]) for m in noisy))
    print("读数: " + args.metrics)
    return 0


if __name__ == "__main__":
    sys.exit(main())
