# Coffee Backoffice

ระบบหลังบ้านร้านกาแฟภาษาไทย UI minimal โทนเข้ม สำหรับร้านเดียว เชื่อม PostgreSQL จริง รองรับ owner / manager / cashier / kitchen

## สิ่งที่ใช้งานได้

- เข้าสู่ระบบ ออกจากระบบ เปลี่ยนรหัสผ่าน จัดการผู้ใช้และสิทธิ์
- หมวดหมู่ เมนู ราคา อัปโหลดรูปถ่ายจากเครื่อง/ลิงก์รูป สถานี เวลาเตรียม ตัวเลือกเสริม และเปิด/ปิดขาย
- POS ทานที่ร้าน/กลับบ้าน ตัวเลือก/หมายเหตุ พักออเดอร์ รับเงินสด/บันทึก PromptPay และใบเสร็จพิมพ์ผ่าน browser
- QR ประจำโต๊ะ หน้าลูกค้าไม่ต้องล็อกอิน เลือกเมนู/ตัวเลือก/หมายเหตุ ส่งออเดอร์ และติดตามสถานะเฉพาะออเดอร์ของตัวเอง
- KDS สามคอลัมน์ ตัวจับเวลาจากเวลา server สีเตือนเกินเป้าหมาย สูตรตามตัวเลือก กรองสถานี เสียงแจ้งเตือน และ SSE reconnect
- สูตร/ขั้นตอน วัตถุดิบ รับเข้า ของเสีย แจ้งสต็อกต่ำ และตัดสต็อกครั้งเดียวตอนยืนยันออเดอร์หรือรับชำระล่วงหน้าด้วย DB transaction
- ยอดขายรายวัน/ช่วงวันที่ เมนูและช่วงเวลาขายดี กำไรขั้นต้นเฉพาะ owner เวลาเตรียมเฉลี่ย และปิดวัน
- FastAPI forecast แยกบริการ บันทึกผลพยากรณ์ กราฟ ปริมาณเตรียม แนะนำวัตถุดิบ และ MAPE/RMSE เมื่อมีข้อมูลเทียบ
- worker พยากรณ์หลัง 02:00 Asia/Bangkok วันละหนึ่งครั้ง พร้อม catch-up/retry
- Audit logs, version conflict checks และป้องกันออเดอร์/ตัดสต็อกซ้ำเมื่อเครือข่ายขัดข้อง

**ขอบเขตเริ่มต้น:** PromptPay เป็นการตรวจเงินและยืนยันโดยพนักงาน ไม่มี gateway/ตรวจสลิปอัตโนมัติ การคืนเงินเป็นการบันทึกหลังคืนเงินจริงด้วยพนักงาน Forecast เชื่อม XGBoost จาก ProjectA แล้ว พร้อมเทรน XGBoost จากประวัติร้านและเลือกเทียบกับยอดสัปดาห์ก่อน ผลใหม่ไม่มีช่วงความเชื่อมั่น และยังต้องประเมินความแม่นยำกับยอดจริงของร้าน ฟีเจอร์เสริมเฟส 8 เช่นสมาชิก/IoT/หลายสาขายังไม่รวมใน core release

## เริ่มใช้งานกับ PostgreSQL ในเครื่อง (Windows)

ต้องใช้ Node.js 22.14+, PostgreSQL 18 และ Python 3.12+

1. สร้างฐานข้อมูลแยกชื่อ `coffee_backoffice` ใน pgAdmin หรือใช้ `CREATE DATABASE coffee_backoffice;` (เครื่องที่พัฒนางานนี้สร้างให้แล้ว)
2. คัดลอก `.env.example` เป็น `.env` แล้วตั้ง `DATABASE_URL` ด้วยบัญชี PostgreSQL ของคุณ กำหนด `SEED_OWNER_EMAIL` และรหัสผ่าน `SEED_OWNER_PASSWORD` ยาวอย่างน้อย 12 ตัวอักษร ไม่เกิน 72 UTF-8 bytes
3. รันคำสั่งต่อไปนี้ในโฟลเดอร์โปรเจกต์:

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r forecast-service/requirements.txt
npm run db:migrate
npm run db:seed
# ทางเลือกสำหรับเริ่มทดลอง: เมนู/สูตร/สต็อกตัวอย่าง และประวัติจำลอง 84 วัน
npm run db:demo
npm run build
npm run local
```

ตรวจความพร้อมด้วย `npm run ops:check` สำรองข้อมูลด้วย `npm run db:backup` และทดสอบกู้คืนด้วย `npm run test:backup` (ต้อง build และใช้ development PostgreSQL ที่สร้างฐานทดลองได้) ดู [คู่มือเปิดร้าน ปิดวัน สำรองและกู้คืน](docs/operations.md) สำหรับขั้นตอนใช้งานจริง

เปิด [http://localhost:3001](http://localhost:3001) แล้วใช้บัญชีตาม `.env` รหัสผ่านไม่ถูก commit ขึ้น Git `npm run local` เปิด API/หน้าเว็บ, FastAPI และ worker ใน terminal เดียว กด Ctrl+C เพื่อหยุด โปรแกรมจะไม่เปิด API ซ้ำหาก port นั้นมี Coffee Backoffice ทำงานอยู่แล้ว

`db:seed` สร้าง owner เฉพาะฐานข้อมูลที่ยังไม่มีผู้ใช้ ไม่ reset รหัสผ่านเดิม `db:demo` ทำงานเฉพาะ development/test และเฉพาะเมื่อยังไม่มีสินค้า ข้อมูลตัวอย่างสร้าง manager@example.com, cashier@example.com, kitchen@example.com โดยใช้รหัสเริ่มต้นเดียวกับ owner สำหรับทดลองในเครื่อง ควรเปลี่ยนรหัส/ปิดบัญชีตัวอย่างก่อนใช้งานจริง

ข้อมูลประวัติจำลองอยู่ใน `sales_daily` พร้อม `source=demo` ไม่สร้างออเดอร์/การชำระย้อนหลัง และไม่แสดงเป็นยอดขายจริงในรายงาน หน้าพยากรณ์แจ้งเมื่อใช้ประวัติตัวอย่าง

## QR สั่งอาหารประจำโต๊ะ

1. เจ้าของร้าน/ผู้จัดการเปิดเมนู **โต๊ะ / QR → เพิ่มโต๊ะ** แล้วตั้งหมายเลขหรือชื่อ เช่น `1`, `2`, `A1`
2. กด **ดู / พิมพ์ QR** เพื่อพิมพ์ป้าย ดาวน์โหลด PNG หรือเปิดเมนูลูกค้า
3. ลูกค้าสแกน เลือกเมนู แล้วกด **ส่งออเดอร์** โดยไม่ต้องล็อกอิน
4. พนักงานเปิดหน้า **ออเดอร์** รายการจะมีป้าย **สั่งผ่าน QR** และเลขโต๊ะ กด **ยืนยันและส่งเข้าบาร์** เพื่อเริ่มทำโดยยังไม่รับชำระ
5. ลูกค้าติดตามสถานะ **รอร้านยืนยัน → รอทำ → กำลังทำ → รอเสิร์ฟ → เสิร์ฟแล้ว** ผ่านลิงก์เฉพาะออเดอร์ ระบบอัปเดตอัตโนมัติ
6. **ทานเสร็จแล้วค่อยจ่าย** พนักงานเปิดออเดอร์เดิม กด **รับชำระ** และยืนยันเมื่อได้รับเงินจริง ยอดค้างยังอยู่หลังเสิร์ฟจนกว่าจะรับชำระ และปิดวันไม่ได้หากยังมีออเดอร์ค้างชำระ

ตั้ง `PUBLIC_ORIGIN` ใน `.env` เป็นที่อยู่ที่โทรศัพท์เข้าถึงได้ เช่น `http://192.168.1.100:3001` สำหรับ Wi-Fi ร้าน หรือ `https://ชื่อโดเมนร้าน` สำหรับ production แล้วเปิดเว็บใหม่ก่อนพิมพ์ QR ห้ามใช้ `localhost` สำหรับมือถือเครื่องอื่น โทรศัพท์ต้องเข้าถึงเครื่องร้านได้ผ่าน Wi-Fi/เครือข่าย และ firewall ต้องอนุญาตการเชื่อมต่อ หาก IP เปลี่ยน ให้ปรับค่าและพิมพ์ป้ายใหม่

การปิดรับโต๊ะหรือเปลี่ยน QR จะหยุดคำสั่งซื้อใหม่จากลิงก์เดิม แต่ลิงก์ติดตามออเดอร์ที่ส่งแล้วจะยังใช้งานได้ QR ของโต๊ะไม่สามารถเปิดรายการของลูกค้าคนอื่น เก็บลิงก์ติดตามส่วนตัวไว้และไม่ส่งต่อ รายละเอียดอยู่ใน [สัญญา QR ordering](docs/table-ordering.md)

## รันบริการแยกกัน / พัฒนา

```powershell
npm run dev
# อีก terminal สำหรับ frontend hot reload:
# เปลี่ยน APP_ORIGIN ใน .env เป็น http://localhost:5173 ก่อนเปิด dev API
npm run dev:web
# FastAPI:
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir forecast-service --host 127.0.0.1 --port 8001
# scheduler:
npm run forecast:worker
```

ค่าเริ่มต้นใช้งานเว็บ build ที่ port 3001 ได้ทั้ง frontend และ API ตรวจสุขภาพที่ `/api/health` และ forecast service ที่ `http://127.0.0.1:8001/health` หากใช้ hot reload ให้เปิด URL ตรงกับ `APP_ORIGIN`

ทุก POST/PATCH/PUT/DELETE ของ API ต้องมี `Origin` ตรงกับ `APP_ORIGIN` รวมถึงคำขอจาก CLI ใช้ HttpOnly/SameSite=Strict session cookie และใช้ Secure + ชื่อ `__Host-` ใน production Production ต้องตั้ง HTTPS, `NODE_ENV=production`, บัญชี DB/รหัสผ่านเฉพาะ และให้ forecast service อยู่ในเครือข่ายภายใน หาก deploy หลาย API instances ต้องเปลี่ยน rate-limit store จาก memory เป็น shared store ไม่ตั้ง trust proxy อัตโนมัติ

## Docker Compose

```powershell
docker compose up --build --wait
docker compose exec -e SEED_OWNER_EMAIL -e SEED_OWNER_PASSWORD api node dist/seed.js
# ทางเลือกสำหรับข้อมูลตัวอย่าง:
docker compose exec api node dist/demo.js
```

กำหนด `SEED_OWNER_EMAIL`/`SEED_OWNER_PASSWORD` ใน environment ของ shell ก่อน seed ผ่าน exec ค่าใน `.env` จะไม่ถูกส่งเข้า container โดยอัตโนมัติสำหรับคำสั่งนี้ เว็บอยู่ port 3001, forecast 8001, DB ที่ publish ออก host เป็น **5433** เพื่อไม่ชน PostgreSQL ในเครื่อง (ปรับด้วย `POSTGRES_PORT`) API/worker ใน Docker ใช้ DB/service ภายใน Compose ไม่ได้เชื่อม DB เครื่อง host โดยอัตโนมัติ

Compose เป็นค่าพัฒนา ใช้ `POSTGRES_PASSWORD` เปลี่ยนรหัสเริ่มต้นได้ ห้ามใช้ค่าเริ่มต้นเป็น production

## ตรวจงาน

```powershell
npm run typecheck
npm test
npm run test:postgres
python -m unittest discover -s forecast-service
npm run build
# เปิด FastAPI ที่ port 8001 ก่อน; Windows ใช้ Edge ที่ติดตั้งอยู่
npm run test:e2e
```

- 56 integration/configuration tests ครอบคลุม auth/roles, CRUD, SQL rollback, ราคา, options, สต็อก, idempotency, สถานะ KDS, คืนเงิน, รายงาน, ปิดวัน, forecast ทั้งชุด/รายเมนู, public QR/table binding, quote validation, capability isolation, ทานเสร็จค่อยจ่าย, LAN/production security headers และอัปโหลด/ตรวจไฟล์รูป
- Python model/selection tests 24 กรณี รวมตรวจผลตรงกับโมเดล ProjectA กันข้อมูลอนาคตรั่ว ประวัติสิ้นสุดต่างวัน และทำซ้ำผลเทรน Coffee Sales จริง
- Browser test ครอบคลุม 24 กลุ่มตรวจ รวม lost-payment-response retry, POS → ใบเสร็จ → KDS → ส่งมอบ → รายงาน, CRUD, อัปโหลดรูป/พรีวิวบนมือถือ, พยากรณ์เฉพาะเมนู, สิทธิ์, เปลี่ยนรหัสผ่าน, ถอดรหัส PNG ของ QR, การสั่ง/ติดตามของลูกค้า, 1536px/390px และ automated WCAG checks บน POS/หน้าลูกค้า
- Tests บน PostgreSQL และ browser ใช้ schema สุ่มแล้วลบ ไม่เขียน test orders ลงตารางร้านจริง ต้องใช้ development database ที่อนุญาตสร้าง schema
- Browser plugin ไม่พร้อมใน session นี้ จึงใช้ Playwright/Edge; CI ใช้ Chromium ภาพ QA อยู่ใน OS temp หรือ `QA_OUTPUT_DIR` ไม่ commit รูปทดสอบ
- CI ตรวจ typecheck, PGlite, PostgreSQL 18, Python, browser, production build และเปิด Docker stack เพื่อ smoke test

Migration มี checksum ห้ามแก้ไฟล์ที่ใช้แล้ว ให้เพิ่ม migration ใหม่

## เอกสารและจุดเชื่อมต่อ

- [สเปกต้นฉบับ](docs/coffee-shop-backoffice-spec.md)
- [สถานะงานและขอบเขต](docs/roadmap.md)
- [โครงสร้างระบบ Use Cases, ER และพจนานุกรมข้อมูล](docs/system-design.md)
- [แผนทดสอบรับมอบ/ทดลองกับผู้ใช้และแนวทางสาธิต](docs/acceptance-plan.md)
- [แผนเก็บข้อมูลจริงและประเมินพยากรณ์](docs/forecast-evaluation-plan.md)
- [คู่มือใช้งานร้าน สำรอง/กู้คืน และตรวจความพร้อม](docs/operations.md)
- [ผลตรวจระบบและข้อจำกัดก่อนเปิดร้าน](docs/release-check.md)
- [กติกา domain / การรับเงินและปิดวัน](docs/domain-decisions.md)
- [ผลทดลองเทรนด้วยข้อมูล Coffee Sales จริงและข้อจำกัด](docs/coffee-sales-evaluation.md) — เทรนและทดสอบแล้ว แต่ยังไม่เปิดใช้แทนโมเดลในแอปเพราะแพ้ baseline ที่เลือกจาก validation
- [แนวทาง UI และ token](DESIGN.md) / [พฤติกรรมร่วม](UX-CONTRACT.md)
- [ภาพแนวทางและ brief จาก ImageGen](docs/design/concept.md)

API หลัก: `/api/auth/*`, `/api/users`, `/api/catalog`, `/api/categories`, `/api/products`, `/api/ingredients`, `/api/stock-movements`, `/api/recipes/:productId`, `/api/orders`, `/api/kds`, `/api/events`, `/api/reports`, `/api/reports/close`, `/api/forecasts`, `/api/forecasts/generate`, `/api/audit-logs`

เชื่อมโมเดลจริงแล้ว ดู [การเชื่อมโมเดลและวิธีเลือกพยากรณ์](docs/forecast-integration.md) ต้องมีประวัติรายเมนูอย่างน้อย 28 วันติดต่อกัน; เมื่อครบ 84 วัน ระบบจะเทรนโมเดลจากประวัติร้านและเทียบย้อนหลัง 28 วันก่อนเลือกใช้ วันที่ไม่มีข้อมูลไม่ถูกเติมศูนย์อัตโนมัติ ผลจากข้อมูลตัวอย่างไม่ใช่หลักฐานความแม่นยำของร้านจริง เก็บโมเดลที่เทรนใหม่ใน `forecast-service/runtime/` หรือ Docker volume `coffee_forecast_models`

ภาพถ่ายจริงประกอบครบ 8 เมนู แสดงใน POS/QR และพรีวิวตอนแก้ไข โดยไม่มีลิงก์เครดิตหรือข้อความ license บนหน้าจอ ดู [รายละเอียดภาพเมนู](docs/menu-photographs.md)
