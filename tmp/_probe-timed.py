
import numpy as np
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp"
imgs = [np.array(Image.open(base + r"\timed%d.png" % i).convert("RGB")).astype(np.int32) for i in (1,2,3)]
ox, oy, s = 606, 119, 893
pen = [im[oy:oy+s, ox:ox+s] for im in imgs]
print("猪圈区域尺寸:", pen[0].shape)
# 内圈（栅栏内）: x 13.40..86.60% y 19.70..81.74%
ix0, ix1 = int(0.1340*s), int(0.8660*s); iy0, iy1 = int(0.1970*s), int(0.8174*s)
inner = [p[iy0:iy1, ix0:ix1] for p in pen]
outer = []
for p in pen:
    m = np.ones((s, s), bool); m[iy0:iy1, ix0:ix1] = False
    outer.append(p[m])
for i in (1,2):
    d_in = np.abs(inner[0] - inner[i]).max(axis=2)
    d_out = np.abs(outer[0] - outer[i]).max(axis=1)
    print("第1帧 vs 第%d帧：内圈(草+猪) 变化像素 %d (最大差 %d) | 围栏带 变化像素 %d (最大差 %d)"
          % (i+1, int((d_in>2).sum()), int(d_in.max()), int((d_out>2).sum()), int(d_out.max())))
