import { CONFIG } from './config.mjs';

export class OllamaError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 健康检查：Ollama 是否运行、默认模型是否已下载。
export async function checkHealth() {
  const result = {
    ollama: { running: false },
    model: { name: CONFIG.model, available: false },
  };
  try {
    const res = await fetch(`${CONFIG.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    result.ollama = { running: true };
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];
    result.model.available = models.some((m) => m && m.name === CONFIG.model);
  } catch (err) {
    result.ollama = { running: false, error: err.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
  result.ok = result.ollama.running && result.model.available;
  return result;
}

export async function assertModelAvailable() {
  const health = await checkHealth();
  if (!health.ollama.running) {
    throw new OllamaError('ollama-unavailable', 'Ollama 未运行，请先启动 Ollama 后重试');
  }
  if (!health.model.available) {
    throw new OllamaError(
      'model-missing',
      `模型 ${CONFIG.model} 未下载，请运行 npm run setup 下载 ${CONFIG.model}`,
    );
  }
}

async function* readNdjsonLines(body) {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, idx).trim();
      pending = pending.slice(idx + 1);
      if (line) yield line;
    }
  }
  pending += decoder.decode();
  const tail = pending.trim();
  if (tail) yield tail;
}

// 调用 Ollama /api/chat（stream=true），逐个产出 content 增量。
// signal 用于中止上游生成（用户停止或超时）。
export async function* streamChat({ messages, signal }) {
  let res;
  try {
    res = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.model,
        messages,
        stream: true,
        options: { num_ctx: CONFIG.numCtx },
      }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new OllamaError('aborted', '生成已中止');
    throw new OllamaError('ollama-unavailable', `无法连接 Ollama: ${err.message}`);
  }

  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // ignore
    }
    if (res.status === 404) {
      throw new OllamaError('model-missing', `模型 ${CONFIG.model} 不可用，请运行 npm run setup 下载 ${CONFIG.model}`, res.status);
    }
    throw new OllamaError('ollama-error', `Ollama 返回错误 HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }

  let sawDone = false;
  try {
    for await (const line of readNdjsonLines(res.body)) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.error) {
        throw new OllamaError('generation-error', String(parsed.error));
      }
      const content = parsed.message && typeof parsed.message.content === 'string'
        ? parsed.message.content
        : '';
      if (content) yield content;
      if (parsed.done) {
        sawDone = true;
        break;
      }
    }
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (err.name === 'AbortError') throw new OllamaError('aborted', '生成已中止');
    throw new OllamaError('generation-error', `流式读取失败: ${err.message}`);
  }
  if (!sawDone && signal && signal.aborted) {
    throw new OllamaError('aborted', '生成已中止');
  }
}

// 按 numCtx 预算裁剪历史：从最新往前累加，超出预算的旧消息丢弃，
// 最新一条用户消息必定保留。按设计文档，仅携带当前消息的图片。
export function buildOllamaMessages(chat, currentUserMessage, currentImageBase64) {
  const budget = CONFIG.numCtx;
  const estimate = (text) => Math.max(1, Math.ceil(String(text || '').length));

  const all = chat.messages.at(-1)?.id === currentUserMessage.id
    ? [...chat.messages]
    : [...chat.messages, currentUserMessage];
  let used = 0;
  const picked = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    const cost = estimate(m.text);
    if (i === all.length - 1) {
      used += cost; // 最新用户消息必须保留
    } else if (used + cost > budget) {
      continue; // 旧消息超出预算则丢弃
    } else {
      used += cost;
    }
    picked.unshift(m);
  }

  return picked.map((m) => {
    const item = { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text ?? '') };
    if (m.id === currentUserMessage.id && currentImageBase64) {
      item.images = [currentImageBase64];
    }
    return item;
  });
}
