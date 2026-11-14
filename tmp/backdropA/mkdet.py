
import os
from PIL import Image, ImageDraw
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after10"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\detmix"
os.makedirs(OUT,exist_ok=True)
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
items=[("pighub-258",(140,0,246,90)),("pighub-1031",(145,0,205,45)),
       ("pighub-686",(105,0,202,50)),("pighub-473",(85,0,220,45)),
       ("pighub-209",(135,0,213,60)),("pighub-417",(155,55,215,115)),
       ("pighub-337",(15,90,100,135)),("pighub-271",(125,20,215,110))]
for si in range(0,len(items),2):
    chunk=items[si:si+2]
    cells=[]
    for name,(x0,y0,x1,y1) in chunk:
        im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
        x0=max(0,x0);y0=max(0,y0);x1=min(im.width,x1);y1=min(im.height,y1)
        c=im.crop((x0,y0,x1,y1))
        sc=min(6, 1000//max(1,c.width))
        z=c.resize((c.width*sc,c.height*sc),Image.NEAREST)
        cells.append((name,z,"%s x%d  (%d,%d)-(%d,%d)"%(name,sc,x0,y0,x1,y1)))
    W=max(c[1].width for c in cells)+20; H=sum(c[1].height+24 for c in cells)+20
    sheet=checker(W,H); d=ImageDraw.Draw(sheet); y=10
    for name,z,lab in cells:
        t=checker(z.width,z.height); t.paste(z,(0,0),z); sheet.paste(t,(10,y))
        d.text((10,y+z.height+3),lab,fill=(0,0,0)); y+=z.height+24
    sheet.save(os.path.join(OUT,"det-%02d.png"%(si//2)))
print("ok")
