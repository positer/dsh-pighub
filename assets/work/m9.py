
import numpy as np, json
from PIL import Image
src = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
a = np.array(Image.open(src).convert("RGB"))
H,W,_ = a.shape
mn = a.min(axis=2)
pig = np.load(r"dsh-pighub/assets/work/pig_mask.npy")
ring = np.load(r"dsh-pighub/assets/work/ring_mask.npy")
dark = np.load(r"dsh-pighub/assets/work/dark_mask.npy")
white = np.load(r"dsh-pighub/assets/work/white_mask.npy")
x0,y0,x1,y1 = 56,105,571,526
frame = np.zeros((H,W), bool); frame[y0:y1+1, x0:x1+1] = True
target = frame & (~pig) & (~white)

def greedy(mask, min_area):
    m = mask.copy(); boxes=[]
    while True:
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

for ma in [1,4,16,36,64,144]:
    boxes, rest = greedy(target, ma)
    print("min_area=%d boxes=%d residual=%d coverage=%.3f%%" % (ma, len(boxes), int(rest.sum()), 100.0*(target.sum()-rest.sum())/target.sum()))

# pick min_area=16 then second pass on residual with run-length rects
boxes, rest = greedy(target, 16)
print("pruned residual px:", int(rest.sum()))
# second pass: cover residual with row-run rects of height 1 merged across identical column ranges
r = rest.copy()
extra=[]
ys = np.nonzero(r.any(axis=1))[0]
# group rows: for each row, produce runs; merge consecutive rows with identical run sets
prev_runs=None; prev_y=None
def runs_of(row):
    out=[];x=0
    idx=np.nonzero(row)[0]
    if len(idx)==0: return out
    start=idx[0]; last=idx[0]
    for i in idx[1:]:
        if i==last+1: last=i
        else: out.append((int(start),int(last))); start=i; last=i
    out.append((int(start),int(last)))
    return out
rows={}
for y in ys:
    rows[int(y)] = runs_of(r[y])
# merge consecutive rows with identical runs into rects
merged=[]
cur_y=None; cur_runs=None
for y in sorted(rows):
    if cur_runs is not None and rows[y]==cur_runs and y==cur_y+1:
        cur_y=y; continue
    if cur_runs is not None:
        for (s,e) in cur_runs: merged.append([s, cur_start, e-s+1, cur_y-cur_start+1])
    cur_y=y; cur_runs=rows[y]; cur_start=y
if cur_runs is not None:
    for (s,e) in cur_runs: merged.append([s, cur_start, e-s+1, cur_y-cur_start+1])
print("residual row-run rects:", len(merged), "covered px:", sum(b[2]*b[3] for b in merged))
allb = boxes + merged
# verify no pig
bad=0; pigsum=0
for (bx,by,bw,bh) in allb:
    c=int(pig[by:by+bh, bx:bx+bw].sum())
    if c: bad+=1; pigsum+=c
print("TOTAL boxes", len(allb), "boxes touching pig:", bad, "pig px:", pigsum)
cov = target.copy()
for (bx,by,bw,bh) in allb: cov[by:by+bh, bx:bx+bw]=False
print("residual after second pass:", int((target&cov).sum()))
json.dump(allb, open(r"dsh-pighub/assets/work/cover_final.json","w"))
