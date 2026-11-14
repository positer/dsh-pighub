
import numpy as np, collections
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png").convert("RGB")).astype(np.int32)
# 横向扫描 y=620：找 1600..1760 的色阶变化
y=620
prev=None
print("y=620, x 1590..1760 的变化点:")
for x in range(1590, 1760):
    c = tuple(a[y,x])
    if c != prev:
        print("   x=%4d %s" % (x, c))
        prev = c
print()
# 纵向扫描 x=1652
x=1652
prev=None
print("x=1652, y 80..1200 的变化点（只打前 25 个）:")
n=0
for y2 in range(80, 1200):
    c = tuple(a[y2,x])
    if c != prev:
        print("   y=%4d %s" % (y2, c)); prev=c; n+=1
        if n>25: break
