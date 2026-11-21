// 内置精选模型目录：离线可浏览，仅用户主动下载时才访问 Ollama 仓库。
export const MODEL_CATALOG = [
  {
    id: 'qwen3-vl:2b-instruct-q4_K_M',
    family: 'Qwen3-VL',
    params: '2B',
    tier: 1,
    sizeGB: 1.9,
    vision: true,
    summary: '默认模型：中文对话、截图理解与 OCR，最快最省内存。',
    capabilities: { chinese: '优秀', ocr: '良好', speed: '快' },
  },
  {
    id: 'qwen3-vl:4b-instruct-q4_K_M',
    family: 'Qwen3-VL',
    params: '4B',
    tier: 2,
    sizeGB: 2.5,
    vision: true,
    summary: '中文与 OCR 更好，速度稍慢，适合内存充足的设备。',
    capabilities: { chinese: '优秀', ocr: '优秀', speed: '中' },
  },
  {
    id: 'qwen3-vl:8b',
    family: 'Qwen3-VL',
    params: '8B',
    tier: 3,
    sizeGB: 5.2,
    vision: true,
    summary: '同系列效果更强，需要 16 GiB 以上内存，M 系列芯片体验更好。',
    capabilities: { chinese: '优秀', ocr: '优秀', speed: '慢' },
  },
  {
    id: 'qwen2.5vl:3b',
    family: 'Qwen2.5-VL',
    params: '3B',
    tier: 1,
    sizeGB: 2.0,
    vision: true,
    summary: '上一代视觉模型，中文与 OCR 稳定，资源占用较低。',
    capabilities: { chinese: '优秀', ocr: '良好', speed: '中' },
  },
  {
    id: 'minicpm-v:8b',
    family: 'MiniCPM-V',
    params: '8B',
    tier: 3,
    sizeGB: 5.5,
    vision: true,
    summary: '中文 OCR 表现突出，体积与内存需求较高。',
    capabilities: { chinese: '优秀', ocr: '优秀', speed: '慢' },
  },
  {
    id: 'llama3.2-vision:11b',
    family: 'Llama 3.2 Vision',
    params: '11B',
    tier: 3,
    sizeGB: 7.8,
    vision: true,
    summary: 'Meta 视觉模型，英文更强，中文场景一般，内存需求高。',
    capabilities: { chinese: '一般', ocr: '良好', speed: '慢' },
  },
  {
    id: 'moondream:1.8b',
    family: 'Moondream',
    params: '1.8B',
    tier: 1,
    sizeGB: 1.7,
    vision: true,
    summary: '极轻量视觉模型，速度快，中文与 OCR 能力有限。',
    capabilities: { chinese: '一般', ocr: '一般', speed: '快' },
  },
  {
    id: 'gemma3:4b',
    family: 'Gemma 3',
    params: '4B',
    tier: 2,
    sizeGB: 3.3,
    vision: true,
    summary: 'Google 多模态模型，多语言能力强，中文场景不如 Qwen 对口。',
    capabilities: { chinese: '一般', ocr: '良好', speed: '中' },
  },
  {
    id: 'deepseek-r1:1.5b',
    family: 'DeepSeek-R1',
    params: '1.5B',
    tier: 1,
    sizeGB: 1.1,
    vision: false,
    summary: '纯文本推理模型，带思考过程，能流畅运行但能力有限。不支持图片。',
    capabilities: { chinese: '良好', ocr: '不支持', speed: '中' },
  },
  {
    id: 'deepseek-r1:8b',
    family: 'DeepSeek-R1',
    params: '8B',
    tier: 3,
    sizeGB: 5.2,
    vision: false,
    summary: '纯文本推理模型，中文推理能力强，思考过程较长、响应慢。不支持图片。',
    capabilities: { chinese: '优秀', ocr: '不支持', speed: '慢' },
  },
  {
    id: 'qwen3:4b',
    family: 'Qwen3',
    params: '4B',
    tier: 2,
    sizeGB: 2.5,
    vision: false,
    summary: '纯文本中文模型，日常问答与写作效果好。不支持图片。',
    capabilities: { chinese: '优秀', ocr: '不支持', speed: '中' },
  },
  {
    id: 'qwen3:8b',
    family: 'Qwen3',
    params: '8B',
    tier: 3,
    sizeGB: 5.2,
    vision: false,
    summary: '纯文本中文模型，效果更强，需要 16 GiB 以上内存。不支持图片。',
    capabilities: { chinese: '优秀', ocr: '不支持', speed: '慢' },
  },
  {
    id: 'gemma3:1b',
    family: 'Gemma 3',
    params: '1B',
    tier: 1,
    sizeGB: 0.8,
    vision: false,
    summary: '轻量纯文本模型，速度快，中文能力一般。不支持图片。',
    capabilities: { chinese: '一般', ocr: '不支持', speed: '快' },
  },
];

const LEVEL_ORDER = { recommended: 0, usable: 1, 'not-recommended': 2 };

// 展示排序：使用中优先，多模态在前，内置精选在远程模型前，再按推荐度、tier、id。
export function sortModelsForDisplay(models, device, currentId) {
  const decorated = models.map((model) => ({
    model,
    level: LEVEL_ORDER[recommendModel(model, device).level],
  }));
  decorated.sort((a, b) => {
    const ma = a.model;
    const mb = b.model;
    if ((ma.id === currentId) !== (mb.id === currentId)) return ma.id === currentId ? -1 : 1;
    if (ma.vision !== mb.vision) return ma.vision ? -1 : 1;
    const sourceDiff = (ma.source === 'remote' ? 1 : 0) - (mb.source === 'remote' ? 1 : 0);
    if (sourceDiff) return sourceDiff;
    return a.level - b.level || ma.tier - mb.tier || ma.id.localeCompare(mb.id);
  });
  return decorated.map((d) => d.model);
}

function recommendLevel(tier, memGB, isAppleSilicon) {
  if (isAppleSilicon) {
    // Q3：Apple Silicon 推 4B、8B 可试；32 GiB 以上推 8B。
    if (tier === 3 && memGB >= 32) return 'recommended';
    if (tier === 2) return 'recommended';
    return 'usable';
  }
  if (memGB < 8) return tier === 1 ? 'recommended' : 'not-recommended';
  if (memGB < 16) {
    if (tier === 1) return 'recommended';
    return tier === 2 ? 'usable' : 'not-recommended';
  }
  if (memGB < 32) {
    if (tier === 2) return 'recommended';
    return 'usable';
  }
  return tier === 3 ? 'recommended' : 'usable';
}

export function recommendModel(model, device) {
  const memGB = device.totalMemBytes / (1024 ** 3);
  const level = recommendLevel(model.tier, memGB, device.isAppleSilicon);
  const memText = `${memGB.toFixed(0)} GiB`;
  const metal = device.isAppleSilicon ? '，Apple Silicon 可使用 Metal 加速' : '';
  const reason = level === 'recommended'
    ? `本机内存 ${memText}${metal}，此模型在当前设备上效果与速度最均衡`
    : level === 'usable'
      ? `本机内存 ${memText}${metal}，可以运行，但生成更慢、内存占用更高`
      : `本机内存 ${memText}，运行此模型可能明显卡顿或内存不足`;
  return { level, reason };
}
