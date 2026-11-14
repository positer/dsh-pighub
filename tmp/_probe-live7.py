
import numpy as np
from PIL import Image, ImageDraw
p = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png"
a = np.array(Image.open(p).convert("RGB")).astype(np.int32)
# 猪圈方框：由木头 bbox 的**水平**跨度反推（水平跨度最可靠：两侧立柱都是亮木）
wood = (a[...,0]>150)&(a[...,1]>60)&(a[...,1]<160)&(a[...,2]<115)&(a[...,0]-a[...,2]>90)
m = np.zeros_like(wood); m[100:1150, 560:1700] = wood[100:1150, 560:1700]
ys,xs = np.where(m)
s = (xs.max()-xs.min()+1)/0.9234
px0 = xs.min()-0.0383*s; py0 = ys.min()-0.0399*s
print("猪圈方框: x %.0f..%.0f y %.0f..%.0f 边长 %.0f (DPR %.2f)" % (px0, px0+s, py0, py0+s, s, s/451))
# 参考色：猪圈方框内、围栏外的一个点
ref = a[int(py0+s*0.5), int(px0+s*0.02)]
print("猪圈内、围栏外的参照色:", ref.tolist())
sub = a[int(py0)-40:int(py0+s)+40, int(px0)-40:int(px0+s)+40]
d = np.abs(sub-ref).max(axis=2)
amp = np.clip(d*12, 0, 255).astype(np.uint8)
img = Image.fromarray(amp).convert("RGB")
dr = ImageDraw.Draw(img)
dr.rectangle([40, 40, 40+s, 40+s], outline=(255, 0, 255), width=2)
img.save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_pen-amp2.png")
# 四角与四边中点（方框内 6px / 方框外 6px）成对比较
print("方框内 6px（猪圈自己） vs 方框外 6px（宿主画的区域）：")
for name, (ix, iy), (ox, oy) in [
    ("左上", (px0+6, py0+6), (px0-6, py0-6)),
    ("右上", (px0+s-6, py0+6), (px0+s+6, py0-6)),
    ("左下", (px0+6, py0+s-6), (px0-6, py0+s+6)),
    ("右下", (px0+s-6, py0+s-6), (px0+s+6, py0+s+6)),
    ("左中", (px0+6, py0+s/2), (px0-6, py0+s/2)),
    ("上中", (px0+s/2, py0+6), (px0+s/2, py0-6)),
]:
    vi = a[int(iy), int(ix)]; vo = a[int(oy), int(ox)]
    print("   %-4s 内 %-14s 外 %-14s 相同=%s" % (name, vi.tolist(), vo.tolist(), bool(np.abs(vi-vo).max()<=2)))
