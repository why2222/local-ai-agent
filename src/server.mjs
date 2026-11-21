import { CONFIG, REMOTE_HOST } from './config.mjs';
import { createApp } from './app.mjs';

const server = createApp();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[error] 端口 ${CONFIG.port} 已被占用，请修改 config.json 中的 port`);
  } else {
    console.error(`[error] 服务器错误: ${err.message}`);
  }
  process.exit(1);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`本地 AI 助手已启动: http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`模型: ${CONFIG.model}  数据目录: ${CONFIG.dataDir}`);
  console.log(`Ollama: ${CONFIG.ollamaUrl}`);
  if (REMOTE_HOST) {
    console.log(`远程访问模式已启用: https://${REMOTE_HOST}（需访问令牌，请使用环境变量中的令牌登录）`);
  }
});
