
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp"
Image.open(base + r"\occ-top.png").convert("RGB").crop((640, 130, 1520, 560)).save(base + r"\_occ-top-crop.png")
Image.open(base + r"\occ-bottom.png").convert("RGB").crop((640, 560, 1520, 1040)).save(base + r"\_occ-bottom-crop.png")
print("cropped")
