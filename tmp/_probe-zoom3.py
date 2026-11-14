
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
Image.open(base + r"\pen-house.png").convert("RGB").crop((10, 0, 190, 140)).resize((540, 420), Image.NEAREST).save(base + r"\_zoom-house2.png")
Image.open(base + r"\pen-house-front.png").convert("RGB").crop((10, 0, 190, 200)).resize((540, 600), Image.NEAREST).save(base + r"\_zoom-house-front2.png")
print("ok")
