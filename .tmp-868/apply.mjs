
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

copyFileSync('.tmp-868/C.png', 'assets/img/pighub-868.png');

const MP = 'assets/manifest.json';
const raw = readFileSync(MP, 'utf8');
const m = JSON.parse(raw);
const rt = JSON.stringify(m, null, 2) + '\n';
console.log('roundtrip byte-identical:', rt === raw, raw.length, rt.length);

const pig = m.pigs.find((p) => p.id === 'pighub-868');
const buf = readFileSync('assets/img/pighub-868.png');
const sha = createHash('sha256').update(buf).digest('hex');
const before = { bytes: pig.bytes, sha256: pig.sha256, sizeRatio: pig.sizeRatio, incomplete: pig.incomplete };
pig.bytes = buf.length;
pig.sha256 = sha;
pig.sizeRatio = 84.24;
delete pig.incomplete;
delete pig.incompleteReason;
const out = JSON.stringify(m, null, 2) + '\n';
writeFileSync(MP, out);
console.log('before:', JSON.stringify(before));
console.log('after :', JSON.stringify({ bytes: pig.bytes, sha256: sha.slice(0,16)+'...', sizeRatio: pig.sizeRatio, incomplete: pig.incomplete === true }));
console.log('entry keys:', Object.keys(pig).join(','));
