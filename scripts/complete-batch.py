import os, json
import numpy as np
from PIL import Image, ImageDraw
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
ids = json.load(open(os.path.join(ROOT,'archive','incomplete-candidates.json'), encoding='utf-8'))[:6]
std=Image.open(os.path.join(ROOT,'assets','img','standard-pig.png')).convert('RGBA')
sa=np.array(std); sm=sa[:,:,3]>8
ys,xs=np.nonzero(sm); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max()
body=std.crop((int(x0),int(y0+(y1-y0)*0.50),int(x1)+1,int(y1)+1))
def complete(card, TW=160):
    k=TW/card.width
    cs=card.resize((TW,int(card.height*k)), Image.LANCZOS)
    hw=cs.width*0.70; bw=int(hw*1.30); bh=int(body.height*bw/body.width)
    b=body.resize((bw,bh), Image.LANCZOS)
    cv=Image.new('RGBA',(cs.width, cs.height+int(bh*0.8)),(0,0,0,0))
    cv.alpha_composite(b,(int(cs.width*0.55-bw/2), int(cs.height*0.97-bh*0.22)))
    cv.alpha_composite(cs,(0,0))
    a=np.array(cv); ys2,xs2=np.nonzero(a[:,:,3]>8)
    return cv.crop((xs2.min(),ys2.min(),xs2.max()+1,ys2.max()+1))
CELL=180; cols=6
sheet=Image.new('RGBA',(CELL*cols*2, CELL*((len(ids)+cols-1)//cols)+16),(22,22,26,255))
d=ImageDraw.Draw(sheet)
for i,pid in enumerate(ids):
    p=next(x for x in man['pigs'] if x['id']==pid)
    card=Image.open(os.path.join(ROOT,p.get('raster') or p['file'])).convert('RGBA')
    out=complete(card)
    x=(i%cols)*CELL*2; y=(i//cols)*CELL+16
    d.text((x+4,y-14), pid, fill=(220,220,220,255))
    for j,s in enumerate((card,out)):
        t=s.copy(); t.thumbnail((CELL-12,CELL-16), Image.LANCZOS)
        sheet.alpha_composite(t,(x+j*CELL+(CELL-t.width)//2, y+(CELL-t.height)//2))
q=os.path.join(ROOT,'archive','complete-batch1.png'); sheet.save(q)
print('wrote',q, ids)