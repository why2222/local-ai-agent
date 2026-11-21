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

2026-11-21 新增"模型设置"功能：侧栏齿轮打开面板，展示设备信息（CPU/内存/平台）、内置模型目录（qwen3-vl 2b/4b/8b、minicpm-v:8b、gemma3:4b）及中文/OCR/速度说明、按内存与 Apple Silicon 分档的推荐建议（推荐/可试/不推荐 + 理由）、下载进度（可取消）、切换即时生效并写回 `config.json`。首版不含删除模型。API：`GET /api/models`、`POST /api/models/select`、`POST /api/models/pull`。仅用户主动下载时联网（见 `docs/adr/0002-model-settings.md`）。真实链路已验证：目录与推荐档位、未下载 409、真实 Ollama pull success、select 写回；UI 截图 `runtime/ui-settings.png`。code-review 后修复了 Apple Silicon 分档未生效的缺口并补测试。

2026-11-21 新增"远程访问模式"（**默认关闭，仅调试**）：诊断确认 zconnect 公网域名被 Host 白名单拒绝属设计行为后，用户明确授权实现。`LOCAL_AI_REMOTE_HOST`（精确域名，小写归一、去 :443）+ `LOCAL_AI_REMOTE_TOKEN`（≥16 位 URL 安全随机串）必须成对设置，缺任一或令牌非法均拒绝启动。登录 `/?token=...` 设置 `HttpOnly;Secure;SameSite=Strict` Cookie 并 302 去令牌；API 接受 `?token=`；Origin 仅允许该域名 https 同源；错误日志只记 pathname 不记 query（防令牌落盘）。本机回环/局域网不需令牌。见 `docs/adr/0003-remote-access-mode.md`（含用户知情同意与备选方案）。**当前生产启动命令未开启此模式**，需要时按 README"远程访问模式"节配置。

2026-11-21 模型目录升级（C 方案）：内置扩充至 13 个（多模态全档位+热门纯文本含 DeepSeek 系列），新增"在线获取更多模型"按钮（二次确认才连接 ollama.com，不上传应用数据），`src/model-library.mjs` 解析官方库 HTML（实测 271 个模型）并缓存 `data/model-cache.json`，失败回退内置。`POST /api/models/fetch-remote`；目录按使用中→多模态→内置→推荐度排序；纯文本模型发送图片被前后端拦截（`model-no-vision`）；不推荐模型下载需二次确认（可取消）。决策与隐私评估见 `docs/adr/0004-online-model-library.md`。

服务当前在运行：应用 `0.0.0.0:43210`，Ollama `127.0.0.1:11434`。**2026-11-21 已按用户确认启用远程访问模式**：`LOCAL_AI_ALLOW_LAN=1` + `LOCAL_AI_REMOTE_HOST=remote-access-18266.zconnect.cn` + `LOCAL_AI_REMOTE_TOKEN`（令牌仅存于进程环境变量，不写入本文档与仓库）。启动时全链路已验证：回环/局域网 200、远程无令牌或错令牌 401、正确令牌 API 200、页面 302+安全 Cookie、Cookie 访问 200、其他域名 403。关闭方式：去掉这两个 REMOTE 环境变量重启。

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

- 正常运行不调用云端 AI，不加载外部字体/脚本/CDN/统计；不得为提速改用 `-cloud` 模型。外网仅限三类明确例外：首次安装下载 Ollama/模型、用户在模型设置中主动下载模型（`docs/adr/0002`）、用户主动点击在线获取目录（`docs/adr/0004`）；不做后台自动更新或打开面板自动拉取。
- 公网访问仅能通过"远程访问模式"显式启用（域名+令牌成对配置，默认关闭）；不得用改写 Host、放开白名单等方式绕过，见 `docs/adr/0003-remote-access-mode.md`。
- 聊天文字和图片只写入本地 `data/`；日志不记录完整聊天正文或图片内容。
- 模型输出不得未经转义直接注入 `innerHTML`。
- 服务校验所有请求参数，拒绝路径穿越、非法文件和不支持的方法。
- 删除会话会同时删除对应图片，操作前需确认。
- 不得把本机绝对路径写死在应用模块中。

## 验证与测试

- `npm test`：89 个用例，Node 内置 `node:test`，零依赖，约 1 秒。覆盖前端 `createId`、config/Host 校验、storage 原子写入、chat-store（含损坏隔离）、image-store 签名校验、ollama 请求构造与流式/中止、HTTP API 集成（路径穿越、生成锁、停止生成）、模型目录与推荐分档（含 Apple Silicon）、模型列表/切换/下载 API（进度、错误、下载锁）、远程访问模式（令牌、Cookie、Origin、配置校验）、在线目录解析/缓存/合并与纯文本图片拦截。
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
7. `CONTEXT.md`、`docs/adr/` — 领域术语与决策记录（0001 测试策略、0002 模型设置、0003 远程访问模式）。
8. `src/model-catalog.mjs`、`src/device.mjs`、`src/remote-access.mjs` — 模型目录、设备检测、远程访问控制；`public/settings.mjs`、`public/http.mjs` — 设置面板与前端公共请求。
9. `test/` — 自动化测试与 `test/helpers/`（假 Ollama、临时数据目录）。
10. `scripts/` — setup/start 脚本。

## 相关文件

- `handoff/continuations/task_66fb2eeb50d19071.draft.md` — 工作台自动维护的回合草稿，只保留当前事实，正式状态以本文件为准。
- 旧会话 `session_06ef4c2e-8bef-468a-9cb7-2525357563b1` 已损坏不可恢复：历史图片的服务端 blob 被清除，所有请求被 API 以 400 拒绝。后续工作一律在新会话进行，不要再尝试修复该会话。
