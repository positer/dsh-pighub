import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
ids = ['pighub-27-1','pighub-27-2']
j = json.load(open(os.path.join(ROOT,'assets','judgements.json'), encoding='utf-8'))
have = {x.get('id') for x in j['judgements']}
for i in ids:
    if i in have: continue
    j['judgements'].append({'id': i, 'mood': 'cute', 'moodReason': '用户手调后的猪，造型正常、无血腥怪异元素'})
json.dump(j, open(os.path.join(ROOT,'assets','judgements.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
s = json.load(open(os.path.join(ROOT,'assets','cards','selection.json'), encoding='utf-8'))
have2 = {x.get('id') for x in s['cards']}
for i in ids:
    if i in have2: continue
    s['cards'].append({'id': i, 'mood': 'cute', 'moodReason': '用户手调后的猪，造型正常、无血腥怪异元素'})
json.dump(s, open(os.path.join(ROOT,'assets','cards','selection.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('judgements', len(j['judgements']), 'selection', len(s['cards']))