"""
角色卡去重执行（2026-11-14 最终裁定：视觉判定名单）。

与 _dedupe-apply.py 的区别：那份是**按像素规则**选保留者的对照脚本（保留作证据，不改）；
本份按 lead 采纳的**视觉判定**名单执行，只做删除 + manifest 条目移除 + counts 同步。

core diff 复刻 scripts/dedupe-core.py 的同一口径（暖色包围盒中间 50% → 24x24 LANCZOS → 平均绝对差），
保证归档里的数字与候选筛选时同源。

用法：
  python scripts/_dedupe-apply-vision.py            # 干跑
  python scripts/_dedupe-apply-vision.py --write    # 真删
"""
import json, os, sys, hashlib
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(BASE, "assets", "manifest.json")

# 簇 -> 代表卡（删除卡的「替代卡」）
KEEPER = {1: "pighub-1114", 2: "pighub-1063", 3: "pighub-1093", 4: "pighub-1135",
          5: "pighub-1172", 6: "pighub-1226", 7: "pighub-38", 8: "pighub-376",
          9: "pighub-479", 10: "pighub-804"}

# 视觉依据（看图判定时写下的那句）
WHY = {
    "pighub-1124": "同底图：两个实心黑圆眼、粉鼻两孔、左上粉耳笔、右上卷尾全同，无装扮差异",
    "pighub-249":  "同底图，四固定特征全同，无装扮差异",
    "pighub-266":  "同底图，四固定特征全同，无装扮差异",
    "pighub-680":  "同底图，四固定特征全同；画布高仅 190（下方被裁、腿更短）",
    "pighub-829":  "同底图，四固定特征全同，描边略粗",
    "pighub-830":  "同底图，197x175 低分辨率放大后描边发糊",
    "pighub-836":  "同底图，四固定特征全同",
    "pighub-981":  "同底图，171x153 为簇内最低分辨率",
    "pighub-192":  "同底图：闭眼笑两道弧、粉鼻两孔、左上粉耳笔、右上卷尾全同",
    "pighub-300":  "同底图，另加下巴/前腿左下描边锯齿状破损（非内容差异）",
    "pighub-1095": "同底图：两个实心黑圆眼、粉鼻、粉耳笔、卷尾全同；190x168 低分辨率放大、描边粗糊",
    "pighub-993":  "同底图，整猪在更高画布（256x239）里缩得更小，有效分辨率最低",
    "pighub-1199": "同底图（朝右）：黑圆眼、粉鼻、右上粉耳笔、左上卷尾全同，与 1135 肉眼无差别",
    "pighub-1181": "同底图，四固定特征全同；143x127 为簇内最低分辨率",
    "pighub-1183": "同底图，四固定特征全同；与 1172 仅差 1px 宽高",
    "pighub-1305": "同底图：闭眼笑单道弧、粉鼻、左上粉耳笔、右上卷尾全同",
    "pighub-201":  "同底图，但云朵气泡内为空 = 道具被抠掉的残缺版（lead 裁定删、留 38）",
    "pighub-40":   "同底图同一红玫瑰，但画布被纵向压到 137 高，下半身裁掉/压扁",
    "pighub-814":  "同底图：闭眼笑两道弧、粉鼻、粉耳笔、卷尾全同",
    "pighub-975":  "同底图（幽灵猪：波浪底、无腿、两侧品红手臂笔），四固定特征全同",
}

DELETE = list(WHY.keys())
RASTER = (".png", ".jpg", ".jpeg", ".webp")


def core_vec(path):
    """与 scripts/dedupe-core.py 完全同一口径。"""
    im = Image.open(path)
    if getattr(im, "is_animated", False):
        im.seek(0)
    im = im.convert("RGBA")
    a = np.array(im)
    h, w = a.shape[:2]
    r, b = a[:, :, 0].astype(int), a[:, :, 2].astype(int)
    op = a[:, :, 3] > 8
    warm = op & (r > b + 12) & (r > 60)
    ys, xs = np.nonzero(warm)
    if len(xs) < 500:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    hw, hh = (x1 - x0) // 4, (y1 - y0) // 4
    core = im.crop((max(0, cx - hw), max(0, cy - hh),
                    min(w, cx + hw + 1), min(h, cy + hh + 1))).convert("RGB").resize((24, 24), Image.LANCZOS)
    return np.array(core, dtype=np.float32)


def main():
    write = "--write" in sys.argv
    m = json.load(open(MP, encoding="utf-8"))
    pigs = m["pigs"]
    by_id = {p["id"]: p for p in pigs}
    clusters = json.load(open(os.path.join(BASE, "archive", "dedupe-core.json"), encoding="utf-8"))["clusters"]
    cluster_of = {}
    for ci, g in enumerate(clusters, 1):
        for pid in g:
            cluster_of[pid] = ci

    # 1) 前置校验
    problems = []
    for pid in DELETE:
        if pid not in by_id:
            problems.append((pid, "not in manifest"))
            continue
        if pid not in cluster_of:
            problems.append((pid, "not in any cluster"))
        if pid == KEEPER.get(cluster_of.get(pid)):
            problems.append((pid, "is its own cluster keeper"))
        if not os.path.exists(os.path.join(BASE, by_id[pid]["file"])):
            problems.append((pid, "file missing"))
    keepers_present = [k for k in KEEPER.values() if k in by_id]
    if len(keepers_present) != len(KEEPER):
        problems.append(("keepers", "missing: %s" % [k for k in KEEPER.values() if k not in by_id]))
    print("拟删 %d 张；替代卡齐全: %s" % (len(DELETE), len(keepers_present) == len(KEEPER)))
    if problems:
        print("!! 前置校验失败:", problems)
        return

    # 2) 计算 core diff（删除卡 vs 替代卡）
    kv = {}
    for k in KEEPER.values():
        kv[k] = core_vec(os.path.join(BASE, by_id[k]["file"]))
    rows = []
    for pid in DELETE:
        ci = cluster_of[pid]
        k = KEEPER[ci]
        v = core_vec(os.path.join(BASE, by_id[pid]["file"]))
        if v is None or kv[k] is None:
            d = None
        else:
            d = round(float(np.abs(v - kv[k]).mean()), 2)
        p = by_id[pid]
        rows.append({"id": pid, "cluster": ci, "keeper": k, "core_diff": d,
                     "size": [p["size"]["width"], p["size"]["height"]],
                     "file": p["file"], "why": WHY[pid]})
        print("c%-2d 删 %-12s %dx%-3d core_diff=%-5s 替代=%s" % (
            ci, pid, p["size"]["width"], p["size"]["height"], d, k))

    # 3) 执行
    before_pigs = len(pigs)
    if write:
        for r in rows:
            path = os.path.join(BASE, r["file"])
            if os.path.exists(path):
                os.remove(path)
        removed = set(DELETE)
        m["pigs"] = [p for p in pigs if p["id"] not in removed]
        # counts：与 scripts/build-assets.mjs 第 326-332 行同口径
        m["counts"] = {
            "total": len(m["pigs"]),
            "live": len([p for p in m["pigs"] if p.get("kind") == "live"]),
            "dead": len([p for p in m["pigs"] if p.get("kind") == "dead"]),
            "vector": len([p for p in m["pigs"] if p.get("vector")]),
            "adopted": len([p for p in m["pigs"] if p.get("adopted") is True]),
        }
        with open(MP, "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)
            f.write("\n")
        out = os.path.join(BASE, "archive", "dedupe-applied.json")
        json.dump({"deleted": rows, "counts": m["counts"],
                   "pigs_before": before_pigs, "pigs_after": len(m["pigs"])},
                  open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("\n[写入] pigs %d -> %d；counts=%s" % (before_pigs, len(m["pigs"]),
                                                   json.dumps(m["counts"], ensure_ascii=False)))
        print("明细 ->", os.path.relpath(out, BASE))
    else:
        print("\n[干跑] 未改动任何文件。加 --write 执行。")
        print("预计 pigs %d -> %d" % (before_pigs, before_pigs - len(DELETE)))


if __name__ == "__main__":
    main()
