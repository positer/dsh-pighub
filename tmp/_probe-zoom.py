
from PIL import Image
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
top = Image.open(shots + r"\pen-top.png").convert("RGB").crop((150, 30, 320, 200)).resize((510, 510), Image.NEAREST)
top.save(shots + r"\_zoom-top.png")
bot = Image.open(shots + r"\pen-bottom.png").convert("RGB").crop((150, 300, 320, 452)).resize((510, 456), Image.NEAREST)
bot.save(shots + r"\_zoom-bottom.png")
print("ok")
