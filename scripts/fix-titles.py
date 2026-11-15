import json, os
from collections import Counter
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
FIX = {'pighub-372':'猪拳','pighub-590':'猪历','pighub-658':'拔萝卜猪','pighub-217':'无语猪','pighub-423':'学习猪','pighub-479':'乐乐猪','pighub-182':'包子猪','pighub-38':'沉思猪','pighub-563':'红苹果猪','pighub-902':'王者猪','pighub-933':'星球猪','pighub-65':'幽猪'}
for p in man['pigs']:
    if p['id'] in FIX: p['title'] = FIX[p['id']]
def ok(t): return isinstance(t,str) and len(t)<=4 and (t.endswith('猪') or t.startswith('猪'))
bad=[p['id'] for p in man['pigs'] if not ok(p.get('title',''))]
c=Counter(p.get('title') for p in man['pigs'])
dup=[t for t,n in c.items() if n>1]
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('bad', len(bad), bad, 'dups', len(dup), dup)