import json, os
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def load(p):
    im = Image.open(p)
    if getattr(im,'is_animated',False): im.seek(0)
    return im.convert('RGBA')
def bbox_crop(im, src=False):
    a = np.array(im)
    if src:
        rgb = a[:,:,:3].astype(int)
        m = ~((rgb[:,:,0]>245)&(rgb[:,:,1]>245)&(rgb[:,:,2]>245))
    else:
        m = a[:,:,3] > 8
    ys, xs = np.nonzero(m)
    if len(xs)==0: return None, None
    return im.crop((xs.min(), ys.min(), xs.max()+1, ys.max()+1)), m
rows=[]
for pig in man['pigs']:
    name = pig['file'].split('/')[-1]
    op = os.path.join(ROOT,'assets','originals',name)
    cp = os.path.join(ROOT, pig['file'])
    if pig.get('animated') or not os.path.exists(op): continue
    try:
        o = load(op); c = load(cp)
    except Exception: continue
    ar_o = o.width/o.height; ar_c = c.width/c.height
    if abs(ar_o-ar_c)/ar_o <= 0.05: continue   # 只看长宽比不同的
    ob,_ = bbox_crop(o, True); cb,_ = bbox_crop(c)
    if ob is None or cb is None: continue
    S=256
    ob2 = ob.resize((S,S), Image.LANCZOS); cb2 = cb.resize((S,S), Image.LANCZOS)
    oa = np.array(ob2); ca = np.array(cb2)
    om = ~((oa[:,:,0]>245)&(oa[:,:,1]>245)&(oa[:,:,2]>245))
    diff = float(np.abs(oa[:,:,:3].astype(int)-ca[:,:,:3].astype(int)).sum(axis=2)[om].mean())
    rows.append((pig['id'], round(diff,1), '%dx%d' % (o.width,o.height), '%dx%d' % (c.width,c.height)))
rows.sort(key=lambda r:-r[1])
print('aspect_differs 共', len(rows), '张，按平均色差排序（前 15）:')
for r in rows[:15]: print('  ', r[0], 'mean_delta=', r[1], r[2], '->', r[3])
import collections
buckets = collections.Counter('高(>30)' if r[1]>30 else ('中(10-30)' if r[1]>10 else '低(<10)') for r in rows)
print('分布:', dict(buckets))