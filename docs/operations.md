# คู่มือใช้งานและดูแลร้าน

ขอบเขต: ร้านเดียว, เงินเป็นสตางค์, วันขาย Asia/Bangkok, รับเงินโดยพนักงาน, ใบเสร็จผ่าน browser, ลูกค้าทานก่อนจ่าย ไม่เชื่อมตรวจสลิปอัตโนมัติ ใช้บัญชีเฉพาะบุคคลและเครื่องร้านที่ดูแลได้

## เริ่มใช้

ติดตั้งตาม README และกำหนด `.env` เฉพาะเครื่อง รัน `npm run db:migrate`, `npm run db:seed`, `npm run build`, `npm run local` การเปิดครั้งถัดไปใช้ `npm run local` ใน terminal ที่เปิดค้างไว้ ไม่ต้อง seed/demo ซ้ำ หน้าเว็บคือ http://localhost:3001

ก่อนเปิดร้านรัน `npm run ops:check` คำสั่งอ่านอย่างเดียว ตรวจ migrations/checksums, owner, เมนูที่ไม่มีสูตร/รูป, สต็อกต่ำ, บัญชี/ประวัติตัวอย่าง, เงินค้าง, frontend, API, forecast และอายุ backup ค่า FAIL ต้องแก้ก่อนใช้ส่วนที่เกี่ยวข้อง WARN ต้องตรวจตามบริบท (เช่น สต็อกต่ำไม่ใช่ระบบล่ม) ไม่ได้ทดสอบ firewall/อุปกรณ์จริงแทนผู้ใช้

เจ้าของร้านตรวจชื่อเมนู ราคา ตัวเลือก ปริมาณสูตร หน่วยวัตถุดิบ และยอดตั้งต้นให้ตรงร้าน เพิ่มพนักงานจริงใน **ผู้ใช้งาน** แล้วปิดบัญชีตัวอย่างผ่านหน้าจอหลังสร้างบัญชีทดแทน เปลี่ยนรหัสผ่าน owner และพนักงานก่อนใช้จริง ห้ามแชร์บัญชี owner ให้ครัว/แคชเชียร์ ไม่ล้างข้อมูลร้านเดิมเพื่อเริ่มสาธิต ใช้ฐานแยกเมื่อทดลอง

## QR และอุปกรณ์

กำหนด `PUBLIC_ORIGIN` เป็น IP เครื่องร้านที่มือถือเข้าถึงได้ เช่น `http://192.168.1.36:3001` แล้ว restart API พิมพ์ QR จาก **โต๊ะ / QR** ใหม่เมื่อเปลี่ยน URL มือถือและเครื่องร้านอยู่ Wi-Fi เดียวกัน ตรวจการแยกอุปกรณ์ของ guest Wi-Fi และอนุญาต firewall เฉพาะเครือข่ายร้าน หาก IP เปลี่ยนบ่อย ให้ตั้ง DHCP reservation ของเครื่องร้านใน router แล้วใช้ที่อยู่คงที่นั้น

ทดสอบสแกนด้วยโทรศัพท์จริงทุกโต๊ะก่อนติดป้าย ทดสอบพิมพ์ใบเสร็จกับเครื่องจริง ระบบนี้พิมพ์ผ่าน browser ไม่ใช่ ESC/POS โดยตรง ถ้าดับหน้าจอ/เครื่องเข้าสลีป บริการในเครื่องจะหยุดตอบจนเครื่องกลับมาทำงาน

## การนำเสนอผ่านฮอตสปอต

ไม่จำเป็นต้องมี Wi-Fi ของสถานที่นำเสนอ เปิดฮอตสปอตบนมือถือ แล้วให้คอมและมือถือกรรมการเชื่อมฮอตสปอตนั้น บางโทรศัพท์/เครือข่ายมี client isolation หรือจำกัดการเข้าถึงคอมจากมือถือเจ้าของฮอตสปอต จึงต้องทดลองจากอุปกรณ์จริงก่อนนำเสนอ

1. หยุดระบบที่เปิดอยู่ด้วย Ctrl+C ใน terminal เดิม ก่อนเปลี่ยนเครือข่ายหรือเริ่มรอบใหม่
2. เชื่อมคอมกับฮอตสปอต แล้วรัน `npm run local:lan` คำสั่งตรวจ IPv4 ของ LAN/Wi-Fi ปัจจุบัน เปลี่ยนเฉพาะ `PUBLIC_ORIGIN` ใน `.env` แล้วเริ่มบริการ ไม่แก้ `APP_ORIGIN`/รหัสผ่าน ไม่ใช้กับ production
3. คอมเปิด `http://localhost:3001` ตามเดิม เข้า **โต๊ะ / QR** แล้วโหลดหน้าใหม่ ให้กรรมการสแกน QR ที่แสดงรอบนี้
4. ทดลองสั่ง/ติดตามด้วยข้อมูลสาธิตก่อนเริ่ม หลีกเลี่ยงการเปลี่ยนเครือข่ายกลางรอบ เพราะลิงก์ QR/ติดตามเดิมที่อ้าง IP เก่าจะเข้าไม่ได้

หากมี Wi-Fi และ Ethernet หรือ VPN พร้อมกันจนเลือกไม่ได้ คำสั่งจะแสดง IP ที่พบ ให้ระบุ `npm run local:lan -- --ip <IP ของคอมในฮอตสปอต>` IP ที่ระบุต้องถูกใช้อยู่บนคอมจริง คำสั่งข้ามชื่อ virtual/VPN adapters ที่รู้จัก แต่ไม่อาจตรวจ VPN ทุกชนิดได้ ควรปิด VPN ที่ไม่จำเป็นตอนสาธิต

ถ้าต้องการตั้งค่าอย่างเดียวโดยไม่เปิดบริการ ใช้ `npm run network:prepare` (หรือ `npm run network:prepare -- --ip <IP>`) แล้ว restart API ที่เปิดอยู่ คำสั่งนี้ไม่ปิด process/เปลี่ยน firewall อัตโนมัติ `local:lan` จะไม่เปิด API ซ้ำถ้าพบว่าเปิดอยู่แล้ว และจะใช้ forecast service ที่เปิดอยู่แทนการเปิดซ้ำ

QR ที่พิมพ์แล้วไม่สามารถเปลี่ยน URL ในตัวเองได้ การเลือก IP อัตโนมัติทำให้ **QR ที่เปิดใหม่** ชี้ถูกหลังย้ายเครือข่ายเท่านั้น ถ้าต้องใช้ QR เดิมถาวรหรือให้มือถือบนเครือข่ายอื่นเข้า ต้องใช้ HTTPS URL คงที่ที่เข้าถึงได้จากอินเทอร์เน็ต

## ระหว่างขาย

1. ลูกค้าสแกนโต๊ะ เลือกเมนูและตัวเลือก ส่งออเดอร์ เก็บลิงก์ติดตามเฉพาะออเดอร์ไว้
2. แคชเชียร์ตรวจเลขโต๊ะ/หมายเหตุ แล้วกด **ยืนยันและส่งเข้าบาร์** ระบบตัดสต็อกครั้งเดียว ถ้าวัตถุดิบขาดให้แก้สต็อกหรือจัดการรายการก่อนยืนยัน
3. ครัว/บาร์เริ่มทำ → พร้อมเสิร์ฟ พนักงานส่งมอบ สถานะลูกค้าอัปเดตตามรายการเดิม
4. หลังทาน เปิดออเดอร์เดิม **รับชำระ** ตรวจยอดเงินจริง/รายการโอนก่อนยืนยัน กรณีเงินสดกรอกยอดรับ ระบบคำนวณทอน พิมพ์ใบเสร็จได้
5. หากกดรับเงินแล้วเน็ตขาด ใช้รายการเดิม/การลองซ้ำที่แอปเตรียมไว้ ตรวจสถานะก่อนสร้างใหม่ ห้ามสร้างออเดอร์ใหม่เพื่อแก้การตอบกลับหาย

การยกเลิกหลังเริ่มทำถือเป็นการใช้วัตถุดิบแล้ว ยอดสต็อกไม่คืนอัตโนมัติ รายการที่ชำระแล้วต้อง owner/manager ยืนยันการคืนเงินจริงก่อนบันทึกคืนเงิน บันทึกของเสียและเหตุผลใน **สต็อกและสูตร** ให้ตรงเหตุการณ์ ไม่ใช้การเพิ่มสต็อกเพื่อปกปิดของเสีย

## ปิดวัน

ตรวจรายการที่ยังรอทำ/ทำ/รอเสิร์ฟและรายการเสิร์ฟแล้วแต่ยังไม่จ่าย รับเงินหรือจัดการรายการให้ครบ ตรวจเงินสดกับรายงานและยอดโอน กดปิดวันในรายงาน ปิดแล้วแก้รายการเงินของวันนั้นไม่ได้ สำรองฐานข้อมูลหลังปิดวันทุกวัน

## สำรองและกู้คืน

ใช้ PostgreSQL 18 client tools (`pg_dump`, `pg_restore`) ถ้าไม่อยู่ใน PATH ให้ตั้ง `PG_BIN` ใน `.env` ระบบค้นหา Windows path มาตรฐานให้เอง คำสั่งนี้ไม่ส่งรหัสผ่านใน command arguments/logs ใช้ connection environment ของ child process จึงต้องทำบนเครื่องและบัญชี OS ที่ไว้ใจได้ ตามข้อจำกัดใน [PostgreSQL environment documentation](https://www.postgresql.org/docs/18/libpq-envars.html)

```powershell
npm run db:backup
# ดูชื่อไฟล์ที่คำสั่งแจ้ง เก็บ .dump และ .dump.json คู่กัน
npm run db:restore -- .local/backups/coffee-เวลาที่สำรอง.dump coffee_restore_drill
```

สำรอง public schema ใน snapshot เดียวกัน รวมเงิน ออเดอร์ สูตร สต็อก audit และรูปที่อัปโหลด ตรวจ archive/ขนาด/SHA-256 พร้อมจำนวนแถวและ migration checksums ค่า default อยู่ใน `.local/backups` ซึ่งไม่ commit ควรเก็บสำเนาในอุปกรณ์อีกเครื่องที่ควบคุมสิทธิ์/เข้ารหัสได้ เก็บอย่างน้อยย้อนหลัง 7 วันและรายสัปดาห์ 4 ชุด ไม่ลบชุดเก่าจนตรวจสำเนาใหม่สำเร็จ ไฟล์ `.partial` ไม่ใช่ backup ที่พร้อมใช้

**กู้คืนสร้างฐานใหม่เท่านั้น** ชื่อต้องขึ้นต้น `coffee_restore_` ห้ามชื่อฐานเดิม/ฐานที่มีอยู่แล้ว บัญชีที่ใช้ต้องมีสิทธิ์สร้างฐาน ระบบตรวจ checksum ก่อนสร้าง และเทียบจำนวนแถวทุกตารางกับ snapshot หลัง restore จากนั้น revoke staff sessions ในฐานใหม่เพื่อให้ล็อกอินใหม่ ถ้าล้มเหลวอาจเหลือฐานใหม่ที่ไม่สมบูรณ์ แต่ฐานร้านเดิมไม่ถูกแทนที่ ตรวจและจัดการฐานทดลองนั้นใน pgAdmin ก่อนลองใหม่ด้วยชื่อใหม่

เมื่อเกิดเหตุจริง: หยุดรับรายการใหม่ เก็บ backup สภาพปัจจุบันถ้าอ่านได้ กู้คืนเป็นฐานใหม่ ทดสอบล็อกอิน/เมนู/รายงาน/รูป ตรวจยอดเงินและรายการหลังเวลา backup แยกต่างหาก แล้วหยุด API/worker เปลี่ยนเฉพาะชื่อฐานใน `DATABASE_URL` รัน migrations/build และเปิดใหม่ การเปลี่ยนฐานใช้งานเป็นการตัดสินใจของเจ้าของร้าน ไม่ทำอัตโนมัติ ต้องกระทบยอดเงินที่รับหลัง backup เพราะไม่อยู่ใน snapshot

สำรองโค้ดด้วย Git และเก็บ `.env` ใน private storage แยกจาก Git ฐานข้อมูลไม่รวมการตั้งค่า OS, firewall, printer หรือไฟล์ `forecast-service/runtime` โมเดลต้นฉบับอยู่ใน Git; โมเดลร้านสามารถเทรนจากประวัติที่กู้คืน หรือสำรอง runtime/volume เพิ่มเมื่อจำเป็น ห้าม restore archive จากแหล่งที่ไม่ไว้วางใจ รายละเอียด [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)

ทดสอบเครื่องมือแบบแยกฐานด้วย `npm run build` แล้ว `npm run test:backup` ต้องใช้ development server ที่อนุญาตสร้าง/ลบฐานทดลอง ระบบไม่ใช้คำสั่งนี้กับฐานร้าน CI ทดสอบขั้นตอนเดียวกัน

## เมื่อมีปัญหา

| อาการ                | ตรวจและแก้                                                                       |
| -------------------- | -------------------------------------------------------------------------------- |
| เปิดเว็บไม่ได้       | PostgreSQL ทำงาน, terminal `npm run local`, `npm run ops:check`, port 3001 ไม่ชน |
| มือถือเปิด QR ไม่ได้ | PUBLIC_ORIGIN, IP ปัจจุบัน, Wi-Fi, firewall; ห้าม localhost                      |
| ถูกออกจากระบบ        | เข้าสู่ระบบใหม่; หลังเปลี่ยนรหัส/สิทธิ์หรือกู้คืนต้องล็อกอินใหม่                 |
| ข้อมูลถูกแก้แล้ว     | ปิดฟอร์ม โหลดรายการล่าสุด แล้วแก้อีกครั้ง ระบบไม่ทับงานผู้อื่น                   |
| รับเงินแล้วไม่แน่ใจ  | ตรวจออเดอร์เดิม/รายงาน/เงินจริงก่อนลองซ้ำ ห้ามรับเงินซ้ำ                         |
| ปิดวันไม่ได้         | ตรวจออเดอร์ที่ยังไม่ส่งมอบและรายการค้างชำระ รวมเสิร์ฟแล้ว                        |
| พยากรณ์ข้อมูลไม่พอ   | ตรวจการปิดวัน/ประวัติต่อเนื่อง ไม่เติมยอดปลอมหรือศูนย์ให้วันที่ไม่ทราบ           |
| backup ล้มเหลว       | PG_BIN/version18, สิทธิ์ฐาน, พื้นที่ว่าง; เก็บ backup ก่อนหน้าจนชุดใหม่ผ่าน      |

## เปิดผ่านอินเทอร์เน็ต

การตั้งค่า Compose ใน repo เป็น development ต้องเตรียมโดเมนและ HTTPS จริงก่อนเปิด production ตั้ง `NODE_ENV=production`, `APP_ORIGIN`/`PUBLIC_ORIGIN` เป็น HTTPS ที่ไม่มี path/trailing slash ใช้บัญชี DB เฉพาะร้านและรหัสเฉพาะ ให้ PostgreSQL/forecast อยู่ในเครือข่ายภายใน เปิดเฉพาะ reverse proxy ไป API อย่าเปิดพอร์ต DB/forecast สาธารณะ จัดบริการให้ restart หลัง reboot และทดสอบกู้คืนบนเครื่องปลายทาง

ยังไม่มีโดเมน/เครื่องปลายทางที่ผู้ใช้ระบุ จึงไม่ได้เผยแพร่ระบบสู่สาธารณะหรือซื้อบริการ หากมีหลาย API instances ต้องใช้ shared rate-limit store และกำหนด trusted proxy ตาม topology จริง ห้ามตั้ง `trust proxy=true` แบบไม่จำกัด

## Forecast v5 operations

See [active architecture and APIs](forecast-v5.md). Run migrations after a verified backup; migration 014 is additive and keeps old forecasts. Keep Node and FastAPI at the same version. Worker needs yesterday's closing after 02:00 Bangkok and creates all three horizons atomically; a missing closing waits and failures retry. `FORECAST_SAFETY_FACTOR` defaults to 1 (1–2 supported); the dashboard can override its view without changing saved snapshots. New v5 models refit from saved business inputs and do not require offline ProjectA artifacts/runtime caches. Do not confuse a retrospective analysis with a prediction actually issued in the past. Genuine accuracy requires future customer outcomes; simulation and old-pipeline results remain separately labeled.

## Warehouse extension (2026-11-04)

See [single-shop operations and migration](single-shop.md) and the [earlier implementation status](project-completion-status.md). Inventory supports stocktaking, lot and expiry tracking, supplier purchasing and partial receipts, and expense history. Normal startup leaves demo sales generation disabled. Legacy stock keeps its unknown provenance, cost, and expiry until reviewed.

For manual acceptance use `/acceptance` and [the participant template](acceptance-session-template.md); physical printer testing uses `/printer-test` and [the device checklist](printer-acceptance.md). Neither page is evidence that unavailable participants/hardware were tested. Future genuine-sales validation follows [the prospective collection protocol](prospective-validation.md).

`npm run test:load` creates a retained isolated QA schema and verifies operational source counts/stock hashes; it must never be substituted with production traffic generation. Current local measurements and limitations are in the completion guide. Backup verification databases and QA schemas are retained; deleting them requires a separate reviewed decision.
