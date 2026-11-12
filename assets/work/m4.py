
from PIL import Image
import numpy as np
p = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
a = np.array(Image.open(p).convert("RGB")).astype(np.int16)
H,W,_ = a.shape
mn = a.min(axis=2)
def comps(mask, conn=4):
    lab = np.zeros(mask.shape, np.int32); cur=0
    from collections import deque
    out=[]
    for sy in range(mask.shape[0]):
        for sx in range(mask.shape[1]):
            if not mask[sy,sx] or lab[sy,sx]: continue
            cur+=1
            dq=deque([(sy,sx)]); lab[sy,sx]=cur; n=0
            minx,maxx,miny,maxy=sx,sx,sy,sy
            while dq:
                y,x=dq.pop(); n+=1
                minx=min(minx,x);maxx=max(maxx,x);miny=min(miny,y);maxy=max(maxy,y)
                nb=[(y-1,x),(y+1,x),(y,x-1),(y,x+1)]
                if conn==8: nb+=[(y-1,x-1),(y-1,x+1),(y+1,x-1),(y+1,x+1)]
                for ny,nx in nb:
                    if 0<=ny<mask.shape[0] and 0<=nx<mask.shape[1] and mask[ny,nx] and not lab[ny,nx]:
                        lab[ny,nx]=cur; dq.append((ny,nx))
            out.append((n,(minx,miny,maxx,maxy)))
    out.sort(reverse=True)
    return out, lab
white = mn>=236
mid = (mn>=90)&(mn<236)
dark = mn<90
print("counts: white",int(white.sum()),"mid",int(mid.sum()),"dark",int(dark.sum()), "total", W*H)
for name, m in [("white",white),("mid",mid),("dark",dark),("nonwhite",~white)]:
    cs,_ = comps(m)
    print(name, "components:", len(cs), "top:", cs[:6])
