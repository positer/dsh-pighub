
import numpy as np
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
with_house = np.array(Image.open(base + r"\tmp\pen-shots\pen-house.png").convert("RGB")).astype(np.int32)[0:452,0:452]
without   = np.array(Image.open(base + r"\tmp\pen-shots\pen-house-off.png").convert("RGB")).astype(np.int32)[0:452,0:452]
d = np.abs(with_house - without).max(axis=2)
house_mask = d > 6
ys,xs = np.where(house_mask)
print("小屋覆盖的像素: %d  bbox x %d..%d y %d..%d" % (house_mask.sum(), xs.min(), xs.max(), ys.min(), ys.max()))
print("  占猪圈边长百分比: x %.2f%%..%.2f%%  y %.2f%%..%.2f%%" % (xs.min()/452*100, (xs.max()+1)/452*100, ys.min()/452*100, (ys.max()+1)/452*100))
# 栅栏自己的像素：拿参考图 452 缩放后的 alpha>=200 且是木色/描边的像素
ref = Image.open(base + r"\assets\img\pen-fence.png").convert("RGBA").resize((452,452), Image.LANCZOS)
ra = np.array(ref)
fence = ra[:,:,3] >= 200
inter = house_mask & fence
print("小屋遮住的**栅栏像素**: %d（= 小屋覆盖区的 %.1f%%）" % (int(inter.sum()), inter.sum()/max(1,house_mask.sum())*100))
if inter.sum():
    ys2,xs2 = np.where(inter)
    print("  被遮住的栅栏像素 bbox: x %d..%d y %d..%d （x 百分比 %.2f%%..%.2f%%）" % (xs2.min(), xs2.max(), ys2.min(), ys2.max(), xs2.min()/452*100, (xs2.max()+1)/452*100))
    print("  其中 y 在分割线（50.68%% = %d px）以上的: %d，以下: %d" % (int(452*0.5068), int((ys2 < 452*0.5068).sum()), int((ys2 >= 452*0.5068).sum())))
