"""
去重候选簇的并排对照图（只出图，不动 assets/）。

每簇一张：一格一张卡、等比缩放、白底黑字、格下标 id + 尺寸。
输出 archive/dedupe-clusters/c<N>.png。

用法：python scripts/_dedupe-sheets.py
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(BASE, "assets", "manifest.json")
CORE = os.path.join(BASE, "archive", "dedupe-core.json")
OUT = os.path.join(BASE, "archive", "dedupe-clusters")

TARGET_W = 1150
PAD = 12
LABEL_H = 46


def font(size):
    for p in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\consola.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    os.makedirs(OUT, exist_ok=True)
    only = None
    scale = 1.0
    suffix = ""
    for i, a in enumerate(sys.argv):
        if a == "--only":
            only = {int(x) for x in sys.argv[i + 1].split(",")}
        if a == "--scale":
            scale = float(sys.argv[i + 1])
            suffix = "-%gx" % scale
    m = json.load(open(MP, encoding="utf-8"))
    by_id = {p["id"]: p for p in m["pigs"]}
    clusters = json.load(open(CORE, encoding="utf-8"))["clusters"]
    f = font(20)

    for ci, cluster in enumerate(clusters, 1):
        if only and ci not in only:
            continue
        n = len(cluster)
        cols = 5 if n > 4 else n
        cell = min(int(300 * scale), (int(TARGET_W * scale) - PAD * (cols + 1)) // cols)
        rows = (n + cols - 1) // cols
        W = PAD * (cols + 1) + cell * cols
        H = PAD * (rows + 1) + (cell + LABEL_H) * rows
        sheet = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(sheet)

        for i, pid in enumerate(cluster):
            r, c = divmod(i, cols)
            x0 = PAD + c * (cell + PAD)
            y0 = PAD + r * (cell + LABEL_H + PAD)
            p = by_id.get(pid)
            if p is None:
                d.text((x0 + 6, y0 + 6), pid + " MISSING", fill=(200, 0, 0), font=f)
                continue
            path = os.path.join(BASE, p["file"])
            im = Image.open(path).convert("RGBA")
            w, h = im.size
            s = min(cell / w, cell / h)
            nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
            im2 = im.resize((nw, nh), Image.LANCZOS)
            bg = Image.new("RGBA", (nw, nh), (255, 255, 255, 255))
            bg.alpha_composite(im2)
            sheet.paste(bg.convert("RGB"), (x0 + (cell - nw) // 2, y0 + (cell - nh) // 2))
            # 细边框，方便看出画布边界
            d.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], outline=(210, 210, 210))
            d.text((x0 + 2, y0 + cell + 6), pid, fill=(0, 0, 0), font=f)
            d.text((x0 + 2, y0 + cell + 24), "%dx%d" % (w, h), fill=(90, 90, 90), font=f)

        out = os.path.join(OUT, "c%d%s.png" % (ci, suffix))
        sheet.save(out)
        print("c%-2d %2d 张  %dx%d  -> %s" % (ci, n, W, H, os.path.relpath(out, BASE)))


if __name__ == "__main__":
    main()