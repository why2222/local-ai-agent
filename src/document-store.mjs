import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.mjs';
import { extractTextFromFile, chunkDocument } from './document-extract.mjs';

function documentDir(chatId) {
  return path.join(CONFIG.dataDir, 'documents', chatId);
}

export async function saveDocument(chatId, buffer, ext, name) {
  const id = randomUUID();
  const dir = documentDir(chatId);
  await mkdir(dir, { recursive: true });
  const rawPath = path.join(dir, `${id}${ext}`);
  await writeFile(rawPath, buffer);
  const text = await extractTextFromFile(rawPath, ext);
  await writeFile(path.join(dir, `${id}.extracted.txt`), text, 'utf8');
  const meta = {
    id, name, ext, size: buffer.length, textChars: text.length,
    batches: chunkDocument(text).length,
  };
  await writeFile(path.join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export async function readDocumentMeta(chatId, docId) {
  return JSON.parse(await readFile(path.join(documentDir(chatId), `${docId}.meta.json`), 'utf8'));
}

export async function readDocumentBatches(chatId, docId) {
  const text = await readFile(path.join(documentDir(chatId), `${docId}.extracted.txt`), 'utf8');
  return chunkDocument(text);
}

export async function readDocumentRaw(chatId, docId) {
  const files = await readdir(documentDir(chatId));
  const raw = files.find((f) => f.startsWith(`${docId}.`) && !f.endsWith('.extracted.txt') && !f.endsWith('.meta.json'));
  if (!raw) return null;
  return { buffer: await readFile(path.join(documentDir(chatId), raw)), ext: path.extname(raw).toLowerCase() };
}
