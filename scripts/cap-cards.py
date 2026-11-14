import json, os, hashlib
from PIL import Image
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
CAP = 512
ids = ['pighub-12','pighub-873','pighub-209','pighub-271','pighub-473','pighub-341','pighub-417','pighub-1087','pighub-27','pighub-751']
out = []
for pid in ids:
    pig = next(p for p in man['pigs'] if p['id']==pid)
    p = os.path.join(ROOT, pig['file'])
    im = Image.open(p).convert('RGBA')
    if max(im.size) > CAP:
        k = CAP / max(im.size)
        im = im.resize((max(1,int(im.width*k)), max(1,int(im.height*k))), Image.LANCZOS)
        im.save(p)
    pig['bytes'] = os.path.getsize(p); pig['sha256'] = sha(p)
    pig['size'] = {'width': im.width, 'height': im.height}
    out.append((pid, im.size, pig['bytes']))
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print(out)