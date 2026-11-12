
import hashlib
from PIL import Image
import numpy as np
p = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
b = open(p,'rb').read()
print("bytes", len(b), "sha256", hashlib.sha256(b).hexdigest()[:16])
im = Image.open(p)
print("format", im.format, "mode", im.mode, "size", im.size, "info", {k:(v if len(str(v))<40 else "...") for k,v in im.info.items()})
im = im.convert("RGB")
a = np.array(im)
H,W,_ = a.shape
print("shape", a.shape)
for name, sl in [("top",a[0,:,:]),("bottom",a[-1,:,:]),("left",a[:,0,:]),("right",a[:,-1,:])]:
    col, cnt = np.unique(sl.reshape(-1,3), axis=0, return_counts=True)
    order = np.argsort(-cnt)[:3]
    print(name, [(tuple(int(x) for x in col[i]), int(cnt[i])) for i in order])
col, cnt = np.unique(a.reshape(-1,3), axis=0, return_counts=True)
order = np.argsort(-cnt)[:10]
print("TOP COLORS:")
for i in order:
    print("  ", tuple(int(x) for x in col[i]), int(cnt[i]), round(100.0*cnt[i]/(H*W),3))
print("total px", H*W)
