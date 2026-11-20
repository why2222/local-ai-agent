# 项目状态快照：本地 AI 助手

更新时间：2026-11-21。本文件是项目级状态快照，新会话先读本文件，再按需深入子文件。

## 目标与验收

在自己电脑上运行的中文多模态 AI 助手：文字对话、JPG/PNG 图片理解、中文 OCR、本地聊天历史；模型部署在本地，数据不出电脑；代码和配置可迁移到 Apple M2 MacBook。

完整设计与验收标准见 `docs/superpowers/specs/2026-11-20-local-ai-assistant-design.md`。首版不包含文档知识库、向量数据库、账号、语音、视频、云端同步和多用户；文档问答是后续独立阶段。

## 当前状态

首版已完成并在 Linux 真机验证：中文流式对话、图片 OCR 与总结、停止生成、失败重试、会话新建/切换/删除、历史与图片持久化、断网可用。实测：模型保持加载时短文字首字约 1.1 秒、约 10 token/s；1440×1000 中文截图 OCR 加总结约 4 分 18 秒，推理内存约 2.4 GiB。

最近完成（2026-11-20 21:40）：修复局域网访问时 `crypto.randomUUID is not a function`。原因：通过 `http://192.168.31.7:43210` 访问属于非安全 HTTP 环境，浏览器禁用 `crypto.randomUUID()`；`public/app.mjs` 增加了本机 UUID 兼容回退。发送、流式、停止均已回归验证，`npm run check` 通过。

2026-11-21：建立自动化测试（`npm test`，51 用例全绿，约 1 秒），过程中修复两个真实 bug：

1. `public/app.mjs:37` 笔误 `globalThis.createId()`：本机回环访问（安全上下文）发送消息必抛 TypeError，此前局域网验证走的是回退分支所以未暴露。已抽取为 `public/id.mjs` 并修复为 `globalThis.crypto.randomUUID()`，三条路径均有回归测试。
2. 停止生成监听 `req 'close'` 不可靠：客户端断开后不触发，上游生成不中止、消息不保存。已改为 `res 'close'` + `!res.writableEnded` 守卫（`src/app.mjs`），集成测试验证停止后保存 stopped 部分回答、生成锁释放。

另新增 `LOCAL_AI_DATA_DIR` / `LOCAL_AI_OLLAMA_URL` 环境变量覆盖（测试 seam，见 `docs/adr/0001-testing-strategy.md`）。服务已用新代码重启（`LOCAL_AI_ALLOW_LAN=1 npm start`），真实模型短问答冒烟通过，测试会话已清理。前端修复为静态文件，**其他设备需刷新页面（必要时强制刷新）后生效**。

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

- `npm test`：51 个用例，Node 内置 `node:test`，零依赖，约 1 秒。覆盖前端 `createId`、config/Host 校验、storage 原子写入、chat-store（含损坏隔离）、image-store 签名校验、ollama 请求构造与流式/中止、HTTP API 集成（路径穿越、生成锁、停止生成）。
- 测试一律用进程内假 Ollama + 临时数据目录，不加载真实模型、不读写真实 `data/`；真实模型验证保持手工冒烟。
- `npm run check`：全部 src 与 public 模块（含 `public/id.mjs`）的 `node --check` 语法检查。
- 前端 DOM 交互无自动化测试，仍靠浏览器手工回归。
- 术语见 `CONTEXT.md`；测试策略决策见 `docs/adr/0001-testing-strategy.md`。

## 遗留事项 / 下一步候选

- git：2026-11-20 初始化仓库（main 分支）并提交首个基线 `78d6956`；2026-11-21 提交测试与 bug 修复。仓库级署名 `wuhaoyu2222 <wuhaoyu2222@gmail.com>`（未改全局配置）；`data/`、`runtime/`、`.superpowers/` 不入库。`handoff/continuations/` 下当前会话的自动草稿不纳入功能提交。
- M2 MacBook 迁移：README 已有安装、迁移、Metal 加速和切换 `qwen3-vl:4b-instruct-q4_K_M` 的步骤，**尚未真机验证**，不能标记完成。
- 可选方向：文档问答（独立阶段）、M2 真机适配验证、前端 DOM 交互测试（目前无基建）。新功能用 `/grill-with-docs` 明确范围后再 `/implement`；疑难 bug 用 `/diagnosing-bugs`。

## 阅读清单

1. `README.md` — 安装、启动、使用、配置、FAQ、M2 迁移。
2. `docs/superpowers/specs/2026-11-20-local-ai-assistant-design.md` — 首版设计与验收标准。
3. `config.json`、`src/config.mjs` — 模型/端口/数据目录与局域网开关。
4. `src/server.mjs`、`src/app.mjs` — HTTP 服务与 API。
5. `src/ollama.mjs` — Ollama 客户端与流式转发。
6. `public/app.mjs`、`public/id.mjs` — 前端交互与 ID 生成（含 randomUUID 回退）。
7. `CONTEXT.md`、`docs/adr/0001-testing-strategy.md` — 领域术语与测试策略决策。
8. `test/` — 自动化测试与 `test/helpers/`（假 Ollama、临时数据目录）。
9. `scripts/` — setup/start 脚本。

## 相关文件

- `handoff/continuations/task_66fb2eeb50d19071.draft.md` — 工作台自动维护的回合草稿，只保留当前事实，正式状态以本文件为准。
- 旧会话 `session_06ef4c2e-8bef-468a-9cb7-2525357563b1` 已损坏不可恢复：历史图片的服务端 blob 被清除，所有请求被 API 以 400 拒绝。后续工作一律在新会话进行，不要再尝试修复该会话。
