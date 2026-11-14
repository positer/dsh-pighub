import json, os
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
RASTER=('.png','.jpg','.jpeg','.webp','.gif')
odd=[]
for p in man['pigs']:
    f=p['file']
    if not f.lower().endswith(RASTER):
        odd.append((p['id'],'vector',f)); continue
    try:
        im=Image.open(os.path.join(ROOT,f))
        if getattr(im,'is_animated',False): im.seek(0)
        im=im.convert('RGBA'); a=np.array(im)
    except Exception as e:
        odd.append((p['id'],'read_error',str(e)[:40])); continue
    m=a[:,:,3]>8
    area=int(m.sum()); tot=im.width*im.height
    fill=area/max(1,tot)
    ys,xs=np.nonzero(m)
    if area==0:
        odd.append((p['id'],'empty',f)); continue
    bb=(xs.max()-xs.min()+1, ys.max()-ys.min()+1)
    ar=max(bb)/max(1,min(bb))
    if fill<0.06: odd.append((p['id'],'very_sparse', 'fill=%.3f'%fill))
    elif ar>4.0: odd.append((p['id'],'extreme_aspect','bbox=%dx%d'%bb))
print('可疑卡:', len(odd))
for o in odd: print('  ', o)