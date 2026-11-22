#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_VERSION="v22.23.5"
RELEASE_REPO="${LOCAL_AI_RELEASE_REPO:-why2222/local-ai-agent}"

log() { printf '[本地助手] %s\n' "$*"; }
fail() { printf '[本地助手] 错误：%s\n' "$*" >&2; exit 1; }

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -ge 22 ]]; then return; fi
  fi
  local node_arch="x64"
  [[ "$(uname -m)" == "arm64" ]] && node_arch="arm64"
  local node_dir="$ROOT_DIR/runtime/node"
  if [[ ! -x "$node_dir/bin/node" ]]; then
    log "下载 Node.js $NODE_VERSION（便携版，无需管理员权限）"
    mkdir -p "$ROOT_DIR/runtime/downloads"
    local archive="$ROOT_DIR/runtime/downloads/node-$NODE_VERSION-darwin-$node_arch.tar.gz"
    curl --fail --location --retry 3 --continue-at - --output "$archive" \
      "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$node_arch.tar.gz"
    rm -rf "$node_dir"
    tar -xzf "$archive" -C "$ROOT_DIR/runtime/downloads"
    mv "$ROOT_DIR/runtime/downloads/node-$NODE_VERSION-darwin-$node_arch" "$node_dir"
    xattr -dr com.apple.quarantine "$node_dir" 2>/dev/null || true
  fi
  export PATH="$node_dir/bin:$PATH"
}

ensure_ollama_mac() {
  if [[ "$(uname -s)" != "Darwin" ]]; then return 0; fi
  if command -v ollama >/dev/null 2>&1 || [[ -x /Applications/Ollama.app/Contents/Resources/ollama ]]; then return; fi
  local app_dir="$ROOT_DIR/runtime/ollama/Ollama.app"
  if [[ ! -x "$app_dir/Contents/Resources/ollama" ]]; then
    log "下载 Ollama（本地推理引擎）"
    mkdir -p "$ROOT_DIR/runtime/downloads" "$ROOT_DIR/runtime/ollama"
    local archive="$ROOT_DIR/runtime/downloads/Ollama-darwin.zip"
    curl --fail --location --retry 3 --continue-at - --output "$archive" \
      "https://ollama.com/download/Ollama-darwin.zip"
    ditto -x -k "$archive" "$ROOT_DIR/runtime/ollama" 2>/dev/null || unzip -q -o "$archive" -d "$ROOT_DIR/runtime/ollama"
    xattr -dr com.apple.quarantine "$app_dir" 2>/dev/null || true
  fi
}

start_service() {
  ensure_node
  if ! curl --fail --silent http://127.0.0.1:43210/api/health >/dev/null 2>&1; then
    log "启动本地服务"
    cd "$ROOT_DIR"
    mkdir -p "$ROOT_DIR/data/logs"
    nohup bash scripts/start.sh >"$ROOT_DIR/data/logs/launcher.log" 2>&1 &
    for _ in {1..90}; do
      if curl --fail --silent http://127.0.0.1:43210/api/health >/dev/null 2>&1; then break; fi
      sleep 1
    done
  fi
}

open_app() {
  local port
  port="$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('$ROOT_DIR/config.json','utf8')).port)")"
  if command -v open >/dev/null 2>&1; then
    if ! open "http://127.0.0.1:$port" 2>/dev/null; then
      log "请打开浏览器访问 http://127.0.0.1:$port"
    fi
  else
    log "请打开浏览器访问 http://127.0.0.1:$port"
  fi
}
