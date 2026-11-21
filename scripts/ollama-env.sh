#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export OLLAMA_HOST="127.0.0.1:11434"
export OLLAMA_MODELS="$ROOT_DIR/data/models"
export OLLAMA_NO_CLOUD=1
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE="q8_0"
export OLLAMA_CONTEXT_LENGTH=2048
export LLAMA_ARG_CACHE_RAM=0
export LLAMA_ARG_NO_WARMUP=1
export LLAMA_ARG_IMAGE_MAX_TOKENS=1024
mkdir -p "$OLLAMA_MODELS" "$ROOT_DIR/data/logs"

if [[ "$(uname -s)" == "Darwin" ]]; then
  OLLAMA_BIN="$(command -v ollama || true)"
  if [[ -z "$OLLAMA_BIN" && -x "$ROOT_DIR/runtime/ollama/Ollama.app/Contents/Resources/ollama" ]]; then
    OLLAMA_BIN="$ROOT_DIR/runtime/ollama/Ollama.app/Contents/Resources/ollama"
  fi
  if [[ -z "$OLLAMA_BIN" && -x /Applications/Ollama.app/Contents/Resources/ollama ]]; then
    OLLAMA_BIN="/Applications/Ollama.app/Contents/Resources/ollama"
  fi
else
  OLLAMA_BIN="$ROOT_DIR/runtime/ollama/bin/ollama"
fi

if [[ -z "${OLLAMA_BIN:-}" || ! -x "$OLLAMA_BIN" ]]; then
  echo "未找到 Ollama，请先运行 npm run setup。"
  exit 1
fi

MODEL="$(node -e "const fs=require('node:fs'); console.log(JSON.parse(fs.readFileSync('$ROOT_DIR/config.json','utf8')).model)")"
if [[ "$MODEL" == *-cloud* ]]; then
  echo "禁止使用云端模型。"
  exit 1
fi
