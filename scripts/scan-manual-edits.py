import os, json, hashlib
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
changed_png=[]; changed_other=[]; missing=[]
listed=set()
for p in man['pigs']:
    for key in ('file','raster'):
        rel = p.get(key)
        if not rel: continue
        listed.add(os.path.basename(rel))
        f = os.path.join(ROOT, rel)
        if not os.path.exists(f):
            missing.append((p['id'], key, rel)); continue
    f = os.path.join(ROOT, p['file'])
    if os.path.exists(f):
        if os.path.getsize(f) != p.get('bytes') or sha(f) != p.get('sha256'):
            (changed_png if p['file'].lower().endswith('.png') else changed_other).append(p['id'])
# 磁盘上有、清单里没有的图
have=set(os.listdir(os.path.join(ROOT,'assets','img')))
orphan=[n for n in have if n.lower().endswith(('.png','.svg','.gif','.webp','.jpg')) and n not in listed and n not in ('pen-fence.png','house-open.png','house-closed.png','standard-pig.png','house-barn.png')]
print('清单条数', len(man['pigs']))
print('改过的 PNG:', len(changed_png), changed_png[:12])
print('改过的其它(SVG等):', len(changed_other), changed_other[:8])
print('清单里缺文件:', len(missing), missing[:6])
print('磁盘上有但清单无:', len(orphan), orphan[:12])
json.dump({'png':changed_png,'other':changed_other,'missing':missing,'orphan':orphan}, open(os.path.join(ROOT,'archive','manual-diff.json'),'w'), ensure_ascii=False)