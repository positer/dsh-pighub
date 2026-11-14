import json, os
import numpy as np
from PIL import Image, ImageDraw
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
# 每张卡按目视结果单独定多边形（归一化坐标 0..1）
PLANS = {
'pighub-12': [
    [(0,0),(0.26,0),(0,0.74)],
    [(1,0),(0.68,0),(1,0.74)],
    [(0,0.78),(1,0.78),(1,1),(0,1)],
],
'pighub-209': [
    [(0,0),(0.30,0),(0,0.70)],
    [(1,0),(0.64,0),(1,0.70)],
    [(0,0.72),(1,0.72),(1,1),(0,1)],
],
}
CELL=320
ids=list(PLANS.keys())
sheet=Image.new('RGBA',(CELL*len(ids)*2, CELL),(20,20,24,255))
for i,pid in enumerate(ids):
    p=next(x for x in man['pigs'] if x['id']==pid)
    im=Image.open(os.path.join(ROOT,p['file'])).convert('RGBA')
    W,H=im.size
    mask=Image.new('L',(W,H),0); md=ImageDraw.Draw(mask)
    for poly in PLANS[pid]:
        md.polygon([(int(x*W),int(y*H)) for x,y in poly], fill=255)
    a=np.array(im); a[np.array(mask)>0]=(0,0,0,0)
    res=Image.fromarray(a,'RGBA')
    ys,xs=np.nonzero(np.array(res)[:,:,3]>8)
    res=res.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
    for j,src in enumerate((im,res)):
        t=src.copy(); t.thumbnail((CELL-16,CELL-16), Image.LANCZOS)
        sheet.alpha_composite(t,((i*2+j)*CELL+(CELL-t.width)//2,(CELL-t.height)//2))
q=os.path.join(ROOT,'archive','percard-12-209.png'); sheet.save(q)
print('wrote',q)