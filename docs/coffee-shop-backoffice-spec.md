# Coffee Shop Back-Office Web App — Project Spec

เอกสารนี้สรุปความต้องการของระบบหลังบ้านร้านกาแฟ เพื่อใช้เป็นสเปกให้ Codex พัฒนาต่อ

---

## 1. ภาพรวม

เว็บแอปจัดการหลังบ้านร้านกาแฟ ครอบคลุมเมนู ออเดอร์/POS สต็อกวัตถุดิบ หน้าจอครัว/บาร์ (KDS) รายงาน และการพยากรณ์ยอดขายด้วย model ที่มีอยู่แล้ว

**เป้าหมาย:** ให้เจ้าของร้านและพนักงานจัดการร้านได้ครบในที่เดียว และใช้ข้อมูลพยากรณ์ช่วยวางแผนวัตถุดิบ

**ขอบเขตเริ่มต้น:** ร้านเดียว (single branch) ออกแบบ DB ให้เพิ่ม `branch_id` ภายหลังได้

---

## 2. Tech Stack (ข้อเสนอ — Codex เลือกปรับได้ถ้าเหมาะสมกว่า)

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | React / Next.js + TypeScript, Tailwind CSS |
| Backend หลัก | Node.js (NestJS หรือ Express) + TypeScript |
| ฐานข้อมูล | PostgreSQL (ใช้ ORM เช่น Prisma) |
| Auth | JWT หรือ session + Role-Based Access Control |
| Real-time | WebSocket (Socket.IO) หรือ Server-Sent Events |
| Forecast Service | Python (FastAPI) แยกเป็นบริการต่างหาก |
| Deploy | Docker Compose สำหรับ dev; Vercel/Railway/Render หรือ VPS สำหรับ production |

---

## 3. Roles และสิทธิ์

| Role | สิทธิ์ |
|---|---|
| `owner` | ทุกอย่าง รวมรายงานกำไร ตั้งค่าระบบ จัดการผู้ใช้ |
| `manager` | เมนู สต็อก รายงานยอดขาย จัดการพนักงาน |
| `cashier` | สร้างออเดอร์ รับชำระ ดูออเดอร์ |
| `kitchen` | เห็นเฉพาะหน้า KDS และเปลี่ยนสถานะออเดอร์ ห้ามดูรายงานยอดขาย |

---

## 4. โมดูลและฟีเจอร์

### 4.1 Auth & Users
- Login/Logout, เปลี่ยนรหัสผ่าน
- จัดการผู้ใช้และกำหนด role (owner/manager เท่านั้น)

### 4.2 เมนูและสินค้า
- CRUD: หมวดหมู่, เมนู (ชื่อ, ราคา, รูป, รายละเอียด)
- ตัวเลือกเสริม (options): ระดับความหวาน, ขนาดแก้ว, ท็อปปิ้ง พร้อมราคาเพิ่ม
- เปิด/ปิดการขายเมนูชั่วคราว (`is_available`)
- กำหนดเวลาเตรียมเป้าหมายต่อเมนู (`target_prep_seconds`)

### 4.3 ออเดอร์ / POS เบื้องต้น
- สร้างออเดอร์ เลือกเมนู + ตัวเลือก + หมายเหตุ
- ประเภทออเดอร์: dine-in, takeaway
- ชำระเงิน: เงินสด, QR PromptPay (บันทึกวิธีชำระและสถานะ)
- สถานะออเดอร์: `pending → preparing → ready → completed` (และ `cancelled`)
- พิมพ์/แสดงใบเสร็จ

### 4.3.1 หน้าจอเชฟ / บาร์ (KDS) ← ส่วนสำคัญ
- แสดงเป็นการ์ดออเดอร์ แบ่งคอลัมน์: รอทำ | กำลังทำ | เสร็จรอเสิร์ฟ
- ในการ์ดแสดง: เลขออเดอร์/โต๊ะ, ประเภท, รายการเมนู + จำนวน, ตัวเลือก, หมายเหตุลูกค้า (เน้นสี)
- **ตัวจับเวลา:** แสดงว่าสั่งมาแล้วกี่นาที (นับขึ้นจาก `created_at`)
  - คำนวณฝั่ง frontend จากเวลา server ไม่ยิง request ทุกวินาที
  - สี: เขียว (ไม่เกินเป้าหมาย) / เหลือง (ใกล้เกิน) / แดง (เกินเวลา) อิงจาก `target_prep_seconds`
- **สูตรการทำ:** กดดูสูตร หรือแสดงย่อในการ์ด
  - วัตถุดิบ + ปริมาณ, ขั้นตอนเป็นข้อๆ, รูปประกอบ (optional)
  - ปรับตามตัวเลือก เช่น เลือกนมโอ๊ต ให้แสดงนมโอ๊ตแทนนมวัว
- ปุ่ม "เริ่มทำ" และ "เสร็จ" บันทึก `started_at` / `completed_at`
- เรียงออเดอร์เก่าสุดไว้ก่อน; กรองตามสถานี (`bar` / `kitchen`) ได้
- **Real-time:** ออเดอร์ใหม่เด้งขึ้นจอทันที + เสียงแจ้งเตือน
- แสดงสถานะ "ขาดการเชื่อมต่อ" ชัดเจน และ reconnect อัตโนมัติ
- UI เหมาะกับจอสัมผัส ปุ่มและตัวอักษรใหญ่
- Role `kitchen` เข้าถึงได้เฉพาะหน้านี้

### 4.4 สต็อกวัตถุดิบ
- CRUD วัตถุดิบ พร้อมหน่วย (g, ml, ชิ้น ฯลฯ) และจุดสั่งซื้อ (reorder point)
- **สูตร (recipe)** ผูกเมนู ↔ วัตถุดิบ ตัดสต็อกอัตโนมัติเมื่อออเดอร์ถูกชำระ/ยืนยัน (ให้ถือเป็น transaction)
- บันทึกรับของเข้า และของเสีย/เสียหาย (`stock_movements`)
- แจ้งเตือนเมื่อสต็อกต่ำกว่าจุดสั่งซื้อ

### 4.5 รายงานและแดชบอร์ด
- ยอดขายรายวัน/สัปดาห์/เดือน
- เมนูขายดี, ช่วงเวลาขายดี
- ต้นทุน vs กำไรต่อเมนู (จากสูตร)
- สรุปปิดกะ/ปิดวัน
- **เวลาเตรียมเฉลี่ยต่อเมนู** (จาก `started_at`/`completed_at`) ใช้ปรับ `target_prep_seconds`

### 4.6 การพยากรณ์ยอดขาย (Forecast)
ดูรายละเอียดในหัวข้อ 6

---

## 5. Database Schema (ตารางหลัก)

```
users(id, name, email, password_hash, role, created_at)
categories(id, name, sort_order)
products(id, category_id, name, price, image_url, is_available, target_prep_seconds, station)
product_option_groups(id, product_id, name, is_required, multi_select)
product_options(id, group_id, name, extra_price, ingredient_id?, ingredient_qty?)
orders(id, order_no, type, table_no, status, total, note, created_by, created_at)
order_items(id, order_id, product_id, qty, unit_price, status, station, note,
            started_at, completed_at)
order_item_options(id, order_item_id, option_id)
order_status_logs(id, order_id, from_status, to_status, changed_by, changed_at)
payments(id, order_id, method, amount, status, paid_at)
ingredients(id, name, unit, current_stock, reorder_point)
recipes(id, product_id)
recipe_ingredients(id, recipe_id, ingredient_id, qty)
recipe_steps(id, recipe_id, step_no, instruction, image_url, timer_seconds)
stock_movements(id, ingredient_id, type, qty, reason, ref_order_id?, created_by, created_at)
suppliers(id, name, contact)               -- เฟสหลัง
sales_daily(date, product_id, qty, revenue) -- สรุปรายวันสำหรับ model
forecasts(id, forecast_date, product_id, predicted_qty, lower, upper,
          model_version, generated_at)
```

> ปรับ/เพิ่ม index และ constraint ตามความเหมาะสม (เช่น index `orders.created_at`, `order_items.status`)

---

## 6. Forecast Service Integration

ผู้ใช้มี model พยากรณ์ยอดขายอยู่แล้ว (ประเภท model, ฟอร์แมต input/output จริง: **รอผู้ใช้ระบุ** ดูหัวข้อ 9) ให้ออกแบบเป็นบริการแยก

**สถาปัตยกรรม**
```
[Frontend] → [Backend หลัก] → [PostgreSQL]
                   ↓
         [Forecast Service (FastAPI)]
                   ↓
         อ่าน sales_daily / โหลด model
```

**API สัญญา (ร่าง ปรับได้เมื่อรู้ฟอร์แมต model จริง)**
```
POST /forecast
Request:  { "date_from": "2026-11-03", "date_to": "2026-11-09", "product_id": 12 | null }
Response: [{ "date": "...", "product_id": 12, "predicted_qty": 34.5,
             "lower": 28.0, "upper": 41.0, "model_version": "v1" }]
```

**รูปแบบการทำงาน**
- Scheduled job รันทุกคืน → เรียก `/forecast` → บันทึกผลลง `forecasts`
- แดชบอร์ดอ่านจากตาราง `forecasts` (โหลดเร็ว ไม่ต้องรอ model)
- Retrain ตามรอบ (เช่นรายสัปดาห์) — ทำเป็นขั้นตอนแยก
- เก็บ `model_version` กับทุกผลพยากรณ์

**การใช้งานในระบบ**
1. กราฟยอดขายจริง vs พยากรณ์ 7-30 วัน พร้อมช่วงความเชื่อมั่น
2. พยากรณ์รายเมนู → แนะนำปริมาณที่ควรเตรียม
3. **แนะนำสั่งวัตถุดิบ:** ยอดพยากรณ์ × recipe − สต็อกคงเหลือ = จำนวนที่ควรสั่ง
4. แสดงความแม่นยำ (MAPE/RMSE) เทียบพยากรณ์กับยอดจริง
5. (ภายหลัง) ช่วยวางตารางกะพนักงาน

ระหว่างพัฒนาให้มี **mock forecast** และ **seed data จำลอง** เพื่อให้ระบบทำงานได้ก่อนเชื่อม model จริง

---

## 7. Non-functional Requirements

- Type-safe (TypeScript), validate input ทุก endpoint
- รหัสผ่านเข้ารหัส (bcrypt/argon2), ป้องกัน CSRF/XSS/SQL injection ตามมาตรฐาน
- การตัดสต็อกและการสร้างออเดอร์ใช้ DB transaction
- Responsive: POS ใช้ได้บนแท็บเล็ต, KDS ใช้ได้บนจอสัมผัสขนาดใหญ่
- Audit log: บันทึกว่าใครแก้ข้อมูลสำคัญอะไรเมื่อไหร่ (เมนู/ราคา/สต็อก)
- มี README, `.env.example`, migration และ seed script
- มี test พื้นฐานสำหรับ logic สำคัญ (ตัดสต็อก, คำนวณราคา, สถานะออเดอร์)

---

## 8. ลำดับการพัฒนา (Phases)

1. **Foundation:** โครงโปรเจกต์, DB schema, Auth + Role
2. **เมนูและหมวดหมู่:** CRUD + options
3. **ออเดอร์และการชำระเงิน:** POS, สถานะออเดอร์
4. **KDS:** หน้าจอเชฟ, ตัวจับเวลา, real-time, สูตรการทำ
5. **สต็อกและสูตร:** ตัดสต็อกอัตโนมัติ, แจ้งเตือนสต็อกต่ำ
6. **รายงาน/แดชบอร์ด** รวมเวลาเตรียมเฉลี่ย
7. **Forecast Service:** เชื่อม model, ตาราง `forecasts`, กราฟ, แนะนำสั่งวัตถุดิบ
8. **ฟีเจอร์เสริม:** สมาชิก/แต้ม, ตารางกะ, ซัพพลายเออร์/PO, รายจ่าย, หลายสาขา, สั่งผ่าน QR โต๊ะ

---

## 9. ข้อมูลที่ยังต้องระบุ (Open Items)

- [ ] ประเภท model พยากรณ์ (เช่น ARIMA / Prophet / LSTM / XGBoost) และไฟล์/ไลบรารีที่ใช้โหลด
- [ ] ฟอร์แมต input/output จริงของ model และความละเอียดการพยากรณ์ (รายวัน/รายชั่วโมง, รายเมนู/รวม)
- [ ] ชุดข้อมูลย้อนหลังที่ใช้ train และรูปแบบไฟล์
- [ ] วิธีชำระเงิน QR PromptPay: แค่บันทึกสถานะเอง หรือเชื่อม payment gateway
- [ ] ต้องการเครื่องพิมพ์ใบเสร็จจริงหรือไม่
- [ ] (ทางเลือก) ส่วน IoT: ปุ่ม/ไฟสถานะ ESP32 ที่บาร์, เซนเซอร์ชั่งน้ำหนักวัตถุดิบ, เซนเซอร์อุณหภูมิตู้เย็น
