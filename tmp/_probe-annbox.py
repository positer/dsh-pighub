
import numpy as np, collections
from PIL import Image
p = r"C:\Users\12252\.dsh\attachments\v1\objects\c5\c537076c3a927f8232bccf48b4defc1bd0db8d64a887a2dc73eff7e6f68fe812"
a = np.array(Image.open(p).convert("RGBA")).astype(np.int32)
r,g,b,al = a[...,0],a[...,1],a[...,2],a[...,3]
# 标注线：不透明且强红（wood 是 (205,125,54)，g 高；标注线 g/b 都低）
ann = (al > 200) & (r > 150) & (g < 120) & (b < 120) & (r - g > 90)
print("annotation px:", int(ann.sum()))
print("colour samples:", collections.Counter([tuple(v) for v in a[ann][:5000]]).most_common(5))
ys,xs = np.where(ann)
print("bbox x", xs.min(), xs.max(), "y", ys.min(), ys.max())
midr, midc = 627, 627
row = np.where(ann[midr])[0]; col = np.where(ann[:, midc])[0]
# 连续段
def segs(idx):
    out=[]
    for i in idx:
        if out and i == out[-1][1]+1: out[-1][1]=i
        else: out.append([int(i),int(i)])
    return out
print("row y=627 segments:", segs(row))
print("col x=627 segments:", segs(col))
# 四条边：在中心行/列取线的两侧，同时给出线宽
print("stroke thickness left:", segs(row)[0][1]-segs(row)[0][0]+1 if len(segs(row)) else None,
      " right:", segs(row)[-1][1]-segs(row)[-1][0]+1 if len(segs(row)) else None)
print("stroke thickness top:", segs(col)[0][1]-segs(col)[0][0]+1 if len(segs(col)) else None,
      " bottom:", segs(col)[-1][1]-segs(col)[-1][0]+1 if len(segs(col)) else None)
# 是否圆角：看顶部那段在多个 x 上的 y
for x in (110, 120, 140, 300, 600, 1000, 1100, 1140):
    ysx = np.where(ann[:, x])[0]
    print("  x=%4d top red y:%s bottom y:%s" % (x, ysx[:3].tolist(), ysx[-3:].tolist()))
