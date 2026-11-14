
import numpy as np
from PIL import Image
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub"
ref = Image.open(base + r"\assets\img\pen-fence.png").convert("RGBA")
ref452 = ref.resize((452, 452), Image.LANCZOS)
render = Image.open(base + r"\tmp\pen-shots\pen-empty.png").convert("RGB").crop((0, 0, 452, 452))
with_house = np.array(Image.open(base + r"\tmp\pen-shots\pen-house.png").convert("RGB")).astype(np.int32)[:, :452]
no_house = np.array(Image.open(base + r"\tmp\pen-shots\pen-house-off.png").convert("RGB")).astype(np.int32)[:, :452]
house_mask = np.abs(with_house - no_house).max(axis=2) > 6
grass = render.getpixel((226, 300))
canvas = Image.new("RGB", (452, 452), grass); canvas.paste(ref452, (0, 0), ref452)
a = np.array(canvas).astype(np.int32); b = np.array(render).astype(np.int32)
alpha = np.array(ref452)[:, :, 3]
opaque = alpha >= 250
d = np.abs(a - b).max(axis=2)
for name, mask in (("围栏不透明像素（含被小屋压住的那一块）", opaque),
                   ("围栏不透明像素（**排除**小屋覆盖区）", opaque & ~house_mask)):
    v = d[mask]
    print("%-34s 像素 %6d  最大 %3d  均值 %.2f  >8/255 %.3f%%" % (name, mask.sum(), int(v.max()), float(v.mean()), float((v > 8).mean()*100)))
# 三联图（用排除小屋的差异图，免得把"小屋压住栅栏"当成品红误读）
diff = np.where(house_mask, 0, d)
panel = Image.new("RGB", (452*3 + 20, 452 + 24), (245, 246, 247))
panel.paste(canvas, (0, 24)); panel.paste(render, (462, 24))
panel.paste(Image.fromarray(np.clip(diff*4, 0, 255).astype(np.uint8)).convert("RGB"), (924, 24))
panel.save(base + r"\tmp\pen-shots\_compare-ref.png")
print("wrote _compare-ref.png (左=原图 452，中=猪圈渲染，右=差异 x4，小屋覆盖区略去)")
