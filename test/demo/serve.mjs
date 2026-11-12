/**
 * 验证台的静态服务器（只为本地开发与取证用，不是产品的一部分）。
 *
 * 为什么需要：验证台要用 `fetch` 读本地文件，`file://` 下会被浏览器的同源策略拦住。
 *
 * 用法：node test/demo/serve.mjs [port]      # 端口 0 = 让系统分配，会打印实际端口
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.argv[2] || 0);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.img': 'image/jpeg',
};

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  const file = resolve(join(root, pathname));
  // 只服务包目录内的文件：验证台不需要访问别处，也就不该开这个口子。
  if (!file.startsWith(root)) { response.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('验证台: http://127.0.0.1:' + server.address().port + '/test/demo/pighub-demo.html');
});
