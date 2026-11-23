import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LIB = path.resolve('scripts/launcher/lib.sh');

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function runStartService(t, { scenario }) {
  const root = await mkdtemp(path.join(tmpdir(), 'local-ai-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const newService = path.join(root, 'new-service');
  const oldService = path.join(root, 'old-service');
  const commands = path.join(root, 'commands');
  const oldRoot = path.join(root, 'old-location');
  const oldConfig = { dataDir: path.join(oldRoot, 'data') };
  if (scenario === 'moved-current') oldConfig.rootDir = oldRoot;
  const oldHealth = JSON.stringify({ config: oldConfig });
  const currentHealth = JSON.stringify({ config: { rootDir: root, dataDir: path.join(root, 'external-data') } });
  let initialize = '';
  if (scenario === 'current') initialize = `: > ${shellQuote(newService)};`;
  if (scenario.startsWith('moved')) initialize = `: > ${shellQuote(oldService)};`;
  const script = `
    set -e
    source ${shellQuote(LIB)}
    ROOT_DIR=${shellQuote(root)}
    ensure_node() { :; }
    curl() {
      if [[ -f ${shellQuote(newService)} ]]; then
        printf '%s\\n' ${shellQuote(currentHealth)}
      elif [[ -f ${shellQuote(oldService)} ]]; then
        printf '%s\\n' ${shellQuote(oldHealth)}
      else
        return 1
      fi
    }
    lsof() { [[ ! -f ${shellQuote(oldService)} ]] || printf '4242\\n'; }
    kill() {
      if [[ "$1" == "-0" ]]; then [[ -f ${shellQuote(oldService)} ]]; return; fi
      printf 'kill\\n' >> ${shellQuote(commands)}
      rm -f ${shellQuote(oldService)}
    }
    nohup() { printf 'nohup\\n' >> ${shellQuote(commands)}; : > ${shellQuote(newService)}; }
    sleep() { :; }
    ${initialize}
    start_service
  `;
  const result = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  const actions = existsSync(commands) ? await readFile(commands, 'utf8') : '';
  return { result, actions };
}

for (const scenario of ['moved-legacy', 'moved-current']) {
  test(`移动目录后按顺序重启旧服务（${scenario}）`, async (t) => {
    const { result, actions } = await runStartService(t, { scenario });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(actions, 'kill\nnohup\n');
  });
}

test('当前目录的服务保持复用，自定义数据目录不影响判断', async (t) => {
  const { result, actions } = await runStartService(t, { scenario: 'current' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(actions, '');
});

test('没有服务时直接启动，不执行结束进程操作', async (t) => {
  const { result, actions } = await runStartService(t, { scenario: 'fresh' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(actions, 'nohup\n');
});
