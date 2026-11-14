import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
DROP = {'pighub-1124','pighub-249','pighub-266','pighub-680','pighub-829','pighub-830','pighub-836','pighub-981',
        'pighub-192','pighub-300','pighub-1095','pighub-993','pighub-1199','pighub-1181','pighub-1183',
        'pighub-1305','pighub-40','pighub-814','pighub-975','pighub-201'}
before = len(man['pigs'])
removed = [(p['id'], p['file']) for p in man['pigs'] if p['id'] in DROP]
man['pigs'] = [p for p in man['pigs'] if p['id'] not in DROP]
if isinstance(man.get('counts'), dict):
    man['counts']['pigs'] = len(man['pigs'])
# 只从「必须在池里」的 moodGate 里剔掉被删的；moodRejected / excluded 是历史记录，不动
if isinstance(man.get('moodGate'), list):
    man['moodGate'] = [x for x in man['moodGate'] if (x.get('id') if isinstance(x,dict) else x) not in DROP]
for pid, f in removed:
    fp = os.path.join(ROOT, f)
    if os.path.exists(fp): os.remove(fp)
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('before', before, 'after', len(man['pigs']), 'removed', len(removed))