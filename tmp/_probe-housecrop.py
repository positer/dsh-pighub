
from PIL import Image
im = Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\house-live.png").convert("RGB")
im.crop((600, 100, 1520, 1020)).resize((760, 760)).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_house-live-crop.png")
print("ok")
