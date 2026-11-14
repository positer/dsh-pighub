
import numpy as np, os
from PIL import Image
from collections import Counter
AFT=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA\after2"
im=Image.open(os.path.join(AFT,"pighub-258.png")).convert("RGBA")
a=np.asarray(im)
pts=[(181,66),(181,67),(180,67),(181,68)]
for x,y in pts:
    print((x,y), a[y,x].tolist())
# neighbourhood alphas around (181,67)
print("alpha patch:")
print(a[63:73,177:187,3])
