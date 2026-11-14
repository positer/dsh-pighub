
import numpy as np, collections
from PIL import Image
p = r"C:\Users\12252\.dsh\attachments\v1\objects\c5\c537076c3a927f8232bccf48b4defc1bd0db8d64a887a2dc73eff7e6f68fe812"
im = Image.open(p)
print("mode", im.mode, "size", im.size, "format", im.format)
a = np.array(im.convert("RGBA")).astype(np.int32)
print("corners", a[0,0], a[-1,-1], "center", a[627,627])
r,g,b,al = a[...,0],a[...,1],a[...,2],a[...,3]
vis = al > 128
# 找红：r 明显大于 g,b
red = (r > 120) & (r - g > 50) & (r - b > 50)
print("red-ish px", int(red.sum()), "visible red", int((red&vis).sum()))
print("red colors:", collections.Counter([tuple(v) for v in a[red][:3000]]).most_common(6))
ys,xs = np.where(red)
print("red bbox x", xs.min(), xs.max(), "y", ys.min(), ys.max())
mid=627
row=[x for x in range(a.shape[1]) if red[mid,x]]
col=[y for y in range(a.shape[0]) if red[y,mid]]
print("row y=627 red x:", row)
print("col x=627 red y:", col)
