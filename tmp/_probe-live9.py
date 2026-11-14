
import numpy as np
from PIL import Image
panel = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk-open.png").convert("RGB")).astype(np.int32)
chat  = np.array(Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk1.png").convert("RGB")).astype(np.int32)
# 猪圈方框：由围栏可见内容的水平跨度（x 640..1465）反推，s=893，左上角 (606,119)
ox, oy, s = 606, 119, 893
def med(img, cx, cy, n=4):
    return np.median(img[cy-n:cy+n+1, cx-n:cx+n+1].reshape(-1,3), axis=0).astype(int).tolist()
print("猪圈方框: x %d..%d y %d..%d (边长 %d, DPR %.2f)" % (ox, ox+s, oy, oy+s, s, s/451))
pts = {
 "左边中(围栏外)": (ox+8, oy+s//2), "右边中(围栏外)": (ox+s-8, oy+s//2),
 "上边中(围栏外)": (ox+s//2, oy+8), "下边中(围栏外)": (ox+s//2, oy+s-8),
 "左上角": (ox+6, oy+20), "右下角": (ox+s-6, oy+s-12),
}
print("%-16s %-16s %-16s %-16s %s" % ("位置", "面板视图(插件开着)", "方框外(同一面板)", "对话视图(插件不在)", "两视图相同"))
ok = True
for name, (x, y) in pts.items():
    vi = med(panel, x, y)
    dx = -12 if x < ox + s/2 else 12
    dy = -12 if y < oy + s/2 else 12
    vo = med(panel, x+dx, y+dy)
    vc = med(chat, x, y)
    same = bool(np.abs(np.array(vi)-np.array(vc)).max() <= 2)
    ok = ok and same
    print("%-16s %-16s %-16s %-16s %s" % (name, vi, vo, vc, same))
print("猪圈外圈像素 == 插件不在时的同一位置（宿主底色）:", ok)
print("窗口底（侧栏）(300,1250):", med(panel,300,1250))
print("面板卡片上、猪圈左侧 (585,600):", med(panel,585,600))
