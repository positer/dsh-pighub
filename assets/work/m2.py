
from PIL import Image
import numpy as np
from collections import deque
p = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
a = np.array(Image.open(p).convert("RGB")).astype(np.int16)
H,W,_ = a.shape
R,G,B = a[:,:,0],a[:,:,1],a[:,:,2]
mn = a.min(axis=2); mx = a.max(axis=2)
print("W,H", W,H, "total", W*H)
# distinct colors count
flat = a.reshape(-1,3)
uniq, inv, cnt = np.unique(flat, axis=0, return_inverse=True, return_counts=True)
print("distinct colors", len(uniq))
order = np.argsort(-cnt)
print("top 25 colors:")
for i in order[:25]:
    print("   ", tuple(int(x) for x in uniq[i]), int(cnt[i]))
# how many colors are "pink family" (R>=250)
print("\nR==255 count", int((R==255).sum()), "R>=250", int((R>=250).sum()))
print("min channel histogram bins:")
for lo,hi in [(0,10),(10,20),(20,40),(40,60),(60,80),(80,100),(100,120),(120,160),(160,200),(200,236),(236,256)]:
    m = (mn>=lo)&(mn<hi)
    print("  mn in [%d,%d): %d" % (lo,hi,int(m.sum())))
