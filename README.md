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
- 点击左下角齿轮打开“模型设置”：紧凑列表显示每个模型和针对本机的推荐建议，顶部可搜索、按类型或已下载筛选；点击模型行内联展开能力说明与推荐理由；在线目录默认折叠，搜索时自动展开匹配项。下载新模型（仅下载时联网，显示进度、可取消），或切换到已下载的模型（立即生效并写回 `config.json`，无需重启）。纯文本模型不支持图片，选中后发送图片会被拦截提示。
- 点击“添加文档”选择文本、代码、PDF、DOCX、XLSX 文件（单文件 ≤100 MiB），选择后**不会自动发送**：可先输入处理要求（如“提取所有颜色值”，不输入则默认生成摘要），点击发送后开始分批处理，逐批生成再汇总，显示批次进度、可停止。原文保存在本机 `data/documents/`，可点击消息中的“查看原文”。PDF 文本提取依赖系统 `pdftotext`（Linux 安装 `poppler-utils`，macOS 运行 `brew install poppler`）；扫描件无文本时请改用图片 OCR。注意：大文档按每 1500 字一批送入本机模型，批数很多时耗时会很长（本机每批约需几秒到十几秒），可随时停止。
- 需要更多模型时，点击面板里的“在线获取更多模型”，二次确认后才会连接 ollama.com 拉取官方目录（暴露出口 IP 与浏览行为，不上传任何聊天数据），成功后缓存在本地供离线浏览，失败自动回退内置目录。不推荐的模型下载前会要求再次确认。

## 分发与一键安装（macOS）

给非技术用户分发时，用 GitHub Releases 的 zip 包，用户无需安装任何开发环境。

**发布（维护者）**：

```bash
bash scripts/pack-release.sh
gh release create v1.0.0 runtime/release/local-ai.zip --generate-notes
```

`scripts/launcher/lib.sh` 的 `RELEASE_REPO` 默认为 `your-name/local-ai-assistant`，请改成你的 GitHub 仓库（也可用 `LOCAL_AI_RELEASE_REPO` 环境变量覆盖）。

**用户安装**：

方式一（推荐，一行命令，无 Gatekeeper 拦截）：打开"终端"，粘贴执行：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/why2222/local-ai-agent/main/scripts/launcher/web-install.sh)"
```

自动下载最新版本、安装便携 Node.js、Ollama 和模型，完成后浏览器自动打开应用。默认安装到 `~/Applications/local-ai`。

方式二（zip 安装）：下载 `local-ai.zip` 解压，双击 `Install.command`。macOS 对未签名脚本会提示"无法验证"，此时到"系统设置 → 隐私与安全性"底部点"仍要打开"，或在终端执行 `xattr -dr com.apple.quarantine <解压后的目录>` 后再双击。

首次需下载约 2-4 GB，无需管理员密码。

**日常使用与更新**：

- `Start.command`：启动服务并打开浏览器。
- `Update.command`：从 GitHub Releases 拉取最新版本并更新，保留聊天数据、模型和本机配置。

数据目录（`data/`）、模型、Node 与 Ollama 运行时（`runtime/`）都在项目目录内，更新不会覆盖。

Linux 仍用 `npm run setup && npm start`。

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

修改后重启应用。更换模型后还需运行一次 `npm run setup` 下载新模型；也可以直接在界面的“模型设置”里下载和切换，无需手动编辑和重启。

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

## 远程访问模式（默认关闭，仅供调试）

通过 zconnect 等反向代理从公网域名访问时，需要显式启用远程访问模式。**未配置时应用行为完全不变**，公网域名一律 403。

启用必须同时设置两个环境变量，缺少任何一个都会拒绝启动（不允许无认证远程访问）：

```bash
# 生成一个随机令牌（也可以用其他 URL 安全随机串）
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"

LOCAL_AI_ALLOW_LAN=1 \
LOCAL_AI_REMOTE_HOST=remote-access-18266.zconnect.cn \
LOCAL_AI_REMOTE_TOKEN=<上一步生成的令牌> \
npm start
```

使用方式：

- 浏览器打开 `https://remote-access-18266.zconnect.cn/?token=<令牌>`：校验通过后设置 `HttpOnly; Secure; SameSite=Strict` Cookie 并跳转到无令牌地址，之后凭 Cookie 访问，无需再带令牌。
- API/脚本可用 `?token=<令牌>` 参数（如 `curl 'https://<域名>/api/health?token=<令牌>'`）。
- 仅允许配置的那一个域名及其 `https` 同源 Origin；其他域名仍 403，本机回环和局域网访问不需要令牌。

注意：流量经过反向代理第三方（TLS 在其处终止，对代理可见）；持有令牌的人可访问全部聊天文字、图片和模型管理接口。令牌只出现在你的环境变量和首次登录链接中，不要分享。反向代理保留原始 Host 头即可，无需改写。

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
