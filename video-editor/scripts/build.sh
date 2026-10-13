#!/usr/bin/env bash
# 편집기 exe와 설치 파일 만들기 (Linux·macOS·Windows Git Bash)
#   필요: Node.js(npm), makensis(NSIS) — Ubuntu: sudo apt install nsis
#   결과: dist/VideoEditor.exe, installer/out/VideoEditor-<버전>-install.exe, installer/out/VideoEditor-components-install.exe
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(sed -n "s/^const APP_VERSION = '\(.*\)';/\1/p" main.mjs)
echo "▶ 버전 $VERSION"
[ -d node_modules ] || npm ci
echo "▶ exe 만들기 (bun --compile, Windows x64)"
npx bun build --compile --minify --target=bun-windows-x64 --windows-hide-console main.mjs --outfile dist/VideoEditor.exe
[ -f installer/ffmpeg.exe ] || bash scripts/get-ffmpeg.sh
echo "▶ 설치 파일 만들기 (NSIS)"
mkdir -p installer/out
( cd installer && makensis -V2 -DVERSION="$VERSION" setup.nsi && makensis -V2 components.nsi )
ls -la installer/out
