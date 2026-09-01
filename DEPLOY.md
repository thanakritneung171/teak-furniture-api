# Deploy — ขึ้น VPS

ระบบมี 2 ส่วนที่ deploy คนละแบบ:

- **API (`teak-furniture-api`)** — รันเป็น Node service บน VPS (หลัง nginx + TLS) ต่อ PostgreSQL
- **แอปมือถือ (`teak-furniture-app`)** — build เป็น APK/AAB แล้วชี้มาที่ URL ของ API บน VPS
  (แอป **ไม่ได้** ติดตั้งบน VPS — VPS โฮสต์แค่ API)

VPS ตัวเดิม (ที่รัน emptychair) มี Node + PostgreSQL + nginx อยู่แล้ว — teak API รันคู่ขนานได้
โดยใช้ **DB ใหม่ + port ใหม่ (:4000) + nginx server block ใหม่** ไม่กระทบของเดิม

> คำสั่งทั้งหมดรันบน VPS เอง (ssh เข้าไป) — ผมช่วยรันให้ไม่ได้ (นโยบายห้ามกรอกรหัส login แทน)

---

## 1. เอาโค้ดขึ้น VPS

repo เป็น private — เลือกวิธีใดวิธีหนึ่ง:

**ก) git clone ด้วย deploy key** (แนะนำ — อัปเดตง่าย)
```bash
# บน VPS: สร้าง key แล้วเอา public key ไปใส่ที่ GitHub repo → Settings → Deploy keys
ssh-keygen -t ed25519 -f ~/.ssh/teak_deploy -N ""
cat ~/.ssh/teak_deploy.pub      # เพิ่มใน Deploy keys ของ repo
# ตั้ง ssh ให้ใช้ key นี้กับ github แล้ว:
sudo mkdir -p /opt && cd /opt
GIT_SSH_COMMAND="ssh -i ~/.ssh/teak_deploy" git clone git@github.com:thanakritneung171/teak-furniture-api.git
```

**ข) หรือใช้ Personal Access Token (PAT)**
```bash
cd /opt && git clone https://<PAT>@github.com/thanakritneung171/teak-furniture-api.git
```

## 2. PostgreSQL — สร้าง DB + role เฉพาะ (ไม่ใช้ superuser ในแอป)

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE teak_production;
CREATE ROLE teak_app LOGIN PASSWORD 'CHANGE_ME_STRONG';
GRANT ALL PRIVILEGES ON DATABASE teak_production TO teak_app;
\c teak_production
GRANT ALL ON SCHEMA public TO teak_app;
SQL
```

## 3. ตั้ง env (production)

`/opt/teak-furniture-api/.env` (อย่า commit):
```
DATABASE_URL="postgresql://teak_app:CHANGE_ME_STRONG@127.0.0.1:5432/teak_production?schema=public"
JWT_SECRET="<สุ่มยาว ๆ เช่น openssl rand -hex 32>"
JWT_EXPIRES_IN="7d"
PORT=4000
```

## 4. ติดตั้ง + migrate + build

```bash
cd /opt/teak-furniture-api
npm ci
npx prisma migrate deploy      # ใช้ migrate deploy (prod) — ไม่รัน seed อัตโนมัติ
npm run build
```

**สร้าง admin คนแรก** (seed จะ **ลบข้อมูลทั้งหมด** — รันได้ครั้งเดียวตอน DB ว่างเท่านั้น เพื่อ demo):
```bash
npm run seed          # เฉพาะตอนเริ่มต้น/อยากได้ข้อมูลตัวอย่าง — ห้ามรันซ้ำบน prod ที่มีข้อมูลจริง
```
หรือถ้าไม่อยากได้ demo data ให้เพิ่ม admin เองด้วย SQL (hash PIN ด้วย bcrypt) แล้วค่อยเพิ่มพนักงานผ่านแอป

## 5. รันเป็น service (systemd)

`/etc/systemd/system/teak-api.service`:
```ini
[Unit]
Description=Teak Production API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/teak-furniture-api
EnvironmentFile=/opt/teak-furniture-api/.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teak-api
sudo systemctl status teak-api        # เช็คว่าขึ้น :4000
```
> โฟลเดอร์ `uploads/` ต้องเขียนได้โดย user ที่รัน service (`chown -R www-data /opt/teak-furniture-api/uploads`)

## 6. nginx reverse proxy + TLS

`/etc/nginx/sites-available/teak-api` (แก้ `api.example.com` เป็นโดเมนจริง):
```nginx
server {
  server_name api.example.com;
  client_max_body_size 15m;     # เผื่ออัปโหลดรูป
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/teak-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.example.com     # ออก TLS ให้อัตโนมัติ
```
ได้ API ที่ `https://api.example.com/api` · Swagger `https://api.example.com/docs`

> ถ้ายังไม่มีโดเมน: ใช้ `http://202.183.141.213:4000/api` ชั่วคราวได้ (เปิด firewall port 4000)
> แต่ควรมี TLS ก่อนใช้จริง เพราะมี JWT/รูป

## 7. แอปมือถือ — ชี้มาที่ VPS แล้ว build APK

แก้ `teak-furniture-app/src/api/client.ts`:
```ts
export const API_ORIGIN = 'https://api.example.com';   // แทน 10.0.2.2/localhost
```
แล้ว build (บนเครื่องที่มี Android Studio/SDK):
```bash
cd teak-furniture-app/android
./gradlew assembleRelease        # ได้ app/build/outputs/apk/release/app-release.apk
```
แจกไฟล์ APK ให้พนักงานติดตั้ง (หรือขึ้น Play Store / internal testing)
> release build ต้องมี signing keystore (ดู React Native docs — Signed APK)

## อัปเดตรอบถัดไป

```bash
cd /opt/teak-furniture-api && git pull
npm ci && npx prisma migrate deploy && npm run build
sudo systemctl restart teak-api
```
ฝั่งแอป: build APK ใหม่แล้วแจกใหม่ (หรือใช้ CodePush/OTA ในอนาคต)

## หมายเหตุ

- `uploads/` เก็บบน disk ของ VPS — สำรอง/ย้ายไป object storage (S3/R2) เมื่อโตขึ้น (ดู ROADMAP)
- CORS ตอนนี้เปิดหมด (`enableCors()`) — จำกัด origin เฉพาะโดเมนแอป/admin เมื่อ prod
- สำรอง DB: `pg_dump teak_production` เป็นงวด ๆ
