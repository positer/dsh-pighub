/**
 * 最小 ZIP 读取器（主题包以 zip 分发，用户口径 2026-11-14）。
 *
 * 不引依赖：包要能离线安装。只支持现实中会遇到的两种存储方式：
 *   0 STORED（不压缩）、8 DEFLATE（node:zlib 的 inflateRawSync 正好对应裸 deflate）。
 * 其余算法一律拒绝并给出可读原因。
 *
 * 安全：三道上限（条目数 / 单文件 / 解压总量）防 zip 炸弹；名字不许穿越或绝对路径。
 */
import { inflateRawSync } from 'node:zlib';

export const ZIP_LIMITS = { entries: 500, fileBytes: 8 * 1024 * 1024, totalBytes: 40 * 1024 * 1024 };

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 66000);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

export function isSafeZipName(name) {
  const value = String(name || '').replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  const parts = value.split('/').filter(Boolean);
  return parts.length > 0 && parts.every((part) => part !== '..' && part !== '.');
}

export function readZip(buffer) {
  try {
    if (!buffer || buffer.length < 22) return { ok: false, reason: 'empty_or_too_small', files: [] };
    const eocd = findEocd(buffer);
    if (eocd < 0) return { ok: false, reason: 'not_a_zip', files: [] };
    const count = buffer.readUInt16LE(eocd + 10);
    const cdOffset = buffer.readUInt32LE(eocd + 16);
    if (count === 0) return { ok: false, reason: 'zip_has_no_entries', files: [] };
    if (count > ZIP_LIMITS.entries) return { ok: false, reason: 'too_many_entries', files: [] };
    const files = [];
    let total = 0;
    let cursor = cdOffset;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
        return { ok: false, reason: 'corrupt_central_directory', files: [] };
      }
      const method = buffer.readUInt16LE(cursor + 10);
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      const localOffset = buffer.readUInt32LE(cursor + 42);
      const name = buffer.slice(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      cursor += 46 + nameLength + extraLength + commentLength;
      if (name.endsWith('/')) continue;
      if (!isSafeZipName(name)) return { ok: false, reason: 'unsafe_entry_name:' + name, files: [] };
      if (uncompressedSize > ZIP_LIMITS.fileBytes) return { ok: false, reason: 'entry_too_large:' + name, files: [] };
      total += uncompressedSize;
      if (total > ZIP_LIMITS.totalBytes) return { ok: false, reason: 'uncompressed_too_large', files: [] };
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        return { ok: false, reason: 'corrupt_local_header:' + name, files: [] };
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.slice(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) {
        try { data = inflateRawSync(raw); } catch { return { ok: false, reason: 'inflate_failed:' + name, files: [] }; }
      } else return { ok: false, reason: 'unsupported_method:' + method + ':' + name, files: [] };
      files.push({ name, data });
    }
    return { ok: true, reason: '', files };
  } catch (error) {
    return { ok: false, reason: 'zip_read_error:' + String((error && error.message) || error).slice(0, 120), files: [] };
  }
}
