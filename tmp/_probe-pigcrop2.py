
from PIL import Image
im = Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pig-over-house2.png").convert("RGB")
im.crop((620, 130, 1150, 600)).resize((795, 705)).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_pig-house-zoom2.png")
print("ok")
