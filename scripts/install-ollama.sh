#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="v0.40.16"
VERSION_NUMBER="0.40.16"
ARCHIVE="ollama-linux-amd64.tar.zst"
SHA256="87bfafb2acbc89b2e6a1be0a9043de6aa75fb450696f86bc426e65fc448f788d"

if [[ "$(uname -s)" == "Darwin" ]]; then
  if command -v ollama >/dev/null 2>&1; then
    ollama --version
    exit 0
  fi
  if [[ -x /Applications/Ollama.app/Contents/Resources/ollama ]]; then
    /Applications/Ollama.app/Contents/Resources/ollama --version
    exit 0
  fi
  echo "请先从 https://ollama.com/download/mac 安装 Ollama，再重新运行 npm run setup。"
  exit 1
fi

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "当前自动安装脚本仅支持 Linux x86_64。"
  exit 1
fi

OLLAMA_BIN="$ROOT_DIR/runtime/ollama/bin/ollama"
if [[ -x "$OLLAMA_BIN" ]] && [[ "$("$OLLAMA_BIN" --version 2>&1)" == *"$VERSION_NUMBER"* ]]; then
  "$OLLAMA_BIN" --version
  exit 0
fi

DOWNLOAD_DIR="$ROOT_DIR/runtime/downloads"
ARCHIVE_PATH="$DOWNLOAD_DIR/$VERSION-$ARCHIVE"
mkdir -p "$DOWNLOAD_DIR" "$ROOT_DIR/runtime/ollama"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  curl --fail --location --retry 3 --continue-at - \
    --output "$ARCHIVE_PATH" \
    "https://github.com/ollama/ollama/releases/download/$VERSION/$ARCHIVE"
fi

echo "$SHA256  $ARCHIVE_PATH" | sha256sum --check --status || {
  echo "Ollama 安装包校验失败。请删除 runtime/downloads/$VERSION-$ARCHIVE 后重试。"
  exit 1
}

tar -xf "$ARCHIVE_PATH" -C "$ROOT_DIR/runtime/ollama"
"$OLLAMA_BIN" --version
