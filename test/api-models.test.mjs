import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { startFakeOllama, writeNdjsonLines } from './helpers/fake-ollama.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

const dataDir = useTempDataDir('local-ai-models-api-');
const configFile = path.join(dataDir, 'config.json');
process.env.LOCAL_AI_CONFIG_FILE = configFile;
const fake = await startFakeOllama({
  models: ['qwen3-vl:2b-instruct-q4_K_M', 'qwen3-vl:4b-instruct-q4_K_M'],
});
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
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, text: buffer.toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postJson(path, payload) {
  return apiRequest({
    method: 'POST', path, body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  });
}

test('GET /api/models 返回设备信息、推荐建议和下载/使用中标记', async () => {
  const res = await apiRequest({ path: '/api/models' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.text);
  assert.ok(data.device.totalMemBytes > 0);
  assert.ok(data.device.cpuModel.length > 0);
  assert.equal(data.current, 'qwen3-vl:2b-instruct-q4_K_M');
  assert.equal(data.models.length, 5);

  const twoB = data.models.find((m) => m.id === 'qwen3-vl:2b-instruct-q4_K_M');
  assert.equal(twoB.downloaded, true);
  assert.equal(twoB.inUse, true);
  assert.ok(['recommended', 'usable', 'not-recommended'].includes(twoB.recommendation.level));
  assert.ok(twoB.recommendation.reason.length > 0);

  const gemma = data.models.find((m) => m.id === 'gemma3:4b');
  assert.equal(gemma.downloaded, false);
  assert.equal(gemma.inUse, false);
});

test('select 拒绝目录外模型', async () => {
  const res = await postJson('/api/models/select', { model: 'some-unknown:model' });
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.text).error.code, 'unknown-model');
});

test('select 拒绝未下载的模型', async () => {
  const res = await postJson('/api/models/select', { model: 'gemma3:4b' });
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(res.text).error.code, 'model-not-downloaded');
});

test('select 已下载模型：即时生效并写回配置文件', async () => {
  const res = await postJson('/api/models/select', { model: 'qwen3-vl:4b-instruct-q4_K_M' });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.text).model, 'qwen3-vl:4b-instruct-q4_K_M');
  assert.equal(CONFIG.model, 'qwen3-vl:4b-instruct-q4_K_M');

  const saved = JSON.parse(readFileSync(configFile, 'utf8'));
  assert.equal(saved.model, 'qwen3-vl:4b-instruct-q4_K_M');

  const list = JSON.parse((await apiRequest({ path: '/api/models' })).text);
  assert.equal(list.current, 'qwen3-vl:4b-instruct-q4_K_M');
  assert.equal(list.models.find((m) => m.id === 'qwen3-vl:4b-instruct-q4_K_M').inUse, true);

  const health = JSON.parse((await apiRequest({ path: '/api/health' })).text);
  assert.equal(health.ok, true);
  assert.equal(health.config.model, 'qwen3-vl:4b-instruct-q4_K_M');
});

test('pull 拒绝目录外模型', async () => {
  const res = await postJson('/api/models/pull', { model: 'some-unknown:model' });
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.text).error.code, 'unknown-model');
});

test('pull 转发下载进度并以 done 结束', async () => {
  fake.state.onPull = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [
      { status: 'pulling manifest' },
      { status: 'downloading', completed: 50, total: 100 },
      { status: 'success' },
    ]);
  };
  const res = await postJson('/api/models/pull', { model: 'qwen3-vl:8b' });
  assert.equal(res.status, 200);
  const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
  const progress = events.filter((e) => e.type === 'progress');
  assert.ok(progress.some((e) => e.completed === 50 && e.total === 100));
  assert.equal(events.at(-1).type, 'done');
  assert.equal(fake.state.pulls[0].model, 'qwen3-vl:8b');
});

test('pull 上游错误以 error 事件返回', async () => {
  fake.state.onPull = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    writeNdjsonLines(res, [{ error: 'denied' }]);
  };
  const res = await postJson('/api/models/pull', { model: 'qwen3-vl:8b' });
  const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).code, 'download-error');
  assert.match(events.at(-1).message, /denied/);
});

test('同时只允许一个下载', async () => {
  fake.state.onPull = (payload, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ status: 'downloading', completed: 1, total: 100 }) + '\n');
    // 保持响应不结束，模拟下载进行中。
  };
  const firstProgress = new Promise((resolve) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: appPort, path: '/api/models/pull', method: 'POST',
      headers: { host: LOOPBACK_HOST, 'content-type': 'application/json' },
    }, (res) => {
      res.once('data', () => resolve(req));
    });
    req.on('error', () => {});
    req.end(JSON.stringify({ model: 'qwen3-vl:8b' }));
  });
  const firstReq = await firstProgress;
  const busy = await postJson('/api/models/pull', { model: 'qwen3-vl:8b' });
  assert.equal(busy.status, 409);
  assert.equal(JSON.parse(busy.text).error.code, 'download-busy');
  firstReq.destroy();
});
