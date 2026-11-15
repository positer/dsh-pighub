import os, json, hashlib, sys
import numpy as np
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
man = json.load(open(mp, encoding='utf-8'))
changed=[]; missing=[]
for p in man['pigs']:
    f = os.path.join(ROOT, p['file'])
    if not os.path.exists(f):
        missing.append((p['id'], p['file'])); continue
    b = os.path.getsize(f); s = sha(f)
    if b != p.get('bytes') or s != p.get('sha256'):
        changed.append((p['id'], p['file'], b, s[:10])); p['bytes']=b; p['sha256']=s
        # 尺寸若变了同步（只对位图）
        if p['file'].lower().endswith(('.png','.jpg','.jpeg','.webp')):
            im=Image.open(f); p['size']={'width':im.width,'height':im.height}
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('已同步:', len(changed), '条'); 
for c in changed[:20]: print('  ', c)
print('缺文件:', missing)