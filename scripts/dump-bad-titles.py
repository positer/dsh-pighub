import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def ok(t):
    if not isinstance(t,str): return False
    if len(t) > 4: return False
    return t.endswith('猪') or t.startswith('猪')
bad=[p for p in man['pigs'] if not ok(p.get('title',''))]
lines=['# 不合规标题（共 %d 张）' % len(bad),'']
for p in bad:
    lines.append('%s\t%s' % (p['id'], p.get('title','')))
open(os.path.join(ROOT,'archive','bad-titles.txt'),'w',encoding='utf-8').write('\n'.join(lines))
print(len(bad))