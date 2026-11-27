# 密码卡包 PasswordWallet · V0.11

一个本地优先的 iOS / Android 密码卡片 App：主页用「轮盘」式卡片轮播展示各 App 的账号密码（默认遮罩），
点开卡片进入钱包式详情页查看 / 复制明文。数据只存在本机，AES-256 加密落盘。

- 产物：
  - `build/密码卡包-V0.11.ipa`（iOS，未签名需自签；iOS 12.0+ / arm64）
  - `build/密码卡包-V0.11.apk`（Android，已签名直接装；Android 6.0+ / API 23）
- 包名：`com.cxk.password`（两端一致，可从 V0.5 及更早覆盖升级）
- 技术栈：原生壳（iOS=Objective-C+WKWebView，Android=Java+WebView）+ 共用 HTML/CSS/JS 界面 + 系统钥匙串加密存储
- 详细说明见 [交付说明.md](交付说明.md)

## 版本记录

### V0.11
1. 卡片/列表图标改用真实 App 图标（Simple Icons，39 个品牌 + 首字占位）
2. 卡片排版：左侧白色图标 + 名称 / 账号 / 密码三行，账号与密码带标签

### V0.10
1. 卡片阴影改用卡片主色，只向右下投射；列表模式去掉阴影改细边框
2. 更新页状态文案：「请及时更新！」/「已是最新版本无需更新~」

### V0.9
1. iOS 检查 403 修复：Release 内 `version.json` 备用通道
2. 卡片阴影改为轻投影（去掉 WebView 下的黑色矩形暗块）
3. 轮盘卡片放大到 132 高 / 宽度 −40px

### V0.8
1. 修复 Android 联网检查：补 `INTERNET` / `ACCESS_NETWORK_STATE` 权限
2. 更新页失败时显示具体原因

### V0.7
1. 轮盘模式改为「左轮转盘」：扇形叠放 + 上下滑动切换 + 选中卡浮起 + 页码点
2. 模式切换移到右上角按钮；删除卡片加弹窗确认
3. 分类 14 类、图标 56 个

### V0.6
1. 「版本更新」接入 **GitHub Releases**：填 `GITHUB_UPDATE_REPO = '用户名/仓库名'` 即可读取最新 release
2. 更新页展示远端 Release 说明（有新版本时出现），版本号兼容 `v0.6` / `0.6` / `0.6-beta`
3. 新增 `tools/publish_github_release.sh`，`gh` 一键发版（自动带上 IPA/APK）
4. 版本号 0.6（iOS 0.6/6，Android 0.6/6）

### V0.5
1. 联网检查新版本：原生 `http.get` 桥 + 6 小时节流 / 6 秒超时 / 失败静默
2. 更新页「上次检查」状态行
3. 「清空全部卡片」改为弹窗二次确认，防误删

### V0.4
1. 轮盘卡片缩小到 116pt + 三层投影；分类页分组标题配色标签
2. 「关于」新增版本更新入口与小红点

### V0.3
1. 卡片账号加「账号」标签；首页搜索（后移至最上方）
2. 使用手册新增版本日志；卡片首次缩小

### V0.2
1. 模板库改名 + 扩到 67 个模板；备注提示「填写你的小秘密」
2. 自定义 RGB 配色；使用手册独立成页

## 快速开始

```bash
# 只改界面
cp web/* build/out/Payload/PasswordWallet.app/web/
python tools/pack_ipa.py build/out/Payload/PasswordWallet.app build/密码卡包-V0.11.ipa   # iOS
wsl -d Ubuntu2204 -- bash /mnt/e/DATA/Pojia/PasswordWallet/build/build_apk.sh            # Android

# 改原生代码
wsl -d Ubuntu2204 -- bash /mnt/e/DATA/Pojia/PasswordWallet/build/build_ipa.sh
wsl -d Ubuntu2204 -- bash /mnt/e/DATA/Pojia/PasswordWallet/build/build_apk.sh
```

## 用 GitHub 做更新监控（已上线：checkak/passwordwallet）

```bash
# 1. 推源码
cd E:/DATA/Pojia/PasswordWallet
git init && git add . && git commit -m "密码卡包 V0.6"
git branch -M main
git remote add origin https://github.com/<你的用户名>/passwordwallet.git
git push -u origin main

# 2. 发 Release（自动带上 IPA / APK）
gh auth login
bash tools/publish_github_release.sh v0.6 "首个 GitHub 发布版本"

# 3. 改一行配置后重新出包
#    web/app.js: const GITHUB_UPDATE_REPO = '你的用户名/passwordwallet';
```

之后 App 启动会读 `releases/latest` 的 `tag_name` 与 `body`：远端版本更高就亮小红点并显示更新说明。
只读、无需 token；未登录调用限 60 次/小时，App 每天最多查 4 次。

也可以改用自建静态 JSON：把 `version.json` 传到任意 https 地址，然后把 `UPDATE_FEED_URL` 填成该地址。

```json
{"version":"0.6","notes":["本次更新了什么"],"url":"下载页地址"}
```

## 目录

| 路径 | 说明 |
|---|---|
| `native/` | iOS：`main.m`、`PWRootViewController.m`（WebView + JS 桥 + http.get）、`PWVaultStore.m`、`PWCompat.m`、`Info.plist` |
| `android/` | Android：`AndroidManifest.xml`、`java/com/cxk/password/*.java`、`res/` |
| `web/` | 双端共用界面：`index.html` / `style.css` / `app.js` |
| `version.json` | 联网更新源模板 |
| `assets/icons/` | iOS 图标 |
| `screenshots/` | 各界面截图 |
| `build/` | `build_ipa.sh`、`build_apk.sh`、`android/keystore.jks`、中间产物与最终包 |
| `tools/pack_ipa.py` | 只改前端时的 iOS 重打包脚本 |

## 功能清单

- 轮盘模式（3D 旋转 + 吸附 + 分层投影）/ 列表模式
- 首页搜索：App 名 / 账号 / 分类 / 备注
- 卡片：品牌渐变、图标、「账号」「密码」双标签、遮罩、收藏
- 详情页：密码点眼睛显形，账号/密码一键复制，60 秒后自动清空剪贴板
- 模板库 67 个主流 App；自定义卡片（16 位密码生成器、10 套配色 + 自定义 RGB）
- 分类（配色标签）/ 收藏 / 我的；使用手册（含版本日志）
- 版本更新：联网检查 + 小红点（可关闭，见上）
- 清空全部卡片：弹窗二次确认
- 6 位主密码锁屏、AES-256 加密存储、备份导出 / 导入
- 触感反馈；Android 物理返回键分级处理

## 本地预览（不装手机）

浏览器直接打开 `web/index.html`（自动降级 localStorage）。带参数可直达某界面：
`?preview=list|detail|editor|templates|me|category|fav|lock`
