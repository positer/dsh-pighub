
import os
from PIL import Image, ImageDraw
ORI=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\\ba"
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
cells=[]
for name in ["pighub-1087","pighub-1198"]:
    im=Image.open(os.path.join(ORI,name+".png")).convert("RGBA")
    z=im.resize((int(im.width*2.2),int(im.height*2.2)),Image.LANCZOS)
    cells.append((name,z))
W=max(c[1].width for c in cells)+20; H=sum(c[1].height+26 for c in cells)+20
sheet=checker(W,H); d=ImageDraw.Draw(sheet); y=10
for name,z in cells:
    t=checker(z.width,z.height); t.paste(z,(0,0),z); sheet.paste(t,(10,y)); d.text((10,y+z.height+3),name+" ORIGINAL",fill=(0,0,0)); y+=z.height+26
sheet.save(os.path.join(OUT,"manual-check.png")); print("ok")
