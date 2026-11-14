
import os
from PIL import Image, ImageDraw
ORI=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img"
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\final"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\ba"
os.makedirs(OUT,exist_ok=True)
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
for name in ["pighub-560","pighub-922","pighub-417"]:
    a=Image.open(os.path.join(ORI,name+".png")).convert("RGBA")
    b=Image.open(os.path.join(AFT,name+".png")).convert("RGBA")
    sc=min(2.2, 560/a.width, 560/a.height)
    za=a.resize((int(a.width*sc),int(a.height*sc)),Image.LANCZOS)
    zb=b.resize((int(b.width*sc),int(b.height*sc)),Image.LANCZOS)
    W=za.width+zb.width+30; H=max(za.height,zb.height)+30
    sheet=checker(W,H); d=ImageDraw.Draw(sheet)
    sheet.paste(za,(10,10),za); sheet.paste(zb,(za.width+20,10),zb)
    d.text((10,H-18),"BEFORE "+name,fill=(0,0,0)); d.text((za.width+20,H-18),"AFTER",fill=(0,0,0))
    sheet.save(os.path.join(OUT,name+".png"))
print("ok")
