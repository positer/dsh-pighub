import json, os
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
def dhash(im, n=8):
    g = im.convert('L').resize((n+1,n), Image.LANCZOS)
    a = np.array(g, dtype=int)
    bits = (a[:,1:] > a[:,:-1]).flatten()
    return bits
def ahash(im, n=8):
    g = im.convert('L').resize((n,n), Image.LANCZOS)
    a = np.array(g, dtype=float); m = a.mean()
    return (a > m).flatten()
items=[]
for p in man['pigs']:
    if not p['file'].lower().endswith(RASTER): continue
    try:
        im=Image.open(os.path.join(ROOT,p['file']))
        if getattr(im,'is_animated',False): im.seek(0)
        im=im.convert('RGBA')
    except Exception: continue
    # 用不透明区域裁切后再算哈希，减少留白差异
    a=np.array(im); m=a[:,:,3]>8
    ys,xs=np.nonzero(m)
    if len(xs)==0: continue
    im2=im.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
    items.append((p['id'], dhash(im2), ahash(im2), im2.size))
print('参与去重的卡:', len(items))
pairs=[]
for i in range(len(items)):
    for j in range(i+1,len(items)):
        d = int((items[i][1]^items[j][1]).sum())
        a = int((items[i][2]^items[j][2]).sum())
        if d<=12 and a<=12:
            pairs.append((items[i][0], items[j][0], d, a))
pairs.sort(key=lambda x:(x[2]+x[3]))
print('近似对:', len(pairs))
for q in pairs[:25]: print('  ', q)
json.dump(pairs, open(os.path.join(ROOT,'archive','dedupe-pairs.json'),'w'), ensure_ascii=False)