import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { startFakeOllama, writeNdjsonLines } from './helpers/fake-ollama.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-remote-library-api-');
const fake = await startFakeOllama({ models: ['qwen3-vl:2b-instruct-q4_K_M', 'deepseek-r1:1.5b'] });
process.env.LOCAL_AI_OLLAMA_URL = fake.url;

const libraryState = { fail: false };
const library = createServer((req, res) => {
  if (libraryState.fail) {
    res.writeHead(500);
    res.end('boom');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<ul><li><a href="/library/deepseek-ocr" class="group">
    <div><h2><div><span class="group-hover:underline truncate">deepseek-ocr</span></div></h2>
    <p class="max-w-lg break-words text-neutral-800 text-md">DeepSeek reasoning model</p></div>
    <div><span class="inline-flex rounded-md bg-indigo-50">thinking</span>
    <span class="inline-flex rounded-md bg-[#ddf4ff] px-2">1.5b</span></div>
  </a></li></ul>`);
});
await new Promise((resolve) => library.listen(0, '127.0.0.1', resolve));
process.env.LOCAL_AI_LIBRARY_URL = `http://127.0.0.1:${library.address().port}`;

const { createApp } = await import('../src/app.mjs');
const { CONFIG } = await import('../src/config.mjs');

const app = createApp();
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const appPort = app.address().port;
after(async () => {
  app.closeAllConnections?.();
  await new Promise((resolve) => app.close(resolve));
  await fake.close();
  await new Promise((resolve) => library.close(resolve));
});

function apiRequest({ method = 'GET', path: p, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: appPort, path: p, method,
      headers: { host: `127.0.0.1:${CONFIG.port}`, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('主动获取在线目录：合并模型与缓存信息，远程模型可下载', async () => {
  const res = await apiRequest({ method: 'POST', path: '/api/models/fetch-remote' });
  assert.equal(res.status, 200);
  const result = JSON.parse(res.text);
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);

  const list = JSON.parse((await apiRequest({ path: '/api/models' })).text);
  assert.equal(list.cache.count, 1);
  assert.ok(list.cache.fetchedAt);
  const remote = list.models.find((m) => m.id === 'deepseek-ocr');
  assert.equal(remote.source, 'remote');
  assert.equal(remote.vision, false);
  assert.equal(remote.downloaded, false);

  fake.state.onPull = (payload, req, res2) => {
    res2.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res2, [{ status: 'success' }]);
  };
  const pull = await apiRequest({
    method: 'POST', path: '/api/models/pull', body: JSON.stringify({ model: 'deepseek-ocr' }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(pull.status, 200);
  assert.equal(fake.state.pulls[0].model, 'deepseek-ocr');
});

test('在线获取失败返回 502，目录保持可用', async () => {
  libraryState.fail = true;
  const res = await apiRequest({ method: 'POST', path: '/api/models/fetch-remote' });
  assert.equal(res.status, 502);
  assert.equal(JSON.parse(res.text).error.code, 'fetch-failed');
  const list = JSON.parse((await apiRequest({ path: '/api/models' })).text);
  assert.ok(list.models.length >= 12);
});

test('纯文本模型拒绝带图片的消息，移除图片或切回多模态后可发送', async () => {
  const select = await apiRequest({
    method: 'POST', path: '/api/models/select', body: JSON.stringify({ model: 'deepseek-r1:1.5b' }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(select.status, 200);

  const chat = JSON.parse((await apiRequest({ method: 'POST', path: '/api/chats' })).text).chat;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const uploaded = await apiRequest({
    method: 'POST', path: `/api/chats/${chat.id}/images`, body: png,
    headers: { 'content-type': 'image/png' },
  });
  assert.equal(uploaded.status, 201);
  const imageId = JSON.parse(uploaded.text).image.id;

  const rejected = await apiRequest({
    method: 'POST', path: `/api/chats/${chat.id}/messages`,
    body: JSON.stringify({ text: '看图', imageId }), headers: { 'content-type': 'application/json' },
  });
  assert.equal(rejected.status, 400);
  assert.equal(JSON.parse(rejected.text).error.code, 'model-no-vision');

  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [{ message: { content: '文字回答' } }, { message: { content: '' }, done: true }]);
  };
  const textOnly = await apiRequest({
    method: 'POST', path: `/api/chats/${chat.id}/messages`,
    body: JSON.stringify({ text: '纯文字问题' }), headers: { 'content-type': 'application/json' },
  });
  assert.equal(textOnly.status, 200);

  await apiRequest({
    method: 'POST', path: '/api/models/select',
    body: JSON.stringify({ model: 'qwen3-vl:2b-instruct-q4_K_M' }),
    headers: { 'content-type': 'application/json' },
  });
  const visionAgain = await apiRequest({
    method: 'POST', path: `/api/chats/${chat.id}/messages`,
    body: JSON.stringify({ text: '看图', imageId }), headers: { 'content-type': 'application/json' },
  });
  assert.equal(visionAgain.status, 200);
});
