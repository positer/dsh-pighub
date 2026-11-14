
import numpy as np
from PIL import Image
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
pen = np.array(Image.open(shots + r"\pen-meadow.png").convert("RGB")).astype(np.int32)[0:452, 0:452]
g_r = pen[:, :, 1] - pen[:, :, 0]
ys, xs = np.where((g_r > 6) & (pen[:, :, 1] > 90))
print("草地层绿色 bbox: x %d..%d  y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max()))
print("换算成百分比: x %.2f%%..%.2f%%  y %.2f%%..%.2f%%" % (
    (xs.min()) / 452 * 100, (xs.max() + 1) / 452 * 100, (ys.min()) / 452 * 100, (ys.max() + 1) / 452 * 100))
print("用户红框: x 8.37%%..91.47%%  y 18.26%%..96.65%%")
