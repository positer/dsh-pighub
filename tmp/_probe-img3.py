
from PIL import Image
import numpy as np, struct
src = r"C:\Users\12252\.dsh\attachments\v1\objects\30\30b82f489b4558748f6e090cc859c4a8670331c901459866880eabfdfa8642d7"
im = Image.open(src)
print("info:", {k:v for k,v in im.info.items() if k!='icc_profile'})
# PNG chunks
with open(src,'rb') as f:
    data = f.read()
pos=8
while pos < len(data):
    ln = struct.unpack(">I", data[pos:pos+4])[0]
    typ = data[pos+4:pos+8].decode('latin1')
    print("chunk", typ, ln)
    pos += 12+ln
a = np.array(im.convert("RGBA")).astype(np.int16)
al=a[...,3]; r,g,b=a[...,0],a[...,1],a[...,2]
red=(r>200)&(g<90)&(b<90)&(al>0)
print("red alpha percentiles", np.percentile(al[red],[50,75,90,99,100]))
print("red alpha >200 count", int((al[red]>200).sum()), "of", int(red.sum()))
# composite over white and save full + a top-left crop x3
comp = Image.new("RGBA", im.size, (255,255,255,255))
comp.alpha_composite(im.convert("RGBA"))
comp.convert("RGB").save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_fb_white.png")
comp.convert("RGB").crop((0,0,420,420)).resize((840,840), Image.NEAREST).save(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\_fb_tl.png")
