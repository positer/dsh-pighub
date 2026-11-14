
import os
from PIL import Image, ImageDraw
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after12"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\detmix"
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
items=[("pighub-1031",(150,0,198,70)),("pighub-258",(150,0,192,90))]
cells=[]
for name,box in items:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    c=im.crop(box); z=c.resize((c.width*6,c.height*6),Image.NEAREST)
    cells.append((name,z,box))
W=max(c[1].width for c in cells)+20; H=sum(c[1].height+26 for c in cells)+20
sheet=checker(W,H); d=ImageDraw.Draw(sheet); y=10
for name,z,box in cells:
    t=checker(z.width,z.height); t.paste(z,(0,0),z); sheet.paste(t,(10,y))
    d.text((10,y+z.height+3),"%s %s x6"%(name,box),fill=(0,0,0)); y+=z.height+26
sheet.save(os.path.join(OUT,"loopcheck.png")); print(sheet.size)
