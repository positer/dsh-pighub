import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
for rel, key in (('assets/cards/selection.json','cards'), ('assets/judgements.json','judgements')):
    p = os.path.join(ROOT, rel)
    j = json.load(open(p, encoding='utf-8'))
    n = 0
    for r in j[key]:
        if r.get('id','').startswith('pighub-27-'):
            r['category'] = 'species'; n += 1
    json.dump(j, open(p,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
    print(rel, 'patched', n)