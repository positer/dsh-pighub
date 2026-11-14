
import numpy as np, collections
from PIL import Image
src = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
a = np.array(Image.open(src).convert("RGBA")).astype(np.int32)
r,g,b,al = a[...,0],a[...,1],a[...,2],a[...,3]
# 目标红 ≈ (213,74,50)：找近邻
target = np.array([213,74,50])
d = np.abs(a[...,:3]-target).sum(axis=2)
sel = d <= 30
print("近 (213,74,50) 的像素:", int(sel.sum()))
print("其中 alpha 分布:", collections.Counter(al[sel].tolist()).most_common(10))
ys,xs = np.where(sel)
print("bbox x", xs.min(), xs.max(), "y", ys.min(), ys.max())
# 中线扫描
mid = 627
row = [x for x in range(1254) if sel[mid,x]]
col = [y for y in range(1254) if sel[y,mid]]
print("中线那一行 y=%d 的红像素 x:" % mid, row[:20], "...", row[-5:] if row else None, "count", len(row))
print("中线那一列 x=%d 的红像素 y:" % mid, col[:20], "...", col[-5:] if col else None, "count", len(col))
# 只看 alpha>=100 的
sel2 = sel & (al>=100)
print("近红 & alpha>=100:", int(sel2.sum()))
if sel2.sum():
    ys2,xs2=np.where(sel2); print(" bbox", xs2.min(), xs2.max(), ys2.min(), ys2.max())
# 行/列统计：哪一行整行出现
cnt_row = sel.sum(axis=1); cnt_col = sel.sum(axis=0)
print("最长的红行:", [(int(y), int(cnt_row[y])) for y in np.argsort(cnt_row)[-6:]])
print("最长的红列:", [(int(x), int(cnt_col[x])) for x in np.argsort(cnt_col)[-6:]])
