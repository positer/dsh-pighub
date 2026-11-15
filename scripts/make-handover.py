import os, json, csv
from PIL import Image, ImageDraw
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
pigs = man['pigs']
OUT = os.path.join(ROOT,'archive','asset-handover')
os.makedirs(OUT, exist_ok=True)
# 1) 索引 CSV
rows = []
for i,p in enumerate(pigs):
    rows.append({'序': i+1, 'id': p['id'], 'title': p.get('title',''), 'svg': p['file'], 'png': p.get('raster') or '',
                 'vector': 'yes' if p.get('vector') else 'no', '说明': ''})
with open(os.path.join(OUT,'index.csv'),'w',encoding='utf-8-sig',newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
# 2) 缩略图总表：每张带序号与 id，16 列
CELL=110; cols=16
def sheet(batch, name):
    rr=(len(batch)+cols-1)//cols
    sh=Image.new('RGBA',(CELL*cols,(CELL+14)*rr),(20,20,24,255)); d=ImageDraw.Draw(sh)
    for i,p in enumerate(batch):
        x=(i%cols)*CELL; y=(i//cols)*(CELL+14)
        d.text((x+2,y+1), '%d %s' % (p['n'], p['id'].replace('pighub-','')), fill=(200,200,200,255))
        try: im=Image.open(p['path']).convert('RGBA')
        except Exception: continue
        im.thumbnail((CELL-6,CELL-16), Image.LANCZOS)
        sh.alpha_composite(im,(x+(CELL-im.width)//2, y+14+(CELL-16-im.height)//2))
    q=os.path.join(OUT,name); sh.save(q); return q
items=[]
for i,p in enumerate(pigs):
    items.append({'n':i+1,'id':p['id'],'path':os.path.join(ROOT, p.get('raster') or p['file'])})
made=[sheet(items[i:i+128], 'sheet-%02d.png' % (i//128+1)) for i in range(0,len(items),128)]
print('index.csv +', len(made), '张总表，共', len(items), '张卡')
print(made)