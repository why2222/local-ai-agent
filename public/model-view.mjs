// 模型商店视图：厂商分组、按发布/更新时间新到旧排序、厂商多选与类型组合筛选。
export const VENDOR_ORDER = ['qwen', 'deepseek', 'google', 'meta', 'openbmb', 'moondream', 'microsoft', 'ibm', 'liquid', 'other'];
export const VENDOR_LABELS = {
  qwen: 'Qwen · 阿里通义',
  deepseek: 'DeepSeek · 深度求索',
  google: 'Google · Gemma',
  meta: 'Meta · Llama',
  openbmb: 'OpenBMB · 面壁',
  moondream: 'Moondream',
  microsoft: 'Microsoft · Phi',
  ibm: 'IBM · Granite',
  liquid: 'Liquid AI',
  other: '其他厂商',
};
const LEVEL_ORDER = { recommended: 0, usable: 1, 'not-recommended': 2 };

export function filterModelsForView(models, view = {}) {
  const search = (view.searchText || '').trim().toLowerCase();
  const filterType = view.filterType || 'all';
  const vendors = view.vendors || [];
  const matches = (m) => {
    if (vendors.length && !vendors.includes(m.vendor)) return false;
    if (filterType === 'vision' && !m.vision) return false;
    if (filterType === 'text' && m.vision) return false;
    if (filterType === 'downloaded' && !m.downloaded) return false;
    if (!search) return true;
    return `${m.id} ${m.family} ${m.summary}`.toLowerCase().includes(search);
  };

  const groups = [];
  for (const vendor of VENDOR_ORDER) {
    const items = models.filter((m) => m.vendor === vendor && matches(m));
    if (!items.length) continue;
    items.sort((a, b) => {
      if (a.inUse !== b.inUse) return a.inUse ? -1 : 1;
      const ta = a.releaseDate || a.updatedAt || '';
      const tb = b.releaseDate || b.updatedAt || '';
      if (ta !== tb) return ta > tb ? -1 : 1;
      const levelDiff = LEVEL_ORDER[a.recommendation.level] - LEVEL_ORDER[b.recommendation.level];
      return levelDiff || a.id.localeCompare(b.id);
    });
    groups.push({ key: vendor, label: VENDOR_LABELS[vendor], models: items });
  }
  return groups;
}
