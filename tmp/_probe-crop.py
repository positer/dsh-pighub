
from PIL import Image
im = Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\drag-top.png").convert("RGB")
im.crop((560, 60, 1620, 1120)).resize((700, 700)).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_drag-top-crop.png")
print("ok")
