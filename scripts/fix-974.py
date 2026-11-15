import os, json, hashlib
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
mp = os.path.join(ROOT,'assets','manifest.json')
man = json.load(open(mp, encoding='utf-8'))
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda: f.read(1<<20), b''): h.update(c)
    return h.hexdigest()
p = next(x for x in man['pigs'] if x['id']=='pighub-974')
fp = os.path.join(ROOT, p['raster'])
p['file']=p['raster']; p['vector']=False
p['bytes']=os.path.getsize(fp); p['sha256']=sha(fp)
p['rasterBytes']=p['bytes']; p['rasterSha']=p['sha256']
from PIL import Image
im=Image.open(fp); p['size']={'width':im.width,'height':im.height}
p['background']={'key':'none','threshold':0,'all':False,'removed':0}
p['note']='补全版（有身体、卷尾、斗鸡眼）；2026-11-15 误被上游半身像覆盖后从 git 还原'
json.dump(man, open(mp,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('974 ->', im.size, p['bytes'])