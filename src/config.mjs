import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from './storage.mjs';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SRC_DIR, '..');

export const ALLOW_LAN = process.env.LOCAL_AI_ALLOW_LAN === '1';
export const HOST = ALLOW_LAN ? '0.0.0.0' : '127.0.0.1';
export const OLLAMA_URL = process.env.LOCAL_AI_OLLAMA_URL || 'http://127.0.0.1:11434';
export const LIBRARY_URL = process.env.LOCAL_AI_LIBRARY_URL || 'https://ollama.com';

// 远程访问模式：默认关闭，必须同时配置域名和访问令牌才启用。
export const REMOTE_HOST = (process.env.LOCAL_AI_REMOTE_HOST || '').toLowerCase().replace(/:443$/, '');
export const REMOTE_TOKEN = process.env.LOCAL_AI_REMOTE_TOKEN || '';
if (REMOTE_HOST && !REMOTE_TOKEN) {
  throw new Error('已设置 LOCAL_AI_REMOTE_HOST，必须同时设置 LOCAL_AI_REMOTE_TOKEN（访问令牌），不允许无认证远程访问');
}
if (!REMOTE_HOST && REMOTE_TOKEN) {
  throw new Error('已设置 LOCAL_AI_REMOTE_TOKEN，必须同时设置 LOCAL_AI_REMOTE_HOST（远程访问域名）');
}
if (REMOTE_TOKEN && !/^[A-Za-z0-9_-]{16,}$/.test(REMOTE_TOKEN)) {
  throw new Error('LOCAL_AI_REMOTE_TOKEN 必须是至少 16 位的 URL 安全字符（字母、数字、_、-），请用随机长令牌');
}

const DEFAULTS = {
  model: 'qwen3-vl:2b-instruct-q4_K_M',
  port: 43210,
  numCtx: 2048,
  maxImageBytes: 8 * 1024 * 1024,
  dataDir: 'data',
};

export const CONFIG_FILE_PATH = process.env.LOCAL_AI_CONFIG_FILE || path.join(ROOT_DIR, 'config.json');

function loadConfigFile() {
  const configPath = CONFIG_FILE_PATH;
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error(`配置文件损坏或不是合法 JSON: ${configPath}`);
  }
}

function resolveConfig() {
  const raw = loadConfigFile();
  const config = { ...DEFAULTS, ...raw };

  if (typeof config.model !== 'string' || config.model.length === 0) {
    throw new Error('config.json: model 必须是非空字符串');
  }
  const port = Number(config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('config.json: port 必须是 1-65535 的整数');
  }
  const numCtx = Number(config.numCtx);
  if (!Number.isInteger(numCtx) || numCtx < 512 || numCtx > 128 * 1024) {
    throw new Error('config.json: numCtx 必须是 512-131072 的整数');
  }
  const maxImageBytes = Number(config.maxImageBytes);
  if (!Number.isInteger(maxImageBytes) || maxImageBytes < 1024 || maxImageBytes > 64 * 1024 * 1024) {
    throw new Error('config.json: maxImageBytes 必须是 1KiB-64MiB 的整数');
  }
  if (typeof config.dataDir !== 'string' || config.dataDir.length === 0) {
    throw new Error('config.json: dataDir 必须是非空字符串');
  }

  const dataDir = path.resolve(ROOT_DIR, process.env.LOCAL_AI_DATA_DIR || config.dataDir);
  const chatsDir = path.join(dataDir, 'chats');
  const imagesDir = path.join(dataDir, 'images');
  const quarantineDir = path.join(dataDir, 'quarantine');
  const publicDir = path.join(ROOT_DIR, 'public');

  for (const dir of [dataDir, chatsDir, imagesDir, quarantineDir]) {
    mkdirSync(dir, { recursive: true });
  }

  return {
    rootDir: ROOT_DIR,
    model: config.model,
    port,
    numCtx,
    maxImageBytes,
    dataDir,
    chatsDir,
    imagesDir,
    quarantineDir,
    publicDir,
    host: HOST,
    ollamaUrl: OLLAMA_URL,
  };
}

export const CONFIG = resolveConfig();

export async function saveSelectedModel(model) {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(CONFIG_FILE_PATH, 'utf8'));
  } catch {
    // 配置文件缺失或损坏时以当前配置为准重写。
  }
  raw.model = model;
  await writeJsonAtomic(CONFIG_FILE_PATH, raw);
  CONFIG.model = model;
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  const allowed = new Set([
    `127.0.0.1:${CONFIG.port}`,
    `localhost:${CONFIG.port}`,
    `[::1]:${CONFIG.port}`,
  ]);
  if (allowed.has(hostHeader.toLowerCase())) return true;
  if (!ALLOW_LAN) return false;
  try {
    const url = new URL(`http://${hostHeader}`);
    return Number(url.port) === CONFIG.port && isPrivateIPv4(url.hostname);
  } catch {
    return false;
  }
}
