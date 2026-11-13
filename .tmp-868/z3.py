
from PIL import Image
im = Image.open(".tmp-868/B.png").convert("RGBA")
bg = Image.new("RGBA", im.size, (236,236,236,255)); bg.alpha_composite(im); bg=bg.convert("RGB")
c = bg.crop((20,215,236,273)); c.resize((c.width*3,c.height*3), Image.NEAREST).save(".tmp-868/B-belly3x-full.png")
print(c.size)
