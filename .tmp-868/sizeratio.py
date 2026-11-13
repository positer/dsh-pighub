
# 复算 sizeRatio（与 scripts/size-ratios.mjs 同口径），并用现行 manifest 自证复刻忠实。
import json, math, os
import numpy as np
from PIL import Image

def jround(x):
    # JS Math.round: 半数向 +inf
    return math.floor(x + 0.5)

def stats(path, pig):
    if path.lower().endswith(".png"):
        im = Image.open(path); im.seek(0)
        a = np.array(im.convert("RGBA"))
        return im.width, im.height, int((a[:, :, 3] > 16).sum())
    w, h = pig["size"]["width"], pig["size"]["height"]
    so = pig.get("sizeOpaque")
    opaque = so if isinstance(so, (int, float)) and so > 0 else w * h
    return w, h, int(opaque)

m = json.load(open("assets/manifest.json", encoding="utf-8"))
rows = []
for pig in m["pigs"]:
    p = os.path.join("assets", str(pig["file"]).replace("assets/", ""))
    try:
        w, h, opaque = stats(p, pig)
    except Exception as e:
        print("skip", pig["id"], e); continue
    if not opaque: continue
    rows.append({"id": pig["id"], "w": w, "opaque": opaque, "ratio": w / math.sqrt(opaque)})

rows.sort(key=lambda r: r["ratio"])
med = rows[len(rows) // 2]["ratio"]
for r in rows:
    r["sr"] = jround((96 * r["ratio"] / med) * 100) / 100.0

bad = []
for pig in m["pigs"]:
    hit = next((r for r in rows if r["id"] == pig["id"]), None)
    if hit and abs(hit["sr"] - float(pig["sizeRatio"])) > 1e-9:
        bad.append((pig["id"], pig["sizeRatio"], hit["sr"]))
print("pigs measured:", len(rows), " median ratio: %.6f" % med)
print("sizeRatio replication mismatches:", len(bad), bad[:5])

# 新值（候选 C.png 取代 868 的像素）
cur = next(r for r in rows if r["id"] == "pighub-868")
im = Image.open(".tmp-868/C.png"); a = np.array(im.convert("RGBA"))
new_opaque = int((a[:, :, 3] > 16).sum())
new_ratio = im.width / math.sqrt(new_opaque)
print("868 opaque  before:", cur["opaque"], " after:", new_opaque, " delta:", new_opaque - cur["opaque"])
print("868 ratio   before: %.6f  after: %.6f" % (cur["ratio"], new_ratio))

ratios = sorted([r["ratio"] for r in rows if r["id"] != "pighub-868"] + [new_ratio])
med2 = ratios[len(ratios) // 2]
new_sr = jround((96 * new_ratio / med2) * 100) / 100.0
print("median before: %.6f  median after: %.6f  (同一只 -> %s)" % (med, med2, "一致" if med == med2 else "变了"))
print("868 sizeRatio before:", cur["sr"], " after:", new_sr)
print("visual = sqrt(A)*sr/W  before: %.3f  after: %.3f" % (
    math.sqrt(cur["opaque"]) * cur["sr"] / cur["w"], math.sqrt(new_opaque) * new_sr / im.width))
