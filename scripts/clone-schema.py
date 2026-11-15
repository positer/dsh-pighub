import json, os, hashlib
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
tpl = next(p for p in man['pigs'] if p['id']=='pighub-26' ) if any(p['id']=='pighub-26' for p in man['pigs']) else man['pigs'][0]
print('模板卡', tpl['id'], '字段', sorted(tpl.keys()))
for p in man['pigs']:
    if p['id'] in ('pighub-27-1','pighub-27-2'):
        for k,v in tpl.items():
            if k in ('id','title','file','raster','bytes','sha256','size','source','completion','mood','moodReason','note','background'): continue
            p.setdefault(k, v)
        p['file'] = p['file']
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
n = next(p for p in man['pigs'] if p['id']=='pighub-27-1')
print('新卡字段', sorted(n.keys()))
print('species =', n.get('species'), 'kind =', n.get('kind'))