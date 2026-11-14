
import numpy as np, os
from PIL import Image, ImageDraw
from collections import Counter
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after5"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\\v4shots"
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
for name,box in [("pighub-1031",None),("pighub-258",None)]:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    a=np.asarray(im)
    R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
    m=(A>60)&(np.abs(R-86)<34)&(np.abs(G-74)<34)&(np.abs(B-116)<50)&(B>G+8)&(B>R+4)&(R>50)
    ys,xs=np.nonzero(m)
    print(name, im.size, "residual", len(xs), "bbox", (int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())) if len(xs) else None)
    print("  sample", [(int(x),int(y),tuple(int(v) for v in a[y,x])) for x,y in list(zip(xs,ys))[:6]])
    z=im.resize((im.width*4,im.height*4),Image.NEAREST)
    t=checker(z.width,z.height); t.paste(z,(0,0),z); t.save(os.path.join(OUT,name+"-x4.png"))
