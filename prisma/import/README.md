# นำเข้าข้อมูลจาก Trello → Teak DB

ย้ายการ์ดจากบอร์ด Trello (workspace "EMPTY CHAIR") เข้า Postgres ของระบบใหม่ **ครั้งเดียว รันซ้ำได้
ไม่ซ้ำข้อมูล (idempotent) และไม่แต่งข้อมูลเอง** — pipeline 2 ขั้น: `fetch` (ดึงลงไฟล์) → `import` (เขียน DB)

## เตรียมก่อน
1. ตั้ง `TRELLO_KEY` / `TRELLO_TOKEN` ใน `.env` ของ `teak-furniture-api` (อ่านอย่างเดียว ไม่แก้ Trello)
   - key/token ออกได้ที่ https://trello.com/power-ups/admin (หรือ `https://trello.com/1/authorize`)
2. มี `DATABASE_URL` และรัน migration + seed แล้ว:
   ```bash
   npx prisma migrate deploy   # รวม 20260921000000_add_external_ref (ตาราง ExternalRef)
   npx prisma generate
   npm run seed                # ต้องมี WorkflowStage + users ก่อน import
   ```

## ขั้นตอน
```bash
# 1) ดึง snapshot จาก Trello → data/trello/<timestamp>/{cards,actions,manifest}.json
npm run import:fetch

# 2) ลองแบบไม่เขียน DB → อ่านรายงานก่อน
npm run import:trello -- --dry-run
#    เปิด data/trello/<timestamp>/import-report.md ตรวจ: จำนวนที่เดา, label/คน ที่ยังแมปไม่ได้

# 3) เขียนจริง
npm run import:trello -- --commit
```

ตัวเลือกเพิ่ม: `--snapshot <dir>` (เลือก snapshot เอง), `--limit <n>` (ทดสอบ n การ์ดแรก),
`--with-sessions` (สร้าง WorkSession โดยประมาณจากช่วงเวลาย้ายบอร์ด)

## แมปข้อมูล (แก้ได้ที่ `mapping.ts`)
- **บอร์ด → stage:** ขึ้นแบบ→DESIGN, รอของ→WAITING, เก็บงาน→ASSEMBLY, ทำสี→PAINT, ส่ง→SHIP, ส่งแล้ว→SHIPPED
  (บอร์ดที่ไม่ใช่การผลิต—สต๊อก/คอนเทนต์/ใบเสร็จ—ไม่ถูกดึง)
- **label → สี/ภาค/แหล่งโครง** ; label ที่ไม่รู้จัก → เก็บเป็น `Tag(custom)` ไม่ให้หาย (ขึ้นรายงาน)
- **คน:** `TRELLO_MEMBER_TO_USER_PHONE` (ชื่อ Trello → เบอร์ user ที่ seed) ; แมปไม่ได้ → assignee/actor เป็น
  null + เก็บชื่อดิบไว้ใน `event.detail` — เติม dict แล้ว `--commit` ซ้ำเพื่อ **backfill actor** ที่เคยว่าง

## แต่ละการ์ดแตกเป็นอะไร
`1 การ์ด → Customer (dedup ตามชื่อ) + Order + Product + ProductionTask` ที่ **stage ปัจจุบันของการ์ด**
พร้อม timeline: `moveCardToBoard` → `TaskEvent(STATUS_CHANGE)` (วันที่จริง), `commentCard` → `TaskEvent(NOTE)`,
attachments → `ImageAsset`. ชื่อการ์ดดิบถูกเก็บเต็มใน `Product.name`/`note` เสมอ

## idempotent
ทุก Trello id ถูกผูกกับ row ผ่านตาราง `ExternalRef` (`source, externalId, entityType`) — รัน `--commit`
ซ้ำจะข้ามของที่มีแล้ว ไม่สร้างซ้ำ และ resume งานก้อนใหญ่ได้

## ข้อควรรู้
- URL รูปของ Trello ต้องใช้ token ถึงจะเปิดได้ — ระบบเก็บ URL ไว้ก่อน การโหลดมา re-host เข้า `/uploads`
  เป็นงานเฟสถัดไป
- การ์ดเก่า/ข้อความยัดรวมมั่ว → parser จะอ่านได้แย่กว่า ทุกจุดที่ไม่มั่นใจจะ **ปล่อยว่าง + ขึ้นรายงาน**
  (เช่น จำนวนที่อ่านไม่ได้จะตั้ง = 1 และ list ไว้ให้แก้)
