import os, json, hashlib
import numpy as np
from PIL import Image
import vtracer
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
IMG = os.path.join(ROOT,'assets','img')
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
DROP = {'pighub-219','pighub-27','pighub-417','pighub-751'}
old27 = next((p for p in man['pigs'] if p['id']=='pighub-27'), None)
print('旧 27 的 title =', (old27 or {}).get('title'))
man['pigs'] = [p for p in man['pigs'] if p['id'] not in DROP]
# 新卡：27-1 / 27-2
NEW = [('pighub-27-1','pighub-27-1.png'), ('pighub-27-2','pighub-27-2.png')]
base27 = old27 or {}
for nid, png in NEW:
    fp = os.path.join(IMG, png)
    im = Image.open(fp).convert('RGBA')
    svg = png.replace('.png','.svg')
    sp = os.path.join(IMG, svg)
    vtracer.convert_image_to_svg_py(fp, sp, colormode='color', hierarchical='stacked', mode='spline',
                                    filter_speckle=8, color_precision=6, corner_threshold=60, path_precision=2)
    man['pigs'].append({
        'id': nid, 'title': (base27.get('title') or '猪') + '（手调）',
        'kind': base27.get('kind','live'), 'note': '用户 2026-11-14 手调后新增',
        'vector': True, 'animated': False,
        'file': 'assets/img/' + svg, 'raster': 'assets/img/' + png,
        'bytes': os.path.getsize(sp), 'sha256': sha(sp),
        'size': {'width': im.width, 'height': im.height},
        'sizeRatio': base27.get('sizeRatio', 100), 'mood': 'cute', 'moodReason': '用户手调后入库',
    })
# 清理孤儿 SVG（已回退成 PNG 的 4 张）与清单外 426
for n in ('pighub-879.svg','pighub-880.svg','pighub-138.svg','pighub-1112.svg','pighub-426.png'):
    p=os.path.join(IMG,n)
    if os.path.exists(p): os.remove(p); print('removed orphan', n)
man['counts'] = {
  'total': len(man['pigs']),
  'live': len([p for p in man['pigs'] if p.get('kind')=='live']),
  'dead': len([p for p in man['pigs'] if p.get('kind')=='dead']),
  'vector': len([p for p in man['pigs'] if p.get('vector') is True]),
  'adopted': len([p for p in man['pigs'] if p.get('adopted') is True]),
}
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('pigs now', len(man['pigs']), man['counts'])