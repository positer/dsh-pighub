
import numpy as np
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pig-over-house.png").convert("RGB")).astype(np.int32)
r,g,b = a[...,0],a[...,1],a[...,2]
pink = (r>225)&(g>175)&(g<225)&(b>150)&(b<215)&(r-b>40)&(r-g>25)
ox, oy, s = 606, 119, 893
hx0, hx1 = int(ox+0.097*s), int(ox+0.277*s)
hy0, hy1 = int(oy+0.198*s), int(oy+0.351*s)
print("小屋方框（屏幕坐标）: x %d..%d  y %d..%d" % (hx0,hx1,hy0,hy1))
sub = pink[hy0:hy1, hx0:hx1]
print("小屋方框内的猪皮像素: %d" % int(sub.sum()))
ys,xs = np.where(pink)
if sub.sum():
    yy,xx = np.where(sub)
    print("  在方框内的猪皮 bbox: x %d..%d y %d..%d（屏幕 ±%d/%d）" % (xx.min()+hx0, xx.max()+hx0, yy.min()+hy0, yy.max()+hy0, hx0, hy0))
