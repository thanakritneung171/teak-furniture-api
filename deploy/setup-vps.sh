#!/usr/bin/env bash
# One-shot deploy ของ Teak Production บน VPS (Ubuntu/Debian) — ทำทั้ง API + PWA (เว็บ)
#
# วิธีใช้ — ssh เข้า VPS เองก่อน (คุณเป็นคนกรอกรหัส) แล้วรัน:
#   sudo bash /opt/teak-furniture-api/deploy/setup-vps.sh \
#        --api-domain=api.example.com --app-domain=app.example.com
#
# ต้อง clone ทั้ง 2 repo ไว้ก่อน (ดู DEPLOY.md §1 — แนะนำ deploy key):
#   /opt/teak-furniture-api   (repo นี้)
#   /opt/teak-furniture-app   (แอป/PWA)
#
# flags (ทั้งหมดไม่บังคับ — เว้นไว้ = ใช้ค่า default / ข้าม TLS):
#   --api-domain=   โดเมน API (เว้นว่าง = ใช้ IP:PORT ไม่ตั้ง nginx/TLS ให้ API)
#   --app-domain=   โดเมน PWA (เว้นว่าง = build dist-web ไว้เฉย ๆ ไม่ตั้ง nginx/TLS)
#   --db-password=  รหัส DB (เว้นว่าง = สุ่ม)
#   --jwt-secret=   JWT secret (เว้นว่าง = สุ่ม)
#   --port=         พอร์ต API (default 4000)
#   --api-dir=      โฟลเดอร์ repo API (default /opt/teak-furniture-api)
#   --app-dir=      โฟลเดอร์ repo แอป (default /opt/teak-furniture-app)
#   --skip-pwa      ทำเฉพาะ API ไม่แตะ PWA
set -euo pipefail

# ---- ค่าเริ่มต้น (override ได้ทั้งผ่าน env และ flag ด้านล่าง) ----
APP_DIR="${APP_DIR:-/opt/teak-furniture-api}"
APP_DIR_WEB="${APP_DIR_WEB:-/opt/teak-furniture-app}"
PORT="${PORT:-4000}"
DB_NAME="teak_production"
DB_USER="teak_app"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
API_DOMAIN="${API_DOMAIN:-${DOMAIN:-}}"   # โดเมน API ; เว้นว่าง = IP:PORT
APP_DOMAIN="${APP_DOMAIN:-}"              # โดเมน PWA ; เว้นว่าง = ไม่ตั้ง nginx ให้เว็บ
RUN_USER="${RUN_USER:-www-data}"
SKIP_PWA=0

# ---- parse flags (override env) ----
for arg in "$@"; do
  case "$arg" in
    --api-domain=*)  API_DOMAIN="${arg#*=}" ;;
    --app-domain=*)  APP_DOMAIN="${arg#*=}" ;;
    --db-password=*) DB_PASSWORD="${arg#*=}" ;;
    --jwt-secret=*)  JWT_SECRET="${arg#*=}" ;;
    --port=*)        PORT="${arg#*=}" ;;
    --api-dir=*)     APP_DIR="${arg#*=}" ;;
    --app-dir=*)     APP_DIR_WEB="${arg#*=}" ;;
    --skip-pwa)      SKIP_PWA=1 ;;
    *) echo "!! ไม่รู้จัก flag: $arg" ; exit 1 ;;
  esac
done

# origin ของ API ที่ฝั่งเว็บจะเรียก (สำหรับ build PWA)
if [ -n "$API_DOMAIN" ]; then
  WEB_API_ORIGIN="https://${API_DOMAIN}"
else
  SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  WEB_API_ORIGIN="http://${SERVER_IP}:${PORT}"
fi

echo "==> API dir : $APP_DIR"
echo "==> APP dir : $APP_DIR_WEB"
echo "==> API url : ${API_DOMAIN:+https://$API_DOMAIN}${API_DOMAIN:-http://<IP>:$PORT}"
echo "==> PWA url : ${APP_DOMAIN:+https://$APP_DOMAIN}${APP_DOMAIN:-'(build only, no nginx)'}"
echo "==> เว็บจะเรียก API ที่: $WEB_API_ORIGIN"
cd "$APP_DIR"

# =====================  API  =====================
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

if [ -n "$API_DOMAIN" ]; then
  echo "==> 5) nginx + TLS สำหรับ API ($API_DOMAIN)"
  cat > /etc/nginx/sites-available/teak-api <<NGINX
server {
  server_name ${API_DOMAIN};
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
    certbot --nginx -d "$API_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || \
      echo "   (certbot ไม่ผ่าน — รัน 'certbot --nginx -d $API_DOMAIN' เองภายหลัง)"
  else
    echo "   ยังไม่มี certbot — ติดตั้ง: apt install certbot python3-certbot-nginx"
  fi
else
  echo "==> ข้าม nginx ให้ API (ไม่ได้ตั้ง --api-domain) — API ที่ http://<IP>:${PORT}/api (เปิด firewall port ${PORT} เอง)"
fi

# =====================  PWA (เว็บ)  =====================
if [ "$SKIP_PWA" = "1" ]; then
  echo "==> ข้าม PWA (--skip-pwa)"
elif [ ! -d "$APP_DIR_WEB" ]; then
  echo "==> ข้าม PWA — ไม่พบโฟลเดอร์ $APP_DIR_WEB"
  echo "    clone ก่อน: git clone <teak-furniture-app> $APP_DIR_WEB แล้วรันสคริปต์นี้ใหม่"
else
  echo "==> 6) build PWA (ชี้ API ที่ $WEB_API_ORIGIN)"
  cd "$APP_DIR_WEB"
  npm ci
  TEAK_API_ORIGIN="$WEB_API_ORIGIN" npm run build:web
  echo "   ได้ไฟล์ static ที่ $APP_DIR_WEB/dist-web"

  if [ -n "$APP_DOMAIN" ]; then
    echo "==> 7) nginx + TLS สำหรับ PWA ($APP_DOMAIN)"
    cat > /etc/nginx/sites-available/teak-app <<NGINX
server {
  server_name ${APP_DOMAIN};
  root ${APP_DIR_WEB}/dist-web;
  index index.html;
  # service worker ห้าม cache นาน (จะได้เห็นเวอร์ชันใหม่ทันที)
  location = /service-worker.js { add_header Cache-Control "no-cache"; try_files \$uri =404; }
  location / { try_files \$uri /index.html; }   # SPA fallback
}
NGINX
    ln -sf /etc/nginx/sites-available/teak-app /etc/nginx/sites-enabled/teak-app
    nginx -t && systemctl reload nginx
    if command -v certbot >/dev/null 2>&1; then
      certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || \
        echo "   (certbot ไม่ผ่าน — รัน 'certbot --nginx -d $APP_DOMAIN' เองภายหลัง)"
      echo "   ⚠ PWA/ออฟไลน์ ใช้ได้เฉพาะบน HTTPS — ตรวจว่า certbot ออก TLS สำเร็จ"
    else
      echo "   ยังไม่มี certbot — ติดตั้ง: apt install certbot python3-certbot-nginx (PWA ต้องมี HTTPS)"
    fi
  else
    echo "==> ข้าม nginx ให้ PWA (ไม่ได้ตั้ง --app-domain) — เสิร์ฟ $APP_DIR_WEB/dist-web เองภายหลัง"
  fi
  cd "$APP_DIR"
fi

# =====================  สรุป  =====================
echo ""
echo "======================================================"
echo " API : ${API_DOMAIN:+https://$API_DOMAIN/api}${API_DOMAIN:-http://<IP>:$PORT/api}"
[ -n "$API_DOMAIN" ] && echo " Docs: https://${API_DOMAIN}/docs"
if [ "$SKIP_PWA" != "1" ] && [ -d "$APP_DIR_WEB" ]; then
  echo " PWA : ${APP_DOMAIN:+https://$APP_DOMAIN}${APP_DOMAIN:-$APP_DIR_WEB/dist-web (ยังไม่ตั้ง nginx)}"
fi
echo " ----"
echo " DB_USER=${DB_USER}"
echo " DB_PASSWORD=${DB_PASSWORD}"
echo " JWT_SECRET=${JWT_SECRET}"
echo " (เก็บค่าเหล่านี้ไว้ — อยู่ใน ${APP_DIR}/.env ด้วย)"
echo "======================================================"
echo " อัปเดตรอบถัดไป: git pull ทั้ง 2 repo แล้วรันสคริปต์นี้ซ้ำ (idempotent)"
