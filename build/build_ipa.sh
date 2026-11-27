#!/usr/bin/env bash
# 密码卡包 V1.2 — 无 Xcode 构建 IPA（WSL: clang-14 + ld64.lld + iPhoneOS16.5.sdk）
set -euo pipefail

SRC=/mnt/e/DATA/Pojia/PasswordWallet
TC=/mnt/e/DATA/Pojia/_toolchain
SDK=$TC/sdk/iPhoneOS16.5.sdk
LD=$TC/lld/usr/lib/llvm-14/bin/ld64.lld
OUT=$SRC/build/out
APPNAME=PasswordWallet
BUNDLE="$OUT/Payload/$APPNAME.app"

TARGET_MIN=12.0
SDK_VER=16.5

rm -rf "$OUT"
mkdir -p "$OUT/obj" "$BUNDLE"

echo "== 1/4 编译 Objective-C 源码 =="
CFLAGS=(-target arm64-apple-ios$TARGET_MIN -isysroot "$SDK" -fobjc-arc -O2
        -Wall -Wno-unused-parameter -I "$SRC/native" -DNDEBUG)
for f in "$SRC"/native/*.m; do
  o="$OUT/obj/$(basename "${f%.m}").o"
  clang "${CFLAGS[@]}" -c "$f" -o "$o"
  echo "  cc $(basename "$f")"
done

echo "== 2/4 链接 arm64 可执行文件 =="
"$LD" -arch arm64 \
  -platform_version ios $TARGET_MIN $SDK_VER \
  -syslibroot "$SDK" \
  -o "$BUNDLE/$APPNAME" \
  "$OUT"/obj/*.o \
  -framework UIKit -framework Foundation -framework WebKit -framework Security \
  -framework CoreGraphics -framework QuartzCore \
  -lSystem
chmod 755 "$BUNDLE/$APPNAME"

echo "== 3/4 组装 App Bundle =="
cp "$SRC/native/Info.plist" "$BUNDLE/Info.plist"
mkdir -p "$BUNDLE/web"
cp "$SRC"/web/*.html "$SRC"/web/*.css "$SRC"/web/*.js "$BUNDLE/web/"
for icon in AppIcon60x60@2x.png AppIcon60x60@3x.png AppIcon76x76@2x.png; do
  cp "$SRC/assets/icons/$icon" "$BUNDLE/$icon"
done
printf 'APPL????' > "$BUNDLE/PkgInfo"

echo "== 4/4 打包 IPA =="
cd "$OUT"
zip -qry "$SRC/build/$APPNAME-V1.2.ipa" Payload
cd "$SRC/build"

echo "--- 产物 ---"
ls -lh "$SRC/build/$APPNAME-V1.2.ipa"
file "$BUNDLE/$APPNAME"
sha256sum "$SRC/build/$APPNAME-V1.2.ipa"
echo "BUILD_OK"
