
from PIL import Image
import os, collections
root = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
for name in ["pighub-258","pighub-217","pighub-1031","pighub-12","pighub-242"]:
    im = Image.open(os.path.join(root,"assets","img",name+".png")).convert("RGBA")
    px = im.load()
    c = collections.Counter()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = px[x,y]
            if a > 200: c[(r//8*8,g//8*8,b//8*8)] += 1
    print(name, im.size, "top colors:", c.most_common(8))
