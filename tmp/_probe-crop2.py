
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp"
for name, box in (("drag-top", (600, 100, 1520, 620)), ("drag-bottom", (600, 600, 1520, 1040))):
    im = Image.open(base + "\\" + name + ".png").convert("RGB")
    im.crop(box).save(base + "\\_" + name + "-crop.png")
    print(name, "cropped", box)
