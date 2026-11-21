// 设置面板的视图过滤与分组：多模态/纯文本/在线目录，在线目录默认折叠。
export function filterModelsForView(models, view = {}) {
  const search = (view.searchText || '').trim().toLowerCase();
  const filterType = view.filterType || 'all';
  const matches = (m) => {
    if (filterType === 'vision' && !m.vision) return false;
    if (filterType === 'text' && m.vision) return false;
    if (filterType === 'downloaded' && !m.downloaded) return false;
    if (!search) return true;
    return `${m.id} ${m.family} ${m.summary}`.toLowerCase().includes(search);
  };

  const vision = [];
  const text = [];
  const remote = [];
  for (const m of models) {
    if (!matches(m)) continue;
    if (m.source === 'remote') remote.push(m);
    else if (m.vision) vision.push(m);
    else text.push(m);
  }

  const groups = [];
  if (vision.length) groups.push({ key: 'vision', label: '多模态 · 支持图片', models: vision, collapsed: false });
  if (text.length) groups.push({ key: 'text', label: '纯文本 · 不支持图片', models: text, collapsed: false });
  if (remote.length) {
    groups.push({
      key: 'remote',
      label: `在线目录 · ${remote.length} 个模型`,
      models: remote,
      collapsed: !view.remoteExpanded && !search && filterType !== 'downloaded',
    });
  }
  return groups;
}
