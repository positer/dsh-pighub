
import numpy as np, collections
from PIL import Image
im = Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\seam.png").convert("RGB")
a = np.array(im).astype(np.int32)
names = ["A", "B", "C", "D"]
crop = {n: a[10:462, 10+i*462:10+i*462+452] for i, n in enumerate(names)}
ref = crop["A"]
for n in ("B", "C", "D"):
    d = np.abs(crop[n] - ref).max(axis=2)
    ys, xs = np.where(d > 0)
    print("=== %s: %d px, max %d" % (n, len(xs), int(d.max())))
    print("  rows (count):", sorted(collections.Counter(ys.tolist()).items())[:14], "...")
    print("  cols (count):", sorted(collections.Counter(xs.tolist()).items())[:8])
    vals = collections.Counter(d[ys, xs].tolist())
    print("  diff magnitudes:", vals.most_common(8))
    print("  seam row 229/230 count:", int((ys == 229).sum()), int((ys == 230).sum()))
# 分割线处每一列在三个变体里的读数（挑几列：左栏、中央空处、右栏）
for x in (30, 60, 100, 226, 380, 420):
    print("x=%3d  A=%s B=%s C=%s" % (x, ref[228:232, x].tolist(), crop["B"][228:232, x].tolist(), crop["C"][228:232, x].tolist()))
