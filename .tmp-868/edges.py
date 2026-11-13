
import numpy as np
from PIL import Image
a = np.array(Image.open("assets/img/pighub-868.png").convert("RGBA"))
al = a[:,:,3]
print("row  leftmost A>128  leftmost A>16  rightmost A>128  rightmost A>16")
for y in range(225, 248):
    l128 = np.nonzero(al[y,:] > 128)[0]; l16 = np.nonzero(al[y,:] > 16)[0]
    print(y, (l128.min() if len(l128) else -1), (l16.min() if len(l16) else -1),
          (l128.max() if len(l128) else -1), (l16.max() if len(l16) else -1))
