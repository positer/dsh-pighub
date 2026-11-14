
import os
from PIL import Image, ImageDraw
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after8"
ORI=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\v4shots"
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
for name,box in [("pighub-258",(150,20,230,80)),("pighub-1031",(140,0,215,60))]:
    im=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    x0,y0,x1,y1=box
    c=im.crop((max(0,x0),max(0,y0),min(im.width,x1),min(im.height,y1)))
    z=c.resize((c.width*6,c.height*6),Image.NEAREST)
    t=checker(z.width,z.height); t.paste(z,(0,0),z)
    t.save(os.path.join(OUT,name+"-crop6.png"))
print("ok")
