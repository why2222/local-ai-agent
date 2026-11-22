#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then exec /bin/bash "$0" "$@"; fi
set -eo pipefail

# 一行安装：bash -c "$(curl -fsSL https://raw.githubusercontent.com/why2222/local-ai-agent/main/scripts/launcher/web-install.sh)"
REPO="${LOCAL_AI_RELEASE_REPO:-why2222/local-ai-agent}"
DEST="${LOCAL_AI_HOME:-$HOME/Applications/local-ai}"

echo "[本地助手] 开始安装到 $DEST"
mkdir -p "$DEST"

echo "[本地助手] 下载最新版本"
curl --fail --location --retry 3 --output /tmp/local-ai-install.zip \
  "https://github.com/$REPO/releases/latest/download/local-ai.zip"

extract_dir="$DEST/.install-extract"
rm -rf "$extract_dir"
mkdir -p "$extract_dir"
unzip -q -o /tmp/local-ai-install.zip -d "$extract_dir"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$extract_dir/" "$DEST/"
else
  cp -R "$extract_dir/"* "$DEST/"
fi
rm -rf "$extract_dir"

cd "$DEST"
bash scripts/launcher/Install.command
echo "[本地助手] 安装完成。以后运行 $DEST/Start.command 即可启动。"
