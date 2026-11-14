
import os
from PIL import Image, ImageDraw
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after13"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\detmix"
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
ids=["pighub-258","pighub-1031","pighub-12","pighub-209"]
CELL=560
for si in range(0,4,2):
    chunk=ids[si:si+2]
    cells=[]
    for name in chunk:
        im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
        sc=min(2.6, CELL/im.width, CELL/im.height)
        z=im.resize((int(im.width*sc),int(im.height*sc)),Image.LANCZOS)
        cells.append((name,z))
    W=max(c[1].width for c in cells)+20; H=sum(c[1].height+26 for c in cells)+20
    sheet=checker(W,H); d=ImageDraw.Draw(sheet); y=10
    for name,z in cells:
        t=checker(z.width,z.height); t.paste(z,(0,0),z); sheet.paste(t,(10,y)); d.text((10,y+z.height+3),name,fill=(0,0,0)); y+=z.height+26
    sheet.save(os.path.join(OUT,"v11-%02d.png"%(si//2)))
print("ok")
