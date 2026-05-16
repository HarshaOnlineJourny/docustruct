#!/usr/bin/env bash
# DocuStruct one-shot setup script for a fresh Ubuntu 22.04+ VPS.
# Run this AS ROOT or with sudo on the server. It:
#   - installs Node 20, nginx, certbot, git, build tools
#   - creates a docustruct system user
#   - clones the repo into /opt/docustruct (or pulls if it already exists)
#   - installs deps for server + client
#   - builds the client
#   - installs the systemd unit + nginx site
#
# After this finishes you still need to:
#   1. edit /opt/docustruct/.env (set DOCUSTRUCT_ENC_KEY)
#   2. point DNS at this server (A record for docustruct.theproapps.com)
#   3. set up the htpasswd file (see DEPLOY.md)
#   4. run certbot to issue the TLS cert
#
# Usage:
#   curl -fsSL <raw URL of this script> | sudo bash -s -- <git-repo-url>
#   sudo bash setup.sh git@github.com:you/docustruct.git
set -euo pipefail

REPO_URL="${1:-}"
INSTALL_DIR="/opt/docustruct"
SERVICE_USER="docustruct"
DOMAIN="${DOMAIN:-docustruct.theproapps.com}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2; exit 1
fi
if [[ -z "$REPO_URL" && ! -d "$INSTALL_DIR/.git" ]]; then
  echo "Usage: $0 <git-repo-url>" >&2; exit 1
fi

echo "==> Installing system packages…"
apt-get update -y
apt-get install -y curl ca-certificates gnupg build-essential python3 git nginx apache2-utils
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "==> Creating service user '$SERVICE_USER'…"
  adduser --system --group --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Fetching code into $INSTALL_DIR…"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --rebase
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "==> Installing server dependencies…"
sudo -u "$SERVICE_USER" bash -lc "cd $INSTALL_DIR/server && npm install --omit=dev"

echo "==> Installing + building the client…"
sudo -u "$SERVICE_USER" bash -lc "cd $INSTALL_DIR/client && npm install && npm run build"

echo "==> Seeding .env if missing…"
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  sed -i "s|replace-me-with-a-long-random-string|$KEY|" "$INSTALL_DIR/.env"
  echo "    Generated DOCUSTRUCT_ENC_KEY in $INSTALL_DIR/.env"
fi
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
chmod 640 "$INSTALL_DIR/.env"

echo "==> Installing systemd service…"
cp "$INSTALL_DIR/deploy/docustruct.service" /etc/systemd/system/docustruct.service
systemctl daemon-reload
systemctl enable docustruct
systemctl restart docustruct

echo "==> Installing nginx site…"
sed "s/docustruct.theproapps.com/$DOMAIN/g" "$INSTALL_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/docustruct
ln -sf /etc/nginx/sites-available/docustruct /etc/nginx/sites-enabled/docustruct
# Disable the default site so we own port 80.
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Done."
echo ""
echo "Next steps:"
echo "  1. Add an A record at theproapps.com -> docustruct -> this server's IP."
echo "  2. Create the htpasswd gate:"
echo "       sudo htpasswd -c /etc/nginx/.htpasswd-docustruct alice"
echo "  3. Provision TLS:"
echo "       sudo certbot --nginx -d $DOMAIN"
echo "  4. Visit https://$DOMAIN/"
