
import numpy as np
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
for name, colour in (("pen-light", [255,255,255]), ("pen-dark", [17,19,21])):
    pen = np.array(Image.open(base + "\\" + name + ".png").convert("RGB")).astype(np.int32)[0:452, 0:452]
    pts = {"左上角(4,4)": pen[4,4], "右上角(448,4)": pen[4,448], "左下角(4,448)": pen[448,4], "右下角(448,448)": pen[448,448],
           "上带(226,6)": pen[6,226], "下带(226,446)": pen[446,226], "左带(6,226)": pen[226,6], "右带(446,226)": pen[226,446]}
    ok = all(bool(np.abs(v - np.array(colour)).max() <= 2) for v in pts.values())
    print("%s（页面底色 %s）：" % (name, colour))
    for k,v in pts.items():
        print("   %-14s %s" % (k, v.tolist()))
    print("   全部等于页面底色:", ok)
