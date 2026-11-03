# พยากรณ์ความต้องการสินค้า v2

## ข้อมูลที่ใช้และเป้าหมาย

ค่าเริ่มต้นใช้ **ประวัติส่งมอบจริงเท่านั้น** (`data_mode=actual`) จำนวนต่อเมนูต่อวัน Bangkok จาก `orders.completed_at` และ order item snapshots นับสินค้าเสิร์ฟแล้วแม้ยังไม่ชำระหรือคืนเงินภายหลัง ไม่เอาวันรับเงินมาเลื่อนความต้องการ รายงานการเงินและ `sales_daily.source=actual` เดิมยังใช้วันรับเงินตามเดิม ไม่มีการแก้ payment/stock/order timestamps เพื่อเทรน

ข้อยกเว้นที่เจ้าของร้องขออย่างชัดเจน: [การจำลองย้อนหลังในฐานหลัก](main-shop-replay.md) สร้างรายการผ่าน workflow ของร้านเดิม พร้อม `simulation_run_id` และเวลาเหตุการณ์จำลองเฉพาะรายการใหม่ `actual` จึงหมายถึง order ledger ไม่ใช่การรับรองว่าทุกรายการมาจากลูกค้าจริง archive ที่ใช้ประวัติเหล่านี้มี `contains_simulated_sales` และคะแนนอยู่ในกลุ่ม simulation แยกจากคะแนนยอดขายปกติ การจำลองไม่แก้ timestamps ของรายการเดิม

วันที่ปิดวันแล้วและเมนูมีอยู่ตาม `forecast_since` แต่ไม่มีการส่งมอบ จะเป็น zero observation วันที่หาย/วันที่ยังไม่ครบ/ก่อนมีเมนูไม่ถูกเติมศูนย์ ใช้ประวัติย้อนหลังสูงสุด 120 วัน ยังไม่มี stockout/เวลาเปิดร้าน/อากาศเป็น feature ข้อมูลส่งมอบเป็น observed fulfilled demand ไม่ใช่ยอดที่ลูกค้าอยากซื้อทั้งหมดเมื่อสินค้าขาด

โหมดทดลอง `mixed` อนุญาตประวัติ demo โดย actual ในวันเดียวกันมีลำดับสูงกว่า มีป้ายบอกบนหน้าจอและในรอบที่เก็บไว้ ข้อมูลภายนอกไม่ถูกนำเข้า order/payment/actual ของร้าน ดู [การตรวจแหล่งข้อมูล](forecast-data-review.md)

## วิธีที่เปรียบเทียบ

- ยอดวันเดียวกันสัปดาห์ก่อน
- ค่าเฉลี่ย 7 วัน, ค่าเฉลี่ย 28 วัน และค่าเฉลี่ย weekday เดียวกันสี่สัปดาห์
- Simple exponential smoothing (SES), alpha 0.2
- Damped Holt: alpha 0.3, beta 0.1, phi 0.9; จำกัดผลลัพธ์ไม่ติดลบ
- ProjectA XGBoost เดิม (retail transfer candidate) และ Poisson XGBoost ที่เทรนจากประวัติร้าน

สมการ smoothing อ้างอิง [Forecasting: Principles and Practice](https://otexts.com/fpp3/exponential-smoothing.html) ค่าพารามิเตอร์กำหนดไว้ล่วงหน้า ไม่ได้อ้างว่าเป็น ETS ที่ optimize likelihood หรือช่วงความเชื่อมั่นที่สอบเทียบแล้ว โมเดลสถิติเก็บ state จากข้อมูลก่อน origin เท่านั้น

เลือกตาม MAE รายเมนูและระยะที่ร้องขอ โดยใช้ rolling validation ที่คำตอบแต่ละช่วงไม่ซ้อนกัน:

| ระยะ | ประวัติขั้นต่ำสำหรับเลือกวิธี | จุดออกผลย้อนหลัง | คู่ต่อเมนู |
| --- | ---: | --- | ---: |
| 1 วัน | 42 วัน | ย้อนหลัง 14 ถึง 1 วัน | 14 |
| 7 วัน | 56 วัน | ย้อนหลัง 28, 21, 14, 7 วัน | 28 |
| 30 วัน | 88 วัน | ย้อนหลัง 60, 30 วัน | 60 |

ทุกจุดมีข้อมูลฝึกก่อนคำตอบอย่างน้อย 28 วัน หากยังไม่ถึงเกณฑ์ใช้ weekly baseline โดยยังต้องมีประวัติครบ 28 วันต่อเนื่อง คะแนน selection เหล่านี้ **ไม่ใช่ independent holdout** แม้หน้าต่างไม่ซ้อนกันแล้ว ห้ามเปลี่ยนวิธีแล้วอ้างคะแนน holdout เดิมเป็นผลทดสอบใหม่

ทุกวิธีใช้ target/ช่วงวันเดียวกัน ไม่ใช้ราคาจากอนาคต หากคะแนนเท่ากันคง weekly baseline โมเดลร้านฝึกใหม่ด้วยประวัติทั้งหมดเฉพาะเมื่อถูกเลือก ผลลัพธ์คง model version และ diagnostic scores ของทุก candidate ไม่มีการบังคับให้ XGBoost ชนะ บริการใช้ `coffee-selection-v3`

## รอบพยากรณ์ที่แก้ย้อนหลังไม่ได้

Migration 010 เพิ่ม `forecast_runs` และ `forecast_run_points` ทุกครั้งที่สำเร็จจะเก็บรอบใหม่พร้อม:

- เวลาที่เริ่มสร้าง, ช่วงเป้าหมาย, โหมดข้อมูล, target basis `fulfilled_v1` และ actor
- ประวัติที่ส่งให้โมเดลจริงทั้งชุด พร้อม SHA-256
- ผลรายเมนู/วัน, ระยะล่วงหน้าจากวันที่ออก forecast, method/version, provenance, bounds ถ้ามี และ diagnostics

DB triggers ปฏิเสธ UPDATE/DELETE ของ archive ตาราง `forecasts` เดิมยังเป็น cache สำหรับ compatibility เมื่อมี archive หน้าผลล่าสุดเลือกหนึ่งรอบที่ครอบคลุมเมนูมากที่สุด แล้วเลือกรอบล่าสุดในขอบเขตนั้น ไม่ต่อค่าหลายรอบเข้าด้วยกัน รายการแนะนำ stock คำนวณจากจุดที่แสดงบนกราฟจริง ผลเก่าจากฐาน paid-sales ไม่ถูกแอบ backfill เป็นรอบ fulfilled หรือใช้คิดคะแนนใหม่

JSON export มี `input_history_serialized` เป็นข้อความ UTF-8 ที่เรียง property ตามสัญญาคงที่ (`date,product_id,qty,unit_price,source`) ใช้ SHA-256 ของข้อความนี้เทียบ `history_sha256` ได้ตรง แม้ PostgreSQL jsonb จะจัดลำดับ key ของ object ใหม่ ไม่ใช้ hash ของไฟล์ export ทั้งไฟล์

หน้าเว็บเลือกดู 50 รอบล่าสุดในช่วงวันที่ที่กรองได้ (รอบอื่นยังอยู่ใน DB และเปิดด้วย run ID ได้) เลือกรอบแล้วดาวน์โหลด JSON รวม snapshot ผ่าน `GET /api/forecasts/runs/:id` เฉพาะ owner/manager การ export มีข้อมูลธุรกิจ จัดเก็บเป็นส่วนตัว ไม่มีข้อมูลลูกค้าหรือ token จาก orders ถูกส่งเข้า snapshot

## คะแนนจากการใช้งานจริง

คะแนนหลักใช้เฉพาะ `data_mode=actual`, `history_source=actual`, target `fulfilled_v1`, ออก forecast ก่อนวันเป้าหมาย และมี actual ที่จับคู่ได้ ไม่รวม legacy/demo/mixed/backcast หรือวันปัจจุบันที่ยังไม่จบ

นโยบายคงที่: เลือกรอบที่ออก **แรกสุด** ต่อเมนู/วันเป้าหมาย/lead/source/mode การกดสร้างซ้ำจึงไม่คูณจำนวนตัวอย่างหรือเลือกคะแนนที่ดูดีภายหลัง แสดงคะแนนแยกตาม lead และเมนู ส่วนคะแนนรวมทุก lead คือ forecast pairs หลายระยะ ไม่ใช่จำนวนวันอิสระ

MAE/RMSE/Bias รวม actual เป็นศูนย์ด้วย MAPE ตัดคู่ที่ actual=0 และระบุจำนวน zero pairs; WAPE ไม่กำหนดเมื่อยอดจริงรวมเป็นศูนย์ ทุกคะแนนเป็น null เมื่อยังไม่มีคู่ที่วัดได้ แสดงผลโหมดทดลองแยกจากคะแนนหลัก

ช่อง MAPE/RMSE/MAE/WAPE เลือกแหล่งคะแนนด้วย `score` ใน URL: auto/actual/simulation/demo/mixed/unknown อัตโนมัติให้ใช้กลุ่ม simulation เมื่อรอบที่แสดงฝึกจากรายการจำลอง โดยมีป้ายระบุที่มา ไม่เปลี่ยน API `accuracy` ซึ่งยังเก็บคะแนน genuine เท่านั้น ช่วงอนาคตที่ยังไม่มีคู่เทียบยังแสดง — และมีลิงก์ดู holdout ล่าสุดจาก metadata ของรอบจำลองที่ complete แล้ว คะแนนยังเป็น population ตามช่วงวัน/เมนู/lead ตาม earliest-issued policy ไม่ได้เลือกเฉพาะรอบที่คะแนนดีที่สุด

กราฟมีวันปฏิทินครบ ไม่เติมวันหายเป็นศูนย์ ไม่ลากเส้นข้ามข้อมูลที่ไม่ทราบ และมีป้ายวันขาด แสดงจำนวนเมนูที่มี observation เมื่อวันนั้นมีข้อมูลบางเมนู จุดพยากรณ์ของกราฟและคำแนะนำวัตถุดิบมาจากรอบเดียวกัน

การเลือก run ID เปลี่ยนกราฟ/รายละเอียด/stock recommendation ตามรอบนั้น stock recommendation ใช้สูตรพื้นฐานและ stock **ปัจจุบัน** ไม่ใช่ snapshot วัตถุดิบในอดีต ส่วนตารางวัดผลใช้ population และนโยบาย earliest-issued ข้างต้นตามช่วงวัน/เมนู/lead ที่เลือก ไม่คำนวณคะแนนเฉพาะรอบที่เลือกเพื่อหลีกเลี่ยงการเลือกเฉพาะรอบที่ชนะ

## ใช้หน้าพยากรณ์

1. เลือกช่วงวัน/เมนูและโหมดข้อมูล กด **แสดงผล** ตรวจตารางความพร้อม วันล่าสุด/วันต่อเนื่อง
2. โหมดจริงต้องมี 28 วันต่อเนื่องที่ล่าสุดไม่เก่าเกินเกณฑ์ ชุดหลายเมนูต้องมี origin ร่วมกันครบด้วย หากยังไม่พร้อมเลือกเฉพาะเมนู หรือใช้โหมดทดลองอย่างชัดเจนเพื่อสาธิต
3. เลือก 7/28/30 วันแล้ว **สร้างพยากรณ์ใหม่** ระบบเก็บรอบใหม่ ผล 29–30 วันยังไม่มีข้ออ้างความแม่นยำอิสระ
4. เลือกรอบเก่า/ดาวน์โหลด JSON ดูประวัติที่ใช้ เหตุผล และคะแนนเลือกวิธีในรายละเอียดเมนู
5. หลังมีการส่งมอบจริงในอนาคต ดู MAE/WAPE/RMSE/Bias โดยกรองระยะล่วงหน้า 1/7/14/28 วัน

Nightly worker ใช้โหมด actual เสมอและยังเป็น all-menu batch ถ้าเมนูใดไม่มีประวัติเพียงพอจะไม่สร้างผลปลอมหรือสลับไป demo การเทรนโมเดล/การประเมินยังต้องมีข้อมูลร้านจริงต่อเนื่อง ไม่สามารถพิสูจน์ความแม่นยำด้วยยอด demo

## การตรวจสอบ

Backend ตรวจ archive immutability/snapshots, permission/export, cross-midnight payment vs delivery, unpaid/refunded deliveries, provenance, duplicate evaluation and zero-demand metrics บน PGlite และ PostgreSQL จริง Model tests ตรวจ rolling splits, future price isolation, baselines/smoothing, common-origin completeness และ reproducibility ของโมเดลเดิม Browser ตรวจ mode switch/readiness, old-run selection/export, duplicate generation, mobile and accessibility ใน schema ทดลอง

สำรองฐานก่อน migration 010 และตรวจ recovery หลังเพิ่มสองตาราง Archive เพิ่มขนาด DB ตามจำนวนรอบ ควรสำรองนอกเครื่องและเฝ้าดูพื้นที่ว่าง ไม่เปิด endpoint ลบ archive โดยอัตโนมัติ

## Monthly history and evaluation contract

History browsing and UTF-8 BOM CSV use the requested range (maximum 367 days), independently of the 120-day training window. Unknown daily quantities stay blank. CSV includes closed/unclosed status, simulation lineage, prediction/model/run metadata and formula-neutralized names. Unclosed order observations are isolated chart points and excluded from training, readiness and evaluation; demo mode remains explicitly synthetic.

The 1/7/30 evaluation table uses issued archived predictions and closed-day outcomes, separated by provenance. Weekly baseline values come only from the original run snapshot; the paired-model and baseline MAEs use identical available pairs. Horizons are cumulative leads 1 through 1/7/30, not errors of aggregated weekly/monthly totals. Historical targets never enter current stock recommendations. Use 1-7 days to assist preparation and 30 days for trend planning; simulated scores do not establish real-customer accuracy.

## Verification on 2026-11-03

Local checks: 80 PostgreSQL integration/configuration tests, 30 Python model tests, and 25 browser workflow groups passed. Main-app read-only QA verifies April history beyond the training window, UTF-8 CSV download, monthly navigation, desktop/mobile layout, and archived 1/7/30-day baseline comparisons against the independently saved replay report. New main-app rounds for 1/7/30 days produced 8/56/240 points in about 2.7/1.6/2.0 seconds; unclosed November 2 observations were absent from their inputs.

A posthoc reanalysis of the already-examined October 3-November 1 simulation window using its original frozen input gave v3 MAE 2.658917, RMSE 3.269751 and WAPE 36.07349% (240 pairs). Original issued v2 scores were MAE 2.775421, RMSE 3.430429 and WAPE 37.65410%. This retrospective result is lower than v2 on the examined simulation, but is not evidence of improved real-shop accuracy or a new untouched holdout. No tuning was performed against these outcomes, and the old immutable archive/scores remain unchanged. New future rounds must accumulate closed-day outcomes before they can establish prospective accuracy.

Selection validation also reproduces the gap between the last closed observation and the first requested target (0-6 days): each fold recursively bridges those unobserved days before scoring its 1/7/30-day target window. Minimum selection history increases by this gap. This prevents a nominal next-day request from being selected using day-ahead errors when its latest closed input is several days old.

Active implementation: [Forecast v4](forecast-v4.md) supersedes the earlier v2/v3 selection and no-interval rules in this document for new rounds. Prior archives remain available unchanged.
