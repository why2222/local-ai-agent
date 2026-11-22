# 本地 AI 助手 · 部署指南（面向 AI 代理）

本文档面向 AI 代理（agent）：按本文档可自动完成部署、验证、更新与排障，**无需用户手动操作**。普通用户只需最后打开浏览器。

## 1. 项目与分发物

- 应用：本地多模态 AI 助手（中文对话、图片 OCR、文档摘要、模型商店、深浅色 UI）。
- 架构：本机 Node.js 服务（`127.0.0.1:43210`）+ Ollama（`127.0.0.1:11434`）+ 本地模型。零 npm 依赖。
- 分发仓库：`https://github.com/why2222/local-ai-agent`（public）。
- 分发物：
  - 源码仓库（含 `scripts/launcher/`）。
  - Release `local-ai.zip`（含 `Install.command` / `Start.command` / `Update.command`）。
  - 一行安装脚本 `scripts/launcher/web-install.sh`（首选安装方式）。

## 2. 安装（agent 执行）

**首选：一行命令安装**（macOS / Linux 均可，免 sudo、免手动装环境）：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/why2222/local-ai-agent/main/scripts/launcher/web-install.sh)"
```

脚本行为（可预期）：

1. 下载最新 release zip 到 `/tmp/local-ai-install.zip`。
2. 解压到 `~/Applications/local-ai`（可用 `LOCAL_AI_HOME` 覆盖目标目录）。
3. 运行 `scripts/launcher/Install.command`：
   - 便携 Node.js ≥22（系统无 Node 时下载到 `runtime/node`）。
   - macOS 下载 Ollama.app 到 `runtime/ollama/Ollama.app`；Linux 用 `scripts/install-ollama.sh` 的固定版本。
   - `scripts/setup.sh` 下载默认模型（约 2 GB）。
4. 启动服务并打开浏览器（无浏览器时打印 URL）。

**备选：zip + 双击**（macOS 有 Gatekeeper 提示，需"系统设置 → 隐私与安全性 → 仍要打开"，或 `xattr -dr com.apple.quarantine <解压目录>`）。

## 3. 验证（必须执行）

```bash
curl -s http://127.0.0.1:43210/api/health
```

预期：`{"ollama":{"running":true},"model":{"available":true},"ok":true,...}`。

- 浏览器访问 `http://127.0.0.1:43210` 应显示聊天界面。
- 发送一条短消息应出现流式回答。
- 启动器位置：`~/Applications/local-ai/Start.command`、`Update.command`。

## 4. 启动与停止

- 启动：`Start.command`（幂等：已在运行则直接打开浏览器）。
- 停止：终端 `pkill -f 'node src/server.mjs'`；Ollama 如由启动器启动会被一并停止。
- 手动启动替代：`npm start`（项目根目录）。

## 5. 更新

- 用户侧：双击 `Update.command`（从最新 release 更新，保留 `data/`、`runtime/`、`config.json`）。
- 或重跑一行安装命令（等价于更新，保留数据）。
- 维护者发布新版本：`bash scripts/pack-release.sh && gh release create <tag> runtime/release/local-ai.zip --generate-notes`。
- 私有仓库需 `LOCAL_AI_GITHUB_TOKEN`（有读权限的 PAT）；公开仓库无需 token。

## 6. 配置（如需修改）

`config.json`：model、port、numCtx、maxImageBytes、dataDir。

环境变量：

| 变量 | 用途 | 默认 |
|---|---|---|
| `LOCAL_AI_ALLOW_LAN` | `1` 时监听 `0.0.0.0` 并放行私网 IPv4 | 仅回环 |
| `LOCAL_AI_DATA_DIR` | 覆盖数据目录（测试/多实例） | `data` |
| `LOCAL_AI_OLLAMA_URL` | 覆盖 Ollama 地址 | `http://127.0.0.1:11434` |
| `LOCAL_AI_LIBRARY_URL` | 覆盖模型库地址（测试） | `https://ollama.com` |
| `LOCAL_AI_REMOTE_HOST` | 远程访问域名（与 TOKEN 成对启用） | 关闭 |
| `LOCAL_AI_REMOTE_TOKEN` | 远程访问令牌（≥16 位 URL 安全字符） | 关闭 |
| `LOCAL_AI_RELEASE_REPO` | 更新用仓库 | `why2222/local-ai-agent` |
| `LOCAL_AI_GITHUB_TOKEN` | 私有仓库下载认证 | 空 |

## 7. 常见故障与处理

| 现象 | 处理 |
|---|---|
| "Apple 无法验证…恶意软件" | 用一行命令安装，或"系统设置→隐私与安全性→仍要打开"，或 `xattr -dr com.apple.quarantine <目录>` |
| 安装脚本静默失败 | 用 `bash -x` 跟踪；已知修复：`ensure_ollama_mac` 非 Mac 返回 0、`curl && break` 改 `if curl; then break; fi` |
| 模型未就绪 | 重跑 `npm run setup`；查 `data/logs/ollama-setup.log` |
| 生成很慢/内存不足 | 关闭大程序、降 `numCtx` 到 1024；本机小内存是主要限制 |
| 端口 43210 被占 | 改 `config.json` 的 `port` 后重启 |
| api.github.com 不可达 | 网络限制时用网页手动发 release 或配置代理；`releases/latest/download/local-ai.zip` 不经 API 也可下载 |
| 模型输出截断/死循环 | 摘要已内建 `num_predict=400` + 截断续写与重复检测；更新到最新版即可 |

## 8. 隐私与安全边界（代理必须遵守）

- 正常运行不调用云端 AI、不加载外部字体/脚本/CDN/统计。
- 外网仅用于：首次安装下载、用户主动下载模型、用户主动更新目录、Update.command 更新。
- 聊天文字、图片、文档只写本机 `data/`；日志不记完整正文。
- 局域网开放（`LOCAL_AI_ALLOW_LAN=1`）需用户明确授权；远程公网访问需 `LOCAL_AI_REMOTE_HOST` + `LOCAL_AI_REMOTE_TOKEN` 成对启用（默认关闭，禁止无认证暴露）。
- 不得用 `-cloud` 模型或把服务绑定到公网地址。

## 9. 维护者检查清单（agent 部署后应确认）

- [ ] `curl /api/health` 返回 ok:true
- [ ] 浏览器可打开聊天页并可发送消息
- [ ] 模型商店可切换已下载模型
- [ ] 文档上传可生成摘要（小文件）
- [ ] 浅色/深色主题可切换
- [ ] 生成中刷新页面回答不中断（后台生成）
- [ ] 断网后文字/图片聊天仍可用（模型已下载后）
