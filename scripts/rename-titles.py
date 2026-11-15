import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
MAP = {'pig-1361':'猪知道吗','pighub-1003':'求知猪','pighub-1005':'碗里猪','pighub-1020':'其实猪','pighub-1096':'名言猪','pighub-1103':'竹猪','pighub-1135':'写实猪','pighub-1172':'下面猪','pighub-1182':'指令猪','pighub-1191':'猪咪咪','pighub-1198':'澄闪猪','pighub-12':'只是猪','pighub-1201':'猪绷了','pighub-1213':'猪乐','pighub-1226':'爱心猪','pighub-1236':'伤心猪','pighub-1243':'雨天猪','pighub-1252':'碧蓝猪','pighub-1279':'猪包','pighub-1318':'思维猪','pighub-138':'天猪','pighub-2':'奶茶猪','pighub-209':'猪思考','pighub-29':'翻身猪','pighub-296':'闪电猪','pighub-337':'求猪','pighub-372':'升猪拳','pighub-376':'着迷猪','pighub-439':'逃课猪','pighub-469':'应援猪','pighub-556':'猪碧','pighub-563':'苹果猪','pighub-583':'猪味','pighub-589':'安安猪','pighub-590':'老猪历','pighub-61':'吨位猪','pighub-631':'幽灵猪','pighub-658':'萝卜猪','pighub-675':'魔法猪','pighub-676':'望月猪','pighub-710':'呆呆猪','pighub-723':'云朵猪','pighub-727':'棉花猪','pighub-744':'赛亚猪','pighub-768':'停车猪','pighub-772':'歪倒猪','pighub-791':'城堡猪','pighub-792':'软垫猪','pighub-794':'藤椒猪','pighub-812':'倒车猪','pighub-854':'秋千猪','pighub-861':'名猪','pighub-865':'斗眼猪','pighub-874':'机械猪','pighub-879':'气球猪','pighub-880':'拿球猪','pighub-902':'猪王','pighub-906':'咕咕猪','pighub-933':'地球猪','pighub-936':'木马猪','pighub-948':'麋鹿猪','pighub-953':'面包猪','pighub-955':'葡萄猪','pighub-989':'流汗猪','pighub-27-1':'忘猪','pighub-27-2':'猪忘了'}
n=0
for p in man['pigs']:
    if p['id'] in MAP: p['title']=MAP[p['id']]; n+=1
def ok(t): return isinstance(t,str) and len(t)<=4 and (t.endswith('猪') or t.startswith('猪'))
bad=[p for p in man['pigs'] if not ok(p.get('title',''))]
from collections import Counter
dup=[t for t,c in Counter(p.get('title') for p in man['pigs']).items() if c>1]
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('renamed', n, 'still_bad', len(bad), 'dups', dup)