import json, os, sys, hashlib, urllib.request
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
ids = sys.argv[1:]
report = []
for pid in ids:
    pig = next(p for p in man['pigs'] if p['id']==pid)
    if pig.get('animated'):
        report.append((pid,'SKIP animated')); continue
    p = os.path.join(ROOT, pig['file'])
    req = urllib.request.Request(pig['source']['url'], headers={'User-Agent':'dsh-pighub/rework'})
    raw = urllib.request.urlopen(req, timeout=40).read()
    tmp = p + '.up'
    open(tmp,'wb').write(raw)
    im = Image.open(tmp).convert('RGBA')
    a = np.array(im)
    had_alpha = bool((a[:,:,3] < 250).any())
    if not had_alpha:
        rgb = a[:,:,:3].astype(int)
        pure = (rgb[:,:,0]>=252)&(rgb[:,:,1]>=252)&(rgb[:,:,2]>=252)
        a[:,:,3] = np.where(pure, 0, a[:,:,3])
        removed = int(pure.sum())
    else:
        removed = 0
    im = Image.fromarray(a,'RGBA')
    im.save(p)
    os.remove(tmp)
    pig['bytes'] = os.path.getsize(p)
    pig['sha256'] = sha(p)
    pig['size'] = {'width': im.width, 'height': im.height}
    pig['background'] = {'key': 'none' if had_alpha else 'near-white', 'threshold': 252 if not had_alpha else 0, 'all': False, 'removed': removed}
    pig['completion'] = {'mode':'original-as-is','at':'2026-11-14','note':'按用户口径改为直接使用上游原图（零改动），仅去纯白底；旧补全曾重绘/删改原图内容。'}
    report.append((pid, im.size, pig['bytes'], removed))
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print(report)