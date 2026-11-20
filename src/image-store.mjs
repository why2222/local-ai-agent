import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.mjs';

const SIGNATURES = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export const IMAGE_MIME_TYPES = Object.keys(SIGNATURES);

export class ImageValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function matchesSignature(buffer, mimeType) {
  const sig = SIGNATURES[mimeType];
  if (!sig || buffer.length < sig.length) return false;
  return sig.every((byte, i) => buffer[i] === byte);
}

function detectMime(buffer) {
  for (const [mimeType, sig] of Object.entries(SIGNATURES)) {
    if (matchesSignature(buffer, mimeType)) return mimeType;
  }
  return null;
}

// 校验 Content-Type 与文件签名，通过后按 chatId/imageId 落盘。
export async function saveImage(chatId, buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageValidationError('empty-body', '请求体为空');
  }
  if (buffer.length > CONFIG.maxImageBytes) {
    throw new ImageValidationError(
      'too-large',
      `图片超过大小限制 ${Math.floor(CONFIG.maxImageBytes / 1024 / 1024)} MiB`,
    );
  }
  const declared = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!SIGNATURES[declared]) {
    throw new ImageValidationError('unsupported-type', '仅支持 image/jpeg 或 image/png');
  }
  const actual = detectMime(buffer);
  if (actual !== declared) {
    throw new ImageValidationError('signature-mismatch', '文件内容与声明的格式不一致');
  }

  const id = randomUUID();
  const ext = declared === 'image/png' ? 'png' : 'jpg';
  const dir = path.join(CONFIG.imagesDir, chatId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.${ext}`);
  await writeFile(filePath, buffer);

  return { id, chatId, mimeType: declared, ext, size: buffer.length };
}

function imageFilePath(chatId, imageId, ext) {
  return path.join(CONFIG.imagesDir, chatId, `${imageId}.${ext}`);
}

export async function readImage(chatId, imageId) {
  for (const ext of ['jpg', 'png']) {
    const filePath = imageFilePath(chatId, imageId, ext);
    try {
      const buffer = await readFile(filePath);
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      return { buffer, mimeType };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return null;
}

export async function imageExists(chatId, imageId) {
  for (const ext of ['jpg', 'png']) {
    try {
      await access(imageFilePath(chatId, imageId, ext));
      return true;
    } catch {
      // try next extension
    }
  }
  return false;
}

export async function deleteChatImages(chatId) {
  await rm(path.join(CONFIG.imagesDir, chatId), { recursive: true, force: true });
}
