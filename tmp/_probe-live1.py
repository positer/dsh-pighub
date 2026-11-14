
import numpy as np, collections
from PIL import Image
p = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png"
im = Image.open(p).convert("RGB")
a = np.array(im).astype(np.int32)
print("shot", im.size)
# 只在中部面板区域找木头色（r>150, g 60..150, b<110）
r,g,b = a[...,0],a[...,1],a[...,2]
wood = (r>150)&(g>60)&(g<160)&(b<115)&(r-b>90)
sub = np.zeros_like(wood); sub[60:1100, 500:1700] = wood[60:1100, 500:1700]
ys,xs = np.where(sub)
print("fence bbox in desktop: x %d..%d  y %d..%d  (w %d h %d)" % (xs.min(), xs.max(), ys.min(), ys.max(), xs.max()-xs.min()+1, ys.max()-ys.min()+1))
# 由原图几何反推猪圈方框：原图里可见内容 bbox 是 3.83%..96.17% / 3.99%..96.41%
w = xs.max()-xs.min()+1; h = ys.max()-ys.min()+1
pen_w = w/0.9234; pen_h = h/0.9242
x0 = xs.min() - 0.0383*pen_w; y0 = ys.min() - 0.0399*pen_h
print("推算猪圈方框: x %.0f..%.0f y %.0f..%.0f  边长 %.0fx%.0f" % (x0, x0+pen_w, y0, y0+pen_h, pen_w, pen_h))
# 页面底色：取面板外的一块（左侧栏底部 / 右侧空白）
bg_samples = [(300,1200),(1800,1300),(1400,1280),(1300,1200)]
for (x,y) in bg_samples:
    print("  page bg at (%d,%d) = %s" % (x, y, a[y,x].tolist()))
pagebg = a[1300, 1800]
print("取 page bg =", pagebg.tolist())
# 猪圈四角（沿方框内缩 6px）与围栏外圈（围栏 bbox 外 12px）
corners = [(x0+6, y0+6), (x0+pen_w-6, y0+6), (x0+6, y0+pen_h-6), (x0+pen_w-6, y0+pen_h-6)]
print("四角读数:")
o = True
for (cx, cy) in corners:
    v = a[int(cy), int(cx)]
    same = bool(np.abs(v-pagebg).max() <= 2)
    o = o and same
    print("   (%.0f,%.0f) RGB=%s 等于页面底色=%s" % (cx, cy, v.tolist(), same))
ring = [(xs.min()-14, (ys.min()+ys.max())//2), (xs.max()+14, (ys.min()+ys.max())//2),
        ((xs.min()+xs.max())//2, ys.min()-14), ((xs.min()+xs.max())//2, ys.max()+14)]
print("围栏外圈读数:")
for (cx, cy) in ring:
    v = a[int(cy), int(cx)]
    same = bool(np.abs(v-pagebg).max() <= 2)
    o = o and same
    print("   (%d,%d) RGB=%s 等于页面底色=%s" % (cx, cy, v.tolist(), same))
print("四角 + 围栏外圈 全部等于页面底色:", o)
# 存一张猪圈特写
im.crop((int(x0)-6, int(y0)-6, int(x0+pen_w)+6, int(y0+pen_h)+6)).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-live.png")
print("wrote pen-live.png")
