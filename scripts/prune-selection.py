import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
DROP = {'pighub-1124','pighub-249','pighub-266','pighub-680','pighub-829','pighub-830','pighub-836','pighub-981',
        'pighub-192','pighub-300','pighub-1095','pighub-993','pighub-1199','pighub-1181','pighub-1183',
        'pighub-1305','pighub-40','pighub-814','pighub-975','pighub-201'}
for rel in ('assets/cards/selection.json','assets/judgements.json'):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p): continue
    j = json.load(open(p, encoding='utf-8'))
    key = 'cards' if 'cards' in j else ('judgements' if 'judgements' in j else None)
    if not key: continue
    before = len(j[key])
    j[key] = [x for x in j[key] if x.get('id') not in DROP]
    json.dump(j, open(p,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
    print(rel, before, '->', len(j[key]))