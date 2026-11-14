
import numpy as np
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png").convert("RGB")).astype(np.int32)
r,g,b = a[...,0],a[...,1],a[...,2]
# 草地：绿色系且在中部面板区域
green = (g>110)&(g<190)&(g-r>8)&(g-b>30)
m = np.zeros_like(green); m[60:1200, 500:1750] = green[60:1200, 500:1750]
ys,xs = np.where(m)
gx0,gx1,gy0,gy1 = xs.min(), xs.max(), ys.min(), ys.max()
print("草地 bbox: x %d..%d y %d..%d  (w %d h %d)" % (gx0,gx1,gy0,gy1,gx1-gx0+1,gy1-gy0+1))
pen_w = (gx1-gx0+1)/0.831; pen_h = (gy1-gy0+1)/0.7839
px0 = gx0 - 0.0837*pen_w; py0 = gy0 - 0.1826*pen_h
print("由草地反推猪圈: x %.0f..%.0f  y %.0f..%.0f  边长 %.0f x %.0f" % (px0, px0+pen_w, py0, py0+pen_h, pen_w, pen_h))
# 四角（内缩 8px）与围栏外圈（围栏 bbox 外 12px，但仍在猪圈方框内）
corners = [(px0+8, py0+8), (px0+pen_w-8, py0+8), (px0+8, py0+pen_h-8), (px0+pen_w-8, py0+pen_h-8)]
print("猪圈四角读数:")
for (cx, cy) in corners:
    print("   (%.0f,%.0f) = %s" % (cx, cy, a[int(cy), int(cx)].tolist()))
print("围栏左右外圈（猪圈方框内、围栏外）读数:")
for (cx, cy) in [(px0+pen_w*0.02, (py0+py0+pen_h)/2), (px0+pen_w*0.98, (py0+py0+pen_h)/2),
                 ((px0+px0+pen_w)/2, py0+pen_h*0.01), ((px0+px0+pen_w)/2, py0+pen_h*0.99)]:
    print("   (%.0f,%.0f) = %s" % (cx, cy, a[int(cy), int(cx)].tolist()))
print("页面底色（左侧栏空白 (300,1200)）:", a[1200,300].tolist(), " 面板右侧空白 (2000,1400):", a[1400,2000].tolist())
