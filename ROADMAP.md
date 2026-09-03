# Teak Production — Roadmap / แผนงานที่เหลือ

แผนงานส่วนที่ยังไม่ทำ ของระบบผลิตเฟอร์นิเจอร์ไม้สัก (repo กลาง = `teak-furniture-api`,
แอปมือถือ = `teak-furniture-app`). เอกสารนี้ครอบคลุมทั้งสอง repo.

## สถานะปัจจุบัน (เสร็จแล้ว)

- **Phase 1 (MVP):** DB ใหม่ (ไม่อิง Trello) · API NestJS (auth, tasks/my/board/detail,
  timer, complete-stage, history) · แอปมือถือ (Login, งานของฉัน, งาน, Task Detail+timer,
  History, Board) · Order flow (Orders, Order Detail, สร้าง Order, เพิ่มสินค้า → auto Task)
- **Phase 2:** assign งาน · Overview KPI · Board · จัดการพนักงาน · แจ้งเตือน (in-app +
  persisted `/inbox`, สร้างอัตโนมัติตอน assign) · อัปโหลดรูปจริง (`/uploads` + `/images`)
- **Login PIN 6 หลัก:** เข้าใช้งานด้วย PIN อย่างเดียว (bcrypt ฝั่ง server, match ข้ามผู้ใช้)
- **PWA (เว็บ):** รันแอปเดียวกันบนเบราว์เซอร์ผ่าน react-native-web + webpack · service worker
  (Workbox) precache app shell + cache `/api` (NetworkFirst) และ `/uploads` (CacheFirst) →
  เปิด/อ่านข้อมูลได้ตอนออฟไลน์ · `manifest.webmanifest` + ไอคอน 192/512/180 → ติดตั้งลงจอโฮมได้
  (ยืนยันบน Chrome จริง: SW ลง, precache ทำงาน, ติดตั้งได้, login PIN ผ่าน)
- **Offline write + sync (งานพนักงาน):** กด "เริ่ม/หยุด/เสร็จขั้นตอน" ตอนไม่มีเน็ตได้ — เก็บคิว
  ถาวร (AsyncStorage/localStorage) + อัปเดตจอทันที (optimistic) → กลับมาออนไลน์ค่อยส่งอัตโนมัติ
  ตามลำดับ (FIFO) · กันซิงค์ซ้ำด้วย `clientId` (idempotency, unique บน `WorkSession`/`TaskEvent`)
  · บันทึก "เวลาจริงที่กด" (`at`) ไม่ใช่เวลาที่ซิงค์ · หลังซิงค์เสร็จ refetch สถานะจริงจาก server
  (ยืนยัน end-to-end บน Chrome จริง)

---

## 1. Push Notification จริง (FCM) — ยังไม่ทำ

ตอนนี้มีแค่ **in-app / persisted notification** (`/inbox`). ส่วนที่ขาดคือ "เด้งเตือนที่เครื่อง
แม้ปิดแอป" ซึ่งต้องใช้ Firebase Cloud Messaging (Android) + APNs (iOS).

**ต้องมีก่อน (ทำเองนอกโค้ด):**
- สร้าง Firebase project → เพิ่ม Android app (package `com.teakfurnitureapp`) และ iOS app
- ดาวน์โหลด `google-services.json` → `android/app/`, `GoogleService-Info.plist` → iOS
- iOS: เปิด APNs + อัปโหลด key ใน Firebase
- สร้าง service account key ของ Firebase → ใส่เป็น env ฝั่ง API (`FIREBASE_SERVICE_ACCOUNT`)

**ฝั่ง API (`teak-furniture-api`):**
- เพิ่ม `firebase-admin`
- schema: เพิ่ม `DeviceToken { id, userId, token @unique, platform, createdAt }` (relation → User)
- endpoint: `POST /devices` (register token ของผู้ใช้ที่ login), `DELETE /devices/:token`
- `PushService.sendToUser(userId, {title, body, data})` — ดึง token ของ user แล้วส่งผ่าน
  `admin.messaging().sendEachForMulticast(...)`; ลบ token ที่ invalid
- เรียก `PushService` ควบคู่กับ `NotificationsService.create(...)` (ที่ `tasks.service.ts` ตอน
  assign, และเพิ่มจุด overdue/complete ตามต้องการ) — persisted + push ไปพร้อมกัน
- (ทางเลือก) cron รายวันเช็ก overdue → push เตือน

**ฝั่งมือถือ (`teak-furniture-app`):**
- เพิ่ม `@react-native-firebase/app` + `@react-native-firebase/messaging`
- ตอน login สำเร็จ: ขอ permission (`messaging().requestPermission()`), ดึง token
  (`getToken()`) → `POST /devices`; subscribe `onTokenRefresh`
- handle: `onMessage` (foreground → in-app toast/refresh inbox), `setBackgroundMessageHandler`,
  `onNotificationOpenedApp` / `getInitialNotification` (แตะแล้วเปิด Task ที่เกี่ยวข้องผ่าน
  `data.taskId`)
- ล้าง token ตอน logout
- **ต้อง build native ใหม่** (bare RN — ต้องมี Android Studio/Xcode)

**ไฟล์ที่จะแตะ:** api `prisma/schema.prisma`, `src/devices/*`, `src/push/*`,
`src/tasks/tasks.service.ts`; app `src/push/*`, `src/store/auth.tsx`, `App.tsx`, `android/`, `ios/`

---

## 2. Admin Web (repo ที่ 3) — ยังไม่ทำ (ผู้ใช้พักไว้)

เว็บฝั่งผู้ดูแล ใช้ **API เดียวกันนี้** (generate client จาก Swagger `/docs-json`).
แนะนำ Next.js (App Router) + React Query. หน้าหลัก: Dashboard/KPI, Order management
(ตาราง + สร้าง/แก้), Task Board (kanban เต็ม), Reports, Employees, Settings (stages/tags/product types).
รายละเอียด desktop อยู่ในบรีฟ §20, §24 (`teak-furniture-app-design/project/uploads/teak_furniture_production_app_design_brief.md`).

---

## 3. Phase 3 — Reports & Analytics — ยังไม่ทำ

- **Production report** ตามช่วงเวลา (วันนี้/สัปดาห์/เดือน/custom) — จำนวนงานตามสถานะ/ประเภท
- **Work-time report** — เวลารวม/เฉลี่ย ต่อ task / ต่อ stage / ต่อพนักงาน (จาก `WorkSession`)
- **Employee productivity** — งานเสร็จ + ชั่วโมงรวมต่อคน
- **Avg production time ต่อรุ่นสินค้า** → ต่อยอดประเมินต้นทุน/กำหนดส่ง (บรีฟ §19, §26)
- API: endpoint aggregation (`groupBy` / raw SQL บน WorkSession + TaskEvent); Mobile/Web: หน้า Reports

---

## 4. Polish / เก็บงาน

- ปรับ UI ให้ตรง `.dc.html` แบบ pixel-perfect (ตอนนี้ตรง design system + โครง)
- แกลเลอรีรูปหลายรูปในหน้า Task/Product (ตอนนี้โชว์รูปหลัก) + ลบ/จัดลำดับรูป
- Orders/Tasks: pagination + search + filter ฝั่ง server
- Soft-delete / แก้ไข order-product-task, ยกเลิกงาน
- Unit/e2e tests (Jest + supertest ฝั่ง API), detox ฝั่ง mobile
- Production hardening: DB role สิทธิ์ต่ำ (ไม่ใช้ superuser), rate limit, refresh token, logging
- Build ลงเครื่องจริง (Android Studio + SDK) แล้วทดสอบ device จริง
- **Offline เพิ่มเติม:** ตอนนี้ queue เฉพาะ action ของพนักงาน (timer start/stop, complete-stage)
  และโชว์แบนเนอร์ออฟไลน์ที่หน้า Task Detail — ยังเหลือ: (ก) แบนเนอร์ออฟไลน์/pending รวมระดับแอป
  (แถบบนสุดทุกหน้า) แทนเฉพาะหน้า Task Detail; (ข) queue สำหรับสร้าง Order/สินค้า + assign ตอน
  ออฟไลน์ (ตอนนี้ต้องออนไลน์); (ค) จัดการ conflict จริงจัง — ตอนนี้ 4xx ระหว่างซิงค์ถูก "ทิ้ง"
  (dead-letter) กันคิวตัน ควรเก็บ log + แจ้งผู้ใช้ให้ทราบว่ารายการไหนซิงค์ไม่สำเร็จ; (ง) เนทีฟ
  ยังไม่มี NetInfo (ถือว่าออนไลน์ไว้ก่อน แล้วอาศัย retry จาก error) — ถ้า build เนทีฟจริงควรเพิ่ม
  `@react-native-community/netinfo` ให้ `isOnline()` แม่นบนมือถือ
