
import numpy as np, collections
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\seam3.png").convert("RGB")).astype(np.int32)
names = ["A1", "A2", "A3", "E"]
crop = {n: a[10:462, 10+i*462:10+i*462+452] for i, n in enumerate(names)}
def rep(tag, x, y):
    d = np.abs(x - y).max(axis=2); ys, xs = np.where(d > 0)
    print("%-18s diffPx=%4d max=%3d" % (tag, len(xs), int(d.max()) if len(xs) else 0), end="")
    if len(xs): print("  rows:", sorted(collections.Counter(ys.tolist()).items())[:5])
    else: print("   <-- 0")
rep("A1 vs A2 (对照1)", crop["A1"], crop["A2"])
rep("A1 vs A3 (对照2)", crop["A1"], crop["A3"])
rep("A2 vs A3 (对照3)", crop["A2"], crop["A3"])
rep("A1 vs E   (方案E)", crop["A1"], crop["E"])
