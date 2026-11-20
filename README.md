# 本地助手

一个完全在自己电脑上运行的中文多模态 AI 助手。支持文字对话、JPG/PNG 图片理解、中文 OCR 和本地聊天历史，界面采用浅色 macOS 风格。

默认模型：`qwen3-vl:2b-instruct-q4_K_M`。应用不使用云端 AI、外部字体、CDN 或统计脚本，服务只监听 `127.0.0.1`。

## 首次安装

### Linux x86_64

准备 Node.js 22 或更新版本，以及 `curl`、`tar`、`zstd`、`sha256sum`。然后运行：

```bash
npm run setup
```

脚本会：

1. 从 Ollama 官方 GitHub Release 下载固定版本并校验 SHA-256。
2. 将 Ollama 安装到项目的 `runtime/ollama/`，不需要 `sudo`，不安装系统服务。
3. 将模型下载到项目的 `data/models/`。

首次需要下载约 4 GB，具体时间取决于网络。安装过程不要关闭终端。

### 启动

```bash
npm start
```

浏览器打开：<http://127.0.0.1:43210>

停止时，在终端按 `Ctrl+C`。脚本会同时停止由它启动的 Ollama，不会影响已经独立运行的其他 Ollama 实例。

模型下载完成后，文字和图片聊天不需要外网。

## 使用

- 输入文字后按 Enter 发送，Shift+Enter 换行。
- 点击“添加图片”选择 JPG 或 PNG，单张最大 8 MiB。
- 生成过程中点击圆形停止按钮，可以保留已经生成的内容。
- 将鼠标移到左侧会话上，可以删除会话及其图片。
- 窄屏下点击左上角侧栏按钮管理会话。

## 本地数据

```text
data/
├── chats/       # 会话 JSON
├── images/      # 上传图片
├── logs/        # Ollama 启动日志
└── models/      # 本地模型
```

`data/` 和 `runtime/` 已加入 `.gitignore`。删除会话会同时删除对应图片，操作前请确认不再需要。

## 配置

编辑 `config.json`：

```json
{
  "model": "qwen3-vl:2b-instruct-q4_K_M",
  "port": 43210,
  "numCtx": 2048,
  "maxImageBytes": 8388608,
  "dataDir": "data"
}
```

修改后重启应用。更换模型后还需运行一次 `npm run setup` 下载新模型。

## 测试

```bash
npm test        # 全部自动化测试（Node 内置 test runner，无额外依赖）
npm run check   # 语法检查
```

测试覆盖前端 `createId`、配置与 Host 校验、会话与图片存储、Ollama 客户端（请求构造、流式解析、中止）和 HTTP API 集成（含生成锁与停止生成）。测试使用进程内假 Ollama 和临时数据目录，不需要真实模型，不读写真实 `data/`，通常 1 秒内跑完。

两个环境变量主要用于测试和高级场景，正常运行无需设置：

- `LOCAL_AI_DATA_DIR`：覆盖数据目录（默认 `config.json` 的 `dataDir`）。
- `LOCAL_AI_OLLAMA_URL`：覆盖 Ollama 地址（默认 `http://127.0.0.1:11434`）。

另有 `LOCAL_AI_ALLOW_LAN=1` 可监听 `0.0.0.0` 并放行私网 IPv4 的 Host 头，用于局域网访问；默认仍只监听 `127.0.0.1`。

## 常见问题

### 模型尚未就绪

确认 `npm run setup` 已完整执行，然后重启：

```bash
npm start
```

也可查看 `data/logs/ollama.log` 和 `data/logs/ollama-setup.log`。

### 内存不足或生成很慢

本机没有独立显卡时，图片理解会明显慢于文字聊天。当前默认使用 `2048` 上下文，并禁用云端功能、限制单模型单请求和关闭提示缓存。仍有内存压力时，可将 `numCtx` 进一步调低到 `1024`，关闭不需要的大型程序后重启。不要为了提速改用带 `-cloud` 的模型。

当前 Linux 实测：模型保持加载时，一次短文字回答首字约 1.1 秒、生成约 10 token/s；1440×1000 中文截图的完整 OCR 与总结约 4 分 18 秒，推理进程内存约 2.4 GiB。首次加载和图片分辨率会影响耗时。

### 端口被占用

应用默认端口为 43210，Ollama 为 11434。可修改 `config.json` 中的应用 `port`；Ollama 端口固定为本机默认端口。

## 迁移到 M2 MacBook

1. 安装 Node.js 22 或更新版本。
2. 从 <https://ollama.com/download/mac> 安装最新版 Ollama，并至少打开一次完成初始化。
3. 复制项目到 MacBook。不要复制 Linux 的 `runtime/`，聊天需要迁移时复制 `data/chats/` 和 `data/images/`；模型可以在 MacBook 重新下载。
4. 在项目目录运行：

   ```bash
   npm run setup
   npm start
   ```

5. 打开 <http://127.0.0.1:43210>。

macOS 上 Ollama 会使用 Apple Silicon 的 Metal 加速。若 M2 内存充足，可将 `config.json` 的模型改为：

```text
qwen3-vl:4b-instruct-q4_K_M
```

然后重新运行 `npm run setup`。4B 模型效果更好，但占用更多内存。

当前交付环境是 Linux，以上 M2 步骤和 Metal 加速尚未经过真机验证。
