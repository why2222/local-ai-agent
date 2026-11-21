import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeOllama, writeNdjsonLines } from './helpers/fake-ollama.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-generate-');
const fake = await startFakeOllama();
process.env.LOCAL_AI_OLLAMA_URL = fake.url;
after(() => fake.close());

const { generateWithContinuation, isRepetitiveLoop } = await import('../src/generate.mjs');

test('自然结束时不续写', async () => {
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [
      { message: { content: '完整回答' } },
      { message: { content: '' }, done: true, done_reason: 'stop' },
    ]);
  };
  fake.state.requests = [];
  const result = await generateWithContinuation({ messages: [{ role: 'user', content: '问' }] });
  assert.equal(result.text, '完整回答');
  assert.equal(result.stoppedBy, 'natural');
  assert.equal(fake.state.requests.length, 1);
});

test('被长度截断时自动续写直到自然结束', async () => {
  let call = 0;
  fake.state.onChat = (payload, req, res) => {
    call += 1;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (call === 1) {
      writeNdjsonLines(res, [
        { message: { content: '前半部分' } },
        { message: { content: '' }, done: true, done_reason: 'length' },
      ]);
    } else {
      writeNdjsonLines(res, [
        { message: { content: '后半部分' } },
        { message: { content: '' }, done: true, done_reason: 'stop' },
      ]);
    }
  };
  fake.state.requests = [];
  const result = await generateWithContinuation({ messages: [{ role: 'user', content: '问' }] });
  assert.equal(result.text, '前半部分后半部分');
  assert.equal(result.stoppedBy, 'natural');
  assert.equal(fake.state.requests.length, 2);
  const second = fake.state.requests[1].messages;
  assert.equal(second.at(-1).content, '请接着上文继续输出剩余部分，不要重复已写内容，不要重新开始。');
  assert.equal(second.at(-2).role, 'assistant');
  assert.equal(second.at(-2).content, '前半部分');
});

test('重复循环时立即中止，不再续写', async () => {
  const fragment = '重复片段'.repeat(30);
  fake.state.onChat = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [
      { message: { content: fragment } },
      { message: { content: '' }, done: true, done_reason: 'length' },
    ]);
  };
  fake.state.requests = [];
  const result = await generateWithContinuation({ messages: [{ role: 'user', content: '问' }] });
  assert.equal(result.stoppedBy, 'loop');
  assert.ok(fake.state.requests.length <= 2);
});

test('持续截断但不重复时受续写次数上限保护', async () => {
  let call = 0;
  fake.state.onChat = (payload, req, res) => {
    call += 1;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [
      { message: { content: `第${call}段不同内容` } },
      { message: { content: '' }, done: true, done_reason: 'length' },
    ]);
  };
  fake.state.requests = [];
  const result = await generateWithContinuation({ messages: [{ role: 'user', content: '问' }], maxContinuations: 2 });
  assert.equal(result.stoppedBy, 'limit');
  assert.equal(fake.state.requests.length, 3);
});

test('isRepetitiveLoop 识别长片段重复，不误伤正常文本', () => {
  assert.equal(isRepetitiveLoop('正常的回答，没有重复。'), false);
  const loop = '这是一段会反复出现的文字内容，长度足够触发检测。'.repeat(5);
  assert.equal(isRepetitiveLoop(loop), true);
});
