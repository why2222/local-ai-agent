import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-remote-config-');

test('只设置 REMOTE_HOST 而缺少令牌时拒绝启动', async () => {
  process.env.LOCAL_AI_REMOTE_HOST = 'remote-access-18266.zconnect.cn';
  delete process.env.LOCAL_AI_REMOTE_TOKEN;
  await assert.rejects(() => import('../src/config.mjs?case=host-only'), /LOCAL_AI_REMOTE_TOKEN/);
});

test('只设置令牌而缺少 REMOTE_HOST 时拒绝启动', async () => {
  delete process.env.LOCAL_AI_REMOTE_HOST;
  process.env.LOCAL_AI_REMOTE_TOKEN = 'test-token-abc123';
  await assert.rejects(() => import('../src/config.mjs?case=token-only'), /LOCAL_AI_REMOTE_HOST/);
});

test('REMOTE_HOST 归一化为小写并去掉 :443 后缀', async () => {
  process.env.LOCAL_AI_REMOTE_HOST = 'Remote-Access-18266.ZCONNECT.cn:443';
  process.env.LOCAL_AI_REMOTE_TOKEN = 'test-token-abc123';
  const { REMOTE_HOST } = await import('../src/config.mjs?case=normalize');
  assert.equal(REMOTE_HOST, 'remote-access-18266.zconnect.cn');
});

test('过短或含非法字符的令牌拒绝启动', async () => {
  process.env.LOCAL_AI_REMOTE_HOST = 'x.example.com';
  process.env.LOCAL_AI_REMOTE_TOKEN = 'short';
  await assert.rejects(() => import('../src/config.mjs?case=weak-token'), /LOCAL_AI_REMOTE_TOKEN/);
  process.env.LOCAL_AI_REMOTE_TOKEN = 'has space in token 123';
  await assert.rejects(() => import('../src/config.mjs?case=bad-token'), /LOCAL_AI_REMOTE_TOKEN/);
});
