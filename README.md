# Coffee Backoffice

ระบบหลังบ้านร้านกาแฟตาม [สเปก](docs/coffee-shop-backoffice-spec.md) พัฒนาเป็นส่วน ๆ ตาม [roadmap](docs/roadmap.md)

สถานะ: Foundation API อยู่ระหว่างพัฒนา ยังไม่มีหน้าเว็บ/POS/KDS

## Development

ต้องใช้ Node.js 22.14+ และ PostgreSQL 18 (หรือ Docker Compose)

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d db
npm run db:migrate
npm run dev
```

ตรวจสถานะ: `GET http://localhost:3001/api/health`

รัน API และ DB ใน Docker: `docker compose up --build -d` (migration ทำอัตโนมัติ)
ค่า DB ใน Compose เป็นค่าพัฒนาบนเครื่องเท่านั้น เปลี่ยนรหัสและตั้ง HTTPS ก่อนนำขึ้น production

## Validation

```powershell
npm run typecheck
npm test
npm run build
```

Integration tests ใช้ PGlite (PostgreSQL บน WASM) จึงไม่ต้องเปิด Docker แต่ไม่ได้ทดแทนการตรวจ container และ concurrent requests บน PostgreSQL จริง

ไฟล์ migration ที่ใช้แล้วห้ามแก้ย้อนหลัง ให้เพิ่มไฟล์ใหม่ ระบบตรวจ checksum ก่อนรันซ้ำ
