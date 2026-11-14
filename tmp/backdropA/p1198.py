
from PIL import Image
from collections import Counter
import numpy as np
ORI=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img"
im=Image.open(ORI+"\\pighub-1198.png").convert("RGBA")
a=np.asarray(im); print("size",im.size)
sub=a[0:212, 170:256]
c=Counter()
for y in range(0,sub.shape[0],3):
    for x in range(0,sub.shape[1],3):
        p=sub[y,x]
        if p[3]>60: c[(int(p[0])//8*8,int(p[1])//8*8,int(p[2])//8*8,int(p[3])//32*32)]+=1
print(c.most_common(10))
