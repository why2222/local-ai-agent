#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then exec /bin/bash "$0" "$@"; fi
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd -P)"
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

service_is_current() {
  local service_root
  service_root="$(curl --fail --silent http://127.0.0.1:43210/api/health 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).config?.rootDir||"")}catch{process.exit(1)}})')" || return 1
  [[ "$service_root" == "$ROOT_DIR" ]]
}

stop_service() {
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -nP -iTCP:43210 -sTCP:LISTEN -t 2>/dev/null || true)"
  fi
  if [[ -z "$pids" ]]; then
    pids="$(pgrep -f '(^|/)node src/server\.mjs$' 2>/dev/null || true)"
  fi
  [[ -n "$pids" ]] || return 0
  kill $pids 2>/dev/null || true
  for _ in {1..10}; do
    if ! kill -0 $pids 2>/dev/null; then return 0; fi
    sleep 1
  done
  kill -9 $pids 2>/dev/null || true
}

start_service() {
  ensure_node
  if ! service_is_current; then
    if curl --fail --silent http://127.0.0.1:43210/api/health >/dev/null 2>&1; then
      log "检测到旧目录的服务仍在运行，正在重启"
      stop_service
    fi
    log "启动本地服务"
    cd "$ROOT_DIR"
    mkdir -p "$ROOT_DIR/data/logs"
    nohup bash scripts/start.sh >"$ROOT_DIR/data/logs/launcher.log" 2>&1 &
    local waited=0
    for _ in {1..90}; do
      if service_is_current; then break; fi
      sleep 1
      waited=$((waited + 1))
      if [[ $((waited % 10)) -eq 0 ]]; then
        log "正在等待服务就绪…（已等待 ${waited} 秒）"
      fi
    done
    if ! service_is_current; then
      log "服务启动超时，最近日志如下："
      tail -20 "$ROOT_DIR/data/logs/launcher.log" 2>/dev/null || true
      log "请把以上日志发给我排查；也可先运行 bash scripts/setup.sh 检查 Ollama 与模型。"
      return 1
    fi
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
