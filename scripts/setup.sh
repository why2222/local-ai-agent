#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ROOT_DIR/scripts/install-ollama.sh"
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
  "$OLLAMA_BIN" serve >"$ROOT_DIR/data/logs/ollama-setup.log" 2>&1 &
  OLLAMA_PID=$!
fi

for _ in {1..60}; do
  if curl --fail --silent "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl --fail --silent "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  echo "Ollama 启动失败，请查看 data/logs/ollama-setup.log。"
  exit 1
fi

"$OLLAMA_BIN" pull "$MODEL"
"$OLLAMA_BIN" show "$MODEL" >/dev/null
PORT="$(node -e "const fs=require('node:fs'); console.log(JSON.parse(fs.readFileSync('$ROOT_DIR/config.json','utf8')).port)")"
printf '\n安装完成。运行 npm start，然后打开 http://127.0.0.1:%s\n' "$PORT"
