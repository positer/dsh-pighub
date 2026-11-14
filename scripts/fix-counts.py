import json, os
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
pigs = man['pigs']
# 严格按 build-assets.mjs 的 5 键 schema 重算，vector 用 p.vector 标志口径
man['counts'] = {
    'total': len(pigs),
    'live': len([p for p in pigs if p.get('kind') == 'live']),
    'dead': len([p for p in pigs if p.get('kind') == 'dead']),
    'vector': len([p for p in pigs if p.get('vector') is True]),
    'adopted': len([p for p in pigs if p.get('adopted') is True]),
}
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('counts:', man['counts'])