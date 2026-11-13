
from PIL import Image
import sys
tag = sys.argv[1]
im = Image.open(f".tmp-868/{tag}.png").convert("RGBA")
cur = Image.open("assets/img/pighub-868.png").convert("RGBA")
def onbg(i):
    bg = Image.new("RGBA", i.size, (236,236,236,255)); bg.alpha_composite(i); return bg.convert("RGB")
n = onbg(im); o = onbg(cur)
c = n.crop((22,232,76,262)); c.resize((c.width*10, c.height*10), Image.NEAREST).save(f".tmp-868/{tag}-shoulderL10x.png")
c = n.crop((108,238,156,273)); c.resize((c.width*8, c.height*8), Image.NEAREST).save(f".tmp-868/{tag}-crotch8x.png")
a=o.crop((20,228,236,273)); b=n.crop((20,228,236,273))
w = Image.new("RGB",(a.width*4, a.height*4*2+10),(255,255,255))
w.paste(a.resize((a.width*4,a.height*4), Image.NEAREST),(0,0))
w.paste(b.resize((b.width*4,b.height*4), Image.NEAREST),(0,a.height*4+10))
w.save(f".tmp-868/{tag}-ba4x.png")
print("ok")
