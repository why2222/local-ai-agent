import { readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { deleteChatImages } from './image-store.mjs';

export const TITLE_MAX_CHARS = 40;

export function createEmptyChat() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function chatFile(id) {
  return path.join(CONFIG.chatsDir, `${id}.json`);
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function isValidId(value) {
  return isUuid(value);
}

export function makeTitle(text) {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  const chars = [...compact];
  return chars.length > TITLE_MAX_CHARS ? chars.slice(0, TITLE_MAX_CHARS).join('') + '…' : compact;
}

async function quarantineCorrupt(file, id, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(CONFIG.quarantineDir, `${id}-${stamp}.json`);
  try {
    await rename(file, target);
  } catch {
    // 隔离失败不阻断启动；文件保留原处。
  }
  return { id, quarantinedAt: new Date().toISOString(), reason };
}

async function loadChatFile(file) {
  const id = path.basename(file, '.json');
  if (!isUuid(id)) return { chat: null, corrupt: null };
  try {
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(raw);
    if (!data || data.id !== id || !Array.isArray(data.messages)) {
      throw new Error('会话文件结构不合法');
    }
    return { chat: data, corrupt: null };
  } catch {
    return { chat: null, corrupt: await quarantineCorrupt(file, id, 'corrupt-json') };
  }
}

// 返回 { chats, corrupt }；chats 按 updatedAt 倒序，corrupt 为本次被隔离的损坏会话。
export async function listChats() {
  const entries = await readdir(CONFIG.chatsDir);
  const chats = [];
  const corrupt = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const { chat, corrupt: bad } = await loadChatFile(path.join(CONFIG.chatsDir, entry));
    if (chat) chats.push(chat);
    if (bad) corrupt.push(bad);
  }
  chats.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { chats, corrupt };
}

// 返回会话；不存在返回 null，损坏文件已被隔离。
export async function getChat(id) {
  if (!isUuid(id)) return null;
  const { chat, corrupt } = await loadChatFile(chatFile(id));
  return chat;
}

export async function saveChat(chat) {
  chat.updatedAt = new Date().toISOString();
  await writeJsonAtomic(chatFile(chat.id), chat);
  return chat;
}

export function summarize(chat) {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  };
}

export async function deleteChat(id) {
  if (!isUuid(id)) return false;
  const existed = (await getChat(id)) !== null;
  await rm(chatFile(id), { force: true });
  await deleteChatImages(id);
  return existed;
}
