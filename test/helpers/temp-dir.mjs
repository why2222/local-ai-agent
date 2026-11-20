import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 在动态 import 被测模块之前调用：把数据目录隔离到临时目录。
export function useTempDataDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  process.env.LOCAL_AI_DATA_DIR = dir;
  return dir;
}
