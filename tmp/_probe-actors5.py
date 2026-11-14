
import re
for name in ("pen-edges","pen-top","pen-bottom"):
    html = open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots\%s.html" % name, encoding="utf-8").read()
    print("==", name)
    for m in re.finditer(r'<div data-pig="([^"]*)" class="([^"]*)" style="([^"]*)"', html):
        print("  pig", m.group(1), m.group(2), "|", m.group(3))
