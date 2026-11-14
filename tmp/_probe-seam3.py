
import numpy as np, collections
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\seam2.png").convert("RGB")).astype(np.int32)
names = ["A 单层", "E overflow 50.72", "G overflow 50%", "H 下半不裁剪"]
crop = {n: a[10:462, 10+i*462:10+i*462+452] for i, n in enumerate(names)}
ref = crop[names[0]]
for n in names[1:]:
    d = np.abs(crop[n] - ref).max(axis=2)
    ys, xs = np.where(d > 0)
    print("%-16s diffPx=%4d max=%3d" % (n, len(xs), int(d.max()) if len(xs) else 0), end="")
    if len(xs):
        print("  rows:", sorted(collections.Counter(ys.tolist()).items())[:6], " bbox x %d..%d" % (xs.min(), xs.max()))
    else:
        print("   <-- 逐像素 0")
for x in (30, 420):
    print("x=%3d rows228-231: A=%s E=%s" % (x, ref[228:232, x].tolist(), crop["E overflow 50.72"][228:232, x].tolist()))
