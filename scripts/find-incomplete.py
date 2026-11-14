import json, os
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
rows=[]
for p in man['pigs']:
    if p.get('animated') or not p['file'].lower().endswith(RASTER): continue
    try: im=Image.open(os.path.join(ROOT,p['file'])).convert('RGBA')
    except Exception: continue
    a=np.array(im); h,w=a.shape[:2]
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    # 只统计「猪身/暖色」贴边：幕布是紫色的，不会算进来
    warm = op & (r > b + 12) & (r > 60)
    bot=int(warm[h-1,:].sum()); left=int(warm[:,0].sum()); right=int(warm[:,w-1].sum()); top=int(warm[0,:].sum())
    if max(bot,left,right) > 6:
        rows.append((p['id'], bot, left, right, top, im.size))
rows.sort(key=lambda x:-(x[1]+x[2]+x[3]))
print('猪身贴边（可能被裁）:', len(rows))
for r2 in rows[:15]: print('  ', r2)
json.dump([r2[0] for r2 in rows], open(os.path.join(ROOT,'archive','incomplete-candidates.json'),'w'), ensure_ascii=False)