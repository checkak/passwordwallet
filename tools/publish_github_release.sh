#!/usr/bin/env bash
# 发布一个 GitHub Release（供 App 的「版本更新」读取）
#
# 用法：
#   bash tools/publish_github_release.sh v0.6 "本次更新内容…"
#
# 前置：
#   1. 已安装 GitHub CLI（gh）并登录：gh auth login
#   2. 当前目录已关联仓库：git remote -v 能看到 origin
#   3. 已构建好 build/密码卡包-0.6.apk 与 build/PasswordWallet-0.6.ipa
#
# 发布后把仓库名填进 web/app.js：
#   const GITHUB_UPDATE_REPO = '你的用户名/仓库名';
# 重新出包，旧版本启动就会读到这个 release 并亮小红点。
set -euo pipefail

TAG="${1:-}"
NOTES="${2:-}"
if [ -z "$TAG" ]; then
  echo "用法: bash tools/publish_github_release.sh v0.6 \"更新说明\""
  exit 1
fi

VER="${TAG#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/build/密码卡包-${VER}.apk"
IPA="$ROOT/build/PasswordWallet-${VER}.ipa"

command -v gh >/dev/null || { echo "缺少 gh：https://cli.github.com/"; exit 1; }
git -C "$ROOT" remote get-url origin >/dev/null 2>&1 || { echo "当前目录未关联 GitHub 仓库"; exit 1; }

ARGS=()
[ -f "$APK" ] && ARGS+=("$APK") || echo "提示：未找到 $APK（本次只发说明）"
[ -f "$IPA" ] && ARGS+=("$IPA") || echo "提示：未找到 $IPA（本次只发说明）"

if [ -n "$NOTES" ]; then
  gh release create "$TAG" "${ARGS[@]}" --title "密码卡包 $TAG" --notes "$NOTES"
else
  gh release create "$TAG" "${ARGS[@]}" --title "密码卡包 $TAG" --generate-notes
fi

echo "已发布 $TAG"
echo "App 端配置：const GITHUB_UPDATE_REPO = '$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo '用户名/仓库名')';"
