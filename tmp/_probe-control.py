
import re
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
html = open(shots + r"\pen-empty.html", encoding="utf-8").read()
# 控制组：远层不裁剪（height:100%），并删掉近层 —— 等价于「把整张图只画一次」。
ctrl = html.replace('class="pighub-fence is-back" style="top:0;height:50.68%"',
                    'class="pighub-fence is-back" style="top:0;height:100%"')
m = re.search(r'<div class="pighub-fence is-front"[^>]*><div class="pighub-fence-shot"[^>]*></div></div>', ctrl)
assert m, "没找到近层 div"
ctrl = ctrl[:m.start()] + ctrl[m.end():]
open(shots + r"\pen-control.html", "w", encoding="utf-8").write(ctrl)
print("control html written; back layer:", 'height:100%' in ctrl, "front layer gone:", 'is-front' not in ctrl)
