import os, json, hashlib
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
reverted=0; kept=0
for p in man['pigs']:
    r = p.get('raster')
    if not r or not r.endswith('.png'): continue
    fp = os.path.join(ROOT, r)
    if not os.path.exists(fp): continue
    # 逐像素一致的要求只能靠位图满足：file 指回 PNG，SVG 留在磁盘备用
    p['file'] = r
    p['vector'] = False
    p['bytes'] = os.path.getsize(fp)
    p['sha256'] = sha(fp)
    reverted += 1
man['counts']['vector'] = len([p for p in man['pigs'] if p.get('vector') is True])
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('回退为位图:', reverted, 'counts.vector =', man['counts']['vector'])