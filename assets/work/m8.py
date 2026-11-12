
import numpy as np
from PIL import Image
from collections import deque
src = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
a = np.array(Image.open(src).convert("RGB")).astype(np.int16)
H,W,_ = a.shape
mn = a.min(axis=2)
pig = np.load(r"dsh-pighub/assets/work/pig_mask.npy")
ring = np.load(r"dsh-pighub/assets/work/ring_mask.npy")
dark = np.load(r"dsh-pighub/assets/work/dark_mask.npy")
white = np.load(r"dsh-pighub/assets/work/white_mask.npy")
pigb = (56,105,571,526)
x0,y0,x1,y1 = pigb[0],pigb[1],pigb[2],pigb[3]
print("TRIM px frame:", x0,y0, x1-x0+1, y1-y0+1)
frame = np.zeros((H,W), bool); frame[y0:y1+1, x0:x1+1] = True
print("frame px", int(frame.sum()))
target = frame & (~pig) & (~white)   # 需 erase 的：底板(暗) + 底板柔边 + 哼哧 + 字母深色装饰里落在此帧内的
print("target px", int(target.sum()))
# breakdown
print("  dark in target", int((target&dark).sum()), " ring in target", int((target&ring).sum()))
# text
txt_region = np.zeros((H,W),bool); txt_region[510:562, 455:562]=True
print("pig px in text region x455-561,y510-561:", int(((txt_region)&pig).sum()))
tp = np.argwhere(txt_region&pig)
if len(tp): print("  pig px extent in text region: x", tp[:,1].min(), tp[:,1].max(), "y", tp[:,0].min(), tp[:,0].max())
# pig px inside pig bbox corners count
print("nonpig nonwhite in frame (target) coverage by bands test")
# greedy maximal rectangle cover of target (only rects fully inside target)
def greedy_cover(mask, min_area=12, max_boxes=4000):
    m = mask.copy()
    boxes=[]
    while True:
        # find maximal rectangle greedily: for each row, use histogram method to find best area
        best = (0,0,0,0,0)
        heights = np.zeros(m.shape[1], int)
        for y in range(m.shape[0]):
            heights = np.where(m[y], heights+1, 0)
            # largest rectangle in histogram
            stack=[]
            for x in range(m.shape[1]+1):
                h = heights[x] if x < m.shape[1] else 0
                start = x
                while stack and stack[-1][1] >= h:
                    sx, sh = stack.pop()
                    area = sh*(x-sx)
                    if area > best[0]:
                        best = (area, sx, y-sh+1, x-sx, sh)
                    start = sx
                stack.append((start,h))
        if best[0] < min_area or len(boxes) >= max_boxes: break
        area,bx,by,bw,bh = best
        m[by:by+bh, bx:bx+bw] = False
        boxes.append((bx,by,bw,bh))
    return boxes, m
boxes, rest = greedy_cover(target, min_area=10)
print("COVER boxes:", len(boxes), "residual px:", int(rest.sum()), "coverage:", round(100.0*(target.sum()-rest.sum())/target.sum(),3))
# check each box has 0 pig
bad = 0; pigsum=0
for (bx,by,bw,bh) in boxes:
    c = int(pig[by:by+bh, bx:bx+bw].sum())
    if c: bad+=1; pigsum+=c
print("boxes touching pig:", bad, "pig px inside boxes:", pigsum)
import json
print("first 10 boxes:", boxes[:10])
# residual distribution
ys,xs = np.nonzero(rest)
if len(xs): print("residual bbox", xs.min(), ys.min(), xs.max(), ys.max())
np.save(r"dsh-pighub/assets/work/cover_rest.npy", rest)
json.dump(boxes[:400], open(r"dsh-pighub/assets/work/cover_boxes.json","w"))
