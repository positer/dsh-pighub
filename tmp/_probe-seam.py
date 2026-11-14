
import numpy as np
from PIL import Image
im = Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\seam.png").convert("RGB")
print("shot size", im.size)
a = np.array(im).astype(np.int32)
# 4 个 452x452 的猪圈，左起 10px，间隔 10px
names = ["A 单层(参考)", "B clip-path", "C 预切图", "D bg-size 200%"]
crop = {}
for i, name in enumerate(names):
    x = 10 + i * (452 + 10); y = 10
    crop[name] = a[y:y+452, x:x+452]
ref = crop[names[0]]
for name in names[1:]:
    d = np.abs(crop[name] - ref).max(axis=2)
    ys, xs = np.where(d > 0)
    line = "%-14s diffPx=%5d  max=%3d" % (name, len(xs), int(d.max()) if len(xs) else 0)
    if len(xs):
        line += "  bbox x %d..%d y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max())
        # 若差异集中在一条水平带，报一下行号分布
        rows = np.unique(ys)
        line += "  rows=%s" % (rows[:6].tolist(), )
    print(line)
# 也把每块的边缘列像素打出来，检查圆形边框是否一致
Image.fromarray(a.astype(np.uint8)).crop((10, 10, 10+452, 10+452)).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\seam_A.png")
