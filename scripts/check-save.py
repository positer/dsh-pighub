import json, os, subprocess
ROOT = r'C:/Users/12252/Desktop/Files/Code/PigHub/dsh-pighub'
state_p = os.path.join(os.path.expanduser('~'), '.PigHub', 'state.json')
st = json.load(open(state_p, encoding='utf-8'))
man = json.load(open(os.path.join(ROOT,'assets','manifest.json'), encoding='utf-8'))
ids = {p['id'] for p in man['pigs']}
owned = list(st.get('pigs', {}).keys())
store = st.get('store', [])
pets = st.get('pets', [])
missing = [i for i in owned if i not in ids]
missing_store = [i for i in store if i not in ids]
missing_pets = [i for i in pets if i not in ids]
print('state 里拥有', len(owned), '只；清单', len(ids), '只')
print('pigs 里缺失:', missing)
print('store 里缺失:', missing_store)
print('pets 里缺失:', missing_pets)
print('todayPigId =', st.get('todayPigId'))
print('migratedFrom =', json.dumps(st.get('migratedFrom'), ensure_ascii=False)[:300])
# 在 git 历史里找「为猪着迷」
raw = subprocess.check_output(['git','show','HEAD:assets/manifest.json'], cwd=ROOT)
hist = json.loads(raw.decode('utf-8'))
hit = [ (p['id'], p.get('title')) for p in hist['pigs'] if '着迷' in str(p.get('title','')) ]
print('历史清单里含「着迷」:', hit)