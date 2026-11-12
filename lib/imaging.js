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

/* --------------------------------------------------------------- 逐素材微调 */
/*
 * 这几步不是为了「自动化」而存在的，而是让**每个素材的专项处理**有可写的落点：
 * 一张图该留哪块白（文字框）、该删哪个多余配件、要不要描一圈边，都是逐图判断，
 * 写进 assets/work/<id>.json，构建时确定性地执行。
 */

/** 归一化矩形 → 像素矩形（相对被裁后的图）。 */
function rectOf(frame, rect) {
  const [x, y, w, h] = rect;
  // 与帧求交：起点可能落在帧外（work 里的框按原图坐标给，裁切后就可能越界），
  // 越界时必须同时收窄宽度，否则「负起点 + 原宽度」会扩成整帧，把图整块清掉。
  const x0 = Math.max(0, Math.round(frame.width * x));
  const y0 = Math.max(0, Math.round(frame.height * y));
  const x1 = Math.min(frame.width, Math.round(frame.width * (x + w)));
  const y1 = Math.min(frame.height, Math.round(frame.height * (y + h)));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** 文字框：这些区域里的白**强制保留**（对白气泡、屏幕清单）。source 是去白前的帧。 */
export function restoreRects(frame, source, rects) {
  for (const rect of rects || []) {
    const { x, y, w, h } = rectOf(frame, rect);
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        const index = (row * frame.width + col) * 4;
        frame.data[index] = source.data[index];
        frame.data[index + 1] = source.data[index + 1];
        frame.data[index + 2] = source.data[index + 2];
        frame.data[index + 3] = source.data[index + 3];
      }
    }
  }
  return frame;
}

/** 去掉多余配件：这些区域整块清成透明（例：显示器、加油机、罚单）。 */
export function eraseRects(frame, rects) {
  for (const rect of rects || []) {
    const { x, y, w, h } = rectOf(frame, rect);
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        frame.data[(row * frame.width + col) * 4 + 3] = 0;
      }
    }
  }
  return frame;
}

/**
 * 描图边：把不透明区域向外扩 width 像素，扩出来的那圈填成描边色，再盖回原图。
 * 用 box 膨胀而不是分轮廓再描线：结果一样，但不需要处理自交与孔洞。
 */
export function addOutline(frame, width, color) {
  const radius = Math.max(1, Math.round(width));
  const { width: w, height: h, data } = frame;
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) if (data[i * 4 + 3] > 24) opaque[i] = 1;
  const [r, g, b] = color;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x;
      if (opaque[index]) continue;
      let near = false;
      for (let dy = -radius; dy <= radius && !near; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (opaque[ny * w + nx]) { near = true; break; }
        }
      }
      if (!near) continue;
      out[index * 4] = r;
      out[index * 4 + 1] = g;
      out[index * 4 + 2] = b;
      out[index * 4 + 3] = 255;
    }
  }
  // 原图盖在描边之上
  for (let i = 0; i < w * h; i += 1) {
    if (!opaque[i]) continue;
    out[i * 4] = data[i * 4];
    out[i * 4 + 1] = data[i * 4 + 1];
    out[i * 4 + 2] = data[i * 4 + 2];
    out[i * 4 + 3] = data[i * 4 + 3];
  }
  return { width: w, height: h, data: new Uint8Array(out) };
}

/**
 * 删掉**所有**近白像素（不区分是否与四边连通）。
 *
 * 什么时候用：素材已经被裁成「纯猪贴纸」，画面里唯一该透明的就是白——此时尾巴卷曲内侧
 * 那种封闭白也应当删（默认的「只删四边连通白」会留着它）。对含信息的场景图不要用。
 */
export function stripAllWhite(frame, whiteMin) {
  const { width, height, data } = frame;
  for (let i = 0; i < width * height; i += 1) {
    if (data[i * 4 + 3] < 24) continue;
    if (data[i * 4] >= whiteMin && data[i * 4 + 1] >= whiteMin && data[i * 4 + 2] >= whiteMin) data[i * 4 + 3] = 0;
  }
  return frame;
}

/* ------------------------------------------------------------- 风格校验 */
/*
 * 「风格化校验」要回答的是：这张图**是不是同一种画风**，而不是「里面有没有猪字」。
 * 于是不看文件名、不看标题、不看文字，只看像素的颜色分布——PigHub 这类猪的共同风格是
 * 低饱和桃色身体 + 玫红点缀 + 深色描边，配合扁平的色块（几乎没有高频细节）。
 *
 * 三项指标：
 *   palette  —— 落在桃色/玫红/深描边三段色带里的像素占比（画风越统一越高）；
 *   flatness —— 相邻像素差异很小，说明是平涂而不是照片/截图；
 *   verdict  —— palette ≥ 0.55 且 flatness ≥ 0.35 记为 match，否则 reject。
 * reject 的素材不打包，除非逐素材规格里显式 override 并写明理由。
 */
const STYLE = { paletteMin: 0.55, flatnessMin: 0.35 };

function hsvOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
    else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
    else h = 60 * ((r - g) / (max - min) + 4);
  }
  return [h < 0 ? h + 360 : h, s, v];
}

export function styleScore(frame) {
  const { width, height, data } = frame;
  let opaque = 0, inPalette = 0, flat = 0, compared = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const a = data[index * 4 + 3];
      if (a < 24) continue;
      opaque += 1;
      const [h, s, v] = hsvOf(data[index * 4], data[index * 4 + 1], data[index * 4 + 2]);
      const peach = h >= 10 && h <= 38 && s >= 0.12 && s <= 0.62 && v >= 0.68;
      const rose = (h >= 330 || h <= 9) && s >= 0.22 && s <= 0.85 && v >= 0.5;
      const outline = v <= 0.28;
      if (peach || rose || outline) inPalette += 1;
      if (x + 1 < width) {
        const next = (y * width + x + 1) * 4;
        compared += 1;
        if (Math.abs(data[index * 4] - data[next]) + Math.abs(data[index * 4 + 1] - data[next + 1]) + Math.abs(data[index * 4 + 2] - data[next + 2]) < 36) flat += 1;
      }
    }
  }
  const palette = opaque ? inPalette / opaque : 0;
  const flatness = compared ? flat / compared : 0;
  const verdict = palette >= STYLE.paletteMin && flatness >= STYLE.flatnessMin ? 'match' : 'reject';
  return {
    verdict,
    palette: Math.round(palette * 1000) / 1000,
    flatness: Math.round(flatness * 1000) / 1000,
    thresholds: STYLE,
  };
}

/* --------------------------------------------------------- 受损补洞 */
/*
 * 用户口径：「抠去造成主猪体受损的部分，主动用原色猜测填充」。
 *
 * 什么时候会伤到猪身：删字幕/配件时 erase 框压到猪边缘、或去白把猪身上的浅色部分一起削掉。
 * 表现为猪身内部出现透明洞。这里的做法是**只补被猪身包住的洞**：
 *   1. 从图像四边对透明像素做连通填充，够不到的就是「洞」；
 *   2. 每个洞取它外圈 2px 环上的**不透明像素中位色**当填充色（同色系、不引入新颜色）；
 *   3. 填成不透明，记下洞数与被填像素数，写进 manifest 便于追溯。
 * 外圈背景不补——那是本来就没东西的地方，补上反而糊出一圈色块。
 */
export function fillHoles(frame, options = {}) {
  // 只补「被我们抠坏的地方」：洞的外接框必须与某个 erase 框相交。
  // 源图自带的负空间（卷尾环内、腿间）是我们**想保留**的透明洞，不能填。
  const regions = Array.isArray(options.only) ? options.only : null;
  const { width, height, data } = frame;
  const total = width * height;
  const transparent = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) transparent[i] = data[i * 4 + 3] < 24 ? 1 : 0;

  // 1) 从四边做连通，标记「外面」的透明区
  const outside = new Uint8Array(total);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (!transparent[p] || outside[p]) return;
    outside[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  while (queue.length) {
    const p = queue.pop();
    const x = p % width;
    const y = (p - x) / width;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // 2) 剩下的透明像素就是洞；按连通块逐个取环上中位色填充
  const done = new Uint8Array(total);
  let holes = 0, filled = 0;
  for (let seed = 0; seed < total; seed += 1) {
    if (!transparent[seed] || outside[seed] || done[seed]) continue;
    holes += 1;
    const members = [];
    const stack = [seed];
    done[seed] = 1;
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (!transparent[q] || outside[q] || done[q]) continue;
        done[q] = 1;
        stack.push(q);
      }
    }
    // 洞的外接框：不与任何 erase 框相交就跳过（那是源图本来就有的负空间）
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (const p of members) {
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const overlaps = !regions || regions.some((rect) => {
      const { x, y, w, h } = rectOf(frame, rect);
      return minX < x + w && maxX >= x && minY < y + h && maxY >= y;
    });
    if (!overlaps) { holes -= 1; continue; }

    // 环采样：洞外扩 2px 范围内的不透明像素
    const reds = [], greens = [], blues = [];
    for (const p of members) {
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (data[q * 4 + 3] < 200) continue;
          reds.push(data[q * 4]); greens.push(data[q * 4 + 1]); blues.push(data[q * 4 + 2]);
        }
      }
    }
    const median = (list) => (list.length ? list.slice().sort((a, b) => a - b)[list.length >> 1] : 245);
    const r = median(reds), g = median(greens), bl = median(blues);
    for (const p of members) {
      data[p * 4] = r; data[p * 4 + 1] = g; data[p * 4 + 2] = bl; data[p * 4 + 3] = 255;
      filled += 1;
    }
  }
  return { holes, filled };
}

/* --------------------------------------------------------- 背景色键*/
/*
 * 现实里不是所有素材都是白底。实测「愤怒猪」就是**纯黑底**：
 * refineWhite/stripAllWhite 判据是 min(r,g,b) ≥ whiteMin，对黑底一个像素都不删。
 *
 * 所以这里把「去背景」抽象成一个可配置的色键：
 *   key: 'light' —— 从四边泛洪，删掉 min(r,g,b) ≥ threshold 的连通像素（白底，原有行为）
 *   key: 'dark'  —— 从四边泛洪，删掉 max(r,g,b) ≤ threshold 的连通像素（黑底）
 *   all: true    —— 不看连通性，全图删掉所有匹配该判据的像素（白底里的封闭白、黑底里的封闭黑）
 * 只删与画布四边连通的区域，是为了不误伤猪身上的同色细节（眼珠、鼻孔）。
 */
export function stripBackground(frame, options = {}) {
  const key = options.key === 'dark' ? 'dark' : 'light';
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 236;
  const removeAll = options.all === true;
  const { width, height, data } = frame;
  const total = width * height;
  const match = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] < 24) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const hit = key === 'dark'
      ? Math.max(r, g, b) <= threshold
      : Math.min(r, g, b) >= threshold;
    if (hit) match[i] = 1;
  }
  if (removeAll) {
    let removed = 0;
    for (let i = 0; i < total; i += 1) if (match[i]) { data[i * 4 + 3] = 0; removed += 1; }
    return { removed, mode: 'all' };
  }
  // 只删与四边连通的匹配像素
  const seen = new Uint8Array(total);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (!match[p] || seen[p]) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  let removed = 0;
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    removed += 1;
    const x = p % width;
    const y = (p - x) / width;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return { removed, mode: 'flood' };
}

/**
 * 给画面四周加透明边。
 *
 * 为什么需要：有些素材的猪**被画布四边裁切**（鼻子顶左缘、尾巴顶右缘），
 * 而 `addOutline` 只在帧内膨胀——那几条边上的描边就断了。先加一圈透明边，
 * 描边就能顺着裁切边画完整。
 */
export function padFrame(frame, pad) {
  const n = Math.max(0, Math.round(pad));
  if (!n) return frame;
  const width = frame.width + n * 2;
  const height = frame.height + n * 2;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < frame.height; y += 1) {
    const from = y * frame.width * 4;
    const to = ((y + n) * width + n) * 4;
    data.set(frame.data.subarray(from, from + frame.width * 4), to);
  }
  return { width, height, data };
}

/* ------------------------------------------------------- 最小补色 */
/*
 * 场景：猪身上的字（水印/名字/台词）与猪身粘连，只能连猪身一起擦掉。
 * 「最小补色」= **只补被擦掉的那一块**，用紧邻的猪身颜色一点一点长进去，
 * 而不是整片糊一个中位色（那会在猪身上留下一个色块）。
 *
 * 做法是多源 BFS 的颜色扩散：
 *   1. 起点 = 与待补区相邻的**不透明**像素；
 *   2. 按距离一层层向里填，每个新像素取已填邻居的均值；
 *   3. 只填「外接框与某个 erase 框相交」的透明区，其余透明区原样保留。
 * 这样补出来的颜色是连续的，且不会扩散到擦除区之外。
 */
export function patchMinimal(frame, options = {}) {
  const regions = Array.isArray(options.only) ? options.only : [];
  if (!regions.length) return { holes: 0, filled: 0, mode: 'none' };
  const { width, height, data } = frame;
  const total = width * height;
  const inside = new Uint8Array(total);
  for (const rect of regions) {
    const { x, y, w, h } = rectOf(frame, rect);
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        const p = row * width + col;
        if (data[p * 4 + 3] < 24) inside[p] = 1;
      }
    }
  }
  // 队列：先放「紧邻不透明像素」的待补像素
  let frontier = [];
  for (let p = 0; p < total; p += 1) {
    if (!inside[p]) continue;
    const x = p % width; const y = (p - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (data[(ny * width + nx) * 4 + 3] >= 24) { frontier.push(p); dy = 2; break; }
      }
    }
  }
  let filled = 0;
  const filledMask = new Uint8Array(total);
  while (frontier.length) {
    const next = [];
    for (const p of frontier) {
      if (filledMask[p]) continue;
      const x = p % width; const y = (p - x) / width;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!filledMask[q] && data[q * 4 + 3] < 24) continue;
          r += data[q * 4]; g += data[q * 4 + 1]; b += data[q * 4 + 2]; n += 1;
        }
      }
      if (!n) { next.push(p); continue; }
      data[p * 4] = Math.round(r / n);
      data[p * 4 + 1] = Math.round(g / n);
      data[p * 4 + 2] = Math.round(b / n);
      data[p * 4 + 3] = 255;
      filledMask[p] = 1;
      filled += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (inside[q] && !filledMask[q]) next.push(q);
        }
      }
    }
    frontier = next;
  }
  return { holes: 1, filled, mode: 'minimal' };
}
