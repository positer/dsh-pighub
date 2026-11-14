
import numpy as np
from PIL import Image
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
pen = np.array(Image.open(shots + r"\pen-empty.png").convert("RGB")).astype(np.int32)[0:452, 0:452]
BASE = pen[8, 226]      # 猪圈里、栅栏之上、草框之外的一小块：这就是猪圈底色
print("猪圈底色（y=8,x=226）:", BASE.tolist())
def is_base(px): return np.abs(px - BASE).max() <= 2
rows = {}
for y in (4, 8, 14, 20, 226, 434, 440, 448):
    xs = [x for x in range(452) if not is_base(pen[y, x])]
    rows[y] = (xs[0], xs[-1]) if xs else None
print("每行「不是底色」的 x 范围：", {k: v for k, v in rows.items()})
cols = {}
for x in (4, 8, 14, 20, 226, 434, 440, 448):
    ys = [y for y in range(452) if not is_base(pen[y, x])]
    cols[x] = (ys[0], ys[-1]) if ys else None
print("每列「不是底色」的 y 范围：", {k: v for k, v in cols.items()})
# 草框最外沿：草色的像素范围（草是绿色系：g > r 且 g > b）
g_r = pen[:, :, 1] - pen[:, :, 0]
ys, xs = np.where((g_r > 8) & (pen[:, :, 1] > 90))
print("绿色系像素 bbox: x %d..%d  y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max()))
print("期望（红框）：x %.2f..%.2f  y %.2f..%.2f" % (452*0.0837, 452*0.9147, 452*0.1826, 452*0.9665))
