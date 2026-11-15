import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def ok(t):
    if not isinstance(t,str): return False
    if len(t) > 4: return False
    return t.endswith('猪') or t.startswith('猪')
bad=[p for p in man['pigs'] if not ok(p.get('title',''))]
print('总数', len(man['pigs']), '不合规', len(bad))
for p in bad[:40]: print(' ', p['id'], '|', p.get('title'))
json.dump([{'id':p['id'],'title':p.get('title','')} for p in man['pigs']], open(os.path.join(ROOT,'archive','titles.json'),'w'), ensure_ascii=False, indent=1)