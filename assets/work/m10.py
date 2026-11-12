
import numpy as np, json
from PIL import Image
src = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
a = np.array(Image.open(src).convert("RGB"))
H,W,_ = a.shape
pig = np.load(r"dsh-pighub/assets/work/pig_mask.npy")
white = np.load(r"dsh-pighub/assets/work/white_mask.npy")
x0,y0,x1,y1 = 56,105,571,526
frame = np.zeros((H,W), bool); frame[y0:y1+1, x0:x1+1] = True
target = frame & (~pig) & (~white)
T = int(target.sum())
def greedy(mask, min_area, max_iter=4000):
    m = mask.copy(); boxes=[]
    for _ in range(max_iter):
        best=(0,0,0,0,0)
        heights = np.zeros(m.shape[1], int)
        for y in range(m.shape[0]):
            heights = np.where(m[y], heights+1, 0)
            stack=[]
            for x in range(m.shape[1]+1):
                h = int(heights[x]) if x < m.shape[1] else 0
                start = x
                while stack and stack[-1][1] >= h:
                    sx, sh = stack.pop()
                    area = sh*(x-sx)
                    if area > best[0]: best=(area, sx, y-sh+1, x-sx, sh)
                    start = sx
                stack.append((start,h))
        if best[0] < min_area: break
        area,bx,by,bw,bh = best
        m[by:by+bh, bx:bx+bw] = False
        boxes.append([int(bx),int(by),int(bw),int(bh)])
    return boxes, m
res={}
for ma in [36, 64, 144, 400]:
    boxes, rest = greedy(target, ma)
    print("min_area=%d boxes=%d residual=%d coverage=%.3f%%" % (ma, len(boxes), int(rest.sum()), 100.0*(T-rest.sum())/T))
    res[ma]=(boxes, rest)
boxes, rest = res[36]
r = rest.copy()
def runs_of(row):
    idx=np.nonzero(row)[0]
    out=[]
    if len(idx)==0: return out
    start=idx[0]; last=idx[0]
    for i in idx[1:]:
        if i==last+1: last=i
        else: out.append((int(start),int(last))); start=i; last=i
    out.append((int(start),int(last)))
    return out
rows={int(y):runs_of(r[y]) for y in np.nonzero(r.any(axis=1))[0]}
merged=[]; cur_runs=None; cur_y=None; cur_start=None
for y in sorted(rows):
    if cur_runs is not None and rows[y]==cur_runs and y==cur_y+1:
        cur_y=y; continue
    if cur_runs is not None:
        for (s,e) in cur_runs: merged.append([s, cur_start, e-s+1, cur_y-cur_start+1])
    cur_y=y; cur_runs=rows[y]; cur_start=y
if cur_runs is not None:
    for (s,e) in cur_runs: merged.append([s, cur_start, e-s+1, cur_y-cur_start+1])
print("residual rows", len(rows), "run-rects", len(merged))
allb = boxes + merged
bad=0; pigsum=0
for (bx,by,bw,bh) in allb:
    c=int(pig[by:by+bh, bx:bx+bw].sum())
    if c: bad+=1; pigsum+=c
cov = target.copy()
for (bx,by,bw,bh) in allb: cov[by:by+bh, bx:bx+bw]=False
print("TOTAL boxes", len(allb), "bad", bad, "pigpx", pigsum, "residual", int((target&cov).sum()))
json.dump([[int(v) for v in b] for b in allb], open(r"dsh-pighub/assets/work/cover_final.json","w"))
