"""
把角色卡里的动画 GIF 加工成能直接进猪圈的贴图：**去白底 + 裁到动画全程的内容框**，
并把量到的「真实不透明像素数」记进 assets/work/gif-alpha-report.json，供改清单那一步写 sizeOpaque。

为什么需要这一步（2026-11-13 实测）：
  1. cards 管线对动画卡是 animated_passthrough（原样随包），但这一批 8 张动画卡里有 5 张画布是
     100% 不透明的近白底（首帧四角 RGB 238–251、alpha 255），原样收编会在草地猪圈上显示成白方框；
  2. pighub-854 的猪只占 621x960 画布的 14%，不裁框的话 sizeRatio 会把整块画布当体量算，猪会缩到看不见；
  3. GIF 在纯 Node 里量不了 alpha，scripts/size-ratios.mjs 会退化成「整块画布都不透明」来估算，
     对 854 这种长条画布误差极大——所以这里量一次真值，写进清单的 sizeOpaque。

口径与 build-assets 一致：只去掉**从画布边缘连通过去**的近白像素（阈值 225），
猪身上的白（眼白、高光）因为不连通而保留；裁框取全部帧的并集，动画动作不会被裁掉。

用法：
  python scripts/gif-alpha.py pighub-813 pighub-812     加工 cards/img/<id>.gif → assets/img/<id>.gif
  python scripts/gif-alpha.py --measure pighub-1131      只量 assets/img/<id>.gif（不重写），补记读数
"""
import os, sys, json
from collections import deque
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "assets", "cards", "img")
DST = os.path.join(BASE, "assets", "img")
REPORT = os.path.join(BASE, "assets", "work", "gif-alpha-report.json")
THR = 225


def border_white(rgba):
    """从四条边向内漫填「近白且不透明」的像素：只删背景，不碰猪身上的白。"""
    rgb = rgba[:, :, :3].astype(np.int16)
    near = (rgb.min(axis=2) >= THR) & (rgba[:, :, 3] > 0)
    h, w = near.shape
    seen = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    return seen


def measure(path, pid):
    """量最终贴图：帧数、画布、逐帧不透明像素的中位数（渲染时一帧一屏，所以按帧量）。"""
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    counts = []
    for i in range(n):
        im.seek(i)
        counts.append(int((np.array(im.convert("RGBA"))[:, :, 3] > 16).sum()))
    counts.sort()
    return {"id": pid, "frames": n, "canvas": list(im.size),
            "opaqueMedian": counts[len(counts) // 2],
            "opaqueMin": counts[0], "opaqueMax": counts[-1],
            "bytes": os.path.getsize(path)}


def record(info):
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    data = {}
    if os.path.exists(REPORT):
        data = json.load(open(REPORT, encoding="utf-8"))
    data[info["id"]] = info
    json.dump(data, open(REPORT, "w", encoding="utf-8"), ensure_ascii=False, indent=2, sort_keys=True)


def process(pid):
    path = os.path.join(SRC, pid + ".gif")
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    frames, durations, union = [], [], None
    for i in range(n):
        im.seek(i)
        rgba = np.array(im.convert("RGBA"))
        rgba[border_white(rgba), 3] = 0
        m = rgba[:, :, 3] > 16
        union = m if union is None else (union | m)
        frames.append(rgba)
        durations.append(im.info.get("duration", 100))
    ys, xs = np.where(union)
    if len(xs) == 0:
        raise SystemExit(pid + ": 全透明，没有内容")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

    # 统一调色板：用内容最多的一帧量化出 255 色，其余帧沿用同一张表，避免逐帧换色。
    flat = max(frames, key=lambda a: int((a[:, :, 3] > 16).sum()))
    pal = Image.fromarray(flat[:, :, :3]).crop(box).quantize(colors=255, method=Image.MEDIANCUT, dither=Image.NONE)

    out = []
    for rgba in frames:
        crop = rgba[box[1]:box[3], box[0]:box[2]]
        p = Image.fromarray(crop[:, :, :3]).quantize(palette=pal, dither=Image.NONE)
        arr = np.array(p).astype(np.uint8)
        arr[crop[:, :, 3] <= 16] = 255          # 255 = 专门留给透明的调色板槽
        frame = Image.fromarray(arr, mode="P").copy()
        frame.putpalette(pal.getpalette()[:768])
        out.append(frame)

    target = os.path.join(DST, pid + ".gif")
    out[0].save(target, save_all=True, append_images=out[1:], duration=durations,
                loop=0, transparency=255, disposal=2, optimize=False)
    info = measure(target, pid)
    info["srcCanvas"] = list(im.size)
    info["mode"] = "stripped+cropped"
    record(info)
    return info


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--measure":
        for pid in args[1:]:
            info = measure(os.path.join(DST, pid + ".gif"), pid)
            info["mode"] = "measured-only"
            record(info)
            print(json.dumps(info, ensure_ascii=False))
    else:
        for pid in args:
            print(json.dumps(process(pid), ensure_ascii=False))
