
import os
from PIL import Image, ImageDraw
from collections import Counter
import numpy as np
ORI=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img"
TR=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\trial2"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\\ba"
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
a=Image.open(os.path.join(ORI,"pighub-1087.png")).convert("RGBA")
b=Image.open(os.path.join(TR,"pighub-1087.png")).convert("RGBA")
sc=min(2.4, 600/a.width, 600/a.height)
za=a.resize((int(a.width*sc),int(a.height*sc)),Image.LANCZOS); zb=b.resize((int(b.width*sc),int(b.height*sc)),Image.LANCZOS)
W=za.width+zb.width+30; H=max(za.height,zb.height)+34
sheet=checker(W,H); d=ImageDraw.Draw(sheet)
sheet.paste(za,(10,10),za); sheet.paste(zb,(za.width+20,10),zb)
d.text((10,H-20),"BEFORE 1087",fill=(0,0,0)); d.text((za.width+20,H-20),"TRIAL AFTER",fill=(0,0,0))
sheet.save(os.path.join(OUT,"trial-1087.png"))

im=Image.open(os.path.join(ORI,"pighub-1198.png")).convert("RGBA")
arr=np.asarray(im); R=arr[:,:,0].astype(int);G=arr[:,:,1].astype(int);B=arr[:,:,2].astype(int);A=arr[:,:,3].astype(int)
# sample the banner area (right side)
sub=arr[300:600, 350:520]
c=Counter()
for y in range(0,sub.shape[0],4):
    for x in range(0,sub.shape[1],4):
        p=sub[y,x]
        if p[3]>60: c[(int(p[0])//8*8,int(p[1])//8*8,int(p[2])//8*8,int(p[3])//32*32)]+=1
print("1198 banner-ish colours:", c.most_common(10))
print("1198 size", im.size)
