
import numpy as np, os
from PIL import Image
from collections import Counter
ROOT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
for name in ["pighub-258","pighub-686"]:
    im = Image.open(os.path.join(ROOT,"assets","img",name+".png")).convert("RGBA")
    a = np.asarray(im)
    # sample the region inside the banner bbox: print a coarse grid of pixels with their colour
    print("=== ", name, im.size)
    # banner fill pixel sample
    ys,xs = np.nonzero((a[:,:,2].astype(int) - a[:,:,0].astype(int) > 20) & (a[:,:,3]>200) & (a[:,:,0]<140))
    print(" navy px", len(xs))
    c = Counter()
    for y,x in zip(ys[::7],xs[::7]):
        c[(a[y,x,0]//8*8,a[y,x,1]//8*8,a[y,x,2]//8*8)] += 1
    print(" navy colours:", c.most_common(6))
    # cream glyph: find bright pixels inside banner bbox
    bx0,by0,bx1,by1 = (int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max()))
    print(" bbox", bx0,by0,bx1,by1)
    sub = a[by0:by1+1, bx0:bx1+1]
    bright = sub[(sub[:,:,3]>200) & (sub[:,:,0]>200) & (sub[:,:,1]>200)]
    cb = Counter()
    for p in bright[::3]:
        cb[(p[0]//8*8,p[1]//8*8,p[2]//8*8)] += 1
    print(" bright-in-bbox colours:", cb.most_common(6))
