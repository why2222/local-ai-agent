import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-images-');

const { CONFIG } = await import('../src/config.mjs');
const {
  saveImage, readImage, imageExists, deleteChatImages, ImageValidationError,
} = await import('../src/image-store.mjs');

const CHAT_ID = '123e4567-e89b-42d3-a456-426614174000';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function expectCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ImageValidationError);
    assert.equal(err.code, code);
    return true;
  });
}

test('拒绝空图片和非 Buffer 输入', async () => {
  await expectCode(saveImage(CHAT_ID, Buffer.alloc(0), 'image/png'), 'empty-body');
  await expectCode(saveImage(CHAT_ID, 'not-a-buffer', 'image/png'), 'empty-body');
});

test('拒绝超过大小限制的图片', async () => {
  const big = Buffer.alloc(CONFIG.maxImageBytes + 1);
  PNG.copy(big, 0);
  await expectCode(saveImage(CHAT_ID, big, 'image/png'), 'too-large');
});

test('拒绝不支持的 Content-Type', async () => {
  await expectCode(saveImage(CHAT_ID, PNG, 'text/plain'), 'unsupported-type');
  await expectCode(saveImage(CHAT_ID, PNG, ''), 'unsupported-type');
});

test('拒绝文件签名与声明格式不一致的图片', async () => {
  await expectCode(saveImage(CHAT_ID, JPEG, 'image/png'), 'signature-mismatch');
  await expectCode(saveImage(CHAT_ID, Buffer.from('hello world'), 'image/png'), 'signature-mismatch');
});

test('PNG 保存后可读回，Content-Type 允许携带参数', async () => {
  const saved = await saveImage(CHAT_ID, PNG, 'image/png; charset=binary');
  assert.equal(saved.ext, 'png');
  assert.equal(saved.mimeType, 'image/png');
  assert.equal(saved.size, PNG.length);

  const loaded = await readImage(CHAT_ID, saved.id);
  assert.equal(loaded.mimeType, 'image/png');
  assert.deepEqual(loaded.buffer, PNG);
  assert.equal(await imageExists(CHAT_ID, saved.id), true);
});

test('JPEG 保存为 jpg 扩展名', async () => {
  const saved = await saveImage(CHAT_ID, JPEG, 'image/jpeg');
  assert.equal(saved.ext, 'jpg');
  const loaded = await readImage(CHAT_ID, saved.id);
  assert.equal(loaded.mimeType, 'image/jpeg');
  assert.deepEqual(loaded.buffer, JPEG);
});

test('不存在的图片返回 null / false', async () => {
  const missingId = '00000000-0000-4000-8000-000000000000';
  assert.equal(await readImage(CHAT_ID, missingId), null);
  assert.equal(await imageExists(CHAT_ID, missingId), false);
});

test('deleteChatImages 删除整个会话图片目录', async () => {
  const chatId = '223e4567-e89b-42d3-a456-426614174000';
  const saved = await saveImage(chatId, PNG, 'image/png');
  await deleteChatImages(chatId);
  assert.equal(await imageExists(chatId, saved.id), false);
  assert.equal(await readImage(chatId, saved.id), null);
});
