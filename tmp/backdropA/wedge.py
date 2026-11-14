
import numpy as np, os
from PIL import Image
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after13"
im=Image.open(os.path.join(AFT,"pighub-1031.png")).convert("RGBA")
a=np.asarray(im); R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
nav=(A>8)&(np.abs(R-86)<70)&(np.abs(G-74)<70)&(np.abs(B-116)<80)&(B>G+2)
ys,xs=np.nonzero(nav)
print("bbox",xs.min(),ys.min(),xs.max(),ys.max(),"n",len(xs),"size",im.size)
print("colours",[tuple(int(v) for v in a[y,x][:3]) for y,x in list(zip(ys,xs))[:8]])
