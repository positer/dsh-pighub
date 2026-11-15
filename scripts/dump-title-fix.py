import json, os
from collections import Counter
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def ok(t): return isinstance(t,str) and len(t)<=4 and (t.endswith('猪') or t.startswith('猪'))
lines=[]
bad=[p for p in man['pigs'] if not ok(p.get('title',''))]
lines.append('## 仍不合规 %d' % len(bad))
for p in bad: lines.append('%s\t%s' % (p['id'], p.get('title','')))
c=Counter(p.get('title') for p in man['pigs'])
lines.append('')
lines.append('## 重名')
for t,n in c.items():
    if n>1:
        ids=[p['id'] for p in man['pigs'] if p.get('title')==t]
        lines.append('%s x%d  %s' % (t, n, ','.join(ids)))
open(os.path.join(ROOT,'archive','title-fix.txt'),'w',encoding='utf-8').write('\n'.join(lines))
print('written')