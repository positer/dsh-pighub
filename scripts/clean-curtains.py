import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from collections import deque
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def dilate(m,k):
    out=m.copy()
    for dy in range(-k,k+1):
        for dx in range(-k,k+1):
            out |= np.roll(np.roll(m,dy,axis=0),dx,axis=1)
    return out
def clean(im, halo=4):
    a=np.array(im).copy(); h,w=a.shape[:2]
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    # 猪身与道具：偏暖（R 明显大于 B）
    warm = op & (r > b + 12) & (r > 60)
    protect = dilate(warm, halo)
    fillable = op & ~protect
    # 从四条边灌水，只连通到边框的部分会被清掉（幕布/文字/星点）
    seen=np.zeros((h,w),bool); q=deque()
    for x in range(w):
        for y in (0,h-1):
            if fillable[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    for y in range(h):
        for x in (0,w-1):
            if fillable[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    while q:
        cy,cx=q.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=cy+dy,cx+dx
            if 0<=ny<h and 0<=nx<w and fillable[ny,nx] and not seen[ny,nx]:
                seen[ny,nx]=True; q.append((ny,nx))
    a[seen]=(0,0,0,0)
    return Image.fromarray(a,'RGBA')
ids=json.load(open(os.path.join(ROOT,'archive','curtain-cards.json'), encoding='utf-8'))[:9]
CELL=300; cols=3; rows=(len(ids)+cols-1)//cols
sheet=Image.new('RGBA',(CELL*cols*2, CELL*rows),(20,20,24,255))
for i,pid in enumerate(ids):
    p=next(x for x in man['pigs'] if x['id']==pid)
    im=Image.open(os.path.join(ROOT,p['file'])).convert('RGBA')
    out=clean(im)
    ys,xs=np.nonzero(np.array(out)[:,:,3]>8)
    if len(xs): out=out.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
    for j,src in enumerate((im,out)):
        t=src.copy(); t.thumbnail((CELL-12,CELL-12), Image.LANCZOS)
        sheet.alpha_composite(t,((i%cols)*2*CELL+j*CELL+(CELL-t.width)//2,(i//cols)*CELL+(CELL-t.height)//2))
q=os.path.join(ROOT,'archive','flood-clean-preview.png'); sheet.save(q)
print('wrote',q, ids)