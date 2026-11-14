
import numpy as np, os
from PIL import Image
base=r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\backdropA"
for name in ["pighub-1106","pighub-40","pighub-686","pighub-250"]:
    a=Image.open(os.path.join(base,"after8",name+".png")).convert("RGBA")
    b=Image.open(os.path.join(base,"after9",name+".png")).convert("RGBA")
    A=np.asarray(a); B=np.asarray(b)
    print(name,"v8",a.size,"v9",b.size, "opaque v8/v9", int((A[:,:,3]>8).sum()), int((B[:,:,3]>8).sum()))
