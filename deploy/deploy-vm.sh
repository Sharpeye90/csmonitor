#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${APP_NAME:-cs2-parser}"
APP_USER="${APP_USER:-$USER}"
APP_DIR="${APP_DIR:-/var/www/cs2-parser}"
PORT="${PORT:-3000}"
DOMAIN="${DOMAIN:-_}"
NODE_MAJOR="${NODE_MAJOR:-22}"
INSTALL_PACKAGES="${INSTALL_PACKAGES:-1}"
SETUP_NGINX="${SETUP_NGINX:-1}"
SETUP_SYSTEMD="${SETUP_SYSTEMD:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_PATH="/etc/systemd/system/${APP_NAME}.service"
NGINX_PATH="/etc/nginx/sites-available/${APP_NAME}"
NGINX_ENABLED_PATH="/etc/nginx/sites-enabled/${APP_NAME}"

log() {
  printf '\n[%s] %s\n' "${APP_NAME}" "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Команда '$1' не найдена" >&2
    exit 1
  fi
}

ensure_env_file() {
  if [[ ! -f "${APP_DIR}/.env" ]]; then
    echo "Файл ${APP_DIR}/.env не найден. Создайте его на основе .env.example и укажите DATABASE_URL." >&2
    exit 1
  fi
}

install_system_packages() {
  if [[ "${INSTALL_PACKAGES}" != "1" ]]; then
    return
  fi

  log "Устанавливаю системные зависимости"
  sudo apt update
  sudo apt install -y nginx tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng git curl ca-certificates rsync

  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v${NODE_MAJOR}\."; then
    log "Устанавливаю Node.js ${NODE_MAJOR}"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt install -y nodejs
  fi
}

prepare_app_dir() {
  log "Готовлю директорию приложения"
  sudo mkdir -p "${APP_DIR}"
  sudo chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

  if [[ "${REPO_ROOT}" != "${APP_DIR}" ]]; then
    require_command rsync
    rsync -a --delete \
      --exclude ".git" \
      --exclude "node_modules" \
      --exclude ".next" \
      "${REPO_ROOT}/" "${APP_DIR}/"
  fi
}

install_node_dependencies() {
  log "Устанавливаю npm-зависимости"
  cd "${APP_DIR}"
  npm install
}

run_migrations_and_build() {
  log "Применяю Prisma migration"
  cd "${APP_DIR}"
  npm run prisma:migrate

  log "Собираю приложение"
  npm run build
}

render_systemd_service() {
  log "Настраиваю systemd"
  sudo tee "${SERVICE_PATH}" >/dev/null <<EOF
[Unit]
Description=CS2 Match Parser
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port ${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "${APP_NAME}"
  sudo systemctl restart "${APP_NAME}"
}

render_nginx_config() {
  if [[ "${SETUP_NGINX}" != "1" ]]; then
    return
  fi

  log "Настраиваю nginx"
  sudo tee "${NGINX_PATH}" >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

  if [[ ! -L "${NGINX_ENABLED_PATH}" ]]; then
    sudo ln -sf "${NGINX_PATH}" "${NGINX_ENABLED_PATH}"
  fi

  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    sudo rm -f /etc/nginx/sites-enabled/default
  fi

  sudo nginx -t
  sudo systemctl enable nginx
  sudo systemctl reload nginx
}

print_summary() {
  log "Деплой завершен"
  echo "Приложение: ${APP_NAME}"
  echo "Каталог: ${APP_DIR}"
  echo "Порт: ${PORT}"
  echo "Домен/IP: ${DOMAIN}"
  echo
  echo "Проверки:"
  echo "  sudo systemctl status ${APP_NAME}"
  echo "  sudo journalctl -u ${APP_NAME} -n 100 --no-pager"
  echo "  curl -I http://127.0.0.1:${PORT}"
}

main() {
  require_command sudo
  require_command bash

  install_system_packages
  prepare_app_dir
  ensure_env_file
  install_node_dependencies
  run_migrations_and_build

  if [[ "${SETUP_SYSTEMD}" == "1" ]]; then
    render_systemd_service
  fi

  render_nginx_config
  print_summary
}

main "$@"
