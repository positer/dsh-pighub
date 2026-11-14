
import numpy as np
from PIL import Image
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
pen = np.array(Image.open(shots + r"\pen-empty.png").convert("RGB")).astype(np.int32)[0:452, 0:452]
stage = pen[1, 1]
print("页面底色（stage，探针页是 #f5f6f7）:", stage.tolist())
# 采样：四角 + 围栏外圈（栅栏 bbox x 17..435 / y 18..436 的四条外带）
probes = {
  "左上角 (4,4)": pen[4, 4], "右上角 (448,4)": pen[4, 448], "左下角 (4,448)": pen[448, 4], "右下角 (448,448)": pen[448, 448],
  "上带 (226,6)": pen[6, 226], "下带 (226,446)": pen[446, 226],
  "左带 (6,226)": pen[226, 6], "右带 (446,226)": pen[226, 446],
}
ok = True
for k, v in probes.items():
    same = bool(np.abs(v - stage).max() <= 1)
    ok = ok and same
    print("  %-14s RGB=%s  与页面底色一致=%s" % (k, v.tolist(), same))
print("四角与围栏外圈是否全部等于页面底色:", ok)
# 也确认围栏内部的透明区（草框之外、围栏之内）是否露出底色：取内圈上方、草框之外的窄带
inner_strip = pen[70:80, 226]
print("内圈上方、草框外窄带的中位色:", np.median(inner_strip, axis=0).tolist())
# 颜色种类：整张图里有多少种"非底色且非草非木"的填充？先看外带是否只有底色
