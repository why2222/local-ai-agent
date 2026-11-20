import { createServer } from 'node:http';

// 进程内假 Ollama：/api/tags 返回模型清单，/api/chat 交给测试自定义响应。
export async function startFakeOllama({ models = ['qwen3-vl:2b-instruct-q4_K_M'] } = {}) {
  const state = { requests: [], onChat: null };
  const server = createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      return;
    }
    if (req.url === '/api/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body);
        state.requests.push(payload);
        if (state.onChat) state.onChat(payload, req, res);
        else {
          res.writeHead(500);
          res.end('onChat 未设置');
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}

export function writeNdjsonLines(res, objects) {
  for (const obj of objects) res.write(JSON.stringify(obj) + '\n');
  res.end();
}
