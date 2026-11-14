import os, json
import numpy as np
from PIL import Image
from collections import deque
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
def clean(im):
    a=np.array(im).copy(); h,w=a.shape[:2]
    op=a[:,:,3]>8
    lab=np.zeros((h,w),np.int32); n=0; sizes=[]; warmfrac=[]
    for y in range(h):
        for x in range(w):
            if op[y,x] and lab[y,x]==0:
                n+=1; q=deque([(y,x)]); lab[y,x]=n; pts=[(y,x)]
                while q:
                    cy,cx=q.popleft()
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx=cy+dy,cx+dx
                        if 0<=ny<h and 0<=nx<w and op[ny,nx] and lab[ny,nx]==0:
                            lab[ny,nx]=n; q.append((ny,nx)); pts.append((ny,nx))
                ys=np.array([p[0] for p in pts]); xs=np.array([p[1] for p in pts])
                col=a[ys,xs,:3].astype(int)
                warm=float(((col[:,0]>col[:,2]+10)&(col[:,0]>60)).mean())
                sizes.append(len(pts)/float(h*w)); warmfrac.append(warm)
    keep=np.zeros((h,w),bool)
    for k in range(1,n+1):
        # 只保留：面积 >8% 画布，或暖色占比 >60%（猪身/道具）
        if sizes[k-1] > 0.08 or warmfrac[k-1] > 0.60:
            keep |= (lab==k)
    a[~keep]=(0,0,0,0)
    ys,xs=np.nonzero(a[:,:,3]>8)
    out=Image.fromarray(a,'RGBA')
    if len(xs): out=out.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
    return out
ids=['pighub-417','pighub-631','pighub-473','pighub-271','pighub-873','pighub-209','pighub-1087','pighub-27']
CELL=250; cols=4
sheet=Image.new('RGBA',(CELL*cols*2, CELL*2),(20,20,24,255))
for i,pid in enumerate(ids):
    p=next(x for x in man['pigs'] if x['id']==pid)
    im=Image.open(os.path.join(ROOT,p.get('raster') or p['file'])).convert('RGBA')
    out=clean(im)
    for j,s in enumerate((im,out)):
        t=s.copy(); t.thumbnail((CELL-14,CELL-14), Image.LANCZOS)
        sheet.alpha_composite(t,(((i%cols)*2+j)*CELL+(CELL-t.width)//2,(i//cols)*CELL+(CELL-t.height)//2))
q=os.path.join(ROOT,'archive','text-clean-v2.png'); sheet.save(q)
print('wrote',q)