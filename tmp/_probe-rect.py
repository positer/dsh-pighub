
from PIL import Image
import numpy as np
src = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
a = np.array(Image.open(src).convert("RGBA"))
al = a[...,3]
empty = (al <= 8)   # "no visible pixel" (matches what the eye sees: alpha<=8 is invisible)

H,W = empty.shape
# largest all-empty rectangle (classic histogram method), over the whole canvas
best = (0,0,0,0,0)  # area, x0,x1,y0,y1
heights = np.zeros(W, dtype=np.int32)
for y in range(H):
    heights = np.where(empty[y], heights+1, 0)
    stack = []
    for x in range(W+1):
        cur = heights[x] if x < W else 0
        start = x
        while stack and stack[-1][1] > cur:
            sx, h = stack.pop()
            area = h*(x-sx)
            if area > best[0]:
                best = (area, sx, x-1, y-h+1, y)
            start = sx
        stack.append((start, cur))
area,x0,x1,y0,y1 = best
print("largest full-transparent rect: x %d..%d  y %d..%d  (w %d h %d) area %d" % (x0,x1,y0,y1,x1-x0+1,y1-y0+1,area))
print("as percent of 1254: x %.2f..%.2f  y %.2f..%.2f" % (x0/12.54, (x1+1)/12.54, y0/12.54, (y1+1)/12.54))

# content bbox of the visible fence
ys,xs = np.where(~empty)
print("visible bbox: x %d..%d y %d..%d  -> pct x %.2f..%.2f y %.2f..%.2f" % (xs.min(),xs.max(),ys.min(),ys.max(), xs.min()/12.54,(xs.max()+1)/12.54, ys.min()/12.54,(ys.max()+1)/12.54))

# For a given candidate inner rect, what is the max protrusion detection?
# check row/col emptiness profiles
rowempty = empty.sum(axis=1)
print("rows with any opaque (first 260):", [(y,int(1254-rowempty[y])) for y in range(0,260,20)])
# verify the rect is fully empty
sub = empty[y0:y1+1, x0:x1+1]
print("rect fully empty:", bool(sub.all()))
# nearest opaque above/below/left/right of the rect
print("above col-centre y range opaque rows:", [y for y in range(0,y0) if not empty[y,627]][-3:])
print("below col-centre:", [y for y in range(y1+1,H) if not empty[y,627]][:3])
print("left of rect at row mid:", [x for x in range(0,x0) if not empty[(y0+y1)//2,x]][-3:])
print("right of rect at row mid:", [x for x in range(x1+1,W) if not empty[(y0+y1)//2,x]][:3])
