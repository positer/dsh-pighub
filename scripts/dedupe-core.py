import json, os
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
ids=[]; vecs=[]
for p in man['pigs']:
    if not p['file'].lower().endswith(RASTER): continue
    try:
        im=Image.open(os.path.join(ROOT,p['file']))
        if getattr(im,'is_animated',False): im.seek(0)
        im=im.convert('RGBA')
    except Exception: continue
    a=np.array(im); h,w=a.shape[:2]
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    warm=op&(r>b+12)&(r>60)
    ys,xs=np.nonzero(warm)
    if len(xs)<500: continue
    x0,x1,y0,y1=xs.min(),xs.max(),ys.min(),ys.max()
    # 取身体核心：包围盒中间 50% 区域（去掉耳朵/道具/尾巴等外围）
    cx,cy=(x0+x1)//2,(y0+y1)//2
    hw,hh=(x1-x0)//4,(y1-y0)//4
    core=im.crop((max(0,cx-hw),max(0,cy-hh),min(w,cx+hw+1),min(h,cy+hh+1))).convert('RGB').resize((24,24), Image.LANCZOS)
    ids.append(p['id']); vecs.append(np.array(core,dtype=np.float32))
V=np.stack(vecs); n=len(ids)
print('参与:', n)
parent=list(range(n))
def find(x):
    while parent[x]!=x: parent[x]=parent[parent[x]]; x=parent[x]
    return x
def union(a,b):
    ra,rb=find(a),find(b)
    if ra!=rb: parent[rb]=ra
pairs=[]
for i in range(n):
    if i+1>=n: break
    d=np.abs(V[i+1:]-V[i]).mean(axis=(1,2,3))
    for k,val in enumerate(d):
        if val < 3.5:
            j=i+1+k; pairs.append((ids[i],ids[j],round(float(val),2))); union(i,j)
groups={}
for i in range(n): groups.setdefault(find(i),[]).append(ids[i])
dups=sorted([g for g in groups.values() if len(g)>1], key=lambda g:-len(g))
print('身体核心高度相似的簇:', len(dups))
for g in dups[:12]: print('  ', g)
json.dump({'pairs':pairs,'clusters':dups}, open(os.path.join(ROOT,'archive','dedupe-core.json'),'w'), ensure_ascii=False)