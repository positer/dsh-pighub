
import numpy as np
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img\pen-fence.png").convert("RGBA")).astype(np.int32)
al = a[...,3]
wood = al > 200
# 中央一段（避开立柱 x 166..194/294..357/496..557/700..758/904..964/1058..1087）
cols = list(range(400,480))
rows = []
for y in range(0, 400):
    frac = float(wood[y, cols].mean())
    rows.append((y, frac))
runs = []
cur = None
for y, frac in rows:
    if frac > 0.9:
        if cur is None: cur = [y, y]
        else: cur[1] = y
    else:
        if cur: runs.append(tuple(cur)); cur = None
if cur: runs.append(tuple(cur))
print("远栏两道横梁的 y 区带（中央列 400..479 上 >90% 不透明的连续行）:", runs)
for (y0,y1) in runs:
    print("   y %d..%d px  ->  %.2f%%..%.2f%%  (高 %d px = %.2f%%)" % (y0,y1, y0/12.54, (y1+1)/12.54, y1-y0+1, (y1-y0+1)/12.54))
# 整圈远栏（含立柱）的 y 范围
ys = np.where(wood[:, 200:1050].any(axis=1))[0]
top_rows = ys[ys < 400]
print("远栏整体 y: %d..%d px -> %.2f%%..%.2f%%" % (top_rows.min(), top_rows.max(), top_rows.min()/12.54, (top_rows.max()+1)/12.54))
