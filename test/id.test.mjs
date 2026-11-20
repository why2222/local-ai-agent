import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createId } from '../public/id.mjs';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function withCrypto(value, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
}

test('浏览器提供 crypto.randomUUID 时直接使用它', async () => {
  const known = '123e4567-e89b-42d3-a456-426614174000';
  await withCrypto({ randomUUID: () => known }, () => {
    assert.equal(createId(), known);
  });
});

test('非安全上下文没有 randomUUID 时回退生成合法 UUID v4', async () => {
  await withCrypto({ getRandomValues: (bytes) => bytes.fill(1) }, () => {
    const id = createId();
    assert.match(id, UUID_V4_RE);
  });
});

test('完全没有 crypto 时仍能生成合法 UUID v4，且两次不同', async () => {
  await withCrypto(undefined, () => {
    const a = createId();
    const b = createId();
    assert.match(a, UUID_V4_RE);
    assert.match(b, UUID_V4_RE);
    assert.notEqual(a, b);
  });
});
