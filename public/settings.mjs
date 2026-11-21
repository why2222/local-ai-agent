import { requestJson } from './http.mjs';
import { filterModelsForView, VENDOR_ORDER, VENDOR_LABELS } from './model-view.mjs';

const dialog = document.getElementById('settings-dialog');
const deviceCard = document.getElementById('settings-device');
const cardsBox = document.getElementById('settings-models');
const errorBox = document.getElementById('settings-error');

let catalog = [];
let cacheInfo = null;
let downloading = null;
let confirmDownloadId = null;
let remoteConfirming = false;
let remoteConfirmTimer = null;
let notifyChanged = () => {};
let lastPaint = 0;
let expandedId;
const view = { searchText: '', filterType: 'all', vendors: [] };

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
  cacheInfo = data.cache;
  if (expandedId === undefined) expandedId = data.current;
  renderDevice(data.device);
  renderVendorChips();
  renderModels();
}

function renderVendorChips() {
  const box = document.getElementById('vendor-filters');
  box.replaceChildren();
  const label = el('span', 'chip-label', '厂商');
  box.append(label);
  const allChip = el('button', `chip${view.vendors.length === 0 ? ' on' : ''}`, '全部');
  allChip.type = 'button';
  allChip.addEventListener('click', () => {
    view.vendors = [];
    renderVendorChips();
    renderModels();
  });
  box.append(allChip);
  const present = new Set(catalog.map((m) => m.vendor));
  for (const vendor of VENDOR_ORDER) {
    if (!present.has(vendor)) continue;
    const selected = view.vendors.includes(vendor);
    const chip = el('button', `chip${selected ? ' on' : ''}`, VENDOR_LABELS[vendor].split(' · ')[0]);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      view.vendors = selected ? view.vendors.filter((v) => v !== vendor) : [...view.vendors, vendor];
      renderVendorChips();
      renderModels();
    });
    box.append(chip);
  }
}

function renderDevice(device) {
  const memGB = (bytes) => (bytes / 1024 ** 3).toFixed(1);
  const platform = device.isAppleSilicon ? 'macOS · Apple Silicon（Metal 加速）' : `${device.platform} · ${device.arch}`;
  deviceCard.textContent = `${device.cpuModel} · ${device.cores} 核 · ${memGB(device.totalMemBytes)} GiB 内存（可用约 ${memGB(device.freeMemBytes)} GiB） · ${platform}`;
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
  } else if (model.recommendation.level === 'not-recommended' && confirmDownloadId !== model.id) {
    box.append(iconButton('下载', 'secondary-button', () => {
      confirmDownloadId = model.id;
      renderModels();
    }));
  } else {
    const label = model.recommendation.level === 'not-recommended' ? '仍要下载？' : '下载';
    box.append(iconButton(label, 'secondary-button', () => startDownload(model)));
    if (model.recommendation.level === 'not-recommended' && confirmDownloadId === model.id) {
      box.append(iconButton('取消', 'secondary-button', () => {
        confirmDownloadId = null;
        renderModels();
      }));
    }
  }
  return box;
}

function modelRow(model) {
  const row = el('div', `model-row${expandedId === model.id ? ' expanded' : ''}${model.inUse ? ' in-use' : ''}`);
  row.dataset.modelId = model.id;
  const nameButton = el('button', 'name name-button', `${model.family} · ${model.params}`);
  nameButton.type = 'button';
  nameButton.setAttribute('aria-expanded', String(expandedId === model.id));
  nameButton.setAttribute('aria-controls', `detail-${model.id}`);
  nameButton.addEventListener('click', () => toggleExpanded(model));
  row.append(nameButton);
  if (model.source !== 'remote') row.append(el('span', 'model-badge pick', '精选'));
  row.append(el('span', `model-badge ${model.recommendation.level}`, LEVEL_TEXT[model.recommendation.level]));
  if (!model.vision) row.append(el('span', 'model-badge neutral', '纯文本'));
  if (model.inUse) row.append(el('span', 'model-badge in-use', '使用中'));
  else if (model.downloaded) row.append(el('span', 'model-badge neutral', '已下载'));
  row.append(el('span', 'sp'));
  const timeText = model.releaseDate ? `${model.releaseDate} 发布` : model.updatedAt ? `库更新于 ${model.updatedAt}` : '';
  if (timeText) row.append(el('span', 'meta', timeText));
  row.append(el('span', 'meta', model.sizeGB ? `${model.sizeGB} GB` : '—'));
  row.append(actionFor(model));
  row.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    toggleExpanded(model);
  });
  return row;
}

function toggleExpanded(model) {
  expandedId = expandedId === model.id ? null : model.id;
  renderModels();
  if (expandedId) {
    const button = cardsBox.querySelector(`[data-model-id="${CSS.escape(expandedId)}"] .name-button`);
    button?.focus();
  }
}

function modelDetail(model) {
  const detail = el('div', 'model-detail');
  detail.id = `detail-${model.id}`;
  detail.append(el('p', 'summary', model.summary));
  const kv = el('div', 'kv');
  const items = [
    [model.capabilities.chinese, '中文能力'],
    [model.capabilities.ocr, 'OCR'],
    [model.capabilities.speed, '生成速度'],
    [model.sizeGB ? `${model.sizeGB} GB` : '未知', '模型体积'],
  ];
  for (const [value, label] of items) {
    const cell = el('div');
    cell.append(el('b', '', value), el('span', '', label));
    kv.append(cell);
  }
  detail.append(kv);
  detail.append(el('div', 'reason', model.recommendation.reason));
  return detail;
}

function renderModels() {
  cardsBox.replaceChildren();
  const groups = filterModelsForView(catalog, view);
  if (!groups.length) {
    cardsBox.append(el('div', 'history-empty', '没有匹配的模型，试试其他搜索词'));
    return;
  }
  for (const group of groups) {
    cardsBox.append(el('div', 'model-group-label', group.label));
    for (const model of group.models) {
      cardsBox.append(modelRow(model));
      if (expandedId === model.id) cardsBox.append(modelDetail(model));
    }
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
    expandedId = model.id;
    await loadModels();
    notifyChanged();
  } catch (error) {
    showError(error.message);
  }
}

async function startDownload(model) {
  showError();
  confirmDownloadId = null;
  downloading = { id: model.id, controller: new AbortController(), status: '准备下载', completed: 0, total: 0 };
  expandedId = model.id;
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

async function fetchRemoteDirectory() {
  const button = document.getElementById('fetch-remote-button');
  if (!remoteConfirming) {
    remoteConfirming = true;
    button.textContent = '确认连接 ollama.com？';
    remoteConfirmTimer = setTimeout(() => {
      remoteConfirming = false;
      button.textContent = '更新模型目录';
    }, 5000);
    return;
  }
  clearTimeout(remoteConfirmTimer);
  remoteConfirming = false;
  button.disabled = true;
  button.textContent = '正在连接 ollama.com…';
  showError();
  try {
    await requestJson('/api/models/fetch-remote', { method: 'POST' });
    await loadModels();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = '更新模型目录';
  }
}

export async function openSettings({ onModelChanged } = {}) {
  if (onModelChanged) notifyChanged = onModelChanged;
  showError();
  if (!dialog.open) dialog.showModal();
  await loadModels().catch((error) => showError(error.message));
}

document.getElementById('fetch-remote-button').addEventListener('click', fetchRemoteDirectory);
document.getElementById('settings-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
document.getElementById('model-search').addEventListener('input', (event) => {
  view.searchText = event.target.value;
  renderModels();
});
function setFilterType(filterType) {
  document.querySelectorAll('#model-filters .chip').forEach((c) => {
    c.classList.toggle('on', c.dataset.filter === filterType);
  });
  view.filterType = filterType;
  renderModels();
}

document.querySelectorAll('#model-filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => setFilterType(chip.dataset.filter));
});
