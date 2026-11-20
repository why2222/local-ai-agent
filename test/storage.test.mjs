import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from '../src/storage.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'local-ai-storage-'));

test('写入后读回相同数据，覆盖写也生效', async () => {
  const file = path.join(dir, 'chat.json');
  await writeJsonAtomic(file, { id: 'a', messages: [{ text: '你好' }] });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { id: 'a', messages: [{ text: '你好' }] });

  await writeJsonAtomic(file, { id: 'a', messages: [] });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { id: 'a', messages: [] });
});

test('写入完成后不残留临时文件', async () => {
  const file = path.join(dir, 'clean.json');
  await writeJsonAtomic(file, { ok: true });
  const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});
