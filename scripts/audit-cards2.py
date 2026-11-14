import json, os
import numpy as np
from PIL import Image
from collections import Counter
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def load(p):
    im = Image.open(p)
    if getattr(im,'is_animated',False): im.seek(0)
    return im.convert('RGBA')
def mask(a, src=False):
    if src:
        rgb = a[:,:,:3].astype(int)
        return ~((rgb[:,:,0]>245)&(rgb[:,:,1]>245)&(rgb[:,:,2]>245))
    return a[:,:,3] > 8
rows = []
for pig in man['pigs']:
    name = pig['file'].split('/')[-1]
    op = os.path.join(ROOT,'assets','originals',name)
    cp = os.path.join(ROOT, pig['file'])
    if pig.get('animated'):
        rows.append((pig['id'],'animated_skip','-','-',''));continue
    if not os.path.exists(op):
        rows.append((pig['id'],'no_baseline','-','-',''));continue
    try:
        o = load(op); c = load(cp)
    except Exception as e:
        rows.append((pig['id'],'error','-','-',str(e)[:30]));continue
    oa, ca = np.array(o), np.array(c)
    om = mask(oa, True)
    if o.size != c.size:
        ar_o = o.width/o.height; ar_c = c.width/c.height
        if abs(ar_o-ar_c)/ar_o > 0.05:
            rows.append((pig['id'],'aspect_differs','-','-','%dx%d→%dx%d' % (o.width,o.height,c.width,c.height)));continue
        c = c.resize(o.size, Image.LANCZOS)
        ca = np.array(c)
    cm = mask(ca)
    ys, xs = np.nonzero(om)
    orr = oa[ys,xs,:3].astype(int); crr = ca[ys,xs,:3].astype(int)
    diff = int((np.abs(orr-crr).sum(axis=1) > 30).sum())
    ratio = diff/max(1,len(xs))
    verdict = 'ok' if ratio < 0.005 else ('scaled_ok' if ratio < 0.05 else 'CHANGED')
    rows.append((pig['id'], verdict, str(diff), str(int(max(0,int(cm.sum())-int(om.sum())))),
                 '%.3f%% %s' % (ratio*100, 'resized' if o.size!=c.size else 'same')))
with open(os.path.join(ROOT,'archive','card-audit2.tsv'),'w',encoding='utf-8') as f:
    f.write('id\tverdict\tinner_diff\touter_added\tnote\n')
    for r in rows: f.write('\t'.join(str(x) for x in r)+'\n')
print(dict(Counter(r[1] for r in rows)))
for r in rows:
    if r[1]=='CHANGED': print('  CHANGED', r[0], r[2], r[4])