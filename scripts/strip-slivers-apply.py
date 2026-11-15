import os, json, hashlib
import numpy as np
from PIL import Image
from collections import deque
import vtracer
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
IMG = os.path.join(ROOT,'assets','img')
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
def dilate(m,k=4):
    out=m.copy()
    for dy in range(-k,k+1):
        for dx in range(-k,k+1):
            out |= np.roll(np.roll(m,dy,axis=0),dx,axis=1)
    return out
def strip(im, max_thin=8, max_frac=0.012):
    a=np.array(im).copy(); h,w=a.shape[:2]
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    white=op&(r>=244)&(g>=244)&(b>=244)
    warm=op&(r>b+12)&(r>60)
    cand=white&~dilate(warm,4)
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
                if min(bh,bw)<=max_thin or len(pts)/float(h*w)<=max_frac:
                    for (py,px) in pts: a[py,px]=(0,0,0,0)
                    killed+=len(pts)
    return Image.fromarray(a,'RGBA'), killed
changed=[]
for p in man['pigs']:
    rel=p.get('raster')
    if not rel or not rel.endswith('.png'): continue
    fp=os.path.join(ROOT,rel)
    if not os.path.exists(fp): continue
    im=Image.open(fp).convert('RGBA')
    out,killed=strip(im)
    if killed>0:
        out.save(fp)
        png_rel=rel; svg_rel=png_rel.replace('.png','.svg'); svg_fp=os.path.join(ROOT,svg_rel)
        vtracer.convert_image_to_svg_py(fp, svg_fp, colormode='color', hierarchical='stacked', mode='spline',
                                        filter_speckle=8, color_precision=6, corner_threshold=60, path_precision=2)
        p['file']=svg_rel; p['vector']=True
        p['bytes']=os.path.getsize(svg_fp); p['sha256']=sha(svg_fp)
        p['rasterBytes']=os.path.getsize(fp); p['rasterSha']=sha(fp)
        changed.append((p['id'],killed))
man['counts']['vector']=len([p for p in man['pigs'] if p.get('vector') is True])
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('清理白细条的卡数:', len(changed)); print(changed)