import json, os
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
S=64
ids=[]; vecs=[]
for p in man['pigs']:
    if not p['file'].lower().endswith(RASTER): continue
    try:
        im=Image.open(os.path.join(ROOT,p['file']))
        if getattr(im,'is_animated',False): im.seek(0)
        im=im.convert('RGBA')
    except Exception: continue
    a=np.array(im); m=a[:,:,3]>8
    ys,xs=np.nonzero(m)
    if len(xs)==0: continue
    crop=im.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1)).convert('RGB').resize((S,S), Image.LANCZOS)
    ids.append(p['id']); vecs.append(np.array(crop, dtype=np.float32))
V=np.stack(vecs)
n=len(ids); print('参与:', n)
parent=list(range(n))
def find(x):
    while parent[x]!=x: parent[x]=parent[parent[x]]; x=parent[x]
    return x
def union(a,b):
    ra,rb=find(a),find(b)
    if ra!=rb: parent[rb]=ra
pairs=[]
for i in range(n):
    d=np.abs(V[i+1:]-V[i]).mean(axis=(1,2,3)) if i+1<n else np.array([])
    for k,val in enumerate(d):
        if val < 2.0:
            j=i+1+k; pairs.append((ids[i],ids[j],round(float(val),3))); union(i,j)
groups={}
for i in range(n): groups.setdefault(find(i),[]).append(ids[i])
dups=[g for g in groups.values() if len(g)>1]
dups.sort(key=lambda g:-len(g))
print('完全/近乎相同的簇:', len(dups))
for g in dups[:15]: print('  ', g)
json.dump({'pairs':pairs,'clusters':dups}, open(os.path.join(ROOT,'archive','dedupe-strict.json'),'w'), ensure_ascii=False)
print('重复对总数:', len(pairs))