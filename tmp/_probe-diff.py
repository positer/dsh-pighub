
import numpy as np
from PIL import Image
OUT = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\work\pen-fence"
alpha = np.array(Image.open(OUT + r"\fence-alpha.png").convert("RGBA")).astype(np.int32)
back = np.array(Image.open(OUT + r"\back.png").convert("RGBA")).astype(np.int32)
front = np.array(Image.open(OUT + r"\front.png").convert("RGBA")).astype(np.int32)
b = back/255.0; f = front/255.0
ab, af = b[...,3:4], f[...,3:4]
out_a = ab + af*(1-ab)
out_p = f[...,:3]*af + (b[...,:3]*ab)*(1.0-af)
out_rgb = np.where(out_a>0, out_p/np.maximum(out_a,1e-12), 0.0)
st = np.concatenate([out_rgb, out_a], axis=2)
st = np.rint(st*255.0).astype(np.int32)
d = np.abs(st - alpha); md = d.max(axis=2)
ys,xs = np.where(md>0)
print("diff px", len(xs), "max", int(md.max()))
for k in range(min(8, len(xs))):
    y,x = ys[k], xs[k]
    print("at", y, x, "orig", alpha[y,x], "back", back[y,x], "front", front[y,x], "stacked", st[y,x])
import collections
print("alpha values of diff px:", collections.Counter(alpha[ys,xs,3].tolist()).most_common(8))
print("orig RGB of diff px sample:", collections.Counter([tuple(v) for v in alpha[ys,xs,:3][:2000]]).most_common(5))
