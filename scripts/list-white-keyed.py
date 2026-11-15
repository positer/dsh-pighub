import os, json
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
rows=[]
for p in man['pigs']:
    bg = p.get('background') or {}
    key = bg.get('key')
    if key in ('white','near-white','light'):
        rows.append((p['id'], key, bg.get('threshold'), bg.get('removed')))
print('白色键控的卡:', len(rows))
for r in rows[:20]: print(' ', r)