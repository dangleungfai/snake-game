#!/usr/bin/env bash
#
# Ubuntu 20.04+ / 24.04 一键部署：通过 apt 安装 Nginx、Git 等，拉取本仓库并配置站点。
# 用法（在服务器上）：
#   curl -fsSL https://raw.githubusercontent.com/dangleungfai/snake-game/main/scripts/deploy-ubuntu.sh -o deploy-ubuntu.sh
#   chmod +x deploy-ubuntu.sh
#   sudo ./deploy-ubuntu.sh
#
# 或克隆仓库后：
#   cd snake-game && sudo ./scripts/deploy-ubuntu.sh
#
set -euo pipefail

# ---------- 默认参数（可用环境变量或命令行覆盖）----------
REPO_URL="${REPO_URL:-https://github.com/dangleungfai/snake-game.git}"
WEB_ROOT="${WEB_ROOT:-/var/www/snake-game}"
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_SITE="${NGINX_SITE:-snake-game}"
WITH_UFW="${WITH_UFW:-0}"
WITH_SSL="${WITH_SSL:-0}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

usage() {
  cat <<'EOF'
一键部署 snake-game 到 Ubuntu（Nginx + 可选 UFW / HTTPS）

用法:
  sudo ./scripts/deploy-ubuntu.sh [选项]

参数说明：
  --repo URL          Git 仓库地址（默认官方仓库 HTTPS）
  --web-root PATH     站点根目录（默认 /var/www/snake-game）
  --server-name NAME  Nginx server_name（默认 _，任意 Host/IP 可访问）
  --with-ufw          安装并配置 UFW：放行 SSH、HTTP（若启用 SSL 则再放行 HTTPS）
  --with-ssl          安装 Certbot 并申请证书（需同时指定 --domain 与 --email）
  --domain FQDN       域名（与 DNS 指向本机公网 IP，供 --with-ssl）
  --email ADDR        Let's Encrypt 联系邮箱（供 --with-ssl）
  -h, --help          显示帮助

示例：
  sudo ./scripts/deploy-ubuntu.sh
  sudo ./scripts/deploy-ubuntu.sh --with-ufw
  sudo ./scripts/deploy-ubuntu.sh --with-ssl --domain game.example.com --email you@example.com
EOF
}

# ---------- 解析命令行 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --web-root)
      WEB_ROOT="$2"
      shift 2
      ;;
    --server-name)
      SERVER_NAME="$2"
      shift 2
      ;;
    --with-ufw)
      WITH_UFW=1
      shift
      ;;
    --with-ssl)
      WITH_SSL=1
      shift
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --email)
      EMAIL="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1 （使用 --help 查看说明）" >&2
      exit 1
      ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行，例如: sudo $0" >&2
  exit 1
fi

if [[ "$WITH_SSL" -eq 1 ]]; then
  if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
    echo "使用 --with-ssl 时必须同时提供 --domain 与 --email。" >&2
    exit 1
  fi
  SERVER_NAME="$DOMAIN"
fi

echo "==> 更新 apt 索引并安装依赖包：nginx、git、ca-certificates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx git ca-certificates

echo "==> 确保 Nginx 开机自启"
systemctl enable nginx
systemctl start nginx

install_or_update_site_files() {
  if [[ -d "${WEB_ROOT}/.git" ]]; then
    echo "==> 检测到已有 Git 仓库，执行 git pull"
    git -C "$WEB_ROOT" pull --ff-only
  elif [[ -f "${WEB_ROOT}/index.html" ]]; then
    echo "==> 目录已存在 index.html，跳过克隆。若需从远程覆盖，请删除 ${WEB_ROOT} 后重跑脚本。"
  else
    echo "==> 克隆仓库到 ${WEB_ROOT}"
    mkdir -p "$(dirname "$WEB_ROOT")"
    git clone --depth 1 "$REPO_URL" "$WEB_ROOT"
  fi
}

install_or_update_site_files

echo "==> 设置目录权限（www-data）"
chown -R www-data:www-data "$WEB_ROOT"
chmod -R u=rwX,g=rX,o=rX "$WEB_ROOT"

echo "==> 写入 Nginx 站点: /etc/nginx/sites-available/${NGINX_SITE}"
cat >"/etc/nginx/sites-available/${NGINX_SITE}" <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    root ${WEB_ROOT};
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
NGX

echo "==> 启用站点并移除默认站点（若存在）"
ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
rm -f /etc/nginx/sites-enabled/default

echo "==> 校验并重载 Nginx"
nginx -t
systemctl reload nginx

if [[ "$WITH_UFW" -eq 1 ]]; then
  echo "==> 安装并配置 UFW（放行 SSH、HTTP）"
  apt-get install -y ufw
  ufw allow OpenSSH
  ufw allow 'Nginx HTTP'
  if [[ "$WITH_SSL" -eq 1 ]]; then
    ufw allow 'Nginx HTTPS' || true
  fi
  ufw --force enable || true
  ufw status verbose || true
fi

if [[ "$WITH_SSL" -eq 1 ]]; then
  echo "==> 安装 Certbot 并申请 HTTPS 证书"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx \
    -d "$DOMAIN" \
    -m "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --redirect
fi

echo ""
echo "部署完成。请用浏览器访问："
if [[ "$WITH_SSL" -eq 1 ]]; then
  echo "  https://${DOMAIN}/"
else
  echo "  http://<服务器公网IP>/  （若 server_name 为 _，用 IP 即可）"
fi
echo "站点根目录: ${WEB_ROOT}"
