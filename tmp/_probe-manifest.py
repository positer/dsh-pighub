
import json, statistics
m = json.load(open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\manifest.json", encoding="utf-8"))
print("pigs:", len(m["pigs"]))
print(json.dumps({k:v for k,v in m["pigs"][0].items() if k!="note"}, ensure_ascii=False)[:600])
ratios=[]
for p in m["pigs"]:
    w = p.get("width"); h = p.get("height")
    if w and h: ratios.append(h/w)
print("assets with w/h:", len(ratios))
if ratios:
    print("h/w median %.3f  p10 %.3f p90 %.3f" % (statistics.median(ratios), sorted(ratios)[len(ratios)//10], sorted(ratios)[9*len(ratios)//10]))
print("keys sample:", sorted(m["pigs"][0].keys()))
sr=[p.get("sizeRatio") for p in m["pigs"] if p.get("sizeRatio")]
print("sizeRatio median", statistics.median(sr) if sr else None, "min", min(sr) if sr else None, "max", max(sr) if sr else None)
