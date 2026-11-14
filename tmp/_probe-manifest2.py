
import json, statistics
m = json.load(open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\manifest.json", encoding="utf-8"))
r=[]
for p in m["pigs"]:
    s=p.get("size") or {}
    w,h=s.get("width"),s.get("height")
    if w and h: r.append(h/w)
r.sort()
print("n=%d  h/w: p10 %.3f median %.3f p90 %.3f mean %.3f" % (len(r), r[len(r)//10], statistics.median(r), r[9*len(r)//10], statistics.mean(r)))
sr=sorted(p.get("sizeRatio") or 96 for p in m["pigs"])
print("sizeRatio: median %.1f p10 %.1f p90 %.1f" % (statistics.median(sr), sr[len(sr)//10], sr[9*len(sr)//10]))
