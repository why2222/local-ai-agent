import { requestJson } from './http.mjs';

const dialog = document.getElementById('settings-dialog');
const deviceCard = document.getElementById('settings-device');
const cardsBox = document.getElementById('settings-models');
const errorBox = document.getElementById('settings-error');

let catalog = [];
let downloading = null;
let notifyChanged = () => {};
let lastPaint = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(label, className, onClick) {
  const button = el('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || '';
}

async function loadModels() {
  const data = await requestJson('/api/models');
  catalog = data.models;
  renderDevice(data.device);
  renderModels();
}

function renderDevice(device) {
  deviceCard.replaceChildren();
  const memGB = (bytes) => (bytes / 1024 ** 3).toFixed(1);
  const platform = device.isAppleSilicon ? 'macOS · Apple Silicon（Metal 加速）' : `${device.platform} · ${device.arch}`;
  const items = [
    [`${device.cpuModel}`, `${device.cores} 核处理器`],
    [`${memGB(device.totalMemBytes)} GiB`, `内存 · 当前可用约 ${memGB(device.freeMemBytes)} GiB`],
    [platform, '运行平台'],
  ];
  for (const [value, label] of items) {
    const item = el('div', 'device-item');
    item.append(el('strong', '', value), el('span', '', label));
    deviceCard.append(item);
  }
}

const LEVEL_TEXT = { recommended: '推荐', usable: '可试', 'not-recommended': '不推荐' };

function actionFor(model) {
  const box = el('div', 'model-actions');
  if (downloading?.id === model.id) {
    const progress = el('div', 'model-progress');
    const text = el('div', 'model-progress-text');
    const percent = downloading.total > 0 ? Math.floor(downloading.completed / downloading.total * 100) : null;
    text.append(
      el('span', '', downloading.status || '下载中'),
      el('span', '', percent === null ? '…' : `${percent}%`),
    );
    const bar = el('div', 'model-progress-bar');
    const fill = el('span');
    fill.style.width = percent === null ? '15%' : `${percent}%`;
    bar.append(fill);
    progress.append(text, bar);
    box.append(progress, iconButton('取消', 'secondary-button', () => downloading?.controller.abort()));
    return box;
  }
  if (model.inUse) {
    box.append(el('span', 'model-current', '当前使用'));
    return box;
  }
  if (downloading) {
    box.append(el('span', 'model-meta', '另一模型下载中'));
    return box;
  }
  if (model.downloaded) {
    box.append(iconButton('使用此模型', 'secondary-button', () => selectModel(model)));
  } else {
    box.append(iconButton('下载', 'secondary-button', () => startDownload(model)));
  }
  return box;
}

function renderModels() {
  cardsBox.replaceChildren();
  for (const model of catalog) {
    const card = el('article', `model-card${model.inUse ? ' in-use' : ''}`);
    const head = el('div', 'model-card-head');
    head.append(el('strong', '', `${model.family} · ${model.params}`));
    head.append(el('span', `model-badge ${model.recommendation.level}`, LEVEL_TEXT[model.recommendation.level]));
    if (model.inUse) head.append(el('span', 'model-badge in-use', '使用中'));
    if (model.downloaded && !model.inUse) head.append(el('span', 'model-badge usable', '已下载'));
    card.append(head);
    card.append(el('p', 'model-summary', model.summary));
    card.append(el('div', 'model-meta', `中文 ${model.capabilities.chinese} · OCR ${model.capabilities.ocr} · 速度 ${model.capabilities.speed} · 约 ${model.sizeGB} GB`));
    card.append(el('p', 'model-reason', model.recommendation.reason));
    card.append(actionFor(model));
    cardsBox.append(card);
  }
}

function paintProgress() {
  const now = Date.now();
  if (now - lastPaint < 150) return;
  lastPaint = now;
  renderModels();
}

async function selectModel(model) {
  showError();
  try {
    await requestJson('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.id }),
    });
    await loadModels();
    notifyChanged();
  } catch (error) {
    showError(error.message);
  }
}

async function startDownload(model) {
  showError();
  downloading = { id: model.id, controller: new AbortController(), status: '准备下载', completed: 0, total: 0 };
  renderModels();
  try {
    const res = await fetch('/api/models/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.id }),
      signal: downloading.controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || `下载失败（${res.status}）`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, idx).trim();
        pending = pending.slice(idx + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'progress') {
          downloading.status = event.status;
          downloading.completed = event.completed || 0;
          downloading.total = event.total || 0;
          paintProgress();
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') showError(error.message);
  } finally {
    downloading = null;
    await loadModels().catch(() => {});
    notifyChanged();
  }
}

export async function openSettings({ onModelChanged } = {}) {
  if (onModelChanged) notifyChanged = onModelChanged;
  showError();
  if (!dialog.open) dialog.showModal();
  await loadModels().catch((error) => showError(error.message));
}

document.getElementById('settings-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
