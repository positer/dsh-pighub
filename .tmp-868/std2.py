
import numpy as np
from PIL import Image
import importlib.util
spec = importlib.util.spec_from_file_location("b", "scripts/_868-belly.py")
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
def prof(p):
    a = np.array(Image.open(p).convert("RGBA")); al = a[:,:,3] > 16
    return np.array([ (int(np.nonzero(al[:,x])[0].max()) if al[:,x].any() else -1) for x in range(a.shape[1]) ])
p = prof("assets/img/standard-pig.png")
for (x0,x1,label) in [(134,167,"前腿与第二腿之间"),(239,264,"第二/第三腿之间"),(319,348,"第三/第四腿之间")]:
    q = p[x0:x1+1]
    print("%s x=%d..%d  y=%s  span=%d  strict=%d near=%d" % (
        label, x0, x1, list(q[::4]), int(q.max()-q.min()), b.flat_run(q), b.near_flat_run(q)))
print("canvas 482 wide -> normalise to 256: factor %.3f" % (256/482.0))
for (x0,x1) in [(134,167),(239,264),(319,348)]:
    q=p[x0:x1+1]; print("  normalised near-flat cols: %.0f" % (b.near_flat_run(q)*256/482.0))
