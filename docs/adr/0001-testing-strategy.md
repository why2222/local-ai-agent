# 自动化测试：Node 内置运行器 + 假 Ollama + 临时数据目录

2026-11-21 为项目建立自动化测试时决定：使用 Node 22 内置 `node:test` + `assert/strict`（`npm test`），不引入任何测试框架；测试通过进程内假 Ollama 服务替代真实模型，并用 `LOCAL_AI_DATA_DIR` / `LOCAL_AI_OLLAMA_URL` 环境变量把数据目录和 Ollama 地址隔离到测试环境。

原因：项目既定约束是零外部依赖，引入 Vitest/Jest 会破坏该约束；真实模型约 2 GB、图片推理分钟级，无法作为每次改动的日常回归手段。测试因此保持在 1 秒级、不读写真实 `data/`。

## Considered Options

- **Vitest / Jest**：生态成熟，但引入外部依赖，违背项目约束，拒绝。
- **对真实 Ollama 跑自动化测试**：保真度高，但加载慢、依赖本机模型状态，拒绝；真实模型验证保留为手工冒烟。

## Consequences

- 更换测试运行器需要重写全部测试，不应轻率提出。
- `LOCAL_AI_DATA_DIR` / `LOCAL_AI_OLLAMA_URL` 是测试与高级用途的公开配置面，改动时需同步测试。
