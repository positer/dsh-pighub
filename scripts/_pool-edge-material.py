
"""临时探针：对 audit-completeness.py 报出的切边猪，量「切掉的是猪还是布景」。

判据与 scripts/_pool-batch-b.py 的 cmd_peach() 完全同一口径（那里的 docstring 是依据来源）：
  猪身色 = 暖亮桃粉：alpha>16 且 R>=180、G>=120、B>=90、R-B>=20、R-G<=60；
  取样位置 = 内缩 2px（最外一列永远是描边）；frac_edge >= 0.30 判「猪身被切」。
"""
import os, json
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = {
    "pighub-242": ["left"], "pighub-376": ["right"], "pighub-40": ["right"],
    "pighub-997": ["right"],
    "pighub-27": ["top", "right"], "pighub-751": ["bottom", "right"],
    "pighub-426": ["left"], "pighub-1087": ["top", "right"],
    "pighub-1099": ["bottom"], "pighub-974": ["bottom", "right"],
}
out = []
for pid, sides in CASES.items():
    p = os.path.join(BASE, "assets", "img", pid + ".png")
    a = np.array(Image.open(p).convert("RGBA"))
    al = a[:, :, 3] > 16
    ys, xs = np.where(al)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    peach = al & (r >= 180) & (g >= 120) & (b >= 90) & ((r - b) >= 20) & ((r - g) <= 60)
    for side in sides:
        ins = 2
        if side == "right":   c = x1 - ins; e_al, e_pc = al[y0:y1+1, c], peach[y0:y1+1, c]
        elif side == "left":  c = x0 + ins; e_al, e_pc = al[y0:y1+1, c], peach[y0:y1+1, c]
        elif side == "top":   c = y0 + ins; e_al, e_pc = al[c, x0:x1+1], peach[c, x0:x1+1]
        else:                 c = y1 - ins; e_al, e_pc = al[c, x0:x1+1], peach[c, x0:x1+1]
        n_op, n_pc = int(e_al.sum()), int(e_pc.sum())
        frac_edge = n_pc / float(len(e_al))
        out.append({"id": pid, "side": side, "frac_edge": round(frac_edge, 3),
                    "frac_opaque": round(n_pc / n_op, 3) if n_op else 0.0,
                    "verdict": "PIG cut" if frac_edge >= 0.30 else "NOT pig (decoration)"})
for o in out:
    print("%-13s %-6s edge_peach=%5.3f opaque_peach=%5.3f  %s" % (o["id"], o["side"], o["frac_edge"], o["frac_opaque"], o["verdict"]))
json.dump(out, open(os.path.join(BASE, "archive", "20261113-201154-pool-to-256", "edge-material.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
