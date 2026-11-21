import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CATALOG, recommendModel } from '../src/model-catalog.mjs';
import { getDeviceInfo } from '../src/device.mjs';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-catalog-');
const { isCatalogModel } = await import('../src/model-library.mjs');

function device(memGB, isAppleSilicon = false) {
  return { totalMemBytes: memGB * 1024 ** 3, isAppleSilicon };
}

function tierOf(id) {
  return MODEL_CATALOG.find((m) => m.id === id).tier;
}

test('目录包含默认模型，且每条都有完整的能力说明', () => {
  assert.ok(isCatalogModel('qwen3-vl:2b-instruct-q4_K_M'));
  assert.equal(isCatalogModel('some-unknown:model'), false);
  for (const model of MODEL_CATALOG) {
    assert.ok(model.id && model.family && model.params && model.summary);
    assert.ok(model.sizeGB > 0);
    assert.ok(model.capabilities.chinese && model.capabilities.ocr && model.capabilities.speed);
    assert.ok([1, 2, 3].includes(model.tier));
  }
});

test('小内存设备（<8 GiB）只推荐 2B', () => {
  const d = device(6);
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 1), d).level, 'recommended');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 2), d).level, 'not-recommended');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 3), d).level, 'not-recommended');
});

test('本机档位（8-16 GiB）推荐 2B，4B 可试，8B 不推荐', () => {
  const d = device(11);
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 1), d).level, 'recommended');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 2), d).level, 'usable');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 3), d).level, 'not-recommended');
});

test('16-32 GiB 推荐 4B，8B 可试', () => {
  const d = device(16);
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 2), d).level, 'recommended');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 3), d).level, 'usable');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 1), d).level, 'usable');
});

test('32 GiB 以上推荐 8B', () => {
  const d = device(32);
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 3), d).level, 'recommended');
});

test('推荐理由包含本机内存数值，Apple Silicon 提及 Metal', () => {
  const r = recommendModel(MODEL_CATALOG.find((m) => m.tier === 1), device(11, true));
  assert.match(r.reason, /11 GiB/);
  assert.match(r.reason, /Metal/);
});

test('Apple Silicon 推 4B、8B 可试（Q3 明确授权的分档）', () => {
  const d = device(16, true);
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 2), d).level, 'recommended');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 3), d).level, 'usable');
  const small = device(8, true);
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 2), small).level, 'recommended');
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 3), small).level, 'usable');
});

test('Apple Silicon 32 GiB 以上推荐 8B', () => {
  const d = device(32, true);
  assert.equal(recommendModel(MODEL_CATALOG.find((m) => m.tier === 3), d).level, 'recommended');
});

test('设备检测返回 CPU、内存与平台信息', () => {
  const info = getDeviceInfo();
  assert.ok(info.cpuModel.length > 0);
  assert.ok(info.cores >= 1);
  assert.ok(info.totalMemBytes > 0);
  assert.ok(info.freeMemBytes >= 0);
  assert.equal(info.isAppleSilicon, info.platform === 'darwin' && info.arch === 'arm64');
});
