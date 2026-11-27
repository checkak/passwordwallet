#!/usr/bin/env bash
# 密码卡包 — 无 Android Studio 构建 APK（WSL: JDK17 + build-tools 34 + aapt2/d8/apksigner）
set -euo pipefail

SRC=/mnt/e/DATA/Pojia/PasswordWallet
AND=/mnt/e/DATA/Pojia/_android
export JAVA_HOME="$AND/jdk"
export PATH="$JAVA_HOME/bin:$PATH"
BT="$AND/sdk/build-tools/34.0.0"
AJAR="$AND/sdk/platforms/android-34/android.jar"
OUT="$SRC/build/apk"
APK_OUT="$SRC/build/密码卡包-V0.8.apk"
KEYSTORE="$SRC/build/android/keystore.jks"

[ -x "$BT/aapt2" ] || { echo "缺少 build-tools：先跑 _tools/setup_android.sh"; exit 1; }
[ -f "$AJAR" ] || { echo "缺少 android.jar：先跑 _tools/setup_android.sh"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"/{assets/web,compiled,classes,gen}

echo "== 1/7 收集前端资源 =="
cp "$SRC"/web/index.html "$SRC"/web/style.css "$SRC"/web/app.js "$OUT/assets/web/"

echo "== 2/7 编译资源 =="
"$BT/aapt2" compile --dir "$SRC/android/res" -o "$OUT/compiled/res.zip"

echo "== 3/7 链接资源表 + 打入 assets =="
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$AJAR" \
  --manifest "$SRC/android/AndroidManifest.xml" \
  -R "$OUT/compiled/res.zip" \
  --java "$OUT/gen" \
  --auto-add-overlay \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  -A "$OUT/assets"

echo "== 4/7 编译 Java =="
find "$SRC/android/java" -name '*.java' > "$OUT/sources.txt"
find "$OUT/gen" -name '*.java' >> "$OUT/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 \
  -bootclasspath "$AJAR" -classpath "$AJAR" \
  -d "$OUT/classes" @"$OUT/sources.txt"

echo "== 5/7 dex（d8）=="
CLASSES=$(find "$OUT/classes" -name '*.class')
"$BT/d8" --release --min-api 23 --lib "$AJAR" --output "$OUT" $CLASSES

echo "== 6/7 组装 + 对齐 =="
cp "$OUT/base.apk" "$OUT/unsigned.apk"
( cd "$OUT" && zip -q -j unsigned.apk classes.dex )
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "== 7/7 签名 =="
mkdir -p "$(dirname "$KEYSTORE")"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -alias pw -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass android -keypass android \
    -dname "CN=Cheng Tongxue, OU=Personal, O=PasswordWallet, L=CN, ST=CN, C=CN" >/dev/null 2>&1
  echo "  已生成签名证书 build/android/keystore.jks（口令 android）"
fi
"$BT/apksigner" sign \
  --ks "$KEYSTORE" --ks-key-alias pw \
  --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 23 \
  --out "$APK_OUT" "$OUT/aligned.apk"

echo "--- 校验 ---"
"$BT/apksigner" verify --verbose --print-certs "$APK_OUT" > "$OUT/verify.txt"
head -12 "$OUT/verify.txt"
"$BT/aapt2" dump badging "$APK_OUT" > "$OUT/badging.txt"
head -6 "$OUT/badging.txt"
ls -lh "$APK_OUT"
sha256sum "$APK_OUT"
echo "BUILD_APK_OK"
