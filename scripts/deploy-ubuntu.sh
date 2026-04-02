#!/usr/bin/env bash
#
# Ubuntu 24.04 一键部署：apt 安装 Nginx、Git、证书、curl、UFW，拉取仓库并配置站点。
# 结束后仅在终端输出「访问链接」一行（HTTPS 模式输出 https://域名/）。
#
#   curl -fsSL https://raw.githubusercontent.com/dangleungfai/snake-game/main/scripts/deploy-ubuntu.sh -o deploy-ubuntu.sh
#   chmod +x deploy-ubuntu.sh && sudo ./deploy-ubuntu.sh
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/dangleungfai/snake-game.git}"
WEB_ROOT="${WEB_ROOT:-/var/www/snake-game}"
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_SITE="${NGINX_SITE:-snake-game}"
WITH_SSL="${WITH_SSL:-0}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
SKIP_UFW="${SKIP_UFW:-0}"

usage() {
  cat <<'EOF'
Ubuntu 24.04 一键部署 snake-game（默认安装 Nginx、Git、CA 证书、curl、UFW 并放行端口）

用法:
  sudo ./deploy-ubuntu.sh [选项]

选项:
  --repo URL           Git 仓库（默认官方 HTTPS）
  --web-root PATH      站点目录（默认 /var/www/snake-game）
  --server-name NAME   Nginx server_name（默认 _，适合用 IP 访问）
  --skip-ufw           不安装/不启用 UFW（仅用云安全组时可加）
  --with-ssl           启用 HTTPS（须同时 --domain 与 --email）
  --domain FQDN        域名（须解析到本机公网 IP）
  --email ADDR         Let's Encrypt 邮箱
  -h, --help           帮助

示例:
  sudo ./deploy-ubuntu.sh
  sudo ./deploy-ubuntu.sh --skip-ufw
  sudo ./deploy-ubuntu.sh --with-ssl --domain game.example.com --email you@example.com
EOF
}

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
    --skip-ufw)
      SKIP_UFW=1
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
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "请使用 sudo 运行" >&2
  exit 1
fi

if [[ "$WITH_SSL" -eq 1 ]]; then
  if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
    echo "--with-ssl 需要同时指定 --domain 与 --email" >&2
    exit 1
  fi
  SERVER_NAME="$DOMAIN"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx git ca-certificates curl

if [[ "$SKIP_UFW" -eq 0 ]]; then
  apt-get install -y ufw
  ufw allow OpenSSH
  ufw allow 'Nginx HTTP'
  [[ "$WITH_SSL" -eq 1 ]] && ufw allow 'Nginx HTTPS'
  ufw --force enable
fi

systemctl enable nginx
systemctl start nginx

if [[ -d "${WEB_ROOT}/.git" ]]; then
  git -C "$WEB_ROOT" pull --ff-only
elif [[ -f "${WEB_ROOT}/index.html" ]]; then
  :
else
  mkdir -p "$(dirname "$WEB_ROOT")"
  git clone --depth 1 "$REPO_URL" "$WEB_ROOT"
fi

chown -R www-data:www-data "$WEB_ROOT"
chmod -R u=rwX,g=rX,o=rX "$WEB_ROOT"

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

ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [[ "$WITH_SSL" -eq 1 ]]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect
fi

# ---------- 仅输出访问链接 ----------
if [[ "$WITH_SSL" -eq 1 ]]; then
  printf '访问链接: https://%s/\n' "$DOMAIN"
else
  PUBLIC_IP=""
  for url in https://api.ipify.org https://ifconfig.me/ip; do
    PUBLIC_IP=$(curl -fsSL --max-time 6 "$url" 2>/dev/null | tr -d '[:space:]' || true)
    [[ -n "$PUBLIC_IP" ]] && break
  done
  if [[ -z "$PUBLIC_IP" ]]; then
    PUBLIC_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
  fi
  if [[ -z "$PUBLIC_IP" ]]; then
    PUBLIC_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "你的服务器公网IP")
  fi
  printf '访问链接: http://%s/\n' "$PUBLIC_IP"
fi
