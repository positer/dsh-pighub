/**
 * 矢量描摹的单元测试。
 *
 * 被测代码**直接从 lib/client.js 里取**（@trace:begin…@trace:end 之间）：
 * client.js 是闭包工厂，没法 import；复制一份来测，测的就不是发布出去的那份。
 * 取出来的是一段纯函数代码，没有 DOM 依赖，可以在 Node 里直接跑。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const begin = source.indexOf('/* @trace:begin');
const end = source.indexOf('/* @trace:end */');
assert.ok(begin >= 0 && end > begin, 'bundle 里找不到 @trace 标记');
const slice = source.slice(source.indexOf('*/', begin) + 2, end);
const trace = new Function(slice + 'return { vectorise, quantize, contours };')();

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('PASS  ' + label); };

/** 造一帧 RGBA：painter(x, y) 返回 [r,g,b,a] 或 null（透明）。 */
function frameOf(width, height, painter) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = painter(x, y);
      const index = (y * width + x) * 4;
      if (!pixel) continue;
      data[index] = pixel[0]; data[index + 1] = pixel[1]; data[index + 2] = pixel[2]; data[index + 3] = pixel[3];
    }
  }
  return { width, height, data };
}

check('量化：透明像素不入调色板，最多 6 个色块', () => {
  const frame = frameOf(8, 8, (x, y) => (x < 4 ? [255, 0, 0, 255] : (y < 4 ? [0, 0, 255, 255] : null)));
  const quantized = trace.quantize(frame);
  assert.ok(quantized.colors.length >= 1 && quantized.colors.length <= 6);
  assert.equal(quantized.labels[0], 0, '左上角应是占比最大的颜色');
});

check('方形色块 → 1 个 path，viewBox 等于图像尺寸', () => {
  const frame = frameOf(20, 20, (x, y) => (x >= 5 && x < 15 && y >= 5 && y < 15 ? [255, 0, 0, 255] : null));
  const svg = trace.vectorise(frame);
  assert.ok(svg, '应产出 SVG');
  assert.ok(svg.startsWith('<svg'), '以 <svg 开头');
  assert.ok(svg.indexOf('viewBox="0 0 20 20"') > 0, 'viewBox 必须是图像尺寸：' + svg.slice(0, 120));
  assert.equal((svg.match(/<path /g) || []).length, 1, '一个色块应该只有一个 path');
  assert.ok(svg.indexOf('fill-rule="evenodd"') > 0, '必须用 evenodd 才能挖洞');
  assert.equal(/NaN|Infinity/.test(svg), false, '不能出现 NaN/Infinity');
});

check('带洞的环 → 同一条 path 里两个子路径（evenodd 挖洞）', () => {
  const frame = frameOf(24, 24, (x, y) => {
    const outer = x >= 4 && x < 20 && y >= 4 && y < 20;
    const hole = x >= 9 && x < 15 && y >= 9 && y < 15;
    return outer && !hole ? [255, 0, 0, 255] : null;
  });
  const svg = trace.vectorise(frame);
  assert.ok(svg);
  const pathCount = (svg.match(/<path /g) || []).length;
  assert.equal(pathCount, 1, '同一颜色应合并成一条 path，实际 ' + pathCount);
  const moves = (svg.match(/M/g) || []).length;
  assert.ok(moves >= 2, '应有两个子路径（外环 + 内环），实际 M 数 ' + moves);
});

check('两种颜色 → 两条 path，且面积大的先画', () => {
  const frame = frameOf(20, 20, (x, y) => {
    if (x >= 0 && x < 14 && y >= 0 && y < 14) return [255, 0, 0, 255];
    if (x >= 15 && x < 19 && y >= 15 && y < 19) return [0, 0, 255, 255];
    return null;
  });
  const svg = trace.vectorise(frame);
  const paths = svg.match(/<path [^>]*>/g) || [];
  assert.equal(paths.length, 2, '应有两个色块，实际 ' + paths.length);
  const firstFill = (paths[0].match(/fill="([^"]+)"/) || [])[1] || '';
  const red = firstFill.match(/rgb\((\d+),(\d+),(\d+)\)/);
  assert.ok(red && Number(red[1]) > 200 && Number(red[3]) < 60, '大面积红色应先画，实际 ' + firstFill);
});

check('全透明 → 不产出 SVG（调用方退回位图）', () => {
  const frame = frameOf(10, 10, () => null);
  assert.equal(trace.vectorise(frame), null);
});

check('噪点色块被丢弃（面积过小不生成路径）', () => {
  const frame = frameOf(30, 30, (x, y) => {
    if (x === 3 && y === 3) return [0, 255, 0, 255];
    if (x >= 10 && x < 20 && y >= 10 && y < 20) return [255, 0, 0, 255];
    return null;
  });
  const svg = trace.vectorise(frame);
  assert.ok(svg);
  assert.equal((svg.match(/<path /g) || []).length, 1, '1 像素的噪点不该成为一条 path');
});

check('同一输入两次描摹结果完全一致（可复现）', () => {
  const build = () => frameOf(18, 18, (x, y) => (x > 2 && x < 16 && y > 2 && y < 16 ? [10, 200, 30, 255] : null));
  assert.equal(trace.vectorise(build()), trace.vectorise(build()));
});

check('输出是自包含 SVG（无外部引用、可作 img.src）', () => {
  const frame = frameOf(16, 16, (x, y) => (x > 3 && x < 12 && y > 3 && y < 12 ? [200, 40, 40, 255] : null));
  const svg = trace.vectorise(frame);
  assert.ok(svg.indexOf('xmlns="http://www.w3.org/2000/svg"') > 0, '必须带 xmlns 才能当图片用');
  assert.equal(/href=|<image|<script/.test(svg), false, '不能引用外部资源');
});

console.log('\n' + passed + ' PASS / 0 FAIL  —  vector tracer');
