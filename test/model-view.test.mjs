import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterModelsForView } from '../public/model-view.mjs';

const MODELS = [
  { id: 'qwen3-vl:2b', family: 'Qwen3-VL', vision: true, downloaded: true, summary: '默认模型' },
  { id: 'deepseek-r1:1.5b', family: 'DeepSeek-R1', vision: false, downloaded: false, summary: '纯文本推理' },
  { id: 'deepseek-ocr', family: 'deepseek-ocr', vision: true, downloaded: false, summary: 'OCR model', source: 'remote' },
  { id: 'bonsai-2', family: 'bonsai-2', vision: true, downloaded: false, summary: 'Vision model', source: 'remote' },
  { id: 'tiny-text', family: 'tiny-text', vision: false, downloaded: true, summary: 'text', source: 'remote' },
];

test('默认按多模态/纯文本分组，在线目录折叠', () => {
  const groups = filterModelsForView(MODELS, {});
  assert.deepEqual(groups.map((g) => g.key), ['vision', 'text', 'remote']);
  assert.equal(groups[0].models.length, 1);
  assert.equal(groups[1].models.length, 1);
  assert.equal(groups[2].collapsed, true);
  assert.equal(groups[2].models.length, 3);
});

test('手动展开在线目录', () => {
  const groups = filterModelsForView(MODELS, { remoteExpanded: true });
  assert.equal(groups.find((g) => g.key === 'remote').collapsed, false);
});

test('搜索跨全部目录且强制展开在线目录', () => {
  const groups = filterModelsForView(MODELS, { searchText: 'deepseek' });
  assert.equal(groups.find((g) => g.key === 'remote').collapsed, false);
  const remote = groups.find((g) => g.key === 'remote');
  assert.deepEqual(remote.models.map((m) => m.id), ['deepseek-ocr']);
  assert.equal(groups.find((g) => g.key === 'text').models.length, 1);
});

test('已下载筛选只保留已下载并展开在线目录', () => {
  const groups = filterModelsForView(MODELS, { filterType: 'downloaded' });
  assert.equal(groups.find((g) => g.key === 'remote').collapsed, false);
  const all = groups.flatMap((g) => g.models);
  assert.deepEqual(all.map((m) => m.id), ['qwen3-vl:2b', 'tiny-text']);
});

test('多模态筛选排除纯文本（含在线目录中的纯文本）', () => {
  const groups = filterModelsForView(MODELS, { filterType: 'vision', remoteExpanded: true });
  const all = groups.flatMap((g) => g.models);
  assert.ok(all.every((m) => m.vision));
  assert.ok(!groups.some((g) => g.key === 'text'));
});

test('无匹配时返回空分组列表', () => {
  const groups = filterModelsForView(MODELS, { searchText: 'no-such-model' });
  assert.deepEqual(groups, []);
});
