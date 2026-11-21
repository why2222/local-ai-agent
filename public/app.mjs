import { createId } from './id.mjs';
import { request, requestJson } from './http.mjs';
import { openSettings } from './settings.mjs';
import { parseMarkdownBlocks, parseInline, isSafeLink } from './markdown.mjs';

const $ = (selector) => document.querySelector(selector);

const elements = {
  chatList: $('#chat-list'),
  newChat: $('#new-chat'),
  messages: $('#messages'),
  title: $('#conversation-title'),
  composer: $('#composer'),
  input: $('#message-input'),
  send: $('#send-button'),
  sendIcon: $('#send-icon'),
  attachMenuButton: $('#attach-menu-button'),
  attachMenu: $('#attach-menu'),
  attachImageItem: $('#attach-image-item'),
  attachDocItem: $('#attach-doc-item'),
  imageInput: $('#image-input'),
  selectedImage: $('#selected-image'),
  selectedDocument: $('#selected-document'),
  selectedDocumentName: $('#selected-document-name'),
  removeDocument: $('#remove-document'),
  documentInput: $('#document-input'),
  selectedImagePreview: $('#selected-image-preview'),
  selectedImageName: $('#selected-image-name'),
  removeImage: $('#remove-image'),
  error: $('#form-error'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  statusButton: $('#status-button'),
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebar-toggle'),
  sidebarBackdrop: $('#sidebar-backdrop'),
};

const state = {
  chats: [],
  currentChat: null,
  generating: false,
  controller: null,
  selectedFile: null,
  selectedFileUrl: null,
  selectedDocument: null,
  currentVision: true,
  followScroll: true,
};

function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

async function refreshSidebarModel() {
  try {
    const data = await requestJson('/api/models');
    const current = data.models.find((m) => m.id === data.current);
    state.currentVision = current ? current.vision !== false : true;
    document.getElementById('model-name').textContent = current ? `${current.family} · 仅在本机运行` : '仅在本机运行';
  } catch {
    // 模型状态由健康检查提示，这里不重复报错。
  }
}

function showError(message = '') {
  elements.error.textContent = message;
  elements.error.hidden = !message;
}

function chatFrom(data) {
  return data.chat || data;
}

function chatListFrom(data) {
  return Array.isArray(data) ? data : (data.chats || []);
}

function imageIdFrom(message) {
  return message.imageId || message.image?.id || message.image?.imageId || null;
}

async function checkHealth() {
  elements.statusDot.className = 'status-dot';
  elements.statusText.textContent = '正在检查模型';
  try {
    const health = await requestJson('/api/health');
    const ready = health.ready === true || health.ok === true || health.modelAvailable === true || health.model?.available === true;
    elements.statusDot.className = `status-dot ${ready ? 'ready' : 'error'}`;
    elements.statusText.textContent = ready ? '模型已就绪' : (health.message || '模型尚未就绪');
    elements.statusButton.title = health.message || (ready ? '本地模型运行正常' : '点击重新检查');
    return ready;
  } catch (error) {
    elements.statusDot.className = 'status-dot error';
    elements.statusText.textContent = 'Ollama 未连接';
    elements.statusButton.title = error.message;
    return false;
  }
}

async function loadChats() {
  const data = await requestJson('/api/chats');
  state.chats = chatListFrom(data);
  renderChatList();
  return state.chats;
}

function renderChatList() {
  elements.chatList.replaceChildren();
  if (!state.chats.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '还没有历史会话';
    elements.chatList.append(empty);
    return;
  }

  const label = document.createElement('div');
  label.className = 'history-label';
  label.textContent = '会话';
  elements.chatList.append(label);

  for (const chat of state.chats) {
    const row = document.createElement('div');
    row.className = `history-row${state.currentChat?.id === chat.id ? ' active' : ''}`;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'history-item';
    select.textContent = chat.title || '新会话';
    select.title = chat.title || '新会话';
    select.disabled = state.generating;
    select.addEventListener('click', () => selectChat(chat.id));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-chat';
    remove.setAttribute('aria-label', `删除会话：${chat.title || '新会话'}`);
    remove.title = '删除会话';
    remove.disabled = state.generating;
    remove.append(icon('trash'));
    remove.addEventListener('click', () => deleteChat(chat.id));

    row.append(select, remove);
    elements.chatList.append(row);
  }
}

async function createChat({ focus = true } = {}) {
  const data = await requestJson('/api/chats', { method: 'POST' });
  const chat = chatFrom(data);
  state.currentChat = chat;
  await loadChats();
  renderChat();
  closeSidebar();
  if (focus) elements.input.focus();
  return chat;
}

async function selectChat(id) {
  if (state.generating) return;
  showError();
  const data = await requestJson(`/api/chats/${encodeURIComponent(id)}`);
  state.currentChat = chatFrom(data);
  renderChat();
  renderChatList();
  closeSidebar();
}

async function deleteChat(id) {
  const chat = state.chats.find((item) => item.id === id);
  if (!window.confirm(`确定删除“${chat?.title || '新会话'}”吗？此操作会同时删除其中的图片。`)) return;
  await request(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (state.currentChat?.id === id) state.currentChat = null;
  await loadChats();
  if (!state.currentChat && state.chats.length) {
    await selectChat(state.chats[0].id);
  } else if (!state.currentChat) {
    await createChat({ focus: false });
  }
}

function renderChat() {
  elements.title.textContent = state.currentChat?.title || '新会话';
  elements.messages.replaceChildren();
  const thread = document.createElement('div');
  thread.className = 'thread';
  const messages = state.currentChat?.messages || [];

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const mark = document.createElement('div');
    mark.className = 'brand-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.append(icon('spark'));
    const heading = document.createElement('h2');
    heading.textContent = '有什么可以帮你？';
    const description = document.createElement('p');
    description.textContent = '可以输入中文问题，或添加一张 JPG/PNG 图片进行识别和总结。';
    empty.append(mark, heading, description);
    thread.append(empty);
  } else {
    for (const message of messages) thread.append(renderMessage(message));
  }

  elements.messages.append(thread);
  requestAnimationFrame(() => scrollToBottom(false));
}

function createStatusIndicator(text) {
  const status = document.createElement('div');
  status.className = 'status-indicator';
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  status.append(dots, document.createTextNode(text));
  return status;
}

function createDocProgress(progressText, ratio = null) {
  const wrap = document.createElement('div');
  wrap.className = 'doc-progress';
  const label = document.createElement('div');
  label.className = 'label';
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  const text = document.createElement('span');
  text.className = 'label-text';
  text.textContent = progressText;
  label.append(dots, text);
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('span');
  fill.style.width = ratio === null ? '20%' : `${Math.round(ratio * 100)}%`;
  bar.append(fill);
  wrap.append(label, bar);
  return wrap;
}

function renderMessage(message) {
  const article = document.createElement('article');
  article.className = `message ${message.role}`;
  article.dataset.messageId = message.id || '';

  if (message.role === 'user') {
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    const text = document.createElement('span');
    text.textContent = message.content || message.text || '';
    bubble.append(text);
    const imageId = imageIdFrom(message);
    if (imageId) bubble.append(createMessageImage(imageId));
    if (message.documentId) bubble.append(createDocumentLink(message.documentName || '查看原文', message.documentId));
    article.append(bubble);
    return article;
  }

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.append(icon('spark'));
  const body = document.createElement('div');
  body.className = 'message-body';
  const isEmptyStreaming = message.status === 'streaming' && !(message.content || message.text);
  if (message.status === 'streaming' && message.progress) {
    body.append(createDocProgress(message.progress, message.progressRatio ?? null));
  }
  if (isEmptyStreaming) {
    if (!message.progress) body.append(createStatusIndicator('正在思考…'));
  } else {
    body.append(renderFormattedText(message.content || message.text || '', message.status === 'streaming'));
  }
  if (message.documentId) body.append(createDocumentLink('查看原文', message.documentId));
  if (message.status && message.status !== 'complete' && message.status !== 'completed' && message.status !== 'streaming') {
    const status = document.createElement('div');
    status.className = `message-status ${message.status === 'error' ? 'error' : ''}`;
    const statusText = document.createElement('span');
    statusText.textContent = message.status === 'stopped' ? '已停止生成' : (message.error || '生成中断，可以重试');
    status.append(statusText);
    if (message.status === 'error') {
      const retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'retry-button secondary-button';
      retryButton.append(icon('refresh'), document.createTextNode('重试'));
      retryButton.addEventListener('click', () => {
        const messages = state.currentChat?.messages || [];
        const index = messages.findIndex((item) => item.id === message.id);
        const user = messages.slice(0, index).reverse().find((item) => item.role === 'user');
        if (user?.documentId) {
          const rawText = user.text || user.content || '';
          const instruction = rawText.startsWith('上传文档《') ? '' : rawText;
          sendDocument(instruction, { documentId: user.documentId, name: user.documentName });
        } else if (user) {
          sendMessage({ text: user.content || user.text || '', imageId: imageIdFrom(user) });
        }
      });
      status.append(retryButton);
    }
    body.append(status);
  }
  article.append(avatar, body);
  return article;
}

function createMessageImage(imageId) {
  const image = document.createElement('img');
  image.className = 'message-image';
  image.alt = '用户上传的图片';
  image.loading = 'lazy';
  image.src = `/api/chats/${encodeURIComponent(state.currentChat.id)}/images/${encodeURIComponent(imageId)}`;
  return image;
}

function appendInline(parent, text) {
  for (const token of parseInline(text)) {
    if (token.type === 'text') {
      parent.append(document.createTextNode(token.text));
    } else if (token.type === 'bold') {
      const strong = document.createElement('strong');
      strong.textContent = token.text;
      parent.append(strong);
    } else if (token.type === 'code') {
      const code = document.createElement('code');
      code.textContent = token.text;
      parent.append(code);
    } else if (token.type === 'link') {
      if (isSafeLink(token.href)) {
        const a = document.createElement('a');
        a.textContent = token.text;
        a.href = token.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        parent.append(a);
      } else {
        parent.append(document.createTextNode(token.text));
      }
    }
  }
}

function renderFormattedText(text, streaming = false) {
  const container = document.createElement('div');
  if (streaming) container.className = 'streaming-caret';
  for (const block of parseMarkdownBlocks(text)) {
    if (block.type === 'paragraph') {
      const p = document.createElement('p');
      appendInline(p, block.text);
      container.append(p);
    } else if (block.type === 'heading') {
      const h = document.createElement(`h${Math.min(block.level + 2, 6)}`);
      appendInline(h, block.text);
      container.append(h);
    } else if (block.type === 'hr') {
      container.append(document.createElement('hr'));
    } else if (block.type === 'quote') {
      const q = document.createElement('blockquote');
      appendInline(q, block.text);
      container.append(q);
    } else if (block.type === 'table') {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const cell of block.header) {
        const th = document.createElement('th');
        appendInline(th, cell);
        headRow.append(th);
      }
      thead.append(headRow);
      table.append(thead);
      const tbody = document.createElement('tbody');
      for (const row of block.rows) {
        const tr = document.createElement('tr');
        for (const cell of row) {
          const td = document.createElement('td');
          appendInline(td, cell);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      container.append(table);
    } else if (block.type === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        appendInline(li, item);
        list.append(li);
      }
      container.append(list);
    } else if (block.type === 'code') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      pre.append(code);
      container.append(pre);
    }
  }
  return container;
}

function scrollToBottom(smooth = true) {
  elements.messages.scrollTo({ top: elements.messages.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

function maybeScrollToBottom() {
  if (state.followScroll) scrollToBottom(false);
}

function updateFollowScroll() {
  const distance = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight;
  state.followScroll = distance < 80;
  const backBottom = document.getElementById('back-bottom');
  backBottom.hidden = state.followScroll || !state.generating;
}

elements.messages.addEventListener('scroll', updateFollowScroll);
document.getElementById('back-bottom').addEventListener('click', () => {
  state.followScroll = true;
  document.getElementById('back-bottom').hidden = true;
  scrollToBottom();
});

function setGenerating(generating) {
  state.generating = generating;
  elements.send.classList.toggle('stopping', generating);
  elements.send.setAttribute('aria-label', generating ? '停止生成' : '发送消息');
  elements.sendIcon.setAttribute('href', generating ? '/icons.svg#stop' : '/icons.svg#arrow-up');
  elements.newChat.disabled = generating;
  elements.input.readOnly = generating;
  elements.attachMenuButton.disabled = generating;
  updateSendState();
  renderChatList();
  updateFollowScroll();
}

function updateSendState() {
  elements.send.disabled = !state.generating && !elements.input.value.trim() && !state.selectedFile && !state.selectedDocument;
}

const DOCUMENT_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.log', '.pdf', '.docx', '.xlsx', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.cs', '.html', '.css', '.sh', '.yml', '.yaml', '.toml', '.xml', '.sql'];

function clearSelectedDocument() {
  state.selectedDocument = null;
  elements.selectedDocument.hidden = true;
  elements.documentInput.value = '';
  updateSendState();
}

function selectDocument(file) {
  showError();
  if (!file) return;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.includes(ext)) {
    showError('仅支持文本、代码、PDF、DOCX、XLSX 文档。');
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    showError('文档不能超过 100 MiB。');
    return;
  }
  clearSelectedFile();
  clearSelectedDocument();
  state.selectedDocument = file;
  elements.selectedDocumentName.textContent = `${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
  elements.selectedDocument.hidden = false;
  updateSendState();
}

function clearSelectedFile() {
  if (state.selectedFileUrl) URL.revokeObjectURL(state.selectedFileUrl);
  state.selectedFile = null;
  state.selectedFileUrl = null;
  elements.selectedImage.hidden = true;
  elements.selectedImagePreview.removeAttribute('src');
  elements.imageInput.value = '';
  updateSendState();
}

function selectFile(file) {
  showError();
  if (!file) return;
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    showError('仅支持 JPG 和 PNG 图片。');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showError('图片不能超过 8 MiB。');
    return;
  }
  clearSelectedFile();
  clearSelectedDocument();
  state.selectedFile = file;
  state.selectedFileUrl = URL.createObjectURL(file);
  elements.selectedImagePreview.src = state.selectedFileUrl;
  elements.selectedImageName.textContent = file.name;
  elements.selectedImage.hidden = false;
  updateSendState();
}

async function uploadImage(chatId, file) {
  if (!file) return null;
  const data = await requestJson(`/api/chats/${encodeURIComponent(chatId)}/images`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  return data.image?.id || data.imageId || data.id;
}

async function sendMessage(retry = null) {
  if (state.generating) {
    state.controller?.abort();
    return;
  }

  if (!retry && state.selectedDocument) {
    await sendDocument(elements.input.value.trim());
    return;
  }

  const selectedFile = retry ? null : state.selectedFile;
  if ((selectedFile || retry?.imageId) && state.currentVision === false) {
    showError('当前模型不支持图片，请移除图片或在模型设置中切换多模态模型');
    return;
  }
  const inputText = retry?.text ?? elements.input.value.trim();
  const text = inputText || ((selectedFile || retry?.imageId) ? '请识别并描述这张图片。' : '');
  if (!text && !selectedFile && !retry?.imageId) return;
  showError();
  if (!state.currentChat) await createChat({ focus: false });
  const chatId = state.currentChat.id;
  const localImageUrl = retry?.imageId
    ? `/api/chats/${encodeURIComponent(chatId)}/images/${encodeURIComponent(retry.imageId)}`
    : state.selectedFileUrl;
  setGenerating(true);

  const userMessage = {
    id: createId(),
    role: 'user',
    content: text,
    status: 'complete',
    ...(retry?.imageId ? { imageId: retry.imageId } : {}),
  };
  const assistantMessage = { id: createId(), role: 'assistant', content: '', status: 'streaming' };
  state.currentChat.messages ||= [];
  state.currentChat.messages.push(userMessage, assistantMessage);
  renderChat();
  const thread = elements.messages.querySelector('.thread');
  const userArticles = thread.querySelectorAll('.message.user');
  if (selectedFile && localImageUrl && userArticles.length) {
    const image = document.createElement('img');
    image.className = 'message-image';
    image.alt = '用户上传的图片';
    image.src = localImageUrl;
    userArticles[userArticles.length - 1].querySelector('.user-bubble').append(image);
  }

  elements.input.value = '';
  autoResizeInput();
  clearSelectedFile();
  state.controller = new AbortController();

  try {
    const imageId = retry?.imageId || await uploadImage(chatId, selectedFile);
    if (imageId) userMessage.imageId = imageId;
    const response = await request(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, imageId }),
      signal: state.controller.signal,
    });
    await consumeStream(response, assistantMessage);
    assistantMessage.status = 'complete';
  } catch (error) {
    if (error.name === 'AbortError') {
      assistantMessage.status = 'stopped';
    } else {
      assistantMessage.status = 'error';
      assistantMessage.error = error.message;
      showError(error.message);
    }
  } finally {
    setGenerating(false);
    state.controller = null;
    if (assistantMessage.status === 'error' || assistantMessage.status === 'stopped') {
      renderChat();
    } else {
      try {
        const fresh = chatFrom(await requestJson(`/api/chats/${encodeURIComponent(chatId)}`));
        state.currentChat = fresh;
      } catch {}
      renderChat();
    }
    try { await loadChats(); } catch {}
    elements.input.focus();
  }
}

async function sendDocument(instruction = '', retryDoc = null) {
  if (state.generating) {
    state.controller?.abort();
    return;
  }
  const file = retryDoc ? null : state.selectedDocument;
  if (!file && !retryDoc) return;
  if (!state.currentChat) await createChat({ focus: false });
  const chatId = state.currentChat.id;
  setGenerating(true);

  const docName = retryDoc?.name || file.name;
  const userMessage = {
    id: createId(), role: 'user',
    content: instruction || `上传文档《${docName}》，生成摘要`,
    status: 'complete', documentName: docName,
  };
  const assistantMessage = {
    id: createId(), role: 'assistant', content: '', status: 'streaming',
    progress: retryDoc ? '准备重新生成摘要' : '准备上传文档', documentName: docName,
  };
  state.currentChat.messages ||= [];
  state.currentChat.messages.push(userMessage, assistantMessage);
  renderChat();
  clearSelectedDocument();
  elements.input.value = '';
  autoResizeInput();
  updateSendState();
  state.controller = new AbortController();

  try {
    let docId = retryDoc?.documentId;
    if (!docId) {
      const { document: doc } = await requestJson(`/api/chats/${encodeURIComponent(chatId)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Document-Name': encodeURIComponent(file.name) },
        body: file,
      });
      docId = doc.id;
    }
    userMessage.documentId = docId;
    assistantMessage.documentId = docId;
    const response = await request(`/api/chats/${encodeURIComponent(chatId)}/documents/${encodeURIComponent(docId)}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
      signal: state.controller.signal,
    });
    await consumeDocumentStream(response, assistantMessage);
    assistantMessage.status = 'complete';
  } catch (error) {
    if (error.name === 'AbortError') {
      assistantMessage.status = 'stopped';
    } else {
      assistantMessage.status = 'error';
      assistantMessage.error = error.message;
      showError(error.message);
    }
  } finally {
    setGenerating(false);
    state.controller = null;
    if (assistantMessage.status === 'error' || assistantMessage.status === 'stopped') {
      renderChat();
    } else {
      try {
        state.currentChat = chatFrom(await requestJson(`/api/chats/${encodeURIComponent(chatId)}`));
      } catch {}
      renderChat();
    }
    try { await loadChats(); } catch {}
    elements.input.focus();
  }
}

async function consumeDocumentStream(response, assistantMessage) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const article = [...elements.messages.querySelectorAll('.message.assistant')].at(-1);
  const body = article?.querySelector('.message-body');

  const updateProgress = () => {
    if (!body) return;
    let progressEl = body.querySelector('.doc-progress');
    if (!progressEl) {
      progressEl = createDocProgress(assistantMessage.progress || '', assistantMessage.progressRatio ?? null);
      body.prepend(progressEl);
    } else {
      progressEl.querySelector('.label-text').textContent = assistantMessage.progress || '';
      if (assistantMessage.progressRatio != null) {
        progressEl.querySelector('.bar span').style.width = `${Math.round(assistantMessage.progressRatio * 100)}%`;
      }
    }
    let textEl = body.querySelector('.text-content');
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.className = 'text-content';
      body.append(textEl);
    }
    if (assistantMessage.content) {
      body.querySelector('.status-indicator')?.remove();
      textEl.replaceChildren(renderFormattedText(assistantMessage.content, true));
    }
    maybeScrollToBottom();
  };

  const applyEvent = (event) => {
    if (event.type === 'batch') {
      assistantMessage.progress = `正在处理文档 · 第 ${event.index}/${event.total} 批`;
      assistantMessage.progressRatio = event.index / event.total;
      updateProgress();
    } else if (event.type === 'final-start') {
      assistantMessage.progress = '正在汇总摘要';
      assistantMessage.progressRatio = 1;
      updateProgress();
    } else if (event.type === 'delta') {
      assistantMessage.content += event.text || '';
      updateProgress();
    } else if (event.type === 'done') {
      assistantMessage.status = 'complete';
      if (event.message?.text) assistantMessage.content = event.message.text;
      if (event.message?.documentId) assistantMessage.documentId = event.message.documentId;
    } else if (event.type === 'error') {
      throw new Error(event.message || '文档摘要失败');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop();
    for (const line of lines) {
      if (line.trim()) applyEvent(JSON.parse(line));
    }
    if (done) break;
  }
  if (buffer.trim()) applyEvent(JSON.parse(buffer));
}

function createDocumentLink(text, docId) {
  const link = document.createElement('a');
  link.className = 'document-link';
  link.href = `/api/chats/${encodeURIComponent(state.currentChat.id)}/documents/${encodeURIComponent(docId)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.append(icon('doc'), document.createTextNode(text));
  return link;
}

async function consumeStream(response, assistantMessage) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let article = [...elements.messages.querySelectorAll('.message.assistant')].at(-1);
  let body = article?.querySelector('.message-body');

  const applyEvent = (event) => {
    if (event.type === 'delta') {
      assistantMessage.content += event.text || event.content || event.message?.content || '';
      if (body) body.replaceChildren(renderFormattedText(assistantMessage.content, true));
      maybeScrollToBottom();
    } else if (event.type === 'done') {
      const finalMessage = event.message || event.assistantMessage;
      if (finalMessage?.content) assistantMessage.content = finalMessage.content;
      if (event.id) assistantMessage.id = event.id;
    } else if (event.type === 'error') {
      throw new Error(event.error?.message || event.error || event.message || '模型生成失败');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop();
    for (const line of lines) {
      if (line.trim()) applyEvent(JSON.parse(line));
    }
    if (done) break;
  }
  if (buffer.trim()) applyEvent(JSON.parse(buffer));
}

function autoResizeInput() {
  elements.input.style.height = 'auto';
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 160)}px`;
}

function openSidebar() {
  elements.sidebar.classList.add('open');
  elements.sidebarBackdrop.classList.add('visible');
  elements.sidebarToggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  elements.sidebar.classList.remove('open');
  elements.sidebarBackdrop.classList.remove('visible');
  elements.sidebarToggle.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  if (window.matchMedia('(max-width: 760px)').matches) {
    elements.sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    return;
  }
  const collapsed = $('#app').classList.toggle('sidebar-collapsed');
  elements.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
}

elements.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage().catch((error) => {
    setGenerating(false);
    showError(error.message);
  });
});
elements.input.addEventListener('input', () => { autoResizeInput(); updateSendState(); });
elements.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});
elements.newChat.addEventListener('click', () => createChat().catch((error) => showError(error.message)));
function closeAttachMenu() {
  elements.attachMenu.hidden = true;
  elements.attachMenuButton.setAttribute('aria-expanded', 'false');
}

elements.attachMenuButton.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = elements.attachMenu.hidden;
  elements.attachMenu.hidden = !open;
  elements.attachMenuButton.setAttribute('aria-expanded', String(open));
});
elements.attachImageItem.addEventListener('click', () => {
  closeAttachMenu();
  elements.imageInput.click();
});
elements.attachDocItem.addEventListener('click', () => {
  closeAttachMenu();
  elements.documentInput.click();
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.attach-menu-wrap')) closeAttachMenu();
});
elements.documentInput.addEventListener('change', () => selectDocument(elements.documentInput.files[0]));
elements.removeDocument.addEventListener('click', clearSelectedDocument);
elements.imageInput.addEventListener('change', () => selectFile(elements.imageInput.files[0]));
elements.removeImage.addEventListener('click', clearSelectedFile);
elements.statusButton.addEventListener('click', checkHealth);
document.getElementById('settings-button').addEventListener('click', () => {
  openSettings({
    onModelChanged: () => {
      checkHealth();
      refreshSidebarModel();
    },
  });
});
elements.sidebarToggle.addEventListener('click', toggleSidebar);
elements.sidebarBackdrop.addEventListener('click', closeSidebar);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeSidebar();
    closeAttachMenu();
  }
});
window.addEventListener('beforeunload', () => {
  state.controller?.abort();
  if (state.selectedFileUrl) URL.revokeObjectURL(state.selectedFileUrl);
});

async function initialize() {
  try {
    await Promise.all([loadChats(), checkHealth(), refreshSidebarModel()]);
    if (state.chats.length) {
      await selectChat(state.chats[0].id);
    } else {
      await createChat({ focus: false });
    }
  } catch (error) {
    showError(error.message);
    elements.statusDot.className = 'status-dot error';
    elements.statusText.textContent = '本地服务异常';
    renderChat();
  }
}

initialize();
