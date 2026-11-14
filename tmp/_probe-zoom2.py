
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
Image.open(base + r"\pen-house.png").convert("RGB").crop((10, 40, 190, 200)).resize((540, 480), Image.NEAREST).save(base + r"\_zoom-house.png")
Image.open(base + r"\pen-house-front.png").convert("RGB").crop((10, 40, 190, 200)).resize((540, 480), Image.NEAREST).save(base + r"\_zoom-house-front.png")
print("ok")
