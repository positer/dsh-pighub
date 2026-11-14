
import numpy as np, os
from PIL import Image, ImageDraw
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after4"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\v4shots"
os.makedirs(OUT,exist_ok=True)
def checker(w,h,s=12):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
ids=["pighub-258","pighub-686","pighub-1031","pighub-1087"]
for name in ids:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    z=im.resize((im.width*3,im.height*3),Image.NEAREST)
    t=checker(z.width,z.height); t.paste(z,(0,0),z); t.save(os.path.join(OUT,name+"-x3.png"))
print("ok")
