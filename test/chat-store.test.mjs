import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { useTempDataDir } from './helpers/temp-dir.mjs';

useTempDataDir('local-ai-chats-');

const { CONFIG } = await import('../src/config.mjs');
const {
  createEmptyChat, listChats, getChat, saveChat, deleteChat, summarize,
  makeTitle, isValidId, TITLE_MAX_CHARS,
} = await import('../src/chat-store.mjs');
const { saveImage } = await import('../src/image-store.mjs');
const { writeJsonAtomic } = await import('../src/storage.mjs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('createEmptyChat 返回空会话结构', () => {
  const chat = createEmptyChat();
  assert.match(chat.id, UUID_RE);
  assert.equal(chat.title, '');
  assert.deepEqual(chat.messages, []);
  assert.ok(!Number.isNaN(Date.parse(chat.createdAt)));
});

test('makeTitle 压缩连续空白并去除首尾空白', () => {
  assert.equal(makeTitle('  你好 \n\t 世界  '), '你好 世界');
});

test('makeTitle 按字符截断，不截断 emoji', () => {
  assert.equal(makeTitle('字'.repeat(TITLE_MAX_CHARS)).length, TITLE_MAX_CHARS);
  assert.equal(makeTitle('字'.repeat(TITLE_MAX_CHARS + 1)), '字'.repeat(TITLE_MAX_CHARS) + '…');
  const emojis = makeTitle('🙂'.repeat(TITLE_MAX_CHARS + 1));
  assert.equal([...emojis].length, TITLE_MAX_CHARS + 1);
  assert.ok(emojis.endsWith('…'));
});

test('isValidId 只接受小写 UUID', () => {
  assert.equal(isValidId('123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(isValidId('123E4567-E89B-42D3-A456-426614174000'), false);
  assert.equal(isValidId('not-a-uuid'), false);
  assert.equal(isValidId(''), false);
});

test('saveChat 后可 getChat 读回，updatedAt 被刷新', async () => {
  const chat = createEmptyChat();
  chat.messages.push({ id: 'm1', role: 'user', text: '你好', status: 'complete' });
  const before = chat.updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await saveChat(chat);
  const loaded = await getChat(chat.id);
  assert.equal(loaded.id, chat.id);
  assert.equal(loaded.messages.length, 1);
  assert.ok(loaded.updatedAt >= before);
  assert.deepEqual(summarize(loaded).messageCount, 1);
});

test('listChats 按 updatedAt 倒序', async () => {
  const oldChat = { ...createEmptyChat(), title: '旧', updatedAt: '2026-01-01T00:00:00.000Z' };
  const newChat = { ...createEmptyChat(), title: '新', updatedAt: '2026-11-01T00:00:00.000Z' };
  await writeJsonAtomic(path.join(CONFIG.chatsDir, `${oldChat.id}.json`), oldChat);
  await writeJsonAtomic(path.join(CONFIG.chatsDir, `${newChat.id}.json`), newChat);
  const { chats, corrupt } = await listChats();
  assert.deepEqual(corrupt, []);
  const titles = chats.map((c) => c.title);
  assert.ok(titles.indexOf('新') < titles.indexOf('旧'));
});

test('损坏会话被隔离到 quarantine，不影响其他会话', async () => {
  const good = createEmptyChat();
  good.title = '正常';
  await saveChat(good);
  const badId = '123e4567-e89b-42d3-a456-426614174000';
  const badFile = path.join(CONFIG.chatsDir, `${badId}.json`);
  writeFileSync(badFile, '{broken json');

  const { chats, corrupt } = await listChats();
  assert.ok(chats.some((c) => c.id === good.id));
  assert.ok(!chats.some((c) => c.id === badId));
  assert.equal(corrupt.length, 1);
  assert.equal(corrupt[0].id, badId);
  assert.equal(corrupt[0].reason, 'corrupt-json');
  assert.equal(existsSync(badFile), false);
  assert.ok(readdirSync(CONFIG.quarantineDir).some((name) => name.startsWith(badId)));
  assert.equal(await getChat(badId), null);
});

test('非 UUID 命名的 json 文件被忽略且不隔离', async () => {
  writeFileSync(path.join(CONFIG.chatsDir, 'notes.json'), '{}');
  const { corrupt } = await listChats();
  assert.deepEqual(corrupt, []);
  assert.ok(existsSync(path.join(CONFIG.chatsDir, 'notes.json')));
});

test('deleteChat 同时删除会话文件和图片，重复删除返回 false', async () => {
  const chat = createEmptyChat();
  await saveChat(chat);
  await saveImage(chat.id, PNG, 'image/png');
  assert.equal(await deleteChat(chat.id), true);
  assert.equal(existsSync(path.join(CONFIG.chatsDir, `${chat.id}.json`)), false);
  assert.equal(existsSync(path.join(CONFIG.imagesDir, chat.id)), false);
  assert.equal(await deleteChat(chat.id), false);
});
