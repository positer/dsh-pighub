
import re
html = open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots\pen-edges.html", encoding="utf-8").read()
for m in re.finditer(r'<div class="pighub-actor[^"]*" data-pig="([^"]*)" style="([^"]*)"', html):
    print("pig", m.group(1), "->", m.group(2))
print("--- images ---")
for m in re.finditer(r'<img src="([^"]*)"[^>]*>', html):
    print(m.group(1))
