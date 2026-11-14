
import re
base = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
html = open(base + r"\pen-empty.html", encoding="utf-8").read()
for name, colour in (("pen-light", "#ffffff"), ("pen-dark", "#111315")):
    out = html.replace("#stage{display:flex;padding:0;background:#f5f6f7;width:max-content}",
                       "#stage{display:flex;padding:0;background:%s;width:max-content}" % colour)
    out = out.replace("background:#fff;font-family", "background:%s;font-family" % colour)
    open(base + "\\" + name + ".html", "w", encoding="utf-8").write(out)
    print("wrote", name, colour)
