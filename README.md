# Coffee Backoffice

ระบบจัดการร้านกาแฟสาขาเดียว รองรับการขายหน้าร้าน (POS) การสั่งผ่าน QR ที่โต๊ะ การติดตามออเดอร์บนหน้าจอบาร์ (KDS) การจัดการสูตรและสต็อก รายงานยอดขาย และการพยากรณ์ 1, 7 และ 30 วัน

พัฒนาด้วย React, Node.js, PostgreSQL และ FastAPI

## เริ่มใช้งานบน Windows

ต้องมี Node.js 22.14 ขึ้นไป, PostgreSQL 18 และ Python 3.12 ขึ้นไป

1. สร้างฐานข้อมูลชื่อ `coffee_backoffice` ใน PostgreSQL
2. คัดลอก `.env.example` เป็น `.env` แล้วตั้ง `DATABASE_URL`, `SEED_OWNER_EMAIL` และ `SEED_OWNER_PASSWORD` (อย่างน้อย 12 ตัวอักษร และไม่เกิน 72 ไบต์ UTF-8)
3. รันจากโฟลเดอร์โปรเจกต์

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r forecast-service/requirements.txt
npm run db:migrate
npm run db:seed
npm run build
npm run local
```

เปิด [localhost:3001](http://localhost:3001) แล้วเข้าสู่ระบบด้วยบัญชีที่ตั้งไว้ใน `.env` คำสั่ง `npm run local` เปิดเว็บ API บริการพยากรณ์ และ worker พร้อมกัน

ถ้าจะทดสอบ QR บนมือถือ ให้เชื่อมมือถือกับคอมในเครือข่ายเดียวกัน ใช้ `npm run local:lan` แทน แล้วเปิดหน้า **โต๊ะ / QR** เพื่อใช้ QR จาก IP ปัจจุบัน

## เอกสาร

- [คู่มือเปิดร้าน ปิดวัน และสำรองข้อมูล](docs/operations.md)
- [โครงสร้างระบบ แผนภาพ และพจนานุกรมข้อมูล](docs/system-design.md)
- [การพยากรณ์และข้อจำกัด](docs/forecast-v5.md)
- [คู่มือสาธิต Historical Replay ด้วยข้อมูลสาธารณะ](docs/forecast-presentation-demo.md)
