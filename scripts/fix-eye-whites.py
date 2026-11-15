import os, json, hashlib
import numpy as np
from PIL import Image, ImageDraw
from collections import deque
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
def key_border_white(im, thr=246):
    a=np.array(im).copy(); h,w=a.shape[:2]
    rgb=a[:,:,:3].astype(int); alpha=a[:,:,3]
    light=(rgb[:,:,0]>=thr)&(rgb[:,:,1]>=thr)&(rgb[:,:,2]>=thr)&(alpha>8)
    seen=np.zeros((h,w),bool); q=deque()
    for x in range(w):
        for y in (0,h-1):
            if light[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    for y in range(h):
        for x in (0,w-1):
            if light[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    while q:
        cy,cx=q.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=cy+dy,cx+dx
            if 0<=ny<h and 0<=nx<w and light[ny,nx] and not seen[ny,nx]:
                seen[ny,nx]=True; q.append((ny,nx))
    a[seen,3]=0
    return Image.fromarray(a,'RGBA'), int(seen.sum())
p = next(x for x in man['pigs'] if x['id']=='pighub-974')
src = os.path.join(ROOT,'assets','originals','up-pighub-974.png')
if not os.path.exists(src): src = os.path.join(ROOT,'assets','originals','pighub-974.png')
im = Image.open(src).convert('RGBA')
out, removed = key_border_white(im)
dst = os.path.join(ROOT, p['raster'])
out.save(dst)
p['bytes']=os.path.getsize(dst); p['sha256']=sha(dst)
p['size']={'width':out.width,'height':out.height}
p['background']={'key':'border-white','threshold':246,'all':False,'removed':removed}
p['file']=p['raster']; p['vector']=False
json.dump(man, open(os.path.join(ROOT,'assets','manifest.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
# 校验：眼睛内部白像素是否仍不透明
a=np.array(out); al=a[:,:,3]
white=((a[:,:,0]>=250)&(a[:,:,1]>=250)&(a[:,:,2]>=250))
print('removed', removed, '白色像素', int(white.sum()), '其中透明', int((white&(al==0)).sum()))