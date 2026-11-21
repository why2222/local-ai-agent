import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startFakeOllama, writeNdjsonLines } from './helpers/fake-ollama.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-api-');
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
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function apiRequest({ method = 'GET', path: p, body, headers = {}, host = LOOPBACK_HOST }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: appPort, path: p, method,
      headers: { host, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buffer, text: buffer.toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function createChat() {
  const res = await apiRequest({ method: 'POST', path: '/api/chats' });
  assert.equal(res.status, 201);
  return JSON.parse(res.text).chat;
}

function completeChat(payload, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  writeNdjsonLines(res, [
    { message: { content: '回答一' } },
    { message: { content: '回答二' } },
    { message: { content: '' }, done: true },
  ]);
}

test('首页返回 HTML 并带安全响应头', async () => {
  const res = await apiRequest({ path: '/' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.headers['content-security-policy']);
  assert.match(res.text, /<html/);
});

test('非法 Host 和非法 Origin 被拒绝', async () => {
  const badHost = await apiRequest({ path: '/api/health', host: 'evil.com' });
  assert.equal(badHost.status, 403);
  const badOrigin = await apiRequest({ path: '/api/health', headers: { origin: 'http://evil.com' } });
  assert.equal(badOrigin.status, 403);
});

test('健康检查返回模型与配置', async () => {
  const res = await apiRequest({ path: '/api/health' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.text);
  assert.equal(data.ok, true);
  assert.equal(data.config.model, CONFIG.model);
});

test('会话创建、列表、读取、删除', async () => {
  const chat = await createChat();
  const list = JSON.parse((await apiRequest({ path: '/api/chats' })).text);
  assert.ok(list.chats.some((c) => c.id === chat.id));

  const got = await apiRequest({ path: `/api/chats/${chat.id}` });
  assert.equal(got.status, 200);

  const del = await apiRequest({ method: 'DELETE', path: `/api/chats/${chat.id}` });
  assert.equal(del.status, 204);
  assert.equal((await apiRequest({ path: `/api/chats/${chat.id}` })).status, 404);
});

test('静态文件路径穿越返回 403', async () => {
  const res = await apiRequest({ path: '/%2e%2e%2fconfig.json' });
  assert.equal(res.status, 403);
});

test('图片上传校验与读回', async () => {
  const chat = await createChat();
  const base = `/api/chats/${chat.id}/images`;

  assert.equal((await apiRequest({ method: 'POST', path: `/api/chats/${'0'.repeat(8)}-0000-4000-8000-000000000000/images`, body: PNG, headers: { 'content-type': 'image/png' } })).status, 404);
  assert.equal((await apiRequest({ method: 'POST', path: base, body: PNG, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await apiRequest({ method: 'POST', path: base, body: Buffer.from('not an image'), headers: { 'content-type': 'image/png' } })).status, 400);

  const uploaded = await apiRequest({ method: 'POST', path: base, body: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal(uploaded.status, 201);
  const image = JSON.parse(uploaded.text).image;

  const got = await apiRequest({ path: `${base}/${image.id}` });
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.deepEqual(got.buffer, PNG);
});

test('消息参数校验：空文本、坏 imageId、不存在的图片', async () => {
  const chat = await createChat();
  const url = `/api/chats/${chat.id}/messages`;
  const post = (payload) => apiRequest({
    method: 'POST', path: url, body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  });

  assert.equal((await post({ text: '  ' })).status, 400);
  assert.equal(JSON.parse((await post({ text: '  ' })).text).error.code, 'empty-text');
  assert.equal(JSON.parse((await post({ text: 'hi', imageId: 'bad' })).text).error.code, 'bad-image-id');
  assert.equal(JSON.parse((await post({ text: 'hi', imageId: '00000000-0000-4000-8000-000000000000' })).text).error.code, 'image-not-found');
});

test('完整消息流：delta + done，会话保存用户与助手消息并生成标题', async () => {
  fake.state.onChat = completeChat;
  const chat = await createChat();
  const res = await apiRequest({
    method: 'POST', path: `/api/chats/${chat.id}/messages`,
    body: JSON.stringify({ text: '你好' }), headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /ndjson/);
  const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
  const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text);
  assert.deepEqual(deltas, ['回答一', '回答二']);
  const done = events.find((e) => e.type === 'done');
  assert.equal(done.message.status, 'complete');
  assert.equal(done.message.text, '回答一回答二');

  const saved = JSON.parse((await apiRequest({ path: `/api/chats/${chat.id}` })).text).chat;
  assert.equal(saved.title, '你好');
  assert.deepEqual(saved.messages.map((m) => m.role), ['user', 'assistant']);
});

test('模型未下载时返回 409 且用户消息仍被保留', async () => {
  const empty = await startFakeOllama({ models: [] });
  const previous = CONFIG.ollamaUrl;
  CONFIG.ollamaUrl = empty.url;
  try {
    const chat = await createChat();
    const res = await apiRequest({
      method: 'POST', path: `/api/chats/${chat.id}/messages`,
      body: JSON.stringify({ text: '触发预检' }), headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.text).error.code, 'model-missing');
    const saved = JSON.parse((await apiRequest({ path: `/api/chats/${chat.id}` })).text).chat;
    assert.equal(saved.messages.length, 1);
    assert.equal(saved.messages[0].text, '触发预检');
  } finally {
    CONFIG.ollamaUrl = previous;
    await empty.close();
  }
});

test('后台生成：断连不中止，stop 接口停止保存 stopped 部分回答', async () => {
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: '部分回答' } }) + '\n');
    // 保持响应不结束，模拟持续生成。
  };
  const chat = await createChat();
  const messagePath = `/api/chats/${chat.id}/messages`;

  const firstDelta = new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: appPort, path: messagePath, method: 'POST',
      headers: { host: LOOPBACK_HOST, 'content-type': 'application/json' },
    }, (res) => {
      res.once('data', () => resolve(req));
    });
    req.on('error', () => {});
    req.end(JSON.stringify({ text: '长回答' }));
  });
  const firstReq = await firstDelta;

  const busy = await apiRequest({
    method: 'POST', path: messagePath,
    body: JSON.stringify({ text: '第二个' }), headers: { 'content-type': 'application/json' },
  });
  assert.equal(busy.status, 409);
  assert.equal(JSON.parse(busy.text).error.code, 'generation-busy');

  firstReq.destroy();

  // 后台生成：断开连接不中止，streaming 状态可见；增量每秒持久化。
  let saved = JSON.parse((await apiRequest({ path: `/api/chats/${chat.id}` })).text).chat;
  let assistant = saved.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.status, 'streaming');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  saved = JSON.parse((await apiRequest({ path: `/api/chats/${chat.id}` })).text).chat;
  assistant = saved.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.text, '部分回答');

  // 显式停止接口才中止生成。
  const stop = await apiRequest({ method: 'POST', path: `/api/chats/${chat.id}/stop` });
  assert.equal(stop.status, 200);
  for (let i = 0; i < 60; i += 1) {
    saved = JSON.parse((await apiRequest({ path: `/api/chats/${chat.id}` })).text).chat;
    assistant = saved.messages.find((m) => m.role === 'assistant');
    if (assistant.status !== 'streaming') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(assistant.status, 'stopped');
  assert.equal(assistant.text, '部分回答');

  fake.state.onChat = completeChat;
  const again = await apiRequest({
    method: 'POST', path: messagePath,
    body: JSON.stringify({ text: '停止后重试' }), headers: { 'content-type': 'application/json' },
  });
  assert.equal(again.status, 200);
});
