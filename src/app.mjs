import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG, isLoopbackHost, saveSelectedModel } from './config.mjs';
import { recommendModel, sortModelsForDisplay } from './model-catalog.mjs';
import { getAllModels, getCacheInfo, isCatalogModel, refreshRemoteModels } from './model-library.mjs';
import { getDeviceInfo } from './device.mjs';
import { isRemoteHost, checkRemoteAccess } from './remote-access.mjs';
import {
  createEmptyChat, listChats, getChat, saveChat, deleteChat, summarize,
  makeTitle, isValidId,
} from './chat-store.mjs';
import { saveImage, readImage, imageExists, ImageValidationError } from './image-store.mjs';
import { streamChat, buildOllamaMessages, assertModelAvailable, checkHealth, listDownloadedModels, pullModel, OllamaError } from './ollama.mjs';

const MAX_TEXT_CHARS = 32 * 1024;
const GENERATION_IDLE_TIMEOUT_MS = 900_000;

// 全局单生成锁：同时只允许一个生成请求。
const generationLock = { active: false };
function acquireLock() {
  if (generationLock.active) return false;
  generationLock.active = true;
  return true;
}
function releaseLock() {
  generationLock.active = false;
}

// 下载与生成使用独立的锁，互不影响。
const downloadLock = { active: false };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function writeNdjson(res, obj) {
  if (res.writableEnded || res.destroyed) return false;
  return res.write(JSON.stringify(obj) + '\n');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        if (!rejected) {
          rejected = true;
          // 继续排空请求体，保持连接可用，让调用方返回 413。
          reject(Object.assign(new Error('请求体过大'), { code: 'payload-too-large' }));
        }
        return;
      }
      if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit) {
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'bad-json' });
  }
}

// 默认仅允许本机；显式开启时允许私有局域网地址，并校验同源。
function isLocalRequest(req) {
  if (!isLoopbackHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' || !isLoopbackHost(url.host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// 解析并校验请求体中的目录内模型 id；失败时已发送错误响应，返回 null。
async function readCatalogModel(req, res) {
  let body;
  try {
    body = await readJsonBody(req, 16 * 1024);
  } catch (err) {
    sendError(res, 400, 'bad-json', err.message);
    return null;
  }
  const model = typeof body?.model === 'string' ? body.model : '';
  if (!isCatalogModel(model)) {
    sendError(res, 400, 'unknown-model', '模型不在可选目录中');
    return null;
  }
  return model;
}

async function handlePullModel(req, res) {
  const model = await readCatalogModel(req, res);
  if (!model) return;
  if (downloadLock.active) {
    return sendError(res, 409, 'download-busy', '已有下载正在进行，请稍后再试');
  }
  downloadLock.active = true;

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  const abort = new AbortController();
  const onClose = () => { if (!res.writableEnded) abort.abort(new Error('client-abort')); };
  res.on('close', onClose);

  try {
    for await (const event of pullModel({ model, signal: abort.signal })) {
      writeNdjson(res, {
        type: 'progress',
        status: event.status,
        completed: event.completed ?? null,
        total: event.total ?? null,
      });
    }
    writeNdjson(res, { type: 'done', model });
  } catch (err) {
    if (!res.destroyed && !res.writableEnded) {
      writeNdjson(res, {
        type: 'error',
        code: err.code || 'download-error',
        message: err.message,
      });
    }
  } finally {
    res.off('close', onClose);
    downloadLock.active = false;
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

async function handleSelectModel(req, res) {
  const model = await readCatalogModel(req, res);
  if (!model) return;

  let downloaded;
  try {
    downloaded = await listDownloadedModels();
  } catch (err) {
    return sendError(res, 502, err.code || 'ollama-unavailable', err.message);
  }
  if (!downloaded.includes(model)) {
    return sendError(res, 409, 'model-not-downloaded', '模型尚未下载，请先下载');
  }

  try {
    await saveSelectedModel(model);
  } catch (err) {
    return sendError(res, 500, 'storage-error', `配置保存失败: ${err.message}`);
  }
  sendJson(res, 200, { ok: true, model });
}

async function handleFetchRemoteModels(res) {
  try {
    const result = await refreshRemoteModels();
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    sendError(res, 502, 'fetch-failed', `在线获取模型目录失败: ${err.message}`);
  }
}

async function handleListModels(res) {
  const device = getDeviceInfo();
  let downloaded = [];
  try {
    downloaded = await listDownloadedModels();
  } catch {
    // Ollama 不可达时目录仍可浏览，下载标记全部为 false。
  }
  sendJson(res, 200, {
    device,
    current: CONFIG.model,
    cache: getCacheInfo(),
    models: sortModelsForDisplay(getAllModels(), device, CONFIG.model).map((model) => ({
      ...model,
      recommendation: recommendModel(model, device),
      downloaded: downloaded.includes(model.id),
      inUse: model.id === CONFIG.model,
    })),
  });
}

async function handleHealth(res) {
  const health = await checkHealth();
  sendJson(res, 200, {
    ...health,
    config: {
      model: CONFIG.model,
      numCtx: CONFIG.numCtx,
      maxImageBytes: CONFIG.maxImageBytes,
      dataDir: CONFIG.dataDir,
    },
  });
}

async function handleListChats(res) {
  const { chats, corrupt } = await listChats();
  sendJson(res, 200, { chats: chats.map(summarize), corrupt });
}

async function handleCreateChat(res) {
  const chat = createEmptyChat();
  await saveChat(chat);
  sendJson(res, 201, { chat });
}

async function handleGetChat(res, id) {
  const chat = await getChat(id);
  if (!chat) return sendError(res, 404, 'chat-not-found', '会话不存在');
  sendJson(res, 200, { chat });
}

async function handleDeleteChat(res, id) {
  const existed = await deleteChat(id);
  if (!existed) return sendError(res, 404, 'chat-not-found', '会话不存在');
  res.writeHead(204, SECURITY_HEADERS);
  res.end();
}

async function handleUploadImage(req, res, chatId) {
  const chat = await getChat(chatId);
  if (!chat) return sendError(res, 404, 'chat-not-found', '会话不存在');

  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
    return sendError(res, 415, 'unsupported-type', '仅支持 image/jpeg 或 image/png');
  }

  let buffer;
  try {
    buffer = await readBody(req, CONFIG.maxImageBytes + 1);
  } catch (err) {
    if (err.code === 'payload-too-large') {
      return sendError(res, 413, 'too-large', '图片超过大小限制');
    }
    throw err;
  }

  try {
    const image = await saveImage(chatId, buffer, contentType);
    sendJson(res, 201, {
      image: {
        id: image.id,
        chatId: image.chatId,
        mimeType: image.mimeType,
        size: image.size,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof ImageValidationError) {
      const status = err.code === 'too-large' ? 413 : err.code === 'unsupported-type' ? 415 : 400;
      return sendError(res, status, err.code, err.message);
    }
    throw err;
  }
}

async function handleGetImage(res, chatId, imageId) {
  if (!UUID_RE.test(imageId)) return sendError(res, 404, 'image-not-found', '图片不存在');
  const image = await readImage(chatId, imageId);
  if (!image) return sendError(res, 404, 'image-not-found', '图片不存在');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': image.mimeType,
    'Content-Length': image.buffer.length,
    'Cache-Control': 'private, max-age=3600',
  });
  res.end(image.buffer);
}

async function handlePostMessage(req, res, chatId) {
  const chat = await getChat(chatId);
  if (!chat) return sendError(res, 404, 'chat-not-found', '会话不存在');

  let body;
  try {
    body = await readJsonBody(req, 256 * 1024);
  } catch (err) {
    if (err.code === 'payload-too-large') return sendError(res, 413, 'too-large', '请求体过大');
    return sendError(res, 400, 'bad-json', err.message);
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return sendError(res, 400, 'empty-text', 'text 不能为空');
  if ([...text].length > MAX_TEXT_CHARS) {
    return sendError(res, 400, 'text-too-long', `text 超过 ${MAX_TEXT_CHARS} 字符`);
  }
  const imageId = body.imageId ?? null;
  if (imageId !== null) {
    const currentModel = getAllModels().find((m) => m.id === CONFIG.model);
    if (currentModel && currentModel.vision === false) {
      return sendError(res, 400, 'model-no-vision', '当前模型不支持图片，请移除图片或在模型设置中切换多模态模型');
    }
    if (!UUID_RE.test(imageId)) return sendError(res, 400, 'bad-image-id', 'imageId 必须是 UUID');
    if (!(await imageExists(chatId, imageId))) {
      return sendError(res, 400, 'image-not-found', '图片不存在或不属于该会话');
    }
  }

  if (!acquireLock()) {
    return sendError(res, 409, 'generation-busy', '已有生成正在进行，请先停止或稍后再试');
  }

  // 用户消息：保留、不可由生成失败回滚。
  const now = new Date().toISOString();
  const imageRecord = imageId ? await readImage(chatId, imageId) : null;
  const userMessage = {
    id: randomUUID(),
    role: 'user',
    text,
    createdAt: now,
    status: 'complete',
    ...(imageId ? { imageId, imageMimeType: imageRecord?.mimeType ?? null } : {}),
  };
  chat.messages.push(userMessage);
  if (!chat.title) chat.title = makeTitle(text);
  try {
    await saveChat(chat);
  } catch (err) {
    releaseLock();
    chat.messages.pop();
    return sendError(res, 500, 'storage-error', `会话保存失败: ${err.message}`);
  }

  // 预检 Ollama 与模型，失败时保留用户消息并允许重试。
  try {
    await assertModelAvailable();
  } catch (err) {
    releaseLock();
    const status = err instanceof OllamaError && err.code === 'model-missing' ? 409 : 502;
    return sendError(res, status, err.code, err.message);
  }

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });

  const abort = new AbortController();
  const idleTimer = setTimeout(() => abort.abort(new Error('idle-timeout')), GENERATION_IDLE_TIMEOUT_MS);
  const onClose = () => { if (!res.writableEnded) abort.abort(new Error('client-abort')); };
  res.on('close', onClose);

  let fullText = '';
  let settled = false;

  const finish = async (status) => {
    if (settled) return;
    settled = true;
    clearTimeout(idleTimer);
    res.off('close', onClose);
    const assistantMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: fullText,
      createdAt: new Date().toISOString(),
      status,
    };
    try {
      chat.messages.push(assistantMessage);
      await saveChat(chat);
    } catch (err) {
      writeNdjson(res, {
        type: 'error',
        code: 'storage-error',
        message: `回答已生成但保存失败: ${err.message}`,
        partial: true,
      });
    }
    releaseLock();
  };

  try {
    const ollamaMessages = buildOllamaMessages(
      chat,
      userMessage,
      imageRecord ? imageRecord.buffer.toString('base64') : null,
    );
    for await (const delta of streamChat({ messages: ollamaMessages, signal: abort.signal })) {
      fullText += delta;
      if (!writeNdjson(res, { type: 'delta', text: delta })) {
        abort.abort(new Error('client-gone'));
        break;
      }
    }
    await finish('complete');
    writeNdjson(res, { type: 'done', message: chat.messages[chat.messages.length - 1] });
  } catch (err) {
    const aborted = abort.signal.aborted || (err instanceof OllamaError && err.code === 'aborted');
    await finish(aborted ? 'stopped' : 'error');
    if (!res.destroyed && !res.writableEnded) {
      writeNdjson(res, {
        type: 'error',
        code: aborted ? 'stopped' : err.code || 'generation-error',
        message: aborted
          ? '已停止，部分回答已保存'
          : (err instanceof OllamaError ? err.message : `生成失败: ${err.message}`),
        partial: aborted,
      });
    }
  } finally {
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendError(res, 400, 'bad-path', '路径不合法');
  }
  const relPath = decoded === '/' ? '/index.html' : decoded;
  const fullPath = path.resolve(CONFIG.publicDir, '.' + relPath);
  if (!fullPath.startsWith(CONFIG.publicDir + path.sep)) {
    return sendError(res, 403, 'forbidden', '禁止访问该路径');
  }
  const base = path.basename(fullPath);
  if (base.startsWith('.')) return sendError(res, 404, 'not-found', '文件不存在');

  let filePath = fullPath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    return sendError(res, 404, 'not-found', '文件不存在');
  }

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
    });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  } catch {
    sendError(res, 404, 'not-found', '文件不存在');
  }
}

async function route(req, res) {
  if (isRemoteHost(req.headers.host)) {
    const access = checkRemoteAccess(req);
    if (access.action === 'redirect') {
      res.writeHead(302, { ...SECURITY_HEADERS, Location: access.location, 'Set-Cookie': access.setCookie });
      return res.end();
    }
    if (access.action === 'deny') {
      return sendError(res, access.status, access.code, access.message);
    }
  } else if (!isLocalRequest(req)) {
    return sendError(res, 403, 'forbidden', '仅允许本机回环地址访问');
  }

  const url = new URL(req.url, `http://${CONFIG.host}:${CONFIG.port}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') return handleHealth(res);
  if (pathname === '/api/models' && method === 'GET') return handleListModels(res);
  if (pathname === '/api/models/select' && method === 'POST') return handleSelectModel(req, res);
  if (pathname === '/api/models/pull' && method === 'POST') return handlePullModel(req, res);
  if (pathname === '/api/models/fetch-remote' && method === 'POST') return handleFetchRemoteModels(res);

  if (pathname === '/api/chats') {
    if (method === 'GET') return handleListChats(res);
    if (method === 'POST') return handleCreateChat(res);
    return sendError(res, 405, 'method-not-allowed', '不支持的方法');
  }

  const chatMatch = pathname.match(/^\/api\/chats\/([0-9a-fA-F-]{36})$/);
  if (chatMatch) {
    const id = chatMatch[1].toLowerCase();
    if (!isValidId(id)) return sendError(res, 404, 'chat-not-found', '会话不存在');
    if (method === 'GET') return handleGetChat(res, id);
    if (method === 'DELETE') return handleDeleteChat(res, id);
    return sendError(res, 405, 'method-not-allowed', '不支持的方法');
  }

  const messagesMatch = pathname.match(/^\/api\/chats\/([0-9a-fA-F-]{36})\/messages$/);
  if (messagesMatch) {
    if (method !== 'POST') return sendError(res, 405, 'method-not-allowed', '不支持的方法');
    return handlePostMessage(req, res, messagesMatch[1].toLowerCase());
  }

  const imagesMatch = pathname.match(/^\/api\/chats\/([0-9a-fA-F-]{36})\/images$/);
  if (imagesMatch) {
    if (method !== 'POST') return sendError(res, 405, 'method-not-allowed', '不支持的方法');
    return handleUploadImage(req, res, imagesMatch[1].toLowerCase());
  }

  const imageMatch = pathname.match(/^\/api\/chats\/([0-9a-fA-F-]{36})\/images\/([0-9a-fA-F-]{36})$/);
  if (imageMatch) {
    if (method !== 'GET') return sendError(res, 405, 'method-not-allowed', '不支持的方法');
    return handleGetImage(res, imageMatch[1].toLowerCase(), imageMatch[2].toLowerCase());
  }

  if (pathname.startsWith('/api/')) {
    return sendError(res, 404, 'not-found', '接口不存在');
  }

  if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, pathname);
  return sendError(res, 405, 'method-not-allowed', '不支持的方法');
}

export function createApp() {
  return createServer((req, res) => {
    route(req, res).catch((err) => {
      if (!res.headersSent) {
        sendError(res, 500, 'internal-error', '服务器内部错误');
      } else if (!res.writableEnded) {
        res.end();
      }
      let pathname = req.url;
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch {
        // 保留原始值用于日志。
      }
      console.error(`[error] ${req.method} ${pathname}: ${err.name}: ${err.message}`);
    });
  });
}
