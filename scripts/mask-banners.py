import json, os
import numpy as np
from PIL import Image, ImageDraw
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
NEW_OUT = os.path.join(ROOT,'archive','masked')
os.makedirs(NEW_OUT, exist_ok=True)
ids=['pighub-751','pighub-12','pighub-873','pighub-209','pighub-271','pighub-473','pighub-341','pighub-417','pighub-1087','pighub-27']
CELL=260; cols=5; rows=(len(ids)+cols-1)//cols
sheet=Image.new('RGBA',(CELL*cols, CELL*rows+20),(20,20,24,255))
d=ImageDraw.Draw(sheet)
for i,pid in enumerate(ids):
    p=next(x for x in man['pigs'] if x['id']==pid)
    im=Image.open(os.path.join(ROOT,p['file'])).convert('RGBA')
    W,H=im.size
    mask=Image.new('L',(W,H),0); md=ImageDraw.Draw(mask)
    md.polygon([(0,0),(int(0.28*W),0),(0,int(0.72*H))], fill=255)
    md.polygon([(W,0),(int(0.66*W),0),(W,int(0.72*H))], fill=255)
    md.rectangle([0,int(0.76*H),W,H], fill=255)
    a=np.array(im); a[np.array(mask)>0]=(0,0,0,0)
    op=a[:,:,3]>8
    res=Image.fromarray(a,'RGBA')
    ys,xs=np.nonzero(op)
    if len(xs)==0:
        print('EMPTY', pid); continue
    res=res.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
    res.save(os.path.join(NEW_OUT,pid+'.png'))
    t=res.copy(); t.thumbnail((CELL-16,CELL-30), Image.LANCZOS)
    sheet.alpha_composite(t,((i%cols)*CELL+(CELL-t.width)//2,(i//cols)*CELL+(CELL-t.height)//2+20))
    d.text(((i%cols)*CELL+6,(i//cols)*CELL+4), pid, fill=(210,210,210,255))
q=os.path.join(ROOT,'archive','masked-preview.png'); sheet.save(q)
print('wrote',q)