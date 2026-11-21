import os from 'node:os';

export function getDeviceInfo() {
  const cpus = os.cpus();
  return {
    cpuModel: cpus[0]?.model || '未知',
    cores: cpus.length,
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    platform: os.platform(),
    arch: os.arch(),
    isAppleSilicon: os.platform() === 'darwin' && os.arch() === 'arm64',
  };
}
