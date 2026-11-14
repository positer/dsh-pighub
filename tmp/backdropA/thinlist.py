
import numpy as np, os
from PIL import Image
from collections import deque
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after10"
def label(mask):
    h,w=mask.shape; lab=np.full((h,w),-1,np.int32); out=[]; cur=0
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
for name in ["pighub-258","pighub-1031","pighub-686","pighub-209","pighub-417","pighub-473","pighub-337","pighub-271"]:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    a=np.asarray(im); R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
    warm=(R-G>=28)&(R>=120)
    dark=(np.maximum(np.maximum(R,G),B)<150)&(A>8)&~warm
    # pixels with >=2 transparent 8-neighbours
    tr=(A<=8).astype(int)
    nb=np.zeros_like(tr)
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            if dy==0 and dx==0: continue
            sh=np.roll(np.roll(tr,dy,axis=0),dx,axis=1)
            nb+=sh
    thin=dark&(nb>=2)
    _l,cl=label(thin)
    cl=sorted([c for c in cl if c["area"]>=8],key=lambda c:-c["area"])
    print(name, im.size, [(c["area"],c["bbox"]) for c in cl[:6]])
