#!/usr/bin/env bash
# 一键部署演示站：在【你的电脑】上运行，构建 web 版 → 打包 → 上传 → 在服务器上安装并启动。
#
#   ./deploy/deploy.sh root@<服务器IP>
#
# 前置：本机有 node(>=22) npm ssh scp tar；能 ssh 到服务器（强烈建议先 ssh-copy-id 配置密钥，
# 不要把密码写进脚本或命令行）。可重复运行用来升级，数据库和用户上传的图片会保留。
set -euo pipefail

TARGET="${1:?用法: $0 user@host   例如 $0 root@<服务器IP>}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
DEMO_LOCATION="${DEMO_LOCATION:-31.24,121.49}"   # 示例数据所在坐标（和 seed 一致）

cd "$(dirname "$0")/.."
for c in node npm ssh scp tar; do command -v "$c" >/dev/null || { echo "缺少命令: $c" >&2; exit 1; }; done

echo "==> 构建 web 版（同源访问 API，开启“使用示例位置”）"
(
  cd app
  npm ci
  # 不设置 EXPO_PUBLIC_API_URL：线上 web 版会自动使用页面自身的 origin
  env -u EXPO_PUBLIC_API_URL EXPO_PUBLIC_DEMO_LOCATION="$DEMO_LOCATION" CI=1 npx expo export --platform web
)

echo "==> 打包"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/server" "$STAGE/web"
tar -C server --exclude=node_modules --exclude='*.db' --exclude='*.db-*' --exclude=uploads --exclude=test \
  -cf - src seed-images package.json package-lock.json tsconfig.json | tar -C "$STAGE/server" -xf -
cp -R app/dist/. "$STAGE/web/"
cp deploy/remote-setup.sh "$STAGE/remote-setup.sh"
PKG="$(mktemp -u).tgz"
tar -C "$STAGE" -czf "$PKG" .
echo "    $(du -h "$PKG" | cut -f1)"

echo "==> 上传到 $TARGET"
scp "${SSH_OPTS[@]}" "$PKG" "$TARGET:/tmp/musichere-demo.tgz"
rm -f "$PKG"

echo "==> 在服务器上安装并启动"
ssh "${SSH_OPTS[@]}" "$TARGET" 'set -e; rm -rf /tmp/musichere-pkg && mkdir /tmp/musichere-pkg && tar -xzf /tmp/musichere-demo.tgz -C /tmp/musichere-pkg && bash /tmp/musichere-pkg/remote-setup.sh'
