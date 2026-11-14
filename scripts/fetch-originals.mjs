/** 从源头重新抓原始素材（用户口径 2026-11-14：补全不得改动原图，先要有原图做基线）。 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const manifest = JSON.parse(readFileSync(join(root, 'assets/manifest.json'), 'utf8'));
const outDir = join(root, 'assets/originals');
mkdirSync(outDir, { recursive: true });

let ok = 0, skipped = 0, failed = 0, mismatch = 0;
const failures = [];
for (const pig of manifest.pigs) {
  const url = pig.source && pig.source.url;
  const name = pig.file.split('/').pop();
  const dest = join(outDir, name);
  if (!url) { skipped += 1; continue; }
  if (existsSync(dest)) { skipped += 1; continue; }
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'dsh-pighub/audit' } });
    if (!res.ok) { failed += 1; failures.push(name + ' http' + res.status); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(buf).digest('hex');
    if (pig.source.sha256 && sha !== pig.source.sha256) { mismatch += 1; failures.push(name + ' sha_mismatch'); }
    writeFileSync(dest, buf);
    ok += 1;
  } catch (error) { failed += 1; failures.push(name + ' ' + String(error && error.message).slice(0, 60)); }
}
console.log(JSON.stringify({ ok, skipped, failed, mismatch, total: manifest.pigs.length, failures: failures.slice(0, 8) }, null, 2));