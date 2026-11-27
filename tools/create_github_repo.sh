#!/usr/bin/env bash
# 一键在 GitHub 建仓库 + 推源码 + 发首个 Release，并打印要填进 app.js 的仓库名
#
# 用法（二选一）：
#   1) 已登录 gh：bash tools/create_github_repo.sh passwordwallet
#   2) 用 token ：GH_TOKEN=ghp_xxx bash tools/create_github_repo.sh passwordwallet
#
# token 权限：repo（public_repo 即可）
set -euo pipefail

NAME="${1:-passwordwallet}"
VIS="${2:-public}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GH_BIN="${GH_BIN:-gh}"
VER="0.6"

command -v "$GH_BIN" >/dev/null || { echo "缺少 gh：先装 https://cli.github.com/ 或设置 GH_BIN"; exit 1; }

cd "$ROOT"

# 1. 本地仓库
if [ ! -d .git ]; then
  git init -q
  git branch -M main 2>/dev/null || true
fi
git add -A
if ! git rev-parse HEAD >/dev/null 2>&1; then
  git -c user.name="Chen" -c user.email="chen@local" commit -q -m "密码卡包 V${VER} 源码"
  echo "已生成首个提交"
else
  git -c user.name="Chen" -c user.email="chen@local" commit -q -m "更新：V${VER}" || echo "无新改动，跳过提交"
fi

# 2. 建仓库并推送
if ! "$GH_BIN" repo view "$NAME" >/dev/null 2>&1; then
  "$GH_BIN" repo create "$NAME" --"$VIS" --source=. --remote=origin --push
else
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "$("$GH_BIN" repo view "$NAME" --json sshUrl -q .sshUrl)"
  git push -u origin main
fi
OWNER="$("$GH_BIN" repo view --json nameWithOwner -q .nameWithOwner)"
echo "仓库：$OWNER"

# 3. 首个 Release（带安装包，供 App 的版本更新读取）
APK="$ROOT/build/密码卡包-${VER}.apk"
IPA="$ROOT/build/PasswordWallet-${VER}.ipa"
ASSETS=()
[ -f "$APK" ] && ASSETS+=("$APK")
[ -f "$IPA" ] && ASSETS+=("$IPA")
if ! "$GH_BIN" release view "v${VER}" >/dev/null 2>&1; then
  "$GH_BIN" release create "v${VER}" "${ASSETS[@]}" \
    --title "密码卡包 V${VER}" \
    --notes "首个 GitHub 发布版本：轮盘/列表双模式、67 个模板、自定义 RGB、联网更新检查、清空二次确认。"
fi

cat <<EOF

✅ 完成
   仓库：https://github.com/$OWNER
   Release：https://github.com/$OWNER/releases/tag/v${VER}

最后一步（改一行后重新出包）：
   web/app.js → const GITHUB_UPDATE_REPO = '$OWNER';
   然后跑 build_apk.sh / build_ipa.sh
EOF
