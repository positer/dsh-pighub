"""
角色卡矢量化：把冻结库里的**静态位图**转成 SVG，并把清单里那一条改成指向 SVG。

为什么是独立脚本、不并进 build-assets.mjs（2026-11-15 实测后定）：
  build-assets.mjs 的 vector 分支走 lib/imaging.js 的 vectorise()（量化 → 等值线 → 简化，
  一个色块一条 path + fill-rule=evenodd），那是仓库自绘的描摹器；本脚本用 vtracer
  （mode=spline、hierarchical=stacked），同一只猪的产物形态与体积都不同。
  两条路各自可重跑、互不覆盖：build-assets 只认 judgements 里的 vector 判定，
  本脚本只认清单里 file 以 .png 结尾的那批。

为什么干跑是默认、--write 才落盘：
  一次要写 200+ 个文件 + 200+ 条清单记录，参数或尺寸口径一旦错，回滚成本是 200+ 个文件。
  默认只把 SVG 落到 --out（默认是仓库外的 .tmp-vectorize/svg）并打印统计；--write 才进仓库目录并回填清单。

为什么 --out 默认是 assets/img/ 而不是 assets/svg/（实测，三个消费方都硬编码了这个目录）：
  lib/assets.js:11   IMAGE_DIR = ../assets/img/
  lib/assets.js:81   assetSummary 用 pig.file.replace('assets/img/','') 再拼回 IMAGE_DIR
  lib/index.js:809   GET /pighub/asset/<file> 用 new URL(basename, IMAGE_DIR)
  lib/index.js:123   桌面桌宠的精灵路径 = join(assets, img, basename)
  清单里写 assets/svg/x.svg 的后果：静态路由 404、assetSummary 少算体积、桌宠被静默跳过
  （pet-window.cs:196 的 !File.Exists 分支）。另：桌宠自己 pet-window.cs:205 是 new Bitmap(path)，
  GDI+ 不认 SVG —— 所以桌面桌宠这一路还需要一份位图，这是留给上一层的决策，不在本脚本里假装解决。

判据（每条都能复核）：
  1. SVG 的 width/height 必须等于 PNG 的像素尺寸 —— 客户端的猪是 width:100%;height:auto，
     高宽比来自清单的 size（client.js:1075），SVG 自己的比例对不上就会被拉伸；
  2. 回填的 bytes/sha256 必须是磁盘文件的真值（test/smoke.mjs:83-85 逐条对账）；
  3. 任何一张失败就整体不写（--write 直接拒绝），不允许写一半。

用法（vtracer 只装在 DSH 运行时那个 3.12 解释器里，见 RUNTIME_PY）：
  RUNTIME_PY scripts/vectorize-all.py                      # 干跑全部静态位图
  RUNTIME_PY scripts/vectorize-all.py --ids=keep.json       # 只做名单里的（list 或 {"keep":[...]}）
  RUNTIME_PY scripts/vectorize-all.py --limit=6             # 冒烟
  RUNTIME_PY scripts/vectorize-all.py --write               # 写 assets/img/<id>.svg 并回填清单
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(BASE, "assets", "manifest.json")
RUNTIME_PY = r"C:\Users\12252\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"

# 试点验证过的参数（archive/svg-pilot/ 的 751 / 873 / pig-1355 就是这套参数出的）
PARAMS = dict(
    colormode="color",
    hierarchical="stacked",
    mode="spline",
    filter_speckle=8,
    color_precision=6,
    corner_threshold=60,
    path_precision=2,
)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def detect_json_format(raw):
    """量出这份 JSON 的换行与结尾：写回时**原样复刻**，不顺手归一（§S.5 的教训）。

    2026-11-15 实测：assets/manifest.json 是 **CRLF（6805 个）+ 结尾没有换行**；
    json.dumps(indent=2) 的默认输出是 LF + 无结尾换行，两者差 6805 字节。
    """
    text = raw.decode("utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    return newline, text.endswith("\n")


def dump_manifest(data, newline, trailing):
    text = json.dumps(data, indent=2, ensure_ascii=False).replace("\n", newline)
    if trailing:
        text += newline
    return text.encode("utf-8")


def load_manifest(path):
    raw = open(path, "rb").read()
    data = json.loads(raw.decode("utf-8"))
    fmt = detect_json_format(raw)
    # 能不能安全地整文件重写：用同一种格式序列化回去必须与原文件逐字节相同。
    return data, raw, fmt, dump_manifest(data, *fmt) == raw


def load_ids(path):
    if not path:
        return None
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict):
        for key in ("keep", "ids", "cards", "pigs"):
            if key in data:
                data = data[key]
                break
        else:
            raise SystemExit("名单文件是对象但没有 keep/ids/cards/pigs 键：" + path)
    if not isinstance(data, list):
        raise SystemExit("名单文件必须是数组或带 keep 的对象：" + path)
    out = []
    for item in data:
        out.append(item if isinstance(item, str) else item.get("id"))
    return [x for x in out if x]


def svg_dims(path):
    head = open(path, "r", encoding="utf-8").read(600)
    m = re.search(r'<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"', head)
    if not m:
        return None
    return int(round(float(m.group(1)))), int(round(float(m.group(2))))


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--write", action="store_true", help="真的写盘并回填清单（默认干跑）")
    ap.add_argument("--ids", default=None, help="只做这些 id：JSON 数组或 {\"keep\":[...]}")
    ap.add_argument("--out", default="assets/img", help="产物目录（相对仓库根，默认 assets/img）")
    ap.add_argument("--manifest", default=MANIFEST, help="清单路径（默认 assets/manifest.json；测试时指到副本）")
    ap.add_argument("--backup", default=os.path.join(os.path.dirname(BASE), "archive", "asset-backup", "manifest.before-vector.json"),
                    help="写回前把原清单备份到这里（已存在则不覆盖）")
    ap.add_argument("--limit", type=int, default=0, help="只做前 N 只（冒烟）")
    ap.add_argument("--report", default=os.path.join(BASE, ".tmp-vectorize", "vectorize-report.json"))
    args = ap.parse_args()

    try:
        import vtracer
    except Exception as exc:  # noqa: BLE001
        raise SystemExit("这台解释器没有 vtracer（%s）。请用：%s" % (exc, RUNTIME_PY))
    from PIL import Image

    manifest, raw_bytes, fmt, canonical_ok = load_manifest(args.manifest)
    pigs = manifest["pigs"]
    only = load_ids(args.ids)
    only_set = set(only) if only else None

    todo, skipped = [], []
    for pig in pigs:
        if only_set is not None and pig["id"] not in only_set:
            skipped.append((pig["id"], "not_in_ids"))
            continue
        rel = str(pig.get("file") or "")
        if not rel.lower().endswith(".png"):
            skipped.append((pig["id"], "not_png:" + (rel.rsplit(".", 1)[-1] if rel else "?")))
            continue
        todo.append(pig)
    if args.limit:
        todo = todo[: args.limit]

    out_dir = args.out if os.path.isabs(args.out) else os.path.join(BASE, args.out)
    if not args.write and os.path.abspath(out_dir).startswith(os.path.abspath(os.path.join(BASE, "assets"))):
        out_dir = os.path.join(BASE, ".tmp-vectorize", "svg")
    os.makedirs(out_dir, exist_ok=True)

    items, failures = [], []
    t0 = time.time()
    for i, pig in enumerate(todo, 1):
        pid = pig["id"]
        src = os.path.join(BASE, pig["file"])
        dst = os.path.join(out_dir, pid + ".svg")
        rec = {"id": pid, "png": pig["file"], "ok": False}
        try:
            with Image.open(src) as im:
                png_size = (im.width, im.height)
            rec["png_size"] = list(png_size)
            rec["png_bytes"] = os.path.getsize(src)
            vtracer.convert_image_to_svg_py(src, dst, **PARAMS)
            dims = svg_dims(dst)
            rec["svg_size"] = list(dims) if dims else None
            if dims != png_size:
                raise SystemExit("SVG 尺寸 %s != PNG 尺寸 %s" % (dims, png_size))
            rec["svg_bytes"] = os.path.getsize(dst)
            rec["sha256"] = sha256_of(dst)
            rec["ok"] = True
            items.append(rec)
        except Exception as exc:  # noqa: BLE001
            rec["error"] = "%s: %s" % (type(exc).__name__, exc)
            failures.append(rec)
            items.append(rec)
        if i % 25 == 0 or i == len(todo):
            print("  %d/%d ..." % (i, len(todo)), flush=True)
    elapsed = time.time() - t0

    ok = [r for r in items if r["ok"]]
    sizes = sorted(r["svg_bytes"] for r in ok)
    png_total = sum(r["png_bytes"] for r in ok)
    svg_total = sum(sizes)
    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "params": PARAMS,
        "out": os.path.relpath(out_dir, BASE),
        "write": bool(args.write),
        "counts": {
            "candidates": len(todo),
            "ok": len(ok),
            "failed": len(failures),
            "skipped": len(skipped),
        },
        "bytes": {
            "png_total": png_total,
            "svg_total": svg_total,
            "svg_avg": int(svg_total / len(ok)) if ok else 0,
            "svg_max": sizes[-1] if sizes else 0,
            "svg_min": sizes[0] if sizes else 0,
            "ratio": round(svg_total / png_total, 3) if png_total else 0,
        },
        "skipped": [{"id": a, "why": b} for a, b in skipped],
        "items": items,
        "manifestRoundTrip": canonical_ok,
        "elapsedSec": round(elapsed, 2),
    }

    print()
    print("参数: " + json.dumps(PARAMS, ensure_ascii=False))
    print("候选 %d 只 → 成功 %d / 失败 %d / 跳过 %d   用时 %.1fs"
          % (len(todo), len(ok), len(failures), len(skipped), elapsed))
    if ok:
        print("SVG 体积: 合计 %d B (%.2f MB)  平均 %d B  最小 %d B  最大 %d B  为 PNG 的 %.2f 倍"
              % (svg_total, svg_total / 1048576.0, report["bytes"]["svg_avg"],
                 report["bytes"]["svg_min"], report["bytes"]["svg_max"], report["bytes"]["ratio"]))
        print("PNG 体积（同一批）: %d B (%.2f MB)" % (png_total, png_total / 1048576.0))
        big = [r for r in ok if r["svg_bytes"] > 200000]
        if big:
            print("超 200 KB 的 %d 张: %s" % (len(big), ", ".join("%s(%.0fKB)" % (r["id"], r["svg_bytes"] / 1024.0) for r in big)))
    if failures:
        print("失败明细:")
        for r in failures:
            print("  %-14s %s" % (r["id"], r.get("error")))
    if skipped:
        from collections import Counter
        print("跳过: " + str(Counter(b.split(":")[0] for _, b in skipped)))
    print("产物目录: " + out_dir)
    print("报告: " + args.report)
    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    json.dump(report, open(args.report, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(args.report, "a", encoding="utf-8").write("\n")

    if not args.write:
        print("干跑结束，仓库里一个文件都没动。")
        return 0
    if failures:
        print("有失败项，拒绝写回（--write 要求 0 失败）。")
        return 1
    if not canonical_ok:
        print("清单用同一种格式序列化回去与磁盘不一致，拒绝整文件重写（换行/缩进口径不同）。")
        return 1

    # ---- 回填清单 ----
    # 口径（2026-11-15 与 lead 对齐）：file 指向 SVG、vector=true、bytes/sha256 取 SVG 真值、
    # size 不动（SVG 的 width/height 已断言等于 PNG 像素尺寸）；
    # 新增 raster 指向原 PNG —— 桌面桌宠走 GDI+（pet-window.cs:205 new Bitmap），它读不了 SVG，
    # 所以位图必须留着，由 lib/index.js:123 的 pig.raster || pig.file 取用。
    out_rel = os.path.relpath(out_dir, BASE).replace(os.sep, "/")
    by_id = {r["id"]: r for r in items if r["ok"]}
    new_pigs = []
    touched = 0
    for pig in manifest["pigs"]:
        rec = by_id.get(pig["id"])
        if not rec:
            new_pigs.append(pig)
            continue
        old_file = pig["file"]
        rebuilt = {}
        for key, value in pig.items():
            rebuilt[key] = value
            if key == "file":
                rebuilt["file"] = out_rel + "/" + pig["id"] + ".svg"
                rebuilt["raster"] = old_file
        rebuilt["vector"] = True
        rebuilt["bytes"] = rec["svg_bytes"]
        rebuilt["sha256"] = rec["sha256"]
        new_pigs.append(rebuilt)
        touched += 1
    manifest["pigs"] = new_pigs
    # counts 的键集合是 build-assets 的 5 键 schema（total/live/dead/vector/adopted）——
    # 只更新 vector 一个值，**不新增键**（2026-11-15 lead 明确：非 schema 键已去掉，别再塞回去）。
    counts = manifest.setdefault("counts", {})
    counts["vector"] = sum(1 for p in new_pigs if p.get("vector") is True)

    # 写前备份（§S.6：写素材/清单之前先建备份）
    backup = args.backup
    os.makedirs(os.path.dirname(backup), exist_ok=True)
    if not os.path.exists(backup):
        open(backup, "wb").write(raw_bytes)

    open(args.manifest, "wb").write(dump_manifest(manifest, *fmt))

    # ---- 写后自检：清单里每一条都必须与磁盘对得上（smoke 1.x 的同口径）----
    check = json.loads(open(args.manifest, "rb").read().decode("utf-8"))
    bad = []
    for pig in check["pigs"]:
        if pig["id"] not in by_id:
            continue
        for key in ("file", "raster"):
            rel = pig.get(key)
            if not rel:
                bad.append((pig["id"], key, "missing_field"))
                continue
            path = os.path.join(BASE, rel)
            if not os.path.exists(path):
                bad.append((pig["id"], key, "file_not_found:" + rel))
                continue
            if key == "file":
                size = os.path.getsize(path)
                digest = sha256_of(path)
                if size != pig["bytes"]:
                    bad.append((pig["id"], key, "bytes %d != %d" % (size, pig["bytes"])))
                if digest != pig["sha256"]:
                    bad.append((pig["id"], key, "sha256 mismatch"))

    print()
    print("已写回：%d 只转成 SVG；清单 file→%s/<id>.svg、raster→原 PNG、vector=true；counts.vector=%d"
          % (touched, out_rel, counts["vector"]))
    print("清单备份: " + backup)
    if bad:
        print("写后自检失败 %d 条:" % len(bad))
        for row in bad[:20]:
            print("  %s %s %s" % row)
        return 1
    print("写后自检通过：%d 条 file/raster 全部存在，bytes 与 sha256 与磁盘逐条相同。" % (touched * 2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
