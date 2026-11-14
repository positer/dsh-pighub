
import numpy as np
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
ref = Image.open(base + r"\assets\img\pen-fence.png").convert("RGBA")
ref452 = ref.resize((452, 452), Image.LANCZOS)
render = Image.open(base + r"\tmp\pen-shots\pen-empty.png").convert("RGB").crop((0, 0, 452, 452))
# 参考图铺到同一块绿底上（渲染里围栏下面是草地）
grass = render.getpixel((226, 300))
canvas = Image.new("RGB", (452, 452), grass)
canvas.paste(ref452, (0, 0), ref452)
a = np.array(canvas).astype(np.int32); b = np.array(render).astype(np.int32)
alpha = np.array(ref452)[:, :, 3]
mask = alpha >= 250          # 完全不透明的围栏像素：抗锯齿边不看（两边混合的背景不同，本来就该不同）
d = np.abs(a - b).max(axis=2)
print("不透明围栏像素数:", int(mask.sum()), "/(452^2 = 204304)")
print("差异（仅不透明像素）：最大 %d  均值 %.2f  >8/255 的比例 %.3f%%" % (int(d[mask].max()), float(d[mask].mean()), float((d[mask] > 8).mean()*100)))
# 三联图：参考 | 渲染 | 放大 4 倍的差异
diff = np.clip(d * 4, 0, 255).astype(np.uint8)
panel = Image.new("RGB", (452*3 + 20, 452 + 24), (245, 246, 247))
panel.paste(canvas, (0, 24)); panel.paste(render, (462, 24))
panel.paste(Image.fromarray(diff).convert("RGB"), (924, 24))
panel.save(base + r"\tmp\pen-shots\_compare-ref.png")
# 参考图单独存一张 452 的，便于并排
canvas.save(base + r"\tmp\pen-shots\_ref452.png")
print("wrote _compare-ref.png / _ref452.png")
