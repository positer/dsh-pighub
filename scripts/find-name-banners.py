import os, json
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp')
rows=[]
for p in man['pigs']:
    f=p.get('raster') or p['file']
    if not str(f).lower().endswith(RASTER): continue
    try: im=Image.open(os.path.join(ROOT,f)).convert('RGBA')
    except Exception: continue
    a=np.array(im); h,w=a.shape[:2]
    r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
    op=a[:,:,3]>8
    white = op & (r>244)&(g>244)&(b>244)
    purple = op & (b > r + 15) & (b > 100)
    # 名称横幅特征：底部 1/3 里出现「白底板」或「紫幕布+文字」
    band = slice(int(h*0.66), h)
    wb = float(white[band,:].sum())/float(h*w)
    pb = float(purple[band,:].sum())/float(h*w)
    if wb > 0.03 or pb > 0.06:
        rows.append((p['id'], round(wb*100,1), round(pb*100,1)))
rows.sort(key=lambda x:-(x[1]+x[2]))
print('疑似名称横幅卡:', len(rows))
for x in rows[:18]: print('  ', x)
json.dump([x[0] for x in rows], open(os.path.join(ROOT,'archive','name-banner-cards.json'),'w'), ensure_ascii=False)