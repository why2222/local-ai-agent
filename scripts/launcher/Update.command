#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_node
log "检查最新版本（$RELEASE_REPO）"
auth_header=()
if [[ -n "${LOCAL_AI_GITHUB_TOKEN:-}" ]]; then
  auth_header=(-H "Authorization: Bearer $LOCAL_AI_GITHUB_TOKEN")
fi
latest_url="$(curl --fail --silent "${auth_header[@]}" "https://api.github.com/repos/$RELEASE_REPO/releases/latest" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);const a=(r.assets||[]).find(a=>a.name.endsWith('.zip'));console.log(a?a.browser_download_url:'');})")"
[[ -n "$latest_url" ]] || fail "未找到发布包。私有仓库需设置 LOCAL_AI_GITHUB_TOKEN（有该仓库读取权限的 GitHub token）。"

log "下载最新版本"
mkdir -p "$ROOT_DIR/runtime/downloads"
curl --fail --location "${auth_header[@]}" --output "$ROOT_DIR/runtime/downloads/update.zip" "$latest_url"

log "安装更新（保留聊天数据、模型和本机配置）"
extract_dir="$ROOT_DIR/runtime/downloads/update-extract"
rm -rf "$extract_dir"
mkdir -p "$extract_dir"
ditto -x -k "$ROOT_DIR/runtime/downloads/update.zip" "$extract_dir" 2>/dev/null || unzip -q -o "$ROOT_DIR/runtime/downloads/update.zip" -d "$extract_dir"
source_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -1)"
[[ -n "$source_dir" ]] || fail "更新包结构异常"
for path in src public scripts package.json README.md CONTEXT.md docs; do
  if [[ -e "$source_dir/$path" ]]; then
    rm -rf "${ROOT_DIR:?}/$path"
    cp -R "$source_dir/$path" "$ROOT_DIR/$path"
  fi
done

cd "$ROOT_DIR"
bash scripts/setup.sh
if pgrep -f 'node src/server.mjs' >/dev/null 2>&1; then
  log "重启本地服务"
  pkill -f 'node src/server.mjs' || true
  sleep 1
fi
start_service
open_app
log "更新完成。"
