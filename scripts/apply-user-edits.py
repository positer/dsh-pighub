import os, json, hashlib, subprocess
from PIL import Image
import vtracer
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
IMG = os.path.join(ROOT,'assets','img')
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
def vec(png, svg):
    vtracer.convert_image_to_svg_py(png, svg, colormode='color', hierarchical='stacked', mode='spline',
                                    filter_speckle=8, color_precision=6, corner_threshold=60, path_precision=2)
for pid in ['pighub-12','pighub-209','pighub-271','pighub-473','pighub-1087','pighub-1198','pighub-341']:
    png=os.path.join(IMG,pid+'.png'); svg=os.path.join(IMG,pid+'.svg')
    if os.path.exists(png): vec(png,svg); print('vec',pid)
if not any(p['id']=='pighub-219' for p in man['pigs']):
    raw = subprocess.check_output(['git','show','HEAD:assets/manifest.json'], cwd=ROOT)
    hist = json.loads(raw.decode('utf-8'))
    old = next((p for p in hist['pigs'] if p['id']=='pighub-219'), None)
    png=os.path.join(IMG,'pighub-219.png'); svg=os.path.join(IMG,'pighub-219.svg')
    if old and os.path.exists(png):
        vec(png,svg)
        im=Image.open(png)
        newp=dict(old); newp.update({'file':'assets/img/pighub-219.svg','raster':'assets/img/pighub-219.png',
            'vector':True,'bytes':os.path.getsize(svg),'sha256':sha(svg),
            'size':{'width':im.width,'height':im.height},'note':'用户 2026-11-14 手调后重新入库'})
        man['pigs'].append(newp); print('re-added 219')
for p in man['pigs']:
    f=os.path.join(ROOT,p['file'])
    if os.path.exists(f): p['bytes']=os.path.getsize(f); p['sha256']=sha(f)
    r=p.get('raster')
    if r and os.path.exists(os.path.join(ROOT,r)):
        p['rasterBytes']=os.path.getsize(os.path.join(ROOT,r)); p['rasterSha']=sha(os.path.join(ROOT,r))
man['counts']={'total':len(man['pigs']),
 'live':len([p for p in man['pigs'] if p.get('kind')=='live']),
 'dead':len([p for p in man['pigs'] if p.get('kind')=='dead']),
 'vector':len([p for p in man['pigs'] if p.get('vector') is True]),
 'adopted':len([p for p in man['pigs'] if p.get('adopted') is True])}
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('pigs', len(man['pigs']), man['counts'])