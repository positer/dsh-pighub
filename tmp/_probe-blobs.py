
import numpy as np, json
from PIL import Image
from collections import deque
a = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png").convert("RGB")).astype(np.int32)
r,g,b = a[...,0],a[...,1],a[...,2]
# 猪皮：粉（r 很高、g/b 中等、r-b 明显）
pink = (r>225)&(g>175)&(g<225)&(b>150)&(b<215)&(r-b>40)&(r-g>25)
win = np.zeros_like(pink); win[100:1150, 590:1560] = pink[100:1150, 590:1560]
H,W = win.shape
seen = np.zeros_like(win, bool)
blobs = []
for y0 in range(100, 1150, 1):
    for x0 in range(590, 1560, 1):
        if win[y0,x0] and not seen[y0,x0]:
            q = deque([(y0,x0)]); seen[y0,x0]=True; pts=[]
            while q:
                y,x = q.popleft(); pts.append((y,x))
                for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny,nx = y+dy, x+dx
                    if 100<=ny<1150 and 590<=nx<1560 and win[ny,nx] and not seen[ny,nx]:
                        seen[ny,nx]=True; q.append((ny,nx))
            if len(pts) > 3000:
                ys = [p[0] for p in pts]; xs=[p[1] for p in pts]
                blobs.append({"n":len(pts), "cx":float(np.mean(xs)), "cy":float(np.mean(ys)),
                              "x0":min(xs),"x1":max(xs),"y0":min(ys),"y1":max(ys)})
print("检出粉色团块:", len(blobs))
for bl in sorted(blobs, key=lambda z: z["cx"]):
    print("   centroid=(%.0f,%.0f) bbox x %d..%d y %d..%d n=%d" % (bl["cx"],bl["cy"],bl["x0"],bl["x1"],bl["y0"],bl["y1"],bl["n"]))
json.dump(blobs, open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_blobs.json","w"))
