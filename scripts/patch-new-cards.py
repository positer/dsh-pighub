import json, os, hashlib
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
for p in man['pigs']:
    if p['id'].startswith('pighub-27-'):
        png = os.path.join(ROOT, p['raster'])
        p['source'] = {'url': 'local://user-edited', 'group': 'user-edited', 'sha256': sha(png)}
        p['background'] = {'key':'none','threshold':0,'all':False,'removed':0}
        p['completion'] = {'mode':'user-edit','at':'2026-11-14','note':'用户手调后新增'}
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('patched', [p['id'] for p in man['pigs'] if p['id'].startswith('pighub-27-')])