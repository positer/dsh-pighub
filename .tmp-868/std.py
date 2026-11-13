
import numpy as np
from PIL import Image
import importlib.util
spec = importlib.util.spec_from_file_location("b", "scripts/_868-belly.py")
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

def prof(p):
    a = np.array(Image.open(p).convert("RGBA")); al = a[:,:,3] > 16
    out=[]
    for x in range(a.shape[1]):
        ys=np.nonzero(al[:,x])[0]
        out.append(int(ys.max()) if len(ys) else -1)
    return np.array(out)

# standard pig: measure belly underside between the front legs and the back legs.
p = prof("assets/img/standard-pig.png")
sel = [x for x in range(150, 260)]           # 它的腹部下缘那一段（见前面 runs）
q = p[sel]
print("standard-pig belly cols 150..259 bottom profile:")
print(" ", " ".join(str(v) for v in q[::5]))
print("  strict flat run:", b.flat_run(q), " near-flat(<=1px):", b.near_flat_run(q))
print("  span of y:", int(q.max()-q.min()))
print("  scale to 256/462 = %.3f" % (256/462))
print("  near-flat run normalised to 256px canvas: %.0f cols" % (b.near_flat_run(q)*256/462))
