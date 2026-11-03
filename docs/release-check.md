# บันทึกตรวจระบบ — 3 พฤศจิกายน 2569

## ส่วนที่เพิ่ม/แก้

- `ee64d52`: อัปโหลดรูปถ่ายเมนูจริงจากเครื่อง ตรวจไฟล์/สิทธิ์/ขนาด ลบ metadata เก็บใน PostgreSQL แสดง POS/QR และ preview บนมือถือ
- `f485c10`: สำรอง snapshot พร้อม SHA-256/จำนวนแถว กู้คืนเฉพาะฐานใหม่ ตรวจ binary photos/migrations/revoked sessions; เพิ่ม `ops:check` และ recovery drill ใน CI
- `6d0d392`: แก้ประวัติเมนูสิ้นสุดต่างวัน ใช้ common observed origin, สร้าง forecast เฉพาะเมนูที่กรอง และจำกัดพื้นที่กราฟขณะ viewport เปลี่ยน

## ผลตรวจในเครื่องพัฒนา

| รายการ                            | ผล                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| TypeScript server/client          | ผ่าน                                                                                                               |
| Production frontend/API build     | ผ่าน                                                                                                               |
| PGlite integration/config         | 56/56 ผ่าน                                                                                                         |
| PostgreSQL 18 isolated schemas    | 56/56 ผ่าน                                                                                                         |
| Python model/selection/evaluation | 24/24 ผ่าน                                                                                                         |
| Browser workflows                 | 24 กลุ่มผ่าน: Edge, 1536px/390px, Thai/Bangkok, LAN HTTP                                                           |
| Automated accessibility           | ผ่านชุด axe WCAG ที่ระบุใน browser scripts; ไม่แทนการตรวจด้วยผู้ใช้จริง                                            |
| Backup/recovery                   | ผ่าน: snapshot counts/checksums, bytea photo, revoke restored sessions, reject corruption/existing/source database |
| Premium static UI audit           | strict: 0 findings                                                                                                 |
| Local operating health            | API/DB/forecast ผ่าน; nightly worker สำเร็จ 2026-11-03                                                             |

Browser plugin ไม่พร้อมใน session จึงใช้ Playwright/Edge; CI ใช้ Chromium ภาพทดสอบอยู่ใน `QA_OUTPUT_DIR` นอก repo ไม่เผยแพร่ tokens/credentials ภาพรูปเมนูในแอปเป็นภาพจริง ไม่มี AI menu assets หรือเครดิตบนหน้าจอ

CI ของการแก้โค้ดล่าสุด `6d0d392` ผ่านครบ รวม PostgreSQL, Python, Chromium, backup/recovery และ Docker stack: [run 41597966160](https://github.com/cappici52/CoffeeBackoffice_Project/actions/runs/41597966160) ผลของ commit ถัดไปตรวจได้จาก [workflow checks](https://github.com/cappici52/CoffeeBackoffice_Project/actions/workflows/ci.yml)

## สภาพข้อมูลร้านที่ตรวจพบ

เมนูเปิดขาย 8 รายการ มีสูตร/รูปครบ ไม่มีออเดอร์ค้างชำระ ณ เวลาตรวจ มีวัตถุดิบที่ระดับเตือน 1 รายการ, บัญชีพนักงานตัวอย่างยังเปิด 3 บัญชี และประวัติ demo 672 แถว จึงต้องตรวจ stock กับของจริง และเปลี่ยนรหัส/จัดบัญชีจริงก่อนเปิดร้าน ตัวเลขนี้เป็นสถานะ ณ การตรวจ ไม่ใช่ค่าคงที่หรือผลประเมินผู้ใช้

มี backup ทั้งก่อนและหลัง migration 009 ใน `.local/backups` (ไม่อยู่ใน Git) เปลี่ยน PUBLIC_ORIGIN ในเครื่องเป็น `http://192.168.1.36:3001` ตาม IP Wi-Fi ณ วันที่ตรวจ ป้ายที่ใช้ IP เก่าต้องพิมพ์ใหม่ แนะนำตั้ง IP reservation ก่อนติดป้ายถาวร

## การรับมอบที่ยังต้องอาศัยโลกจริง

ไม่มีผลประเมินจากกลุ่มผู้ใช้จริง ไม่มี actual shop holdout เพียงพอยืนยันความแม่นยำ และยังไม่มี production domain/host หรือรุ่นเครื่องพิมพ์ที่ระบุ จึงไม่ได้อ้างผลเหล่านั้นว่าเสร็จแล้ว เตรียมขั้นตอนพร้อมใช้งานไว้ใน [acceptance plan](acceptance-plan.md), [forecast evaluation](forecast-evaluation-plan.md) และ [operations](operations.md)

ระบบพร้อมใช้/สาธิตในเครื่องและ LAN ภายใต้ขอบเขตที่ทดสอบ การเปิดร้านเงินจริงต้องให้ผู้รับผิดชอบตรวจราคา สูตร stock บัญชี อุปกรณ์และการสำรองนอกเครื่องก่อน ไม่เติมยอดจำลองลง actual หรือแก้ผลโมเดลให้ดูดี
