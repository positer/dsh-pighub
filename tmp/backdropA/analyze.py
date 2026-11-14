
import os, json, sys
import numpy as np
from PIL import Image
from collections import deque
root = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
ids = """pig-1358, pighub-1000, pighub-1005, pighub-1012, pighub-1018, pighub-1020, pighub-1031, pighub-104, pighub-105, pighub-1055, pighub-1063, pighub-1079, pighub-1087, pighub-1095, pighub-1099, pighub-1106, pighub-1114, pighub-1130, pighub-1135, pighub-1140, pighub-1162, pighub-1181, pighub-1183, pighub-1198, pighub-12, pighub-1208, pighub-1222, pighub-1232, pighub-1243, pighub-1252, pighub-1279, pighub-1305, pighub-1320, pighub-138, pighub-148, pighub-155, pighub-164, pighub-175, pighub-188, pighub-197, pighub-2, pighub-209, pighub-217, pighub-222, pighub-242, pighub-244, pighub-250, pighub-254, pighub-258, pighub-262, pighub-267, pighub-271, pighub-273, pighub-276, pighub-282, pighub-286, pighub-293, pighub-296, pighub-311, pighub-328, pighub-337, pighub-351, pighub-366, pighub-372, pighub-379, pighub-40, pighub-408, pighub-417, pighub-439, pighub-452, pighub-462, pighub-468, pighub-473, pighub-481, pighub-511, pighub-513, pighub-55, pighub-560, pighub-583, pighub-590, pighub-599, pighub-604, pighub-607, pighub-609, pighub-610, pighub-631, pighub-65, pighub-652, pighub-658, pighub-66, pighub-664, pighub-675, pighub-679, pighub-682, pighub-684, pighub-686, pighub-701, pighub-710, pighub-727, pighub-751, pighub-772, pighub-776, pighub-791, pighub-794, pighub-814, pighub-829, pighub-836, pighub-860, pighub-865, pighub-868, pighub-873, pighub-88, pighub-895, pighub-906, pighub-920, pighub-922, pighub-927, pighub-932, pighub-936, pighub-950, pighub-955, pighub-974, pighub-981, pighub-989, pighub-994"""
ids = [s.strip() for s in ids.split(",") if s.strip()]

def comps(mask):
    h,w = mask.shape
    lab = np.full((h,w), -1, np.int32)
    out = []
    cur = 0
    for y in range(h):
        for x in range(w):
            if mask[y,x] and lab[y,x] < 0:
                q = deque([(y,x)]); lab[y,x] = cur; n=0
                y0=y1=y; x0=x1=x
                while q:
                    cy,cx = q.popleft(); n+=1
                    if cy<y0:y0=cy
                    if cy>y1:y1=cy
                    if cx<x0:x0=cx
                    if cx>x1:x1=cx
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx = cy+dy, cx+dx
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and lab[ny,nx]<0:
                            lab[ny,nx]=cur; q.append((ny,nx))
                out.append({"area":n,"bbox":[x0,y0,x1,y1]})
                cur += 1
    return lab, out

res = {}
for name in ids:
    p = os.path.join(root,"assets","img",name+".png")
    im = Image.open(p).convert("RGBA")
    a = np.asarray(im).astype(np.int32)
    r,g,b,al = a[:,:,0],a[:,:,1],a[:,:,2],a[:,:,3]
    opaque = al > 200
    # banner palette ~ (84,74,108) plus lighter (96,80,136)
    ban = opaque & (np.abs(r-84)<26) & (np.abs(g-74)<26) & (np.abs(b-110)<42) & (b>g+8) & (b>r+8)
    nban = int(ban.sum())
    entry = {"size":[im.width,im.height],"banner_px":nban}
    if nban > 150:
        ys,xs = np.nonzero(ban)
        entry["banner_bbox"] = [int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]
        entry["banner_frac"] = round(nban/ (im.width*im.height),4)
        entry["banner_share_of_opaque"] = round(nban/max(1,int(opaque.sum())),4)
    lab,cl = comps(opaque)
    cl.sort(key=lambda c:-c["area"])
    entry["ncomp"] = len(cl)
    entry["comps"] = cl[:6]
    entry["pig_area"] = cl[0]["area"] if cl else 0
    res[name] = entry

json.dump(res, open(os.path.join(root,"tmp","backdropA","analysis.json"),"w"), indent=1)
banners = sorted([k for k,v in res.items() if v["banner_px"]>150])
print("BANNER-CANDIDATES:", len(banners))
print(", ".join(banners))
print()
multi = sorted([k for k,v in res.items() if v["ncomp"]>1], key=lambda k: -res[k]["ncomp"])
print("MULTI-COMPONENT (possible detached props):")
for k in multi:
    v=res[k]
    print(" ", k, "ncomp",v["ncomp"], "pig",v["pig_area"], "others",[(c["area"],c["bbox"]) for c in v["comps"][1:]])
