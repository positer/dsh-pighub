
import numpy as np
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
with_house = np.array(Image.open(base + r"\tmp\pen-shots\pen-house.png").convert("RGB")).astype(np.int32)[0:452,0:452]
without   = np.array(Image.open(base + r"\tmp\pen-shots\pen-house-off.png").convert("RGB")).astype(np.int32)[0:452,0:452]
house = np.abs(with_house - without).max(axis=2) > 6
ys,xs = np.where(house)
print("小屋画到的像素: %d  bbox x %d..%d y %d..%d  -> 百分比 x %.2f%%..%.2f%% y %.2f%%..%.2f%%" % (
    house.sum(), xs.min(), xs.max(), ys.min(), ys.max(), xs.min()/452*100, (xs.max()+1)/452*100, ys.min()/452*100, (ys.max()+1)/452*100))
ref = Image.open(base + r"\assets\img\pen-fence.png").convert("RGBA").resize((452,452), Image.LANCZOS)
fence = np.array(ref)[:,:,3] >= 200
inter = house & fence
print("小屋遮住的栅栏像素: %d" % int(inter.sum()))
if inter.sum():
    ys2,xs2 = np.where(inter)
    print("  被遮住的栅栏 bbox: x %d..%d y %d..%d  -> 百分比 x %.2f%%..%.2f%% y %.2f%%..%.2f%%" % (
        xs2.min(), xs2.max(), ys2.min(), ys2.max(), xs2.min()/452*100, (xs2.max()+1)/452*100, ys2.min()/452*100, (ys2.max()+1)/452*100))
    print("  被遮住的竖直高度: %d px = %.2f 个百分点" % (ys2.max()-ys2.min()+1, (ys2.max()-ys2.min()+1)/452*100))
    split_y = int(452*0.5068)
    print("  分割线以上: %d px，以下: %d px" % (int((ys2 < split_y).sum()), int((ys2 >= split_y).sum())))
    # 两道横梁分别被遮住多少
    for name, (y0, y1) in (("上横梁", (int(452*0.0829), int(452*0.1228))), ("下横梁", (int(452*0.1411), int(452*0.1746)))):
        band = inter[y0:y1+1, :]
        print("  %s（y %d..%d）被遮住: %d px，横向 x %s" % (name, y0, y1, int(band.sum()),
              (str(np.where(band.any(axis=0))[0].min()) + ".." + str(np.where(band.any(axis=0))[0].max())) if band.any() else "无"))
