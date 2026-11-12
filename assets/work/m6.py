
import numpy as np
from PIL import Image
from collections import deque
src = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
a = np.array(Image.open(src).convert("RGB")).astype(np.int16)
H,W,_ = a.shape
mn = a.min(axis=2); mx = a.max(axis=2)
def label(mask):
    lab = np.full(mask.shape, -1, np.int32); cur=0; out=[]
    for sy in range(mask.shape[0]):
        row=mask[sy]
        for sx in range(mask.shape[1]):
            if not row[sx] or lab[sy,sx]>=0: continue
            dq=deque([(sy,sx)]); lab[sy,sx]=cur; n=0
            minx,maxx,miny,maxy=sx,sx,sy,sy
            while dq:
                y,x=dq.pop(); n+=1
                if x<minx:minx=x
                if x>maxx:maxx=x
                if y<miny:miny=y
                if y>maxy:maxy=y
                for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                    if 0<=ny<mask.shape[0] and 0<=nx<mask.shape[1] and mask[ny,nx] and lab[ny,nx]<0:
                        lab[ny,nx]=cur; dq.append((ny,nx))
            out.append({'n':n,'bbox':(minx,miny,maxx,maxy)}); cur+=1
    return lab,out
white = mn>=236; dark = mn<90; mid = (mn>=90)&(mn<236)
lab_mid, mids = label(mid)
lab_dark, darks = label(dark)
lab_white, whites = label(white)
mids_sorted = sorted(range(len(mids)), key=lambda i: -mids[i]['n'])
print("MID comps(top6):")
for i in mids_sorted[:6]:
    print("   n=%d bbox=%s" % (mids[i]['n'], mids[i]['bbox']))
pig_lab = mids_sorted[0]
pig = (lab_mid==pig_lab)
pigb = mids[pig_lab]['bbox']
print("PIG bbox", pigb, "n", int(pig.sum()))
# plate ring = mid comps other than pig, largest
ring_lab = mids_sorted[1]
ring = (lab_mid==ring_lab)
print("RING bbox", mids[ring_lab]['bbox'], "n", int(ring.sum()))
# other mid comps
print("other mid comps:", [(mids[i]['n'], mids[i]['bbox']) for i in mids_sorted[2:14]])
# dark comps inside pig region
inside_dark = [d for d in darks if d['bbox'][0]>=pigb[0] and d['bbox'][2]<=pigb[2] and d['bbox'][1]>=pigb[1] and d['bbox'][3]<=pigb[3]]
inside_dark.sort(key=lambda d:-d['n'])
print("DARK comps inside pig:", len(inside_dark), [(d['n'], d['bbox']) for d in inside_dark[:10]])
print("total dark px inside pig bbox:", int(((dark)&(pig==False)&(np.arange(H)[:,None]>=pigb[1])&(np.arange(H)[:,None]<=pigb[3])&(np.arange(W)[None,:]>=pigb[0])&(np.arange(W)[None,:]<=pigb[2])).sum()))
# white comps inside the pig's bbox (letters) - check whether they're enclosed by pig
inner_white = [w for w in whites if w['bbox'][0]>pigb[0] and w['bbox'][2]<pigb[2] and w['bbox'][1]>pigb[1] and w['bbox'][3]<pigb[3]]
inner_white.sort(key=lambda w:-w['n'])
print("WHITE comps fully inside pig bbox:", len(inner_white), sum(w['n'] for w in inner_white))
for w in inner_white[:12]: print("   ", w['n'], w['bbox'])
print("border white comp n:", whites[max(range(len(whites)), key=lambda i: whites[i]['n'])]['n'], whites[max(range(len(whites)), key=lambda i: whites[i]['n'])]['bbox'])
# pig min-channel extremes
pm = mn[pig]
print("pig mn min/max/median:", int(pm.min()), int(pm.max()), int(np.median(pm)))
print("pig px with mn>=236:", int(((mn>=236)&pig).sum()), ">=230:", int(((mn>=230)&pig).sum()), ">=210:", int(((mn>=210)&pig).sum()), ">=200:", int(((mn>=200)&pig).sum()))
# 哼哧 text comps: mid comps outside pig bbox bottom-right
txt = [m for m in mids_sorted[2:] if mids[m]['bbox'][0]>440 and mids[m]['bbox'][1]>490]
print("text mid comps:", len(txt), [(mids[i]['n'], mids[i]['bbox']) for i in txt])
if txt:
    xs=[mids[i]['bbox'][0] for i in txt]; xe=[mids[i]['bbox'][2] for i in txt]
    ys=[mids[i]['bbox'][1] for i in txt]; ye=[mids[i]['bbox'][3] for i in txt]
    print("text union bbox", (min(xs),min(ys),max(xe),max(ye)))
np.save(r"dsh-pighub/assets/work/pig_mask.npy", pig)
np.save(r"dsh-pighub/assets/work/ring_mask.npy", ring)
np.save(r"dsh-pighub/assets/work/dark_mask.npy", dark)
np.save(r"dsh-pighub/assets/work/white_mask.npy", white)
np.save(r"dsh-pighub/assets/work/lab_mid.npy", lab_mid)
