
import os, json
from PIL import Image, ImageDraw
ARCH = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\archive\20261114-010201-remove-backdrop-A"
IDS = ["pighub-258","pighub-1031","pighub-1106","pighub-12","pighub-209","pighub-217","pighub-242",
       "pighub-250","pighub-262","pighub-271","pighub-293","pighub-337","pighub-40","pighub-417",
       "pighub-473","pighub-560","pighub-686","pighub-873","pighub-922"]
def checker(w,h,s=10):
    im=Image.new("RGB",(w,h),(203,203,203)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(233,233,233))
    return im
CELL=540
for si in range(0,len(IDS),4):
    chunk=IDS[si:si+4]
    W=2*CELL+30; H=2*(CELL+18)+30
    sheet=checker(W,H); d=ImageDraw.Draw(sheet)
    for k,i in enumerate(chunk):
        cx=10+(k%2)*CELL; cy=10+(k//2)*(CELL+18)
        im=Image.open(os.path.join(ARCH,"after",i+".png")).convert("RGBA")
        sc=min(2.5, CELL/im.width, CELL/im.height)
        z=im.resize((int(im.width*sc),int(im.height*sc)),Image.LANCZOS)
        tile=checker(CELL,CELL); tile.paste(z,((CELL-z.width)//2,(CELL-z.height)//2),z)
        sheet.paste(tile,(cx,cy)); d.text((cx+2,cy+CELL+2),"%s  x%.1f"%(i,sc),fill=(0,0,0))
    sheet.save(os.path.join(ARCH,"verify","sheet-%02d.png"%(si//4)))
m=json.load(open(os.path.join(ARCH,"writeback.json"),encoding="utf-8"))
print("id | before | after | bytes before->after")
for r in m:
    print("%s | %dx%d | %dx%d | %d -> %d" % (r["id"], r["before_size"][0], r["before_size"][1],
          r["after_size"][0], r["after_size"][1], r["before_bytes"], r["after_bytes"]))
