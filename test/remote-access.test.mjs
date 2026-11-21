import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startFakeOllama } from './helpers/fake-ollama.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-remote-');
process.env.LOCAL_AI_REMOTE_HOST = 'remote-access-18266.zconnect.cn';
process.env.LOCAL_AI_REMOTE_TOKEN = 'test-token-abc123';
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

const REMOTE_HOST = 'remote-access-18266.zconnect.cn';
const TOKEN = 'test-token-abc123';

function apiRequest({ method = 'GET', path: p, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: appPort, path: p, method,
      headers: { host: REMOTE_HOST, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('远程域名无令牌或令牌错误返回 401', async () => {
  const noToken = await apiRequest({ path: '/api/health' });
  assert.equal(noToken.status, 401);
  assert.equal(JSON.parse(noToken.text).error.code, 'unauthorized');

  const wrong = await apiRequest({ path: '/api/health?token=wrong' });
  assert.equal(wrong.status, 401);

  const badCookie = await apiRequest({ path: '/api/health', headers: { cookie: '__Host-remote_token=wrong' } });
  assert.equal(badCookie.status, 401);
});

test('URL 携带正确令牌：设置安全 Cookie 并 302 到无令牌地址', async () => {
  const res = await apiRequest({ path: '/?token=' + TOKEN });
  assert.equal(res.status, 302);
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /__Host-remote_token=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(!res.headers.location.includes('token'));
});

test('有效 Cookie 可访问，API 带令牌参数也可访问', async () => {
  const withCookie = await apiRequest({ path: '/api/health', headers: { cookie: `__Host-remote_token=${TOKEN}` } });
  assert.equal(withCookie.status, 200);
  assert.equal(JSON.parse(withCookie.text).ok, true);

  const withQuery = await apiRequest({ path: `/api/health?token=${TOKEN}` });
  assert.equal(withQuery.status, 200);
});

test('同源 https Origin 允许写操作，外站 Origin 拒绝', async () => {
  const sameOrigin = await apiRequest({
    method: 'POST', path: '/api/chats',
    headers: { cookie: `__Host-remote_token=${TOKEN}`, origin: `https://${REMOTE_HOST}` },
  });
  assert.equal(sameOrigin.status, 201);

  const evilOrigin = await apiRequest({
    path: '/api/health',
    headers: { cookie: `__Host-remote_token=${TOKEN}`, origin: 'https://evil.com' },
  });
  assert.equal(evilOrigin.status, 403);
});

test('其他域名仍然 403，回环访问不需要令牌', async () => {
  const other = await apiRequest({ path: '/api/health', headers: { host: 'other.example.com' } });
  assert.equal(other.status, 403);

  const loopback = await apiRequest({ path: '/api/health', headers: { host: `127.0.0.1:${CONFIG.port}` } });
  assert.equal(loopback.status, 200);
});
