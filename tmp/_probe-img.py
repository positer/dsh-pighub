
import sys
from PIL import Image
import numpy as np
src = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
im = Image.open(src)
print("mode", im.mode, "size", im.size)
a = np.array(im.convert("RGBA")).astype(np.int16)
print("shape", a.shape)
print("corner px", a[0,0], a[0,-1], a[-1,0], a[-1,-1])
print("center px", a[627,627])
# how many pixels are saturated red / yellow
r,g,b = a[...,0],a[...,1],a[...,2]
red = (r>200)&(g<90)&(b<90)
yel = (r>200)&(g>200)&(b<90)
print("red px", int(red.sum()), "yellow px", int(yel.sum()))
print("pure white px", int(((r==255)&(g==255)&(b==255)).sum()))
# row0 sample every 100
print("row0:", [tuple(a[0,x][:3]) for x in range(0,1254,120)])
print("col0:", [tuple(a[y,0][:3]) for y in range(0,1254,120)])
