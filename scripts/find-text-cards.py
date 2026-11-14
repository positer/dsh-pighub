import os, json
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
cand=[]
for p in man['pigs']:
    f=p.get('raster') or p['file']
    if not str(f).lower().endswith(RASTER): continue
    try: im=Image.open(os.path.join(ROOT,f)).convert('RGBA')
    except Exception: continue
    a=np.array(im); h,w=a.shape[:2]
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    purple = op & (b > r + 15) & (b > 100)
    # 近白但不透明白（文字底板/白描边）
    white = op & (r>244)&(g>244)&(b>244)
    warm = op & (r > b + 12) & (r > 60)
    score = int(purple.sum()) + int(white.sum()*0.5)
    if score > 1200:
        cand.append((p['id'], int(purple.sum()), int(white.sum()), round(score/(w*h)*100,1), (w,h)))
cand.sort(key=lambda x:-x[3])
print('疑似带文字/幕布的卡:', len(cand))
for c in cand[:15]: print('  ', c)
json.dump([c[0] for c in cand], open(os.path.join(ROOT,'archive','text-cards.json'),'w'), ensure_ascii=False)