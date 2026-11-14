
import numpy as np, os
from PIL import Image, ImageDraw
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after8"
OUT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\v8sheets"
os.makedirs(OUT,exist_ok=True)
def checker(w,h,s=12):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
ids=["pighub-258","pighub-1031","pighub-1106","pighub-12","pighub-209","pighub-217","pighub-242","pighub-250","pighub-262","pighub-271","pighub-293","pighub-337","pighub-40","pighub-417","pighub-473","pighub-560","pighub-686","pighub-873","pighub-922"]
CELL=512; LBL=16
for si in range(0,len(ids),4):
    chunk=ids[si:si+4]
    W=2*CELL+30; H=2*(CELL+LBL)+30
    sheet=checker(W,H); d=ImageDraw.Draw(sheet)
    for k,i in enumerate(chunk):
        cx=10+(k%2)*CELL; cy=10+(k//2)*(CELL+LBL)
        im=Image.open(os.path.join(AFT,i+".png")).convert("RGBA")
        z=im.resize((im.width*2,im.height*2),Image.LANCZOS)
        if z.width>CELL or z.height>CELL: z.thumbnail((CELL,CELL),Image.LANCZOS)
        tile=checker(CELL,CELL); tile.paste(z,((CELL-z.width)//2,(CELL-z.height)//2),z)
        sheet.paste(tile,(cx,cy)); d.text((cx+2,cy+CELL+2),i,fill=(0,0,0))
    sheet.save(os.path.join(OUT,"v8-%02d.png"%(si//4)))
print("ok")
