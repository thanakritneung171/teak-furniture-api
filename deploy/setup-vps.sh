#!/usr/bin/env bash
# One-shot deploy ของ teak-furniture-api บน VPS (Ubuntu/Debian)
# วิธีใช้ — ssh เข้า VPS เองก่อน แล้ว:
#   sudo bash deploy/setup-vps.sh
# ตั้งค่าได้ผ่าน env (ไม่บังคับ): DOMAIN, DB_PASSWORD, JWT_SECRET, PORT, APP_DIR
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/teak-furniture-api}"
PORT="${PORT:-4000}"
DB_NAME="teak_production"
DB_USER="teak_app"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
DOMAIN="${DOMAIN:-}"     # เช่น api.example.com ; เว้นว่าง = ใช้ IP:PORT (ไม่ตั้ง nginx/TLS)
RUN_USER="${RUN_USER:-www-data}"

echo "==> ใช้โฟลเดอร์: $APP_DIR"
cd "$APP_DIR"

echo "==> 1) สร้าง DB + role (ถ้ายังไม่มี)"
sudo -u postgres psql <<SQL
SELECT 'CREATE DATABASE ${DB_NAME}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${DB_NAME}')\gexec
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}';
  END IF;
END \$\$;
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

echo "==> 2) เขียน .env"
cat > "$APP_DIR/.env" <<ENV
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}?schema=public"
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="7d"
PORT=${PORT}
ENV
chmod 600 "$APP_DIR/.env"

echo "==> 3) ติดตั้ง + migrate + build"
npm ci
npx prisma migrate deploy
npm run build
mkdir -p "$APP_DIR/uploads" && chown -R "$RUN_USER" "$APP_DIR/uploads"

# seed อัตโนมัติ "เฉพาะตอน DB ว่าง" (สร้าง admin/พนักงานตัวอย่าง + PIN)
if [ "$(sudo -u postgres psql -tAc "SELECT count(*) FROM \"User\"" "${DB_NAME}" 2>/dev/null || echo 0)" = "0" ]; then
  echo "   DB ว่าง → รัน seed (PIN 100000 admin ... 100006)"
  npm run seed || true
else
  echo "   DB มีข้อมูลแล้ว → ข้าม seed (กันข้อมูลหาย)"
fi

echo "==> 4) systemd service"
cat > /etc/systemd/system/teak-api.service <<UNIT
[Unit]
Description=Teak Production API
After=network.target postgresql.service

[Service]
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
User=${RUN_USER}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now teak-api
systemctl restart teak-api
sleep 2
systemctl --no-pager --full status teak-api | head -n 8 || true

if [ -n "$DOMAIN" ]; then
  echo "==> 5) nginx + TLS สำหรับ $DOMAIN"
  cat > /etc/nginx/sites-available/teak-api <<NGINX
server {
  server_name ${DOMAIN};
  client_max_body_size 15m;
  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX
  ln -sf /etc/nginx/sites-available/teak-api /etc/nginx/sites-enabled/teak-api
  nginx -t && systemctl reload nginx
  if command -v certbot >/dev/null 2>&1; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || \
      echo "   (certbot ไม่ผ่าน — รัน 'certbot --nginx -d $DOMAIN' เองภายหลัง)"
  else
    echo "   ยังไม่มี certbot — ติดตั้ง: apt install certbot python3-certbot-nginx"
  fi
  echo ""
  echo "เสร็จ → API: https://${DOMAIN}/api   ·   Swagger: https://${DOMAIN}/docs"
else
  echo "==> ข้าม nginx (ไม่ได้ตั้ง DOMAIN) — API ที่ http://<IP>:${PORT}/api (เปิด firewall port ${PORT} เอง)"
fi

echo ""
echo "======================================================"
echo " DB_USER=${DB_USER}"
echo " DB_PASSWORD=${DB_PASSWORD}"
echo " JWT_SECRET=${JWT_SECRET}"
echo " (บันทึกค่าเหล่านี้ไว้ — เก็บอยู่ใน ${APP_DIR}/.env ด้วย)"
echo "======================================================"
