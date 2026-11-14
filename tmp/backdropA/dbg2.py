
import numpy as np, os
from PIL import Image
from collections import Counter
ROOT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
AFT=os.path.join(ROOT,"tmp","backdropA","after2")
for name in ["pighub-258","pighub-686","pighub-1031"]:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    a=np.asarray(im); R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
    m=(A>60)&(np.abs(R-86)<34)&(np.abs(G-74)<34)&(np.abs(B-116)<50)&(B>G+8)&(B>R+4)&(R>50)
    ys,xs=np.nonzero(m)
    print(name,"residual",len(xs),"coords sample",list(zip(xs.tolist(),ys.tolist()))[:12])
    print("   colours", Counter([tuple(a[y,x][:3].tolist()) for y,x in zip(ys,xs)]).most_common(6))
    print("   rows", Counter(ys.tolist()).most_common(4), "cols", Counter(xs.tolist()).most_common(4))
