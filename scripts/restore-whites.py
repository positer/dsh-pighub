import os, json, hashlib
import numpy as np
from PIL import Image
from collections import deque
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
def restore_interior_white(im):
    a=np.array(im).copy(); h,w=a.shape[:2]
    rgb=a[:,:,:3].astype(int); al=a[:,:,3]
    # 目标：本应是不透明白（255,255,255）却被误置成透明的像素
    cand=(al==0)&(rgb[:,:,0]>=250)&(rgb[:,:,1]>=250)&(rgb[:,:,2]>=250)
    if not cand.any(): return im, 0
    # 只有「不连通到画布四边」的才恢复（外圈白底必须保持透明）
    seen=np.zeros((h,w),bool); q=deque()
    for x in range(w):
        for y in (0,h-1):
            if cand[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    for y in range(h):
        for x in (0,w-1):
            if cand[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    while q:
        cy,cx=q.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=cy+dy,cx+dx
            if 0<=ny<h and 0<=nx<w and cand[ny,nx] and not seen[ny,nx]:
                seen[ny,nx]=True; q.append((ny,nx))
    fix = cand & ~seen
    a[fix,3]=255
    return Image.fromarray(a,'RGBA'), int(fix.sum())
fixed=[]
for p in man['pigs']:
    rel=p.get('raster')
    if not rel: continue
    fp=os.path.join(ROOT,rel)
    if not os.path.exists(fp) or not rel.lower().endswith('.png'): continue
    im=Image.open(fp).convert('RGBA')
    out,n = restore_interior_white(im)
    if n>0:
        out.save(fp)
        p['bytes']=os.path.getsize(fp); p['sha256']=sha(fp)
        p['rasterBytes']=p['bytes']; p['rasterSha']=p['sha256']
        p['file']=rel; p['vector']=False
        fixed.append((p['id'],n))
json.dump(man, open(os.path.join(ROOT,'assets','manifest.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('修复卡数:', len(fixed))
print(fixed[:12])