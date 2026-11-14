
import numpy as np
from PIL import Image
from collections import deque
im=Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img\pighub-1198.png").convert("RGBA")
a=np.asarray(im); R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
seed=(A>60)&(np.abs(R-86)<30)&(np.abs(G-74)<30)&(np.abs(B-116)<46)&(B>G+10)&(B>R+6)&(R>55)&(G>50)&(B>70)
print("seed px", int(seed.sum()))
# relax
loose=(A>60)&(np.abs(R-110)<40)&(np.abs(G-92)<40)&(np.abs(B-160)<50)&(B>G+20)&(B>R+20)
print("loose px", int(loose.sum()))
ys,xs=np.nonzero(seed); print("seed bbox", (xs.min(),ys.min(),xs.max(),ys.max()) if len(xs) else None)
def label(mask):
    h,w=mask.shape; lab=np.full((h,w),-1,np.int32); out=[]; cur=0
    for y in range(h):
        for x in range(w):
            if mask[y,x] and lab[y,x]<0:
                q=deque([(y,x)]); lab[y,x]=cur; n=0
                while q:
                    cy,cx=q.popleft(); n+=1
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx=cy+dy,cx+dx
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and lab[ny,nx]<0:
                            lab[ny,nx]=cur; q.append((ny,nx))
                out.append(n); cur+=1
    return out
print("seed comps", sorted(label(seed),reverse=True)[:5])
print("loose comps", sorted(label(loose),reverse=True)[:5])
