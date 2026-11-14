
import numpy as np, collections
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png").convert("RGB")).astype(np.int32)
# 在面板区域做一个 5px 网格采样，看有哪些底色色阶
region = a[80:1200, 450:1750]
cols = collections.Counter([tuple(v) for v in region[::6, ::6].reshape(-1, 3)])
print("最常见颜色:", cols.most_common(6))
# 找出 [33..38] 这一档的像素范围
r,g,b = a[...,0],a[...,1],a[...,2]
light = (np.abs(r-35)<=3)&(np.abs(g-35)<=3)&(np.abs(b-36)<=3)
ys,xs = np.where(light)
print("偏亮一档像素数:", light.sum(), "bbox x %d..%d y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max()))
# 沿一条穿过 pen 中部的水平线，打印色阶变化（每 8px 采样）
y = 620
row = a[y]
prev = None
print("y=620 横向色阶变化点:")
for x in range(450, 1750, 2):
    c = tuple(row[x])
    if c != prev:
        print("   x=%4d %s" % (x, c), end="")
        prev = c
        if x > 700: break
print()
