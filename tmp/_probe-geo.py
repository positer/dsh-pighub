
from PIL import Image
import numpy as np
src = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
a = np.array(Image.open(src).convert("RGBA")).astype(np.int16)
al = a[...,3]
m = al > 8           # ignore the alpha<=6 fringe
H,W = m.shape
print("opaque(>8) bbox:", )
ys,xs = np.where(m); print("x", xs.min(), xs.max(), "y", ys.min(), ys.max(), "count", m.sum())

# Top fence: bottom contour over central columns (exclude corner grass/stones region x<200 or x>1054)
def bottom_of_top(x0,x1,ytop=0,ybot=520):
    res=[]
    for x in range(x0,x1):
        col = np.where(m[ytop:ybot, x])[0]
        res.append(col.max()+ytop if col.size else -1)
    return np.array(res)
b = bottom_of_top(220,1030)
print("top-fence bottom contour: min %d p10 %d median %d p90 %d max %d" % (b.min(), np.percentile(b,10), np.median(b), np.percentile(b,90), b.max()))

def top_of_bottom(x0,x1):
    res=[]
    for x in range(x0,x1):
        col = np.where(m[740:1254, x])[0]
        res.append(col.min()+740 if col.size else -1)
    return np.array(res)
t = top_of_bottom(220,1030)
print("bottom-fence top contour: min %d p10 %d median %d p90 %d max %d" % (t.min(), np.percentile(t,10), np.median(t), np.percentile(t,90), t.max()))

# right edge of left fence / left edge of right fence, sampled on middle rows
def right_of_left(y0,y1):
    res=[]
    for y in range(y0,y1):
        row = np.where(m[y, 0:520])[0]
        res.append(row.max() if row.size else -1)
    return np.array(res)
def left_of_right(y0,y1):
    res=[]
    for y in range(y0,y1):
        row = np.where(m[y, 740:1254])[0]
        res.append(row.min()+740 if row.size else -1)
    return np.array(res)
rl = right_of_left(320, 940); lr = left_of_right(320, 940)
print("left-fence inner right edge: min %d med %d max %d" % (rl.min(), np.median(rl), rl.max()))
print("right-fence inner left edge: min %d med %d max %d" % (lr.min(), np.median(lr), lr.max()))

# rows where the side fence exists: count opaque per row in left strip
strip = m[:, 60:180].sum(axis=1)
rows = np.where(strip>20)[0]
print("left strip extent rows:", rows.min(), rows.max())
strip2 = m[:, 1080:1200].sum(axis=1); rows2=np.where(strip2>20)[0]
print("right strip extent rows:", rows2.min(), rows2.max())
# top fence rows extent in central strip
st = m[:, 400:900].sum(axis=1); rr = np.where(st>20)[0]
print("central strip extents rows:", rr.min(), rr.max())
# find gaps in central strip
dd = np.diff(rr); print("gaps>1:", [(int(rr[i]), int(rr[i+1])) for i in np.where(dd>1)[0]][:10])
