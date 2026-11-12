/**
 * 校验「要发的版本」和「tag 说的是同一个版本」。
 *
 * 为什么值得单独一个脚本：tag 与 manifest 分属两处，不一致时 npm 会把 tarball 发到
 * 一个和 tag 不匹配的版本号上，而**发布不可撤销**（72 小时后连 unpublish 都不行）。
 * 这一步放在 pack job 里、凭据之外——判据不依赖任何 secret。
 *
 * 用法：node scripts/check-version.mjs [tag]
 *   tag 省略时读 GITHUB_REF_NAME（tag push 的 ref 名）。
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const raw = (process.argv[2] || process.env.GITHUB_REF_NAME || '').trim();
const tag = raw.replace(/^refs\/tags\//, '').replace(/^v/, '');

if (!tag) {
  console.error('没有 tag 可比对：传入一个 tag，或在 GitHub Actions 的 tag push 里运行。');
  process.exit(2);
}

if (tag !== pkg.version) {
  console.error('版本不一致：tag = ' + tag + '，package.json = ' + pkg.version);
  process.exit(1);
}

console.log('OK  tag ' + raw + ' == package.json ' + pkg.version);
