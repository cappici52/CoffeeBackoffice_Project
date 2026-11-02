# Coffee Backoffice

ระบบหลังบ้านร้านกาแฟตาม [สเปก](docs/coffee-shop-backoffice-spec.md) พัฒนาเป็นส่วน ๆ ตาม [roadmap](docs/roadmap.md)

สถานะ: Foundation API มีระบบ session, roles และจัดการผู้ใช้แล้ว ยังไม่มีหน้าเว็บ/POS/KDS

## Development

ต้องใช้ Node.js 22.14+ และ PostgreSQL 18 (หรือ Docker Compose)

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d db
npm run db:migrate
# กำหนด SEED_OWNER_EMAIL และ SEED_OWNER_PASSWORD ใน .env ก่อน
npm run db:seed
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

## Authentication

Seed สร้าง owner เฉพาะเมื่อยังไม่มีผู้ใช้ ไม่เปลี่ยนรหัสบัญชีเดิม รหัสผ่านใหม่ต้องยาวอย่างน้อย 12 ตัวอักษร และไม่เกิน 72 UTF-8 bytes

ทุก POST/PATCH ต้องส่ง `Origin` ตรงกับ `APP_ORIGIN` รวมถึงคำขอจาก CLI เพื่อป้องกัน CSRF ใช้ cookie session แบบ HttpOnly/SameSite=Strict (Secure และชื่อ `__Host-` ใน production) ไม่เก็บ token ใน localStorage

| Endpoint | สิทธิ์ |
|---|---|
| `POST /api/auth/login` | สาธารณะ (email, password) |
| `POST /api/auth/logout` | ผู้ใช้ที่ล็อกอิน |
| `GET /api/auth/me` | ผู้ใช้ที่ล็อกอิน |
| `POST /api/auth/change-password` | ผู้ใช้ที่ล็อกอิน (current_password, new_password) |
| `GET /api/users?page=1&page_size=25` | owner/manager |
| `POST /api/users` | owner/manager (name, email, password, role) |
| `PATCH /api/users/:id` | owner/manager (name, role, is_active) |

Owner จัดการได้ทุก role; manager เห็นและจัดการเฉพาะ cashier/kitchen ไม่มี public signup และไม่อนุญาตลดสิทธิ์หรือปิดบัญชีตัวเอง การเปลี่ยน role/ปิดบัญชีจะยกเลิก sessions ของบัญชีนั้น การเปลี่ยนรหัสผ่านยกเลิกทุก session และต้องล็อกอินใหม่

Login จำกัด 15 ครั้ง/15 นาทีต่อ IP ในแต่ละ process ต้องเพิ่ม shared rate-limit store หาก deploy หลาย instances; ยังไม่ได้ตั้ง trust proxy อัตโนมัติ ควรกำหนดเฉพาะ proxy ที่เชื่อถือได้เมื่อนำขึ้นระบบจริง

API ใช้ error codes เช่น `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `ORIGIN_FORBIDDEN` โดยไม่ส่ง SQL error หรือรหัสผ่านกลับ มี audit logs สำหรับสร้าง/แก้ไขผู้ใช้ เปลี่ยนรหัสผ่านและล็อกอิน โดยไม่บันทึกรหัสผ่านหรือ session token
