#!/usr/bin/env bash
# 在服务器上以 root 运行（由 deploy.sh 调用，也可手动：把解包后的目录放在 /tmp/musichere-pkg 再执行）。
# 做的事：装 Node 22 → 安装服务端依赖 → 首次部署时导入示例数据 → 注册 systemd 服务（监听 80 端口，
# 同时托管 web 页面和 /api）。可重复执行；已有的数据库和上传图片不会被覆盖。
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/opt/musichere
DATA_DIR=/var/lib/musichere
PORT="${PORT:-80}"
DEMO_LAT="${DEMO_LAT:-31.24}"
DEMO_LNG="${DEMO_LNG:-121.49}"
NODE_VERSION=v22.22.2
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"   # 国内服务器直连 npmjs 经常很慢

[ "$(id -u)" = 0 ] || { echo "请用 root 运行" >&2; exit 1; }
[ -d "$PKG_DIR/server" ] && [ -f "$PKG_DIR/web/index.html" ] || { echo "安装包不完整: $PKG_DIR" >&2; exit 1; }

node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }

echo "==> Node.js"
if node_ok; then
  echo "    已有 $(node -v)"
else
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "不支持的架构 $(uname -m)" >&2; exit 1 ;; esac
  FILE="node-$NODE_VERSION-linux-$ARCH.tar.xz"
  command -v xz >/dev/null || { (command -v apt-get >/dev/null && apt-get install -y xz-utils) || yum install -y xz || dnf install -y xz; }
  mkdir -p /usr/local/lib/nodejs
  # 先试国内镜像，失败再试官方
  curl -fL --retry 3 -o "/tmp/$FILE" "https://registry.npmmirror.com/-/binary/node/$NODE_VERSION/$FILE" \
    || curl -fL --retry 3 -o "/tmp/$FILE" "https://nodejs.org/dist/$NODE_VERSION/$FILE"
  tar -xJf "/tmp/$FILE" -C /usr/local/lib/nodejs
  for b in node npm npx; do ln -sf "/usr/local/lib/nodejs/node-$NODE_VERSION-linux-$ARCH/bin/$b" "/usr/local/bin/$b"; done
  rm -f "/tmp/$FILE"
  echo "    已安装 $(node -v)"
fi

echo "==> 安装应用到 $APP_DIR"
id musichere >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin musichere
mkdir -p "$APP_DIR" "$DATA_DIR/uploads"
rm -rf "$APP_DIR/server.new" "$APP_DIR/web.new"
cp -R "$PKG_DIR/server" "$APP_DIR/server.new"
cp -R "$PKG_DIR/web" "$APP_DIR/web.new"
( cd "$APP_DIR/server.new" && npm ci --omit=dev --registry="$NPM_REGISTRY" --no-audit --no-fund )
rm -rf "$APP_DIR/server" "$APP_DIR/web"
mv "$APP_DIR/server.new" "$APP_DIR/server"
mv "$APP_DIR/web.new" "$APP_DIR/web"

echo "==> 示例数据"
if [ ! -f "$DATA_DIR/musichere.db" ]; then
  ( cd "$APP_DIR/server" && DB_PATH="$DATA_DIR/musichere.db" UPLOAD_DIR="$DATA_DIR/uploads" NODE_NO_WARNINGS=1 \
      ./node_modules/.bin/tsx src/seed.ts --lat "$DEMO_LAT" --lng "$DEMO_LNG" )
else
  echo "    数据库已存在，跳过（保留现有数据）"
fi
chown -R musichere:musichere "$DATA_DIR"

echo "==> systemd 服务"
cat > /etc/systemd/system/musichere.service <<UNIT
[Unit]
Description=MusicHere demo (API + web)
After=network.target

[Service]
User=musichere
WorkingDirectory=$APP_DIR/server
Environment=NODE_ENV=production
Environment=NODE_NO_WARNINGS=1
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
Environment=DB_PATH=$DATA_DIR/musichere.db
Environment=UPLOAD_DIR=$DATA_DIR/uploads
Environment=WEB_DIR=$APP_DIR/web
ExecStart=$APP_DIR/server/node_modules/.bin/tsx src/index.ts
Restart=always
RestartSec=2
# 允许非 root 用户监听 80 端口
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable musichere >/dev/null 2>&1
systemctl restart musichere

echo "==> 防火墙"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow "$PORT"/tcp >/dev/null && echo "    ufw 已放行 $PORT"; fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$PORT"/tcp >/dev/null && firewall-cmd --reload >/dev/null && echo "    firewalld 已放行 $PORT"
fi

echo "==> 健康检查"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    OK=1; break
  fi
  sleep 1
done
if [ "${OK:-0}" != 1 ]; then
  echo "服务没有起来，最近日志：" >&2
  journalctl -u musichere -n 40 --no-pager >&2
  exit 1
fi
curl -fsS "http://127.0.0.1:$PORT/" | grep -q "<title" && echo "    API 与页面均正常"
IP="$(curl -fsS -m 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "✔ 部署完成： http://$IP$( [ "$PORT" = 80 ] || echo ":$PORT" )/"
echo "  如果从外网打不开：到云厂商控制台的【安全组】放行 TCP $PORT 入方向。"
echo "  日志： journalctl -u musichere -f      重启： systemctl restart musichere"
