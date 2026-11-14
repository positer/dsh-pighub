
import re
html = open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots\pen-edges.html", encoding="utf-8").read()
i = html.find('pighub-actor')
print(repr(html[i-160:i+900]))
