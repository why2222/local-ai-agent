import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';

export const DOCUMENT_EXTENSIONS = [
  '.txt', '.md', '.json', '.csv', '.log', '.pdf', '.docx', '.xlsx',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rs',
  '.c', '.cpp', '.h', '.cs', '.html', '.css', '.sh', '.yml', '.yaml', '.toml', '.xml', '.sql',
];
const OFFICE_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);
const execFileAsync = promisify(execFile);

export class DocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function extractTextFromFile(filePath, ext) {
  const extension = ext.toLowerCase();
  if (!DOCUMENT_EXTENSIONS.includes(extension)) {
    throw new DocumentError('unsupported-type', `不支持的文件类型 ${extension}`);
  }
  let text;
  if (!OFFICE_EXTENSIONS.has(extension)) {
    const raw = await readFile(filePath, 'utf8');
    text = raw.replace(/^﻿/, '');
  } else if (extension === '.pdf') {
    text = await extractPdf(filePath);
  } else if (extension === '.docx') {
    text = await extractDocx(filePath);
  } else {
    text = await extractXlsx(filePath);
  }
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!text) {
    throw new DocumentError('empty-text', '未能从文件中提取到文本（扫描件请改用图片 OCR）');
  }
  return text;
}

async function extractPdf(filePath) {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], {
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    throw new DocumentError('extract-failed', `PDF 文本提取失败: ${err.message}`);
  }
}

function readZipEntries(buffer) {
  try {
    return readZipEntriesUnsafe(buffer);
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    throw new DocumentError('extract-failed', `ZIP/Office 文件解析失败: ${err.message}`);
  }
}

function readZipEntriesUnsafe(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DocumentError('extract-failed', '不是有效的 ZIP/Office 文件');
  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const size = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buffer.subarray(dataStart, dataStart + size);
    entries.set(name, method === 8 ? inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }) : data);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(xml) {
  return decodeXml(xml.replace(/<[^>]+>/g, ''));
}

async function extractDocx(filePath) {
  const entries = readZipEntries(await readFile(filePath));
  const doc = entries.get('word/document.xml');
  if (!doc) throw new DocumentError('extract-failed', 'DOCX 中未找到 document.xml');
  const withBreaks = doc.toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ');
  return stripTags(withBreaks);
}

async function extractXlsx(filePath) {
  const entries = readZipEntries(await readFile(filePath));
  const shared = [];
  const sharedXml = entries.get('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const m of sharedXml.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(stripTags(m[1]));
    }
  }
  const lines = [];
  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();
  for (const name of sheetNames) {
    const xml = entries.get(name).toString('utf8')
      .replace(/<c\b[^>]*\/>/g, '')
      .replace(/<row[^>]*\/>/g, '');
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1];
        const body = cell[2];
        const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        let value = '';
        if (attrs.includes('t="s"') && v) value = shared[Number(v[1])] ?? '';
        else if (inline) value = decodeXml(inline[1]);
        else if (v) value = decodeXml(v[1]);
        if (value) cells.push(value);
      }
      if (cells.length) lines.push(cells.join('\t'));
    }
  }
  return lines.join('\n');
}

// 汇总提示词：在 numCtx 预算内截断各片段摘要，保证 reduce 步不超上限。
export function buildSummaryPrompt(name, partials) {
  const budget = 1500;
  const per = Math.max(60, Math.floor((budget - 100) / Math.max(1, partials.length)));
  const trimmed = partials.map((p) => (p.length > per ? `${p.slice(0, per)}…（有删节）` : p));
  return `以下是文档《${name}》各片段的摘要，请合并为完整摘要与要点（中文）：\n\n${trimmed.join('\n\n---\n\n')}`;
}

// 按段落优先切分批，单批不超过 maxChars；超长段落硬切。
export function chunkDocument(text, maxChars = 1500) {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const batches = [];
  let current = '';
  const pushCurrent = () => {
    if (current) {
      batches.push(current);
      current = '';
    }
  };
  for (const para of text.split('\n\n')) {
    if (para.length > maxChars) {
      pushCurrent();
      for (let i = 0; i < para.length; i += maxChars) batches.push(para.slice(i, i + maxChars));
      continue;
    }
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChars) {
      pushCurrent();
      current = para;
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return batches;
}
