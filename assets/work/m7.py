
from PIL import Image
im = Image.open(r"dsh-pighub/assets/work/downloads/b站猪.jpg")
im.crop((110,170,310,340)).resize((800,680), Image.LANCZOS).save(r"dsh-pighub/assets/work/zoom-face.png")
im.crop((330,190,470,320)).resize((560,520), Image.LANCZOS).save(r"dsh-pighub/assets/work/zoom-right.png")
print("ok")
