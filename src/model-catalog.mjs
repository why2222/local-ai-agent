// 内置精选模型目录：离线可浏览，仅用户主动下载时才访问 Ollama 仓库。
export const MODEL_CATALOG = [
  {
    id: 'qwen3-vl:2b-instruct-q4_K_M',
    family: 'Qwen3-VL',
    params: '2B',
    tier: 1,
    sizeGB: 1.9,
    summary: '默认模型：中文对话、截图理解与 OCR，最快最省内存。',
    capabilities: { chinese: '优秀', ocr: '良好', speed: '快' },
  },
  {
    id: 'qwen3-vl:4b-instruct-q4_K_M',
    family: 'Qwen3-VL',
    params: '4B',
    tier: 2,
    sizeGB: 2.5,
    summary: '中文与 OCR 更好，速度稍慢，适合内存充足的设备。',
    capabilities: { chinese: '优秀', ocr: '优秀', speed: '中' },
  },
  {
    id: 'qwen3-vl:8b',
    family: 'Qwen3-VL',
    params: '8B',
    tier: 3,
    sizeGB: 5.2,
    summary: '同系列效果更强，需要 16 GiB 以上内存，M 系列芯片体验更好。',
    capabilities: { chinese: '优秀', ocr: '优秀', speed: '慢' },
  },
  {
    id: 'minicpm-v:8b',
    family: 'MiniCPM-V',
    params: '8B',
    tier: 3,
    sizeGB: 5.5,
    summary: '中文 OCR 表现突出，体积与内存需求较高。',
    capabilities: { chinese: '优秀', ocr: '优秀', speed: '慢' },
  },
  {
    id: 'gemma3:4b',
    family: 'Gemma 3',
    params: '4B',
    tier: 2,
    sizeGB: 3.3,
    summary: 'Google 多模态模型，多语言能力强，中文场景不如 Qwen 对口。',
    capabilities: { chinese: '一般', ocr: '良好', speed: '中' },
  },
];

export function isCatalogModel(id) {
  return MODEL_CATALOG.some((model) => model.id === id);
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
