
import numpy as np, os
from PIL import Image
from collections import Counter
ROOT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
for name,box in [("pighub-1031",(195,0,250,45)),("pighub-258",(150,0,220,50))]:
    im=Image.open(os.path.join(ROOT,"assets","img",name+".png")).convert("RGBA")
    a=np.asarray(im)
    x0,y0,x1,y1=box
    sub=a[y0:y1,x0:x1]
    c=Counter()
    for y in range(sub.shape[0]):
        for x in range(sub.shape[1]):
            p=sub[y,x]
            if p[3]>200: c[(int(p[0]),int(p[1]),int(p[2]))]+=1
    print(name, "top-right region colours:", c.most_common(10))
