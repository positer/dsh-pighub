import json, os
import numpy as np
from PIL import Image, ImageDraw
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def dilate(m,k):
    out=m.copy()
    for dy in range(-k,k+1):
        for dx in range(-k,k+1):
            out |= np.roll(np.roll(m,dy,axis=0),dx,axis=1)
    return out
ids=['pighub-751','pighub-12','pighub-873','pighub-209','pighub-271','pighub-473','pighub-341','pighub-417','pighub-1087','pighub-27']
CELL=260; cols=5; rows=(len(ids)+cols-1)//cols
sheet=Image.new('RGBA',(CELL*cols, CELL*rows+20),(20,20,24,255))
d=ImageDraw.Draw(sheet); stat=[]
for i,pid in enumerate(ids):
    p=next(x for x in man['pigs'] if x['id']==pid)
    im=Image.open(os.path.join(ROOT,p['file'])).convert('RGBA')
    a=np.array(im); r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    warm = op & (r > b + 18) & (r > 70) & ~((r>200)&(g<120)&(b>150))   # 猪身/道具；排除紫色文字
    keep = dilate(warm, max(4, im.width//60)) & op
    cut=a.copy(); cut[~keep]=(0,0,0,0)
    res=Image.fromarray(cut,'RGBA')
    ys,xs=np.nonzero(np.array(res)[:,:,3]>8)
    if len(xs)==0: stat.append((pid,'EMPTY')); continue
    res=res.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
    stat.append((pid, res.size))
    t=res.copy(); t.thumbnail((CELL-16,CELL-30), Image.LANCZOS)
    sheet.alpha_composite(t,((i%cols)*CELL+(CELL-t.width)//2,(i//cols)*CELL+(CELL-t.height)//2+20))
    d.text(((i%cols)*CELL+6,(i//cols)*CELL+4), pid, fill=(210,210,210,255))
q=os.path.join(ROOT,'archive','adaptive-mask-preview.png'); sheet.save(q)
print(stat); print('wrote',q)