
import numpy as np
from PIL import Image
p = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png"
a = np.array(Image.open(p).convert("RGB")).astype(np.int32)
sub = a[60:1080, 500:1620]
# 以「围栏之外、猪圈之内」的一个点作为参照色，放大与它的差
ref = sub[500-60, 560-500]   # (560,500) 附近是猪圈内、围栏外
print("参照色:", ref.tolist())
d = np.abs(sub - ref).max(axis=2)
amp = np.clip(d * 10, 0, 255).astype(np.uint8)
Image.fromarray(amp).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_pen-amp.png")
print("amplified (x10) saved; pixels differing from ref:", int((d>0).sum()), "of", d.size)
# 猪圈方框（由草地反推）：x 549..1548 y 67..1020
print("猪圈方框内、围栏外的四个粗采样区（各 20x20 的中位色）:")
regions = {
 "左上 (560..580, 80..100)": (560,580,80,100),
 "右上 (1510..1530, 80..100)": (1510,1530,80,100),
 "左下 (560..580, 990..1010)": (560,580,990,1010),
 "右下 (1510..1530, 990..1010)": (1510,1530,990,1010),
 "左中 (555..575, 520..540)": (555,575,520,540),
 "右中 (1525..1545, 520..540)": (1525,1545,520,540),
}
for k,(x0,x1,y0,y1) in regions.items():
    block = a[y0:y1, x0:x1].reshape(-1,3)
    print("  %-26s 中位色=%s" % (k, np.median(block, axis=0).astype(int).tolist()))
print("页面底（猪圈左侧同高、距猪圈 40px 外） (505..525, 520..540):", np.median(a[520:540,505:525].reshape(-1,3),axis=0).astype(int).tolist())
print("页面底（猪圈上方 30px 外） (800..820, 30..50):", np.median(a[30:50,800:820].reshape(-1,3),axis=0).astype(int).tolist())
