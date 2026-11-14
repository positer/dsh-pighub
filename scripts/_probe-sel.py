
import json, os, re
BASE = os.path.abspath('.')
DROP = {'pighub-1124','pighub-249','pighub-266','pighub-680','pighub-829','pighub-830','pighub-836','pighub-981',
        'pighub-192','pighub-300','pighub-1095','pighub-993','pighub-1199','pighub-1181','pighub-1183',
        'pighub-1305','pighub-40','pighub-814','pighub-975','pighub-201'}

sel = json.load(open(os.path.join(BASE,'assets/cards/selection.json'), encoding='utf-8'))
cards = sel['cards']
print('selection.cards:', len(cards))
ids = [c.get('id') for c in cards]
print('cards whose id in DROP:', len([i for i in ids if i in DROP]))
print('sample ids:', ids[:5])
# 1305 出现在哪
for c in cards:
    if '1305' in json.dumps(c, ensure_ascii=False):
        print('1305 entry:', json.dumps(c, ensure_ascii=False)[:400])
        break
else:
    print('no card contains "1305"')
txt = open(os.path.join(BASE,'assets/cards/selection.json'), encoding='utf-8').read()
print('raw occurrences of pighub-1305:', txt.count('pighub-1305'))
print('note field:', sel.get('note','')[:300])
print()
print('--- judgements.json ---')
j = json.load(open(os.path.join(BASE,'assets/judgements.json'), encoding='utf-8'))
print('keys:', list(j.keys()), 'count:', len(j.get('judgements', [])))
print('judged ids sample:', [x.get('id') for x in j['judgements'][:5]])
print()
print('--- manifest counts ---')
m = json.load(open(os.path.join(BASE,'assets/manifest.json'), encoding='utf-8'))
pigs = m['pigs']
c = {'total': len(pigs),
     'live': len([p for p in pigs if p.get('kind')=='live']),
     'dead': len([p for p in pigs if p.get('kind')=='dead']),
     'vector': len([p for p in pigs if p.get('vector')]),
     'adopted': len([p for p in pigs if p.get('adopted') is True])}
print('correct:', json.dumps(c))
print('current:', json.dumps(m['counts']))
