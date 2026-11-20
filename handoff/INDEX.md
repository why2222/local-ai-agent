# 项目状态快照：本地 AI 助手

更新时间：2026-11-20。本文件是项目级状态快照，新会话先读本文件，再按需深入子文件。

## 目标与验收

在自己电脑上运行的中文多模态 AI 助手：文字对话、JPG/PNG 图片理解、中文 OCR、本地聊天历史；模型部署在本地，数据不出电脑；代码和配置可迁移到 Apple M2 MacBook。

完整设计与验收标准见 `docs/superpowers/specs/2026-11-20-local-ai-assistant-design.md`。首版不包含文档知识库、向量数据库、账号、语音、视频、云端同步和多用户；文档问答是后续独立阶段。

## 当前状态

首版已完成并在 Linux 真机验证：中文流式对话、图片 OCR 与总结、停止生成、失败重试、会话新建/切换/删除、历史与图片持久化、断网可用。实测：模型保持加载时短文字首字约 1.1 秒、约 10 token/s；1440×1000 中文截图 OCR 加总结约 4 分 18 秒，推理内存约 2.4 GiB。

最近完成（2026-11-20 21:40）：修复局域网访问时 `crypto.randomUUID is not a function`。原因：通过 `http://192.168.31.7:43210` 访问属于非安全 HTTP 环境，浏览器禁用 `crypto.randomUUID()`；`public/app.mjs` 增加了本机 UUID 兼容回退。发送、流式、停止均已回归验证，`npm run check` 通过。

服务当前在运行：应用 `0.0.0.0:43210`，Ollama `127.0.0.1:11434`。

## 关键决策

- 技术栈：Node.js 22+ 内置模块 + 浏览器原生 HTML/CSS/JS，无前端框架、无外部依赖；Ollama 固定版本安装在 `runtime/ollama/`，免 sudo、不装系统服务；模型在 `data/models/`。
- 默认模型 `qwen3-vl:2b-instruct-q4_K_M`（Instruct 版，非 Thinking），`numCtx` 2048，单图最大 8 MiB，同时生成请求数 1。以本机 i3-N305、11 GiB 内存、无独显可稳定运行为约束。
- UI：macOS 风格 C 版雾紫灰浅色设计。用户明确否定过绿色"AI 味"按钮和纯黑严肃风格，不要回退。
- 模型调用封装在 `src/ollama.mjs`，未来可替换 llama.cpp 而不影响界面与历史格式。

## 局域网开放（对首版设计的有意例外）

设计文档原定只监听 `127.0.0.1`。2026-11-20 用户明确要求"临时验证打开局域网访问"，随后要求"不要限时，当前一直打开局域网访问"。

实现：环境变量 `LOCAL_AI_ALLOW_LAN=1` 时监听 `0.0.0.0`（`src/config.mjs:8`），默认仍只监听回环；私网 IPv4 的 Host 头校验随之放行。`scripts/start.sh` 不含该变量，**重启后要保持局域网访问，必须用 `LOCAL_AI_ALLOW_LAN=1 npm start` 启动**。

此授权仅限局域网，不包含任何公网隧道或远程端口转发；公网暴露仍需按安全底线单独取得明确同意。

## 禁区与信任边界

- 正常运行不调用云端 AI，不加载外部字体/脚本/CDN/统计；不得为提速改用 `-cloud` 模型。
- 聊天文字和图片只写入本地 `data/`；日志不记录完整聊天正文或图片内容。
- 模型输出不得未经转义直接注入 `innerHTML`。
- 服务校验所有请求参数，拒绝路径穿越、非法文件和不支持的方法。
- 删除会话会同时删除对应图片，操作前需确认。
- 不得把本机绝对路径写死在应用模块中。

## 验证与测试

项目没有自动化测试，唯一检查是 `npm run check`（对全部 src 和 public 模块做 `node --check` 语法检查）。功能验证靠真实浏览器端回归。

## 遗留事项 / 下一步候选

- git 基线：项目此前无版本控制，2026-11-20 初始化仓库（main 分支）并提交首个基线，仓库级署名 `wuhaoyu2222 <wuhaoyu2222@gmail.com>`（未改全局配置）；`data/`、`runtime/`、`.superpowers/` 不入库。
- M2 MacBook 迁移：README 已有安装、迁移、Metal 加速和切换 `qwen3-vl:4b-instruct-q4_K_M` 的步骤，**尚未真机验证**，不能标记完成。
- 可选方向：补自动化测试、文档问答（独立阶段）、M2 真机适配验证。新功能用 `/grill-with-docs` 明确范围后再 `/implement`；疑难 bug 用 `/diagnosing-bugs`。

## 阅读清单

1. `README.md` — 安装、启动、使用、配置、FAQ、M2 迁移。
2. `docs/superpowers/specs/2026-11-20-local-ai-assistant-design.md` — 首版设计与验收标准。
3. `config.json`、`src/config.mjs` — 模型/端口/数据目录与局域网开关。
4. `src/server.mjs`、`src/app.mjs` — HTTP 服务与 API。
5. `src/ollama.mjs` — Ollama 客户端与流式转发。
6. `public/app.mjs` — 前端交互（含 randomUUID 回退）。
7. `scripts/` — setup/start 脚本。

## 相关文件

- `handoff/continuations/task_66fb2eeb50d19071.draft.md` — 工作台自动维护的回合草稿，只保留当前事实，正式状态以本文件为准。
- 旧会话 `session_06ef4c2e-8bef-468a-9cb7-2525357563b1` 已损坏不可恢复：历史图片的服务端 blob 被清除，所有请求被 API 以 400 拒绝。后续工作一律在新会话进行，不要再尝试修复该会话。
