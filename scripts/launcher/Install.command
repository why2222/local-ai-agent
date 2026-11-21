#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "开始安装本地 AI 助手（首次需下载 Ollama 与模型，约 2-4 GB，请保持联网）"
ensure_node
ensure_ollama_mac
cd "$ROOT_DIR"
bash scripts/setup.sh
start_service
open_app
log "安装完成，应用已在浏览器打开。以后双击 Start.command 即可使用。"
