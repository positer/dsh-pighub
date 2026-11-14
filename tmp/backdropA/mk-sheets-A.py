
import os, json, sys
from PIL import Image, ImageDraw
root = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
ids = """pig-1131, pig-1358, pighub-1000, pighub-1005, pighub-1012, pighub-1018, pighub-1020, pighub-1031, pighub-104, pighub-105, pighub-1055, pighub-1063, pighub-1079, pighub-1087, pighub-1095, pighub-1099, pighub-1106, pighub-1114, pighub-1130, pighub-1135, pighub-1140, pighub-1162, pighub-1181, pighub-1183, pighub-1198, pighub-12, pighub-1208, pighub-1222, pighub-1232, pighub-1243, pighub-1252, pighub-1279, pighub-1305, pighub-1320, pighub-138, pighub-148, pighub-155, pighub-164, pighub-175, pighub-188, pighub-197, pighub-2, pighub-209, pighub-217, pighub-222, pighub-242, pighub-244, pighub-250, pighub-254, pighub-258, pighub-262, pighub-267, pighub-271, pighub-273, pighub-276, pighub-282, pighub-286, pighub-293, pighub-296, pighub-311, pighub-328, pighub-337, pighub-351, pighub-366, pighub-372, pighub-379, pighub-40, pighub-408, pighub-417, pighub-439, pighub-452, pighub-462, pighub-468, pighub-473, pighub-481, pighub-511, pighub-513, pighub-55, pighub-560, pighub-583, pighub-590, pighub-599, pighub-604, pighub-607, pighub-609, pighub-610, pighub-631, pighub-65, pighub-652, pighub-658, pighub-66, pighub-664, pighub-675, pighub-679, pighub-682, pighub-684, pighub-686, pighub-701, pighub-710, pighub-727, pighub-751, pighub-772, pighub-776, pighub-791, pighub-794, pighub-812, pighub-814, pighub-829, pighub-836, pighub-860, pighub-865, pighub-868, pighub-873, pighub-878, pighub-88, pighub-895, pighub-906, pighub-920, pighub-922, pighub-927, pighub-932, pighub-936, pighub-950, pighub-955, pighub-974, pighub-981, pighub-989, pighub-994"""
ids = [s.strip() for s in ids.split(",") if s.strip()]
have = [i for i in ids if os.path.exists(os.path.join(root,"assets","img",i+".png"))]
nopng = [i for i in ids if not os.path.exists(os.path.join(root,"assets","img",i+".png"))]
outdir = os.path.join(root,"tmp","backdropA")
os.makedirs(outdir, exist_ok=True)
print("total", len(ids), "have png", len(have), "no png", len(nopng), nopng)

def checker(w,h,s=16):
    im = Image.new("RGB",(w,h),(210,210,210)); d = ImageDraw.Draw(im)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if ((x//s)+(y//s))%2==0: d.rectangle([x,y,x+s-1,y+s-1],fill=(235,235,235))
    return im

TILE=300; COLS=4; ROWS=3; PAD=8; LBL=16
per=COLS*ROWS
sheets=[]
for si in range(0,len(have),per):
    chunk=have[si:si+per]
    W=COLS*(TILE+PAD)+PAD; H=ROWS*(TILE+LBL+PAD)+PAD
    sheet=checker(W,H); d=ImageDraw.Draw(sheet)
    for k,i in enumerate(chunk):
        cx=PAD+(k%COLS)*(TILE+PAD); cy=PAD+(k//COLS)*(TILE+LBL+PAD)
        im=Image.open(os.path.join(root,"assets","img",i+".png")); im.load()
        tile=checker(TILE,TILE)
        s=min(TILE/im.width,TILE/im.height)
        im2=im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))),Image.LANCZOS) if s<1 else im
        im2=im2.convert("RGBA")
        tile.paste(im2,((TILE-im2.width)//2,(TILE-im2.height)//2),im2)
        sheet.paste(tile,(cx,cy))
        d.text((cx+2,cy+TILE+2),i,fill=(0,0,0))
    out=os.path.join(outdir,"sheet-%02d.png"%(si//per)); sheet.save(out); sheets.append(out)
print(json.dumps(sheets))
