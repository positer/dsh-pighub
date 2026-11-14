
import numpy as np, os
from PIL import Image
from collections import deque
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after11"
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
for name in ["pighub-258","pighub-1031"]:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    a=np.asarray(im); R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
    warm=(R-G>=28)&(R>=120)
    tr=(A<=8).astype(int); nb=np.zeros_like(tr)
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            if dy==0 and dx==0: continue
            nb+=np.roll(np.roll(tr,dy,axis=0),dx,axis=1)
    dark=(np.maximum(np.maximum(R,G),B)<170)&(A>8)&~warm&(nb>=2)
    _l,cl=label(dark)
    cl=sorted([c for c in cl if c["area"]>=6],key=lambda c:-c["area"])
    print(name,im.size,"dark thin far:",[(c["area"],c["bbox"]) for c in cl[:6]])
    # white blotches
    white=(np.minimum(np.minimum(R,G),B)>195)&(A>8)&~warm&(nb>=2)
    _l2,cl2=label(white)
    cl2=sorted([c for c in cl2 if c["area"]>=6],key=lambda c:-c["area"])
    print("   white blobs:",[(c["area"],c["bbox"]) for c in cl2[:6]])
    # navy residue
    nav=(A>8)&(np.abs(R-86)<60)&(np.abs(G-74)<60)&(np.abs(B-116)<70)&(B>G+4)
    _l3,cl3=label(nav)
    cl3=sorted([c for c in cl3 if c["area"]>=6],key=lambda c:-c["area"])
    print("   navy blobs:",[(c["area"],c["bbox"]) for c in cl3[:6]])
