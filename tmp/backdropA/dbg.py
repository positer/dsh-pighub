
import numpy as np, os
from PIL import Image
from collections import deque
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after2"
def label(mask):
    h,w = mask.shape; lab=np.full((h,w),-1,np.int32); out=[]; cur=0
    for y in range(h):
        for x in range(w):
            if mask[y,x] and lab[y,x]<0:
                q=deque([(y,x)]); lab[y,x]=cur; n=0; y0=y1=y; x0=x1=x
                while q:
                    cy,cx=q.popleft(); n+=1
                    if cy<y0:y0=cy
                    if cy>y1:y1=cy
                    if cx<x0:x0=cx
                    if cx>x1:x1=cx
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx=cy+dy,cx+dx
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and lab[ny,nx]<0:
                            lab[ny,nx]=cur; q.append((ny,nx))
                out.append({"area":n,"bbox":[x0,y0,x1,y1],"id":cur}); cur+=1
    return lab,out
for name in ["pighub-258","pighub-686"]:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    a=np.asarray(im); A=a[:,:,3].astype(np.int32)
    _l,cl=label(A<=8)
    cl=sorted(cl,key=lambda c:-c["area"])
    print(name, im.size, "transparent comps:", [(c["area"],c["bbox"]) for c in cl[:6]])
    print("  opaque px", int((A>8).sum()), " alpha<200 count", int(((A>8)&(A<200)).sum()))
