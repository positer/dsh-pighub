
from PIL import Image
import numpy as np
src = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
a = np.array(Image.open(src).convert("RGBA")).astype(np.int16)
al = a[...,3]
print("alpha hist: 0 =", int((al==0).sum()), " 1-127 =", int(((al>0)&(al<128)).sum()), " 128-254 =", int(((al>=128)&(al<255)).sum()), " 255 =", int((al==255).sum()))
ys,xs = np.where(al>0)
print("opaque bbox x", xs.min(), xs.max(), "y", ys.min(), ys.max())
r,g,b = a[...,0],a[...,1],a[...,2]
red = (r>200)&(g<90)&(b<90)&(al>0)
yel = (r>200)&(g>200)&(b<90)&(al>0)
for name,mask in (("red",red),("yellow",yel)):
    ys2,xs2 = np.where(mask)
    print(name, int(mask.sum()), "bbox x", xs2.min(), xs2.max(), "y", ys2.min(), ys2.max(), "alpha med", int(np.median(al[mask])))
# coarse alpha coverage map 20x20
H,W = al.shape
cov = np.zeros((20,20), int)
for i in range(20):
    for j in range(20):
        cov[i,j] = int((al[i*H//20:(i+1)*H//20, j*W//20:(j+1)*W//20] > 8).mean()*100)
print("coverage %% map (rows top->bottom):")
for row in cov: print(" ".join(f"{v:3d}" for v in row))
# sample the fence body color at known spots (top rail mid)
print("probe top rail:", tuple(a[110,200][:4]), "post:", tuple(a[400,100][:4]), "inner bg:", tuple(a[600,600][:4]))
# check any near-white opaque pixels
near_white = (al>0)&(r>235)&(g>235)&(b>235)
print("near-white opaque:", int(near_white.sum()))
# where white-ish opaque (alpha>0, r,g,b>235) bbox
if near_white.sum():
    ys3,xs3 = np.where(near_white); print("white bbox", xs3.min(), xs3.max(), ys3.min(), ys3.max())
