import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CATALOG, sortModelsForDisplay } from '../src/model-catalog.mjs';

const device = { totalMemBytes: 11 * 1024 ** 3, isAppleSilicon: false };

test('内置目录每个模型都有 vision 标记，纯文本模型标注不支持图片', () => {
  assert.ok(MODEL_CATALOG.length >= 12);
  for (const model of MODEL_CATALOG) {
    assert.equal(typeof model.vision, 'boolean');
  }
  const textOnly = MODEL_CATALOG.filter((m) => !m.vision);
  assert.ok(textOnly.length >= 3);
  assert.ok(textOnly.some((m) => m.id.startsWith('deepseek-r1:')));
});

test('分组排序：多模态在前，组内按推荐度再按 tier', () => {
  const sorted = sortModelsForDisplay(MODEL_CATALOG, device);
  const firstTextIndex = sorted.findIndex((m) => !m.vision);
  assert.ok(firstTextIndex > 0);
  assert.ok(sorted.slice(0, firstTextIndex).every((m) => m.vision));
  assert.ok(sorted.slice(firstTextIndex).every((m) => !m.vision));

  // 多模态组内：推荐 2B 排在不推荐 8B 前
  const twoB = sorted.findIndex((m) => m.id === 'qwen3-vl:2b-instruct-q4_K_M');
  const eightB = sorted.findIndex((m) => m.id === 'qwen3-vl:8b');
  assert.ok(twoB < eightB);
});

test('使用中模型排最前，内置精选在远程模型之前', () => {
  const remote = {
    id: 'remote-small', family: 'remote-small', params: '1B', tier: 1, sizeGB: null,
    vision: true, summary: 'remote', capabilities: { chinese: '未知', ocr: '未知', speed: '快' }, source: 'remote',
  };
  const sorted = sortModelsForDisplay([...MODEL_CATALOG, remote], device, 'qwen3-vl:2b-instruct-q4_K_M');
  assert.equal(sorted[0].id, 'qwen3-vl:2b-instruct-q4_K_M');
  const builtinIndex = sorted.findIndex((m) => m.id === 'qwen3-vl:4b-instruct-q4_K_M');
  const remoteIndex = sorted.findIndex((m) => m.id === 'remote-small');
  assert.ok(builtinIndex < remoteIndex, '内置精选应排在远程模型之前');
});
