"""
角色卡去重（方案 A：每簇只留一张）—— 构建期一次性脚本，默认干跑。

保留规则（按优先级，来自 2026-11-14 用户拍板）：
  1. 未被画布裁切 > 被裁切          （数据：archive/cut-cards.json）
  2. 分辨率高 > 低                  （数据：manifest 的 size，并用实际文件核对）
  3. 无幕布/文字 > 有               （数据：archive/curtain-cards.json）
  4. 特例：pighub-1114 必须保留（侧边栏图标的描摹来源，README 引用）

删除 = 删 assets/img/<file> + 从 manifest.pigs 移除条目 + 按 build-assets.mjs 的同一口径重算 counts。
只删条目，不改其它字段语义。

用法：
  python scripts/_dedupe-apply.py            # 干跑，打印决策表，不写任何东西
  python scripts/_dedupe-apply.py --write    # 真删
"""
import json, os, sys, hashlib
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(BASE, "assets", "manifest.json")
CORE = os.path.join(BASE, "archive", "dedupe-core.json")
CUT = os.path.join(BASE, "archive", "cut-cards.json")
CURTAIN = os.path.join(BASE, "archive", "curtain-cards.json")

KEEP_FORCED = {"pighub-1114"}


def load(p):
    return json.load(open(p, encoding="utf-8"))


def actual_size(path):
    try:
        with Image.open(path) as im:
            return im.size
    except Exception:
        return (0, 0)


def main():
    write = "--write" in sys.argv
    m = load(MP)
    pigs = m["pigs"]
    by_id = {p["id"]: p for p in pigs}
    clusters = load(CORE)["clusters"]
    cut = set(load(CUT))
    curtain = set(load(CURTAIN))

    plan = []
    for ci, cluster in enumerate(clusters, 1):
        rows = []
        for pid in cluster:
            p = by_id.get(pid)
            if p is None:
                rows.append({"id": pid, "missing": True})
                continue
            path = os.path.join(BASE, p["file"])
            aw, ah = actual_size(path)
            rows.append({
                "id": pid,
                "file": p["file"],
                "manifest_size": [p["size"]["width"], p["size"]["height"]],
                "actual_size": [aw, ah],
                "area": aw * ah,
                "cut": pid in cut,
                "curtain": pid in curtain,
                "kind": p.get("kind"),
                "vector": bool(p.get("vector")),
                "ext": os.path.splitext(p["file"])[1],
                "bytes_ok": os.path.getsize(path) == p.get("bytes"),
                "sha_ok": hashlib.sha256(open(path, "rb").read()).hexdigest() == p.get("sha256"),
            })
        live_rows = [r for r in rows if not r.get("missing")]
        forced = [r for r in live_rows if r["id"] in KEEP_FORCED]
        if forced:
            keeper = forced[0]
            how = "规则4 强制保留"
        else:
            # 1 未裁切 > 裁切；2 面积大 > 小；3 无幕布 > 有幕布
            keeper = max(live_rows, key=lambda r: (0 if r["cut"] else 1, r["area"], 0 if r["curtain"] else 1))
            how = "规则1/2/3"
        deleted = [r for r in live_rows if r["id"] != keeper["id"]]
        plan.append({"cluster": ci, "members": live_rows, "keeper": keeper, "deleted": deleted, "how": how})

    # 打印决策表
    total_del = 0
    for c in plan:
        k = c["keeper"]
        print("簇%d  保留 %-12s [%s]  %dx%d %s%s" % (
            c["cluster"], k["id"], c["how"], k["actual_size"][0], k["actual_size"][1],
            "裁切 " if k["cut"] else "", "幕布" if k["curtain"] else ""))
        for r in c["deleted"]:
            total_del += 1
            print("      删  %-12s %dx%d  area=%-7d cut=%-5s curtain=%-5s ext=%s" % (
                r["id"], r["actual_size"][0], r["actual_size"][1], r["area"],
                r["cut"], r["curtain"], r["ext"]))
        # 同簇里面积/裁切完全相同却由规则2/3 分不开的，标出来人工确认
        sig = {}
        for r in c["deleted"] + [k]:
            sig.setdefault((r["cut"], r["area"], r["curtain"]), []).append(r["id"])
        for key, ids in sig.items():
            if len(ids) > 1:
                print("      ! 并列（%s 完全相同）：%s —— 靠簇内顺序取第一个" % (key, ids))

    print()
    print("簇数=%d  保留=%d  删除=%d  剩余 pigs=%d" % (
        len(plan), len(plan), total_del, len(pigs) - total_del))

    # 一致性检查：被保留的卡 bytes/sha 必须与文件一致（smoke 会断言）
    bad = []
    for c in plan:
        k = c["keeper"]
        if not (k["bytes_ok"] and k["sha_ok"]):
            bad.append(k["id"])
    print("保留卡 bytes/sha 不一致：", bad if bad else "无")

    # 全库范围内，非簇成员里是否也有 bytes/sha 不一致的（不修，只报）
    allbad = []
    for p in pigs:
        path = os.path.join(BASE, p["file"])
        if not os.path.exists(path):
            allbad.append((p["id"], "MISSING"))
            continue
        if os.path.getsize(path) != p.get("bytes") or hashlib.sha256(open(path, "rb").read()).hexdigest() != p.get("sha256"):
            allbad.append((p["id"], "stale"))
    print("全库 bytes/sha 不一致（不修，只报）：", allbad if allbad else "无")

    if not write:
        print("\n[干跑] 未改动任何文件。加 --write 执行。")
        return

    # 真删
    report = []
    for c in plan:
        k = c["keeper"]
        for r in c["deleted"]:
            path = os.path.join(BASE, r["file"])
            if os.path.exists(path):
                os.remove(path)
            report.append({
                "id": r["id"], "cluster": c["cluster"], "keeper": k["id"],
                "file": r["file"], "size": r["actual_size"],
                "cut": r["cut"], "curtain": r["curtain"],
            })
        c["deleted_ids"] = [r["id"] for r in c["deleted"]]

    removed = {r["id"] for r in report}
    m["pigs"] = [p for p in pigs if p["id"] not in removed]
    # counts 与 build-assets.mjs 第 326-332 行完全同口径
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
    json.dump({"clusters": [{"cluster": c["cluster"], "keeper": c["keeper"]["id"],
                             "deleted": [r["id"] for r in c["deleted"]],
                             "how": c["how"]} for c in plan],
               "report": report, "counts": m["counts"]},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\n[写入] 删除 %d 个文件，manifest.counts=%s" % (len(report), json.dumps(m["counts"], ensure_ascii=False)))
    print("明细 ->", os.path.relpath(out, BASE))


if __name__ == "__main__":
    main()
