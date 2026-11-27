#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本地仓库推到 GitHub（走 REST API，绕开 git 传输层的 TLS 问题）并发布 Release。

用法：
    GH_TOKEN=ghp_xxx python tools/publish_to_github.py --repo checkak/passwordwallet --tag v0.6 \
        --assets build/密码卡包-V0.6.apk build/PasswordWallet-V0.6.ipa \
        --notes "更新说明"

说明：
  · 用 Git Data API（blobs → tree → commit → ref），74 个文件只要 4 次 API 调用
  · GitHub 不允许匿名建库；本脚本假定仓库已存在（空库也可以）
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def token():
    t = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not t:
        sys.exit("缺少 GH_TOKEN 环境变量")
    return t.strip()


def call(url, method="GET", payload=None, raw=None, ctype="application/json"):
    data = raw
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "passwordwallet-publisher")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            return resp.status, (json.loads(body) if body and ctype == "application/json" else body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return e.code, body


def tracked_files():
    out = subprocess.check_output(["git", "-C", ROOT, "ls-files"], text=True)
    files = []
    for rel in out.splitlines():
        rel = rel.strip()
        if not rel:
            continue
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(full):
            continue
        size = os.path.getsize(full)
        if size > 40 * 1024 * 1024:
            print("  跳过超大文件:", rel, size)
            continue
        files.append((rel, full, size))
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="owner/name")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--tag", default="")
    ap.add_argument("--notes", default="")
    ap.add_argument("--assets", nargs="*", default=[])
    args = ap.parse_args()
    repo = args.repo

    # 0. 仓库是否可写
    code, info = call(f"{API}/repos/{repo}")
    if code != 200:
        sys.exit(f"读不到仓库 {repo}: HTTP {code} {info}")
    print("仓库:", info["full_name"], "| 默认分支:", info.get("default_branch"), "| 空库:", info.get("size") == 0)

    # 1. 空仓库需要先有一次提交，Git Data API 才能用（否则 409 Git Repository is empty）
    code, ref0 = call(f"{API}/repos/{repo}/git/ref/heads/{args.branch}")
    if code != 200:
        bootstrap = base64.b64encode(
            ("# 密码卡包 PasswordWallet\n\n本地加密的 iOS / Android 密码卡片 App。\n").encode("utf-8")
        ).decode("ascii")
        code, res = call(f"{API}/repos/{repo}/contents/README.md", "PUT", {
            "message": "初始化仓库", "content": bootstrap, "branch": args.branch})
        print("初始化仓库:", code)
        if code not in (200, 201):
            sys.exit(f"初始化失败: {code} {res}")

    # 2. 上传 blobs
    files = tracked_files()
    print("准备上传文件数:", len(files))
    entries = []
    for rel, full, size in files:
        with open(full, "rb") as fh:
            content = base64.b64encode(fh.read()).decode("ascii")
        mode = "100644"
        if rel.endswith(".sh") or (os.access(full, os.X_OK) and rel.endswith((".py",))):
            mode = "100755"
        code, blob = call(f"{API}/repos/{repo}/git/blobs", "POST",
                          {"content": content, "encoding": "base64"})
        if code not in (200, 201):
            sys.exit(f"blob 失败 {rel}: {code} {blob}")
        entries.append({"path": rel, "mode": mode, "type": "blob", "sha": blob["sha"]})
        print(f"  blob ok {rel} ({size} B)")

    # 3. tree / commit / ref
    code, tree = call(f"{API}/repos/{repo}/git/trees", "POST", {"tree": entries})
    if code not in (200, 201):
        sys.exit(f"tree 失败: {code} {tree}")

    parents = []
    code, ref = call(f"{API}/repos/{repo}/git/ref/heads/{args.branch}")
    if code == 200:
        parents = [ref["object"]["sha"]]
    elif code not in (404, 409):
        print("  读取分支失败:", code, ref)

    code, commit = call(f"{API}/repos/{repo}/git/commits", "POST", {
        "message": "密码卡包 V0.6 源码", "tree": tree["sha"], "parents": parents})
    if code not in (200, 201):
        sys.exit(f"commit 失败: {code} {commit}")

    if parents:
        code, upd = call(f"{API}/repos/{repo}/git/refs/heads/{args.branch}", "PATCH",
                         {"sha": commit["sha"], "force": True})
    else:
        code, upd = call(f"{API}/repos/{repo}/git/refs", "POST",
                         {"ref": f"refs/heads/{args.branch}", "sha": commit["sha"]})
    if code not in (200, 201):
        sys.exit(f"更新分支失败: {code} {upd}")
    print("已推送提交:", commit["sha"][:10], "→", args.branch)

    # 3. Release
    if args.tag:
        code, rel = call(f"{API}/repos/{repo}/releases", "POST", {
            "tag_name": args.tag,
            "target_commitish": commit["sha"],
            "name": "密码卡包 " + args.tag,
            "body": args.notes or "首个 GitHub 发布版本",
            "draft": False,
            "prerelease": False,
        })
        if code not in (200, 201):
            sys.exit(f"建 Release 失败: {code} {rel}")
        print("Release:", rel["html_url"])

        for path in args.assets:
            if not os.path.isfile(path):
                print("  跳过不存在的资产:", path)
                continue
            name = os.path.basename(path)
            url = f"{UPLOADS}/repos/{repo}/releases/{rel['id']}/assets?name={urllib.parse.quote(name)}"
            with open(path, "rb") as fh:
                code, res = call(url, "POST", raw=fh.read(), ctype="application/octet-stream")
            if code not in (200, 201):
                print(f"  资产上传失败 {name}: {code} {res}")
            else:
                print(f"  已上传 {name} ({res.get('size')} B)")

    # 4. 回读 /releases/latest，确认 App 会看到什么
    code, latest = call(f"{API}/repos/{repo}/releases/latest")
    if code == 200:
        print("latest:", latest["tag_name"], "|", latest["html_url"])
    else:
        print("latest 读取失败:", code)


if __name__ == "__main__":
    main()
