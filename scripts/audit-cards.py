import json, os
import numpy as np
from PIL import Image
from collections import Counter

ROOT = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
man = json.load(open(os.path.join(ROOT, "assets", "manifest.json"), encoding="utf-8"))
N = 128

def load(p):
    im = Image.open(p)
    if getattr(im, "is_animated", False):
        im.seek(0)
    return im.convert("RGBA")

def mask_of(a, src=False):
    if src:
        rgb = a[:, :, :3].astype(int)
        return ~((rgb[:, :, 0] > 245) & (rgb[:, :, 1] > 245) & (rgb[:, :, 2] > 245))
    return a[:, :, 3] > 8

rows = []
for pig in man["pigs"]:
    name = pig["file"].split("/")[-1]
    op = os.path.join(ROOT, "assets", "originals", name)
    cp = os.path.join(ROOT, "assets", "img", name)
    if not os.path.exists(op):
        rows.append((pig["id"], "no_baseline", "-", "-", ""))
        continue
    try:
        o = load(op); c = load(cp)
    except Exception as e:
        rows.append((pig["id"], "error", "-", "-", str(e)[:30]))
        continue
    oa, ca = np.array(o), np.array(c)
    if o.size == c.size:
        # 同画布：直接逐像素比，无对齐误差
        om = mask_of(oa, True)
        ys, xs = np.nonzero(om)
        orr = oa[ys, xs, :3].astype(int)
        crr = ca[ys, xs, :3].astype(int)
        diff = int((np.abs(orr - crr).sum(axis=1) > 12).sum())
        cm = mask_of(ca)
        added = int(max(0, int(cm.sum()) - int(om.sum())))
        rows.append((pig["id"], "ok" if diff == 0 else "CHANGED", str(diff), str(added), "same_size"))
        continue
    # 不同画布：降采样 + 质心 + ±6 搜索（粗对齐），只做定性
    om_s = np.array(Image.fromarray((mask_of(oa, True) * 255).astype(np.uint8), "L").resize((N, N), Image.BILINEAR)) > 110
    cm_s = np.array(Image.fromarray((mask_of(ca) * 255).astype(np.uint8), "L").resize((N, N), Image.BILINEAR)) > 110
    ys, xs = np.nonzero(om_s)
    if len(xs) < 20:
        rows.append((pig["id"], "needs_manual", "-", "-", "empty_mask"))
        continue
    cy, cx = ys.mean(), xs.mean()
    ty, tx = np.nonzero(cm_s)
    tyc, txc = ty.mean(), tx.mean()
    best, best_s = None, -1.0
    for dy in range(int(tyc - cy) - 8, int(tyc - cy) + 9):
        for dx in range(int(txc - cx) - 8, int(txc - cx) + 9):
            yy = ys + dy; xx = xs + dx
            ok = (yy >= 0) & (yy < N) & (xx >= 0) & (xx < N)
            if ok.sum() < len(ys) * 0.6:
                continue
            s = cm_s[yy[ok], xx[ok]].mean()
            if s > best_s:
                best, best_s = (dy, dx), s
    if best_s < 0.95:
        rows.append((pig["id"], "needs_manual", "-", "-", "score=%.2f size=%dx%d" % (best_s, o.width, o.height)))
        continue
    rows.append((pig["id"], "resized", "-", "-", "score=%.2f %dx%d→%dx%d" % (best_s, o.width, o.height, c.width, c.height)))

with open(os.path.join(ROOT, "archive", "card-audit.tsv"), "w", encoding="utf-8") as f:
    f.write("id\tverdict\tinner_diff\touter_added\tnote\n")
    for r in rows:
        f.write("\t".join(str(x) for x in r) + "\n")
print("verdicts:", dict(Counter(r[1] for r in rows)))
for r in rows:
    if r[1] == "CHANGED":
        print("  CHANGED", r[0], "inner_diff=", r[2], r[4])
