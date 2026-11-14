
import numpy as np, os, json
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
ids=["pighub-258","pighub-1031","pighub-686","pighub-473","pighub-250","pighub-922","pighub-337","pighub-271","pighub-417","pighub-209","pighub-217","pighub-262","pighub-242","pighub-873","pighub-1106"]
for name in ids:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    a=np.asarray(im); R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
    warm=(R-G>=28)&(R>=120)
    near=warm.copy()
    for _ in range(6):
        g=near.copy(); g[1:,:]|=near[:-1,:]; g[:-1,:]|=near[1:,:]; g[:,1:]|=near[:,:-1]; g[:,:-1]|=near[:,1:]; near=g
    dark=(np.maximum(np.maximum(R,G),B)<130)&(A>8)
    cand=dark&~near
    _l,cl=label(cand)
    cl=sorted([c for c in cl if c["area"]>=5],key=lambda c:-c["area"])
    print(name, im.size, "dark-far comps:", [(c["area"],c["bbox"]) for c in cl[:5]])
