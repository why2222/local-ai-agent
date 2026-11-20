import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { useTempDataDir } from './helpers/temp-dir.mjs';

const dataDir = useTempDataDir('local-ai-config-');
const ollamaUrl = 'http://127.0.0.1:59999';
process.env.LOCAL_AI_DATA_DIR = dataDir;
process.env.LOCAL_AI_OLLAMA_URL = ollamaUrl;
delete process.env.LOCAL_AI_ALLOW_LAN;

const { CONFIG, isLoopbackHost } = await import('../src/config.mjs');

test('LOCAL_AI_DATA_DIR 覆盖数据目录并自动创建子目录', () => {
  assert.equal(CONFIG.dataDir, dataDir);
  assert.equal(CONFIG.chatsDir, path.join(dataDir, 'chats'));
  assert.equal(CONFIG.imagesDir, path.join(dataDir, 'images'));
  for (const dir of [CONFIG.chatsDir, CONFIG.imagesDir, CONFIG.quarantineDir]) {
    assert.ok(existsSync(dir), `${dir} 应被创建`);
  }
});

test('LOCAL_AI_OLLAMA_URL 覆盖 Ollama 地址', () => {
  assert.equal(CONFIG.ollamaUrl, ollamaUrl);
});

test('默认只接受本机回环 Host', () => {
  assert.equal(isLoopbackHost('127.0.0.1:43210'), true);
  assert.equal(isLoopbackHost('localhost:43210'), true);
  assert.equal(isLoopbackHost('LOCALHOST:43210'), true);
  assert.equal(isLoopbackHost('[::1]:43210'), true);
});

test('默认拒绝局域网地址、错误端口和非法输入', () => {
  assert.equal(isLoopbackHost('192.168.31.7:43210'), false);
  assert.equal(isLoopbackHost('127.0.0.1:9999'), false);
  assert.equal(isLoopbackHost('evil.com'), false);
  assert.equal(isLoopbackHost(''), false);
  assert.equal(isLoopbackHost(undefined), false);
});
