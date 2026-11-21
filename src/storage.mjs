import { writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// 同目录临时文件 + 原子替换，避免中途退出损坏 JSON。
export async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  const json = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, json, 'utf8');
  await rename(tmpPath, filePath);
}
