import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-config-lan-');
process.env.LOCAL_AI_ALLOW_LAN = '1';

const { isLoopbackHost } = await import('../src/config.mjs');

test('开启局域网后接受私网 IPv4 且端口必须匹配', () => {
  assert.equal(isLoopbackHost('192.168.31.7:43210'), true);
  assert.equal(isLoopbackHost('10.0.0.2:43210'), true);
  assert.equal(isLoopbackHost('172.16.5.4:43210'), true);
  assert.equal(isLoopbackHost('172.31.255.254:43210'), true);
  assert.equal(isLoopbackHost('192.168.31.7:9999'), false);
});

test('开启局域网后仍拒绝公网地址和回环以外的非法输入', () => {
  assert.equal(isLoopbackHost('172.32.0.1:43210'), false);
  assert.equal(isLoopbackHost('8.8.8.8:43210'), false);
  assert.equal(isLoopbackHost('evil.com:43210'), false);
});

test('开启局域网后回环地址仍可用', () => {
  assert.equal(isLoopbackHost('127.0.0.1:43210'), true);
});
