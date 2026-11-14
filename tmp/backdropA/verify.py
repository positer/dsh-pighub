
# -*- coding: utf-8 -*-
"""复查图：每组 = 上排「擦后 2 倍」+ 下排「原幕布区域 3 倍细节」，棋盘底，白框标出全图范围。"""
import os, sys, json
from PIL import Image, ImageDraw
ROOT = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
AFT = os.path.join(ROOT, "tmp", "backdropA", "after")
OUT = os.path.join(ROOT, "tmp", "backdropA", "verify")
os.makedirs(OUT, exist_ok=True)

def checker(w, h, s=12):
    im = Image.new("RGB", (w, h), (203, 203, 203)); d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if ((x//s)+(y//s)) % 2 == 0:
                d.rectangle([x, y, x+s-1, y+s-1], fill=(233, 233, 233))
    return im

def make(name, bbox, out, scale_full=2, scale_det=3):
    im = Image.open(os.path.join(AFT, name + ".png")).convert("RGBA")
    # 细节窗：原幕布 bbox 按 1:1 与擦后图对齐（擦后图未裁切位移信息 → 用全图 2 倍即可 + 单独 3 倍窗）
    full = im.resize((im.width*scale_full, im.height*scale_full), Image.NEAREST)
    x0, y0, x1, y1 = 0, 0, im.width, im.height
    if bbox:
        bx0, by0, bx1, by1 = bbox
        x0 = max(0, bx0-12); y0 = max(0, by0-12); x1 = min(im.width, bx1+12); y1 = min(im.height, by1+12)
    det = im.crop((x0, y0, x1, y1))
    det = det.resize((det.width*scale_det, det.height*scale_det), Image.NEAREST)
    W = max(full.width, det.width) + 20
    H = full.height + det.height + 60
    sheet = checker(W, H); d = ImageDraw.Draw(sheet)
    t1 = checker(full.width, full.height); t1.paste(full, (0,0), full)
    sheet.paste(t1, (10, 10))
    d.text((10, 10+full.height+4), "%s  after  x%d" % (name, scale_full), fill=(0,0,0))
    t2 = checker(det.width, det.height); t2.paste(det, (0,0), det)
    sheet.paste(t2, (10, 10+full.height+24))
    d.text((10, 10+full.height+24+det.height+4), "detail x%d  region %s" % (scale_det, (x0,y0,x1,y1)), fill=(0,0,0))
    sheet.save(os.path.join(OUT, name + ".png"))
    return os.path.join(OUT, name + ".png")

if __name__ == "__main__":
    ids = json.load(open(os.path.join(ROOT,"tmp","backdropA","metrics.json"), encoding="utf-8"))
    for m in ids:
        if not m: continue
        print(make(m["id"], m.get("banner_bbox"), OUT))
