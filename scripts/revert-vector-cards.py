import json, os, hashlib
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
REVERT = ['pighub-879','pighub-880','pighub-1112','pighub-138']
done=[]
for pid in REVERT:
    p = next(x for x in man['pigs'] if x['id']==pid)
    raster = p.get('raster') or p['file'].replace('.svg','.png')
    fp = os.path.join(ROOT, raster)
    if not os.path.exists(fp):
        done.append((pid,'no_png')); continue
    p['file'] = raster
    p['raster'] = raster
    p['vector'] = False
    p['bytes'] = os.path.getsize(fp)
    p['sha256'] = sha(fp)
    done.append((pid,'reverted',p['bytes']))
man['counts']['vector'] = len([x for x in man['pigs'] if x.get('vector') is True])
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print(done); print('counts.vector =', man['counts']['vector'])