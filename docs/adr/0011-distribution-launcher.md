# 分发：GitHub Releases zip + 一键启动器（免 Electron/签名）

2026-11-22 确定分发方案。目标用户只会双击安装包、优先 macOS，无 Apple Developer 账号，发布渠道 GitHub；用户接受"浏览器打开"的形式，不要求必须原生安装包。

决定：不做 Electron（避免签名/公证与打包工程量），改为 Releases 发布 `local-ai.zip`：
- `Install.command`：便携 Node.js（免 sudo）、Ollama.app 项目内安装（`runtime/ollama/Ollama.app`，`ollama-env.sh`/`install-ollama.sh` 已支持该路径）、模型下载、启动并打开浏览器。
- `Start.command`：启动服务并打开浏览器；健康检查返回项目根目录，若 43210 端口仍是移动前旧目录的服务，则先停止旧进程再从当前目录重启。
- `Update.command`：通过 `releases/latest/download/local-ai.zip` 直链拉取最新 release zip，不依赖 GitHub API 元数据；覆盖代码目录（src/public/scripts/docs 等），保留 `data/`、`runtime/`、`config.json`。
- `scripts/pack-release.sh` 生成 zip（根目录含三个启动器）。

## Consequences

- 未签名，用户首次需"右键 → 打开"；安装器对下载的 Node/Ollama.app 做 `xattr -dr com.apple.quarantine` 处理。
- `RELEASE_REPO` 需维护者改为自己的 GitHub 仓库（或 `LOCAL_AI_RELEASE_REPO` 环境变量）。
- macOS 双击安装流程未在 M2 真机验证（本机 Linux 仅做脚本语法与打包验证），首次在 M2 上需实测。
- 若未来需要原生双击体验与自动更新，再评估 Electron 独立阶段。
