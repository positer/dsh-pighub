
from PIL import Image
import numpy as np
p = r"dsh-pighub/assets/work/downloads/b站猪.jpg"
a = np.array(Image.open(p).convert("RGB")).astype(np.int16)
mn = a.min(axis=2)
mid = ((mn>=90)&(mn<236))
dark = (mn<90)
Image.fromarray((mid*255).astype(np.uint8)).save(r"dsh-pighub/assets/work/mask-mid.png")
Image.fromarray((dark*255).astype(np.uint8)).save(r"dsh-pighub/assets/work/mask-dark.png")
# crop the top region to inspect
Image.open(r"dsh-pighub/assets/work/downloads/b站猪.jpg").crop((30,30,619,200)).resize((1000,289)).save(r"dsh-pighub/assets/work/crop-top.png")
Image.open(r"dsh-pighub/assets/work/downloads/b站猪.jpg").crop((100,180,300,420)).resize((600,720)).save(r"dsh-pighub/assets/work/crop-leftletter.png")
Image.open(r"dsh-pighub/assets/work/downloads/b站猪.jpg").crop((450,470,619,600)).resize((676,520)).save(r"dsh-pighub/assets/work/crop-hnchi.png")
print("ok")
