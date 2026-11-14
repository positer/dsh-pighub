
import numpy as np
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png").convert("RGB")).astype(np.int32)
HOST_A = np.array([21,21,23]); HOST_B = np.array([27,27,28])
region = a[90:1200, 560:1750]
da = np.abs(region - HOST_A).max(axis=2); db = np.abs(region - HOST_B).max(axis=2)
mask = (da > 10) & (db > 10)
ys,xs = np.where(mask)
x0,x1,y0,y1 = xs.min()+560, xs.max()+560, ys.min()+90, ys.max()+90
print("可见内容 bbox: x %d..%d y %d..%d  (w %d h %d)" % (x0,x1,y0,y1,x1-x0+1,y1-y0+1))
pen_w = (x1-x0+1)/0.9234; pen_h = (y1-y0+1)/0.9242
px0 = x0-0.0383*pen_w; py0 = y0-0.0399*pen_h
print("=> 猪圈方框: x %.0f..%.0f  y %.0f..%.0f  边长 %.0f x %.0f (DPR ≈ %.2f)" % (px0, px0+pen_w, py0, py0+pen_h, pen_w, pen_h, pen_w/451))
def med(cx, cy, n=9):
    return np.median(a[cy-n:cy+n, cx-n:cx+n].reshape(-1,3), axis=0).astype(int).tolist()
pts_inside = [(px0+4, py0+4), (px0+pen_w-4, py0+4), (px0+4, py0+pen_h-4), (px0+pen_w-4, py0+pen_h-4),
              (px0+4, (py0+py0+pen_h)/2), (px0+pen_w-4, (py0+py0+pen_h)/2)]
pts_outside = [(px0-14, py0+4), (px0+pen_w+14, py0+4), (px0-14, (py0+py0+pen_h)/2), (px0+pen_w+14, (py0+py0+pen_h)/2)]
print("猪圈方框内、围栏外的采样（应等于宿主面板底色）:")
for (x,y) in pts_inside: print("   (%4.0f,%4.0f) = %s" % (x, y, med(int(x),int(y))))
print("猪圈方框外、同一张面板上的采样（宿主自己画的区域）:")
for (x,y) in pts_outside: print("   (%4.0f,%4.0f) = %s" % (x, y, med(int(x),int(y))))
