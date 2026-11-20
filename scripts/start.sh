#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ollama-env.sh"

OLLAMA_PID=""
cleanup() {
  if [[ -n "$OLLAMA_PID" ]]; then
    kill "$OLLAMA_PID" 2>/dev/null || true
    wait "$OLLAMA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if ! curl --fail --silent "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  "$OLLAMA_BIN" serve >"$ROOT_DIR/data/logs/ollama.log" 2>&1 &
  OLLAMA_PID=$!
fi

for _ in {1..60}; do
  if curl --fail --silent "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! "$OLLAMA_BIN" show "$MODEL" >/dev/null 2>&1; then
  echo "模型尚未安装，请先运行 npm run setup。"
  exit 1
fi

cd "$ROOT_DIR"
node src/server.mjs
