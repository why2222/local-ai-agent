import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { useTempDataDir } from './helpers/temp-dir.mjs';

const dataDir = useTempDataDir('local-ai-library-');
const {
  parseLibraryHtml, getAllModels, getCachedModels, getCacheInfo, refreshRemoteModels,
} = await import('../src/model-library.mjs');

const FIXTURE = `
<ul>
  <li><a href="/library/qwen3-vl" class="group w-full space-y-5">
    <div title="qwen3-vl"><h2><div><span class="group-hover:underline truncate">qwen3-vl</span></div></h2>
    <p class="max-w-lg break-words text-neutral-800 text-md">The most powerful vision-language model in Qwen &amp; friends. </p></div>
    <div><span class="inline-flex rounded-md bg-indigo-50">vision</span><span class="inline-flex rounded-md bg-indigo-50">tools</span>
    <span class="inline-flex rounded-md bg-[#ddf4ff] px-2">2b</span><span class="inline-flex rounded-md bg-[#ddf4ff] px-2">4b</span><span class="inline-flex rounded-md bg-[#ddf4ff] px-2">8b</span></div>
  </a></li>
  <li><a href="/library/deepseek-ocr" class="group w-full space-y-5">
    <div title="deepseek-ocr"><h2><div><span class="group-hover:underline truncate">deepseek-ocr</span></div></h2>
    <p class="max-w-lg break-words text-neutral-800 text-md">DeepSeek reasoning model</p></div>
    <div><span class="inline-flex rounded-md bg-indigo-50">thinking</span>
    <span class="inline-flex rounded-md bg-[#ddf4ff] px-2">1.5b</span><span class="inline-flex rounded-md bg-[#ddf4ff] px-2">8b</span></div>
  </a></li>
  <li><a href="/library/somemodel" class="group w-full space-y-5">
    <div title="somemodel"><h2><div><span class="group-hover:underline truncate">somemodel</span></div></h2>
    <p class="max-w-lg break-words text-neutral-800 text-md">No sizes listed</p></div>
  </a></li>
</ul>`;

test('解析官方库卡片：名称、描述、vision、尺寸与 tier 推断', () => {
  const models = parseLibraryHtml(FIXTURE);
  assert.equal(models.length, 3);

  const vl = models.find((m) => m.id === 'qwen3-vl');
  assert.equal(vl.vision, true);
  assert.equal(vl.tier, 1);
  assert.equal(vl.params, '2B');
  assert.match(vl.summary, /Qwen & friends/);
  assert.equal(vl.source, 'remote');
  assert.equal(vl.sizeGB, null);

  const r1 = models.find((m) => m.id === 'deepseek-ocr');
  assert.equal(r1.vision, false);
  assert.equal(r1.tier, 1);
  assert.equal(r1.capabilities.ocr, '不支持');

  const unknown = models.find((m) => m.id === 'somemodel');
  assert.equal(unknown.tier, 2);
  assert.equal(unknown.vision, false);
});

test('初始无缓存时目录只有内置模型', () => {
  assert.equal(getCachedModels().length, 0);
  assert.equal(getCacheInfo().fetchedAt, null);
  assert.ok(getAllModels().length >= 12);
});

test('在线获取成功后写入缓存并合并目录，重复获取不重复', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await refreshRemoteModels({ baseUrl });
    assert.equal(result.count, 3);
    assert.ok(result.fetchedAt);

    const saved = JSON.parse(readFileSync(path.join(dataDir, 'model-cache.json'), 'utf8'));
    assert.equal(saved.models.length, 3);

    const all = getAllModels();
    assert.ok(all.some((m) => m.id === 'deepseek-ocr'));
    assert.ok(!all.some((m) => m.id === 'qwen3-vl'), '与内置同基础名的官方条目应被去重');
    const ids = all.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, '合并目录的模型 id 不应重复');
    const before = all.length;
    await refreshRemoteModels({ baseUrl });
    assert.equal(getAllModels().length, before);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('获取失败时保留现有缓存与目录', async () => {
  const server = createServer((req, res) => {
    res.writeHead(500);
    res.end('boom');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(() => refreshRemoteModels({ baseUrl: `http://127.0.0.1:${server.address().port}` }));
    assert.equal(getCachedModels().length, 3);
    assert.ok(getAllModels().some((m) => m.id === 'deepseek-ocr'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('缓存文件损坏时回退为内置目录', async () => {
  writeFileSync(path.join(dataDir, 'model-cache.json'), '{broken');
  const fresh = await import('../src/model-library.mjs?case=corrupt');
  assert.equal(fresh.getCachedModels().length, 0);
  assert.ok(fresh.getAllModels().length >= 12);
});

test('无 vision 标签但命名明确的视觉模型也归为多模态', () => {
  const card = (id) => `<li><a href="/library/${id}" class="group"><div><h2><div><span class="group-hover:underline truncate">${id}</span></div></h2><p class="max-w-lg break-words text-neutral-800 text-md">x</p></div></a></li>`;
  const models = parseLibraryHtml(card('qwen2.5vl') + card('llama3.2-vision') + card('llava') + card('deepseek-ocr'));
  assert.equal(models.find((m) => m.id === 'qwen2.5vl').vision, true);
  assert.equal(models.find((m) => m.id === 'llama3.2-vision').vision, true);
  assert.equal(models.find((m) => m.id === 'llava').vision, true);
  assert.equal(models.find((m) => m.id === 'deepseek-ocr').vision, false);
});
