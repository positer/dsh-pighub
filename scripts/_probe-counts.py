
import json, os
BASE = os.path.abspath('.')
m = json.load(open(os.path.join(BASE,'assets/manifest.json'), encoding='utf-8'))
pigs = m['pigs']
files = set()
for p in pigs:
    files.add(os.path.basename(p['file']))
on_disk = set(os.listdir(os.path.join(BASE,'assets/img')))
print('manifest pigs:', len(pigs))
print('assets/img files:', len(on_disk))
print('orphan files (on disk, not in manifest):', sorted(on_disk - files))
print('missing files (in manifest, not on disk):', sorted(files - on_disk))
print('counts:', json.dumps(m['counts']))
