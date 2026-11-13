
from PIL import Image
im = Image.open(".tmp-868/cand.png").convert("RGBA")
cur = Image.open("assets/img/pighub-868.png").convert("RGBA")
def onbg(i):
    bg = Image.new("RGBA", i.size, (236,236,236,255)); bg.alpha_composite(i); return bg.convert("RGB")
n = onbg(im); o = onbg(cur)
for name,(x0,y0,x1,y1) in {"ljun":(52,240,110,273),"crotch":(108,238,156,273),"junR":(150,240,206,273)}.items():
    c = n.crop((x0,y0,x1,y1)); c.resize((c.width*8, c.height*8), Image.NEAREST).save(f".tmp-868/z-{name}.png")
# side-by-side before/after of the whole belly at 4x
w = Image.new("RGB",(256*4, 60*4*2+8),(255,255,255))
a=o.crop((20,225,236,285)) if False else o.crop((20,220,236,273))
b=n.crop((20,220,236,273))
w.paste(a.resize((a.width*4,a.height*4), Image.NEAREST),(0,0))
w.paste(b.resize((b.width*4,b.height*4), Image.NEAREST),(0,a.height*4+8))
w.save(".tmp-868/belly-4x-before-after.png")
print("ok")
