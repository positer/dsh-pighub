
import os, json
from PIL import Image, ImageDraw
root = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
ids = """pighub-1031,pighub-1055,pighub-1087,pighub-1106,pighub-12,pighub-1208,pighub-155,pighub-209,pighub-217,pighub-242,pighub-250,pighub-258,pighub-262,pighub-271,pighub-293,pighub-337,pighub-40,pighub-417,pighub-473,pighub-560,pighub-686,pighub-791,pighub-873,pighub-922,pighub-936,pighub-408,pighub-1198,pighub-296,pighub-1140,pighub-1232,pighub-244,pighub-222,pighub-105,pighub-439,pighub-462,pighub-468"""
ids = [s.strip() for s in ids.split(",") if s.strip()]
out = os.path.join(root,"tmp","backdropA")
def checker(w,h,s=16):
    im = Image.new("RGB",(w,h),(205,205,205)); d=ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(232,232,232))
    return im
CELL=512; COLS=2; ROWS=2; LBL=18
sheets=[]
for si in range(0,len(ids),4):
    chunk=ids[si:si+4]
    W=COLS*CELL+20; H=ROWS*(CELL+LBL)+20
    sheet=checker(W,H); d=ImageDraw.Draw(sheet)
    for k,i in enumerate(chunk):
        cx=10+(k%COLS)*CELL; cy=10+(k//COLS)*(CELL+LBL)
        im=Image.open(os.path.join(root,"assets","img",i+".png")).convert("RGBA")
        im.thumbnail((CELL,CELL),Image.LANCZOS)
        tile=checker(CELL,CELL)
        tile.paste(im,((CELL-im.width)//2,(CELL-im.height)//2),im)
        sheet.paste(tile,(cx,cy)); d.text((cx+2,cy+CELL+3),i,fill=(0,0,0))
    o=os.path.join(out,"zoom-%02d.png"%(si//4)); sheet.save(o); sheets.append(o)
print(json.dumps(sheets))
