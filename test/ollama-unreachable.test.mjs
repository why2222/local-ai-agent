import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-ollama-down-');
// 指向未监听的端口，模拟 Ollama 未运行。
process.env.LOCAL_AI_OLLAMA_URL = 'http://127.0.0.1:1';

const { checkHealth, assertModelAvailable } = await import('../src/ollama.mjs');

test('Ollama 不可达时健康检查报告 unreachable，预检抛 ollama-unavailable', async () => {
  const health = await checkHealth();
  assert.equal(health.ok, false);
  assert.equal(health.ollama.running, false);
  assert.equal(health.ollama.error, 'unreachable');
  await assert.rejects(() => assertModelAvailable(), (err) => err.code === 'ollama-unavailable');
});
