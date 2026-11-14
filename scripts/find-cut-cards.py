import json, os
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
cut=[]
for p in man['pigs']:
    if p.get('animated') or not p['file'].lower().endswith(RASTER): continue
    try:
        im=Image.open(os.path.join(ROOT,p['file'])).convert('RGBA')
    except Exception: continue
    m=np.array(im)[:,:,3]>8
    h,w=m.shape
    bottom = m[h-1,:].sum()
    top = m[0,:].sum()
    left = m[:,0].sum()
    right = m[:,w-1].sum()
    if bottom > 2 or left > 2 or right > 2 or top > 2:
        cut.append((p['id'], int(bottom), int(top), int(left), int(right), im.size))
print('边缘被裁的卡:', len(cut))
for c in cut[:20]: print('  ', c)
json.dump([c[0] for c in cut], open(os.path.join(ROOT,'archive','cut-cards.json'),'w'), ensure_ascii=False)