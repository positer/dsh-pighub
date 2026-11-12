
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { refineWhite, contentBounds, cropFrame, styleScore } from './lib/imaging.js';
const dec = await sharp(readFileSync('test/demo/vendor/pigs/pig-1358.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const frame = { width: dec.info.width, height: dec.info.height, data: dec.data };
// 现状：judgements.json 里 pig-1358 的 cut.trim=[0,0,1,1]、white=236、无 work → refineWhite(边框连通白)
const f = { width: frame.width, height: frame.height, data: Uint8Array.from(frame.data) };
refineWhite(f, 236);
const box = contentBounds(f, 1);
const cropped = cropFrame(f, box.x, box.y, box.w, box.h);
console.log('BEFORE (current spec) size', cropped.width + 'x' + cropped.height, 'style', JSON.stringify(styleScore(cropped)));
