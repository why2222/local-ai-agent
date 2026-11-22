#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then exec /bin/bash "$0" "$@"; fi
set -eo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib.sh"

log "开始安装本地 AI 助手"
ensure_node
ensure_ollama_mac
cd "$ROOT_DIR"
start_service
open_app
log "后台下载默认模型（约 2 GB），下载完成后即可聊天；进度见 data/logs/model-download.log"
nohup bash scripts/setup.sh >"$ROOT_DIR/data/logs/model-download.log" 2>&1 &
log "安装完成，应用已在浏览器打开。以后双击 Start.command 即可使用。"
