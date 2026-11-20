import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeOllama, writeNdjsonLines } from './helpers/fake-ollama.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-ollama-');
const fake = await startFakeOllama();
process.env.LOCAL_AI_OLLAMA_URL = fake.url;
after(() => fake.close());

const { CONFIG } = await import('../src/config.mjs');
const {
  checkHealth, assertModelAvailable, streamChat, buildOllamaMessages, OllamaError,
} = await import('../src/ollama.mjs');

async function expectStreamError(predicate) {
  await assert.rejects(async () => {
    for await (const delta of streamChat({ messages: [] })) void delta;
  }, predicate);
}

test('模型已下载时健康检查 ok', async () => {
  const health = await checkHealth();
  assert.equal(health.ok, true);
  assert.equal(health.ollama.running, true);
  assert.equal(health.model.available, true);
  await assertModelAvailable();
});

test('模型未下载时预检抛 model-missing', async () => {
  const empty = await startFakeOllama({ models: [] });
  const previous = CONFIG.ollamaUrl;
  CONFIG.ollamaUrl = empty.url;
  try {
    const health = await checkHealth();
    assert.equal(health.ok, false);
    assert.equal(health.ollama.running, true);
    assert.equal(health.model.available, false);
    await assert.rejects(() => assertModelAvailable(), (err) => {
      assert.ok(err instanceof OllamaError);
      assert.equal(err.code, 'model-missing');
      return true;
    });
  } finally {
    CONFIG.ollamaUrl = previous;
    await empty.close();
  }
});

test('streamChat 逐段产出内容，请求体携带模型与 numCtx', async () => {
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [
      { message: { content: '你好' } },
      { message: { content: '，世界' } },
      { message: { content: '' }, done: true },
    ]);
  };
  const messages = [{ role: 'user', content: '打招呼' }];
  const deltas = [];
  for await (const delta of streamChat({ messages })) deltas.push(delta);
  assert.deepEqual(deltas, ['你好', '，世界']);

  const sent = fake.state.requests.at(-1);
  assert.equal(sent.model, CONFIG.model);
  assert.equal(sent.stream, true);
  assert.equal(sent.options.num_ctx, CONFIG.numCtx);
  assert.deepEqual(sent.messages, messages);
});

test('流中的 error 字段抛 generation-error', async () => {
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [{ error: 'boom' }]);
  };
  await expectStreamError((err) => err.code === 'generation-error' && err.message === 'boom');
});

test('HTTP 404 抛 model-missing，其他错误抛 ollama-error', async () => {
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(404);
    res.end('model not found');
  };
  await expectStreamError((err) => err.code === 'model-missing' && err.status === 404);

  fake.state.onChat = (payload, req, res) => {
    res.writeHead(500);
    res.end('internal');
  };
  await expectStreamError((err) => err.code === 'ollama-error' && err.status === 500);
});

test('客户端中止后抛 aborted', async () => {
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: '部分' } }) + '\n');
    // 不结束响应，模拟仍在生成。
  };
  const controller = new AbortController();
  const gen = streamChat({ messages: [], signal: controller.signal });
  const first = await gen.next();
  assert.equal(first.value, '部分');
  controller.abort();
  await assert.rejects(() => gen.next(), (err) => err.code === 'aborted');
});

test('buildOllamaMessages 当前消息已在末尾时不重复', () => {
  const current = { id: 'm2', role: 'user', text: '现在' };
  const chat = { messages: [{ id: 'm1', role: 'user', text: '之前' }, current] };
  const result = buildOllamaMessages(chat, current, null);
  assert.deepEqual(result, [
    { role: 'user', content: '之前' },
    { role: 'user', content: '现在' },
  ]);
});

test('buildOllamaMessages 当前消息不在末尾时追加', () => {
  const current = { id: 'm3', role: 'user', text: '新问题' };
  const chat = { messages: [{ id: 'm1', role: 'assistant', text: '旧回答' }] };
  const result = buildOllamaMessages(chat, current, null);
  assert.deepEqual(result.at(-1), { role: 'user', content: '新问题' });
  assert.equal(result.length, 2);
});

test('buildOllamaMessages 超出 numCtx 预算的旧消息被丢弃，最新必保留', () => {
  const current = { id: 'm3', role: 'user', text: 'c'.repeat(100) };
  const chat = {
    messages: [
      { id: 'm1', role: 'user', text: 'a'.repeat(1500) },
      { id: 'm2', role: 'assistant', text: 'b'.repeat(1500) },
      current,
    ],
  };
  const result = buildOllamaMessages(chat, current, null);
  assert.deepEqual(result.map((m) => m.content[0]), ['b', 'c']);
});

test('buildOllamaMessages 图片只挂在当前用户消息上', () => {
  const current = { id: 'm2', role: 'user', text: '看图' };
  const chat = { messages: [{ id: 'm1', role: 'user', text: '之前' }, current] };
  const result = buildOllamaMessages(chat, current, 'base64data');
  assert.deepEqual(result.at(-1).images, ['base64data']);
  assert.equal(result[0].images, undefined);
});

test('buildOllamaMessages 非 assistant 角色统一映射为 user', () => {
  const current = { id: 'm2', role: 'user', text: '现在' };
  const chat = { messages: [{ id: 'm1', role: 'system', text: '旧' }, current] };
  const result = buildOllamaMessages(chat, current, null);
  assert.equal(result[0].role, 'user');
});
