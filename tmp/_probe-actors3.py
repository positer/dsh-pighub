
import re
html = open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots\pen-edges.html", encoding="utf-8").read()
i = html.find('data-pig=')
print(repr(html[i-200:i+700]))
print("=== count data-pig:", html.count("data-pig="))
