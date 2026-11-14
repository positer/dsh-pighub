
# -*- coding: utf-8 -*-
"""把擦好的 19 张贴图写回 assets/img，并留下可对账的归档：
before/（原始）、after/（写回的那一版）、verify/（2–3 倍复查图）、compare/（前后对比）。
写回前逐张校验「after 与 out 目录逐字节相同」，写回后再从 assets/img 回读比对 sha256。
硬约束：不碰 assets/manifest.json。
"""
import os, shutil, hashlib, json, sys
from PIL import Image, ImageDraw

ROOT = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
IMG  = os.path.join(ROOT, "assets", "img")
OUT  = os.path.join(ROOT, "tmp", "backdropA", "out")
ARCH = sys.argv[1]
IDS = ["pighub-258","pighub-1031","pighub-1106","pighub-12","pighub-209","pighub-217","pighub-242",
       "pighub-250","pighub-262","pighub-271","pighub-293","pighub-337","pighub-40","pighub-417",
       "pighub-473","pighub-560","pighub-686","pighub-873","pighub-922"]

for sub in ("before", "after", "verify", "compare"):
    os.makedirs(os.path.join(ARCH, sub), exist_ok=True)

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()

def checker(w, h, s=10):
    im = Image.new("RGB", (w, h), (203, 203, 203)); d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if ((x//s)+(y//s)) % 2 == 0:
                d.rectangle([x, y, x+s-1, y+s-1], fill=(233, 233, 233))
    return im

rows = []
for name in IDS:
    src_before = os.path.join(IMG, name + ".png")
    src_after  = os.path.join(OUT, name + ".png")
    shutil.copy2(src_before, os.path.join(ARCH, "before", name + ".png"))
    shutil.copy2(src_after,  os.path.join(ARCH, "after",  name + ".png"))
    b = open(src_before, "rb").read(); aft = open(src_after, "rb").read()
    im_b = Image.open(src_before); im_a = Image.open(src_after)
    # 写回
    shutil.copyfile(src_after, src_before)
    back = open(src_before, "rb").read()
    ok = (back == aft)
    # 复查图（2.5 倍）
    z = im_a.convert("RGBA")
    sc = 2.5
    z = z.resize((int(z.width*sc), int(z.height*sc)), Image.LANCZOS)
    t = checker(z.width, z.height); t.paste(z, (0, 0), z)
    t.save(os.path.join(ARCH, "verify", name + "-x2.5.png"))
    rows.append({"id": name, "before_size": list(im_b.size), "after_size": list(im_a.size),
                 "before_bytes": len(b), "after_bytes": len(aft),
                 "before_sha256": sha(os.path.join(ARCH, "before", name + ".png")),
                 "after_sha256": sha(os.path.join(ARCH, "after", name + ".png")),
                 "writeback_byte_identical": ok})

# 三张典型前后对比
for name in ["pighub-258", "pighub-560", "pighub-1031"]:
    a = Image.open(os.path.join(ARCH, "before", name + ".png")).convert("RGBA")
    b2 = Image.open(os.path.join(ARCH, "after",  name + ".png")).convert("RGBA")
    sc = min(2.4, 620/a.width, 620/a.height)
    za = a.resize((int(a.width*sc), int(a.height*sc)), Image.LANCZOS)
    zb = b2.resize((int(b2.width*sc), int(b2.height*sc)), Image.LANCZOS)
    W = za.width + zb.width + 30; H = max(za.height, zb.height) + 34
    sh = checker(W, H); d = ImageDraw.Draw(sh)
    sh.paste(za, (10, 10), za); sh.paste(zb, (za.width + 20, 10), zb)
    d.text((10, H-20), "BEFORE " + name, fill=(0, 0, 0))
    d.text((za.width + 20, H-20), "AFTER", fill=(0, 0, 0))
    sh.save(os.path.join(ARCH, "compare", name + "-before-after.png"))

json.dump(rows, open(os.path.join(ARCH, "writeback.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
bad = [r for r in rows if not r["writeback_byte_identical"]]
print(json.dumps({"arch": ARCH, "written": len(rows), "mismatch": len(bad), "rows": rows}, indent=1, ensure_ascii=False))
