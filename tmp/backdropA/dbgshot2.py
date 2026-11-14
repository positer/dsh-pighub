
import numpy as np, os
from PIL import Image, ImageDraw
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after3"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\dbgshots"
def checker(w,h,s=12):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
for name in ["pighub-258","pighub-686","pighub-1031"]:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    z=im.resize((im.width*3,im.height*3),Image.NEAREST)
    t=checker(z.width,z.height); t.paste(z,(0,0),z); t.save(os.path.join(OUT,name+"-v3x3.png"))
    # alpha histogram of surviving opaque-ish
    a=np.asarray(im); A=a[:,:,3].astype(int)
    print(name,"px 9..200 alpha:",int(((A>8)&(A<200)).sum()),"opaque>=200:",int((A>=200).sum()))
