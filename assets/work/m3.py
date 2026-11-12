
from PIL import Image
import numpy as np
p = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
im = Image.open(p).convert("RGB")
a = np.array(im).astype(np.int16)
H,W,_ = a.shape
mn = a.min(axis=2)
# class map: white=white, plate=dark(<90), pig=light(90..235)
out = np.zeros((H,W,3), np.uint8)
out[mn>=236] = (255,255,255)
out[mn<90] = (40,40,40)
mid = (mn>=90)&(mn<236)
out[mid] = (0,255,0)
Image.fromarray(out).save(r"dsh-pighub/assets/work/class-map.png")
# scan lines
for y in [120, 200, 300, 400, 520]:
    row = mn[y]
    # find runs
    runs=[]
    prev=row[0]; start=0
    for x in range(1,W):
        cls = 0 if row[x]>=236 else (1 if row[x]<90 else 2)
        pc = 0 if row[x-1]>=236 else (1 if row[x-1]<90 else 2)
        if cls!=pc:
            runs.append((pc,start,x-1)); start=x
    runs.append((0 if row[W-1]>=236 else (1 if row[W-1]<90 else 2), start, W-1))
    runs=[r for r in runs if r[1]!=r[2] or True]
    print("y=",y, "runs(len>=3):", [(c,s,e) for c,s,e in runs if e-s>=2][:14])
for x in [150, 300, 480]:
    col = mn[:,x]
    runs=[]; start=0
    for y in range(1,H):
        cls = 0 if col[y]>=236 else (1 if col[y]<90 else 2)
        pc = 0 if col[y-1]>=236 else (1 if col[y-1]<90 else 2)
        if cls!=pc: runs.append((pc,start,y-1)); start=y
    runs.append((0 if col[H-1]>=236 else (1 if col[H-1]<90 else 2), start, H-1))
    print("x=",x, "runs:", [(c,s,e) for c,s,e in runs if e-s>=2][:14])
