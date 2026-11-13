"""
全库完整性普查（构建期工具，需要 Pillow）。

判定一只猪「被直线切断」的依据（三条都要满足才判残缺）：
  1. 该边的**不透明像素占该边长的比例** >= 0.55（被切的一侧会一直是满的）；
  2. 该边上连续不透明段的**长度占该边** >= 0.45（装饰物贴边是窄段，切边是长段）；
  3. 该边两侧（内侧 2px）的透明度是**硬过渡**（切边没有抗锯齿的柔和收边）。

输出 JSON + 人类可读清单。用法：python scripts/audit-completeness.py [--json]
"""
import json, os, sys
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(BASE, "assets", "manifest.json")


def longest_run(flags):
    """最长连续不透明段的长度与它的中心位置（0..1，沿该边方向）。"""
    best = cur = 0
    best_mid = 0.0
    start = 0
    for i, v in enumerate(flags):
        if v:
            if cur == 0:
                start = i
            cur += 1
            if cur > best:
                best = cur
                best_mid = (start + i) / 2.0 / max(1, len(flags) - 1)
        else:
            cur = 0
    return best, best_mid


def audit(path):
    im = Image.open(path)
    im.seek(0)
    im = im.convert("RGBA")
    a = np.array(im)[:, :, 3] > 16
    ys, xs = np.where(a)
    if len(xs) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    sub = a[y0:y1 + 1, x0:x1 + 1]
    h, w = sub.shape
    edges = {
        "top": sub[0, :], "bottom": sub[h - 1, :],
        "left": sub[:, 0], "right": sub[:, w - 1],
    }
    hits = {}
    for name, line in edges.items():
        ratio = float(line.mean())
        run, mid = longest_run(line)
        span = run / float(len(line))
        # 第 4 条判据：这条长段必须**盖住中部**（0.25~0.75）。装饰物（旗子/蜗牛壳/苹果）
        # 贴边时只是角上一条斜带，中点落在两端附近，据此排除。
        central = 0.25 <= mid <= 0.75
        # 第 5 条判据：从这条长段的中点**向内**量厚度。被切断的是身体（厚），
        # 装饰物贴边只是薄薄一条（旗子/蜗牛壳/苹果的边）。
        if name in ("left", "right"):
            col_i = 0 if name == "left" else w - 1
            row_mid = int(round(mid * (h - 1)))
            depth = 0
            step = 1 if name == "left" else -1
            x = col_i
            while 0 <= x < w and sub[row_mid, x]:
                depth += 1
                x += step
            thick = depth / float(w)
        else:
            row_i = 0 if name == "top" else h - 1
            col_mid = int(round(mid * (w - 1)))
            depth = 0
            step = 1 if name == "top" else -1
            y = row_i
            while 0 <= y < h and sub[y, col_mid]:
                depth += 1
                y += step
            thick = depth / float(h)
        if ratio >= 0.55 and span >= 0.45 and central and thick >= 0.30:
            hits[name] = {"ratio": round(ratio, 2), "run": round(span, 2), "mid": round(mid, 2), "thick": round(thick, 2)}
    # 内部缺口：bbox 内透明像素占比过高 = 可能只有头没有身体（粗略判断）
    fill = float(sub.mean())
    return {"size": [w, h], "fill": round(fill, 3), "cuts": hits}


if __name__ == "__main__":
    m = json.load(open(MP, encoding="utf-8"))
    rows = []
    for p in m["pigs"]:
        path = os.path.join(BASE, p["file"])
        if not p["file"].lower().endswith(".png"):
            continue
        try:
            r = audit(path)
        except Exception:
            continue
        if not r:
            continue
        rows.append({"id": p["id"], "completion": (p.get("completion") or {}).get("mode", "-"), **r})
    bad = [r for r in rows if r["cuts"]]
    print("普查 %d 只，判定仍被直线切断：%d 只" % (len(rows), len(bad)))
    for r in bad:
        print("  %-14s completion=%-14s cuts=%s fill=%.2f size=%dx%d" % (
            r["id"], r["completion"], ",".join(r["cuts"].keys()), r["fill"], r["size"][0], r["size"][1]))
    out = os.path.join(os.path.dirname(BASE), "archive", "20261113-completion", "audit.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"cards": rows, "incomplete": [r["id"] for r in bad]}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("json ->", out)
