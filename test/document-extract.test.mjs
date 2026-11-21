import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { extractTextFromFile, chunkDocument, DOCUMENT_EXTENSIONS } from '../src/document-extract.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'local-ai-doc-'));

function makeZip(entries, deflate = false) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name);
    const data = deflate ? deflateRawSync(content) : content;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0, 14);
    c.writeUInt32LE(0, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(content.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt16LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

test('纯文本按 UTF-8 读取并去除 BOM', async () => {
  const file = path.join(dir, 'a.txt');
  writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好，文档')]));
  assert.equal(await extractTextFromFile(file, '.txt'), '你好，文档');
});

test('不支持的扩展名抛 unsupported-type', async () => {
  const file = path.join(dir, 'a.exe');
  writeFileSync(file, 'x');
  await assert.rejects(() => extractTextFromFile(file, '.exe'), (err) => err.code === 'unsupported-type');
});

test('docx 提取段落文本（stored 与 deflate 两种压缩）', async () => {
  const xml = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>第一段 你好</w:t></w:r></w:p><w:p><w:r><w:t>第二段 world</w:t></w:r></w:p></w:body></w:document>';
  for (const deflate of [false, true]) {
    const file = path.join(dir, `d${deflate}.docx`);
    writeFileSync(file, makeZip([['word/document.xml', Buffer.from(xml)]], deflate));
    const text = await extractTextFromFile(file, '.docx');
    assert.match(text, /第一段 你好/);
    assert.match(text, /第二段 world/);
    assert.ok(text.indexOf('第一段 你好') < text.indexOf('第二段 world'));
  }
});

test('xlsx 提取共享字符串并按行拼接', async () => {
  const shared = '<?xml version="1.0"?><sst><si><t>姓名</t></si><si><t>数量</t></si><si><t>苹果</t></si></sst>';
  const sheet = '<?xml version="1.0"?><worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>2</v></c></row><row><c t="s"><v>1</v></c><c><v>42</v></c></row></sheetData></worksheet>';
  const file = path.join(dir, 's.xlsx');
  writeFileSync(file, makeZip([
    ['xl/sharedStrings.xml', Buffer.from(shared)],
    ['xl/worksheets/sheet1.xml', Buffer.from(sheet)],
  ], true));
  const text = await extractTextFromFile(file, '.xlsx');
  assert.match(text, /姓名/);
  assert.match(text, /苹果/);
  assert.match(text, /42/);
});

test('PDF 通过 pdftotext 提取文本', async (t) => {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add('<</Type/Catalog/Pages 2 0 R>>');
  const pages = add('<</Type/Pages/Kids[3 0 R]/Count 1>>');
  const page = add('<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>');
  const content = 'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET';
  add(`<</Length ${content.length}>>stream\n${content}\nendstream`);
  add('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root ${catalog} 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;
  const file = path.join(dir, 'x.pdf');
  writeFileSync(file, pdf);
  const text = await extractTextFromFile(file, '.pdf');
  assert.match(text, /Hello PDF/);
});

test('提取结果为空时抛 empty-text', async () => {
  const file = path.join(dir, 'empty.txt');
  writeFileSync(file, '   \n  ');
  await assert.rejects(() => extractTextFromFile(file, '.txt'), (err) => err.code === 'empty-text');
});

test('chunkDocument 短文档单批，长文档按段落分批且不超长', () => {
  assert.equal(chunkDocument('短文本', 100).length, 1);
  const paragraphs = Array.from({ length: 10 }, (_, i) => `第${i}段 ${'字'.repeat(40)}`);
  const text = paragraphs.join('\n\n');
  const batches = chunkDocument(text, 150);
  assert.ok(batches.length > 1);
  for (const batch of batches) assert.ok(batch.length <= 150);
  assert.equal(batches.join('\n\n'), text);
});

test('chunkDocument 超长段落硬切且空文本返回空数组', () => {
  const batches = chunkDocument('字'.repeat(500), 100);
  assert.equal(batches.length, 5);
  assert.deepEqual(chunkDocument('', 100), []);
});

test('文档扩展名白名单包含文本、代码与 Office 格式', () => {
  for (const ext of ['.txt', '.md', '.json', '.csv', '.pdf', '.docx', '.xlsx', '.mjs', '.py']) {
    assert.ok(DOCUMENT_EXTENSIONS.includes(ext), ext);
  }
  assert.ok(!DOCUMENT_EXTENSIONS.includes('.exe'));
});

test('xlsx 忽略自闭合空单元格与空行，不错列串行', async () => {
  const shared = '<?xml version="1.0"?><sst><si><t>姓名</t></si><si><t>苹果</t></si></sst>';
  const sheet = '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c t="s"><v>0</v></c><c r="B1" s="1"/><c t="s"><v>1</v></c></row><row r="2"/><row r="3"><c t="s"><v>0</v></c><c><v>7</v></c></row></sheetData></worksheet>';
  const file = path.join(dir, 'selfclose.xlsx');
  writeFileSync(file, makeZip([
    ['xl/sharedStrings.xml', Buffer.from(shared)],
    ['xl/worksheets/sheet1.xml', Buffer.from(sheet)],
  ], true));
  const text = await extractTextFromFile(file, '.xlsx');
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /姓名/);
  assert.match(lines[0], /苹果/);
  assert.match(lines[1], /7/);
});

test('buildSummaryPrompt 在预算内截断长摘要并标注删节', async () => {
  const { buildSummaryPrompt } = await import('../src/document-extract.mjs');
  const partials = Array.from({ length: 10 }, () => '摘'.repeat(300));
  const prompt = buildSummaryPrompt('长文', partials);
  assert.ok(prompt.length < 2000);
  assert.match(prompt, /有删节/);
  assert.match(prompt, /长文/);
  const short = buildSummaryPrompt('短文', ['片段一', '片段二']);
  assert.match(short, /片段一/);
  assert.match(short, /片段二/);
});
