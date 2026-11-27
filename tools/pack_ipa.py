#!/usr/bin/env python3
"""把已组装好的 .app 目录打包成 IPA（无需重新编译，用于只改前端页面后的快速迭代）。

用法：
    python pack_ipa.py build/out/Payload/PasswordWallet.app build/密码卡包-V0.1.ipa

只改 web/ 里的页面时：
    1) 把 PasswordWallet/web/* 覆盖到 build/out/Payload/PasswordWallet.app/web/
    2) 运行上面的命令重新打包
"""

import os
import sys
import zipfile


def add_tree(zf, root, arc_prefix):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            full = os.path.join(base, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            arc = f"{arc_prefix}/{rel}" if arc_prefix else rel
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            # 可执行文件必须保留 0755，否则安装后无法启动
            mode = 0o755 if os.access(full, os.X_OK) and not name.endswith((".png", ".plist", ".js", ".css", ".html")) else 0o644
            info.external_attr = (0o100000 | mode) << 16
            with open(full, "rb") as fh:
                zf.writestr(info, fh.read())


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    app_dir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(app_dir), "app.ipa")
    if not os.path.isdir(app_dir):
        print("不是目录:", app_dir)
        return 1
    app_name = os.path.basename(app_dir)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        add_tree(zf, app_dir, f"Payload/{app_name}")
    print("打包完成:", out, os.path.getsize(out), "bytes")
    with zipfile.ZipFile(out) as zf:
        bad = zf.testzip()
        print("完整性:", "OK" if bad is None else f"损坏 {bad}")
        print("条目数:", len(zf.namelist()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
