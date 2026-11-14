
import numpy as np
from PIL import Image
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png").convert("RGB")).astype(np.int32)
HOST = np.array([21,21,23])
win = a[80:1200, 560:1560]
d = np.abs(win - HOST).max(axis=2)
mask = d > 12
ys, xs = np.where(mask)
x0, x1, y0, y1 = xs.min()+560, xs.max()+560, ys.min()+80, ys.max()+80
print("内容 bbox（窗口 x560..1560）: x %d..%d y %d..%d  (w %d h %d)" % (x0,x1,y0,y1, x1-x0+1, y1-y0+1))
s = (x1-x0+1)/0.9234
px0 = x0 - 0.0383*s; py0 = y0 - 0.0399*s
print("=> 猪圈方框 x %.0f..%.0f y %.0f..%.0f 边长 %.0f（DPR %.2f）" % (px0, px0+s, py0, py0+s, s, s/451))
def med(cx, cy, n=5):
    return np.median(a[cy-n:cy+n+1, cx-n:cx+n+1].reshape(-1,3), axis=0).astype(int).tolist()
pairs = [
 ("左边中", (px0+5, py0+s/2), (px0-9, py0+s/2)),
 ("右边中", (px0+s-5, py0+s/2), (px0+s+9, py0+s/2)),
 ("上边中", (px0+s/2, py0+5), (px0+s/2, py0-9)),
 ("下边中", (px0+s/2, py0+s-5), (px0+s/2, py0+s+9)),
 ("左上角", (px0+5, py0+5), (px0-9, py0-9)),
 ("右下角", (px0+s-5, py0+s-5), (px0+s+9, py0+s+9)),
]
ok = True
for name, (ix,iy), (ox,oy) in pairs:
    vi = med(int(ix),int(iy)); vo = med(int(ox),int(oy))
    same = bool(np.abs(np.array(vi)-np.array(vo)).max() <= 2)
    ok = ok and same
    print("  %-6s 猪圈内 %-14s 方框外 %-14s 相同=%s" % (name, vi, vo, same))
print("六对采样全都一致:", ok)
print("宿主页面（面板之外、窗口底）(300,1250):", a[1250,300].tolist(), "  面板卡片上、猪圈外 (580,620):", a[620,580].tolist())
