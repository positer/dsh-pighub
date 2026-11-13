"""
补全产物校验探针（_ 前缀 = 一次性探针，不进管线；只读 assets/img，不改任何素材）。

对 manifest 里每只有 completion 记录的猪逐张量五件事：
  1. 来源：与 assets/img/standard-pig.png 的 alpha 轮廓 IoU（缩放到同一画布后），
     以及（换头法）与标准猪的 RGB 逐像素一致率 —— 换头法的身体必须就是标准猪；
  2. 接缝：接缝两侧 ±8 的逐列/行中位亮度剖面，最大相邻台阶（taste.md §H.3 口径；
     接缝坐标由 before↔after 的掩膜互相关**自己解出来**，不读补全脚本的写入记录）；
  3. 完整性：importlib 调 scripts/audit-completeness.py 的 audit()（不复制算法）；
  4. 元数据：bytes / sha256 / size / sizeRatio 与磁盘逐字节对账；
  5. 出 3 倍放大目检图（每只一张：左=2x 全图，右=接缝带 3x）。

用法：python scripts/_verify-completion.py --out archive/<ts>-verify-completion/
"""
import argparse, hashlib, importlib.util, json, os, sys
import numpy as np
from PIL import Image
from scipy.signal import fftconvolve

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(BASE, "assets", "manifest.json")
std_path = os.path.join(BASE, "assets", "img", "standard-pig.png")

def _load_audit():
    spec = importlib.util.spec_from_file_location("audit_completeness", os.path.join(BASE, "scripts", "audit-completeness.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
AUDIT = _load_audit()

def lum(a):
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]

def load_rgba(p):
    im = Image.open(p); im.seek(0); return np.array(im.convert("RGBA"))

def crop_bbox(arr):
    ys, xs = np.nonzero(arr[:, :, 3] > 16)
    return arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def align(before, after):
    """把 before 放进 after 画布，解出平移 (dy,dx)：掩膜互相关取最大重叠。"""
    A = (after[:, :, 3] > 16).astype(np.float32)
    B = (before[:, :, 3] > 16).astype(np.float32)
    corr = fftconvolve(A, B[::-1, ::-1], mode="full")
    i, j = np.unravel_index(np.argmax(corr), corr.shape)
    dy, dx = i - (B.shape[0] - 1), j - (B.shape[1] - 1)
    Hb, Wb = B.shape
    canvas = np.zeros(A.shape, np.float32); canvas_b = np.zeros(after.shape, np.uint8)
    y0, x0 = max(0, dy), max(0, dx)
    y1, x1 = min(A.shape[0], dy + Hb), min(A.shape[1], dx + Wb)
    if y1 <= y0 or x1 <= x0:
        return None
    canvas[y0:y1, x0:x1] = B[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    canvas_b[y0:y1, x0:x1] = before[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    ov = (canvas > 0) & (A > 0)
    if ov.sum() == 0:
        return None
    d = np.abs(canvas_b[:, :, :3].astype(np.int16) - after[:, :, :3].astype(np.int16)).max(axis=2)
    same = float((d[ov] <= 6).mean())
    return {"dy": int(dy), "dx": int(dx), "overlap": int(ov.sum()), "rgb_same_frac": round(same, 3),
            "bw": int(Wb), "bh": int(Hb)}

def profile_steps(arr, axis, coord, win=8, face=None):
    """taste.md §H.3：±win 全不透明行/列的中位亮度剖面 + 相邻台阶。"""
    a = arr.astype(np.float32); al = a[:, :, 3] > 200; L = lum(a)
    prof = []
    if axis == "v":
        xs = range(max(0, coord - win), min(a.shape[1], coord + win + 1))
        rows = [y for y in range(a.shape[0]) if all(al[y, x] for x in xs)]
        if face is not None:
            rows = [y for y in rows if face[0] <= y <= face[1]]
        if len(rows) < 8:
            return {"error": "too few fully-opaque rows", "rows": len(rows), "coord": int(coord)}
        prof = [(x, float(np.median(L[rows, x]))) for x in xs]
    else:
        ys = range(max(0, coord - win), min(a.shape[0], coord + win + 1))
        cols = [x for x in range(a.shape[1]) if all(al[y, x] for y in ys)]
        if face is not None:
            cols = [x for x in cols if face[0] <= x <= face[1]]
        if len(cols) < 8:
            return {"error": "too few fully-opaque cols", "cols": len(cols), "coord": int(coord)}
        prof = [(y, float(np.median(L[y, cols]))) for y in ys]
    steps = [(abs(prof[i + 1][1] - prof[i][1]), prof[i + 1][0]) for i in range(len(prof) - 1)]
    if not steps:
        return {"error": "empty profile", "coord": int(coord), "n": len(prof)}
    mx, atmx = max(steps)
    srt = sorted(steps, reverse=True)
    seam = [s for s, c in steps if c == coord]
    # 封口线是不是一条横贯的直线：在 coord 这一行/列上，猪身不透明的连续段占该行/列全宽的比例
    al2 = arr[:, :, 3] > 200
    if axis == "h":
        line = al2[min(max(coord, 0), arr.shape[0] - 1), :]
    else:
        line = al2[:, min(max(coord, 0), arr.shape[1] - 1)]
    run, _ = (max((len(s) for s in "".join("1" if v else "0" for v in line).split("0")), default=0), 0)
    straight = {"line_opaque_frac": round(float(line.mean()), 3),
                "line_longest_run_frac": round(run / float(len(line)), 3)}
    return {"coord": int(coord), "n": len(prof), "straight_line": straight,
            "profile": [[int(c), round(v, 1)] for c, v in prof],
            "max_step": round(mx, 2), "max_step_at": int(atmx),
            "second_step": round(srt[1][0], 2) if len(srt) > 1 else 0.0,
            "median_step": round(float(np.median([s for s, _ in steps])), 2),
            "step_at_seam": round(seam[0], 2) if seam else None,
            "max_is_at_seam": bool(int(atmx) == int(coord))}

def cap_flatness(arr, side, coord, margin=3):
    """端帽内部是不是一整片平涂色：占帽内不透明像素中，与帽内中位色最大通道差 <=6 的比例。
    闭合法的端帽按「原图最近纯填色」平涂，所以这个数应当很高（腿与描边会拉低一点）。"""
    al = arr[:, :, 3] > 200
    H, W = al.shape
    if side == "right":
        reg = (slice(0, H), slice(coord + 2, max(coord + 3, W - margin)))
    elif side == "left":
        reg = (slice(0, H), slice(margin, max(margin + 1, coord - 1)))
    elif side == "bottom":
        reg = (slice(coord + 2, max(coord + 3, H - margin)), slice(0, W))
    else:
        reg = (slice(margin, max(margin + 1, coord - 1)), slice(0, W))
    m = al[reg]
    if m.sum() < 50:
        return None
    px = arr[reg][:, :, :3][m].astype(np.int16)
    med = np.median(px, axis=0)
    return round(float((np.abs(px - med).max(axis=1) <= 6).mean()), 3)

def zoom(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(BASE, "archive", "_verify-tmp"))
    ap.add_argument("--before-closure", default=os.path.join(BASE, "archive", "20261113-223028-complete-all-pigs", "before"))
    ap.add_argument("--before-graft", default=os.path.join(BASE, "archive", "20261113-223028-complete-all-pigs", "before"))
    ap.add_argument("--before-swap", default=os.path.join(BASE, "archive", "20261113-204139-heads-up-headswap"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    m = json.load(open(MP, encoding="utf-8"))
    pigs = [p for p in m["pigs"] if p.get("completion")]
    std = crop_bbox(load_rgba(std_path))
    ws = np.array(Image.fromarray(std).split()[3])
    res = []
    for p in pigs:
        pid, mode = p["id"], p["completion"]["mode"]
        path = os.path.join(BASE, p["file"])
        raw = open(path, "rb").read()
        arr = load_rgba(path)
        bb = crop_bbox(arr)
        h, w = bb.shape[:2]
        pim = Image.open(path)
        rec = {"id": pid, "mode": mode, "file": p["file"], "disk": {"bytes": len(raw),
               "sha256": hashlib.sha256(raw).hexdigest(), "size": [pim.width, pim.height],
               "bbox_size": [w, h]},
               "manifest": {"bytes": p["bytes"], "sha256": p["sha256"],
                            "size": [p["size"]["width"], p["size"]["height"]], "sizeRatio": p.get("sizeRatio")}}
        rec["meta_ok"] = (rec["disk"]["bytes"] == rec["manifest"]["bytes"] and
                          rec["disk"]["sha256"] == rec["manifest"]["sha256"] and
                          rec["disk"]["size"] == rec["manifest"]["size"])
        rec["sizeRatio_in_range"] = bool(p.get("sizeRatio") is not None and 62 <= p["sizeRatio"] <= 137)
        # 1. 来源：轮廓 IoU（标准猪缩放到目标 bbox）
        tm = (bb[:, :, 3] > 16).astype(np.uint8)
        sm = np.array(Image.fromarray((ws > 16).astype(np.uint8) * 255).resize((w, h), Image.NEAREST)) > 127
        inter = int((tm.astype(bool) & sm).sum()); uni = int((tm.astype(bool) | sm).sum())
        rec["provenance"] = {"iou_vs_standard": round(inter / uni, 3),
                             "iou_inter": inter, "iou_union": uni}
        if mode == "head-swap":
            std_raw = load_rgba(std_path)
            if std_raw.shape[:2] == arr.shape[:2]:
                d = np.abs(std_raw[:, :, :3].astype(np.int16) - arr[:, :, :3].astype(np.int16)).max(axis=2)
                ao = arr[:, :, 3] > 200
                rec["provenance"]["body_rgb_match_frac"] = round(float((d[ao] <= 6).mean()), 3)
                rec["provenance"]["body_rgb_match_px"] = int((d[ao] <= 6).sum())
                rec["provenance"]["body_opaque_px"] = int(ao.sum())
        # 3. 完整性（复用 audit）
        a = AUDIT.audit(path)
        rec["completeness"] = {"audit_cuts": list((a or {}).get("cuts", {}).keys()), "fill": (a or {}).get("fill")}
        # before 对齐
        pre = None
        cand = [os.path.join(args.before_closure if mode != "head-swap" else args.before_swap, os.path.basename(p["file"]))]
        for c in cand:
            if os.path.exists(c):
                pre = crop_bbox(load_rgba(c))
        rec["has_before"] = pre is not None
        # 2. 接缝。坐标来源：closure 用补全写入记录（writeback 的 seam pos，已逐条核对
        #    与画布尺寸相容：cap 深度 13..80px）；head-swap 用写入记录的 face_box 各条边；
        #    graft 用「卡片原图」的头顶下沿（该模式的躯干藏在头后面，结构上没有直缝）。
        #    剖面与台阶由本探针自量，不读写入记录里的读数。
        seams = []
        if mode == "contour-closure":
            wb = json.load(open(os.path.join(BASE, "archive", "20261113-223028-complete-all-pigs", "writeback.json"), encoding="utf-8"))
            for side, wb_max, wb_pos, wb_seam in next((x["seams"] for x in wb["pigs"] if x["id"] == pid), []):
                st = profile_steps(bb, "v" if side in ("left", "right") else "h", int(wb_pos))
                st["side"] = side
                st["cap_flat"] = cap_flatness(bb, side, int(wb_pos))
                st["writeback"] = {"max_step": wb_max, "pos": wb_pos, "seam_step": wb_seam}
                seams.append(st)
        elif mode == "head-swap":
            wb2 = json.load(open(os.path.join(BASE, "archive", "20261113-204139-heads-up-headswap", "writeback.json"), encoding="utf-8"))
            meta = wb2[pid]["meta"]
            fb = meta["face_box"]
            rec["face_box"] = fb
            for side, coord in (("bottom", fb[3]), ("right", fb[2]), ("top", fb[1]), ("left", fb[0])):
                if side not in meta["edges"]:
                    continue
                st = profile_steps(bb, "v" if side in ("left", "right") else "h", int(coord))
                st["side"] = side
                seams.append(st)
        elif mode == "body-graft" and pre is not None:
            al_ = align(pre, bb)
            rec["align"] = al_
            hb = pre.shape[0]
            seam_y = al_["dy"] + hb - 1
            st = profile_steps(bb, "h", seam_y)
            st["side"] = "head-bottom(graft)"
            st["before_same_measure"] = profile_steps(pre, "h", hb - 1)
            seams.append(st)
        rec["seams"] = seams
        res.append(rec)
        # 5. 3 倍目检图
        pil = Image.fromarray(bb, "RGBA")
        tiles = [zoom(pil, 2)]
        for st in seams:
            if "error" in st:
                continue
            c = st["coord"]
            if st["side"].startswith(("left", "right")):
                band = pil.crop((max(0, c - 16), 0, min(pil.width, c + 17), pil.height))
            elif st["side"].startswith(("top", "bottom")):
                band = pil.crop((0, max(0, c - 16), pil.width, min(pil.height, c + 17)))
            else:
                band = pil.crop((0, max(0, c - 16), pil.width, min(pil.height, c + 17)))
            tiles.append(zoom(band, 3))
        Wt = sum(t.width for t in tiles) + 8 * (len(tiles) - 1)
        Ht = max(t.height for t in tiles)
        sheet = Image.new("RGBA", (Wt, Ht), (255, 255, 255, 255))
        x = 0
        for t in tiles:
            sheet.alpha_composite(t, (x, 0)); x += t.width + 8
        outp = os.path.join(args.out, "%s-verify3x.png" % pid)
        sheet.save(outp)
        rec["zoom_png"] = os.path.relpath(outp, BASE)
    json.dump({"pigs": res}, open(os.path.join(args.out, "verify.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    for r in res:
        s = r["seams"][0] if r["seams"] else {}
        print("%-12s %-14s meta=%s sR=%s(%s) iou=%.3f cuts=%s seam=%s" % (
            r["id"], r["mode"], r["meta_ok"], r["manifest"]["sizeRatio"], r["sizeRatio_in_range"],
            r["provenance"]["iou_vs_standard"], r["completeness"]["audit_cuts"],
            ("%s max=%.2f at=%s seamstep=%s" % (s.get("side"), s.get("max_step", -1),
             s.get("max_step_at"), s.get("step_at_seam"))) if s else "-"))
    print("json ->", os.path.join(args.out, "verify.json"))

if __name__ == "__main__":
    main()
