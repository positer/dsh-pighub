
import os, json
import numpy as np
from PIL import Image
IMG=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img"
IDS=["pighub-258","pighub-1031","pighub-1106","pighub-12","pighub-209","pighub-217","pighub-242",
     "pighub-250","pighub-262","pighub-271","pighub-293","pighub-337","pighub-40","pighub-417",
     "pighub-473","pighub-560","pighub-686","pighub-873","pighub-922"]
bad=[]
for i in IDS:
    p=os.path.join(IMG,i+".png")
    im=Image.open(p); im.verify()
    im2=Image.open(p).convert("RGBA"); a=np.asarray(im2)
    R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
    navy=(A>60)&(np.abs(R-86)<34)&(np.abs(G-74)<34)&(np.abs(B-116)<50)&(B>G+8)&(B>R+4)&(R>50)
    n=int(navy.sum())
    ok = im.mode in ("RGBA","RGB") and n < 400
    print("%-14s %s %s navy=%d %s" % (i, im.mode, im.size, n, "OK" if ok else "CHECK"))
    if not ok: bad.append(i)
print("flagged:", bad)
