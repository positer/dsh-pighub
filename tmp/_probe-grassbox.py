
import numpy as np
from PIL import Image
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
a = np.array(Image.open(shots + r"\pen-empty.png").convert("RGB")).astype(np.int32)
pen = a[0:452, 0:452]
print("pen 尺寸", pen.shape)
BASE = pen[2, 2].tolist()
print("猪圈底色（探针页没有 --dsw-alias-bg-base 令牌，落到兜底 #0b0d10）:", BASE)
# 草坪边界：逐行/列找"不是底色"的第一处
def is_base(px): return np.abs(px - np.array(BASE)).max() <= 2
rows = {}
for y in (5, 10, 20, 226, 430, 440, 448):
    xs = [x for x in range(452) if not is_base(pen[y, x])]
    rows[y] = (xs[0], xs[-1], len(xs)) if xs else None
print("每一行内容(非底色)的 x 范围：")
for y, v in rows.items(): print("  y=%3d -> %s" % (y, v))
for x in (2, 10, 20, 226, 430, 448):
    ys = [y for y in range(452) if not is_base(pen[y, x])]
    print("  列 x=%3d -> y %s" % (x, (ys[0], ys[-1], len(ys)) if ys else None))
# 期望：草的红框 8.37%..91.47% x、18.26%..96.65% y
print("期望草坪框 px: x %.2f..%.2f  y %.2f..%.2f" % (452*0.0837, 452*0.9147, 452*0.1826, 452*0.9665))
# 栅栏可见 bbox（alpha>0 的图在 452 下的映射）：只做对照，不参与断言
print("栅栏原图 bbox 在 452 下的映射: x %.2f..%.2f y %.2f..%.2f" % (452*0.0383, 452*0.9617, 452*0.0399, 452*0.9641))
