
from PIL import Image
import numpy as np
src = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
al = np.array(Image.open(src).convert("RGBA"))[...,3]
empty = al <= 8
H,W = empty.shape

def rle(vals, lo=None):
    out=[]; 
    for i,v in enumerate(vals):
        if out and out[-1][1]==v: out[-1][2]+=1
        else: out.append([i, int(v), 1])
    return [(f"x{a}..{a+c-1}", v) for a,v,c in out]

# top contour: for each column, last opaque row in y<400
top = []
for x in range(W):
    col = np.where(~empty[0:400, x])[0]
    top.append(int(col.max()) if col.size else -1)
print("top contour RLE (x-range, bottom y):")
for r in rle(top): print("  ", r)
# bottom contour: first opaque row in y>850
bot=[]
for x in range(W):
    col = np.where(~empty[860:H, x])[0]
    bot.append(int(col.min()+860) if col.size else -1)
print("bottom contour RLE:")
for r in rle(bot): print("  ", r)
# left contour rows 300..950
lft=[]
for y in range(300,951):
    row = np.where(~empty[y, 0:600])[0]
    lft.append(int(row.max()) if row.size else -1)
print("left contour RLE over y300..950:")
for r in rle(lft): print("  ", r)
rgt=[]
for y in range(300,951):
    row = np.where(~empty[y, 700:W])[0]
    rgt.append(int(row.min()+700) if row.size else -1)
print("right contour RLE over y300..950:")
for r in rle(rgt): print("  ", r)
