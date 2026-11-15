import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
SRC = {'url':'https://pighub.top/images/%E7%8C%AA%E5%BF%98%E4%BA%86.jpg','group':'pighub-online',
       'sha256':'4d1b836bbee0acbbe7ca99dc2497b3a02aeb3e71807705f7a3951196768849b8'}
for p in man['pigs']:
    if p['id'].startswith('pighub-27-'):
        p['source'] = dict(SRC)
        p['title'] = '猪忘了（手调 %s）' % p['id'][-1]
        p['note'] = '来自 pighub-27「猪忘了」的用户手调版本（2026-11-14 拆分并调整）'
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print([ (p['id'], p['title']) for p in man['pigs'] if p['id'].startswith('pighub-27-')])