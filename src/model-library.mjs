import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, LIBRARY_URL } from './config.mjs';
import { MODEL_CATALOG } from './model-catalog.mjs';
import { writeJsonAtomic } from './storage.mjs';

const CACHE_FILE = path.join(CONFIG.dataDir, 'model-cache.json');
const DEFAULT_LIBRARY_URL = 'https://ollama.com';
const SPEED_BY_TIER = { 1: '快', 2: '中', 3: '慢' };

let cache = { fetchedAt: null, models: [] };
function isValidCacheEntry(m) {
  return m && typeof m.id === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(m.id)
    && [1, 2, 3].includes(m.tier) && typeof m.vision === 'boolean'
    && m.capabilities && typeof m.capabilities.chinese === 'string';
}
try {
  const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  if (raw && Array.isArray(raw.models)) {
    cache = { fetchedAt: raw.fetchedAt ?? null, models: raw.models.filter(isValidCacheEntry) };
  }
} catch {
  // 无缓存或缓存损坏：回退为内置目录。
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseSizeLabel(label) {
  const match = label.trim().match(/^([\d.]+)\s*([bm])$/i);
  if (!match) return null;
  return Number(match[1]) * (match[2].toLowerCase() === 'm' ? 0.001 : 1);
}

function isVisionModel(id, segment) {
  if (/>vision</.test(segment)) return true;
  // 官方未打 vision 标签但明确支持视觉的命名形态。
  return /vision/i.test(id) || id.endsWith('vl') || id.includes('-vl') || id.startsWith('llava');
}

export function parseLibraryHtml(html) {
  const models = [];
  const cards = html.split('<a href="/library/').slice(1);
  for (const card of cards) {
    const segment = card.slice(0, card.indexOf('</a>'));
    const id = segment.slice(0, segment.indexOf('"'));
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) continue;

    const descMatch = segment.match(/text-neutral-800 text-md">([^<]*)<\/p>/);
    const summary = descMatch ? decodeEntities(descMatch[1]).trim() : '来自 Ollama 官方库';
    const sizeLabels = [...segment.matchAll(/bg-\[#ddf4ff\][^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim());
    const sizes = sizeLabels.map(parseSizeLabel).filter((v) => typeof v === 'number');
    const minB = sizes.length ? Math.min(...sizes) : null;
    const tier = minB === null ? 2 : minB <= 3 ? 1 : minB <= 6 ? 2 : 3;
    const smallestLabel = sizeLabels.length ? sizeLabels[0].toUpperCase() : '—';
    const vision = isVisionModel(id, segment);

    models.push({
      id,
      family: id,
      params: smallestLabel,
      tier,
      sizeGB: null,
      vision,
      summary,
      capabilities: { chinese: '未知', ocr: vision ? '未知' : '不支持', speed: SPEED_BY_TIER[tier] },
      source: 'remote',
    });
  }
  return models;
}

export function getCachedModels() {
  return cache.models;
}

export function getCacheInfo() {
  return { fetchedAt: cache.fetchedAt, count: cache.models.length };
}

export function getAllModels() {
  const ids = new Set(MODEL_CATALOG.map((m) => m.id));
  return [...MODEL_CATALOG, ...cache.models.filter((m) => !ids.has(m.id))];
}

export function isCatalogModel(id) {
  return getAllModels().some((model) => model.id === id);
}

// 仅在用户主动点击时调用：访问 Ollama 官方库并更新本地缓存。
export async function refreshRemoteModels({ baseUrl = LIBRARY_URL } = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl}/library`, {
      headers: { 'User-Agent': 'local-ai-assistant/1.0' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`无法连接 Ollama 官方库: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Ollama 官方库返回 HTTP ${res.status}`);
  const html = await res.text();
  const models = parseLibraryHtml(html);
  if (models.length === 0) throw new Error('官方库目录解析为空，页面结构可能已变化');
  cache = { fetchedAt: new Date().toISOString(), models };
  await writeJsonAtomic(CACHE_FILE, cache);
  return { count: models.length, fetchedAt: cache.fetchedAt };
}
