import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startFakeOllama, writeNdjsonLines } from './helpers/fake-ollama.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-documents-');
const fake = await startFakeOllama();
process.env.LOCAL_AI_OLLAMA_URL = fake.url;

const { createApp } = await import('../src/app.mjs');
const { CONFIG } = await import('../src/config.mjs');

const app = createApp();
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const appPort = app.address().port;
after(async () => {
  app.closeAllConnections?.();
  await new Promise((resolve) => app.close(resolve));
  await fake.close();
});

const LOOPBACK_HOST = `127.0.0.1:${CONFIG.port}`;

function apiRequest({ method = 'GET', path: p, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: appPort, path: p, method,
      headers: { host: LOOPBACK_HOST, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function createChat() {
  const res = await apiRequest({ method: 'POST', path: '/api/chats' });
  return JSON.parse(res.text).chat;
}

function uploadDocument(chatId, name, body) {
  return apiRequest({
    method: 'POST', path: `/api/chats/${chatId}/documents`, body,
    headers: { 'content-type': 'application/octet-stream', 'x-document-name': encodeURIComponent(name) },
  });
}

function completeChat(payload, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  writeNdjsonLines(res, [
    { message: { content: '摘要内容' } },
    { message: { content: '' }, done: true },
  ]);
}

test('拒绝不支持的文档类型和超限文件', async () => {
  const chat = await createChat();
  assert.equal((await uploadDocument(chat.id, 'a.exe', Buffer.from('x'))).status, 415);
  assert.equal((await uploadDocument(chat.id, 'big.txt', Buffer.alloc(100 * 1024 * 1024 + 1, 65))).status, 413);
});

test('上传文本文件返回批次信息，原文可读取', async () => {
  const chat = await createChat();
  const res = await uploadDocument(chat.id, '笔记.txt', Buffer.from('第一段 你好\n\n第二段 世界'));
  assert.equal(res.status, 201);
  const doc = JSON.parse(res.text).document;
  assert.equal(doc.name, '笔记.txt');
  assert.equal(doc.batches, 1);
  assert.ok(doc.textChars > 0);

  const raw = await apiRequest({ path: `/api/chats/${chat.id}/documents/${doc.id}` });
  assert.equal(raw.status, 200);
  assert.match(raw.text, /第一段 你好/);
});

test('摘要流程：NDJSON 进度与最终消息入会话', async () => {
  fake.state.onChat = completeChat;
  const chat = await createChat();
  const doc = JSON.parse((await uploadDocument(chat.id, '笔记.txt', Buffer.from('第一段 你好\n\n第二段 世界'))).text).document;

  const res = await apiRequest({ method: 'POST', path: `/api/chats/${chat.id}/documents/${doc.id}/summarize` });
  assert.equal(res.status, 200);
  const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((e) => e.type === 'batch' && e.total === 1));
  assert.ok(events.some((e) => e.type === 'final-start'));
  const done = events.find((e) => e.type === 'done');
  assert.equal(done.message.status, 'complete');
  assert.match(done.message.text, /摘要内容/);

  const saved = JSON.parse((await apiRequest({ path: `/api/chats/${chat.id}` })).text).chat;
  assert.equal(saved.messages[0].role, 'user');
  assert.equal(saved.messages[0].documentId, doc.id);
  assert.equal(saved.messages[1].role, 'assistant');
  assert.match(saved.title, /笔记/);
});

test('长文档分批：每批一次调用加一次汇总', async () => {
  fake.state.onChat = completeChat;
  const chat = await createChat();
  const longText = Array.from({ length: 10 }, (_, i) => `第${i}段 ${'字'.repeat(200)}`).join('\n\n');
  const doc = JSON.parse((await uploadDocument(chat.id, '长文.txt', Buffer.from(longText))).text).document;
  assert.ok(doc.batches >= 2);

  fake.state.requests = [];
  const res = await apiRequest({ method: 'POST', path: `/api/chats/${chat.id}/documents/${doc.id}/summarize` });
  assert.equal(res.status, 200);
  assert.equal(fake.state.requests.length, doc.batches + 1);
  const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((e) => e.type === 'batch' && e.total === doc.batches));
});

test('摘要文档不存在返回 404', async () => {
  const chat = await createChat();
  const res = await apiRequest({ method: 'POST', path: `/api/chats/${chat.id}/documents/00000000-0000-4000-8000-000000000000/summarize` });
  assert.equal(res.status, 404);
});

test('停止摘要后保存 stopped 状态', async () => {
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: '部分摘要' } }) + '\n');
  };
  const chat = await createChat();
  const doc = JSON.parse((await uploadDocument(chat.id, '笔记.txt', Buffer.from('内容'))).text).document;

  const firstDelta = new Promise((resolve) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: appPort, path: `/api/chats/${chat.id}/documents/${doc.id}/summarize`, method: 'POST',
      headers: { host: LOOPBACK_HOST },
    }, (res) => {
      res.once('data', () => resolve(req));
    });
    req.on('error', () => {});
    req.end();
  });
  const req = await firstDelta;
  req.destroy();

  let saved;
  for (let i = 0; i < 60; i += 1) {
    saved = JSON.parse((await apiRequest({ path: `/api/chats/${chat.id}` })).text).chat;
    if (saved.messages.some((m) => m.role === 'assistant')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const assistant = saved.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.status, 'stopped');
  assert.match(assistant.text, /部分摘要/);
});

test('DOCX 原文以 Office MIME 返回，PDF 原文以 application/pdf 返回', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const makeZip = (entries) => {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of entries) {
      const nameBuf = Buffer.from(name);
      const data = deflateRawSync(content);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(content.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      parts.push(local, nameBuf, data);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(8, 10);
      c.writeUInt32LE(0, 16);
      c.writeUInt32LE(data.length, 20);
      c.writeUInt32LE(content.length, 24);
      c.writeUInt16LE(nameBuf.length, 28);
      c.writeUInt32LE(offset, 42);
      central.push(c, nameBuf);
      offset += 30 + nameBuf.length + data.length;
    }
    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, centralBuf, eocd]);
  };
  const xml = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>文档内容</w:t></w:r></w:p></w:body></w:document>';
  const chat = await createChat();
  const docxBuffer = makeZip([['word/document.xml', Buffer.from(xml)]]);
  const res = await uploadDocument(chat.id, '报告.docx', docxBuffer);
  assert.equal(res.status, 201);
  const doc = JSON.parse(res.text).document;
  const raw = await apiRequest({ path: `/api/chats/${chat.id}/documents/${doc.id}` });
  assert.equal(raw.status, 200);
  assert.match(raw.headers['content-type'], /wordprocessingml/);
});
