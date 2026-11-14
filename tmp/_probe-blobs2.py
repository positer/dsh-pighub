
import numpy as np
from PIL import Image
from collections import deque
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\timed2.png").convert("RGB")).astype(np.int32)
r,g,b = a[...,0],a[...,1],a[...,2]
pink = (r>225)&(g>175)&(g<225)&(b>150)&(b<215)&(r-b>40)&(r-g>25)
win = np.zeros_like(pink); win[130:1000, 610:1495] = pink[130:1000, 610:1495]
seen = np.zeros_like(win, bool); blobs=[]
for y0 in range(130, 1000):
    for x0 in range(610, 1495):
        if win[y0,x0] and not seen[y0,x0]:
            q=deque([(y0,x0)]); seen[y0,x0]=True; pts=[]
            while q:
                y,x=q.popleft(); pts.append((y,x))
                for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny,nx=y+dy,x+dx
                    if 130<=ny<1000 and 610<=nx<1495 and win[ny,nx] and not seen[ny,nx]:
                        seen[ny,nx]=True; q.append((ny,nx))
            if len(pts)>2500:
                ys=[p[0] for p in pts]; xs=[p[1] for p in pts]
                blobs.append((len(pts), int(np.mean(xs)), int(np.mean(ys)), min(xs),max(xs),min(ys),max(ys)))
blobs.sort(key=lambda z:(z[2], z[1]))
for bl in blobs:
    print("n=%5d centroid=(%4d,%4d) bbox x %d..%d y %d..%d" % bl)
print("猪圈方框 x 606..1499 y 119..1012；内圈 x 726..1379 y 295..849")
