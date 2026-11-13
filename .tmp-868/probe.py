
import numpy as np, json, sys
from PIL import Image
sys.path.insert(0, "scripts")
import importlib.util
spec = importlib.util.spec_from_file_location("b", "scripts/_868-belly.py")
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

def load(p): return np.array(Image.open(p).convert("RGBA"))

paths = {
 "current":      "assets/img/pighub-868.png",
 "archive-after":"archive/20261113-223028-complete-all-pigs/after/pighub-868.png",
 "pre-erase?":   "archive/20261113-223028-complete-all-pigs/before/pighub-868.png",
}
for k,p in paths.items():
    a = load(p)
    print(k, a.shape, "seam(coord=247):", json.dumps(b.seam_step(a, 247)))
# bottom profile of the belly span for the current file
a = load("assets/img/pighub-868.png")
al = a[:,:,3] > 16
xs = range(27, 228)
bot = []
for x in xs:
    ys = np.nonzero(al[:, x])[0]
    bot.append(int(ys.max()) if len(ys) else -1)
bot = np.array(bot)
print("\ncurrent bottom profile x=27..227:")
print(" ".join(str(v) for v in bot))
# longest constant run
best=0; bestx=None; cur=1
for i in range(1,len(bot)):
    if bot[i]==bot[i-1]: cur+=1
    else: cur=1
    if cur>best: best=cur; bestx=(i-cur+1+27, i+27)
print("longest constant-bottom run:", best, "cols", bestx)
