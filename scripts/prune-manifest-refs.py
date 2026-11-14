import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
ids = {p['id'] for p in man['pigs']}
dropped = []
for key in ('moodGate','moodRejected','rejected','excluded'):
    v = man.get(key)
    if isinstance(v, list):
        kept = []
        for item in v:
            ident = item.get('id') if isinstance(item, dict) else item
            if isinstance(ident, str) and ident not in ids and ident.startswith('pighub-'):
                dropped.append((key, ident)); continue
            kept.append(item)
        man[key] = kept
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('pruned refs:', dropped)