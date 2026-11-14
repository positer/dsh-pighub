
import re
shots = r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\tmp\pen-shots"
html = open(shots + r"\pen-empty.html", encoding="utf-8").read()
# 只有草地（把两层栅栏整段删掉）：这样量到的绿色范围就是**草地层**的范围，不再混进栅栏自带的草丛。
out = re.sub(r'<div class="pighub-fence is-(back|front)"[^>]*><div class="pighub-fence-shot"[^>]*></div></div>', '', html)
assert out.count('class="pighub-fence is-back"') == 0 and out.count('class="pighub-fence is-front"') == 0
open(shots + r"\pen-meadow.html", "w", encoding="utf-8").write(out)
print("meadow-only page written")
