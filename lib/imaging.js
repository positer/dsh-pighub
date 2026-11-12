/**
 * 素材处理（**构建期**跑在开发者机器上，不进浏览器、不进运行时）。
 *
 * 为什么搬到 Node 侧：用户口径是「素材本地处理好后打包进包内，脱离库调用，
 * 不要求用户算力处理素材」。所以去白底、裁到猪身、描摹成 SVG 全部在 `npm run assets:build`
 * 时完成，产物是普通文件；运行时只负责显示一个本地文件。
 *
 * 这里的函数都是纯函数（只吃 RGBA 数组），因此可以直接被 test/*.mjs 单测。
 */

export const TRACE_MAX_COLORS = 6;
export const TRACE_EPSILON = 1.15;
export const TRACE_MAX_EDGE = 220;
export const INK_DENSE = 0.32;
export const WHITE_MIN = 236;
/* ------------------------------------------------- 矢量图化（描摹成 SVG） */
/*
 * 为什么做：位图放大就糊。猪猪图多是**平涂卡通**，非常适合描摹成少量色块 + 路径；
 * 描成 SVG 之后由浏览器按显示尺寸重新栅格化，放多大都不糊。
 *
 * 做法（不依赖任何库，全在浏览器里）：
 *   1. 量化：把已抠底的位图压到最多 6 个色块（透明像素不参与）；
 *   2. 等值线：对每个色块用 marching squares 抽边界环（内外环一视同仁，靠 evenodd 填）；
 *   3. 简化：Douglas–Peucker，把像素锯齿压成折线；
 *   4. 输出 <svg viewBox=...><path fill-rule=evenodd/></svg>，转 data URL。
 *
 * 注意：这是「平涂描摹」，不是照片级矢量化。场景类整图（照片/海报）描出来会很脏，
 * 所以是否描摹跟着**逐图判定**走（judgements.json 的 vector 字段），而不是一刀切。
 */



/** 把 RGBA 压成「色块索引图」：透明 = -1，其余按 5 bit 桶聚类后合并到最常见的 K 种。 */
export function quantize(frame) {
  const { width, height, data } = frame;
  const counts = new Map();
  const buckets = new Int16Array(width * height).fill(-1);
  for (let index = 0; index < width * height; index += 1) {
    const alpha = data[index * 4 + 3];
    if (alpha < 24) continue;
    const r = data[index * 4], g = data[index * 4 + 1], b = data[index * 4 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
    buckets[index] = key;
  }
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TRACE_MAX_COLORS);
  const indexOf = new Map(palette.map(([key], index) => [key, index]));
  const labels = new Int16Array(width * height).fill(-1);
  for (let index = 0; index < width * height; index += 1) {
    const key = buckets[index];
    if (key < 0) continue;
    // 桶不在前 K 名里，就归到最近的调色板颜色（按 5 bit 距离）。
    let label = indexOf.get(key);
    if (label === undefined) {
      let best = 0, bestDistance = 1e9;
      palette.forEach(([candidate], position) => {
        const dr = ((candidate >> 10) & 31) - ((key >> 10) & 31);
        const dg = ((candidate >> 5) & 31) - ((key >> 5) & 31);
        const db = (candidate & 31) - (key & 31);
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) { bestDistance = distance; best = position; }
      });
      label = best;
    }
    labels[index] = label;
  }
  const colors = palette.map(([key]) => {
    const r = ((key >> 10) & 31) * 8 + 4;
    const g = ((key >> 5) & 31) * 8 + 4;
    const b = (key & 31) * 8 + 4;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  });
  /*
   * 合并「小而近」的色块。
   *
   * 源图是带渐变的插画，量化后会把同一块受光面拆成一圈圈相近的色（放大就是色带）。
   * 规则：占比 < 3% **且** 与某个更大色块的距离很近（5bit 空间里 < 10）→ 并进去。
   * 反例保护：眼睛/鼻孔这类小但颜色差别大的色块（距离远）**不会**被合并。
   */
  const totals = new Array(colors.length).fill(0);
  for (const label of labels) if (label >= 0) totals[label] += 1;
  const totalPixels = totals.reduce((sum, value) => sum + value, 0) || 1;
  const remap = new Array(colors.length).fill(-1);
  for (let small = 0; small < colors.length; small += 1) {
    if (totals[small] / totalPixels >= 0.03) continue;
    const [sr, sg, sb] = colors[small].match(/\d+/g).map(Number);
    for (let big = 0; big < colors.length; big += 1) {
      if (big === small || remap[big] >= 0) continue;
      if (totals[big] / totalPixels < 0.03) continue;
      const [br, bg, bb] = colors[big].match(/\d+/g).map(Number);
      const distance = Math.abs(br - sr) + Math.abs(bg - sg) + Math.abs(bb - sb);
      if (distance <= 26) { remap[small] = big; break; }
    }
  }
  if (remap.some((value) => value >= 0)) {
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      if (label >= 0 && remap[label] >= 0) labels[index] = remap[label];
    }
  }
  return { labels: smoothLabels(labels, width, height), colors, width, height };
}

/**
 * marching squares：返回某个色块的所有闭合边界环（像素坐标）。
 *
 * 几何约定（容易写错的点）：格点取在**像素中心**，所以一个 cell 的四个角是
 * (x,y)(x+1,y)(x,y+1)(x+1,y+1)，四条边的中点分别是 top(x+.5,y) right(x+1,y+.5)
 * bottom(x+.5,y+1) left(x,y+.5)。边界外一律按「不属于该色块」处理。
 * 内外环不区分方向：最终统一用 fill-rule=evenodd 填，洞自然被挖掉。
 */
/**
 * 3×3 众数平滑，跑两遍。
 *
 * 为什么需要：原图是 JPG，平涂区域里仍有轻微渐变，量化后会出现「同色系的细条纹」，
 * 描出来就是一层层色带（放大 3 倍肉眼可见）。取邻域众数能把这类 1px 条纹吃掉，
 * 而真正的轮廓（宽度远大于 1px）不受影响。
 */
export function smoothLabels(labels, width, height) {
  let current = labels;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = Int16Array.from(current);
    const tally = new Map();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const self = current[index];
        if (self < 0) continue;
        tally.clear();
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const value = current[(y + dy) * width + (x + dx)];
            if (value < 0) continue;
            tally.set(value, (tally.get(value) || 0) + 1);
          }
        }
        let best = self, bestCount = tally.get(self) || 0;
        for (const [value, count] of tally) {
          if (count > bestCount) { best = value; bestCount = count; }
        }
        next[index] = best;
      }
    }
    current = next;
  }
  return current;
}

export function contours(labels, width, height, target) {
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : (labels[y * width + x] === target ? 1 : 0));
  /*
   * 边用**无向**方式存：每个 cell 给出的有向线段方向并不保证首尾相接，
   * 按方向链会在中途断开（实测会得到一堆「29 个点的开链、面积算不对」）。
   * 这里存边表 + 顶点邻接，串环时两边都走，闭合即止。
   */
  const edges = [];        // { a: 'x,y', b: 'x,y', used: false }
  const adjacency = new Map();
  const push = (x1, y1, x2, y2) => {
    const index = edges.length;
    edges.push({ a: x1 + ',' + y1, b: x2 + ',' + y2, used: false });
    for (const key of [x1 + ',' + y1, x2 + ',' + y2]) {
      if (!adjacency.has(key)) adjacency.set(key, []);
      adjacency.get(key).push(index);
    }
  };
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const top = [x + 0.5, y], right = [x + 1, y + 0.5];
      const bottom = [x + 0.5, y + 1], left = [x, y + 0.5];
      const seg = (a, b) => push(a[0], a[1], b[0], b[1]);
      if (code === 1) seg(left, bottom);          // 只有左下
      else if (code === 2) seg(bottom, right);    // 只有右下
      else if (code === 3) seg(left, right);      // 下侧
      else if (code === 4) seg(top, right);       // 只有右上
      else if (code === 5) { seg(left, bottom); seg(top, right); }   // 鞍点：按两块斜对处理
      else if (code === 6) seg(top, bottom);      // 右侧
      else if (code === 7) seg(left, top);        // 缺左上
      else if (code === 8) seg(left, top);        // 只有左上
      else if (code === 9) seg(top, bottom);      // 左侧
      else if (code === 10) { seg(left, top); seg(bottom, right); }  // 鞍点（另一种斜对）
      else if (code === 11) seg(right, top);      // 缺右上
      else if (code === 12) seg(left, right);     // 上侧
      else if (code === 13) seg(bottom, right);   // 缺右下
      else if (code === 14) seg(left, bottom);    // 缺左下
    }
  }
  const loops = [];
  for (let index = 0; index < edges.length; index += 1) {
    if (edges[index].used) continue;
    const first = edges[index];
    edges[index].used = true;
    const startKey = first.a;
    const loop = [startKey.split(',').map(Number)];
    let current = first.b;
    for (let step = 0; step < 100000; step += 1) {
      if (current === startKey) break;
      loop.push(current.split(',').map(Number));
      const candidates = adjacency.get(current) || [];
      let nextEdge = -1;
      for (const candidate of candidates) {
        if (!edges[candidate].used) { nextEdge = candidate; break; }
      }
      if (nextEdge < 0) break;
      const edge = edges[nextEdge];
      edge.used = true;
      current = edge.a === current ? edge.b : edge.a;
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

/** Douglas–Peucker 简化（闭合环按开折线处理，端点固定）。 */
export function simplify(points, epsilon) {
  if (points.length < 4) return points;
  const distance = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = -1, record = 0;
    for (let index = first + 1; index < last; index += 1) {
      const d = distance(points[index], points[first], points[last]);
      if (d > record) { record = d; farthest = index; }
    }
    if (farthest > 0 && record > epsilon) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** 一帧 RGBA → SVG 字符串（没有可描内容时返回 null）。 */
export function vectorise(frame, epsilon) {
  const { labels, colors, width, height } = quantize(frame);
  const paths = [];
  colors.forEach((color, index) => {
    const loops = contours(labels, width, height, index);
    let area = 0;
    loops.forEach((loop) => {
      for (let i = 0; i < loop.length - 1; i += 1) {
        area += loop[i][0] * loop[i + 1][1] - loop[i + 1][0] * loop[i][1];
      }
    });
    if (Math.abs(area) / 2 < 3) return;   // 噪点色块丢弃（面积按 shoelace/2 计）
    const d = loops.map((loop) => {
      const points = simplify(loop, epsilon || TRACE_EPSILON);
      if (points.length < 3) return '';
      const head = 'M' + points[0][0].toFixed(1) + ' ' + points[0][1].toFixed(1);
      const body = points.slice(1).map((point) => 'L' + point[0].toFixed(1) + ' ' + point[1].toFixed(1)).join('');
      return head + body + 'Z';
    }).filter(Boolean).join('');
    if (d) paths.push({ color, d, area: Math.abs(area) / 2 });
  });
  paths.sort((a, b) => b.area - a.area);
  if (paths.length === 0) return null;
  const body = paths.map((path) => '<path fill="' + path.color + '" fill-rule="evenodd" d="' + path.d + '"/>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" shape-rendering="geometricPrecision">' + body + '</svg>';
}


export function refineWhite(frame, whiteMin) {
  const { width, height, data } = frame;
  const total = width * height;
  const white = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (data[index * 4 + 3] < 24) continue;
    if (data[index * 4] >= whiteMin && data[index * 4 + 1] >= whiteMin && data[index * 4 + 2] >= whiteMin) white[index] = 1;
  }
  const seen = new Uint8Array(total);
  const stack = [];
  for (let seed = 0; seed < total; seed += 1) {
    if (!white[seed] || seen[seed]) continue;
    stack.length = 0;
    stack.push(seed);
    seen[seed] = 1;
    const members = [];
    let touchesBorder = false;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    while (stack.length) {
      const point = stack.pop();
      members.push(point);
      const x = point % width;
      const y = (point - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && white[point - 1] && !seen[point - 1]) { seen[point - 1] = 1; stack.push(point - 1); }
      if (x < width - 1 && white[point + 1] && !seen[point + 1]) { seen[point + 1] = 1; stack.push(point + 1); }
      if (y > 0 && white[point - width] && !seen[point - width]) { seen[point - width] = 1; stack.push(point - width); }
      if (y < height - 1 && white[point + width] && !seen[point + width]) { seen[point + width] = 1; stack.push(point + width); }
    }
    let remove = true;
    if (!touchesBorder) {
      const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
      let ink = 0;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const point = y * width + x;
          if (white[point]) continue;
          if (data[point * 4 + 3] < 24) continue;
          ink += 1;
        }
      }
      remove = boxArea > 0 && ink / boxArea >= INK_DENSE;
    }
    if (remove) for (const point of members) data[point * 4 + 3] = 0;
  }
  return frame;
}

/** 剩余不透明内容的外接框（踩到猪身用），留一点边避免贴死。 */
export function cropFrame(frame, x, y, w, h) {
  const source = frame.data;
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const from = ((y + row) * frame.width + x) * 4;
    out.set(source.subarray(from, from + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}

export function contentBounds(frame, pad) {
  const { width, height, data } = frame;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 24) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height, empty: true };
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    w: Math.min(width - x, maxX - minX + 1 + pad * 2),
    h: Math.min(height - y, maxY - minY + 1 + pad * 2),
  };
}
