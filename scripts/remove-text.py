import os, json
import numpy as np
from PIL import Image, ImageDraw
from collections import deque
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def dilate(m,k=3):
    out=m.copy()
    for dy in range(-k,k+1):
        for dx in range(-k,k+1):
            out |= np.roll(np.roll(m,dy,axis=0),dx,axis=1)
    return out
def clean(im):
    a=np.array(im).copy(); h,w=a.shape[:2]
    op=a[:,:,3]>8
    lab=np.zeros((h,w),np.int32); n=0; comps=[]
    for y in range(h):
        for x in range(w):
            if op[y,x] and lab[y,x]==0:
                n+=1; q=deque([(y,x)]); lab[y,x]=n; pts=[(y,x)]
                while q:
                    cy,cx=q.popleft()
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx=cy+dy,cx+dx
                        if 0<=ny<h and 0<=nx<w and op[ny,nx] and lab[ny,nx]==0:
                            lab[ny,nx]=n; q.append((ny,nx)); pts.append((ny,nx))
                comps.append(pts)
    if not comps: return im, 0
    comps.sort(key=len, reverse=True)
    main=set(comps[0])
    main_d=dilate(np.zeros((h,w),bool) | (lab==1), 4)
    keep=np.zeros((h,w),bool)
    for pts in comps:
        ys=[p[0] for p in pts]; xs=[p[1] for p in pts]
        area=len(pts); frac=area/float(h*w)
        col=a[ys,xs,:3].astype(int)
        warm=float(((col[:,0]>col[:,2]+12)&(col[:,0]>60)).mean())
        # 保留：主猪体 / 面积够大的 / 暖色占比高的 / 紧贴主猪体的
        if pts is comps[0] or frac>0.012 or warm>0.35 or main_d[ys,xs].mean()>0.25:
            for p in pts: keep[p]=True
    a[~keep]=(0,0,0,0)
    ys,xs=np.nonzero(a[:,:,3]>8)
    out=Image.fromarray(a,'RGBA')
    if len(xs): out=out.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
    return out, len(comps)
ids=['pighub-209','pighub-217','pighub-417','pighub-473','pighub-873','pighub-1087','pighub-27','pighub-12']
CELL=250; cols=4; rows=(len(ids)+cols-1)//cols
sheet=Image.new('RGBA',(CELL*cols*2, CELL*rows),(20,20,24,255))
for i,pid in enumerate(ids):
    p=next(x for x in man['pigs'] if x['id']==pid)
    src=p.get('raster') or p['file']
    im=Image.open(os.path.join(ROOT,src)).convert('RGBA')
    out,nc=clean(im)
    for j,s in enumerate((im,out)):
        t=s.copy(); t.thumbnail((CELL-14,CELL-14), Image.LANCZOS)
        sheet.alpha_composite(t,(((i%cols)*2+j)*CELL+(CELL-t.width)//2,(i//cols)*CELL+(CELL-t.height)//2))
q=os.path.join(ROOT,'archive','text-removal-preview.png'); sheet.save(q)
print('wrote',q)