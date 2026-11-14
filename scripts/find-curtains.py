import json, os
import numpy as np
from PIL import Image, ImageDraw
from collections import deque
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
def curtain_score(a):
    if a.shape[2] < 4: return 0
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    purple = op & (b > r + 15) & (b > 100)
    return int(purple.sum())
cand=[]
for p in man['pigs']:
    if p.get('animated') or not p['file'].lower().endswith(RASTER): continue
    try:
        im=Image.open(os.path.join(ROOT,p['file'])).convert('RGBA')
    except Exception: continue
    s=curtain_score(np.array(im))
    if s>1500: cand.append((p['id'], s, p['file']))
cand.sort(key=lambda x:-x[1])
print('有幕布的卡:', len(cand))
print(cand[:12])
json.dump([c[0] for c in cand], open(os.path.join(ROOT,'archive','curtain-cards.json'),'w'), ensure_ascii=False)