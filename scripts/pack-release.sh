#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/runtime/release"
OUT="$OUT_DIR/local-ai.zip"
mkdir -p "$OUT_DIR"

cd "$ROOT_DIR"
rm -f "$OUT"
zip -q -r "$OUT" \
  src public scripts config.json package.json README.md CONTEXT.md docs .gitignore \
  -x '*/.DS_Store' 'scripts/launcher/root/*'
zip -q -j "$OUT" \
  "$ROOT_DIR/scripts/launcher/root/Install.command" \
  "$ROOT_DIR/scripts/launcher/root/Start.command" \
  "$ROOT_DIR/scripts/launcher/root/Update.command"
printf '发布包已生成: %s\n' "$OUT"
printf '发布到 GitHub Releases: gh release create <tag> %s --generate-notes\n' "$OUT"
