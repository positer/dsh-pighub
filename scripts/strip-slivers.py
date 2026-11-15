import os, json
import numpy as np
from PIL import Image, ImageDraw
from collections import deque
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def dilate(m,k=4):
    out=m.copy()
    for dy in range(-k,k+1):
        for dx in range(-k,k+1):
            out |= np.roll(np.roll(m,dy,axis=0),dx,axis=1)
    return out
def strip_white_slivers(im, max_thin=8, max_frac=0.012):
    a=np.array(im).copy(); h,w=a.shape[:2]
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    white = op & (r>=244)&(g>=244)&(b>=244)
    warm  = op & (r > b + 12) & (r > 60)
    near_pig = dilate(warm, 4)
    cand = white & ~near_pig          # 白色、且不贴着猪/道具
    lab=np.zeros((h,w),np.int32); n=0; killed=0
    for y in range(h):
        for x in range(w):
            if cand[y,x] and lab[y,x]==0:
                n+=1; q=deque([(y,x)]); lab[y,x]=n; pts=[(y,x)]
                while q:
                    cy,cx=q.popleft()
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx=cy+dy,cx+dx
                        if 0<=ny<h and 0<=nx<w and cand[ny,nx] and lab[ny,nx]==0:
                            lab[ny,nx]=n; q.append((ny,nx)); pts.append((ny,nx))
                ys=[p[0] for p in pts]; xs=[p[1] for p in pts]
                bh=max(ys)-min(ys)+1; bw=max(xs)-min(xs)+1
                thin = min(bh,bw) <= max_thin
                small = len(pts)/float(h*w) <= max_frac
                if thin or small:
                    for (py,px) in pts: a[py,px]=(0,0,0,0)
                    killed += len(pts)
    return Image.fromarray(a,'RGBA'), killed
ids=['pighub-12','pighub-209','pighub-271','pighub-473','pighub-341','pighub-1087','pighub-1198']
CELL=200
sheet=Image.new('RGBA',(CELL*len(ids), CELL*2+16),(22,22,26,255))
d=ImageDraw.Draw(sheet); stat=[]
for i,pid in enumerate(ids):
    p=next((x for x in man['pigs'] if x['id']==pid), None)
    if not p: continue
    fp=os.path.join(ROOT, p.get('raster') or p['file'])
    im=Image.open(fp).convert('RGBA')
    out,killed=strip_white_slivers(im)
    stat.append((pid,killed))
    d.text((i*CELL+4,1), pid.replace('pighub-','')+' -%d'%killed, fill=(215,215,215,255))
    for j,s in enumerate((im,out)):
        t=s.copy(); t.thumbnail((CELL-10,CELL-18), Image.LANCZOS)
        sheet.alpha_composite(t,(i*CELL+(CELL-t.width)//2, 16+j*CELL+(CELL-t.height)//2))
q=os.path.join(ROOT,'archive','sliver-preview.png'); sheet.save(q)
print('wrote',q); print(stat)