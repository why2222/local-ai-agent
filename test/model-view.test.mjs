import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterModelsForView } from '../public/model-view.mjs';

const MODELS = [
  { id: 'qwen3.5:4b', family: 'Qwen3.5', vendor: 'qwen', vision: true, downloaded: true, inUse: false, releaseDate: '2026-03', summary: '新一代', recommendation: { level: 'recommended' } },
  { id: 'qwen3-vl:2b', family: 'Qwen3-VL', vendor: 'qwen', vision: true, downloaded: true, inUse: true, releaseDate: '2025-11', summary: '默认', recommendation: { level: 'recommended' } },
  { id: 'qwen2.5vl:3b', family: 'Qwen2.5-VL', vendor: 'qwen', vision: true, downloaded: false, inUse: false, releaseDate: '2025-01', summary: '上一代', recommendation: { level: 'recommended' } },
  { id: 'deepseek-r1:1.5b', family: 'DeepSeek-R1', vendor: 'deepseek', vision: false, downloaded: false, inUse: false, releaseDate: '2025-01', summary: '纯文本推理', recommendation: { level: 'recommended' } },
  { id: 'deepseek-ocr', family: 'deepseek-ocr', vendor: 'deepseek', vision: true, downloaded: false, inUse: false, releaseDate: null, updatedAt: '2025-12-01', summary: 'OCR model', source: 'remote', recommendation: { level: 'usable' } },
  { id: 'gemma4:e4b', family: 'Gemma 4', vendor: 'google', vision: true, downloaded: false, inUse: false, releaseDate: null, updatedAt: '2026-06-01', summary: 'Google 多模态', recommendation: { level: 'usable' } },
];

test('按厂商分组，组内按时间新到旧排序，使用中优先', () => {
  const groups = filterModelsForView(MODELS);
  assert.deepEqual(groups.map((g) => g.key), ['qwen', 'deepseek', 'google']);
  const qwen = groups[0].models.map((m) => m.id);
  assert.equal(qwen[0], 'qwen3-vl:2b', '使用中排最前');
  assert.deepEqual(qwen.slice(1), ['qwen3.5:4b', 'qwen2.5vl:3b'], '其余按时间新到旧');
  assert.equal(groups[0].label, 'Qwen · 阿里通义');
});

test('厂商多选：只显示选中厂商（可多选）', () => {
  const groups = filterModelsForView(MODELS, { vendors: ['qwen', 'google'] });
  assert.deepEqual(groups.map((g) => g.key), ['qwen', 'google']);
  assert.ok(!groups.some((g) => g.key === 'deepseek'));
});

test('厂商+类型组合筛选（Qwen + 多模态）', () => {
  const groups = filterModelsForView(MODELS, { vendors: ['qwen'], filterType: 'vision' });
  assert.equal(groups.length, 1);
  assert.ok(groups[0].models.every((m) => m.vendor === 'qwen' && m.vision));
});

test('纯文本筛选排除视觉模型', () => {
  const groups = filterModelsForView(MODELS, { filterType: 'text' });
  const all = groups.flatMap((g) => g.models);
  assert.deepEqual(all.map((m) => m.id), ['deepseek-r1:1.5b']);
});

test('搜索跨全部目录，已下载筛选只保留已下载', () => {
  const found = filterModelsForView(MODELS, { searchText: 'deepseek' });
  const all = found.flatMap((g) => g.models);
  assert.deepEqual(all.map((m) => m.id).sort(), ['deepseek-ocr', 'deepseek-r1:1.5b']);
  const downloaded = filterModelsForView(MODELS, { filterType: 'downloaded' });
  assert.deepEqual(downloaded.flatMap((g) => g.models).map((m) => m.id).sort(), ['qwen3-vl:2b', 'qwen3.5:4b']);
});

test('无匹配返回空分组', () => {
  assert.deepEqual(filterModelsForView(MODELS, { searchText: 'no-such' }), []);
});
