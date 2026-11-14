
import re
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
html = open(base + r"\pen-house.html", encoding="utf-8").read()
m = re.search(r'<div class="pighub-house"[^>]*>.*?</div>', html, re.S)
assert m, "没找到小屋 div"
out = html[:m.start()] + html[m.end():]
open(base + r"\pen-house-off.html", "w", encoding="utf-8").write(out)
print("wrote pen-house-off.html")
