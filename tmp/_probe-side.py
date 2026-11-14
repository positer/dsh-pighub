
from PIL import Image
im = Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\desk2.png").convert("RGB")
im.crop((0, 440, 400, 700)).resize((800, 520), Image.NEAREST).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_side.png")
print("ok", im.size)
