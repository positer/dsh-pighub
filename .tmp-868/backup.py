
import os, shutil, hashlib
os.makedirs("archive/asset-backup", exist_ok=True)
src = "assets/img/pighub-868.png"
dst = "archive/asset-backup/pighub-868.before-bellyfix.png"
shutil.copy2(src, dst)
def sha(p): return hashlib.sha256(open(p,"rb").read()).hexdigest()
print("backup ->", dst, len(open(dst,"rb").read()), sha(dst))
print("src bytes", len(open(src,"rb").read()), sha(src))
print("existing backups in archive/asset-backup:", sorted(os.listdir("archive/asset-backup")))
