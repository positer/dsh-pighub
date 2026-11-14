
import os, re, json
BASE = os.path.abspath('.')
DROP = ['pighub-1124','pighub-249','pighub-266','pighub-680','pighub-829','pighub-830','pighub-836','pighub-981',
        'pighub-192','pighub-300','pighub-1095','pighub-993','pighub-1199','pighub-1181','pighub-1183',
        'pighub-1305','pighub-40','pighub-814','pighub-975','pighub-201']
pat = re.compile(r'pighub-(\d+)')
targets = []
for root, dirs, files in os.walk(BASE):
    dirs[:] = [d for d in dirs if d not in ('node_modules','.git','__pycache__','archive','tmp-vectorize','tmp')]
    for fn in files:
        if fn.endswith(('.md','.mjs','.js','.json','.py','.yml','.yaml')):
            p = os.path.join(root, fn)
            if os.path.getsize(p) > 4_000_000: continue
            targets.append(p)
hits = {}
for p in targets:
    try: txt = open(p, encoding='utf-8', errors='replace').read()
    except Exception: continue
    for m in pat.finditer(txt):
        if 'pighub-' + m.group(1) in DROP:
            hits.setdefault(os.path.relpath(p, BASE), set()).add('pighub-'+m.group(1))
print('扫描文件数:', len(targets))
if not hits:
    print('没有引用被删卡的文件')
for f, ids in sorted(hits.items()):
    print(' ', f, '->', sorted(ids))
