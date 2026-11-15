import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
ids = {p['id'] for p in man['pigs']}
for rel in ('assets/cards/selection.json','assets/judgements.json'):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p): continue
    j = json.load(open(p, encoding='utf-8'))
    key = 'cards' if 'cards' in j else ('judgements' if 'judgements' in j else None)
    if not key: continue
    before = len(j[key])
    j[key] = [x for x in j[key] if x.get('id') in ids]
    json.dump(j, open(p,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
    print(rel, before, '->', len(j[key]))