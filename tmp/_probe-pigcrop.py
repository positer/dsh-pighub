
from PIL import Image
im = Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pig-over-house.png").convert("RGB")
im.crop((620, 130, 1100, 560)).resize((720, 645)).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_pig-house-zoom.png")
im.crop((600, 100, 1520, 1020)).resize((760, 760)).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_pig-house-pen.png")
print("ok")
