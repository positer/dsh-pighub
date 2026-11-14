
import numpy as np, collections
from PIL import Image
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
html = open(shots + r"\pen-control.html", encoding="utf-8").read()
print("control: 远层 div 数 =", html.count('class="pighub-fence is-back"'), " 近层 div 数 =", html.count('class="pighub-fence is-front"'))
a = np.array(Image.open(shots + r"\pen-empty.png").convert("RGB")).astype(np.int32)
b = np.array(Image.open(shots + r"\pen-control.png").convert("RGB")).astype(np.int32)
print("shot sizes", a.shape, b.shape)
pen_a = a[0:452, 0:452]; pen_b = b[0:452, 0:452]
d = np.abs(pen_a - pen_b).max(axis=2)
ys, xs = np.where(d > 0)
print("两层 vs 单层：diffPx=%d  max=%d" % (len(xs), int(d.max()) if len(xs) else 0))
if len(xs):
    print("  rows:", sorted(collections.Counter(ys.tolist()).items())[:8])
    print("  bbox x %d..%d y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max()))
    print("  magnitudes:", collections.Counter(d[ys, xs].tolist()).most_common(6))
